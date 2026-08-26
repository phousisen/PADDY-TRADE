import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, TrendingUp, Warehouse, MapPin } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import RenameLocationModal from "../components/RenameLocationModal.jsx";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

export default function LocationDetail({ locationId, setPage }) {
  const isCombined = locationId === "all";
  const [allLocations, setAllLocations] = useState([]);
  const [location, setLocation] = useState(null);
  const [txs, setTxs] = useState([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [locs, transactions] = await Promise.all([api.getLocations(), api.getTransactions()]);
      setAllLocations(locs);
      if (isCombined) {
        setLocation(null);
        setTxs(transactions);
      } else {
        setLocation(locs.find((l) => l.id === locationId) || null);
        setTxs(transactions.filter((t) => t.location_id === locationId));
      }
    } catch (err) {
      // Without this, a failed/dropped request left this whole page stuck
      // showing "Loading…" forever with no error and no way to retry.
      setLoadError(err.message || "Couldn't load this location — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [locationId]);

  const summary = useMemo(() => {
    const active = txs.filter((t) => (t.hq_status || "processing") !== "cancelled");
    const buys = active.filter((t) => t.type === "BUY");
    const sells = active.filter((t) => t.type === "SELL");
    const totalBuy = buys.reduce((s, t) => s + Number(t.amount), 0);
    const totalSell = sells.reduce((s, t) => s + Number(t.amount), 0);
    return {
      totalBuy, totalSell, profit: totalSell - totalBuy,
      buyKg: buys.reduce((s, t) => s + Number(t.quantity_kg), 0),
      sellKg: sells.reduce((s, t) => s + Number(t.quantity_kg), 0),
      txCount: active.length,
    };
  }, [txs]);

  const combinedStock = useMemo(() => allLocations.reduce((s, l) => s + Number(l.current_stock_kg), 0), [allLocations]);
  const combinedCapacity = useMemo(() => allLocations.reduce((s, l) => s + Number(l.capacity_kg), 0), [allLocations]);

  if (!isCombined && !location) {
    return (
      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <Topbar title={<>Location<span className="font-khmer block text-sm font-normal text-slate-500">ទីតាំង</span></>} />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-slate-400">
          {loadError ? (
            <>
              <p className="text-rose-500">{loadError}</p>
              <button onClick={load} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Retry<span className="font-khmer block text-xs">ព្យាយាមម្តងទៀត</span></button>
            </>
          ) : loading ? (
            <>Loading…<span className="font-khmer block">កំពុងផ្ទុក…</span></>
          ) : (
            <>
              <p>This location couldn't be found.<span className="font-khmer block">រកមិនឃើញទីតាំងនេះទេ។</span></p>
              <button onClick={() => setPage("stations")} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Back to Locations<span className="font-khmer block text-xs">ត្រឡប់ទៅទីតាំង</span></button>
            </>
          )}
        </main>
      </div>
    );
  }

  const stockKg = isCombined ? combinedStock : Number(location.current_stock_kg);
  const capacityKg = isCombined ? combinedCapacity : Number(location.capacity_kg);
  const pct = Math.round((stockKg / capacityKg) * 100);
  const displayName = isCombined ? "All Locations Combined" : location.name;
  const displayNameKh = isCombined ? "ទីតាំងទាំងអស់រួមគ្នា" : location.name_kh;

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={displayName} subtitle={displayNameKh} />
      <main className="flex-1 overflow-y-auto p-6">
        {loadError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry<span className="font-khmer block text-[10px]">ព្យាយាមម្តងទៀត</span></button>
          </div>
        )}
        <div className="mb-4 flex items-center justify-between">
          <button onClick={() => setPage("stations")} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
            <ArrowLeft size={15} /> Back to Locations<span className="font-khmer text-xs">&nbsp;ត្រឡប់ទៅទីតាំង</span>
          </button>
          {!isCombined && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700">
              <Pencil size={13} /> Rename<span className="font-khmer text-xs">&nbsp;ប្តូរឈ្មោះ</span>
            </button>
          )}
        </div>

        <div className="mb-5 grid grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><Warehouse size={13} /> {isCombined ? "Combined Stock" : "Current Stock"}<span className="font-khmer">&nbsp;{isCombined ? "ស្តុករួម" : "ស្តុកបច្ចុប្បន្ន"}</span></div>
            <p className="text-xl font-bold text-slate-800">{fmt2(stockKg)} kg</p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
            <p className="mt-1 text-xs text-slate-400">{pct}% of {fmt2(capacityKg)} kg capacity<span className="font-khmer block text-[11px]">{pct}% នៃចំណុះ {fmt2(capacityKg)} គីឡូក្រាម</span></p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><TrendingUp size={13} /> Total Purchased<span className="font-khmer">&nbsp;ទិញសរុប</span></div>
            <p className="text-xl font-bold text-slate-800">{fmt2(summary.buyKg)} kg</p>
            <p className="mt-1 text-xs text-slate-400">{fmtRiel(summary.totalBuy)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><TrendingUp size={13} /> Total Sold<span className="font-khmer">&nbsp;លក់សរុប</span></div>
            <p className="text-xl font-bold text-slate-800">{fmt2(summary.sellKg)} kg</p>
            <p className="mt-1 text-xs text-slate-400">{fmtRiel(summary.totalSell)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 text-xs text-slate-400">Gross Profit<span className="font-khmer">&nbsp;ចំណេញសរុប</span></div>
            <p className={`text-xl font-bold ${summary.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmtRiel(summary.profit)}</p>
            <p className="mt-1 text-xs text-slate-400">{summary.txCount} transactions total<span className="font-khmer block text-[11px]">{summary.txCount} ប្រតិបត្តិការសរុប</span></p>
          </div>
        </div>

        {isCombined && allLocations.length > 0 && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="font-semibold text-slate-700">Stock by Location<span className="font-khmer block text-xs font-normal">ស្តុកតាមទីតាំង</span></h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-2 font-medium">Location<span className="font-khmer block text-[10px]">ទីតាំង</span></th>
                  <th className="px-5 py-2 font-medium">Stock (kg)<span className="font-khmer block text-[10px]">ស្តុក (គីឡូក្រាម)</span></th>
                  <th className="px-5 py-2 font-medium">Capacity (kg)<span className="font-khmer block text-[10px]">ចំណុះ (គីឡូក្រាម)</span></th>
                </tr>
              </thead>
              <tbody>
                {allLocations.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2 font-medium text-slate-700">{l.name}</td>
                    <td className="px-5 py-2 text-slate-700">{fmt2(l.current_stock_kg)}</td>
                    <td className="px-5 py-2 text-slate-600">{fmt2(l.capacity_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="font-semibold text-slate-700">Transaction History<span className="font-khmer block text-xs font-normal">ប្រវត្តិប្រតិបត្តិការ</span></h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Date<span className="font-khmer block text-[10px]">កាលបរិច្ឆេទ</span></th>
                <th className="px-5 py-3 font-medium">Receipt<span className="font-khmer block text-[10px]">បង្កាន់ដៃ</span></th>
                {isCombined && <th className="px-5 py-3 font-medium">Location<span className="font-khmer block text-[10px]">ទីតាំង</span></th>}
                <th className="px-5 py-3 font-medium">Type<span className="font-khmer block text-[10px]">ប្រភេទ</span></th>
                <th className="px-5 py-3 font-medium">Party<span className="font-khmer block text-[10px]">ភាគី</span></th>
                <th className="px-5 py-3 font-medium">Qty (kg)<span className="font-khmer block text-[10px]">បរិមាណ (គីឡូក្រាម)</span></th>
                <th className="px-5 py-3 font-medium">Amount<span className="font-khmer block text-[10px]">ចំនួនទឹកប្រាក់</span></th>
                <th className="px-5 py-3 font-medium">Status<span className="font-khmer block text-[10px]">ស្ថានភាព</span></th>
              </tr>
            </thead>
            <tbody>
              {txs.slice().sort((a, b) => (a.tx_date + a.tx_time < b.tx_date + b.tx_time ? 1 : -1)).map((t) => {
                const isCancelled = (t.hq_status || "processing") === "cancelled";
                return (
                <tr key={t.id} className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${isCancelled ? "opacity-50" : ""}`}>
                  <td className="px-5 py-3 text-slate-500">{t.tx_date}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{t.code}</td>
                  {isCombined && <td className="px-5 py-3 text-slate-600"><div className="flex items-center gap-1"><MapPin size={12} className="text-slate-300" />{t.stationName}</div></td>}
                  <td className="px-5 py-3"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${t.type === "BUY" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>{t.type}</span></td>
                  <td className="px-5 py-3 text-slate-700">{t.partyName}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt2(t.quantity_kg)}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(t.amount)}</td>
                  <td className="px-5 py-3">
                    {isCancelled ? (
                      <span className="text-xs font-medium text-slate-400 line-through">Cancelled<span className="font-khmer block text-[10px] no-underline">បានលុបចោល</span></span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );})}
              {txs.length === 0 && <tr><td colSpan={isCombined ? 8 : 7} className="px-5 py-10 text-center text-sm text-slate-400">No transactions yet.<span className="font-khmer block">មិនទាន់មានប្រតិបត្តិការទេ។</span></td></tr>}
            </tbody>
          </table>
        </div>
      </main>

      {editing && location && (
        <RenameLocationModal
          location={location}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setLocation(updated); setEditing(false); }}
        />
      )}
    </div>
  );
}
