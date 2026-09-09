import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, LockOpen, CalendarCheck, AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { getAccurateNow } from "../supabaseClient.js";

// [2026-09-09] Monthly Close — the screen for what used to be two SQL
// commands typed into Supabase.
//
// The rules are NOT reimplemented here. Every button calls the same database
// function the SQL editor calls (period_lock_COMPLETE_2026-09-09.sql), so a
// close made from this panel and one made from SQL behave identically. In
// particular the "you cannot close a month that still has problems" rule
// lives in close_period itself — this screen shows the problems and lets you
// force past them, but it is the database that refuses.
//
// Why it exists: closing a month needed the owner, a computer and the
// Supabase editor. That is the wrong shape for a job that belongs to whoever
// does the books.

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Cambodia time, same as every other date on every other screen.
function cambodiaToday() {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(getAccurateNow()).forEach((p) => { parts[p.type] = p.value; });
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

function pad(n) { return String(n).padStart(2, "0"); }
function firstOf(y, m) { return `${y}-${pad(m)}-01`; }
function lastOf(y, m) { return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; }
function label(y, m) { return `${MONTH_NAMES[m - 1]} ${y}`; }

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "short", year: "numeric" }).format(d);
}

// The last 6 finished months plus the one running now, newest first.
function recentMonths() {
  const { y, m } = cambodiaToday();
  const out = [];
  for (let i = 0; i < 7; i++) {
    let mm = m - i, yy = y;
    while (mm <= 0) { mm += 12; yy -= 1; }
    out.push({ y: yy, m: mm, from: firstOf(yy, mm), to: lastOf(yy, mm), name: label(yy, mm) });
  }
  return out;
}

const PRIORITY_STYLE = {
  "FIX FIRST":   { chip: "bg-rose-100 text-rose-700",   icon: AlertTriangle },
  "HAVE A LOOK": { chip: "bg-amber-100 text-amber-700", icon: AlertTriangle },
  READY:         { chip: "bg-brand-100 text-brand-700", icon: CheckCircle2 },
};

function CheckResults({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {rows.map((r, i) => {
        const style = PRIORITY_STYLE[r.priority] || PRIORITY_STYLE["HAVE A LOOK"];
        const Icon = style.icon;
        return (
          <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${style.chip}`}>
                <Icon size={11} /> {r.priority}
              </span>
              <span className="text-sm font-semibold text-slate-700">{r.check_name}</span>
              {r.found > 0 && <span className="text-xs text-slate-400">{r.found}</span>}
            </div>
            {r.detail && r.detail !== "—" && (
              <p className="mt-1.5 break-words text-xs text-slate-500">{r.detail}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReopenModal({ month, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) { setError("Please say why — it is kept on the record."); return; }
    setBusy(true); setError("");
    try { await onConfirm(reason.trim()); }
    catch (err) { setError(err.message || "Could not reopen."); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold text-slate-700">
            <LockOpen size={16} className="text-amber-500" /> Reopen {month.name}
          </h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500"><X size={16} /></button>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          {month.name} becomes editable again. Everything before it stays closed. Close it again
          once the correction is made.
        </p>
        <form onSubmit={submit}>
          <label className="mb-1 block text-xs text-slate-500">Why is it being reopened? <span className="text-rose-500">*</span></label>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} autoFocus rows={2}
            placeholder="e.g. Correcting the weigh-out on CN 000487"
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
          {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={busy || !reason.trim()} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
              {busy ? "Reopening…" : "Reopen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MonthlyClosePanel() {
  const { profile, isViewOnly } = useAuth();
  const canClose = !!profile?.isOwner && !isViewOnly;

  const months = useMemo(() => recentMonths(), []);
  const today = useMemo(() => cambodiaToday(), []);

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(null);     // month.to being checked
  const [checks, setChecks] = useState({});           // month.to -> rows
  const [closing, setClosing] = useState(null);
  const [reopenFor, setReopenFor] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setStatus(await api.getPeriodStatus());
    } catch (e) {
      setError(
        /current_closed_through|period_locks|does not exist|schema cache/i.test(e?.message || "")
          ? "Monthly close isn't set up in the database yet. Ask your administrator to run period_lock_COMPLETE_2026-09-09.sql."
          : (e?.message || "Could not load the closing status.")
      );
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runCheck(month) {
    setChecking(month.to); setNotice(""); setError("");
    try {
      // Await first, then set — the updater passed to setChecks is not async,
      // so `await` cannot live inside it.
      const rows = await api.getPeriodCheck(month.from, month.to);
      setChecks((prev) => ({ ...prev, [month.to]: rows }));
    } catch (e) {
      setError(e.message || "Could not run the check.");
    } finally { setChecking(null); }
  }

  async function doClose(month, force) {
    setClosing(month.to); setNotice(""); setError("");
    try {
      await api.closePeriod({ through: month.to, reason: `${month.name} closed`, force });
      setNotice(`${month.name} is closed.`);
      setChecks((prev) => ({ ...prev, [month.to]: undefined }));
      await load();
    } catch (e) {
      // close_period's own refusal message is the useful one — it names what
      // is unresolved and how to see the detail. Show it as it is.
      setError(e.message || "Could not close the month.");
    } finally { setClosing(null); }
  }

  async function doReopen(month, reason) {
    // Reopening = moving the line back to the day before this month started.
    const backTo = new Date(Date.UTC(month.y, month.m - 1, 0)).toISOString().slice(0, 10);
    await api.reopenPeriod({ backTo, reason });
    setReopenFor(null);
    setNotice(`${month.name} is open again. Close it once the correction is made.`);
    await load();
  }

  const closedThrough = status?.closedThrough || null;
  const isClosed = (month) => !!closedThrough && month.to <= closedThrough;
  const isRunning = (month) => month.y === today.y && month.m === today.m;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
      <div className="mb-1 flex items-center gap-2">
        <CalendarCheck size={17} className="text-brand-600" />
        <h3 className="font-semibold text-slate-700">Monthly Close</h3>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Closing a month locks its numbers so nothing dated in it can be changed, cancelled or
        backdated. Reading, reports and receipts are unaffected — and so is today's work at every
        station.
      </p>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</div>
      )}
      {notice && (
        <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-xs text-brand-700">{notice}</div>
      )}

      {!loading && status && (
        <>
          <div className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 ${closedThrough ? "border-brand-200 bg-brand-50" : "border-slate-200 bg-slate-50"}`}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${closedThrough ? "bg-brand-600" : "bg-slate-300"}`} />
            <div>
              <p className="text-sm font-semibold text-slate-700">
                {closedThrough ? `Books are closed up to ${fmtDate(closedThrough)}` : "No month has been closed yet"}
              </p>
              <p className="text-[11px] text-slate-500">
                {closedThrough
                  ? "Anything dated after that can still be edited as normal."
                  : "Nothing is locked. Everything can still be edited."}
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {months.map((month) => {
              const closed = isClosed(month);
              const running = isRunning(month);
              const rows = checks[month.to];
              const blocked = Array.isArray(rows) && rows.some((r) => r.priority === "FIX FIRST");
              const ready = Array.isArray(rows) && !blocked;

              return (
                <div key={month.to} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700">{month.name}</span>
                        {closed && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] font-bold text-rose-600">
                            <Lock size={10} /> Closed
                          </span>
                        )}
                        {running && !closed && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500">Still running</span>
                        )}
                      </div>
                      {closed && (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          Locked through {fmtDate(closedThrough)}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!closed && (
                        <button
                          onClick={() => runCheck(month)}
                          disabled={checking === month.to}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {checking === month.to ? <Loader2 size={12} className="animate-spin" /> : null}
                          {checking === month.to ? "Checking…" : rows ? "Check again" : "Check month"}
                        </button>
                      )}

                      {!closed && ready && canClose && (
                        <button
                          onClick={() => doClose(month, false)}
                          disabled={closing === month.to}
                          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          {closing === month.to ? "Closing…" : `Close ${MONTH_NAMES[month.m - 1]}`}
                        </button>
                      )}

                      {!closed && blocked && canClose && (
                        <button
                          onClick={() => doClose(month, true)}
                          disabled={closing === month.to}
                          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          title="The problems above stay on the record next to this close"
                        >
                          {closing === month.to ? "Closing…" : "Close anyway"}
                        </button>
                      )}

                      {closed && canClose && (
                        <button
                          onClick={() => setReopenFor(month)}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          <LockOpen size={12} /> Reopen
                        </button>
                      )}
                    </div>
                  </div>

                  {blocked && (
                    <p className="mt-2 text-[11px] font-medium text-rose-600">
                      Fix these before closing. Closing anyway is allowed, but what you closed over
                      is written into the record.
                    </p>
                  )}
                  <CheckResults rows={rows} />
                </div>
              );
            })}
          </div>

          {status.history?.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Closing history</p>
              <div className="space-y-1.5">
                {status.history.slice(0, 8).map((h) => (
                  <div key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                    <span className="text-slate-600">
                      <span className="font-semibold">{fmtDate(h.closed_through)}</span>
                      <span className="text-slate-400"> — {h.reason}</span>
                    </span>
                    <span className="text-[11px] text-slate-400">{h.userName} · {fmtDate(h.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!canClose && (
            <p className="mt-4 text-[11px] text-slate-400">
              You can see which months are closed. Closing and reopening are owner-only.
            </p>
          )}
        </>
      )}

      {reopenFor && (
        <ReopenModal
          month={reopenFor}
          onClose={() => setReopenFor(null)}
          onConfirm={(reason) => doReopen(reopenFor, reason)}
        />
      )}
    </div>
  );
}
