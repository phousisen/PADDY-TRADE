import { useState } from "react";
import { Warehouse, Languages } from "lucide-react";
import { useAuth } from "../AuthContext.jsx";
import { useLanguage } from "../i18n.jsx";
import { loginCandidates } from "../loginName.js";
import { readSignOutNote, shouldShowNote, reasonKey, needsAttention } from "../signOutReason.js";
import { dmyTime } from "../dateFormat.js";

export default function Login() {
  const { login } = useAuth();
  const { lang, setLang, t } = useLanguage();
  // Named `email` because that is what the database column is called. What
  // a person types here is a NAME — "boss", "012934050" — and toLoginEmail
  // puts the domain on. See loginName.js.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // [2026-09-17] SISEN: "why do we always get logged out". Read once, on the
  // screen that is actually asking the question — see signOutReason.js. The
  // useState initialiser rather than an effect, so it cannot flash in late.
  const [note] = useState(() => {
    const n = readSignOutNote();
    return shouldShowNote({ note: n }) ? n : null;
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // [2026-09-16] A typed name can belong to either house domain — the
    // new accounts on paddytrade.com, or older ones like
    // boss@paddytrade.local. Try each until one is accepted, so nobody has
    // to know which era their account comes from. A real address, and a
    // correct password on the first domain, both stop at one attempt.
    const candidates = loginCandidates(email);
    let err = null;
    for (const address of candidates) {
      err = await login(address, password);
      if (!err) break;
    }
    setLoading(false);
    if (err || candidates.length === 0) setError(t("login_error"));
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

          {/* Why the last session ended. Amber only for the one cause that
              means something is wrong — an expired login — because an amber
              box on "you pressed Log out" would teach everyone to ignore it. */}
          {note && (
            <div className={`mb-4 rounded-lg border px-3 py-2.5 text-xs ${
              needsAttention(note.reason)
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-slate-200 bg-slate-50 text-slate-500"
            }`}>
              <span className="block font-medium">{t(reasonKey(note.reason))}</span>
              <span className="text-[11px] opacity-80">{dmyTime(note.at)}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">{t("login_name")}</label>
              {/* [2026-09-16] A plain text box, deliberately. Given the email
                  input type the browser itself refuses to submit a value with
                  no "@" in it, before any of our code gets to run — so a bare
                  name would be impossible however loginName.js behaves.
                  Guarded by scripts-check-login.mjs. */}
              <input
                type="text"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                placeholder={t("login_name_hint")}
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
