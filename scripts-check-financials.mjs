// Proves the six defects fixed in src/financials.js on 2026-09-14 stay fixed.
//
// Each block below REPRODUCES the old wrong answer first, then asserts the new
// one — so if someone ever reverts the logic, the check says exactly which of
// the six came back and what it does to the numbers.
//
// Run: node scripts-check-financials.mjs

import { computeFinancials, paidStatusMap } from "./src/financials.js";

let failures = 0;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
function ok(cond, msg, extra) {
  if (!cond) { failures++; console.log("  FAIL " + msg, extra === undefined ? "" : extra); }
}
const money = (n) => Math.round(n).toLocaleString("en-US");

const LOC = "rk";
const stations = [{ id: LOC, name: "Reang Kesey", current_stock_kg: 0 }];
const tx = (o) => ({ location_id: LOC, hq_status: "processing", status: "confirmed", ...o });

// ---------------------------------------------------------------------------
// A small, hand-checkable history:
//   Jul  buy 10,000 kg @ 800  = 8,000,000   (unpaid — a July debt)
//   Aug  buy 10,000 kg @ 900  = 9,000,000   (paid)
//   Sep  sell 15,000 kg @ 950 = 14,250,000  (paid)
// The shed then holds 5,000 kg, bought at a mix of 800 and 900 → 850 each.
// ---------------------------------------------------------------------------
const asAtTxs = [
  tx({ id: "b1", tx_date: "2026-07-10", type: "BUY",  quantity_kg: 10000, amount: 8000000,  car_plate: "Truck: A" }),
  tx({ id: "b2", tx_date: "2026-08-10", type: "BUY",  quantity_kg: 10000, amount: 9000000,  car_plate: "Truck: B" }),
  tx({ id: "s1", tx_date: "2026-09-10", type: "SELL", quantity_kg: 15000, amount: 14250000, car_plate: "Truck: C" }),
];
const payments = [
  { id: "p1", transaction_id: "b2", location_id: LOC, type: "payment", amount: 9000000,  pay_date: "2026-08-11" },
  { id: "p2", transaction_id: "s1", location_id: LOC, type: "payment", amount: 14250000, pay_date: "2026-09-11" },
  { id: "e1", location_id: LOC, type: "expense", category: "Staff", amount: 500000, pay_date: "2026-09-30" },
];
const SEP = { startDate: "2026-09-01", endDate: "2026-09-30" };
const f = computeFinancials({ asAtTxs, payments, adjustments: [], stations, ...SEP });

console.log("September, on a history that starts in July\n");

// --- FIX 1 — gross profit is sales less the COST OF WHAT SOLD ---------------
// The shed held 20,000 kg costing 17,000,000 → 850/kg. Selling 15,000 kg costs
// 12,750,000. The OLD code did sales − purchases = 14,250,000 − 0 = 14,250,000,
// because nothing was bought in September at all.
const oldGross = 14250000 - 0;
ok(near(f.costOfGoodsSold, 15000 * 850), "cost of goods sold is wrong", f.costOfGoodsSold);
ok(near(f.grossProfit, 14250000 - 12750000), "gross profit is not sales less cost of goods sold", f.grossProfit);
ok(f.grossProfit < oldGross, "gross profit did not change — the cash-margin bug is back");
console.log(`  1. gross profit   ${money(f.grossProfit)}   (the old code said ${money(oldGross)})`);

// --- FIX 2 — inventory at running average, never zero -----------------------
// OLD: all-time stock kg × the PERIOD's average buy price. Nothing was bought
// in September, so that average was 0 and the shed was worth nothing.
ok(near(f.inventoryKg, 5000), "inventory kg wrong", f.inventoryKg);
ok(near(f.inventoryValue, 5000 * 850), "inventory is not at weighted average cost", f.inventoryValue);
ok(near(f.inventoryCostPerKg, 850, 0.01), "cost per kg wrong", f.inventoryCostPerKg);
ok(f.inventoryValue > 0, "inventory valued at zero — the period-average bug is back");
console.log(`  2. inventory      ${money(f.inventoryValue)} = 5,000 kg @ 850.00   (the old code said 0)`);

// --- FIX 3 — a July debt still shows on a September report ------------------
ok(near(f.accountsPayable, 8000000),
   "the July purchase left payables — period-scoped balances are back", f.accountsPayable);
console.log(`  3. payables       ${money(f.accountsPayable)}   (July's unpaid purchase, correctly still owed)`);

// --- FIX 4 — cash may be negative ------------------------------------------
const drained = computeFinancials({
  asAtTxs: [tx({ id: "b9", tx_date: "2026-09-02", type: "BUY", quantity_kg: 10000, amount: 9000000, car_plate: "Truck: D" })],
  payments: [{ id: "p9", transaction_id: "b9", location_id: LOC, type: "payment", amount: 9000000, pay_date: "2026-09-02" }],
  adjustments: [], stations, ...SEP,
});
ok(drained.cashEstimate < 0, "cash was floored at zero again", drained.cashEstimate);
ok(near(drained.cashEstimate, -9000000), "cash figure wrong", drained.cashEstimate);
console.log(`  4. cash           ${money(drained.cashEstimate)} on a buying-only month   (the old code said 0)`);

// --- FIX 5 — retained earnings is earned, not plugged ----------------------
// Accumulated profit since the beginning: 14,250,000 − 12,750,000 − 500,000.
ok(near(f.retainedEarnings, 14250000 - 12750000 - 500000),
   "retained earnings is not accumulated profit", f.retainedEarnings);
const plug = f.totalAssets - f.totalLiabilities - f.partnerCapital;
ok(!near(f.retainedEarnings, plug, 0.5) || near(f.unreconciled, 0, 0.5),
   "retained earnings still looks like the balancing plug");
console.log(`  5. retained       ${money(f.retainedEarnings)}   (earned, not the figure needed to balance)`);

// --- FIX 6 — a counted shortage is a real cost -----------------------------
const withLoss = computeFinancials({
  asAtTxs, payments, stations, ...SEP,
  adjustments: [{ location_id: LOC, created_at: "2026-09-20T16:00:00+07:00", adjustment_kg: -1000 }],
});
ok(withLoss.stockLossValue < 0, "a counted shortage did not reach the profit", withLoss.stockLossValue);
ok(near(withLoss.netProfit, withLoss.grossProfit - withLoss.totalExpenses + withLoss.stockLossValue),
   "net profit does not carry the stock loss");
ok(withLoss.netProfit < f.netProfit, "losing 1,000 kg did not reduce profit");
console.log(`  6. stock loss     ${money(withLoss.stockLossValue)} taken to profit   (the old code ignored it)`);

// A found surplus is NOT income — paddy is not sold by being found.
const withGain = computeFinancials({
  asAtTxs, payments, stations, ...SEP,
  adjustments: [{ location_id: LOC, created_at: "2026-09-20T16:00:00+07:00", adjustment_kg: 1000 }],
});
ok(withGain.stockLossValue === 0, "a counted surplus was taken as income", withGain.stockLossValue);

// --- the sheet accounts for itself -----------------------------------------
// Nothing is plugged, so the two sides can differ — and the gap must be
// exactly what is unexplained, never hidden.
ok(near(f.totalAssets, f.totalLiabilities + f.equity + f.unreconciled),
   "assets do not equal liabilities + equity + the unreconciled gap");
ok(near(f.equity, f.partnerCapital + f.retainedEarnings), "equity is not capital plus retained earnings");
console.log(`\n  assets ${money(f.totalAssets)} = liabilities ${money(f.totalLiabilities)} + equity ${money(f.equity)} + unexplained ${money(f.unreconciled)}`);

// --- scope: another station's rows never leak ------------------------------
const withNoise = computeFinancials({
  asAtTxs: [...asAtTxs,
    tx({ id: "x1", location_id: "other", tx_date: "2026-09-05", type: "SELL", quantity_kg: 99999, amount: 999999999, car_plate: "Truck: Z" }),
    { ...tx({ id: "x2", tx_date: "2026-09-06", type: "SELL", quantity_kg: 88888, amount: 888888888, car_plate: "Truck: Y" }), hq_status: "cancelled" },
  ],
  payments, adjustments: [], stations, ...SEP,
});
for (const k of ["totalSell", "grossProfit", "accountsReceivable", "inventoryValue", "retainedEarnings"]) {
  ok(near(withNoise[k], f[k], 1), `another station or a cancelled sale leaked into ${k}`, `${withNoise[k]} vs ${f[k]}`);
}
console.log("  another station's rows and cancelled sales stay out");

// --- period vs as-at: the P&L moves with the period, the sheet does not -----
const aug = computeFinancials({ asAtTxs, payments, adjustments: [], stations, startDate: "2026-08-01", endDate: "2026-08-31" });
ok(aug.totalSell === 0, "August should have no sales", aug.totalSell);
ok(near(aug.accountsPayable, 8000000), "August still owes July's purchase", aug.accountsPayable);
ok(near(aug.inventoryKg, 20000), "August's shed holds both purchases", aug.inventoryKg);
console.log("  period figures move with the period; balances are as at its end");

// --- paidStatusMap is unchanged behaviour ----------------------------------
const m = paidStatusMap(asAtTxs, payments);
ok(near(m.b1.remaining, 8000000), "unpaid purchase not reported as owing");
ok(near(m.b2.remaining, 0), "paid purchase still reported as owing");
ok(near(m.s1.paid, 14250000), "collected sale not reported as paid");


// --- consolidation is addition, in THIS module too ---------------------------
// [2026-09-14] financials.js pooled every station into one weighted-average
// shed, so Reports → Overview charged one station's sales partly at another
// station's cost, and disagreed with the Balance Sheet the moment more than
// one station was selected. Each station is now pooled on its own and added.
{
  const A = "a", B = "b";
  const st2 = [{ id: A, name: "A" }, { id: B, name: "B" }];
  const t2 = (o) => ({ hq_status: "processing", status: "confirmed", car_plate: "Truck: A", ...o });
  const txs2 = [
    // Two sheds at very different prices, each selling its own paddy.
    t2({ id: "a1", location_id: A, tx_date: "2026-09-01", type: "BUY",  quantity_kg: 10000, amount: 8000000 }),
    t2({ id: "a2", location_id: A, tx_date: "2026-09-05", type: "SELL", quantity_kg: 6000,  amount: 5400000 }),
    t2({ id: "b1", location_id: B, tx_date: "2026-09-02", type: "BUY",  quantity_kg: 10000, amount: 12000000 }),
    t2({ id: "b2", location_id: B, tx_date: "2026-09-06", type: "SELL", quantity_kg: 6000,  amount: 7800000 }),
  ];
  const args = { asAtTxs: txs2, payments: [], adjustments: [], ...SEP };
  const both = computeFinancials({ ...args, stations: st2 });
  const onlyA = computeFinancials({ ...args, stations: [st2[0]] });
  const onlyB = computeFinancials({ ...args, stations: [st2[1]] });

  ok(near(both.costOfGoodsSold, onlyA.costOfGoodsSold + onlyB.costOfGoodsSold),
     "two stations' cost of goods sold is not the two added up — the sheds are being pooled",
     `${both.costOfGoodsSold} vs ${onlyA.costOfGoodsSold + onlyB.costOfGoodsSold}`);
  ok(near(both.inventoryValue, onlyA.inventoryValue + onlyB.inventoryValue),
     "two stations' inventory is not the two added up", both.inventoryValue);
  ok(near(both.grossProfit, onlyA.grossProfit + onlyB.grossProfit),
     "two stations' gross profit is not the two added up", both.grossProfit);
  // The pooled RATE is re-derived, not the average of the two stations' rates.
  ok(near(both.inventoryCostPerKg, both.inventoryValue / both.inventoryKg, 0.01),
     "consolidated cost/kg is not pooled value over pooled kilos", both.inventoryCostPerKg);
  console.log(`  consolidation is addition · cost of goods sold ${money(both.costOfGoodsSold)} = ${money(onlyA.costOfGoodsSold)} + ${money(onlyB.costOfGoodsSold)}`);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
