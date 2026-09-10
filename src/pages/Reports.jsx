import { useEffect, useState } from "react";
import { LayoutGrid, ShoppingBag, TrendingUp, Wallet, HandCoins, Boxes, Landmark, History, ReceiptText, Download, Loader2, Scale, PiggyBank, TrendingDown } from "lucide-react";
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

export default function Reports({ initialTab = "overview" }) {
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
      const [txs, payments, capitalEntries, loanEntries] = await Promise.all([
        api.getTransactions(range),
        api.getPayments(range),
        api.getPartnerCapitalEntries().catch(() => []),
        api.getBankLoans().catch(() => []),
      ]);
      downloadReportWorkbook(
        { txs, payments, capitalEntries, loanEntries, stations: locations, selectedLocationIds, startDate, endDate },
        `PaddyTrade_Report_${cambodiaTimestamp()}.xlsx`
      );
    } catch (err) {
      setExportError(err.message || "Export failed — check your connection and try again.");
    } finally {
      setExporting(false);
    }
  }

  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "balancesheet", label: "Balance Sheet", icon: Scale },
    { id: "purchases", label: "Purchases", icon: ShoppingBag },
    { id: "sales", label: "Sales", icon: TrendingUp },
    { id: "payables", label: "Accounts Payable", icon: HandCoins },
    { id: "receivables", label: "Accounts Receivable", icon: Wallet },
    { id: "stock", label: "Stock", icon: Boxes },
    { id: "shrinkage", label: "Stock Loss", icon: TrendingDown },
    { id: "cashflow", label: "Cash Flow", icon: Landmark },
    { id: "capital", label: "Capital & Loans", icon: PiggyBank },
    { id: "tax", label: "Tax", icon: ReceiptText },
    ...(isAdmin ? [{ id: "auditlog", label: "Activity Log", icon: History }] : []),
  ];

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
            {exporting ? "Exporting..." : "Export to Excel"}
          </button>
        </div>
        <div className="flex gap-0.5 overflow-x-auto">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
                tab === tb.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <tb.icon size={14} /> {tb.label}
            </button>
          ))}
        </div>
      </div>
      {exportError && (
        <div className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-6 py-2 text-xs font-medium text-rose-600">
          <span>{exportError}</span>
          <button onClick={exportExcel} className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}
      <main className="flex-1 overflow-y-auto bg-paper p-6">
        {tab === "overview" && <ReportOverview selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} onNavigate={setTab} />}
        {tab === "balancesheet" && <ReportBalanceSheet selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "purchases" && <ReportPurchases selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "sales" && <ReportSales selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "payables" && <ReportPayables selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "receivables" && <ReportReceivables selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "stock" && <ReportStock selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "shrinkage" && <ReportShrinkage selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "cashflow" && <ReportCashFlow selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "capital" && <ReportCapital selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "tax" && <ReportTax selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "auditlog" && isAdmin && <ReportAuditLog />}
      </main>
    </div>
  );
}
