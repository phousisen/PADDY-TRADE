// Offline support for Weighing Tickets.
//
// Why this exists: some stations barely have WiFi and it drops often, but
// trucks keep arriving. Staff need to keep creating tickets, weighing,
// pricing, and finalizing with zero connection — then have everything
// quietly catch up with PaddyTrade the moment the connection comes back.
//
// How it works, in plain terms:
//  - Every new ticket/party/product gets its ID generated on the device
//    right away (a UUID), not by the server. That means the ticket is
//    "real" immediately, offline or not, and its ID never has to change
//    later when it syncs.
//  - A copy of each ticket is kept in the browser's local storage on that
//    device, so the board still shows it even with zero network.
//  - Every action (create ticket, weigh in, set price, weigh out,
//    finalize) is applied to that local copy immediately, AND queued up
//    to be sent to the server. If we're online, we try to send it right
//    away. If we're offline (or the send fails), it stays queued.
//  - Queued actions are sent in the exact order they happened, and we
//    wait for each one to succeed before sending the next — so, for
//    example, a ticket always reaches the server before the "set price"
//    update for that same ticket does.
//  - The moment the browser regains a connection, or every 15 seconds as
//    a safety net, we try to flush the queue.
//
// This file has no UI in it — WeighingTickets.jsx calls into it.

import { api } from "./api.js";
import { ensureFreshSession } from "./supabaseClient.js";

const CACHE_KEY = "ptw_ticket_cache_v1";
const QUEUE_KEY = "ptw_ticket_queue_v1";
const PARTY_CACHE_KEY = "ptw_party_cache_v1";
const PRODUCT_CACHE_KEY = "ptw_product_cache_v1";
const PAPER_TICKET_KEY = "ptw_last_paper_ticket_no_v1";

// Same timezone stamping used in api.js — stamps with Cambodia's actual
// wall-clock time regardless of the device's own timezone setting, since
// this is what ends up on the printed slip/receipt.
function cambodiaNow() {
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date())
    .forEach((p) => { parts[p.type] = p.value; });
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}:${parts.second}` };
}

// Races an online-only lookup against a plain timer. Some "offline" is
// actually WiFi still connected to a router with no real internet behind
// it (common at these stations) — instead of that lookup sitting for a
// long time before the browser gives up, we stop waiting on our own terms
// and fall back to creating the record locally, same reasoning as
// AuthContext.jsx's withTimeout for login. Never rejects — resolves to
// `fallbackValue` if `promise` doesn't settle within `ms`.
// Kept short on purpose: this is what New Ticket's Save button actually
// waits on (see resolvePartyIdOffline/resolveProductIdOffline below), so
// a flaky connection shouldn't make staff sit and stare at "Saving…" for
// several seconds before a ticket appears. It's safe to keep this tight
// now that a same-phone/same-name conflict at sync time is handled
// gracefully too (see api.js's createParty/createProduct) instead of
// getting the whole offline queue stuck — this lookup only has to be
// fast, not the only line of defense against a duplicate.
const ONLINE_LOOKUP_TIMEOUT_MS = 1200;
export function withTimeout(promise, ms, fallbackValue) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallbackValue), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallbackValue); }
    );
  });
}

export function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older browsers that don't have crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------
// Quality Ticket No. auto-increment — Baitang's paper tickets come from a
// pre-numbered booklet, used in order, so once staff have typed the first
// one for a location, every New Ticket screen after that can suggest the
// next number for them (still just a suggestion — they can always type
// over it, e.g. if a ticket was spoiled or they're on a different
// booklet). Kept separate from the ticket cache itself since that cache
// only holds tickets still in progress — a finalized ticket drops out of
// it — but the "last number used" needs to survive that.
// ---------------------------------------------------------------------

function readLastPaperTicketMap() {
  return readJSON(PAPER_TICKET_KEY, {});
}

export function suggestNextPaperTicketNo(locationId) {
  const map = readLastPaperTicketMap();
  const last = map[locationId || "_default"];
  if (!last) return "";
  const digitMatch = last.match(/\d+$/);
  if (!digitMatch) return "";
  const numPart = digitMatch[0];
  const prefix = last.slice(0, last.length - numPart.length);
  const incremented = String(Number(numPart) + 1).padStart(numPart.length, "0");
  return prefix + incremented;
}

export function recordPaperTicketNo(locationId, paperTicketNo) {
  const trimmed = (paperTicketNo || "").trim();
  if (!trimmed) return;
  const map = readLastPaperTicketMap();
  map[locationId || "_default"] = trimmed;
  writeJSON(PAPER_TICKET_KEY, map);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — nothing we can do locally, the queue
    // just won't persist across a page reload this one time.
  }
}

// Compare-and-swap style write: snapshots the raw stored string, computes
// the mutation, then re-reads that raw string again immediately before
// writing — if it changed in between, another tab wrote in the meantime and
// this redoes the whole mutation against their latest state instead of
// blindly overwriting it. This closes a real data-loss window: two
// tabs/windows of PaddyTrade open on the same computer at once (e.g.
// someone checking Transactions in one tab while another person is
// mid-entry on New Buy in a second tab) both read and write this same
// localStorage key with no locking otherwise, and whichever tab's write
// lands last silently erases whatever the other tab had just added —
// including a brand-new, already-printed transaction that exists nowhere
// else yet.
//
// An earlier version of this function checked AFTER writing (re-reading and
// comparing to what it had just written) instead of BEFORE — that only
// catches a collision that happens in the few instructions between the
// write and that verify-read. A collision landing between the initial READ
// and the write itself (an equally likely window, same size) sailed through
// undetected, because the write simply overwrote it and the after-the-fact
// check trivially matched what had just been written. A small test harness
// exercising this exact scenario (built while investigating a lost
// transaction) caught it — see offline_test/ in the delivered files. The
// version below checks the precondition (has anything changed since I
// read?) rather than the postcondition (does storage match what I just
// wrote?), which is what an actual compare-and-swap needs to do.
//
// localStorage still has no real cross-tab lock, so this narrows the unsafe
// window down to the handful of instructions between the pre-write
// recheck and the write itself, rather than fully eliminating it — but that
// window is now about as small as plain synchronous JS can make it.
function mutateQueue(mutator) {
  for (let attempt = 0; attempt < 25; attempt++) {
    let rawBefore;
    try { rawBefore = localStorage.getItem(QUEUE_KEY); } catch { rawBefore = null; }
    let current;
    try { current = rawBefore ? JSON.parse(rawBefore) : []; } catch { current = []; }
    const next = mutator(current.slice());

    let rawNow;
    try { rawNow = localStorage.getItem(QUEUE_KEY); } catch { rawNow = null; }
    if (rawNow !== rawBefore) continue; // someone else wrote in between — redo against their latest state

    writeJSON(QUEUE_KEY, next);
    notifyStatus();
    return next;
  }
  // 25 collisions in a row would mean something is pathologically wrong
  // (not just two tabs racing occasionally) — fall back to whatever is
  // currently stored rather than looping forever.
  notifyStatus();
  return getQueue();
}

// ---------------------------------------------------------------------
// Ticket cache — a local mirror of the ticket board so it still renders
// with no network at all.
// ---------------------------------------------------------------------

export function getCachedTickets() {
  return readJSON(CACHE_KEY, []);
}

export function upsertCachedTicket(ticket) {
  const list = getCachedTickets();
  const i = list.findIndex((t) => t.id === ticket.id);
  if (i >= 0) list[i] = { ...list[i], ...ticket };
  else list.unshift(ticket);
  writeJSON(CACHE_KEY, list);
  return list;
}

export function removeCachedTicket(id) {
  const list = getCachedTickets().filter((t) => t.id !== id);
  writeJSON(CACHE_KEY, list);
  return list;
}

// Merges what the server just returned with what we have locally. Server
// data wins for any ticket that has no local pending changes; a ticket
// that still has queued (unsynced) operations keeps its local version so
// we don't briefly flash stale server data over it.
export function mergeServerTickets(serverTickets) {
  const pendingIds = new Set(getQueue().map((op) => op.ticketId).filter(Boolean));
  const local = getCachedTickets();
  const localById = new Map(local.map((t) => [t.id, t]));
  const merged = serverTickets.map((t) => (pendingIds.has(t.id) && localById.has(t.id) ? localById.get(t.id) : t));
  // Keep any locally-created tickets the server doesn't know about yet
  // (still offline, or synced a split second ago and not yet re-fetched).
  const serverIds = new Set(serverTickets.map((t) => t.id));
  for (const t of local) {
    if (!serverIds.has(t.id) && pendingIds.has(t.id)) merged.unshift(t);
  }
  writeJSON(CACHE_KEY, merged);
  return merged;
}

// ---------------------------------------------------------------------
// Transaction cache — a local mirror of Buy/Sell transactions (both ones
// finalized from a Weighing Ticket and manual entries) so the
// Transactions list still shows real, correct data with no network at
// all. Before this existed, a transaction saved offline (or during a
// connection blip) was safely queued and the printed receipt correctly
// warned it wasn't synced yet — but the Transactions LIST page itself
// had nothing to fall back on: it only ever asked the server directly,
// so until the connection came back and a server fetch actually
// succeeded, the sale looked like it had vanished, even though nothing
// was ever lost.
// ---------------------------------------------------------------------

const TX_CACHE_KEY = "ptw_tx_cache_v1";

export function getCachedTransactions() {
  return readJSON(TX_CACHE_KEY, []);
}

export function upsertCachedTransaction(tx) {
  const list = getCachedTransactions();
  const i = list.findIndex((t) => t.id === tx.id);
  if (i >= 0) list[i] = { ...list[i], ...tx };
  else list.unshift(tx);
  writeJSON(TX_CACHE_KEY, list);
  return list;
}

// Every transaction id this device still has queued changes for — either
// a manual entry not yet sent (createTransaction, keyed by payload.id)
// or one created by finalizing a Weighing Ticket (finalizeTicket, keyed
// by payload.transactionId rather than the op's own ticketId).
function pendingTransactionIds() {
  const ids = new Set();
  for (const op of getQueue()) {
    if (op.type === "createTransaction" && op.payload?.id) ids.add(op.payload.id);
    if (op.type === "finalizeTicket" && op.payload?.transactionId) ids.add(op.payload.transactionId);
  }
  return ids;
}

// Same reasoning as mergeServerTickets above: server data wins for any
// transaction with no local pending changes; one still queued on this
// device keeps its local (already receipt-ready) version so it doesn't
// flash away, and any transaction the server doesn't know about yet
// (still offline, or synced a split second ago and not yet re-fetched)
// stays visible too instead of disappearing.
export function mergeServerTransactions(serverTxs) {
  const pendingIds = pendingTransactionIds();
  const local = getCachedTransactions();
  const localById = new Map(local.map((t) => [t.id, t]));
  const merged = serverTxs.map((t) => (pendingIds.has(t.id) && localById.has(t.id) ? localById.get(t.id) : t));
  const serverIds = new Set(serverTxs.map((t) => t.id));
  for (const t of local) {
    if (!serverIds.has(t.id) && pendingIds.has(t.id)) merged.unshift(t);
  }
  writeJSON(TX_CACHE_KEY, merged);
  return merged;
}

// ---------------------------------------------------------------------
// Payment cache — same reasoning as the transaction cache just above,
// for the "already Paid" cash payment recorded at the moment a manual
// Buy/Sell is saved (createPaymentOffline). Without this, the amount
// shown as "Paid" / "Remaining" on the Transactions list for a
// just-saved offline entry would be wrong (looking like the full amount
// is still owed) until the payment itself finished syncing.
// ---------------------------------------------------------------------

const PAYMENT_CACHE_KEY = "ptw_payment_cache_v1";

export function getCachedPayments() {
  return readJSON(PAYMENT_CACHE_KEY, []);
}

export function upsertCachedPayment(payment) {
  const list = getCachedPayments();
  const i = list.findIndex((p) => p.id === payment.id);
  if (i >= 0) list[i] = { ...list[i], ...payment };
  else list.unshift(payment);
  writeJSON(PAYMENT_CACHE_KEY, list);
  return list;
}

export function mergeServerPayments(serverPayments) {
  const pendingIds = new Set(
    getQueue().filter((op) => op.type === "createPayment" && op.payload?.id).map((op) => op.payload.id)
  );
  const local = getCachedPayments();
  const localById = new Map(local.map((p) => [p.id, p]));
  const merged = serverPayments.map((p) => (pendingIds.has(p.id) && localById.has(p.id) ? localById.get(p.id) : p));
  const serverIds = new Set(serverPayments.map((p) => p.id));
  for (const p of local) {
    if (!serverIds.has(p.id) && pendingIds.has(p.id)) merged.unshift(p);
  }
  writeJSON(PAYMENT_CACHE_KEY, merged);
  return merged;
}

// ---------------------------------------------------------------------
// Party / product lookup caches — so typing a farmer's or buyer's name
// (and matching it to an existing record, or deciding it's new) works
// without a network round-trip.
// ---------------------------------------------------------------------

export function getCachedParties() {
  return readJSON(PARTY_CACHE_KEY, []);
}
export function setCachedParties(list) {
  writeJSON(PARTY_CACHE_KEY, list);
}
export function addCachedParty(party) {
  const list = getCachedParties();
  if (!list.some((p) => p.id === party.id)) {
    list.push(party);
    writeJSON(PARTY_CACHE_KEY, list);
  }
}

// Fixes up local state after a queued createParty op turns out to have
// reused an EXISTING party (same phone + location) instead of actually
// inserting a new one under the id we generated on this device — see the
// comment in api.js's createParty. Every ticket, and every still-queued
// op, that was already pointing at the id that didn't end up being used
// gets repointed at the real one, so nothing downstream (like this same
// ticket's own createTicket op, sitting right behind this one in the
// queue) tries to save against a party id that was never actually
// inserted.
function remapPartyId(oldId, newId) {
  if (!oldId || oldId === newId) return;

  const tickets = getCachedTickets();
  let ticketsChanged = false;
  for (const t of tickets) {
    if (t.party_id === oldId) { t.party_id = newId; ticketsChanged = true; }
  }
  if (ticketsChanged) writeJSON(CACHE_KEY, tickets);

  mutateQueue((q) => {
    for (const op of q) {
      if (op.payload && op.payload.partyId === oldId) op.payload.partyId = newId;
    }
    return q;
  });

  // Drop the placeholder cache row keyed by the id that never actually
  // made it to the server, so nothing offline resolves a fresh lookup to
  // it again.
  const parties = getCachedParties().filter((p) => p.id !== oldId);
  writeJSON(PARTY_CACHE_KEY, parties);
}

// Same idea as remapPartyId above, for products — a queued createProduct
// op can also resolve to an EXISTING row (same name) instead of actually
// inserting a new one under the id generated on this device.
function remapProductId(oldId, newId) {
  if (!oldId || oldId === newId) return;

  const tickets = getCachedTickets();
  let ticketsChanged = false;
  for (const t of tickets) {
    if (t.product_id === oldId) { t.product_id = newId; ticketsChanged = true; }
  }
  if (ticketsChanged) writeJSON(CACHE_KEY, tickets);

  mutateQueue((q) => {
    for (const op of q) {
      if (op.payload && op.payload.productId === oldId) op.payload.productId = newId;
    }
    return q;
  });

  const products = getCachedProducts().filter((p) => p.id !== oldId);
  writeJSON(PRODUCT_CACHE_KEY, products);
}

// Called when the server tells us a queued ticket change (weigh-in,
// price, weigh-out, or finalize) targets a weighing ticket that no
// longer exists — most likely a database reset ran (e.g. clearing test
// data) after this device queued the change while it was offline.
// Clears it off the local board and drops every still-queued change for
// that same ticket too, since none of them can succeed either — otherwise
// the very next one just blocks that ticket's lane again the same way, one
// at a time. (The op that triggered this — the one currently being
// processed — gets removed the normal way, by its own id, right after this
// runs in trySync; it doesn't need special handling here.)
function dropOtherOpsForGoneTicket(ticketId) {
  if (!ticketId) return;
  removeCachedTicket(ticketId);
  mutateQueue((q) => q.filter((op) => op.ticketId !== ticketId));
  // Also clear any "stuck" tracking for that ticket's now-dropped ops —
  // otherwise a ticket that just got cleared could keep reporting as
  // stuck in the sync banner forever, even though nothing for it is left
  // in the queue to retry.
  for (const [opId, entry] of stuckOps) {
    if (entry.ticketId === ticketId) stuckOps.delete(opId);
  }
}

export function getCachedProducts() {
  return readJSON(PRODUCT_CACHE_KEY, []);
}
export function setCachedProducts(list) {
  writeJSON(PRODUCT_CACHE_KEY, list);
}
export function addCachedProduct(product) {
  const list = getCachedProducts();
  if (!list.some((p) => p.id === product.id)) {
    list.push(product);
    writeJSON(PRODUCT_CACHE_KEY, list);
  }
}

// Called whenever we're online and have a spare moment (e.g. on page
// load, or right after a successful sync) so the lookup caches used
// offline stay reasonably fresh.
export async function refreshLookupCaches() {
  // No connection at all — skip straight out instead of spending up to
  // ONLINE_LOOKUP_TIMEOUT_MS x2 waiting on requests that have no chance of
  // succeeding. Whatever's already cached stays exactly as it was.
  if (!navigator.onLine) return;
  const [parties, products] = await Promise.all([
    withTimeout(api.getParties().catch(() => null), ONLINE_LOOKUP_TIMEOUT_MS, null),
    withTimeout(api.getProducts().catch(() => null), ONLINE_LOOKUP_TIMEOUT_MS, null),
  ]);
  // Offline, timed out, or failed — just keep whatever's already cached
  // rather than wiping it out with an empty/partial result.
  if (parties) setCachedParties(parties);
  if (products) setCachedProducts(products);
}

// ---------------------------------------------------------------------
// Pending operations queue.
// ---------------------------------------------------------------------

export function getQueue() {
  return readJSON(QUEUE_KEY, []);
}
export function enqueue(op) {
  // Every op gets a stable id of its own (separate from ticketId/partyId,
  // which name what the op acts ON, not the op itself) so a specific op
  // can be pulled out of the middle of the queue once it succeeds — not
  // just "whatever's currently at the front" — which matters once ops for
  // different tickets are allowed to be attempted out of relative order
  // (see trySync below).
  mutateQueue((q) => { q.push({ ...op, _id: newId() }); return q; });
}
// Removes one specific op by id, wherever it currently sits in the queue —
// used instead of a plain shift() so a later, unrelated op that finished
// first (see trySync) is removed correctly even though it isn't at index 0.
function removeOp(opId) {
  if (!opId) return;
  mutateQueue((q) => q.filter((o) => o._id !== opId));
  clearOpFailure(opId);
}
// Every op the sync loop touches needs a real `_id` before it can be
// safely removed by id (see removeOp above) — but ops already sitting in
// the queue on a real device RIGHT NOW, saved under yesterday's code,
// were written before enqueue() started stamping one on. Without this,
// the very first time one of those already-queued tickets syncs
// successfully under the new code, removeOp would silently do nothing
// (no id to match), so it would never actually leave the queue — it would
// get "successfully" resaved again on every single pass, forever, in a
// tight loop with no delay between attempts, hammering the database with
// the same insert over and over while the ticket stayed stuck showing
// "not synced" even though it had already saved. Backfilling missing ids
// once, up front, before anything else runs, closes that off entirely.
function ensureOpIds() {
  mutateQueue((q) => {
    let changed = false;
    const next = q.map((op) => {
      if (op._id) return op;
      changed = true;
      return { ...op, _id: newId() };
    });
    return changed ? next : q;
  });
}

export function pendingCountForTicket(ticketId) {
  return getQueue().filter((op) => op.ticketId === ticketId).length;
}
export function totalPending() {
  return getQueue().length;
}

// True if this specific transaction only exists locally right now (still
// queued, not yet confirmed saved to the shared database) — whether it was
// entered manually (createTransaction) or came from finalizing a Weighing
// Ticket (finalizeTicket). Used by Receipt.jsx to warn staff BEFORE they
// walk away from a just-printed receipt that isn't actually in PaddyTrade
// yet — printing has never meant "saved"; this makes that visible instead
// of silent.
export function isTransactionPendingSync(transactionId) {
  if (!transactionId) return false;
  return getQueue().some((op) =>
    (op.type === "createTransaction" && op.payload?.id === transactionId) ||
    (op.type === "finalizeTicket" && op.payload?.transactionId === transactionId)
  );
}

// ---------------------------------------------------------------------
// Sync status subscription — lets the UI show "Offline — N changes
// waiting" / "Syncing…" / "All changes synced" without polling.
// ---------------------------------------------------------------------

let syncing = false;
const listeners = new Set();
export function onSyncStatusChange(fn) {
  listeners.add(fn);
  fn(getStatus());
  return () => listeners.delete(fn);
}

// Tracks which queued ops are genuinely stuck — meaning we're online and
// they've failed to save several times in a row for a real reason (bad
// data, a permissions/RLS problem, a server-side bug) — as opposed to plain
// "offline, waiting for WiFi", which isn't a problem at all and shouldn't
// look like one. These are very different situations for staff: one
// resolves itself the moment the connection returns, the other won't
// resolve on its own no matter how long you wait.
//
// Keyed by the op's own `_id` (not by ticket) because trySync below lets
// ops for DIFFERENT tickets keep syncing even while one ticket's op is
// stuck — so more than one op can be independently stuck at the same time,
// and each needs its own attempt count rather than one shared counter that
// only ever meant "the thing at the front of the queue".
const stuckOps = new Map(); // opId -> { since, lastFailedAt, attempts, error, opType, ticketId }
const STUCK_THRESHOLD = 3; // consecutive failed attempts, while online, before we call it "stuck"

function noteOpFailure(op, err) {
  if (!navigator.onLine) {
    // Not actually stuck — just offline, which is expected and resolves on
    // its own. Don't let failures recorded here linger and misreport as
    // "stuck" once the connection comes back and these same ops succeed on
    // their very first real attempt.
    clearStuckTracking();
    return;
  }
  const existing = stuckOps.get(op._id);
  stuckOps.set(op._id, {
    since: existing ? existing.since : new Date().toISOString(),
    // [2026-08-28] Separate from `since` on purpose. A Map keeps a key in
    // its ORIGINAL insertion position even after `.set()` updates its
    // value, so picking "the last entry" to show in the banner used to
    // mean "whichever op got stuck first", not "whichever op just failed
    // most recently" — meaning the error text on screen could be stale
    // and misleading (e.g. still showing an old permissions-sounding
    // error from earlier, even after the real, current problem had
    // changed to something else entirely). getStatus() below now picks
    // by this timestamp instead.
    lastFailedAt: new Date().toISOString(),
    attempts: (existing?.attempts || 0) + 1,
    error: (err && err.message) || String(err),
    opType: op.type,
    ticketId: op.ticketId || null,
  });
}
function clearOpFailure(opId) {
  stuckOps.delete(opId);
}
function clearStuckTracking() {
  stuckOps.clear();
}

// [2026-08-28] Set when this browser's login itself has gone stale and
// couldn't be refreshed automatically (see ensureFreshSession in
// supabaseClient.js) — kept separate from the generic "stuck" state above
// because the fix and the message shown to staff are completely
// different. A genuinely stuck save (bad data, a real permissions gap)
// needs an admin to look at the database. A dead login just needs someone
// to sign back in — nothing else. Telling those apart clearly avoids
// exactly what happened at Thapedey: a dead login produced a permissions-
// looking error, which sent troubleshooting in the wrong direction for a
// long time before the real cause (this browser's session had expired)
// was found.
let sessionExpired = false;

function getStatus() {
  const stuck = [...stuckOps.values()].filter((e) => e.attempts >= STUCK_THRESHOLD);
  const mostRecent = stuck.length
    ? stuck.reduce((a, b) => (new Date(b.lastFailedAt || b.since) > new Date(a.lastFailedAt || a.since) ? b : a))
    : null;
  return {
    online: navigator.onLine,
    syncing,
    pending: totalPending(),
    sessionExpired,
    stuck: stuck.length > 0,
    stuckCount: stuck.length,
    stuckSince: stuck.length ? new Date(Math.min(...stuck.map((e) => new Date(e.since).getTime()))).toISOString() : null,
    // The error text from whichever stuck op failed MOST RECENTLY — shown
    // verbatim in the banner so staff/an admin can actually see WHY (e.g.
    // a permissions error vs. a duplicate value) instead of just
    // "something is broken, good luck".
    lastStuckError: mostRecent ? mostRecent.error : null,
  };
}
function notifyStatus() {
  const s = getStatus();
  listeners.forEach((fn) => fn(s));
}

// ---------------------------------------------------------------------
// Running a single queued operation against the real API.
// ---------------------------------------------------------------------

async function runOp(op) {
  switch (op.type) {
    case "createParty": {
      const party = await api.createParty(op.payload);
      addCachedParty(party);
      // api.createParty can resolve to an EXISTING party instead of the
      // one we asked it to create (same phone number already on file at
      // this location) — when that happens, fix up anything that was
      // already pointing at the unused local id.
      if (op.payload.id && party.id !== op.payload.id) {
        remapPartyId(op.payload.id, party.id);
      }
      return party;
    }
    case "createProduct": {
      const product = await api.createProduct(op.payload.name, op.payload.id);
      addCachedProduct(product);
      if (op.payload.id && product.id !== op.payload.id) {
        remapProductId(op.payload.id, product.id);
      }
      return product;
    }
    case "updateParty": {
      const party = await api.updateParty(op.partyId, op.payload);
      const list = getCachedParties();
      const idx = list.findIndex((p) => p.id === op.partyId);
      if (idx >= 0) { list[idx] = { ...list[idx], ...party }; setCachedParties(list); }
      return party;
    }
    case "createTicket":
      return api.createTicket(op.payload);
    case "setTicketGross": {
      const result = await api.setTicketGross(op.ticketId, op.payload);
      if (result === null) { dropOtherOpsForGoneTicket(op.ticketId); return null; }
      return result;
    }
    case "editTicket": {
      const result = await api.updateTicketInfo(op.ticketId, op.payload);
      if (result === null) { dropOtherOpsForGoneTicket(op.ticketId); return null; }
      return result;
    }
    case "setTicketPrice": {
      const result = await api.setTicketPrice(op.ticketId, op.payload);
      if (result === null) { dropOtherOpsForGoneTicket(op.ticketId); return null; }
      return result;
    }
    case "setTicketTare": {
      const result = await api.setTicketTare(op.ticketId, op.payload);
      if (result === null) { dropOtherOpsForGoneTicket(op.ticketId); return null; }
      return result;
    }
    case "finalizeTicket": {
      const result = await api.finalizeTicket(op.ticketId, op.payload);
      if (result === null) { dropOtherOpsForGoneTicket(op.ticketId); return null; }
      return result;
    }
    case "createTransaction":
      return api.createTransaction(op.payload);
    case "createPayment":
      return api.createPayment(op.payload);
    case "logAudit":
      // logAuditStrict (not the plain logAudit every other caller in the
      // app uses) — a failed audit-log write for a brand-new transaction
      // needs to retry like everything else in this queue, not vanish
      // silently with nothing but a console.error nobody was watching.
      return api.logAuditStrict(op.payload);
    default:
      throw new Error("Unknown queued operation: " + op.type);
  }
}

// A save that hangs (a request that neither succeeds nor fails, just never
// comes back — the exact failure mode a flaky rural connection produces,
// as opposed to a clean "offline" or a clean error) used to freeze syncing
// entirely: the loop below awaits each op one at a time, so one stuck
// request meant EVERY ticket behind it sat showing "not synced" for as
// long as the browser's own network stack was willing to keep waiting —
// which can be minutes, and the "Connected — syncing…" banner never even
// changes to say anything is wrong, because nothing has actually failed
// yet from the browser's point of view. Bounding every op to a fixed
// amount of time turns that silent, open-ended hang into an ordinary,
// visible failure — it gets retried and reported exactly like a real
// error would, and — this is the important part — it stops blocking
// every OTHER op from getting its own chance to go through in the
// meantime.
const SYNC_OP_TIMEOUT_MS = 20000;
function runOpWithTimeout(op) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for a response — the connection may be too unstable to complete this save right now."));
    }, SYNC_OP_TIMEOUT_MS);
    runOp(op).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// Only these op types touch the ticket board's local cache once they land
// on the server — a manually-entered Buy/Sell (createTransaction/
// createPayment/logAudit, queued from TransactionForm.jsx) has no
// ticketId and isn't a ticket at all, so it must never be folded into the
// ticket cache below.
//
// finalizeTicket is deliberately NOT in this set even though it does
// carry a ticketId: what it gets back from the server is the newly
// created TRANSACTION row, not a ticket row — those two tables don't
// share an id space. Folding a transaction row into the ticket cache
// through the generic path below used to overwrite the merged object's
// `id` with the transaction's id, so upsertCachedTicket couldn't find
// the real ticket entry to update and quietly inserted a second, bogus
// "ticket" (transaction fields wearing the finalized ticket's stage)
// into the cache instead — harmless to what's on screen today only
// because finalized tickets are already filtered off the board, but a
// real latent bug (stray junk piling up in local storage, and a
// candidate to leak into name/phone autocomplete). finalizeTicket is
// handled on its own further down instead, updating the ticket and the
// new transaction each in their own correct cache.
const TICKET_OP_TYPES = new Set(["createTicket", "setTicketGross", "editTicket", "setTicketPrice", "setTicketTare"]);
// Op types whose successful result is a transaction row and belongs in
// the transaction cache (see the finalizeTicket note just above for why
// finalizeTicket is here and not in TICKET_OP_TYPES).
const TX_OP_TYPES = new Set(["createTransaction", "finalizeTicket"]);

// Processes whatever's queued, one op at a time (see runOpWithTimeout
// above for why each one is time-bounded) and independently per ticket
// (see the pass loop inside trySync below for why one stuck ticket no
// longer blocks a different one).
let syncPromise = null;
export function trySync() {
  if (syncPromise) return syncPromise;

  // Nothing queued — this call is just the 15s safety-net heartbeat (or a
  // redundant call right after one). Quietly top up the lookup caches if
  // we're online, but skip flipping the "syncing" status entirely: every
  // screen watching sync status (like the ticket board) reacts to that
  // flag by reloading, so toggling it for a no-op cycle was making the
  // whole board silently refresh itself every 15 seconds even when
  // absolutely nothing had changed. Only a REAL sync (queue not empty)
  // should trigger that reload.
  if (getQueue().length === 0) {
    if (navigator.onLine) refreshLookupCaches();
    return Promise.resolve();
  }

  syncPromise = (async () => {
    // This await must stay first, before anything else in this function.
    // Reason: `syncPromise = (async () => { ... })();` runs the function
    // body SYNCHRONOUSLY (JS starts executing an async function's body the
    // instant it's called) right up until the first genuine await — and
    // only THEN does the call expression return the (still-pending) promise
    // back to this assignment. If the whole body were able to finish
    // without ever hitting a real await — which happens on the offline
    // branch below, since it returns immediately with no network call in
    // between — its `finally` block (which resets `syncPromise = null`)
    // would run to completion BEFORE the outer `syncPromise = (async () =>
    // {...})()` assignment itself finishes, and that assignment would then
    // immediately overwrite the fresh `null` right back to this (already-
    // resolved) promise. From that point on `syncPromise` is permanently
    // stuck non-null, so `if (syncPromise) return syncPromise;` short-
    // circuits every later call — including the 15s heartbeat and the
    // "online" event listener — forever, with no error and nothing in the
    // console: sync silently stops for good until the page is reloaded.
    // A tiny test harness built to verify "runs safely without WiFi"
    // reproduced this exact scenario (go offline once, then come back
    // online) and caught it — see offline_test/ in the delivered files.
    // Forcing a real await here guarantees this assignment always
    // completes first, so the `finally` below can never race it.
    await Promise.resolve();
    syncing = true;
    notifyStatus();
    try {
      // This offline check must stay INSIDE the try/finally below (not
      // before it) so `finally` always runs and resets syncPromise, even
      // when we bail out immediately because there's no connection.
      if (!navigator.onLine) {
        // Also found by the test harness: a "stuck" flag set while online
        // (real repeated failures) used to linger forever once the
        // connection actually dropped, because this early return skips the
        // per-op loop below entirely — the only place that was clearing it.
        // Offline is its own, correctly-labeled state (the amber banner);
        // it shouldn't still be showing the earlier red "stuck" alert on
        // top of it. Once back online, a genuinely broken save re-flags
        // itself as stuck again within a few attempts anyway.
        clearStuckTracking();
        return;
      }

      // [2026-08-28] Check the login itself is actually still valid BEFORE
      // attempting any save — see ensureFreshSession in supabaseClient.js
      // for the full story. If it can't be refreshed, don't even try the
      // ops below: they'd just fail with a confusing permissions-looking
      // error that has nothing to do with permissions, the same thing
      // that made this so hard to diagnose at Thapedey. Show a plain
      // "please sign in again" message instead, and leave every queued
      // change exactly as it is — nothing here is dropped or touched, it
      // all resumes automatically the moment someone signs back in.
      const authOk = await ensureFreshSession();
      if (!authOk) {
        sessionExpired = true;
        notifyStatus();
        return;
      }
      if (sessionExpired) {
        sessionExpired = false;
        notifyStatus();
      }

      // Backfill ids on anything queued before this code existed (see
      // ensureOpIds above) — must run before the loop below ever calls
      // removeOp, or an already-queued op could silently never be removed.
      ensureOpIds();
      // One pass over whatever's currently queued. A genuinely broken op
      // (bad data, an RLS/permissions problem, a server-side bug) no longer
      // blocks EVERY other change on the device behind it forever. Two
      // rules decide what's genuinely allowed to wait behind it:
      //   1. Other ops for the SAME ticket always wait their turn — a
      //      ticket's own changes have to apply in order.
      //   2. Any op (ticket or not) that references a party/product id
      //      which itself is still an unsynced LOCAL id — because the
      //      createParty/createProduct op that was going to create it just
      //      failed — waits too, since it would fail anyway (that id
      //      doesn't exist on the server yet).
      // Everything else — a different ticket, a different party, a bank
      // detail update that nothing else depends on — gets its own chance
      // to reach the server this pass, completely independent of whatever
      // else is stuck. This is what "one bad ticket stalls the whole
      // board" (Pong Ro + Reang Kesey, Aug 2026) turned out to be: a single
      // stuck op quietly blocking dozens of completely unrelated tickets'
      // saves behind it, with no visibility into why. Nothing is ever
      // skipped out of order for something that actually depends on it,
      // and nothing is ever dropped — a stuck op just stays queued and
      // gets retried every pass until it succeeds or someone (an admin, or
      // me) reads the error text now shown in the banner and fixes the
      // actual cause.
      while (true) {
        const q = getQueue();
        if (q.length === 0) break;

        const blockedTicketIds = new Set();
        const blockedLocalIds = new Set(); // party/product local ids that failed to create this pass
        let progressed = false;

        for (const op of q) {
          const refId = op.payload?.partyId || op.payload?.productId || op.partyId || null;
          if (refId && blockedLocalIds.has(refId)) {
            if (op.ticketId) blockedTicketIds.add(op.ticketId);
            continue;
          }
          if (op.ticketId && blockedTicketIds.has(op.ticketId)) continue;

          try {
            const result = await runOpWithTimeout(op);
            // A ticket-related op just landed on the server — fold the
            // server's returned row into the local cache so the UI reflects
            // confirmed data as soon as it's available.
            if (result && TICKET_OP_TYPES.has(op.type)) {
              upsertCachedTicket(normalizeSyncedTicket(op, result));
            }
            // Same idea for a transaction — either a manual Buy/Sell
            // (createTransaction) or the one created by finishing a
            // Weighing Ticket (finalizeTicket) — so the Transactions list
            // has the confirmed, authoritative row the moment it's synced
            // instead of only its own locally-built preview.
            if (result && TX_OP_TYPES.has(op.type)) {
              upsertCachedTransaction(normalizeSyncedTransaction(op, result));
              if (op.type === "finalizeTicket") {
                // The ticket side of this was already marked finalized the
                // instant "Finish Ticket" was pressed (see
                // finalizeTicketOffline) — this just confirms it stayed
                // that way, using the ticket's OWN id, never the
                // transaction's (see the TX_OP_TYPES note above).
                patchCachedTicket(op.ticketId, { stage: "finalized", transaction_id: result.id });
              }
            }
            // And the "already Paid" cash payment recorded alongside a
            // manual entry — same reasoning, so the Paid/Remaining amount
            // on the Transactions list is right immediately, not just
            // after the next successful full reload.
            if (result && op.type === "createPayment") {
              upsertCachedPayment(result);
            }
            removeOp(op._id);
            progressed = true;
          } catch (err) {
            // Network still down, or a real error — either way, this
            // specific op stays queued and gets retried later rather than
            // being skipped or dropped.
            console.warn("[offlineQueue] sync paused for one op:", err?.message || err);
            noteOpFailure(op, err);
            if (op.ticketId) blockedTicketIds.add(op.ticketId);
            if ((op.type === "createParty" || op.type === "createProduct") && op.payload?.id) {
              blockedLocalIds.add(op.payload.id);
            }
          }
        }
        // Nothing at all went through this pass (everything queued is
        // blocked, or offline) — stop here instead of looping forever;
        // the 15s heartbeat / "online" listener will try again.
        if (!progressed) break;
      }
      if (getQueue().length === 0) await refreshLookupCaches();
    } finally {
      syncing = false;
      notifyStatus();
      syncPromise = null;
    }
  })();
  return syncPromise;
}

// Best-effort: merge whatever a create/update op returned back into the
// locally cached ticket, keyed by the ticket's local id. The server row
// doesn't carry the friendly display names (station/staff names) our
// cached copy already has, so we keep those until the next full refresh
// fills them in for real.
function normalizeSyncedTicket(op, result) {
  const ticketId = op.ticketId || result.id;
  const cached = getCachedTickets().find((t) => t.id === ticketId) || {};
  return {
    ...cached,
    ...result,
    stationName: cached.stationName || result.stationName,
    stationAddress: cached.stationAddress || result.stationAddress,
    stationPhone: cached.stationPhone || result.stationPhone,
    grossByName: result.grossByName ?? cached.grossByName ?? null,
    pricedByName: result.pricedByName ?? cached.pricedByName ?? null,
    tareByName: result.tareByName ?? cached.tareByName ?? null,
    createdByName: result.createdByName ?? cached.createdByName ?? null,
  };
}

// Same idea as normalizeSyncedTicket above, for a transaction: the raw
// row Supabase hands back from an insert has none of the joined display
// names (party/station/product) our locally-built copy already has, so
// keep those until the next full list refresh fills them in for real —
// everything else (id, code, amounts, dates) comes from the server,
// which is now the authoritative copy.
function normalizeSyncedTransaction(op, result) {
  const txId = op.payload?.transactionId || op.payload?.id || result.id;
  const cached = getCachedTransactions().find((t) => t.id === txId) || {};
  return {
    ...cached,
    ...result,
    partyName: cached.partyName || result.partyName,
    partyIdNumber: cached.partyIdNumber || result.partyIdNumber,
    product_name: cached.product_name || result.product_name,
    stationName: cached.stationName || result.stationName,
    stationAddress: cached.stationAddress || result.stationAddress,
    stationPhone: cached.stationPhone || result.stationPhone,
    status: result.status ?? cached.status ?? "confirmed",
    hq_status: result.hq_status ?? cached.hq_status ?? "processing",
  };
}

let autoSyncStarted = false;
export function startAutoSync() {
  if (autoSyncStarted) return;
  autoSyncStarted = true;
  window.addEventListener("online", trySync);
  window.addEventListener("offline", notifyStatus);
  setInterval(trySync, 15000);
  // Safety net: if this device still has changes that never made it to
  // PaddyTrade's shared database (e.g. wifi never came back before
  // closing up), warn before the tab/browser closes so staff don't walk
  // away thinking today's tickets are saved to HQ when they're actually
  // still sitting only on this one computer.
  window.addEventListener("beforeunload", (e) => {
    if (totalPending() > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  // Kick one off right away in case we're already online.
  trySync();
}

// ---------------------------------------------------------------------
// Offline-aware wrappers — what WeighingTickets.jsx actually calls. Each
// one updates the local cache immediately (so the screen reacts right
// away, connection or not) and queues the real save for whenever the
// connection allows it.
// ---------------------------------------------------------------------

// Widened from a 4-digit (~9,000 possible values) space to 6-digit
// (~900,000) to match api.js's genTicketCode/genCode — the 4-digit space
// was small enough that, across two stations' tickets over time, random
// collisions had become a real, recurring cause of tickets getting stuck
// "not synced" forever (the server now also self-heals a collision by
// picking a fresh code and retrying — see insertWithFreshCodeOnCollision
// in api.js — but starting from a much bigger space means that almost
// never needs to happen in the first place).
function genLocalTicketCode() {
  return `TKT-${Math.floor(100000 + Math.random() * 899999)}`;
}
function genLocalTxCode(type) {
  const n = Math.floor(100000 + Math.random() * 899999);
  return type === "BUY" ? `RCP-${n}-A` : `INV-${n}-B`;
}

// Matches an existing supplier/buyer by exact name, or creates a new one
// — checks the local cache first (works with zero network), then a live
// lookup if we're online and the cache might be stale.
export async function resolvePartyIdOffline(typedName, type, locationId, extra = {}) {
  const trimmed = (typedName || "").trim();
  if (!trimmed) return null;

  // Scoped to THIS station (when we know it) — otherwise a same-named
  // buyer/seller already on file at a different location would silently
  // get reused here, quietly attaching this station's ticket to another
  // station's party record (and its bank details, phone, history, etc).
  const cachedMatch = getCachedParties().find(
    (p) => p.type === type && (!locationId || p.location_id === locationId) && (p.name || "").trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (cachedMatch) return cachedMatch.id;

  if (navigator.onLine) {
    const matches = await withTimeout(api.getParties({ type, q: trimmed, locationId }).catch(() => null), ONLINE_LOOKUP_TIMEOUT_MS, null);
    const exact = matches && matches.find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      addCachedParty(exact);
      return exact.id;
    }
  }

  const id = newId();
  addCachedParty({
    id, name: trimmed, type, location_id: locationId,
    phone: extra.phone || null, bank_name: extra.bankName || null, bank_account: extra.bankAccount || null,
    bank_qr_url: extra.bankQrUrl || null, id_number: extra.idNumber || null, company: extra.company || null, destination: extra.destination || null,
  });
  enqueue({
    type: "createParty",
    payload: {
      id, name: trimmed, type, locationId, phone: extra.phone, bankName: extra.bankName, bankAccount: extra.bankAccount,
      bankQrUrl: extra.bankQrUrl, idNumber: extra.idNumber, company: extra.company, destination: extra.destination,
    },
  });
  trySync();
  return id;
}

// Updates an existing supplier/buyer's saved bank details/QR — e.g. when
// staff correct or add them at Finish Ticket and they differ from what's
// already on file, so the next truckload from this same farmer has it
// ready to prefill.
export function updatePartyOffline(partyId, { bankName, bankAccount, bankQrUrl }) {
  if (!partyId) return;
  const list = getCachedParties();
  const idx = list.findIndex((p) => p.id === partyId);
  if (idx >= 0) {
    const fields = {};
    if (bankName !== undefined) fields.bank_name = bankName || null;
    if (bankAccount !== undefined) fields.bank_account = bankAccount || null;
    if (bankQrUrl !== undefined) fields.bank_qr_url = bankQrUrl || null;
    list[idx] = { ...list[idx], ...fields };
    setCachedParties(list);
  }
  enqueue({ type: "updateParty", partyId, payload: { bankName, bankAccount, bankQrUrl } });
  trySync();
}

// Same idea for the paddy/product type field.
export async function resolveProductIdOffline(typedName) {
  const trimmed = (typedName || "").trim();
  if (!trimmed) return null;

  const cachedMatch = getCachedProducts().find((p) => (p.name || "").trim().toLowerCase() === trimmed.toLowerCase());
  if (cachedMatch) return cachedMatch.id;

  if (navigator.onLine) {
    const all = await withTimeout(api.getProducts().catch(() => null), ONLINE_LOOKUP_TIMEOUT_MS, null);
    if (all) {
      setCachedProducts(all);
      const exact = all.find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
      if (exact) return exact.id;
    }
  }

  const id = newId();
  addCachedProduct({ id, name: trimmed });
  enqueue({ type: "createProduct", payload: { id, name: trimmed } });
  trySync();
  return id;
}

// Opens a brand new ticket the instant a truck arrives — no network
// required. `locationName`/`locationAddress`/`locationPhone` are only used
// for the on-screen/print label — resolved locally from the already-loaded
// `locations` list (see add_location_address_phone.sql), no network call.
export function createTicketOffline({ type, locationId, locationName, locationAddress, locationPhone, partyId, partyName, phone, bankName, bankAccount, carPlate, driverName, productId, productName, userId, paperTicketNo, bankQrUrl, recordedByName }) {
  const id = newId();
  const code = genLocalTicketCode();
  const ticket = {
    id, code, type,
    location_id: locationId, stationName: locationName || "—",
    stationAddress: locationAddress || "", stationPhone: locationPhone || "",
    party_id: partyId || null, party_name: partyName,
    phone: phone || null, bank_name: bankName || null, bank_account: bankAccount || null,
    car_plate: carPlate || null, driver_name: driverName || null,
    product_id: productId || null, product_name: productName,
    paper_ticket_no: paperTicketNo || null,
    bank_qr_url: bankQrUrl || null,
    // Whichever staff member actually typed this ticket in — "Buyer" on a
    // Buy ticket (they're acting as PaddyTrade's buyer), "Seller" on a
    // Sell ticket — separate from `created_by`, which is just whichever
    // account is logged in on this device and may be shared by several
    // people during a shift.
    recorded_by_name: recordedByName || null,
    stage: "arrived",
    gross_kg: null, gross_at: null, gross_by: null, grossByName: null,
    quality_grade: null, moisture_pct: null, mixture_pct: null, outthrow_pct: null,
    deduction_kg: 0, price_per_kg: null, staff_fee: 0, tax_applicable: false, tax_rate: 10,
    price_note: null, priced_at: null, priced_by: null, pricedByName: null,
    tare_kg: null, tare_at: null, tare_by: null, tareByName: null,
    transaction_id: null, note: null,
    created_by: userId, createdByName: null, created_at: new Date().toISOString(),
  };
  upsertCachedTicket(ticket);
  enqueue({ type: "createTicket", ticketId: id, payload: { id, code, type, locationId, partyId, partyName, phone, bankName, bankAccount, carPlate, driverName, productId, productName, userId, paperTicketNo, bankQrUrl, recordedByName } });
  recordPaperTicketNo(locationId, paperTicketNo);
  trySync();
  return ticket;
}

function patchCachedTicket(id, patch) {
  const list = getCachedTickets();
  const existing = list.find((t) => t.id === id) || { id };
  const updated = { ...existing, ...patch };
  upsertCachedTicket(updated);
  return updated;
}

export function setTicketGrossOffline(id, { grossKg, userId }) {
  const updated = patchCachedTicket(id, { gross_kg: grossKg, gross_at: new Date().toISOString(), gross_by: userId, stage: "weighed_in" });
  enqueue({ type: "setTicketGross", ticketId: id, payload: { grossKg, userId } });
  trySync();
  return updated;
}

// Fixes up the basic weigh-in details on a ticket that's still open —
// used by the "Edit" button on the ticket board (available up until
// Finish Ticket / Decline, same as everything else on that board). Same
// offline-first pattern as the rest of this file: the local cache updates
// immediately so the board reflects the fix right away, and the real save
// is queued for whenever the connection allows it. Only the fields that
// were actually passed in get patched — a caller that only changed the
// plate number, say, doesn't need to also resend everything else.
export function editTicketOffline(id, { partyId, partyName, phone, carPlate, driverName, productId, productName, paperTicketNo, grossKg, userId }) {
  const patch = {};
  if (partyId !== undefined) patch.party_id = partyId || null;
  if (partyName !== undefined) patch.party_name = partyName;
  if (phone !== undefined) patch.phone = phone || null;
  if (carPlate !== undefined) patch.car_plate = carPlate || null;
  if (driverName !== undefined) patch.driver_name = driverName || null;
  if (productId !== undefined) patch.product_id = productId || null;
  if (productName !== undefined) patch.product_name = productName;
  if (paperTicketNo !== undefined) patch.paper_ticket_no = paperTicketNo || null;
  if (grossKg !== undefined) {
    patch.gross_kg = grossKg;
    patch.gross_at = new Date().toISOString();
    patch.gross_by = userId;
  }
  const updated = patchCachedTicket(id, patch);
  enqueue({
    type: "editTicket",
    ticketId: id,
    payload: { partyId, partyName, phone, carPlate, driverName, productId, productName, paperTicketNo, grossKg, userId },
  });
  if (paperTicketNo !== undefined) recordPaperTicketNo(updated.location_id, paperTicketNo);
  trySync();
  return updated;
}

export function setTicketPriceOffline(id, opts) {
  const { qualityGrade, moisturePct, mixturePct, outthrowPct, deductionKg, pricePerKg, staffFee, taxApplicable, taxRate, priceNote, userId, decline, bankName, bankAccount, bankQrUrl } = opts;
  const patch = {
    quality_grade: qualityGrade || null,
    moisture_pct: moisturePct || 0,
    mixture_pct: mixturePct || 0,
    outthrow_pct: outthrowPct || 0,
    deduction_kg: deductionKg || 0,
    price_per_kg: decline ? null : pricePerKg,
    staff_fee: staffFee || 0,
    tax_applicable: !!taxApplicable,
    tax_rate: taxApplicable ? (taxRate || 0) : 0,
    price_note: priceNote || null,
    priced_at: new Date().toISOString(),
    priced_by: userId,
    stage: decline ? "declined" : "priced",
  };
  // Which bank (or Cash) and QR to pay this farmer with — decided here, not
  // at weigh-in, since that's genuinely when it's known. Left out entirely
  // (not overwritten with a blank) on calls that don't pass them, like a
  // quick Decline.
  if (bankName !== undefined) patch.bank_name = bankName || null;
  if (bankAccount !== undefined) patch.bank_account = bankAccount || null;
  if (bankQrUrl !== undefined) patch.bank_qr_url = bankQrUrl || null;
  const updated = patchCachedTicket(id, patch);
  enqueue({ type: "setTicketPrice", ticketId: id, payload: opts });
  trySync();
  return updated;
}

export function setTicketTareOffline(id, { tareKg, userId }) {
  const updated = patchCachedTicket(id, { tare_kg: tareKg, tare_at: new Date().toISOString(), tare_by: userId, stage: "weighed_out" });
  enqueue({ type: "setTicketTare", ticketId: id, payload: { tareKg, userId } });
  trySync();
  return updated;
}

// Finalizing needs a real transaction to hand to the receipt screen right
// away, even offline — so we build one locally from the ticket's own
// numbers (the exact same math FinalizeModal already previews) and queue
// the real save for later. Once synced, the permanent server copy has
// this same id, so nothing about the receipt has to change.
export function finalizeTicketOffline(ticket, { userId, txDate, receiptPhotoUrl }) {
  const transactionId = newId();
  const transactionCode = genLocalTxCode(ticket.type);
  // Same fix as api.js's finalizeTicket (kept in sync with it on purpose):
  // Buy is In minus Out (arrives loaded, leaves empty); Sell is the other
  // way, Out minus In (arrives empty, leaves loaded for delivery).
  const netKg = Math.max(0, ticket.type === "BUY"
    ? (ticket.gross_kg || 0) - (ticket.tare_kg || 0)
    : (ticket.tare_kg || 0) - (ticket.gross_kg || 0));
  const payableKg = Math.max(0, netKg - (ticket.deduction_kg || 0));
  const staffFeeAmt = ticket.type === "BUY" ? (ticket.staff_fee || 0) : 0;
  const subtotal = Math.max(0, payableKg * (ticket.price_per_kg || 0) - staffFeeAmt);
  const taxAmount = ticket.tax_applicable ? Math.round(subtotal * (ticket.tax_rate || 0)) / 100 : 0;
  const amount = Math.round((subtotal) * 100) / 100;

  patchCachedTicket(ticket.id, { stage: "finalized", transaction_id: transactionId });
  enqueue({ type: "finalizeTicket", ticketId: ticket.id, payload: { userId, txDate, transactionId, transactionCode, receiptPhotoUrl } });
  trySync();

  const { date: nowDate, time: nowTime } = cambodiaNow();
  const tx = {
    id: transactionId,
    code: transactionCode,
    type: ticket.type,
    tx_date: txDate || nowDate,
    tx_time: nowTime,
    // location_id/party_id/product_id: not needed for the receipt itself,
    // but required for the Transactions list — its location filter and
    // per-transaction payment lookups both key off these, same as every
    // field the real server row would eventually have.
    location_id: ticket.location_id,
    party_id: ticket.party_id,
    product_id: ticket.product_id,
    partyName: ticket.party_name,
    partyIdNumber: ticket.phone,
    bank_name: ticket.bank_name,
    bank_account: ticket.bank_account,
    product_name: ticket.product_name,
    stationName: ticket.stationName,
    stationAddress: ticket.stationAddress,
    stationPhone: ticket.stationPhone,
    gross_kg: ticket.gross_kg,
    gross_at: ticket.gross_at,
    tare_kg: ticket.tare_kg,
    tare_at: ticket.tare_at,
    quantity_kg: netKg,
    quality_grade: ticket.quality_grade,
    moisture_pct: ticket.moisture_pct,
    mixture_pct: ticket.mixture_pct,
    outthrow_pct: ticket.outthrow_pct,
    deduction_kg: ticket.deduction_kg,
    payable_kg: payableKg,
    price_per_kg: ticket.price_per_kg,
    car_plate: ticket.car_plate,
    driver_name: ticket.driver_name,
    paper_ticket_no: ticket.paper_ticket_no,
    bank_qr_url: ticket.bank_qr_url,
    receipt_photo_url: receiptPhotoUrl || null,
    note: ticket.note,
    recorded_by_name: ticket.recorded_by_name,
    tax_applicable: ticket.tax_applicable,
    staff_fee: ticket.staff_fee,
    amount,
    tax_rate: ticket.tax_rate,
    tax_amount: taxAmount,
    total_with_tax: amount + taxAmount,
    created_by: userId,
    // status/hq_status: the server always fills these in itself on
    // insert (see the weighing_tickets/transactions schema defaults), so
    // matching that default here means this cached row looks and behaves
    // exactly like the real one until it syncs and gets replaced by it.
    status: "confirmed",
    hq_status: "processing",
  };
  upsertCachedTransaction(tx);
  return tx;
}

// ---------------------------------------------------------------------
// Manual Buy/Sell entries — used by TransactionForm.jsx. Unlike a
// Weighing Ticket, a manual entry has no multi-stage lifecycle: staff
// fill in the whole thing and save it once. Same offline reasoning as
// everything above though — the transaction (and its payment/audit
// entries, if applicable) gets a real id immediately so the receipt
// shown right after Save is the permanent record, not a preview, and the
// actual writes are queued for whenever the connection allows them. This
// is what fixes "the form loses everything I typed if the connection
// drops" — nothing here waits on a network call to succeed.
// ---------------------------------------------------------------------

// partyName/partyIdNumber/bankName/bankAccount/productName/stationName are
// display-only — the caller (TransactionForm.jsx) already has them on
// screen and they're never sent to the server (the real party/product/
// station names always come from their own tables via a join) — but
// without them here, the record cached below for the Transactions list
// would have nothing to show in its Party/Station columns until the real
// sync completes, same gap this whole change exists to close.
export function createTransactionOffline({ type, locationId, partyId, productId, quantityKg, pricePerKg, paymentStatus, userId, qualityGrade, taxApplicable, taxRate, moisturePct, mixturePct, outthrowPct, deductionKg, staffFee, note, carPlate, driverName, receiptPhotoUrl, paymentProofUrl, txDate, partyName, partyIdNumber, bankName, bankAccount, productName, stationName }) {
  const id = newId();
  const code = genLocalTxCode(type);
  const payableKg = Math.max(0, (quantityKg || 0) - (deductionKg || 0));
  const staffFeeAmt = type === "BUY" ? (staffFee || 0) : 0;
  const amount = Math.round(Math.max(0, payableKg * (pricePerKg || 0) - staffFeeAmt) * 100) / 100;
  const taxAmount = taxApplicable ? Math.round(amount * (taxRate || 0)) / 100 : 0;
  const { date: nowDate, time: nowTime } = cambodiaNow();

  enqueue({
    type: "createTransaction",
    payload: {
      id, code, type, locationId, partyId, productId, quantityKg, pricePerKg, paymentStatus, userId,
      qualityGrade, taxApplicable, taxRate, moisturePct, mixturePct, outthrowPct, deductionKg,
      staffFee: staffFeeAmt, note, carPlate, driverName, receiptPhotoUrl, paymentProofUrl, txDate,
    },
  });
  trySync();

  const tx = {
    id, code, type,
    tx_date: txDate || nowDate,
    tx_time: nowTime,
    location_id: locationId,
    party_id: partyId,
    product_id: productId,
    partyName: partyName || "—",
    partyIdNumber: partyIdNumber || "",
    bank_name: bankName || null,
    bank_account: bankAccount || null,
    product_name: productName || null,
    stationName: stationName || "—",
    quantity_kg: quantityKg,
    payable_kg: payableKg,
    price_per_kg: pricePerKg,
    payment_status: paymentStatus,
    quality_grade: qualityGrade || null,
    moisture_pct: moisturePct || 0,
    mixture_pct: mixturePct || 0,
    outthrow_pct: outthrowPct || 0,
    deduction_kg: deductionKg || 0,
    note: note || null,
    car_plate: carPlate || null,
    driver_name: driverName || null,
    receipt_photo_url: receiptPhotoUrl || null,
    payment_proof_url: paymentProofUrl || null,
    staff_fee: staffFeeAmt,
    tax_applicable: !!taxApplicable,
    tax_rate: taxApplicable ? (taxRate || 0) : 0,
    amount,
    tax_amount: taxAmount,
    total_with_tax: amount + taxAmount,
    created_by: userId,
    status: "confirmed",
    hq_status: "processing",
  };
  upsertCachedTransaction(tx);
  return tx;
}

// Records a cash payment made at the moment a manual transaction is
// saved (the "already Paid" case) — same client-generated-id pattern, so
// it lands on the server as the exact same record whenever it syncs.
export function createPaymentOffline({ type, transactionId, locationId, amount, method, payDate, memo, userId }) {
  const id = newId();
  enqueue({ type: "createPayment", payload: { id, type, transactionId, locationId, amount, method, payDate, memo, userId } });
  trySync();
  const payment = { id, type, transaction_id: transactionId, location_id: locationId, amount, method, pay_date: payDate, memo, created_by: userId };
  upsertCachedPayment(payment);
  return payment;
}

// Queues an Activity Log entry without waiting on the network — used
// alongside createTransactionOffline/createPaymentOffline so a new
// manual entry is traceable later even if it was saved while offline.
export function logAuditOffline(payload) {
  enqueue({ type: "logAudit", payload });
  trySync();
}
