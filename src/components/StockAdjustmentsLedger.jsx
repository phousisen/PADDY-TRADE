import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, TrendingDown, TrendingUp, Undo2, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { supabase, getAccurateNow } from "../supabaseClient.js";
import { cambodiaDateStr, effectiveAdjDateStr } from "../dailyLedger.js";
import { dmy } from "../dateFormat.js";

// THE STOCK LEDGER — every change to a station's stock that is not a ticket.
//
// [2026-09-21] SISEN: "i noticed we dont have anywhere to track data on reset
// of gained, u only build the loss, but tis so unorganized". The page had a
// Stock Loss Log and nothing else: a station that found 760 kg more than the
// book (rain, a buyer's heavier scale) had that recorded but shown nowhere,
// so every station looked as if it only ever lost.
//
// One list now: losses, gains and reversals, with the four totals that
// actually describe a month — Lost, Gained, Reversed and Net — and Net as a
// percentage of the paddy bought, which is the only way to tell drying from
// something worse.
//
// And the Owner can UNDO a wrong reset from here (stock_reversal.sql): a
// reason of at least 15 characters, their own password, and a plain warning
// of what will happen. Nothing is deleted — the original stays, crossed out,
// with who undid it and why.

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmt1(n) { return (Math.round((n || 0) * 10) / 10).toFixed(1); }
const num = (v) => Number(v) || 0;
const MIN_REASON = 15;
const UNDO_DAYS = 14;

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** What one row is, for the tag, the colour and the totals. */
function kindOf(a) {
  if (a.reverses_adjustment_id) return "rev";
  if (a.reversed_at) return "gone";
  return num(a.adjustment_kg) < 0 ? "loss" : "gain";
}
/** A Settle from the Dashboard: marked since 21/09, and recognisable before
 *  that by the note the database writes on a back-dated correction. */
function isSettle(a) {
  const n = String(a.note || "");
  return /^Settle\b/.test(n) || /counted against/i.test(n);
}
/** Riel for one row: the recorded loss value when there is one, else kg × price. */
function valueOf(a) {
  const kg = num(a.adjustment_kg);
  if (kg < 0 && a.value_lost != null) return -num(a.value_lost);
  if (a.price_per_kg == null) return null;
  return Math.round(kg * num(a.price_per_kg));
}

export default function StockAdjustmentsLedger({ txs = [], stations = [], isOwner, isViewOnly, userEmail, userId, t, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("month");    // month | last | all
  const [kind, setKind] = useState("all");          // all | loss | gain | rev
  const [undo, setUndo] = useState(null);           // the row being undone
  const seq = useRef(0);

  const today = cambodiaDateStr(getAccurateNow());
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const range = period === "month" ? [monthStart, today] : period === "last" ? [lastMonthStart, lastMonthEnd] : [null, null];

  async function load() {
    const my = ++seq.current;
    setLoading(true); setError("");
    try {
      // One day either side, then dated by the shared after-midnight rule —
      // the same way every other stock screen dates a count.
      const v = await api.getStockAdjustments({
        includeReversed: true,
        startDate: range[0] ? addDays(range[0], -1) : undefined,
        endDate: range[1] ? addDays(range[1], 1) : undefined,
      });
      if (my === seq.current) setRows(v);
    } catch (err) {
      if (my === seq.current) setError(err.message || t("sl_err_load"));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }
  useEffect(() => { load(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const inRange = useMemo(() => rows.filter((a) => {
    if (!a.created_at) return false;
    const d = effectiveAdjDateStr(a);
    return (!range[0] || d >= range[0]) && (!range[1] || d <= range[1]);
  }), [rows, range[0], range[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // Who undid what: the reversal row is written by the Owner, so its
  // adjusted_by is the name to show on the original it crossed out.
  const reverserOf = useMemo(() => {
    const m = {};
    for (const a of rows) if (a.reverses_adjustment_id) m[a.reverses_adjustment_id] = a;
    return m;
  }, [rows]);

  const totals = useMemo(() => {
    const out = { lostKg: 0, lostRiel: 0, lostN: 0, gainKg: 0, gainRiel: 0, gainN: 0, revKg: 0, revN: 0 };
    for (const a of inRange) {
      const k = kindOf(a), kg = num(a.adjustment_kg), v = valueOf(a);
      if (k === "loss") { out.lostKg += -kg; out.lostRiel += v != null ? -v : 0; out.lostN += 1; }
      else if (k === "gain") { out.gainKg += kg; out.gainRiel += v != null ? v : 0; out.gainN += 1; }
      else if (k === "rev") { out.revKg += Math.abs(kg); out.revN += 1; }
      // "gone" (an undone original) is in no total: with its reversal it is
      // as if it never happened, which is the whole point of undoing it.
    }
    return out;
  }, [inRange]);

  // Paddy bought in the same window, at the stations this page can see.
  const boughtKg = useMemo(() => {
    const seen = new Set(stations.map((s) => s.id));
    return txs.reduce((s, tx) => {
      if (tx.type !== "BUY" || (tx.hq_status || "processing") === "cancelled") return s;
      if (seen.size && !seen.has(tx.location_id)) return s;
      const d = String(tx.tx_date || "").slice(0, 10);
      if ((range[0] && d < range[0]) || (range[1] && d > range[1])) return s;
      return s + num(tx.quantity_kg);
    }, 0);
  }, [txs, stations, range[0], range[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const netKg = totals.gainKg - totals.lostKg;
  const netPct = boughtKg > 0 ? (Math.abs(Math.min(0, netKg)) / boughtKg) * 100 : null;

  const shown = inRange.filter((a) => {
    const k = kindOf(a);
    if (kind === "all") return true;
    if (kind === "loss") return k === "loss" || (k === "gone" && num(a.adjustment_kg) < 0);
    if (kind === "gain") return k === "gain" || (k === "gone" && num(a.adjustment_kg) > 0);
    return k === "rev" || k === "gone";
  });
  const count = (k) => inRange.filter((a) => {
    const x = kindOf(a);
    if (k === "loss") return x === "loss";
    if (k === "gain") return x === "gain";
    if (k === "rev") return x === "rev";
    return true;
  }).length;

  const canUndo = (a) => {
    if (!isOwner || isViewOnly) return false;
    if (kindOf(a) !== "loss" && kindOf(a) !== "gain") return false;
    if (num(a.adjustment_kg) === 0) return false;
    return effectiveAdjDateStr(a) >= addDays(today, -UNDO_DAYS);
  };

  const tagFor = (a) => {
    const k = kindOf(a);
    if (k !== "rev" && isSettle(a)) return <span className="inline-flex whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11.5px] font-semibold text-blue-700">{t("sl_tag_settle")}</span>;
    if (k === "rev") return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11.5px] font-semibold text-violet-700"><Undo2 size={11} /> {t("sl_tag_rev")}</span>;
    if (num(a.adjustment_kg) < 0) {
      return a.reason === "reset"
        ? <span className="inline-flex whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-slate-600">{t("sl_tag_reset")}</span>
        : <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11.5px] font-semibold text-rose-700"><TrendingDown size={11} /> {t("sl_tag_loss")}</span>;
    }
    return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11.5px] font-semibold text-brand-700"><TrendingUp size={11} /> {t("sl_tag_gain")}</span>;
  };

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-slate-700"><RotateCcw size={16} className="text-brand-600" /> {t("sl_title")}</h3>
          <p className="mt-0.5 text-xs text-slate-400">{t("sl_subtitle")}</p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {[["month", t("sl_this_month")], ["last", t("sl_last_month")], ["all", t("sl_all_time")]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${period === k ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 border-b border-slate-100 lg:grid-cols-4">
        <div className="px-5 py-3.5">
          <p className="text-[11px] text-slate-400">{t("sl_lost")}</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-rose-600">−{fmt(totals.lostKg)} kg</p>
          <p className="text-[11px] tabular-nums text-slate-400">{fmt(totals.lostRiel)} ៛ · {t("sl_times", { n: totals.lostN })}</p>
        </div>
        <div className="border-l border-slate-100 px-5 py-3.5">
          <p className="text-[11px] text-slate-400">{t("sl_gained")}</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-brand-700">+{fmt(totals.gainKg)} kg</p>
          <p className="text-[11px] tabular-nums text-slate-400">{fmt(totals.gainRiel)} ៛ · {t("sl_times", { n: totals.gainN })}</p>
        </div>
        <div className="border-t border-slate-100 px-5 py-3.5 lg:border-l lg:border-t-0">
          <p className="text-[11px] text-slate-400">{t("sl_reversed")}</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-violet-700">{fmt(totals.revKg)} kg</p>
          <p className="text-[11px] tabular-nums text-slate-400">{t("sl_times", { n: totals.revN })}</p>
        </div>
        <div className="border-l border-t border-slate-100 px-5 py-3.5 lg:border-t-0">
          <p className="text-[11px] text-slate-400">{t("sl_net")}</p>
          <p className={`mt-0.5 text-lg font-bold tabular-nums ${netKg < 0 ? "text-slate-800" : "text-brand-700"}`}>{netKg >= 0 ? "+" : "−"}{fmt(Math.abs(netKg))} kg</p>
          <p className="text-[11px] tabular-nums text-slate-400">{netPct == null ? t("sl_no_buys") : t("sl_net_pct", { pct: fmt1(netPct), kg: fmt(boughtKg) })}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
        <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-1">
          {[["all", t("sl_f_all"), inRange.length], ["loss", t("sl_f_loss"), count("loss")], ["gain", t("sl_f_gain"), count("gain")], ["rev", t("sl_f_rev"), count("rev")]].map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${kind === k ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              {label} <span className="opacity-70">{n}</span>
            </button>
          ))}
        </div>
        {isOwner && !isViewOnly && <p className="text-[11.5px] text-slate-400">{t("sl_undo_hint", { days: UNDO_DAYS })}</p>}
      </div>

      {error && <p className="mx-5 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50/70 text-left text-xs text-slate-400">
              <th className="px-5 py-2 font-medium">{t("col_date")}</th>
              <th className="px-5 py-2 font-medium">{t("station")}</th>
              <th className="px-5 py-2 font-medium">{t("sl_col_type")}</th>
              <th className="px-5 py-2 text-right font-medium">{t("sl_col_kg")}</th>
              <th className="px-5 py-2 text-right font-medium">{t("col_price_used")}</th>
              <th className="px-5 py-2 text-right font-medium">{t("sl_col_value")}</th>
              <th className="px-5 py-2 font-medium">{t("sl_col_who")}</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => {
              const k = kindOf(a), kg = num(a.adjustment_kg), v = valueOf(a);
              const gone = k === "gone";
              const by = gone ? reverserOf[a.id] : null;
              const kgCls = gone ? "text-slate-400 line-through" : k === "rev" ? "text-violet-700" : kg < 0 ? "text-rose-600" : "text-brand-700";
              return (
                <tr key={a.id} className={`border-b border-slate-50 last:border-0 ${gone ? "bg-slate-50/40" : "hover:bg-slate-50/60"}`}>
                  <td className={`whitespace-nowrap px-5 py-3 ${gone ? "text-slate-400" : "text-slate-500"}`}>{dmy(effectiveAdjDateStr(a))}</td>
                  <td className={`whitespace-nowrap px-5 py-3 font-medium ${gone ? "text-slate-400" : "text-slate-700"}`}>{a.stationName}</td>
                  <td className="px-5 py-3">{tagFor(a)}</td>
                  <td className={`whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums ${kgCls}`}>{kg > 0 ? "+" : "−"}{fmt(Math.abs(kg))} kg</td>
                  <td className={`whitespace-nowrap px-5 py-3 text-right tabular-nums ${gone ? "text-slate-400" : "text-slate-600"}`}>{a.price_per_kg != null ? fmt(a.price_per_kg) : "—"}</td>
                  <td className={`whitespace-nowrap px-5 py-3 text-right tabular-nums ${kgCls}`}>{v == null ? <span className="text-slate-300 no-underline">—</span> : `${v > 0 ? "+" : "−"}${fmt(Math.abs(v))}`}</td>
                  <td className="px-5 py-3">
                    <span className={gone ? "text-slate-400" : "text-slate-600"}>{a.adjustedByName}</span>
                    <span className="block max-w-[26rem] text-xs text-slate-400">
                      {gone
                        ? <span className="text-violet-700">{t("sl_undone_by", { date: dmy(a.reversed_at), name: by?.adjustedByName || "—" })}{a.reversal_reason ? ` — “${a.reversal_reason}”` : ""}</span>
                        : a.note || ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    {canUndo(a) && (
                      <button type="button" onClick={() => setUndo(a)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700">
                        {t("sl_undo_btn")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {loading && shown.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">{t("loading_label")}</td></tr>}
            {!loading && shown.length === 0 && !error && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">{t("sl_empty")}</td></tr>}
          </tbody>
        </table>
      </div>

      {undo && (
        <UndoModal
          row={undo}
          station={stations.find((s) => s.id === undo.location_id) || null}
          userEmail={userEmail}
          userId={userId}
          t={t}
          onClose={() => setUndo(null)}
          onDone={() => { setUndo(null); load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

function UndoModal({ row, station, userEmail, userId, t, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kg = num(row.adjustment_kg);
  const v = valueOf(row);
  const nowKg = station ? num(station.current_stock_kg) : null;
  const afterKg = nowKg == null ? null : nowKg - kg;
  // [2026-09-21] An undo that would leave the station below zero is almost
  // always the wrong one — typically a Settle, which exists precisely to
  // clear a negative. It is not forbidden, but it has to be meant.
  const goesNegative = afterKg != null && afterKg < -0.005;
  const [accepted, setAccepted] = useState(false);
  const short = Math.max(0, MIN_REASON - reason.trim().length);
  const missing = [
    short > 0 && t("sl_need_reason", { n: short }),
    !password && t("sl_need_password"),
    goesNegative && !accepted && t("sl_need_tick"),
  ].filter(Boolean);
  const ok = missing.length === 0 && !busy;

  async function go() {
    if (!ok) return;
    setBusy(true); setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: userEmail, password });
      if (authError) { setError(t("cr_sc_bad_password")); setBusy(false); return; }
      const newId = await api.reverseStockAdjustment(row.id, reason.trim());
      await api.logAudit({
        action: "reverse_stock_adjustment",
        tableName: "stock_adjustments",
        recordId: row.id,
        oldData: { adjustment_kg: kg, stationName: row.stationName, date: effectiveAdjDateStr(row) },
        newData: { reversal_id: newId, reason: reason.trim() },
        userId,
      }).catch(() => {});
      onDone();
    } catch (err) {
      setError(err.message || t("sr_error_default"));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="flex items-center gap-2 font-semibold text-slate-800"><Undo2 size={16} className="text-violet-600" /> {t("sl_undo_title")}</h3>
          <p className="mt-0.5 text-xs text-slate-400">{row.stationName} · {dmy(effectiveAdjDateStr(row))}</p>
        </div>
        <div className="px-5 py-4">
          <div className="overflow-hidden rounded-xl border border-slate-200 text-sm tabular-nums">
            <div className="flex justify-between px-3.5 py-2.5">
              <span className="text-slate-500">{t("sl_undo_orig")}</span>
              <b className={kg < 0 ? "text-rose-600" : "text-brand-700"}>{kg > 0 ? "+" : "−"}{fmt(Math.abs(kg))} kg{v != null ? ` · ${v > 0 ? "+" : "−"}${fmt(Math.abs(v))} ៛` : ""}</b>
            </div>
            {nowKg != null && (
              <>
                <div className="flex justify-between border-t border-slate-100 px-3.5 py-2.5">
                  <span className="text-slate-500">{t("sl_undo_now")}</span><b className="text-slate-700">{fmt(nowKg)} kg</b>
                </div>
                <div className={`flex justify-between border-t border-slate-100 px-3.5 py-2.5 ${goesNegative ? "bg-rose-50" : "bg-violet-50"}`}>
                  <span className={`font-semibold ${goesNegative ? "text-rose-700" : "text-violet-700"}`}>{t("sl_undo_after")}</span>
                  <b className={goesNegative ? "text-rose-700" : "text-violet-700"}>{afterKg < 0 ? "−" : ""}{fmt(Math.abs(afterKg))} kg</b>
                </div>
              </>
            )}
          </div>

          <div className="mt-3 flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{t("sl_undo_warning")}</span>
          </div>

          {goesNegative && (
            <>
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-rose-800">
                <b className="block">{t("sl_neg_title", { kg: fmt(Math.abs(afterKg)) })}</b>
                {isSettle(row) ? t("sl_neg_settle") : t("sl_neg_body")}
              </div>
              <button type="button" onClick={() => setAccepted((v) => !v)}
                className="mt-2.5 flex w-full items-start gap-2.5 text-left text-[12.5px] leading-relaxed text-rose-800">
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${accepted ? "border-rose-600 bg-rose-600 text-white" : "border-rose-400 bg-white"}`}>{accepted ? "✓" : ""}</span>
                <span>{t("sl_neg_tick", { kg: fmt(Math.abs(afterKg)) })}</span>
              </button>
            </>
          )}

          <label className="mb-1.5 mt-4 block text-xs font-medium text-slate-500" htmlFor="undo-why">{t("sl_undo_reason", { n: MIN_REASON })}</label>
          <textarea id="undo-why" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={t("sl_undo_reason_ph")}
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
          <div className="mt-1 flex items-center justify-between text-[11.5px]">
            {short > 0
              ? <span className="font-semibold text-rose-600">{reason.trim().length === 0 ? t("sl_reason_empty", { n: MIN_REASON }) : t("sl_need_reason", { n: short })}</span>
              : <span className="font-semibold text-brand-700">✓</span>}
            <span className={short > 0 ? "text-slate-400" : "text-brand-700"}>{reason.trim().length} / {MIN_REASON}</span>
          </div>

          <label className="mb-1.5 mt-2 block text-xs font-medium text-slate-500" htmlFor="undo-pw">{t("cr_sc_password")}</label>
          <input id="undo-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="off" name="undo-own-password-not-autofillable"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          {missing.length > 0 && <span className="mr-auto text-[11.5px] text-slate-500">{t("sl_still_needed")} {missing.join(" · ")}</span>}
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">{t("cancel")}</button>
          <button type="button" onClick={go} disabled={!ok}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40">
            {busy ? t("saving_label") : t("sl_undo_confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
