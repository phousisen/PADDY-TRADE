// The financial figures behind Reports → Overview, Balance Sheet and the
// Excel export. One place, so those three can never disagree.
//
// [2026-09-14] Replaces computeFinancials() in ReportOverview.jsx, which had
// six defects. Each is named below where it is fixed, because the numbers this
// file produces are DIFFERENT from what the app showed before — they are right
// now, but they will not match yesterday's screen.
//
// ---------------------------------------------------------------------------
// The period / as-at distinction, which is what most of the old bugs came from
// ---------------------------------------------------------------------------
// An Income Statement figure belongs to a PERIOD: sales in September.
// A Balance Sheet figure is a point in time, AS AT the period end: everything
// a farmer is owed on 30 September, whenever the paddy was bought.
//
// The old code used period-filtered transactions for both, so a debt from July
// simply vanished from a September report, and the shed was valued using a
// September-only average price. Callers now pass `asAtTxs` — every transaction
// up to the period end — and this file takes the period slice itself.

import { buildDays, rollup } from "./periodBook.js";
import { effectiveAdjDateStr } from "./dailyLedger.js";

const num = (v) => Number(v) || 0;

// What a transaction is actually owed on. total_with_tax where it exists,
// falling back to amount — the same rule paidStatusMap has always used.
const billOf = (tx) => num(tx.total_with_tax ?? tx.amount);

// transaction id -> { paid, remaining }, computed live from the payments
// ledger. The payment_status column on the transaction is only what it was at
// creation time and does not update when a payment is later recorded.
export function paidStatusMap(txs, payments) {
  const txIds = new Set(txs.map((t) => t.id));
  const paidById = {};
  for (const p of payments) {
    if (!p.transaction_id || !txIds.has(p.transaction_id)) continue;
    paidById[p.transaction_id] = (paidById[p.transaction_id] || 0) + num(p.amount);
  }
  const result = {};
  for (const t of txs) {
    const total = billOf(t);
    const paid = Math.min(total, paidById[t.id] || 0);
    result[t.id] = { paid, remaining: Math.max(0, total - paid) };
  }
  return result;
}

const isActive = (t) => (t.hq_status || "processing") !== "cancelled";

/**
 * @param asAtTxs      every transaction up to endDate, already scoped to the
 *                     chosen stations. NOT period-filtered — this file slices
 *                     the period itself.
 * @param payments     every payment up to endDate (all types), same scope.
 * @param adjustments  stock counts up to endDate, same scope.
 * @param stations     the station rows in scope.
 * @param startDate    period start, or null for "since the beginning".
 * @param endDate      period end, or null for "up to today".
 */
export function computeFinancials({
  asAtTxs = [],
  payments = [],
  adjustments = [],
  stations = [],
  capitalEntries = [],
  loanEntries = [],
  startDate = null,
  endDate = null,
} = {}) {
  const stationIds = new Set(stations.map((s) => s.id));
  const inScope = (locId) => (stationIds.size ? stationIds.has(locId) : true);

  // Cut at the period end here rather than trusting the caller to have done
  // it. A balance sheet is AS AT a date: a sale made after it has not happened
  // yet, and must not empty the shed or settle a debt early.
  const notAfterEnd = (d) => !endDate || (d && d <= endDate);
  const active = asAtTxs.filter(
    (t) => isActive(t) && inScope(t.location_id) && notAfterEnd(t.tx_date));
  const inPeriod = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate);
  const periodTxs = active.filter((t) => t.tx_date && inPeriod(t.tx_date));

  const scopedPayments = payments.filter((p) => inScope(p.location_id) && notAfterEnd(p.pay_date));
  const expensesAll = scopedPayments.filter((p) => p.type === "expense");
  const expensesPeriod = expensesAll.filter((p) => p.pay_date && inPeriod(p.pay_date));

  // -------------------------------------------------------------------------
  // The running weighted-average pool, built from ALL history up to the period
  // end. This is what gives a real cost of goods sold and a real inventory
  // value — see periodBook.js for why the average and not the day's price.
  // -------------------------------------------------------------------------
  // [2026-09-14] EACH STATION IS POOLED ON ITS OWN, then added — the same fix
  // statements.js carries, for the same reason. Reang Kesey's shed and
  // Jomnoum's shed are two different piles of paddy bought at two different
  // prices, and paddy does not move between them; one pooled average charges
  // one station's sales partly at another's cost. Overview and the Balance
  // Sheet read from different modules, so the fix has to exist in both or the
  // two screens disagree the moment more than one station is selected.
  // [2026-09-19] Dated by the shared after-midnight rule (see statements.js).
  const scopedAdj = adjustments.filter(
    (a) => inScope(a.location_id) && a.created_at && notAfterEnd(effectiveAdjDateStr(a)));
  const perStation = [...stationIds].map((id) => buildDays({
    txs: active.filter((t) => t.location_id === id),
    payments: expensesAll.filter((p) => p.location_id === id),
    adjustments: scopedAdj.filter((a) => a.location_id === id),
    locationIds: [id],
  }));
  const add = (rs) => {
    // [2026-09-19] No stations loaded: an empty rollup of zeros, not {} —
    // {} made every profit and stock figure NaN, exported as 0.
    if (rs.length === 0) return rollup([]);
    if (rs.length === 1) return rs[0];
    const o = {};
    for (const k of Object.keys(rs[0] || {})) o[k] = rs.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    // A rate is re-derived from the pooled figures, never summed.
    o.costPerKg = o.closingKg > 0 ? o.closingValue / o.closingKg : 0;
    o.buyPricePerKg = o.boughtKg > 0 ? o.spent / o.boughtKg : 0;
    o.days = Math.max(0, ...rs.map((r) => Number(r.days) || 0));
    return o;
  };
  const period = add(perStation.map((ds) => rollup(ds.filter((d) => inPeriod(d.date)))));
  const toDate = add(perStation.map((ds) => rollup(ds)));

  const totalSell = periodTxs.filter((t) => t.type === "SELL").reduce((s, t) => s + num(t.amount), 0);
  const totalBuy = periodTxs.filter((t) => t.type === "BUY").reduce((s, t) => s + num(t.amount), 0);
  const totalExpenses = expensesPeriod.reduce((s, e) => s + num(e.amount), 0);

  // FIX 1 — gross profit was `sales − purchases`, which is a cash margin, not
  // profit. Buying paddy is not a cost until it is sold; what it cost to buy
  // the paddy that ACTUALLY SHIPPED is. On a heavy buying month the old figure
  // showed a loss the business had not made.
  const costOfGoodsSold = period.cogs;
  const grossProfit = totalSell - costOfGoodsSold;

  // FIX 6 — stock written off on a physical count never reached the profit at
  // all. It is a real cost and now appears as one. (A counted SURPLUS is not
  // taken as income; found paddy is not a sale.)
  // [2026-09-19] Loss by loss — a surplus never cancels a loss.
  const stockLossValue = num(period.lossValue);
  const netProfit = grossProfit - totalExpenses + stockLossValue;

  // -------------------------------------------------------------------------
  // Balance sheet — every figure AS AT the period end
  // -------------------------------------------------------------------------
  // FIX 3 — payables and receivables were computed from period transactions
  // only, so a farmer unpaid since July did not appear on a September report.
  // They are point-in-time balances and must look at everything up to the end.
  const paidMap = paidStatusMap(active, scopedPayments);
  const buys = active.filter((t) => t.type === "BUY");
  const sells = active.filter((t) => t.type === "SELL");
  const accountsPayable = buys.reduce((s, t) => s + (paidMap[t.id]?.remaining || 0), 0);
  const accountsReceivable = sells.reduce((s, t) => s + (paidMap[t.id]?.remaining || 0), 0);
  const paidBuy = buys.reduce((s, t) => s + (paidMap[t.id]?.paid || 0), 0);
  const paidSell = sells.reduce((s, t) => s + (paidMap[t.id]?.paid || 0), 0);

  // FIX 2 — inventory was `all-time stock kg × the PERIOD's average buy price`.
  // Open a report on the 1st of a month before anyone had bought anything and
  // that average was zero: the whole shed was valued at 0 ៛. It is now the
  // running weighted-average cost of the paddy actually in the shed.
  const inventoryValue = toDate.closingValue;
  const inventoryKg = toDate.closingKg;
  const inventoryCostPerKg = toDate.costPerKg;

  // [2026-09-19] Only entries dated by the period end, as on the Balance
  // Sheet page — a loan drawn on 10 Sep appeared on the 31 Aug overview.
  const scopedCapital = capitalEntries.filter((e) => inScope(e.location_id) && notAfterEnd(e.entry_date));
  const scopedLoans = loanEntries.filter((e) => inScope(e.location_id) && notAfterEnd(e.entry_date));
  const bankLoansOutstanding = scopedLoans.reduce(
    (s, e) => s + (e.type === "borrow" ? num(e.amount) : -num(e.amount)), 0);
  const partnerCapital = scopedCapital.reduce(
    (s, e) => s + (e.type === "contribution" ? num(e.amount) : -num(e.amount)), 0);

  // FIX 4 — cash was floored at zero (`Math.max(0, …)`), so an overdrawn
  // business displayed as having none rather than as owing. It is reported as
  // it computes, negative included.
  //
  // It remains a DERIVED figure: money in less money out since the system
  // began, with no opening balance behind it. `cashIsDerived` says so, and the
  // reports label it accordingly.
  const allExpensesToDate = expensesAll.reduce((s, e) => s + num(e.amount), 0);
  const cashDerived = paidSell - paidBuy + partnerCapital + bankLoansOutstanding - allExpensesToDate;

  // FIX 5 — retained earnings was `equity − partnerCapital`: a plug, the
  // number required to make the sheet balance rather than a number the
  // business earned. It is now the accumulated profit since the system began,
  // computed exactly the way this period's profit is.
  const retainedEarnings =
    toDate.received - toDate.cogs - allExpensesToDate + num(toDate.lossValue);

  const totalLiabilities = accountsPayable + bankLoansOutstanding;
  const equity = partnerCapital + retainedEarnings;
  const totalAssets = cashDerived + accountsReceivable + inventoryValue;

  // Because nothing is plugged any more, the two sides can differ — and the
  // gap is meaningful: it is the cash the business held before the system
  // started, which nobody has ever entered. Recording an opening balance
  // closes it. Reported rather than hidden.
  const unreconciled = totalAssets - (totalLiabilities + equity);

  return {
    // period figures
    totalBuy, totalSell, costOfGoodsSold, grossProfit, totalExpenses, stockLossValue, netProfit,
    soldKg: period.soldKg, boughtKg: period.boughtKg,
    // as-at figures
    accountsPayable, accountsReceivable, paidBuy, paidSell,
    inventoryValue, inventoryKg, inventoryCostPerKg,
    cashEstimate: cashDerived, cashIsDerived: true,
    bankLoansOutstanding, partnerCapital, retainedEarnings,
    totalAssets, totalLiabilities, equity, unreconciled,
    // so a page can warn about paddy that shipped without being in the shed
    shortfallKg: period.shortfallKg, shortfallValue: period.shortfallValue,
  };
}
