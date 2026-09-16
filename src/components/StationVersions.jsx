import { useEffect, useMemo, useState } from "react";
import { MonitorSmartphone, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { useLanguage } from "../i18n.jsx";
import { APP_VERSION } from "../version.js";
import { dmyTime } from "../dateFormat.js";

// Which version is each station actually running?
//
// [2026-09-16] Until today nothing in the app could answer that. Reang Kesey
// spent three days on pre-merge code, re-creating a paddy type that had been
// merged away, and the only way to find out was to walk there. SISEN:
// "each location doesnt know or there system wont auto update ... i need a
// professional version of the system. like top level."
//
// Every browser writes what it is running on the heartbeat it already sends
// (api.reportAppVersion). This reads that back, one row per person who has
// signed in recently, grouped by station.
//
// WHAT "NEWEST" MEANS HERE: the highest version string anyone has reported,
// or the one this very page is running, whichever is greater. There is no
// separate list of releases to keep in step — the newest thing anyone has
// seen IS the newest thing. Nothing to maintain, nothing to get wrong.
//
// A station with nothing to report is not shown as behind. It is shown as
// not having checked in, which is a different problem with a different fix.

// Somebody counts for this list if their browser checked in today. Older
// than that and the version they reported says nothing about the machine
// sitting at the weighbridge right now.
const SEEN_WINDOW_MS = 24 * 60 * 60 * 1000;

function isRecent(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < SEEN_WINDOW_MS;
}

export default function StationVersions() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [control, setControl] = useState(null);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState("");
  // A station account may not be allowed to read the staff list at all. That
  // is not an error worth a red box on a page it can otherwise use — the
  // panel just is not for them, so it disappears.
  const [hidden, setHidden] = useState(false);

  async function load() {
    try {
      const [profiles, ctrl] = await Promise.all([api.getProfiles(), api.getAppControl()]);
      setRows(profiles || []);
      setControl(ctrl);
      setError("");
    } catch {
      setHidden(true);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);

  const { stations, newest } = useMemo(() => {
    const seen = (rows || []).filter((r) => isRecent(r.last_seen_at) && r.app_version);
    let top = APP_VERSION === "dev" ? "" : APP_VERSION;
    for (const r of seen) if (r.app_version > top) top = r.app_version;

    const byStation = new Map();
    for (const r of rows || []) {
      const key = r.locationName || "—";
      if (!byStation.has(key)) byStation.set(key, []);
      byStation.get(key).push(r);
    }
    const out = [...byStation.entries()].map(([name, people]) => {
      const active = people.filter((p) => isRecent(p.last_seen_at) && p.app_version);
      const versions = [...new Set(active.map((p) => p.app_version))].sort().reverse();
      return {
        name,
        versions,
        behind: versions.filter((v) => v !== top),
        people: active.sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at)),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { stations: out, newest: top };
  }, [rows]);

  async function push() {
    setPushing(true);
    setError("");
    try {
      await api.requestStationReload();
      await load();
    } catch (err) {
      setError(err.message || "Couldn't send the update.");
    } finally {
      setPushing(false);
    }
  }

  const anyBehind = stations.some((s) => s.behind.length > 0);

  if (hidden) return null;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <MonitorSmartphone size={16} className="text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-800">{t("sh_versions")}</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500">
          {t("sh_newest")} {newest || "—"}
        </span>
        {profile?.isOwner && (
          <button
            type="button"
            onClick={push}
            disabled={pushing}
            className={`ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${anyBehind ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-600 hover:bg-brand-700"}`}
          >
            <RefreshCw size={13} className={pushing ? "animate-spin" : ""} />
            {pushing ? t("sh_pushing") : t("sh_push")}
          </button>
        )}
      </div>

      {error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

      <div className="divide-y divide-slate-100">
        {stations.map((s) => (
          <div key={s.name} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-[120px] text-sm font-medium text-slate-700">{s.name}</span>
            {s.versions.length === 0 ? (
              <span className="text-xs text-slate-400">{t("sh_never_reported")}</span>
            ) : (
              s.versions.map((v) => (
                <span
                  key={v}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${v === newest ? "bg-brand-50 text-brand-700" : "bg-rose-50 text-rose-600"}`}
                >
                  {v === newest ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                  {v}
                </span>
              ))
            )}
            <span className="ml-auto text-[11px] text-slate-400">
              {s.people.slice(0, 3).map((p) => p.full_name).filter(Boolean).join(", ")}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        {t("sh_push_hint")}
        {control?.reload_requested_at ? ` · ${t("sh_pushed_at")} ${dmyTime(control.reload_requested_at)}` : ""}
      </p>
    </div>
  );
}
