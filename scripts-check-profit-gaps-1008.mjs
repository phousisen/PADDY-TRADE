// Guard for the profit check of 8 Oct 2026 (periodBook.js, "THE BOOKS NOW
// FOLLOW THE SHED THROUGH ZERO"). Run: node scripts-check-profit-gaps-1008.mjs
import { buildDays, buildDaysLegacy, buildDaysByStation, closingByStation, rollup } from "./src/periodBook.js";

let fails = 0;
const ok = (cond, msg, got) => { if (!cond) { fails++; console.log("  FAIL", msg, got === undefined ? "" : JSON.stringify(got)); } };
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const L = "S";
const ts = (d, h = 20) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00+07:00`).toISOString();
const T = (d, type, kg, amt) => ({ tx_date: d, location_id: L, type, quantity_kg: kg, amount: amt, hq_status: "processing" });
const A = (d, kg, reason = "count") => ({ location_id: L, created_at: ts(d), adjustment_kg: kg, reason });
const run = (c) => rollup(buildDays({ ...c, locationIds: [] }));

// 1. a sale saved before the purchase that supplied it
{
  const r = run({ txs: [T("2026-09-20", "SELL", 10000, 11000000), T("2026-09-21", "BUY", 10000, 10000000)] });
  ok(near(r.profit, 1000000), "1: a sale before its purchase must be charged the purchase", r.profit);
  ok(near(r.closingKg, 0, 0.01) && near(r.closingValue, 0), "1: shed must end empty", [r.closingKg, r.closingValue]);
  const old = rollup(buildDaysLegacy({ txs: [T("2026-09-20", "SELL", 10000, 11000000), T("2026-09-21", "BUY", 10000, 10000000)], locationIds: [] }));
  ok(near(old.profit, 11000000), "1: (the old walk showed the whole sale as profit)", old.profit);
}
// 1b. sold beyond the shed, the gap filled later at a different price
{
  const r = run({ txs: [T("2026-09-19", "BUY", 5000, 5000000), T("2026-09-20", "SELL", 10000, 11000000), T("2026-09-21", "BUY", 5000, 5500000)] });
  ok(near(r.profit, 500000), "1b: the late purchase's real cost must reach profit", r.profit);
}
// 2. a wrong count corrected later — in either order around a sale
{
  const a = run({ txs: [T("2026-09-20", "BUY", 20000, 20000000), T("2026-09-23", "SELL", 20000, 22000000)],
    adjustments: [A("2026-09-21", -10000), A("2026-09-22", 10000)] });
  ok(near(a.profit, 2000000), "2a: loss, found, then sold: charged once", a.profit);
  ok(near(a.lossValue, 0), "2a: lost and found cancel", a.lossValue);
  const b = run({ txs: [T("2026-01-01", "BUY", 100, 100000), T("2026-01-03", "SELL", 100, 110000)],
    adjustments: [A("2026-01-02", -100), A("2026-01-04", 100)] });
  ok(near(b.profit, 10000), "2b: loss, sold, then found: charged once", b.profit);
}
// 3. a real loss is still a loss; a real find still a find
{
  const r = run({ txs: [T("2026-09-20", "BUY", 10000, 10000000), T("2026-09-23", "SELL", 9000, 9900000)], adjustments: [A("2026-09-22", -1000)] });
  ok(near(r.profit, -100000), "3: a real loss stays in profit", r.profit);
}
// 4. starting counts never touch profit — including one that goes below zero
{
  const r = run({ txs: [T("2026-09-20", "BUY", 10000, 10000000), T("2026-09-21", "SELL", 10000, 11000000)], adjustments: [A("2026-09-22", -500, "opening")] });
  ok(near(r.lossValue, 0) && near(r.profit, 1000000), "4a: a starting count is not a loss", [r.lossValue, r.profit]);
  const b = run({ txs: [T("2026-01-01", "BUY", 100, 100000), T("2026-01-02", "SELL", 100, 110000), T("2026-01-04", "BUY", 50, 50000)],
    adjustments: [A("2026-01-03", -50, "opening")] });
  ok(near(b.cogs, 100000) && near(b.profit, 10000), "4b: a purchase filling a starting count's gap is not a cost", [b.cogs, b.profit]);
}
// 5. found paddy and a starting count on the same day never give a negative shed
{
  const ds = buildDays({ txs: [T("2026-01-01", "BUY", 1000, 1000000), T("2026-01-03", "SELL", 500, 550000)],
    adjustments: [A("2026-01-02", 1000), A("2026-01-02", -1500, "opening")], locationIds: [] });
  ok(ds.every((d) => d.closingValue >= -0.01 && d.costPerKg >= 0), "5: shed value must never go below zero", ds.map((d) => [d.closingValue, d.costPerKg]));
}
// 6. a year that ends owing paddy is settled at the cost it was charged
{
  const txs = [T("2025-12-30", "BUY", 100, 80000), T("2025-12-31", "SELL", 200, 200000), T("2026-01-05", "BUY", 100, 100000)];
  const cont = buildDays({ txs, locationIds: [] }).filter((d) => d.date >= "2026-01-01");
  const opening = closingByStation({ txs: txs.filter((t) => t.tx_date < "2026-01-01"), adjustments: [], locationIds: [L] });
  const split = buildDaysByStation({ txs: txs.filter((t) => t.tx_date >= "2026-01-01"), locationIds: [L], openingByLoc: opening });
  ok(near(rollup(cont).profit, rollup(split).profit), "6: next year must not charge the gap again", [rollup(cont).profit, rollup(split).profit]);
}

// Random data -------------------------------------------------------------
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const date = (i) => { const d = new Date(Date.UTC(2026, 7, 1 + i)); return d.toISOString().slice(0, 10); };

// 7. correct data gives exactly the same figures as the old walk
{
  let worst = 0;
  for (let k = 0; k < 300; k++) {
    const txs = [], adjustments = []; let stock = 0;
    for (let i = 0; i < 60; i++) {
      const buy = Math.round(rnd() * 20000); stock += buy; const price = 900 + rnd() * 200;
      if (buy) txs.push(T(date(i), "BUY", buy, Math.round(buy * price)));
      const sell = Math.round(rnd() * stock); stock -= sell;
      if (sell) txs.push(T(date(i), "SELL", sell, Math.round(sell * (price + 100))));
      if (rnd() < 0.1 && stock > 100) { const l = -Math.round(rnd() * stock * 0.05); stock += l; adjustments.push(A(date(i), l)); }
    }
    const a = rollup(buildDaysLegacy({ txs, adjustments, locationIds: [] }));
    const b = rollup(buildDays({ txs, adjustments, locationIds: [] }));
    for (const f of ["profit", "cogs", "lossValue", "closingKg", "closingValue", "received", "spent", "expenses"]) worst = Math.max(worst, Math.abs(a[f] - b[f]));
  }
  ok(worst < 0.01, "7: correct data must give identical figures", worst);
}
// 8. messy data: every riel paid is a cost, a loss, a starting-count write-off
//    or still in the pool — exactly once; no NaN; the shed never below zero.
{
  let bad = 0, worst = 0, neg = 0;
  for (let k = 0; k < 2000; k++) {
    const txs = [], adjustments = [];
    for (let i = 0; i < 40; i++) {
      if (rnd() < 0.7) txs.push(T(date(i), "BUY", Math.round(rnd() * 5000), Math.round(rnd() * 5000 * (800 + rnd() * 300))));
      if (rnd() < 0.7) txs.push(T(date(i), "SELL", Math.round(rnd() * 6000), Math.round(rnd() * 6000 * 1000)));
      if (rnd() < 0.15) adjustments.push(A(date(i), Math.round((rnd() - 0.5) * 3000)));
      if (rnd() < 0.05) adjustments.push(A(date(i), Math.round((rnd() - 0.6) * 3000), "opening"));
    }
    const ds = buildDays({ txs, adjustments, locationIds: [] });
    for (const d of ds) {
      for (const f of ["profit", "cogs", "lostValue", "closingValue", "carryValue", "resetWriteOff"]) if (!Number.isFinite(d[f])) bad++;
      if (d.closingValue < -0.01 || d.costPerKg < -1e-9) neg++;
    }
    const spent = ds.reduce((s, d) => s + d.spent, 0), cogs = ds.reduce((s, d) => s + d.cogs, 0);
    const lost = ds.reduce((s, d) => s + d.lostValue, 0), wo = ds.reduce((s, d) => s + d.startWriteOff, 0);
    const pool = ds.length ? ds[ds.length - 1].carryValue : 0;
    worst = Math.max(worst, Math.abs(spent - (cogs - lost + wo + pool)));
  }
  ok(bad === 0, "8: no NaN or Infinity", bad);
  ok(neg === 0, "8: the shed's value never goes below zero", neg);
  ok(worst < 1, "8: every riel paid is accounted for exactly once", worst);
}
// 9. all stations together = the stations added up
{
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const txs = [], adjustments = [];
    for (const loc of ["X", "Y", "Z"]) for (let i = 0; i < 20; i++) {
      if (rnd() < 0.6) txs.push({ ...T(date(i), "BUY", Math.round(rnd() * 4000), Math.round(rnd() * 4000000)), location_id: loc });
      if (rnd() < 0.6) txs.push({ ...T(date(i), "SELL", Math.round(rnd() * 4000), Math.round(rnd() * 4400000)), location_id: loc });
      if (rnd() < 0.1) adjustments.push({ ...A(date(i), Math.round((rnd() - 0.5) * 2000)), location_id: loc });
    }
    const all = rollup(buildDaysByStation({ txs, adjustments, locationIds: ["X", "Y", "Z"] }));
    const sum = ["X", "Y", "Z"].map((l) => rollup(buildDays({ txs: txs.filter((t) => t.location_id === l), adjustments: adjustments.filter((a) => a.location_id === l), locationIds: [] })))
      .reduce((o, r) => ({ profit: o.profit + r.profit, lossValue: o.lossValue + r.lossValue, closingValue: o.closingValue + r.closingValue }), { profit: 0, lossValue: 0, closingValue: 0 });
    for (const f of ["profit", "lossValue", "closingValue"]) worst = Math.max(worst, Math.abs(all[f] - sum[f]));
  }
  ok(worst < 0.01, "9: all stations must equal the stations added up", worst);
}

console.log(fails ? `\n${fails} CHECK(S) FAILED` : "All profit-check guards passed (1, 1b, 2a, 2b, 3, 4a, 4b, 5, 6, 7, 8, 9).");
process.exit(fails ? 1 : 0);
