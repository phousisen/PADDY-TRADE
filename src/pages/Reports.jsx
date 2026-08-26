import { useEffect, useState } from "react";
import { LayoutGrid, ShoppingBag, TrendingUp, Wallet, HandCoins, Boxes, Landmark, History, ReceiptText, Download, Loader2, Scale, PiggyBank } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import LocationFilter from "../components/LocationFilter.jsx";
import DateRangeFilter from "../components/DateRangeFilter.jsx";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { api } from "../api.js";
import { downloadReportWorkbook, cambodiaTimestamp } from "../reportExport.js";
import ReportOverview from "./ReportOverview.jsx";
import ReportBalanceSheet from "./ReportBalanceSheet.jsx";
import ReportPurchases from "./ReportPurchases.jsx";
import ReportSales from "./ReportSales.jsx";
import ReportPayables from "./ReportPayables.jsx";
import ReportReceivables from "./ReportReceivables.jsx";
import ReportStock from "./ReportStock.jsx";
import ReportCashFlow from "./ReportCashFlow.jsx";
import ReportCapital from "./ReportCapital.jsx";
import ReportTax from "./ReportTax.jsx";
import ReportAuditLog from "./ReportAuditLog.jsx";

export default function Reports({ initialTab = "overview" }) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [tab, setTab] = useState(initialTab);
  const [locations, setLocations] = useState([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    api.getLocations().then(setLocations).catch(() => {});
  }, []);

  async function exportExcel() {
    setExporting(true);
    setExportError("");
    try {
      const [txs, payments, capitalEntries, loanEntries] = await Promise.all([
        api.getTransactions(),
        api.getPayments(),
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
    { id: "overview", label: "Overview", labelKm: "ទិដ្ឋភាពទូទៅ", icon: LayoutGrid },
    { id: "balancesheet", label: "Balance Sheet", labelKm: "តារាងតុល្យការ", icon: Scale },
    { id: "purchases", label: "Purchases", labelKm: "ការទិញ", icon: ShoppingBag },
    { id: "sales", label: "Sales", labelKm: "ការលក់", icon: TrendingUp },
    { id: "payables", label: "Accounts Payable", labelKm: "គណនីត្រូវបង់", icon: HandCoins },
    { id: "receivables", label: "Accounts Receivable", labelKm: "គណនីត្រូវទទួល", icon: Wallet },
    { id: "stock", label: "Stock", labelKm: "ស្តុកទំនិញ", icon: Boxes },
    { id: "cashflow", label: "Cash Flow", labelKm: "លំហូរសាច់ប្រាក់", icon: Landmark },
    { id: "capital", label: "Capital & Loans", labelKm: "ដើមទុន និង កម្ចី", icon: PiggyBank },
    { id: "tax", label: "Tax", labelKm: "ពន្ធ", icon: ReceiptText },
    ...(isAdmin ? [{ id: "auditlog", label: "Activity Log", labelKm: "កំណត់ត្រាសកម្មភាព", icon: History }] : []),
  ];

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("reports_title")} subtitle={t("reports_subtitle")} />
      <div className="border-b border-slate-200 bg-white px-6">
        <div className="flex items-center justify-between">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                  tab === tb.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                <tb.icon size={15} />
                <span>
                  {tb.label}
                  <span className="font-khmer block text-[10px] font-normal leading-tight">{tb.labelKm}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 py-2">
            <DateRangeFilter startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
            {locations.length > 1 && (
              <LocationFilter locations={locations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
            )}
            <button
              onClick={exportExcel}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={14} className="animate-spin text-slate-400" /> : <Download size={14} className="text-slate-400" />}
              <span>
                {exporting ? "Exporting..." : "Export to Excel"}
                <span className="font-khmer block text-[10px] font-normal leading-tight">{exporting ? "កំពុងនាំចេញ..." : "នាំចេញទៅ Excel"}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
      {exportError && (
        <div className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-6 py-2 text-xs font-medium text-rose-600">
          <span>{exportError}</span>
          <button onClick={exportExcel} className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry<span className="font-khmer block text-[10px] font-normal">ព្យាយាមម្តងទៀត</span></button>
        </div>
      )}
      <main className="flex-1 overflow-y-auto bg-slate-100 p-6">
        {tab === "overview" && <ReportOverview selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} onNavigate={setTab} />}
        {tab === "balancesheet" && <ReportBalanceSheet selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "purchases" && <ReportPurchases selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "sales" && <ReportSales selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "payables" && <ReportPayables selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "receivables" && <ReportReceivables selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "stock" && <ReportStock selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "cashflow" && <ReportCashFlow selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "capital" && <ReportCapital selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "tax" && <ReportTax selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "auditlog" && isAdmin && <ReportAuditLog />}
      </main>
    </div>
  );
}
