import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw, CheckCircle2, AlertTriangle, WifiOff, Clock, Monitor, Smartphone, Info,
} from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { useLanguage } from "../i18n.jsx";
import { APP_VERSION, shortVersion } from "../version.js";
import { dmyTime, hm } from "../dateFormat.js";
import { deviceLabel, describeDevice } from "../deviceId.js";
import { buildBoard } from "../deviceWatch.js";
import { getAccurateNow } from "../supabaseClient.js";

// Everything about a station, on one line.
//
// [2026-09-16] The first version of this put a version panel ABOVE the older
// Active/Quiet cards, so the page had two lists describing the same five
// places and disagreeing about which mattered. It also printed "Quit and
// reopen the app at this station." five times, counted "1 device(s)", and
// listed SISEN's own email back to him as somebody else who was signed in.
// He said: "not professional and proper at all." He was right.
//
// One table now. Station, can we reach it, what is it running, what has it
// traded today, and which machines are signed in — the last tucked under
// their own station rather than in a separate panel.
//
// Every rule about reachability and what counts as odd lives in
// deviceWatch.js, which is pure and tested. This file only draws.
//
// THE ORDER IS THE POINT: worst first. On a good day the summary line in the
// header answers the question and nobody reads a row.

const REFRESH_MS = 30000;

const CONN = {
  ok:    { cls: "bg-brand-50 text-brand-700", Icon: CheckCircle2, key: "st_connected" },
  quiet: { cls: "bg-amber-50 text-amber-700 border border-amber-200", Icon: Clock, key: "st_quiet" },
  gone:  { cls: "bg-rose-100 text-rose-700", Icon: WifiOff, key: "st_unreachable" },
  none:  { cls: "bg-slate-100 text-slate-500 font-medium", Icon: Clock, key: "st_not_reported" },
};
const RAIL = { ok: "bg-brand-600", quiet: "bg-amber-500", gone: "bg-rose-600", none: "bg-slate-300" };

// One chip per device at most — five chips on a row is noise, not information.
const FLAG_ORDER = ["behind", "shared_login", "not_a_pc", "new_device"];
const FLAG_KEY = {
  behind: "sh_behind",
  shared_login: "sh_shared_login",
  not_a_pc: "sh_not_a_pc",
  new_device: "sh_new_device",
};
const topFlag = (flags) => FLAG_ORDER.find((f) => flags.includes(f)) || null;

/** Minutes of silence, for the "· 14 min" on a connection chip. */
function minutesSince(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / 60000));
}

/** "just now" / "12 min ago" / "3 hr ago" / "2 d ago", in the reader's language. */
function ago(iso, now, t) {
  const m = minutesSince(iso, now);
  if (m === null) return null;
  if (m < 1) return t("sh_just_now");
  if (m < 60) return t("st_ago_min").replace("{n}", String(m));
  const h = Math.round(m / 60);
  if (h < 24) return t("st_ago_hr").replace("{n}", String(h));
  return t("st_ago_day").replace("{n}", String(Math.round(h / 24)));
}

function DeviceLine({ d, t, now }) {
  const Icon = d.platform === "Phone" || d.platform === "Tablet" ? Smartphone : Monitor;
  const flag = topFlag(d.flags);
  return (
    <div className="flex flex-wrap items-center gap-2 py-[3px] text-[12px] text-slate-400">
      <Icon size={12} className="shrink-0 text-slate-300" />
      <span className="font-semibold text-slate-600">{d.name}</span>
      <span>{deviceLabel(d.device_id)}</span>
      {flag && (
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 text-[10.5px] font-semibold text-amber-700">
          {t(FLAG_KEY[flag])}
        </span>
      )}
      <span className="ml-auto text-[11px]">
        {d.reach === "ok" ? t("sh_just_now") : `${t("st_last_heard")} ${hm(d.last_seen_at)}`}
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
  const [txs, setTxs] = useState([]);
  const [control, setControl] = useState(null);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // A station account may not be allowed to read the staff list at all. That
  // is not worth a red box on a page it can otherwise use — the panel simply
  // is not for them, so it disappears.
  const [hidden, setHidden] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [ps, locs, ctrl, devs, transactions] = await Promise.all([
        api.getProfiles(), api.getLocations(), api.getAppControl(),
        api.getDeviceSessions(), api.getTransactions(),
      ]);
      setProfiles(ps || []);
      setLocations(locs || []);
      setControl(ctrl);
      setSessions(devs || []);
      // Same "doesn't count" convention as everywhere else — a cancelled
      // transaction must not make a station look busier than it was.
      setTxs((transactions || []).filter((x) => x.hq_status !== "cancelled"));
      setError("");
    } catch {
      setHidden(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Re-render on a timer as well as on a fetch, so "quiet" becomes "not
  // reachable" on its own. Otherwise a station could go dark and the screen
  // would keep showing the last happy answer until somebody reloaded.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const now = getAccurateNow().getTime();
  const today = useMemo(() => {
    const p = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(now)).forEach((x) => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day}`;
  }, [Math.floor(now / 3600000)]);

  const board = useMemo(
    () => buildBoard({ sessions, profiles, locations, runningVersion: APP_VERSION }),
    [sessions, profiles, locations, tick],
  );

  // What each station has traded today — the figures that used to sit in a
  // second panel of their own below this one.
  const trading = useMemo(() => {
    const out = new Map();
    for (const loc of locations) {
      const mine = txs.filter((x) => x.location_id === loc.id);
      const last = mine.reduce((best, x) =>
        (!best || new Date(x.created_at) > new Date(best.created_at) ? x : best), null);
      out.set(loc.id, { count: mine.filter((x) => x.tx_date === today).length, lastAt: last?.created_at || null });
    }
    return out;
  }, [txs, locations, today]);

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

  const { stations, newest, current, deviceCount, silent } = board;
  const attention = stations.filter(
    (s) => s.reach === "gone" || s.behind > 0 || s.flags.some((f) => FLAG_KEY[f]),
  ).length;
  const allGood = stations.length > 0 && attention === 0 && current === stations.length;
  const needReopen = stations.filter((s) => s.devices.length === 0).length;
  const me = describeDevice();

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* ── header ── */}
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2 px-4 pb-3 pt-3.5">
        <h3 className="text-[15px] font-semibold text-slate-800">{t("st_title")}</h3>
        <span className="text-[12.5px] text-slate-500">
          {silent
            ? t("st_waiting")
            : allGood
              ? <span className="font-semibold text-brand-700">{t("st_all_good").replace("{n}", String(stations.length))}</span>
              : (
                <>
                  <span className="font-semibold text-rose-600">
                    {t("st_attention").replace("{n}", String(attention)).replace("{all}", String(stations.length))}
                  </span>
                  {deviceCount > 0 && <> · <b className="font-semibold text-slate-700">{t("st_machines").replace("{n}", String(deviceCount))}</b></>}
                </>
              )}
        </span>
        {profile?.isOwner && (
          <button
            type="button"
            onClick={push}
            disabled={pushing || silent}
            title={silent ? t("sh_push_pointless") : ""}
            className={`ml-auto self-center flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed ${
              silent ? "border border-slate-200 bg-transparent text-slate-400"
                : attention ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "bg-brand-600 text-white hover:bg-brand-700"}`}
          >
            <RefreshCw size={13} className={pushing ? "animate-spin" : ""} />
            {pushing ? t("sh_pushing") : t("sh_push")}
          </button>
        )}
      </div>

      {/* ── the one-time instruction. Once, not once per station. ── */}
      {needReopen > 0 && !loading && (
        <div className="mx-4 mb-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <Info size={15} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-[13px] text-slate-600">
            <b className="text-amber-800">{t("st_reopen_title")}</b> {t("st_reopen_why")}
          </p>
        </div>
      )}

      {error && <p className="mx-4 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

      {/* ── one table ── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[9.5px] font-bold uppercase tracking-[.11em] text-slate-400">
              <th className="border-y border-slate-100 px-4 py-2 text-left">{t("st_col_station")}</th>
              <th className="border-y border-slate-100 px-4 py-2 text-left">{t("st_col_connection")}</th>
              <th className="border-y border-slate-100 px-4 py-2 text-left">{t("st_col_version")}</th>
              <th className="border-y border-slate-100 px-4 py-2 text-left">{t("st_col_trading")}</th>
              <th className="border-y border-slate-100 px-4 py-2 text-right">{t("st_col_users")}</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((s, i) => {
              const meta = CONN[s.reach] || CONN.none;
              const { Icon } = meta;
              const mins = minutesSince(s.devices[0]?.last_seen_at, now);
              const trade = trading.get(s.id) || { count: 0, lastAt: null };
              const shown = s.devices[0]?.app_version;
              return (
                <Fragmentish key={s.id} first={i === 0}>
                  <tr>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5 text-sm font-semibold tracking-wide text-slate-800">
                        <i className={`h-4 w-[3px] shrink-0 rounded-full ${RAIL[s.reach]}`} />
                        {s.name}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${meta.cls}`}>
                        <Icon size={11} />
                        {t(meta.key)}
                        {(s.reach === "gone" || s.reach === "quiet") && mins != null
                          ? ` · ${t("st_n_min").replace("{n}", String(mins))}` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {shown ? (
                        <span className={`rounded-full px-2 py-0.5 font-mono text-[11.5px] font-semibold ${
                          newest && shown !== newest ? "bg-rose-100 text-rose-700" : "bg-brand-50 text-brand-700"}`}>
                          {shortVersion(shown)}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-slate-600 tabular-nums">
                      {trade.count > 0 || trade.lastAt ? (
                        <>
                          {t("st_n_tickets").replace("{n}", String(trade.count))}
                          {trade.lastAt && <span className="text-slate-300"> · {ago(trade.lastAt, now, t)}</span>}
                        </>
                      ) : <span className="text-slate-300">{t("st_no_trading")}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[12.5px] tabular-nums text-slate-600">
                      {s.devices.length || <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                  {s.devices.length > 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 pb-2 pl-[38px] pt-0">
                        {s.devices.map((dv) => (
                          <DeviceLine key={`${dv.device_id}:${dv.user_id}`} d={dv} t={t} now={now} />
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragmentish>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── footer: the build, the rhythm, and you ── */}
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
        <span className="ml-auto flex items-center gap-2">
          <span className="rounded border border-brand-100 bg-brand-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-brand-700">
            {t("sh_you")}
          </span>
          <span>{t("sh_hq")} · {me.platform} · {me.browser}</span>
          <span className={`font-mono font-semibold ${
            !newest || APP_VERSION === newest ? "text-brand-700" : "text-rose-600"}`}>
            {shortVersion(APP_VERSION)}
          </span>
        </span>
      </div>
    </div>
  );
}

// A <tbody> cannot hold a fragment with a key in older React without this
// wrapper, and two <tr>s per station is exactly what the layout needs: the
// station, then its machines indented underneath it.
function Fragmentish({ children, first }) {
  return (
    <>
      {!first && <tr className="h-px"><td colSpan={5} className="border-t border-slate-100 p-0" /></tr>}
      {children}
    </>
  );
}
