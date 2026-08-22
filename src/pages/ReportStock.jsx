import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

export default function ReportStock({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [allStations, setAllStations] = useState([]);
  const [allTxs, setAllTxs] = useState([]);
  const [view, setView] = useState("summary");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  function load() {
    setLoading(true);
    setLoadError("");
    Promise.all([api.getLocations(), api.getTransactions()])
      .then(([s, t]) => {
        setAllStations(s);
        setAllTxs(t.slice().sort((a, b) => (a.tx_date + a.tx_time > b.tx_date + b.tx_time ? 1 : -1)));
      })
      .catch((err) => {
        // Without this, a failed/dropped request silently showed an
        // empty report instead of saying the load itself had failed.
        setLoadError(err.message || "Couldn't load this report — check your connection and try again.");
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const stations = selectedLocationIds.length ? allStations.filter((s) => selectedLocationIds.includes(s.id)) : allStations;
  const txs = allTxs
    .filter((t) => (t.hq_status || "processing") !== "cancelled")
    .filter((t) => !selectedLocationIds.length || selectedLocationIds.includes(t.location_id))
    .filter((t) => !startDate || t.tx_date >= startDate)
    .filter((t) => !endDate || t.tx_date <= endDate);

  // Running balance per location, built from the transaction history.
  // Note: this reconstructs the ledger from BUY(+)/SELL(-) movements only —
  // it doesn't account for any manual stock adjustments made outside the app.
  const movements = useMemo(() => {
    const running = {};
    return txs.map((tx) => {
      const delta = tx.type === "BUY" ? Number(tx.quantity_kg) : -Number(tx.quantity_kg);
      running[tx.location_id] = (running[tx.location_id] || 0) + delta;
      return { ...tx, delta, runningBalance: running[tx.location_id] };
    });
  }, [txs]);

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}
      <div className="mb-4 flex justify-end gap-2">
        {[{ v: "summary", l: "Summary" }, { v: "detail", l: "Movement Detail" }].map((o) => (
          <button key={o.v} onClick={() => setView(o.v)} className={`rounded-lg border px-3 py-1.5 text-sm ${view === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        {view === "summary" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Current Stock (kg)</th>
                <th className="px-5 py-3 font-medium">Capacity (kg)</th>
                <th className="px-5 py-3 font-medium">% Full</th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                const pct = Math.round((Number(s.current_stock_kg) / Number(s.capacity_kg)) * 100);
                return (
                  <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-700">{s.name}</td>
                    <td className="px-5 py-3 text-slate-700">{fmt2(s.current_stock_kg)}</td>
                    <td className="px-5 py-3 text-slate-600">{fmt2(s.capacity_kg)}</td>
                    <td className="px-5 py-3 text-slate-600">{pct}%</td>
                  </tr>
                );
              })}
              {loading && stations.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {stations.length === 0 && !loading && !loadError && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">No locations visible to your account.</td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Receipt</th>
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Change (kg)</th>
                <th className="px-5 py-3 font-medium">Running Balance</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-500">{m.tx_date}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{m.code}</td>
                  <td className="px-5 py-3 text-slate-600">{m.stationName}</td>
                  <td className="px-5 py-3"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${m.type === "BUY" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}>{m.type}</span></td>
                  <td className={`px-5 py-3 font-medium ${m.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{m.delta >= 0 ? "+" : ""}{fmt2(m.delta)}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt2(m.runningBalance)}</td>
                </tr>
              ))}
              {loading && movements.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {movements.length === 0 && !loading && !loadError && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">No stock movements yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
