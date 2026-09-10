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
  const { profile, session, loading: authLoading, isViewOnly } = useAuth();
  const isAdmin = profile?.role === "admin";
  // [2026-09-03] A view-only account can already reach LocationDetail
  // directly (App.jsx gates "station-detail" on `isAdmin || isViewOnly`,
  // same as every other admin-tier read page it can see) — this table's
  // own row click just hadn't been updated to match, so tapping a location
  // here silently did nothing for that account type even though the page
  // it would open was already allowed. `canOpenLocation` is this table's
  // one gate for both the row's click handler and its chevron affordance.
  const canOpenLocation = isAdmin || isViewOnly;
  const [locations, setLocations] = useState([]);
  const [txs, setTxs] = useState([]);
  // [2026-09-10] Stock adjustments, for the Adjusted column in Location
  // Performance. Loaded alongside the rest but allowed to fail on its own —
  // a missing column is better than a blank dashboard.
  const [adjustments, setAdjustments] = useState([]);
  const [feedTxs, setFeedTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load({ isRetry = false } = {}) {
    setLoading(true);
    setLoadError("");
    try {
      // [2026-09-10] The dashboard asks for the PERIOD ON SCREEN, not for
      // every transaction ever recorded. The period buttons used to
      // re-slice a full download; now they change the query. Same figures,
      // and it stops growing with the whole history of the business.
      //
      // The live feed is fetched separately and bounded to eight rows, so
      // it still shows the last few loads first thing in the morning when
      // "Today" is legitimately empty.
      const [locs, transactions, feed] = await Promise.all([
        api.getLocations(),
        api.getTransactions({ from: rangeStart, to: rangeEnd }),
        api.getTransactions({ limit: 8 }).catch(() => []),
      ]);
      setFeedTxs(feed.filter((x) => (x.hq_status || "processing") !== "cancelled"));
      api.getStockAdjustments({ startDate: rangeStart, endDate: rangeEnd })
        .then(setAdjustments).catch(() => setAdjustments([]));
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

  const todayStr = cambodiaDateStr();
  const [period, setPeriod] = useState("today");
  const [customStart, setCustomStart] = useState(todayStr);
  const [customEnd, setCustomEnd] = useState(todayStr);
  const PERIODS = PERIOD_IDS.map((p) => ({ ...p, label: t(p.key) }));

  // Every card/table below reads from this one range. [2026-09-10]
  // Switching the period now re-runs the query for that period rather
  // than re-slicing a full download — see the effect just below.
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

  // [2026-09-10] Moved below the period memo, and the period is now in the
  // dependency list: switching Today/Week/Month re-runs the query instead
  // of re-slicing a full download. It has to sit here rather than further
  // up — naming rangeStart in a dependency list before it is declared is a
  // reference error, and the whole page would go white.
  //
  // Wait for AuthContext's own startup check to finish and a real session
  // to actually be attached before firing. App.jsx already blocks
  // rendering until authLoading is false, but a cached-profile fallback
  // (AuthContext's PROFILE_TIMEOUT_MS path, for a slow connection) can let
  // that happen slightly before the Supabase client's session is fully
  // attached — this re-fires load() once session actually shows up.
  useEffect(() => {
    if (authLoading || !session?.user?.id) return;
    load();
  }, [authLoading, session?.user?.id, rangeStart, rangeEnd]);

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

  // [2026-09-09] The money position. The dashboard showed rice and activity
  // but never money — you could see 111 tonnes on hand and have no idea
  // whether you owed farmers 300 million or were owed it by buyers.
  //
  // [2026-09-10] The money row (cash in hand, owed to farmers, owed by
  // buyers, net position) was removed from this screen at SISEN's request —
  // four money figures beside four rice figures was too much to read at a
  // glance, and none of it is what the dashboard is for. The arithmetic
  // still lives in src/cashDirection.js and the same figures are on the
  // Financial Reports screens, so nothing was lost, only moved out of the way.

  // [2026-09-10] Location Performance, rebuilt so the row actually adds up.
  //
  // The old table put PERIOD-filtered Buy and Sell next to an ALL-TIME stock
  // figure, under a heading that said "(Today)". On a quiet day it read
  // "— · — · −1,670 kg", which looks broken and isn't: the dashes were today
  // and the −1,670 was the running balance since the station opened. The two
  // could never be made to reconcile, and that is what made this table look
  // wrong every time anyone checked it.
  //
  // Now every row reads left to right and the last column is the sum of the
  // ones before it:
  //
  //     Opening + Bought − Sold + Adjusted = On hand
  //
  // On hand is the station's own balance (maintained by a database trigger,
  // so it is authoritative). Opening is DERIVED by winding that balance back
  // through the period's movements — not stored, and correct for any period
  // the filter is set to. Adjusted is stock written off during the period,
  // which was invisible before and is part of why the old columns never
  // reconciled.
  const locationPerformance = useMemo(() => {
    return locations.map((loc) => {
      const locPeriod = periodTxs.filter((t) => t.location_id === loc.id);
      const boughtKg = locPeriod.filter((t) => t.type === "BUY").reduce((s, t) => s + Number(t.quantity_kg || 0), 0);
      const soldKg = locPeriod.filter((t) => t.type === "SELL").reduce((s, t) => s + Number(t.quantity_kg || 0), 0);
      // Adjustments are dated by when they were made, in Cambodia time, so a
      // late-evening write-off lands on the day it happened rather than the
      // next one.
      const adjustedKg = adjustments
        .filter((a) => a.location_id === loc.id)
        .filter((a) => {
          const day = cambodiaDateStr(new Date(a.created_at));
          return day >= rangeStart && day <= rangeEnd;
        })
        .reduce((s, a) => s + Number(a.adjustment_kg || 0), 0);

      const onHandKg = Number(loc.current_stock_kg) || 0;
      // Wind the authoritative closing balance back through the period.
      const openingKg = onHandKg - boughtKg + soldKg - adjustedKg;
      const moved = boughtKg > 0 || soldKg > 0 || adjustedKg !== 0;

      // The old dot meant "percentage of capacity", so every station showed
      // red — a trader who ships everything out is permanently under 40%
      // full, and five red dots read as five alarms. It now means whether
      // the station needs you.
      const status = onHandKg < -0.01 ? "attn" : moved ? "trading" : "quiet";

      return { loc, openingKg, boughtKg, soldKg, adjustedKg, onHandKg, status };
    });
  }, [locations, periodTxs, adjustments, rangeStart, rangeEnd]);

  const perfTotals = useMemo(() => locationPerformance.reduce((acc, r) => ({
    openingKg: acc.openingKg + r.openingKg,
    boughtKg: acc.boughtKg + r.boughtKg,
    soldKg: acc.soldKg + r.soldKg,
    adjustedKg: acc.adjustedKg + r.adjustedKg,
    onHandKg: acc.onHandKg + r.onHandKg,
  }), { openingKg: 0, boughtKg: 0, soldKg: 0, adjustedKg: 0, onHandKg: 0 }), [locationPerformance]);

  // Its own bounded fetch — see load(). Sorting eight rows is free.
  const liveFeed = useMemo(() => {
    return feedTxs.slice().sort((a, b) => (a.tx_date + a.tx_time < b.tx_date + b.tx_time ? 1 : -1)).slice(0, 8);
  }, [feedTxs]);

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
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
              <div className="flex items-baseline gap-2.5">
                <h3 className="font-bold text-slate-800">{t("dash_location_perf_plain")}</h3>
                {/* The unit, said once. Every number in this table is kilos —
                    repeating "kg" in thirty cells is noise. */}
                <span className="rounded border border-slate-200 px-1.5 py-px text-[10px] font-semibold tracking-wide text-slate-400">kg</span>
              </div>
              <span className="whitespace-nowrap text-[11px] tabular-nums text-slate-400">
                {rangeLabel} · {t("dash_locations_count", { n: locations.length })}
              </span>
            </div>
            {/* overflow-x-auto: the table scrolls sideways on its own on a
                narrow phone instead of pushing the whole page wider. */}
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-right text-[10px] uppercase tracking-[0.09em] text-slate-400">
                  <th className="px-5 py-2.5 text-left font-bold">{t("col_location")}</th>
                  <th className="px-3 py-2.5 font-bold">{t("col_opening")}</th>
                  {/* The three movement columns sit on a faint wash so they
                      read as one group — what happened during the period —
                      without ruling a line through the table. */}
                  <th className="bg-slate-50/70 px-3 py-2.5 font-bold">{t("col_bought")}</th>
                  <th className="bg-slate-50/70 px-3 py-2.5 font-bold">{t("col_sold")}</th>
                  <th className="bg-slate-50/70 px-3 py-2.5 font-bold">{t("col_adjusted")}</th>
                  <th className="px-3 py-2.5 font-bold">{t("col_on_hand")}</th>
                  {canOpenLocation && <th className="w-8 px-3 py-2.5"></th>}
                </tr>
              </thead>
              <tbody>
                {/* Rows open LocationDetail for HQ Admin / Owner and for a
                    view-only account, which reaches the same read-only page.
                    Any other role would only hit a permission screen, so it
                    stays unclickable for them (App.jsx gates station-detail). */}
                {locationPerformance.map(({ loc, openingKg, boughtKg, soldKg, adjustedKg, onHandKg, status }) => (
                  <tr
                    key={loc.id}
                    onClick={canOpenLocation ? () => { setSelectedLocationId(loc.id); setPage("station-detail"); } : undefined}
                    className={`border-b border-slate-50 text-right last:border-0 ${canOpenLocation ? "cursor-pointer hover:bg-brand-50/40" : "hover:bg-slate-50/60"}`}
                  >
                    <td className="px-5 py-3.5 text-left">
                      <div className="flex items-center gap-2.5">
                        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                          status === "attn" ? "bg-amber-500 ring-[3px] ring-amber-100"
                          : status === "trading" ? "bg-brand-600"
                          : "bg-slate-300"}`} />
                        <span className="font-semibold text-slate-700">{loc.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 tabular-nums text-slate-600">{fmt(openingKg)}</td>
                    {/* No "+" on Bought — it is always positive, so a plus on
                        every row carries no information. Sold and Adjusted
                        keep the minus, which does. */}
                    <td className="bg-slate-50/70 px-3 py-3.5 tabular-nums text-brand-700">
                      {boughtKg > 0 ? fmt(boughtKg) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="bg-slate-50/70 px-3 py-3.5 tabular-nums text-rose-600">
                      {soldKg > 0 ? `−${fmt(soldKg)}` : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="bg-slate-50/70 px-3 py-3.5 tabular-nums text-rose-600">
                      {adjustedKg !== 0 ? `${adjustedKg < 0 ? "−" : ""}${fmt(Math.abs(adjustedKg))}` : <span className="text-slate-300">—</span>}
                    </td>
                    {/* The only column in full weight: it is what the row is
                        for, and where the eye should land. */}
                    <td className={`px-3 py-3.5 font-semibold tabular-nums ${onHandKg < -0.01 ? "text-rose-600" : onHandKg === 0 ? "text-slate-400" : "text-slate-800"}`}>
                      {onHandKg < 0 ? `−${fmt(Math.abs(onHandKg))}` : fmt(onHandKg)}
                    </td>
                    {canOpenLocation && (
                      <td className="px-3 py-3.5 text-slate-300"><ChevronRight size={15} /></td>
                    )}
                  </tr>
                ))}
                {loading && locations.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">{t("loading_label")}</td></tr>}
                {locations.length === 0 && !loading && !loadError && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">{t("dash_no_locations")}</td></tr>}
              </tbody>
              {locationPerformance.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50/70 text-right font-bold">
                    <td className="px-5 py-3.5 text-left text-slate-700">{t("col_all_locations")}</td>
                    <td className="px-3 py-3.5 tabular-nums text-slate-700">{fmt(perfTotals.openingKg)}</td>
                    <td className="px-3 py-3.5 tabular-nums text-slate-700">{fmt(perfTotals.boughtKg)}</td>
                    <td className="px-3 py-3.5 tabular-nums text-slate-700">{perfTotals.soldKg > 0 ? `−${fmt(perfTotals.soldKg)}` : "—"}</td>
                    <td className="px-3 py-3.5 tabular-nums text-slate-700">{perfTotals.adjustedKg !== 0 ? `${perfTotals.adjustedKg < 0 ? "−" : ""}${fmt(Math.abs(perfTotals.adjustedKg))}` : "—"}</td>
                    <td className="px-3 py-3.5 tabular-nums text-slate-800">{perfTotals.onHandKg < 0 ? `−${fmt(Math.abs(perfTotals.onHandKg))}` : fmt(perfTotals.onHandKg)}</td>
                    {canOpenLocation && <td className="px-3 py-3.5"></td>}
                  </tr>
                </tfoot>
              )}
            </table>
            </div>
            {locationPerformance.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-[11.5px] text-slate-500">
                  <span className="flex items-center gap-2"><span className="h-[7px] w-[7px] rounded-full bg-brand-600" /><b className="font-semibold text-slate-700">{t("perf_trading")}</b> {t("perf_trading_why")}</span>
                  <span className="flex items-center gap-2"><span className="h-[7px] w-[7px] rounded-full bg-slate-300" /><b className="font-semibold text-slate-700">{t("perf_quiet")}</b> {t("perf_quiet_why")}</span>
                  <span className="flex items-center gap-2"><span className="h-[7px] w-[7px] rounded-full bg-amber-500 ring-[3px] ring-amber-100" /><b className="font-semibold text-slate-700">{t("perf_attn")}</b> {t("perf_attn_why")}</span>
                </div>
                {/* Printed so anyone can check the arithmetic on any row
                    without being told how the table works. */}
                <div className="border-t border-slate-100 px-5 py-3 text-[11.5px] text-slate-400">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-sans font-semibold text-slate-600">{t("perf_formula")}</code>
                </div>
              </>
            )}
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
