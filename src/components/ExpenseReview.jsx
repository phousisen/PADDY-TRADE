import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, Lock, Pencil } from "lucide-react";
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

// [2026-09-22] SISEN, on the first version of the manager's screen: "so
// unprofessional. seems very messy". A green button on every one of 93 rows,
// a typing box on every figure, the station and date repeated in a side
// panel, and the carrying-fee check squeezed into a chip beside the amount.
// Now: one summary strip, one table grouped by month, figures shown as text
// until "Correct a figure" is pressed, a warning as one sentence above the
// items, and one action bar — "Confirm & next" opens the next day by itself.

function Summary({ cells }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-4">
      {cells.map((c) => (
        <button key={c.key} type="button" onClick={c.onClick}
          className={`border-b border-r border-slate-100 px-4 py-3 text-left hover:bg-slate-50 lg:border-b-0 ${c.active ? "bg-slate-50" : ""}`}>
          <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[.07em] text-slate-500">
            <i className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />{c.label}
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums text-slate-800">{c.n}</span>
            {c.sub != null && <span className="text-[12.5px] tabular-nums text-slate-400">{c.sub}</span>}
          </p>
        </button>
      ))}
    </div>
  );
}

async function checkPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
}

// Columns of the day table (sm and up). On a phone each row stacks.
const COLS = "sm:grid sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.3fr)_3.5rem_minmax(0,1fr)_8.5rem_1.25rem] sm:items-center sm:gap-4";

export default function ExpenseReview({
  days, requests, loading, canConfirm, canRecord, userId, userEmail, t,
  tonnageByDayLoc, onChanged, onOpenDay, focus, monthFrom, monthTo,
}) {
  const manager = !!canConfirm;
  const [filter, setFilter] = useState(manager ? "waiting" : "all");
  const [station, setStation] = useState("");
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

  const stations = useMemo(() => {
    const m = new Map();
    for (const d of scoped) m.set(d.locationId, d.stationName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [scoped]);

  const shown = useMemo(() => {
    if (filter === "requests") return [];
    let list = station ? scoped.filter((d) => d.locationId === station) : scoped;
    if (filter === "waiting") list = list.filter((d) => d.status === "waiting");
    else if (filter === "confirmed") list = list.filter((d) => d.status === "confirmed" && (!monthFrom || d.day >= monthFrom));
    else if (filter === "sent_back") list = list.filter((d) => d.status === "sent_back");
    // Waiting: the oldest first — it has waited longest.
    if (filter === "waiting") list = [...list].reverse();
    return list.slice(0, 200);
  }, [scoped, filter, monthFrom, station]);

  // Grouped by month, in the order shown.
  const groups = useMemo(() => {
    const out = [];
    for (const d of shown) {
      const ym = d.day.slice(0, 7);
      let g = out[out.length - 1];
      if (!g || g.ym !== ym) { g = { ym, days: [], total: 0 }; out.push(g); }
      g.days.push(d);
      g.total += d.total;
    }
    return out;
  }, [shown]);

  const filters = manager
    ? [["waiting", t("xr_f_waiting"), sum.waiting.n], ["requests", t("xr_f_requests"), sum.requests.n], ["confirmed", t("xr_f_confirmed"), sum.confirmed.n], ["sent_back", t("xr_f_sent_back"), sum.sentBack.n]]
    : [["all", t("xr_f_all"), scoped.length], ["waiting", t("xr_f_with_manager"), sum.waiting.n], ["confirmed", t("xr_f_confirmed"), sum.confirmed.n], ["sent_back", t("xr_f_sent_back"), sum.sentBack.n], ["requests", t("xr_f_my_requests"), myRequests.filter((r) => r.status === "pending").length]];

  const cells = [
    { key: "waiting", dot: "bg-amber-500", label: manager ? t("xr_tile_waiting_you") : t("xr_tile_with_manager"), n: sum.waiting.n, sub: riel(sum.waiting.amount), onClick: () => setFilter("waiting"), active: filter === "waiting" },
    { key: "confirmed", dot: "bg-brand-600", label: t("xr_tile_confirmed_month"), n: sum.confirmed.n, sub: riel(sum.confirmed.amount), onClick: () => setFilter("confirmed"), active: filter === "confirmed" },
    { key: "sent_back", dot: "bg-rose-600", label: manager ? t("xr_tile_sent_back") : t("xr_tile_sent_back_you"), n: sum.sentBack.n, sub: riel(sum.sentBack.amount), onClick: () => setFilter("sent_back"), active: filter === "sent_back" },
    { key: "requests", dot: "bg-violet-500", label: t("xr_f_requests"), n: manager ? sum.requests.n : myRequests.filter((r) => r.status === "pending").length, sub: null, onClick: () => setFilter("requests"), active: filter === "requests" },
  ];

  const keys = shown.map((d) => d.key);
  const nextAfter = (key) => { const i = keys.indexOf(key); return i >= 0 && i + 1 < keys.length ? keys[i + 1] : null; };

  return (
    <div className="grid gap-3.5">
      <Summary cells={cells} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex max-w-full flex-wrap rounded-lg border border-slate-200 bg-white p-1">
          {filters.map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${filter === k ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              {label} <span className="opacity-70">{n}</span>
            </button>
          ))}
        </div>
        {filter !== "requests" && stations.length > 1 && (
          <select value={station} onChange={(e) => setStation(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 outline-none">
            <option value="">{t("all_locations")}</option>
            {stations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>

      {loading && <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" />{t("ex_loading")}</p>}

      {filter === "requests" ? (
        <RequestList requests={manager ? requests : myRequests} manager={manager} userId={userId} userEmail={userEmail} t={t} onChanged={onChanged} />
      ) : shown.length === 0 && !loading ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-400">{t(filter === "waiting" && manager ? "xr_none_waiting" : "xr_none_here")}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className={`hidden border-b border-slate-100 px-5 py-2 text-[10.5px] font-semibold uppercase tracking-[.07em] text-slate-400 ${COLS}`}>
            <span>{t("xr_col_day")}</span><span>{t("xr_station")}</span><span>{t("xr_entered")}</span>
            <span className="text-right">{t("xr_col_items")}</span><span className="text-right">{t("xr_col_amount")}</span><span>{t("xr_col_status")}</span><span />
          </div>
          {groups.map((g) => (
            <div key={g.ym}>
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-[.07em] text-slate-500">
                <span>{t(`mon_${Number(g.ym.slice(5, 7))}`)} {g.ym.slice(0, 4)} · {t("xr_n_days", { n: g.days.length })}</span>
                <span className="tabular-nums">{riel(g.total)}</span>
              </div>
              {g.days.map((d) => (
                <DayRow key={d.key} d={d} t={t} manager={manager} canRecord={canRecord} userId={userId} userEmail={userEmail}
                  open={openKey === d.key} onToggle={() => setOpenKey(openKey === d.key ? null : d.key)}
                  onDone={() => setOpenKey(nextAfter(d.key))}
                  startRequest={focus?.key === d.key && focus?.request}
                  tonnage={tonnageByDayLoc?.get(`${d.day}|${d.locationId}`)}
                  pendingRequests={requests.filter((r) => r.status === "pending" && r.location_id === d.locationId && String(r.day).slice(0, 10) === d.day)}
                  onChanged={onChanged} onOpenDay={onOpenDay} />
              ))}
            </div>
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

const shortName = (s) => String(s || "").replace(/@.*$/, "");

function DayRow({ d, t, manager, canRecord, userId, userEmail, open, onToggle, onDone, startRequest, tonnage, pendingRequests, onChanged, onOpenDay }) {
  const statusLabel = d.status === "confirmed" ? t("xr_s_confirmed") : d.status === "sent_back" ? t("xr_s_sent_back")
    : manager ? t("xr_s_waiting") : t("xr_s_with_manager");
  const why = whyLine(d, t);
  const decided = d.review?.decided_by_name;
  const k = weekdayKey(d.day);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left hover:bg-slate-50 ${open ? "bg-slate-50" : ""} ${COLS}`}>
        <span className="min-w-0">
          <b className="text-[13.5px] font-semibold text-slate-800">{dmy(d.day)}</b>
          {k && <span className="ml-1.5 text-[12px] text-slate-400">{t(`xr_wd_${k.slice(4)}`)}</span>}
          {why && <span className="mt-0.5 block text-[11.5px] text-amber-700">{why}</span>}
        </span>
        <span className="min-w-0"><span className="rounded-md border border-brand-100 bg-brand-50 px-2 py-0.5 text-[11.5px] font-semibold text-brand-700">{d.stationName}</span></span>
        <span className="min-w-0 truncate text-[12.5px] text-slate-500">
          {d.enteredBy.map(shortName).join(", ") || "—"}{d.lastAt && <> · {dmyTime(d.lastAt).slice(0, 5)} {dmyTime(d.lastAt).slice(-5)}</>}
        </span>
        <span className="hidden text-right text-[12.5px] tabular-nums text-slate-500 sm:block">{d.rows.length}</span>
        <span className="ml-auto text-right text-[13.5px] font-semibold tabular-nums text-slate-800 sm:ml-0">{riel(d.total)}</span>
        <span className="min-w-0">
          <Pill kind={d.status}>{statusLabel}</Pill>
          {d.status === "confirmed" && decided && (
            <span className="mt-0.5 block truncate text-[11px] text-slate-400">{t("xr_by", { name: decided })}{d.review?.corrected ? ` · ${t("xr_corrected")}` : ""}</span>
          )}
          {pendingRequests.length > 0 && <span className="mt-0.5 block text-[11px] font-semibold text-violet-700">{t("xr_n_requests", { n: pendingRequests.length })}</span>}
        </span>
        <span className="hidden text-slate-400 sm:block">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
      </button>
      {open && (
        <div className="bg-slate-50 px-3 pb-4 sm:px-5">
          {manager
            ? <ManagerPanel d={d} t={t} userId={userId} userEmail={userEmail} tonnage={tonnage} onChanged={onChanged} onDone={onDone} />
            : <StaffPanel d={d} t={t} canRecord={canRecord} tonnage={tonnage} startRequest={startRequest} onChanged={onChanged} onOpenDay={onOpenDay} pendingRequests={pendingRequests} />}
        </div>
      )}
    </div>
  );
}

// The carrying-fee check, as one sentence above the items (or null).
function commissionNote(d, tonnage, t) {
  const merged = [...mergeByCategory(d.rows).values()];
  const commission = merged.filter((m) => isCommission(m.category)).reduce((s, m) => s + m.amount, 0);
  if (commission <= 0) return null;
  const c = checkCommission({ commission, boughtKg: tonnage?.boughtKg, soldKg: tonnage?.soldKg });
  const tn = c.tonnesBought ? `${c.tonnesBought.toFixed(1)} t · ${fmt(c.perTonne)} ៛/t` : "";
  if (c.state === "unknown") return { tone: "amber", text: t("ex_kh_unknown") };
  if (c.state === "over") return { tone: "rose", text: `${t("ex_kh_over")} ${riel(c.overBy)} · ${tn}` };
  if (c.state === "at") return { tone: "amber", text: `${t("ex_kh_at")} · ${tn}` };
  return { tone: "ok", text: tn };
}

function Items({ d, t, tonnage, amounts, setAmounts, editable }) {
  const merged = useMemo(() => [...mergeByCategory(d.rows).values()], [d.rows]);
  const note = commissionNote(d, tonnage, t);
  const total = merged.reduce((s, m) => {
    const v = editable ? parseAmount(amounts?.[m.key]) : m.amount;
    return s + (v == null ? 0 : v);
  }, 0);
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-slate-100 text-[10.5px] font-semibold uppercase tracking-[.07em] text-slate-400">
          <th className="py-2 text-left font-semibold">{t("xr_col_item")}</th>
          <th className="hidden py-2 text-left font-semibold sm:table-cell">{t("xr_col_note")}</th>
          <th className="py-2 text-right font-semibold">{t("xr_col_amount")}</th>
        </tr>
      </thead>
      <tbody>
        {merged.map((m) => {
          const now = editable ? parseAmount(amounts?.[m.key]) : m.amount;
          const changed = editable && now !== null && Math.round(now) !== Math.round(m.amount);
          const cleared = editable && now === null;
          const memo = m.rows.map((r) => r.memo).filter(Boolean).join(" · ");
          const okNote = isCommission(m.category) && note?.tone === "ok" ? note.text : "";
          return (
            <tr key={m.key} className="border-b border-slate-100">
              <td className="py-2.5 text-slate-800">{m.category}</td>
              <td className="hidden py-2.5 text-[12.5px] text-slate-400 sm:table-cell">
                {[memo, okNote].filter(Boolean).join(" · ") || "—"}
              </td>
              <td className="py-2.5 text-right tabular-nums">
                {editable && m.rows.length === 1 ? (
                  <span className="inline-flex items-center gap-2">
                    {(changed || cleared) && <span className="text-[11.5px] text-slate-400 line-through">{fmt(m.amount)}</span>}
                    <input inputMode="numeric" value={amounts?.[m.key] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [m.key]: e.target.value }))}
                      className={`w-28 rounded-md border px-2 py-1 text-right text-[13px] font-semibold tabular-nums outline-none ${changed || cleared ? "border-violet-300 bg-violet-50 text-violet-800" : "border-slate-300 bg-white"}`} />
                  </span>
                ) : (
                  <span className="text-slate-800">{riel(m.amount)}</span>
                )}
              </td>
            </tr>
          );
        })}
        <tr>
          <td className="pt-2.5 font-bold text-slate-800">{t("ex_total")}</td>
          <td className="hidden sm:table-cell" />
          <td className="pt-2.5 text-right font-bold tabular-nums text-slate-900">{riel(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Warning({ d, tonnage, t }) {
  const note = commissionNote(d, tonnage, t);
  if (!note || note.tone === "ok") return null;
  return (
    <p className={`rounded-lg border px-3 py-2 text-[12.5px] ${note.tone === "rose" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      {note.text}
    </p>
  );
}

function SheetHead({ d, t, right }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
      <div>
        <p className="text-[14.5px] font-bold text-slate-800">{fullDate(d.day, t)} · {d.stationName}</p>
        <p className="text-[12px] text-slate-500">{t("xr_entered_on", { name: d.enteredBy.join(", ") || "—", at: d.lastAt ? dmyTime(d.lastAt) : "—" })}</p>
      </div>
      {right}
    </div>
  );
}

function ManagerPanel({ d, t, userId, userEmail, tonnage, onChanged, onDone }) {
  const merged = useMemo(() => [...mergeByCategory(d.rows).values()], [d.rows]);
  const original = () => Object.fromEntries(merged.map((m) => [m.key, String(Math.round(m.amount))]));
  const [amounts, setAmounts] = useState(original);
  const [editing, setEditing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const edits = editing ? merged.filter((m) => {
    const v = parseAmount(amounts[m.key]);
    return v === null || Math.round(v) !== Math.round(m.amount);
  }) : [];
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
      onDone?.();
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
      onDone?.();
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  }

  const canEdit = allowed && merged.some((m) => m.rows.length === 1);
  const toggleEdit = () => { if (editing) { setAmounts(original()); setReason(""); } setEditing(!editing); };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <SheetHead d={d} t={t} right={canEdit && !sendingBack && (
        <button type="button" onClick={toggleEdit}
          className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold ${editing ? "text-slate-500 hover:text-slate-600" : "text-brand-600 hover:text-brand-700"}`}>
          {editing ? t("cancel") : <><Pencil size={13} />{t("xr_correct_figure")}</>}
        </button>
      )} />
      <div className="grid gap-3 px-4 py-3">
        <Warning d={d} tonnage={tonnage} t={t} />
        <Items d={d} t={t} tonnage={tonnage} amounts={amounts} setAmounts={setAmounts} editable={editing} />
        {editing && merged.some((m) => m.rows.length > 1) && <p className="text-[11.5px] text-slate-400">{t("xr_dupe_hint")}</p>}
        {correcting && (
          <div className="grid gap-1.5">
            <label className="text-[12.5px] font-semibold text-violet-800">{t("xr_why_changing")}</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("xr_why_changing_ph")}
              className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2 text-[13px] outline-none" />
            {!reasonOk && <p className="text-[11.5px] text-slate-400">{t("xr_more_chars", { n: 10 - reason.trim().length })}</p>}
          </div>
        )}
        {d.review?.status === "sent_back" && d.review?.note && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{t("xr_your_note")}: “{d.review.note}”</p>}
        {d.review?.reply && <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">{t("xr_staff_reply")}: “{d.review.reply}”</p>}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-[12.5px]">
        {!allowed ? (
          <p className="text-slate-600">{d.status === "confirmed" ? t("xr_already_confirmed") : t("xr_you_entered_it")}</p>
        ) : sendingBack ? (
          <div className="grid gap-2">
            <label className="font-semibold text-slate-700">{t("xr_what_to_fix")}</label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("xr_what_to_fix_ph")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-rose-300" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSendingBack(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600">{t("cancel")}</button>
              <button type="button" onClick={sendBack} disabled={note.trim().length < 5 || busy}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{t("xr_send_back")}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex min-w-[14rem] flex-1 items-center gap-2 text-slate-700">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {t("xr_checked_receipts")}
            </label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("xr_password")}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              autoComplete="current-password" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-brand-400 sm:w-48" />
            <button type="button" onClick={() => setSendingBack(true)} disabled={busy}
              className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">{t("xr_send_back")}</button>
            <button type="button" onClick={confirm} disabled={!canPress}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 ${correcting ? "bg-violet-700 hover:bg-violet-800" : "bg-brand-600 hover:bg-brand-700"}`}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {correcting ? t("xr_correct_confirm") : t("xr_confirm_next")}
            </button>
          </div>
        )}
        {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-rose-700">{error}</p>}
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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <SheetHead d={d} t={t} />
      <div className="grid gap-3 px-4 py-3">
      <Warning d={d} tonnage={tonnage} t={t} />
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
