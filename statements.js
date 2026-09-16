// The five financial statements, in one place.
//
// [2026-09-14] Balance Sheet · Income Statement · Cash Flow · Inventory ·
// Shareholder's Records — built to the spec the accountant gave, per station
// and consolidated, from the same arithmetic. Nothing here fetches or renders;
// pages hand it raw rows and get numbers back, so five screens can never
// disagree with each other about the same month.
//
// ---------------------------------------------------------------------------
// Two rules this module will not bend
// ---------------------------------------------------------------------------
//
// 1. CONSOLIDATION IS ADDITION, AND ONLY WHERE ADDITION IS VALID.
//    Pick one station and you get that station. Pick three and you get the
//    three added together — not a "group" with rules of its own. That works
//    because every figure here is either a flow over a period (sales, expenses
//    — addition is meaningful) or a level at one moment (cash, the shed, what
//    is owed — five different sheds at the same instant, so addition is still
//    meaningful). What is NEVER added is a RATE: cost per kg is re-derived
//    from the pooled value and the pooled kilos, never averaged across
//    stations, and an ownership percentage is never pooled at all (see
//    shareholders() below for why).
//
// 2. A FIGURE NOBODY HAS ENTERED IS null, NEVER 0.
//    Depreciation, interest, tax and the opening cash balance are not things
//    the system can work out from weighbridge tickets; somebody has to tell
//    it. Until they do, those lines are null and the pages print them as
//    "not entered". Zero is a claim — it says the business owns nothing that
//    wears out and pays no interest — and printing a claim nobody made is how
//    a report ends up confidently wrong. Every subtotal that touches a null
//    is itself null, all the way up: an unknown plus a known is still unknown.
//
// See periodBook.js for the running weighted-average pool behind cost of goods
// sold and the value of the shed, and financials.js for the period/as-at
// distinction, which applies here identically.

import { buildDays, rollup, SUM_FIELDS } from "./periodBook.js";
import { categoryKey } from "./expenseCategories.js";

const num = (v) => Number(v) || 0;
const isActive = (t) => (t.hq_status || "processing") !== "cancelled";
const billOf = (tx) => num(tx.total_with_tax ?? tx.amount);

// Add, but stay null if any part is unknown. This is rule 2 in one function
// and it is used for every total on every statement.
export function addKnown(...xs) {
  let total = 0;
  for (const x of xs) {
    if (x === null || x === undefined) return null;
    total += Number(x) || 0;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Expenses -> the lines the accountant asked for
// ---------------------------------------------------------------------------
// Expense categories are free text typed by staff, so the same real cost
// arrives spelled several ways. This maps them onto the three expense lines on
// the Income Statement. It is deliberately generous, matches Khmer as well as
// English, and anything it does not recognise falls into "other operating
// expenses" — never silently dropped, which would quietly inflate profit.
const INTERMEDIARY = ["intermediary", "broker", "commission", "middleman", "កូនដៃ", "ចំណាយកូនដៃ"];
const WAGES = ["wage", "salary", "salaries", "staff", "payroll", "labour", "labor", "ប្រាក់ខែ", "កម្មករ"];
const INTEREST = ["interest", "loan interest", "ការប្រាក់"];
const TAXES = ["tax", "patent", "ពន្ធ"];

export function classifyExpense(category) {
  // [2026-09-16] Was String(category).trim().toLowerCase(), which does not
  // see the zero-width characters a Khmer keyboard inserts — so a ថ្លៃកូនដៃ
  // carrying one failed `.includes("កូនដៃ")` and fell into "other operating
  // expenses", off the intermediary line entirely. categoryKey() strips them,
  // the same normalisation the products unique index uses.
  const c = categoryKey(category);
  if (!c) return "other";
  const hit = (list) => list.some((k) => c.includes(k));
  if (hit(INTERMEDIARY)) return "intermediary";
  if (hit(WAGES)) return "wages";
  if (hit(INTEREST)) return "interest";
  if (hit(TAXES)) return "tax";
  return "other";
}

// transaction id -> { paid, remaining }, from the payments ledger rather than
// the transaction's own payment_status column, which is only ever what it was
// at creation time. Same rule financials.js uses.
export function paidStatusMap(txs, payments) {
  const ids = new Set(txs.map((t) => t.id));
  const paidById = {};
  for (const p of payments) {
    if (!p.transaction_id || !ids.has(p.transaction_id)) continue;
    paidById[p.transaction_id] = (paidById[p.transaction_id] || 0) + num(p.amount);
  }
  const out = {};
  for (const t of txs) {
    const total = billOf(t);
    const paid = Math.min(total, paidById[t.id] || 0);
    out[t.id] = { paid, remaining: Math.max(0, total - paid) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Depreciation — straight line, only from assets somebody has entered
// ---------------------------------------------------------------------------
// cost / useful life, apportioned to the days of the period the asset was
// actually in service. An asset bought mid-month is depreciated from the day
// it arrived, not for the whole month.
const DAY = 86400000;
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / DAY) + 1);

export function depreciationFor(assets, startDate, endDate) {
  // No asset register at all means nobody has told the system what it owns.
  // That is not the same as owning nothing, so: null, not zero.
  if (!assets || !assets.length) return null;
  if (!startDate || !endDate) return null;
  let total = 0;
  for (const a of assets) {
    const cost = num(a.cost);
    const years = num(a.useful_life_years);
    if (!cost || years <= 0) continue;               // an unusable row contributes nothing
    const from = a.in_service_date && a.in_service_date > startDate ? a.in_service_date : startDate;
    if (a.in_service_date && a.in_service_date > endDate) continue;   // not yet in service
    // Stop once the asset is fully written down.
    const lifeEnds = new Date(new Date(a.in_service_date || startDate).getTime() + years * 365 * DAY)
      .toISOString().slice(0, 10);
    const to = lifeEnds < endDate ? lifeEnds : endDate;
    if (to < from) continue;
    total += (cost / years) * (daysBetween(from, to) / 365);
  }
  return total;
}

export function accumulatedDepreciation(assets, asAt) {
  if (!assets || !assets.length) return null;
  if (!asAt) return null;
  let total = 0;
  for (const a of assets) {
    const cost = num(a.cost);
    const years = num(a.useful_life_years);
    if (!cost || years <= 0) continue;
    const start = a.in_service_date;
    if (!start || start > asAt) continue;
    const elapsed = daysBetween(start, asAt) / 365;
    total += Math.min(cost, (cost / years) * elapsed);   // never below zero book value
  }
  return total;
}

// ---------------------------------------------------------------------------
// The statements
// ---------------------------------------------------------------------------
/**
 * @param asAtTxs      every transaction up to endDate for the stations in
 *                     scope. NOT period-filtered — this module takes the
 *                     period slice itself, because a balance sheet figure is
 *                     as-at and an income statement figure is for a period.
 * @param payments     every payment up to endDate, all types, same scope.
 * @param adjustments  stock counts up to endDate, same scope.
 * @param stations     the station rows in scope (this IS the consolidation).
 * @param partners     partner rows, each with location_id and share_pct.
 * @param capitalEntries / loanEntries   partner_capital_entries / bank_loans.
 * @param assets       fixed_assets rows, or [] / null when none entered.
 * @param settings     per-station finance settings keyed by location id:
 *                     { opening_cash, tax_rate_pct, interest_rate_pct }.
 */
export function computeStatements({
  asAtTxs = [],
  payments = [],
  adjustments = [],
  stations = [],
  partners = [],
  capitalEntries = [],
  loanEntries = [],
  assets = null,
  settings = {},
  startDate = null,
  endDate = null,
} = {}) {
  const stationIds = new Set(stations.map((s) => s.id));
  const inScope = (id) => (stationIds.size ? stationIds.has(id) : true);
  const notAfterEnd = (d) => !endDate || (d && d <= endDate);
  const inPeriod = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate);

  const active = asAtTxs.filter((t) => isActive(t) && inScope(t.location_id) && notAfterEnd(t.tx_date));
  const periodTxs = active.filter((t) => t.tx_date && inPeriod(t.tx_date));
  const scopedPays = payments.filter((p) => inScope(p.location_id) && notAfterEnd(p.pay_date));
  const expensesAll = scopedPays.filter((p) => p.type === "expense");
  const expensesPeriod = expensesAll.filter((p) => p.pay_date && inPeriod(p.pay_date));
  const scopedAssets = assets === null ? null : assets.filter((a) => inScope(a.location_id));

  // The running pool: cost of goods sold and the value of the shed, from all
  // history up to the period end. Never the period's average price — see
  // periodBook.js and FIX 2 in financials.js for what that got wrong.
  //
  // [2026-09-14] EACH STATION IS POOLED ON ITS OWN, then added. Pooling every
  // station into one average shed was the first thing this module did, and it
  // is wrong: Reang Kesey's shed and Jomnoum's shed are two different piles of
  // paddy bought at two different prices, and paddy does not move between
  // them. One pooled average charged Reang Kesey's sales partly at Jomnoum's
  // cost — 50,000 ៛ of cost of goods sold appeared out of nowhere on a
  // three-station consolidation, and the same consolidation no longer equalled
  // the three stations added up. Caught by scripts-check-statements.mjs.
  const scopedAdjustments = adjustments.filter(
    (a) => inScope(a.location_id) && notAfterEnd(String(a.created_at || "").slice(0, 10)));
  const daysByStation = [...stationIds].map((id) => buildDays({
    txs: active.filter((t) => t.location_id === id),
    payments: expensesAll.filter((p) => p.location_id === id),
    adjustments: scopedAdjustments.filter((a) => a.location_id === id),
    locationIds: [id],
  }));
  const period = mergeRollups(daysByStation.map((ds) => rollup(ds.filter((d) => inPeriod(d.date)))));
  const toDate = mergeRollups(daysByStation.map((ds) => rollup(ds)));

  // ---- expenses split onto the accountant's lines --------------------------
  const bucket = (rows) => {
    const b = { intermediary: 0, wages: 0, other: 0, interest: 0, tax: 0 };
    for (const e of rows) b[classifyExpense(e.category)] += num(e.amount);
    return b;
  };
  const expP = bucket(expensesPeriod);
  const expAllToDate = expensesAll.reduce((s, e) => s + num(e.amount), 0);

  // =========================================================================
  // INCOME STATEMENT — in the order the accountant wrote it down
  // =========================================================================
  const sales = periodTxs.filter((t) => t.type === "SELL").reduce((s, t) => s + num(t.amount), 0);
  // Other income is money in that is not a paddy sale: recorded as a payment
  // of type "other_income". Nothing else is ever counted as income — found
  // paddy is not a sale, and a partner's capital is not income either.
  const otherIncome = scopedPays
    .filter((p) => p.type === "other_income" && p.pay_date && inPeriod(p.pay_date))
    .reduce((s, p) => s + num(p.amount), 0);
  const grossIncome = sales + otherIncome;

  const costOfGoodsSold = period.cogs;
  // A counted SHORTAGE is a real cost. A counted SURPLUS is not income —
  // paddy is not sold by being found — so only the negative side is taken.
  const inventoryLost = Math.min(0, period.lostValue);

  const depreciation = depreciationFor(scopedAssets, startDate, endDate);
  // Interest actually recorded as an expense. If the business carries loans
  // and nothing has been recorded, that is far more likely to be unrecorded
  // than genuinely nil, so it reads as not entered rather than as zero.
  const loansOutstanding = loanEntries
    .filter((e) => inScope(e.location_id) && notAfterEnd(e.entry_date))
    .reduce((s, e) => s + (e.type === "borrow" ? num(e.amount) : -num(e.amount)), 0);
  const interest = expP.interest > 0 ? expP.interest : (loansOutstanding > 0 ? null : 0);

  const operatingExpenses = expP.intermediary + expP.wages + expP.other;
  // Everything above the unknowns — every figure in it is real, so the pages
  // can show it as a number even while depreciation and interest are blank.
  const profitBeforeUnknowns = grossIncome - costOfGoodsSold + inventoryLost - operatingExpenses;

  const grossProfit = addKnown(profitBeforeUnknowns, depreciation === null ? null : -depreciation,
                               interest === null ? null : -interest);

  const taxRate = firstSetting(settings, stationIds, "tax_rate_pct");
  const tax = expP.tax > 0 ? expP.tax
            : (taxRate === null || grossProfit === null) ? null
            : Math.max(0, grossProfit) * (num(taxRate) / 100);
  const netProfit = addKnown(grossProfit, tax === null ? null : -tax);

  // =========================================================================
  // BALANCE SHEET — every figure AS AT the period end
  // =========================================================================
  const paidMap = paidStatusMap(active, scopedPays);
  const buys = active.filter((t) => t.type === "BUY");
  const sells = active.filter((t) => t.type === "SELL");
  const accountsPayable = buys.reduce((s, t) => s + (paidMap[t.id]?.remaining || 0), 0);
  const accountsReceivable = sells.reduce((s, t) => s + (paidMap[t.id]?.remaining || 0), 0);
  const paidBuy = buys.reduce((s, t) => s + (paidMap[t.id]?.paid || 0), 0);
  const paidSell = sells.reduce((s, t) => s + (paidMap[t.id]?.paid || 0), 0);

  const inventoryValue = toDate.closingValue;
  const inventoryKg = toDate.closingKg;
  const inventoryCostPerKg = toDate.costPerKg;

  const scopedCapital = capitalEntries.filter((e) => inScope(e.location_id) && notAfterEnd(e.entry_date));
  // Capital is what partners PUT IN, gross. Drawings — what they took out —
  // are a separate line.
  //
  // [2026-09-14] These were one net figure, AND drawings were subtracted from
  // retained earnings as well, so every riel a partner drew reduced equity
  // twice: a 1,000,000 drawing moved equity by 2,000,000. Drawings now appear
  // once, on their own line, and retained earnings is pure accumulated profit.
  // Guarded in scripts-check-statements.mjs.
  const partnerCapital = scopedCapital
    .filter((e) => e.type === "contribution")
    .reduce((s, e) => s + num(e.amount), 0);
  const drawings = scopedCapital
    .filter((e) => e.type !== "contribution")
    .reduce((s, e) => s + num(e.amount), 0);
  const capitalNet = partnerCapital - drawings;   // what actually moved in cash

  const assetCost = scopedAssets === null ? null : scopedAssets.reduce((s, a) => s + num(a.cost), 0);
  const accumDep = accumulatedDepreciation(scopedAssets, endDate);
  const fixedAssetsNet = addKnown(assetCost, accumDep === null ? null : -accumDep);

  const openingCash = sumSetting(settings, stationIds, "opening_cash");
  // Cash MOVED since the system began. Adding the opening balance turns it
  // into cash HELD; without one it is a movement, and saying so is the point.
  const cashMovement = paidSell - paidBuy + capitalNet + loansOutstanding - expAllToDate;
  const cash = addKnown(openingCash, cashMovement);

  // Current assets are always knowable — cash movement, debts and the shed all
  // come from recorded activity. Total assets waits on the asset register, so
  // the page can still show a real subtotal while fixed assets read as not
  // entered, instead of the whole sheet going blank.
  const currentAssets = addKnown(cash, accountsReceivable, inventoryValue);
  const totalAssets = addKnown(currentAssets, fixedAssetsNet);
  const accrued = 0;   // no accruals ledger yet — see the note on the page
  const totalLiabilities = accountsPayable + loansOutstanding + accrued;

  // Retained earnings is EARNED, never the figure required to make the sheet
  // balance. Accumulated profit since the system began, computed exactly the
  // way this period's profit is, less what partners have drawn out.
  const retainedEarnings =
    toDate.received - toDate.cogs - expAllToDate + Math.min(0, toDate.lostValue);
  const equity = partnerCapital - drawings + retainedEarnings;

  // Nothing is plugged, so the two sides can differ — and the gap is
  // meaningful: it is the cash the business held before the system started.
  // Reported, never hidden.
  const unreconciled = totalAssets === null ? null : totalAssets - (totalLiabilities + equity);

  // =========================================================================
  // CASH FLOW
  // =========================================================================
  const collected = sumPaymentsInPeriod(scopedPays, inPeriod, ["receive_payment", "payment"], sells);
  const paidOut = sumPaymentsInPeriod(scopedPays, inPeriod, ["pay_supplier", "payment"], buys);
  const expensesPaidPeriod = expensesPeriod.reduce((s, e) => s + num(e.amount), 0);
  const capitalInPeriod = scopedCapital
    .filter((e) => e.entry_date && inPeriod(e.entry_date))
    .reduce((s, e) => s + (e.type === "contribution" ? num(e.amount) : 0), 0);
  const drawingsInPeriod = scopedCapital
    .filter((e) => e.entry_date && inPeriod(e.entry_date) && e.type !== "contribution")
    .reduce((s, e) => s + num(e.amount), 0);
  const loansInPeriod = loanEntries
    .filter((e) => inScope(e.location_id) && e.entry_date && inPeriod(e.entry_date))
    .reduce((s, e) => s + (e.type === "borrow" ? num(e.amount) : -num(e.amount)), 0);
  const assetsBoughtInPeriod = scopedAssets === null ? null
    : scopedAssets.filter((a) => a.in_service_date && inPeriod(a.in_service_date))
        .reduce((s, a) => s + num(a.cost), 0);

  const cfOperating = collected - paidOut - expensesPaidPeriod;
  const cfInvesting = assetsBoughtInPeriod === null ? null : -assetsBoughtInPeriod;
  const cfFinancing = capitalInPeriod + loansInPeriod - drawingsInPeriod;
  const cfNet = addKnown(cfOperating, cfInvesting, cfFinancing);

  return {
    scope: { stationIds: [...stationIds], stations, startDate, endDate, consolidated: stationIds.size > 1 },

    income: {
      sales, otherIncome, grossIncome,
      costOfGoodsSold, inventoryLost,
      intermediaryFee: expP.intermediary, wages: expP.wages, otherExpenses: expP.other,
      operatingExpenses, depreciation, interest,
      profitBeforeUnknowns, grossProfit, tax, netProfit,
      soldKg: period.soldKg, boughtKg: period.boughtKg, purchases: periodTxs
        .filter((t) => t.type === "BUY").reduce((s, t) => s + num(t.amount), 0),
    },

    balance: {
      cash, cashMovement, openingCash,
      accountsReceivable, inventoryValue, inventoryKg, inventoryCostPerKg,
      currentAssets, assetCost, accumDep, fixedAssetsNet, totalAssets,
      accountsPayable, loansOutstanding, accrued, totalLiabilities,
      partnerCapital, drawings, retainedEarnings, equity,
      unreconciled,
    },

    cashflow: {
      collected, paidOut, expensesPaid: expensesPaidPeriod, cfOperating,
      // [2026-09-15] Split so the Cash Flow can show កូនដៃ on its own line, the
      // way the money is actually thought about here. "Other" is deliberately
      // the REMAINDER rather than a second bucket sum, so the two lines always
      // add back to expensesPaid exactly — a classification that misses a
      // category can never open a silent gap between them.
      expensesPaidIntermediary: expP.intermediary,
      expensesPaidOther: expensesPaidPeriod - expP.intermediary,
      assetsBought: assetsBoughtInPeriod, cfInvesting,
      capitalIn: capitalInPeriod, loansIn: loansInPeriod, drawings: drawingsInPeriod, cfFinancing,
      cfNet, openingCash, closingCash: addKnown(openingCash, cfNet),
    },

    inventory: inventoryByStation({ stations, active, expensesAll, adjustments: scopedAdjustments, inPeriod }),
    shareholders: shareholders({ stations, partners, active, periodTxs, capitalEntries, notAfterEnd,
                                 inPeriod, expensesPeriod }),
  };
}

// Add up per-station rollups into one. Flows (what was bought, sold, spent,
// lost) simply add. Levels — what is in the shed — also add, because they are
// separate sheds at the same moment. The one thing that must NOT be added is
// the RATE: cost per kg is re-derived from the pooled value over the pooled
// kilos, so a shed holding 200 kg cannot pull the average as hard as one
// holding 70,000.
function mergeRollups(rs) {
  if (rs.length === 1) return rs[0];
  const o = {};
  // SUM_FIELDS already carries cogs — adding it again in the second list would
  // double every station's cost of goods sold.
  const extra = ["profit", "cash", "openingKg", "openingValue", "closingKg", "closingValue"];
  for (const f of [...SUM_FIELDS, ...extra]) o[f] = rs.reduce((s, r) => s + (Number(r[f]) || 0), 0);
  // Days are calendar days, not a quantity: three stations trading the same
  // 30 days is 30 days, not 90.
  o.days = Math.max(0, ...rs.map((r) => Number(r.days) || 0));
  o.costPerKg = o.closingKg > 0 ? o.closingValue / o.closingKg : 0;
  o.buyPricePerKg = o.boughtKg > 0 ? o.spent / o.boughtKg : 0;
  return o;
}

// A setting that is per-station: summed across the scope, null if ANY station
// in scope has not had it entered — a group opening balance that silently
// counts four stations and ignores the fifth is worse than no figure at all.
function sumSetting(settings, stationIds, key) {
  if (!stationIds.size) return null;
  let total = 0;
  for (const id of stationIds) {
    const v = settings?.[id]?.[key];
    if (v === null || v === undefined || v === "") return null;
    total += Number(v) || 0;
  }
  return total;
}

// A setting that is a RATE: never summed. Taken only when every station in
// scope agrees on it, because there is no such thing as a consolidated tax
// rate made by adding two rates together.
function firstSetting(settings, stationIds, key) {
  const vals = [...stationIds].map((id) => settings?.[id]?.[key]);
  if (!vals.length || vals.some((v) => v === null || v === undefined || v === "")) return null;
  const first = Number(vals[0]);
  return vals.every((v) => Number(v) === first) ? first : null;
}

function sumPaymentsInPeriod(pays, inPeriod, types, txs) {
  const ids = new Set(txs.map((t) => t.id));
  return pays
    .filter((p) => types.includes(p.type) && p.transaction_id && ids.has(p.transaction_id)
                && p.pay_date && inPeriod(p.pay_date))
    .reduce((s, p) => s + num(p.amount), 0);
}

// ---------------------------------------------------------------------------
// Inventory, one row per station plus a consolidated row
// ---------------------------------------------------------------------------
function inventoryByStation({ stations, active, expensesAll, adjustments, inPeriod }) {
  const rows = stations.map((s) => {
    const days = buildDays({
      txs: active.filter((t) => t.location_id === s.id),
      payments: expensesAll.filter((p) => p.location_id === s.id),
      adjustments: adjustments.filter(
        (a) => a.location_id === s.id),   // already cut at the period end by the caller
      locationIds: [s.id],
    });
    const toDate = rollup(days);
    const period = rollup(days.filter((d) => inPeriod(d.date)));
    return {
      id: s.id, name: s.name,
      closingKg: toDate.closingKg, costPerKg: toDate.costPerKg, closingValue: toDate.closingValue,
      boughtKg: period.boughtKg, soldKg: period.soldKg,
      lostKg: period.lostKg, lostValue: period.lostValue,
    };
  });

  // The consolidated row adds the sheds — five different sheds at the same
  // moment, so that addition is valid. The RATE is re-derived from the pooled
  // value over the pooled kilos; averaging the five stations' costs would
  // weight a shed holding 200 kg the same as one holding 70,000.
  const t = rows.reduce((a, r) => ({
    closingKg: a.closingKg + r.closingKg, closingValue: a.closingValue + r.closingValue,
    boughtKg: a.boughtKg + r.boughtKg, soldKg: a.soldKg + r.soldKg,
    lostKg: a.lostKg + r.lostKg, lostValue: a.lostValue + r.lostValue,
  }), { closingKg: 0, closingValue: 0, boughtKg: 0, soldKg: 0, lostKg: 0, lostValue: 0 });
  t.costPerKg = t.closingKg > 0 ? t.closingValue / t.closingKg : 0;

  return { rows, total: t };
}

// ---------------------------------------------------------------------------
// Shareholder's Records — sales volume and value
// ---------------------------------------------------------------------------
// Holdings belong to a STATION, not to the group. Each station has its own
// partners and its own percentages, and at least one station's split does not
// follow the capital put in — so a percentage only means anything inside its
// own station, and there is no group-level percentage to compute. What can be
// done honestly is: give each holding its station's share, then add each
// PERSON up across the stations in scope. That second figure is a sum of
// amounts, never a blended percentage.
function shareholders({ stations, partners, active, periodTxs, capitalEntries, notAfterEnd, inPeriod, expensesPeriod }) {
  const holdings = [];
  for (const s of stations) {
    const mine = partners.filter((p) => p.location_id === s.id);
    const sellTxs = periodTxs.filter((t) => t.location_id === s.id && t.type === "SELL");
    const volKg = sellTxs.reduce((a, t) => a + num(t.quantity_kg), 0);
    const value = sellTxs.reduce((a, t) => a + num(t.amount), 0);

    const sDays = buildDays({
      txs: active.filter((t) => t.location_id === s.id),
      payments: expensesPeriod.filter((p) => p.location_id === s.id),
      adjustments: [], locationIds: [s.id],
    });
    const p = rollup(sDays.filter((d) => inPeriod(d.date)));
    const stationProfit = p.received - p.cogs - p.expenses + Math.min(0, p.lostValue);

    const capOf = (partnerId) => capitalEntries
      .filter((e) => e.location_id === s.id && e.partner_id === partnerId && notAfterEnd(e.entry_date))
      .reduce((a, e) => a + (e.type === "contribution" ? num(e.amount) : -num(e.amount)), 0);

    // A share that has not been entered is null — not "the rest", and not an
    // equal split, both of which would be inventions.
    const totalShare = mine.reduce((a, p2) => a + (p2.share_pct === null || p2.share_pct === undefined ? 0 : num(p2.share_pct)), 0);
    for (const partner of mine) {
      const share = partner.share_pct === null || partner.share_pct === undefined ? null : num(partner.share_pct);
      holdings.push({
        stationId: s.id, stationName: s.name,
        partnerId: partner.id, name: partner.name,
        capital: capOf(partner.id),
        sharePct: share,
        volKg: share === null ? null : volKg * share / 100,
        value: share === null ? null : value * share / 100,
        profit: share === null ? null : stationProfit * share / 100,
      });
    }
    // Say so loudly when a station's shares do not add to 100 — the report is
    // then describing something that is not a whole.
    holdings.filter((h) => h.stationId === s.id).forEach((h) => { h.stationShareTotal = totalShare; });
  }

  const byPerson = {};
  for (const h of holdings) {
    const k = h.name;
    const t = byPerson[k] || (byPerson[k] = { name: k, stations: 0, capital: 0, volKg: 0, value: 0, profit: 0, partial: false });
    t.stations++;
    t.capital += h.capital;
    if (h.volKg === null) t.partial = true;
    else { t.volKg += h.volKg; t.value += h.value; t.profit += h.profit; }
  }

  return { holdings, people: Object.values(byPerson).sort((a, b) => b.value - a.value) };
}
