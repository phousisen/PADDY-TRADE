// Transactions → Print Register.
//
// [2026-09-15] Two settings and a button. The settings exist because the
// printable width of a continuous-feed dot-matrix printer is not something the
// app can know — it depends on the tractor-feed guides at each station, and
// the four stations are not set up identically. So the width is asked for, in
// millimetres, and remembered per browser.
//
// Rows per form is a CEILING, not a promise. "15 per form" means at most 15;
// if the fifteenth would not fit whole it moves to the next form. That is the
// whole point of the paginator — see the note at the top of printRegister.js.

import { useState } from "react";
import { Printer, X } from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { printRegister } from "../printRegister.js";

const KEY_W = "paddytrade_register_width_mm";
const KEY_R = "paddytrade_register_rows";

// localStorage is per-station-PC, which is exactly the right scope for a
// printer setting — and it is read defensively, because a locked-down browser
// profile throws rather than returning null.
function readSetting(key, fallback) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}
function writeSetting(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* not worth failing a print over */ }
}

const WIDTHS = [160, 170, 180, 190, 200];
const ROWS = [0, 10, 12, 15, 18, 20, 25];

export default function PrintRegisterModal({ rows, meta, onClose }) {
  const { t } = useLanguage();
  const [width, setWidth] = useState(() => readSetting(KEY_W, 180));
  const [perForm, setPerForm] = useState(() => {
    try {
      const raw = localStorage.getItem(KEY_R);
      return raw === null ? 0 : Math.max(0, Number(raw) || 0);
    } catch { return 0; }
  });
  const [blocked, setBlocked] = useState(false);

  function go() {
    writeSetting(KEY_W, width);
    writeSetting(KEY_R, perForm);
    const ok = printRegister({ rows, t, meta, widthMm: width, rowsPerForm: perForm });
    if (!ok) { setBlocked(true); return; }
    onClose();
  }

  const pill = (active) =>
    `rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
      active ? "border-brand-700 bg-brand-700 text-white"
             : "border-slate-200 bg-white text-slate-500 hover:border-brand-400 hover:text-brand-700"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h3 className="text-[16px] font-bold tracking-tight text-slate-900">{t("print_title")}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="text-[12.5px] leading-relaxed text-slate-500">{t("print_intro")}</p>

        <div className="mt-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-400">{t("print_width")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {WIDTHS.map((w) => (
              <button key={w} type="button" onClick={() => setWidth(w)} className={pill(width === w)}>{w} mm</button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-slate-400">{t("print_width_hint")}</p>
        </div>

        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-400">{t("print_rows")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ROWS.map((r) => (
              <button key={r} type="button" onClick={() => setPerForm(r)} className={pill(perForm === r)}>
                {r === 0 ? t("print_rows_auto") : r}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-slate-400">{t("print_rows_hint")}</p>
        </div>

        {blocked && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] text-rose-700">
            {t("print_popup_blocked")}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-slate-500">
            {rows.length === 0 ? t("print_nothing") : t("print_count", { n: rows.length })}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
              {t("cancel")}
            </button>
            <button
              onClick={go}
              disabled={rows.length === 0}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              <Printer size={14} /> {t("print_go")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
