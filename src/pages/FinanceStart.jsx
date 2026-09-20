// Finance — the screen list, and the "To enter" panel.
//
// [2026-09-15] This file used to be a whole landing page: a paragraph about how
// the weighbridge feeds the statements, three warnings each with a sentence
// explaining what it did to the numbers, and fifteen cards each carrying a full
// question. 434 words before you reached a single figure — and the fifteen
// cards were a second copy of the menu sitting right next to the menu.
//
// It is now two things and nothing else:
//
//   FINANCE_SCREENS / FINANCE_GROUPS — the one list that drives the sub-menu.
//   ToEnter — the three things nobody has recorded, as three rows you can
//             count, sitting at the top of Overview.
//
// Nothing was dropped. Every screen is still one click away in the sub-menu,
// and the sentence that used to sit under each warning now lives on the screen
// where you fix it, which is where it is actually useful.

import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";

// Kept next to the nav definition in Reports.jsx deliberately — one list, so a
// screen can never appear in the menu and be missing from the app, or the
// reverse. `group` is the machine key; the label comes from i18n.
export const FINANCE_SCREENS = [
  { id: "balancesheet", group: "Statements", labelKey: "fin_bs" },
  { id: "income", group: "Statements", labelKey: "fin_is" },
  { id: "cashflow", group: "Statements", labelKey: "fin_cf" },
  { id: "inventory", group: "Statements", labelKey: "fin_inv" },
  { id: "shareholders", group: "Statements", labelKey: "fin_sh" },

  { id: "purchases", group: "Ledgers", labelKey: "fin_purchases" },
  { id: "sales", group: "Ledgers", labelKey: "fin_sales" },
  { id: "payables", group: "Ledgers", labelKey: "fin_payables" },
  { id: "receivables", group: "Ledgers", labelKey: "fin_receivables" },
  { id: "stock", group: "Ledgers", labelKey: "fin_stock" },
  { id: "shrinkage", group: "Ledgers", labelKey: "fin_shrinkage" },

  { id: "capital", group: "Setup", labelKey: "fin_capital" },
  { id: "financesetup", group: "Setup", labelKey: "fin_setup", admin: true },
  { id: "tax", group: "Setup", labelKey: "fin_tax" },
  { id: "auditlog", group: "Setup", labelKey: "fin_auditlog", admin: true },
];

export const FINANCE_GROUPS = [
  { id: "Statements", labelKey: "fin_grp_statements" },
  { id: "Ledgers", labelKey: "fin_grp_ledgers" },
  { id: "Setup", labelKey: "fin_grp_setup" },
];

/**
 * The three things nobody has recorded, counted rather than described.
 *
 * Checked live rather than written down in prose that quietly goes out of
 * date — the day the expenses go in, this panel disappears by itself.
 */
export default function ToEnter({ onNavigate, isAdmin }) {
  const { t } = useLanguage();
  const [gaps, setGaps] = useState(null);

  useEffect(() => {
    let alive = true;
    // [2026-09-19] (audit F22, F25) A table not created yet counts as empty;
    // any other failure hides this panel rather than telling the owner that
    // no expenses or partners have been entered when they have. And only
    // expense payments are fetched — this used to download every payment in
    // the business to count the expenses.
    const soft = (p, d) => p.catch((e) => {
      if (/relation .* does not exist|schema cache|could not find/i.test(String(e?.message || ""))) return d;
      throw e;
    });
    Promise.all([
      soft(api.getPayments({ type: "expense" }), []),
      soft(api.getPartners(), []),
      soft(api.getFinanceSettings(), {}),
      api.getLocations(),
    ]).then(([payments, partners, settings, locations]) => {
      if (!alive) return;
      setGaps({
        expenses: payments.length,
        partners: partners.length,
        noOpening: locations.filter((l) => settings?.[l.id]?.opening_cash == null).length,
        stations: locations.length,
      });
    }).catch(() => { if (alive) setGaps(null); });
    return () => { alive = false; };
  }, []);

  if (!gaps) return null;

  const rows = [
    gaps.expenses === 0 && { k: "exp", label: t("nav_expenses"), value: t("fin_te_none"), go: null },
    gaps.partners === 0 && { k: "par", label: t("fin_te_partners"), value: t("fin_te_none"), go: "capital" },
    gaps.noOpening > 0 && {
      k: "cash", label: t("fin_te_cash"),
      value: t("fin_te_stations", { n: gaps.noOpening, total: gaps.stations }),
      go: isAdmin ? "financesetup" : null,
    },
  ].filter(Boolean);

  if (rows.length === 0) {
    return (
      <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[13px] font-medium text-brand-800">
        <Check size={15} /> {t("fin_all_entered")}
      </div>
    );
  }

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
        <b className="text-[13.5px] font-bold text-slate-900">{t("fin_toenter")}</b>
        <span className="ml-auto rounded-full border border-gold-300 bg-gold-50 px-2.5 py-0.5 text-[11.5px] font-bold text-gold-700">
          {rows.length}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.k} className="flex items-center gap-3 border-t border-slate-50 px-4 py-2.5 first:border-t-0">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-gold-300" />
          <span className="text-[13px] font-medium text-slate-800">{r.label}</span>
          <span className="ml-auto whitespace-nowrap text-[12.5px] text-slate-400">{r.value}</span>
          {/* Expenses lives in the green sidebar, not inside Finance, so that
              one row says where rather than pretending to be a link. */}
          {r.go ? (
            <button
              onClick={() => onNavigate(r.go)}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-[12px] font-semibold text-brand-700 hover:bg-brand-100"
            >
              {t("fin_te_enter")} <ArrowRight size={11} />
            </button>
          ) : (
            <span className="shrink-0 text-[12px] font-semibold text-slate-300">{t("nav_expenses")}</span>
          )}
        </div>
      ))}
    </div>
  );
}
