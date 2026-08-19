import {
  LayoutGrid, Warehouse, Receipt, Users, ShoppingCart, MapPin, BarChart3,
  Settings, Languages, ClipboardList, LogOut, UserCog, ShieldCheck, Scale,
} from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";

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
      ]
    : [];

  const isActive = (id) => page === id || (id === "payments" && page === "reports-payments");

  function NavButton({ item }) {
    return (
      <button
        onClick={() => setPage(item.id)}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
          isActive(item.id) ? "bg-brand-600 text-white shadow-sm" : "text-brand-100/80 hover:bg-brand-800 hover:text-white"
        }`}
      >
        <item.icon size={18} className="shrink-0" />
        <span className="flex-1 leading-tight">{item.label}</span>
        {item.badge > 0 && <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">{item.badge}</span>}
      </button>
    );
  }

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col bg-brand-900 px-3 py-4">
      <div className="mb-4 flex items-center gap-2 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-white"><Warehouse size={18} /></div>
        <span className="text-lg font-bold tracking-wide text-white">{t("appName")}</span>
      </div>

      <button onClick={() => setLang(lang === "en" ? "km" : "en")} className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-brand-700 bg-brand-800 px-3 py-2 text-xs font-medium text-brand-100 hover:bg-brand-700">
        <Languages size={14} /> {lang === "en" ? "EN" : "KM"} <span className="text-brand-400">/</span> <span className="text-brand-400">{lang === "en" ? "ខ្មែរ" : "English"}</span>
      </button>

      {profile && (
        <div className="mb-4 rounded-lg border border-brand-700 bg-brand-950 p-2.5">
          <p className="text-xs font-medium text-white">{profile.full_name}</p>
          <p className="flex items-center gap-1 text-[11px] text-brand-400">
            {isOwner && <ShieldCheck size={11} className="text-amber-400" />}
            {profile.roleName || t(`role_${profile.role}`)}
          </p>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {mainNav.map((item) => <NavButton key={item.id} item={item} />)}

        {systemNav.length > 0 && (
          <>
            <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-brand-400">System Management</p>
            {systemNav.map((item) => <NavButton key={item.id} item={item} />)}
          </>
        )}
      </nav>

      <div className="mt-4 border-t border-brand-800 pt-3">
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-brand-100/80 hover:bg-brand-800 hover:text-white">
          <LogOut size={18} /> {t("logout")}
        </button>
      </div>
    </aside>
  );
}
