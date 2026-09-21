import { useEffect, useReducer } from "react";
import { subscribeScale, scaleSnapshot } from "../scaleWatch.js";

// [2026-09-21] The poll loop that used to be here now lives in scaleWatch.js,
// one per station scale, shared by every weight box and by the background
// watcher App.jsx keeps on a station PC. Everything it learned here still
// holds there: the PC's own scale program is asked first (works with no
// internet), a reading for another station is never shown as this one's, a
// cloud reading is judged by the corrected clock, a reading older than 6 s
// is "not connected", and nothing is fetched while a print dialog is open.
//
// What is new is `status` — whether this weight may be captured right now
// (see scaleGuard.js). `by` names the weight box asking, so pressing Capture
// twice on the same ticket is not mistaken for a second truck.
export function useLiveWeight(locationId, { by = null, foreground = true } = {}) {
  const [, redraw] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!locationId) return undefined;
    redraw();
    return subscribeScale(locationId, redraw, { foreground });
  }, [locationId, foreground]);
  if (!locationId) return { connected: false, weightKg: undefined, source: undefined, status: "offline" };
  return scaleSnapshot(locationId, { by });
}

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

export default function LiveWeightBox({ locationId, label, onUse }) {
  const { connected, weightKg } = useLiveWeight(locationId);
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${connected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
        <div>
          <p className={`text-xs font-medium ${connected ? "text-emerald-700" : "text-slate-400"}`}>{connected ? (label || "Live Scale Weight") : "Scale not connected"}</p>
          <p className={`text-lg font-bold ${connected ? "text-emerald-800" : "text-slate-300"}`}>{connected ? `${fmt2(weightKg)} kg` : "— kg"}</p>
        </div>
      </div>
      {connected && onUse && (
        <button type="button" onClick={() => onUse(weightKg)}
          className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
          Use This
        </button>
      )}
    </div>
  );
}
