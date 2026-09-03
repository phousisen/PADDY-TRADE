import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { useLanguage } from "./i18n.jsx";
import { api } from "./api.js";
import { startAutoSync } from "./offlineQueue.js";
import Login from "./pages/Login.jsx";
import Sidebar from "./components/Sidebar.jsx";
import MobileNav from "./components/MobileNav.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import StockInventory from "./pages/StockInventory.jsx";
import Transactions from "./pages/Transactions.jsx";
import TransactionForm from "./pages/TransactionForm.jsx";
import WeighingTickets from "./pages/WeighingTickets.jsx";
import ChangeRequests from "./pages/ChangeRequests.jsx";
import Reports from "./pages/Reports.jsx";
import Expenses from "./pages/Expenses.jsx";
import SimpleListPage from "./pages/SimpleListPage.jsx";
import LocationsPage from "./pages/LocationsPage.jsx";
import StationHealth from "./pages/StationHealth.jsx";
import LocationDetail from "./pages/LocationDetail.jsx";
import PartyDetail from "./pages/PartyDetail.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import RolesPage from "./pages/RolesPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ReceiptTemplateEditor from "./pages/ReceiptTemplateEditor.jsx";
import RegisterFarmer from "./pages/RegisterFarmer.jsx";
import RegisterPartyStaff from "./pages/RegisterPartyStaff.jsx";
import SetPassword from "./pages/SetPassword.jsx";

export default function App() {
  const { session, profile, loading, hasPermission, isViewOnly } = useAuth();
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

  // [2026-09-01] Where the "Email Invite" link (AddUserModal.jsx /
  // api.inviteUserAccount) lands -- checked before the login gate below,
  // same reasoning as ?register=1 above: clicking the emailed link signs
  // this browser into a short-lived recovery session itself, so this has
  // to work whether or not this browser was already signed in as someone
  // else, and without waiting on the normal profile load.
  if (regParams.get("setpassword") === "1") {
    return <SetPassword />;
  }

  if (loading) {
    return <div className="flex h-screen w-full items-center justify-center bg-slate-50 text-slate-400 text-sm">Loading…</div>;
  }

  if (!session || !profile) {
    return <Login />;
  }

  // [2026-08-31] A deliberately narrow, self-contained restriction: an
  // account whose permission set is EXACTLY ["manage_parties"] and nothing
  // else — no create_transactions, no view_dashboard, nothing — is treated
  // as registration-only and dropped straight onto that one screen, no
  // sidebar, no other page reachable at all. This is what the new
  // "Registrar" role (created from the Roles page: Own Location, only
  // "View & edit farmers/buyers" checked) resolves to.
  //
  // Every role that already existed before this change — Owner, HQ Admin,
  // Manager, Staff, Suspended — carries more than just that one permission
  // (or, for Suspended, none at all), so none of them can ever match this
  // condition. This can only ever affect a role someone deliberately
  // creates with exactly this one narrow permission and nothing more —
  // existing accounts behave exactly as they did before this change.
  const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
  const isRegistrationOnly = permissions.length > 0 && permissions.every((p) => p === "manage_parties");
  if (isRegistrationOnly) {
    return <RegisterPartyStaff />;
  }

  const isAdmin = profile.role === "admin";
  const isStaff = profile.role === "staff";
  // Reports/Payments aren't a blanket Staff deny like the others below —
  // a Staff account with the "View Financial Reports" permission (granted
  // via Settings -> Roles) is allowed in, scoped to their own location by
  // Supabase RLS. See canViewReports below.
  const canViewReports = !isStaff || hasPermission("view_reports");

  function renderPage() {
    // [2026-09-01] `&& !isViewOnly` — a view-only account (see
    // viewOnlyGuard.js) is still a plain "staff" account underneath (it
    // gets full visibility through its own custom role's "All Locations" +
    // every-permission-checked setup, not by pretending to be an HQ
    // Admin), so without this it would get denied here before ever
    // reaching the isAdmin-or-isViewOnly checks below.
    if (isStaff && !isViewOnly && (page === "stations" || page === "station-detail" || page === "station-health" || page === "users" || page === "roles" || page === "settings" || page === "receipt-template")) {
      return <PermissionDenied />;
    }
    if (isStaff && (page === "reports" || page === "payments" || page === "expenses") && !canViewReports) {
      return <PermissionDenied />;
    }
    if (page === "dashboard") return <Dashboard setPage={setPage} setSelectedLocationId={setSelectedLocationId} />;
    if (page === "stock") return <StockInventory />;
    if (page === "transactions") return <Transactions setPage={setPage} />;
    if (page === "tickets") return <WeighingTickets />;
    if (page === "new-buy") return !isViewOnly ? <TransactionForm type="BUY" setPage={setPage} prefillParty={prefillParty} clearPrefill={() => setPrefillParty(null)} /> : <PermissionDenied />;
    if (page === "new-sell") return !isViewOnly ? <TransactionForm type="SELL" setPage={setPage} prefillParty={prefillParty} clearPrefill={() => setPrefillParty(null)} /> : <PermissionDenied />;
    // `isAdmin || isViewOnly` on every line below — a view-only account
    // gets to SEE every one of these pages exactly like an HQ Admin does;
    // it's the pages themselves (and the api.js/offlineQueue.js backstop
    // behind them) that keep every actual edit/create/delete control off
    // limits once it's there. See viewOnlyGuard.js for the full picture.
    if (page === "requests") return (isAdmin || isViewOnly) ? <ChangeRequests /> : <PermissionDenied />;
    if (page === "stations") return (isAdmin || isViewOnly) ? <LocationsPage setPage={setPage} setSelectedLocationId={setSelectedLocationId} /> : <PermissionDenied />;
    if (page === "station-detail") return (isAdmin || isViewOnly) ? <LocationDetail locationId={selectedLocationId} setPage={setPage} /> : <PermissionDenied />;
    if (page === "station-health") return (isAdmin || isViewOnly) ? <StationHealth /> : <PermissionDenied />;
    if (page === "reports") return canViewReports ? <Reports /> : <PermissionDenied />;
    if (page === "payments") return canViewReports ? <Reports initialTab="cashflow" /> : <PermissionDenied />;
    if (page === "expenses") return canViewReports ? <Expenses /> : <PermissionDenied />;
    if (page === "users") return (isAdmin || isViewOnly) ? <UsersPage /> : <PermissionDenied />;
    if (page === "roles") return (isAdmin || isViewOnly) ? <RolesPage /> : <PermissionDenied />;
    if (page === "settings") return (isAdmin || isViewOnly) ? <SettingsPage /> : <PermissionDenied />;
    // Receipt Template Editor retired [2026-08-25]: Receipt.jsx now uses a
    // fixed, verified print design (logo + per-location address/phone,
    // matches the Weigh-In Slip) and no longer reads DEFAULT_RECEIPT_TEMPLATE
    // / mergeReceiptTemplate / ExactWeightTicket from it — those named
    // exports are gone, so <ReceiptTemplateEditor /> is never rendered here
    // (it would crash trying to read style off an undefined template). The
    // page/file itself is left in place, just disconnected, rather than
    // deleted outright.
    if (page === "receipt-template") return profile?.isOwner ? (
      <div className="p-8 text-center text-sm text-slate-500">
        <p className="mb-1 text-base font-semibold text-slate-700">Receipt Template — no longer used</p>
        <p>Printed receipts and weigh-in slips now use a fixed design (with the company logo and each location's own address/phone). Changing anything on this old page would no longer affect what gets printed.</p>
      </div>
    ) : <PermissionDenied />;
    // [2026-08-31] Same screen the restricted "Registrar" role is dropped
    // onto full-screen above — reachable normally via a "Register
    // Farmer/Buyer" button on the Farmers/Buyers pages themselves (not a
    // separate sidebar item — see SimpleListPage.jsx), for any role that
    // already has manage_parties (Staff, Manager, HQ Admin, Owner all do
    // today). Doesn't grant anything new: every one of those roles can
    // already create/edit a party via Suppliers/Buyers — this is just a
    // faster, search-first way to reach the same thing, with the
    // identity-photo verification step built in.
    // `&& !isViewOnly` on all four of these below — a view-only account
    // gets every one of hasPermission("manage_parties")'s checks for free
    // (its custom role has every permission checked, so it can SEE the
    // Farmers & Buyers pages fully), but none of the actual register/buy/
    // sell entry points. Passing `null` instead of a real handler is the
    // SAME pattern SimpleListPage/PartyDetail already use to hide these
    // buttons for a role that lacks manage_parties — nothing new to teach
    // those two files, just one more reason to pass null.
    const canRegisterParty = hasPermission("manage_parties") && !isViewOnly;
    if (page === "register-party") return canRegisterParty ? <RegisterPartyStaff /> : <PermissionDenied />;
    if (page === "suppliers") return <SimpleListPage title={t("nav_suppliers")} kind="suppliers" onBuyFor={isViewOnly ? null : startBuyFor} onOpenParty={(p) => viewParty(p, "suppliers")} onRegister={canRegisterParty ? () => setPage("register-party") : null} onSwitchKind={setPage} />;
    if (page === "buyers") return <SimpleListPage title={t("nav_buyers")} kind="buyers" onSellFor={isViewOnly ? null : startSellFor} onOpenParty={(p) => viewParty(p, "buyers")} onRegister={canRegisterParty ? () => setPage("register-party") : null} onSwitchKind={setPage} />;
    if (page === "party-detail") return <PartyDetail partyId={openParty?.id} kind={openParty?.kind} setPage={setPage} onBuyFor={isViewOnly ? null : startBuyFor} onSellFor={isViewOnly ? null : startSellFor} />;
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
      {/* [2026-08-31] Phone-only bottom tab bar + "More" sheet — takes
          over navigation below the `md` breakpoint, where Sidebar above
          is hidden. Fixed-positioned, so its place in this tree doesn't
          affect layout; see index.css for the matching bottom padding
          added to every page's own scroll area so this doesn't cover
          content. */}
      <MobileNav page={page} setPage={setPage} pendingRequests={pendingRequests} />
    </div>
  );
}
