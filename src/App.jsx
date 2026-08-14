import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { useLanguage } from "./i18n.jsx";
import { api } from "./api.js";
import Login from "./pages/Login.jsx";
import Sidebar from "./components/Sidebar.jsx";
import StockInventory from "./pages/StockInventory.jsx";
import Transactions from "./pages/Transactions.jsx";
import TransactionForm from "./pages/TransactionForm.jsx";
import ChangeRequests from "./pages/ChangeRequests.jsx";
import FinancialReports from "./pages/FinancialReports.jsx";
import SimpleListPage from "./pages/SimpleListPage.jsx";

export default function App() {
  const { session, profile, loading } = useAuth();
  const { t } = useLanguage();
  const [page, setPage] = useState("dashboard");
  const [pendingRequests, setPendingRequests] = useState(0);

  useEffect(() => {
    if (profile?.role === "admin") {
      api.getChangeRequests().then((rows) => setPendingRequests(rows.filter((r) => r.status === "pending").length));
    }
  }, [profile, page]);

  // Staff don't have a stock/dashboard view — send them straight to transactions.
  // (removed: staff can now view the dashboard)

  if (loading) {
    return <div className="flex h-screen w-full items-center justify-center bg-slate-50 text-slate-400 text-sm">Loading…</div>;
  }

  if (!session || !profile) {
    return <Login />;
  }

  // Staff still can't edit/delete transactions or see admin-only pages,
  // but they can view the stock dashboard now.
  const isStaff = profile.role === "staff";

  function renderPage() {
    if (isStaff && (page === "reports" || page === "stations")) {
      return <PermissionDenied />;
    }
    if (page === "dashboard" || page === "stock") return <StockInventory />;
    if (page === "transactions") return <Transactions setPage={setPage} />;
    if (page === "new-buy") return <TransactionForm type="BUY" setPage={setPage} />;
    if (page === "new-sell") return <TransactionForm type="SELL" setPage={setPage} />;
    if (page === "requests") return isAdmin ? <ChangeRequests /> : <PermissionDenied />;
    if (page === "stations") return isAdmin ? <SimpleListPage title={t("nav_stations")} kind="stations" /> : <PermissionDenied />;
    if (page === "reports") return !isStaff ? <FinancialReports /> : <PermissionDenied />;
    if (page === "suppliers") return <SimpleListPage title={t("nav_suppliers")} kind="suppliers" />;
    if (page === "buyers") return <SimpleListPage title={t("nav_buyers")} kind="buyers" />;
    return <StockInventory />;
  }

  function PermissionDenied() {
    return (
      <div className="flex h-screen flex-1 items-center justify-center">
        <p className="text-sm text-slate-500">{t("permission_denied")}</p>
      </div>
    );
  }

  return (
    <div className="flex bg-slate-100">
      <Sidebar page={page} setPage={setPage} pendingRequests={pendingRequests} />
      {renderPage()}
    </div>
  );
}
