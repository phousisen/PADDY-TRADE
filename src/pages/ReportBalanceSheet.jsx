// Reports → Balance Sheet.
//
// [2026-09-14] Rebuilt onto statements.js, so this page and the Income
// Statement, Cash Flow, Inventory and Shareholder's Records all read the same
// arithmetic and can never disagree about the same month.
//
// Assets = Liabilities + Equity, as at the period end. Every figure here is a
// POSITION on a date — what a farmer is owed on 30 September, whatever month
// the paddy was bought in — which is why the data is fetched as-at rather than
// cut at the period start.
//
// Two things this page will not do:
//
//   It will not PLUG. Retained earnings is accumulated profit, computed the
//   same way this period's profit is — not the figure required to make the two
//   sides agree. So the sides can differ, and when they do the gap is printed
//   with its own explanation instead of being quietly absorbed.
//
//   It will not treat a blank as a zero. With no asset register, Total Assets
//   reads "not entered" rather than silently claiming the business owns
//   nothing — but Current Assets is still a real number, so the page is useful
//   before setup is finished.
//
// [2026-09-15] Khmer pass — every label and hint now comes from i18n.jsx.
// Accounting terms follow ACAR's published Khmer IFRS-for-SMEs statements.

import { useStatements } from "../useStatements.js";
import { ReportCard } from "../components/ReportUI.jsx";
import { useLanguage } from "../i18n.jsx";
import { Explain, Line, StatementHead, StatementSummary, StationChips, ScopeBar, SetupNotice, UnreconciledNotice, fmt, fmtKg, isKnown } from "../components/StatementUI.jsx";

export default function ReportBalanceSheet({ selectedLocationIds = [], setSelectedLocationIds, startDate = null, endDate = null }) {
  const { t } = useLanguage();
  const { data, stations, raw, loading, error, setupMissing } = useStatements({ selectedLocationIds, startDate, endDate });

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">{t("loading_label")}</div>;
  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>;

  const b = data.balance;
  const asAt = endDate || t("st_today");

  return (
    <div>
      <StatementHead
        title={t("fin_bs")}
        scope={stations.length === 1 ? stations[0].name : t("st_consolidated_n", { n: stations.length })}
        asAt={asAt}
      />
      <StationChips stations={raw.stations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
      <ScopeBar stations={stations} />
      <StatementSummary cells={[
        { label: t("st_curassets"), value: b.currentAssets, sub: t("bs_sum_curassets"), why: t("bs_sum_curassets_why") },
        { label: t("fin_inv"), value: b.inventoryValue, sub: t("bs_sum_inv", { kg: fmtKg(b.inventoryKg) }) },
        { label: t("st_owedfarmers"), value: b.accountsPayable, sub: t("bs_sum_ap") },
        { label: t("st_owedus"), value: b.accountsReceivable, sub: t("bs_sum_ar") },
        { label: t("st_equity"), value: b.equity, sub: t("bs_sum_eq"), tone: "pos" },
      ]} />
      <SetupNotice missing={setupMissing} what={t("bs_setup_what")} />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------------- Assets ---------------- */}
        <ReportCard title={t("st_assets")}>
          <Line
            label={t("st_cash")}
            hint={isKnown(b.openingCash) ? t("bs_cash_hint") : t("bs_cash_hint_none")}
            value={b.cash}
            why={t("bs_cash_why")}
            indent
          />
          <Line label={t("st_ar")} hint={t("bs_ar_hint")} value={b.accountsReceivable} indent />
          <Line
            label={t("st_invline")}
            hint={t("bs_inv_hint", { kg: fmtKg(b.inventoryKg), rate: fmt(b.inventoryCostPerKg) })}
            value={b.inventoryValue} indent
          />
          <Line label={t("st_curassets")} value={b.currentAssets} total />

          <Line
            label={t("st_ppe")}
            hint={isKnown(b.assetCost)
              ? t("bs_ppe_hint", { cost: fmt(b.assetCost), dep: fmt(b.accumDep) })
              : t("bs_ppe_hint_none")}
            value={b.fixedAssetsNet}
            why={t("bs_ppe_why")}
            indent
          />
          <Line label={t("st_totassets")} value={b.totalAssets} grand />
        </ReportCard>

        {/* ---------------- Liabilities + Equity ---------------- */}
        <div className="space-y-5">
          <ReportCard title={t("st_liabilities")}>
            <Line label={t("st_ap")} hint={t("bs_ap_hint")} value={b.accountsPayable} indent />
            <Line label={t("bs_loans")} value={b.loansOutstanding} indent />
            <Line label={t("st_accrued")} hint={t("bs_accrued_hint")} value={b.accrued} indent />
            <Line label={t("st_totliab")} value={b.totalLiabilities} total />
          </ReportCard>

          <ReportCard title={t("st_equity")}>
            <Line label={t("st_capital")} hint={t("bs_capital_hint")} value={b.partnerCapital} indent />
            <Line label={t("st_drawings")} hint={t("bs_drawings_hint")} value={-b.drawings} indent signed />
            <Line label={t("st_retained")} hint={t("bs_retained_hint")} value={b.retainedEarnings} indent signed />
            <Line label={t("st_totequity")} value={b.equity} total signed />
            <Line
              label={t("bs_lplusE")}
              value={isKnown(b.totalLiabilities) && isKnown(b.equity) ? b.totalLiabilities + b.equity : null}
              grand
            />
          </ReportCard>
        </div>
      </div>

      <UnreconciledNotice value={b.unreconciled} />

      <Explain>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[12px] leading-relaxed text-slate-500">
            <b className="font-semibold text-slate-700">{t("bs_note1_t", { v: fmt(b.cashMovement) })}</b>{" "}
            {t("bs_note1_b")}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[12px] leading-relaxed text-slate-500">
            <b className="font-semibold text-slate-700">{t("bs_note2_t")}</b> {t("bs_note2_b")}
          </div>
        </div>
      </Explain>
    </div>
  );
}
