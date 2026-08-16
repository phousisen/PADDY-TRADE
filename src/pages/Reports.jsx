import { useEffect, useState } from "react";
import { LayoutGrid, ShoppingBag, TrendingUp, Wallet, HandCoins, Boxes, Landmark, History, ReceiptText } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import LocationFilter from "../components/LocationFilter.jsx";
import DateRangeFilter from "../components/DateRangeFilter.jsx";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { api } from "../api.js";
import ReportOverview from "./ReportOverview.jsx";
import ReportPurchases from "./ReportPurchases.jsx";
import ReportSales from "./ReportSales.jsx";
import ReportPayables from "./ReportPayables.jsx";
import ReportReceivables from "./ReportReceivables.jsx";
import ReportStock from "./ReportStock.jsx";
import ReportCashFlow from "./ReportCashFlow.jsx";
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

  useEffect(() => {
    api.getLocations().then(setLocations);
  }, []);

  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "purchases", label: "Purchases", icon: ShoppingBag },
    { id: "sales", label: "Sales", icon: TrendingUp },
    { id: "payables", label: "Accounts Payable", icon: HandCoins },
    { id: "receivables", label: "Accounts Receivable", icon: Wallet },
    { id: "stock", label: "Stock", icon: Boxes },
    { id: "cashflow", label: "Cash Flow", icon: Landmark },
    { id: "tax", label: "Tax", icon: ReceiptText },
    ...(isAdmin ? [{ id: "auditlog", label: "Audit Log", icon: History }] : []),
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
                <tb.icon size={15} /> {tb.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 py-2">
            <DateRangeFilter startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
            {locations.length > 1 && (
              <LocationFilter locations={locations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
            )}
          </div>
        </div>
      </div>
      <main className="flex-1 overflow-y-auto bg-slate-100 p-6">
        {tab === "overview" && <ReportOverview selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "purchases" && <ReportPurchases selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "sales" && <ReportSales selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "payables" && <ReportPayables selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "receivables" && <ReportReceivables selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "stock" && <ReportStock selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "cashflow" && <ReportCashFlow selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "tax" && <ReportTax selectedLocationIds={selectedLocationIds} startDate={startDate} endDate={endDate} />}
        {tab === "auditlog" && isAdmin && <ReportAuditLog />}
      </main>
    </div>
  );
}
