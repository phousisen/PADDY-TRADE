import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";

function toIso(d) { return d.toISOString().slice(0, 10); }
function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function startOfWeek(d) { const r = new Date(d); const day = (r.getDay() + 6) % 7; return addDays(r, -day); } // Monday start
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

function presets() {
  const t = today();
  return [
    { label: "Today", start: toIso(t), end: toIso(t) },
    { label: "Yesterday", start: toIso(addDays(t, -1)), end: toIso(addDays(t, -1)) },
    { label: "This Week", start: toIso(startOfWeek(t)), end: toIso(t) },
    { label: "Last Week", start: toIso(addDays(startOfWeek(t), -7)), end: toIso(addDays(startOfWeek(t), -1)) },
    { label: "This Month", start: toIso(startOfMonth(t)), end: toIso(t) },
    { label: "Last Month", start: toIso(startOfMonth(addDays(startOfMonth(t), -1))), end: toIso(endOfMonth(addDays(startOfMonth(t), -1))) },
    { label: "Last 7 Days", start: toIso(addDays(t, -6)), end: toIso(t) },
    { label: "Last 30 Days", start: toIso(addDays(t, -29)), end: toIso(t) },
    { label: "All Time", start: null, end: null },
  ];
}

function fmtDisplay(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function DateRangeFilter({ startDate, endDate, onChange }) {
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

  const label = !startDate && !endDate ? "All Time" : `${fmtDisplay(startDate)} – ${fmtDisplay(endDate)}`;
  const matchingPreset = PRESETS.find((p) => p.start === startDate && p.end === endDate);

  return (
    <div className="relative" ref={ref}>
      <button onClick={openPopover} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
        <Calendar size={14} className="text-slate-400" />
        {matchingPreset ? matchingPreset.label : label}
        <ChevronDown size={14} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 flex w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="w-36 border-r border-slate-100 py-2">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${tempStart === p.start && tempEnd === p.end ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 flex-col p-3">
            <label className="mb-1 text-xs text-slate-500">Start date</label>
            <input type="date" value={tempStart || ""} onChange={(e) => setTempStart(e.target.value || null)}
              className="mb-3 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            <label className="mb-1 text-xs text-slate-500">End date</label>
            <input type="date" value={tempEnd || ""} onChange={(e) => setTempEnd(e.target.value || null)}
              className="mb-4 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            <div className="mt-auto flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">Cancel</button>
              <button onClick={done} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
