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
  "lostKg", "lostValue", "startKg",
  "shortfallKg", "shortfallValue", "resetWriteOff",
  "lateCost",          // [2026-10-08] part of cogs: see buildDays
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
// [2026-10-08] THE BOOKS NOW FOLLOW THE SHED THROUGH ZERO (profit check).
//
// The finance manager said profit was wrong. Most of it was her own sheet and
// stock counts typed by hand, but replaying the live data through this file
// found two cases it got wrong, both around a shed that the books show as
// empty or below zero:
//
//   1. A sale that meets an empty shed in the books (the purchase that supplied
//      it was saved later, or dated the next day) was costed at 0 ៛, so the
//      whole sale showed as profit; when the purchase arrived it only filled
//      the gap and its cost went to the write-off, never to profit.
//   2. A wrong count corrected on a later day: the loss was charged, the
//      paddy "found" the next day gave nothing back, and it was charged AGAIN
//      when it was sold. Profit fell twice for paddy that never left.
//
// The fix is one idea: the pool keeps its value when it goes below zero. A
// sale beyond the shed is charged at the last cost the shed had, and the pool
// then owes those kilos at that cost. When paddy arrives it settles what is
// owed first: a purchase that costs more or less than was charged puts only
// the difference into cost of goods sold (`lateCost`); a starting count
// settles it without touching profit, as it always has.
//
// Found paddy now cancels lost paddy, at the same cost — the way stock
// overs and shorts are booked against each other in any perpetual
// inventory. It is not a sale and never appears as one: it lives only on the
// "stock lost / found" line, so a month's figure there is lost minus found.
// (The 19 Sep rule "a surplus must never cancel a loss" is what charged a
// corrected count twice; scripts-check-financials.mjs says so now too.)
//
// On correct data — purchases saved before the sales they supply, and no
// count corrected later — every figure is exactly what the old walk gave:
// buildDaysLegacy below is the old walk, kept unchanged, and
// scripts-check-profit-gaps-1008.mjs compares the two on random data, checks
// the money identity on random messy data, and checks that over a station's
// whole life every riel paid for paddy ends up as cost of goods sold, a loss
// or a starting-count write-off — exactly once.
//
// What is NOT changed here: a sale still leaves the shed at the buyer's
// weight (quantity_kg) while the stock ledger takes the station's weight.
// Booking that gap as "lost on the road" needs its own line on the Daily Book
// and is a separate change.
export function buildDays({ txs = [], payments = [], adjustments = [], locationIds = [],
  openingKg = 0, openingValue = 0, openingCost = null }) {
  const wanted = locationIds.length ? new Set(locationIds) : null;
  const inScope = (locId) => !wanted || wanted.has(locId);

  const byDate = new Map();
  const bucket = (date) => {
    if (!byDate.has(date)) byDate.set(date, { date, ...emptyTotals(), lateCost: 0 });
    return byDate.get(date);
  };
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
  for (const p of payments) {
    if (p.type !== "expense" || !p.pay_date || !inScope(p.location_id)) continue;
    const b = bucket(p.pay_date);
    const amt = num(p.amount);
    if (isCommission(p.category)) b.commission += amt;
    else b.otherExp += amt;
    b.expenses += amt;
  }
  for (const a of adjustments) {
    if (!inScope(a.location_id) || !a.created_at) continue;
    const b = bucket(effectiveAdjDateStr(a));
    b.lostKg += num(a.adjustment_kg);
    if (a.reason === "opening") b.startKg += num(a.adjustment_kg);
    b.counted = true;
  }

  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const EPS = 0.001;

  // The pool. `kg` is the books' stock and may be below zero; `value` is what
  // it is worth — below zero, it is the cost already charged for the kilos
  // the books owe. Opening below zero with no value given (an old caller)
  // owes those kilos at no charge, which is what the old walk assumed.
  let kg = num(openingKg);
  let value = kg > EPS ? num(openingValue) : (kg < -EPS ? Math.min(0, num(openingValue)) : 0);
  let lastCost = openingCost != null ? num(openingCost) : (kg > EPS ? value / kg : 0);

  // What one kilo costs right now: the average of the shed; below zero, what
  // was charged for the kilos owed; at zero, the last cost the shed had.
  const unitCost = () => (kg > EPS ? value / kg : kg < -EPS ? value / kg : lastCost);

  for (const d of days) {
    d.openingKg = kg;
    d.openingValue = Math.max(0, value);
    d.lateCost = 0;
    let writeOff = 0;              // value leaving the books outside profit (starting counts)
    let sellCogs = 0;

    // Paddy in. `kind`: "buy" (riel actually paid), "found" (valued at cost),
    // "start" (a starting count — kilos only, never profit).
    const takeIn = (q, riel, kind) => {
      if (q <= 0) {
        // Money paid with no kilos (a ticket missing its weight) is still a
        // cost: it cannot sit in a shed that holds nothing.
        if (kind === "buy" && riel) d.lateCost += riel;
        return 0;
      }
      let rest = q, added = 0;
      if (kg < -EPS) {
        const fill = Math.min(rest, -kg);
        const charged = (value / kg) * fill;          // what was charged for these kilos
        const paid = kind === "buy" ? riel * (fill / q) : charged;
        if (kind === "buy") d.lateCost += paid - charged;
        if (kind === "start") writeOff -= charged;
        kg += fill;
        value += charged;
        added += charged;
        rest -= fill;
      }
      if (rest > 0) {
        const worth = kind === "buy" ? riel * (rest / q) : rest * unitCost();
        if (kind === "start") writeOff -= worth;
        kg += rest;
        value += worth;
        added += worth;
      }
      return added;
    };
    // Paddy out, at today's cost. Beyond the shed, the pool goes below zero
    // and owes those kilos at that same cost.
    const takeOut = (q) => {
      if (q <= 0) return 0;
      const c = kg > EPS ? value / kg : lastCost;
      kg -= q;
      value -= q * c;
      return q * c;
    };

    takeIn(d.boughtKg, d.spent, "buy");
    if (kg > EPS) lastCost = value / kg;

    const heldBeforeSale = Math.max(0, kg);
    const saleCost = d.soldKg > 0 ? (kg > EPS ? value / kg : lastCost) : 0;
    d.shortfallKg = Math.max(0, d.soldKg - heldBeforeSale);
    d.shortfallValue = d.shortfallKg * saleCost;
    sellCogs = takeOut(d.soldKg);

    // Counts: a loss at today's cost, and found paddy at the same cost, so
    // one cancels the other. A starting count moves kilos only.
    const countKg = d.lostKg - d.startKg;
    if (countKg > 0) {
      d.lostValue = takeIn(countKg, 0, "found");   // exactly the value it brings in
    } else if (countKg < 0) {
      d.lostValue = -takeOut(-countKg);
    } else {
      d.lostValue = 0;
    }
    if (d.startKg < 0) writeOff += takeOut(-d.startKg);
    else if (d.startKg > 0) takeIn(d.startKg, 0, "start");

    // A shed that ends exactly empty resets clean: no stale value drifts on.
    if (Math.abs(kg) <= EPS) { writeOff += value; kg = 0; value = 0; }
    if (kg > EPS) lastCost = value / kg;

    d.cogs = sellCogs + d.lateCost;
    d.closingKg = kg;
    d.closingValue = Math.max(0, value);
    d.carryValue = value;          // with the owed value, for next year's opening
    d.carryCost = lastCost;
    d.costPerKg = kg > EPS ? value / kg : 0;
    d.buyPricePerKg = d.boughtKg > 0 ? d.spent / d.boughtKg : 0;
    // Everything that left the books' value without passing through profit:
    // starting counts, and the cost moved between the shed and what it owes.
    // Kept so the long-standing identity still reads true:
    //   closing = opening + spent − cogs + shortfall + lost − written off
    d.resetWriteOff = d.openingValue + d.spent - d.cogs + d.shortfallValue + d.lostValue - d.closingValue;
    d.startWriteOff = writeOff;
    d.lossValue = d.lostValue;
    d.profit = d.received - d.cogs - d.expenses + d.lossValue;
    d.cash = d.received - d.spent - d.expenses;
  }
  return days;
}

// The walk as it was until 8 Oct 2026, unchanged. Not used by any screen —
// kept so scripts-check-profit-gaps-1008.mjs can show the new walk gives
// exactly the same figures on correct data.
export function buildDaysLegacy({ txs = [], payments = [], adjustments = [], locationIds = [], openingKg = 0, openingValue = 0 }) {
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
    // [2026-10-03] A "starting count" (reason "opening") sets the real figure
    // after old records were typed in by hand. The kilos move like any count,
    // but it is NOT paddy lost or found, so it carries no value and never
    // touches profit — see `startKg` in the walk below.
    if (a.reason === "opening") b.startKg += num(a.adjustment_kg);
    b.counted = true;
  }

  // --- walk the days in order, carrying the pool ---------------------------
  //
  // [2026-10-03] THE SHED AND THE BOOKS NOW AGREE ON KILOS (full check S3).
  //
  // The cost pool below still never holds negative paddy — you cannot value
  // paddy that is not there. But the kilos used to stop at zero too, so after
  // a station sold more than the books showed, the Daily Book closed at 0
  // while the stock ledger (Dashboard) closed below zero — and the paddy that
  // later filled that gap (a late paper ticket, a settle) was then counted a
  // second time, as stock "in the shed" that the ledger never had.
  //
  // `deficitKg` remembers how far below zero the books really are. Paddy that
  // arrives while there is a deficit fills it first; only what is left over
  // goes into the shed. The kilos shown (closingKg) are therefore always the
  // ledger's figure — pool minus deficit — and at most one of the two is ever
  // non-zero. The deficit was already charged to cost when it was sold (see
  // the shortfall below), so filling it adds no second cost.
  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  let poolKg = Math.max(0, num(openingKg));
  let poolValue = poolKg > 0 ? num(openingValue) : 0;
  let deficitKg = Math.max(0, -num(openingKg));

  // Paddy coming in (bought, or found by a count): fill the deficit first.
  // The value of what fills it is booked as written off (`fillValue`): that
  // paddy was already costed when it shipped (the shortfall), so it must not
  // sit in the shed's value as well.
  let fillValue = 0;
  const takeIn = (kg) => {
    const fill = Math.min(deficitKg, Math.max(0, kg));
    deficitKg -= fill;
    return kg - fill;            // what actually reaches the shed
  };

  for (const d of days) {
    d.openingKg = poolKg - deficitKg;
    d.openingValue = poolValue;

    fillValue = 0;
    const boughtIn = takeIn(d.boughtKg);
    poolKg += boughtIn;
    poolValue += d.boughtKg > 0 ? d.spent * (boughtIn / d.boughtKg) : 0;
    fillValue += d.boughtKg > 0 ? d.spent * ((d.boughtKg - boughtIn) / d.boughtKg) : 0;

    const cost = poolKg > 0 ? poolValue / poolKg : 0;

    // A shed cannot hold negative paddy, so the physical level stops at zero —
    // but the COST of everything shipped is still charged, at the rate
    // prevailing that day. Costing only what the shed happened to hold would
    // let paddy ship for free and silently inflate the day's profit.
    //
    // When a sale exceeds what the books say is in the shed, that is a data
    // problem — a missed purchase, a mistyped weight, a ticket entered at the
    // wrong station. It is recorded as a shortfall so the page can flag it,
    // never swallowed — and now also carried as a deficit, so the kilos keep
    // matching the ledger.
    const availableKg = poolKg;
    d.shortfallKg = Math.max(0, d.soldKg - availableKg);
    d.cogs = d.soldKg * cost;                 // the full quantity shipped
    d.shortfallValue = d.shortfallKg * cost;
    poolKg = Math.max(0, poolKg - d.soldKg);
    poolValue = Math.max(0, poolValue - (d.soldKg - d.shortfallKg) * cost);
    deficitKg += d.shortfallKg;

    // A count: a loss comes out of the shed (and below zero, into the
    // deficit); a gain fills the deficit first, then the shed.
    // Real counts (losses/gains) are valued; a starting count is not.
    const countKg = d.lostKg - d.startKg;
    d.lostValue = countKg * cost;
    if (countKg >= 0) {
      const gainIn = takeIn(countKg);
      poolKg += gainIn;
      poolValue += gainIn * cost;
      fillValue += (countKg - gainIn) * cost;
    } else {
      const out = Math.min(poolKg, -countKg);
      poolKg -= out;
      poolValue += d.lostValue;               // as before; an over-loss is written off below
      deficitKg += -countKg - out;
    }
    // The starting count: kilos only. Paddy it removes leaves the shed's value
    // as a write-off (not a loss, not in profit); paddy it adds comes in at
    // the day's cost and is balanced the same way, so the money still ties out.
    if (d.startKg < 0) {
      const out = Math.min(poolKg, -d.startKg);
      fillValue += out * cost;
      poolKg -= out;
      poolValue -= out * cost;
      deficitKg += -d.startKg - out;
    } else if (d.startKg > 0) {
      const inKg = takeIn(d.startKg);
      poolKg += inKg;
      poolValue += inKg * cost;
      fillValue -= inKg * cost;
    }

    // A shed that empties resets clean — no stale cost drifts into tomorrow.
    // Any value left behind when the kilos reach zero is stock that vanished
    // on paper: recorded, never silently discarded, so the money always
    // accounts for itself.
    d.resetWriteOff = fillValue;
    if (poolKg <= 0.001) { d.resetWriteOff += poolValue; poolKg = 0; poolValue = 0; }

    d.closingKg = poolKg - deficitKg;
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
// buildDaysByStation — every station on its own shed, then added day by day
// ---------------------------------------------------------------------------
//
// [2026-09-29] Daily check, 29 Sep: the Daily Book fed every selected
// station into ONE buildDays call, so "All stations" ran one pooled average
// cost across five different sheds. Reang Kesey's sales were charged partly
// at Jomnoum's buying price, and the day's profit stopped matching the
// Income Statement (statements.js and financials.js were fixed on 14 Sep;
// the Daily Book never was).
//
// Here each station walks its own pool with buildDays, and the days are then
// added up. A station with nothing on a given day still holds its stock that
// day, so its closing level is carried forward into the total rather than
// dropping out.
const stationKey = (v) => (v == null ? "∅" : String(v));

function stationIdsOf({ txs = [], payments = [], adjustments = [], locationIds = [], extra = [] }) {
  if (locationIds.length) return [...new Set(locationIds.map(stationKey))];
  const ids = new Set(extra);
  for (const r of txs) ids.add(stationKey(r.location_id));
  for (const r of payments) ids.add(stationKey(r.location_id));
  for (const r of adjustments) ids.add(stationKey(r.location_id));
  return [...ids];
}

function daysForStation(id, { txs = [], payments = [], adjustments = [], opening = {} }) {
  const pick = (r) => stationKey(r.location_id) === id;
  return buildDays({
    txs: txs.filter(pick), payments: payments.filter(pick), adjustments: adjustments.filter(pick),
    locationIds: [], openingKg: num(opening.kg), openingValue: num(opening.value),
    openingCost: opening.cost ?? null,
  });
}

/** Each station's shed at the end of the given rows: { [stationId]: { kg, value } }. */
export function closingByStation({ txs = [], adjustments = [], locationIds = [] }) {
  const out = {};
  for (const id of stationIdsOf({ txs, adjustments, locationIds })) {
    const days = daysForStation(id, { txs, adjustments });
    const last = days[days.length - 1];
    // [2026-10-08] The value carried is the pool's own (below zero: what was
    // charged for the kilos owed) and the last cost, so a year that ends owing
    // paddy is settled in January at the same cost it was charged in December.
    out[id] = last
      ? { kg: last.closingKg, value: last.carryValue ?? last.closingValue, cost: last.carryCost ?? null }
      : { kg: 0, value: 0, cost: null };
  }
  return out;
}

export function buildDaysByStation({ txs = [], payments = [], adjustments = [], locationIds = [], openingByLoc = {} }) {
  const ids = stationIdsOf({ txs, payments, adjustments, locationIds, extra: Object.keys(openingByLoc) });
  const per = ids.map((id) => ({
    opening: openingByLoc[id] || { kg: 0, value: 0 },
    days: daysForStation(id, { txs, payments, adjustments, opening: openingByLoc[id] || {} }),
  }));
  if (per.length === 1) return per[0].days;

  const dates = [...new Set(per.flatMap((p) => p.days.map((d) => d.date)))].sort();
  const at = per.map(() => 0);
  const lastKg = per.map((p) => num(p.opening.kg));
  const lastVal = per.map((p) => Math.max(0, num(p.opening.value)));
  return dates.map((date) => {
    const row = { date, ...emptyTotals(), openingKg: 0, openingValue: 0, closingKg: 0, closingValue: 0,
      profit: 0, cash: 0, lossValue: 0, counted: false };
    per.forEach((p, i) => {
      const d = p.days[at[i]];
      if (d && d.date === date) {
        for (const f of SUM_FIELDS) row[f] += num(d[f]);
        row.openingKg += num(d.openingKg); row.openingValue += num(d.openingValue);
        row.closingKg += num(d.closingKg); row.closingValue += num(d.closingValue);
        row.profit += num(d.profit); row.cash += num(d.cash);
        row.lossValue += d.lossValue != null ? num(d.lossValue) : Math.min(0, num(d.lostValue));
        row.counted = row.counted || !!d.counted;
        lastKg[i] = num(d.closingKg); lastVal[i] = num(d.closingValue);
        at[i] += 1;
      } else {
        // Nothing happened at this station today; its shed is unchanged.
        row.openingKg += lastKg[i]; row.openingValue += lastVal[i];
        row.closingKg += lastKg[i]; row.closingValue += lastVal[i];
      }
    });
    row.costPerKg = row.closingKg > 0 ? row.closingValue / row.closingKg : 0;
    row.buyPricePerKg = row.boughtKg > 0 ? row.spent / row.boughtKg : 0;
    return row;
  });
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
  // [2026-10-08] Each day's own lossValue: lost minus found (see buildDays,
  // "THE BOOKS NOW FOLLOW THE SHED THROUGH ZERO"). Days from the old walk
  // (buildDaysLegacy) have none and keep the old rule, losses only.
  o.lossValue = days.reduce((a, d) => a + (d.lossValue != null ? num(d.lossValue) : Math.min(0, num(d.lostValue))), 0);

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
// [2026-10-03] Callers pass the corrected clock (getAccurateNow), not the
// PC's own — kept as a parameter so this file still runs without the app.
export function cambodiaToday(now = new Date()) { return cambodiaDateStr(now); }
