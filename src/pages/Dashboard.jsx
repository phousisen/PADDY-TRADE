import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Warehouse, MapPin, Activity } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }
function timeAgo(dateStr, timeStr) {
  // dateStr/timeStr are Cambodia wall-clock values — parse them as such
  // explicitly (+07:00) so this is correct no matter what timezone the
  // viewing device itself is set to.
  const then = new Date(`${dateStr}T${timeStr || "00:00:00"}+07:00`);
  const diffMin = Math.round((Date.now() - then.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr${diffHr === 1 ? "" : "s"} ago`;
  return `${Math.round(diffHr / 24)} day(s) ago`;
}
// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting.
function cambodiaDateStr(d = new Date()) {
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

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "custom", label: "Custom" },
];

export default function Dashboard() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [locations, setLocations] = useState([]);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [locs, transactions] = await Promise.all([api.getLocations(), api.getTransactions()]);
      setLocations(locs);
      setTxs(transactions.filter((x) => (x.hq_status || "processing") !== "cancelled"));
    } catch (err) {
      // Without this, a failed/dropped request left the dashboard — the
      // first thing anyone sees when they open PaddyTrade — stuck showing
      // nothing, with no indication of why or how to retry.
      setLoadError(err.message || "Couldn't load the dashboard — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const todayStr = cambodiaDateStr();
  const [period, setPeriod] = useState("today");
  const [customStart, setCustomStart] = useState(todayStr);
  const [customEnd, setCustomEnd] = useState(todayStr);

  // Every card/table below reads from this one range — switching the
  // period control re-slices the same transaction list instead of
  // re-fetching, so it's instant.
  const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
    switch (period) {
      case "yesterday": {
        const y = addDays(todayStr, -1);
        return { rangeStart: y, rangeEnd: y, rangeLabel: "Yesterday" };
      }
      case "week":
        return { rangeStart: startOfWeekStr(todayStr), rangeEnd: todayStr, rangeLabel: "This Week" };
      case "month":
        return { rangeStart: startOfMonthStr(todayStr), rangeEnd: todayStr, rangeLabel: "This Month" };
      case "custom": {
        // Guard against the end date being typed before the start date —
        // swap rather than silently returning an empty/backwards range.
        const s = customStart || todayStr;
        const e = customEnd || todayStr;
        return { rangeStart: s <= e ? s : e, rangeEnd: s <= e ? e : s, rangeLabel: "Selected Period" };
      }
      default:
        return { rangeStart: todayStr, rangeEnd: todayStr, rangeLabel: "Today" };
    }
  }, [period, todayStr, customStart, customEnd]);

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
      <Topbar title={isAdmin ? "HQ Overview" : "Location Overview"} subtitle="Operations Summary" />
      <main className="flex-1 overflow-y-auto p-6">
        {loadError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
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
              <span>to</span>
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

        <div className="mb-5 grid grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 text-brand-600"><TrendingUp size={16} /></div>
            <p className="text-xs font-medium text-slate-500">Total Buy ({rangeLabel})</p>
            <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-800">{fmt2(totalBuyKg)} kg</p>
            <p className="mt-1 text-[11px] text-slate-400">{fmtRiel(totalBuyAmt)} paid out</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-sky-600"><TrendingDown size={16} /></div>
            <p className="text-xs font-medium text-slate-500">Total Sell ({rangeLabel})</p>
            <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-800">{fmt2(totalSellKg)} kg</p>
            <p className="mt-1 text-[11px] text-slate-400">{fmtRiel(totalSellAmt)} received</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600"><Warehouse size={16} /></div>
            <p className="text-xs font-medium text-slate-500">Current Stock (All-Time)</p>
            <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-800">{fmt2(netStockKg)} kg</p>
            {/* This is deliberately NOT "today's buy minus today's sell" —
                it's the real running total built up over the location's
                entire history. Sitting next to the two "Today" cards made
                it look like it should equal them, which it never will
                unless the location's stock happened to start today at
                zero. Spelling that out here so it reads correctly at a
                glance instead of looking like a math error. */}
            <p className="mt-1 text-[11px] text-slate-400">on hand right now, across {locations.length} location(s) — not just today</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-gold-100 text-gold-700"><MapPin size={16} /></div>
            <p className="text-xs font-medium text-slate-500">Active Locations</p>
            <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-800">{locations.length}</p>
            <p className="mt-1 text-[11px] text-slate-400">{periodTxs.length} transaction(s) — {rangeLabel}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-5">
          <div className="col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="font-bold text-slate-800">Location Performance ({rangeLabel})</h3>
              <span className="text-[11px] text-slate-400">{locations.length} location(s)</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-semibold">Location</th>
                  <th className="px-3 py-2.5 font-semibold">Buy (kg)</th>
                  <th className="px-3 py-2.5 font-semibold">Sell (kg)</th>
                  <th className="px-3 py-2.5 font-semibold">Stock</th>
                </tr>
              </thead>
              <tbody>
                {locationPerformance.map(({ loc, buyKg, sellKg, pct }) => (
                  <tr key={loc.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${pct > 80 ? "bg-emerald-500" : pct > 40 ? "bg-gold-500" : "bg-rose-400"}`} />
                        <span className="font-semibold text-slate-700">{loc.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 font-medium text-brand-600">{buyKg > 0 ? `+${fmt2(buyKg)}` : "—"}</td>
                    <td className="px-3 py-3.5 font-medium text-sky-600">{sellKg > 0 ? `-${fmt2(sellKg)}` : "—"}</td>
                    <td className="px-3 py-3.5 text-slate-600">
                      <div className="flex items-center gap-2.5">
                        <span>{fmt2(loc.current_stock_kg)} kg</span>
                        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                        </span>
                        <span className="text-[11px] text-slate-400">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {loading && locations.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
                {locations.length === 0 && !loading && !loadError && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">No locations yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <Activity size={15} className="text-brand-600" />
              <h3 className="font-bold text-slate-800">Live Feed</h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {liveFeed.map((tx) => (
                <div key={tx.id} className="flex items-start gap-2.5 border-b border-slate-50 px-4 py-3.5 last:border-0">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${tx.type === "BUY" ? "bg-brand-100 text-brand-700" : "bg-sky-100 text-sky-700"}`}>
                    {tx.type === "BUY" ? "▲" : "▼"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-700">{tx.partyName} · {fmt2(tx.quantity_kg)} kg</p>
                    <p className="text-[11px] text-slate-400">{tx.stationName}</p>
                  </div>
                  <p className="shrink-0 whitespace-nowrap text-[10.5px] text-slate-400">{timeAgo(tx.tx_date, tx.tx_time)}</p>
                </div>
              ))}
              {loading && liveFeed.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-400">Loading…</p>}
              {liveFeed.length === 0 && !loading && !loadError && <p className="px-4 py-10 text-center text-sm text-slate-400">No activity yet.</p>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
