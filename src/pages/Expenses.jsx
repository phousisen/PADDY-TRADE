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
  stationsOn, weekdayOf, childGrain,
} from "../expenseBook.js";

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
}) {
  const { t } = useLanguage();
  const [amounts, setAmounts] = useState({});
  const [extra, setExtra] = useState([]);
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const next = {};
    for (const row of existingRows) next[categoryKey(row.category)] = String(Math.round(Number(row.amount) || 0));
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
  // into an empty box is not.
  const changesExisting = existingRows.some((r) => {
    const typed = parseAmount(amounts[categoryKey(r.category)]);
    return typed != null && Math.round(typed) !== Math.round(Number(r.amount) || 0);
  });
  const mustExplain = needsPassword && changesExisting;

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
              return (
                <div key={key}
                  className={`flex items-center gap-3 px-3 py-2 ${i ? "border-t border-slate-100" : ""} ${isCommission(name) ? "bg-amber-50/70" : ""}`}>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                    {name}
                    {isCommission(name) && (
                      <span className="ml-2 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">{t("ex_commission")}</span>
                    )}
                  </span>
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-400">
                    {parsed != null ? fmt(parsed) : ""}
                  </span>
                  <input inputMode="numeric" value={value} placeholder="—"
                    onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter" && !saving) submit(); }}
                    className={`${amountCls} w-28 shrink-0`} />
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

          {mustExplain && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Lock size={12} /> You are changing a figure already recorded — say why
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
          {canEdit && (
            <button type="button" onClick={submit} disabled={saving || (mustExplain && !reason.trim())}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />} {t("ex_save_next")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────── the one table ──

function Num({ v, cls = "" }) {
  return <td className={`py-2 pl-4 text-right tabular-nums ${cls}`}>{v == null ? <span className="text-slate-300">—</span> : fmt(v)}</td>;
}

export default function Expenses() {
  const { t } = useLanguage();
  const { session, profile, can, isViewOnly } = useAuth();
  const isOwner = !!profile?.isOwner;
  const canRecord = (isOwner || can("record_expenses")) && !isViewOnly;

  const [locations, setLocations] = useState([]);
  const [allExpenses, setAllExpenses] = useState([]);
  const [marks, setMarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const today = cambodiaDateStr();
  const [grain, setGrain] = useState("day");
  const [group, setGroup] = useState("period");
  const [anchor, setAnchor] = useState(today);
  const [scope, setScope] = useState([]);            // [] = all locations
  const [openKey, setOpenKey] = useState(null);

  const [sheet, setSheet] = useState(null);          // { day, locationId } | null
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
    } catch (err) {
      setLoadError(errText(null, err, "") || err.message || "Couldn't load expenses.");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

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

  const periods = useMemo(() => byPeriod(rows, grain), [rows, grain]);
  const categories = useMemo(() => byCategory(rows), [rows]);
  const stations = useMemo(() => byStation(rows, locations), [rows, locations]);
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
    for (const l of locations) {
      const last = lastSeen[l.id];
      if (!last) continue;
      const gap = Math.round((Date.parse(today) - Date.parse(last)) / 86400000);
      if (gap >= 5) out.push({ k: "Missing", t: `${l.name} — nothing entered since ${last}` });
    }
    const seen = new Map();
    for (const r of rows) {
      const k = `${String(r.pay_date).slice(0, 10)}|${r.location_id}|${categoryKey(r.category)}|${Math.round(Number(r.amount) || 0)}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const [k, n] of seen) {
      if (n < 2) continue;
      const [d, locId, , amt] = k.split("|");
      const l = locations.find((x) => x.id === locId);
      out.push({ k: "Twice", t: `${riel(Number(amt))} · ${l?.name || "—"} · ${d} — recorded ${n} times` });
    }
    return out;
  }, [allExpenses, marks, locations, rows, today]);

  // ── the sheet ───────────────────────────────────────────────────────────
  const sheetRows = useMemo(
    () => (sheet ? allExpenses.filter((r) => String(r.pay_date).slice(0, 10) === sheet.day && r.location_id === sheet.locationId) : []),
    [allExpenses, sheet],
  );
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
      const existing = new Map(sheetRows.map((r) => [categoryKey(r.category), r]));
      for (const e of entries) {
        const was = existing.get(categoryKey(e.category));
        if (was) {
          if (Math.round(Number(was.amount) || 0) === Math.round(e.amount)) continue;
          await api.updateExpense(was.id, { amount: e.amount, reason, userId: session.user.id });
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
      // On to the next station that has not been entered for this day.
      const states = stationsOn(sheet.day, locations, allExpenses, marks);
      const next = states.find((s) => s.state === "blank" && s.id !== sheet.locationId);
      if (next) setSheet({ day: sheet.day, locationId: next.id });
      else setSheet(null);
    } catch (err) {
      setSaveError(errText(null, err, "") || err.message || "Could not save.");
    } finally { setSaving(false); }
  }

  function handleSave(payload) {
    if (payload.changesExisting && needsPassword) { setPwPrompt(payload); return; }
    reallySave(payload);
  }

  const scopeLabel = !scope.length ? "All locations"
    : scope.length === 1 ? (locations.find((l) => l.id === scope[0])?.name || "1 station")
    : `${scope.length} stations`;

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
                    <span className="min-w-[110px] text-center text-xs font-semibold text-slate-600">{win.label}</span>
                    <button type="button" onClick={() => setAnchor(shiftAnchor(grain, anchor, 1))}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50">›</button>
                  </div>
                )}
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
                <div className="flex flex-wrap items-center gap-2 border-y border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  <span className="rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">{alerts[0].k}</span>
                  <span>{alerts[0].t}</span>
                  {alerts.length > 1 && <span className="ml-auto text-xs text-amber-700">{alerts.length - 1} more to check</span>}
                </div>
              )}

              {/* one table */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-2 text-left font-bold">{headers[0]}</th>
                      <th className="py-2 pl-4 text-right font-bold">ថ្លៃកូនដៃ</th>
                      <th className="py-2 pl-4 text-right font-bold">{group === "period" || group === "station" ? t("ex_other") : prevWin.label}</th>
                      <th className="py-2 pl-4 text-right font-bold">{t("ex_total")}</th>
                      <th className="w-10 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {group === "period" && periods.map((p) => {
                      const isOpen = openKey === p.key;
                      const kids = !isOpen ? null
                        : grain === "day"
                          ? stationsOn(p.key, locations, rows, marks)
                          : byPeriod(p.rows, childGrain(grain));
                      return (
                        <Fragmented key={p.key}>
                          <tr onClick={() => setOpenKey(isOpen ? null : p.key)}
                            className={`cursor-pointer border-b border-slate-50 ${isOpen ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                            <td className="px-4 py-2 text-slate-700">
                              <b>{p.label}</b>
                              {grain === "day" && <span className="ml-1.5 text-[11px] text-slate-400">{weekdayOf(p.key)}</span>}
                            </td>
                            <Num v={p.commission} cls="font-semibold text-amber-700" />
                            <Num v={p.other} cls="text-slate-600" />
                            <Num v={p.total} cls="font-bold text-slate-800" />
                            <td className="px-4 text-right"><ChevronRight size={15} className={`inline text-slate-300 ${isOpen ? "rotate-90 text-brand-600" : ""}`} /></td>
                          </tr>
                          {isOpen && grain === "day" && kids.map((s) => (
                            <tr key={s.id} className="border-b border-slate-50 bg-slate-50/70 text-[13px]">
                              <td className="py-1.5 pl-10 pr-4 text-slate-600">
                                {s.name}
                                {s.state === "nothing" && <span className="ml-2 text-[11px] text-slate-400">{t("ex_nothing_spent")}</span>}
                                {s.state === "blank" && <span className="ml-2 text-[11px] text-slate-400">{t("ex_not_entered")}</span>}
                              </td>
                              <Num v={s.state === "blank" ? null : s.commission} cls={s.state === "spent" ? "text-amber-700" : "text-slate-400"} />
                              <Num v={s.state === "blank" ? null : s.other} cls="text-slate-500" />
                              <Num v={s.state === "blank" ? null : s.total} cls="text-slate-700" />
                              <td className="px-4 text-right">
                                {canRecord && (
                                  <button type="button" onClick={(e) => { e.stopPropagation(); setSheet({ day: p.key, locationId: s.id }); }}
                                    className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-white">
                                    {s.state === "blank" ? t("ex_enter") : t("ex_open")}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                          {isOpen && grain !== "day" && kids.map((c) => (
                            <tr key={c.key} className="border-b border-slate-50 bg-slate-50/70 text-[13px]">
                              <td className="py-1.5 pl-10 pr-4 text-slate-600">{c.label}</td>
                              <Num v={c.commission} cls="text-amber-700" />
                              <Num v={c.other} cls="text-slate-500" />
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
                          <Num v={s.other} cls="text-slate-600" />
                          <Num v={s.total} cls="font-bold text-slate-800" />
                          <td className={`px-4 text-right text-[11px] tabular-nums ${diff < 0 ? "text-brand-700" : "text-slate-400"}`}>
                            {before === 0 ? "" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}`}
                          </td>
                        </tr>
                      );
                    })}

                    {!rows.length && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                        Nothing recorded in {win.label}.
                      </td></tr>
                    )}

                    {rows.length > 0 && (
                      <tr className="border-t-2 border-slate-300 font-bold">
                        <td className="px-4 py-2 text-slate-700">{win.label}</td>
                        <Num v={sum.commission} cls="text-amber-700" />
                        <Num v={group === "category" ? prevSum.total : sum.other} cls="text-slate-600" />
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

      {sheet && (
        <DaySheet
          day={sheet.day} setDay={(d) => setSheet((s) => ({ ...s, day: d }))}
          locationId={sheet.locationId} setLocationId={(id) => setSheet((s) => ({ ...s, locationId: id }))}
          locations={locations} categories={catList} existingRows={sheetRows} dayStates={dayStates}
          onSave={handleSave} saving={saving} error={saveError}
          canEdit={canRecord} needsPassword={needsPassword}
          onClose={() => { setSheet(null); setSaveError(""); }}
        />
      )}

      {pwPrompt && (
        <ConfirmPassword onCancel={() => setPwPrompt(null)}
          onConfirmed={() => { const p = pwPrompt; setPwPrompt(null); reallySave(p); }} />
      )}
    </div>
  );
}

// A named wrapper rather than <>…</> so the guard can see the grouping, and
// so a key can sit on it.
function Fragmented({ children }) { return <>{children}</>; }

// ──────────────────────────────────────────────── password, only to reach back ──

function ConfirmPassword({ onCancel, onConfirmed }) {
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
          <Lock size={16} className="text-slate-400" /> Confirm it is you
        </h3>
        <p className="mb-3 text-xs text-slate-400">
          You are changing a figure that is already recorded, on a day that is not today or that somebody else entered.
        </p>
        <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={t("ex_your_password")} className={inputCls} />
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("ex_cancel")}</button>
          <button type="submit" disabled={busy || !password}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? t("ex_checking") : t("ex_confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}
