import { Fragment, useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp, Gauge, MapPin, ChevronRight, ChevronDown, Layers } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }

export default function StockInventory() {
  const { t } = useLanguage();
  const [stations, setStations] = useState([]);
  const [products, setProducts] = useState([]);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  async function load() {
    setLoading(true);
    const [st, tx, pr] = await Promise.all([api.getLocations(), api.getTransactions(), api.getProducts()]);
    setStations(st);
    setTxs(tx);
    setProducts(pr);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const totalStockKg = stations.reduce((s, x) => s + Number(x.current_stock_kg), 0);
  const totalCapacityKg = stations.reduce((s, x) => s + Number(x.capacity_kg), 0);
  const capacityPct = totalCapacityKg ? Math.round((totalStockKg / totalCapacityKg) * 100) : 0;
  const avgPrice = txs.length ? txs.reduce((s, x) => s + Number(x.price_per_kg), 0) / txs.length : 0;
  const estimatedValue = Math.round(totalStockKg * avgPrice);

  const productsById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  // Stock isn't tracked per paddy type in the database — each location just
  // has one running total. To break it down by type, replay every
  // transaction's net weight (weight minus quality deduction), adding it for
  // Buys and subtracting it for Sells, grouped by location and paddy type.
  const stockByLocationProduct = useMemo(() => {
    const map = {};
    for (const tx of txs) {
      if (!tx.location_id || !tx.product_id) continue;
      const payable = Math.max(0, Number(tx.quantity_kg || 0) - Number(tx.deduction_kg || 0));
      const delta = tx.type === "BUY" ? payable : -payable;
      map[tx.location_id] = map[tx.location_id] || {};
      map[tx.location_id][tx.product_id] = (map[tx.location_id][tx.product_id] || 0) + delta;
    }
    return map;
  }, [txs]);

  const combinedByProduct = useMemo(() => {
    const map = {};
    for (const locId in stockByLocationProduct) {
      for (const prodId in stockByLocationProduct[locId]) {
        map[prodId] = (map[prodId] || 0) + stockByLocationProduct[locId][prodId];
      }
    }
    return map;
  }, [stockByLocationProduct]);

  // Value paddy type by its own average trade price rather than the one
  // blended average, so a premium type doesn't get under/over-valued.
  const avgPriceByProduct = useMemo(() => {
    const sums = {}, counts = {};
    for (const tx of txs) {
      if (!tx.product_id) continue;
      sums[tx.product_id] = (sums[tx.product_id] || 0) + Number(tx.price_per_kg || 0);
      counts[tx.product_id] = (counts[tx.product_id] || 0) + 1;
    }
    const out = {};
    for (const id in sums) out[id] = sums[id] / counts[id];
    return out;
  }, [txs]);

  function productRows(byProduct) {
    return Object.entries(byProduct)
      .filter(([, kg]) => Math.abs(kg) > 0.01)
      .map(([prodId, kg]) => ({
        id: prodId,
        name: productsById[prodId]?.name || "—",
        kg,
        value: kg * (avgPriceByProduct[prodId] ?? avgPrice),
      }))
      .sort((a, b) => b.kg - a.kg);
  }

  const combinedRows = productRows(combinedByProduct);

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

        <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="font-semibold text-slate-700">{t("stock_by_station")}</h3>
            <p className="text-xs text-slate-400">Click a location to see its paddy type breakdown</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">{t("station")}</th>
                <th className="px-5 py-2 font-medium">{t("quantity_kg")}</th>
                <th className="px-5 py-2 font-medium">{t("stock_value_col")}</th>
                <th className="px-5 py-2 font-medium">{t("updated")}</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                const stationValue = Number(s.current_stock_kg) * avgPrice;
                const isOpen = expandedId === s.id;
                const rows = productRows(stockByLocationProduct[s.id] || {});
                return (
                  <Fragment key={s.id}>
                    <tr onClick={() => setExpandedId(isOpen ? null : s.id)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-5 py-3"><p className="font-medium text-slate-700">{s.name}</p><p className="text-xs text-slate-400">{s.name_kh}</p></td>
                      <td className="px-5 py-3 font-medium text-slate-700">{fmt(s.current_stock_kg)}</td>
                      <td className="px-5 py-3 font-medium text-slate-700">{fmtRiel(stationValue)}</td>
                      <td className="px-5 py-3 text-xs text-slate-400">{s.updated_ago}</td>
                      <td className="px-5 py-3 text-right">
                        {isOpen ? <ChevronDown size={16} className="ml-auto text-slate-400" /> : <ChevronRight size={16} className="ml-auto text-slate-300" />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-slate-50 bg-slate-50/60 last:border-0">
                        <td colSpan={5} className="px-5 py-3">
                          {rows.length === 0 ? (
                            <p className="py-2 text-center text-xs text-slate-400">No paddy type breakdown yet for this location.</p>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-slate-400">
                                  <th className="py-1.5 pl-2 font-medium">Paddy Type</th>
                                  <th className="py-1.5 font-medium">{t("quantity_kg")}</th>
                                  <th className="py-1.5 font-medium">{t("stock_value_col")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((r) => (
                                  <tr key={r.id} className="border-t border-white">
                                    <td className="py-1.5 pl-2 text-slate-600">{r.name}</td>
                                    <td className="py-1.5 font-medium text-slate-700">{fmt(r.kg)}</td>
                                    <td className="py-1.5 font-medium text-slate-700">{fmtRiel(r.value)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {stations.length === 0 && !loading && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">No locations visible to your account.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="flex items-center gap-2 font-semibold text-slate-700"><Layers size={16} className="text-brand-600" /> Stock by Paddy Type — All Locations Combined</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">Paddy Type</th>
                <th className="px-5 py-2 font-medium">{t("quantity_kg")}</th>
                <th className="px-5 py-2 font-medium">{t("stock_value_col")}</th>
              </tr>
            </thead>
            <tbody>
              {combinedRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{r.name}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{fmt(r.kg)}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{fmtRiel(r.value)}</td>
                </tr>
              ))}
              {combinedRows.length === 0 && !loading && (
                <tr><td colSpan={3} className="px-5 py-10 text-center text-sm text-slate-400">No stock recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
