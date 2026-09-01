import { useState } from "react";
import {
  LayoutGrid, Scale, Receipt, Users, Menu, X, Warehouse, ShoppingCart,
  MapPin, BarChart3, Settings, Languages, ClipboardList, LogOut, UserCog,
  ShieldCheck, Wallet,
} from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";

// [2026-08-31] Phone-only navigation, shown only below the `md` breakpoint
// (Sidebar.jsx is `hidden md:flex` — this is what takes over below that).
// A fixed bottom tab bar with the 4 screens used constantly, plus a
// "More" tab that opens a full-screen sheet with everything else —
// mirrors Sidebar.jsx's own nav list and the exact same permission checks,
// just presented differently for a small screen. This file does NOT add
// or change what any role can reach — every id here already exists as a
// route in App.jsx's renderPage(), gated by the same isAdmin/isStaff/
// hasPermission checks already enforced there; this only decides what's
// offered to tap.
export default function MobileNav({ page, setPage, pendingRequests }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { lang, setLang, t } = useLanguage();
  const { profile, hasPermission, logout } = useAuth();
  const isAdmin = profile?.role === "admin";
  const isStaff = profile?.role === "staff";
  const isOwner = !!profile?.isOwner;
  // Same rule as App.jsx/Sidebar.jsx's canViewReports — a Staff account
  // granted "View Financial Reports" via Settings -> Roles should see
  // Reports/Expenses here too, not just on desktop.
  const canViewReports = !isStaff || hasPermission("view_reports");

  const primaryTabs = [
    { id: "dashboard", label: t("nav_dashboard"), icon: LayoutGrid },
    { id: "tickets", label: "Tickets", icon: Scale },
    { id: "transactions", label: t("nav_transactions"), icon: Receipt },
    { id: "suppliers", label: t("nav_suppliers"), icon: Users },
  ];

  const moreItems = [
    { id: "buyers", label: t("nav_buyers"), icon: ShoppingCart },
    ...(isAdmin ? [{ id: "requests", label: t("nav_requests"), icon: ClipboardList, badge: pendingRequests }] : []),
    { id: "stock", label: t("nav_stock"), icon: Warehouse },
    ...(canViewReports ? [{ id: "reports", label: t("nav_reports"), icon: BarChart3 }] : []),
    ...(canViewReports ? [{ id: "expenses", label: "Expenses", icon: Wallet }] : []),
  ];

  const systemItems = isAdmin
    ? [
        { id: "stations", label: t("nav_stations"), icon: MapPin },
        { id: "users", label: "Users", icon: UserCog },
        { id: "roles", label: "Roles", icon: ShieldCheck },
        { id: "settings", label: t("nav_settings"), icon: Settings },
      ]
    : [];

  // "More" itself should read as the active tab whenever the open page
  // lives inside it (or its System Management section) — otherwise
  // leaving a page like Buyers or Settings would show nothing highlighted.
  const moreIds = new Set([...moreItems.map((i) => i.id), ...systemItems.map((i) => i.id), "party-detail", "register-party"]);
  const isMoreActive = moreIds.has(page) && !primaryTabs.some((tabItem) => tabItem.id === page);

  function go(id) {
    setPage(id);
    setMoreOpen(false);
  }

  function MenuRow({ item }) {
    return (
      <button
        onClick={() => go(item.id)}
        className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${
          page === item.id ? "bg-white/12 font-semibold text-white" : "text-brand-200/85"
        }`}
      >
        <item.icon size={18} className="shrink-0" />
        <span className="flex-1">{item.label}</span>
        {item.badge > 0 && <span className="rounded-full bg-gold-500 px-1.5 py-0.5 text-[10px] font-bold text-brand-950">{item.badge}</span>}
      </button>
    );
  }

  return (
    <>
      {/* [2026-08-31] Bottom tab bar made bigger per explicit request — icon
          19→22, text 10px→11px, more padding, plus a soft rounded highlight
          behind whichever tab is active so it's clearer at a glance where
          you are. Purely a phone thing (md:hidden), doesn't touch desktop. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-black/20 bg-brand-950 px-1.5 pt-2 md:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      >
        {primaryTabs.map((tabItem) => {
          const active = page === tabItem.id;
          return (
            <button
              key={tabItem.id}
              onClick={() => go(tabItem.id)}
              className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-bold ${active ? "bg-white/10 text-white" : "text-brand-300/70"}`}
            >
              <tabItem.icon size={22} className={active ? "text-brand-400" : ""} />
              {tabItem.label}
            </button>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-bold ${isMoreActive || moreOpen ? "bg-white/10 text-white" : "text-brand-300/70"}`}
        >
          <Menu size={22} className={isMoreActive || moreOpen ? "text-brand-400" : ""} />
          More
        </button>
      </nav>

      {/* Full-screen "More" sheet — everything that isn't one of the 4
          constant-use tabs above. */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-brand-950 md:hidden">
          <div className="flex items-center justify-between px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}>
            <span className="text-base font-bold text-white">{t("appName")}</span>
            <button onClick={() => setMoreOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white" aria-label="Close menu">
              <X size={18} />
            </button>
          </div>

          {profile && (
            <div className="mx-4 mb-4 flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 p-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-500 text-xs font-bold text-brand-950">
                {(profile.full_name || "U").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{profile.full_name}</p>
                <p className="flex items-center gap-1 text-xs text-brand-300">
                  {isOwner && <ShieldCheck size={11} className="text-gold-300" />}
                  {profile.roleName || t(`role_${profile.role}`)}
                </p>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <div className="flex flex-col gap-0.5">
              {moreItems.map((item) => <MenuRow key={item.id} item={item} />)}
            </div>

            {systemItems.length > 0 && (
              <>
                <p className="mb-1 mt-5 px-3 text-[10px] font-semibold uppercase tracking-wider text-brand-400">System Management</p>
                <div className="flex flex-col gap-0.5">
                  {systemItems.map((item) => <MenuRow key={item.id} item={item} />)}
                </div>
              </>
            )}

            <div className="mt-5 flex flex-col gap-0.5 border-t border-white/10 pt-3">
              <button onClick={() => setLang(lang === "en" ? "km" : "en")} className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm text-brand-200/85">
                <Languages size={18} className="shrink-0" />
                <span className="flex-1">{lang === "en" ? "English" : "ខ្មែរ"}</span>
                <span className="text-xs text-brand-400">{lang === "en" ? "Switch to KM" : "Switch to EN"}</span>
              </button>
              <button onClick={logout} className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm text-brand-200/85">
                <LogOut size={18} className="shrink-0" />
                {t("logout")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
