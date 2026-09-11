import { useState } from "react";
import { Scale, AlertTriangle, BookOpen } from "lucide-react";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }

// [2026-09-11] Closing a SMALL negative stock difference in one step.
//
// WHY THIS IS SEPARATE FROM AdjustStockModal
//   AdjustStockModal sets a station's stock to a number someone captured off
//   the scale, and its "reset to 0" path asks for a password every time —
//   right for wiping a forty-tonne shed at the end of a day, far too heavy
//   for the 35 kg that Reang Kesey is short. Asking for a password to
//   correct eight dollars is how a correction stops being made at all, and
//   an uncorrected −35 sits on the Dashboard forever teaching everyone to
//   ignore red numbers. So this is its own, much smaller thing.
//
// WHY IT ONLY HANDLES NEGATIVES
//   Negative stock is never real — a shed cannot hold less than nothing, so
//   a negative is always an error and zeroing it can never destroy paddy
//   that exists. A small POSITIVE figure might be genuine stock sitting in
//   the shed overnight, so this deliberately does not touch it; that is what
//   the daily reset in AdjustStockModal is for, password and all.
//
// WHERE THE LIMIT COMES FROM
//   `floor` is the smallest buy ticket this station has ever written (see
//   api.getStationTicketFloor / station_ticket_floor_2026-09-11.sql). A gap
//   smaller than that CANNOT be one missing ticket, so it has to be rain,
//   scale drift or sweepings. A gap bigger than that might be a lost ticket
//   and is refused here — that refusal is the whole point of the screen, and
//   is why the limit is read from the station's own history rather than
//   typed into Settings where somebody could raise it the day it gets
//   inconvenient.
//
// A station with too little history has no meaningful smallest ticket yet,
// so `enoughHistory` false refuses everything rather than guessing.
export function canSettle(onHandKg, floor) {
  if (!floor || !floor.enoughHistory) return false;
  if (!(floor.floorKg > 0)) return false;
  // Strictly negative, and small enough that no single ticket explains it.
  return onHandKg < -0.005 && Math.abs(onHandKg) < floor.floorKg;
}

// `onHandKg` is passed in rather than read off station.current_stock_kg:
// the Location Performance table derives On hand from the stock ledger, and
// that is the number the person is looking at when they press the button.
// Reading a second, possibly different figure out of the locations row here
// is how a modal ends up disagreeing with the table that opened it.
export default function SettleDifferenceModal({ station, onHandKg, floor, priceSuggestion, t, onClose, onSubmit }) {
  const previous = Number(onHandKg) || 0;
  const gapKg = Math.abs(previous);           // what has to appear to reach 0
  const allowed = canSettle(previous, floor);

  const [reason, setReason] = useState("moisture");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const price = priceSuggestion != null ? Number(priceSuggestion.price) : null;
  const valueRiel = price != null && Number.isFinite(price) ? gapKg * price : null;

  // How many whole tickets this station's gap is worth, for the refusal
  // message — "10 tickets" lands harder than "21,345 kg" with someone
  // deciding whether it is worth chasing.
  const ticketsWorth = floor && floor.avgKg > 0 ? gapKg / floor.avgKg : null;
  const pctOfFloor = floor && floor.floorKg > 0 ? Math.round((gapKg / floor.floorKg) * 100) : null;

  async function submit() {
    setError("");
    setSaving(true);
    try {
      // Always to zero: this screen exists only for negatives, and zero is
      // the only defensible destination for a figure that cannot be real.
      await onSubmit({
        newStockKg: 0,
        reason,
        note: note.trim() || null,
        pricePerKg: price != null && Number.isFinite(price) ? price : null,
      });
    } catch (err) {
      setError(err.message || t("adj_save_error_default"));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700">
          <Scale size={16} className="text-brand-600" /> {t("settle_title", { station: station.name })}
        </h3>
        <p className="mb-4 text-xs text-slate-400">{t("settle_subtitle")}</p>

        <div className="mb-3 rounded-lg border border-slate-200 px-3 py-1 text-sm">
          <div className="flex justify-between border-b border-slate-100 py-2">
            <span className="text-slate-500">{t("adj_system_shows")}</span>
            <span className="font-semibold tabular-nums text-rose-600">−{fmt2(gapKg)} kg</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-2">
            <span className="text-slate-500">{t("adj_setting_to")}</span>
            <span className="font-semibold tabular-nums text-slate-700">0.00 kg</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-slate-500">{t("settle_smallest_ticket")}</span>
            <span className="font-semibold tabular-nums text-slate-700">
              {floor && floor.floorKg > 0 ? `${fmt(floor.floorKg)} kg` : "—"}
            </span>
          </div>
        </div>

        {allowed ? (
          <>
            {/* The money, which the old modal never showed for a gain — a
                heavier weigh-out than weigh-in is real value in your favour
                and should be readable as such, not just as kilos. */}
            <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5">
              <p className="text-[19px] font-extrabold leading-tight tracking-tight text-brand-800 tabular-nums">
                {t("settle_gain_headline", { kg: fmt2(gapKg), value: valueRiel != null ? ` ≈ ${fmtRiel(valueRiel)}` : "" })}
              </p>
              <p className="mt-0.5 text-[11.5px] text-brand-700/80">{t("settle_gain_why")}</p>
              {pctOfFloor != null && (
                <p className="mt-0.5 text-[11.5px] text-brand-700/80">
                  {t("settle_too_small_to_be_ticket", { pct: pctOfFloor })}
                </p>
              )}
            </div>

            <label className="mb-1 block text-xs font-medium text-slate-500">{t("settle_reason_label")}</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
              <option value="moisture">{t("settle_reason_moisture")}</option>
              <option value="recount">{t("settle_reason_drift")}</option>
              <option value="other">{t("adj_reason_other")}</option>
            </select>

            <label className="mb-1 block text-xs font-medium text-slate-500">{t("settle_note_label")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          </>
        ) : (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-rose-700">
              <AlertTriangle size={14} className="shrink-0" /> {t("settle_refused_title")}
            </p>
            <p className="text-[12.5px] leading-relaxed text-rose-800/90">
              {!floor || !floor.enoughHistory
                ? t("settle_refused_no_history", { n: floor ? floor.ticketCount : 0 })
                : t("settle_refused_too_big", {
                    kg: fmt(gapKg),
                    value: valueRiel != null ? fmtRiel(valueRiel) : "—",
                    tickets: ticketsWorth != null ? fmt(Math.max(1, Math.round(ticketsWorth))) : "—",
                  })}
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-rose-700">
              <BookOpen size={13} className="shrink-0" /> {t("settle_refused_next_step")}
            </p>
          </div>
        )}

        {error && <p className="mb-2 text-sm text-rose-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40">
            {allowed ? t("cancel") : t("close_label")}
          </button>
          {allowed && (
            <button type="button" onClick={submit} disabled={saving}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? t("saving_label") : t("settle_btn")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
