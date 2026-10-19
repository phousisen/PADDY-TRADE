import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, ExternalLink, MessageSquareText, Search, ShieldCheck, Undo2 } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { useLanguage } from "../i18n.jsx";
import { dmy, dmyTime } from "../dateFormat.js";
import { cambodiaDateStr } from "../dailyLedger.js";
import { getAccurateNow } from "../supabaseClient.js";
import { findMoneyProblems, totalsOf, MIN_GAP, EXPLAINABLE, LATE_DAYS, khDate, daysBetween } from "../moneyCheck.js";

// [2026-10-19] Data Check → Money. moneyCheck.js decides what is listed and
// why; this file only loads, shows, explains, approves and puts back. The
// database enforces every rule shown here (money-check-notes SQL).

const fmt = (v) => new Intl.NumberFormat("en-US").format(Math.round(Number(v) || 0));
const REASONS = { owed_buyer: ["credit", "other"], owed_farmer: ["collect_later", "other"], paid_late: ["checked", "other"] };
const inGroup = (row, g) => g === "all"
  || (g === "fix" && row.severity === 1)
  || (g === "buyers" && row.problems.includes("owed_buyer"))
  || (g === "farmers" && row.problems.includes("owed_farmer"))
  || (g === "check" && row.problems.includes("paid_late"))
  || (g === "waiting" && row.waitingForOwner);

function Summary({ totals, t, group, setGroup }) {
  const cells = [
    { g: "fix", label: t("mc_sum_fix"), value: `${fmt(totals.fixNowRiel)} ៛`, sub: t("mc_n_tickets", { n: totals.fixNow }), on: totals.fixNow > 0, tone: "rose" },
    { g: "buyers", label: t("mc_sum_buyers"), value: `${fmt(totals.owedByBuyers)} ៛`, sub: t("mc_n_tickets", { n: totals.owedByBuyersN }), on: totals.owedByBuyersN > 0, tone: "amber" },
    { g: "farmers", label: t("mc_sum_farmers"), value: `${fmt(totals.owedToFarmers)} ៛`, sub: t("mc_n_tickets", { n: totals.owedToFarmersN }), on: totals.owedToFarmersN > 0, tone: "amber" },
    { g: "check", label: t("mc_sum_late"), value: `${fmt(totals.paidLateRiel)} ៛`, sub: t("mc_n_tickets", { n: totals.paidLateN }), on: totals.paidLateN > 0, tone: "sky" },
  ];
  const tone = {
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
    off: "border-slate-200 bg-white text-slate-500",
  };
  return (
    <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {cells.map((c, i) => (
        <button
          key={i}
          onClick={() => setGroup(group === c.g ? "all" : c.g)}
          className={`rounded-xl border px-3 py-2.5 text-left ${tone[c.on ? c.tone : "off"]} ${group === c.g ? "ring-2 ring-slate-400" : ""}`}
        >
          <div className="text-[12px] font-bold">{c.label}</div>
          <div className="mt-0.5 text-base font-bold tabular-nums lg:text-lg">{c.value}</div>
          <div className="text-[12px] opacity-80">{c.sub}</div>
        </button>
      ))}
    </div>
  );
}

function PaymentLines({ row, names, t }) {
  const [open, setOpen] = useState(row.problems.some((p) => p === "double" || p === "overpaid" || p === "paid_late" || p === "wrong_type"));
  const want = row.type === "BUY" ? "pay_supplier" : "receive_customer";
  if (!row.payments.length) return <p className="mt-2 text-[13px] text-slate-500">{t("mc_no_payments")}</p>;
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-[13px] font-semibold text-slate-600 hover:text-slate-800">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t("mc_show_payments", { n: row.payments.length })}
      </button>
      {open && (
        <div className="mt-1.5 divide-y divide-slate-200 border-t border-slate-200">
          {row.payments.map((p) => {
            const late = row.latePaymentIds.includes(p.id);
            const lateBy = p.created_at && p.pay_date ? daysBetween(String(p.pay_date).slice(0, 10), khDate(p.created_at)) : 0;
            return (
              <div key={p.id} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 py-1.5 text-[13px]">
                <span className="text-slate-600">{dmy(p.pay_date)}</span>
                <span className="text-slate-500">{["cash", "bank", "check"].includes(p.method) ? t(`mc_m_${p.method}`) : (p.method || "—")}</span>
                <span className="font-semibold tabular-nums text-slate-800">{fmt(p.amount)} ៛</span>
                <span className="text-slate-500">
                  {t("mc_by", { name: names[p.created_by] || "—" })}
                  {p.created_at && <span className="text-slate-400"> · {dmyTime(p.created_at)}</span>}
                </span>
                {p.type !== want && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">{t("mc_p_wrong_type")}</span>}
                {late && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">{t("mc_late_by", { n: lateBy })}</span>}
                {p.memo && <div className="w-full text-[12px] text-slate-400">“{p.memo}”</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NoteBox({ note, problem, names, t, isOwner, isHQ, row, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pending = !note.approved_at;
  async function act(kind) {
    setBusy(true); setErr("");
    try {
      if (kind === "approve") await api.approveMoneyCheckNotes([note.id]);
      else await api.reopenMoneyCheckNotes({ transactionId: row.id, problems: [problem] });
      onChanged();
    } catch (e) {
      setErr(e?.message === "NOTHING_CHANGED" ? t("mc_err_nothing_changed") : (e?.message || t("mc_err_save")));
    } finally { setBusy(false); }
  }
  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-[13px] ${pending ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="font-semibold text-slate-700">{t(`mc_r_${note.reason}`)}: <span className="font-normal">“{note.note}”</span></div>
      <div className="mt-0.5 text-[12px] text-slate-500">
        {t("mc_explained_by", { name: names[note.created_by] || "—", when: dmyTime(note.created_at) })}
        {note.approved_at && note.approved_by !== note.created_by && <> · {t("mc_approved_by", { name: names[note.approved_by] || "—" })}</>}
      </div>
      {pending && <div className="mt-1 text-[12px] font-bold text-amber-800">{t("mc_waiting_owner")}</div>}
      {err && <div className="mt-1 text-[12px] text-rose-600">{err}</div>}
      <div className="mt-1.5 flex flex-wrap gap-2">
        {pending && isOwner && (
          <button onClick={() => act("approve")} disabled={busy} className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            <ShieldCheck size={12} /> {t("mc_approve")}
          </button>
        )}
        {isHQ && (problem !== "paid_late" || isOwner) && (
          <button onClick={() => act("reopen")} disabled={busy} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <Undo2 size={12} /> {t("mc_reopen")}
          </button>
        )}
      </div>
    </div>
  );
}

function ExplainForm({ row, items, isOwner, t, onSaved, onCancel }) {
  const firstProblem = items[0].problem;
  const [reason, setReason] = useState(REASONS[firstProblem][0]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const needsOwner = !isOwner;
  const ok = text.trim().length >= 10;
  async function save() {
    if (busy || !ok) return;
    setBusy(true); setErr("");
    try {
      await api.addMoneyCheckNotes({ transactionId: row.id, items, reason, note: text });
      onSaved();
    } catch (e) {
      setErr(/row-level security|permission|policy/i.test(e?.message || "") ? t("mc_err_not_allowed") : (e?.message || t("mc_err_save")));
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <p className="mb-2 text-[13px] leading-relaxed text-slate-600">{t(firstProblem === "paid_late" ? "mc_check_hint" : "mc_explain_hint")}</p>
      <div className="mb-2 flex flex-wrap gap-2">
        {REASONS[firstProblem].map((r) => (
          <label key={r} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] ${reason === r ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-slate-200 text-slate-600"}`}>
            <input type="radio" name={`r-${row.id}`} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
            {t(`mc_r_${r}`)}
          </label>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={300}
        placeholder={t(firstProblem === "paid_late" ? "mc_check_ph" : "mc_explain_ph")}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
      {!ok && text.length > 0 && <p className="mt-1 text-[12px] text-slate-400">{t("mc_note_min")}</p>}
      {needsOwner && <p className="mt-1 text-[12px] font-semibold text-amber-800">{t("mc_needs_owner")}</p>}
      {err && <p className="mt-1 text-[12px] text-rose-600">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={save} disabled={busy || !ok} className="rounded-lg bg-brand-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? t("mc_saving") : t("mc_save_note")}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-500 hover:bg-slate-50">{t("mc_cancel")}</button>
      </div>
    </div>
  );
}

function ProblemCard({ row, names, t, me, isOwner, isHQ, notesReady, onOpen, onChanged }) {
  const [explaining, setExplaining] = useState(false);
  const isBuy = row.type === "BUY";
  const card = { 1: "border-rose-200 bg-rose-50/40", 2: "border-amber-200 bg-amber-50/40", 3: "border-sky-200 bg-sky-50/40" }[row.severity];
  const chip = (p) => ({ 1: "bg-rose-100 text-rose-700", 2: "bg-amber-100 text-amber-800", 3: "bg-sky-100 text-sky-800" }[p === "paid_late" ? 3 : ["owed_farmer", "owed_buyer"].includes(p) ? 2 : 1]);
  const owedLabel = row.gap < 0 ? (isBuy ? t("mc_col_paid_too_much") : t("mc_col_received_too_much")) : (isBuy ? t("mc_col_we_owe") : t("mc_col_buyer_owes"));

  // What this user may explain on this ticket, right now (the database
  // checks the same): never your own ticket (the owner may), and never a
  // late payment you typed yourself — not even the owner.
  const ownTicket = !!(row.recordedBy && me && row.recordedBy === me && !isOwner);
  const typedLate = !!(me && row.latePaidBy.includes(me));
  const mayExplain = (p) => (p === "paid_late" ? !typedLate : !ownTicket);
  const items = row.problems
    .filter((p) => EXPLAINABLE.includes(p) && !row.notes[p] && mayExplain(p))
    .map((p) => ({ problem: p, gap: row.gapFor[p] }));
  const blocked = row.problems.filter((p) => EXPLAINABLE.includes(p) && !row.notes[p] && !mayExplain(p));
  // One reason list per form: explain the owed lines and the late check separately.
  const formItems = items.length ? items.filter((i) => (i.problem === "paid_late") === (items[0].problem === "paid_late")) : [];
  const canExplain = isHQ && notesReady && !ownTicket && formItems.length > 0;
  const fixOnly = row.problems.filter((p) => !EXPLAINABLE.includes(p));

  return (
    <div className={`rounded-xl border p-4 ${card}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${isBuy ? "bg-brand-100 text-brand-700" : "bg-sky-100 text-sky-700"}`}>
              {isBuy ? t("mc_buy") : t("mc_sell")}
            </span>
            {row.paperNo && <span className="text-base font-bold text-slate-800">{row.paperNo}</span>}
            <span className={row.paperNo ? "text-[13px] text-slate-500" : "text-base font-bold text-slate-800"}>{row.code}</span>
          </div>
          <div className="mt-1 text-[13px] text-slate-600">
            {row.stationName} · {dmy(row.date)} · {t("mc_days_ago", { n: row.age })}
            {row.partyName && row.partyName !== "—" ? ` · ${row.partyName}` : ""}
          </div>
          {row.recordedBy && <div className="text-[12px] text-slate-400">{t("mc_entered_by", { name: names[row.recordedBy] || "—" })}</div>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {row.problems.map((p) => (
            <span key={p} className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${chip(p)}`}>{t(`mc_p_${p}`)}</span>
          ))}
        </div>
      </div>

      {row.problems.map((p) => (
        <p key={p} className="mt-2 text-[13px] leading-relaxed text-slate-700">{t(`mc_p_${p}_plain`, { days: LATE_DAYS })}</p>
      ))}

      <div className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
        <div className="rounded-lg bg-white/80 px-3 py-2">
          <div className="text-[12px] font-bold text-slate-500">{t("mc_col_total")}</div>
          <div className="mt-0.5 font-semibold tabular-nums text-slate-800">{fmt(row.total)} ៛</div>
          <div className="text-[12px] text-slate-500">{fmt(row.kg)} kg{row.price > 0 ? ` · ${fmt(row.price)} ៛/kg` : ""}</div>
        </div>
        <div className="rounded-lg bg-white/80 px-3 py-2">
          <div className="text-[12px] font-bold text-slate-500">{isBuy ? t("mc_col_paid") : t("mc_col_received")}</div>
          <div className="mt-0.5 font-semibold tabular-nums text-slate-800">{fmt(row.paid)} ៛</div>
        </div>
        {row.estimate > 0 ? (
          <div className="rounded-lg bg-rose-100 px-3 py-2">
            <div className="text-[12px] font-bold text-rose-800">{t("mc_col_worth")}</div>
            <div className="mt-0.5 font-bold tabular-nums text-rose-800">≈ {fmt(row.estimate)} ៛</div>
            <div className="text-[12px] text-rose-700">{t("mc_worth_hint")}</div>
          </div>
        ) : Math.abs(row.gap) >= MIN_GAP ? (
          <div className={`rounded-lg px-3 py-2 ${row.gap < 0 ? "bg-rose-100" : "bg-amber-100"}`}>
            <div className="text-[12px] font-bold text-slate-700">{owedLabel}</div>
            <div className={`mt-0.5 font-bold tabular-nums ${row.gap < 0 ? "text-rose-800" : "text-amber-900"}`}>{fmt(Math.abs(row.gap))} ៛</div>
          </div>
        ) : row.lateSum > 0 ? (
          <div className="rounded-lg bg-sky-100 px-3 py-2">
            <div className="text-[12px] font-bold text-sky-900">{t("mc_col_late")}</div>
            <div className="mt-0.5 font-bold tabular-nums text-sky-900">{fmt(row.lateSum)} ៛</div>
          </div>
        ) : (
          <div className="rounded-lg bg-white/80 px-3 py-2">
            <div className="text-[12px] font-bold text-slate-500">{t("mc_col_diff")}</div>
            <div className="mt-0.5 font-semibold tabular-nums text-slate-800">0 ៛</div>
          </div>
        )}
      </div>

      {row.perKg && (
        <p className="mt-2 text-[13px] font-semibold text-slate-800">{t(row.gap < 0 ? "mc_perkg_more" : "mc_perkg_less", { n: row.perKg })}</p>
      )}

      <PaymentLines row={row} names={names} t={t} />

      {row.problems.filter((p) => row.notes[p]).map((p) => (
        <NoteBox key={p} note={row.notes[p]} problem={p} names={names} t={t} isOwner={isOwner} isHQ={isHQ} row={row} onChanged={onChanged} />
      ))}

      {fixOnly.map((p) => <p key={p} className="mt-2 text-[13px] font-semibold text-rose-800">{t(`mc_fix_${p}`)}</p>)}
      {isHQ && blocked.length > 0 && (
        <p className="mt-2 text-[12px] text-slate-500">{t(blocked.includes("paid_late") ? "mc_not_own_late" : "mc_not_own")}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onOpen && (
          <button onClick={() => onOpen(row.code)} className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
            <ExternalLink size={13} /> {t("mc_open_tx")}
          </button>
        )}
        {canExplain && !explaining && (
          <button onClick={() => setExplaining(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
            {formItems[0].problem === "paid_late" ? <ShieldCheck size={13} /> : <MessageSquareText size={13} />}
            {formItems[0].problem === "paid_late" ? t("mc_mark_checked") : t("mc_explain")}
          </button>
        )}
      </div>

      {explaining && (
        <ExplainForm row={row} items={formItems} isOwner={isOwner} t={t}
          onSaved={() => { setExplaining(false); onChanged(); }} onCancel={() => setExplaining(false)} />
      )}
    </div>
  );
}

export default function MoneyCheck({ setPage, onCount, onLoading, refreshSignal = 0 }) {
  const { t } = useLanguage();
  const { profile, session, isViewOnly } = useAuth();
  const isOwner = !isViewOnly && !!profile?.isOwner;
  // Same rule as the database's paddy_is_hq(): an HQ login, never a station.
  const isHQ = !isViewOnly && (isOwner || profile?.role === "admin" || profile?.roleScope === "all");
  const me = session?.user?.id || profile?.id || null;

  const [data, setData] = useState(null);
  const [names, setNames] = useState({});
  const [notesReady, setNotesReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [station, setStation] = useState("all");
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [today, setToday] = useState(() => cambodiaDateStr(getAccurateNow()));
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true); setError("");
    try {
      let ready = true;
      const [core, locations, notes] = await Promise.all([
        api.getMoneyCheckData(),
        api.getLocations(),
        // Missing table = the SQL step not run yet. The list still works;
        // only "Explain" waits for it.
        api.getMoneyCheckNotes().catch((e) => {
          if (/money_check_notes/i.test(e?.message || "") && /does not exist|schema cache|could not find/i.test(e?.message || "")) { ready = false; return []; }
          throw e;
        }),
      ]);
      if (mine !== seq.current) return;            // a newer load has started
      const stationName = Object.fromEntries((locations || []).map((l) => [l.id, l.name]));
      setNotesReady(ready);
      setToday(cambodiaDateStr(getAccurateNow()));
      setData({ txs: core.txs.map((x) => ({ ...x, stationName: stationName[x.location_id] || "—" })), payments: core.payments, notes, locations: locations || [] });
    } catch (e) {
      if (mine === seq.current) setError(e?.message || "load");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshSignal]);
  useEffect(() => { onLoading?.(loading); }, [loading, onLoading]);

  const full = useMemo(() => (data ? findMoneyProblems({ txs: data.txs, payments: data.payments, notes: data.notes, today }) : null), [data, today]);

  // Names only for what is listed: farmers/buyers, and who entered, paid,
  // explained or approved.
  useEffect(() => {
    if (!full) return;
    const rows = [...full.open, ...full.done];
    const partyIds = rows.map((r) => r.partyId).filter((id) => id && !(`p:${id}` in names));
    const userIds = [];
    for (const r of rows) {
      userIds.push(r.recordedBy);
      for (const p of r.payments) userIds.push(p.created_by);
      for (const n of Object.values(r.notes)) if (n) userIds.push(n.created_by, n.approved_by);
    }
    const missingUsers = [...new Set(userIds.filter((id) => id && !(id in names)))];
    if (!partyIds.length && !missingUsers.length) return;
    let alive = true;
    Promise.all([api.getPartyNames(partyIds), api.getProfileNames(missingUsers)]).then(([parties, users]) => {
      if (!alive) return;
      // Only names that came back are kept; a failed lookup is asked again
      // on the next load instead of being remembered as "—".
      setNames((prev) => {
        const next = { ...prev, ...users };
        for (const id of partyIds) if (id in parties) next[`p:${id}`] = parties[id];
        return next;
      });
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  const view = useMemo(() => {
    if (!full) return null;
    const needle = q.trim().toLowerCase();
    const keep = (r) => (station === "all" || r.locationId === station)
      && (!needle || [r.code, r.paperNo, names[`p:${r.partyId}`]].some((s) => String(s || "").toLowerCase().includes(needle)));
    const withNames = (r) => ({ ...r, partyName: names[`p:${r.partyId}`] || "" });
    const open = full.open.filter(keep).map(withNames);
    const done = full.done.filter(keep).map(withNames);
    // Totals follow the station picker, not the search or group buttons.
    const totals = station === "all" ? full.totals : totalsOf(full.open.filter((r) => r.locationId === station));
    return { open: open.filter((r) => inGroup(r, group)), done: done.filter((r) => inGroup(r, group)), totals, allOpen: open.length };
  }, [full, station, group, q, names]);

  // The tab's number: what THIS person can act on. Finance is not counted
  // the owner's checks, nor tickets already waiting for the owner.
  useEffect(() => {
    if (!full || !onCount) return;
    const actionable = full.open.filter((r) => isOwner || (r.severity !== 3 && !r.waitingForOwner));
    onCount(actionable.length);
  }, [full, onCount, isOwner]);

  const onOpen = setPage
    ? (code) => {
        try { sessionStorage.setItem("paddytrade_tx_search", code); } catch { /* the code is on the card */ }
        setPage("transactions");
      }
    : null;

  const [exportErr, setExportErr] = useState("");
  async function exportList() {
    if (!view) return;
    setExportErr("");
    let XLSX;
    try { XLSX = await import("xlsx"); } catch { setExportErr(t("mc_err_export")); return; }
    const line = (r, state) => ({
      [t("mc_x_state")]: state,
      [t("mc_x_station")]: r.stationName,
      [t("mc_x_date")]: dmy(r.date),
      [t("mc_x_ticket")]: r.code,
      [t("mc_x_paper")]: r.paperNo,
      [t("mc_x_party")]: r.partyName,
      [t("mc_x_problem")]: r.problems.map((p) => t(`mc_p_${p}`)).join(", "),
      [t("mc_col_total")]: Math.round(r.total),
      [t("mc_x_paid")]: Math.round(r.paid),
      [t("mc_x_gap")]: r.gap,
      [t("mc_x_days")]: r.age,
      [t("mc_x_entered_by")]: names[r.recordedBy] || "",
      [t("mc_x_typed_by")]: [...new Set(r.payments.map((p) => names[p.created_by] || ""))].filter(Boolean).join(", "),
      [t("mc_x_note")]: Object.values(r.notes).filter(Boolean).map((n) => `${t(`mc_r_${n.reason}`)}: ${n.note}`).join(" | "),
      [t("mc_x_explained_by")]: Object.values(r.notes).filter(Boolean).map((n) => `${names[n.created_by] || ""} ${dmyTime(n.created_at)}`).join(" | "),
      [t("mc_x_ok_by")]: Object.values(r.notes).filter(Boolean).map((n) => (n.approved_at ? `${names[n.approved_by] || ""} ${dmyTime(n.approved_at)}` : t("mc_x_waiting"))).join(" | "),
    });
    const rows = [...view.open.map((r) => line(r, t("mc_x_open"))), ...view.done.map((r) => line(r, t("mc_x_explained")))];
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Money check");
    try { XLSX.writeFile(wb, `money-check-${today}.xlsx`); } catch { setExportErr(t("mc_err_export")); }
  }

  const clean = full && full.open.length === 0 && !error && !loading;

  return (
    <>
      <div className="mb-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[13px] leading-relaxed text-slate-600">
        <AlertTriangle size={14} className="mr-1.5 inline-block text-slate-400" />
        {t("mc_intro")}
      </div>

      {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{t("mc_err_load")} ({error})</div>}
      {!notesReady && isHQ && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">{t("mc_notes_setup")}</div>
      )}
      {loading && !data && <p className="px-1 py-10 text-center text-sm text-slate-400">{t("loading_label")}</p>}

      {view && <Summary totals={view.totals} t={t} group={group} setGroup={setGroup} />}
      {view && (
        <p className="mb-3 text-[12px] text-slate-500">
          {t("mc_oldest", { n: view.totals.oldestDays })}
          {view.totals.waitingForOwner > 0 && <> · <span className="font-bold text-amber-800">{t("mc_n_waiting", { n: view.totals.waitingForOwner })}</span></>}
          {full.done.length > 0 && <> · {t("mc_n_explained", { n: full.done.length })}</>}
        </p>
      )}

      {data && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("mc_search_ph")}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none" />
          </div>
          {data.locations.length > 1 && (
            <select value={station} onChange={(e) => setStation(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none">
              <option value="all">{t("mc_all_stations")}</option>
              {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {isOwner && view.totals.waitingForOwner > 0 && (
            <button onClick={() => setGroup(group === "waiting" ? "all" : "waiting")}
              className={`rounded-lg px-3 py-2 text-[13px] font-bold ${group === "waiting" ? "bg-amber-600 text-white" : "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}>
              {t("mc_waiting_mine", { n: view.totals.waitingForOwner })}
            </button>
          )}
          {group !== "all" && (
            <button onClick={() => setGroup("all")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
              {t("mc_show_all")}
            </button>
          )}
          <button onClick={exportList} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
            <Download size={13} /> {t("mc_export")}
          </button>
        </div>
      )}

      {exportErr && <p className="mb-3 text-[13px] text-rose-600">{exportErr}</p>}

      {clean && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-6 py-12 text-center">
          <CheckCircle2 size={30} className="mx-auto mb-3 text-brand-600" />
          <p className="text-sm font-bold text-slate-700">{t("mc_all_match")}</p>
          <p className="mt-1 text-xs text-slate-500">{t("dc_nothing_needed")}</p>
        </div>
      )}

      {view && view.open.length === 0 && view.allOpen > 0 && (
        <p className="px-1 py-6 text-center text-[13px] text-slate-500">{t("mc_none_in_filter")}</p>
      )}

      {view && view.open.length > 0 && (
        <div className="space-y-3">
          {view.open.map((row) => (
            <ProblemCard key={row.id} row={row} names={names} t={t} me={me} isOwner={isOwner} isHQ={isHQ}
              notesReady={notesReady} onOpen={onOpen} onChanged={load} />
          ))}
        </div>
      )}

      {view && view.done.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowDone((v) => !v)} className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-slate-600 hover:text-slate-800">
            {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t("mc_explained_n", { n: view.done.length })}
          </button>
          {showDone && (
            <div className="space-y-2">
              {view.done.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-bold text-slate-800">{row.paperNo || row.code}</span>
                    <span className="text-slate-500">{row.stationName} · {dmy(row.date)}{row.partyName ? ` · ${row.partyName}` : ""}</span>
                    {row.problems.map((p) => <span key={p} className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-bold text-slate-600">{t(`mc_p_${p}`)} · {fmt(Math.abs(row.gapFor[p]))} ៛</span>)}
                  </div>
                  {row.problems.filter((p) => row.notes[p]).map((p) => (
                    <NoteBox key={p} note={row.notes[p]} problem={p} names={names} t={t} isOwner={isOwner} isHQ={isHQ} row={row} onChanged={load} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
