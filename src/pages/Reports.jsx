import { useEffect, useState } from "react";
import { LayoutGrid, ShoppingBag, TrendingUp, Wallet, HandCoins, Boxes, Landmark, History, ReceiptText, Download, Loader2, Scale, PiggyBank, TrendingDown, FileText, Package, Users, SlidersHorizontal, BarChart3 } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import LocationFilter from "../components/LocationFilter.jsx";
import DateRangeFilter from "../components/DateRangeFilter.jsx";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { api } from "../api.js";
import { queryRange } from "../reportQuery.js";
import { getAccurateNow } from "../supabaseClient.js";
import { downloadReportWorkbook, cambodiaTimestamp } from "../reportExport.js";
import ReportOverview from "./ReportOverview.jsx";
import ReportBalanceSheet from "./ReportBalanceSheet.jsx";
import ReportPurchases from "./ReportPurchases.jsx";
import ReportSales from "./ReportSales.jsx";
import ReportPayables from "./ReportPayables.jsx";
import ReportReceivables from "./ReportReceivables.jsx";
import ReportStock from "./ReportStock.jsx";
import ReportShrinkage from "./ReportShrinkage.jsx";
import ReportCashFlow from "./ReportCashFlow.jsx";
import ReportCapital from "./ReportCapital.jsx";
import ReportTax from "./ReportTax.jsx";
import ReportAuditLog from "./ReportAuditLog.jsx";
// [2026-09-14] The accountant's statements — built on statements.js, which
// every one of them shares, so they cannot disagree about the same month.
import ReportIncomeStatement from "./ReportIncomeStatement.jsx";
import ReportInventory from "./ReportInventory.jsx";
import ReportShareholders from "./ReportShareholders.jsx";
import ReportFinanceSetup from "./ReportFinanceSetup.jsx";
// [2026-09-15] The Finance section index, and the one list that defines what
// is in this section. The sub-menu below and the Start page are built from
// the SAME list, so a screen can never be in one and missing from the other.
import FinanceStart, { FINANCE_SCREENS, FINANCE_GROUPS } from "./FinanceStart.jsx";


// Cambodia's calendar today, and the first of the month it falls in — the
// period every report opens on.
function cambodiaToday() {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(getAccurateNow()).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}
function monthStart() {
  return `${cambodiaToday().slice(0, 7)}-01`;
}

export default function Reports({ initialTab = "start" }) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [tab, setTab] = useState(initialTab);
  const [locations, setLocations] = useState([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  // [2026-09-10] Reports open on THIS MONTH, not on all time.
  //
  // Chosen by SISEN. It is not cosmetic: the period is now part of the
  // database query, so a report can only ask for a period it has. Opening
  // on "everything" would mean every report downloading the whole history
  // before showing anything, which is the problem being fixed. Any range,
  // including all of it, is still one click away on the date filter.
  const [startDate, setStartDate] = useState(() => monthStart());
  const [endDate, setEndDate] = useState(() => cambodiaToday());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    api.getLocations().then(setLocations).catch(() => {});
  }, []);

  async function exportExcel() {
    setExporting(true);
    setExportError("");
    try {
      // [2026-09-10] The export now respects the filters ON SCREEN. It used
      // to fetch everything ever recorded and hand it to the workbook,
      // which then filtered it — so the download was the size of the whole
      // business no matter what period you had chosen.
      const range = queryRange({ selectedLocationIds, startDate, endDate });
      // [2026-09-14] `from` dropped on purpose: the balance-sheet figures in
      // this workbook are AS AT the period end and need the history behind
      // them — see src/financials.js. The period slice is taken there.
      const asAt = { ...range, from: undefined };
      const [txs, payments, capitalEntries, loanEntries, adjustments] = await Promise.all([
        api.getTransactions(asAt),
        api.getPayments(asAt),
        api.getPartnerCapitalEntries().catch(() => []),
        api.getBankLoans().catch(() => []),
        api.getStockAdjustments({ locationId: asAt.locationId, endDate }).catch(() => []),
      ]);
      downloadReportWorkbook(
        { txs, payments, adjustments, capitalEntries, loanEntries, stations: locations, selectedLocationIds, startDate, endDate },
        `PaddyTrade_Report_${cambodiaTimestamp()}.xlsx`
      );
    } catch (err) {
      setExportError(err.message || "Export failed — check your connection and try again.");
    } finally {
      setExporting(false);
    }
  }

  // [2026-09-15] A grouped SUB-MENU down the side, not a row of seventeen tabs.
  //
  // The row was the reason the statements were invisible: seventeen items in
  // one scrolling strip put the new ones off the left edge with nothing to say
  // they existed. Five short groups in a column can all be seen at once, and
  // each one carries a plain-words hint, so nobody has to decode "Shrinkage"
  // to find out it means paddy lost on a count.
  //
  // Overview is KEPT — it is the screen that has been used every day, and
  // removing it while the statements are still settling would be a second
  // disruption on top of the first. It simply no longer opens by default.
  const ICONS = {
    start: LayoutGrid, overview: BarChart3, balancesheet: Scale, income: FileText,
    cashflow: Landmark, inventory: Package, shareholders: Users,
    purchases: ShoppingBag, sales: TrendingUp, payables: HandCoins,
    receivables: Wallet, stock: Boxes, shrinkage: TrendingDown,
    capital: PiggyBank, financesetup: SlidersHorizontal, tax: ReceiptText, auditlog: History,
  };
  // [2026-09-15] Khmer pass — the menu holds keys, not words, and resolves
  // them here, so the sub-menu switches language with the rest of the app.
  const navGroups = [
    { label: null, items: [
      { id: "start", label: t("fin_start"), short: t("fin_start_h") },
      { id: "overview", label: t("fin_overview"), short: t("fin_overview_h") },
    ] },
    ...FINANCE_GROUPS.map((g) => ({
      label: t(g.labelKey),
      items: FINANCE_SCREENS
        .filter((s) => s.group === g.id && (!s.admin || isAdmin))
        .map((s) => ({ ...s, label: t(s.labelKey), short: t(s.shortKey) })),
    })),
  ];
  const allTabs = navGroups.flatMap((g) => g.items);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("reports_title")} subtitle={t("reports_subtitle")} />
      <div className="border-b border-slate-200 bg-white px-6 pt-3">
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          <DateRangeFilter startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
          {locations.length > 1 && (
            <LocationFilter locations={locations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
          )}
          <button
            onClick={exportExcel}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-brand-800 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {exporting ? t("exporting_btn") : t("export_ledger")}
          </button>
        </div>
      </div>
      {exportError && (
        <div className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-6 py-2 text-xs font-medium text-rose-600">
          <span>{exportError}</span>
          <button onClick={exportExcel} className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100">{t("retry_btn")}</button>
        </div>
      )}
      {/* The section's own two-column layout: sub-menu, then the screen.
          The app's green sidebar is untouched — this column only exists while
          you are inside Finance, the way a Settings section works. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav className="hidden w-[218px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-2.5 py-3 lg:block">
          {navGroups.map((g, gi) => (
            <div key={g.label || `g${gi}`} className={gi > 0 ? "mt-4" : ""}>
              {g.label && (
                <p className="mb-1 px-2.5 text-[10px] font-bold uppercase tracking-[0.11em] text-slate-300">{g.label}</p>
              )}
              {g.items.map((it) => {
                const Icon = ICONS[it.id] || FileText;
                const on = tab === it.id;
                return (
                  <button
                    key={it.id}
                    onClick={() => setTab(it.id)}
                    className={`mb-0.5 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      on ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    <Icon size={15} className={`mt-0.5 shrink-0 ${on ? "text-brand-600" : "text-slate-300"}`} />
                    <span className="min-w-0">
                      <span className={`block text-[13px] leading-tight ${on ? "font-semibold" : "font-medium"}`}>{it.label}</span>
                      {it.short && <span className="mt-0.5 block text-[10.5px] leading-tight text-slate-400">{it.short}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Below the lg breakpoint two nav columns do not fit, so the sub-menu
            becomes one dropdown rather than being hidden with no way back. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
            <select
              value={tab}
              onChange={(e) => setTab(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-700"
            >
              {navGroups.map((g, gi) => (
                <optgroup key={g.label || `g${gi}`} label={g.label || t("nav_finance")}>
                  {g.items.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

      <main className="flex-1 overflow-y-auto bg-paper p-6">
        {tab === "start" && <FinanceStart onNavigate={setTab} isAdmin={isAdmin} />}
        {tab === "overview" && <ReportOverview selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} onNavigate={setTab} />}
        {tab === "balancesheet" && <ReportBalanceSheet selectedLocationIds={selectedLocationIds} setSelectedLocationIds={setSelectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "income" && <ReportIncomeStatement selectedLocationIds={selectedLocationIds} setSelectedLocationIds={setSelectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "inventory" && <ReportInventory selectedLocationIds={selectedLocationIds} setSelectedLocationIds={setSelectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "shareholders" && <ReportShareholders selectedLocationIds={selectedLocationIds} setSelectedLocationIds={setSelectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "financesetup" && isAdmin && <ReportFinanceSetup />}
        {tab === "purchases" && <ReportPurchases selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "sales" && <ReportSales selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "payables" && <ReportPayables selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "receivables" && <ReportReceivables selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "stock" && <ReportStock selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "shrinkage" && <ReportShrinkage selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "cashflow" && <ReportCashFlow selectedLocationIds={selectedLocationIds} setSelectedLocationIds={setSelectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "capital" && <ReportCapital selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "tax" && <ReportTax selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "auditlog" && isAdmin && <ReportAuditLog selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
      </main>
        </div>
      </div>
    </div>
  );
}
