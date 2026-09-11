import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Warehouse, MapPin, Activity, ChevronRight } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import SettleDifferenceModal, { canSettle } from "../components/SettleDifferenceModal.jsx";
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
  // [2026-09-11] Settling writes to the stock ledger, so it is Owner/HQ
  // Admin only — a view-only account reaches the same table and must not
  // get the button, and neither should a station login looking at its own
  // row.
  const canSettleRole = isAdmin && !isViewOnly;
  const [locations, setLocations] = useState([]);
  const [txs, setTxs] = useState([]);
  // [2026-09-10] Stock adjustments, for the Adjusted column in Location
  // Performance. Loaded alongside the rest but allowed to fail on its own —
  // a missing column is better than a blank dashboard.
  const [adjustments, setAdjustments] = useState([]);
  const [feedTxs, setFeedTxs] = useState([]);
  // [2026-09-10] What each station held at the END of the selected period,
  // and at the end of the day BEFORE it. Read from the ledger, which knows
  // the answer for any date. Empty until they arrive, or if the database
  // function is not installed yet — see the fallback in locationPerformance.
  const [closeAtEnd, setCloseAtEnd] = useState(new Map());
  const [closeBeforeStart, setCloseBeforeStart] = useState(new Map());
  // [2026-09-11] Per-station smallest/average buy ticket and recent price —
  // what decides whether a negative On hand can be settled here or has to
  // go back to the paper book. Empty Map until it arrives, or forever if
  // station_ticket_floor_2026-09-11.sql hasn't been run yet, in which case
  // canSettle() is false for every station and the column stays exactly as
  // it was before this feature existed.
  const [ticketFloor, setTicketFloor] = useState(new Map());
  const [settleLoc, setSettleLoc] = useState(null);
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
      // [2026-09-10] NOTHING WAITS FOR ANYTHING ELSE.
      //
      // These three used to be one Promise.all: the screen showed
      // "Loading…" and 0 locations until the slowest of them came back,
      // even though the station list is a handful of rows and arrives in a
      // fraction of the time. The stations, their names and their current
      // stock now paint the moment they arrive; the period's movements
      // fill in behind them; the live feed and the adjustments arrive when
      // they arrive. Same requests, but the page stops being held hostage
      // by its slowest one.
      const locsPromise = api.getLocations();

      locsPromise.then((locs) => {
        // A request that raced ahead of the auth session fully attaching
        // (weak station WiFi, right after login/reload) can come back
        // empty — RLS quietly filters everything out instead of erroring —
        // which is indistinguishable from "this account really has zero
        // locations". Retry once before showing anything.
        if (locs.length === 0 && session?.user?.id && !isRetry) { load({ isRetry: true }); return; }
        setLocations(locs);
      }).catch(() => {});

      api.getTransactions({ limit: 8 })
        .then((feed) => setFeedTxs(feed.filter((x) => (x.hq_status || "processing") !== "cancelled")))
        .catch(() => {});

      api.getStockAdjustments({ startDate: rangeStart, endDate: rangeEnd })
        .then(setAdjustments).catch(() => setAdjustments([]));

      // Not affected by the period buttons — a station's smallest ticket is
      // a fact about its whole history, not about the days on screen. It
      // still rides along with each load rather than being fetched once,
      // because it is a single grouped read that returns one row per
      // station, and keeping it here means a settle made a moment ago is
      // reflected without a special refresh path.
      api.getStationTicketFloor().then(setTicketFloor).catch(() => setTicketFloor(new Map()));

      // The two snapshots that make "On hand" mean the end of the period
      // you picked rather than right now.
      const dayBefore = addDays(rangeStart, -1);
      api.getStockAtClose(rangeEnd).then(setCloseAtEnd).catch(() => setCloseAtEnd(new Map()));
      api.getStockAtClose(dayBefore).then(setCloseBeforeStart).catch(() => setCloseBeforeStart(new Map()));

      // The one the page genuinely has to wait for before it stops saying
      // "Loading…": the movements for the period on screen.
      const transactions = await api.getTransactions({ from: rangeStart, to: rangeEnd });
      setTxs(transactions.filter((x) => (x.hq_status || "processing") !== "cancelled"));
    } catch (err) {
      // Without this, a failed/dropped request left the dashboard — the
      // first thing anyone sees when they open PaddyTrade — stuck showing
      // nothing, with no indication of why or how to retry.
      // [2026-09-11] A dropped or timed-out request is a connection
      // problem, not something the person reading this screen can act on.
      // Ping Pong showed a red banner reading
      // "AbortError: signal is aborted without reason" — a raw browser
      // string, from supabaseClient.js's own per-request cutoff firing on
      // a slow link. Nobody can do anything with that, and the page
      // reloads fine a second later. Show the plain "couldn't load" line
      // for those and keep the specific text for real errors (a
      // permissions problem, a bad query) which an admin CAN act on.
      const raw = `${err?.name || ""} ${err?.message || err || ""}`.toLowerCase();
      const isConnectionBlip =
        raw.includes("aborterror") ||
        raw.includes("signal is aborted") ||
        raw.includes("failed to fetch") ||
        raw.includes("networkerror") ||
        raw.includes("load failed") ||
        raw.includes("timed out");
      setLoadError(isConnectionBlip ? t("dash_load_error") : (err.message || t("dash_load_error")));
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

  // [2026-09-11] Settling is only offered while the table is showing the
  // CURRENT state. On an older period the On hand column is a historical
  // snapshot — pressing settle there would set the station's stock TODAY to
  // zero based on where it stood last Tuesday, which is a different and
  // much worse operation than the one the button appears to offer. Rather
  // than explain that, the column simply is not there unless the period
  // ends today.
  const periodEndsToday = rangeEnd === cambodiaDateStr();
  const canSettleHere = canSettleRole && periodEndsToday;
  // Six fixed columns, plus the settle column and the chevron when shown —
  // kept as one number so the "loading" and "no locations" rows below span
  // the table properly instead of a hard-coded 7 that silently goes wrong
  // the moment a column is added.
  const perfColSpan = 6 + (canSettleHere ? 1 : 0) + (canOpenLocation ? 1 : 0);

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

      // [2026-09-10] Both ends are now REAL SNAPSHOTS, read from the
      // ledger: what this station held at the end of the day before the
      // period, and at the end of the last day of it.
      //
      // Before this, On hand was always today's figure whatever period was
      // selected, and Opening was worked backwards from it — so the
      // Yesterday row showed yesterday's movements against today's balance
      // and described no real moment (SISEN spotted it).
      //
      // If the snapshots are not there — the database function isn't
      // installed yet, or they simply have not arrived — this falls back to
      // exactly the old behaviour rather than showing a blank.
      const haveSnapshots = closeAtEnd.size > 0;
      const onHandKg = haveSnapshots
        ? (closeAtEnd.get(loc.id) ?? 0)
        : (Number(loc.current_stock_kg) || 0);
      const openingKg = haveSnapshots && closeBeforeStart.size > 0
        ? (closeBeforeStart.get(loc.id) ?? 0)
        : onHandKg - boughtKg + soldKg - adjustedKg;
      const moved = boughtKg > 0 || soldKg > 0 || adjustedKg !== 0;

      // The old dot meant "percentage of capacity", so every station showed
      // red — a trader who ships everything out is permanently under 40%
      // full, and five red dots read as five alarms. It now means whether
      // the station needs you.
      const status = onHandKg < -0.01 ? "attn" : moved ? "trading" : "quiet";

      return { loc, openingKg, boughtKg, soldKg, adjustedKg, onHandKg, status };
    });
  }, [locations, periodTxs, adjustments, rangeStart, rangeEnd, closeAtEnd, closeBeforeStart]);

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
                  {/* [2026-09-11] Holds the settle control. Deliberately
                      unlabelled: it is empty on every station whose stock
                      is fine, and a column heading over mostly-blank cells
                      reads as something missing rather than something
                      that only appears when it applies. */}
                  {canSettleHere && <th className="px-3 py-2.5"></th>}
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
                    {/* A negative opening is the same warning as a negative
                        On hand — the books said the shed owed paddy at the
                        start of the period — so it is coloured the same
                        way rather than sitting there as a plain grey
                        number. */}
                    <td className={`px-3 py-3.5 tabular-nums ${openingKg < -0.01 ? "text-rose-600" : "text-slate-600"}`}>{fmt(openingKg)}</td>
                    {/* No "+" on Bought — it is always positive, so a plus on
                        every row carries no information. Sold and Adjusted
                        keep the minus, which does. */}
                    <td className="bg-slate-50/70 px-3 py-3.5 tabular-nums text-brand-700">
                      {boughtKg > 0 ? fmt(boughtKg) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="bg-slate-50/70 px-3 py-3.5 tabular-nums text-rose-600">
                      {soldKg > 0 ? `−${fmt(soldKg)}` : <span className="text-slate-300">—</span>}
                    </td>
                    {/* [2026-09-12] Adjusted takes its colour from its SIGN.
                        It was hard-coded rose like Sold, so Reang Kesey's
                        +35 kg — paddy the station turned out to have MORE
                        of — was printed in the same red as a loss. Sold is
                        always red because stock always leaves; an
                        adjustment goes either way, and the colour has to
                        say which. A "+" is shown too, for the same reason
                        the minus is shown on Sold: the sign is the
                        information. */}
                    <td className={`bg-slate-50/70 px-3 py-3.5 tabular-nums ${adjustedKg < 0 ? "text-rose-600" : "text-brand-700"}`}>
                      {adjustedKg !== 0 ? `${adjustedKg < 0 ? "−" : "+"}${fmt(Math.abs(adjustedKg))}` : <span className="text-slate-300">—</span>}
                    </td>
                    {/* The only column in full weight: it is what the row is
                        for, and where the eye should land. */}
                    <td className={`px-3 py-3.5 font-semibold tabular-nums ${onHandKg < -0.01 ? "text-rose-600" : onHandKg === 0 ? "text-slate-400" : "text-slate-800"}`}>
                      {onHandKg < 0 ? `−${fmt(Math.abs(onHandKg))}` : fmt(onHandKg)}
                    </td>
                    {/* [2026-09-11] Only ever shown against a NEGATIVE On
                        hand — a shed cannot hold less than nothing, so a
                        negative is always an error and there is always
                        something to do about it. A positive figure is
                        left alone: it might be real paddy sitting in the
                        shed, and zeroing that is the daily reset's job
                        (password and all), not this button's.
                        stopPropagation because the whole row is a link
                        into the station page. */}
                    {canSettleHere && (
                      <td className="px-3 py-3.5 text-right">
                        {onHandKg < -0.005 && (
                          canSettle(onHandKg, ticketFloor.get(loc.id)) ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setSettleLoc({ loc, onHandKg }); }}
                              className="whitespace-nowrap rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11.5px] font-bold text-brand-700 hover:bg-brand-100"
                            >
                              {t("perf_settle_btn", { kg: fmt(Math.abs(onHandKg)) })}
                            </button>
                          ) : (
                            <span
                              title={t("settle_refused_next_step")}
                              className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-slate-400"
                            >
                              {t("perf_settle_blocked")}
                            </span>
                          )
                        )}
                      </td>
                    )}
                    {canOpenLocation && (
                      <td className="px-3 py-3.5 text-slate-300"><ChevronRight size={15} /></td>
                    )}
                  </tr>
                ))}
                {loading && locations.length === 0 && <tr><td colSpan={perfColSpan} className="px-5 py-10 text-center text-sm text-slate-400">{t("loading_label")}</td></tr>}
                {locations.length === 0 && !loading && !loadError && <tr><td colSpan={perfColSpan} className="px-5 py-10 text-center text-sm text-slate-400">{t("dash_no_locations")}</td></tr>}
              </tbody>
              {/* [2026-09-10] The "All locations" totals row was removed at
                  SISEN's request: every figure in it is already on the four
                  cards directly above this table. Repeating a number is not
                  free — it is one more thing that can disagree with itself. */}
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

      {/* [2026-09-11] Settle difference. `settleLoc` carries BOTH the row's
          location and the exact On hand figure that row was showing, so the
          modal can never quote a different number from the table that
          opened it (the table's On hand comes from the stock ledger;
          locations.current_stock_kg is a separate cached copy). The write
          itself is still safe regardless: record_stock_adjustment re-reads
          the station's real current stock under lock on the server, so a
          sale syncing in between cannot turn this into a wrong loss —
          see api.recordStockAdjustment. */}
      {settleLoc && (
        <SettleDifferenceModal
          station={settleLoc.loc}
          onHandKg={settleLoc.onHandKg}
          floor={ticketFloor.get(settleLoc.loc.id)}
          priceSuggestion={
            ticketFloor.get(settleLoc.loc.id)?.recentPrice != null
              ? { price: ticketFloor.get(settleLoc.loc.id).recentPrice, source: "recent" }
              : null
          }
          t={t}
          onClose={() => setSettleLoc(null)}
          onSubmit={async ({ newStockKg, reason, note, pricePerKg }) => {
            await api.recordStockAdjustment({
              locationId: settleLoc.loc.id,
              previousStockKg: Number(settleLoc.loc.current_stock_kg) || 0,
              newStockKg,
              reason,
              note,
              userId: session?.user?.id,
              pricePerKg,
            });
            setSettleLoc(null);
            // Full reload rather than patching the row by hand: the
            // adjustment changes On hand, the Adjusted column and the
            // ledger snapshots at once, and re-deriving all three from one
            // source beats keeping three copies in step.
            load();
          }}
        />
      )}
    </div>
  );
}
