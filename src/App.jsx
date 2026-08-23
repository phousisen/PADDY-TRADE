import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { useLanguage } from "./i18n.jsx";
import { api } from "./api.js";
import { startAutoSync } from "./offlineQueue.js";
import Login from "./pages/Login.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import StockInventory from "./pages/StockInventory.jsx";
import Transactions from "./pages/Transactions.jsx";
import TransactionForm from "./pages/TransactionForm.jsx";
import WeighingTickets from "./pages/WeighingTickets.jsx";
import ChangeRequests from "./pages/ChangeRequests.jsx";
import Reports from "./pages/Reports.jsx";
import SimpleListPage from "./pages/SimpleListPage.jsx";
import LocationsPage from "./pages/LocationsPage.jsx";
import LocationDetail from "./pages/LocationDetail.jsx";
import PartyDetail from "./pages/PartyDetail.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import RolesPage from "./pages/RolesPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ReceiptTemplateEditor from "./pages/ReceiptTemplateEditor.jsx";
import RegisterFarmer from "./pages/RegisterFarmer.jsx";

export default function App() {
  const { session, profile, loading } = useAuth();
  const { t } = useLanguage();
  const [page, setPage] = useState("dashboard");
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [prefillParty, setPrefillParty] = useState(null);
  const [openParty, setOpenParty] = useState(null); // { id, kind }

  // Jump to a fresh New Buy / New Sell form with a farmer's or buyer's info
  // already filled in — used by the "New Buy"/"New Sell" button on their
  // profile row in the Farmers/Buyers list, so staff don't retype the same
  // name, phone, and bank details for every truckload.
  function startBuyFor(party) {
    setPrefillParty(party);
    setPage("new-buy");
  }
  function startSellFor(party) {
    setPrefillParty(party);
    setPage("new-sell");
  }

  // Open a farmer's or buyer's full profile page (clicked from their name
  // on the Farmers/Buyers list) — shows their info, running totals, and
  // complete transaction history.
  function viewParty(party, kind) {
    setOpenParty({ id: party.id, kind });
    setPage("party-detail");
  }

  useEffect(() => {
    if (profile?.role === "admin") {
      api.getChangeRequests().then((rows) => setPendingRequests(rows.filter((r) => r.status === "pending").length));
    }
  }, [profile, page]);

  // Start the offline sync/safety-net once someone's actually signed in —
  // app-wide, not just while the Weighing Tickets screen happens to be
  // open, so staff can be on Transactions/Reports/etc. and still have any
  // still-pending changes finish syncing (and still get warned before
  // closing the tab if something hasn't synced yet). Safe to call more
  // than once; it only ever sets itself up the first time.
  useEffect(() => {
    if (session && profile) startAutoSync();
  }, [session, profile]);

  // Public self-registration for farmers -- reached by scanning a QR code
  // at the entrance, no login needed. Checked before the login gate below
  // since this has to work for someone who has never signed in at all.
  // Example link: https://yourapp.vercel.app/?register=1&loc=<location id>
  const regParams = new URLSearchParams(window.location.search);
  if (regParams.get("register") === "1") {
    return <RegisterFarmer locationId={regParams.get("loc") || null} />;
  }

  if (loading) {
    return <div className="flex h-screen w-full items-center justify-center bg-slate-50 text-slate-400 text-sm">Loading…</div>;
  }

  if (!session || !profile) {
    return <Login />;
  }

  const isAdmin = profile.role === "admin";
  const isStaff = profile.role === "staff";

  function renderPage() {
    if (isStaff && (page === "reports" || page === "payments" || page === "stations" || page === "station-detail" || page === "users" || page === "roles" || page === "settings" || page === "receipt-template")) {
      return <PermissionDenied />;
    }
    if (page === "dashboard") return <Dashboard />;
    if (page === "stock") return <StockInventory />;
    if (page === "transactions") return <Transactions setPage={setPage} />;
    if (page === "tickets") return <WeighingTickets />;
    if (page === "new-buy") return <TransactionForm type="BUY" setPage={setPage} prefillParty={prefillParty} clearPrefill={() => setPrefillParty(null)} />;
    if (page === "new-sell") return <TransactionForm type="SELL" setPage={setPage} prefillParty={prefillParty} clearPrefill={() => setPrefillParty(null)} />;
    if (page === "requests") return isAdmin ? <ChangeRequests /> : <PermissionDenied />;
    if (page === "stations") return isAdmin ? <LocationsPage setPage={setPage} setSelectedLocationId={setSelectedLocationId} /> : <PermissionDenied />;
    if (page === "station-detail") return isAdmin ? <LocationDetail locationId={selectedLocationId} setPage={setPage} /> : <PermissionDenied />;
    if (page === "reports") return !isStaff ? <Reports /> : <PermissionDenied />;
    if (page === "payments") return !isStaff ? <Reports initialTab="cashflow" /> : <PermissionDenied />;
    if (page === "users") return isAdmin ? <UsersPage /> : <PermissionDenied />;
    if (page === "roles") return isAdmin ? <RolesPage /> : <PermissionDenied />;
    if (page === "settings") return isAdmin ? <SettingsPage /> : <PermissionDenied />;
    if (page === "receipt-template") return profile?.isOwner ? <ReceiptTemplateEditor /> : <PermissionDenied />;
    if (page === "suppliers") return <SimpleListPage title={t("nav_suppliers")} kind="suppliers" onBuyFor={startBuyFor} onOpenParty={(p) => viewParty(p, "suppliers")} />;
    if (page === "buyers") return <SimpleListPage title={t("nav_buyers")} kind="buyers" onSellFor={startSellFor} onOpenParty={(p) => viewParty(p, "buyers")} />;
    if (page === "party-detail") return <PartyDetail partyId={openParty?.id} kind={openParty?.kind} setPage={setPage} onBuyFor={startBuyFor} onSellFor={startSellFor} />;
    return <Dashboard />;
  }

  function PermissionDenied() {
    return (
      <div className="flex h-screen flex-1 items-center justify-center">
        <p className="text-sm text-slate-500">{t("permission_denied")}</p>
      </div>
    );
  }

  return (
    <div className="flex bg-paper">
      <Sidebar page={page} setPage={setPage} pendingRequests={pendingRequests} />
      {renderPage()}
    </div>
  );
}
