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

// Re-reads the queue immediately after every write and retries the whole
// read-modify-write if what's actually stored doesn't match what we just
// wrote — this closes a real data-loss window: two tabs/windows of
// PaddyTrade open on the same computer at once (e.g. someone checking
// Transactions in one tab while another person is mid-entry on New Buy in
// a second tab) both read and write this same localStorage key with no
// locking otherwise, and whichever tab's write lands last silently erases
// whatever the other tab had just added — including a brand-new,
// already-printed transaction that exists nowhere else yet. localStorage
// has no real cross-tab lock, so this isn't a perfect guarantee, but it
// narrows the unsafe window from "the entire life of the tab" down to the
// handful of milliseconds between our own write and our own verify-read.
function mutateQueue(mutator) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const current = getQueue();
    const next = mutator(current.slice());
    writeJSON(QUEUE_KEY, next);
    const verify = getQueue();
    if (JSON.stringify(verify) === JSON.stringify(next)) {
      notifyStatus();
      return next;
    }
    // Another tab wrote in between our write and this read-back — redo the
    // mutation against whatever's actually there now instead of silently
    // discarding it.
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
// Clears it off the local board and drops every OTHER still-queued
// change for that same ticket too, since none of them can succeed
// either — otherwise the very next one just blocks the queue again the
// same way, one at a time. Leaves the op currently being processed
// (always at the front of the queue) for the normal dequeue step right
// after this runs, rather than removing it here too.
function dropOtherOpsForGoneTicket(ticketId) {
  if (!ticketId) return;
  removeCachedTicket(ticketId);
  mutateQueue((q) => (q.length === 0 ? q : [q[0], ...q.slice(1).filter((op) => op.ticketId !== ticketId)]));
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
  mutateQueue((q) => { q.push(op); return q; });
}
function dequeueFirst() {
  mutateQueue((q) => { q.shift(); return q; });
  clearStuckTracking();
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

// Tracks whether the item at the FRONT of the queue is genuinely stuck —
// meaning we're online and it has failed to save several times in a row for
// a real reason (bad data, a permissions/RLS problem, a server-side bug) —
// as opposed to plain "offline, waiting for WiFi", which isn't a problem at
// all and shouldn't look like one. These are very different situations for
// staff: one resolves itself the moment the connection returns, the other
// won't resolve on its own no matter how long you wait, and everything
// behind it in the queue is blocked too. Surfacing them the same way (as
// this code used to) makes a genuinely broken sync look identical to a
// normal, harmless delay.
let stuckOpSignature = null;
let stuckSince = null;
let stuckAttempts = 0;
let lastStuckError = null;
const STUCK_THRESHOLD = 3; // consecutive failed attempts, while online, before we call it "stuck"

function noteOpFailure(op, err) {
  if (!navigator.onLine) {
    // Not actually stuck — just offline, which is expected and resolves on
    // its own. Don't let a failure recorded here linger and misreport as
    // "stuck" once the connection comes back and this same op succeeds on
    // its very first real attempt.
    clearStuckTracking();
    return;
  }
  const sig = JSON.stringify({ type: op.type, ticketId: op.ticketId, payload: op.payload });
  if (sig === stuckOpSignature) {
    stuckAttempts += 1;
  } else {
    stuckOpSignature = sig;
    stuckSince = new Date().toISOString();
    stuckAttempts = 1;
  }
  lastStuckError = (err && err.message) || String(err);
}
function clearStuckTracking() {
  stuckOpSignature = null;
  stuckSince = null;
  stuckAttempts = 0;
  lastStuckError = null;
}

function getStatus() {
  return {
    online: navigator.onLine,
    syncing,
    pending: totalPending(),
    stuck: stuckAttempts >= STUCK_THRESHOLD,
    stuckSince,
    stuckAttempts,
    lastStuckError,
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

// Only these op types touch the ticket board's local cache once they land
// on the server — a manually-entered Buy/Sell (createTransaction/
// createPayment/logAudit, queued from TransactionForm.jsx) has no
// ticketId and isn't a ticket at all, so it must never be folded into the
// ticket cache below.
const TICKET_OP_TYPES = new Set(["createTicket", "setTicketGross", "setTicketPrice", "setTicketTare", "finalizeTicket"]);

// Processes the queue strictly in order (FIFO), stopping at the first
// failure — a later op might depend on an earlier one having landed (e.g.
// a ticket has to exist on the server before we can set its price), so we
// never want to skip ahead.
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
    syncing = true;
    notifyStatus();
    try {
      // NOTE: this offline check must stay INSIDE the try/finally below.
      // It used to be a bare early-return before syncing=true/try even
      // started, which skipped the `finally` block entirely — meaning
      // syncPromise never got reset back to null while offline. Every
      // later call to trySync() (including the periodic 15s heartbeat)
      // then saw a stale non-null syncPromise and returned it immediately
      // without ever retrying, so sync could permanently stop until the
      // page was reloaded. Keeping the check in here lets `finally` always
      // run and reset syncPromise, so sync resumes on its own once WiFi
      // comes back.
      if (!navigator.onLine) return;
      while (true) {
        const q = getQueue();
        if (q.length === 0) break;
        const op = q[0];
        try {
          const result = await runOp(op);
          // A ticket-related op just landed on the server — fold the
          // server's returned row into the local cache so the UI reflects
          // confirmed data as soon as it's available.
          if (result && TICKET_OP_TYPES.has(op.type)) {
            upsertCachedTicket(normalizeSyncedTicket(op, result));
          }
          dequeueFirst();
        } catch (err) {
          // Network still down, or a real error — either way, stop here
          // and try again later rather than skipping ahead out of order.
          console.warn("[offlineQueue] sync paused:", err?.message || err);
          noteOpFailure(op, err);
          break;
        }
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
    grossByName: result.grossByName ?? cached.grossByName ?? null,
    pricedByName: result.pricedByName ?? cached.pricedByName ?? null,
    tareByName: result.tareByName ?? cached.tareByName ?? null,
    createdByName: result.createdByName ?? cached.createdByName ?? null,
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

function genLocalTicketCode() {
  return `TKT-${Math.floor(1000 + Math.random() * 8999)}`;
}
function genLocalTxCode(type) {
  const n = Math.floor(1000 + Math.random() * 8999);
  return type === "BUY" ? `RCP-${n}-A` : `INV-${n}-B`;
}

// Matches an existing supplier/buyer by exact name, or creates a new one
// — checks the local cache first (works with zero network), then a live
// lookup if we're online and the cache might be stale.
export async function resolvePartyIdOffline(typedName, type, locationId, extra = {}) {
  const trimmed = (typedName || "").trim();
  if (!trimmed) return null;

  const cachedMatch = getCachedParties().find((p) => p.type === type && (p.name || "").trim().toLowerCase() === trimmed.toLowerCase());
  if (cachedMatch) return cachedMatch.id;

  if (navigator.onLine) {
    const matches = await withTimeout(api.getParties({ type, q: trimmed }).catch(() => null), ONLINE_LOOKUP_TIMEOUT_MS, null);
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
// required. `locationName` is only used for the on-screen/print label.
export function createTicketOffline({ type, locationId, locationName, partyId, partyName, phone, bankName, bankAccount, carPlate, driverName, productId, productName, userId, paperTicketNo, bankQrUrl, recordedByName }) {
  const id = newId();
  const code = genLocalTicketCode();
  const ticket = {
    id, code, type,
    location_id: locationId, stationName: locationName || "—",
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
  return {
    id: transactionId,
    code: transactionCode,
    type: ticket.type,
    tx_date: txDate || nowDate,
    tx_time: nowTime,
    partyName: ticket.party_name,
    partyIdNumber: ticket.phone,
    bank_name: ticket.bank_name,
    bank_account: ticket.bank_account,
    product_name: ticket.product_name,
    stationName: ticket.stationName,
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
  };
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

export function createTransactionOffline({ type, locationId, partyId, productId, quantityKg, pricePerKg, paymentStatus, userId, qualityGrade, taxApplicable, taxRate, moisturePct, mixturePct, outthrowPct, deductionKg, staffFee, note, carPlate, driverName, receiptPhotoUrl, paymentProofUrl, txDate }) {
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

  return {
    id, code, type,
    tx_date: txDate || nowDate,
    tx_time: nowTime,
    location_id: locationId,
    party_id: partyId,
    product_id: productId,
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
  };
}

// Records a cash payment made at the moment a manual transaction is
// saved (the "already Paid" case) — same client-generated-id pattern, so
// it lands on the server as the exact same record whenever it syncs.
export function createPaymentOffline({ type, transactionId, locationId, amount, method, payDate, memo, userId }) {
  const id = newId();
  enqueue({ type: "createPayment", payload: { id, type, transactionId, locationId, amount, method, payDate, memo, userId } });
  trySync();
  return { id, type, transaction_id: transactionId, location_id: locationId, amount, method, pay_date: payDate, memo, created_by: userId };
}

// Queues an Activity Log entry without waiting on the network — used
// alongside createTransactionOffline/createPaymentOffline so a new
// manual entry is traceable later even if it was saved while offline.
export function logAuditOffline(payload) {
  enqueue({ type: "logAudit", payload });
  trySync();
}
