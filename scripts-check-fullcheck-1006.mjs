// [2026-10-06] Guards for daily-check fixes #32, #33, #34, #35, #37, #27.
// Run: node scripts-check-fullcheck-1006.mjs   (exit 1 on any failure)
import { readFileSync } from "node:fs";
const SRC = process.argv[2] || "./src";
const { computeStatements } = await import(SRC + "/statements.js");
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok    " : "  FAIL  ") + m); if (!c) fails++; };
const read = (f) => readFileSync(SRC + "/" + f, "utf8");

console.log("#32 Buy/Sell form keeps the cursor");
const tf = read("pages/TransactionForm.jsx");
const tfBody = tf.slice(tf.indexOf("export default function TransactionForm"), tf.indexOf("\nfunction Step("));
ok(!/const Step\s*=/.test(tf) && /\nfunction Step\(/.test(tf) && !/function Step\(/.test(tfBody),
  "Step is made once, outside the form (not on every key)");

console.log("#33 one weight box empty");
ok(/oneWeightMissing \? 0 :/.test(tf), "net weight is 0 while one box is empty");
ok(/if \(oneWeightMissing\) \{ setError/.test(tf), "Save refuses with one box empty");

console.log("#34 Send back keeps the payment");
const oq = read("offlineQueue.js");
const drop = oq.slice(oq.indexOf("function dropOpsForGoneTransaction"), oq.indexOf("function dropOpsForGoneTransaction") + 3000);
ok(/writeJSON\(PAYMENT_CACHE_KEY, keptPays\)/.test(drop), "the cached copy of a dropped payment goes too");

console.log("#35 farmers with the same name");
const rp = oq.slice(oq.indexOf("export async function resolvePartyIdOffline"), oq.indexOf("export async function resolvePartyIdOffline") + 3000);
ok(/pickSamePerson/.test(rp) && /digits\(p\.phone\) === typedPhone/.test(rp), "a typed phone decides who the farmer is");
const wt = read("pages/WeighingTickets.jsx");
ok(/clearNameFill\(key\)/.test(wt), "New Ticket takes back the phone and bank when the name changes");
ok(/function unpickParty\(\)/.test(tf) && /setPartyPhone\(e\.target\.value\); unpickParty\(\)/.test(tf), "manual form drops the picked farmer's bank when phone changes");

console.log("#27 second PC finishing the same truck");
const api = read("api.js");
const t2 = api.slice(api.indexOf("if (id && transactionId && amount != null)"), api.indexOf("return insertOrFetchExisting(\"payments\", row);"));
ok(!/gte\("created_at"/.test(t2) && !/eq\("amount"/.test(t2), "any earlier payment of the same kind on the load counts, at any time");

console.log("#37 cash with an overpaid load");
const st = [{ id: "pp", name: "Ping Pong" }];
const txs = [{ id: "b1", location_id: "pp", tx_date: "2026-10-01", type: "BUY", quantity_kg: 1000, amount: 1000000, hq_status: "processing", status: "confirmed" },
             { id: "s1", location_id: "pp", tx_date: "2026-10-02", type: "SELL", quantity_kg: 1000, amount: 1200000, hq_status: "processing", status: "confirmed" }];
const run = (buyPaid, sellPaid) => computeStatements({ stations: st, asAtTxs: txs, adjustments: [], partners: [], capitalEntries: [], loanEntries: [],
  payments: [{ id: "p1", transaction_id: "b1", location_id: "pp", type: "pay_supplier", amount: buyPaid, pay_date: "2026-10-01" },
             { id: "p2", transaction_id: "s1", location_id: "pp", type: "receive_customer", amount: sellPaid, pay_date: "2026-10-02" }],
  startDate: "2026-10-01", endDate: "2026-10-31" });
const exact = run(1000000, 1200000), over = run(1100000, 1250000);
const cashMoved = (s) => s.balance.cashMovement;
console.log(`        exact payments: cash moved ${cashMoved(exact).toLocaleString("en-US")} ៛`);
console.log(`        farmer overpaid 100,000 and buyer overpaid 50,000: cash moved ${cashMoved(over).toLocaleString("en-US")} ៛`);
ok(Math.abs(cashMoved(over) - (cashMoved(exact) - 100000 + 50000)) < 1, "cash counts every riel that moved");
ok(Math.abs((over.cashflow.collected - over.cashflow.paidOut) - cashMoved(over)) < 1, "Cash Flow lines add up to the same cash");
ok(over.balance.overpaidToFarmers === 100000 && over.balance.overpaidByBuyers === 50000, "the extra shows as 'to get back' / 'to give back'");
ok(Math.abs((over.balance.unreconciled ?? 0) - (exact.balance.unreconciled ?? 0)) < 1 || (over.balance.unreconciled === null && exact.balance.unreconciled === null),
   "the Balance Sheet still balances exactly as before");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
