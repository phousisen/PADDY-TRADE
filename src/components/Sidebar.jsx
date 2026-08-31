import {
  LayoutGrid, Warehouse, Receipt, Users, ShoppingCart, MapPin, BarChart3,
  Settings, Languages, ClipboardList, LogOut, UserCog, ShieldCheck, Scale,
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
  const { profile, logout } = useAuth();
  const isAdmin = profile?.role === "admin";
  const isStaff = profile?.role === "staff";
  const isOwner = !!profile?.isOwner;

  const mainNav = [
    { id: "dashboard", label: t("nav_dashboard"), icon: LayoutGrid },
    { id: "tickets", label: "Weighing Tickets", icon: Scale },
    { id: "transactions", label: t("nav_transactions"), icon: Receipt },
    ...(isAdmin ? [{ id: "requests", label: t("nav_requests"), icon: ClipboardList, badge: pendingRequests }] : []),
    { id: "suppliers", label: t("nav_suppliers"), icon: Users },
    { id: "buyers", label: t("nav_buyers"), icon: ShoppingCart },
    { id: "stock", label: t("nav_stock"), icon: Warehouse },
    ...(!isStaff ? [{ id: "reports", label: t("nav_reports"), icon: BarChart3 }] : []),
  ];

  const systemNav = isAdmin
    ? [
        { id: "stations", label: t("nav_stations"), icon: MapPin },
        { id: "users", label: "Users", icon: UserCog },
        { id: "roles", label: "Roles", icon: ShieldCheck },
        { id: "settings", label: t("nav_settings"), icon: Settings },
        // "Receipt Template" nav entry removed [2026-08-25] — that page no
        // longer affects the printed receipt/slip design (see App.jsx), so
        // it's no longer linked from here. The route itself still exists
        // and shows a plain notice if anyone has it bookmarked.
      ]
    : [];

  const isActive = (id) => page === id || (id === "payments" && page === "reports-payments");

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
    <aside className="flex h-screen w-64 shrink-0 flex-col bg-gradient-to-b from-brand-900 to-brand-950 px-3 py-4">
      {/* Logo — a gradient tile instead of a flat block, so the app feels
          like a real product with a mark rather than an icon on a swatch. */}
      <div className="mb-4 flex items-center gap-2.5 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-md shadow-black/20"><Warehouse size={18} /></div>
        <span className="text-lg font-bold tracking-tight text-white">{t("appName")}</span>
      </div>

      <button onClick={() => setLang(lang === "en" ? "km" : "en")} className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-brand-100 hover:bg-white/10">
        <Languages size={14} /> {lang === "en" ? "EN" : "KM"} <span className="text-brand-400">/</span> <span className="text-brand-400">{lang === "en" ? "ខ្មែរ" : "English"}</span>
      </button>

      {profile && (
        <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 p-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-500 text-[11px] font-bold text-brand-950">
            {(profile.full_name || "U").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-white">{profile.full_name}</p>
            <p className="flex items-center gap-1 text-[10.5px] text-brand-300">
              {isOwner && <ShieldCheck size={11} className="text-gold-300" />}
              {profile.roleName || t(`role_${profile.role}`)}
            </p>
          </div>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {mainNav.map((item) => <NavButton key={item.id} item={item} />)}

        {systemNav.length > 0 && (
          <>
            <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-brand-400">System Management</p>
            {systemNav.map((item) => <NavButton key={item.id} item={item} />)}
          </>
        )}
      </nav>

      <div className="mt-4 border-t border-white/10 pt-3">
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-brand-200/85 hover:bg-white/5 hover:text-white">
          <LogOut size={18} /> {t("logout")}
        </button>
      </div>
    </aside>
  );
}
