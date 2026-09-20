// Guards src/statements.js — the five financial statements.
//
// [2026-09-14] These are the numbers the accountant signs and the partners are
// paid on, so the rules they must obey are written down here as assertions
// rather than trusted to survive the next edit.
//
// The two that matter most, because breaking either produces a report that
// looks perfectly reasonable and is wrong:
//   1. Consolidating three stations equals the three computed separately and
//      added — with the deliberate exception of RATES, which are re-derived.
//   2. A figure nobody has entered stays null all the way up. The moment a
//      null quietly becomes a 0, the statement claims something nobody said.
//
// Run: node scripts-check-statements.mjs

import { computeStatements, classifyExpense, depreciationFor, accumulatedDepreciation, addKnown } from "./src/statements.js";

let failures = 0;
const near = (a, b, tol = 1) => a !== null && b !== null && Math.abs(a - b) <= tol;
function ok(cond, msg, extra) {
  if (!cond) { failures++; console.log("  FAIL " + msg, extra === undefined ? "" : extra); }
}
const money = (n) => (n === null ? "not entered" : Math.round(n).toLocaleString("en-US"));

// ---------------------------------------------------------------------------
// Three stations, deliberately different from each other
// ---------------------------------------------------------------------------
const ST = [
  { id: "rk", name: "Reang Kesey" },
  { id: "jn", name: "Jomnoum" },
  { id: "pp", name: "Ping Pong" },
];
const tx = (o) => ({ hq_status: "processing", status: "confirmed", car_plate: "Truck: A", ...o });

const TXS = [
  // Reang Kesey: buys at two prices, then ships most of it
  tx({ id: "rk1", location_id: "rk", tx_date: "2026-08-10", type: "BUY",  quantity_kg: 10000, amount: 8000000 }),
  tx({ id: "rk2", location_id: "rk", tx_date: "2026-09-05", type: "BUY",  quantity_kg: 10000, amount: 9000000 }),
  tx({ id: "rk3", location_id: "rk", tx_date: "2026-09-10", type: "SELL", quantity_kg: 15000, amount: 14250000 }),
  // Jomnoum: one buy, one sell, nothing left
  tx({ id: "jn1", location_id: "jn", tx_date: "2026-09-03", type: "BUY",  quantity_kg: 6000,  amount: 5400000 }),
  tx({ id: "jn2", location_id: "jn", tx_date: "2026-09-08", type: "SELL", quantity_kg: 6000,  amount: 5700000 }),
  // Ping Pong: buys only — the shed is full and nothing has shipped
  tx({ id: "pp1", location_id: "pp", tx_date: "2026-09-02", type: "BUY",  quantity_kg: 4000,  amount: 3600000 }),
  // never counted anywhere
  tx({ id: "x1", location_id: "rk", tx_date: "2026-09-06", type: "SELL", quantity_kg: 99999, amount: 999999999, hq_status: "cancelled" }),
];

const PAYS = [
  { id: "p1", transaction_id: "rk2", location_id: "rk", type: "payment", amount: 9000000, pay_date: "2026-09-05" },
  { id: "p2", transaction_id: "rk3", location_id: "rk", type: "payment", amount: 14250000, pay_date: "2026-09-11" },
  { id: "p3", transaction_id: "jn1", location_id: "jn", type: "payment", amount: 5400000, pay_date: "2026-09-03" },
  { id: "p4", transaction_id: "jn2", location_id: "jn", type: "payment", amount: 5700000, pay_date: "2026-09-09" },
  // rk1 (August, 8,000,000) is deliberately never paid — a debt that must
  // still appear on a September balance sheet.
  { id: "e1", location_id: "rk", type: "expense", category: "Staff salary",     amount: 500000, pay_date: "2026-09-30" },
  { id: "e2", location_id: "rk", type: "expense", category: "ចំណាយកូនដៃ",        amount: 300000, pay_date: "2026-09-30" },
  { id: "e3", location_id: "jn", type: "expense", category: "Fuel",             amount: 200000, pay_date: "2026-09-15" },
  { id: "e4", location_id: "pp", type: "expense", category: "Broker commission", amount: 100000, pay_date: "2026-09-20" },
  { id: "oi", location_id: "rk", type: "other_income", amount: 250000, pay_date: "2026-09-12" },
];

const PARTNERS = [
  { id: "a", location_id: "rk", name: "Sisen",  share_pct: 60 },
  { id: "b", location_id: "rk", name: "Neth",   share_pct: 40 },
  // Ping Pong's split does NOT follow the capital — 40/60 against 300/200.
  { id: "c", location_id: "pp", name: "Sisen",  share_pct: 40 },
  { id: "d", location_id: "pp", name: "Sothea", share_pct: 60 },
  // Jomnoum has a partner whose share nobody has entered.
  { id: "e", location_id: "jn", name: "Sisen",  share_pct: null },
];
const CAPITAL = [
  { location_id: "rk", partner_id: "a", type: "contribution", amount: 6000000, entry_date: "2026-07-01" },
  { location_id: "rk", partner_id: "b", type: "contribution", amount: 4000000, entry_date: "2026-07-01" },
  { location_id: "rk", partner_id: "a", type: "drawing",      amount: 1000000, entry_date: "2026-09-20" },
  { location_id: "pp", partner_id: "c", type: "contribution", amount: 3000000, entry_date: "2026-07-01" },
  { location_id: "pp", partner_id: "d", type: "contribution", amount: 2000000, entry_date: "2026-07-01" },
];
const LOANS = [{ location_id: "rk", type: "borrow", amount: 5000000, entry_date: "2026-07-15" }];

const SEP = { startDate: "2026-09-01", endDate: "2026-09-30" };
const base = { asAtTxs: TXS, payments: PAYS, adjustments: [], partners: PARTNERS,
               capitalEntries: CAPITAL, loanEntries: LOANS, ...SEP };

const run = (stations, extra = {}) => computeStatements({ ...base, stations, ...extra });

console.log("Financial statements — three stations, September on a history starting in July\n");

// ===========================================================================
// 1. Nothing entered stays null — never a zero
// ===========================================================================
const rk = run([ST[0]]);
ok(rk.income.depreciation === null, "depreciation became a number with no asset register", rk.income.depreciation);
ok(rk.income.interest === null, "interest became 0 while a loan is outstanding", rk.income.interest);
ok(rk.income.grossProfit === null, "gross profit was computed through an unknown", rk.income.grossProfit);
ok(rk.income.netProfit === null, "net profit was computed through an unknown", rk.income.netProfit);
ok(rk.balance.openingCash === null, "opening cash invented", rk.balance.openingCash);
ok(rk.balance.cash === null, "cash reported as held when only the movement is known", rk.balance.cash);
ok(typeof rk.income.profitBeforeUnknowns === "number",
   "the figure that IS knowable went null too — that hides real information");
console.log(`  1. unknowns stay unknown · profit before them ${money(rk.income.profitBeforeUnknowns)} ៛, gross profit ${money(rk.income.grossProfit)}`);

// addKnown itself
ok(addKnown(1, 2, 3) === 6, "addKnown cannot add");
ok(addKnown(1, null, 3) === null, "addKnown swallowed a null");

// ===========================================================================
// 2. Consolidation is addition
// ===========================================================================
const all = run(ST);
const parts = ST.map((s) => run([s]));
const sum = (f) => parts.reduce((a, p) => a + f(p), 0);

for (const [path, get] of [
  ["income.sales",              (p) => p.income.sales],
  ["income.otherIncome",        (p) => p.income.otherIncome],
  ["income.costOfGoodsSold",    (p) => p.income.costOfGoodsSold],
  ["income.intermediaryFee",    (p) => p.income.intermediaryFee],
  ["income.wages",              (p) => p.income.wages],
  ["income.profitBeforeUnknowns", (p) => p.income.profitBeforeUnknowns],
  ["balance.accountsPayable",   (p) => p.balance.accountsPayable],
  ["balance.accountsReceivable",(p) => p.balance.accountsReceivable],
  ["balance.inventoryValue",    (p) => p.balance.inventoryValue],
  ["balance.inventoryKg",       (p) => p.balance.inventoryKg],
  ["balance.partnerCapital",    (p) => p.balance.partnerCapital],
  ["balance.retainedEarnings",  (p) => p.balance.retainedEarnings],
  ["balance.loansOutstanding",  (p) => p.balance.loansOutstanding],
  ["cashflow.cfOperating",      (p) => p.cashflow.cfOperating],
]) {
  const a = path.split(".").reduce((o, k) => o[k], all);
  ok(near(a, sum(get)), `consolidated ${path} is not the stations added up`, `${a} vs ${sum(get)}`);
}
console.log(`  2. three stations consolidate · sales ${money(all.income.sales)} = ${parts.map((p) => money(p.income.sales)).join(" + ")}`);

// A RATE is re-derived, never averaged. Ping Pong holds 4,000 kg at 900 and
// Reang Kesey 5,000 kg at 850; the pooled rate must sit between them and be
// weighted by the kilos, not the midpoint of the two rates.
const naiveAvg = parts.filter((p) => p.balance.inventoryKg > 0)
  .reduce((a, p, _, arr) => a + p.balance.inventoryCostPerKg / arr.length, 0);
ok(!near(all.balance.inventoryCostPerKg, naiveAvg, 0.5),
   "consolidated cost/kg looks like the average of the stations' rates");
ok(near(all.balance.inventoryCostPerKg,
        all.balance.inventoryValue / all.balance.inventoryKg, 0.01),
   "consolidated cost/kg is not value over kilos");
console.log(`  3. rates re-derived, not averaged · ${all.balance.inventoryCostPerKg.toFixed(2)} ៛/kg (averaging the rates would say ${naiveAvg.toFixed(2)})`);

// ===========================================================================
// 3. The sheet accounts for itself
// ===========================================================================
// The identity is checked on a FULLY CONFIGURED business — opening cash and an
// asset register entered — because that is the only state in which both sides
// are fully known. Half-configured, the sheet must go null rather than balance
// against a figure nobody supplied; that is asserted straight after.
const FULL_ASSETS = [
  { location_id: "rk", cost: 36500000, useful_life_years: 10, in_service_date: "2026-01-01" },
  { location_id: "jn", cost: 18000000, useful_life_years: 10, in_service_date: "2026-01-01" },
  { location_id: "pp", cost: 12000000, useful_life_years: 10, in_service_date: "2026-01-01" },
];
const withCash = run(ST, { assets: FULL_ASSETS, settings: {
  rk: { opening_cash: 20000000 }, jn: { opening_cash: 5000000 }, pp: { opening_cash: 3000000 } } });
ok(withCash.balance.cash !== null, "cash still null after opening balances were entered");
ok(withCash.balance.totalAssets !== null, "total assets still null after the asset register was entered");

// Unconfigured: current assets are still a real number, but the total waits.
ok(typeof all.balance.currentAssets !== "number" || all.balance.currentAssets === null,
   "current assets should be null while opening cash is unknown", all.balance.currentAssets);
const cashOnly = run(ST, { settings: {
  rk: { opening_cash: 20000000 }, jn: { opening_cash: 5000000 }, pp: { opening_cash: 3000000 } } });
ok(typeof cashOnly.balance.currentAssets === "number",
   "current assets should be knowable once opening cash is entered");
ok(cashOnly.balance.totalAssets === null,
   "total assets was reported with no asset register — fixed assets treated as zero", cashOnly.balance.totalAssets);
ok(near(withCash.balance.totalAssets,
        withCash.balance.totalLiabilities + withCash.balance.equity + withCash.balance.unreconciled),
   "assets do not equal liabilities + equity + the unexplained gap");
// [2026-09-19] ...plus the opening balance: the cash the business held when
// the system started belongs to the owners ("opening balance equity").
ok(near(withCash.balance.equity,
        withCash.balance.partnerCapital - withCash.balance.drawings + withCash.balance.retainedEarnings
        + withCash.balance.openingEquity),
   "equity is not capital, less drawings, plus retained earnings, plus the opening balance");
// A drawing must reduce equity ONCE. It was being taken off capital and off
// retained earnings both, so a 1,000,000 drawing moved equity by 2,000,000 —
// a page could show partners drawing nothing and equity falling anyway.
const noDraw = computeStatements({
  ...base, stations: [ST[0]],
  capitalEntries: CAPITAL.filter((e) => e.type === "contribution"),
});
const oneDraw = computeStatements({ ...base, stations: [ST[0]], capitalEntries: CAPITAL });
const drawn = CAPITAL.filter((e) => e.location_id === "rk" && e.type !== "contribution")
  .reduce((s, e) => s + e.amount, 0);
ok(near(noDraw.balance.equity - oneDraw.balance.equity, drawn),
   "a drawing does not move equity by its own amount — counted twice, or not at all",
   `equity fell ${money(noDraw.balance.equity - oneDraw.balance.equity)} for a ${money(drawn)} drawing`);
ok(near(noDraw.balance.retainedEarnings, oneDraw.balance.retainedEarnings),
   "drawings reached retained earnings — they are not an expense and not a loss");
ok(near(oneDraw.balance.partnerCapital, 10000000),
   "partner capital is not the gross contributed", oneDraw.balance.partnerCapital);
ok(near(oneDraw.balance.drawings, drawn), "drawings line wrong", oneDraw.balance.drawings);

// The unexplained gap must BE the opening-cash hole the page says it is:
// put another 1,000,000 of opening cash in and the gap must close by exactly
// that. Without this, "assets = liabilities + equity + unexplained" is just
// the definition of unexplained restated, and proves nothing.
const gapA = run(ST, { assets: FULL_ASSETS, settings: {
  rk: { opening_cash: 20000000 }, jn: { opening_cash: 5000000 }, pp: { opening_cash: 3000000 } } });
const gapB = run(ST, { assets: FULL_ASSETS, settings: {
  rk: { opening_cash: 21000000 }, jn: { opening_cash: 5000000 }, pp: { opening_cash: 3000000 } } });
// [2026-09-19] REVERSED, deliberately. The gap used to grow riel for riel
// with the opening cash entered (an asset with nothing on the other side),
// while the page told the owner that entering it CLOSES the gap. The opening
// balance is now owners' equity, so entering it moves both sides equally and
// the gap is left meaning only "something recorded does not add up".
ok(near(gapB.balance.unreconciled - gapA.balance.unreconciled, 0),
   "entering opening cash changed the unexplained gap — the opening balance must sit in equity",
   `${money(gapB.balance.unreconciled - gapA.balance.unreconciled)}`);
console.log(`  4b. a drawing moves equity once · opening cash is balanced by opening equity`);

// Retained earnings must be EARNED, not the figure that makes it balance.
const plug = withCash.balance.totalAssets - withCash.balance.totalLiabilities - withCash.balance.partnerCapital;
ok(!near(withCash.balance.retainedEarnings, plug, 0.5) || near(withCash.balance.unreconciled, 0, 0.5),
   "retained earnings still looks like the balancing plug");
console.log(`  4. the sheet accounts for itself · assets ${money(withCash.balance.totalAssets)} = liabilities ${money(withCash.balance.totalLiabilities)} + equity ${money(withCash.balance.equity)} + unexplained ${money(withCash.balance.unreconciled)}`);

// One station missing its opening balance makes the GROUP figure unknown,
// rather than a total that quietly counts two stations out of three.
const partial = run(ST, { settings: { rk: { opening_cash: 20000000 }, jn: { opening_cash: 5000000 } } });
ok(partial.balance.openingCash === null,
   "a group opening balance was reported while one station had none", partial.balance.openingCash);
console.log("  5. one station missing its opening cash leaves the group figure unknown, not understated");

// ===========================================================================
// 4. Period vs as-at
// ===========================================================================
ok(near(rk.balance.accountsPayable, 8000000),
   "the unpaid July purchase vanished from a September report", rk.balance.accountsPayable);
const aug = computeStatements({ ...base, stations: [ST[0]], startDate: "2026-08-01", endDate: "2026-08-31" });
ok(aug.income.sales === 0, "August should have no sales", aug.income.sales);
ok(near(aug.balance.inventoryKg, 10000), "August's shed holds only the August purchase", aug.balance.inventoryKg);
ok(near(rk.balance.inventoryKg, 5000), "September's shed is wrong", rk.balance.inventoryKg);
ok(near(rk.balance.inventoryValue, 5000 * 850), "the shed is not at weighted-average cost", rk.balance.inventoryValue);
console.log(`  6. period figures move, balances are as at the end · shed ${money(rk.balance.inventoryValue)} = 5,000 kg @ 850`);

// ===========================================================================
// 5. Expense classification
// ===========================================================================
ok(classifyExpense("ចំណាយកូនដៃ") === "intermediary", "Khmer intermediary fee not recognised");
ok(classifyExpense("Broker commission") === "intermediary", "broker commission not recognised");
ok(classifyExpense("Staff salary") === "wages", "salary not recognised");
ok(classifyExpense("ប្រាក់ខែ") === "wages", "Khmer wages not recognised");
ok(classifyExpense("Fuel") === "other", "an unknown category must fall to other, never be dropped");
ok(classifyExpense("") === "other", "a blank category must fall to other");
// Nothing may be lost between the ledger and the three expense lines.
const expensesOnStatement = all.income.intermediaryFee + all.income.wages + all.income.otherExpenses;
const expensesInLedger = PAYS.filter((p) => p.type === "expense" && p.pay_date >= "2026-09-01" && p.pay_date <= "2026-09-30")
  .reduce((s, p) => s + p.amount, 0);
ok(near(expensesOnStatement, expensesInLedger),
   "expenses went missing between the ledger and the statement", `${expensesOnStatement} vs ${expensesInLedger}`);
console.log(`  7. every recorded expense reaches a line · ${money(expensesOnStatement)} ៛ in, ${money(expensesOnStatement)} ៛ on the statement`);

// ===========================================================================
// 6. Depreciation
// ===========================================================================
const ASSETS = [{ location_id: "rk", cost: 36500000, useful_life_years: 10, in_service_date: "2026-01-01" }];
const dep = run([ST[0]], { assets: ASSETS });
ok(dep.income.depreciation !== null, "an entered asset still produced no depreciation");
ok(near(dep.income.depreciation, (36500000 / 10) * (30 / 365), 2000),
   "September depreciation is not one month of straight line", dep.income.depreciation);
ok(dep.income.grossProfit !== null || dep.income.interest === null,
   "gross profit still null although depreciation is now known");
// An asset not yet in service contributes nothing.
const future = run([ST[0]], { assets: [{ location_id: "rk", cost: 1e9, useful_life_years: 5, in_service_date: "2027-01-01" }] });
ok(near(future.income.depreciation, 0), "an asset bought next year was depreciated this month", future.income.depreciation);
// It never depreciates past its own cost.
const old = accumulatedDepreciation([{ cost: 1000000, useful_life_years: 2, in_service_date: "2015-01-01" }], "2026-09-30");
ok(near(old, 1000000), "an asset was written down below zero book value", old);
ok(depreciationFor([], "2026-09-01", "2026-09-30") === null, "an empty asset register must read as not entered");
console.log(`  8. depreciation · ${money(dep.income.depreciation)} ៛ for September, nothing before an asset is in service`);

// ===========================================================================
// 7. Shareholders
// ===========================================================================
ok(all.shareholders.holdings.length === PARTNERS.length, "a holding went missing");
const rkH = all.shareholders.holdings.filter((h) => h.stationId === "rk");
ok(near(rkH.reduce((s, h) => s + h.value, 0), 14250000),
   "the station's shares do not add back to its own sales", rkH.reduce((s, h) => s + h.value, 0));
// Ping Pong: the 40/60 split must NOT follow the 3,000,000 / 2,000,000 capital.
const pp = all.shareholders.holdings.filter((h) => h.stationId === "pp");
const bigCapital = pp.reduce((a, b) => (a.capital > b.capital ? a : b));
ok(bigCapital.sharePct === 40, "Ping Pong's share was made to follow the capital", bigCapital.sharePct);
// A share nobody entered stays null and is never treated as the remainder.
const jn = all.shareholders.holdings.find((h) => h.stationId === "jn");
ok(jn.sharePct === null && jn.value === null, "an unentered share was invented", jn.sharePct);
// One person across stations is a sum of AMOUNTS, never a blended percentage.
const sisen = all.shareholders.people.find((p) => p.name === "Sisen");
ok(sisen.stations === 3, "Sisen's three holdings did not come together", sisen.stations);
ok(sisen.partial === true, "the group line did not flag the station with no share entered");
ok(!("sharePct" in sisen), "a group-level percentage was invented");
console.log(`  9. shareholders · per station, ${all.shareholders.holdings.length} holdings; Sisen across ${sisen.stations} stations, flagged incomplete`);

// ===========================================================================
// 8. Cancelled rows and other stations stay out
// ===========================================================================
ok(near(rk.income.sales, 14250000), "a cancelled sale leaked into income", rk.income.sales);
const jnOnly = run([ST[1]]);
ok(near(jnOnly.income.sales, 5700000), "another station leaked in", jnOnly.income.sales);
ok(near(jnOnly.balance.inventoryKg, 0), "Jomnoum's shed should be empty", jnOnly.balance.inventoryKg);
ok(near(jnOnly.balance.accountsPayable, 0), "Jomnoum owes nothing", jnOnly.balance.accountsPayable);
console.log("  10. cancelled transactions and other stations stay out");

// ===========================================================================
// 9. Inventory rows
// ===========================================================================
ok(all.inventory.rows.length === 3, "an inventory row went missing");
ok(near(all.inventory.total.closingKg, all.balance.inventoryKg),
   "the inventory report and the balance sheet disagree about the shed");
ok(near(all.inventory.total.closingValue, all.balance.inventoryValue),
   "the inventory report and the balance sheet disagree about its value");
console.log("  11. the inventory report and the balance sheet agree about the shed");

// ===========================================================================
// 12. The Cash Flow's two expense lines add back to expenses paid
// ===========================================================================
// [2026-09-15] កូនដៃ was split onto its own line at SISEN's request. The one
// way that can go wrong silently is a classification bucket nobody sums, so
// the second line is the REMAINDER and this asserts the pair is exhaustive —
// including the case where every expense is កូនដៃ and the case where none is.
{
  const cf = all.cashflow;
  ok(near(addKnown(cf.expensesPaidIntermediary, cf.expensesPaidOther), cf.expensesPaid),
     "the two cash-flow expense lines do not add back to expenses paid",
     [cf.expensesPaidIntermediary, cf.expensesPaidOther, cf.expensesPaid]);
  ok(cf.expensesPaidIntermediary >= 0, "intermediary paid went negative", cf.expensesPaidIntermediary);
  ok(cf.expensesPaidOther >= 0, "other expenses paid went negative", cf.expensesPaidOther);

  // All-កូនដៃ: the other line must be exactly zero, never a rounding crumb.
  const onlyInt = run([ST[0]], { payments: [
    { id: "x1", location_id: "rk", type: "expense", category: "កូនដៃ", amount: 400000, pay_date: "2026-09-10" },
  ] });
  ok(near(onlyInt.cashflow.expensesPaidOther, 0),
     "other expenses is not zero when every expense is កូនដៃ", onlyInt.cashflow.expensesPaidOther);

  // No កូនដៃ at all: the intermediary line must be zero and other must carry it.
  const noInt = run([ST[0]], { payments: [
    { id: "x2", location_id: "rk", type: "expense", category: "Fuel", amount: 250000, pay_date: "2026-09-10" },
  ] });
  ok(near(noInt.cashflow.expensesPaidIntermediary, 0),
     "intermediary is not zero when no expense is កូនដៃ", noInt.cashflow.expensesPaidIntermediary);
  ok(near(noInt.cashflow.expensesPaidOther, 250000),
     "other expenses did not pick up the non-កូនដៃ expense", noInt.cashflow.expensesPaidOther);

  console.log(`  12. cash-flow expense lines are exhaustive · ${money(all.cashflow.expensesPaidIntermediary)} កូនដៃ + ${money(all.cashflow.expensesPaidOther)} other = ${money(all.cashflow.expensesPaid)} ៛`);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
