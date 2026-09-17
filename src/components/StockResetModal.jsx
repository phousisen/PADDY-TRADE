import { useState } from "react";
import { Scale, RotateCcw, AlertTriangle, Clock, X } from "lucide-react";
import { describeReset, validateRequest, MIN_REASON_CHARS } from "../stockReset.js";
import { dmyTime } from "../dateFormat.js";

// The station's side of a stock reset.
//
// [2026-09-17] SISEN: "i want each location to be able to reset their stock to
// 0 to get it as a stock loss, but will need hq above to confirm and accept
// it."
//
// DELIBERATELY NOT AdjustStockModal.
//   That modal CHANGES stock, and asks for a password to prove the person
//   meant it. This one changes nothing — it asks. The second person is HQ,
//   which is a stronger check than a password the same person types, so there
//   is no password here. Adding one would only teach staff that typing their
//   password is what makes stock move, which is exactly the habit this
//   feature exists to remove.
//
// Two states: the form, and — when one is already waiting — the receipt,
// because a station whose request is pending must be able to see what it
// asked for without being able to ask again.

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }

function Shell({ title, subtitle, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700">
          <Scale size={16} className="text-brand-600" /> {title}
        </h3>
        <p className="mb-4 text-xs text-slate-400">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

/** The three-cell strip: what the book says, what was counted, the difference. */
function DiffStrip({ d, t }) {
  const missing = d.isLoss;
  return (
    <div className="mb-3 flex overflow-hidden rounded-lg border border-slate-200 text-center">
      <div className="flex-1 border-r border-slate-100 px-2 py-2.5">
        <span className="block text-[11px] text-slate-400">{t("sr_book")}</span>
        <span className="text-sm font-semibold text-slate-700">{fmt(d.bookKg)}</span>
      </div>
      <div className="flex-1 border-r border-slate-100 px-2 py-2.5">
        <span className="block text-[11px] text-slate-400">{t("sr_counted")}</span>
        <span className="text-sm font-semibold text-slate-700">{fmt(d.countedKg)}</span>
      </div>
      <div className={`flex-1 px-2 py-2.5 ${missing ? "bg-rose-50" : d.isGain ? "bg-brand-50" : ""}`}>
        <span className={`block text-[11px] ${missing ? "text-rose-500" : d.isGain ? "text-brand-600" : "text-slate-400"}`}>
          {missing ? t("sr_missing") : d.isGain ? t("sr_extra") : t("sr_difference")}
        </span>
        <span className={`text-sm font-semibold ${missing ? "text-rose-700" : d.isGain ? "text-brand-700" : "text-slate-700"}`}>
          {missing ? fmt(d.missingKg) : d.isGain ? `+${fmt(d.diffKg)}` : "0"}
        </span>
      </div>
    </div>
  );
}

export function StockResetModal({ station, priceSuggestion, pending, t, onClose, onSubmit, onCancelRequest }) {
  const book = Number(station.current_stock_kg) || 0;
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const price = priceSuggestion != null ? Number(priceSuggestion.price) : null;
  const d = describeReset({ bookKg: book, countedKg: Number(String(counted).replace(/,/g, "")), pricePerKg: price });
  const check = validateRequest({ count: counted, reason, bookKg: book, pendingRequest: pending });
  const typedSomething = String(counted).trim() !== "";

  // ── already waiting ──────────────────────────────────────────────────────
  // Not a disabled button with no explanation. The station sees exactly what
  // it asked for, when, and that the stock has not moved.
  if (pending) {
    const p = describeReset({
      bookKg: pending.book_kg_at_request,
      countedKg: pending.counted_kg,
      pricePerKg: pending.price_per_kg,
    });
    return (
      <Shell title={t("sr_title", { station: station.name })} subtitle={t("sr_pending_subtitle")}>
        <div className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <Clock size={15} className="mt-0.5 shrink-0" />
          <span>
            <span className="block font-semibold">{t("sr_pending_title")}</span>
            {dmyTime(pending.requested_at)}
          </span>
        </div>

        <DiffStrip d={p} t={t} />

        {p.isLoss && p.hasPrice && (
          <div className="mb-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5">
            <span className="block text-[11px] text-rose-600">{t("sr_loss_label")}</span>
            <span className="text-lg font-bold text-rose-700">{fmtRiel(p.lossValue)}</span>
          </div>
        )}

        {pending.note && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{pending.note}</p>}

        <p className="mb-4 text-xs text-slate-400">{t("sr_stock_unchanged", { kg: fmt(book) })}</p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("close_label")}</button>
          {onCancelRequest && (
            <button type="button" disabled={busy}
              onClick={async () => {
                setError(""); setBusy(true);
                try { await onCancelRequest(pending); } catch (err) { setError(err.message || t("sr_error_default")); setBusy(false); }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40">
              <X size={13} /> {t("sr_withdraw")}
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
      </Shell>
    );
  }

  // ── the form ─────────────────────────────────────────────────────────────
  async function submit(e) {
    e.preventDefault();
    if (!check.ok) return;
    setError(""); setBusy(true);
    try {
      await onSubmit({
        countedKg: check.countedKg,
        // Zero means the shed is empty — that is the app's "reset" reason and
        // not a recount. Everything else is a recount until someone says
        // otherwise; the typed note carries the real story either way.
        reason: check.countedKg === 0 ? "reset" : "recount",
        note: check.reason,
        pricePerKg: price != null && price > 0 ? Math.round(price) : null,
      });
    } catch (err) {
      setError(err.message || t("sr_error_default"));
      setBusy(false);
    }
  }

  return (
    <Shell title={t("sr_title", { station: station.name })} subtitle={t("sr_subtitle")}>
      <form onSubmit={submit}>
        <div className="mb-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
          <div><span className="text-slate-500">{t("sr_book")}</span> <span className="font-medium text-slate-700">{fmt2(book)} kg</span></div>
          <button type="button" onClick={() => setCounted("0")}
            className="flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">
            <RotateCcw size={11} /> {t("sr_empty_shortcut")}
          </button>
        </div>

        <label className="mb-1 block text-xs text-slate-500">{t("sr_counted_label")}</label>
        {/* A plain number box on purpose. WeightField exists to read the
            weighbridge, and a shed count is not a weighbridge reading — the
            scale button there would offer a lorry's weight as the answer to
            "how much paddy is in the building". */}
        <input
          type="number" min="0" step="1" inputMode="decimal"
          value={counted} onChange={(e) => setCounted(e.target.value)}
          placeholder="0"
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-3 text-lg font-semibold tabular-nums outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />

        {typedSomething && check.error !== "not_a_number" && <DiffStrip d={d} t={t} />}

        {d.isLoss && d.hasPrice && (
          <div className="mb-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5">
            <span className="block text-[11px] text-rose-600">{t("sr_loss_label")}</span>
            <span className="text-lg font-bold text-rose-700">{fmtRiel(d.lossValue)}</span>
          </div>
        )}

        <label className="mb-1 mt-1 block text-xs text-slate-500">{t("sr_reason_label")}</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          placeholder={t("sr_reason_placeholder")}
          className="mb-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        {reason.trim().length > 0 && reason.trim().length < MIN_REASON_CHARS && (
          <p className="mb-2 text-xs text-amber-600">{t("sr_reason_too_short")}</p>
        )}

        <div className="mb-3 flex gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <span>{t("sr_needs_approval")}</span>
        </div>

        {check.error === "unchanged" && typedSomething && (
          <p className="mb-2 text-xs text-slate-400">{t("sr_same_as_book")}</p>
        )}
        {error && <p className="mb-2 text-sm text-rose-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40">{t("cancel")}</button>
          <button type="submit" disabled={busy || !check.ok}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">
            {busy ? t("saving_label") : t("sr_send_btn")}
          </button>
        </div>
      </form>
    </Shell>
  );
}

export default StockResetModal;
