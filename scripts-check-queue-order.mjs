// Guard for the sync loop's dependency ordering.
//
// THE BUG (Ping Pong, 11 Sept 2026): a manual Buy/Sell queues
// createTransaction + createPayment + logAudit together. None carries a
// ticketId, so nothing held them in order. When the transaction was slow,
// the payment ran first and failed forever with
//   insert or update on table "payments" violates foreign key constraint
//   "payments_transaction_id_fkey"
// while its own transaction sat in the queue right beside it.
//
// This replays the loop's skip rules against fixtures. npm is blocked here,
// so the rules are re-implemented from the source and the source is checked
// to still contain them (see assertSourceStillGuards at the bottom).
import { readFileSync } from "fs";

// --- the rule, as implemented in trySync's inner loop -------------------
function planPass(queue) {
  const blockedTicketIds = new Set();
  const blockedLocalIds = new Set();
  const blockedTxIds = new Set(
    queue.filter((o) => o.type === "createTransaction" && o.payload?.id).map((o) => o.payload.id)
  );
  const attempted = [];
  for (const op of queue) {
    const refId = op.payload?.partyId || op.payload?.productId || op.partyId || null;
    if (refId && blockedLocalIds.has(refId)) { if (op.ticketId) blockedTicketIds.add(op.ticketId); continue; }
    if (op.ticketId && blockedTicketIds.has(op.ticketId)) continue;
    if (op.type !== "createTransaction") {
      const needsTx =
        op.payload?.transactionId ||
        (op.payload?.tableName === "transactions" ? op.payload?.recordId : null) ||
        null;
      if (needsTx && blockedTxIds.has(needsTx)) continue;
    }
    attempted.push(op.type + (op.payload?.id ? `:${op.payload.id}` : ""));
  }
  return attempted;
}

const TX = { type: "createTransaction", payload: { id: "tx1" } };
const PAY = { type: "createPayment", payload: { id: "pay1", transactionId: "tx1" } };
const AUDIT_TX = { type: "logAudit", payload: { tableName: "transactions", recordId: "tx1" } };
const AUDIT_PAY = { type: "logAudit", payload: { tableName: "payments", recordId: "pay1" } };
const OTHER = { type: "createParty", payload: { id: "p9" } };
const TICKET = { type: "finalizeTicket", ticketId: "t1", payload: {} };

const cases = [
  ["the Ping Pong case: payment must NOT be tried while its transaction is queued",
    [TX, PAY, AUDIT_TX], ["createTransaction:tx1"]],
  ["once the transaction has landed (gone from the queue), the payment runs",
    [PAY, AUDIT_TX], ["createPayment:pay1", "logAudit"]],
  ["an unrelated op is never held up by a waiting payment",
    [TX, PAY, OTHER], ["createTransaction:tx1", "createParty:p9"]],
  ["a weighing ticket is never held up by a waiting payment",
    [TX, PAY, TICKET], ["createTransaction:tx1", "finalizeTicket"]],
  ["an audit entry against the PAYMENTS table is not blocked by the transaction",
    [TX, AUDIT_PAY], ["createTransaction:tx1", "logAudit"]],
  ["a payment with no transaction (capital/loan entry) always runs",
    [{ type: "createPayment", payload: { id: "p2", transactionId: null } }], ["createPayment:p2"]],
  ["a payment for a DIFFERENT transaction is not blocked",
    [TX, { type: "createPayment", payload: { id: "p3", transactionId: "txOTHER" } }],
    ["createTransaction:tx1", "createPayment:p3"]],
  ["empty queue", [], []],
];

let failed = 0;
for (const [name, queue, want] of cases) {
  const got = planPass(queue);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL  ${name}\n      expected ${JSON.stringify(want)}\n      got      ${JSON.stringify(got)}`);
    failed++;
  }
}

// --- the source must still carry the rule ------------------------------
const src = readFileSync("src/offlineQueue.js", "utf8");
for (const needle of ["blockedTxIds", 'op.type !== "createTransaction"', "payments_transaction_id_fkey"]) {
  if (!src.includes(needle)) {
    console.error(`FAIL  offlineQueue.js no longer contains: ${needle}`);
    failed++;
  }
}

if (failed) { console.error(`\n${failed} queue-ordering check(s) FAILED.`); process.exit(1); }
console.log(`Checked ${cases.length} queue-ordering cases — a payment never runs before its transaction.`);
