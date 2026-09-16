// Expenses — a day at a time, a station at a time.
//
// [2026-09-16] Rebuilt. SISEN: "each location will send us the total expenses
// for each day everyday so the HQ finance will type the expense down."
//
// That single sentence decided the whole screen. The old one recorded ONE
// expense at a time: pick category, amount, date, station, save — repeated
// for every line on every sheet from every station, up to thirty saves a day
// for one person. Now a day is one sheet: pick the station once, fill only
// the categories that had something, save, and it moves to the next station
// that has not been entered.
//
// WHAT CHANGED, AND WHY
//
//   * ថ្លៃកូនដៃ is its own category, never inside Staff. It is a commission
//     paid per kilo to one staff member per station for bringing farmers in.
//     Salary barely moves month to month; commission moves with how much
//     paddy is bought. Averaged together neither can be read — in the month
//     this was designed against, salary moved +2.4% and commission +36.7%,
//     which combine to +13.4% and describe neither. SISEN is actively trying
//     to bring it down, which is impossible to see inside a total.
//
//   * A day with nothing spent is recorded ON PURPOSE (expense_day_marks),
//     so the grid can tell "checked, nothing" from "nobody entered it". A
//     forgotten day makes a station look CHEAPER than it is, and nothing
//     else in the app can catch it — there is no row to catch.
//
//   * Categories can be added, which the paddy types deliberately cannot.
//     The paddy list broke because each DEVICE kept its own copy; this list
//     lives in the database and two people use it. What is guarded is adding
//     one that already exists under a spelling nobody can see — see
//     nearlyTheSame() in expenseCategories.js.
//
//   * Correcting a figure is retyping it, not a form. The password is asked
//     only when reaching back past today or into someone else's entry. The
//     change is recorded either way; the password governs how far back you
//     are reaching, not whether it is written down.

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Lock, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { supabase, getAccurateNow } from "../supabaseClient.js";
import { errText } from "../errText.js";
import {
  categoryList, categoryKey, cleanCategory, isCommission, nearlyTheSame, splitByCategory,
} from "../expenseCategories.js";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }

// Cambodia's calendar date, independent of the device clock — the same
// helper every other page uses to stamp a business date.
function cambodiaDateStr(d = getAccurateNow()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function monthOf(dateStr) { return (dateStr || "").slice(0, 7); }
function daysInMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function shiftMonth(ym, by) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function dayStr(ym, day) { return `${ym}-${String(day).padStart(2, "0")}`; }
function weekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${["January","February","March","April","May","June","July","August","September","October","November","December"][m - 1]} ${y}`;
}

// Plain digits in, grouped figure beside the box. Typing punctuation five
// stations by six categories a day is where mistakes come from.
function parseAmount(text) {
  const cleaned = String(text ?? "").replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const amountCls = `${inputCls} text-right tabular-nums`;

// ───────────────────────────────────────────────────────────────────────────
// Adding a category
// ───────────────────────────────────────────────────────────────────────────

function AddCategory({ existing, onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [forced, setForced] = useState(false);

  const match = useMemo(
    () => (forced ? null : nearlyTheSame(name, existing)),
    [name, existing, forced],
  );
  const clean = cleanCategory(name);
  // An exact match is not a new category at all — it IS that category, so
  // there is nothing to create and no "no, this is different" to offer.
  const blocked = !clean || (match && match.exact);

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
      <label className="mb-1 block text-xs font-medium text-slate-500">New category</label>
      <input
        autoFocus value={name}
        onChange={(e) => { setName(e.target.value); setForced(false); }}
        placeholder="e.g. Rent"
        className={inputCls}
      />
      {match && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-sm font-medium text-amber-800">
            {match.exact ? <>“{match.name}” is already on the list.</> : <>Did you mean “{match.name}”?</>}
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            {match.exact
              ? "Use it from the list above rather than adding it twice."
              : "Two spellings of one category sit side by side on every report from then on."}
          </p>
          {!match.exact && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => { onAdd(match.name); }}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                Use “{match.name}”
              </button>
              <button type="button" onClick={() => setForced(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                No, this is different
              </button>
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={blocked} onClick={() => onAdd(clean)}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40">
          Add
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// One day, one station — the sheet
// ───────────────────────────────────────────────────────────────────────────

function DaySheet({
  day, setDay, locationId, setLocationId, locations, categories, existingRows,
  onSave, onMarkEmpty, saving, error, nextStationName, doneCount, canEdit, editLocked,
}) {
  const [amounts, setAmounts] = useState({});
  const [extra, setExtra] = useState([]);       // categories added this session
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState("");

  // Reopening a day that already has figures loads them, so correcting one
  // is retyping it in place rather than hunting for a row in a log.
  useEffect(() => {
    const next = {};
    for (const row of existingRows) {
      const key = categoryKey(row.category);
      next[key] = String(Math.round(Number(row.amount) || 0));
    }
    setAmounts(next);
    setReason("");
  }, [day, locationId, existingRows.length]);

  const shown = useMemo(() => {
    const seen = new Set();
    const out = [];
    const push = (name) => {
      const key = categoryKey(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(name);
    };
    categories.forEach(push);
    extra.forEach(push);
    // Anything already recorded on this day stays visible even if it is no
    // longer on the list, or the figure would silently disappear.
    existingRows.forEach((r) => push(r.category));
    return out;
  }, [categories, extra, existingRows]);

  const total = shown.reduce((s, name) => s + (parseAmount(amounts[categoryKey(name)]) || 0), 0);
  const anythingTyped = shown.some((name) => parseAmount(amounts[categoryKey(name)]) != null);

  // Amending a day that is not today, or one somebody else entered, asks for
  // a reason. Today's own typing does not.
  const needsReason = editLocked && existingRows.length > 0;

  function submit() {
    const entries = shown
      .map((name) => ({ category: name, amount: parseAmount(amounts[categoryKey(name)]) }))
      .filter((e) => e.amount != null);
    onSave({ entries, reason: reason.trim() });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Station</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <p className="text-xs text-slate-400 sm:pb-2">
          {doneCount} of {locations.length} entered
          {nextStationName ? <> · {nextStationName} next</> : null}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        {shown.map((name, i) => {
          const key = categoryKey(name);
          const value = amounts[key] ?? "";
          const parsed = parseAmount(value);
          return (
            <div key={key}
              className={`flex items-center gap-3 px-3 py-2 ${i ? "border-t border-slate-100" : ""} ${isCommission(name) ? "bg-amber-50/60" : ""}`}>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                {name}
                {isCommission(name) && (
                  <span className="ml-2 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                    Commission
                  </span>
                )}
              </span>
              <span className="w-24 text-right text-xs tabular-nums text-slate-400">
                {parsed != null ? fmt(parsed) : ""}
              </span>
              <input
                inputMode="numeric" value={value}
                onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter" && !saving) submit(); }}
                className={`${amountCls} w-32`} placeholder="—"
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        {adding ? (
          <AddCategory
            existing={shown}
            onAdd={(name) => { setExtra((x) => [...x, name]); setAdding(false); }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          canEdit && (
            <button type="button" onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-slate-50">
              <Plus size={14} /> Add a category
            </button>
          )
        )}
      </div>

      <div className="mt-4 flex items-baseline justify-between border-t border-slate-200 pt-3">
        <span className="text-sm font-semibold text-slate-600">Total for the day</span>
        <span className="text-lg font-bold tabular-nums text-slate-800">{fmtRiel(total)}</span>
      </div>

      {needsReason && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Lock size={12} /> This day is not today — say why it is changing
          </label>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Station sent a corrected sheet" className={inputCls} />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={submit}
            disabled={saving || (needsReason && !reason.trim())}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save &amp; next station
          </button>
          {!anythingTyped && existingRows.length === 0 && (
            <button type="button" onClick={onMarkEmpty} disabled={saving}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Nothing spent this day
            </button>
          )}
          <p className="text-xs text-slate-400">Type plain numbers. Enter saves.</p>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// The month grid — every day, every station
// ───────────────────────────────────────────────────────────────────────────

function MonthGrid({ ym, locations, rows, marks, onOpenDay }) {
  const byCell = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const k = `${r.pay_date}|${r.location_id}`;
      map.set(k, (map.get(k) || 0) + (Number(r.amount) || 0));
    }
    return map;
  }, [rows]);

  const markSet = useMemo(
    () => new Set(marks.map((m) => `${String(m.day).slice(0, 10)}|${m.location_id}`)),
    [marks],
  );

  const days = Array.from({ length: daysInMonth(ym) }, (_, i) => i + 1);
  const today = cambodiaDateStr();
  const colTotals = {};
  let grand = 0;

  const body = days.map((d) => {
    const iso = dayStr(ym, d);
    if (iso > today) return null;
    let dayTotal = 0;
    const cells = locations.map((l) => {
      const key = `${iso}|${l.id}`;
      const amount = byCell.get(key);
      if (amount != null) {
        dayTotal += amount;
        colTotals[l.id] = (colTotals[l.id] || 0) + amount;
      }
      return { l, amount, marked: markSet.has(key) };
    });
    grand += dayTotal;
    return { iso, d, cells, dayTotal };
  }).filter(Boolean);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
            <th className="py-2 pr-3 text-left font-semibold">{monthLabel(ym).split(" ")[0]}</th>
            {locations.map((l) => <th key={l.id} className="py-2 pl-3 text-right font-semibold">{l.name}</th>)}
            <th className="py-2 pl-3 text-right font-semibold">Day total</th>
          </tr>
        </thead>
        <tbody>
          {body.map(({ iso, d, cells, dayTotal }) => (
            <tr key={iso} className="border-b border-slate-50">
              <td className="py-1.5 pr-3 text-slate-500">
                <span className="font-semibold text-slate-700">{d}</span>{" "}
                <span className="text-[11px] text-slate-400">{weekdayOf(iso)}</span>
              </td>
              {cells.map(({ l, amount, marked }) => (
                <td key={l.id} className="py-1.5 pl-3 text-right tabular-nums">
                  {amount != null ? (
                    <button type="button" onClick={() => onOpenDay(iso, l.id)}
                      className="rounded px-1 text-slate-700 hover:bg-slate-100 hover:underline">
                      {fmt(amount)}
                    </button>
                  ) : marked ? (
                    // Checked, and nothing was spent. Not the same as blank.
                    <span className="text-slate-400" title="Nothing spent — recorded">0</span>
                  ) : (
                    <button type="button" onClick={() => onOpenDay(iso, l.id)}
                      className="rounded px-1 text-slate-200 hover:bg-slate-100" title="Nobody has entered this day">
                      —
                    </button>
                  )}
                </td>
              ))}
              <td className="py-1.5 pl-3 text-right font-semibold tabular-nums text-slate-700">{fmt(dayTotal)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 font-bold">
            <td className="py-2 pr-3 text-slate-700">Total</td>
            {locations.map((l) => (
              <td key={l.id} className="py-2 pl-3 text-right tabular-nums text-slate-800">{fmt(colTotals[l.id] || 0)}</td>
            ))}
            <td className="py-2 pl-3 text-right tabular-nums text-slate-900">{fmt(grand)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-400">
        <b className="text-slate-500">0</b> — the station spent nothing and someone said so.
        <b className="ml-2 text-slate-500">—</b> — nobody has entered it.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// What looks wrong
// ───────────────────────────────────────────────────────────────────────────

function buildChecks({ ym, locations, rows, marks, prevRows }) {
  const out = [];
  const today = cambodiaDateStr();

  // 1. A station spending far more than it did last month.
  const thisBy = {}, prevBy = {};
  rows.forEach((r) => { thisBy[r.location_id] = (thisBy[r.location_id] || 0) + Number(r.amount || 0); });
  prevRows.forEach((r) => { prevBy[r.location_id] = (prevBy[r.location_id] || 0) + Number(r.amount || 0); });
  for (const l of locations) {
    const now = thisBy[l.id] || 0;
    const before = prevBy[l.id] || 0;
    // Needs a real base to compare against, or every small station trips it.
    if (before > 100000 && now > before * 1.4) {
      out.push({
        kind: "Up",
        lead: `${l.name} has spent ${fmtRiel(now - before)} more than last month`,
        why: `${fmtRiel(now)} against ${fmtRiel(before)}.`,
      });
    }
  }

  // 2. A station that has stopped being entered. Judged against its own
  //    record: a station that never reports daily is not "missing".
  const lastSeen = {};
  rows.forEach((r) => {
    if (!lastSeen[r.location_id] || r.pay_date > lastSeen[r.location_id]) lastSeen[r.location_id] = r.pay_date;
  });
  marks.forEach((m) => {
    const day = String(m.day).slice(0, 10);
    if (!lastSeen[m.location_id] || day > lastSeen[m.location_id]) lastSeen[m.location_id] = day;
  });
  for (const l of locations) {
    const last = lastSeen[l.id];
    if (!last) continue;
    const gap = Math.round((Date.parse(today) - Date.parse(last)) / 86400000);
    if (gap >= 5) {
      out.push({
        kind: "Missing",
        lead: `${l.name} — nothing entered since ${last}`,
        why: `${gap} days. An unrecorded day makes a station look cheaper than it is.`,
      });
    }
  }

  // 3. The same figure twice on the same day — a slow save pressed again.
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.pay_date}|${r.location_id}|${categoryKey(r.category)}|${Math.round(Number(r.amount) || 0)}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  for (const [k, count] of seen) {
    if (count < 2) continue;
    const [date, locId, , amount] = k.split("|");
    const l = locations.find((x) => x.id === locId);
    out.push({
      kind: "Twice",
      lead: `${fmtRiel(Number(amount))} · ${l?.name || "—"} · ${date}`,
      why: `Recorded ${count} times with the same category and amount.`,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────

export default function Expenses() {
  const { session, profile, can, isViewOnly } = useAuth();
  const isOwner = !!profile?.isOwner;
  const canRecord = isOwner || can("record_expenses");
  const canEditAny = (isOwner || can("edit_expenses")) && !isViewOnly;

  const [locations, setLocations] = useState([]);
  const [allExpenses, setAllExpenses] = useState([]);
  const [marks, setMarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const today = cambodiaDateStr();
  const [ym, setYm] = useState(monthOf(today));
  const [day, setDay] = useState(today);
  const [locationId, setLocationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pwPrompt, setPwPrompt] = useState(null);

  async function load() {
    setLoading(true); setLoadError("");
    try {
      const [locs, exp, dm] = await Promise.all([
        api.getLocations(),
        api.getPayments({ type: "expense" }),
        api.getExpenseDayMarks().catch(() => []),
      ]);
      setLocations(locs || []);
      setAllExpenses(exp || []);
      setMarks(dm || []);
      if (!locationId && locs?.length) setLocationId(locs[0].id);
    } catch (err) {
      setLoadError(errText(null, err, "") || err.message || "Couldn't load expenses.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const monthRows = useMemo(() => allExpenses.filter((r) => monthOf(r.pay_date) === ym), [allExpenses, ym]);
  const prevRows = useMemo(() => allExpenses.filter((r) => monthOf(r.pay_date) === shiftMonth(ym, -1)), [allExpenses, ym]);
  const monthMarks = useMemo(() => marks.filter((m) => String(m.day).slice(0, 7) === ym), [marks, ym]);

  const categories = useMemo(() => categoryList(allExpenses), [allExpenses]);
  const thisMonth = useMemo(() => splitByCategory(monthRows), [monthRows]);
  const lastMonth = useMemo(() => splitByCategory(prevRows), [prevRows]);

  const prevByKey = useMemo(() => {
    const m = new Map();
    lastMonth.categories.forEach((c) => m.set(categoryKey(c.category), c.amount));
    return m;
  }, [lastMonth]);

  const byStation = useMemo(() => {
    const now = {}, before = {};
    monthRows.forEach((r) => { now[r.location_id] = (now[r.location_id] || 0) + Number(r.amount || 0); });
    prevRows.forEach((r) => { before[r.location_id] = (before[r.location_id] || 0) + Number(r.amount || 0); });
    return locations
      .map((l) => ({ l, now: now[l.id] || 0, before: before[l.id] || 0 }))
      .sort((a, b) => b.now - a.now);
  }, [locations, monthRows, prevRows]);

  // Today's progress across the stations — what the person typing needs.
  const todayState = useMemo(() => {
    const entered = new Set(allExpenses.filter((r) => r.pay_date === today).map((r) => r.location_id));
    const nothing = new Set(marks.filter((m) => String(m.day).slice(0, 10) === today).map((m) => m.location_id));
    return locations.map((l) => ({
      l,
      state: entered.has(l.id) ? "done" : nothing.has(l.id) ? "zero" : "todo",
    }));
  }, [locations, allExpenses, marks, today]);

  const nextStation = todayState.find((s) => s.state === "todo" && s.l.id !== locationId)?.l;
  const doneCount = todayState.filter((s) => s.state !== "todo").length;

  const sheetRows = useMemo(
    () => allExpenses.filter((r) => r.pay_date === day && r.location_id === locationId),
    [allExpenses, day, locationId],
  );

  // Reaching back past today, or into a day someone else entered, is what
  // asks for a password. Today's own typing does not.
  const editLocked = day !== today
    || sheetRows.some((r) => r.created_by && r.created_by !== session?.user?.id);

  const checks = useMemo(
    () => buildChecks({ ym, locations, rows: monthRows, marks: monthMarks, prevRows }),
    [ym, locations, monthRows, monthMarks, prevRows],
  );

  async function reallySave({ entries, reason }) {
    setSaving(true); setSaveError("");
    try {
      const existingByKey = new Map(sheetRows.map((r) => [categoryKey(r.category), r]));
      for (const entry of entries) {
        const key = categoryKey(entry.category);
        const existing = existingByKey.get(key);
        if (existing) {
          if (Math.round(Number(existing.amount) || 0) === Math.round(entry.amount)) continue;
          await api.updateExpense(existing.id, {
            amount: entry.amount, reason, userId: session.user.id,
          });
        } else {
          await api.createPayment({
            type: "expense", category: entry.category, transactionId: null,
            locationId, amount: entry.amount, method: "cash", payDate: day,
            memo: null, userId: session.user.id,
          });
        }
      }
      // Money on a day contradicts "nothing spent" — the money wins.
      if (entries.length) {
        await api.clearExpenseDayMark({ locationId, day }).catch(() => {});
      }
      await load();
      if (nextStation) setLocationId(nextStation.id);
    } catch (err) {
      setSaveError(errText(null, err, "") || err.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  function handleSave(payload) {
    if (!payload.entries.length) { setSaveError("Nothing to save. Use “Nothing spent this day” if that is the case."); return; }
    if (editLocked) { setPwPrompt(payload); return; }
    reallySave(payload);
  }

  async function markEmpty() {
    setSaving(true); setSaveError("");
    try {
      await api.markExpenseDayEmpty({ locationId, day, userId: session.user.id });
      await load();
      if (nextStation) setLocationId(nextStation.id);
    } catch (err) {
      setSaveError(err.message || "Could not record that.");
    } finally {
      setSaving(false);
    }
  }

  const monthTotal = thisMonth.total;
  const prevTotal = lastMonth.total;

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Expenses" subtitle="A day at a time, a station at a time" />
      <main className="flex-1 overflow-y-auto bg-paper p-6">
        <div className="mx-auto max-w-5xl space-y-6">

          {loadError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</div>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          )}

          {!loading && (
            <>
              {/* ── Today ─────────────────────────────────────────────── */}
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Today</h2>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap gap-2">
                    {todayState.map(({ l, state }) => (
                      <button key={l.id} type="button"
                        onClick={() => { setDay(today); setLocationId(l.id); }}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                          l.id === locationId ? "border-slate-800 text-slate-800"
                          : state === "done" ? "border-brand-500 text-brand-700"
                          : state === "zero" ? "border-slate-300 text-slate-500"
                          : "border-slate-200 text-slate-400"}`}>
                        {l.name}
                        {state === "done" && <Check size={13} className="ml-1.5 inline" />}
                        {state === "zero" && <span className="ml-1.5 tabular-nums">0</span>}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2.5 text-xs text-slate-400">
                    {today} · <b className="text-slate-500">{doneCount} of {locations.length} entered</b>
                  </p>
                </div>
              </section>

              {/* ── The sheet ─────────────────────────────────────────── */}
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                  {sheetRows.length ? "This day" : "Enter a day"}
                </h2>
                {locationId && (
                  <DaySheet
                    day={day} setDay={setDay}
                    locationId={locationId} setLocationId={setLocationId}
                    locations={locations} categories={categories} existingRows={sheetRows}
                    onSave={handleSave} onMarkEmpty={markEmpty}
                    saving={saving} error={saveError}
                    nextStationName={nextStation?.name} doneCount={doneCount}
                    canEdit={canRecord && !isViewOnly} editLocked={editLocked && !canEditAny ? false : editLocked}
                  />
                )}
                {!canRecord && (
                  <p className="mt-2 text-xs text-slate-400">Your account can view expenses but not record them.</p>
                )}
              </section>

              {/* ── Month header ──────────────────────────────────────── */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">{monthLabel(ym)}</h2>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setYm(shiftMonth(ym, -1))}
                      className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50"><ChevronLeft size={14} /></button>
                    <button type="button" disabled={ym >= monthOf(today)} onClick={() => setYm(shiftMonth(ym, 1))}
                      className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronRight size={14} /></button>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-3xl font-bold tabular-nums text-slate-800">{fmtRiel(monthTotal)}</p>
                  <p className="mt-1 text-sm text-slate-500 tabular-nums">
                    {prevTotal
                      ? <>{fmtRiel(Math.abs(monthTotal - prevTotal))} {monthTotal >= prevTotal ? "more" : "less"} than {monthLabel(shiftMonth(ym, -1)).split(" ")[0]}</>
                      : <>Nothing recorded the month before</>}
                  </p>
                </div>
              </section>

              {/* ── On what / Where ───────────────────────────────────── */}
              <div className="grid gap-6 md:grid-cols-2">
                <section>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">On what</h2>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <table className="w-full text-sm">
                      <tbody>
                        {thisMonth.categories.map((c) => (
                          <tr key={c.category} className="border-b border-slate-50 last:border-0">
                            <td className="py-2 pr-3 text-slate-700">
                              {c.category}
                              {isCommission(c.category) && (
                                <span className="ml-2 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                  Commission
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-right tabular-nums text-slate-800">
                              {fmt(c.amount)}
                              <span className="block text-[11px] text-slate-400">
                                prev {fmt(prevByKey.get(categoryKey(c.category)) || 0)}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {!thisMonth.categories.length && (
                          <tr><td className="py-3 text-sm text-slate-400">Nothing recorded this month.</td></tr>
                        )}
                        <tr className="border-t-2 border-slate-300 font-bold">
                          <td className="py-2 pr-3 text-slate-700">Total</td>
                          <td className="py-2 text-right tabular-nums text-slate-900">{fmt(thisMonth.total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Where</h2>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <table className="w-full text-sm">
                      <tbody>
                        {byStation.map(({ l, now, before }) => (
                          <tr key={l.id} className="border-b border-slate-50 last:border-0">
                            <td className="py-2 pr-3 text-slate-700">{l.name}</td>
                            <td className="py-2 text-right tabular-nums text-slate-800">
                              {fmt(now)}
                              <span className="block text-[11px] text-slate-400">prev {fmt(before)}</span>
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-slate-300 font-bold">
                          <td className="py-2 pr-3 text-slate-700">Total</td>
                          <td className="py-2 text-right tabular-nums text-slate-900">{fmt(monthTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              {/* ── The grid ──────────────────────────────────────────── */}
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Every day, every station</h2>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <MonthGrid
                    ym={ym} locations={locations} rows={monthRows} marks={monthMarks}
                    onOpenDay={(iso, locId) => { setDay(iso); setLocationId(locId); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  />
                </div>
              </section>

              {/* ── Checks ────────────────────────────────────────────── */}
              {checks.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                    Check these <span className="text-slate-300">· {checks.length}</span>
                  </h2>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    {checks.map((c, i) => (
                      <div key={i} className={`flex gap-3 py-3 ${i ? "border-t border-slate-50" : ""}`}>
                        <span className="h-fit rounded bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">{c.kind}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700">{c.lead}</p>
                          <p className="text-xs text-slate-500">{c.why}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {pwPrompt && (
        <ConfirmPassword
          onCancel={() => setPwPrompt(null)}
          onConfirmed={() => { const p = pwPrompt; setPwPrompt(null); reallySave(p); }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Password, only for reaching back
// ───────────────────────────────────────────────────────────────────────────

function ConfirmPassword({ onCancel, onConfirmed }) {
  const { session } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      // Re-authenticating in place, the same check used before a weight is
      // changed. Deliberately NOT a second login — the session is untouched.
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: session.user.email, password,
      });
      if (authErr) { setError("That password is not right."); setBusy(false); return; }
      onConfirmed();
    } catch (err) {
      setError(err.message || "Could not confirm.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700">
          <Lock size={16} className="text-slate-400" /> Confirm it is you
        </h3>
        <p className="mb-3 text-xs text-slate-400">
          You are changing a day that is not today, or one somebody else entered.
        </p>
        <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password" className={inputCls} />
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={busy || !password}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? "Checking…" : "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}
