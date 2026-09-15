// The pieces every financial statement is built from.
//
// [2026-09-14] One rule lives here and nowhere else: HOW A FIGURE NOBODY HAS
// ENTERED IS DRAWN. It is an amber "not entered", never a dash that could be
// mistaken for zero and never a 0 — and it carries the reason, so the person
// reading the statement knows what is missing and where to put it, instead of
// wondering whether the business really did pay no interest.
//
// Every statement page renders through <Amount>, so this can never be done
// one way on the Balance Sheet and another on the Income Statement.

import { createContext, useContext, useState } from "react";
import { AlertTriangle, BookOpen } from "lucide-react";
import { useLanguage } from "../i18n.jsx";

// ---------------------------------------------------------------------------
// [2026-09-15] EXPLANATIONS ARE OPTIONAL NOW, NOT GONE.
//
// Every line on every statement carried a sentence underneath explaining what
// it meant, and every page ended with two or three paragraphs of the same. All
// of it is true and some of it is load-bearing — "buying paddy is not a cost
// until it is sold" is the reason the Income Statement looks the way it does.
// But it was on screen every single time, for someone who has read it a
// hundred times.
//
// So it is behind one switch, off by default, remembered per station PC. The
// figures are the page; the teaching is one click away when somebody new is
// looking over your shoulder.
// ---------------------------------------------------------------------------
const ExplainCtx = createContext(false);
const KEY = "paddytrade_explain";

export function ExplainProvider({ children }) {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
  });
  const toggle = () => setOn((v) => {
    try { localStorage.setItem(KEY, v ? "0" : "1"); } catch { /* private window */ }
    return !v;
  });
  return <ExplainCtx.Provider value={{ on, toggle }}>{children}</ExplainCtx.Provider>;
}

// Reading it outside a provider is not an error — it just means "off", so a
// statement rendered anywhere else still shows its figures.
export function useExplain() {
  const ctx = useContext(ExplainCtx);
  return ctx && typeof ctx === "object" ? ctx : { on: false, toggle: () => {} };
}

// Wraps anything that only exists to explain.
export function Explain({ children }) {
  const { on } = useExplain();
  return on ? children : null;
}

export function ExplainToggle() {
  const { t } = useLanguage();
  const { on, toggle } = useExplain();
  return (
    <button
      onClick={toggle}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors ${
        on ? "border-brand-300 bg-brand-50 text-brand-800"
           : "border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-brand-700"}`}
    >
      <BookOpen size={13} /> {on ? t("st_explain_hide") : t("st_explain_show")}
    </button>
  );
}

// [2026-09-15] SISEN asked for the Cash Flow lines to end in "ក្នុងថ្ងៃ" — in
// the day. They are right for the way he reads the page, and wrong the moment
// somebody opens it with "This Month" selected: the label would say "in the
// day" over a month's total. So the word follows the date filter instead of
// being fixed. A single day gives him exactly the wording he wrote.
//
// Returns a translation key, so the phrase itself stays in i18n.jsx.
export function periodWordKey(startDate, endDate) {
  if (!startDate || !endDate) return "per_period";
  if (startDate === endDate) return "per_day";
  const m = /^(\d{4})-(\d{2})-01$/.exec(startDate);
  if (m) {
    // Last day of that same month — computed, not assumed, so February and the
    // 30-day months are right without a table.
    const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10);
    if (endDate === last) return "per_month";
  }
  return "per_period";
}

export const fmt = (n) => new Intl.NumberFormat("en-US").format(Math.round(Number(n) || 0));
export const fmtKg = (n) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
export const isKnown = (v) => v !== null && v !== undefined;

// A figure. null means nobody has told the system, and that is shown as such.
export function Amount({ v, riel = true, signed = false, bold, why }) {
  const { t } = useLanguage();
  if (!isKnown(v)) {
    return (
      <span
        title={why || t("st_notentered_why")}
        className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-amber-700 ring-1 ring-amber-200"
      >
        <AlertTriangle size={10} /> {t("st_notentered")}
      </span>
    );
  }
  const n = Number(v) || 0;
  const body = signed && n !== 0
    ? `${n < 0 ? "(" : ""}${fmt(Math.abs(n))}${n < 0 ? ")" : ""}`
    : fmt(n);
  return (
    <span className={`tabular-nums ${bold ? "font-semibold" : ""} ${n < 0 ? "text-rose-600" : ""}`}>
      {body}{riel ? " ៛" : ""}
    </span>
  );
}

// A line on a statement.
export function Line({ label, hint, value, indent, bold, total, grand, signed, riel = true, why }) {
  const { on: explain } = useExplain();
  return (
    <div
      className={[
        "flex items-baseline justify-between gap-6 py-2 text-[13.5px]",
        indent ? "pl-4" : "",
        total ? "mt-1 border-t border-slate-300 pt-2.5 font-semibold" : "border-b border-slate-50",
        grand ? "mt-1 border-y-2 border-slate-800 bg-slate-50/70 px-2 py-2.5 font-bold" : "",
      ].join(" ")}
    >
      <span className={`min-w-0 ${bold || total || grand ? "text-slate-900" : "text-slate-500"}`}>
        {label}
        {hint && explain && <span className="mt-0.5 block text-[11px] font-normal text-slate-400">{hint}</span>}
      </span>
      <span className="shrink-0 whitespace-nowrap text-slate-800">
        <Amount v={value} riel={riel} signed={signed} bold={bold || total || grand} why={why} />
      </span>
    </div>
  );
}

// The station chips from the approved sample.
//
// These are not a second, competing filter: they read and write the SAME
// selection the toolbar's Location filter uses, so changing either moves both.
// Two controls on one screen that can disagree about which stations you are
// looking at would be worse than having no chips at all.
//
// Clicking a station toggles it. Clicking the last remaining one does nothing
// — a statement of no stations is not a thing, and an empty screen is a worse
// answer than leaving the selection alone.
export function StationChips({ stations = [], selectedIds = [], setSelectedIds }) {
  const { t } = useLanguage();
  if (!setSelectedIds || stations.length < 2) return null;
  // An empty selection means "all of them" everywhere else in Reports, so the
  // chips show that state as every station lit rather than none.
  const on = (id) => selectedIds.length === 0 || selectedIds.includes(id);
  const all = selectedIds.length === 0 || selectedIds.length === stations.length;

  const toggle = (id) => {
    const current = selectedIds.length ? selectedIds : stations.map((s) => s.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    if (next.length === 0) return;                       // never nothing
    setSelectedIds(next.length === stations.length ? [] : next);
  };

  const chip = (active) =>
    `rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
      active ? "border-brand-700 bg-brand-700 text-white"
             : "border-slate-200 bg-white text-slate-500 hover:border-brand-400 hover:text-brand-700"}`;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="mr-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{t("st_station")}</span>
      {stations.map((s) => (
        <button key={s.id} type="button" onClick={() => toggle(s.id)} className={chip(on(s.id))}>
          {s.name}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setSelectedIds([])}
        className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
          all ? "border-brand-950 bg-brand-950 text-white"
              : "border-slate-200 bg-white text-slate-500 hover:border-brand-400 hover:text-brand-700"}`}
      >
        {t("st_allstations")}
      </button>
    </div>
  );
}

// The summary strip from the approved sample: the five figures that answer
// "how did the month go" before the reader gets into the statement itself.
// Same component on every statement, so the top of each page reads the same
// way and a figure means the same thing wherever it appears.
export function StatementSummary({ cells }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 md:grid-cols-3 lg:grid-cols-5">
      {cells.map((c) => (
        <div key={c.label} className="bg-white px-4 py-3.5">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{c.label}</div>
          <div className={`mt-1.5 text-[18px] font-bold tracking-tight ${
            !isKnown(c.value) ? "" : c.tone === "neg" || Number(c.value) < 0 ? "text-rose-600"
            : c.tone === "pos" ? "text-brand-700" : "text-slate-900"}`}>
            <Amount v={c.value} riel={c.riel !== false} why={c.why} />
          </div>
          {c.sub && <div className="mt-1 text-[11px] text-slate-400">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function StatementHead({ title, scope, period, asAt, right }) {
  const { t } = useLanguage();
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[17px] font-bold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-0.5 text-[12px] text-slate-500">
          {scope}
          {period && <> · {t("st_for")} <b className="font-semibold text-slate-700">{period}</b></>}
          {asAt && <> · {t("st_asat_word")} <b className="font-semibold text-slate-700">{asAt}</b></>}
        </p>
      </div>
      {right}
    </div>
  );
}

// Says, in one line, what the reader is looking at: one station on its own, or
// several genuinely added together.
export function ScopeBar({ stations }) {
  const { t } = useLanguage();
  const names = stations.map((s) => s.name);
  return (
    <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-2.5 text-[12.5px] text-brand-800">
      {names.length === 0 ? t("st_nostations")
        : names.length === 1
        ? t("st_onestation_b", { name: names[0] })
        : t("st_consolidating_b", { names: names.join(" + "), n: names.length })}
    </div>
  );
}

export function SetupNotice({ missing, what }) {
  const { t } = useLanguage();
  if (!missing) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
      <b className="font-semibold">{t("st_setup_title")}</b>{" "}
      {what || t("st_setup_what")} {t("st_setup_b")}
    </div>
  );
}

// The gap between the two sides of the balance sheet. Shown, never hidden and
// never plugged — the number itself is the message.
export function UnreconciledNotice({ value }) {
  const { t } = useLanguage();
  if (!isKnown(value) || Math.abs(value) <= 1) return null;
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
      <b className="font-semibold">{t("st_unexp_title", { v: fmt(value) })}</b> {t("st_unexp_b")}
    </div>
  );
}
