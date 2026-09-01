import { Fragment, useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp, Gauge, MapPin, ChevronRight, ChevronDown, Layers, Scale, RotateCcw } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { AdjustStockModal, ADJUSTMENT_REASONS } from "../components/AdjustStockModal.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { getAccurateNow } from "../supabaseClient.js";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }
// Cambodia's current calendar date (YYYY-MM-DD) — same helper as
// Transactions.jsx/WeighingTickets.jsx, reading getAccurateNow() rather
// than the device's own clock (see section 14's clock-accuracy fix).
function cambodiaDateStr(d = getAccurateNow()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function StockInventory() {
  const { t } = useLanguage();
  const { profile, session, hasPermission } = useAuth();
  const isAdmin = profile?.role === "admin";
  // Defaults to HQ Admin/Owner only until a custom role is explicitly
  // granted "adjust_stock" from the Roles page — no code change needed to
  // open this up to station staff later, just a checkbox there.
  const canAdjustStock = isAdmin || hasPermission("adjust_stock");
  const [stations, setStations] = useState([]);
  const [products, setProducts] = useState([]);
  const [txs, setTxs] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [adjustStation, setAdjustStation] = useState(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      // getStockAdjustments() is caught on its own, separately from the
      // other three — the Stock Loss Log is one section of this page, not
      // the whole thing, so a problem with IT (a bad join, a network blip)
      // should only leave that section empty, never take down stations,
      // totals, and the paddy-type breakdown along with it. Promise.all
      // without this would reject entirely the moment any one of the four
      // calls fails, and the catch block below never gets to set anything.
      const [st, tx, pr, adj] = await Promise.all([
        api.getLocations(),
        api.getTransactions(),
        api.getProducts(),
        api.getStockAdjustments().catch(() => []),
      ]);
      setStations(st);
      setTxs(tx);
      setProducts(pr);
      setAdjustments(adj);
    } catch (err) {
      // Without this, a failed/dropped request left the refresh icon
      // spinning forever with no error and no way to tell what happened.
      setLoadError(err.message || "Couldn't load stock — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submitAdjustment({ newStockKg, reason, note, pricePerKg }) {
    const station = adjustStation;
    const previousStockKg = Number(station.current_stock_kg) || 0;
    await api.recordStockAdjustment({
      locationId: station.id, previousStockKg, newStockKg, reason, note, pricePerKg, userId: session.user.id,
    });
    // Logged the same way every other significant change in the app is —
    // edits, cancellations, payments — so it shows up in the Activity Log
    // alongside everything else, not just as a number that quietly changed.
    await api.logAudit({
      action: "adjust_stock",
      tableName: "locations",
      recordId: station.id,
      oldData: { current_stock_kg: previousStockKg },
      newData: { current_stock_kg: newStockKg, reason, note, pricePerKg, stationName: station.name },
      userId: session.user.id,
    }).catch(() => {});
    setAdjustStation(null);
    load();
  }

  const totalStockKg = stations.reduce((s, x) => s + Number(x.current_stock_kg), 0);
  const totalCapacityKg = stations.reduce((s, x) => s + Number(x.capacity_kg), 0);
  const capacityPct = totalCapacityKg ? Math.round((totalStockKg / totalCapacityKg) * 100) : 0;

  // A cancelled transaction never actually moved any real paddy in or out —
  // same reasoning as every report page (Overview, Stock report, Balance
  // Sheet, Payables/Receivables, Purchases/Sales, Tax, Party Detail, Location
  // Detail all filter this out too) — so it shouldn't count toward the price
  // average or the per-paddy-type breakdown below, either.
  const activeTxs = useMemo(() => txs.filter((t) => (t.hq_status || "processing") !== "cancelled"), [txs]);

  const avgPrice = activeTxs.length ? activeTxs.reduce((s, x) => s + Number(x.price_per_kg), 0) / activeTxs.length : 0;
  const estimatedValue = Math.round(totalStockKg * avgPrice);

  const todayStr = cambodiaDateStr();

  // Today's weighted-average Buy price per station — total riel paid ÷
  // total kg bought today, the same two numbers the Dashboard's "Total Buy
  // (Today)" card already shows. Used only to prefill AdjustStockModal's
  // price field; null (no key) means nothing was bought there yet today.
  const todayAvgBuyPriceByLocation = useMemo(() => {
    const sums = {};
    for (const tx of activeTxs) {
      if (tx.type !== "BUY" || tx.tx_date !== todayStr || !tx.location_id) continue;
      const kg = Number(tx.quantity_kg) || 0;
      const amt = Number(tx.total_with_tax ?? tx.amount) || 0;
      const s = (sums[tx.location_id] = sums[tx.location_id] || { kg: 0, amt: 0 });
      s.kg += kg;
      s.amt += amt;
    }
    const out = {};
    for (const locId in sums) {
      if (sums[locId].kg > 0) out[locId] = sums[locId].amt / sums[locId].kg;
    }
    return out;
  }, [activeTxs, todayStr]);

  // [2026-09-01] Fallback for a station that hasn't bought anything YET
  // today (so todayAvgBuyPriceByLocation has no entry for it) — same
  // weighted-average calculation, just widened to that station's last 30
  // days of Buys instead of only today's. Used to still suggest a price for
  // AdjustStockModal instead of leaving it blank (previously: any stock
  // reset done before that station's first Buy of the day got recorded with
  // no price and no value at all, unless someone typed one in by hand).
  const recentAvgBuyPriceByLocation = useMemo(() => {
    const cutoff = new Date(getAccurateNow());
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cambodiaDateStr(cutoff);
    const sums = {};
    for (const tx of activeTxs) {
      if (tx.type !== "BUY" || !tx.location_id || tx.tx_date < cutoffStr) continue;
      const kg = Number(tx.quantity_kg) || 0;
      const amt = Number(tx.total_with_tax ?? tx.amount) || 0;
      const s = (sums[tx.location_id] = sums[tx.location_id] || { kg: 0, amt: 0 });
      s.kg += kg;
      s.amt += amt;
    }
    const out = {};
    for (const locId in sums) {
      if (sums[locId].kg > 0) out[locId] = sums[locId].amt / sums[locId].kg;
    }
    return out;
  }, [activeTxs]);

  // What AdjustStockModal actually receives: today's price when this
  // station bought something today (most accurate), otherwise its last-30-
  // days average (still a real, recent number instead of nothing), otherwise
  // null when there's truly nothing to base a price on at all.
  const priceSuggestionByLocation = useMemo(() => {
    const out = {};
    const ids = new Set([...Object.keys(todayAvgBuyPriceByLocation), ...Object.keys(recentAvgBuyPriceByLocation)]);
    for (const locId of ids) {
      if (todayAvgBuyPriceByLocation[locId] != null) out[locId] = { price: todayAvgBuyPriceByLocation[locId], source: "today" };
      else if (recentAvgBuyPriceByLocation[locId] != null) out[locId] = { price: recentAvgBuyPriceByLocation[locId], source: "recent" };
    }
    return out;
  }, [todayAvgBuyPriceByLocation, recentAvgBuyPriceByLocation]);

  // Stock Loss Log — every adjustment that actually reduced stock (a
  // "gain," like a recount finding more than expected, isn't a loss and
  // stays out of this specific log/summary, even though it's the same
  // underlying stock_adjustments table).
  const lossRows = useMemo(
    () => adjustments.filter((a) => Number(a.adjustment_kg) < -0.005),
    [adjustments]
  );
  const lossMonthStr = todayStr.slice(0, 7); // "YYYY-MM"
  // created_at is stored/returned as a UTC timestamp — convert to Cambodia's
  // own calendar date before comparing, rather than string-matching the raw
  // ISO value, so a loss recorded late at night doesn't get mis-bucketed
  // against UTC's date boundary instead of the station's real one.
  const lostToday = lossRows.filter((a) => a.created_at && cambodiaDateStr(new Date(a.created_at)) === todayStr);
  const lostThisMonth = lossRows.filter((a) => a.created_at && cambodiaDateStr(new Date(a.created_at)).startsWith(lossMonthStr));
  const lostTodayKg = lostToday.reduce((s, a) => s + Math.abs(Number(a.adjustment_kg)), 0);
  const lostMonthKg = lostThisMonth.reduce((s, a) => s + Math.abs(Number(a.adjustment_kg)), 0);
  const lostMonthValue = lostThisMonth.reduce((s, a) => s + Number(a.value_lost || 0), 0);

  const productsById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  // A manual stock adjustment (Reset to 0, or any other correction) sets
  // a location's own running total (current_stock_kg) directly — it has
  // no per-paddy-type breakdown of its own, since stock was never tracked
  // per type in the database to begin with (see the comment below). That
  // means a reset only zeroes out the ONE aggregate number; the per-type
  // breakdown below used to have no way to know a reset ever happened, so
  // it kept replaying transactions from the beginning of time regardless
  // — a station reset to 0kg could still show its old paddy composition
  // here forever, contradicting the 0kg total shown right above it. Fixed
  // the same way the net-stock diagnostic (see the project log) treats an
  // adjustment: a hard reset point — nothing dated before a location's
  // most recent adjustment counts toward its per-type breakdown anymore.
  // One acknowledged limitation: a real adjustment only ever corrects the
  // single aggregate number, never a specific paddy type, so a reset is
  // treated here as zeroing every type at that location, not just one —
  // there's no data to do better than that.
  const lastAdjustmentAtByLocation = useMemo(() => {
    const map = {};
    for (const a of adjustments) {
      if (!a.location_id || !a.created_at) continue;
      if (!map[a.location_id] || a.created_at > map[a.location_id]) map[a.location_id] = a.created_at;
    }
    return map;
  }, [adjustments]);

  // Stock isn't tracked per paddy type in the database — each location just
  // has one running total. To break it down by type, replay every
  // transaction's net weight (weight minus quality deduction), adding it for
  // Buys and subtracting it for Sells, grouped by location and paddy type —
  // skipping anything dated at or before that location's last adjustment
  // (see comment above).
  const stockByLocationProduct = useMemo(() => {
    const map = {};
    for (const tx of activeTxs) {
      if (!tx.location_id || !tx.product_id) continue;
      const lastAdjAt = lastAdjustmentAtByLocation[tx.location_id];
      if (lastAdjAt && tx.created_at && tx.created_at <= lastAdjAt) continue;
      const payable = Math.max(0, Number(tx.quantity_kg || 0) - Number(tx.deduction_kg || 0));
      const delta = tx.type === "BUY" ? payable : -payable;
      map[tx.location_id] = map[tx.location_id] || {};
      map[tx.location_id][tx.product_id] = (map[tx.location_id][tx.product_id] || 0) + delta;
    }
    return map;
  }, [activeTxs, lastAdjustmentAtByLocation]);

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
    for (const tx of activeTxs) {
      if (!tx.product_id) continue;
      sums[tx.product_id] = (sums[tx.product_id] || 0) + Number(tx.price_per_kg || 0);
      counts[tx.product_id] = (counts[tx.product_id] || 0) + 1;
    }
    const out = {};
    for (const id in sums) out[id] = sums[id] / counts[id];
    return out;
  }, [activeTxs]);

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
        {loadError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        )}
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
                {canAdjustStock && <th className="px-5 py-2 font-medium">Adjust</th>}
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
                      {canAdjustStock && (
                        <td className="px-5 py-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); setAdjustStation(s); }}
                            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700"
                          >
                            <Scale size={12} /> Adjust
                          </button>
                        </td>
                      )}
                      <td className="px-5 py-3 text-right">
                        {isOpen ? <ChevronDown size={16} className="ml-auto text-slate-400" /> : <ChevronRight size={16} className="ml-auto text-slate-300" />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-slate-50 bg-slate-50/60 last:border-0">
                        <td colSpan={canAdjustStock ? 6 : 5} className="px-5 py-3">
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
              {loading && stations.length === 0 && (
                <tr><td colSpan={canAdjustStock ? 6 : 5} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
              )}
              {stations.length === 0 && !loading && !loadError && (
                <tr><td colSpan={canAdjustStock ? 6 : 5} className="px-5 py-10 text-center text-sm text-slate-400">No locations visible to your account.</td></tr>
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
              {combinedRows.length === 0 && !loading && !loadError && (
                <tr><td colSpan={3} className="px-5 py-10 text-center text-sm text-slate-400">No stock recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="flex items-center gap-2 font-semibold text-slate-700"><RotateCcw size={16} className="text-rose-500" /> Stock Loss Log</h3>
            <p className="mt-0.5 text-xs text-slate-400">Every stock adjustment that reduced what's on hand — moisture, spillage, or a daily reset — with what it was worth at the time.</p>
          </div>
          <div className="grid grid-cols-1 divide-y divide-slate-100 border-b border-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="px-5 py-3.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Lost Today</p>
              <p className="mt-0.5 text-lg font-bold text-rose-600">{fmt2(lostTodayKg)} kg</p>
            </div>
            <div className="px-5 py-3.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Lost This Month</p>
              <p className="mt-0.5 text-lg font-bold text-rose-600">{fmt2(lostMonthKg)} kg</p>
            </div>
            <div className="px-5 py-3.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Est. Value Lost This Month</p>
              <p className="mt-0.5 text-lg font-bold text-rose-600">{fmtRiel(lostMonthValue)}</p>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">Date</th>
                <th className="px-5 py-2 font-medium">{t("station")}</th>
                <th className="px-5 py-2 font-medium">Weight Lost</th>
                <th className="px-5 py-2 font-medium">Price/kg Used</th>
                <th className="px-5 py-2 font-medium">Value Lost</th>
                <th className="px-5 py-2 font-medium">Recorded By</th>
                <th className="px-5 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {lossRows.map((a) => (
                <tr key={a.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-500">{a.created_at ? cambodiaDateStr(new Date(a.created_at)) : "—"}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{a.stationName}</td>
                  <td className="px-5 py-3 font-medium text-rose-600">{fmt2(Math.abs(a.adjustment_kg))} kg</td>
                  <td className="px-5 py-3 text-slate-600">{a.price_per_kg != null ? fmtRiel(a.price_per_kg) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-5 py-3 font-medium text-rose-600">{a.value_lost != null ? fmtRiel(a.value_lost) : <span className="font-normal text-slate-300">not valued</span>}</td>
                  <td className="px-5 py-3 text-slate-500">{a.adjustedByName}</td>
                  <td className="px-5 py-3 text-slate-400">{a.note || (ADJUSTMENT_REASONS.find((r) => r.value === a.reason)?.label ?? a.reason)}</td>
                </tr>
              ))}
              {lossRows.length === 0 && !loading && !loadError && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">No stock loss recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {adjustStation && (
        <AdjustStockModal
          station={adjustStation}
          priceSuggestion={priceSuggestionByLocation[adjustStation.id] ?? null}
          t={t}
          isAdmin={isAdmin}
          onClose={() => setAdjustStation(null)}
          onSubmit={submitAdjustment}
        />
      )}
    </div>
  );
}
