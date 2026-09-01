import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

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
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}
      <div className="mb-4 flex justify-end gap-2">
        {[{ v: "summary", l: "Summary" }, { v: "detail", l: "Movement Detail" }].map((o) => (
          <button key={o.v} onClick={() => setView(o.v)} className={`rounded-lg border px-3 py-1.5 text-[13.5px] ${view === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
        ))}
      </div>

      {view === "summary" ? (
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>Location</Th><Th num>Current Stock (kg)</Th><Th num>Capacity (kg)</Th><Th num>% Full</Th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                const pct = Math.round((Number(s.current_stock_kg) / Number(s.capacity_kg)) * 100);
                return (
                  <Tr key={s.id}>
                    <Td name>{s.name}</Td>
                    <Td num>{fmt2(s.current_stock_kg)}</Td>
                    <Td num>{fmt2(s.capacity_kg)}</Td>
                    <Td num>{pct}%</Td>
                  </Tr>
                );
              })}
              {loading && stations.length === 0 && <Tr><td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
              {stations.length === 0 && !loading && !loadError && <Tr><td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No locations visible to your account.</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      ) : (
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th><Th>Receipt</Th><Th>Location</Th><Th>Type</Th><Th num>Change (kg)</Th><Th num>Running Balance</Th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <Tr key={m.id}>
                  <Td>{m.tx_date}</Td>
                  <Td name>{m.code}</Td>
                  <Td>{m.stationName}</Td>
                  <Td><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${m.type === "BUY" ? "bg-brand-50 text-brand-700" : "bg-rose-50 text-rose-600"}`}>{m.type}</span></Td>
                  <Td num className={m.delta >= 0 ? "!text-brand-700 !font-semibold" : "!text-rose-600 !font-semibold"}>{m.delta >= 0 ? "+" : ""}{fmt2(m.delta)}</Td>
                  <Td num>{fmt2(m.runningBalance)}</Td>
                </Tr>
              ))}
              {loading && movements.length === 0 && <Tr><td colSpan={6} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
              {movements.length === 0 && !loading && !loadError && <Tr><td colSpan={6} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No stock movements yet.</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}
