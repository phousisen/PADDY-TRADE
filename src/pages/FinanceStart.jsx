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
//
// [2026-09-15] Khmer pass. Every label here used to be an English literal, so
// a station running the app in Khmer got a Khmer sidebar and an English
// Finance section. The screen list now carries translation KEYS rather than
// words, and both consumers of it (the sub-menu in Reports.jsx and the cards
// below) resolve them through t(). Accounting terms follow ACAR's published
// Khmer IFRS-for-SMEs statements — see the note in i18n.jsx.

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";

// Kept next to the nav definition in Reports.jsx deliberately — one list, so a
// screen can never appear in the menu and be missing here, or the reverse.
//
// group is the machine key; groupKey is what gets shown. Nothing here holds a
// word in any language.
export const FINANCE_SCREENS = [
  { id: "balancesheet", group: "Statements", labelKey: "fin_bs", qKey: "fin_bs_q", shortKey: "fin_bs_h" },
  { id: "income", group: "Statements", labelKey: "fin_is", qKey: "fin_is_q", shortKey: "fin_is_h" },
  { id: "cashflow", group: "Statements", labelKey: "fin_cf", qKey: "fin_cf_q", shortKey: "fin_cf_h" },
  { id: "inventory", group: "Statements", labelKey: "fin_inv", qKey: "fin_inv_q", shortKey: "fin_inv_h" },
  { id: "shareholders", group: "Statements", labelKey: "fin_sh", qKey: "fin_sh_q", shortKey: "fin_sh_h" },

  { id: "purchases", group: "Ledgers", labelKey: "fin_purchases", qKey: "fin_purchases_q", shortKey: "fin_purchases_h" },
  { id: "sales", group: "Ledgers", labelKey: "fin_sales", qKey: "fin_sales_q", shortKey: "fin_sales_h" },
  { id: "payables", group: "Ledgers", labelKey: "fin_payables", qKey: "fin_payables_q", shortKey: "fin_payables_h" },
  { id: "receivables", group: "Ledgers", labelKey: "fin_receivables", qKey: "fin_receivables_q", shortKey: "fin_receivables_h" },
  { id: "stock", group: "Ledgers", labelKey: "fin_stock", qKey: "fin_stock_q", shortKey: "fin_stock_h" },
  { id: "shrinkage", group: "Ledgers", labelKey: "fin_shrinkage", qKey: "fin_shrinkage_q", shortKey: "fin_shrinkage_h" },

  { id: "capital", group: "Setup", labelKey: "fin_capital", qKey: "fin_capital_q", shortKey: "fin_capital_h" },
  { id: "financesetup", group: "Setup", labelKey: "fin_setup", qKey: "fin_setup_q", shortKey: "fin_setup_h", admin: true },
  { id: "tax", group: "Setup", labelKey: "fin_tax", qKey: "fin_tax_q", shortKey: "fin_tax_h" },
  { id: "auditlog", group: "Setup", labelKey: "fin_auditlog", qKey: "fin_auditlog_q", shortKey: "fin_auditlog_h", admin: true },
];

// The three group headings, keyed the same way.
export const FINANCE_GROUPS = [
  { id: "Statements", labelKey: "fin_grp_statements" },
  { id: "Ledgers", labelKey: "fin_grp_ledgers" },
  { id: "Setup", labelKey: "fin_grp_setup" },
];

const Card = ({ s, go, t }) => (
  <button
    onClick={() => go(s.id)}
    className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-brand-400"
  >
    <div className="flex items-center justify-between gap-2">
      <span className="text-[14px] font-semibold text-slate-900">{t(s.labelKey)}</span>
      <ArrowRight size={14} className="shrink-0 text-slate-300 group-hover:text-brand-600" />
    </div>
    <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{t(s.qKey)}</p>
  </button>
);

export default function FinanceStart({ onNavigate, isAdmin }) {
  const { t } = useLanguage();
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

  const visible = (s) => !s.admin || isAdmin;

  return (
    <div className="space-y-6">
      {/* ---- how it fits together ---- */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-[16px] font-bold tracking-tight text-slate-900">{t("fin_fits")}</h2>
        <p className="mt-2 max-w-[76ch] text-[13px] leading-relaxed text-slate-500">{t("fin_fits_b")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[t("fin_fits_1"), t("fin_fits_2"), t("fin_fits_3")].map((s, i, a) => (
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
            <AlertTriangle size={15} /> {t("fin_trust")}
          </h2>
          <p className="mt-1.5 text-[12.5px] text-amber-800">{t("fin_trust_b")}</p>
          <div className="mt-3.5 space-y-2.5">
            {gaps.expenses === 0 && (
              <Gap
                title={t("fin_gap_exp")}
                body={t("fin_gap_exp_b")}
                where={t("fin_where_expenses")}
              />
            )}
            {gaps.partners === 0 && (
              <Gap
                title={t("fin_gap_partners")}
                body={t("fin_gap_partners_b")}
                where={t("fin_where_capital")}
                go={() => onNavigate("capital")}
              />
            )}
            {gaps.noOpening > 0 && (
              <Gap
                title={t("fin_gap_cash", { n: gaps.noOpening, total: gaps.stations })}
                body={t("fin_gap_cash_b")}
                where={t("fin_where_setup")}
                go={isAdmin ? () => onNavigate("financesetup") : undefined}
              />
            )}
          </div>
        </div>
      )}

      {gaps && gaps.expenses > 0 && gaps.partners > 0 && gaps.noOpening === 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[13px] font-medium text-brand-800">
          <Check size={15} /> {t("fin_all_entered")}
        </div>
      )}

      {/* ---- the screens ---- */}
      {FINANCE_GROUPS.map((g) => (
        <div key={g.id}>
          <div className="mb-2.5 flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.11em] text-slate-400">{t(g.labelKey)}</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FINANCE_SCREENS.filter((s) => s.group === g.id && visible(s)).map((s) => (
              <Card key={s.id} s={s} go={onNavigate} t={t} />
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
