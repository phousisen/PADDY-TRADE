import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, TrendingUp, Warehouse, Wallet, Scale, CalendarDays, Boxes } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import RenameLocationModal from "../components/RenameLocationModal.jsx";
import { AdjustStockModal } from "../components/AdjustStockModal.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { getAccurateNow } from "../supabaseClient.js";
import { buildDailyLedgerRows } from "../dailyLedger.js";
import { buildShed } from "../shedStock.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
// Same helper as StockInventory.jsx/Transactions.jsx — Cambodia's current
// calendar date, reading getAccurateNow() rather than the device's own clock.
function cambodiaDateStr(d = getAccurateNow()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// [2026-09-10] "What's in the shed" — one stepped hue, not a rainbow. The
// paddy types don't rank against each other, and different hues would imply
// they do. Darkest = biggest pile, so the swatches read as an order without
// claiming any type is "good" or "bad".
const SHED_COLORS = ["#123626", "#1B5238", "#217A4F", "#2E9E63", "#4FBE80", "#93D9AE"];
const SHED_CARRIED_COLOR = "#94a3b8"; // slate-400 — the untyped lump

// 14 points of a type's own stock level. Deliberately unlabelled: the number
// above it is the amount, this only has to say which way it is going.
function ShedSpark({ values, color, label }) {
  const n = values?.length || 0;
  if (n < 2) return <div className="mt-2.5 h-6" />;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const y = (v) => 22 - ((v - min) / span) * 18;
  const points = values.map((v, i) => `${(i / (n - 1)) * 120},${y(v).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 120 26" preserveAspectRatio="none" role="img" aria-label={label}
         className="mt-2.5 h-6 w-full overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx="119" cy={y(values[n - 1]).toFixed(2)} r="2.2" fill={color} />
    </svg>
  );
}

export default function LocationDetail({ locationId, setPage }) {
  const { t } = useLanguage();
  const { profile, session, hasPermission, isViewOnly } = useAuth();
  const isAdmin = profile?.role === "admin";
  // Same gate as Stock & Inventory's "Adjust Stock" button — HQ Admin/Owner
  // or any custom role explicitly granted "adjust_stock" from the Roles
  // page, but never a view-only account (isAdmin is true for the view-only
  // "boss" login too, since it needs read access to every admin-tier page —
  // `&& !isViewOnly` is what actually keeps this write control out of its
  // hands, matching every other write entry point in the app, see
  // App.jsx's `isViewOnly` comments).
  const canAdjustStock = (isAdmin || hasPermission("adjust_stock")) && !isViewOnly;
  const isCombined = locationId === "all";
  const [allLocations, setAllLocations] = useState([]);
  const [location, setLocation] = useState(null);
  const [txs, setTxs] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // [2026-08-31] "Adjust Stock" — manual only, matching the same modal
  // already used on Stock & Inventory (no new reason type, no automatic
  // reminder/enforcement: staff haven't been trained on the overnight
  // re-weigh workflow yet, per the owner's explicit call).
  const [adjustOpen, setAdjustOpen] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      // Stock adjustments are only fetched for a single real location — the
      // Daily Stock Ledger below is a per-station report (same as
      // StockInventory.jsx's own version), not something that makes sense
      // combined across every station at once. `.catch(() => [])` so a
      // problem loading adjustments alone (a bad join, a network blip)
      // only leaves the ledger's "Lost" figures blank, never blocks the
      // rest of this page from loading.
      const [locs, transactions, adjustmentRows] = await Promise.all([
        api.getLocations(),
        api.getTransactions(),
        isCombined ? Promise.resolve([]) : api.getStockAdjustments({ locationId }).catch(() => []),
      ]);
      setAllLocations(locs);
      setAdjustments(adjustmentRows);
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

  // [2026-09-03] Daily Stock Ledger — phone-only (see the section below),
  // matching the day-card design approved in the Claude Design canvas after
  // the desktop-report screenshot comparison (mobile's original horizontal-
  // scroll table showed far less than the PC report, and swiping a data
  // table wasn't a great mobile pattern either). Built from the exact same
  // shared math StockInventory.jsx's own "Daily Stock Ledger" table already
  // uses — see dailyLedger.js — just windowed to the last 30 days and shown
  // newest-first here, one card per day, instead of a table.
  const ledgerRows = useMemo(() => {
    if (isCombined) return [];
    const all = buildDailyLedgerRows({ txs: [...txs], adjustments, locationId });
    const cutoff = (() => {
      const d = new Date(getAccurateNow());
      d.setDate(d.getDate() - 30);
      return cambodiaDateStr(d);
    })();
    return all.filter((r) => r.date >= cutoff).slice().reverse();
  }, [txs, adjustments, locationId, isCombined]);

  const ledgerTotals = useMemo(() => {
    const totals = { boughtKg: 0, spentAmt: 0, soldKg: 0, earnedAmt: 0, adjustedKg: 0, valueLostToday: 0 };
    for (const r of ledgerRows) {
      totals.boughtKg += r.boughtKg;
      totals.spentAmt += r.spentAmt;
      totals.soldKg += r.soldKg;
      totals.earnedAmt += r.earnedAmt;
      totals.adjustedKg += r.adjustedKg;
      totals.valueLostToday += r.valueLostToday;
    }
    totals.marginAmt = totals.earnedAmt - totals.spentAmt;
    return totals;
  }, [ledgerRows]);

  // [2026-09-10] "What's in the shed" — replaces the Transaction History
  // table that used to be here (SISEN: "i dont need to see the transaction
  // history anymore. it spointless — i want to see something more useful
  // like stock as well as what kind of stock is inside").
  //
  // All of the arithmetic lives in shedStock.js, on its own, so it can be
  // tested against fixtures (scripts-check-shed.mjs) instead of being
  // trusted because it looks right. Read the comment at the top of that
  // file for why it anchors on the last stock count.
  const shed = useMemo(() => {
    if (isCombined || !location) return null;
    return buildShed({ txs, adjustments, location, now: getAccurateNow() });
  }, [txs, adjustments, location, isCombined]);

  const combinedStock = useMemo(() => allLocations.reduce((s, l) => s + Number(l.current_stock_kg), 0), [allLocations]);
  const combinedCapacity = useMemo(() => allLocations.reduce((s, l) => s + Number(l.capacity_kg), 0), [allLocations]);

  // Today's weighted-average Buy price at this station — same two numbers
  // as the Dashboard's "Total Buy (Today)" card — used to prefill
  // AdjustStockModal's price field. Single-location version of
  // StockInventory.jsx's todayAvgBuyPriceByLocation, since txs here is
  // already scoped to one.
  const todayAvgBuyPrice = useMemo(() => {
    if (isCombined) return null;
    const todayStr = cambodiaDateStr();
    let kg = 0, amt = 0;
    for (const tx of txs) {
      if ((tx.hq_status || "processing") === "cancelled") continue;
      if (tx.type !== "BUY" || tx.tx_date !== todayStr) continue;
      kg += Number(tx.quantity_kg) || 0;
      amt += Number(tx.total_with_tax ?? tx.amount) || 0;
    }
    return kg > 0 ? amt / kg : null;
  }, [txs, isCombined]);

  // [2026-09-01] Fallback for when this station hasn't bought anything YET
  // today — same weighted-average calculation, widened to the last 30 days
  // — so a stock reset done before the day's first Buy still gets a
  // suggested price instead of a blank field. Single-location version of
  // StockInventory.jsx's recentAvgBuyPriceByLocation.
  const recentAvgBuyPrice = useMemo(() => {
    if (isCombined) return null;
    const cutoff = new Date(getAccurateNow());
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cambodiaDateStr(cutoff);
    let kg = 0, amt = 0;
    for (const tx of txs) {
      if ((tx.hq_status || "processing") === "cancelled") continue;
      if (tx.type !== "BUY" || tx.tx_date < cutoffStr) continue;
      kg += Number(tx.quantity_kg) || 0;
      amt += Number(tx.total_with_tax ?? tx.amount) || 0;
    }
    return kg > 0 ? amt / kg : null;
  }, [txs, isCombined]);

  // What AdjustStockModal actually receives — see StockInventory.jsx's
  // priceSuggestionByLocation for the same logic across every station.
  const priceSuggestion = useMemo(() => {
    if (todayAvgBuyPrice != null) return { price: todayAvgBuyPrice, source: "today" };
    if (recentAvgBuyPrice != null) return { price: recentAvgBuyPrice, source: "recent" };
    return null;
  }, [todayAvgBuyPrice, recentAvgBuyPrice]);

  async function submitAdjustment({ newStockKg, reason, note, pricePerKg }) {
    const previousStockKg = Number(location.current_stock_kg) || 0;
    await api.recordStockAdjustment({
      locationId: location.id, previousStockKg, newStockKg, reason, note, pricePerKg, userId: session.user.id,
    });
    // Same audit-log pattern as every other significant change in the app —
    // edits, cancellations, payments — so it shows up in the Activity Log
    // alongside everything else, not just as a number that quietly changed.
    await api.logAudit({
      action: "adjust_stock",
      tableName: "locations",
      recordId: location.id,
      oldData: { current_stock_kg: previousStockKg },
      newData: { current_stock_kg: newStockKg, reason, note, pricePerKg, stationName: location.name },
      userId: session.user.id,
    }).catch(() => {});
    setAdjustOpen(false);
    load();
  }

  if (!isCombined && !location) {
    return (
      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <Topbar title="Location" />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-slate-400">
          {loadError ? (
            <>
              <p className="text-rose-500">{loadError}</p>
              <button onClick={load} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Retry</button>
            </>
          ) : loading ? (
            "Loading…"
          ) : (
            <>
              <p>This location couldn't be found.</p>
              <button onClick={() => setPage("stations")} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Back to Locations</button>
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
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        )}
        {/* [2026-08-31] Redesign, sample-approved: a proper hero (avatar +
            name + Rename action) instead of a plain text link and a small
            button on their own row — same information, no new
            functionality, just laid out to read as one clear header. */}
        <button onClick={() => setPage("stations")} className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={15} /> Back to Locations
        </button>
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-xl font-extrabold text-white shadow-sm">
            {(displayName || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-extrabold tracking-tight text-slate-800">{displayName}</h2>
            {displayNameKh && <p className="truncate text-sm text-slate-400">{displayNameKh}</p>}
          </div>
          {!isCombined && canAdjustStock && (
            <button onClick={() => setAdjustOpen(true)} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gold-100 bg-gold-50 px-3 py-2 text-sm font-medium text-gold-700 hover:bg-gold-100">
              <Scale size={13} /> Adjust Stock
            </button>
          )}
          {/* [2026-09-03] `&& !isViewOnly` — this had no permission gate at
              all before; the only reason it never let a view-only account
              actually rename anything is api.js's Proxy backstop rejecting
              the write at submit time. Hiding it here matches every other
              write control in the app instead of showing a form that can
              only ever fail. */}
          {!isCombined && !isViewOnly && (
            <button onClick={() => setEditing(true)} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700">
              <Pencil size={13} /> Rename
            </button>
          )}
        </div>

        {/* [2026-08-31] Same fix as Dashboard's KPI row — grid-cols-1
            sm:grid-cols-2 lg:grid-cols-4 instead of a flat grid-cols-4,
            which used to squeeze these 4 cards on a phone screen. */}
        {/* [2026-08-31] Redesign, sample-approved: icon badges added to
            match the Dashboard's KPI card style — same numbers, same
            layout/breakpoints, just visually consistent with the rest of
            the app instead of a bare inline icon next to the label. */}
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600"><Warehouse size={15} /></div>
            <div className="text-xs text-slate-400">{isCombined ? "Combined Stock" : "Current Stock"}</div>
            <p className="mt-1 text-xl font-bold text-slate-800">{fmt2(stockKg)} kg</p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
            <p className="mt-1 text-xs text-slate-400">{pct}% of {fmt2(capacityKg)} kg capacity</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600"><TrendingUp size={15} /></div>
            <div className="text-xs text-slate-400">Total Purchased</div>
            <p className="mt-1 text-xl font-bold text-slate-800">{fmt2(summary.buyKg)} kg</p>
            <p className="mt-1 text-xs text-slate-400">{fmtRiel(summary.totalBuy)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600"><TrendingUp size={15} /></div>
            <div className="text-xs text-slate-400">Total Sold</div>
            <p className="mt-1 text-xl font-bold text-slate-800">{fmt2(summary.sellKg)} kg</p>
            <p className="mt-1 text-xs text-slate-400">{fmtRiel(summary.totalSell)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-gold-100 text-gold-700"><Wallet size={15} /></div>
            <div className="text-xs text-slate-400">Gross Profit</div>
            <p className={`mt-1 text-xl font-bold ${summary.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmtRiel(summary.profit)}</p>
            <p className="mt-1 text-xs text-slate-400">{summary.txCount} transactions total</p>
          </div>
        </div>

        {isCombined && allLocations.length > 0 && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="font-semibold text-slate-700">Stock by Location</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-2 font-medium">Location</th>
                  <th className="px-5 py-2 font-medium">Stock (kg)</th>
                  <th className="px-5 py-2 font-medium">Capacity (kg)</th>
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

        {/* [2026-09-03] Daily Stock Ledger — phone-only (md:hidden), one
            card per day instead of StockInventory.jsx's wide table, so the
            same report reads cleanly on a phone screen with no horizontal
            scrolling at all (sample-approved design, after a swipeable
            table version was tried and set aside). Placed above Transaction
            History per explicit request. Desktop/tablet already has this
            exact report — with full period controls and the paddy-type
            breakdown — on the Stock & Inventory page, so it isn't
            duplicated here above the `md` breakpoint. */}
        {!isCombined && (
          <div className="mb-5 md:hidden">
            <div className="mb-3 flex items-center gap-2">
              <CalendarDays size={15} className="text-brand-600" />
              <div>
                <h3 className="font-bold text-slate-800">{t("ledger_title")}</h3>
                <p className="text-[11px] text-slate-400">{t("ledger_subtitle")}</p>
              </div>
            </div>

            {ledgerRows.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 shadow-sm">
                {t("no_activity_period")}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {ledgerRows.map((r) => {
                  const netChange = r.closing - r.opening;
                  const isLossDay = r.adjustedKg < -0.005;
                  return (
                    <div key={r.date} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3">
                        <span className="text-[13px] font-semibold text-slate-700">{r.date}</span>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("col_closing")}</p>
                          <p className="text-base font-extrabold text-slate-800">{fmt2(r.closing)} kg</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-4 py-3.5 text-[12.5px]">
                        <div>
                          <p className="text-[10.5px] text-slate-400">{t("col_opening")}</p>
                          <p className="font-semibold text-slate-700">{fmt2(r.opening)} kg</p>
                        </div>
                        <div>
                          <p className="text-[10.5px] text-slate-400">{t("col_net_change")}</p>
                          <p className={`font-semibold ${netChange >= 0 ? "text-brand-700" : "text-rose-600"}`}>{netChange >= 0 ? "+" : ""}{fmt2(netChange)} kg</p>
                        </div>
                        <div>
                          <p className="text-[10.5px] text-slate-400">{t("col_bought_in")}</p>
                          <p className="font-semibold text-brand-700">{r.boughtKg > 0 ? `+${fmt2(r.boughtKg)}` : "—"} kg</p>
                        </div>
                        <div>
                          <p className="text-[10.5px] text-slate-400">{t("col_spent")}</p>
                          <p className="font-semibold text-slate-700">{r.spentAmt > 0 ? fmtRiel(r.spentAmt) : "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10.5px] text-slate-400">{t("col_sold_out")}</p>
                          <p className="font-semibold text-rose-600">{r.soldKg > 0 ? `-${fmt2(r.soldKg)}` : "—"} kg</p>
                        </div>
                        <div>
                          <p className="text-[10.5px] text-slate-400">{t("col_earned")}</p>
                          <p className="font-semibold text-slate-700">{r.earnedAmt > 0 ? fmtRiel(r.earnedAmt) : "—"}</p>
                        </div>
                        {isLossDay && (
                          <>
                            <div>
                              <p className="text-[10.5px] text-slate-400">{t("col_lost")}</p>
                              <p className="font-semibold text-rose-600">{fmt2(r.adjustedKg)} kg</p>
                            </div>
                            <div>
                              <p className="text-[10.5px] text-slate-400">{t("col_value_lost")}</p>
                              <p className="font-semibold text-rose-600">{fmtRiel(r.valueLostToday)}</p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="overflow-hidden rounded-2xl border border-brand-200 bg-brand-50/60 shadow-sm">
                  <div className="border-b border-brand-100 px-4 py-2.5">
                    <span className="text-[12.5px] font-bold text-brand-800">{t("ledger_total_30d")}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-4 py-3.5 text-[12.5px]">
                    <div>
                      <p className="text-[10.5px] text-brand-600/80">{t("col_bought_in")}</p>
                      <p className="font-semibold text-brand-800">+{fmt2(ledgerTotals.boughtKg)} kg</p>
                    </div>
                    <div>
                      <p className="text-[10.5px] text-brand-600/80">{t("col_spent")}</p>
                      <p className="font-semibold text-brand-800">{fmtRiel(ledgerTotals.spentAmt)}</p>
                    </div>
                    <div>
                      <p className="text-[10.5px] text-brand-600/80">{t("col_sold_out")}</p>
                      <p className="font-semibold text-brand-800">-{fmt2(ledgerTotals.soldKg)} kg</p>
                    </div>
                    <div>
                      <p className="text-[10.5px] text-brand-600/80">{t("col_earned")}</p>
                      <p className="font-semibold text-brand-800">{fmtRiel(ledgerTotals.earnedAmt)}</p>
                    </div>
                    {ledgerTotals.adjustedKg < -0.005 && (
                      <>
                        <div>
                          <p className="text-[10.5px] text-brand-600/80">{t("col_lost")}</p>
                          <p className="font-semibold text-rose-600">{fmt2(ledgerTotals.adjustedKg)} kg</p>
                        </div>
                        <div>
                          <p className="text-[10.5px] text-brand-600/80">{t("col_value_lost")}</p>
                          <p className="font-semibold text-rose-600">{fmtRiel(ledgerTotals.valueLostToday)}</p>
                        </div>
                      </>
                    )}
                    <div className="col-span-2 border-t border-brand-200/70 pt-2.5">
                      <p className="text-[10.5px] text-brand-600/80">{t("gross_margin_label")}</p>
                      <p className={`text-[15px] font-extrabold ${ledgerTotals.marginAmt >= 0 ? "text-brand-800" : "text-rose-600"}`}>{fmtRiel(ledgerTotals.marginAmt)}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* [2026-09-10] The Transaction History table was removed at SISEN's
            request. It listed every transaction the station had ever done —
            807 rows at Jomnoum, thousands at Pong Ro — which is the same list
            the Transactions page already gives you, with search and filters
            this page never had. Scrolling it here answered no question that
            page doesn't answer better.

            In its place: what's actually in the shed. See the `shed` memo
            above for how it is built and why it reconciles. */}
        {shed && (
          <div className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex items-center gap-2">
                <Boxes size={15} className="text-brand-600" />
                <h3 className="font-semibold text-slate-700">{t("shed_title")}</h3>
                <span className="rounded border border-slate-200 px-1.5 py-px text-[10px] font-semibold tracking-wide text-slate-400">kg</span>
              </div>
              <span className="text-xs text-slate-400">
                {t("shed_meta", { kg: fmt2(shed.stockKg), date: cambodiaDateStr() })}
              </span>
            </div>

            {shed.tiles.length === 0 && Math.abs(shed.carriedKg) <= 0.005 ? (
              <div className="border-t border-slate-100 px-5 py-8 text-center text-sm text-slate-400">
                {t("shed_empty")}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-3 lg:grid-cols-4">
                {shed.tiles.map((r, i) => {
                  const color = SHED_COLORS[Math.min(i, SHED_COLORS.length - 1)];
                  const share = shed.stockKg > 0 ? Math.round((r.kg / shed.stockKg) * 100) : null;
                  const dir = r.series
                    ? (r.series[r.series.length - 1] - r.series[0] > 0.005 ? "up"
                      : r.series[r.series.length - 1] - r.series[0] < -0.005 ? "down" : "flat")
                    : null;
                  return (
                    <div key={r.key} className="bg-white px-4 py-4">
                      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-500">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
                        <span className="truncate font-khmer">
                          {r.other ? t("shed_other", { n: r.count }) : (r.name || t("shed_untyped"))}
                        </span>
                      </div>
                      <p className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${r.kg < -0.005 ? "text-rose-600" : "text-slate-800"}`}>
                        {fmt2(r.kg)}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-slate-400">
                        {r.kg < -0.005 ? t("shed_below_zero")
                          : share != null ? t("shed_share", { pct: share })
                          : " "}
                      </p>
                      {r.series
                        ? <ShedSpark values={r.series} color={color} label={t(`shed_dir_${dir}`)} />
                        : <div className="mt-2.5 h-6" />}
                    </div>
                  );
                })}

                {/* The untyped carry-forward from the last stock count. It is
                    a tile of its own rather than being spread across the
                    types, because nothing in the data says which type it is
                    — spreading it would be a guess printed as a fact. */}
                {Math.abs(shed.carriedKg) > 0.005 && (
                  <div className="bg-white px-4 py-4">
                    <div className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-500">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SHED_CARRIED_COLOR }} />
                      <span className="truncate">{t("shed_carried")}</span>
                    </div>
                    <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-slate-500">{fmt2(shed.carriedKg)}</p>
                    <p className="mt-0.5 text-[11.5px] text-slate-400">{t("shed_carried_note", { date: shed.countedOn })}</p>
                    <div className="mt-2.5 h-6" />
                  </div>
                )}
              </div>
            )}

            {/* The check. If the parts ever stop adding up to the station's
                own figure, this says so on screen instead of leaving a wrong
                split looking right. */}
            <div className={`border-t px-5 py-3 text-[11.5px] leading-relaxed ${
              Math.abs(shed.diff) > 0.5
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-slate-100 bg-slate-50/70 text-slate-400"}`}>
              {Math.abs(shed.diff) > 0.5
                ? t("shed_recon_bad", { computed: fmt2(shed.computed), stock: fmt2(shed.stockKg), diff: fmt2(shed.diff) })
                : t("shed_foot")}
            </div>
          </div>
        )}

      </main>

      {editing && location && (
        <RenameLocationModal
          location={location}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setLocation(updated); setEditing(false); }}
        />
      )}

      {adjustOpen && !isCombined && location && (
        <AdjustStockModal
          station={location}
          priceSuggestion={priceSuggestion}
          t={t}
          isAdmin={isAdmin}
          userEmail={session.user.email}
          onClose={() => setAdjustOpen(false)}
          onSubmit={submitAdjustment}
        />
      )}
    </div>
  );
}
