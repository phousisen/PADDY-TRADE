import { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { api } from "../api.js";
import { queryRange, rangeKey } from "../reportQuery.js";
// [2026-09-14] The figures moved to src/financials.js — see the six fixes
// documented there. Re-exported from here so the pages that have always
// imported them from this file (Purchases, Sales, PartyDetail, SimpleListPage,
// Balance Sheet, reportExport) need no change.
import { computeFinancials, paidStatusMap } from "../financials.js";
export { computeFinancials, paidStatusMap };
import { SummaryStrip, SummaryCell, ReportCard, SectionLabel, Row, TotalBox, TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }

export default function ReportOverview({ selectedLocationIds = [], startDate = null, endDate = null, onNavigate }) {
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

  // [2026-09-14] Overview is a SUMMARY. The statements an accountant actually
  // signs are their own pages, and they were reachable only from a tab row
  // that scrolled sideways — so they shipped and stayed invisible. This puts
  // them one click away from the page everyone lands on.
  const STATEMENTS = [
    ["balancesheet", "Balance Sheet", "assets, liabilities and equity as at the period end"],
    ["income", "Income Statement", "the accountant's line order, down to net profit"],
    ["cashflow", "Cash Flow", "operating, investing and financing"],
    ["inventory", "Inventory", "the shed by station and consolidated"],
    ["shareholders", "Shareholder's Records", "sales volume and value per partner"],
  ];

  // A failure is stated, and the zeros it would otherwise have produced are
  // not shown at all — a wrong number next to an error message still gets
  // read and believed.
  if (loadError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
        <p className="text-[14px] font-semibold text-rose-800">This report could not load its data.</p>
        <p className="mt-1 text-[13px] leading-relaxed text-rose-700">
          Nothing is shown rather than zeros, because a zero here would look like a real figure and would be wrong.
        </p>
        <p className="mt-2 rounded-md bg-white/70 px-3 py-2 font-mono text-[12px] text-rose-900">{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[13px] font-medium text-rose-700 hover:bg-rose-100"
        >
          Try again
        </button>
      </div>
    );
  }

  // Equally: do not paint a whole balance sheet of zeros while the data is
  // still on its way.
  if (!loaded) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <div>
      {onNavigate && (
        <div className="mb-5 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
          <p className="mb-0.5 text-[13px] font-semibold text-brand-900">The full financial statements</p>
          <p className="mb-3 text-[11.5px] text-brand-800">
            This page is the summary. These are the statements themselves — each one works for a single station or
            consolidates however many you select.
          </p>
          <div className="flex flex-wrap gap-2">
            {STATEMENTS.map(([id, label, hint]) => (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                title={hint}
                className="rounded-lg border border-brand-300 bg-white px-3 py-2 text-left text-[12.5px] font-medium text-brand-800 hover:border-brand-500 hover:bg-brand-50"
              >
                {label} <span className="text-brand-500">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <SummaryStrip>
        <SummaryCell label="Total Sales" value={`${fmt(calc.totalSell)} ៛`} sub={`${sellTx} transaction${sellTx === 1 ? "" : "s"}`} />
        <SummaryCell label="Total Purchases" value={`${fmt(calc.totalBuy)} ៛`} sub={`${buyTx} transaction${buyTx === 1 ? "" : "s"}`} />
        <SummaryCell
          label="Gross Profit"
          value={`${fmt(calc.grossProfit)} ៛`}
          sub={calc.grossProfit >= 0 ? "sales above the cost of what sold" : "sales below the cost of what sold"}
          tone={calc.grossProfit >= 0 ? "pos" : "neg"}
        />
        <SummaryCell
          label="Net Worth (Equity)"
          value={`${fmt(calc.equity)} ៛`}
          sub={calc.equity >= 0 ? "assets exceed liabilities" : "liabilities exceed assets"}
          tone={calc.equity >= 0 ? "pos" : "neg"}
        />
      </SummaryStrip>

      {/* [2026-08-31] grid-cols-1 md:grid-cols-2 instead of a flat
          grid-cols-2 — these two panels used to squeeze side by side on a
          phone screen; now stack full-width below the md breakpoint. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ReportCard title="Profit & Loss" subtitle={`${totalTx} transactions this range`}>
          <Row label="Sales" value={`${fmt(calc.totalSell)} ៛`} onClick={onNavigate ? () => onNavigate("sales") : undefined} />
          {/* [2026-09-14] This line used to read "Total Purchases (COGS)" and
              show everything bought in the period. Buying paddy is not a cost
              until it is sold — what the paddy that actually SHIPPED cost is.
              Purchases are still shown, below, as the separate thing they are. */}
          <Row label="Cost of paddy sold" value={`${fmt(-calc.costOfGoodsSold)} ៛`} />
          <TotalBox><Row label="Gross Profit" value={`${fmt(calc.grossProfit)} ៛`} bold tone={calc.grossProfit >= 0 ? "pos" : "neg"} /></TotalBox>
          <Row label="Operating Expenses" value={`${fmt(-calc.totalExpenses)} ៛`} />
          {calc.stockLossValue < 0 && (
            <Row label="Stock lost on count" value={`${fmt(calc.stockLossValue)} ៛`} tone="neg" />
          )}
          <TotalBox><Row label="Net Profit" value={`${fmt(calc.netProfit)} ៛`} bold tone={calc.netProfit >= 0 ? "pos" : "neg"} /></TotalBox>
          <SectionLabel>For reference</SectionLabel>
          <Row label="Paddy purchased this range" value={`${fmt(calc.totalBuy)} ៛`} indent onClick={onNavigate ? () => onNavigate("purchases") : undefined} />
        </ReportCard>
        <ReportCard
          title="Balance Sheet"
          subtitle={endDate ? `As at ${endDate}` : "As of today"}
        >
          {onNavigate && (
            <button onClick={() => onNavigate("balancesheet")} className="float-right -mt-8 text-[11.5px] font-medium text-brand-600 hover:underline">Full statement →</button>
          )}
          <SectionLabel>Assets</SectionLabel>
          <Row label="Inventory on hand" value={`${fmt(calc.inventoryValue)} ៛`} indent onClick={onNavigate ? () => onNavigate("stock") : undefined} />
          <Row label="Accounts Receivable" value={`${fmt(calc.accountsReceivable)} ៛`} indent onClick={onNavigate ? () => onNavigate("receivables") : undefined} />
          {/* [2026-09-14] No longer floored at zero — an overdrawn business
              used to display as having none. */}
          <Row label="Cash (derived)" value={`${fmt(calc.cashEstimate)} ៛`} indent tone={calc.cashEstimate < 0 ? "neg" : undefined} onClick={onNavigate ? () => onNavigate("cashflow") : undefined} />
          <Row label="Total Assets" value={`${fmt(calc.totalAssets)} ៛`} bold />
          <SectionLabel>Liabilities</SectionLabel>
          <Row label="Accounts Payable" value={`${fmt(calc.accountsPayable)} ៛`} indent onClick={onNavigate ? () => onNavigate("payables") : undefined} />
          <Row label="Bank Loans" value={`${fmt(calc.bankLoansOutstanding)} ៛`} indent onClick={onNavigate ? () => onNavigate("capital") : undefined} />
          <Row label="Total Liabilities" value={`${fmt(calc.totalLiabilities)} ៛`} bold />
          <SectionLabel>Equity</SectionLabel>
          <Row label="Partner Capital" value={`${fmt(calc.partnerCapital)} ៛`} indent onClick={onNavigate ? () => onNavigate("capital") : undefined} />
          <Row label="Retained Earnings" value={`${fmt(calc.retainedEarnings)} ៛`} indent />
          <TotalBox><Row label="Equity (net worth)" value={`${fmt(calc.equity)} ៛`} bold /></TotalBox>
          {/* [2026-09-14] Retained earnings used to be whatever made the sheet
              balance. It is now accumulated profit, so the two sides can differ
              — and the gap is reported rather than hidden inside equity. */}
          {Math.abs(calc.unreconciled) > 1 && (
            <div className="mt-3 rounded-lg border border-gold-300 bg-gold-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-gold-700">
              <b>{fmt(calc.unreconciled)} ៛ unexplained.</b> Nothing here is plugged any more, so the two sides
              can disagree — and this gap is almost always the cash the business held before the system
              started, which has never been entered. Recording an opening balance closes it.
            </div>
          )}
        </ReportCard>
      </div>

      {byLocation.length > 1 && (
        <TableCard title="By Location" className="mt-4">
          <Table>
            <thead>
              <tr>
                <Th>Location</Th><Th num>Sales</Th><Th num>Purchases</Th><Th num>Profit</Th><Th num>Inventory</Th><Th num>Payable</Th>
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

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
        <Wallet size={13} className="mt-0.5 shrink-0" />
        Simplified model: inventory is valued at average purchase cost, and cost of goods sold is approximated from total purchases rather than matched item-by-item.
        {onNavigate && <span className="ml-1">Tip: click any Sales, Purchases, or Balance Sheet line above to jump straight to its detail report.</span>}
      </div>
    </div>
  );
}
