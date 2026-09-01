import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Warehouse, MapPin, Activity, ChevronRight } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { getAccurateNow } from "../supabaseClient.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }
// [2026-09-01] Takes `t` directly (rather than going through a shared
// helper) since English needs singular/plural word choice ("1 min ago" vs
// "2 mins ago") that Khmer doesn't — Khmer uses the same phrase either way,
// so this picks the right translation key per language instead of trying
// to force one template to cover both.
function timeAgo(dateStr, timeStr, t) {
  // dateStr/timeStr are Cambodia wall-clock values — parse them as such
  // explicitly (+07:00) so this is correct no matter what timezone the
  // viewing device itself is set to.
  const then = new Date(`${dateStr}T${timeStr || "00:00:00"}+07:00`);
  const diffMin = Math.round((Date.now() - then.getTime()) / 60000);
  if (diffMin < 1) return t("time_just_now");
  if (diffMin < 60) return t(diffMin === 1 ? "time_min_ago" : "time_mins_ago", { n: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return t(diffHr === 1 ? "time_hr_ago" : "time_hrs_ago", { n: diffHr });
  const diffDay = Math.round(diffHr / 24);
  return t(diffDay === 1 ? "time_day_ago" : "time_days_ago", { n: diffDay });
}
// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting.
function cambodiaDateStr(d = getAccurateNow()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Pure calendar-day arithmetic on "YYYY-MM-DD" strings, done in UTC so it
// never gets tangled up with the viewing device's own timezone (a "day"
// here is a plain calendar date, not a moment in time).
function toDateOnlyUTC(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fromDateOnlyUTC(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(dateStr, n) {
  const d = toDateOnlyUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDateOnlyUTC(d);
}
// Monday-start week.
function startOfWeekStr(dateStr) {
  const d = toDateOnlyUTC(dateStr);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return fromDateOnlyUTC(d);
}
function startOfMonthStr(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

// Labels are resolved per-render inside the component now (needs `t`), not
// as a module-level constant — see PERIODS usage below.
const PERIOD_IDS = [
  { id: "today", key: "period_today" },
  { id: "yesterday", key: "period_yesterday" },
  { id: "week", key: "period_week" },
  { id: "month", key: "period_month" },
  { id: "custom", key: "period_custom" },
];

export default function Dashboard({ setPage, setSelectedLocationId }) {
  const { t } = useLanguage();
  const { profile, session, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [locations, setLocations] = useState([]);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load({ isRetry = false } = {}) {
    setLoading(true);
    setLoadError("");
    try {
      const [locs, transactions] = await Promise.all([api.getLocations(), api.getTransactions()]);
      // A request that raced ahead of the auth session fully attaching
      // (weak station WiFi, right after login/reload) can come back
      // empty — RLS quietly filters everything out instead of erroring —
      // which is indistinguishable on screen from "this account really
      // has zero locations". If that happens once while a real login is
      // in hand, quietly retry a single time before showing anything; a
      // genuinely empty account just looks the same on the retry.
      if (locs.length === 0 && session?.user?.id && !isRetry) {
        return load({ isRetry: true });
      }
      setLocations(locs);
      setTxs(transactions.filter((x) => (x.hq_status || "processing") !== "cancelled"));
    } catch (err) {
      // Without this, a failed/dropped request left the dashboard — the
      // first thing anyone sees when they open PaddyTrade — stuck showing
      // nothing, with no indication of why or how to retry.
      setLoadError(err.message || t("dash_load_error"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // Wait for AuthContext's own startup check to finish and a real
    // session to actually be attached before firing Dashboard's own
    // fetch. App.jsx already blocks rendering until authLoading is
    // false, but a cached-profile fallback (AuthContext's
    // PROFILE_TIMEOUT_MS path, for a slow connection) can let that
    // happen slightly before the Supabase client's own session is fully
    // attached — this re-fires load() once session actually shows up.
    if (authLoading || !session?.user?.id) return;
    load();
  }, [authLoading, session?.user?.id]);

  const todayStr = cambodiaDateStr();
  const [period, setPeriod] = useState("today");
  const [customStart, setCustomStart] = useState(todayStr);
  const [customEnd, setCustomEnd] = useState(todayStr);
  const PERIODS = PERIOD_IDS.map((p) => ({ ...p, label: t(p.key) }));

  // Every card/table below reads from this one range — switching the
  // period control re-slices the same transaction list instead of
  // re-fetching, so it's instant.
  const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
    switch (period) {
      case "yesterday": {
        const y = addDays(todayStr, -1);
        return { rangeStart: y, rangeEnd: y, rangeLabel: t("period_yesterday") };
      }
      case "week":
        return { rangeStart: startOfWeekStr(todayStr), rangeEnd: todayStr, rangeLabel: t("period_week") };
      case "month":
        return { rangeStart: startOfMonthStr(todayStr), rangeEnd: todayStr, rangeLabel: t("period_month") };
      case "custom": {
        // Guard against the end date being typed before the start date —
        // swap rather than silently returning an empty/backwards range.
        const s = customStart || todayStr;
        const e = customEnd || todayStr;
        return { rangeStart: s <= e ? s : e, rangeEnd: s <= e ? e : s, rangeLabel: t("period_custom") };
      }
      default:
        return { rangeStart: todayStr, rangeEnd: todayStr, rangeLabel: t("period_today") };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, todayStr, customStart, customEnd, t]);

  const periodTxs = useMemo(
    () => txs.filter((t) => t.tx_date >= rangeStart && t.tx_date <= rangeEnd),
    [txs, rangeStart, rangeEnd]
  );

  const periodBuy = periodTxs.filter((t) => t.type === "BUY");
  const periodSell = periodTxs.filter((t) => t.type === "SELL");
  const totalBuyKg = periodBuy.reduce((s, t) => s + Number(t.quantity_kg), 0);
  const totalBuyAmt = periodBuy.reduce((s, t) => s + Number(t.total_with_tax ?? t.amount), 0);
  const totalSellKg = periodSell.reduce((s, t) => s + Number(t.quantity_kg), 0);
  const totalSellAmt = periodSell.reduce((s, t) => s + Number(t.total_with_tax ?? t.amount), 0);
  // Weighted average — total riel paid ÷ total kg bought, not an average of
  // the per-transaction prices — so one large truckload properly outweighs
  // a small one instead of being counted the same. null (not 0) when
  // nothing was bought in this range, so the card can say so instead of
  // showing a misleading "0 ៛/kg".
  const avgBuyPrice = totalBuyKg > 0 ? totalBuyAmt / totalBuyKg : null;
  // This one is deliberately NOT period-filtered — it's the real running
  // total on hand right now, not "how much moved during the period".
  const netStockKg = locations.reduce((s, l) => s + Number(l.current_stock_kg), 0);

  const locationPerformance = useMemo(() => {
    return locations.map((loc) => {
      const locPeriod = periodTxs.filter((t) => t.location_id === loc.id);
      const buyKg = locPeriod.filter((t) => t.type === "BUY").reduce((s, t) => s + Number(t.quantity_kg), 0);
      const sellKg = locPeriod.filter((t) => t.type === "SELL").reduce((s, t) => s + Number(t.quantity_kg), 0);
      // A location with no capacity set (0 or blank) would divide by zero
      // here and show "Infinity%" on the progress bar — fall back to 0
      // instead so it just reads as an empty bar.
      const capacity = Number(loc.capacity_kg) || 0;
      const pct = capacity > 0 ? Math.round((Number(loc.current_stock_kg) / capacity) * 100) : 0;
      return { loc, buyKg, sellKg, pct };
    });
  }, [locations, periodTxs]);

  const liveFeed = useMemo(() => {
    return txs.slice().sort((a, b) => (a.tx_date + a.tx_time < b.tx_date + b.tx_time ? 1 : -1)).slice(0, 8);
  }, [txs]);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={isAdmin ? t("dash_hq_overview") : t("dash_location_overview")} subtitle={t("dash_ops_summary")} />
      <main className="flex-1 overflow-y-auto p-6">
        {loadError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">{t("retry_btn")}</button>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === p.id ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-brand-400"
              />
              <span>{t("word_to")}</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={todayStr}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-brand-400"
              />
            </div>
          )}
        </div>

        {/* [2026-08-31] grid-cols-2 lg:grid-cols-4 (was grid-cols-1
            sm:grid-cols-2 lg:grid-cols-4) — per explicit request, this now
            shows 2 compact cards per row on phone/tablet instead of one
            huge full-width card per row, sample-approved. Cards themselves
            get smaller padding/icon/text below lg (icon box, headline
            number, etc.) so they read like a real dashboard instead of a
            stack of oversized tiles; every lg: class below restores the
            exact original desktop sizing (p-5, h-9 w-9 icon box, text-2xl
            number, etc.), so nothing changes there at all. */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm lg:p-5">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-brand-600 lg:mb-3.5 lg:h-9 lg:w-9"><TrendingUp size={15} /></div>
            <p className="text-[10.5px] font-medium leading-tight text-slate-500 lg:text-xs">{t("dash_total_buy", { range: rangeLabel })}</p>
            <p className="mt-1 text-lg font-extrabold tracking-tight text-slate-800 lg:mt-1.5 lg:text-2xl">{fmt2(totalBuyKg)} kg</p>
            <p className="mt-0.5 text-[9.5px] leading-tight text-slate-400 lg:mt-1 lg:text-[11px]">{fmtRiel(totalBuyAmt)} {t("dash_paid_out")}</p>
            {avgBuyPrice != null && (
              <div className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-[9.5px] font-semibold text-brand-700 lg:mt-2 lg:px-2.5 lg:py-1 lg:text-[11px]">
                ⚖ {t("dash_avg_price", { price: fmtRiel(avgBuyPrice) })}
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm lg:p-5">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-600 lg:mb-3.5 lg:h-9 lg:w-9"><TrendingDown size={15} /></div>
            <p className="text-[10.5px] font-medium leading-tight text-slate-500 lg:text-xs">{t("dash_total_sell", { range: rangeLabel })}</p>
            <p className="mt-1 text-lg font-extrabold tracking-tight text-slate-800 lg:mt-1.5 lg:text-2xl">{fmt2(totalSellKg)} kg</p>
            <p className="mt-0.5 text-[9.5px] leading-tight text-slate-400 lg:mt-1 lg:text-[11px]">{fmtRiel(totalSellAmt)} {t("dash_received")}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm lg:p-5">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 lg:mb-3.5 lg:h-9 lg:w-9"><Warehouse size={15} /></div>
            <p className="text-[10.5px] font-medium leading-tight text-slate-500 lg:text-xs">{t("dash_current_stock")}</p>
            <p className="mt-1 text-lg font-extrabold tracking-tight text-slate-800 lg:mt-1.5 lg:text-2xl">{fmt2(netStockKg)} kg</p>
            {/* This is deliberately NOT "today's buy minus today's sell" —
                it's the real running total built up over the location's
                entire history. Sitting next to the two "Today" cards made
                it look like it should equal them, which it never will
                unless the location's stock happened to start today at
                zero. Spelling that out here so it reads correctly at a
                glance instead of looking like a math error. */}
            <p className="mt-0.5 text-[9.5px] leading-tight text-slate-400 lg:mt-1 lg:text-[11px]">{t("dash_on_hand", { n: locations.length })}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm lg:p-5">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-gold-100 text-gold-700 lg:mb-3.5 lg:h-9 lg:w-9"><MapPin size={15} /></div>
            <p className="text-[10.5px] font-medium leading-tight text-slate-500 lg:text-xs">{t("dash_active_locations")}</p>
            <p className="mt-1 text-lg font-extrabold tracking-tight text-slate-800 lg:mt-1.5 lg:text-2xl">{locations.length}</p>
            <p className="mt-0.5 text-[9.5px] leading-tight text-slate-400 lg:mt-1 lg:text-[11px]">{t("dash_tx_count", { n: periodTxs.length, range: rangeLabel })}</p>
          </div>
        </div>

        {/* [2026-08-31] Same fix as the KPI row above — grid-cols-1 lg:grid-cols-3
            instead of a flat grid-cols-3, so Location Performance and Live
            Feed stack full-width on phone/tablet instead of both being
            squeezed into a third of the screen each. Unchanged on desktop
            (lg: and up), where this was already the right layout. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="font-bold text-slate-800">{t("dash_location_perf", { range: rangeLabel })}</h3>
              <span className="text-[11px] text-slate-400">{t("dash_locations_count", { n: locations.length })}</span>
            </div>
            {/* overflow-x-auto: a defensive safety net so the table scrolls
                sideways on its own if it's ever still too wide for a very
                narrow phone, instead of pushing the whole page wider than
                the screen the way the fixed 3-column grid used to. */}
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-semibold">{t("col_location")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("col_buy_kg")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("col_sell_kg")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("col_stock")}</th>
                  {isAdmin && <th className="w-8 px-3 py-2.5"></th>}
                </tr>
              </thead>
              <tbody>
                {/* [2026-08-31] Rows are now clickable for HQ Admin/Owner —
                    opens LocationDetail (same page the Locations list
                    already links to), so "what's happening at this
                    location" is one click away instead of only reachable
                    via Settings > Locations. Sample-approved: same table,
                    same columns, just a hover highlight + chevron added.
                    Not clickable for non-admin roles since station-detail
                    is gated to isAdmin in App.jsx — clicking would only
                    hit a permission-denied screen for them. */}
                {locationPerformance.map(({ loc, buyKg, sellKg, pct }) => (
                  <tr
                    key={loc.id}
                    onClick={isAdmin ? () => { setSelectedLocationId(loc.id); setPage("station-detail"); } : undefined}
                    className={`border-b border-slate-50 last:border-0 ${isAdmin ? "cursor-pointer hover:bg-brand-50" : "hover:bg-slate-50/60"}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${pct > 80 ? "bg-emerald-500" : pct > 40 ? "bg-gold-500" : "bg-rose-400"}`} />
                        <span className="font-semibold text-slate-700">{loc.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 font-medium text-brand-600">{buyKg > 0 ? `+${fmt2(buyKg)}` : "—"}</td>
                    <td className="px-3 py-3.5 font-medium text-rose-600">{sellKg > 0 ? `-${fmt2(sellKg)}` : "—"}</td>
                    <td className="px-3 py-3.5 text-slate-600">
                      <div className="flex items-center gap-2.5">
                        <span>{fmt2(loc.current_stock_kg)} kg</span>
                        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                        </span>
                        <span className="text-[11px] text-slate-400">{pct}%</span>
                      </div>
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-3.5 text-slate-300">
                        <ChevronRight size={15} />
                      </td>
                    )}
                  </tr>
                ))}
                {loading && locations.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">{t("loading_label")}</td></tr>}
                {locations.length === 0 && !loading && !loadError && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">{t("dash_no_locations")}</td></tr>}
              </tbody>
            </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <Activity size={15} className="text-brand-600" />
              <h3 className="font-bold text-slate-800">{t("dash_live_feed")}</h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {liveFeed.map((tx) => (
                <div key={tx.id} className="flex items-start gap-2.5 border-b border-slate-50 px-4 py-3.5 last:border-0">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${tx.type === "BUY" ? "bg-brand-100 text-brand-700" : "bg-rose-100 text-rose-700"}`}>
                    {tx.type === "BUY" ? "▲" : "▼"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-700">{tx.partyName} · {fmt2(tx.quantity_kg)} kg</p>
                    <p className="text-[11px] text-slate-400">{tx.stationName}</p>
                  </div>
                  <p className="shrink-0 whitespace-nowrap text-[10.5px] text-slate-400">{timeAgo(tx.tx_date, tx.tx_time, t)}</p>
                </div>
              ))}
              {loading && liveFeed.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-400">{t("loading_label")}</p>}
              {liveFeed.length === 0 && !loading && !loadError && <p className="px-4 py-10 text-center text-sm text-slate-400">{t("dash_no_activity")}</p>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
