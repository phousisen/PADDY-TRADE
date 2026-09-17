// Expenses — one table, and a day sheet behind a button.
//
// [2026-09-16] Rebuilt twice in a day, and the second rebuild is the one that
// matters. SISEN, on the first: "too many boxes, why not customize it and
// make it more convinient" and "we focus on eevryday, week, month and year
// data".
//
// The first version was six cards — a scope card, a total card, "On what",
// "Where", a month grid and a checks card. Three of those were the same rows
// grouped three ways, so they are now ONE table with a Rows-by switch, and
// everything that steers it sits on one line across the top.
//
// WHAT THE SCREEN IS
//
//   * A REPORT when you open it. The entry sheet only exists once you press
//     "Enter a day" — SISEN: "the enter a day part for expense should only
//     load up when we click on opening expense ticket."
//
//   * Day / Week / Month / Year, the same four grains as the Daily Book, and
//     the same rule underneath: every level is the same rows added up, so a
//     month can never disagree with the days inside it.
//
//   * ថ្លៃកូនដៃ on its own column at every level, never inside a total. It is
//     a commission paid per kilo to one staff member per station, SISEN is
//     cutting it, and it cannot be seen to move if it is averaged with
//     salary. See expenseCategories.js.
//
//   * One station's day per sheet. The first attempt showed the stations as
//     ticked chips, which read as a multi-select; SISEN: "how can we tick so
//     many location in one ticket? because all spending for each location are
//     different." They are now a picker where exactly one is plainly current.
//
//   * Opening a day loads what is already on it, so a forgotten expense goes
//     into its empty box rather than becoming a second entry.
//
//   * Correcting a figure that is already there asks for a password and a
//     reason; adding to an empty box does not. The password is about how far
//     back you are reaching, not about whether the change is recorded — it is
//     recorded either way, in audit_logs.

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Lock, Plus, ChevronRight, X } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import ExpenseSheetPrint from "../components/ExpenseSheetPrint.jsx";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { useLanguage } from "../i18n.jsx";
import { supabase, getAccurateNow } from "../supabaseClient.js";
import { errText } from "../errText.js";
import {
  categoryList, categoryKey, cleanCategory, isCommission, nearlyTheSame,
} from "../expenseCategories.js";
import {
  windowFor, shiftAnchor, filterRows, totals, byPeriod, byCategory, byStation,
  stationsOn, childGrain, daysInWindow, mergeByCategory, periodLabel,
} from "../expenseBook.js";
import { checkCommission, MAX_PER_TONNE } from "../commissionRule.js";
import { dmyTime, weekday } from "../dateFormat.js";
import { useRefetchSignal } from "../useRefetchSignal.js";

const fmt = (n) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));
const riel = (n) => `${fmt(n)} ៛`;

function cambodiaDateStr(d = getAccurateNow()) {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}

// Plain digits in; the grouped figure is shown beside the box. Typing
// punctuation five stations by six categories a day is where mistakes start.
function parseAmount(text) {
  const cleaned = String(text ?? "").replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// [2026-09-16] fieldBase carries no width. Appending `w-32` to a class string
// that already has `w-full` does NOT override it — Tailwind emits `w-full`
// after the numeric widths, so the box took the whole row and the category
// name beside it (min-w-0, truncate) collapsed to nothing. That shipped, and
// the sheet arrived as a column of blank rows.
const fieldBase = "rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const inputCls = `w-full ${fieldBase}`;
const amountCls = `${fieldBase} text-right tabular-nums`;

const GRAINS = [["day", "ex_day"], ["week", "ex_week"], ["month", "ex_month"], ["year", "ex_year"]];
const GROUPS = [["period", "ex_by_period"], ["category", "ex_by_category"], ["station", "ex_by_station"]];

// ───────────────────────────────────────────────────────────── segmented ──

// options are [value, i18n key] — the label is translated here so no
// screen has to hold an English word to pass in.
function Seg({ options, value, onChange, t }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
      {options.map(([v, label], i) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-xs font-semibold ${i ? "border-l border-slate-200" : ""} ${
            v === value ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50"}`}>
          {t(label)}
        </button>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────── one station, inside a day ──
//
// [2026-09-17] SISEN: "i want to be able to see what the spending is on each
// day" — and then, precisely: "for each location".
//
// Opening a day used to give five thin table rows, each with a commission
// figure, an other figure and a total. Three numbers per station and not one
// word about what the money was actually spent on — which is the only thing
// anyone opens a day to find out.
//
// `only` is true when the location picker has one station chosen. There is
// then nothing to label, so the station header is dropped and the categories
// sit directly under the day. A card headed "JOMNOUM" on a screen that
// already says JOMNOUM twice is furniture.
function DayStation({ station, tonnage, only, canRecord, onOpen, t }) {
  // The station's own rows, added up per category. A station can record the
  // same category twice in a day (a second fuel run), and those belong on one
  // line — two lines reading "ប្រេងឥន្ធនៈ" would look like a mistake.
  const lines = useMemo(() => {
    const m = new Map();
    for (const r of station.rows || []) {
      const key = categoryKey(r.category);
      const name = cleanCategory(r.category) || "—";
      const prev = m.get(key) || { key, name, amount: 0, kh: isCommission(r.category) };
      prev.amount += Number(r.amount) || 0;
      m.set(key, prev);
    }
    // ថ្លៃកូនដៃ first wherever it appears — it is the one being watched.
    return [...m.values()].sort((a, b) => (b.kh - a.kh) || (b.amount - a.amount));
  }, [station.rows]);

  const filed = station.state === "spent";
  const nothing = station.state === "nothing";

  // [2026-09-17] The ថ្លៃកូនដៃ check. SISEN: "normally every tons the
  // commision is 10,000riels max". The tonnes come from the tickets already
  // recorded at this station on this day — nothing new is typed, so this
  // cannot disagree with the Daily Book. See commissionRule.js, whose every
  // branch is run in scripts-check-commission.mjs.
  const check = checkCommission({
    commission: station.commission,
    boughtKg: tonnage?.boughtKg,
    soldKg: tonnage?.soldKg,
  });
  const ton = (v) => (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Tonnes in, tonnes out. Shown whenever the day has either, even if no
  // commission was paid — a station that bought 40 tonnes and recorded no
  // ថ្លៃកូនដៃ is worth noticing too.
  const Tons = () => (
    (tonnage?.boughtKg || tonnage?.soldKg) ? (
      <div className="flex gap-px border-y border-slate-100 bg-slate-100">
        <div className="min-w-0 flex-1 bg-slate-50/80 px-2.5 py-1">
          <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400">{t("db_buy")}</p>
          <p className="whitespace-nowrap text-[12.5px] font-bold tabular-nums text-brand-700">
            {ton(check.tonnesBought)}<span className="ml-0.5 text-[9.5px] font-semibold text-slate-400">{t("ex_tonne")}</span>
          </p>
        </div>
        <div className="min-w-0 flex-1 bg-slate-50/80 px-2.5 py-1">
          <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400">{t("db_sell")}</p>
          <p className="whitespace-nowrap text-[12.5px] font-bold tabular-nums text-orange-700">
            {ton(check.tonnesSold)}<span className="ml-0.5 text-[9.5px] font-semibold text-slate-400">{t("ex_tonne")}</span>
          </p>
        </div>
        {/* The rate as its own figure, from sm: up. On a phone it is in the
            sentence below instead — three columns of numbers on a 320pt
            screen is how a figure ends up truncated. */}
        {check.perTonne !== null && station.commission > 0 && (
          <div className="hidden min-w-0 flex-1 bg-slate-50/80 px-2.5 py-1 sm:block">
            <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400">{t("ex_per_tonne")}</p>
            <p className={`whitespace-nowrap text-[12.5px] font-bold tabular-nums ${
              check.state === "over" ? "text-rose-700" : check.state === "at" ? "text-amber-700" : "text-brand-700"}`}>
              {fmt(check.perTonne)}
            </p>
          </div>
        )}
      </div>
    ) : null
  );

  // One line, and it has to be readable by someone who will act on it. An
  // "over" says BY HOW MUCH in riel — a warning triangle on its own tells
  // nobody what to do, and this is a line that can end in a conversation
  // with a staff member.
  const Check = () => {
    if (!filed || station.commission <= 0) return null;
    const tone = check.state === "over"
      ? "bg-rose-50 text-rose-700"
      : check.state === "at" ? "bg-amber-50 text-amber-800"
      : check.state === "unknown" ? "bg-slate-50 text-slate-500"
      : "bg-brand-50 text-brand-700";
    const dot = check.state === "over" ? "bg-rose-600" : check.state === "at" ? "bg-amber-500"
      : check.state === "unknown" ? "bg-slate-300" : "bg-brand-600";
    const mark = check.state === "over" ? "!" : check.state === "at" ? "≈" : check.state === "unknown" ? "?" : "✓";
    return (
      <div className={`flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] ${tone}`}>
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9.5px] font-extrabold text-white ${dot}`}>{mark}</span>
        <span className="min-w-0 flex-1">
          {check.state === "over"
            ? <>{t("ex_kh_over")} <b className="font-extrabold tabular-nums">{fmt(check.overBy)}</b> ៛</>
            : check.state === "at" ? t("ex_kh_at")
            : check.state === "unknown" ? t("ex_kh_unknown")
            : <>{t("ex_kh_ok")} <span className="tabular-nums">{fmt(check.ceiling)}</span></>}
        </span>
        {check.perTonne !== null && (
          <span className="shrink-0 whitespace-nowrap font-extrabold tabular-nums sm:hidden">
            {fmt(check.perTonne)} ៛/{t("ex_tonne")}
          </span>
        )}
      </div>
    );
  };

  const Lines = () => (
    <div className={only ? "" : "px-3 pb-2.5"}>
      {lines.map((l) => (
        <div key={l.key}
          className="ml-0.5 flex items-baseline justify-between gap-2.5 border-l-2 border-slate-100 py-1 pl-3 text-[12.5px]">
          <span className={`min-w-0 truncate ${l.kh ? "font-semibold text-amber-700" : "text-slate-500"}`}>{l.name}</span>
          <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-slate-700">{fmt(l.amount)}</span>
        </div>
      ))}
    </div>
  );

  // ── one station chosen: no card, no header, just the categories ──
  if (only) {
    if (!filed) {
      return (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2.5">
          <span className="flex-1 text-[12.5px] text-slate-400">
            {nothing ? t("ex_nothing_spent") : t("ex_not_entered")}
          </span>
          {canRecord && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-[11.5px] font-bold text-white hover:bg-brand-700">
              {t("ex_enter")}
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <Tons />
        <Check />
        <div className="px-3 pb-2.5 pt-2"><Lines /></div>
        <div className="flex items-center gap-2.5 border-t border-slate-100 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-slate-400">{station.enteredBy || ""}</span>
          <span className="shrink-0 whitespace-nowrap text-[13px] font-extrabold tabular-nums text-slate-900">{fmt(station.total)}</span>
          {canRecord && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700">
              {t("ex_open")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── all locations: one card per station ──
  return (
    <div className={`mb-1.5 overflow-hidden rounded-lg border bg-white last:mb-0 ${
      filed ? "border-slate-200" : "border-dashed border-slate-200 bg-slate-50/50"}`}>
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className={`min-w-0 flex-1 truncate text-[12.5px] font-bold ${filed ? "text-slate-900" : "text-slate-400"}`}>
          {station.name}
          {!filed && (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-500">
              {nothing ? t("ex_nothing_spent") : t("ex_not_entered")}
            </span>
          )}
        </span>
        <span className={`shrink-0 whitespace-nowrap text-[13px] font-extrabold tabular-nums ${
          filed ? "text-slate-900" : "text-slate-300"}`}>
          {filed ? fmt(station.total) : "—"}
        </span>
        {canRecord && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${
              filed
                ? "border border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700"
                : "bg-brand-600 font-bold text-white hover:bg-brand-700"}`}>
            {filed ? t("ex_open") : t("ex_enter")}
          </button>
        )}
      </div>
      {filed && <Tons />}
      {filed && <Check />}
      {filed && lines.length > 0 && <Lines />}
    </div>
  );
}

// ─────────────────────────────────────────────────────── add a category ──

function AddCategory({ existing, onAdd, onCancel }) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [forced, setForced] = useState(false);
  const match = useMemo(() => (forced ? null : nearlyTheSame(name, existing)), [name, existing, forced]);
  const clean = cleanCategory(name);
  const blocked = !clean || (match && match.exact);

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
      <label className="mb-1 block text-xs font-medium text-slate-500">{t("ex_new_category")}</label>
      <input autoFocus value={name} placeholder={t("ex_new_cat_ph")} className={inputCls}
        onChange={(e) => { setName(e.target.value); setForced(false); }} />
      {match && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-sm font-medium text-amber-800">
            {match.exact ? <>“{match.name}” is already on the list.</> : <>Did you mean “{match.name}”?</>}
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            {match.exact
              ? "Use it from the list rather than adding it twice."
              : "Two spellings of one category sit side by side on every report from then on."}
          </p>
          {!match.exact && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => onAdd(match.name)}
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
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40">{t("ex_add")}</button>
        <button type="button" onClick={onCancel}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50">{t("ex_cancel")}</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────── day sheet ──

function DaySheet({
  day, setDay, locationId, setLocationId, locations, categories, existingRows,
  dayStates, onSave, saving, error, canEdit, needsPassword, onClose,
  edits, justSaved, unlocked, onUnlock,
}) {
  const { t } = useLanguage();
  const [amounts, setAmounts] = useState({});
  const [extra, setExtra] = useState([]);
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState("");

  // [2026-09-16] Was: next[key] = that row's amount — which kept only the
  // LAST of any duplicate pair. The sheet then showed one figure while the
  // day really held two, so the total on screen was lower than the truth and
  // saving corrected one row and left the other. Duplicates are SUMMED here,
  // and saving collapses them (see reallySave).
  const merged = useMemo(() => mergeByCategory(existingRows), [existingRows]);
  const dupes = useMemo(
    () => [...merged.values()].filter((m) => m.rows.length > 1),
    [merged],
  );

  useEffect(() => {
    const next = {};
    for (const [key, m] of merged) next[key] = String(Math.round(m.amount));
    setAmounts(next);
    setReason("");
    setExtra([]);
  }, [day, locationId, existingRows.length]);

  const shown = useMemo(() => {
    const seen = new Set(); const out = [];
    const push = (n) => { const k = categoryKey(n); if (k && !seen.has(k)) { seen.add(k); out.push(n); } };
    categories.forEach(push); extra.forEach(push);
    // A figure already on this day stays visible even if its category has
    // since gone from the list, or it would silently vanish.
    existingRows.forEach((r) => push(r.category));
    return out;
  }, [categories, extra, existingRows]);

  const total = shown.reduce((s, n) => s + (parseAmount(amounts[categoryKey(n)]) || 0), 0);

  // Changing a figure that is already recorded is a correction. Putting one
  // into an empty box is not. Compared against the MERGED figure, so a day
  // holding two rows for one category is judged on what it actually totals.
  const changesExisting = [...merged.values()].some((m) => {
    const typed = parseAmount(amounts[m.key]);
    return typed != null && Math.round(typed) !== Math.round(m.amount);
  });
  // Unlocking is the password step now, so what a change still needs is a
  // reason — kept in audit_logs beside the before and after.
  const mustExplain = changesExisting;

  function submit() {
    const entries = shown
      .map((n) => ({ category: n, amount: parseAmount(amounts[categoryKey(n)]) }))
      .filter((e) => e.amount != null);
    onSave({ entries, reason: reason.trim(), changesExisting });
  }

  const cur = locations.find((l) => l.id === locationId);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-6 w-full max-w-2xl rounded-xl border border-brand-500 bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 rounded-t-xl border-b border-brand-100 bg-brand-50 px-5 py-3">
          <div>
            <h3 className="font-semibold text-slate-800">{t("ex_enter_a_day")}</h3>
            <p className="text-xs text-slate-500">
              One station's spending at a time — this sheet is {cur?.name || "—"}'s {day}.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white"><X size={16} /></button>
        </div>

        <div className="p-5">
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("ex_which_station")}</label>
          <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {locations.map((l) => {
              const st = dayStates[l.id] || "blank";
              const isCur = l.id === locationId;
              return (
                <button key={l.id} type="button" onClick={() => setLocationId(l.id)}
                  className={`rounded-lg px-3 py-2 text-left ${
                    isCur ? "border-2 border-brand-600 bg-brand-50"
                          : st === "blank" ? "border border-slate-200 bg-white" : "border border-slate-200 bg-slate-50"}`}>
                  <span className={`block truncate text-[13px] font-bold ${isCur ? "text-slate-800" : "text-slate-500"}`}>
                    {l.name}{st !== "blank" && <Check size={12} className="ml-1 inline text-brand-600" />}
                  </span>
                  <span className={`block text-[11px] ${isCur ? "font-semibold text-brand-700" : "text-slate-400"}`}>
                    {isCur ? "Entering now" : st === "spent" ? "Entered" : st === "nothing" ? "Nothing spent" : "Not yet"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mb-4 w-48">
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("ex_date")}</label>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputCls} />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200">
            {shown.map((name, i) => {
              const key = categoryKey(name);
              const value = amounts[key] ?? "";
              const parsed = parseAmount(value);
              const saved = merged.get(key);
              // [2026-09-16] A figure already written is LOCKED — SISEN:
              // "make sure the written amount are locked if they need to edit
              // it, it will requires a password". An EMPTY box stays open:
              // adding a forgotten expense is not editing a recorded one.
              const locked = !!saved && !unlocked;
              const edit = saved ? edits?.[saved.rows[0].id] : null;
              return (
                <div key={key}
                  className={`flex items-center gap-3 px-3 py-2 ${i ? "border-t border-slate-100" : ""} ${isCommission(name) ? "bg-amber-50/70" : ""}`}>
                  <span className="min-w-0 flex-1 text-sm text-slate-700">
                    <span className="truncate">{name}</span>
                    {isCommission(name) && (
                      <span className="ml-2 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">{t("ex_commission")}</span>
                    )}
                    {edit && (
                      <span className="block text-[11px] text-slate-400">
                        {t("ex_changed_by")} {edit.by} · {dmyTime(edit.at)}
                        {edit.from != null && <> · {fmt(edit.from)} → {fmt(edit.to)}</>}
                      </span>
                    )}
                  </span>
                  {locked ? (
                    <span className="flex w-28 shrink-0 items-center justify-end gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold tabular-nums text-slate-700">
                      <Lock size={11} className="text-slate-400" />
                      {fmt(saved.amount)}
                    </span>
                  ) : (
                  <>
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-400">
                    {parsed != null ? fmt(parsed) : ""}
                  </span>
                  <input inputMode="numeric" value={value} placeholder="—"
                    onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter" && !saving) submit(); }}
                    className={`${amountCls} w-28 shrink-0`} />
                  </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3">
            {adding ? (
              <AddCategory existing={shown}
                onAdd={(n) => { setExtra((x) => [...x, n]); setAdding(false); }}
                onCancel={() => setAdding(false)} />
            ) : canEdit && (
              <button type="button" onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-slate-50">
                <Plus size={14} /> {t("ex_add_category")}
              </button>
            )}
          </div>

          {dupes.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {dupes.map((d) => (
                <p key={d.key}>
                  <b>{d.category}</b> {t("ex_dup_two_rows").replace("{n}", d.rows.length)} — {fmt(d.amount)} ៛.
                </p>
              ))}
              <p className="mt-1 text-xs text-amber-700">{t("ex_dup_merge_hint")}</p>
            </div>
          )}

          {mustExplain && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Lock size={12} /> {t("ex_say_why")}
              </label>
              <input value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={t("ex_reason_ph")} className={inputCls} />
            </div>
          )}

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <p className="text-sm text-slate-500">
            {t("ex_total_for_day")} <b className="ml-1 text-base tabular-nums text-slate-800">{riel(total)}</b>
            <span className="block text-[11px] text-slate-400">{t("ex_save_empty_hint")}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {justSaved && !saving && (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                <Check size={15} /> {t("ex_saved")}
              </span>
            )}
            {canEdit && merged.size > 0 && !unlocked && (
              <button type="button" onClick={onUnlock}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                <Lock size={13} /> {t("ex_unlock_to_edit")}
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={submit} disabled={saving || (mustExplain && !reason.trim())}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                {saving && <Loader2 size={14} className="animate-spin" />} {t("ex_save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────── the one table ──

// [2026-09-16] `hide` drops a column below sm.
//
// SISEN: "customize to fit different phone size to make it readable." This
// table was min-w-[560px] inside a sideways scroller on a 390pt phone, so
// the Total column — the one anyone opens this screen for — was off the
// edge of every row.
//
// Rather than rebuild a table with three grouping modes and expandable
// rows, the middle column stands down on a phone. It is the one figure
// here that can be worked out from the other two (total − ថ្លៃកូនដៃ), so
// it is the only one that can be spared. The desktop table is unchanged.
function Num({ v, cls = "", hide = false }) {
  return (
    <td className={`py-2 pl-2.5 text-right tabular-nums sm:pl-4 ${hide ? "hidden sm:table-cell" : ""} ${cls}`}>
      {v == null ? <span className="text-slate-300">—</span> : fmt(v)}
    </td>
  );
}

export default function Expenses() {
  const { t } = useLanguage();
  const { session, profile, can, isViewOnly } = useAuth();
  const isOwner = !!profile?.isOwner;
  const canRecord = (isOwner || can("record_expenses")) && !isViewOnly;

  const [locations, setLocations] = useState([]);
  const [allExpenses, setAllExpenses] = useState([]);
  const [allTx, setAllTx] = useState([]);
  // [2026-09-17] The printed sheet. Mounted only while printing — it builds
  // its own document in a hidden frame and unmounts itself when the dialog
  // closes. See ExpenseSheetPrint.jsx for why it does not print through the app.
  const [printing, setPrinting] = useState(false);
  const [marks, setMarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const today = cambodiaDateStr();
  const [grain, setGrain] = useState("day");
  const [group, setGroup] = useState("period");
  const [anchor, setAnchor] = useState(today);
  const [scope, setScope] = useState([]);            // [] = all locations
  const [openKey, setOpenKey] = useState(null);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const [sheet, setSheet] = useState(null);          // { day, locationId } | null
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pwPrompt, setPwPrompt] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  const [edits, setEdits] = useState({});
  const [unlocked, setUnlocked] = useState(false);
  const refetch = useRefetchSignal();

  async function load() {
    setLoading(true); setLoadError("");
    try {
      // [2026-09-17] Transactions come too, for the ថ្លៃកូនដៃ check.
      //
      // SISEN: "i each location to show the total buy amount in tons that is
      // purchased in that day so we can actually compare if the commision
      // given is correct or wrong."
      //
      // The tonnage is NOT a new figure anybody types — it is the tickets
      // already recorded, the same rows the Daily Book adds up. Read here so
      // the two screens can never disagree about a day.
      //
      // .catch(() => []) on purpose: this screen's job is expenses, and a
      // transactions call that fails must cost the check, not the page.
      const [locs, exp, dm, txs] = await Promise.all([
        api.getLocations(),
        api.getPayments({ type: "expense" }),
        api.getExpenseDayMarks().catch(() => []),
        api.getTransactions({}).catch(() => []),
      ]);
      setLocations(locs || []);
      setAllExpenses(exp || []);
      setMarks(dm || []);
      setAllTx(txs || []);
    } catch (err) {
      setLoadError(errText(null, err, "") || err.message || "Couldn't load expenses.");
    } finally { setLoading(false); }
  }
  // [2026-09-16] `refetch` goes up when the app comes back to the foreground
  // after being away, or after the login had to be renewed. On a phone the
  // page is still the same page when it is reopened — nothing reloads and
  // nothing re-asks — which is how SISEN's parents ended up looking at
  // figures from hours earlier, or at zeros. See src/sessionWatch.js.
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [refetch]);

  const win = useMemo(() => windowFor(grain, anchor), [grain, anchor]);
  const prevWin = useMemo(() => windowFor(grain, shiftAnchor(grain, anchor, -1)), [grain, anchor]);

  const rows = useMemo(
    () => filterRows(allExpenses, { from: win.from, to: win.to, locationIds: scope }),
    [allExpenses, win, scope],
  );
  const prevRows = useMemo(
    () => filterRows(allExpenses, { from: prevWin.from, to: prevWin.to, locationIds: scope }),
    [allExpenses, prevWin, scope],
  );

  const sum = useMemo(() => totals(rows), [rows]);
  const prevSum = useMemo(() => totals(prevRows), [prevRows]);

  // [2026-09-16] byPeriod builds rows FROM the expenses, so a day nobody
  // entered produced no row and was simply absent from the list — 1, 6, 13,
  // 14 and 16 September were missing from a September that looked complete.
  // That hid the exact thing this screen exists to catch. At Day grain the
  // calendar leads and the figures hang off it.
  const periods = useMemo(() => {
    const found = byPeriod(rows, grain);
    if (grain !== "day") return found;
    const byKey = new Map(found.map((p) => [p.key, p]));
    return daysInWindow(win.from, win.to, today).map(
      (iso) => byKey.get(iso) || {
        key: iso, label: periodLabel(iso, "day"), rows: [],
        commission: 0, other: 0, total: 0, empty: true,
      },
    );
  }, [rows, grain, win, today]);
  // [2026-09-17] SISEN: "when i click on one location it loads the other
  // location as well."
  //
  // He was right, and it was one line. `rows` is filtered by the location
  // picker, but the station breakdown under an expanded day was handed the
  // FULL `locations` list — so picking JOMNOUM still printed Ping Pong,
  // Pong Ro, Reang Kesey and Thapedey underneath it, every one of them
  // reading "មិនទាន់បញ្ចូល", which looks like four stations that forgot to
  // file rather than four stations you did not ask about.
  //
  // Everything the picker governs uses this. The day SHEET deliberately
  // does not — you must still be able to enter a day for any station
  // whatever the report happens to be filtered to.
  // Kilograms bought and sold, keyed "YYYY-MM-DD|locationId". Built once from
  // every transaction rather than filtered per station per day, which on a
  // month of five stations would be 150 passes over the same array.
  const tonnageByDayLoc = useMemo(() => {
    const m = new Map();
    for (const tx of allTx || []) {
      if ((tx.hq_status || "processing") === "cancelled") continue;
      const day = String(tx.tx_date || "").slice(0, 10);
      if (!day || !tx.location_id) continue;
      const key = `${day}|${tx.location_id}`;
      const at = m.get(key) || { boughtKg: 0, soldKg: 0 };
      const kg = Number(tx.quantity_kg) || 0;
      if (tx.type === "BUY") at.boughtKg += kg;
      else if (tx.type === "SELL") at.soldKg += kg;
      m.set(key, at);
    }
    return m;
  }, [allTx]);

  const scopedLocations = useMemo(
    () => (scope.length ? locations.filter((l) => scope.includes(l.id)) : locations),
    [locations, scope],
  );

  const categories = useMemo(() => byCategory(rows), [rows]);
  const stations = useMemo(() => byStation(rows, scopedLocations), [rows, scopedLocations]);
  const prevByCat = useMemo(() => {
    const m = new Map();
    byCategory(prevRows).forEach((c) => m.set(c.key, c.amount));
    return m;
  }, [prevRows]);
  const prevByStn = useMemo(() => {
    const m = new Map();
    byStation(prevRows, locations).forEach((s) => m.set(s.id, s.total));
    return m;
  }, [prevRows, locations]);

  const catList = useMemo(() => categoryList(allExpenses), [allExpenses]);

  // What is missing, and what looks duplicated. Shown as a strip, and only
  // when there is something — never as an empty box.
  const alerts = useMemo(() => {
    const out = [];
    const lastSeen = {};
    allExpenses.forEach((r) => {
      const d = String(r.pay_date).slice(0, 10);
      if (!lastSeen[r.location_id] || d > lastSeen[r.location_id]) lastSeen[r.location_id] = d;
    });
    marks.forEach((m) => {
      const d = String(m.day).slice(0, 10);
      if (!lastSeen[m.location_id] || d > lastSeen[m.location_id]) lastSeen[m.location_id] = d;
    });
    for (const l of scopedLocations) {
      const last = lastSeen[l.id];
      if (!last) continue;
      const gap = Math.round((Date.parse(today) - Date.parse(last)) / 86400000);
      if (gap >= 5) out.push({ k: t("ex_alert_missing"), t: `${l.name} — ${t("ex_nothing_since")} ${last}`, day: last, locationId: l.id });
    }
    const seen = new Map();
    for (const r of rows) {
      const k = `${String(r.pay_date).slice(0, 10)}|${r.location_id}|${categoryKey(r.category)}|${Math.round(Number(r.amount) || 0)}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const [k, n] of seen) {
      if (n < 2) continue;
      const [d, locId, cat, amt] = k.split("|");
      const l = locations.find((x) => x.id === locId);
      // The category is named — "150,000 at Thapedey" told you nothing about
      // WHICH expense to go and look at.
      const row = rows.find((r) => categoryKey(r.category) === cat
        && String(r.pay_date).slice(0, 10) === d && r.location_id === locId);
      out.push({
        k: t("ex_alert_twice"),
        t: `${cleanCategory(row?.category) || "—"} · ${riel(Number(amt))} · ${l?.name || "—"} · ${d} — ${t("ex_recorded_n_times").replace("{n}", n)}`,
        day: d, locationId: locId,
      });
    }
    return out;
  }, [allExpenses, marks, scopedLocations, locations, rows, today, t]);

  // ── the sheet ───────────────────────────────────────────────────────────
  useEffect(() => { setJustSaved(false); setUnlocked(false); }, [sheet?.day, sheet?.locationId]);

  const sheetRows = useMemo(
    () => (sheet ? allExpenses.filter((r) => String(r.pay_date).slice(0, 10) === sheet.day && r.location_id === sheet.locationId) : []),
    [allExpenses, sheet],
  );
  // Who last changed each figure on this day, for the lock line beside it.
  useEffect(() => {
    if (!sheet || !sheetRows.length) { setEdits({}); return; }
    let alive = true;
    api.getExpenseEdits(sheetRows.map((r) => r.id))
      .then((e) => { if (alive) setEdits(e || {}); })
      .catch(() => { if (alive) setEdits({}); });
    return () => { alive = false; };
  }, [sheet?.day, sheet?.locationId, sheetRows.length]);

  const dayStates = useMemo(() => {
    if (!sheet) return {};
    const out = {};
    stationsOn(sheet.day, locations, allExpenses, marks).forEach((s) => { out[s.id] = s.state; });
    return out;
  }, [sheet, locations, allExpenses, marks]);

  const needsPassword = !!sheet && (sheet.day !== today
    || sheetRows.some((r) => r.created_by && r.created_by !== session?.user?.id));

  async function reallySave({ entries, reason }) {
    setSaving(true); setSaveError("");
    try {
      // [2026-09-16] Keyed by category and carrying EVERY row for it, not
      // just the last. A day holding two rows for one category is collapsed
      // on save: the first row takes the figure, the extras are voided with
      // a reason. Voided, never deleted — the record of them stays.
      const existing = mergeByCategory(sheetRows);
      for (const e of entries) {
        const was = existing.get(categoryKey(e.category));
        if (was) {
          const extras = was.rows.slice(1);
          for (const x of extras) {
            await api.voidPayment(x.id, "Merged — this day held more than one entry for this category")
              .catch(() => {});
          }
          if (!extras.length && Math.round(was.amount) === Math.round(e.amount)) continue;
          await api.updateExpense(was.rows[0].id, { amount: e.amount, reason, userId: session.user.id });
        } else {
          await api.createPayment({
            type: "expense", category: e.category, transactionId: null,
            locationId: sheet.locationId, amount: e.amount, method: "cash",
            payDate: sheet.day, memo: null, userId: session.user.id,
          });
        }
      }
      if (entries.length) await api.clearExpenseDayMark({ locationId: sheet.locationId, day: sheet.day }).catch(() => {});
      else await api.markExpenseDayEmpty({ locationId: sheet.locationId, day: sheet.day, userId: session.user.id });

      await load();
      // [2026-09-16] It used to jump to the next station that had not been
      // entered. SISEN: "why does it bring me to next station for what?"
      //
      // It made sense only for the daily round of five. Opening one day from
      // the table to correct one figure and being thrown to a different
      // station is disorienting, and it is the commoner case. The sheet now
      // stays where it is; the picker above shows who is still to do, so the
      // next station is one tap away when that IS what you are doing.
      setJustSaved(true);
    } catch (err) {
      setSaveError(errText(null, err, "") || err.message || "Could not save.");
    } finally { setSaving(false); }
  }

  function handleSave(payload) {
    if (payload.changesExisting && needsPassword) { setPwPrompt(payload); return; }
    reallySave(payload);
  }

  // [2026-09-17] The picker is single-choice now (LocationFilter.jsx), so
  // this is either everything or one named station — never a count.
  const scopeLabel = scope.length
    ? (locations.find((l) => l.id === scope[0])?.name || t("loc_one"))
    : t("loc_all");

  const headers = group === "period" ? [t("ex_period")] : group === "category" ? [t("ex_category")] : [t("ex_station")];

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("ex_title")} subtitle={t("ex_subtitle")} />
      <main className="flex-1 overflow-y-auto bg-paper p-6">
        <div className="mx-auto max-w-4xl">

          {loadError && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</div>}
          {loading && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" />{t("ex_loading")}</div>}

          {!loading && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

              {/* one line of controls */}
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4">
                <select value={scope.length === 1 ? scope[0] : ""} onChange={(e) => setScope(e.target.value ? [e.target.value] : [])}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 outline-none focus:border-brand-400"
                  aria-label={t("ex_locations")}>
                  <option value="">{t("ex_all_locations")}</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <Seg t={t} options={GRAINS} value={grain} onChange={(g) => { setGrain(g); setOpenKey(null); }} />
                <Seg t={t} options={GROUPS} value={group} onChange={(g) => { setGroup(g); setOpenKey(null); }} />
                {win.unit && (
                  <div className="ml-auto flex items-center gap-1">
                    <button type="button" onClick={() => setAnchor(shiftAnchor(grain, anchor, -1))}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50">‹</button>
                    <span className="min-w-[110px] text-center text-xs font-semibold text-slate-600">{win.label || t("ex_all_years")}</span>
                    <button type="button" onClick={() => setAnchor(shiftAnchor(grain, anchor, 1))}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50">›</button>
                  </div>
                )}
                <button type="button" onClick={() => setPrinting(true)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700">
                  {t("ex_print")}
                </button>
                {canRecord && (
                  <button type="button" onClick={() => setSheet({ day: today, locationId: locations[0]?.id })}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                    + {t("ex_enter_a_day")}
                  </button>
                )}
              </div>

              {/* one figure */}
              <div className="flex flex-wrap items-baseline gap-3 px-4 pb-3">
                <span className="text-2xl font-bold tabular-nums text-slate-800">{riel(sum.total)}</span>
                <span className="text-sm text-slate-500">
                  <b className="font-semibold tabular-nums text-amber-700">ថ្លៃកូនដៃ {fmt(sum.commission)}</b>
                  {" · other "}<span className="tabular-nums">{fmt(sum.other)}</span>
                </span>
                <span className="ml-auto text-xs tabular-nums text-slate-400">
                  {prevSum.total
                    ? `${fmt(Math.abs(sum.total - prevSum.total))} ៛ ${sum.total >= prevSum.total ? "more" : "less"} than ${prevWin.label}`
                    : `${scopeLabel}`}
                </span>
              </div>

              {/* a strip, only when there is one */}
              {alerts.length > 0 && (
                <div className="border-y border-amber-200 bg-amber-50">
                  {/* [2026-09-16] Was one line with "2 more to check" that was
                      not a link, no category named, and nothing clickable —
                      it told you there was a problem and gave you nowhere to
                      go. Every alert is listed, names its category, and opens
                      the day it is about. */}
                  {(alertsOpen ? alerts : alerts.slice(0, 1)).map((a, i) => (
                    <button key={i} type="button" disabled={!a.day}
                      onClick={() => a.day && setSheet({ day: a.day, locationId: a.locationId })}
                      className={`flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left text-sm text-amber-900 ${
                        i ? "border-t border-amber-200/70" : ""} ${a.day ? "hover:bg-amber-100" : ""}`}>
                      <span className="rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">{a.k}</span>
                      <span>{a.t}</span>
                      {a.day && <ChevronRight size={14} className="ml-auto text-amber-600" />}
                    </button>
                  ))}
                  {alerts.length > 1 && (
                    <button type="button" onClick={() => setAlertsOpen((v) => !v)}
                      className="w-full border-t border-amber-200/70 px-4 py-1.5 text-left text-xs font-semibold text-amber-700 hover:bg-amber-100">
                      {alertsOpen ? t("ex_show_less") : t("ex_more_to_check").replace("{n}", alerts.length - 1)}
                    </button>
                  )}
                </div>
              )}

              {/* one table */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-0 text-sm sm:min-w-[560px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
                      <th className="px-2.5 py-2 text-left font-bold sm:px-4">{headers[0]}</th>
                      <th className="py-2 pl-4 text-right font-bold">ថ្លៃកូនដៃ</th>
                      <th className="hidden py-2 pl-4 text-right font-bold sm:table-cell">{group === "period" || group === "station" ? t("ex_other") : prevWin.label}</th>
                      <th className="py-2 pl-4 text-right font-bold">{t("ex_total")}</th>
                      <th className="w-10 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {group === "period" && periods.map((p) => {
                      const isOpen = openKey === p.key;
                      const kids = !isOpen ? null
                        : grain === "day"
                          ? stationsOn(p.key, scopedLocations, rows, marks)
                          : byPeriod(p.rows, childGrain(grain));
                      return (
                        <Fragmented key={p.key}>
                          <tr onClick={() => setOpenKey(isOpen ? null : p.key)}
                            className={`cursor-pointer border-b border-slate-50 ${isOpen ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                            <td className="px-4 py-2 text-slate-700">
                              <b className={p.empty ? "font-medium text-slate-400" : ""}>{p.label}</b>
                              {grain === "day" && <span className="ml-1.5 text-[11px] text-slate-400">{weekday(p.key, t)}</span>}
                              {p.empty && <span className="ml-2 text-[11px] text-slate-400">{t("ex_not_entered")}</span>}
                            </td>
                            <Num v={p.empty ? null : p.commission} cls="font-semibold text-amber-700" />
                            <Num v={p.empty ? null : p.other} cls="text-slate-600" hide />
                            <Num v={p.empty ? null : p.total} cls="font-bold text-slate-800" />
                            <td className="px-4 text-right"><ChevronRight size={15} className={`inline text-slate-300 ${isOpen ? "rotate-90 text-brand-600" : ""}`} /></td>
                          </tr>
                          {/* [2026-09-17] THE DAY, BROKEN OUT BY STATION AND THEN
                              BY WHAT THE MONEY WENT ON.
                              SISEN: "i want to be able to see what the spending is
                              on each day" — "for each location".
                              This used to be five thin table rows per day, each
                              with a commission figure, an other figure and a
                              total. Three numbers per station and not one word
                              about what was actually bought. Now each station is
                              a small card carrying its own categories, and a
                              station that has not filed is a dashed card with the
                              button on it rather than a line of dashes.
                              Rendered inside one full-width cell because a card
                              is not a table row — and when ONE station is picked
                              the station level disappears entirely (there is only
                              one) and the categories sit directly under the day. */}
                          {isOpen && grain === "day" && (
                            <tr className="border-b border-slate-100 bg-brand-50/60">
                              <td colSpan={5} className="px-2.5 py-2.5 sm:px-3">
                                {kids.map((st) => (
                                  <DayStation
                                    key={st.id}
                                    station={st}
                                    tonnage={tonnageByDayLoc.get(`${p.key}|${st.id}`)}
                                    only={kids.length === 1}
                                    canRecord={canRecord}
                                    onOpen={() => setSheet({ day: p.key, locationId: st.id })}
                                    t={t}
                                  />
                                ))}
                              </td>
                            </tr>
                          )}
                          {isOpen && grain !== "day" && kids.map((c) => (
                            <tr key={c.key} className="border-b border-slate-50 bg-slate-50/70 text-[13px]">
                              <td className="py-1.5 pl-10 pr-4 text-slate-600">{c.label}</td>
                              <Num v={c.commission} cls="text-amber-700" />
                              <Num v={c.other} cls="text-slate-500" hide />
                              <Num v={c.total} cls="text-slate-700" />
                              <td />
                            </tr>
                          ))}
                        </Fragmented>
                      );
                    })}

                    {group === "category" && categories.map((c) => {
                      const before = prevByCat.get(c.key) || 0;
                      const diff = c.amount - before;
                      return (
                        <tr key={c.key} className="border-b border-slate-50">
                          <td className="px-4 py-2 text-slate-700">
                            <b className={isCommission(c.category) ? "text-amber-800" : ""}>{c.category}</b>
                            {isCommission(c.category) && (
                              <span className="ml-2 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">{t("ex_commission")}</span>
                            )}
                          </td>
                          <Num v={isCommission(c.category) ? c.amount : null} cls="font-semibold text-amber-700" />
                          <Num v={before} cls="text-slate-500" />
                          <Num v={c.amount} cls="font-bold text-slate-800" />
                          <td className={`px-4 text-right text-[11px] tabular-nums ${diff < 0 ? "text-brand-700" : "text-slate-400"}`}>
                            {diff === 0 ? "" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}`}
                          </td>
                        </tr>
                      );
                    })}

                    {group === "station" && stations.map((s) => {
                      const before = prevByStn.get(s.id) || 0;
                      const diff = s.total - before;
                      return (
                        <tr key={s.id} className="border-b border-slate-50">
                          <td className="px-4 py-2 font-medium text-slate-700">{s.name}</td>
                          <Num v={s.commission} cls="font-semibold text-amber-700" />
                          <Num v={s.other} cls="text-slate-600" hide />
                          <Num v={s.total} cls="font-bold text-slate-800" />
                          <td className={`px-4 text-right text-[11px] tabular-nums ${diff < 0 ? "text-brand-700" : "text-slate-400"}`}>
                            {before === 0 ? "" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}`}
                          </td>
                        </tr>
                      );
                    })}

                    {!rows.length && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                        {t("ex_nothing_in")} {win.label || t("ex_all_years")}
                      </td></tr>
                    )}

                    {rows.length > 0 && (
                      <tr className="border-t-2 border-slate-300 font-bold">
                        <td className="px-4 py-2 text-slate-700">{win.label || t("ex_all_years")}</td>
                        <Num v={sum.commission} cls="text-amber-700" />
                        <Num v={group === "category" ? prevSum.total : sum.other} cls="text-slate-600" hide />
                        <Num v={sum.total} cls="text-slate-900" />
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">
                <b className="text-slate-500">{t("ex_open_day_hint")}</b> — a forgotten expense goes into its empty box, not a second entry.
                Days sum to weeks sum to months sum to the year.
              </p>
            </div>
          )}
        </div>
      </main>

      {/* [2026-09-17] The printed sheet — SISEN: "i need help making sure we
          can print out the expenses file". It renders nothing on screen; it
          builds a standalone A4 document in a hidden frame and opens the
          print dialog, where "Save as PDF" is a destination like any printer.
          Given the SAME rows the table is showing, so the paper and the screen
          can never disagree, and every day in the window including the ones
          nobody filed. */}
      {printing && (
        <ExpenseSheetPrint
          rows={rows}
          days={daysInWindow(win.from, win.to, today)}
          marks={marks}
          scopeLabel={scopeLabel}
          periodLabel={win.label || t("ex_all_years")}
          byWhom={profile?.full_name || ""}
          onDone={() => setPrinting(false)}
        />
      )}

      {sheet && (
        <DaySheet
          day={sheet.day} setDay={(d) => setSheet((s) => ({ ...s, day: d }))}
          locationId={sheet.locationId} setLocationId={(id) => setSheet((s) => ({ ...s, locationId: id }))}
          locations={locations} categories={catList} existingRows={sheetRows} dayStates={dayStates}
          onSave={handleSave} saving={saving} error={saveError}
          canEdit={canRecord} needsPassword={needsPassword}
          edits={edits} justSaved={justSaved} unlocked={unlocked}
          onUnlock={() => setPwPrompt({ unlockOnly: true })}
          onClose={() => { setSheet(null); setSaveError(""); }}
        />
      )}

      {pwPrompt && (
        <ConfirmPassword
          unlockOnly={!!pwPrompt.unlockOnly}
          onCancel={() => setPwPrompt(null)}
          onConfirmed={() => {
            const p = pwPrompt;
            setPwPrompt(null);
            // Unlocking only opens the boxes; the change is saved — and
            // recorded — when they press Save.
            if (p.unlockOnly) setUnlocked(true);
            else reallySave(p);
          }} />
      )}
    </div>
  );
}

// A named wrapper rather than <>…</> so the guard can see the grouping, and
// so a key can sit on it.
function Fragmented({ children }) { return <>{children}</>; }

// ──────────────────────────────────────────────── password, only to reach back ──

function ConfirmPassword({ onCancel, onConfirmed, unlockOnly }) {
  const { t } = useLanguage();
  const { session } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      // Re-authenticating in place, the same check used before a weight is
      // changed. Not a second login — the session is untouched.
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: session.user.email, password });
      if (authErr) { setError("That password is not right."); setBusy(false); return; }
      onConfirmed();
    } catch (err) {
      setError(err.message || "Could not confirm."); setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700">
          <Lock size={16} className="text-slate-400" /> {unlockOnly ? t("ex_unlock_title") : t("ex_confirm_title")}
        </h3>
        <p className="mb-3 text-xs text-slate-400">{unlockOnly ? t("ex_unlock_why") : t("ex_confirm_why")}</p>
        <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={t("ex_your_password")} className={inputCls} />
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("ex_cancel")}</button>
          <button type="submit" disabled={busy || !password}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? t("ex_checking") : unlockOnly ? t("ex_unlock_btn") : t("ex_confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}
