// Shared building blocks for every page under Reports (Overview, Balance
// Sheet, Purchases, Sales, Payables, Receivables, Stock, Stock Loss, Cash
// Flow, Capital & Loans, Tax). Nothing here fetches data or computes
// anything — it's presentation only, so every report page that uses these
// pieces automatically looks and feels like the same connected system
// instead of drifting apart from each other over time. Change the look in
// one place here and every report picks it up.
//
// Design intent (approved 2026-09-01 from a click-through sample): plain,
// data-dense, one accent color (brand green) used sparingly, no filler
// icons/emoji, tabular numbers, a summary strip up top instead of busy
// colored KPI cards.

export function SummaryStrip({ children }) {
  return (
    <div className="mb-5 flex flex-wrap overflow-hidden rounded-xl border border-slate-200 bg-white">
      {children}
    </div>
  );
}

export function SummaryCell({ label, value, sub, tone }) {
  const subCls = tone === "neg" ? "text-rose-600" : tone === "pos" ? "text-brand-700" : "text-slate-400";
  return (
    <div className="min-w-[150px] flex-1 border-r border-slate-200 px-5 py-4 last:border-r-0">
      <div className="text-[11.5px] font-medium text-slate-400">{label}</div>
      <div className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div>
      {sub && <div className={`mt-1 text-[11.5px] ${subCls}`}>{sub}</div>}
    </div>
  );
}

export function ReportCard({ title, subtitle, children, className = "" }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 ${className}`}>
      {title && <h3 className="mb-0.5 text-[13.5px] font-semibold text-slate-900">{title}</h3>}
      {subtitle && <p className="mb-3.5 text-[11.5px] text-slate-400">{subtitle}</p>}
      {children}
    </div>
  );
}

export function SectionLabel({ children }) {
  return <p className="mb-0.5 mt-3.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-300 first:mt-0">{children}</p>;
}

export function Row({ label, value, bold, indent, tone, onClick }) {
  const toneCls = tone === "neg" ? "text-rose-600" : tone === "pos" ? "text-brand-700" : "";
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
      title={onClick ? "Click to view details" : undefined}
      className={`group flex items-center justify-between border-b border-slate-50 py-2.5 text-[13.5px] last:border-0 ${indent ? "pl-4" : ""} ${onClick ? "cursor-pointer rounded-md px-1.5 -mx-1.5 hover:bg-brand-50" : ""}`}
    >
      <span className={`${bold ? "font-semibold text-slate-900" : "text-slate-500"} ${onClick ? "group-hover:text-brand-700 group-hover:underline" : ""}`}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold text-slate-900" : toneCls || "text-slate-700"}`}>{value}</span>
    </div>
  );
}

export function TotalBox({ children }) {
  return <div className="mt-2.5 border-t border-slate-200 pt-2.5">{children}</div>;
}

export function TableCard({ title, right, children, className = "" }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 text-[13.5px] font-semibold text-slate-900">
          <span>{title}</span>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// Standard table shell — pass <thead>/<tbody>/<tfoot> children as usual;
// this just supplies the shared border/spacing/typography classes.
export function Table({ children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13.5px]">{children}</table>
    </div>
  );
}
export function Th({ children, num, className = "" }) {
  return (
    <th className={`px-4 py-3 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 ${num ? "text-right" : "text-left"} border-b border-slate-200 ${className}`}>
      {children}
    </th>
  );
}
export function Td({ children, num, name, className = "" }) {
  return (
    <td className={`border-b border-slate-50 px-4 py-3 tabular-nums text-slate-600 ${num ? "text-right" : ""} ${name ? "font-semibold text-slate-900" : ""} ${className}`}>
      {children}
    </td>
  );
}
export function Tr({ children, className = "", onClick, title }) {
  return (
    <tr
      onClick={onClick}
      title={title}
      className={`last:[&>td]:border-0 hover:bg-slate-50/60 ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      {children}
    </tr>
  );
}
export function Tfoot({ children }) {
  return <tfoot className="[&>tr>td]:border-t-2 [&>tr>td]:border-slate-200 [&>tr>td]:py-3 [&>tr>td]:font-bold [&>tr>td]:text-slate-900">{children}</tfoot>;
}

// Aging-bucket badge (Accounts Payable/Receivable) — 4 buckets, colors get
// progressively more urgent the older the balance is.
const AGE_TONES = {
  "0-30 days": "bg-brand-50 text-brand-700",
  "31-60 days": "bg-amber-50 text-amber-700",
  "61-90 days": "bg-orange-50 text-orange-700",
  "90+ days": "bg-rose-50 text-rose-700",
};
export function AgeBadge({ bucket }) {
  return <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${AGE_TONES[bucket] || "bg-slate-100 text-slate-500"}`}>{bucket}</span>;
}
