import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Delete, Loader2 } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { useLanguage } from "../i18n.jsx";
import { getAccurateNow } from "../supabaseClient.js";

// [2026-09-09 v4] The daily count, on the board the station staff already
// live on.
//
// It is a SIGNATURE, not a lock. Nothing is blocked by answering it, and the
// day's work can still be corrected afterwards. A station that could not fix
// an obvious mistake because it had already pressed a button at 5pm would
// simply stop pressing the button, and then you lose the signature and the
// correction both. Refusal belongs to the monthly close, by which time the
// day is long finished and HQ is the one closing it.
//
// WHY THE COUNT IS THE WHOLE POINT
//
// The system can only ever count what ARRIVED. A receipt printed at the
// scale whose transaction never landed is not "missing" from our view — it
// was never here. The paper stubs in the station's hand are the only
// evidence it existed. So we ask them one number.
//
// WHAT v4 CHANGED, AND WHY
//
//   * ONE DAY AT A TIME. v2 showed the last seven days as a list. Nobody
//     reads a list of seven days at the end of a shift. It now asks about
//     the oldest day still unanswered, and when that is done it moves to the
//     next one by itself. Nothing to read, nothing to choose.
//
//   * A NUMBER PAD, not a keyboard. It is a phone at a weighbridge, often
//     with wet or dusty hands.
//
//   * KHMER IS THE BIG TEXT. English sits underneath it.
//
//   * NO WORDS LIKE "confirm", "close" or "reopen" on the staff screen. A
//     question, a number, and Done.
//
//   * THE TICKET NUMBERS ARE ONLY SHOWN AFTER THE COUNTS DISAGREE. On an
//     ordinary day showing them is clutter that trains people to ignore the
//     card. When the counts do disagree they are exactly what is needed, so
//     they are fetched then and not before, with the break in the run
//     offered as a suggestion.
//
//   * "Do it later" is always there. Nothing is ever forced.
//
// Late days are normal, not an exception: buying runs into the evening and
// the office staff go home, and a sell weighed in tonight is weighed out
// tomorrow morning. A design that only allowed "today" would mean the day
// never got answered at all.

function cambodiaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Phnom_Penh" }).format(getAccurateNow());
}

function dayLabel(dateStr, today, t) {
  if (dateStr === today) return t("day_today");
  const d = new Date(`${dateStr}T00:00:00+07:00`);
  const y = new Date(`${today}T00:00:00+07:00`);
  y.setDate(y.getDate() - 1);
  const pretty = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "short",
  }).format(d);
  const isYesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Phnom_Penh" }).format(y) === dateStr;
  return isYesterday ? `${t("day_yesterday")} · ${pretty}` : pretty;
}

// The break in a run of sequential ticket numbers. A suggestion, never an
// answer: books get swapped mid-day and the numbering restarts, and if the
// LAST ticket of the day was the lost one there is no gap to see at all.
function suggestMissing(tickets) {
  const nums = [];
  for (const row of tickets || []) {
    const digits = String(row.paper_ticket_no || "").replace(/\D/g, "");
    if (digits) nums.push({ n: Number(digits), raw: row.paper_ticket_no, width: digits.length });
  }
  if (nums.length < 2) return null;
  nums.sort((a, b) => a.n - b.n);

  // Only ONE clean single-number break in the whole day is worth offering.
  // Two breaks, or a break of several numbers, means we do not actually know
  // — and a confident wrong guess is worse than no guess, because someone
  // will accept it without looking.
  const singles = [];
  for (let i = 1; i < nums.length; i++) {
    const step = nums[i].n - nums[i - 1].n;
    if (step === 2) singles.push(nums[i - 1]);
    else if (step > 2 && step <= 6) return null; // a run of several — let them look
    // A jump larger than that is a new ticket book, not lost tickets.
  }
  if (singles.length !== 1) return null;

  const before = singles[0];
  const prefix = String(before.raw || "").replace(/\d+\s*$/, "");
  return `${prefix}${String(before.n + 1).padStart(before.width, "0")}`;
}

function NumberPad({ value, onChange, disabled }) {
  const push = (d) => { if (!disabled && String(value).length < 4) onChange(`${value}${d}`); };
  const back = () => { if (!disabled) onChange(String(value).slice(0, -1)); };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button key={k} type="button" onClick={() => push(k)} disabled={disabled}
          className="rounded-xl border border-slate-200 bg-white py-3.5 text-xl font-bold tabular-nums text-slate-800 active:bg-slate-100 disabled:opacity-40">
          {k}
        </button>
      ))}
      <button type="button" onClick={back} disabled={disabled}
        className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-3.5 text-slate-500 active:bg-slate-100 disabled:opacity-40">
        <Delete size={20} />
      </button>
      <button type="button" onClick={() => push("0")} disabled={disabled}
        className="rounded-xl border border-slate-200 bg-white py-3.5 text-xl font-bold tabular-nums text-slate-800 active:bg-slate-100 disabled:opacity-40">
        0
      </button>
      <button type="button" onClick={() => onChange("")} disabled={disabled}
        className="rounded-xl border border-slate-200 bg-white py-3.5 text-[13px] font-bold text-slate-500 active:bg-slate-100 disabled:opacity-40">
        C
      </button>
    </div>
  );
}

export default function StationDayClose({ locationId, locationName }) {
  const { isViewOnly } = useAuth();
  const { t } = useLanguage();
  const today = cambodiaToday();

  const [days, setDays] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);   // unavailable, or dismissed for now
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Per-day working state, reset whenever the day being asked about changes.
  const [count, setCount] = useState("");
  const [tickets, setTickets] = useState(null);  // fetched only after a mismatch
  const [missingNo, setMissingNo] = useState("");
  const [askingMissing, setAskingMissing] = useState(false);
  const [doneMessage, setDoneMessage] = useState(null); // {gap}
  // A day already answered that the station has chosen to answer again —
  // they typed 14 when they meant 15. Answering again simply replaces the
  // number; every version stays in the change history.
  const [redoDate, setRedoDate] = useState(null);

  const load = useCallback(async () => {
    if (!locationId) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      setDays(await api.getStationDays(locationId, 7));
      setHidden(false);
    } catch {
      // Not installed in this database yet, or unreachable — the card simply
      // does not appear. It must never get in the way of the ticket board.
      setDays(null);
      setHidden(true);
    } finally { setLoading(false); }
  }, [locationId]);

  useEffect(() => { load(); }, [load]);

  if (loading || hidden || !days || days.length === 0) return null;
  if (isViewOnly || !locationId) return null;

  // The oldest day nobody has answered yet. Oldest first, because an
  // unanswered day from three days ago is the one at risk of never being
  // looked at.
  const pending = days.filter((d) => !d.closed_at).sort((a, b) => (a.business_date < b.business_date ? -1 : 1));
  const answered = days.filter((d) => d.closed_at).sort((a, b) => (a.business_date < b.business_date ? 1 : -1));
  const redo = redoDate ? days.find((d) => d.business_date === redoDate) : null;
  const day = redo || pending[0];

  // Nothing to ask about and nothing recently answered to correct: no card at
  // all rather than an empty one.
  if (!day && answered.length === 0) return null;

  const systemCount = day ? Number(day.tickets_finished || 0) : 0;
  const typed = count === "" ? null : Number(count);
  const gap = typed === null ? null : typed - systemCount;
  const openTickets = day ? Number(day.open_tickets || 0) : 0;

  function resetDay() {
    setCount(""); setTickets(null); setMissingNo(""); setAskingMissing(false);
    setRedoDate(null); setError("");
  }

  // Step 1 → the counts agree: save straight away. They disagree: fetch the
  // day's ticket numbers and ask which one is missing.
  async function submitCount() {
    if (typed === null) return;
    setError("");
    if (gap === 0) { await save(typed, null); return; }
    setBusy(true);
    try {
      const rows = await api.getStationDayTickets(locationId, day.business_date);
      setTickets(rows);
      setMissingNo(gap > 0 ? (suggestMissing(rows) || "") : "");
    } catch {
      setTickets([]);   // the question still stands even if the list failed
    } finally {
      setBusy(false);
      setAskingMissing(true);
    }
  }

  async function save(paperCount, missing) {
    setBusy(true); setError("");
    try {
      await api.closeStationDay({
        locationId,
        businessDate: day.business_date,
        paperCount,
        missingTicketNo: missing,
        note: null,
      });
      setDoneMessage({ gap: paperCount - systemCount });
      resetDay();
      await load();
      setTimeout(() => setDoneMessage(null), 6000);
    } catch (e) {
      setError(e.message || t("day_save_failed"));
    } finally { setBusy(false); }
  }

  const suggestion = tickets ? suggestMissing(tickets) : null;

  return (
    <div className="mb-4 rounded-xl border-2 border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold text-slate-700">{t("day_section_title")}</h3>
        <span className="text-[11px] font-semibold text-slate-400">
          {locationName ? `${locationName} · ` : ""}
          {day ? dayLabel(day.business_date, today, t) : t("day_all_answered")}
          {day && pending.length > 1 ? ` · ${t("day_more_waiting", { n: pending.length - 1 })}` : ""}
        </span>
      </div>

      {doneMessage && (
        <div className={`mb-3 rounded-xl border-2 p-3 text-center ${doneMessage.gap === 0 ? "border-brand-200 bg-brand-50" : "border-amber-200 bg-amber-50"}`}>
          <p className={`text-sm font-bold ${doneMessage.gap === 0 ? "text-brand-700" : "text-amber-700"}`}>
            {doneMessage.gap === 0 ? t("day_all_correct") : t("day_reported_missing", { n: Math.abs(doneMessage.gap) })}
          </p>
        </div>
      )}

      {/* STEP 1 — the one question. */}
      {day && !askingMissing && (
        <>
          <p className="text-[17px] font-bold leading-snug text-slate-800">{t("day_q_count")}</p>
          <p className="mt-1 text-xs text-slate-500">{t("day_q_count_en")}</p>

          <div className="mt-3 rounded-xl bg-slate-100 py-3 text-center">
            <div className="text-3xl font-black tabular-nums leading-none text-slate-800">{systemCount}</div>
            <div className="mt-1 text-[11px] text-slate-500">{t("day_system_has", { n: systemCount })}</div>
          </div>

          <div className="mt-3 flex items-center justify-center">
            <div className={`flex h-14 min-w-[92px] items-center justify-center rounded-xl border-[3px] bg-white text-3xl font-black tabular-nums ${
              typed === null ? "border-slate-300 text-slate-300"
                : gap === 0 ? "border-brand-500 text-slate-800"
                : "border-rose-400 text-rose-600"}`}>
              {count === "" ? "–" : count}
            </div>
          </div>

          <NumberPad value={count} onChange={setCount} disabled={busy} />

          {typed !== null && gap !== 0 && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {gap > 0 ? t("day_gap_missing", { n: gap }) : t("day_gap_extra", { n: -gap })}
            </p>
          )}

          <button
            type="button" onClick={submitCount} disabled={busy || typed === null}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-black text-white disabled:opacity-40 ${
              gap === 0 || typed === null ? "bg-brand-600 hover:bg-brand-700" : "bg-amber-600 hover:bg-amber-700"}`}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {t("day_done")}
          </button>
        </>
      )}

      {/* STEP 2 — only ever reached because the counts disagreed. */}
      {day && askingMissing && (
        <>
          <p className="rounded-xl border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-center text-[14px] font-bold text-rose-700">
            {gap > 0 ? t("day_gap_missing", { n: gap }) : t("day_gap_extra", { n: -gap })}
            <span className="mt-0.5 block text-[11px] font-medium text-slate-600">
              {t("day_book_vs_system", { book: typed, system: systemCount })}
            </span>
          </p>

          {gap > 0 && (
            <>
              <p className="mt-3 text-[15px] font-bold leading-snug text-slate-800">{t("day_q_which")}</p>
              <p className="mt-1 text-xs text-slate-500">{t("day_q_which_en")}</p>

              {tickets && tickets.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {tickets.map((row, i) => (
                    <span key={`${row.code}-${i}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] font-bold tabular-nums text-slate-600">
                      {row.paper_ticket_no || row.code}
                    </span>
                  ))}
                  {suggestion && (
                    <button type="button" onClick={() => setMissingNo(suggestion)}
                      className="rounded-lg border border-dashed border-rose-300 bg-rose-50 px-2 py-1 text-[12px] font-bold tabular-nums text-rose-600">
                      {t("day_maybe_missing", { no: suggestion })}
                    </button>
                  )}
                </div>
              )}

              <input
                value={missingNo} onChange={(e) => setMissingNo(e.target.value)} inputMode="text"
                placeholder={t("day_ticket_no_placeholder")}
                className="mt-3 w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-center text-[17px] font-bold tracking-wide outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </>
          )}

          <button
            type="button" onClick={() => save(typed, gap > 0 ? missingNo.trim() || null : null)} disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 py-3.5 text-[15px] font-black text-white hover:bg-amber-700 disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {t("day_done")}
          </button>

          {gap > 0 && (
            <button type="button" onClick={() => save(typed, null)} disabled={busy}
              className="mt-2 w-full text-center text-[12px] font-medium text-slate-400 hover:text-slate-600">
              {t("day_dont_know")}
            </button>
          )}

          <button type="button" onClick={() => { setAskingMissing(false); setError(""); }} disabled={busy}
            className="mt-2 w-full text-center text-[12px] text-slate-400 hover:text-slate-600">
            {t("day_change_count")}
          </button>
        </>
      )}

      {openTickets > 0 && !askingMissing && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">{t("day_open_tickets", { n: openTickets })}</p>
      )}

      {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}

      {day && !askingMissing && (
        <button type="button" onClick={() => (redo ? resetDay() : setHidden(true))}
          className="mt-2 w-full text-center text-[12px] font-medium text-slate-400 hover:text-slate-600">
          {redo ? t("cancel") : t("day_later")}
        </button>
      )}

      {/* A typed number can be wrong — 14 when they meant 15. The last day
          answered stays reachable so it can be answered again, which simply
          replaces the number. Every version is kept in the change history. */}
      {!askingMissing && !redo && answered.length > 0 && (
        <p className="mt-3 border-t border-slate-100 pt-2.5 text-center text-[11px] text-slate-400">
          {t("day_last_answered", {
            day: dayLabel(answered[0].business_date, today, t),
            n: answered[0].paper_ticket_count ?? "—",
          })}{" "}
          <button type="button" onClick={() => { resetDay(); setRedoDate(answered[0].business_date); }}
            className="font-semibold text-slate-500 underline hover:text-slate-700">
            {t("day_answer_again")}
          </button>
        </p>
      )}
    </div>
  );
}
