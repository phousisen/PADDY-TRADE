import {
  LayoutGrid, Warehouse, Receipt, Users, MapPin, BarChart3,
  Settings, Languages, ClipboardList, LogOut, UserCog, ShieldCheck, Scale, Wallet,
} from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";

// [2026-08-31] Registration was briefly its own top-level sidebar item —
// dropped in favor of a "Register Farmer/Buyer" button living directly on
// the Farmers/Buyers pages instead (see SimpleListPage.jsx), so the
// sidebar itself stays exactly as many rows as it was before this
// feature existed.
export default function Sidebar({ page, setPage, pendingRequests }) {
  const { lang, setLang, t } = useLanguage();
  const { profile, hasPermission, logout } = useAuth();
  const isAdmin = profile?.role === "admin";
  const isStaff = profile?.role === "staff";
  const isOwner = !!profile?.isOwner;
  // A Staff account with "View Financial Reports" granted via Settings ->
  // Roles gets the Reports link too, same rule as App.jsx's canViewReports.
  const canViewReports = !isStaff || hasPermission("view_reports");

  // [2026-09-01] Reorganized into labeled groups (Operations / Directory /
  // Inventory & Reports / System) instead of one long flat list, so the
  // sidebar reads like an organized product's nav rather than a dumped
  // list of every page in the order they were built. No page, permission
  // check, or route changed — only grouping/order/labels.
  const navGroups = [
    { label: null, items: [{ id: "dashboard", label: t("nav_dashboard"), icon: LayoutGrid }] },
    {
      label: "Operations",
      items: [
        { id: "tickets", label: "Weighing Tickets", icon: Scale },
        { id: "transactions", label: t("nav_transactions"), icon: Receipt },
        ...(isAdmin ? [{ id: "requests", label: t("nav_requests"), icon: ClipboardList, badge: pendingRequests }] : []),
      ],
    },
    {
      label: "Directory",
      // Farmers and Buyers used to be two separate nav items pointing at
      // two separate pages. They're still two separate pages/routes under
      // the hood (nothing about party detail / register / navigation logic
      // changed) — but they now share one nav entry, with a Farmers/Buyers
      // toggle living inside the page itself (SimpleListPage.jsx). This
      // link always opens on Farmers; it stays highlighted on either tab.
      items: [{ id: "suppliers", label: "Farmers & Buyers", icon: Users }],
    },
    {
      label: "Inventory & Reports",
      items: [
        { id: "stock", label: t("nav_stock"), icon: Warehouse },
        ...(canViewReports ? [{ id: "reports", label: t("nav_reports"), icon: BarChart3 }] : []),
        // Its own sidebar item rather than a tab inside Financial Reports —
        // staff who log daily expenses shouldn't have to go through the
        // Reports section to reach it. Gated by the same canViewReports
        // permission as Financial Reports, since it's still financial data.
        ...(canViewReports ? [{ id: "expenses", label: "Expenses", icon: Wallet }] : []),
      ],
    },
    ...(isAdmin
      ? [{
          label: "System",
          items: [
            { id: "stations", label: t("nav_stations"), icon: MapPin },
            { id: "users", label: "Users", icon: UserCog },
            { id: "roles", label: "Roles", icon: ShieldCheck },
            { id: "settings", label: t("nav_settings"), icon: Settings },
            // "Receipt Template" nav entry removed [2026-08-25] — that page
            // no longer affects the printed receipt/slip design (see
            // App.jsx), so it's no longer linked from here. The route
            // itself still exists and shows a plain notice if anyone has
            // it bookmarked.
          ],
        }]
      : []),
  ];

  const isActive = (id) =>
    page === id ||
    (id === "payments" && page === "reports-payments") ||
    (id === "suppliers" && page === "buyers"); // merged "Farmers & Buyers" nav item stays highlighted on either tab

  function NavButton({ item }) {
    return (
      <button
        onClick={() => setPage(item.id)}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
          isActive(item.id) ? "bg-white/12 font-semibold text-white" : "text-brand-200/85 hover:bg-white/5 hover:text-white"
        }`}
      >
        <item.icon size={18} className="shrink-0" />
        <span className="flex-1 leading-tight">{item.label}</span>
        {item.badge > 0 && <span className="rounded-full bg-gold-500 px-1.5 py-0.5 text-[10px] font-bold text-brand-950">{item.badge}</span>}
      </button>
    );
  }

  return (
    // [2026-08-31] Hidden below the `md` breakpoint — MobileNav.jsx (a
    // fixed bottom tab bar + a full-screen "More" sheet) takes over
    // navigation on phone-width screens instead. This is the only line
    // that changed in this file: everything else — nav items, permission
    // checks, styling — is untouched, so desktop/tablet behavior is
    // pixel-identical to before.
    <aside className="hidden h-screen w-64 shrink-0 flex-col bg-gradient-to-b from-brand-900 to-brand-950 px-3 py-4 md:flex">
      {/* Header: logo + identity + language, tightened into one compact
          block instead of three separately-boxed rows, plus a thin
          divider to separate it from navigation — reads like a single
          "account" header the way most business software does it. */}
      <div className="mb-3 flex items-center gap-2.5 px-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-md shadow-black/20"><Warehouse size={18} /></div>
        <span className="text-lg font-bold tracking-tight text-white">{t("appName")}</span>
      </div>

      {profile && (
        <div className="mb-2.5 flex items-center gap-2.5 rounded-lg bg-white/5 p-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-500 text-[12px] font-bold text-brand-950">
            {(profile.full_name || "U").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">{profile.full_name}</p>
            <p className="flex items-center gap-1 text-[10.5px] text-brand-300">
              {isOwner && <ShieldCheck size={11} className="text-gold-300" />}
              {profile.roleName || t(`role_${profile.role}`)}
            </p>
          </div>
          <button
            onClick={() => setLang(lang === "en" ? "km" : "en")}
            title={lang === "en" ? "Switch to Khmer" : "Switch to English"}
            className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 px-1.5 py-1 text-[10.5px] font-medium text-brand-200 hover:bg-white/10 hover:text-white"
          >
            <Languages size={12} /> {lang === "en" ? "EN" : "ខ្មែរ"}
          </button>
        </div>
      )}

      <div className="mb-1 border-t border-white/10" />

      <nav className="flex flex-1 flex-col overflow-y-auto pt-1">
        {navGroups.map((group, gi) => (
          <div key={group.label || `g${gi}`} className={gi > 0 ? "mt-3" : ""}>
            {group.label && <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-brand-400">{group.label}</p>}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => <NavButton key={item.id} item={item} />)}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-3 border-t border-white/10 pt-3">
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-brand-200/85 hover:bg-white/5 hover:text-white">
          <LogOut size={18} /> {t("logout")}
        </button>
      </div>
    </aside>
  );
}
