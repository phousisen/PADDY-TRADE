// The Daily Book's arithmetic. Nothing in here touches the network or React —
// it takes the rows the app already fetches and returns the figures the page
// shows, so the whole thing is testable from a script (see
// scripts-check-periodbook.mjs).
//
// The rule the whole file exists to enforce: DAYS SUM TO WEEKS SUM TO MONTHS
// SUM TO THE YEAR. Every level is a rollup of the same day rows — nothing is
// entered, nothing is stored, nothing is recomputed a second way. That is why
// a month can never disagree with the days inside it.
//
// The one figure that does NOT sum down a column is closing stock. It is a
// LEVEL — what is in the shed at the end of that period — so a month's closing
// is its last day's closing, not the sum of the days. Same for cost per kg and
// stock value. buildPeriods() is the only place that knows this.

import { isCommission } from "./expenseCategories.js";

import { cambodiaDateStr, effectiveAdjDateStr } from "./dailyLedger.js";

// Vehicle type is stored on the ticket as "Truck: 3A-1890" — the part before
// the colon is the type, and the list grows as stations add their own (see
// VEHICLE_TYPE_SEED in WeighingTickets.jsx). Anything without a prefix, or
// with a type nobody recognises, is still a load; it just lands in "other".
export const KNOWN_VEHICLES = ["truck", "koyun", "tractor"];

export function vehicleTypeOf(carPlate) {
  const s = String(carPlate || "");
  const i = s.indexOf(":");
  if (i < 0) return "other";
  const t = s.slice(0, i).trim().toLowerCase();
  return KNOWN_VEHICLES.includes(t) ? t : "other";
}

const num = (v) => Number(v) || 0;

// Every field that is a TOTAL — these add up across days. Anything not in this
// list is a level or a derived figure and must be handled explicitly.
export const SUM_FIELDS = [
  "buyLoads", "truck", "koyun", "tractor", "otherVeh",
  "boughtKg", "spent",
  "sellLoads", "soldKg", "received", "cogs",
  "commission", "otherExp", "expenses",
  "lostKg", "lostValue",
  "shortfallKg", "shortfallValue", "resetWriteOff",
];

function emptyTotals() {
  const o = {};
  SUM_FIELDS.forEach((f) => { o[f] = 0; });
  return o;
}

// ---------------------------------------------------------------------------
// buildDays — one row per trading day, with the running weighted-average cost
// ---------------------------------------------------------------------------
//
// The running average is the heart of it. Buying adds kilos AND the riel
// actually paid; the cost per kilo is whatever the pool then averages; selling
// removes kilos AT THAT COST, not at the selling price; a counted shortage or
// surplus moves kilos at the same cost.
//
// Why an average and not the day's price: the paddy in the shed tonight was
// bought across many days at many prices, and it is one pile — there is no way
// to tell which grain came from which day. On a day the shed empties, the
// average and the day's price are the same number, which is most days at most
// stations. On a day stock carries over, the average is the only figure that
// exists at all.
export function buildDays({ txs = [], payments = [], adjustments = [], locationIds = [], openingKg = 0, openingValue = 0 }) {
  const wanted = locationIds.length ? new Set(locationIds) : null;
  const inScope = (locId) => !wanted || wanted.has(locId);

  const byDate = new Map();
  const bucket = (date) => {
    if (!byDate.has(date)) byDate.set(date, { date, ...emptyTotals() });
    return byDate.get(date);
  };

  // --- transactions -------------------------------------------------------
  // hq_status, not status: a cancelled transaction keeps status "confirmed"
  // and is marked cancelled on hq_status (api.js cancelTransaction).
  for (const tx of txs) {
    if (!tx.tx_date || !inScope(tx.location_id)) continue;
    if ((tx.hq_status || "processing") === "cancelled") continue;
    const b = bucket(tx.tx_date);
    const kg = num(tx.quantity_kg);
    const riel = num(tx.amount);
    if (tx.type === "BUY") {
      b.buyLoads += 1;
      b.boughtKg += kg;
      b.spent += riel;
      const v = vehicleTypeOf(tx.car_plate);
      if (v === "truck") b.truck += 1;
      else if (v === "koyun") b.koyun += 1;
      else if (v === "tractor") b.tractor += 1;
      else b.otherVeh += 1;
    } else {
      b.sellLoads += 1;
      b.soldKg += kg;
      b.received += riel;
    }
  }

  // --- expenses -----------------------------------------------------------
  // An expense is a payment of type "expense". ថ្លៃកូនដៃ is split out and
  // everything else — salary included — goes in Other.
  //
  // [2026-09-16] This column was "Staff", matched with
  //     (p.category || "") === "Staff"
  // Two things were wrong with it.
  //
  //   1. ថ្លៃកូនដៃ is a commission the business pays one staff member per
  //      station, per kilo, for bringing farmers in. SISEN is trying to cut
  //      it. Inside a "Staff" column it sits with salary, which barely moves
  //      month to month — so a commission rising 37% and a salary rising 2%
  //      average out to 13% and neither can be read. SISEN: "for the staff
  //      colum, change it to commision, which is ថ្លៃកូនដៃ."
  //
  //   2. The match was an exact string compare, so a category carrying a
  //      zero-width character from a Khmer keyboard — invisible on screen —
  //      fell silently into Other. isCommission() sees through that, the
  //      same normalisation the products unique index uses.
  //
  // Voided payments are already excluded by api.getPayments.
  for (const p of payments) {
    if (p.type !== "expense" || !p.pay_date || !inScope(p.location_id)) continue;
    const b = bucket(p.pay_date);
    const amt = num(p.amount);
    if (isCommission(p.category)) b.commission += amt;
    else b.otherExp += amt;
    b.expenses += amt;
  }

  // --- stock counts -------------------------------------------------------
  // Dated by effectiveAdjDateStr, so a count entered at 2am counts against the
  // night it closed rather than opening the new day negative.
  for (const a of adjustments) {
    if (!inScope(a.location_id) || !a.created_at) continue;
    const b = bucket(effectiveAdjDateStr(a));
    b.lostKg += num(a.adjustment_kg);
    b.counted = true;
  }

  // --- walk the days in order, carrying the pool ---------------------------
  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  let poolKg = num(openingKg);
  let poolValue = num(openingValue);

  for (const d of days) {
    d.openingKg = poolKg;
    d.openingValue = poolValue;

    poolKg += d.boughtKg;
    poolValue += d.spent;

    const cost = poolKg > 0 ? poolValue / poolKg : 0;

    // A shed cannot hold negative paddy, so the physical level stops at zero —
    // but the COST of everything shipped is still charged, at the rate
    // prevailing that day. Costing only what the shed happened to hold would
    // let paddy ship for free and silently inflate the day's profit.
    //
    // When a sale exceeds what the books say is in the shed, that is a data
    // problem — a missed purchase, a mistyped weight, a ticket entered at the
    // wrong station. It is recorded as a shortfall so the page can flag it,
    // never swallowed.
    const availableKg = poolKg;
    d.shortfallKg = Math.max(0, d.soldKg - availableKg);
    d.cogs = d.soldKg * cost;                 // the full quantity shipped
    d.shortfallValue = d.shortfallKg * cost;
    poolKg = Math.max(0, poolKg - d.soldKg);
    poolValue = Math.max(0, poolValue - (d.soldKg - d.shortfallKg) * cost);

    d.lostValue = d.lostKg * cost;
    poolKg += d.lostKg;
    poolValue += d.lostValue;

    // A shed that empties resets clean — no stale cost drifts into tomorrow.
    // Any value left behind when the kilos reach zero is stock that vanished
    // on paper: recorded, never silently discarded, so the money always
    // accounts for itself.
    d.resetWriteOff = 0;
    if (poolKg <= 0.001) { d.resetWriteOff = poolValue; poolKg = 0; poolValue = 0; }

    d.closingKg = poolKg;
    d.closingValue = poolValue;
    d.costPerKg = poolKg > 0 ? poolValue / poolKg : 0;
    d.buyPricePerKg = d.boughtKg > 0 ? d.spent / d.boughtKg : 0;

    // Profit is what the day EARNED: sales, less the cost of the paddy that
    // actually left the shed, less running costs. Cash is what MOVED. They
    // differ by the paddy bought and not yet sold, which is exactly why both
    // are shown — a heavy buying day has fine profit and terrible cash.
    d.profit = d.received - d.cogs - d.expenses + Math.min(0, d.lostValue);
    d.cash = d.received - d.spent - d.expenses;
  }
  return days;
}

// ---------------------------------------------------------------------------
// rollup — totals for a set of day rows
// ---------------------------------------------------------------------------
export function rollup(days) {
  const o = { ...emptyTotals(), days: days.length };
  for (const d of days) {
    for (const f of SUM_FIELDS) o[f] += num(d[f]);
  }
  o.profit = days.reduce((a, d) => a + num(d.profit), 0);
  o.cash = days.reduce((a, d) => a + num(d.cash), 0);
  // [2026-09-19] Losses only, day by day. lostValue nets a surplus on one day
  // against a loss on another; a surplus is not income, so it must never
  // cancel a loss (the Daily Book already takes each day on its own).
  o.lossValue = days.reduce((a, d) => a + Math.min(0, num(d.lostValue)), 0);

  // Levels, not totals — take them from the last day, never the sum.
  const last = days[days.length - 1];
  o.openingKg = days.length ? num(days[0].openingKg) : 0;
  o.openingValue = days.length ? num(days[0].openingValue) : 0;
  o.closingKg = last ? num(last.closingKg) : 0;
  o.closingValue = last ? num(last.closingValue) : 0;
  o.costPerKg = o.closingKg > 0 ? o.closingValue / o.closingKg : 0;
  o.buyPricePerKg = o.boughtKg > 0 ? o.spent / o.boughtKg : 0;
  return o;
}

// ---------------------------------------------------------------------------
// week / month keys
// ---------------------------------------------------------------------------
// ISO week — Monday start, the week containing the year's first Thursday. Built
// from the date STRING so it can never be shifted by the viewer's timezone.
export function isoWeek(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;          // Mon = 0
  dt.setUTCDate(dt.getUTCDate() + 3 - dow);       // the week's Thursday
  const year = dt.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((dt - jan1) / 86400000 + 1) / 7);
  return { year, week, key: `${year}-W${String(week).padStart(2, "0")}` };
}
export function monthKey(dateStr) { return String(dateStr).slice(0, 7); }
export function yearKey(dateStr) { return String(dateStr).slice(0, 4); }

// ---------------------------------------------------------------------------
// buildPeriods — the same days, bucketed at whatever grain the page is showing
// ---------------------------------------------------------------------------
export function buildPeriods(days, grain) {
  if (grain === "days") {
    return days.map((d) => ({ key: d.date, label: d.date, days: [d], totals: { ...d, days: 1 } }));
  }
  const keyOf =
    grain === "weeks" ? (d) => isoWeek(d.date).key :
    grain === "months" ? (d) => monthKey(d.date) :
    (d) => yearKey(d.date);

  const groups = new Map();
  for (const d of days) {
    const k = keyOf(d);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, ds]) => ({ key, label: key, days: ds, totals: rollup(ds) }));
}

// Convenience for the page: today's date at the station, so "this month"
// means the month it is in Cambodia and not wherever the browser thinks it is.
export function cambodiaToday() { return cambodiaDateStr(new Date()); }
