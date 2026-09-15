// Finance → Start here.
//
// [2026-09-15] The index for the Finance section. It exists because the five
// statements shipped, installed correctly, and stayed invisible: they sat in a
// tab row that scrolled sideways, and there was nothing on the page anyone
// landed on to say they were there.
//
// So this page has one job — say what is in this section, in plain words, and
// let you get to it in one click. The second job is to be honest about what is
// NOT ready: a figure nobody has entered, a station with no partners, a month
// with no expenses recorded. Those are the reasons the statements are wrong,
// and they are worth more space than the statements themselves right now.

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { api } from "../api.js";

// Kept next to the nav definition in Finance.jsx deliberately — one list, so a
// screen can never appear in the menu and be missing here, or the reverse.
export const FINANCE_SCREENS = [
  { id: "balancesheet", group: "Statements", label: "Balance Sheet",
    q: "What does the business own, what does it owe, and what is left for the owners — on one date?",
    short: "Own, owe, and what's left" },
  { id: "income", group: "Statements", label: "Income Statement",
    q: "Did the business make a profit this period, and where did it come from?",
    short: "Profit this period" },
  { id: "cashflow", group: "Statements", label: "Cash Flow",
    q: "Where did the money actually go? Profit and cash are not the same number.",
    short: "Where the money went" },
  { id: "inventory", group: "Statements", label: "Inventory",
    q: "How much paddy is in each shed, what did it cost, and what was lost on the counts?",
    short: "Paddy in each shed" },
  { id: "shareholders", group: "Statements", label: "Shareholder's Records",
    q: "How much of the sales and profit belongs to each partner, at each station?",
    short: "Each partner's share" },

  { id: "purchases", group: "Ledgers", label: "Purchases", q: "Every load bought, by farmer and by day.", short: "Everything bought" },
  { id: "sales", group: "Ledgers", label: "Sales", q: "Every load shipped, by buyer and by day.", short: "Everything shipped" },
  { id: "payables", group: "Ledgers", label: "Accounts Payable", q: "What is still owed to farmers.", short: "Owed to farmers" },
  { id: "receivables", group: "Ledgers", label: "Accounts Receivable", q: "What buyers still owe us.", short: "Owed to us" },
  { id: "stock", group: "Ledgers", label: "Stock", q: "The shed, day by day.", short: "The shed over time" },
  { id: "shrinkage", group: "Ledgers", label: "Stock Loss", q: "Paddy written off on physical counts.", short: "Lost on counts" },

  { id: "capital", group: "Setup", label: "Capital & Loans", q: "Partners, what they put in, what they took out, and money borrowed.", short: "Partners and borrowing" },
  { id: "financesetup", group: "Setup", label: "Finance Setup", q: "Everything the weighbridge cannot know — opening cash, assets, shares, tax.", short: "What needs entering", admin: true },
  { id: "tax", group: "Setup", label: "Tax", q: "Tax figures for the period.", short: "Tax" },
  { id: "auditlog", group: "Setup", label: "Activity Log", q: "Every change to money, weight and stock, and who made it.", short: "Who changed what", admin: true },
];

const Card = ({ s, go }) => (
  <button
    onClick={() => go(s.id)}
    className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-brand-400"
  >
    <div className="flex items-center justify-between gap-2">
      <span className="text-[14px] font-semibold text-slate-900">{s.label}</span>
      <ArrowRight size={14} className="shrink-0 text-slate-300 group-hover:text-brand-600" />
    </div>
    <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{s.q}</p>
  </button>
);

export default function FinanceStart({ onNavigate, isAdmin }) {
  // What is missing is the point of this page, so it is checked live rather
  // than described in prose that quietly goes out of date.
  const [gaps, setGaps] = useState(null);

  useEffect(() => {
    let alive = true;
    const soft = (p, d) => p.then((v) => v).catch(() => d);
    Promise.all([
      soft(api.getPayments({}), []),
      soft(api.getPartners(), []),
      soft(api.getFinanceSettings(), {}),
      soft(api.getLocations(), []),
    ]).then(([payments, partners, settings, locations]) => {
      if (!alive) return;
      const expenses = payments.filter((p) => p.type === "expense");
      const noOpening = locations.filter((l) => settings?.[l.id]?.opening_cash == null);
      setGaps({
        expenses: expenses.length,
        partners: partners.length,
        noOpening: noOpening.length,
        stations: locations.length,
      });
    });
    return () => { alive = false; };
  }, []);

  const groups = ["Statements", "Ledgers", "Setup"];
  const visible = (s) => !s.admin || isAdmin;

  return (
    <div className="space-y-6">
      {/* ---- how it fits together ---- */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-[16px] font-bold tracking-tight text-slate-900">How this fits together</h2>
        <p className="mt-2 max-w-[76ch] text-[13px] leading-relaxed text-slate-500">
          Everything starts at the weighbridge. A ticket becomes a transaction, a transaction and its payments become
          the figures below — never typed by hand. That is why the Balance Sheet and the Income Statement cannot
          disagree about the same month: <b className="font-semibold text-slate-800">they are the same arithmetic,
          read two ways</b>.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {["Weighing ticket", "Transaction & payment", "The statements"].map((s, i, a) => (
            <span key={s} className="flex items-center gap-2">
              <span className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-[12.5px] font-medium text-brand-800">{s}</span>
              {i < a.length - 1 && <span className="text-slate-300">→</span>}
            </span>
          ))}
        </div>
      </div>

      {/* ---- what is stopping the numbers being right ---- */}
      {gaps && (gaps.expenses === 0 || gaps.partners === 0 || gaps.noOpening > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="flex items-center gap-2 text-[14px] font-bold text-amber-900">
            <AlertTriangle size={15} /> Before these numbers can be trusted
          </h2>
          <p className="mt-1.5 text-[12.5px] text-amber-800">
            None of this is fixed by the app — somebody has to record it. Until then the statements show what they can
            and mark the rest as not entered.
          </p>
          <div className="mt-3.5 space-y-2.5">
            {gaps.expenses === 0 && (
              <Gap
                title="No expenses have ever been recorded"
                body="Staff wages, កូនដៃ, fuel, repairs — none of it is in the system, so every profit figure is overstated by whatever you really spend."
                where="Sidebar → Expenses"
              />
            )}
            {gaps.partners === 0 && (
              <Gap
                title="No partners are recorded"
                body="Shareholder's Records is empty and the equity section has no capital behind it."
                where="Finance → Capital & Loans"
                go={() => onNavigate("capital")}
              />
            )}
            {gaps.noOpening > 0 && (
              <Gap
                title={`${gaps.noOpening} of ${gaps.stations} stations have no opening cash balance`}
                body="Cash is shown as a movement rather than a balance, and the Balance Sheet carries an unexplained gap at the bottom."
                where="Finance → Finance Setup"
                go={isAdmin ? () => onNavigate("financesetup") : undefined}
              />
            )}
          </div>
        </div>
      )}

      {gaps && gaps.expenses > 0 && gaps.partners > 0 && gaps.noOpening === 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[13px] font-medium text-brand-800">
          <Check size={15} /> Everything the statements need has been entered.
        </div>
      )}

      {/* ---- the screens ---- */}
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-2.5 flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.11em] text-slate-400">{g}</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FINANCE_SCREENS.filter((s) => s.group === g && visible(s)).map((s) => (
              <Card key={s.id} s={s} go={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Gap({ title, body, where, go }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-white/70 px-4 py-3">
      <p className="text-[13px] font-semibold text-amber-900">{title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-amber-800">{body}</p>
      <div className="mt-2">
        {go ? (
          <button onClick={go} className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-amber-800 hover:bg-amber-50">
            {where} <ArrowRight size={12} />
          </button>
        ) : (
          <span className="text-[12px] font-semibold text-amber-800">{where}</span>
        )}
      </div>
    </div>
  );
}
