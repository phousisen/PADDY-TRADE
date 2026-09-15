// Reports → Cash Flow.
//
// [2026-09-14] Rebuilt onto statements.js: operating, investing, financing,
// in the shape an accountant expects, from the same arithmetic as the Balance
// Sheet and the Income Statement.
//
// The distinction this page exists to make: PROFIT AND CASH ARE NOT THE SAME
// NUMBER and are not supposed to be. Profit is what was earned — sales less
// what the paddy that shipped cost, less expenses. Cash is what moved. A month
// spent filling the shed earns little and drains cash; a month emptying it does
// the reverse. The two differ by exactly the change in the value of the shed
// plus what is owed in each direction, and that reconciliation is shown at the
// bottom rather than left for the reader to wonder about.
//
// Without an opening balance this statement is honest about being a MOVEMENT
// and not a closing balance — see the note on the page.

import { useStatements } from "../useStatements.js";
import { useLanguage } from "../i18n.jsx";
import { ReportCard } from "../components/ReportUI.jsx";
import { Line, StatementHead, StatementSummary, StationChips, ScopeBar, fmt, isKnown } from "../components/StatementUI.jsx";

export default function ReportCashFlow({ selectedLocationIds = [], setSelectedLocationIds, startDate = null, endDate = null }) {
  const { t } = useLanguage();
  const { data, stations, raw, loading, error } = useStatements({ selectedLocationIds, startDate, endDate });

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">{t("loading_label")}</div>;
  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>;

  const c = data.cashflow;
  const i = data.income;
  const period = startDate && endDate ? t("st_period_between", { a: startDate, b: endDate }) : t("st_period_all");

  const SECTION = "mb-1 mt-5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-700";

  return (
    <div>
      <StatementHead
        title={t("cf_title")}
        scope={stations.length === 1 ? stations[0].name : t("st_consolidated_n", { n: stations.length })}
        period={period}
      />
      <StationChips stations={raw.stations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
      <ScopeBar stations={stations} />
      <StatementSummary cells={[
        { label: t("st_collected"), value: c.collected },
        { label: t("st_paidfarmers"), value: c.paidOut },
        { label: t("st_expensespaid"), value: c.expensesPaid },
        { label: t("st_netmove"), value: c.cfNet, sub: t("cf_netmove_sub") },
        { label: t("st_closecash"), value: c.closingCash, sub: t("cf_closing_sub"), why: t("cf_opencash_why") },
      ]} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <ReportCard>
          <p className={SECTION.replace("mt-5", "mt-1")}>{t("st_actop")}</p>
          <Line label={t("st_collected")} value={c.collected} indent />
          <Line label={t("st_paidfarmers")} value={-c.paidOut} indent signed />
          <Line label={t("st_expensespaid")} value={-c.expensesPaid} indent signed />
          <Line label={t("cf_netop")} value={c.cfOperating} total signed />

          <p className={SECTION}>{t("st_actinv")}</p>
          <Line
            label={t("cf_ppebought")}
            hint={t("cf_ppebought_hint")}
            value={isKnown(c.assetsBought) ? -c.assetsBought : null}
            why={t("cf_ppebought_why")}
            indent signed
          />
          <Line label={t("cf_netinv")} value={c.cfInvesting} total signed />

          <p className={SECTION}>{t("st_actfin")}</p>
          <Line label={t("st_capital")} value={c.capitalIn} indent />
          <Line label={t("cf_loansnet")} value={c.loansIn} indent signed />
          <Line label={t("cf_drawingsline")} value={-c.drawings} indent signed />
          <Line label={t("cf_netfin")} value={c.cfFinancing} total signed />

          <Line label={t("st_netmove")} value={c.cfNet} grand signed />
          <Line
            label={t("st_opencash")}
            hint={t("cf_opencash_hint")}
            value={c.openingCash}
            why={t("cf_opencash_why2")}
            indent
          />
          <Line label={t("st_closecash")} value={c.closingCash} total />
        </ReportCard>

        <div className="space-y-4">
          {/* The reconciliation that stops the two figures looking like a
              contradiction. */}
          <ReportCard title={t("cf_rec_t")} subtitle={t("cf_rec_s")}>
            <Line label={t("cf_rec_profit")} value={i.profitBeforeUnknowns} indent signed />
            <Line label={t("cf_rec_cash")} value={c.cfOperating} indent signed />
            <Line
              label={t("cf_rec_diff")}
              hint={t("cf_rec_diff_hint")}
              value={isKnown(c.cfOperating) ? i.profitBeforeUnknowns - c.cfOperating : null}
              total signed
            />
          </ReportCard>

          {!isKnown(c.openingCash) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-[12px] leading-relaxed text-amber-800">
              <b className="font-semibold">{t("cf_mov_t")}</b> {t("cf_mov_b", { v: fmt(c.cfNet) })}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[12px] leading-relaxed text-slate-500">
            <b className="font-semibold text-slate-700">{t("cf_draw_t")}</b> {t("cf_draw_b")}
          </div>
        </div>
      </div>
    </div>
  );
}
