import { useRef, useState } from "react";
import { Scale, Camera, Lock, Check, Clock, X } from "lucide-react";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";

// THE EVENING COUNT — the station's side.
//
// [2026-09-21] SISEN: "what if its just staff reseting without anything and
// the hq didnt even bother to check".
//
// Three deliberate choices, all of them about the count being real:
//
//   · IT IS BLIND. This form does not show what the book says. A box that
//     already shows "12,450 kg" is answered by typing 12,450; a box that
//     shows nothing has to be answered by walking into the shed. The
//     comparison happens after the number is sent, and is shown straight
//     back on the next screen.
//   · IT IS JUDGED AGAINST THE PADDY BOUGHT, not against nothing. 300 kg out
//     of 30 tonnes is drying; 300 kg out of 400 kg is not. The database does
//     that arithmetic (submit_stock_count) so the screen cannot flatter it.
//   · A SMALL DIFFERENCE FINISHES HERE. Inside the allowance the stock is
//     corrected at once and recorded as a loss. HQ is asked only about what
//     is outside it — which is what makes HQ actually look.
//
// This file never changes stock and never decides. It sends one number and
// shows what came back.

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmt1(n) { return (Math.round((n || 0) * 10) / 10).toFixed(1); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }

function Shell({ title, subtitle, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700">
          <Scale size={16} className="text-brand-600" /> {title}
        </h3>
        <p className="mb-4 text-xs text-slate-400">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

export default function StockCountModal({ station, priceSuggestion = null, userId, onClose, onDone }) {
  const { t } = useLanguage();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const price = priceSuggestion != null ? Number(priceSuggestion.price) : null;
  const typed = String(counted).trim();
  // A blank box is NOT zero. "I have not typed it yet" and "the shed is
  // empty" are the two most different answers there are.
  const countedKg = typed === "" ? null : Number(typed.replace(/,/g, ""));
  const valid = countedKg != null && Number.isFinite(countedKg) && countedKg >= 0;

  async function submit(e) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError("");
    try {
      let photoUrl = null;
      if (file) {
        try {
          photoUrl = await api.uploadTransactionPhoto(file, "stock-count");
        } catch {
          // The photo is evidence, not the count. Say so rather than losing
          // the number the person just walked the shed for.
          setError(t("sc_photo_failed"));
          setBusy(false);
          return;
        }
      }
      const res = await api.submitStockCount({
        locationId: station.id,
        countedKg,
        note: note.trim() || null,
        photoUrl,
        pricePerKg: price != null && price > 0 ? Math.round(price) : null,
      });
      await api.logAudit({
        action: res?.status === "applied" ? "adjust_stock" : "request_stock_reset",
        tableName: "stock_reset_requests",
        recordId: station.id,
        oldData: { current_stock_kg: res?.expected_kg },
        newData: {
          counted_kg: countedKg, loss_kg: res?.loss_kg, loss_pct: res?.loss_pct,
          bought_since_kg: res?.bought_since_kg, stationName: station.name, auto: res?.status === "applied",
        },
        userId,
      }).catch(() => {});
      setResult(res);
      onDone?.(res);
    } catch (err) {
      const msg = String(err?.message || "");
      setError(/photo/i.test(msg) ? t("sc_photo_required") : msg || t("sr_error_default"));
    } finally {
      setBusy(false);
    }
  }

  // ── what came back ───────────────────────────────────────────────────────
  if (result) {
    const applied = result.status === "applied";
    const loss = Number(result.loss_kg) || 0;
    const pct = result.loss_pct == null ? null : Number(result.loss_pct);
    const value = price != null && price > 0 && loss > 0 ? Math.round(loss * price) : null;
    return (
      <Shell title={t("sc_title", { station: station.name })} subtitle={applied ? t("sc_done_sub") : t("sc_sent_sub")}>
        <div className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3.5 ${applied ? "border-brand-200 bg-brand-50" : "border-amber-200 bg-amber-50"}`}>
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${applied ? "bg-brand-100 text-brand-700" : "bg-amber-100 text-amber-700"}`}>
            {applied ? <Check size={16} /> : <Clock size={16} />}
          </span>
          <div>
            <p className={`text-sm font-semibold ${applied ? "text-brand-800" : "text-amber-800"}`}>
              {applied ? t("sc_done_title") : t("sc_sent_title")}
            </p>
            <p className={`mt-0.5 text-xs leading-relaxed ${applied ? "text-brand-700" : "text-amber-700"}`}>
              {applied ? t("sc_done_body", { kg: fmt(result.counted_kg) }) : t("sc_sent_body", { kg: fmt(result.expected_kg) })}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 text-sm tabular-nums">
          <div className="flex justify-between border-b border-slate-100 px-3.5 py-2.5">
            <span className="text-slate-500">{t("sc_expected")}</span><b className="text-slate-700">{fmt(result.expected_kg)} kg</b>
          </div>
          <div className="flex justify-between border-b border-slate-100 px-3.5 py-2.5">
            <span className="text-slate-500">{t("sc_counted")}</span><b className="text-slate-700">{fmt(result.counted_kg)} kg</b>
          </div>
          <div className="flex justify-between border-b border-slate-100 px-3.5 py-2.5">
            <span className="text-slate-500">{loss >= 0 ? t("sr_missing") : t("sr_extra")}</span>
            <b className={loss > 0 ? "text-rose-600" : loss < 0 ? "text-brand-700" : "text-slate-700"}>
              {loss > 0 ? "−" : loss < 0 ? "+" : ""}{fmt(Math.abs(loss))} kg{value != null ? ` · ${fmtRiel(value)}` : ""}
            </b>
          </div>
          <div className="flex justify-between bg-slate-50 px-3.5 py-2.5">
            <span className="text-slate-500">{t("sc_pct_of_bought")}</span>
            <b className={pct == null ? "text-slate-500" : applied ? "text-brand-700" : "text-rose-600"}>
              {pct == null ? t("sc_no_buys") : `${fmt1(pct)}% · ${fmt(result.bought_since_kg)} kg`}
            </b>
          </div>
        </div>

        {!applied && result.requires_owner && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("sc_owner_needed")}</p>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">{t("close_label")}</button>
        </div>
      </Shell>
    );
  }

  // ── the form ─────────────────────────────────────────────────────────────
  return (
    <Shell title={t("sc_title", { station: station.name })} subtitle={t("sc_subtitle")}>
      <form onSubmit={submit}>
        <div className="mb-3 flex gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs leading-relaxed text-slate-600">
          <Lock size={15} className="mt-0.5 shrink-0 text-slate-400" />
          <span>{t("sc_blind_note")}</span>
        </div>

        <label className="mb-1.5 block text-xs font-medium text-slate-500" htmlFor="sc-count">{t("sc_counted_label")}</label>
        <input
          id="sc-count" type="number" min="0" step="1" inputMode="decimal" autoFocus
          value={counted} onChange={(e) => setCounted(e.target.value)} placeholder=""
          className="mb-1 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-2xl font-bold tabular-nums outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
        />
        <p className="mb-3 text-[11px] text-slate-400">{t("sc_zero_hint")}</p>

        <label className="mb-1.5 block text-xs font-medium text-slate-500" htmlFor="sc-note">{t("sc_note_label")}</label>
        <textarea id="sc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={t("sc_note_placeholder")}
          className="mb-3 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100" />

        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button type="button" onClick={() => fileRef.current?.click()}
          className={`mb-1 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm ${file ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}>
          <Camera size={15} /> {file ? file.name.slice(0, 28) : t("sc_photo_btn")}
        </button>
        <p className="mb-3 text-[11px] text-slate-400">{t("sc_photo_hint")}</p>

        {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40">{t("cancel")}</button>
          <button type="submit" disabled={busy || !valid}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">
            {busy ? t("saving_label") : t("sc_send")}
          </button>
        </div>
      </form>
      {file && (
        <button type="button" onClick={() => setFile(null)}
          className="mt-2 flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-500"><X size={11} /> {t("sc_photo_remove")}</button>
      )}
    </Shell>
  );
}
