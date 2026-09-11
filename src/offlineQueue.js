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
import { ensureFreshSession, getAccurateNow } from "./supabaseClient.js";
import { assertNotViewOnly } from "./viewOnlyGuard.js";
// [2026-09-10] Shared with api.js and with the database's product_key().
import { cleanProductName, findProductByName } from "./productName.js";
// [2026-09-09] Tags an Error with a translation key. The English text still
// goes on .message, so nothing that already reads .message changes; a screen
// that calls errText(t, err) gets Khmer instead. See src/errText.js.
import { tagError } from "./errText.js";

const CACHE_KEY = "ptw_ticket_cache_v1";
const QUEUE_KEY = "ptw_ticket_queue_v1";
const PARTY_CACHE_KEY = "ptw_party_cache_v1";
const PRODUCT_CACHE_KEY = "ptw_product_cache_v1";
const PAPER_TICKET_KEY = "ptw_last_paper_ticket_no_v1";

// Same timezone stamping used in api.js — stamps with Cambodia's actual
// wall-clock time regardless of the device's own timezone setting, since
// this is what ends up on the printed slip/receipt. Uses getAccurateNow()
// (see supabaseClient.js), not the device's raw clock — a station PC's own
// clock can simply be set wrong, which no amount of timezone math can fix
// on its own.
function cambodiaNow() {
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  })
    .formatToParts(getAccurateNow())
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

// [2026-08-30] Used only by finalizeTicketOffline/createTransactionOffline
// below, and deliberately much longer than ONLINE_LOOKUP_TIMEOUT_MS above —
// that one guards a keystroke-driven lookup where staff are actively typing
// and waiting; this one guards the one moment (Finish Ticket / Save on a
// manual Buy or Sell) where a receipt is about to print and become the
// farmer's or buyer's paper proof of the deal. Jomnoum, Aug 2026: two
// tickets were finished and a real receipt printed for each, but the actual
// database write never went out — it just sat queued on that one browser
// and, as far as anyone can tell, whatever was holding it was gone by the
// time anyone checked days later (see the project log for the full
// investigation). The save itself was never the problem — it's already
// solid — the problem was that printing never waited to find out whether it
// had actually reached the server, so there was nothing to notice was wrong
// until someone happened to compare paper receipts against the app much
// later. Giving the save up to this long, only while online, to actually
// land before the receipt prints closes almost all of that window, while
// never blocking a genuinely offline station — see the call sites.
// [2026-09-06] Raised from 7s to 15s at the same time printing went from
// "flag if unconfirmed" back to "refuse if unconfirmed" (see the call
// sites) — a slow-but-working station connection now gets a fair chance
// to land the save before the receipt is refused, instead of tripping
// the refusal on an ordinary slow round-trip.
// [2026-09-07] 15s → 30s: the finalize RPC itself is now allowed up to
// 28s on the wire (api.js finalizeTicket passes its own abort signal,
// bypassing supabaseClient's 8s cutoff), so the wait has to be at least
// that long or a slow-but-working station would be refused every time.
const FINISH_SYNC_TIMEOUT_MS = 30000;

// [2026-09-06] Shared wording for the one case that is now hard-blocked:
// this device says it's online, the save is safely queued here, but the
// shared database did not confirm it within FINISH_SYNC_TIMEOUT_MS. Per
// direction after Jomnoum's TKT-521806/TKT-872042 (receipt printed,
// transaction never landed / landed twice): a receipt must never come out
// of an online station for a transaction the server has not confirmed.
// The queued save is NOT dropped by this — it keeps retrying on its own
// every ~15s and on reconnect, exactly as before — only the receipt is
// held back until it actually lands.
//
// `retrySafe` matters: Finish Ticket dedupes by ticket id (a second press
// reuses the same queued op), so "press again" is safe there. A manual
// New Buy/Sell entry has no such key — pressing Save again would queue a
// SECOND copy and both would eventually land — so for that path the
// message must say the opposite: don't re-enter it, it will appear by
// itself once the queued save lands.
export function unconfirmedSaveMessage(what, retrySafe) {
  const head = `NOT SAVED YET — do NOT print. This device is online but PaddyTrade's database did not confirm this ${what} within ${Math.round(FINISH_SYNC_TIMEOUT_MS / 1000)} seconds (slow or unstable connection). It is safely queued on this device and will keep retrying automatically. `;
  const tail = retrySafe
    ? "Wait a moment and press Finish Ticket again — that is safe, it will NOT create a duplicate. If the ticket disappears from this board in the meantime, it already saved: print its receipt from the Transactions page instead."
    : "Do NOT enter it again — that would create a duplicate. It will appear on the Transactions page by itself once it lands (watch the sync banner at the top); print its receipt from there.";
  return head + tail;
}
function unconfirmedSaveError(what, retrySafe) {
  // [2026-09-09] The English text stays on .message exactly as before, so
  // nothing that already reads it changes behaviour. The tag lets a screen
  // that calls errText(t, err) show the same message in Khmer. See
  // src/errText.js for why it is done this way round.
  return tagError(new Error(unconfirmedSaveMessage(what, retrySafe)), "err_unconfirmed_head", {
    whatKey: what === "ticket" ? "err_what_ticket" : "err_what_entry",
    secs: Math.round(FINISH_SYNC_TIMEOUT_MS / 1000),
  }, retrySafe ? "err_unconfirmed_retry_safe" : "err_unconfirmed_no_retry");
}

// ---------------------------------------------------------------------
// [2026-09-07] Station relay — a second, disk-backed copy of every finished
// ticket / manual entry, held by the scale program (bridge.js) on the
// station PC, which forwards it to the server on its own until confirmed.
// The browser queue below still does the same in parallel; the server
// accepts whichever arrives first and hands the other the same row (see
// finalize_weighing_ticket in platform_hardening_2026-09-07.sql — one live
// transaction per ticket, enforced by the database). This exists so a
// wiped browser, a different browser, or a PC that resets on restart can
// no longer lose a save that already printed a receipt.
//
// Fire-and-forget on purpose: a laptop or phone has no bridge, and a
// station whose bridge is down must not be slowed by it — the browser
// queue is still there. 1.5s cap; any failure is silently ignored.
const LOCAL_RELAY_URL = "http://127.0.0.1:8787/relay";
export function relayToStation(kind, body) {
  // Off the save's own critical path (a save must stay instant even
  // offline); the POST still leaves within milliseconds — long before any
  // receipt could be printed.
  setTimeout(() => relayNow(kind, body), 0);
}
function relayNow(kind, body) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    fetch(`${LOCAL_RELAY_URL}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).catch(() => {}).finally(() => clearTimeout(timer));
  } catch {
    /* no bridge here — fine */
  }
}

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

// [2026-09-05] The actual "add one" rule, pulled out on its own so the
// live, cross-device suggestion (api.getLatestPaperTicketNo, used from
// WeighingTickets.jsx) can reuse the exact same increment logic instead
// of a second copy that could drift from this one.
export function incrementTicketNo(last) {
  if (!last) return "";
  const digitMatch = last.match(/\d+$/);
  if (!digitMatch) return "";
  const numPart = digitMatch[0];
  const prefix = last.slice(0, last.length - numPart.length);
  const incremented = String(Number(numPart) + 1).padStart(numPart.length, "0");
  return prefix + incremented;
}

export function suggestNextPaperTicketNo(locationId) {
  const map = readLastPaperTicketMap();
  return incrementTicketNo(map[locationId || "_default"]);
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
// [2026-08-30] Returns whether the write actually landed, instead of
// swallowing a failure silently. Found during the 2026-08-30 bug audit
// (triggered by tickets that finalized/printed at Ping Pong without
// showing up in Transactions): a full or blocked localStorage meant an
// enqueue()'d op never actually made it to the one place trySync() looks
// (getQueue(), which reads straight back from localStorage) — but nothing
// downstream ever found out, so the receipt printed anyway for a change
// that was never durably queued at all. Callers on the safety-critical
// path (see enqueue below, and finalizeTicketOffline/
// createTransactionOffline further down) now check this before treating
// anything as saved. One retry before giving up, in case this was a
// one-off hiccup (e.g. racing another tab's write of a different key)
// rather than storage genuinely being full.
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      // Storage full or unavailable even on retry — the caller decides
      // what to do; this one write just did not happen.
      return false;
    }
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
// [2026-08-30] Returns { queue, persisted } instead of the bare array —
// persisted is false when writeJSON's actual disk write failed (see
// writeJSON above). Nothing before today's audit ever checked this, which
// is exactly how a finalize could be treated as "queued" when it was
// really only ever sitting in a local variable. No existing caller reads
// this function's return value yet (they only cared about the side
// effect), so widening it here is safe — enqueue() below is the first to
// actually use it.
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

    const persisted = writeJSON(QUEUE_KEY, next);
    notifyStatus();
    return { queue: next, persisted };
  }
  // 25 collisions in a row would mean something is pathologically wrong
  // (not just two tabs racing occasionally) — fall back to whatever is
  // currently stored rather than looping forever. The mutation was never
  // applied, so this is not persisted either.
  notifyStatus();
  return { queue: getQueue(), persisted: false };
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

// [2026-08-30] Used only by discardStuckFinalize/discardStuckManualEntry
// below — deliberately removes a locally-cached transaction that's being
// discarded, not just hidden. Only ever called on a transaction whose op
// has already been confirmed genuinely stuck (repeated real failures) and
// is about to be removed from the queue at the same time.
function removeCachedTransaction(id) {
  const list = getCachedTransactions().filter((t) => t.id !== id);
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
// [2026-09-10] What gets WRITTEN to the device is capped; what gets
// RETURNED to the screen is not.
//
// This cache existed to keep a station working when its connection drops.
// It was being handed every transaction in the business and writing the
// lot to localStorage on every load of the Transactions page — a few
// megabytes of JSON, stringified on the main thread while the person
// waits, and growing forever. localStorage is a handful of megabytes, so
// eventually the write simply fails, and writeJSON swallows that: the
// offline safety net would quietly stop working exactly when the business
// had grown enough to need it.
//
// Everything still queued on this device is always kept — that is the part
// that cannot be re-fetched. On top of that, the most recent rows, which
// is what a station actually looks at while offline.
const CACHE_MAX_ROWS = 400;

function capForCache(list, keepIds, max = CACHE_MAX_ROWS) {
  if (list.length <= max) return list;
  const kept = [];
  const seen = new Set();
  for (const r of list) {
    if (keepIds.has(r.id)) { kept.push(r); seen.add(r.id); }
  }
  // `list` arrives newest-first, so slicing from the front keeps the recent ones.
  for (const r of list) {
    if (kept.length >= max) break;
    if (!seen.has(r.id)) kept.push(r);
  }
  return kept;
}

export function mergeServerTransactions(serverTxs) {
  const pendingIds = pendingTransactionIds();
  const local = getCachedTransactions();
  const localById = new Map(local.map((t) => [t.id, t]));
  const merged = serverTxs.map((t) => (pendingIds.has(t.id) && localById.has(t.id) ? localById.get(t.id) : t));
  const serverIds = new Set(serverTxs.map((t) => t.id));
  for (const t of local) {
    if (!serverIds.has(t.id) && pendingIds.has(t.id)) merged.unshift(t);
  }
  writeJSON(TX_CACHE_KEY, capForCache(merged, pendingIds));
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
  // Capped for the same reason as the transaction cache above.
  writeJSON(PAYMENT_CACHE_KEY, capForCache(merged, pendingIds));
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
// [2026-08-30] Returns { opId, persisted } — persisted is false when the
// underlying localStorage write failed (see writeJSON/mutateQueue above).
// Every other call site in this file still just calls enqueue(...) as a
// bare statement and is unaffected; finalizeTicketOffline and
// createTransactionOffline are the two that now check this before letting
// anything print, since those are the two writes a real receipt depends
// on (see FINISH_SYNC_TIMEOUT_MS above for the incident that made that
// distinction matter).
export function enqueue(op) {
  // Every op gets a stable id of its own (separate from ticketId/partyId,
  // which name what the op acts ON, not the op itself) so a specific op
  // can be pulled out of the middle of the queue once it succeeds — not
  // just "whatever's currently at the front" — which matters once ops for
  // different tickets are allowed to be attempted out of relative order
  // (see trySync below).
  const opId = newId();
  // [2026-08-30] queuedAt: when this op was actually enqueued, so the
  // Needs Attention panel (getNeedsAttentionTransactions below) can show
  // "queued 14 min ago" instead of just a bare list with no sense of how
  // long something's been waiting.
  const queuedAt = getAccurateNow().toISOString();
  const { persisted } = mutateQueue((q) => { q.push({ ...op, _id: opId, queuedAt }); return q; });
  return { opId, persisted };
}
// True if a specific op (by the id enqueue() gave it) is still sitting in
// the durable queue — i.e. not yet removed by a successful sync. Used to
// confirm a specific finalize/create actually got processed by a trySync()
// pass, rather than trusting that trySync() resolving means it did (see
// the syncPromise race explained above trySync).
function isOpQueued(opId) {
  return getQueue().some((op) => op._id === opId);
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
// [2026-08-30] "Needs Attention" — the direct answer to "what if it never
// loads, and I have to type it in new?" Every field a finalize/manual-save
// needs to be recovered is already sitting in getCachedTransactions() (the
// exact object the receipt itself was built from) the whole time it's
// queued — nothing about a stuck or slow sync ever deletes it. This just
// surfaces that data instead of leaving it invisible in localStorage,
// where the only other way to find it was comparing paper against the
// Transactions List by hand. See NeedsAttentionModal.jsx (reachable from
// Topbar.jsx on every page) for where this is actually shown.
// ---------------------------------------------------------------------

// One entry per still-unsynced finalizeTicket/createTransaction op, each
// carrying its full cached transaction (every field the receipt used) plus
// how long it's been queued and, if it's failed enough times in a row to
// count as genuinely stuck (see STUCK_THRESHOLD below), the exact error
// text and a way out. Sorted oldest-first — whatever's been waiting
// longest needs eyes on it soonest.
export function getNeedsAttentionTransactions() {
  const txById = new Map(getCachedTransactions().map((t) => [t.id, t]));
  const items = [];
  for (const op of getQueue()) {
    if (op.type !== "finalizeTicket" && op.type !== "createTransaction") continue;
    const txId = op.type === "finalizeTicket" ? op.payload?.transactionId : op.payload?.id;
    const tx = txId ? txById.get(txId) : null;
    if (!tx) continue; // shouldn't normally happen — the cache write always happens right alongside the enqueue
    const stuckEntry = stuckOps.get(op._id) || null;
    items.push({
      tx,
      opId: op._id,
      opType: op.type,
      ticketId: op.ticketId || null,
      queuedAt: op.queuedAt || null,
      attempts: stuckEntry ? stuckEntry.attempts : 0,
      lastError: stuckEntry ? stuckEntry.error : null,
      isStuck: !!(stuckEntry && stuckEntry.attempts >= STUCK_THRESHOLD),
    });
  }
  items.sort((a, b) => new Date(a.queuedAt || 0) - new Date(b.queuedAt || 0));
  return items;
}

// Cancels a genuinely stuck finalizeTicket op (repeated real failures —
// see isStuck above, not just "still waiting") and sends the ticket back
// to the Waiting board exactly as it was right before Finish Ticket was
// pressed. Nothing about the ticket's own weigh-in/quality/price fields
// was ever touched by finalizing it, so nothing here needs to be retyped
// — staff just press Finish Ticket again once whatever was wrong (a bad
// value, a permissions issue) is fixed. Removing the op first means the
// old stuck attempt can never also go through later and create a second
// transaction alongside the new one.
export function discardStuckFinalize(opId) {
  const op = getQueue().find((o) => o._id === opId);
  if (!op || op.type !== "finalizeTicket") return false;
  const txId = op.payload?.transactionId;
  removeOp(opId);
  if (txId) removeCachedTransaction(txId);
  // [2026-09-11] Ping Pong. Cancelling the finish used to take back the
  // TRANSACTION and leave everything queued alongside it — in particular
  // the cash payment Finish Ticket queues right after it (see
  // WeighingTickets.jsx). That payment stayed in the queue pointing at a
  // transaction that no longer existed anywhere, so from that moment on
  // every sync, every 15 seconds, came back with
  //   violates foreign key constraint "payments_transaction_id_fkey"
  // and the station sat under a permanent red banner with nothing it
  // could do about it. Sending a ticket back has to take the whole
  // finish with it, payment included — the money is re-recorded when the
  // ticket is finished again.
  dropOpsForGoneTransaction(txId);
  // pending_tx_id / pending_tx_code are deliberately LEFT on the cached
  // ticket, so a later Finish re-sends the same transaction id — the
  // server then returns the row it already has instead of a twin.
  if (op.ticketId) patchCachedTicket(op.ticketId, { stage: "weighed_out", transaction_id: null });
  return true;
}

// Same idea for a stuck manual Buy/Sell (createTransaction) — there's no
// ticket to send back here, so this just clears the stuck attempt itself.
// The full details shown in NeedsAttentionModal.jsx should be copied into
// a fresh New Buy/Sell entry BEFORE calling this, if the sale is still
// real — once removed, this exact attempt is gone for good.
export function discardStuckManualEntry(opId) {
  const op = getQueue().find((o) => o._id === opId);
  if (!op || op.type !== "createTransaction") return false;
  const txId = op.payload?.id;
  removeOp(opId);
  if (txId) removeCachedTransaction(txId);
  // Same reasoning as discardStuckFinalize above — TransactionForm.jsx
  // queues the "already paid" cash payment and the activity-log entries
  // immediately after the transaction itself, and they cannot outlive it.
  dropOpsForGoneTransaction(txId);
  return true;
}

// Everything queued that only makes sense if a given transaction exists —
// its payment, its activity-log entries — removed together with it, and
// its stuck tracking cleared so the banner does not keep reporting ops
// that are no longer in the queue. Called wherever a queued transaction
// is deliberately taken back.
function dropOpsForGoneTransaction(txId) {
  if (!txId) return;
  const queue = getQueue();
  const doomed = new Set();
  // Anything pointing straight at the transaction: its payment, and any
  // activity-log entry written against the transactions table.
  const doomedPaymentIds = new Set();
  for (const op of queue) {
    if (op.type === "createTransaction" || op.type === "finalizeTicket") continue;
    const needsTx =
      op.payload?.transactionId ||
      (op.payload?.tableName === "transactions" ? op.payload?.recordId : null) ||
      null;
    if (needsTx !== txId) continue;
    doomed.add(op._id);
    if (op.type === "createPayment" && op.payload?.id) doomedPaymentIds.add(op.payload.id);
  }
  // Second pass: the activity-log entry written against the PAYMENT that
  // just went with it (tableName "payments"), which has no link to the
  // transaction of its own and would otherwise be left describing a
  // payment that was never created.
  if (doomedPaymentIds.size) {
    for (const op of queue) {
      if (op.type !== "logAudit") continue;
      if (op.payload?.tableName === "payments" && doomedPaymentIds.has(op.payload?.recordId)) doomed.add(op._id);
    }
  }
  if (!doomed.size) return;
  mutateQueue((q) => q.filter((o) => !doomed.has(o._id)));
  for (const id of doomed) stuckOps.delete(id);
  notifyStatus();
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

// [2026-09-01] `navigator.onLine` alone isn't a reliable way to tell "the
// connection is fine, this is a real problem" apart from "the connection
// just isn't actually working right now" — it only reflects whether the
// device's network adapter is attached to SOME network, not whether that
// network can actually reach PaddyTrade's server. A Wi-Fi connection that's
// dropping in and out (associated to the router one moment, gone the next)
// can report `navigator.onLine: true` at the exact instant a save is
// attempted and fails — which is exactly what happened at Jomnoum: repeated
// "TypeError: Failed to fetch" failures got counted as "stuck, call an
// admin" even though the real cause was a flaky connection, not bad data.
//
// A much more reliable signal is the shape of the error itself. `fetch()`
// throws a bare TypeError specifically when the request never reached a
// server at all — no DNS, no route, blocked, connection refused, CORS —
// regardless of what `navigator.onLine` claims. Our own request-timeout
// error (see runOpWithTimeout above) means the same thing: a connection too
// unstable to complete a save, not a data problem. Neither should ever
// count toward "stuck". An error Supabase/Postgrest actually returned after
// a real response came back (an RLS rejection, a bad constraint, anything
// from api.js) looks nothing like this — that one really is a problem an
// admin needs to look at, and still counts.
//
// Checked by MESSAGE TEXT, not just `err.name` — the exact error seen at
// Jomnoum came through as the string "TypeError: Failed to fetch" in
// `err.message` itself (something between the browser and here re-wraps
// the original TypeError rather than passing it through with its `.name`
// intact), so relying on `err.name === "TypeError"` alone would have missed
// the very case this exists to catch. Firefox/Safari phrase the same
// network-level failure differently ("NetworkError when attempting to
// fetch resource", "Load failed") — matched too, for the same reason.
function isConnectivityError(err) {
  if (!err) return false;
  const text = `${err.name || ""} ${err.message || err}`.toLowerCase();
  if (text.includes("typeerror")) return true;
  if (text.includes("failed to fetch")) return true;
  if (text.includes("networkerror")) return true;
  if (text.includes("load failed")) return true;
  if (text.includes("timed out waiting for a response")) return true;
  // [2026-09-07] Jomnoum: "AbortError: signal is aborted without reason"
  // — supabaseClient.js's own per-request cutoff (FETCH_TIMEOUT_MS)
  // firing on a slow link. The request may well have COMPLETED on the
  // server; the browser just stopped waiting. That is a slow connection,
  // not bad data — it must never count as "stuck, call an admin", which
  // is what pushed staff into "Send back to Waiting board" + re-finish
  // and produced tonight's duplicate transactions.
  if (text.includes("abort")) return true;
  return false;
}

function noteOpFailure(op, err) {
  if (!navigator.onLine || isConnectivityError(err)) {
    // Not actually stuck — either genuinely offline, or the request never
    // reached the server at all (see isConnectivityError above), both of
    // which resolve themselves once the connection is actually working
    // again. Don't let failures recorded here linger and misreport as
    // "stuck" once the connection comes back and these same ops succeed on
    // their very first real attempt.
    clearStuckTracking();
    return;
  }
  const existing = stuckOps.get(op._id);
  stuckOps.set(op._id, {
    since: existing ? existing.since : getAccurateNow().toISOString(),
    // [2026-08-28] Separate from `since` on purpose. A Map keeps a key in
    // its ORIGINAL insertion position even after `.set()` updates its
    // value, so picking "the last entry" to show in the banner used to
    // mean "whichever op got stuck first", not "whichever op just failed
    // most recently" — meaning the error text on screen could be stale
    // and misleading (e.g. still showing an old permissions-sounding
    // error from earlier, even after the real, current problem had
    // changed to something else entirely). getStatus() below now picks
    // by this timestamp instead.
    lastFailedAt: getAccurateNow().toISOString(),
    attempts: (existing?.attempts || 0) + 1,
    error: (err && err.message) || String(err),
    opType: op.type,
    ticketId: op.ticketId || null,
  });
}
function clearOpFailure(opId) {
  stuckOps.delete(opId);
}
// [2026-09-11] Reading and DISCARDING permanently-stuck operations.
//
// WHY THIS EXISTS — Ping Pong, 11 Sept. Two `createPayment` ops were left
// pointing at transaction ids the server does not have. Every pass they
// were retried, every pass the server answered
//   insert or update on table "payments" violates foreign key constraint
//   "payments_transaction_id_fkey"
// and the red banner said, correctly, that this would not fix itself and
// to tell an admin. But there was nothing an admin could actually DO: the
// banner's "View details" panel only lists work that is still PENDING, so
// it showed "nothing waiting" while the bar above it shouted — and there
// was no way anywhere in the app to get rid of a save that can never
// succeed. The only route left was a browser developer console, which is
// not a thing to ask a weighbridge to do.
//
// An op that references a row the database does not have can never
// succeed no matter how long it retries, so there has to be a way to
// throw it away deliberately. This is that way — with the rule that the
// person doing it SEES exactly what is being discarded first (see
// listStuckOps below, and the confirm list in Topbar.jsx).
//
// Deliberately narrow: it can only discard ops already counted as stuck
// (STUCK_THRESHOLD consecutive failures while online). A save that is
// merely waiting for the internet is never offered up.
function describeOp(op) {
  const p = op.payload || {};
  const n = (v) => (v == null || v === "" ? null : new Intl.NumberFormat("en-US").format(Math.round(Number(v) || 0)));
  switch (op.type) {
    case "createPayment":
      return `Payment ${n(p.amount) || "?"} \u17DB${p.memo ? ` \u2014 ${p.memo}` : ""}${p.payDate ? ` (${p.payDate})` : ""}`;
    case "createTransaction":
      return `${p.type || "Entry"} ${n(p.quantityKg) || "?"} kg${p.code ? ` \u2014 ${p.code}` : ""}`;
    case "finalizeTicket":
      return `Finish ticket${p.transactionCode ? ` \u2014 ${p.transactionCode}` : ""}`;
    case "logAudit":
      return `Activity log entry${p.action ? ` (${p.action})` : ""}`;
    case "createParty":
      return `New farmer/buyer${p.name ? ` \u2014 ${p.name}` : ""}`;
    case "createProduct":
      return `New paddy type${p.name ? ` \u2014 ${p.name}` : ""}`;
    default:
      return op.type;
  }
}

// ---------------------------------------------------------------------
// [2026-09-11] RECOVERING a stuck save, not just discarding it.
//
// Discarding is the last resort. It throws real work away — at Ping Pong
// that would have meant two payments, already printed on a receipt and
// handed to a farmer, simply ceasing to exist.
//
// But the transaction those payments point at is not actually gone. The
// station PC keeps a full copy of every transaction it has made in its
// own local cache (getCachedTransactions above) — party, weight, price,
// truck, grade, the exact date and time, everything the receipt was
// printed from. That copy is written at the same moment the save is
// queued and is never removed by a failed sync. So when a payment is
// rejected with
//   violates foreign key constraint "payments_transaction_id_fkey"
// the missing transaction can be REBUILT from that cache and re-queued
// under its ORIGINAL id — which is the whole point, because the payment
// already points at that id, so once the transaction lands the payment
// goes through on its very next attempt with nothing retyped.
//
// Re-sending a transaction that (unknown to us) is actually already on
// the server is harmless: api.js's insertOrFetchExisting recognises the
// duplicate id and returns the existing row instead of writing anything.
// So recovery is always the safe thing to try FIRST, and discarding is
// only for what genuinely cannot be rebuilt.
//
// The weigh-in date and time are carried across exactly as the device
// recorded them — recovery must never move a transaction to today.
// ---------------------------------------------------------------------

// The transaction a non-transaction op depends on: a payment by
// payload.transactionId, an audit entry by payload.recordId when it is
// logging against the transactions table. Same rule trySync uses to
// decide what waits behind what.
function dependsOnTransactionId(op) {
  if (op.type === "createTransaction" || op.type === "finalizeTicket") return null;
  return (
    op.payload?.transactionId ||
    (op.payload?.tableName === "transactions" ? op.payload?.recordId : null) ||
    null
  );
}

// Turns a cached transaction row (server snake_case — the shape
// upsertCachedTransaction stores) back into the camelCase payload a
// createTransaction op carries. Returns null if the cached row is too
// incomplete to rebuild a real transaction from, so a half-written cache
// entry can never become a bogus row in the database.
function cachedTxToCreateOpPayload(tx) {
  if (!tx || !tx.id || !tx.type || !tx.location_id || !tx.party_id) return null;
  if (tx.quantity_kg == null) return null;
  return {
    id: tx.id,
    code: tx.code || null,
    type: tx.type,
    locationId: tx.location_id,
    partyId: tx.party_id,
    productId: tx.product_id || null,
    quantityKg: Number(tx.quantity_kg) || 0,
    pricePerKg: Number(tx.price_per_kg) || 0,
    paymentStatus: tx.payment_status || "unpaid",
    userId: tx.created_by || null,
    qualityGrade: tx.quality_grade || null,
    taxApplicable: !!tx.tax_applicable,
    taxRate: Number(tx.tax_rate) || 0,
    moisturePct: Number(tx.moisture_pct) || 0,
    mixturePct: Number(tx.mixture_pct) || 0,
    outthrowPct: Number(tx.outthrow_pct) || 0,
    deductionKg: Number(tx.deduction_kg) || 0,
    staffFee: Number(tx.staff_fee) || 0,
    note: tx.note || null,
    carPlate: tx.car_plate || null,
    driverName: tx.driver_name || null,
    receiptPhotoUrl: tx.receipt_photo_url || null,
    paymentProofUrl: tx.payment_proof_url || null,
    // The day and time the device stamped when the weight was taken —
    // NEVER "now". buildTransactionRow only falls back to today when
    // these are missing, so they are always passed explicitly here.
    txDate: tx.tx_date || null,
    txTime: tx.tx_time || null,
    // Present when the transaction came from a Weighing Ticket; absent
    // (and harmlessly null) on a manually-entered Buy/Sell.
    paperTicketNo: tx.paper_ticket_no || null,
    grossKg: tx.gross_kg ?? null,
    grossAt: tx.gross_at || null,
    tareKg: tx.tare_kg ?? null,
    tareAt: tx.tare_at || null,
    recordedByName: tx.recorded_by_name || null,
    bankQrUrl: tx.bank_qr_url || null,
  };
}

function describeCachedTx(tx) {
  const n = (v) => (v == null ? "?" : new Intl.NumberFormat("en-US").format(Math.round(Number(v) || 0)));
  const bits = [`${tx.type || "Entry"} ${n(tx.quantity_kg)} kg`];
  if (tx.code) bits.push(tx.code);
  if (tx.tx_date) bits.push(tx.tx_date + (tx.tx_time ? ` ${String(tx.tx_time).slice(0, 5)}` : ""));
  return bits.join(" — ");
}

// Everything currently counted as stuck, with enough detail to decide.
// `recoverTxId` is set when this op is only failing because a
// transaction is missing from the server AND this device still holds a
// complete copy of it — i.e. when Recover will actually fix it.
export function listStuckOps() {
  const queue = getQueue();
  const byId = new Map(queue.map((o) => [o._id, o]));
  // A transaction that is itself still queued is not missing — it just
  // has not had its turn yet — so nothing depending on it is offered a
  // rebuild. Whatever is really wrong is with that transaction's own op.
  const queuedTxIds = pendingTransactionIds();
  const txById = new Map(getCachedTransactions().map((t) => [t.id, t]));
  const out = [];
  for (const [opId, e] of stuckOps) {
    if (e.attempts < STUCK_THRESHOLD) continue;
    const op = byId.get(opId);
    if (!op) continue; // already left the queue
    const needsTx = dependsOnTransactionId(op);
    const cachedTx = needsTx && !queuedTxIds.has(needsTx) ? txById.get(needsTx) : null;
    const canRebuild = !!(cachedTx && cachedTxToCreateOpPayload(cachedTx));
    out.push({
      opId,
      type: op.type,
      summary: describeOp(op),
      attempts: e.attempts,
      error: e.error || "",
      since: e.since,
      recoverTxId: canRebuild ? needsTx : null,
      recoverSummary: canRebuild ? describeCachedTx(cachedTx) : null,
    });
  }
  return out;
}

// Rebuild the missing transactions the named stuck ops are waiting on,
// re-queue them under their original ids, and let those ops try again
// from a clean slate. Returns { rebuilt, retried } — how many
// transactions were put back, and how many stuck saves were released.
//
// Nothing is deleted here, by design: if a rebuild turns out not to fix
// it, the op is still in the queue and Discard is still available.
export function recoverStuckOps(opIds) {
  const byOpId = new Map(listStuckOps().map((x) => [x.opId, x]));
  const txById = new Map(getCachedTransactions().map((t) => [t.id, t]));
  const doneTxIds = new Set();
  let rebuilt = 0;
  let retried = 0;
  for (const opId of opIds || []) {
    const entry = byOpId.get(opId);
    if (!entry || !entry.recoverTxId) continue;
    const txId = entry.recoverTxId;
    if (!doneTxIds.has(txId)) {
      const payload = cachedTxToCreateOpPayload(txById.get(txId));
      if (!payload) continue;
      // Same storage-failure check every other enqueue in this file
      // makes: if the device could not actually write the queue, nothing
      // was queued and the stuck op must be left exactly as it is rather
      // than reported as recovered.
      const { persisted } = enqueue({ type: "createTransaction", payload });
      if (!persisted) continue;
      doneTxIds.add(txId);
      rebuilt += 1;
    }
    stuckOps.delete(opId);
    retried += 1;
  }
  if (rebuilt || retried) {
    notifyStatus();
    trySync();
  }
  return { rebuilt, retried };
}

// Throw the named ops away for good. Returns how many were actually
// removed. Only ops currently counted as stuck can be discarded, so a
// stale opId from a screen left open cannot quietly delete a save that
// has since started working again.
export function discardStuckOps(opIds) {
  const allowed = new Set(listStuckOps().map((x) => x.opId));
  const ids = new Set((opIds || []).filter((id) => allowed.has(id)));
  if (!ids.size) return 0;
  let removed = 0;
  mutateQueue((q) =>
    q.filter((o) => {
      if (!ids.has(o._id)) return true;
      removed += 1;
      return false;
    })
  );
  for (const id of ids) stuckOps.delete(id);
  notifyStatus();
  return removed;
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
// [2026-09-07] 20s → 30s, to sit above the finalize RPC's own 28s abort
// signal (api.js) — otherwise this timer fires first, the op is marked
// failed, and the still-running request lands on the server anyway,
// which is exactly the "server saved it but the app thinks it failed"
// state behind Jomnoum's duplicates.
const SYNC_OP_TIMEOUT_MS = 30000;
function runOpWithTimeout(op) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(tagError(new Error("Timed out waiting for a response — the connection may be too unstable to complete this save right now."), "err_request_timeout"));
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
        // [2026-09-11] Transaction ids that nothing depending on them may
        // run in front of. Seeded with every transaction whose
        // createTransaction op is STILL QUEUED (i.e. has not reached the
        // server yet), and added to when one fails during this pass.
        //
        // THE BUG THIS FIXES — found at Ping Pong, 11 Sept. A manual
        // Buy/Sell queues three ops together: createTransaction,
        // createPayment and logAudit. None of them carries a ticketId
        // (they are not weighing tickets), so the ticket-ordering rule
        // above did not apply to them and there was nothing else holding
        // them in order. If the createTransaction was slow or timed out,
        // the createPayment right behind it was tried anyway — against a
        // transaction the server did not have yet — and came back
        //   insert or update on table "payments" violates foreign key
        //   constraint "payments_transaction_id_fkey"
        // every single pass, forever. Two of those sat on Ping Pong's PC
        // hammering the server with 409s and showing a red banner nobody
        // could act on, while the transaction they belonged to was still
        // sitting in the queue right beside them.
        //
        // A payment must never be attempted before the transaction it
        // points at exists. Same principle as rule 1 above (a ticket's own
        // changes apply in order) — manual entries just never had it.
        const blockedTxIds = new Set(
          q.filter((o) => o.type === "createTransaction" && o.payload?.id).map((o) => o.payload.id)
        );
        let progressed = false;

        for (const op of q) {
          const refId = op.payload?.partyId || op.payload?.productId || op.partyId || null;
          if (refId && blockedLocalIds.has(refId)) {
            if (op.ticketId) blockedTicketIds.add(op.ticketId);
            continue;
          }
          if (op.ticketId && blockedTicketIds.has(op.ticketId)) continue;
          // Wait for the transaction this op belongs to. `createTransaction`
          // is exempt (it IS the transaction); a payment references it by
          // payload.transactionId, an audit entry by payload.recordId when
          // it is logging against the transactions table.
          if (op.type !== "createTransaction") {
            const needsTx =
              op.payload?.transactionId ||
              (op.payload?.tableName === "transactions" ? op.payload?.recordId : null) ||
              null;
            if (needsTx && blockedTxIds.has(needsTx)) continue;
          }

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
            // A transaction that just failed keeps its payment and audit
            // entry behind it for the rest of this pass too — they are
            // already in blockedTxIds from the seed above, but a
            // createTransaction ENQUEUED mid-pass would not be, so this
            // covers that as well.
            if (op.type === "createTransaction" && op.payload?.id) {
              blockedTxIds.add(op.payload.id);
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
    // [2026-08-30] This function only ever runs once an op has actually
    // succeeded (see the TX_OP_TYPES branch in trySync below) — so however
    // `needs_verification` was left on the cached copy, it's genuinely
    // confirmed synced now. Without this explicit false, `{...cached,
    // ...result}` would leave a `true` set at print time stuck on this
    // device's cached copy forever (the real database row has no such
    // column to overwrite it with), even though the sync it was warning
    // about has since gone through fine.
    needs_verification: false,
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
  assertNotViewOnly();
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
  assertNotViewOnly();
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
  assertNotViewOnly();
  // [2026-09-10] Matching used to be `.trim().toLowerCase()`. For Khmer that
  // sees almost nothing: input methods insert zero-width characters, and the
  // same word can be stored in more than one Unicode normalisation, so two
  // names that draw identically compare as different. This function is where
  // a new paddy type gets minted, so every one of those differences became a
  // duplicate row — seven copies of "សែន ក្រអូប", and several paddy types
  // showing a NEGATIVE balance because stock was sold under one copy and
  // bought under another.
  //
  // productKey() is the JavaScript twin of the database's product_key(), and
  // the database now has a unique index on it. See src/productName.js.
  const cleaned = cleanProductName(typedName);
  if (!cleaned) return null;

  const cachedMatch = findProductByName(getCachedProducts(), cleaned);
  if (cachedMatch) return cachedMatch.id;

  if (navigator.onLine) {
    const all = await withTimeout(api.getProducts().catch(() => null), ONLINE_LOOKUP_TIMEOUT_MS, null);
    if (all) {
      setCachedProducts(all);
      const exact = findProductByName(all, cleaned);
      if (exact) return exact.id;
    }
  }

  // Nothing matched anywhere, so this really is a new paddy type. It is
  // stored cleaned, so when it syncs it either inserts once or collides with
  // an identical name and api.createProduct hands back the existing row.
  const id = newId();
  addCachedProduct({ id, name: cleaned });
  enqueue({ type: "createProduct", payload: { id, name: cleaned } });
  trySync();
  return id;
}

// Opens a brand new ticket the instant a truck arrives — no network
// required. `locationName`/`locationAddress`/`locationPhone` are only used
// for the on-screen/print label — resolved locally from the already-loaded
// `locations` list (see add_location_address_phone.sql), no network call.
//
// `grossKg` is captured HERE, as part of ticket creation itself, rather
// than through a separate follow-up setTicketGrossOffline() call right
// after (that was the old two-step shape — see NewTicketModal in
// WeighingTickets.jsx). The two-step version created a real gap: the
// ticket could reach the server via one save while the weight reached it
// via a second, independent save, and if that second save never made it
// through (a dropped connection, a closed tab, a stuck sync — exactly
// what happened at Jomnoum on 2026-09-01) the ticket was left sitting on
// the board permanently showing "—" for weight, with no way to tell it
// apart from a ticket that was ever going to get one. Now there is only
// ever one save, so a ticket either exists with its weight already on it,
// or it doesn't exist yet at all.
export function createTicketOffline({ type, locationId, locationName, locationAddress, locationPhone, partyId, partyName, phone, bankName, bankAccount, carPlate, driverName, productId, productName, userId, paperTicketNo, bankQrUrl, recordedByName, grossKg }) {
  assertNotViewOnly();
  const id = newId();
  const code = genLocalTicketCode();
  const hasGross = grossKg != null;
  const nowIso = getAccurateNow().toISOString();
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
    stage: hasGross ? "weighed_in" : "arrived",
    gross_kg: hasGross ? grossKg : null,
    gross_at: hasGross ? nowIso : null,
    gross_by: hasGross ? userId : null,
    grossByName: null,
    quality_grade: null, moisture_pct: null, mixture_pct: null, outthrow_pct: null,
    deduction_kg: 0, price_per_kg: null, staff_fee: 0, tax_applicable: false, tax_rate: 10,
    price_note: null, priced_at: null, priced_by: null, pricedByName: null,
    tare_kg: null, tare_at: null, tare_by: null, tareByName: null,
    transaction_id: null, note: null,
    created_by: userId, createdByName: null, created_at: nowIso,
  };
  upsertCachedTicket(ticket);
  enqueue({ type: "createTicket", ticketId: id, payload: { id, code, type, locationId, partyId, partyName, phone, bankName, bankAccount, carPlate, driverName, productId, productName, userId, paperTicketNo, bankQrUrl, recordedByName, grossKg: hasGross ? grossKg : undefined } });
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
  assertNotViewOnly();
  const updated = patchCachedTicket(id, { gross_kg: grossKg, gross_at: getAccurateNow().toISOString(), gross_by: userId, stage: "weighed_in" });
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
  assertNotViewOnly();
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
    patch.gross_at = getAccurateNow().toISOString();
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
  assertNotViewOnly();
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
    priced_at: getAccurateNow().toISOString(),
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

// [2026-09-07] After an HQ Reopen (api.reopenTicket) the old transaction is
// cancelled, so the next Finish must mint a NEW id/code — otherwise the
// remembered pair (see finalizeTicketOffline) would be re-sent and the
// server would hand back the cancelled row. Called from ReopenTicketModal.
export function forgetPendingTransaction(ticketId) {
  // Only if the ticket is actually in the cache — patchCachedTicket would
  // otherwise create a bare stub that could show up as a phantom card.
  if (!getCachedTickets().some((t) => t.id === ticketId)) return;
  patchCachedTicket(ticketId, { pending_tx_id: null, pending_tx_code: null });
}

export function setTicketTareOffline(id, { tareKg, userId }) {
  assertNotViewOnly();
  const updated = patchCachedTicket(id, { tare_kg: tareKg, tare_at: getAccurateNow().toISOString(), tare_by: userId, stage: "weighed_out" });
  enqueue({ type: "setTicketTare", ticketId: id, payload: { tareKg, userId } });
  trySync();
  return updated;
}

// Finalizing needs a real transaction to hand to the receipt screen right
// away, even offline — so we build one locally from the ticket's own
// numbers (the exact same math FinalizeModal already previews) and queue
// the real save for later. Once synced, the permanent server copy has
// this same id, so nothing about the receipt has to change.
export async function finalizeTicketOffline(ticket, { userId, txDate, receiptPhotoUrl, paymentStatus }) {
  assertNotViewOnly();
  // [2026-09-08] The date/time of THIS save, fixed now, carried in the op
  // and used by the server — never "now at sync time" (audit #2).
  const stampedNow = cambodiaNow();
  txDate = txDate || stampedNow.date;
  let txTime = stampedNow.time;
  // [2026-09-07] ONE transaction id/code per ticket, for life — remembered
  // on the cached ticket the first time Finish is pressed, and reused by
  // every later press on this device, whatever happened to the queue in
  // between ("Send back to Waiting" used to throw it away and mint a new
  // one, which is how tonight's Jomnoum receipts ended up carrying a code
  // the database never stored). The server is idempotent on this id, so
  // re-sending it is always safe. A ticket the HQ admin Reopened gets a
  // fresh pair (see reopenTicket in api.js / the cache patch there).
  const remembered = getCachedTickets().find((t) => t.id === ticket.id);
  const transactionId = remembered?.pending_tx_id || newId();
  const transactionCode = remembered?.pending_tx_code || genLocalTxCode(ticket.type || remembered?.type);
  if (!remembered?.pending_tx_id || !remembered?.pending_tx_code) {
    patchCachedTicket(ticket.id, { pending_tx_id: transactionId, pending_tx_code: transactionCode });
  }
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

  // [2026-08-30] Two gaps found in the 2026-08-30 audit (triggered by
  // finished tickets not showing up in Transactions at Ping Pong), both
  // fixed here — see the audit doc "Part 0" for the full write-up:
  //
  //   0.1 — enqueue() could silently fail to persist (storage full or
  //   blocked). Nothing downstream ever checked, so a receipt could print
  //   for a finalize that was never actually queued anywhere durable.
  //   Fixed below by checking `persisted` before doing anything else, and
  //   throwing instead of proceeding when it's false.
  //
  //   0.2 — trySync()'s single shared in-flight promise could resolve
  //   without ever having attempted THIS op, if a sync pass that started
  //   just before this op was enqueued happened to already be wrapping up.
  //   Fixed below by re-checking whether the op is still queued after
  //   trySync() resolves, and calling trySync() again (a genuinely fresh
  //   pass, once the stale one has finished) if it's still there — bounded
  //   by the same FINISH_SYNC_TIMEOUT_MS budget as before.
  //
  // Reusing an already-queued op instead of enqueueing a second one
  // matters here specifically: if a previous attempt on this same ticket
  // already got past the persisted check but then failed to confirm sync
  // in time (thrown below), staff pressing Finish Ticket again must not
  // create a second finalizeTicket op for the same ticket — that would
  // eventually try to create two transactions for one truckload.
  const existingOp = getQueue().find((op) => op.type === "finalizeTicket" && op.ticketId === ticket.id);
  let opId, persisted, finalTransactionId, finalTransactionCode;
  if (existingOp) {
    opId = existingOp._id;
    persisted = true; // it's sitting in getQueue(), which reads straight from disk
    finalTransactionId = existingOp.payload.transactionId;
    finalTransactionCode = existingOp.payload.transactionCode;
    // Keep the FIRST press's date/time — a re-press minutes (or a day)
    // later is the same save, not a new one.
    if (existingOp.payload.txDate) txDate = existingOp.payload.txDate;
    if (existingOp.payload.txTime) txTime = existingOp.payload.txTime;
  } else {
    finalTransactionId = transactionId;
    finalTransactionCode = transactionCode;
    const enqueued = enqueue({ type: "finalizeTicket", ticketId: ticket.id, payload: { userId, txDate, txTime, paymentStatus: paymentStatus || null, transactionId, transactionCode, receiptPhotoUrl } });
    opId = enqueued.opId;
    persisted = enqueued.persisted;
  }

  if (!persisted) {
    throw tagError(new Error("Could not save this ticket on this device (storage error) — nothing was queued. Do NOT print a receipt. Try Finish Ticket again in a moment, or free up space on this device if it keeps happening."), "err_storage_ticket");
  }

  // [2026-09-07] Second copy to the station PC's disk (see relayToStation).
  // Sent BEFORE the wait/print below so the disk copy exists by the time
  // the receipt comes out. The ticket snapshot carries everything Finish
  // set (price, quality, bank, product, tare) under the server's own
  // column names; the transaction row is the same one the receipt shows.
  relayToStation("finalize", {
    ticketId: ticket.id,
    ticket,
    transaction: buildLocalTransactionRow(),
    userId,
  });

  // See FINISH_SYNC_TIMEOUT_MS above for why this waits, bounded, instead
  // of firing and forgetting like every other offline write in this file.
  // Genuinely offline stays exactly as fast as before — nothing to wait on.
  //
  // [2026-08-30] Changed from blocking to flagging, per direction: the
  // storage-write failure above (gap 0.1) still blocks outright, because
  // there is nothing durable to fall back on if that failed. This case
  // (gap 0.2) is different — the op IS safely and durably queued (the
  // `persisted` check above already confirmed that), so instead of
  // stopping the print, this now prints normally and marks the
  // transaction `needs_verification: true` — surfaced as the printed
  // warning band on the receipt (Receipt.jsx) and as an entry in the
  // "Needs Attention" panel (Topbar.jsx / NeedsAttentionModal.jsx) until
  // it actually syncs, instead of disappearing the moment the receipt
  // prints. Nothing about the automatic retrying below changes.
  //
  // [2026-09-06] Reversed again, per direction after Jomnoum's TKT-521806 /
  // TKT-872042: while ONLINE, an unconfirmed save no longer prints-and-
  // flags — it throws (see unconfirmedSaveError), so no receipt exists for
  // a transaction the server hasn't confirmed. Nothing is lost by this:
  // the op stays queued and keeps retrying on its own; the ticket's cached
  // stage is deliberately NOT marked finalized here on that path, so it
  // stays on the board for staff to press Finish Ticket again (safe — the
  // existingOp reuse above plus the atomic finalize_weighing_ticket
  // function on the server both guarantee no duplicate). If the queued
  // save lands in the background first, trySync()'s own success handler
  // marks the ticket finalized and it leaves the board on its own — the
  // receipt is then printed from Transactions. A genuinely OFFLINE station
  // is untouched: it still prints immediately, with the on-screen
  // "not yet synced" warning, and syncs when the connection returns.
  let needsVerification = false;
  if (navigator.onLine) {
    const deadline = Date.now() + FINISH_SYNC_TIMEOUT_MS;
    let confirmed = !isOpQueued(opId); // e.g. a previous attempt already got it synced between attempts
    while (!confirmed && Date.now() < deadline) {
      await withTimeout(trySync(), Math.max(0, deadline - Date.now()), null);
      confirmed = !isOpQueued(opId);
    }
    // [2026-09-07] Print ALWAYS — offline, slow, or unconfirmed. Refusing
    // the receipt on a slow connection (the 2026-09-06 rule) just moved the
    // problem to the person at the scale; the real protection is now in
    // the database (one live transaction per ticket, idempotent finalize)
    // plus the station relay above, so printing first is safe. An
    // unconfirmed save is flagged on screen (needs_verification) and keeps
    // retrying from both the browser queue and the station PC.
    needsVerification = !confirmed;
    // Confirmed — but the server may have answered with a
    // transaction that ALREADY existed for this ticket (an earlier
    // attempt that the browser gave up on but the server completed; see
    // finalize_weighing_ticket's idempotent return). trySync's success
    // handler has already written that server row into the transaction
    // cache and pointed the cached ticket at it. Use THAT for the
    // receipt, never the locally-built copy with a code the server never
    // stored — otherwise the paper shows one code and the database
    // another. Display-only names (party/station/product) stay from the
    // local copy below since the raw server row doesn't carry them.
    const syncedTicket = getCachedTickets().find((t) => t.id === ticket.id);
    const serverTxId = syncedTicket?.transaction_id || finalTransactionId;
    const serverTx = confirmed ? getCachedTransactions().find((t) => t.id === serverTxId) : null;
    if (serverTx) {
      finalTransactionId = serverTx.id;
      finalTransactionCode = serverTx.code || finalTransactionCode;
    }
  } else {
    trySync();
  }

  patchCachedTicket(ticket.id, { stage: "finalized", transaction_id: finalTransactionId });

  const tx = buildLocalTransactionRow();
  tx.needs_verification = needsVerification;
  tx.id = finalTransactionId;
  tx.code = finalTransactionCode;
  upsertCachedTransaction(tx);
  return tx;

  function buildLocalTransactionRow() {
  return {
    needs_verification: false,
    id: finalTransactionId,
    code: finalTransactionCode,
    type: ticket.type,
    tx_date: txDate,
    tx_time: txTime,
    // Mirrors api.finalizeTicket: Buy pending; Sell credit unless the
    // station recorded it paid at the scale (audit #1).
    payment_status: ticket.type === "BUY" ? "pending" : (ticket.price_per_kg == null ? "credit" : (paymentStatus === "paid" ? "paid" : "credit")),
    // location_id/party_id/product_id: not needed for the receipt itself,
    // but required for the Transactions list — its location filter and
    // per-transaction payment lookups both key off these, same as every
    // field the real server row would eventually have.
    location_id: ticket.location_id,
    party_id: ticket.party_id,
    product_id: ticket.product_id,
    partyName: ticket.party_name,
    // Phone typed on the ticket; if staff left it blank, the phone on the
    // farmer/buyer's own record (same fallback api.getTransactions uses).
    partyIdNumber: ticket.phone || getCachedParties().find((p) => p.id === ticket.party_id)?.phone || "",
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
    // Sell-only snapshot of the truck's own weigh-out weight/price at the
    // moment this ticket was finished — mirrors api.js's createTransaction,
    // kept in sync with it on purpose (see that function's own comment).
    // Stays untouched forever after this; quantity_kg/price_per_kg above
    // are the ones that later switch to the buyer's confirmed numbers.
    station_quantity_kg: ticket.type === "SELL" ? netKg : null,
    station_price_per_kg: ticket.type === "SELL" ? ticket.price_per_kg : null,
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
  }
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
export async function createTransactionOffline({ type, locationId, partyId, productId, quantityKg, pricePerKg, paymentStatus, userId, qualityGrade, taxApplicable, taxRate, moisturePct, mixturePct, outthrowPct, deductionKg, staffFee, note, carPlate, driverName, receiptPhotoUrl, paymentProofUrl, txDate, partyName, partyIdNumber, bankName, bankAccount, productName, stationName }) {
  assertNotViewOnly();
  const id = newId();
  const code = genLocalTxCode(type);
  const payableKg = Math.max(0, (quantityKg || 0) - (deductionKg || 0));
  const staffFeeAmt = type === "BUY" ? (staffFee || 0) : 0;
  const amount = Math.round(Math.max(0, payableKg * (pricePerKg || 0) - staffFeeAmt) * 100) / 100;
  const taxAmount = taxApplicable ? Math.round(amount * (taxRate || 0)) / 100 : 0;
  const { date: nowDate, time: nowTime } = cambodiaNow();

  // See the long comment in finalizeTicketOffline above for why this
  // checks `persisted` and loops on `isOpQueued` — same two 2026-08-30
  // audit gaps (0.1 silent storage-write failure, 0.2 the trySync()
  // shared-promise race), same fix. No op-reuse dedup here (unlike
  // finalizeTicketOffline): a manual entry has no ticket id to key a
  // duplicate check on, and the Save button is already disabled while
  // `saving` is true, so a genuine retry after an error here is always a
  // deliberate new attempt, not an accidental double-submit.
  const { opId, persisted } = enqueue({
    type: "createTransaction",
    payload: {
      id, code, type, locationId, partyId, productId, quantityKg, pricePerKg, paymentStatus, userId,
      qualityGrade, taxApplicable, taxRate, moisturePct, mixturePct, outthrowPct, deductionKg,
      staffFee: staffFeeAmt, note, carPlate, driverName, receiptPhotoUrl, paymentProofUrl, txDate,
    },
  });
  if (!persisted) {
    throw tagError(new Error("Could not save this entry on this device (storage error) — nothing was queued. Do NOT print a receipt. Try Save again in a moment, or free up space on this device if it keeps happening."), "err_storage_entry");
  }
  // [2026-09-07] Second copy to the station PC's disk — see relayToStation.
  relayToStation("transaction", {
    transaction: {
      id, code, type, tx_date: txDate || nowDate, tx_time: nowTime, location_id: locationId, party_id: partyId,
      product_id: productId, quantity_kg: quantityKg, price_per_kg: pricePerKg, payment_status: paymentStatus,
      quality_grade: qualityGrade, tax_applicable: !!taxApplicable, tax_rate: taxApplicable ? (taxRate || 0) : 0,
      moisture_pct: moisturePct || 0, mixture_pct: mixturePct || 0, outthrow_pct: outthrowPct || 0,
      deduction_kg: deductionKg || 0, staff_fee: staffFeeAmt, note, car_plate: carPlate, driver_name: driverName,
      receipt_photo_url: receiptPhotoUrl || null, payment_proof_url: paymentProofUrl || null, amount,
      station_quantity_kg: type === "SELL" ? quantityKg : null, station_price_per_kg: type === "SELL" ? pricePerKg : null,
      created_by: userId, status: "confirmed", hq_status: "processing",
    },
    userId,
  });
  // Same reasoning as finalizeTicketOffline above — see FINISH_SYNC_TIMEOUT_MS
  // and the 2026-09-06 comment there. This path deliberately does NOT
  // throw like finalizeTicketOffline now does: the caller
  // (TransactionForm.jsx) still has the "already paid" cash payment and
  // the audit entries to queue right after this returns, and those must
  // be queued alongside the transaction so the whole entry lands together
  // — throwing here would land a "paid" transaction with no payment row.
  // So this keeps returning `needs_verification: true`, and
  // TransactionForm.jsx is what refuses the receipt (it queues the rest,
  // then shows unconfirmedSaveMessage() instead of the print screen).
  let needsVerification = false;
  if (navigator.onLine) {
    const deadline = Date.now() + FINISH_SYNC_TIMEOUT_MS;
    let confirmed = !isOpQueued(opId);
    while (!confirmed && Date.now() < deadline) {
      await withTimeout(trySync(), Math.max(0, deadline - Date.now()), null);
      confirmed = !isOpQueued(opId);
    }
    needsVerification = !confirmed;
  } else {
    trySync();
  }

  const tx = {
    needs_verification: needsVerification,
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
    // Sell-only snapshot — same reasoning as finalizeTicketOffline above
    // and api.js's createTransaction (kept in sync with both on purpose).
    station_quantity_kg: type === "SELL" ? quantityKg : null,
    station_price_per_kg: type === "SELL" ? pricePerKg : null,
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
  assertNotViewOnly();
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
  assertNotViewOnly();
  enqueue({ type: "logAudit", payload });
  trySync();
}
