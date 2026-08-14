import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

export default function ReportPurchases() {
  const [rows, setRows] = useState([]);
  const [groupBy, setGroupBy] = useState("party");
  const [view, setView] = useState("summary");

  useEffect(() => {
    api.getTransactions({ type: "BUY" }).then(setRows);
  }, []);

  const grouped = useMemo(() => {
    const key = groupBy === "party" ? "partyName" : groupBy === "product" ? "productName" : "stationName";
    const map = {};
    rows.forEach((r) => {
      const k = r[key] || "—";
      if (!map[k]) map[k] = { name: k, count: 0, qty: 0, amount: 0 };
      map[k].count += 1;
      map[k].qty += Number(r.quantity_kg);
      map[k].amount += Number(r.amount);
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [rows, groupBy]);

  const totalQty = rows.reduce((s, r) => s + Number(r.quantity_kg), 0);
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <span className="text-xs font-medium text-slate-400 self-center">Group by:</span>
          {[{ v: "party", l: "Supplier" }, { v: "product", l: "Paddy Type" }, { v: "location", l: "Location" }].map((o) => (
            <button key={o.v} onClick={() => setGroupBy(o.v)} className={`rounded-lg border px-3 py-1.5 text-sm ${groupBy === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
          ))}
        </div>
        <div className="flex gap-2">
          {[{ v: "summary", l: "Summary" }, { v: "detail", l: "Detail" }].map((o) => (
            <button key={o.v} onClick={() => setView(o.v)} className={`rounded-lg border px-3 py-1.5 text-sm ${view === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-4">
        <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Total Purchased</p>
          <p className="text-2xl font-bold text-slate-800">{fmt2(totalQty)} kg</p>
        </div>
        <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Total Spent</p>
          <p className="text-2xl font-bold text-slate-800">{fmtRiel(totalAmount)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        {view === "summary" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">{groupBy === "party" ? "Supplier" : groupBy === "product" ? "Paddy Type" : "Location"}</th>
                <th className="px-5 py-3 font-medium">Transactions</th>
                <th className="px-5 py-3 font-medium">Qty (kg)</th>
                <th className="px-5 py-3 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <tr key={g.name} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{g.name}</td>
                  <td className="px-5 py-3 text-slate-600">{g.count}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt2(g.qty)}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(g.amount)}</td>
                </tr>
              ))}
              {grouped.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">No purchases yet.</td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Receipt</th>
                <th className="px-5 py-3 font-medium">Supplier</th>
                <th className="px-5 py-3 font-medium">Paddy Type</th>
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Qty (kg)</th>
                <th className="px-5 py-3 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-500">{r.tx_date}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{r.code}</td>
                  <td className="px-5 py-3 text-slate-700">{r.partyName}</td>
                  <td className="px-5 py-3 text-slate-600">{r.productName}</td>
                  <td className="px-5 py-3 text-slate-600">{r.stationName}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt2(r.quantity_kg)}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(r.amount)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">No purchases yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
