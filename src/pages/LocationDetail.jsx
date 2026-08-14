import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, TrendingUp, Warehouse } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import RenameLocationModal from "../components/RenameLocationModal.jsx";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

export default function LocationDetail({ locationId, setPage }) {
  const [location, setLocation] = useState(null);
  const [txs, setTxs] = useState([]);
  const [editing, setEditing] = useState(false);

  async function load() {
    const [locs, transactions] = await Promise.all([api.getLocations(), api.getTransactions()]);
    setLocation(locs.find((l) => l.id === locationId) || null);
    setTxs(transactions.filter((t) => t.location_id === locationId));
  }
  useEffect(() => { load(); }, [locationId]);

  const summary = useMemo(() => {
    const buys = txs.filter((t) => t.type === "BUY");
    const sells = txs.filter((t) => t.type === "SELL");
    const totalBuy = buys.reduce((s, t) => s + Number(t.amount), 0);
    const totalSell = sells.reduce((s, t) => s + Number(t.amount), 0);
    return {
      totalBuy, totalSell, profit: totalSell - totalBuy,
      buyKg: buys.reduce((s, t) => s + Number(t.quantity_kg), 0),
      sellKg: sells.reduce((s, t) => s + Number(t.quantity_kg), 0),
      txCount: txs.length,
    };
  }, [txs]);

  if (!location) {
    return (
      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <Topbar title="Location" />
        <main className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</main>
      </div>
    );
  }

  const pct = Math.round((Number(location.current_stock_kg) / Number(location.capacity_kg)) * 100);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={location.name} subtitle={location.name_kh} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={() => setPage("stations")} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
            <ArrowLeft size={15} /> Back to Locations
          </button>
          <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700">
            <Pencil size={13} /> Rename
          </button>
        </div>

        <div className="mb-5 grid grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><Warehouse size={13} /> Current Stock</div>
            <p className="text-xl font-bold text-slate-800">{fmt2(location.current_stock_kg)} kg</p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
            <p className="mt-1 text-xs text-slate-400">{pct}% of {fmt2(location.capacity_kg)} kg capacity</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><TrendingUp size={13} /> Total Purchased</div>
            <p className="text-xl font-bold text-slate-800">{fmt2(summary.buyKg)} kg</p>
            <p className="mt-1 text-xs text-slate-400">{fmtRiel(summary.totalBuy)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><TrendingUp size={13} /> Total Sold</div>
            <p className="text-xl font-bold text-slate-800">{fmt2(summary.sellKg)} kg</p>
            <p className="mt-1 text-xs text-slate-400">{fmtRiel(summary.totalSell)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 text-xs text-slate-400">Gross Profit</div>
            <p className={`text-xl font-bold ${summary.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmtRiel(summary.profit)}</p>
            <p className="mt-1 text-xs text-slate-400">{summary.txCount} transactions total</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="font-semibold text-slate-700">Transaction History</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Receipt</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Party</th>
                <th className="px-5 py-3 font-medium">Qty (kg)</th>
                <th className="px-5 py-3 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {txs.slice().sort((a, b) => (a.tx_date + a.tx_time < b.tx_date + b.tx_time ? 1 : -1)).map((t) => (
                <tr key={t.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-500">{t.tx_date}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{t.code}</td>
                  <td className="px-5 py-3"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${t.type === "BUY" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}>{t.type}</span></td>
                  <td className="px-5 py-3 text-slate-700">{t.partyName}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt2(t.quantity_kg)}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(t.amount)}</td>
                </tr>
              ))}
              {txs.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">No transactions yet at this location.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>

      {editing && (
        <RenameLocationModal
          location={location}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setLocation(updated); setEditing(false); }}
        />
      )}
    </div>
  );
}
