import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp, ClipboardList } from "lucide-react";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

const REASON_LABELS = {
  moisture: "Moisture loss",
  spillage: "Spillage / handling",
  recount: "Recount correction",
  other: "Other",
};

// Same Cambodia-timezone-safe date extraction used everywhere else in the
// app (Transactions.jsx, TransactionForm.jsx) — created_at is a full UTC
// timestamp, so this reads it back as the calendar date it actually was
// at the station (UTC+7, no daylight saving) rather than whatever date it
// happens to be in the viewing device's own timezone.
function cambodiaDateOnly(iso) {
  if (!iso) return "";
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(iso)).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "short", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit" }).format(d);
  return `${date} · ${time}`;
}

// Stock Loss report — a plain, honest record of how much paddy each
// location has lost (or occasionally regained, from a recount) beyond
// what Buy/Sell alone accounts for. This reads only from
// stock_adjustments (see api.recordStockAdjustment, wired up from the
// "Adjust" button on the Stock page) — it does not attempt to re-derive
// loss from anything else, since that's exactly the number staff already
// measured by hand when they recorded each adjustment.
export default function ReportShrinkage({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [allAdjustments, setAllAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Station names come from api.getStockAdjustments()'s own join (each
  // row already carries stationName) — no separate getLocations() call
  // needed here.
  function load() {
    setLoading(true);
    setLoadError("");
    api.getStockAdjustments()
      .then(setAllAdjustments)
      .catch((err) => {
        setLoadError(err.message || "Couldn't load this report — check your connection and try again.");
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const adjustments = useMemo(() => {
    return allAdjustments
      .filter((a) => !selectedLocationIds.length || selectedLocationIds.includes(a.location_id))
      .filter((a) => !startDate || cambodiaDateOnly(a.created_at) >= startDate)
      .filter((a) => !endDate || cambodiaDateOnly(a.created_at) <= endDate);
  }, [allAdjustments, selectedLocationIds, startDate, endDate]);

  const totals = useMemo(() => {
    let lossKg = 0, gainKg = 0;
    for (const a of adjustments) {
      const kg = Number(a.adjustment_kg) || 0;
      if (kg < 0) lossKg += -kg; else gainKg += kg;
    }
    return { lossKg, gainKg, netKg: gainKg - lossKg, count: adjustments.length };
  }, [adjustments]);

  const byLocation = useMemo(() => {
    const map = {};
    for (const a of adjustments) {
      const key = a.location_id;
      map[key] = map[key] || { locationName: a.stationName, lossKg: 0, gainKg: 0, count: 0 };
      const kg = Number(a.adjustment_kg) || 0;
      if (kg < 0) map[key].lossKg += -kg; else map[key].gainKg += kg;
      map[key].count += 1;
    }
    return Object.values(map).sort((a, b) => b.lossKg - a.lossKg);
  }, [adjustments]);

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}

      {/* [2026-08-31] Same fix as Dashboard's KPI row — stacks on phone
          instead of squeezing 3 across, unchanged on tablet/desktop. */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100 text-rose-600"><TrendingDown size={16} /></div>
          <p className="text-xs font-medium text-slate-500">Total Loss</p>
          <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-800">{fmt2(totals.lossKg)} kg</p>
          <p className="mt-1 text-[11px] text-slate-400">moisture, spillage, and other recorded loss</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600"><TrendingUp size={16} /></div>
          <p className="text-xs font-medium text-slate-500">Total Gain</p>
          <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-800">{fmt2(totals.gainKg)} kg</p>
          <p className="mt-1 text-[11px] text-slate-400">from recount corrections, if any</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600"><ClipboardList size={16} /></div>
          <p className="text-xs font-medium text-slate-500">Adjustments Recorded</p>
          <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-800">{totals.count}</p>
          <p className="mt-1 text-[11px] text-slate-400">net {totals.netKg >= 0 ? "+" : ""}{fmt2(totals.netKg)} kg over this period</p>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-700">By Location</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-3 font-medium">Location</th>
              <th className="px-5 py-3 font-medium">Adjustments</th>
              <th className="px-5 py-3 font-medium">Loss (kg)</th>
              <th className="px-5 py-3 font-medium">Gain (kg)</th>
              <th className="px-5 py-3 font-medium">Net (kg)</th>
            </tr>
          </thead>
          <tbody>
            {byLocation.map((l) => (
              <tr key={l.locationName} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-5 py-3 font-medium text-slate-700">{l.locationName}</td>
                <td className="px-5 py-3 text-slate-600">{l.count}</td>
                <td className="px-5 py-3 text-rose-600">{l.lossKg > 0 ? `-${fmt2(l.lossKg)}` : "—"}</td>
                <td className="px-5 py-3 text-emerald-600">{l.gainKg > 0 ? `+${fmt2(l.gainKg)}` : "—"}</td>
                <td className={`px-5 py-3 font-medium ${l.gainKg - l.lossKg < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {l.gainKg - l.lossKg >= 0 ? "+" : ""}{fmt2(l.gainKg - l.lossKg)}
                </td>
              </tr>
            ))}
            {loading && byLocation.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
            {byLocation.length === 0 && !loading && !loadError && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">No stock adjustments recorded for this period.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-700">Adjustment History</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Location</th>
              <th className="px-5 py-3 font-medium">Previous → New (kg)</th>
              <th className="px-5 py-3 font-medium">Change (kg)</th>
              <th className="px-5 py-3 font-medium">Reason</th>
              <th className="px-5 py-3 font-medium">Note</th>
              <th className="px-5 py-3 font-medium">Recorded By</th>
            </tr>
          </thead>
          <tbody>
            {adjustments.map((a) => (
              <tr key={a.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-5 py-3 text-slate-500">{fmtDateTime(a.created_at)}</td>
                <td className="px-5 py-3 text-slate-600">{a.stationName}</td>
                <td className="px-5 py-3 text-slate-600">{fmt2(a.previous_stock_kg)} → {fmt2(a.new_stock_kg)}</td>
                <td className={`px-5 py-3 font-medium ${Number(a.adjustment_kg) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {Number(a.adjustment_kg) >= 0 ? "+" : ""}{fmt2(a.adjustment_kg)}
                </td>
                <td className="px-5 py-3"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{REASON_LABELS[a.reason] || a.reason}</span></td>
                <td className="px-5 py-3 text-xs text-slate-400">{a.note || "—"}</td>
                <td className="px-5 py-3 text-slate-500">{a.adjustedByName}</td>
              </tr>
            ))}
            {loading && adjustments.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
            {adjustments.length === 0 && !loading && !loadError && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">No stock adjustments recorded for this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
