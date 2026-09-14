import { useEffect, useMemo, useState } from "react";
import { Scale, Printer } from "lucide-react";
import { getAccurateNow } from "../supabaseClient.js";
import { api } from "../api.js";
import { computeFinancials } from "../financials.js";
import { ReportCard, SectionLabel, Row, TotalBox, TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }

export default function ReportBalanceSheet({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [txs, setTxs] = useState([]);
  const [stations, setStations] = useState([]);
  const [capitalEntries, setCapitalEntries] = useState([]);
  const [loanEntries, setLoanEntries] = useState([]);
  const [payments, setPayments] = useState([]);
  // [2026-09-09] Needed to value stock AS AT the end date rather than today
  // — see stationsAsAt below.
  const [adjustments, setAdjustments] = useState([]);

  useEffect(() => {
    Promise.all([api.getTransactions(), api.getLocations()]).then(([t, s]) => { setTxs(t); setStations(s); });
    api.getPayments().then(setPayments).catch(() => setPayments([]));
    api.getPartnerCapitalEntries().then(setCapitalEntries).catch(() => setCapitalEntries([]));
    api.getBankLoans().then(setLoanEntries).catch(() => setLoanEntries([]));
    api.getStockAdjustments().then(setAdjustments).catch(() => setAdjustments([]));
  }, []);

  const baseStations = selectedLocationIds.length ? stations.filter((s) => selectedLocationIds.includes(s.id)) : stations;

  // [2026-09-09] A balance sheet states a position on a DATE. This page
  // already accepted an end date and filtered the transactions by it — but
  // the inventory line came from locations.current_stock_kg, which is
  // always today's stock. So "as at 31 August" showed August's receivables
  // against today's rice, and the two sides described different days.
  //
  // When an end date in the past is set, stock is rebuilt as at that date
  // from the same facts the database itself uses (recompute_location_stock
  // in fix_stock_drift_2026-09-07.sql): bought minus what physically left
  // on a sale, plus stock adjustments, all up to and including that date.
  // With no end date, or an end date of today, the live figure is used
  // exactly as before — no behaviour change for the everyday view.
  const stationsAsAt = useMemo(() => {
    if (!endDate) return baseStations;
    const todayKh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Phnom_Penh" }).format(getAccurateNow());
    if (endDate >= todayKh) return baseStations;

    return baseStations.map((st) => {
      const fromTx = txs
        .filter((t) => (t.hq_status || "processing") !== "cancelled")
        .filter((t) => t.location_id === st.id)
        .filter((t) => t.tx_date && t.tx_date <= endDate)
        .reduce((sum, t) => sum + (t.type === "BUY"
          ? Number(t.quantity_kg || 0)
          // What physically left the station, matching the database rule.
          : -Number(t.station_quantity_kg ?? t.quantity_kg ?? 0)), 0);

      const fromAdj = adjustments
        .filter((a) => a.location_id === st.id)
        .filter((a) => (a.created_at || "").slice(0, 10) <= endDate)
        .reduce((sum, a) => sum + Number(a.adjustment_kg || 0), 0);

      return { ...st, current_stock_kg: fromTx + fromAdj };
    });
  }, [baseStations, txs, adjustments, endDate]);

  const filteredStations = stationsAsAt;
  const activeTxs = txs
    .filter((t) => (t.hq_status || "processing") !== "cancelled")
    .filter((t) => !startDate || t.tx_date >= startDate)
    .filter((t) => !endDate || t.tx_date <= endDate);
  const filteredTxs = selectedLocationIds.length ? activeTxs.filter((t) => selectedLocationIds.includes(t.location_id)) : activeTxs;

  // Same date-range filtering as activeTxs/filteredTxs above, applied to
  // the "expense"-type rows already sitting in the payments ledger (see
  // Expenses.jsx) — see computeFinancials' comment on why this stays
  // period-scoped instead of all-time.
  const activeExpenses = payments
    .filter((p) => p.type === "expense")
    .filter((p) => !startDate || p.pay_date >= startDate)
    .filter((p) => !endDate || p.pay_date <= endDate);
  const filteredExpenses = selectedLocationIds.length ? activeExpenses.filter((p) => selectedLocationIds.includes(p.location_id)) : activeExpenses;

  // This page already fetches all-time data, which is what a point-in-time
  // balance needs. computeFinancials takes the period slice for the P&L lines
  // and cuts everything else at endDate itself.
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

  const rangeLabel = !startDate && !endDate ? "All time" : `${startDate || "…"} to ${endDate || "…"}`;
  // Is the stock figure a past position or today's? Say so, rather than
  // leaving the reader to assume.
  const todayKh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Phnom_Penh" }).format(getAccurateNow());
  const isAsAtPast = !!endDate && endDate < todayKh;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900"><Scale size={16} className="text-brand-600" /> Balance Sheet</h2>
          <p className="text-[11.5px] text-slate-400">
            {rangeLabel}
            {isAsAtPast
              ? <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">Position as at {endDate}</span>
              : <span className="ml-1.5 text-slate-300">Position as at today</span>}
          </p>
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13.5px] text-slate-600 hover:bg-slate-50">
          <Printer size={14} className="text-slate-400" /> Print
        </button>
      </div>

      <ReportCard className="mx-auto max-w-xl">
        <SectionLabel>Assets</SectionLabel>
        <Row label={isAsAtPast ? `Inventory on hand (as at ${endDate})` : "Inventory on hand"} value={fmtRiel(calc.inventoryValue)} indent />
        <Row label="Accounts Receivable" value={fmtRiel(calc.accountsReceivable)} indent />
        {/* [2026-09-14] No longer floored at zero — an overdrawn business
            used to read as having no cash rather than as owing. */}
        <Row label="Cash (derived)" value={fmtRiel(calc.cashEstimate)} indent tone={calc.cashEstimate < 0 ? "neg" : undefined} />
        <Row label="Total Assets" value={fmtRiel(calc.totalAssets)} bold />

        <SectionLabel>Liabilities</SectionLabel>
        <Row label="Accounts Payable (suppliers)" value={fmtRiel(calc.accountsPayable)} indent />
        <Row label="Bank Loans Outstanding" value={fmtRiel(calc.bankLoansOutstanding)} indent />
        <Row label="Total Liabilities" value={fmtRiel(calc.totalLiabilities)} bold />

        <SectionLabel>Equity</SectionLabel>
        <Row label="Partner Capital (contributed)" value={fmtRiel(calc.partnerCapital)} indent />
        <Row label="Retained Earnings" value={fmtRiel(calc.retainedEarnings)} indent />
        <TotalBox><Row label="Total Equity" value={fmtRiel(calc.equity)} bold /></TotalBox>

        <TotalBox><Row label="Total Liabilities + Equity" value={fmtRiel(calc.totalLiabilities + calc.equity)} bold /></TotalBox>
        {/* [2026-09-14] Retained Earnings used to be the figure that made this
            balance. It is now accumulated profit, computed the same way this
            period's profit is — so the two sides can genuinely differ, and the
            gap is stated instead of being absorbed into equity. */}
        {Math.abs(calc.unreconciled) > 1 && (
          <div className="mt-3 rounded-lg border border-gold-300 bg-gold-50 px-3.5 py-3 text-[11.5px] leading-relaxed text-gold-700">
            <b>{fmtRiel(calc.unreconciled)} unexplained.</b> Assets less liabilities and equity. Nothing on this
            sheet is plugged, so this gap is real: it is almost certainly the cash the business held before the
            system started, which has never been recorded. Entering an opening balance closes it.
          </div>
        )}
      </ReportCard>

      {byLocation.length > 1 && (
        <TableCard title="By Location" className="mt-4">
          <Table>
            <thead>
              <tr>
                <Th>Location</Th><Th num>Total Assets</Th><Th num>Accounts Payable</Th><Th num>Bank Loans</Th><Th num>Partner Capital</Th><Th num>Equity</Th>
              </tr>
            </thead>
            <tbody>
              {byLocation.map((row) => (
                <Tr key={row.station.id}>
                  <Td name>{row.station.name}</Td>
                  <Td num>{fmt(row.totalAssets)}</Td>
                  <Td num>{fmt(row.accountsPayable)}</Td>
                  <Td num>{fmt(row.bankLoansOutstanding)}</Td>
                  <Td num>{fmt(row.partnerCapital)}</Td>
                  <Td num className={row.equity >= 0 ? "!text-brand-700 !font-semibold" : "!text-rose-600 !font-semibold"}>{fmt(row.equity)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}

      <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
        Inventory is valued at weighted average cost — what the paddy in the shed actually cost, mixed across
        the days it was bought. Cost of goods sold is the cost of the paddy that shipped, not everything
        purchased. Retained Earnings is accumulated profit since the system began. Balances are as at the end
        of the chosen period; the profit figures belong to the period itself. Depreciation, interest and tax
        are not yet included — they need the Finance Setup screens.
      </div>
    </div>
  );
}
