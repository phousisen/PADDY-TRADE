import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import ToEnter from "./FinanceStart.jsx";
import { Amount, StatementSummary, UnreconciledNotice, fmt as fmtSt, isKnown } from "../components/StatementUI.jsx";
import { rangeKey } from "../reportQuery.js";
// [2026-10-03] THE FIGURES COME FROM statements.js NOW (full check M1).
// This page read financials.js while the Balance Sheet, Income Statement and
// Cash Flow read statements.js, and the two disagreed: cash here was the
// movement only (no opening balance, no assets bought), VAT owed was missing
// from the liabilities, and net profit ignored depreciation, interest and tax
// even when they were "not entered" on the Income Statement. It now uses the
// same hook as those screens — one fetch, one computeStatements — so the
// Overview cannot show a different cash, debt or profit for the same month.
//
// paidStatusMap is still re-exported from here for the pages that have always
// imported it from this file (Purchases, Sales, PartyDetail, SimpleListPage);
// it is the same rule in financials.js and statements.js.
import { paidStatusMap } from "../financials.js";
export { paidStatusMap };
import { useStatements } from "../useStatements.js";
import { computeStatements, unconfirmedExpenses } from "../statements.js";
import { ReportCard, SectionLabel, Row, TotalBox, TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }

export default function ReportOverview({ selectedLocationIds = [], startDate = null, endDate = null, onNavigate, isAdmin }) {
  const { t } = useLanguage();
  // [2026-10-03] One hook for everything, as the statement pages (full
  // check M1). It also fixes full check M12: the old page set `loaded` as
  // soon as the TRANSACTIONS arrived and filled in payments, counts, capital
  // and loans as each landed — for a few seconds "owed to farmers" was every
  // bill ever and cash went negative. useStatements loads them all in one
  // Promise.all and stays `loading` until every one is in; a failure in any
  // money input is an error, never an empty list.
  const { data, stations: filteredStations, raw, loading, error } =
    useStatements({ selectedLocationIds, startDate, endDate });

  // [2026-10-03] Expense confirmations, for the "not yet confirmed" line the
  // Daily Book shows (full check M14). Same fallback as the Daily Book: if
  // they cannot be read (or confirmation is not set up) there is no line,
  // and nothing else on the page changes. `undefined` = still loading.
  const rk = rangeKey({ selectedLocationIds, startDate, endDate });
  const [reviews, setReviews] = useState(undefined);
  useEffect(() => {
    let alive = true;
    setReviews(undefined);
    api.getExpenseReviews()
      .then((r) => { if (alive) setReviews(r); })
      .catch(() => { if (alive) setReviews(null); });
    return () => { alive = false; };
  }, [rk]);

  // Per station, from the same arithmetic — consolidation is addition, so
  // these rows add up to the totals above them.
  const byLocation = useMemo(() => {
    if (filteredStations.length < 2) return [];
    return filteredStations.map((s) => ({
      station: s,
      st: computeStatements({
        asAtTxs: raw.txs, payments: raw.payments, adjustments: raw.adjustments, stations: [s],
        partners: raw.partners, capitalEntries: raw.capitalEntries, loanEntries: raw.loanEntries,
        assets: raw.assets, settings: raw.settings, startDate, endDate,
      }),
    }));
  }, [raw, filteredStations, startDate, endDate]);

  const unconfirmed = useMemo(() => unconfirmedExpenses({
    payments: raw.payments, reviews: reviews || null,
    stationIds: filteredStations.map((s) => s.id), startDate, endDate,
  }), [raw.payments, reviews, filteredStations, startDate, endDate]);

  const scopeIds = new Set(filteredStations.map((s) => s.id));
  const filteredTxs = (raw.txs || [])
    .filter((t) => (t.hq_status || "processing") !== "cancelled")
    .filter((t) => !startDate || t.tx_date >= startDate)
    .filter((t) => !endDate || t.tx_date <= endDate)
    .filter((t) => !scopeIds.size || scopeIds.has(t.location_id));
  const totalTx = filteredTxs.length;

  // [2026-09-15] The panel of five links to the statements used to sit here.
  // It was built when the statements were hidden behind a tab row that
  // scrolled sideways. They now have their own permanent column on the left,
  // so a second copy of that list on the page it opens onto is just words.

  // A failure is stated, and the zeros it would otherwise have produced are
  // not shown at all — a wrong number next to an error message still gets
  // read and believed.
  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
        <p className="text-[14px] font-semibold text-rose-800">{t("ov_loadfail_t")}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-rose-700">{t("ov_loadfail_b")}</p>
        <p className="mt-2 rounded-md bg-white/70 px-3 py-2 font-mono text-[12px] text-rose-900">{error}</p>
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
  // still on its way. [2026-10-03] Until EVERY load is in, the expense
  // confirmations included (full check M12, M14).
  if (loading || reviews === undefined) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">
        {t("loading_label")}
      </div>
    );
  }

  const inc = data.income;
  const bal = data.balance;
  // [2026-10-03] A figure nobody has entered shows as "not entered", the way
  // the statements show it, never as 0 (statements.js rule 2; full check M1).
  const money = (v) => (isKnown(v) ? `${fmt(v)} ៛` : <Amount v={null} />);
  const toneOf = (v) => (!isKnown(v) ? undefined : v >= 0 ? "pos" : "neg");
  // Sales less the cost of the paddy sold. Same meaning as before, and the
  // by-station rows below add up to it.
  const gross = (i) => i.sales - i.costOfGoodsSold;
  const profitKnown = isKnown(inc.netProfit);

  // The caveat on the profit figure is only true while nothing has been
  // recorded. The day the first expense goes in, it stops being printed —
  // a warning that outlives its reason is how people learn to ignore warnings.
  const beforeExpenses = !data.cashflow.expensesPaid;

  return (
    <div>
      {/* What nobody has recorded, above the figures it would change. */}
      <ToEnter onNavigate={onNavigate} isAdmin={isAdmin} />

      {/* [2026-09-15] Five figures, the same strip every statement uses. What
          the business is holding and what it is owed each way — read off the
          weighbridge, so all five are real even with nothing else entered.
          [2026-10-03] The profit cell is the Income Statement's net profit;
          while depreciation, interest or tax is not entered it shows the
          Income Statement's "profit before dep/int/tax" instead, labelled as
          such, rather than a net profit the statement does not have (M1). */}
      <StatementSummary cells={[
        { label: t("st_inshed"), value: bal.inventoryKg, riel: false,
          sub: t("fig_kg_stations", { n: filteredStations.length }) },
        { label: t("fig_shedvalue"), value: bal.inventoryValue, sub: t("fig_riel_cost") },
        { label: t("st_owedfarmers"), value: bal.accountsPayable, sub: t("st_riel") },
        { label: t("st_owedus"), value: bal.accountsReceivable, sub: t("st_riel") },
        profitKnown
          ? { label: t("fig_profit"), value: inc.netProfit,
              sub: beforeExpenses ? t("fig_profit_sub") : t("st_riel"),
              tone: inc.netProfit >= 0 ? "pos" : "neg" }
          : { label: t("is_sum_pbdit"), value: inc.profitBeforeUnknowns,
              sub: beforeExpenses ? t("fig_profit_sub") : t("is_sum_pbdit_sub"),
              tone: inc.profitBeforeUnknowns >= 0 ? "pos" : "neg" },
      ]} />

      {/* Profit is the one figure above that is NOT complete, so it says so
          once, here, instead of every line carrying a caveat. */}
      {beforeExpenses && (
        <div className="mb-4 rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-[12.3px] leading-relaxed text-gold-700">
          {t("fin_profitnote")}
        </div>
      )}

      {/* [2026-10-03] Same words as the Daily Book (full check M14): the
          expenses are counted in the profit above, but a manager has not
          confirmed them yet, so they may still change. */}
      {unconfirmed > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900">
          <i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
          {t("db_exp_unconfirmed", { amount: `${Math.round(unconfirmed).toLocaleString("en-US")} ៛` })}
        </div>
      )}

      {/* [2026-08-31] grid-cols-1 md:grid-cols-2 instead of a flat
          grid-cols-2 — these two panels used to squeeze side by side on a
          phone screen; now stack full-width below the md breakpoint. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ReportCard title={t("ov_pl")} subtitle={t("ov_txcount", { n: totalTx })}>
          {onNavigate && (
            <button onClick={() => onNavigate("income")} className="float-right -mt-8 text-[11.5px] font-medium text-brand-600 hover:underline">{t("ov_full")}</button>
          )}
          <Row label={t("ov_sales")} value={`${fmt(inc.sales)} ៛`} onClick={onNavigate ? () => onNavigate("sales") : undefined} />
          {/* [2026-09-14] This line used to read "Total Purchases (COGS)" and
              show everything bought in the period. Buying paddy is not a cost
              until it is sold — what the paddy that actually SHIPPED cost is.
              Purchases are still shown, below, as the separate thing they are. */}
          <Row label={t("ov_cogs")} value={`${fmt(-inc.costOfGoodsSold)} ៛`} />
          <TotalBox><Row label={t("ov_grossprofit")} value={`${fmt(gross(inc))} ៛`} bold tone={toneOf(gross(inc))} /></TotalBox>
          {/* [2026-10-03] The Income Statement's lines below gross profit, so
              this card ends on the same net profit (full check M1). */}
          {inc.otherIncome !== 0 && <Row label={t("st_otherincome")} value={`${fmt(inc.otherIncome)} ៛`} />}
          <Row label={t("ov_opex")} value={`${fmt(-inc.operatingExpenses)} ៛`} />
          {inc.inventoryLost < 0 && (
            <Row label={t("ov_stockloss")} value={`${fmt(inc.inventoryLost)} ៛`} tone="neg" />
          )}
          <TotalBox><Row label={t("is_sum_pbdit")} value={`${fmt(inc.profitBeforeUnknowns)} ៛`} bold tone={toneOf(inc.profitBeforeUnknowns)} /></TotalBox>
          <Row label={t("st_depreciation")} value={money(isKnown(inc.depreciation) ? -inc.depreciation : null)} indent />
          <Row label={t("st_interest")} value={money(isKnown(inc.interest) ? -inc.interest : null)} indent />
          <Row label={t("st_tax")} value={money(isKnown(inc.tax) ? -inc.tax : null)} indent />
          <TotalBox><Row label={t("ov_netprofit")} value={money(inc.netProfit)} bold tone={toneOf(inc.netProfit)} /></TotalBox>
          <SectionLabel>{t("ov_reference")}</SectionLabel>
          <Row label={t("ov_purchased")} value={`${fmt(inc.purchases)} ៛`} indent onClick={onNavigate ? () => onNavigate("purchases") : undefined} />
        </ReportCard>
        <ReportCard
          title={t("ov_bs")}
          subtitle={endDate ? t("ov_asat", { date: endDate }) : t("ov_astoday")}
        >
          {onNavigate && (
            <button onClick={() => onNavigate("balancesheet")} className="float-right -mt-8 text-[11.5px] font-medium text-brand-600 hover:underline">{t("ov_full")}</button>
          )}
          <SectionLabel>{t("st_assets")}</SectionLabel>
          <Row label={t("ov_inventory")} value={`${fmt(bal.inventoryValue)} ៛`} indent onClick={onNavigate ? () => onNavigate("stock") : undefined} />
          <Row label={t("ov_ar")} value={`${fmt(bal.accountsReceivable)} ៛`} indent onClick={onNavigate ? () => onNavigate("receivables") : undefined} />
          {/* [2026-10-03] The Balance Sheet's cash — the opening balance plus
              every movement since, less fixed assets bought — not the
              movement alone (full check M1). Without an opening balance it
              reads "not entered", and the movement is said under it. */}
          <Row label={t("st_cash")} value={money(bal.cash)} indent tone={isKnown(bal.cash) && bal.cash < 0 ? "neg" : undefined} onClick={onNavigate ? () => onNavigate("cashflow") : undefined} />
          {!isKnown(bal.cash) && (
            <p className="-mt-1 pb-1.5 pl-4 text-[11.5px] text-slate-400">{t("bs_note1_t", { v: fmtSt(bal.cashMovement) })}</p>
          )}
          {isKnown(bal.assetCost) && <Row label={t("st_ppe")} value={money(bal.fixedAssetsNet)} indent />}
          <Row label={t("ov_totassets")} value={money(bal.totalAssets)} bold />
          <SectionLabel>{t("st_liabilities")}</SectionLabel>
          <Row label={t("ov_ap")} value={`${fmt(bal.accountsPayable)} ៛`} indent onClick={onNavigate ? () => onNavigate("payables") : undefined} />
          <Row label={t("ov_loans")} value={`${fmt(bal.loansOutstanding)} ៛`} indent onClick={onNavigate ? () => onNavigate("capital") : undefined} />
          {Math.abs(bal.vatNet || 0) > 0.5 && <Row label={t("bs_vat")} value={`${fmt(bal.vatNet)} ៛`} indent />}
          <Row label={t("ov_totliab")} value={`${fmt(bal.totalLiabilities)} ៛`} bold />
          <SectionLabel>{t("st_equity")}</SectionLabel>
          <Row label={t("ov_capital")} value={`${fmt(bal.partnerCapital)} ៛`} indent onClick={onNavigate ? () => onNavigate("capital") : undefined} />
          {bal.drawings > 0 && <Row label={t("st_drawings")} value={`${fmt(-bal.drawings)} ៛`} indent />}
          <Row label={t("ov_retained")} value={`${fmt(bal.retainedEarnings)} ៛`} indent />
          {Math.abs(bal.openingEquity || 0) > 0.5 && <Row label={t("bs_opening_equity")} value={`${fmt(bal.openingEquity)} ៛`} indent />}
          <TotalBox><Row label={t("ov_equity")} value={`${fmt(bal.equity)} ៛`} bold /></TotalBox>
          {/* [2026-09-14] Retained earnings used to be whatever made the sheet
              balance. It is now accumulated profit, so the two sides can differ
              — and the gap is reported rather than hidden inside equity.
              [2026-10-03] The Balance Sheet's own notice and wording (M1). */}
          <UnreconciledNotice value={bal.unreconciled} />
        </ReportCard>
      </div>

      {byLocation.length > 1 && (
        <TableCard title={t("ov_bylocation")} className="mt-4">
          <Table>
            <thead>
              <tr>
                {/* [2026-10-03] "Gross Profit", not "Profit" (full check M13):
                    the column is sales less the cost of the paddy sold, before
                    expenses, so it adds up to the Gross Profit line above —
                    not to Net Profit, which it was being read as. */}
                <Th>{t("ov_th_location")}</Th><Th num>{t("ov_sales")}</Th><Th num>{t("ov_th_purchases")}</Th><Th num>{t("ov_grossprofit")}</Th><Th num>{t("ov_th_inventory")}</Th><Th num>{t("ov_th_payable")}</Th>
              </tr>
            </thead>
            <tbody>
              {byLocation.map(({ station, st }) => (
                <Tr key={station.id}>
                  <Td name>{station.name}</Td>
                  <Td num>{fmt(st.income.sales)} ៛</Td>
                  <Td num>{fmt(st.income.purchases)} ៛</Td>
                  <Td num className={gross(st.income) >= 0 ? "!text-brand-700 !font-semibold" : "!text-rose-600 !font-semibold"}>{fmt(gross(st.income))} ៛</Td>
                  <Td num>{fmt(st.balance.inventoryValue)} ៛</Td>
                  <Td num>{fmt(st.balance.accountsPayable)} ៛</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}

    </div>
  );
}
