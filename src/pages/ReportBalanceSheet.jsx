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

import { useStatements } from "../useStatements.js";
import { ReportCard } from "../components/ReportUI.jsx";
import { Line, StatementHead, ScopeBar, SetupNotice, UnreconciledNotice, fmt, fmtKg, isKnown } from "../components/StatementUI.jsx";

export default function ReportBalanceSheet({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { data, stations, loading, error, setupMissing } = useStatements({ selectedLocationIds, startDate, endDate });

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">Loading…</div>;
  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>;

  const b = data.balance;
  const asAt = endDate || "today";

  return (
    <div>
      <StatementHead
        title="Balance Sheet"
        scope={stations.length === 1 ? stations[0].name : `${stations.length} stations, consolidated`}
        asAt={asAt}
      />
      <ScopeBar stations={stations} />
      <SetupNotice missing={setupMissing} what="Fixed assets and opening cash" />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------------- Assets ---------------- */}
        <ReportCard title="Assets">
          <Line
            label="Cash and bank"
            hint={isKnown(b.openingCash)
              ? "opening balance plus everything in and out since"
              : "opening balance not entered — see the note below"}
            value={b.cash}
            why="No opening cash balance entered — Reports → Finance Setup"
            indent
          />
          <Line label="Accounts receivable — buyers" hint="shipped but not yet collected" value={b.accountsReceivable} indent />
          <Line
            label="Inventory — paddy in the shed"
            hint={`${fmtKg(b.inventoryKg)} kg at ${fmt(b.inventoryCostPerKg)} ៛/kg, weighted average`}
            value={b.inventoryValue} indent
          />
          <Line label="Current Assets" value={b.currentAssets} total />

          <Line
            label="Property and equipment, net"
            hint={isKnown(b.assetCost)
              ? `cost ${fmt(b.assetCost)} ៛ less ${fmt(b.accumDep)} ៛ accumulated depreciation`
              : "no asset register yet"}
            value={b.fixedAssetsNet}
            why="Nothing in the asset register — add trucks, scales and buildings under Reports → Finance Setup"
            indent
          />
          <Line label="Total Assets" value={b.totalAssets} grand />
        </ReportCard>

        {/* ---------------- Liabilities + Equity ---------------- */}
        <div className="space-y-5">
          <ReportCard title="Liabilities">
            <Line label="Accounts payable — farmers" hint="weighed in but not yet paid for" value={b.accountsPayable} indent />
            <Line label="Bank loans outstanding" value={b.loansOutstanding} indent />
            <Line
              label="Accrued expenses"
              hint="costs incurred but not yet paid — no accruals ledger yet, so this is nil rather than unknown"
              value={b.accrued} indent
            />
            <Line label="Total Liabilities" value={b.totalLiabilities} total />
          </ReportCard>

          <ReportCard title="Equity">
            <Line label="Partner capital contributed" hint="gross, what partners have put in" value={b.partnerCapital} indent />
            <Line
              label="Less: drawings"
              hint="what partners have taken out — not an expense, and never on the Income Statement"
              value={-b.drawings} indent signed
            />
            <Line
              label="Retained earnings"
              hint="accumulated profit since the system began — earned, not the figure needed to balance"
              value={b.retainedEarnings} indent signed
            />
            <Line label="Total Equity" value={b.equity} total signed />
            <Line
              label="Liabilities + Equity"
              value={isKnown(b.totalLiabilities) && isKnown(b.equity) ? b.totalLiabilities + b.equity : null}
              grand
            />
          </ReportCard>
        </div>
      </div>

      <UnreconciledNotice value={b.unreconciled} />

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[12px] leading-relaxed text-slate-500">
          <b className="font-semibold text-slate-700">Cash movement so far: {fmt(b.cashMovement)} ៛.</b>{" "}
          Money collected less money paid out, since the system began. Add the cash that was in the safe before that
          and you have the cash actually held — which is why the opening balance matters more than it looks.
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[12px] leading-relaxed text-slate-500">
          <b className="font-semibold text-slate-700">Why the shed is worth what it says.</b>{" "}
          Paddy is valued at its running weighted-average cost, not at today's price — what it actually cost to buy
          the kilos still sitting there. On a day the shed empties, that cost and the day's price are the same number.
        </div>
      </div>
    </div>
  );
}
