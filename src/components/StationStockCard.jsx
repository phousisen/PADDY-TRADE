import { useEffect, useRef, useState } from "react";
import { Warehouse, RotateCcw, Scale, Eye, X, Lock } from "lucide-react";
import { api } from "../api.js";
import { describeReset } from "../stockReset.js";
import { dmy, dmyTime } from "../dateFormat.js";
import { StockResetModal } from "./StockResetModal.jsx";

// The station's stock on its own Dashboard, with the two things a station
// does with it at the end of the day.
//
// [2026-09-20] SISEN: "did u build a place for each station to reset the
// stock to 0 or weight the left over stock over night? ... make sure these
// changes they made are not confirmed unless the top confirms or accept it.
// i want them to be able to click on the reset or adjust in the dashboard."
//
// It existed, but only as a small button in a table on the Stock page, where
// nobody at a station looked. This puts it where they land every morning.
// Sample approved 20 Sept (dashboard-stock-pro-sample.html).
//
// NOTHING HERE CHANGES STOCK. Both buttons open StockResetModal, which only
// files a request (request_stock_reset). The stock moves inside
// resolve_stock_reset() when someone at HQ presses Approve in Change
// Requests — and stations_cannot_change_stock.sql makes the database refuse
// any other way for a station account to change it.

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function timeOnly(iso) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch { return ""; }
}

export default function StationStockCard({ station, adjustments = [], priceSuggestion = null, canAsk, userId, t, onChanged }) {
  const [pending, setPending] = useState(null);
  const [modal, setModal] = useState(null);          // null | { initialCount }
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
      // Left as it was. The form still checks, and the database refuses a
      // second request while one is waiting, so a failed look-up here can
      // never lead to two.
    }
  }
  useEffect(() => { setPending(null); loadPending(); }, [stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!confirmWithdraw) return undefined;
    const id = setTimeout(() => setConfirmWithdraw(false), 4000);
    return () => clearTimeout(id);
  }, [confirmWithdraw]);

  // The last count HQ approved (or HQ entered) for this station.
  const lastCount = adjustments
    .filter((a) => a.location_id === stationId && a.created_at)
    .reduce((latest, a) => (!latest || a.created_at > latest.created_at ? a : latest), null);

  async function submit({ countedKg, reason, note, pricePerKg }) {
    await api.requestStockReset({ locationId: stationId, countedKg, reason, note, pricePerKg });
    await api.logAudit({
      action: "request_stock_reset",
      tableName: "stock_reset_requests",
      recordId: stationId,
      oldData: { current_stock_kg: book },
      newData: { counted_kg: countedKg, reason, note, stationName: station.name, from: "dashboard" },
      userId,
    }).catch(() => {});
    setModal(null);
    await loadPending();
    onChanged?.();
  }

  async function withdraw(req) {
    await api.cancelStockReset(req.id);
    setModal(null);
    setPending(null);
    await loadPending();
    onChanged?.();
  }

  async function withdrawFromCard() {
    if (!pending) return;
    if (!confirmWithdraw) { setConfirmWithdraw(true); return; }
    setBusy(true); setError("");
    try { await withdraw(pending); }
    catch (err) { setError(err.message || t("sr_error_default")); }
    finally { setBusy(false); setConfirmWithdraw(false); }
  }

  const p = pending ? describeReset({ bookKg: pending.book_kg_at_request, countedKg: pending.counted_kg }) : null;

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
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-brand-50 px-2.5 py-0.5 text-[10.5px] font-semibold text-brand-700">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              {station?.name}
            </span>
          )}
        </div>

        <p className="mt-2 text-lg font-extrabold tracking-tight text-slate-800 tabular-nums lg:text-2xl">
          {fmt2(book)} <span className="text-sm font-medium text-slate-400">kg</span>
        </p>

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
            </div>
            <p className="mt-1.5 text-[10.5px] text-amber-700">{t("ssc_pending_note", { kg: fmt(book) })} · {dmyTime(pending.requested_at)}</p>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
      </div>

      {canAsk && (
        <>
          <div className="grid grid-cols-2 border-t border-slate-100">
            {pending ? (
              <>
                <button type="button" onClick={() => setModal({ initialCount: "" })}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Eye size={14} /></span>
                  <span className="text-[12.5px] font-semibold leading-tight text-slate-700">{t("ssc_view")}</span>
                </button>
                <button type="button" onClick={withdrawFromCard} disabled={busy}
                  className={`flex items-center gap-2.5 border-l border-slate-100 px-3.5 py-2.5 text-left transition-colors hover:bg-rose-50 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-rose-500 ${confirmWithdraw ? "bg-rose-50" : ""}`}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><X size={14} /></span>
                  <span className="text-[12.5px] font-semibold leading-tight text-rose-600">{confirmWithdraw ? t("ssc_withdraw_confirm") : t("sr_withdraw")}</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setModal({ initialCount: "0" })}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-rose-500">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><RotateCcw size={14} /></span>
                  <span className="text-[12.5px] font-semibold leading-tight text-slate-700">
                    {t("ssc_reset0")}
                    <span className="block text-[10.5px] font-normal text-slate-400">{t("ssc_reset0_sub")}</span>
                  </span>
                </button>
                <button type="button" onClick={() => setModal({ initialCount: "" })}
                  className="flex items-center gap-2.5 border-l border-slate-100 px-3.5 py-2.5 text-left transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Scale size={14} /></span>
                  <span className="text-[12.5px] font-semibold leading-tight text-slate-700">
                    {t("ssc_weigh")}
                    <span className="block text-[10.5px] font-normal text-slate-400">{t("ssc_weigh_sub")}</span>
                  </span>
                </button>
              </>
            )}
          </div>
          {!pending && (
            <div className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-3.5 py-1.5 text-[10.5px] text-slate-500">
              <Lock size={11} /> {t("ssc_hq_first")}
            </div>
          )}
        </>
      )}

      {modal && station && (
        <StockResetModal
          station={station}
          priceSuggestion={priceSuggestion}
          pending={pending}
          initialCount={modal.initialCount}
          t={t}
          onClose={() => setModal(null)}
          onSubmit={submit}
          onCancelRequest={withdraw}
        />
      )}
    </div>
  );
}
