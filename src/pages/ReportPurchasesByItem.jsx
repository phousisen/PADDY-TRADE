import { useEffect, useMemo, useState } from "react";
import { Printer, Layers } from "lucide-react";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

// Mirrors the old bookkeeping system's "Purchases by Item Detail" report:
// purchases grouped by paddy type, each bill shown with its paid/unpaid
// status and a running balance per type — see the sample screenshots this
// was built from.
export default function ReportPurchasesByItem({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [allRows, setAllRows] = useState([]);

  useEffect(() => {
    api.getTransactions({ type: "BUY" }).then(setAllRows);
  }, []);

  const rows = allRows
    .filter((r) => (r.hq_status || "processing") !== "cancelled")
    .filter((r) => !selectedLocationIds.length || selectedLocationIds.includes(r.location_id))
    .filter((r) => !startDate || r.tx_date >= startDate)
    .filter((r) => !endDate || r.tx_date <= endDate);

  const groups = useMemo(() => {
    const map = {};
    rows.forEach((r) => {
      const k = r.productName || "—";
      if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    return Object.keys(map).sort().map((name) => {
      // Paid rows first, then unpaid — same ordering as the old system's
      // "Sort By Paid" — then by date within each.
      const sorted = map[name].slice().sort((a, b) => {
        const pa = a.payment_status === "paid" ? 0 : 1;
        const pb = b.payment_status === "paid" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return a.tx_date < b.tx_date ? -1 : a.tx_date > b.tx_date ? 1 : a.code < b.code ? -1 : 1;
      });
      let bal = 0;
      const withBalance = sorted.map((r) => {
        bal += Number(r.amount);
        return { ...r, runningBalance: bal };
      });
      return {
        name,
        rows: withBalance,
        totalQty: sorted.reduce((s, r) => s + Number(r.quantity_kg), 0),
        totalAmount: sorted.reduce((s, r) => s + Number(r.amount), 0),
      };
    });
  }, [rows]);

  const grandQty = groups.reduce((s, g) => s + g.totalQty, 0);
  const grandAmount = groups.reduce((s, g) => s + g.totalAmount, 0);
  const rangeLabel = !startDate && !endDate ? "All time" : `${startDate || "…"} to ${endDate || "…"}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800"><Layers size={18} className="text-brand-600" /> Purchases by Item</h2>
          <p className="text-xs text-slate-400">{rangeLabel} · grouped by paddy type</p>
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          <Printer size={14} className="text-slate-400" /> Print
        </button>
      </div>

      <div className="mb-4 flex gap-4">
        <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Total Purchased</p>
          <p className="text-2xl font-bold text-slate-800">{fmt2(grandQty)} kg</p>
        </div>
        <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Total Spent</p>
          <p className="text-2xl font-bold text-slate-800">{fmtRiel(grandAmount)}</p>
        </div>
      </div>

      {groups.map((g) => (
        <div key={g.name} className="mb-5 rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h3 className="font-semibold text-slate-700">{g.name}</h3>
            <p className="text-xs text-slate-400">{fmt2(g.totalQty)} kg · {fmtRiel(g.totalAmount)}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">Date</th>
                <th className="px-5 py-2 font-medium">Bill #</th>
                <th className="px-5 py-2 font-medium">Note</th>
                <th className="px-5 py-2 font-medium">Source (Truck/Driver)</th>
                <th className="px-5 py-2 font-medium">Paid</th>
                <th className="px-5 py-2 font-medium">Qty (kg)</th>
                <th className="px-5 py-2 font-medium">Cost Price</th>
                <th className="px-5 py-2 font-medium">Amount</th>
                <th className="px-5 py-2 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-2.5 text-slate-500">{r.tx_date}</td>
                  <td className="px-5 py-2.5 font-medium text-slate-700">{r.code}</td>
                  <td className="px-5 py-2.5 text-slate-500">{r.note || "—"}</td>
                  <td className="px-5 py-2.5 text-slate-600">{r.driver_name || r.partyName}</td>
                  <td className={`px-5 py-2.5 font-medium ${r.payment_status === "paid" ? "text-emerald-600" : "text-amber-600"}`}>
                    {r.payment_status === "paid" ? "Paid" : "Unpaid"}
                  </td>
                  <td className="px-5 py-2.5 text-slate-700">{fmt2(r.quantity_kg)}</td>
                  <td className="px-5 py-2.5 text-slate-700">{fmtRiel(r.price_per_kg)}</td>
                  <td className="px-5 py-2.5 font-medium text-slate-800">{fmtRiel(r.amount)}</td>
                  <td className="px-5 py-2.5 text-slate-700">{fmtRiel(r.runningBalance)}</td>
                </tr>
              ))}
              {g.rows.length === 0 && (
                <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-slate-400">No purchases for this type yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
      {groups.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400 shadow-sm">No purchases yet.</div>
      )}
    </div>
  );
}
