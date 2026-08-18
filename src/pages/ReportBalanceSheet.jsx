import { useEffect, useMemo, useState } from "react";
import { Scale, Printer, MapPin } from "lucide-react";
import { api } from "../api.js";
import { computeFinancials } from "./ReportOverview.jsx";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }

function Line({ label, value, bold, indent }) {
  return (
    <div className={`flex items-center justify-between border-b border-slate-50 py-2.5 text-sm last:border-0 ${indent ? "pl-4" : ""}`}>
      <span className={bold ? "font-semibold text-slate-800" : "text-slate-500"}>{label}</span>
      <span className={bold ? "font-semibold text-slate-800" : "text-slate-700"}>{fmtRiel(value)}</span>
    </div>
  );
}

export default function ReportBalanceSheet({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [txs, setTxs] = useState([]);
  const [stations, setStations] = useState([]);
  const [capitalEntries, setCapitalEntries] = useState([]);
  const [loanEntries, setLoanEntries] = useState([]);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    Promise.all([api.getTransactions(), api.getLocations()]).then(([t, s]) => { setTxs(t); setStations(s); });
    api.getPayments().then(setPayments).catch(() => setPayments([]));
    api.getPartnerCapitalEntries().then(setCapitalEntries).catch(() => setCapitalEntries([]));
    api.getBankLoans().then(setLoanEntries).catch(() => setLoanEntries([]));
  }, []);

  const filteredStations = selectedLocationIds.length ? stations.filter((s) => selectedLocationIds.includes(s.id)) : stations;
  const activeTxs = txs
    .filter((t) => (t.hq_status || "processing") !== "cancelled")
    .filter((t) => !startDate || t.tx_date >= startDate)
    .filter((t) => !endDate || t.tx_date <= endDate);
  const filteredTxs = selectedLocationIds.length ? activeTxs.filter((t) => selectedLocationIds.includes(t.location_id)) : activeTxs;

  const calc = useMemo(
    () => computeFinancials(filteredTxs, filteredStations, capitalEntries, loanEntries, payments),
    [filteredTxs, filteredStations, capitalEntries, loanEntries, payments]
  );

  const byLocation = useMemo(() => {
    return filteredStations.map((s) => {
      const stationTxs = activeTxs.filter((x) => x.location_id === s.id);
      const c = computeFinancials(stationTxs, [s], capitalEntries, loanEntries, payments);
      return { station: s, ...c };
    });
  }, [activeTxs, filteredStations, capitalEntries, loanEntries, payments]);

  const rangeLabel = !startDate && !endDate ? "All time" : `${startDate || "…"} to ${endDate || "…"}`;
  const balances = Math.abs(calc.totalAssets - (calc.totalLiabilities + calc.equity)) < 1;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800"><Scale size={18} className="text-brand-600" /> Balance Sheet</h2>
          <p className="text-xs text-slate-400">{rangeLabel}</p>
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          <Printer size={14} className="text-slate-400" /> Print
        </button>
      </div>

      <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Assets</p>
        <Line label="Inventory on hand" value={calc.inventoryValue} indent />
        <Line label="Accounts Receivable" value={calc.accountsReceivable} indent />
        <Line label="Cash (estimate)" value={Math.max(0, calc.cashEstimate)} indent />
        <Line label="Total Assets" value={calc.totalAssets} bold />

        <p className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Liabilities</p>
        <Line label="Accounts Payable (suppliers)" value={calc.accountsPayable} indent />
        <Line label="Bank Loans Outstanding" value={calc.bankLoansOutstanding} indent />
        <Line label="Total Liabilities" value={calc.totalLiabilities} bold />

        <p className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Equity</p>
        <Line label="Partner Capital (contributed)" value={calc.partnerCapital} indent />
        <Line label="Retained Earnings" value={calc.retainedEarnings} indent />
        <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5"><Line label="Total Equity" value={calc.equity} bold /></div>

        <div className="mt-5 border-t border-slate-100 pt-3">
          <Line label="Total Liabilities + Equity" value={calc.totalLiabilities + calc.equity} bold />
        </div>
        {!balances && (
          <p className="mt-2 text-xs text-amber-600">Note: this doesn't balance exactly against Total Assets — check for data still loading.</p>
        )}
      </div>

      {byLocation.length > 1 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
            <MapPin size={16} className="text-brand-600" />
            <h3 className="font-semibold text-slate-700">By Location</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">Location</th>
                <th className="px-5 py-2 font-medium">Total Assets</th>
                <th className="px-5 py-2 font-medium">Accounts Payable</th>
                <th className="px-5 py-2 font-medium">Bank Loans</th>
                <th className="px-5 py-2 font-medium">Partner Capital</th>
                <th className="px-5 py-2 font-medium">Equity</th>
              </tr>
            </thead>
            <tbody>
              {byLocation.map((row) => (
                <tr key={row.station.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{row.station.name}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt(row.totalAssets)}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt(row.accountsPayable)}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt(row.bankLoansOutstanding)}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt(row.partnerCapital)}</td>
                  <td className={`px-5 py-3 font-medium ${row.equity >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(row.equity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        Simplified model: inventory is valued at average purchase cost, cost of goods sold is approximated from total purchases, and Retained Earnings is whatever's left of Equity after subtracting real Partner Capital — it isn't a full double-entry set of books.
      </div>
    </div>
  );
}
