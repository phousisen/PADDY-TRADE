import { useEffect, useMemo, useState } from "react";
import { Scale, Printer } from "lucide-react";
import { getAccurateNow } from "../supabaseClient.js";
import { api } from "../api.js";
import { computeFinancials } from "./ReportOverview.jsx";
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

  const calc = useMemo(
    () => computeFinancials(filteredTxs, filteredStations, capitalEntries, loanEntries, payments, filteredExpenses),
    [filteredTxs, filteredStations, capitalEntries, loanEntries, payments, filteredExpenses]
  );

  const byLocation = useMemo(() => {
    return filteredStations.map((s) => {
      const stationTxs = activeTxs.filter((x) => x.location_id === s.id);
      const stationExpenses = activeExpenses.filter((p) => p.location_id === s.id);
      const c = computeFinancials(stationTxs, [s], capitalEntries, loanEntries, payments, stationExpenses);
      return { station: s, ...c };
    });
  }, [activeTxs, activeExpenses, filteredStations, capitalEntries, loanEntries, payments]);

  const rangeLabel = !startDate && !endDate ? "All time" : `${startDate || "…"} to ${endDate || "…"}`;
  // Is the stock figure a past position or today's? Say so, rather than
  // leaving the reader to assume.
  const todayKh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Phnom_Penh" }).format(getAccurateNow());
  const isAsAtPast = !!endDate && endDate < todayKh;
  const balances = Math.abs(calc.totalAssets - (calc.totalLiabilities + calc.equity)) < 1;

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
        <Row label="Cash (estimate)" value={fmtRiel(Math.max(0, calc.cashEstimate))} indent />
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
        {!balances && (
          <p className="mt-2 text-[11.5px] text-amber-600">Note: this doesn't balance exactly against Total Assets — check for data still loading.</p>
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
        Simplified model: inventory is valued at average purchase cost, cost of goods sold is approximated from total purchases, and Retained Earnings is whatever's left of Equity after subtracting real Partner Capital — it isn't a full double-entry set of books.
      </div>
    </div>
  );
}
