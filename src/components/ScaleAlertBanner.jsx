import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { getAccurateNow } from "../supabaseClient.js";
import { stationsBelowZero } from "../scaleAlert.js";

function fmtKg(n) {
  return `${n < 0 ? "−" : ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.abs(n))}`;
}

// [2026-09-21] HQ sees at once when a station's scale is reading below zero.
// SISEN found REANG KESEY at −6,675 kg by chance, on a New Buy form. Every
// truck weighed there reads that much too light until someone presses ZERO
// with the platform empty — this puts it at the top of the HQ Dashboard for
// as long as it lasts, and the station's own weight box refuses to capture.
export default function ScaleAlertBanner({ locations, t, onOpen }) {
  const [readings, setReadings] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      api.getScaleReadings().then((r) => { if (!cancelled) setReadings(r); }).catch(() => {});
    };
    load();
    const id = setInterval(load, 60000);
    document.addEventListener("visibilitychange", load);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", load); };
  }, []);

  const below = stationsBelowZero(readings, locations, getAccurateNow().getTime());
  if (below.length === 0) return null;
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600" />
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-rose-900">
        {below.map((s) => (
          <p key={s.id} className="font-semibold">{t("sa_title", { station: s.name, kg: fmtKg(s.weightKg) })}</p>
        ))}
        <p className="text-rose-800">{t("sa_body")}</p>
      </div>
      {onOpen && (
        <button type="button" onClick={onOpen} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100">
          {t("sa_open")}
        </button>
      )}
    </div>
  );
}
