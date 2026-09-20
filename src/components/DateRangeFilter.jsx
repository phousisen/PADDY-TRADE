import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { getAccurateNow } from "../supabaseClient.js";
import { useLanguage } from "../i18n.jsx";

// All date-range math below works with a Date object whose LOCAL
// year/month/day fields represent Cambodia's calendar date — this keeps
// toIso() and the addDays/startOfWeek/startOfMonth helpers correct no
// matter what timezone the viewing device itself happens to be set to.
function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// Uses getAccurateNow() (see supabaseClient.js), not the device's raw
// clock — a station or admin PC's own clock can simply be set wrong, which
// would otherwise make "Today"/"Yesterday" filter on the wrong day.
function today() {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(getAccurateNow()).forEach((p) => { parts[p.type] = p.value; });
  return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function startOfWeek(d) { const r = new Date(d); const day = (r.getDay() + 6) % 7; return addDays(r, -day); } // Monday start
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

// [2026-09-19] Labels in both languages — this filter heads every report and
// the Transactions list, and was English on a Khmer screen.
function presets() {
  const t = today();
  return [
    { k: "drf_today", start: toIso(t), end: toIso(t) },
    { k: "drf_yesterday", start: toIso(addDays(t, -1)), end: toIso(addDays(t, -1)) },
    { k: "drf_this_week", start: toIso(startOfWeek(t)), end: toIso(t) },
    { k: "drf_last_week", start: toIso(addDays(startOfWeek(t), -7)), end: toIso(addDays(startOfWeek(t), -1)) },
    { k: "drf_this_month", start: toIso(startOfMonth(t)), end: toIso(t) },
    { k: "drf_last_month", start: toIso(startOfMonth(addDays(startOfMonth(t), -1))), end: toIso(endOfMonth(addDays(startOfMonth(t), -1))) },
    { k: "drf_last_7", start: toIso(addDays(t, -6)), end: toIso(t) },
    { k: "drf_last_30", start: toIso(addDays(t, -29)), end: toIso(t) },
    { k: "drf_all_time", start: null, end: null },
  ];
}

function fmtDisplay(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function DateRangeFilter({ startDate, endDate, onChange }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [tempStart, setTempStart] = useState(startDate);
  const [tempEnd, setTempEnd] = useState(endDate);
  const ref = useRef(null);
  const PRESETS = presets();

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function openPopover() {
    setTempStart(startDate);
    setTempEnd(endDate);
    setOpen(true);
  }

  function applyPreset(p) {
    setTempStart(p.start);
    setTempEnd(p.end);
  }

  function done() {
    onChange(tempStart, tempEnd);
    setOpen(false);
  }

  // [2026-09-19] (audit F13) Only one end chosen used to read " – 18/09/2026"
  // or "01/09/2026 – ", which looks like a broken filter. It now says
  // "From …" / "Until …".
  const label = !startDate && !endDate
    ? t("drf_all_time")
    : !endDate ? t("drf_from", { d: fmtDisplay(startDate) })
    : !startDate ? t("drf_until", { d: fmtDisplay(endDate) })
    : `${fmtDisplay(startDate)} – ${fmtDisplay(endDate)}`;
  const matchingPreset = PRESETS.find((p) => p.start === startDate && p.end === endDate);

  return (
    <div className="relative" ref={ref}>
      <button onClick={openPopover} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
        <Calendar size={14} className="text-slate-400" />
        {matchingPreset ? t(matchingPreset.k) : label}
        <ChevronDown size={14} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 flex w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="w-36 border-r border-slate-100 py-2">
            {PRESETS.map((p) => (
              <button key={p.k} onClick={() => applyPreset(p)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${tempStart === p.start && tempEnd === p.end ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600"}`}>
                {t(p.k)}
              </button>
            ))}
          </div>
          <div className="flex flex-1 flex-col p-3">
            <label className="mb-1 text-xs text-slate-500">{t("drf_start")}</label>
            <input type="date" value={tempStart || ""} onChange={(e) => setTempStart(e.target.value || null)}
              className="mb-3 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            <label className="mb-1 text-xs text-slate-500">{t("drf_end")}</label>
            <input type="date" value={tempEnd || ""} onChange={(e) => setTempEnd(e.target.value || null)}
              className="mb-4 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            <div className="mt-auto flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">{t("drf_cancel")}</button>
              <button onClick={done} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">{t("drf_done")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
