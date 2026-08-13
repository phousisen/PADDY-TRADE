import { useState } from "react";
import { Warehouse, Languages } from "lucide-react";
import { useAuth } from "../AuthContext.jsx";
import { useLanguage } from "../i18n.jsx";

export default function Login() {
  const { login } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const err = await login(email.trim(), password);
    setLoading(false);
    if (err) setError(t("login_error"));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Warehouse size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">{t("appName")}</h1>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-center text-lg font-semibold text-slate-800">{t("login_title")}</h2>
          <p className="mb-5 text-center text-sm text-slate-400">{t("login_subtitle")}</p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">{t("email")}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                placeholder="you@paddytrade.local"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">{t("password")}</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-sm text-rose-500">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? t("signing_in") : t("sign_in")}
            </button>
          </form>
        </div>

        <button
          onClick={() => setLang(lang === "en" ? "km" : "en")}
          className="mx-auto mt-4 flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
        >
          <Languages size={14} /> {lang === "en" ? "EN" : "KM"} / {lang === "en" ? "ខ្មែរ" : "English"}
        </button>
      </div>
    </div>
  );
}
