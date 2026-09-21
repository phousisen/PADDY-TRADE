import { useEffect, useRef, useState } from "react";
import { Warehouse, Scale, Eye, EyeOff, X, Lock } from "lucide-react";
import { api } from "../api.js";
import { describeReset } from "../stockReset.js";
import { dmy, dmyTime } from "../dateFormat.js";
import StockCountModal from "./StockCountModal.jsx";
import { StockResetModal } from "./StockResetModal.jsx";

// The station's stock on its own Dashboard, and the evening count.
//
// [2026-09-20] SISEN: "i want them to be able to click on the reset or adjust
// in the dashboard" — it existed, but only as a small button in a table on
// the Stock page, where nobody at a station ever looked.
//
// [2026-09-21] Now one button, not two. "Reset to 0" and "weigh what is left"
// turned out to be the same act with a different number in it, so both are
// the evening count: type what is actually in the shed, 0 included. What
// happens next is decided by the database, not here:
//
//   inside the allowance  → applied at once, recorded as a loss, HQ untouched
//   outside it            → nothing moves; it waits for HQ
//   above the owner limit → only the Owner can approve it
//
// See StockCountModal.jsx and daily_stock_count.sql.

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmt1(n) { return (Math.round((n || 0) * 10) / 10).toFixed(1); }
function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function timeOnly(iso) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch { return ""; }
}

export default function StationStockCard({ station, adjustments = [], priceSuggestion = null, canAsk, userId, t, onChanged }) {
  const [pending, setPending] = useState(null);
  const [open, setOpen] = useState(false);          // the count form
  const [viewing, setViewing] = useState(false);     // the receipt of one that is waiting
  // [2026-09-21] THE BOOK FIGURE IS COVERED BY DEFAULT. A count is only
  // worth anything if it was weighed, and a number sitting on the screen is
  // the easiest thing in the world to type back in. It is one tap away for
  // the times a station genuinely needs it (deciding what it can still
  // sell), and it goes back under cover on the next page load.
  const [showBook, setShowBook] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);

  const stationId = station?.id;
  const book = Number(station?.current_stock_kg) || 0;

  async function loadPending() {
    if (!stationId) return;
    const my = ++seq.current;
    try {
      const rows = await api.getStockResetRequests({ status: "pending", locationId: stationId });
      if (my === seq.current) setPending(rows[0] || null);
    } catch {
      // Left as it was. The database refuses a second count while one waits,
      // so a failed look-up here can never lead to two.
    }
  }
  useEffect(() => { setPending(null); loadPending(); }, [stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!confirmWithdraw) return undefined;
    const id = setTimeout(() => setConfirmWithdraw(false), 4000);
    return () => clearTimeout(id);
  }, [confirmWithdraw]);

  // The last count that actually changed the stock — that is what a count
  // leaves behind, whether it applied itself or HQ approved it.
  const lastCount = adjustments
    .filter((a) => a.location_id === stationId && a.created_at)
    .reduce((latest, a) => (!latest || a.created_at > latest.created_at ? a : latest), null);
  const countedToday = lastCount && dmy(lastCount.created_at) === dmy(new Date().toISOString());

  async function withdrawFromCard() {
    if (!pending) return;
    if (!confirmWithdraw) { setConfirmWithdraw(true); return; }
    setBusy(true); setError("");
    try {
      await api.cancelStockReset(pending.id);
      setPending(null);
      await loadPending();
      onChanged?.();
    } catch (err) {
      setError(err.message || t("sr_error_default"));
    } finally { setBusy(false); setConfirmWithdraw(false); }
  }

  const p = pending ? describeReset({ bookKg: pending.book_kg_at_request, countedKg: pending.counted_kg }) : null;
  const pct = pending?.loss_pct == null ? null : Number(pending.loss_pct);

  return (
    <div className="col-span-2 flex flex-col overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-sm">
      <div className="flex-1 p-3.5 lg:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 lg:h-9 lg:w-9"><Warehouse size={15} /></div>
            <p className="text-[10.5px] font-medium leading-tight text-slate-500 lg:text-xs">{t("dash_current_stock")}</p>
          </div>
          {pending ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10.5px] font-semibold text-amber-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 motion-reduce:animate-none" />
              {t("sr_pending_title")}
            </span>
          ) : countedToday ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-brand-50 px-2.5 py-0.5 text-[10.5px] font-semibold text-brand-700">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />{t("ssc_counted_today")}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-[10.5px] font-semibold text-slate-500">
              {t("ssc_not_counted_today")}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <p className="text-lg font-extrabold tracking-tight text-slate-800 tabular-nums lg:text-2xl">
            {showBook ? <>{fmt2(book)} <span className="text-sm font-medium text-slate-400">kg</span></>
                      : <span className="tracking-[0.2em] text-slate-300">••••</span>}
          </p>
          <button type="button" onClick={() => setShowBook((v) => !v)}
            title={showBook ? t("ssc_hide_book") : t("ssc_show_book")}
            aria-label={showBook ? t("ssc_hide_book") : t("ssc_show_book")}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            {showBook ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {!showBook && <p className="text-[10px] leading-tight text-slate-400">{t("ssc_hidden_hint")}</p>}

        {!pending && (
          <p className="mt-0.5 text-[9.5px] leading-tight text-slate-400 lg:text-[11px]">
            {lastCount ? t("ssc_last_count", { date: dmy(lastCount.created_at) }) : t("ssc_no_count")}
          </p>
        )}

        {pending && p && (
          <div className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold">
              <span className="whitespace-nowrap text-brand-700">✓ {t("ssc_step_sent", { time: timeOnly(pending.requested_at) })}</span>
              <span className="h-0.5 flex-1 rounded bg-amber-200" />
              <span className="whitespace-nowrap text-amber-700">{t("ssc_step_review")}</span>
              <span className="h-0.5 flex-1 rounded bg-amber-200" />
              <span className="whitespace-nowrap text-slate-400">{t("ssc_step_applied")}</span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-600 tabular-nums">
              <span>{t("ssc_weighed")} <b className="block text-sm text-slate-800">{fmt(p.countedKg)} kg</b></span>
              {p.isLoss && <span>{t("sr_missing")} <b className="block text-sm text-rose-600">−{fmt(p.missingKg)} kg</b></span>}
              {p.isGain && <span>{t("sr_extra")} <b className="block text-sm text-brand-700">+{fmt(p.diffKg)} kg</b></span>}
              {pct != null && <span>{t("sc_pct_short")} <b className="block text-sm text-rose-600">{fmt1(pct)}%</b></span>}
            </div>
            <p className="mt-1.5 text-[10.5px] text-amber-700">{t("ssc_pending_note", { kg: fmt(book) })} · {dmyTime(pending.requested_at)}</p>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
      </div>

      {canAsk && (
        <>
          {pending ? (
            <div className="grid grid-cols-2 border-t border-slate-100">
              <button type="button" onClick={() => setViewing(true)}
                className="flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Eye size={14} /></span>
                <span className="text-[12.5px] font-semibold leading-tight text-slate-700">{t("ssc_view")}</span>
              </button>
              <button type="button" onClick={withdrawFromCard} disabled={busy}
                className={`flex items-center gap-2.5 border-l border-slate-100 px-3.5 py-2.5 text-left transition-colors hover:bg-rose-50 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-rose-500 ${confirmWithdraw ? "bg-rose-50" : ""}`}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><X size={14} /></span>
                <span className="text-[12.5px] font-semibold leading-tight text-rose-600">{confirmWithdraw ? t("ssc_withdraw_confirm") : t("sr_withdraw")}</span>
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setOpen(true)}
              className="flex items-center gap-3 border-t border-slate-100 px-3.5 py-3 text-left transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Scale size={17} /></span>
              <span className="min-w-0 text-[13.5px] font-semibold leading-tight text-slate-800">
                {t("sc_open_btn")}
                <span className="block truncate text-[11px] font-normal text-slate-400">{t("sc_open_sub")}</span>
              </span>
            </button>
          )}
          {!pending && (
            <div className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-3.5 py-1.5 text-[10.5px] text-slate-500">
              <Lock size={11} /> {t("ssc_hq_first")}
            </div>
          )}
        </>
      )}

      {viewing && pending && station && (
        <StockResetModal
          station={station}
          priceSuggestion={priceSuggestion}
          pending={pending}
          t={t}
          onClose={() => setViewing(false)}
          onSubmit={() => {}}
          onCancelRequest={async (req) => { await api.cancelStockReset(req.id); setViewing(false); setPending(null); await loadPending(); onChanged?.(); }}
        />
      )}

      {open && station && (
        <StockCountModal
          station={station}
          priceSuggestion={priceSuggestion}
          userId={userId}
          onClose={() => { setOpen(false); loadPending(); onChanged?.(); }}
          onDone={() => { loadPending(); onChanged?.(); }}
        />
      )}
    </div>
  );
}
