import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import ToEnter from "./FinanceStart.jsx";
import { StatementSummary } from "../components/StatementUI.jsx";
import { queryRange, rangeKey } from "../reportQuery.js";
// [2026-09-14] The figures moved to src/financials.js — see the six fixes
// documented there. Re-exported from here so the pages that have always
// imported them from this file (Purchases, Sales, PartyDetail, SimpleListPage,
// Balance Sheet, reportExport) need no change.
import { computeFinancials, paidStatusMap } from "../financials.js";
export { computeFinancials, paidStatusMap };
import { ReportCard, SectionLabel, Row, TotalBox, TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }

export default function ReportOverview({ selectedLocationIds = [], startDate = null, endDate = null, onNavigate, isAdmin }) {
  const { t } = useLanguage();
  const [txs, setTxs] = useState([]);
  const [stations, setStations] = useState([]);
  const [capitalEntries, setCapitalEntries] = useState([]);
  const [loanEntries, setLoanEntries] = useState([]);
  const [payments, setPayments] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // [2026-09-10] The period is asked of the database, not filtered out of
  // a full download afterwards. Same figures, a fraction of the data.
  const rk = rangeKey({ selectedLocationIds, startDate, endDate });
  useEffect(() => {
    // [2026-09-14] `from` is deliberately dropped: a balance sheet figure is
    // AS AT the period end, so a debt from two months ago must still be in the
    // data. The period slice for the P&L is taken inside computeFinancials.
    const range = queryRange({ selectedLocationIds, startDate, endDate });
    const asAt = { ...range, from: undefined };
    // [2026-09-14] THIS FETCH USED TO FAIL SILENTLY.
    //
    // There was no .catch here. When the call failed for any reason — a dead
    // login, a permissions rule, a network drop — `txs` simply stayed empty,
    // and every figure on the page rendered as a confident "0 ៛": zero sales,
    // zero purchases, zero stock, a balance sheet where liabilities exceed
    // assets. The page could not tell "the business did nothing" from "I could
    // not load the data", and so it showed the reader the most alarming and
    // least true of the two, with nothing on screen to say otherwise.
    //
    // A report that cannot load its data must say so. It must never print a
    // zero it did not get from the database.
    setLoadError("");
    setLoaded(false);
    Promise.all([api.getTransactions(asAt), api.getLocations()])
      .then(([t, s]) => { setTxs(t); setStations(s); setLoaded(true); })
      .catch((e) => setLoadError(e?.message || "Couldn't load transactions."));
    api.getPayments(asAt).then(setPayments).catch(() => setPayments([]));
    api.getStockAdjustments({ locationId: asAt.locationId, endDate })
      .then(setAdjustments).catch(() => setAdjustments([]));
    // Admin-only tables — a non-admin viewer (shouldn't normally reach this
    // page, but just in case) simply sees zero partner capital/bank loans
    // rather than an error.
    api.getPartnerCapitalEntries().then(setCapitalEntries).catch(() => setCapitalEntries([]));
    api.getBankLoans().then(setLoanEntries).catch(() => setLoanEntries([]));
  }, [rk]);

  const filteredStations = selectedLocationIds.length ? stations.filter((s) => selectedLocationIds.includes(s.id)) : stations;
  const activeTxs = txs
    .filter((t) => (t.hq_status || "processing") !== "cancelled")
    .filter((t) => !startDate || t.tx_date >= startDate)
    .filter((t) => !endDate || t.tx_date <= endDate);
  const filteredTxs = selectedLocationIds.length ? activeTxs.filter((t) => selectedLocationIds.includes(t.location_id)) : activeTxs;

  // Same date-range filtering as activeTxs/filteredTxs above, applied to
  // the "expense"-type rows already sitting in the payments ledger (see
  // Expenses.jsx) — kept period-scoped for the same reason Sales/Purchases
  // are, per computeFinancials' comment.
  const activeExpenses = payments
    .filter((p) => p.type === "expense")
    .filter((p) => !startDate || p.pay_date >= startDate)
    .filter((p) => !endDate || p.pay_date <= endDate);
  const filteredExpenses = selectedLocationIds.length ? activeExpenses.filter((p) => selectedLocationIds.includes(p.location_id)) : activeExpenses;

  const calc = useMemo(
    () => computeFinancials({
      asAtTxs: txs, payments, adjustments, stations: filteredStations,
      capitalEntries, loanEntries, startDate, endDate,
    }),
    [txs, payments, adjustments, filteredStations, capitalEntries, loanEntries, startDate, endDate]
  );

  const byLocation = useMemo(() => {
    return filteredStations.map((s) => {
      const c = computeFinancials({
        asAtTxs: txs, payments, adjustments, stations: [s],
        capitalEntries, loanEntries, startDate, endDate,
      });
      return { station: s, ...c };
    });
  }, [txs, payments, adjustments, filteredStations, capitalEntries, loanEntries, startDate, endDate]);

  const totalTx = filteredTxs.length;
  const buyTx = filteredTxs.filter((t) => t.type === "BUY").length;
  const sellTx = filteredTxs.filter((t) => t.type === "SELL").length;

  // [2026-09-15] The panel of five links to the statements used to sit here.
  // It was built when the statements were hidden behind a tab row that
  // scrolled sideways. They now have their own permanent column on the left,
  // so a second copy of that list on the page it opens onto is just words.

  // A failure is stated, and the zeros it would otherwise have produced are
  // not shown at all — a wrong number next to an error message still gets
  // read and believed.
  if (loadError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
        <p className="text-[14px] font-semibold text-rose-800">{t("ov_loadfail_t")}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-rose-700">{t("ov_loadfail_b")}</p>
        <p className="mt-2 rounded-md bg-white/70 px-3 py-2 font-mono text-[12px] text-rose-900">{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[13px] font-medium text-rose-700 hover:bg-rose-100"
        >
          {t("ov_tryagain")}
        </button>
      </div>
    );
  }

  // Equally: do not paint a whole balance sheet of zeros while the data is
  // still on its way.
  if (!loaded) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">
        {t("loading_label")}
      </div>
    );
  }

  // The caveat on the profit figure is only true while nothing has been
  // recorded. The day the first expense goes in, it stops being printed —
  // a warning that outlives its reason is how people learn to ignore warnings.
  const beforeExpenses = !calc.totalExpenses;

  return (
    <div>
      {/* What nobody has recorded, above the figures it would change. */}
      <ToEnter onNavigate={onNavigate} isAdmin={isAdmin} />

      {/* [2026-09-15] Five figures, the same strip every statement uses. What
          the business is holding and what it is owed each way — read off the
          weighbridge, so all five are real even with nothing else entered. */}
      <StatementSummary cells={[
        { label: t("st_inshed"), value: calc.inventoryKg, riel: false,
          sub: t("fig_kg_stations", { n: filteredStations.length }) },
        { label: t("fig_shedvalue"), value: calc.inventoryValue, sub: t("fig_riel_cost") },
        { label: t("st_owedfarmers"), value: calc.accountsPayable, sub: t("st_riel") },
        { label: t("st_owedus"), value: calc.accountsReceivable, sub: t("st_riel") },
        { label: t("fig_profit"), value: calc.netProfit,
          sub: beforeExpenses ? t("fig_profit_sub") : t("st_riel"),
          tone: calc.netProfit >= 0 ? "pos" : "neg" },
      ]} />

      {/* Profit is the one figure above that is NOT complete, so it says so
          once, here, instead of every line carrying a caveat. */}
      {beforeExpenses && (
        <div className="mb-4 rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-[12.3px] leading-relaxed text-gold-700">
          {t("fin_profitnote")}
        </div>
      )}

      {/* [2026-08-31] grid-cols-1 md:grid-cols-2 instead of a flat
          grid-cols-2 — these two panels used to squeeze side by side on a
          phone screen; now stack full-width below the md breakpoint. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ReportCard title={t("ov_pl")} subtitle={t("ov_txcount", { n: totalTx })}>
          <Row label={t("ov_sales")} value={`${fmt(calc.totalSell)} ៛`} onClick={onNavigate ? () => onNavigate("sales") : undefined} />
          {/* [2026-09-14] This line used to read "Total Purchases (COGS)" and
              show everything bought in the period. Buying paddy is not a cost
              until it is sold — what the paddy that actually SHIPPED cost is.
              Purchases are still shown, below, as the separate thing they are. */}
          <Row label={t("ov_cogs")} value={`${fmt(-calc.costOfGoodsSold)} ៛`} />
          <TotalBox><Row label={t("ov_grossprofit")} value={`${fmt(calc.grossProfit)} ៛`} bold tone={calc.grossProfit >= 0 ? "pos" : "neg"} /></TotalBox>
          <Row label={t("ov_opex")} value={`${fmt(-calc.totalExpenses)} ៛`} />
          {calc.stockLossValue < 0 && (
            <Row label={t("ov_stockloss")} value={`${fmt(calc.stockLossValue)} ៛`} tone="neg" />
          )}
          <TotalBox><Row label={t("ov_netprofit")} value={`${fmt(calc.netProfit)} ៛`} bold tone={calc.netProfit >= 0 ? "pos" : "neg"} /></TotalBox>
          <SectionLabel>{t("ov_reference")}</SectionLabel>
          <Row label={t("ov_purchased")} value={`${fmt(calc.totalBuy)} ៛`} indent onClick={onNavigate ? () => onNavigate("purchases") : undefined} />
        </ReportCard>
        <ReportCard
          title={t("ov_bs")}
          subtitle={endDate ? t("ov_asat", { date: endDate }) : t("ov_astoday")}
        >
          {onNavigate && (
            <button onClick={() => onNavigate("balancesheet")} className="float-right -mt-8 text-[11.5px] font-medium text-brand-600 hover:underline">{t("ov_full")}</button>
          )}
          <SectionLabel>{t("st_assets")}</SectionLabel>
          <Row label={t("ov_inventory")} value={`${fmt(calc.inventoryValue)} ៛`} indent onClick={onNavigate ? () => onNavigate("stock") : undefined} />
          <Row label={t("ov_ar")} value={`${fmt(calc.accountsReceivable)} ៛`} indent onClick={onNavigate ? () => onNavigate("receivables") : undefined} />
          {/* [2026-09-14] No longer floored at zero — an overdrawn business
              used to display as having none. */}
          <Row label={t("ov_cash")} value={`${fmt(calc.cashEstimate)} ៛`} indent tone={calc.cashEstimate < 0 ? "neg" : undefined} onClick={onNavigate ? () => onNavigate("cashflow") : undefined} />
          <Row label={t("ov_totassets")} value={`${fmt(calc.totalAssets)} ៛`} bold />
          <SectionLabel>{t("st_liabilities")}</SectionLabel>
          <Row label={t("ov_ap")} value={`${fmt(calc.accountsPayable)} ៛`} indent onClick={onNavigate ? () => onNavigate("payables") : undefined} />
          <Row label={t("ov_loans")} value={`${fmt(calc.bankLoansOutstanding)} ៛`} indent onClick={onNavigate ? () => onNavigate("capital") : undefined} />
          <Row label={t("ov_totliab")} value={`${fmt(calc.totalLiabilities)} ៛`} bold />
          <SectionLabel>{t("st_equity")}</SectionLabel>
          <Row label={t("ov_capital")} value={`${fmt(calc.partnerCapital)} ៛`} indent onClick={onNavigate ? () => onNavigate("capital") : undefined} />
          <Row label={t("ov_retained")} value={`${fmt(calc.retainedEarnings)} ៛`} indent />
          <TotalBox><Row label={t("ov_equity")} value={`${fmt(calc.equity)} ៛`} bold /></TotalBox>
          {/* [2026-09-14] Retained earnings used to be whatever made the sheet
              balance. It is now accumulated profit, so the two sides can differ
              — and the gap is reported rather than hidden inside equity. */}
          {Math.abs(calc.unreconciled) > 1 && (
            <div className="mt-3 rounded-lg border border-gold-300 bg-gold-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-gold-700">
              <b>{t("ov_unexp", { v: fmt(calc.unreconciled) })}</b> {t("ov_unexp_b")}
            </div>
          )}
        </ReportCard>
      </div>

      {byLocation.length > 1 && (
        <TableCard title={t("ov_bylocation")} className="mt-4">
          <Table>
            <thead>
              <tr>
                <Th>{t("ov_th_location")}</Th><Th num>{t("ov_sales")}</Th><Th num>{t("ov_th_purchases")}</Th><Th num>{t("ov_th_profit")}</Th><Th num>{t("ov_th_inventory")}</Th><Th num>{t("ov_th_payable")}</Th>
              </tr>
            </thead>
            <tbody>
              {byLocation.map((row) => (
                <Tr key={row.station.id}>
                  <Td name>{row.station.name}</Td>
                  <Td num>{fmt(row.totalSell)} ៛</Td>
                  <Td num>{fmt(row.totalBuy)} ៛</Td>
                  <Td num className={row.grossProfit >= 0 ? "!text-brand-700 !font-semibold" : "!text-rose-600 !font-semibold"}>{fmt(row.grossProfit)} ៛</Td>
                  <Td num>{fmt(row.inventoryValue)} ៛</Td>
                  <Td num>{fmt(row.accountsPayable)} ៛</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}

    </div>
  );
}
