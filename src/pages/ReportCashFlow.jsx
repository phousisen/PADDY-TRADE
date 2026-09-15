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
import { ReportCard } from "../components/ReportUI.jsx";
import { Line, StatementHead, StatementSummary, ScopeBar, fmt, isKnown } from "../components/StatementUI.jsx";

export default function ReportCashFlow({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { data, stations, loading, error } = useStatements({ selectedLocationIds, startDate, endDate });

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">Loading…</div>;
  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>;

  const c = data.cashflow;
  const i = data.income;
  const period = startDate && endDate ? `${startDate} to ${endDate}` : "all time";

  return (
    <div>
      <StatementHead
        title="Cash Flow Statement"
        scope={stations.length === 1 ? stations[0].name : `${stations.length} stations, consolidated`}
        period={period}
      />
      <ScopeBar stations={stations} />
      <StatementSummary cells={[
        { label: "Collected from buyers", value: c.collected },
        { label: "Paid to farmers", value: c.paidOut },
        { label: "Expenses paid", value: c.expensesPaid },
        { label: "Net cash movement", value: c.cfNet, sub: "in less out, this period" },
        { label: "Closing cash", value: c.closingCash, sub: "opening balance plus the movement",
          why: "No opening cash balance entered — Reports → Finance Setup" },
      ]} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <ReportCard>
          <p className="mb-1 mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-brand-700">Operating activities</p>
          <Line label="Collected from buyers" value={c.collected} indent />
          <Line label="Paid to farmers" value={-c.paidOut} indent signed />
          <Line label="Expenses paid" value={-c.expensesPaid} indent signed />
          <Line label="Net cash from operating" value={c.cfOperating} total signed />

          <p className="mb-1 mt-5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-700">Investing activities</p>
          <Line
            label="Property and equipment bought"
            hint="assets whose in-service date falls in this period"
            value={isKnown(c.assetsBought) ? -c.assetsBought : null}
            why="No asset register yet — Reports → Finance Setup"
            indent signed
          />
          <Line label="Net cash from investing" value={c.cfInvesting} total signed />

          <p className="mb-1 mt-5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-700">Financing activities</p>
          <Line label="Partner capital contributed" value={c.capitalIn} indent />
          <Line label="Bank loans drawn, less repaid" value={c.loansIn} indent signed />
          <Line label="Drawings by partners" value={-c.drawings} indent signed />
          <Line label="Net cash from financing" value={c.cfFinancing} total signed />

          <Line label="Net movement in cash" value={c.cfNet} grand signed />
          <Line
            label="Opening cash balance"
            hint="what was in the safe when the period began"
            value={c.openingCash}
            why="Not entered — Reports → Finance Setup"
            indent
          />
          <Line label="Closing cash balance" value={c.closingCash} total />
        </ReportCard>

        <div className="space-y-4">
          {/* The reconciliation that stops the two figures looking like a
              contradiction. */}
          <ReportCard title="Profit is not cash" subtitle="and is not meant to be">
            <Line label="Profit before depreciation, interest and tax" value={i.profitBeforeUnknowns} indent signed />
            <Line label="Cash from operating" value={c.cfOperating} indent signed />
            <Line
              label="Difference"
              hint="the paddy that moved into or out of the shed, and what is still owed each way"
              value={isKnown(c.cfOperating) ? i.profitBeforeUnknowns - c.cfOperating : null}
              total signed
            />
          </ReportCard>

          {!isKnown(c.openingCash) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-[12px] leading-relaxed text-amber-800">
              <b className="font-semibold">This is a movement, not a balance.</b> Without an opening figure the
              statement can say how much cash came in and went out — <b className="font-semibold">{fmt(c.cfNet)} ៛</b> this
              period — but not what is actually in the safe. Entering an opening cash balance per station under
              Finance Setup turns this into a real closing balance, and closes the unexplained gap on the Balance
              Sheet at the same time.
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[12px] leading-relaxed text-slate-500">
            <b className="font-semibold text-slate-700">A drawing is not an expense.</b> Money a partner takes out
            reduces equity and reduces cash, but it never touches the Income Statement — so it appears here under
            financing, and on the Balance Sheet under equity, and nowhere else.
          </div>
        </div>
      </div>
    </div>
  );
}
