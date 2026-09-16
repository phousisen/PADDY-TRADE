import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MonitorSmartphone, RefreshCw, CheckCircle2, AlertTriangle, WifiOff,
  Monitor, Smartphone, Clock,
} from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { useLanguage } from "../i18n.jsx";
import { APP_VERSION, shortVersion } from "../version.js";
import { dmyTime, hm } from "../dateFormat.js";
import { deviceLabel } from "../deviceId.js";
import { buildBoard } from "../deviceWatch.js";

// Who is actually in the system, on what machine, running what.
//
// [2026-09-16] Until today nothing in the app could answer any of that. Reang
// Kesey spent three days on pre-merge code and the only way to find out was
// to walk there. SISEN: "i want to see how many devices are logged into each
// account ... if the computer network is not working, does it auto load in
// the system that shows those station network is not connected ... we just
// want to track who is actually in the system."
//
// Every rule about what counts as odd lives in deviceWatch.js, which is pure
// and tested. This file only draws.
//
// THE ORDER IS THE POINT. Worst first — unreachable, then behind, then
// anything odd, then fine. On a good day the header alone answers the
// question and nobody reads a row.

const REFRESH_MS = 30000;

const REACH = {
  ok:    { cls: "bg-brand-50 text-brand-700", Icon: CheckCircle2, key: "sh_reachable" },
  quiet: { cls: "bg-amber-50 text-amber-700 border border-amber-200", Icon: Clock, key: "sh_quiet_now" },
  gone:  { cls: "bg-rose-100 text-rose-700", Icon: WifiOff, key: "sh_unreachable" },
  none:  { cls: "bg-slate-100 text-slate-500", Icon: Clock, key: "sh_never_reported" },
};

const RAIL = { ok: "bg-brand-600", quiet: "bg-amber-500", gone: "bg-rose-600", none: "bg-slate-300" };
const TINT = { gone: "bg-rose-50", quiet: "bg-amber-50/60", ok: "", none: "" };

// Worst flag first — one chip per row, not five.
const FLAG_ORDER = ["gone", "behind", "shared_login", "not_a_pc", "new_device", "quiet"];
const FLAG_KEY = {
  behind: "sh_behind",
  shared_login: "sh_shared_login",
  not_a_pc: "sh_not_a_pc",
  new_device: "sh_new_device",
};

function topFlag(flags) {
  for (const f of FLAG_ORDER) if (flags.includes(f) && FLAG_KEY[f]) return f;
  return null;
}

function Pips({ stations }) {
  return (
    <span className="ml-2 inline-flex gap-[3px] align-middle">
      {stations.map((s) => (
        <span
          key={s.id}
          title={s.name}
          className={`h-[5px] w-3.5 rounded-full ${
            s.reach === "gone" ? "bg-rose-600"
              : s.behind ? "bg-rose-600"
                : s.reach === "none" ? "bg-slate-300"
                  : s.flags.length ? "bg-amber-500" : "bg-brand-600"}`}
        />
      ))}
    </span>
  );
}

function DeviceRow({ d, t, newest }) {
  const Icon = d.platform === "Phone" || d.platform === "Tablet" ? Smartphone : Monitor;
  const flag = topFlag(d.flags);
  const behind = newest && d.app_version && d.app_version !== newest;
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-l border-dashed border-slate-200 py-1 pl-3 text-[12.5px]">
      <Icon size={13} className="shrink-0 text-slate-300" />
      <span className="font-semibold text-slate-600">{d.name}</span>
      <span className="text-slate-400">{deviceLabel(d.device_id)}</span>
      {flag && (
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[10.5px] font-semibold text-amber-700">
          {t(FLAG_KEY[flag])}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2.5">
        <span className={`rounded-full px-2 py-px font-mono text-[11px] font-semibold ${
          behind ? "bg-rose-100 text-rose-700" : "bg-brand-50 text-brand-700"}`}>
          {shortVersion(d.app_version) || "—"}
        </span>
        <span className="min-w-[68px] text-right text-[11px] text-slate-400">
          {d.reach === "ok" ? t("sh_just_now") : hm(d.last_seen_at)}
        </span>
      </span>
    </div>
  );
}

export default function StationVersions() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [control, setControl] = useState(null);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState("");
  // A station account may not be allowed to read the staff list at all. That
  // is not worth a red box on a page it can otherwise use — the panel simply
  // is not for them, so it disappears.
  const [hidden, setHidden] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [ps, locs, ctrl, devs] = await Promise.all([
        api.getProfiles(), api.getLocations(), api.getAppControl(), api.getDeviceSessions(),
      ]);
      setProfiles(ps || []);
      setLocations(locs || []);
      setControl(ctrl);
      setSessions(devs || []);
      setError("");
    } catch {
      setHidden(true);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Re-render on a timer as well as on a fetch, so "quiet" turns into "not
  // reachable" on its own. Otherwise a station could go dark and the screen
  // would keep showing the last happy answer until somebody reloaded.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const board = useMemo(
    () => buildBoard({ sessions, profiles, locations, runningVersion: APP_VERSION }),
    [sessions, profiles, locations, tick],
  );

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

  if (hidden) return null;

  const { stations, newest, roaming, current, deviceCount, silent } = board;
  const anyBad = stations.some((s) => s.reach === "gone" || s.behind > 0);
  const allGood = stations.length > 0 && current === stations.length;

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* ── header ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <MonitorSmartphone size={17} className="shrink-0 text-slate-400" />
        <h3 className="text-[14.5px] font-semibold text-slate-800">{t("sh_versions")}</h3>
        <span className={`text-xs font-semibold ${allGood ? "text-brand-700" : "text-slate-600"}`}>
          {allGood
            ? t("sh_all_current").replace("{n}", String(stations.length))
            : t("sh_n_current").replace("{n}", String(current)).replace("{all}", String(stations.length))}
          {deviceCount > 0 && <span className="font-normal text-slate-400"> · {t("sh_n_devices").replace("{n}", String(deviceCount))}</span>}
          <Pips stations={stations} />
        </span>
        {profile?.isOwner && (
          <button
            type="button"
            onClick={push}
            disabled={pushing || silent}
            title={silent ? t("sh_push_pointless") : ""}
            className={`ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed ${
              silent ? "border border-slate-200 bg-transparent text-slate-400"
                : anyBad ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "bg-brand-600 text-white hover:bg-brand-700"}`}
          >
            <RefreshCw size={13} className={pushing ? "animate-spin" : ""} />
            {pushing ? t("sh_pushing") : t("sh_push")}
          </button>
        )}
      </div>

      {/* ── you, and anyone else who moves around ── */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 bg-brand-50/70 px-4 py-2 text-[12.5px] text-slate-600">
        <span className="rounded border border-brand-100 bg-white px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-brand-700">
          {t("sh_you")}
        </span>
        <span>{t("sh_hq")}</span>
        <span className={`font-mono text-[11.5px] font-semibold ${
          APP_VERSION === newest || !newest ? "text-brand-700" : "text-rose-600"}`}>
          {shortVersion(APP_VERSION)}
        </span>
        {roaming.length > 0 && (
          <span className="ml-auto truncate text-[11px] text-slate-400">
            {t("sh_also_signed_in")} {roaming.slice(0, 4).map((r) => r.name).join(", ")}
            {roaming.length > 4 ? ` +${roaming.length - 4}` : ""}
          </span>
        )}
      </div>

      {error && <p className="mx-4 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

      {/* ── the stations ── */}
      <div>
        {stations.map((s) => {
          const meta = REACH[s.reach] || REACH.none;
          const { Icon } = meta;
          const oddest = topFlag(s.flags);
          const last = s.devices[0]?.last_seen_at;
          return (
            <div key={s.id} className="border-b border-slate-100 last:border-b-0">
              <div className={`flex items-stretch gap-3 ${TINT[s.reach] || ""}`}>
                <span className={`w-[3px] shrink-0 rounded-r-full ${RAIL[s.reach]}`} />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5 py-2.5 pr-4">
                  <span className="text-sm font-semibold tracking-wide text-slate-800">{s.name}</span>
                  <span className="text-[11px] text-slate-400">
                    {s.devices.length
                      ? t("sh_n_devices").replace("{n}", String(s.devices.length))
                      : t("sh_no_device")}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {s.behind > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2 py-0.5 text-[11.5px] font-semibold text-rose-700">
                        <AlertTriangle size={11} />{t("sh_behind")}
                      </span>
                    )}
                    {s.behind === 0 && oddest && oddest !== "gone" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-700">
                        <AlertTriangle size={11} />{t(FLAG_KEY[oddest])}
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${meta.cls}`}>
                      <Icon size={11} />
                      {t(meta.key)}
                      {s.reach === "gone" && last ? ` · ${hm(last)}` : ""}
                    </span>
                  </span>
                </div>
              </div>
              {s.devices.length > 0 && (
                <div className="flex flex-col gap-0.5 py-1 pl-5 pr-4">
                  {s.devices.map((d) => (
                    <DeviceRow key={`${d.device_id}:${d.user_id}`} d={d} t={t} newest={newest} />
                  ))}
                </div>
              )}
              {s.devices.length === 0 && (
                <p className="py-1 pl-8 pr-4 text-[11.5px] text-amber-700">{t("sh_reopen_here")}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── footer ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-[11.5px] text-slate-400">
        <span>{t("sh_newest")} <b className="font-mono text-slate-500">{newest || "—"}</b></span>
        <span className="text-slate-300">·</span>
        <span>{t("sh_checkin_note")}</span>
        {control?.reload_requested_at && (
          <>
            <span className="text-slate-300">·</span>
            <span>{t("sh_pushed_at")} {dmyTime(control.reload_requested_at)}</span>
          </>
        )}
      </div>
    </div>
  );
}
