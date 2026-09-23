// [2026-09-21] Which stations' scales are below zero right now, from the
// readings each station sends up. Pure — used by the HQ Dashboard banner and
// the Station Health table, and tested by scripts-check-scale-guard.
import { BELOW_KG } from "./scaleGuard.js";

// A reading older than this is not "now" — the station may be switched off.
export const SCALE_FRESH_MS = 2 * 60 * 1000;

export function scaleState(reading, nowMs) {
  if (!reading || reading.updated_at == null) return "none";
  const age = nowMs - new Date(reading.updated_at).getTime();
  if (!(age < SCALE_FRESH_MS)) return "quiet";
  return Number(reading.weight_kg) < BELOW_KG ? "below" : "ok";
}

export function stationsBelowZero(readings, locations, nowMs) {
  const byId = new Map((locations || []).map((l) => [l.id, l]));
  return (readings || [])
    .filter((r) => scaleState(r, nowMs) === "below" && byId.has(r.location_id))
    .map((r) => ({ id: r.location_id, name: byId.get(r.location_id).name, weightKg: Number(r.weight_kg) }));
}

// [2026-09-23] A STATION WHOSE SCALE HAS GONE QUIET.
//
// SISEN, on the Ping Pong outage: "there has to be an issue, beacsue earlier
// it was connected." He found out because staff were stuck half way through a
// ticket with a truck on the platform. HQ had every reading it needed hours
// earlier and nothing looked at them — the same failure as 17 September,
// where five stations reported `stuck` every minute and nothing raised it.
//
// SISEN again, before this shipped: "make sure this wont affest other
// location." That is the whole design problem. There are five stations and
// this box is on the HQ Dashboard, so a rule that is even slightly loose
// lights up four innocent stations every evening — and an alarm that fires on
// normal conditions is exactly how the real one gets ignored. So it has to be
// silent unless a station is WORKING and its scale has died under it.
//
// Three conditions, all required:
//
//   1. THE STATION'S PC IS ONLINE RIGHT NOW. Every station's machine checks
//      in about once a minute (device_sessions.last_seen_at — see
//      deviceWatch.js). A station closed for the day has its PC off, so it
//      cannot raise this at all. This one condition does most of the work and
//      it needs no clock, no timezone and no guess about opening hours.
//   2. The scale has been quiet between QUIET_AFTER_MS and GONE_HOME_MS. Under
//      fifteen minutes is a reboot or a slow minute. Over six hours is a
//      machine somebody left switched on overnight with the indicator off.
//   3. It is daytime in Cambodia. A backstop for exactly that left-on-all-
//      night case, so nobody opening the Dashboard at 9pm sees four amber
//      boxes about stations that closed hours ago.
//
// And a station that has NEVER sent a reading is never raised: that is a
// station without the agent installed, not a station that broke.
export const QUIET_AFTER_MS = 15 * 60 * 1000;
export const GONE_HOME_MS = 6 * 60 * 60 * 1000;
// A station PC checks in every minute; five missed check-ins means it is off,
// asleep, or off the internet — in every one of those cases nobody is weighing
// a truck there and there is nothing for HQ to act on.
export const PC_ONLINE_MS = 5 * 60 * 1000;
export const DAY_STARTS_HOUR = 6;
export const DAY_ENDS_HOUR = 19;

/** The hour of the day in Cambodia, whatever the viewing device is set to. */
export function cambodiaHour(nowMs) {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh", hour: "2-digit", hour12: false,
  }).format(new Date(nowMs));
  return Number(h);
}

export function isWorkingHours(nowMs) {
  const h = cambodiaHour(nowMs);
  return h >= DAY_STARTS_HOUR && h < DAY_ENDS_HOUR;
}

/** Which stations have a machine that checked in within PC_ONLINE_MS. */
export function stationsOnline(devices, nowMs) {
  const on = new Set();
  for (const d of devices || []) {
    if (!d || !d.location_id || !d.last_seen_at) continue;
    if (nowMs - new Date(d.last_seen_at).getTime() < PC_ONLINE_MS) on.add(d.location_id);
  }
  return on;
}

/**
 * @param readings  scale_readings rows (one per station)
 * @param locations the stations
 * @param nowMs     server-corrected now
 * @param devices   device_sessions rows. Omitted or empty => nothing is
 *                  raised at all, because without them this cannot tell a
 *                  broken station from a closed one, and guessing wrong is
 *                  worse than saying nothing.
 */
export function stationsWithQuietScale(readings, locations, nowMs, devices = null) {
  if (!isWorkingHours(nowMs)) return [];
  const online = stationsOnline(devices, nowMs);
  if (online.size === 0) return [];
  const byId = new Map((locations || []).map((l) => [l.id, l]));
  return (readings || [])
    .filter((r) => {
      if (!byId.has(r.location_id) || r.updated_at == null) return false;
      if (!online.has(r.location_id)) return false;
      const age = nowMs - new Date(r.updated_at).getTime();
      return age >= QUIET_AFTER_MS && age < GONE_HOME_MS;
    })
    .map((r) => ({
      id: r.location_id,
      name: byId.get(r.location_id).name,
      minutes: Math.round((nowMs - new Date(r.updated_at).getTime()) / 60000),
    }))
    .sort((a, b) => b.minutes - a.minutes);
}
