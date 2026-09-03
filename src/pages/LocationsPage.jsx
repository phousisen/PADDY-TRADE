import { useEffect, useMemo, useState } from "react";
import { Pencil, ChevronRight, Layers, Plus, MapPin, Package, ArrowDownCircle, ArrowUpCircle, Star } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import RenameLocationModal from "../components/RenameLocationModal.jsx";
import AddLocationModal from "../components/AddLocationModal.jsx";
import { api } from "../api.js";
import { getAccurateNow } from "../supabaseClient.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtPct(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

function periodStart(period) {
  const d = getAccurateNow();
  d.setHours(0, 0, 0, 0);
  if (period === "today") return d;
  if (period === "week") { d.setDate(d.getDate() - 6); return d; }
  if (period === "month") { d.setDate(d.getDate() - 29); return d; }
  return null; // all time
}

const PERIODS = [
  { v: "today", l: "Today" },
  { v: "week", l: "This Week" },
  { v: "month", l: "This Month" },
  { v: "all", l: "All Time" },
];

export default function LocationsPage({ setPage, setSelectedLocationId }) {
  const [locations, setLocations] = useState([]);
  const [txs, setTxs] = useState([]);
  const [period, setPeriod] = useState("week");
  const [editingLocation, setEditingLocation] = useState(null);
  const [addingLocation, setAddingLocation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [locs, transactions] = await Promise.all([api.getLocations(), api.getTransactions()]);
      setLocations(locs);
      setTxs(transactions);
    } catch (err) {
      // Without this, a failed/dropped request silently showed "No
      // locations yet" — as if every station had been wiped out — instead
      // of saying the load itself had failed.
      setLoadError(err.message || "Couldn't load locations — check your connection and try again.");
    } finally {
      setLoading(false);
    }
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

  // Total stock across every station — the denominator for each row's
  // "% of total" figure, and the number shown in the Stock on Hand card.
  const totalStockKg = useMemo(
    () => locations.reduce((sum, l) => sum + Number(l.current_stock_kg || 0), 0),
    [locations]
  );

  // Sums of the same period-filtered Bought/Sold figures already computed
  // per-station above — reused here rather than re-scanning txs, so the
  // KPI strip always agrees with the table beneath it by construction.
  const periodTotals = useMemo(() => {
    const t = { boughtKg: 0, boughtAmt: 0, soldKg: 0, soldAmt: 0 };
    Object.values(totalsByLocation).forEach((row) => {
      t.boughtKg += row.boughtKg; t.boughtAmt += row.boughtAmt;
      t.soldKg += row.soldKg; t.soldAmt += row.soldAmt;
    });
    return t;
  }, [totalsByLocation]);

  // The single highest-stock station gets the "Top Station" badge — but
  // only when it actually holds stock, so a fresh board with everyone at
  // zero doesn't randomly crown whichever station happens to sort first.
  const topLocationId = useMemo(() => {
    let top = null;
    for (const l of locations) {
      const kg = Number(l.current_stock_kg || 0);
      if (kg > 0 && (!top || kg > Number(top.current_stock_kg))) top = l;
    }
    return top?.id ?? null;
  }, [locations]);

  const periodLabel = PERIODS.find((p) => p.v === period)?.l || "This Week";

  function openDetail(id) {
    setSelectedLocationId(id);
    setPage("station-detail");
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Locations" subtitle={`${locations.length} station${locations.length === 1 ? "" : "s"} · Cambodia`} />
      <main className="flex-1 overflow-y-auto p-6">
        {loadError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        )}

        {/* KPI strip */}
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-slate-100 text-slate-500">
              <MapPin size={17} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Stations</p>
              <p className="text-lg font-extrabold text-slate-800">{locations.length}</p>
              <p className="text-xs text-slate-400">active locations</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
              <Package size={17} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Stock on Hand</p>
              <p className="truncate text-lg font-extrabold tabular-nums text-slate-800">{fmt2(totalStockKg)} <span className="text-xs font-medium text-slate-400">kg</span></p>
              <p className="text-xs text-slate-400">across all stations</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
              <ArrowDownCircle size={17} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Bought</p>
                <span className="rounded-full bg-gold-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold-700">{periodLabel}</span>
              </div>
              <p className="truncate text-lg font-extrabold tabular-nums text-slate-800">{fmt2(periodTotals.boughtKg)} <span className="text-xs font-medium text-slate-400">kg</span></p>
              <p className="truncate text-xs tabular-nums text-slate-400">{fmtRiel(periodTotals.boughtAmt)}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-slate-50 text-slate-300">
              <ArrowUpCircle size={17} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sold</p>
                <span className="rounded-full bg-gold-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold-700">{periodLabel}</span>
              </div>
              <p className={`truncate text-lg font-extrabold tabular-nums ${periodTotals.soldKg > 0 ? "text-slate-800" : "text-slate-300"}`}>
                {fmt2(periodTotals.soldKg)} <span className="text-xs font-medium text-slate-400">kg</span>
              </p>
              <p className="truncate text-xs text-slate-400">{periodTotals.soldKg > 0 ? fmtRiel(periodTotals.soldAmt) : "no sales recorded yet"}</p>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-800">Station Breakdown</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-[9px] bg-slate-100 p-[3px]">
              {PERIODS.map((o) => (
                <button
                  key={o.v}
                  onClick={() => setPeriod(o.v)}
                  className={`rounded-[7px] px-3 py-1.5 text-[12.5px] transition ${
                    period === o.v ? "bg-white font-bold text-brand-700 shadow-sm" : "font-medium text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <button
              onClick={() => openDetail("all")}
              className="flex items-center gap-1.5 rounded-[9px] bg-brand-600 px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-[0_1px_2px_rgba(33,122,79,0.25)] hover:bg-brand-700"
            >
              <Layers size={13} /> View All Combined
            </button>
            <button
              onClick={() => setAddingLocation(true)}
              className="flex items-center gap-1.5 rounded-[9px] border border-brand-300 bg-white px-3.5 py-1.5 text-[12.5px] font-bold text-brand-700 hover:bg-brand-50"
            >
              <Plus size={13} /> Add Location
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-semibold">Station</th>
                <th className="px-5 py-3 text-right font-semibold">Current Stock</th>
                <th className="px-5 py-3 text-right font-semibold">Bought · {periodLabel}</th>
                <th className="px-5 py-3 text-right font-semibold">Sold · {periodLabel}</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc, i) => {
                const t = totalsByLocation[loc.id] || { boughtKg: 0, boughtAmt: 0, soldKg: 0, soldAmt: 0 };
                const stockKg = Number(loc.current_stock_kg || 0);
                const share = totalStockKg > 0 ? (stockKg / totalStockKg) * 100 : 0;
                const isTop = loc.id === topLocationId;
                const hasStock = stockKg > 0;
                return (
                  <tr key={loc.id} className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${i % 2 === 1 ? "bg-slate-50/40" : ""}`}>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-semibold ${hasStock ? "text-slate-800" : "text-slate-400"}`}>{loc.name}</span>
                        <button onClick={() => setEditingLocation(loc)} className="text-slate-300 hover:text-brand-600" title="Rename">
                          <Pencil size={12} />
                        </button>
                        {isTop && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-gold-700">
                            <Star size={9} className="fill-gold-500 text-gold-500" /> Top Station
                          </span>
                        )}
                        {!hasStock && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-400">No Stock Yet</span>
                        )}
                      </div>
                      {loc.name_kh && <p className="mt-0.5 font-khmer text-xs text-slate-400">{loc.name_kh}</p>}
                      <div className="mt-1.5 h-[3px] w-24 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, share)}%` }} />
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      <p className={`font-bold ${hasStock ? "text-slate-800" : "text-slate-300"}`}>
                        {fmt2(stockKg)} <span className="text-xs font-normal text-slate-400">kg</span>
                      </p>
                      <p className={`text-xs ${isTop ? "font-semibold text-brand-600" : hasStock ? "text-slate-400" : "text-slate-300"}`}>
                        {fmtPct(share)}% of total
                      </p>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      <p className={`font-bold ${hasStock || t.boughtKg > 0 ? "text-slate-800" : "text-slate-300"}`}>
                        {fmt2(t.boughtKg)} <span className="text-xs font-normal text-slate-400">kg</span>
                      </p>
                      <p className="text-xs text-slate-400">{t.boughtKg > 0 ? fmtRiel(t.boughtAmt) : "—"}</p>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      <p className={`font-bold ${t.soldKg > 0 ? "text-slate-800" : "text-slate-300"}`}>
                        {fmt2(t.soldKg)} <span className="text-xs font-normal text-slate-400">kg</span>
                      </p>
                      <p className="text-xs text-slate-300">{t.soldKg > 0 ? fmtRiel(t.soldAmt) : "—"}</p>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button onClick={() => openDetail(loc.id)} className="text-slate-300 hover:text-brand-600" title="View Details">
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {loading && locations.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {locations.length === 0 && !loading && !loadError && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">No locations yet.</td></tr>}
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

      {addingLocation && (
        <AddLocationModal
          onClose={() => setAddingLocation(false)}
          onCreated={(created) => {
            setLocations((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
            setAddingLocation(false);
          }}
        />
      )}
    </div>
  );
}
