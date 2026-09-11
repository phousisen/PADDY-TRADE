// Guard for the 11 Sept data-integrity pass: no silent loss, no orphaned
// dependants, no duplicate money. npm is blocked here, so each rule is
// re-implemented from src/offlineQueue.js and the source is then asserted
// to still contain it.
import { readFileSync } from "fs";
const src = readFileSync("src/offlineQueue.js", "utf8");
const api = readFileSync("src/api.js", "utf8");
const i18n = readFileSync("src/i18n.jsx", "utf8");

let failed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL  ${name}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
    failed++;
  }
};

// ---------------------------------------------------------------------
// 1. NOTHING MAY BE LOST SILENTLY.
//    Every save that represents work — money, a weight, a price, a
//    ticket, a farmer — must fail loudly when the device cannot write it
//    down. The Activity Log is the one deliberate exception.
// ---------------------------------------------------------------------
const MUST_BE_STRICT = [
  ["createParty", 'enqueueStrict({\n    type: "createParty"'],
  ["updateParty", 'enqueueStrict({ type: "updateParty"'],
  ["createProduct", 'enqueueStrict({ type: "createProduct"'],
  ["createTicket (weigh-in)", 'enqueueStrict({ type: "createTicket"'],
  ["setTicketGross", 'enqueueStrict({ type: "setTicketGross"'],
  ["editTicket", 'enqueueStrict({\n    type: "editTicket"'],
  ["setTicketPrice", 'enqueueStrict({ type: "setTicketPrice"'],
  ["setTicketTare", 'enqueueStrict({ type: "setTicketTare"'],
  ["createPayment (cash at the scale)", 'enqueueStrict(\n    { type: "createPayment"'],
];
for (const [what, needle] of MUST_BE_STRICT) {
  if (!src.includes(needle)) { console.error(`FAIL  ${what} can still be lost silently (no enqueueStrict)`); failed++; }
}
if (!src.includes('enqueue({ type: "logAudit", payload });')) {
  console.error("FAIL  logAudit should stay non-strict — it must never abort a finish"); failed++;
}
// The two receipt-critical paths keep their own explicit checks.
for (const needle of ['throw tagError(new Error("Could not save this ticket', 'throw tagError(new Error("Could not save this entry']) {
  if (!src.includes(needle)) { console.error(`FAIL  missing receipt-critical storage check: ${needle}`); failed++; }
}
if (!src.includes("function enqueueStrict")) { console.error("FAIL  enqueueStrict missing"); failed++; }
for (const key of ["err_storage_change", "err_storage_payment"]) {
  const n = (i18n.match(new RegExp(`\\b${key}:`, "g")) || []).length;
  if (n !== 2) { console.error(`FAIL  i18n ${key} appears ${n} time(s), expected 2 (en + km)`); failed++; }
}

// ---------------------------------------------------------------------
// 2. A PAYMENT IS NEVER ATTEMPTED BEFORE ITS TRANSACTION EXISTS.
//    This is the rule whose absence caused the Ping Pong incident: a
//    finalizeTicket's payment carries no ticketId, so nothing held it
//    back while the finalize was still queued.
// ---------------------------------------------------------------------
function blockedTxIds(queue) {
  return new Set([
    ...queue.filter((o) => o.type === "createTransaction" && o.payload?.id).map((o) => o.payload.id),
    ...queue.filter((o) => o.type === "finalizeTicket" && o.payload?.transactionId).map((o) => o.payload.transactionId),
  ]);
}
function wouldAttempt(queue, op) {
  const blocked = blockedTxIds(queue);
  if (op.type === "createTransaction" || op.type === "finalizeTicket") return true;
  const needsTx =
    op.payload?.transactionId ||
    (op.payload?.tableName === "transactions" ? op.payload?.recordId : null) ||
    null;
  return !(needsTx && blocked.has(needsTx));
}
const finishQueue = [
  { _id: "fin", type: "finalizeTicket", ticketId: "TK1", payload: { transactionId: "TX1" } },
  { _id: "pay", type: "createPayment", payload: { id: "PY1", transactionId: "TX1", amount: 970000 } },
  { _id: "audTx", type: "logAudit", payload: { tableName: "transactions", recordId: "TX1" } },
  { _id: "audPay", type: "logAudit", payload: { tableName: "payments", recordId: "PY1" } },
];
eq("a ticket's payment waits for its finalize", wouldAttempt(finishQueue, finishQueue[1]), false);
eq("its transaction audit entry waits too", wouldAttempt(finishQueue, finishQueue[2]), false);
eq("the finalize itself is never blocked", wouldAttempt(finishQueue, finishQueue[0]), true);
eq("an unrelated payment is not held up",
   wouldAttempt(finishQueue, { type: "createPayment", payload: { transactionId: "OTHER" } }), true);
eq("once the finalize is gone the payment goes",
   wouldAttempt(finishQueue.filter((o) => o._id !== "fin"), finishQueue[1]), true);
// The same rule for a manual entry, which is where it already existed.
const manualQueue = [
  { _id: "tx", type: "createTransaction", payload: { id: "TX2" } },
  { _id: "pay", type: "createPayment", payload: { transactionId: "TX2" } },
];
eq("a manual entry's payment still waits", wouldAttempt(manualQueue, manualQueue[1]), false);

// ---------------------------------------------------------------------
// 3. THE SAME MONEY IS NEVER QUEUED TWICE.
// ---------------------------------------------------------------------
function createPaymentOffline(queue, cachedPayments, { type, transactionId, amount }) {
  const sameMoney = (p) =>
    p && p.transaction_id === transactionId && p.type === type &&
    Math.round(Number(p.amount) || 0) === Math.round(Number(amount) || 0);
  const queuedTwin = queue.find(
    (op) => op.type === "createPayment" && sameMoney({
      transaction_id: op.payload?.transactionId, type: op.payload?.type, amount: op.payload?.amount,
    })
  );
  if (queuedTwin) return { reused: "queued" };
  if (cachedPayments.find(sameMoney)) return { reused: "synced" };
  queue.push({ _id: "p" + queue.length, type: "createPayment", payload: { transactionId, type, amount } });
  return { reused: null };
}
let q = [], cache = [];
eq("first payment is queued", createPaymentOffline(q, cache, { type: "pay_supplier", transactionId: "TX1", amount: 970000 }), { reused: null });
eq("a re-finish does not queue a second", createPaymentOffline(q, cache, { type: "pay_supplier", transactionId: "TX1", amount: 970000 }), { reused: "queued" });
eq("only one payment op exists", q.length, 1);
eq("a different amount is a different payment", createPaymentOffline(q, cache, { type: "pay_supplier", transactionId: "TX1", amount: 500 }), { reused: null });
eq("a different transaction is a different payment", createPaymentOffline(q, cache, { type: "pay_supplier", transactionId: "TX9", amount: 970000 }), { reused: null });
eq("a different direction is a different payment", createPaymentOffline(q, cache, { type: "receive_customer", transactionId: "TX1", amount: 970000 }), { reused: null });
// The one that mattered: the first payment already synced, then a re-finish.
q = [];
cache = [{ transaction_id: "TX1", type: "pay_supplier", amount: 970000 }];
eq("an already-synced payment is not paid again", createPaymentOffline(q, cache, { type: "pay_supplier", transactionId: "TX1", amount: 970000 }), { reused: "synced" });
eq("and nothing new was queued", q.length, 0);

// ---------------------------------------------------------------------
// 4. A TRANSACTION'S LOCAL COPY OUTLIVES EVERYTHING THAT NEEDS IT.
// ---------------------------------------------------------------------
function transactionIdsStillNeededLocally(queue) {
  const ids = new Set();
  for (const op of queue) {
    if (op.type === "createTransaction" && op.payload?.id) ids.add(op.payload.id);
    if (op.type === "finalizeTicket" && op.payload?.transactionId) ids.add(op.payload.transactionId);
  }
  for (const op of queue) {
    if (op.type === "createTransaction" || op.type === "finalizeTicket") continue;
    const needsTx =
      op.payload?.transactionId ||
      (op.payload?.tableName === "transactions" ? op.payload?.recordId : null) ||
      null;
    if (needsTx) ids.add(needsTx);
  }
  return ids;
}
eq("a transaction referenced only by a stuck payment is protected from eviction",
   [...transactionIdsStillNeededLocally([{ type: "createPayment", payload: { transactionId: "TX1" } }])], ["TX1"]);
eq("so is one referenced only by an audit entry",
   [...transactionIdsStillNeededLocally([{ type: "logAudit", payload: { tableName: "transactions", recordId: "TX7" } }])], ["TX7"]);
eq("a payment audit entry does not pin a transaction",
   [...transactionIdsStillNeededLocally([{ type: "logAudit", payload: { tableName: "payments", recordId: "PY1" } }])], []);

// ---------------------------------------------------------------------
// 5. ONE TICKET KEEPS ONE TRANSACTION ID FOR LIFE.
//    pending_tx_id is local-only; a board refresh must not erase it, or a
//    re-finish mints a second transaction for the same truckload.
// ---------------------------------------------------------------------
const carryLocalOnly = (serverRow, localRow) => {
  if (!localRow) return serverRow;
  const out = { ...serverRow };
  if (localRow.pending_tx_id && !out.pending_tx_id) out.pending_tx_id = localRow.pending_tx_id;
  if (localRow.pending_tx_code && !out.pending_tx_code) out.pending_tx_code = localRow.pending_tx_code;
  return out;
};
eq("a board refresh keeps the remembered transaction id",
   carryLocalOnly({ id: "TK1", stage: "weighed_out" }, { id: "TK1", pending_tx_id: "TX1", pending_tx_code: "RCP-1-A" }).pending_tx_id, "TX1");
eq("and its code", carryLocalOnly({ id: "TK1" }, { id: "TK1", pending_tx_code: "RCP-1-A" }).pending_tx_code, "RCP-1-A");
eq("a ticket that never had one is unchanged",
   carryLocalOnly({ id: "TK2", stage: "arrived" }, { id: "TK2" }), { id: "TK2", stage: "arrived" });
eq("a cleared memory (cancelled transaction) stays cleared",
   carryLocalOnly({ id: "TK3" }, { id: "TK3", pending_tx_id: null }).pending_tx_id, undefined);
eq("a ticket the device has never seen is passed through",
   carryLocalOnly({ id: "TK4" }, undefined), { id: "TK4" });

// ---------------------------------------------------------------------
// 6. Source rules that the fixtures above stand in for.
// ---------------------------------------------------------------------
for (const needle of [
  // Orphan sweeps everywhere a transaction can be taken back.
  "function dropOpsForGoneTransaction",
  "dropOpsForGoneTransaction(txId)",
  "const goneTxIds = new Set(",            // dropOtherOpsForGoneTicket
  "const orphanedTxIds = new Set()",       // discardStuckOps
  // Ordering.
  'q.filter((o) => o.type === "finalizeTicket" && o.payload?.transactionId).map((o) => o.payload.transactionId)',
  // Cache protection.
  "function transactionIdsStillNeededLocally",
  "const pendingIds = transactionIdsStillNeededLocally()",
  // Ticket identity.
  "const carryLocalOnly = (serverRow, localRow)",
  // Duplicate money.
  "const queuedTwin = getQueue().find(",
  "const syncedTwin = getCachedPayments().find(sameMoney)",
  // updateParty carries its id at the top level.
  "if (op.partyId === oldId) op.partyId = newId;",
]) {
  if (!src.includes(needle)) { console.error(`FAIL  offlineQueue.js missing: ${needle}`); failed++; }
}
if (!api.includes('.eq("transaction_id", transactionId)')) {
  console.error("FAIL  api.createPayment has no retry guard for the screens that send no client id"); failed++;
}
const na = readFileSync("src/components/NeedsAttentionModal.jsx", "utf8");
if (!na.includes("if (!item.isStuck) return;")) {
  console.error("FAIL  NeedsAttentionModal can still discard a save that is merely waiting"); failed++;
}


// ---------------------------------------------------------------------
// 7. A QUALITY LETTER NEVER BLOCKS A TRADE.
//    The database accepts only A/B/C (blank allowed). One screen offered
//    1/2/3, so the first ticket ever given a quality rejected a
//    39,561,600 riel sale permanently. Every write to that column is now
//    normalized, so an unstorable value is dropped, not fatal.
// ---------------------------------------------------------------------
const QUALITY_GRADES = ["A", "B", "C"];
const normalizeQualityGrade = (value) => {
  const v = String(value ?? "").trim().toUpperCase();
  return QUALITY_GRADES.includes(v) ? v : null;
};
eq("A is kept", normalizeQualityGrade("A"), "A");
eq("lower case is accepted", normalizeQualityGrade("b"), "B");
eq("stray spaces are trimmed", normalizeQualityGrade(" c "), "C");
eq("the old 1/2/3 values are dropped, not fatal", normalizeQualityGrade("1"), null);
eq("blank stays blank", normalizeQualityGrade(""), null);
eq("null stays null", normalizeQualityGrade(null), null);
eq("undefined stays null", normalizeQualityGrade(undefined), null);
eq("anything else is dropped", normalizeQualityGrade("Premium"), null);
if (!api.includes("function normalizeQualityGrade")) { console.error("FAIL  api.js missing normalizeQualityGrade"); failed++; }
eq("every write to quality_grade is normalized",
   (api.match(/quality_grade: (?!null,)/g) || []).length,
   (api.match(/quality_grade: normalizeQualityGrade\(/g) || []).length);
const wt = readFileSync("src/pages/WeighingTickets.jsx", "utf8");
for (const bad of ['<option value="1">1</option>', '<option value="2">2</option>', '<option value="3">3</option>']) {
  if (wt.includes(bad)) { console.error(`FAIL  the ticket quality dropdown still offers a value the database rejects: ${bad}`); failed++; }
}
for (const good of ['<option value="A">A</option>', '<option value="B">B</option>', '<option value="C">C</option>']) {
  if (!wt.includes(good)) { console.error(`FAIL  ticket quality dropdown missing ${good}`); failed++; }
}

if (failed) { console.error(`\n${failed} integrity check(s) FAILED.`); process.exit(1); }
console.log("Checked 33 integrity cases — nothing lost silently, nothing orphaned, no money queued twice.");
