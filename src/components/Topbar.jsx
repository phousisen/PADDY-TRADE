import { Search, Bell } from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";

export default function Topbar({ title, subtitle }) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-7 py-4">
      <div>
        {title && <h1 className="text-xl font-bold tracking-tight text-slate-800">{title}</h1>}
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder={t("search_placeholder")} className="w-64 rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100" />
        </div>
        <button className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-100">
          <Bell size={17} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold-500" />
        </button>
        {profile && (
          <div className="flex items-center gap-2.5 border-l border-slate-200 pl-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-semibold text-white shadow-sm">
              {(profile.full_name || "U").charAt(0).toUpperCase()}
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-700">{profile.full_name}</p>
              <p className="text-xs text-slate-400">{t(`role_${profile.role}`)}</p>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
