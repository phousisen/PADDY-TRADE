import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, Lock } from "lucide-react";
import { api } from "../api.js";
import { supabase } from "../supabaseClient.js";
import { dmy, dmyTime, weekdayKey } from "../dateFormat.js";
import { mergeByCategory } from "../expenseBook.js";
import { categoryKey, isCommission } from "../expenseCategories.js";
import { checkCommission } from "../commissionRule.js";
import { summarize, canConfirmDay } from "../expenseReview.js";

// [2026-09-21] EXPENSE CONFIRMATION — the "To confirm" / "My expenses" tab.
//
// SISEN: "i want to let the manager go through it and confirm the expenses
// and all so we know that the expenses is there because 2 people has agreed
// so they can be responsible." And, on the manager's corrections: "how can a
// staff correct the manager's confirm or edit unless they can make a request".
//
// So:
//   · the MANAGER (permission confirm_expenses, or the Owner) reviews each
//     station-day: confirm it, correct a figure and confirm, or send it back;
//     and approves or rejects change requests on days already confirmed;
//   · STAFF see their own days and what happened to them, fix a day that was
//     sent back (or answer that it is right), and — on a confirmed day, which
//     is locked — can only send a change request.
//
// Every rule is also enforced by the database (expense_confirmation.sql); this
// screen only decides what to offer.

const fmt = (n) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));
const riel = (n) => `${fmt(n)} ៛`;
const parseAmount = (text) => {
  const cleaned = String(text ?? "").replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
};

export function fullDate(day, t) {
  // weekdayKey gives "dow_0".."dow_6"; the full names live under xr_wd_*.
  const k = weekdayKey(day);
  return k ? `${t(`xr_wd_${k.slice(4)}`)}, ${dmy(day)}` : dmy(day);
}

const PILL = {
  waiting: "bg-amber-50 text-amber-700",
  confirmed: "bg-brand-50 text-brand-700",
  sent_back: "bg-rose-50 text-rose-700",
  pending: "bg-violet-50 text-violet-700",
  approved: "bg-brand-50 text-brand-700",
  rejected: "bg-rose-50 text-rose-700",
};
const DOT = { waiting: "bg-amber-500", confirmed: "bg-brand-600", sent_back: "bg-rose-600", pending: "bg-violet-500", approved: "bg-brand-600", rejected: "bg-rose-600" };

function Pill({ kind, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${PILL[kind] || "bg-slate-100 text-slate-600"}`}>
      <i className={`h-1.5 w-1.5 rounded-full ${DOT[kind] || "bg-slate-400"}`} />{children}
    </span>
  );
}

function Tile({ tone, label, n, sub, active, onClick }) {
  const rail = tone === "w" ? "before:bg-amber-500" : tone === "c" ? "before:bg-brand-600" : tone === "b" ? "before:bg-rose-600" : "before:bg-violet-500";
  return (
    <button type="button" onClick={onClick}
      className={`relative overflow-hidden rounded-xl border bg-white px-4 py-3 text-left before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${rail} ${
        active ? "border-slate-300 ring-2 ring-slate-100" : "border-slate-200 hover:border-slate-300"}`}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[.07em] text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-800">{n}</p>
      <p className="text-[12px] tabular-nums text-slate-400">{sub}</p>
    </button>
  );
}

async function checkPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
}

export default function ExpenseReview({
  days, requests, loading, canConfirm, canRecord, userId, userEmail, t,
  tonnageByDayLoc, onChanged, onOpenDay, focus, monthFrom, monthTo,
}) {
  const manager = !!canConfirm;
  const [filter, setFilter] = useState(manager ? "waiting" : "all");
  const [openKey, setOpenKey] = useState(null);

  // Opened from somewhere else (a locked day sheet's "Request a change").
  useEffect(() => {
    if (!focus?.key) return;
    setOpenKey(focus.key);
    if (!manager) setFilter("all");
  }, [focus?.key, focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Staff see the days they entered; the manager sees everything.
  const scoped = useMemo(() => (manager ? days : days.filter((d) => d.mine)), [days, manager]);
  const myRequests = useMemo(() => (manager ? requests : requests.filter((r) => r.requested_by === userId)), [requests, manager, userId]);
  const sum = useMemo(() => summarize(scoped, { from: monthFrom, to: monthTo, requests: manager ? requests.filter((r) => r.requested_by !== userId) : myRequests }),
    [scoped, monthFrom, monthTo, requests, myRequests, manager, userId]);

  const shown = useMemo(() => {
    if (filter === "requests") return [];
    let list = scoped;
    if (filter === "waiting") list = list.filter((d) => d.status === "waiting");
    else if (filter === "confirmed") list = list.filter((d) => d.status === "confirmed" && (!monthFrom || d.day >= monthFrom));
    else if (filter === "sent_back") list = list.filter((d) => d.status === "sent_back");
    // Waiting: the oldest first — it has waited longest.
    if (filter === "waiting") list = [...list].reverse();
    return list.slice(0, 200);
  }, [scoped, filter, monthFrom]);

  const filters = manager
    ? [["waiting", t("xr_f_waiting"), sum.waiting.n], ["requests", t("xr_f_requests"), sum.requests.n], ["confirmed", t("xr_f_confirmed"), sum.confirmed.n], ["sent_back", t("xr_f_sent_back"), sum.sentBack.n]]
    : [["all", t("xr_f_all"), scoped.length], ["waiting", t("xr_f_with_manager"), sum.waiting.n], ["confirmed", t("xr_f_confirmed"), sum.confirmed.n], ["sent_back", t("xr_f_sent_back"), sum.sentBack.n], ["requests", t("xr_f_my_requests"), myRequests.filter((r) => r.status === "pending").length]];

  return (
    <div className="grid gap-3.5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile tone="w" active={filter === "waiting"} onClick={() => setFilter("waiting")}
          label={manager ? t("xr_tile_waiting_you") : t("xr_tile_with_manager")} n={sum.waiting.n}
          sub={`${riel(sum.waiting.amount)}${manager && sum.requests.n ? ` · ${t("xr_plus_requests", { n: sum.requests.n })}` : ""}`} />
        <Tile tone="c" active={filter === "confirmed"} onClick={() => setFilter("confirmed")}
          label={t("xr_tile_confirmed_month")} n={sum.confirmed.n} sub={riel(sum.confirmed.amount)} />
        <Tile tone="b" active={filter === "sent_back"} onClick={() => setFilter("sent_back")}
          label={manager ? t("xr_tile_sent_back") : t("xr_tile_sent_back_you")} n={sum.sentBack.n} sub={riel(sum.sentBack.amount)} />
      </div>

      <div className="inline-flex max-w-full flex-wrap self-start rounded-lg border border-slate-200 bg-white p-1">
        {filters.map(([k, label, n]) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${filter === k ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
            {label} <span className="opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {loading && <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" />{t("ex_loading")}</p>}

      {filter === "requests" ? (
        <RequestList requests={manager ? requests : myRequests} manager={manager} userId={userId} userEmail={userEmail} t={t} onChanged={onChanged} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {shown.length === 0 && !loading && (
            <p className="px-5 py-10 text-center text-sm text-slate-400">{t(filter === "waiting" && manager ? "xr_none_waiting" : "xr_none_here")}</p>
          )}
          {shown.map((d) => (
            <DayRow key={d.key} d={d} t={t} manager={manager} canRecord={canRecord} userId={userId} userEmail={userEmail}
              open={openKey === d.key} onToggle={() => setOpenKey(openKey === d.key ? null : d.key)}
              startRequest={focus?.key === d.key && focus?.request}
              tonnage={tonnageByDayLoc?.get(`${d.day}|${d.locationId}`)}
              pendingRequests={requests.filter((r) => r.status === "pending" && r.location_id === d.locationId && String(r.day).slice(0, 10) === d.day)}
              onChanged={onChanged} onOpenDay={onOpenDay} />
          ))}
        </div>
      )}
      <p className="text-[12px] text-slate-400">{t("xr_footer")}</p>
    </div>
  );
}

function whyLine(d, t) {
  if (d.why === "changed") return t("xr_why_changed");
  if (d.why === "fixed") return t("xr_why_fixed");
  if (d.why === "replied") return t("xr_why_replied");
  return null;
}

function DayRow({ d, t, manager, canRecord, userId, userEmail, open, onToggle, startRequest, tonnage, pendingRequests, onChanged, onOpenDay }) {
  const statusLabel = d.status === "confirmed" ? t("xr_s_confirmed") : d.status === "sent_back" ? t("xr_s_sent_back")
    : manager ? t("xr_s_waiting") : t("xr_s_with_manager");
  const why = whyLine(d, t);
  const decided = d.review?.decided_by_name;
  return (
    <div className="border-b border-slate-100 last:border-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-[11rem] flex-1">
          <p className="text-[13.5px] font-semibold text-slate-800">{fullDate(d.day, t)}</p>
          <p className="text-[11.5px] text-slate-400">
            {t("xr_entered_by", { name: d.enteredBy.join(", ") || "—" })}{d.lastAt && <> · {dmyTime(d.lastAt)}</>}
          </p>
          {why && <p className="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11.5px] text-amber-800">{why}</p>}
        </div>
        <span className="rounded-md border border-brand-100 bg-brand-50 px-2 py-0.5 text-[11.5px] font-semibold tracking-wide text-brand-700">{d.stationName}</span>
        <span className="min-w-[7.5rem] text-right text-[13.5px] font-semibold tabular-nums text-slate-800">{riel(d.total)}</span>
        <div className="min-w-[9rem]">
          <Pill kind={d.status}>{statusLabel}</Pill>
          {d.status === "confirmed" && decided && (
            <p className="mt-0.5 text-[11px] text-slate-400">{t("xr_by", { name: decided })}{d.review?.corrected ? ` · ${t("xr_corrected")}` : ""}</p>
          )}
          {pendingRequests.length > 0 && <p className="mt-0.5 text-[11px] font-semibold text-violet-700">{t("xr_n_requests", { n: pendingRequests.length })}</p>}
        </div>
        <button type="button" onClick={onToggle} aria-expanded={open}
          className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold ${open ? "border border-slate-200 text-slate-600" : manager && d.status === "waiting" ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {open ? t("xr_close") : manager && d.status === "waiting" ? t("xr_review") : t("xr_details")}
        </button>
      </div>
      {open && (
        <div className="bg-slate-50/60 px-4 pb-4">
          {manager
            ? <ManagerPanel d={d} t={t} userId={userId} userEmail={userEmail} tonnage={tonnage} onChanged={onChanged} />
            : <StaffPanel d={d} t={t} canRecord={canRecord} tonnage={tonnage} startRequest={startRequest} onChanged={onChanged} onOpenDay={onOpenDay} pendingRequests={pendingRequests} />}
        </div>
      )}
    </div>
  );
}

function Items({ d, t, tonnage, amounts, setAmounts, editable }) {
  const merged = useMemo(() => [...mergeByCategory(d.rows).values()], [d.rows]);
  const commission = merged.filter((m) => isCommission(m.category)).reduce((s, m) => s + m.amount, 0);
  const check = commission > 0 ? checkCommission({ commission, boughtKg: tonnage?.boughtKg, soldKg: tonnage?.soldKg }) : null;
  const total = merged.reduce((s, m) => {
    const v = editable ? parseAmount(amounts?.[m.key]) : m.amount;
    return s + (v == null ? 0 : v);
  }, 0);
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {merged.map((m) => {
          const now = editable ? parseAmount(amounts?.[m.key]) : m.amount;
          const changed = editable && now !== null && Math.round(now) !== Math.round(m.amount);
          const cleared = editable && now === null;
          return (
            <tr key={m.key} className="border-b border-dashed border-slate-200">
              <td className="py-1.5 text-slate-700">
                {m.category}
                {isCommission(m.category) && check && (
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${check.state === "over" ? "bg-rose-50 text-rose-700" : check.state === "at" ? "bg-amber-50 text-amber-700" : "bg-brand-50 text-brand-700"}`}>
                    {check.tonnesBought ? `${check.tonnesBought.toFixed(1)} t · ${fmt(check.perTonne)} ៛/t` : t("ex_kh_unknown")}
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {editable && m.rows.length === 1 ? (
                  <span className="inline-flex items-center gap-2">
                    {(changed || cleared) && <span className="text-[11.5px] text-slate-400 line-through">{fmt(m.amount)}</span>}
                    <input inputMode="numeric" value={amounts?.[m.key] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [m.key]: e.target.value }))}
                      className={`w-28 rounded-md border px-2 py-1 text-right text-[13px] font-semibold tabular-nums outline-none ${changed || cleared ? "border-violet-300 bg-violet-50 text-violet-800" : "border-slate-200 bg-white"}`} />
                  </span>
                ) : (
                  <span className="font-semibold text-slate-800">{riel(m.amount)}</span>
                )}
              </td>
            </tr>
          );
        })}
        <tr>
          <td className="pt-2 font-bold text-slate-800">{t("ex_total")}</td>
          <td className="pt-2 text-right font-bold tabular-nums text-slate-900">{riel(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function ManagerPanel({ d, t, userId, userEmail, tonnage, onChanged }) {
  const merged = useMemo(() => [...mergeByCategory(d.rows).values()], [d.rows]);
  const [amounts, setAmounts] = useState(() => Object.fromEntries(merged.map((m) => [m.key, String(Math.round(m.amount))])));
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const edits = merged.filter((m) => {
    const v = parseAmount(amounts[m.key]);
    return v === null || Math.round(v) !== Math.round(m.amount);
  });
  const correcting = edits.length > 0;
  const allowed = canConfirmDay(d, { canConfirm: true, userId });
  const reasonOk = !correcting || reason.trim().length >= 10;
  const canPress = allowed && checked && password && reasonOk && !busy;

  async function confirm() {
    if (!canPress) return;
    setBusy(true); setError("");
    try {
      if (!(await checkPassword(userEmail, password))) { setError(t("xr_bad_password")); setBusy(false); return; }
      for (const m of edits) {
        const v = parseAmount(amounts[m.key]);
        if (v === null || v === 0) await api.voidPayment(m.rows[0].id, `${t("xr_void_by_manager")}: ${reason.trim()}`);
        else await api.updateExpense(m.rows[0].id, { amount: v, reason: reason.trim(), userId });
      }
      await api.confirmExpenseDay({ locationId: d.locationId, day: d.day, corrected: correcting });
      api.logAudit({
        action: "confirm_expense_day", tableName: "expense_day_reviews", recordId: null,
        oldData: correcting ? { items: edits.map((m) => ({ category: m.category, amount: m.amount })) } : null,
        newData: { stationName: d.stationName, day: d.day, total: d.total, corrected: correcting, reason: correcting ? reason.trim() : null,
          items: correcting ? edits.map((m) => ({ category: m.category, amount: parseAmount(amounts[m.key]) || 0 })) : undefined },
        userId,
      });
      await onChanged();
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  }

  async function sendBack() {
    if (note.trim().length < 5 || busy) return;
    setBusy(true); setError("");
    try {
      await api.sendBackExpenseDay({ locationId: d.locationId, day: d.day, note: note.trim() });
      api.logAudit({ action: "send_back_expense_day", tableName: "expense_day_reviews", recordId: null,
        newData: { stationName: d.stationName, day: d.day, total: d.total, reason: note.trim() }, userId });
      await onChanged();
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-[1.4fr_1fr]">
      <div className="border-b border-slate-200 px-4 py-3 md:border-b-0 md:border-r">
        <Items d={d} t={t} tonnage={tonnage} amounts={amounts} setAmounts={setAmounts} editable={allowed} />
        {merged.some((m) => m.rows.length > 1) && allowed && <p className="mt-2 text-[11.5px] text-slate-400">{t("xr_dupe_hint")}</p>}
        {d.review?.status === "sent_back" && d.review?.note && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{t("xr_your_note")}: “{d.review.note}”</p>}
        {d.review?.reply && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-700">{t("xr_staff_reply")}: “{d.review.reply}”</p>}
      </div>
      <div className="grid content-start gap-2.5 px-4 py-3 text-[12.5px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-slate-400">{t("xr_station")}</dt><dd className="text-slate-800">{d.stationName}</dd>
          <dt className="text-slate-400">{t("xr_date")}</dt><dd className="text-slate-800">{fullDate(d.day, t)}</dd>
          <dt className="text-slate-400">{t("xr_entered")}</dt><dd className="text-slate-800">{d.enteredBy.join(", ") || "—"}</dd>
        </dl>
        {!allowed ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
            {d.status === "confirmed" ? t("xr_already_confirmed") : t("xr_you_entered_it")}
          </p>
        ) : sendingBack ? (
          <>
            <label className="text-slate-600">{t("xr_what_to_fix")}</label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("xr_what_to_fix_ph")}
              className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-rose-300" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSendingBack(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">{t("cancel")}</button>
              <button type="button" onClick={sendBack} disabled={note.trim().length < 5 || busy}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{t("xr_send_back")}</button>
            </div>
          </>
        ) : (
          <>
            {correcting && (
              <>
                <label className="text-violet-800">{t("xr_why_changing")}</label>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("xr_why_changing_ph")}
                  className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2 text-[13px] outline-none" />
                {!reasonOk && <p className="text-[11.5px] text-slate-400">{t("xr_more_chars", { n: 10 - reason.trim().length })}</p>}
              </>
            )}
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {t("xr_checked_receipts")}
            </label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("xr_password")}
              autoComplete="current-password" className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-brand-400" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSendingBack(true)} disabled={busy}
                className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">{t("xr_send_back")}</button>
              <button type="button" onClick={confirm} disabled={!canPress}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 ${correcting ? "bg-violet-700 hover:bg-violet-800" : "bg-brand-600 hover:bg-brand-700"}`}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {correcting ? t("xr_correct_confirm") : t("xr_confirm")}
              </button>
            </div>
          </>
        )}
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">{error}</p>}
      </div>
    </div>
  );
}

function StaffPanel({ d, t, canRecord, tonnage, startRequest, onChanged, onOpenDay, pendingRequests }) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [requesting, setRequesting] = useState(!!startRequest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (startRequest) setRequesting(true); }, [startRequest]);

  async function sendReply() {
    if (reply.trim().length < 5 || busy) return;
    setBusy(true); setError("");
    try {
      await api.resubmitExpenseDay({ locationId: d.locationId, day: d.day, reply: reply.trim() });
      await onChanged();
    } catch (err) { setError(err?.message || String(err)); setBusy(false); }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <Items d={d} t={t} tonnage={tonnage} editable={false} />
      {d.status === "sent_back" && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-900">
          <b>{t("xr_sent_back_by", { name: d.review?.decided_by_name || "—" })}</b> · {dmyTime(d.review?.decided_at)}
          <p className="mt-0.5">“{d.review?.note}”</p>
          {canRecord && !replying && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => onOpenDay(d.day, d.locationId)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">{t("xr_fix_it")}</button>
              <button type="button" onClick={() => setReplying(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">{t("xr_its_right")}</button>
            </div>
          )}
          {replying && (
            <div className="mt-2 grid gap-2">
              <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("xr_reply_ph")}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setReplying(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">{t("cancel")}</button>
                <button type="button" onClick={sendReply} disabled={reply.trim().length < 5 || busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{t("xr_send_reply")}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {d.status === "confirmed" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5 text-[12.5px] text-brand-800">
          <span><Lock size={12} className="mr-1 inline" />{t("xr_locked_line", { name: d.review?.decided_by_name || "—", at: dmyTime(d.review?.decided_at) })}</span>
          {canRecord && !requesting && (
            <button type="button" onClick={() => setRequesting(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">{t("xr_request_change")}</button>
          )}
        </div>
      )}
      {pendingRequests.length > 0 && (
        <p className="text-[12px] font-semibold text-violet-700">{t("xr_n_requests", { n: pendingRequests.length })}</p>
      )}
      {requesting && d.status === "confirmed" && (
        <RequestForm d={d} t={t} onCancel={() => setRequesting(false)} onSent={async () => { setRequesting(false); await onChanged(); }} />
      )}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </div>
  );
}

function RequestForm({ d, t, onCancel, onSent }) {
  const merged = useMemo(() => [...mergeByCategory(d.rows).values()], [d.rows]);
  const [category, setCategory] = useState(merged[0]?.category || "");
  const [custom, setCustom] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cat = category === "__new" ? custom.trim() : category;
  const current = merged.find((m) => categoryKey(m.category) === categoryKey(cat))?.amount || 0;
  const v = parseAmount(amount);
  const ok = cat && v !== null && Math.round(v) !== Math.round(current) && reason.trim().length >= 10 && !busy;

  async function send() {
    if (!ok) return;
    setBusy(true); setError("");
    try {
      await api.requestExpenseChange({ locationId: d.locationId, day: d.day, category: cat, amount: v, reason: reason.trim() });
      await onSent();
    } catch (err) { setError(err?.message || String(err)); setBusy(false); }
  }

  return (
    <div className="grid gap-2 rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-3 text-[12.5px]">
      <p className="font-semibold text-violet-900">{t("xr_request_title")}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px]">
          {merged.map((m) => <option key={m.key} value={m.category}>{m.category}</option>)}
          <option value="__new">{t("xr_other_item")}</option>
        </select>
        {category === "__new" && (
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t("xr_item_name")} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px]" />
        )}
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-slate-400 line-through">{fmt(current)}</span>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("xr_new_amount")}
            className="w-full rounded-lg border border-violet-300 bg-white px-2 py-1.5 text-right text-[13px] font-semibold tabular-nums" />
        </div>
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("xr_request_reason_ph")}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px]" />
      {reason.trim().length > 0 && reason.trim().length < 10 && <p className="text-[11.5px] text-slate-400">{t("xr_more_chars", { n: 10 - reason.trim().length })}</p>}
      <p className="text-[11.5px] text-slate-500">{t("xr_request_note")}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">{t("cancel")}</button>
        <button type="button" onClick={send} disabled={!ok} className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{t("xr_send_request")}</button>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">{error}</p>}
    </div>
  );
}

function RequestList({ requests, manager, userId, userEmail, t, onChanged }) {
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending").slice(0, 30);
  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {pending.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">{t("xr_no_requests")}</p>}
        {pending.map((r) => <RequestRow key={r.id} r={r} t={t} manager={manager} userId={userId} userEmail={userEmail} onChanged={onChanged} />)}
      </div>
      {decided.length > 0 && (
        <>
          <h4 className="text-[11px] font-bold uppercase tracking-[.08em] text-slate-400">{t("xr_decided_requests")}</h4>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {decided.map((r) => <RequestRow key={r.id} r={r} t={t} manager={false} userId={userId} userEmail={userEmail} onChanged={onChanged} />)}
          </div>
        </>
      )}
    </div>
  );
}

function RequestRow({ r, t, manager, userId, userEmail, onChanged }) {
  const [mode, setMode] = useState(null); // "approve" | "reject"
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const day = String(r.day).slice(0, 10);
  const own = r.requested_by === userId;

  async function go() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (mode === "approve" && !(await checkPassword(userEmail, password))) { setError(t("xr_bad_password")); setBusy(false); return; }
      await api.decideExpenseChange({ id: r.id, approve: mode === "approve", note: note.trim() || null });
      api.logAudit({ action: mode === "approve" ? "approve_expense_change" : "reject_expense_change", tableName: "expense_change_requests", recordId: r.id,
        oldData: { category: r.category, amount: r.current_amount }, newData: { category: r.category, amount: r.requested_amount, day, reason: note.trim() || r.reason }, userId });
      await onChanged();
    } catch (err) { setError(err?.message || String(err)); setBusy(false); }
  }

  return (
    <div className="border-b border-slate-100 px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="min-w-[11rem] flex-1">
          <p className="text-[13.5px] font-semibold text-slate-800">{fullDate(day, t)}</p>
          <p className="text-[11.5px] text-slate-400">{t("xr_asked_by", { name: r.requestedByName })} · {dmyTime(r.requested_at)}</p>
        </div>
        <span className="text-[13px] text-slate-700">
          {r.category}: <span className="tabular-nums text-slate-400 line-through">{fmt(r.current_amount)}</span> → <b className="tabular-nums text-violet-800">{riel(r.requested_amount)}</b>
        </span>
        <Pill kind={r.status}>{t(`xr_r_${r.status}`)}</Pill>
        {manager && r.status === "pending" && !own && !mode && (
          <span className="flex gap-2">
            <button type="button" onClick={() => setMode("reject")} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700">{t("xr_reject")}</button>
            <button type="button" onClick={() => setMode("approve")} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">{t("xr_approve")}</button>
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-slate-600">“{r.reason}”</p>
      {r.status !== "pending" && (
        <p className="mt-0.5 text-[11.5px] text-slate-400">{t(r.status === "approved" ? "xr_approved_by" : "xr_rejected_by", { name: r.decidedByName || "—" })} · {dmyTime(r.decided_at)}{r.decision_note ? ` · “${r.decision_note}”` : ""}</p>
      )}
      {mode && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t(mode === "reject" ? "xr_reject_why" : "xr_note_optional")}
            className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px]" />
          {mode === "approve" && (
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("xr_password")}
              className="w-40 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px]" />
          )}
          <button type="button" onClick={() => setMode(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">{t("cancel")}</button>
          <button type="button" onClick={go}
            disabled={busy || (mode === "reject" ? note.trim().length < 5 : !password)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 ${mode === "reject" ? "bg-rose-600" : "bg-brand-600"}`}>
            {mode === "reject" ? t("xr_reject") : t("xr_approve")}
          </button>
        </div>
      )}
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </div>
  );
}
