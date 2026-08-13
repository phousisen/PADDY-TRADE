import { useEffect, useState } from "react";
import { RefreshCw, TrendingUp, Gauge, MapPin, ChevronRight } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }

export default function StockInventory() {
  const { t } = useLanguage();
  const [stations, setStations] = useState([]);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [st, tx] = await Promise.all([api.getLocations(), api.getTransactions()]);
    setStations(st);
    setTxs(tx);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const totalStockKg = stations.reduce((s, x) => s + Number(x.current_stock_kg), 0);
  const totalCapacityKg = stations.reduce((s, x) => s + Number(x.capacity_kg), 0);
  const capacityPct = totalCapacityKg ? Math.round((totalStockKg / totalCapacityKg) * 100) : 0;
  const avgPrice = txs.length ? txs.reduce((s, x) => s + Number(x.price_per_kg), 0) / txs.length : 0;
  const estimatedValue = Math.round(totalStockKg * avgPrice);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("stock_title")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{t("stock_title")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("stock_subtitle")}</p>
          </div>
          <button onClick={load} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {t("refresh")}
          </button>
        </div>

        <div className="mb-6 flex gap-4">
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400"><TrendingUp size={14} /><span>{t("total_stock")}</span></div>
            <p className="text-3xl font-bold text-slate-800">{fmt(totalStockKg)}<span className="ml-1 text-base font-medium text-slate-400">KG</span></p>
          </div>
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400"><Gauge size={14} /><span>{t("est_value")}</span></div>
            <p className="text-3xl font-bold text-slate-800">{(estimatedValue / 1_000_000_000).toFixed(2)}<span className="ml-1 text-base font-medium text-slate-400">Billion Riel</span></p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(capacityPct, 100)}%` }} /></div>
            <p className="mt-1 text-xs text-slate-400">{capacityPct}% {t("of_capacity")}</p>
          </div>
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400"><MapPin size={14} /><span>{t("location_count")}</span></div>
            <p className="text-3xl font-bold text-slate-800">{stations.length}</p>
            <p className="mt-1 text-xs text-slate-400">{t("locations")}</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="font-semibold text-slate-700">{t("stock_by_station")}</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">{t("station")}</th>
                <th className="px-5 py-2 font-medium">{t("quantity_kg")}</th>
                <th className="px-5 py-2 font-medium">{t("capacity")}</th>
                <th className="px-5 py-2 font-medium">{t("updated")}</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                const pct = Math.round((Number(s.current_stock_kg) / Number(s.capacity_kg)) * 100);
                return (
                  <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3"><p className="font-medium text-slate-700">{s.name}</p><p className="text-xs text-slate-400">{s.name_kh}</p></td>
                    <td className="px-5 py-3 font-medium text-slate-700">{fmt(s.current_stock_kg)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-32 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${pct > 80 ? "bg-emerald-500" : pct > 40 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                        <span className="text-xs text-slate-400">{pct}% {t("max")}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400">{s.updated_ago}</td>
                    <td className="px-5 py-3 text-right"><ChevronRight size={16} className="ml-auto text-slate-300" /></td>
                  </tr>
                );
              })}
              {stations.length === 0 && !loading && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">No locations visible to your account.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
