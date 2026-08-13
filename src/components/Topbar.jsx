import { Search, Bell } from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";

export default function Topbar({ title, subtitle }) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div>
        {title && <h1 className="text-lg font-semibold text-slate-800">{title}</h1>}
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder={t("search_placeholder")} className="w-64 rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        </div>
        <button className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100">
          <Bell size={18} /><span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400" />
        </button>
        {profile && (
          <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white">
              {(profile.full_name || "U").charAt(0).toUpperCase()}
            </div>
            <div className="leading-tight">
              <p className="text-sm font-medium text-slate-700">{profile.full_name}</p>
              <p className="text-xs text-slate-400">{t(`role_${profile.role}`)}</p>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
