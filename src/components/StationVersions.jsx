import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw, CheckCircle2, WifiOff, Clock, Monitor, Smartphone, Info, LogOut, X,
} from "lucide-react";
import { api } from "../api.js";
import { reasonKey, needsAttention } from "../signOutReason.js";
import { useAuth } from "../AuthContext.jsx";
import { useLanguage } from "../i18n.jsx";
import { APP_VERSION, shortVersion } from "../version.js";
import { dmyTime, hm } from "../dateFormat.js";
import { deviceLabel, describeDevice } from "../deviceId.js";
import { buildBoard } from "../deviceWatch.js";
import { placeLabel } from "../deviceNet.js";
import { getAccurateNow } from "../supabaseClient.js";
import { scaleState } from "../scaleAlert.js";

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
  // Heard from, and struggling. A flat green here was the thing SISEN caught.
  patchy: { cls: "bg-amber-50 text-amber-700 border border-amber-200", Icon: WifiOff, key: "st_patchy" },
  quiet: { cls: "bg-amber-50 text-amber-700 border border-amber-200", Icon: Clock, key: "st_quiet" },
  gone:  { cls: "bg-rose-100 text-rose-700", Icon: WifiOff, key: "st_unreachable" },
  none:  { cls: "bg-slate-100 text-slate-500 font-medium", Icon: Clock, key: "st_not_reported" },
};
const RAIL = { ok: "bg-brand-600", patchy: "bg-amber-500", quiet: "bg-amber-500", gone: "bg-rose-600", none: "bg-slate-300" };

// One chip per device at most — five chips on a row is noise, not information.
const FLAG_ORDER = ["behind", "new_network", "shared_login", "not_a_pc", "new_device"];
const FLAG_KEY = {
  behind: "sh_behind",
  new_network: "st_new_network",
  shared_login: "sh_shared_login",
  not_a_pc: "sh_not_a_pc",
  new_device: "sh_new_device",
};
const topFlag = (flags) => FLAG_ORDER.find((f) => flags.includes(f)) || null;

// Khmer has no plural form, so the choice is made by KEY rather than by a
// rule — "1 tickets" and "2 of 5 needs attention" were both on screen at the
// same moment, and one of them was describing the two stations that had done
// exactly what was asked.
function plural(t, key, n, extra) {
  let out = t(n === 1 ? `${key}_one` : key).replace("{n}", String(n));
  for (const [k, v] of Object.entries(extra || {})) out = out.replace(`{${k}}`, String(v));
  return out;
}

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

function DeviceLine({ d, t, canSignOut, onSignOut }) {
  const Icon = d.platform === "Phone" || d.platform === "Tablet" ? Smartphone : Monitor;
  const flag = topFlag(d.flags);
  const place = placeLabel(d);
  const leaving = !!d.signout_requested_at;
  return (
    <div className={`flex flex-wrap items-center gap-2 py-[3px] text-[12px] text-slate-400 ${leaving ? "opacity-60" : ""}`}>
      <Icon size={12} className="shrink-0 text-slate-300" />
      <span className="font-semibold text-slate-600">{d.name}</span>
      <span>{deviceLabel(d.device_id)}</span>
      {/* The address is read server-side from the request; the place beside
          it is a guess from a free lookup, and says so. See deviceNet.js. */}
      {d.last_ip && <span className="font-mono text-[11px] text-slate-400">{d.last_ip}</span>}
      {place && <span className="text-[11px] text-slate-300" title={t("st_place_hint")}>{place}</span>}
      {/* [2026-09-17] Why this machine was last signed out — handed in by the
          browser on its next successful login (see signout_reason.sql). Amber
          only for "expired", the one cause that is not somebody's decision and
          therefore the only one that needs looking into. */}
      {d.last_signout_reason && (
        <span className={`rounded border px-1.5 text-[10.5px] font-medium ${
          needsAttention(d.last_signout_reason)
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-slate-200 bg-slate-50 text-slate-400"
        }`} title={t("st_signout_hint")}>
          {t(reasonKey(d.last_signout_reason))}
        </span>
      )}
      {flag && (
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 text-[10.5px] font-semibold text-amber-700">
          {t(FLAG_KEY[flag])}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2.5">
        {leaving ? (
          <span className="text-[11px] font-semibold text-rose-600">{t("st_signing_out")} · {t("st_within_a_minute")}</span>
        ) : d.signed_out_at ? (
          <span className="text-[11px] text-slate-400">{t("st_signed_out_at")} {hm(d.signed_out_at)}</span>
        ) : (
          <span className="text-[11px]">
            {d.reach === "ok" ? t("sh_just_now") : `${t("st_last_heard")} ${hm(d.last_seen_at)}`}
          </span>
        )}
        {canSignOut && !leaving && (
          <button
            type="button"
            onClick={() => onSignOut(d)}
            className={`shrink-0 rounded-md border px-2 py-px text-[11px] font-semibold ${
              flag ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                : "border-slate-200 text-slate-400 hover:bg-slate-50"}`}
          >
            {t("st_sign_out")}
          </button>
        )}
      </span>
    </div>
  );
}

// Nothing happens until this has been read and agreed to. A sign-out is not
// undoable and it can lose a half-typed ticket, so the person and the machine
// are named rather than left to be remembered from whichever row was clicked.
function ConfirmSignOut({ device, t, busy, onCancel, onConfirm }) {
  const place = placeLabel(device);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-[430px] overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h4 className="text-base font-semibold text-slate-800">{t("st_confirm_title")}</h4>
            <p className="mt-1 text-[13.5px] text-slate-500">{t("st_confirm_body")}</p>
          </div>
          <button type="button" onClick={onCancel} className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="mx-4 mb-3 rounded-lg bg-slate-50 px-3 py-2.5 text-[13px]">
          <b className="font-semibold text-slate-800">{device.name}</b>
          <div className="mt-0.5 text-[12px] text-slate-500">
            {deviceLabel(device.device_id)}
            {device.last_ip ? ` · ${device.last_ip}` : ""}
            {place ? ` · ${place}` : ""}
          </div>
        </div>
        <div className="mx-4 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-slate-600">
          {t("st_confirm_warn")}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button type="button" onClick={onCancel}
            className="rounded-lg border border-slate-200 px-3.5 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
            {t("st_cancel")}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            <LogOut size={13} />{t("st_sign_out")}
          </button>
        </div>
      </div>
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
  const [confirming, setConfirming] = useState(null);
  const [kicking, setKicking] = useState(false);
  // [2026-09-21] Each station's latest scale reading — a scale below zero
  // weighs every truck too light, so it belongs on this page.
  const [scales, setScales] = useState(new Map());

  const load = useCallback(async () => {
    try {
      // [2026-09-19] Only the last 30 days of transactions — enough for
      // "today" and "last trade". This used to download the whole
      // transactions table every 30 seconds for as long as the page was open
      // (audit F25).
      const since = new Date(getAccurateNow().getTime() - 30 * 24 * 60 * 60 * 1000);
      const sinceStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Phnom_Penh" }).format(since);
      // Kept out of the Promise.all below: a failed scale read must not hide
      // the rest of the page.
      api.getScaleReadings().then((rows) => setScales(new Map((rows || []).map((r) => [r.location_id, r])))).catch(() => {});
      const [ps, locs, ctrl, devs, transactions] = await Promise.all([
        api.getProfiles(), api.getLocations(), api.getAppControl(),
        api.getDeviceSessions(), api.getTransactions({ from: sinceStr }),
      ]);
      setProfiles(ps || []);
      setLocations(locs || []);
      setControl(ctrl);
      setSessions(devs || []);
      // Same "doesn't count" convention as everywhere else — a cancelled
      // transaction must not make a station look busier than it was.
      setTxs((transactions || []).filter((x) => x.hq_status !== "cancelled"));
      setError("");
      setHidden(false);
    } catch (err) {
      // [2026-09-19] Hidden only when this account may not read the panel, or
      // the database does not have it yet. A dropped connection used to hide
      // the whole panel until the page was reloaded — the one time HQ most
      // needs it (audit F19). Now the last answer stays up with a warning.
      const msg = String(err?.message || "");
      if (err?.code === "42501" || /permission denied|row-level security|does not exist|schema cache/i.test(msg)) setHidden(true);
      else setError(t("st_load_stale"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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

  async function signOut(device) {
    setKicking(true);
    setError("");
    try {
      await api.signOutDevice(device.device_id, device.user_id);
      setConfirming(null);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't sign that machine out.");
      setConfirming(null);
    } finally {
      setKicking(false);
    }
  }

  if (hidden) return null;

  const { stations, newest, current, deviceCount, silent, roaming } = board;
  const canSignOut = !!profile?.isOwner;
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
                    {plural(t, "st_attention", attention, { all: stations.length })}
                  </span>
                  {deviceCount > 0 && <> · <b className="font-semibold text-slate-700">{plural(t, "st_machines", deviceCount)}</b></>}
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
              <th className="border-y border-slate-100 px-4 py-2 text-left">{t("st_col_scale")}</th>
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
                      <span title={s.reach === "patchy" ? t("st_patchy_why") : ""}
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${meta.cls}`}>
                        <Icon size={11} />
                        {t(meta.key)}
                        {(s.reach === "gone" || s.reach === "quiet") && mins != null
                          ? ` · ${t("st_n_min").replace("{n}", String(mins))}` : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <ScaleCell reading={scales.get(s.id)} now={now} t={t} />
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
                          {plural(t, "st_n_tickets", trade.count)}
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
                      <td colSpan={6} className="px-4 pb-2 pl-[38px] pt-0">
                        {s.devices.map((dv) => (
                          <DeviceLine key={`${dv.device_id}:${dv.user_id}`} d={dv} t={t}
                            canSignOut={canSignOut} onSignOut={setConfirming} />
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

      {/* ── everyone who is not tied to a station: you, managers, registrars,
              viewers. Listed so "how many machines is this account on" has an
              answer for them too, never flagged — they move around by design. ── */}
      {roaming.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2.5">
          <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[.11em] text-slate-400">{t("st_others")}</p>
          {roaming.map((dv) => (
            <DeviceLine key={`${dv.device_id}:${dv.user_id}`} d={dv} t={t}
              canSignOut={canSignOut} onSignOut={setConfirming} />
          ))}
        </div>
      )}

      {confirming && (
        <ConfirmSignOut
          device={confirming} t={t} busy={kicking}
          onCancel={() => setConfirming(null)}
          onConfirm={() => signOut(confirming)}
        />
      )}

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
function ScaleCell({ reading, now, t }) {
  const st = scaleState(reading, now);
  if (st === "none") return <span className="text-slate-300">—</span>;
  const w = Number(reading.weight_kg);
  const kg = `${w < 0 ? "−" : ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.abs(w))} kg`;
  if (st === "below") {
    return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11.5px] font-semibold text-rose-700">{t("st_scale_below")} · {kg}</span>;
  }
  if (st === "quiet") return <span className="text-[12px] text-slate-400">{t("st_scale_quiet")}</span>;
  return <span className="text-[12.5px] tabular-nums text-slate-600">{kg}</span>;
}

function Fragmentish({ children, first }) {
  return (
    <>
      {!first && <tr className="h-px"><td colSpan={6} className="border-t border-slate-100 p-0" /></tr>}
      {children}
    </>
  );
}
