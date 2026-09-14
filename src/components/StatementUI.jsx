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

import { AlertTriangle } from "lucide-react";

export const fmt = (n) => new Intl.NumberFormat("en-US").format(Math.round(Number(n) || 0));
export const fmtKg = (n) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
export const isKnown = (v) => v !== null && v !== undefined;

// A figure. null means nobody has told the system, and that is shown as such.
export function Amount({ v, riel = true, signed = false, bold, why }) {
  if (!isKnown(v)) {
    return (
      <span
        title={why || "Nobody has entered this yet — see Reports → Finance Setup"}
        className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-amber-700 ring-1 ring-amber-200"
      >
        <AlertTriangle size={10} /> not entered
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
        {hint && <span className="mt-0.5 block text-[11px] font-normal text-slate-400">{hint}</span>}
      </span>
      <span className="shrink-0 whitespace-nowrap text-slate-800">
        <Amount v={value} riel={riel} signed={signed} bold={bold || total || grand} why={why} />
      </span>
    </div>
  );
}

export function StatementHead({ title, scope, period, asAt, right }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[17px] font-bold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-0.5 text-[12px] text-slate-500">
          {scope}
          {period && <> · for <b className="font-semibold text-slate-700">{period}</b></>}
          {asAt && <> · as at <b className="font-semibold text-slate-700">{asAt}</b></>}
        </p>
      </div>
      {right}
    </div>
  );
}

// Says, in one line, what the reader is looking at: one station on its own, or
// several genuinely added together.
export function ScopeBar({ stations }) {
  const names = stations.map((s) => s.name);
  return (
    <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-2.5 text-[12.5px] text-brand-800">
      {names.length === 0 ? "No stations selected."
        : names.length === 1
        ? <>Showing <b className="font-semibold">{names[0]}</b> on its own — its own partners, its own shed, its own profit.</>
        : <>
            Consolidating <b className="font-semibold">{names.join(" + ")}</b> into one set of figures.
            Every line is those {names.length} stations added together, and no station is counted twice.
          </>}
    </div>
  );
}

export function SetupNotice({ missing, what }) {
  if (!missing) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
      <b className="font-semibold">Finance Setup isn't in the database yet.</b>{" "}
      {what || "Depreciation, fixed assets, opening cash and tax"} will read as not entered until
      <b className="font-semibold"> migration_finance_setup.sql</b> has been run in Supabase → SQL Editor,
      one statement at a time.
    </div>
  );
}

// The gap between the two sides of the balance sheet. Shown, never hidden and
// never plugged — the number itself is the message.
export function UnreconciledNotice({ value }) {
  if (!isKnown(value) || Math.abs(value) <= 1) return null;
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
      <b className="font-semibold">{fmt(value)} ៛ unexplained.</b> Assets less liabilities and equity.
      Nothing on this sheet is adjusted to force the two sides to agree, so the difference is shown instead of
      hidden — it is the cash the business held before the system started, which nobody has entered.
      Recording an opening cash balance under <b className="font-semibold">Finance Setup</b> closes it.
    </div>
  );
}
