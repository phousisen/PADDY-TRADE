// Guard for recoverStuckOps — it REBUILDS a transaction from this
// device's local cache and puts it back in the sync queue, so the rules
// that decide what may be rebuilt (and with what date) are tested rather
// than trusted. npm is blocked here, so the logic below mirrors
// src/offlineQueue.js and the source is then asserted to still contain it.
import { readFileSync } from "fs";
const src = readFileSync("src/offlineQueue.js", "utf8");

const STUCK_THRESHOLD = 3;

function dependsOnTransactionId(op) {
  if (op.type === "createTransaction" || op.type === "finalizeTicket") return null;
  return (
    op.payload?.transactionId ||
    (op.payload?.tableName === "transactions" ? op.payload?.recordId : null) ||
    null
  );
}

function cachedTxToCreateOpPayload(tx) {
  if (!tx || !tx.id || !tx.type || !tx.location_id || !tx.party_id) return null;
  if (tx.quantity_kg == null) return null;
  return {
    id: tx.id, code: tx.code || null, type: tx.type,
    locationId: tx.location_id, partyId: tx.party_id, productId: tx.product_id || null,
    quantityKg: Number(tx.quantity_kg) || 0, pricePerKg: Number(tx.price_per_kg) || 0,
    paymentStatus: tx.payment_status || "unpaid", userId: tx.created_by || null,
    txDate: tx.tx_date || null, txTime: tx.tx_time || null,
    deductionKg: Number(tx.deduction_kg) || 0, staffFee: Number(tx.staff_fee) || 0,
  };
}

const GOOD_TX = {
  id: "TX1", code: "RCP-223816-A", type: "BUY", location_id: "LOC", party_id: "P1",
  product_id: "PR1", quantity_kg: 24560, price_per_kg: 1150, payment_status: "paid",
  created_by: "U1", tx_date: "2026-09-11", tx_time: "18:42:07", deduction_kg: 40, staff_fee: 0,
};

function makeWorld({ cache = [GOOD_TX], queue: q0 } = {}) {
  let queue = q0 || [
    { _id: "pay1", type: "createPayment", payload: { id: "PY1", transactionId: "TX1", amount: 28244000 } },
    { _id: "pay2", type: "createPayment", payload: { id: "PY2", transactionId: "TX2", amount: 100 } },
    { _id: "aud1", type: "logAudit", payload: { tableName: "transactions", recordId: "TX1" } },
  ];
  const stuckOps = new Map([
    ["pay1", { attempts: 6, error: 'violates foreign key constraint "payments_transaction_id_fkey"' }],
    ["pay2", { attempts: 5, error: "payments_transaction_id_fkey" }],
    ["aud1", { attempts: 1, error: "slow" }], // not stuck yet
  ]);
  const pendingTransactionIds = () => {
    const ids = new Set();
    for (const op of queue) {
      if (op.type === "createTransaction" && op.payload?.id) ids.add(op.payload.id);
      if (op.type === "finalizeTicket" && op.payload?.transactionId) ids.add(op.payload.transactionId);
    }
    return ids;
  };
  const listStuckOps = () => {
    const byId = new Map(queue.map((o) => [o._id, o]));
    const queuedTxIds = pendingTransactionIds();
    const txById = new Map(cache.map((t) => [t.id, t]));
    const out = [];
    for (const [opId, e] of stuckOps) {
      if (e.attempts < STUCK_THRESHOLD) continue;
      const op = byId.get(opId);
      if (!op) continue;
      const needsTx = dependsOnTransactionId(op);
      const cachedTx = needsTx && !queuedTxIds.has(needsTx) ? txById.get(needsTx) : null;
      const canRebuild = !!(cachedTx && cachedTxToCreateOpPayload(cachedTx));
      out.push({ opId, recoverTxId: canRebuild ? needsTx : null });
    }
    return out;
  };
  const recoverStuckOps = (opIds, { storageFails = false } = {}) => {
    const byOpId = new Map(listStuckOps().map((x) => [x.opId, x]));
    const txById = new Map(cache.map((t) => [t.id, t]));
    const done = new Set();
    let rebuilt = 0, retried = 0;
    for (const opId of opIds || []) {
      const entry = byOpId.get(opId);
      if (!entry || !entry.recoverTxId) continue;
      const txId = entry.recoverTxId;
      if (!done.has(txId)) {
        const payload = cachedTxToCreateOpPayload(txById.get(txId));
        if (!payload) continue;
        if (storageFails) continue; // enqueue returned persisted:false
        queue.push({ _id: "new" + txId, type: "createTransaction", payload });
        done.add(txId);
        rebuilt++;
      }
      stuckOps.delete(opId);
      retried++;
    }
    return { rebuilt, retried };
  };
  return { listStuckOps, recoverStuckOps, get queue() { return queue; }, stuckOps };
}

let failed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL  ${name}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
    failed++;
  }
};

// 1. The Ping Pong case: a stuck payment whose transaction this device still has.
let w = makeWorld();
eq("the payment whose transaction is cached is recoverable",
   w.listStuckOps().map((x) => [x.opId, x.recoverTxId]), [["pay1", "TX1"], ["pay2", null]]);

// 2. Recovering re-queues the transaction under its ORIGINAL id.
w = makeWorld();
eq("recover reports one rebuild, one retry", w.recoverStuckOps(["pay1"]), { rebuilt: 1, retried: 1 });
const added = w.queue.find((o) => o.type === "createTransaction");
eq("the rebuilt transaction keeps the id the payment points at", added.payload.id, "TX1");
eq("nothing was removed from the queue", w.queue.filter((o) => o.type !== "createTransaction").length, 3);
eq("the stuck tracking for that payment is cleared", w.stuckOps.has("pay1"), false);

// 3. THE STANDING RULE: recovery must never move a transaction to today.
eq("the weigh-in date is carried across exactly", added.payload.txDate, "2026-09-11");
eq("the time is carried across too", added.payload.txTime, "18:42:07");
eq("weight is carried across", added.payload.quantityKg, 24560);
eq("price is carried across", added.payload.pricePerKg, 1150);
eq("the deduction is carried across", added.payload.deductionKg, 40);

// 4. Nothing cached to rebuild from → not offered, and recover does nothing.
w = makeWorld();
eq("a payment with no cached transaction cannot be recovered", w.recoverStuckOps(["pay2"]), { rebuilt: 0, retried: 0 });
eq("and nothing was queued for it", w.queue.filter((o) => o.type === "createTransaction").length, 0);

// 5. A transaction still in the queue is not missing — no rebuild offered.
w = makeWorld({
  queue: [
    { _id: "pay1", type: "createPayment", payload: { transactionId: "TX1" } },
    { _id: "pay2", type: "createPayment", payload: { transactionId: "TX2" } },
    { _id: "aud1", type: "logAudit", payload: { tableName: "transactions", recordId: "TX1" } },
    { _id: "tx1", type: "createTransaction", payload: { id: "TX1" } },
  ],
});
eq("a transaction already waiting in the queue is never rebuilt",
   w.listStuckOps().map((x) => x.recoverTxId), [null, null]);

// 6. An incomplete cache entry is refused rather than turned into a bogus row.
for (const [label, bad] of [
  ["no party", { ...GOOD_TX, party_id: null }],
  ["no station", { ...GOOD_TX, location_id: null }],
  ["no weight", { ...GOOD_TX, quantity_kg: null }],
  ["no type", { ...GOOD_TX, type: null }],
]) {
  const w2 = makeWorld({ cache: [bad] });
  eq(`a cached row with ${label} is not offered for rebuild`,
     w2.listStuckOps().find((x) => x.opId === "pay1").recoverTxId, null);
}
// A zero price is legitimate (price set later) and must NOT block recovery.
eq("a zero price still rebuilds",
   makeWorld({ cache: [{ ...GOOD_TX, price_per_kg: 0 }] }).listStuckOps()[0].recoverTxId, "TX1");

// 7. Two payments on the SAME transaction rebuild it once, release both.
w = makeWorld({
  queue: [
    { _id: "pay1", type: "createPayment", payload: { transactionId: "TX1" } },
    { _id: "pay2", type: "createPayment", payload: { transactionId: "TX1" } },
    { _id: "aud1", type: "logAudit", payload: { tableName: "transactions", recordId: "TX1" } },
  ],
});
eq("one rebuild covers both payments", w.recoverStuckOps(["pay1", "pay2"]), { rebuilt: 1, retried: 2 });
eq("exactly one transaction was queued", w.queue.filter((o) => o.type === "createTransaction").length, 1);

// 8. An op that is not yet stuck can never be recovered, even if named.
w = makeWorld();
eq("a not-yet-stuck op is refused", w.recoverStuckOps(["aud1"]), { rebuilt: 0, retried: 0 });
eq("an unknown id is refused", w.recoverStuckOps(["nope"]), { rebuilt: 0, retried: 0 });
eq("empty input does nothing", w.recoverStuckOps([]), { rebuilt: 0, retried: 0 });
eq("null input does nothing", w.recoverStuckOps(null), { rebuilt: 0, retried: 0 });

// 9. If the device cannot write its queue, nothing is reported as recovered.
w = makeWorld();
eq("a failed queue write recovers nothing", w.recoverStuckOps(["pay1"], { storageFails: true }), { rebuilt: 0, retried: 0 });
eq("and the payment stays tracked as stuck", w.stuckOps.has("pay1"), true);

// The source must still contain the rules tested above.
for (const needle of [
  "export function recoverStuckOps",
  "function cachedTxToCreateOpPayload",
  "function dependsOnTransactionId",
  "txDate: tx.tx_date || null",
  "txTime: tx.tx_time || null",
  "const queuedTxIds = pendingTransactionIds()",
  "if (!persisted) continue",
  "recoverTxId: canRebuild ? needsTx : null",
]) {
  if (!src.includes(needle)) { console.error(`FAIL  offlineQueue.js missing: ${needle}`); failed++; }
}
// Recover must be reachable from the banner.
const top = readFileSync("src/components/Topbar.jsx", "utf8");
for (const needle of ["recoverStuckOps", "sync_recover_btn", "x.recoverTxId"]) {
  if (!top.includes(needle)) { console.error(`FAIL  Topbar.jsx missing: ${needle}`); failed++; }
}
// Both languages must carry every new key.
const i18n = readFileSync("src/i18n.jsx", "utf8");
for (const key of ["sync_recover_badge", "sync_recover_hint", "sync_recover_btn", "sync_recover_done", "sync_recover_only_after"]) {
  const n = (i18n.match(new RegExp(`\\b${key}:`, "g")) || []).length;
  if (n !== 2) { console.error(`FAIL  i18n key ${key} appears ${n} time(s), expected 2 (en + km)`); failed++; }
}

if (failed) { console.error(`\n${failed} recover check(s) FAILED.`); process.exit(1); }
console.log("Checked 26 recover cases — a missing transaction is rebuilt from this device's own copy, with its original id, date and time.");
