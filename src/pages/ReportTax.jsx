import { useEffect, useMemo, useState } from "react";
import { ReceiptText } from "lucide-react";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

export default function ReportTax({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [allTxs, setAllTxs] = useState([]);
  const [view, setView] = useState("summary");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  function load() {
    setLoading(true);
    setLoadError("");
    api.getTransactions()
      .then(setAllTxs)
      .catch((err) => {
        // Without this, a failed/dropped request silently showed "No
        // taxable transactions" — as if nothing taxable had ever happened
        // — instead of saying the load itself had failed.
        setLoadError(err.message || "Couldn't load this report — check your connection and try again.");
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const txs = allTxs
    .filter((t) => (t.hq_status || "processing") !== "cancelled")
    .filter((t) => t.tax_applicable)
    .filter((t) => !selectedLocationIds.length || selectedLocationIds.includes(t.location_id))
    .filter((t) => !startDate || t.tx_date >= startDate)
    .filter((t) => !endDate || t.tx_date <= endDate);

  const outputTax = txs.filter((t) => t.type === "SELL").reduce((s, t) => s + Number(t.tax_amount || 0), 0);
  const inputTax = txs.filter((t) => t.type === "BUY").reduce((s, t) => s + Number(t.tax_amount || 0), 0);
  const netPayable = outputTax - inputTax;

  const sorted = useMemo(() => txs.slice().sort((a, b) => (a.tx_date < b.tx_date ? 1 : -1)), [txs]);

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}
      <div className="mb-4 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Output Tax (collected on sales)</p>
          <p className="text-2xl font-bold text-emerald-600">{fmtRiel(outputTax)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Input Tax (paid on purchases)</p>
          <p className="text-2xl font-bold text-slate-700">{fmtRiel(inputTax)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">{netPayable >= 0 ? "Net Tax Payable" : "Net Tax Refundable"}</p>
          <p className={`text-2xl font-bold ${netPayable >= 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtRiel(Math.abs(netPayable))}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <ReceiptText size={16} className="text-brand-600" />
          <h3 className="font-semibold text-slate-700">Taxable Transactions</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Receipt</th>
              <th className="px-3 py-3 font-medium">Type</th>
              <th className="px-3 py-3 font-medium">Party</th>
              <th className="px-3 py-3 font-medium">Subtotal</th>
              <th className="px-3 py-3 font-medium">Rate</th>
              <th className="px-3 py-3 font-medium">Tax</th>
              <th className="px-3 py-3 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-5 py-3 text-slate-500">{t.tx_date}</td>
                <td className="px-3 py-3 font-medium text-slate-700">{t.code}</td>
                <td className="px-3 py-3"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${t.type === "BUY" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>{t.type}</span></td>
                <td className="px-3 py-3 text-slate-700">{t.partyName}</td>
                <td className="px-3 py-3 text-slate-600">{fmtRiel(t.amount)}</td>
                <td className="px-3 py-3 text-slate-600">{t.tax_rate}%</td>
                <td className="px-3 py-3 text-slate-700">{fmtRiel(t.tax_amount)}</td>
                <td className="px-3 py-3 font-medium text-slate-800">{fmtRiel(t.total_with_tax)}</td>
              </tr>
            ))}
            {loading && sorted.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
            {sorted.length === 0 && !loading && !loadError && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">No taxable transactions recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        Only transactions with "Apply VAT" checked at entry show up here. Tax rates are fully editable per transaction — nothing is assumed automatically.
      </div>
    </div>
  );
}
