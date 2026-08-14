import { useState } from "react";
import { LayoutGrid, ShoppingBag, TrendingUp, Wallet, HandCoins, Boxes, Landmark } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { useLanguage } from "../i18n.jsx";
import ReportOverview from "./ReportOverview.jsx";
import ReportPurchases from "./ReportPurchases.jsx";
import ReportSales from "./ReportSales.jsx";
import ReportPayables from "./ReportPayables.jsx";
import ReportReceivables from "./ReportReceivables.jsx";
import ReportStock from "./ReportStock.jsx";
import ReportCashFlow from "./ReportCashFlow.jsx";

export default function Reports() {
  const { t } = useLanguage();
  const [tab, setTab] = useState("overview");

  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "purchases", label: "Purchases", icon: ShoppingBag },
    { id: "sales", label: "Sales", icon: TrendingUp },
    { id: "payables", label: "Accounts Payable", icon: HandCoins },
    { id: "receivables", label: "Accounts Receivable", icon: Wallet },
    { id: "stock", label: "Stock", icon: Boxes },
    { id: "cashflow", label: "Cash Flow", icon: Landmark },
  ];

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("reports_title")} subtitle={t("reports_subtitle")} />
      <div className="border-b border-slate-200 bg-white px-6">
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
      </div>
      <main className="flex-1 overflow-y-auto bg-slate-100 p-6">
        {tab === "overview" && <ReportOverview />}
        {tab === "purchases" && <ReportPurchases />}
        {tab === "sales" && <ReportSales />}
        {tab === "payables" && <ReportPayables />}
        {tab === "receivables" && <ReportReceivables />}
        {tab === "stock" && <ReportStock />}
        {tab === "cashflow" && <ReportCashFlow />}
      </main>
    </div>
  );
}
