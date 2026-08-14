import { useEffect, useMemo, useState } from "react";
import { Pencil, ChevronRight, Layers } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import RenameLocationModal from "../components/RenameLocationModal.jsx";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

function periodStart(period) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === "today") return d;
  if (period === "week") { d.setDate(d.getDate() - 6); return d; }
  if (period === "month") { d.setDate(d.getDate() - 29); return d; }
  return null; // all time
}

export default function LocationsPage({ setPage, setSelectedLocationId }) {
  const [locations, setLocations] = useState([]);
  const [txs, setTxs] = useState([]);
  const [period, setPeriod] = useState("week");
  const [editingLocation, setEditingLocation] = useState(null);

  async function load() {
    const [locs, transactions] = await Promise.all([api.getLocations(), api.getTransactions()]);
    setLocations(locs);
    setTxs(transactions);
  }
  useEffect(() => { load(); }, []);

  const totalsByLocation = useMemo(() => {
    const start = periodStart(period);
    const map = {};
    txs.forEach((tx) => {
      if ((tx.hq_status || "processing") === "cancelled") return;
      if (start && new Date(tx.tx_date) < start) return;
      if (!map[tx.location_id]) map[tx.location_id] = { boughtKg: 0, boughtAmt: 0, soldKg: 0, soldAmt: 0 };
      if (tx.type === "BUY") { map[tx.location_id].boughtKg += Number(tx.quantity_kg); map[tx.location_id].boughtAmt += Number(tx.amount); }
      else { map[tx.location_id].soldKg += Number(tx.quantity_kg); map[tx.location_id].soldAmt += Number(tx.amount); }
    });
    return map;
  }, [txs, period]);

  function openDetail(id) {
    setSelectedLocationId(id);
    setPage("station-detail");
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Locations" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">All Locations</h2>
          <div className="flex items-center gap-2">
            {[{ v: "today", l: "Today" }, { v: "week", l: "This Week" }, { v: "month", l: "This Month" }, { v: "all", l: "All Time" }].map((o) => (
              <button key={o.v} onClick={() => setPeriod(o.v)} className={`rounded-lg border px-3 py-1.5 text-sm ${period === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
            ))}
            <button onClick={() => openDetail("all")} className="ml-2 flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              <Layers size={14} /> View All Combined
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Khmer</th>
                <th className="px-5 py-3 font-medium">Stock (kg)</th>
                <th className="px-5 py-3 font-medium">Capacity (kg)</th>
                <th className="px-5 py-3 font-medium">Bought</th>
                <th className="px-5 py-3 font-medium">Sold</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => {
                const t = totalsByLocation[loc.id] || { boughtKg: 0, boughtAmt: 0, soldKg: 0, soldAmt: 0 };
                return (
                  <tr key={loc.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700">{loc.name}</span>
                        <button onClick={() => setEditingLocation(loc)} className="text-slate-300 hover:text-brand-600" title="Rename">
                          <Pencil size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{loc.name_kh}</td>
                    <td className="px-5 py-3 text-slate-700">{fmt2(loc.current_stock_kg)}</td>
                    <td className="px-5 py-3 text-slate-600">{fmt2(loc.capacity_kg)}</td>
                    <td className="px-5 py-3">
                      <p className="text-slate-700">{fmt2(t.boughtKg)} kg</p>
                      <p className="text-xs text-slate-400">{fmtRiel(t.boughtAmt)}</p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-slate-700">{fmt2(t.soldKg)} kg</p>
                      <p className="text-xs text-slate-400">{fmtRiel(t.soldAmt)}</p>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openDetail(loc.id)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700">
                        View Details <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {locations.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">No locations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>

      {editingLocation && (
        <RenameLocationModal
          location={editingLocation}
          onClose={() => setEditingLocation(null)}
          onSaved={(updated) => {
            setLocations((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
            setEditingLocation(null);
          }}
        />
      )}
    </div>
  );
}
