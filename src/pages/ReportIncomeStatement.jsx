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
import { ReportCard } from "../components/ReportUI.jsx";
import { Line, StatementHead, StatementSummary, ScopeBar, SetupNotice, fmt, fmtKg, isKnown } from "../components/StatementUI.jsx";

export default function ReportIncomeStatement({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { data, stations, loading, error, setupMissing } = useStatements({ selectedLocationIds, startDate, endDate });

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">Loading…</div>;
  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>;

  const i = data.income;
  const period = startDate && endDate ? `${startDate} to ${endDate}` : startDate ? `from ${startDate}` : endDate ? `up to ${endDate}` : "all time";

  return (
    <div>
      <StatementHead
        title="Income Statement"
        scope={stations.length === 1 ? stations[0].name : `${stations.length} stations, consolidated`}
        period={period}
      />
      <ScopeBar stations={stations} />
      <StatementSummary cells={[
        { label: "Sales", value: i.sales, sub: `${fmtKg(i.soldKg)} kg shipped` },
        { label: "Cost of paddy sold", value: i.costOfGoodsSold, sub: "weighted average cost" },
        { label: "Operating expenses", value: i.operatingExpenses, sub: "recorded this period" },
        { label: "Inventory lost", value: i.inventoryLost, sub: "written off on counts", tone: "neg" },
        { label: "Profit before dep/int/tax", value: i.profitBeforeUnknowns, sub: "every figure in it is real", tone: "pos" },
      ]} />
      <SetupNotice missing={setupMissing} what="Depreciation and tax" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ReportCard>
          <Line label="Income — sales of paddy" hint={`${fmtKg(i.soldKg)} kg shipped`} value={i.sales} indent />
          <Line label="Other incomes" hint="money in that is not a paddy sale" value={i.otherIncome} indent />
          <Line label="Gross Income" value={i.grossIncome} total />

          <Line
            label="Cost of goods sold"
            hint="what the paddy that actually shipped cost to buy, at its running average"
            value={-i.costOfGoodsSold} indent signed
          />
          <Line
            label="Inventory lost"
            hint="written off on physical counts — a counted surplus is not taken as income"
            value={i.inventoryLost} indent signed
          />

          <Line label="Intermediary fee · ចំណាយកូនដៃ" value={-i.intermediaryFee} indent signed />
          <Line label="Wages and salaries" value={-i.wages} indent signed />
          <Line label="Other operating expenses" value={-i.otherExpenses} indent signed />
          <Line
            label="Depreciation"
            hint="straight line over each asset's useful life"
            value={isKnown(i.depreciation) ? -i.depreciation : null}
            why="No asset register yet — add what the business owns under Reports → Finance Setup"
            indent signed
          />
          <Line
            label="Interests"
            hint="interest actually recorded against the loans"
            value={isKnown(i.interest) ? -i.interest : null}
            why="Loans are outstanding but no interest has been recorded — enter it as an expense, or set the rate in Finance Setup"
            indent signed
          />

          <Line label="Gross Profit / (Loss)" value={i.grossProfit} total signed />
          <Line
            label="Tax"
            value={isKnown(i.tax) ? -i.tax : null}
            why="No tax rate set — Reports → Finance Setup"
            indent signed
          />
          <Line label="Net Profit / (Loss)" value={i.netProfit} grand signed />
        </ReportCard>

        <div className="space-y-4">
          <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
              Before depreciation, interest and tax
            </p>
            <p className="mt-1.5 text-[22px] font-bold tracking-tight text-brand-900 tabular-nums">
              {fmt(i.profitBeforeUnknowns)} ៛
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-brand-800">
              Gross income less cost of goods sold, inventory lost and every expense actually recorded.
              Every figure in it is real. The three lines still blank above would each reduce it.
            </p>
          </div>

          <ReportCard title="Where it came from" subtitle="the period's trading, in kilos">
            <Line label="Bought" value={i.boughtKg} riel={false} hint="kg into the shed" indent />
            <Line label="Shipped" value={i.soldKg} riel={false} hint="kg out to buyers" indent />
            <Line label="Purchases at cost" value={i.purchases} indent
                  hint="for reference — buying paddy is not a cost until it is sold" />
          </ReportCard>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[12px] leading-relaxed text-slate-500">
            <b className="font-semibold text-slate-700">Why purchases are not a cost here.</b> Paddy bought and still
            in the shed is an asset, not an expense — it becomes a cost on the day it ships, at what it cost to buy.
            In a heavy buying month, treating purchases as a cost shows a loss the business has not made.
          </div>
        </div>
      </div>
    </div>
  );
}
