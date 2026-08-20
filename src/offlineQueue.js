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

export function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older browsers that don't have crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
  try {
    const [parties, products] = await Promise.all([api.getParties(), api.getProducts()]);
    setCachedParties(parties);
    setCachedProducts(products);
  } catch {
    // Offline or failed — just keep whatever's already cached.
  }
}

// ---------------------------------------------------------------------
// Pending operations queue.
// ---------------------------------------------------------------------

export function getQueue() {
  return readJSON(QUEUE_KEY, []);
}
function setQueue(q) {
  writeJSON(QUEUE_KEY, q);
  notifyStatus();
}
export function enqueue(op) {
  const q = getQueue();
  q.push(op);
  setQueue(q);
}
function dequeueFirst() {
  const q = getQueue();
  q.shift();
  setQueue(q);
}

export function pendingCountForTicket(ticketId) {
  return getQueue().filter((op) => op.ticketId === ticketId).length;
}
export function totalPending() {
  return getQueue().length;
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
function getStatus() {
  return { online: navigator.onLine, syncing, pending: totalPending() };
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
      return party;
    }
    case "createProduct": {
      const product = await api.createProduct(op.payload.name, op.payload.id);
      addCachedProduct(product);
      return product;
    }
    case "createTicket":
      return api.createTicket(op.payload);
    case "setTicketGross":
      return api.setTicketGross(op.ticketId, op.payload);
    case "setTicketPrice":
      return api.setTicketPrice(op.ticketId, op.payload);
    case "setTicketTare":
      return api.setTicketTare(op.ticketId, op.payload);
    case "finalizeTicket":
      return api.finalizeTicket(op.ticketId, op.payload);
    default:
      throw new Error("Unknown queued operation: " + op.type);
  }
}

// Processes the queue strictly in order (FIFO), stopping at the first
// failure — a later op might depend on an earlier one having landed (e.g.
// a ticket has to exist on the server before we can set its price), so we
// never want to skip ahead.
let syncPromise = null;
export function trySync() {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    if (!navigator.onLine) return;
    syncing = true;
    notifyStatus();
    try {
      while (true) {
        const q = getQueue();
        if (q.length === 0) break;
        const op = q[0];
        try {
          const result = await runOp(op);
          // A ticket-related op just landed on the server — fold the
          // server's returned row into the local cache so the UI reflects
          // confirmed data as soon as it's available.
          if (result && op.type !== "createParty" && op.type !== "createProduct") {
            upsertCachedTicket(normalizeSyncedTicket(op, result));
          }
          dequeueFirst();
        } catch (err) {
          // Network still down, or a real error — either way, stop here
          // and try again later rather than skipping ahead out of order.
          console.warn("[offlineQueue] sync paused:", err?.message || err);
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
    try {
      const matches = await api.getParties({ type, q: trimmed });
      const exact = matches.find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
      if (exact) {
        addCachedParty(exact);
        return exact.id;
      }
    } catch {
      // Fall through and create it locally below.
    }
  }

  const id = newId();
  addCachedParty({ id, name: trimmed, type, location_id: locationId, phone: extra.phone || null, bank_name: extra.bankName || null, bank_account: extra.bankAccount || null });
  enqueue({ type: "createParty", payload: { id, name: trimmed, type, locationId, phone: extra.phone, bankName: extra.bankName, bankAccount: extra.bankAccount } });
  trySync();
  return id;
}

// Same idea for the paddy/product type field.
export async function resolveProductIdOffline(typedName) {
  const trimmed = (typedName || "").trim();
  if (!trimmed) return null;

  const cachedMatch = getCachedProducts().find((p) => (p.name || "").trim().toLowerCase() === trimmed.toLowerCase());
  if (cachedMatch) return cachedMatch.id;

  if (navigator.onLine) {
    try {
      const all = await api.getProducts();
      setCachedProducts(all);
      const exact = all.find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
      if (exact) return exact.id;
    } catch {
      // Fall through and create it locally below.
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
export function createTicketOffline({ type, locationId, locationName, partyId, partyName, phone, bankName, bankAccount, carPlate, driverName, productId, productName, userId, paperTicketNo }) {
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
  enqueue({ type: "createTicket", ticketId: id, payload: { id, code, type, locationId, partyId, partyName, phone, bankName, bankAccount, carPlate, driverName, productId, productName, userId, paperTicketNo } });
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
  const { qualityGrade, moisturePct, mixturePct, outthrowPct, deductionKg, pricePerKg, staffFee, taxApplicable, taxRate, priceNote, userId, decline } = opts;
  const updated = patchCachedTicket(id, {
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
  });
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
export function finalizeTicketOffline(ticket, { userId, txDate }) {
  const transactionId = newId();
  const transactionCode = genLocalTxCode(ticket.type);
  const netKg = Math.max(0, (ticket.gross_kg || 0) - (ticket.tare_kg || 0));
  const payableKg = Math.max(0, netKg - (ticket.deduction_kg || 0));
  const staffFeeAmt = ticket.type === "BUY" ? (ticket.staff_fee || 0) : 0;
  const subtotal = Math.max(0, payableKg * (ticket.price_per_kg || 0) - staffFeeAmt);
  const taxAmount = ticket.tax_applicable ? Math.round(subtotal * (ticket.tax_rate || 0)) / 100 : 0;
  const amount = Math.round((subtotal) * 100) / 100;

  patchCachedTicket(ticket.id, { stage: "finalized", transaction_id: transactionId });
  enqueue({ type: "finalizeTicket", ticketId: ticket.id, payload: { userId, txDate, transactionId, transactionCode } });
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
    note: ticket.note,
    tax_applicable: ticket.tax_applicable,
    staff_fee: ticket.staff_fee,
    amount,
    tax_rate: ticket.tax_rate,
    tax_amount: taxAmount,
    total_with_tax: amount + taxAmount,
  };
}
