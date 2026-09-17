// Proves the Daily Book's arithmetic against generated data, so a future edit
// to periodBook.js cannot quietly break it.
//
// What is asserted, in order of how much it would hurt to get wrong:
//   1. days sum to weeks sum to months sum to the year
//   2. the stock chain closes on EVERY day: yesterday's closing + bought
//      − sold ± counted = tonight's closing
//   3. closing stock is a LEVEL — a month's closing is its last day's, never
//      the sum of its days
//   4. the pool never goes negative, and an emptied shed resets to zero cost
//   5. on a day the shed empties, cost per kg equals the price paid that day
//   6. cancelled transactions are excluded; voided payments never arrive
//   7. profit and cash differ by exactly the change in stock value
//   8. vehicle types add up to the load count
//
// Run: node scripts-check-periodbook.mjs

import { readFileSync } from "node:fs";
import { buildDays, rollup, buildPeriods, isoWeek, monthKey, vehicleTypeOf, SUM_FIELDS } from "./src/periodBook.js";

let failures = 0;
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
function ok(cond, msg, extra) {
  if (!cond) { failures++; console.log("  FAIL " + msg, extra === undefined ? "" : extra); }
}

// --- a deterministic year of trading -------------------------------------
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry(42);
const pad = (n) => String(n).padStart(2, "0");
const LOC = "loc-rk";
const VEHICLES = ["Truck", "Koyun", "Tractor", "ក្យូន"]; // the last one has no prefix rule — lands in "other"

const txs = [], payments = [], adjustments = [];
let poolGuess = 40000;               // rough shed level, only to drive the generator
const dates = [];
for (let m = 1; m <= 9; m++) {
  for (let day = 1; day <= 28; day++) {
    if ((day % 7) === 0) continue;   // one day off a week
    const date = `2026-${pad(m)}-${pad(day)}`;
    dates.push(date);
    const buys = Math.floor(rnd() * 4);
    for (let i = 0; i < buys; i++) {
      const kg = Math.round((3000 + rnd() * 25000) * 100) / 100;
      const price = Math.round((840 + rnd() * 60) * 100) / 100;
      const kind = VEHICLES[Math.floor(rnd() * VEHICLES.length)];
      txs.push({
        id: `b${date}-${i}`, tx_date: date, location_id: LOC, type: "BUY",
        quantity_kg: kg, amount: Math.round(kg * price),
        car_plate: kind === "ក្យូន" ? "ក្យូន ២" : `${kind}: 3A-${1000 + i}`,
        hq_status: "processing", status: "confirmed",
      });
      poolGuess += kg;
    }
    // ship whenever the shed has something, and sometimes clear it completely
    const sells = poolGuess > 60000 ? 1 + Math.floor(rnd() * 2) : (rnd() < 0.4 ? 1 : 0);
    for (let i = 0; i < sells; i++) {
      const empty = rnd() < 0.12;
      const kg = empty ? Math.round(poolGuess * 100) / 100
                       : Math.round(Math.min(poolGuess * 0.6, 5000 + rnd() * 25000) * 100) / 100;
      if (kg <= 0) continue;
      const price = Math.round((855 + rnd() * 60) * 100) / 100;
      txs.push({
        id: `s${date}-${i}`, tx_date: date, location_id: LOC, type: "SELL",
        quantity_kg: kg, amount: Math.round(kg * price),
        car_plate: "Truck: 2C-9912", hq_status: "processing", status: "confirmed",
      });
      poolGuess -= kg;
    }
    payments.push({ type: "expense", category: "Salary", pay_date: date, location_id: LOC, amount: 150000 });
    payments.push({ type: "expense", category: "ថ្លៃកូនដៃ", pay_date: date, location_id: LOC, amount: 90000 });
    if (rnd() < 0.5) payments.push({ type: "expense", category: "Fuel", pay_date: date, location_id: LOC, amount: 80000 + Math.round(rnd() * 200000) });
    if (day === 15) {
      adjustments.push({ location_id: LOC, created_at: `${date}T16:00:00+07:00`, adjustment_kg: -Math.round(rnd() * 400 * 100) / 100 });
    }
  }
}

// noise that must be ignored
txs.push({ id: "cancelled", tx_date: "2026-05-05", location_id: LOC, type: "BUY",
  quantity_kg: 999999, amount: 999999999, car_plate: "Truck: X", hq_status: "cancelled", status: "confirmed" });
txs.push({ id: "otherstation", tx_date: "2026-05-05", location_id: "loc-other", type: "BUY",
  quantity_kg: 888888, amount: 888888888, car_plate: "Truck: Y", hq_status: "processing", status: "confirmed" });
payments.push({ type: "payment", pay_date: "2026-05-05", location_id: LOC, amount: 777777777 });

const days = buildDays({ txs, payments, adjustments, locationIds: [LOC], openingKg: 0, openingValue: 0 });

console.log(`Daily Book — ${days.length} trading days generated`);

// 1. every level agrees ------------------------------------------------------
const year = rollup(days);
for (const grain of ["weeks", "months"]) {
  const periods = buildPeriods(days, grain);
  const summed = rollup(periods.flatMap((p) => p.days));
  for (const f of [...SUM_FIELDS, "cogs", "profit", "cash"]) {
    ok(near(summed[f], year[f], 0.5), `${grain} → year mismatch on ${f}`, `${summed[f]} vs ${year[f]}`);
  }
  // and each period equals the days inside it
  for (const p of periods) {
    const direct = rollup(p.days);
    for (const f of SUM_FIELDS) {
      ok(near(direct[f], p.totals[f], 0.01), `${grain} ${p.key} mismatch on ${f}`);
    }
  }
}
console.log("  days sum to weeks sum to months sum to the year");

// 2. the stock chain closes every single day --------------------------------
let prev = 0;
for (const d of days) {
  ok(near(d.openingKg, prev, 0.01), `opening on ${d.date} is not yesterday's closing`, `${d.openingKg} vs ${prev}`);
  const sold = Math.min(d.soldKg, prev + d.boughtKg);
  const expect = prev + d.boughtKg - sold + d.lostKg;
  ok(near(d.closingKg, Math.max(0, expect), 0.02), `stock chain broken on ${d.date}`, `${expect} vs ${d.closingKg}`);
  prev = d.closingKg;
}
console.log("  stock chain closes on all " + days.length + " days");

// 3. closing stock is a level, never a sum ----------------------------------
for (const p of buildPeriods(days, "months")) {
  const lastDay = p.days[p.days.length - 1];
  ok(near(p.totals.closingKg, lastDay.closingKg, 0.01), `${p.key} closing kg is not its last day's`);
  ok(near(p.totals.closingValue, lastDay.closingValue, 0.5), `${p.key} closing value is not its last day's`);
  const summedClosing = p.days.reduce((a, d) => a + d.closingKg, 0);
  ok(p.days.length === 1 || !near(p.totals.closingKg, summedClosing, 0.01),
     `${p.key} closing kg looks like a SUM of its days — it must be a level`);
}
console.log("  closing stock is a level, not a total");

// 4/5. the pool behaves ------------------------------------------------------
let emptied = 0;
for (const d of days) {
  ok(d.closingKg >= -0.001, `negative stock on ${d.date}`, d.closingKg);
  ok(d.closingValue >= -0.5, `negative stock value on ${d.date}`, d.closingValue);
  if (d.closingKg === 0) {
    emptied++;
    ok(d.closingValue === 0, `shed empty but value left behind on ${d.date}`, d.closingValue);
    ok(d.costPerKg === 0, `shed empty but a cost left behind on ${d.date}`, d.costPerKg);
  }
  if (d.closingKg > 0 && d.boughtKg > 0) {
    ok(d.costPerKg > 500 && d.costPerKg < 1200, `cost per kg out of range on ${d.date}`, d.costPerKg);
  }
  // a day that starts empty and buys once: cost per kg IS the price paid
  if (d.openingKg === 0 && d.boughtKg > 0 && d.soldKg === 0 && d.lostKg === 0) {
    ok(near(d.costPerKg, d.buyPricePerKg, 0.01),
       `day started empty on ${d.date} — cost per kg should equal the price paid`,
       `${d.costPerKg} vs ${d.buyPricePerKg}`);
  }
}
ok(emptied > 0, "the generated year never empties the shed — the reset path went untested");
console.log(`  pool never negative · shed emptied on ${emptied} days, resetting clean`);

// 6. noise excluded ----------------------------------------------------------
// build again from the clean rows only — the totals must be identical, which
// is a far better test than guessing a threshold.
const cleanDays = buildDays({
  txs: txs.filter((t) => t.id !== "cancelled" && t.id !== "otherstation"),
  payments: payments.filter((p) => p.type === "expense"),
  adjustments, locationIds: [LOC],
});
const clean = rollup(cleanDays);
for (const f of [...SUM_FIELDS, "profit", "cash", "closingKg", "closingValue"]) {
  ok(near(clean[f], year[f], 0.5), `noise changed ${f}`, `${clean[f]} vs ${year[f]}`);
}
console.log("  cancelled transactions and other stations excluded");

// 7. profit vs cash ----------------------------------------------------------
// The difference between them is exactly the change in the value of the shed.
const stockChange = year.closingValue - year.openingValue;
// Every riel of stock value is accounted for:
//   closing = opening + spent − cogs + shortfall + lost − written off
ok(near(year.closingValue,
        year.openingValue + year.spent - year.cogs + year.shortfallValue + year.lostValue - year.resetWriteOff, 2.0),
   "stock value does not reconcile",
   `${year.closingValue} vs ${year.openingValue + year.spent - year.cogs + year.shortfallValue + year.lostValue - year.resetWriteOff}`);
ok(near(year.profit - year.cash, stockChange - year.shortfallValue + year.resetWriteOff, 2.0),
   "profit less cash should equal the change in stock value, less shortfall, plus write-offs",
   `${year.profit - year.cash} vs ${stockChange - year.shortfallValue + year.resetWriteOff}`);
console.log(`  stock value reconciles · profit − cash ties out (shortfall ${Math.round(year.shortfallValue).toLocaleString()}, written off ${Math.round(year.resetWriteOff).toLocaleString()})`);

// paddy that shipped but the books say was never in the shed must be COSTED,
// never shipped for free — the bug this guard was written to catch.
const freeShip = buildDays({
  txs: [
    { tx_date: "2026-01-01", location_id: LOC, type: "BUY",  quantity_kg: 1000, amount: 850000,  car_plate: "Truck: A", hq_status: "processing" },
    { tx_date: "2026-01-02", location_id: LOC, type: "SELL", quantity_kg: 1500, amount: 1350000, car_plate: "Truck: B", hq_status: "processing" },
  ], locationIds: [LOC],
});
const over = freeShip[1];
ok(near(over.shortfallKg, 500, 0.01), "a sale beyond the shed was not recorded as a shortfall", over.shortfallKg);
ok(near(over.cogs, 1500 * 850, 1), "only the available kilos were costed — the rest shipped free", over.cogs);
ok(near(over.profit, 1350000 - 1500 * 850, 1), "profit inflated by uncosted paddy", over.profit);
ok(over.closingKg === 0, "shed went negative", over.closingKg);
console.log("  paddy shipped beyond the shed is costed and flagged, not free");

// 8. vehicles add up ---------------------------------------------------------
for (const d of days) {
  ok(d.truck + d.koyun + d.tractor + d.otherVeh === d.buyLoads,
     `vehicle counts do not add to the load count on ${d.date}`);
}
ok(vehicleTypeOf("Truck: 3A-1890") === "truck", "vehicle prefix not parsed");
ok(vehicleTypeOf("ក្យូន ២") === "other", "a plate with no prefix should be other, not dropped");
ok(vehicleTypeOf("") === "other", "an empty plate should be other, not dropped");
console.log("  vehicle types add up to the load count");

// ថ្លៃកូនដៃ stands alone ------------------------------------------------------
// [2026-09-16] The Daily Book's expense columns are ថ្លៃកូនដៃ / other / total.
// SISEN is trying to cut the commission, which cannot be seen if it is
// averaged in with salary — salary barely moves, commission moves with how
// much paddy is bought.
{
  const D = "2026-03-02";
  const split = buildDays({
    txs: [], adjustments: [], locationIds: [LOC], openingKg: 0, openingValue: 0,
    payments: [
      { type: "expense", category: "ថ្លៃកូនដៃ", pay_date: D, location_id: LOC, amount: 100000 },
      // The same category carrying a zero-width space — invisible on screen,
      // and what an exact string compare used to drop into Other.
      { type: "expense", category: "ថ្លៃកូនដៃ\u200b", pay_date: D, location_id: LOC, amount: 25000 },
      { type: "expense", category: "Salary", pay_date: D, location_id: LOC, amount: 400000 },
      { type: "expense", category: "Fuel", pay_date: D, location_id: LOC, amount: 60000 },
    ],
  }).find((d) => d.date === D);

  ok(split.commission === 125000, "commission must include an invisibly-different spelling", split.commission);
  ok(split.otherExp === 460000, "salary and fuel belong in other, not commission", split.otherExp);
  ok(split.expenses === 585000, "the two columns must add to total expenses", split.expenses);
  ok(split.commission + split.otherExp === split.expenses, "no expense may fall between the two columns");
  console.log("  ថ្លៃកូនដៃ is its own column, and salary is not in it");
}

// week numbering -------------------------------------------------------------
ok(isoWeek("2026-01-01").week === 1, "ISO week of 1 Jan 2026 should be 1", isoWeek("2026-01-01"));
ok(monthKey("2026-09-14") === "2026-09", "month key wrong");

// reading order ---------------------------------------------------------------
//
// [2026-09-17] SISEN: "make the lastest date up instead" — "for all devices not
// just pc". The page is opened to see how TODAY went, and today used to be
// thirty rows down.
//
// Two things have to hold, and the second is the one that quietly breaks:
//   · buildPeriods stays ASCENDING. It is a pure function several things
//     reason about; the reversal belongs to the screen, not the data.
//   · the week subtotal still lands under its OWN days once reversed.
{
  const asc = buildPeriods(days, "days");
  const sorted = [...asc].every((p, i) => i === 0 || asc[i - 1].key <= p.key);
  ok(sorted, "buildPeriods must stay oldest-first — the page reverses, not this");

  const book = readFileSync("src/pages/DailyBook.jsx", "utf8");
  ok(/buildPeriods\(scoped, grain\)\.slice\(\)\.reverse\(\)/.test(book),
     "DailyBook must show newest first");
  // Both layouts must read the SAME array, or a phone and a computer disagree
  // about what order the month is in.
  ok((book.match(/periods\.map\(/g) || []).length === 2,
     "the phone cards and the computer table must both map over `periods`");
  ok(!/\.reverse\(\)/.test(book.split("const periods = useMemo")[1].split("\n").slice(1).join("\n")),
     "nothing may reverse the rows a second time further down the page");

  // The week break is detected against the NEXT row in display order. Reversed,
  // that is the older day — so the boundary must still fall at the start of a
  // week, putting the subtotal beneath the group it belongs to.
  const shown = [...asc].reverse();
  const emitted = [];
  shown.forEach((p, i) => {
    const next = shown[i + 1];
    emitted.push(p.key);
    if (!next || isoWeek(p.key).key !== isoWeek(next.key).key) emitted.push(`W:${isoWeek(p.key).key}`);
  });
  // Every week that appears must be emitted exactly once, and immediately
  // after the OLDEST day of that week.
  const weeksSeen = emitted.filter((e) => e.startsWith("W:"));
  const weeksReal = [...new Set(days.map((d) => isoWeek(d.date).key))];
  ok(weeksSeen.length === weeksReal.length,
     "every week gets exactly one subtotal", `${weeksSeen.length} vs ${weeksReal.length}`);
  ok(new Set(weeksSeen).size === weeksSeen.length, "no week is subtotalled twice");
  for (let i = 0; i < emitted.length; i += 1) {
    const e = emitted[i];
    if (!e.startsWith("W:")) continue;
    const dayBefore = emitted[i - 1];
    ok(dayBefore && !dayBefore.startsWith("W:") && `W:${isoWeek(dayBefore).key}` === e,
       `the ${e} subtotal must sit directly under that week's oldest day`, dayBefore);
  }
  console.log("  newest day first, each week's total under its own days");
}

console.log(failures === 0
  ? `\nAll checks passed — ${days.length} days, ${buildPeriods(days,"weeks").length} weeks, ${buildPeriods(days,"months").length} months.`
  : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
