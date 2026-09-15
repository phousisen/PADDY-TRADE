// Reports → Income Statement.
//
// [2026-09-14] Built to the accountant's own line order, using the accountant's
// own labels — Income, Other incomes, Gross Income, COGS, Inventory Lost,
// Intermediary Fee (ចំណាយកូនដៃ), Wages and Salaries, Depreciation, Interests,
// Gross Profit/(Loss), Tax, Net Profit/(Loss). Where that ordering differs from
// textbook presentation the accountant's wins: this is the statement they have
// to sign, and a line they cannot find is worse than a line in the wrong place.
//
// The one addition is the subtotal marked "before depreciation, interest and
// tax". Until those three are entered the statement cannot reach a net profit
// — but everything above them is real, computed from recorded transactions, and
// hiding it behind three blanks would leave the page saying nothing at all.

import { useStatements } from "../useStatements.js";
import { useLanguage } from "../i18n.jsx";
import { ReportCard } from "../components/ReportUI.jsx";
import { Explain, Line, StatementHead, StatementSummary, StationChips, ScopeBar, SetupNotice, fmt, fmtKg, isKnown } from "../components/StatementUI.jsx";

export default function ReportIncomeStatement({ selectedLocationIds = [], setSelectedLocationIds, startDate = null, endDate = null }) {
  const { t } = useLanguage();
  const { data, stations, raw, loading, error, setupMissing } = useStatements({ selectedLocationIds, startDate, endDate });

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">{t("loading_label")}</div>;
  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>;

  const i = data.income;
  const period = startDate && endDate ? t("st_period_between", { a: startDate, b: endDate })
    : startDate ? t("st_period_from", { a: startDate })
    : endDate ? t("st_period_upto", { b: endDate })
    : t("st_period_all");

  return (
    <div>
      <StatementHead
        title={t("fin_is")}
        scope={stations.length === 1 ? stations[0].name : t("st_consolidated_n", { n: stations.length })}
        period={period}
      />
      <StationChips stations={raw.stations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
      <ScopeBar stations={stations} />
      <StatementSummary cells={[
        { label: t("is_sum_sales"), value: i.sales, sub: t("is_sum_sales_sub", { kg: fmtKg(i.soldKg) }) },
        { label: t("is_sum_cogs"), value: i.costOfGoodsSold, sub: t("is_sum_cogs_sub") },
        { label: t("st_opex"), value: i.operatingExpenses, sub: t("is_sum_opex_sub") },
        { label: t("st_invlost"), value: i.inventoryLost, sub: t("is_sum_lost_sub"), tone: "neg" },
        { label: t("is_sum_pbdit"), value: i.profitBeforeUnknowns, sub: t("is_sum_pbdit_sub"), tone: "pos" },
      ]} />
      <SetupNotice missing={setupMissing} what={t("is_setup_what")} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ReportCard>
          <Line label={t("is_income_sales")} hint={t("is_sum_sales_sub", { kg: fmtKg(i.soldKg) })} value={i.sales} indent />
          <Line label={t("st_otherincome")} hint={t("is_other_hint")} value={i.otherIncome} indent />
          <Line label={t("st_grossincome")} value={i.grossIncome} total />

          <Line label={t("st_cogs")} hint={t("is_cogs_hint")} value={-i.costOfGoodsSold} indent signed />
          <Line label={t("st_invlost")} hint={t("is_lost_hint")} value={i.inventoryLost} indent signed />

          <Line label={t("st_intermediary")} value={-i.intermediaryFee} indent signed />
          <Line label={t("st_wages")} value={-i.wages} indent signed />
          <Line label={t("st_otherexp")} value={-i.otherExpenses} indent signed />
          <Line
            label={t("st_depreciation")}
            hint={t("is_dep_hint")}
            value={isKnown(i.depreciation) ? -i.depreciation : null}
            why={t("is_dep_why")}
            indent signed
          />
          <Line
            label={t("st_interest")}
            hint={t("is_int_hint")}
            value={isKnown(i.interest) ? -i.interest : null}
            why={t("is_int_why")}
            indent signed
          />

          {/* [2026-09-15] Was labelled "Gross Profit / (Loss)". It is not gross
              profit — gross profit comes before depreciation and interest, and
              both have already been taken off above. This line is profit before
              tax, in English and in Khmer (ប្រាក់ចំណេញមុនគិតពន្ធ). */}
          <Line label={t("st_profitbeforetax")} value={i.grossProfit} total signed />
          <Line
            label={t("st_tax")}
            value={isKnown(i.tax) ? -i.tax : null}
            why={t("is_tax_why")}
            indent signed
          />
          <Line label={t("st_netprofit")} value={i.netProfit} grand signed />
        </ReportCard>

        <div className="space-y-4">
          <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">{t("is_pbdit_t")}</p>
            <p className="mt-1.5 text-[22px] font-bold tracking-tight text-brand-900 tabular-nums">
              {fmt(i.profitBeforeUnknowns)} ៛
            </p>
            <Explain><p className="mt-2 text-[12px] leading-relaxed text-brand-800">{t("is_pbdit_b")}</p></Explain>
          </div>

          <ReportCard title={t("is_from_t")} subtitle={t("is_from_s")}>
            <Line label={t("is_bought")} value={i.boughtKg} riel={false} hint={t("is_bought_hint")} indent />
            <Line label={t("is_shipped")} value={i.soldKg} riel={false} hint={t("is_shipped_hint")} indent />
            <Line label={t("is_purchases")} value={i.purchases} indent hint={t("is_purchases_hint")} />
          </ReportCard>

          <Explain>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[12px] leading-relaxed text-slate-500">
              <b className="font-semibold text-slate-700">{t("is_note_t")}</b> {t("is_note_b")}
            </div>
          </Explain>
        </div>
      </div>
    </div>
  );
}
