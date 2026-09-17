// Is a station reachable, is it on the right code, and is anything odd about
// who is signed in where?
//
// [2026-09-16] SISEN, on what he wants to see:
//
//   "its best to know in details and very fast"
//   "its normal but we want to know if its actually the staff or the staff
//    give others access to the system. and mainly staff only uses pc at the
//    station. unless its us or the manager or the registrar or viewers. but
//    we just want to track who is actually in the system."
//
// So two different expectations, and the difference is the whole design:
//
//   A STATION ACCOUNT is expected to be one PC, at its own station, all day.
//   A second machine, a phone, or a computer never seen before is worth
//   pointing at — that is what "gave someone else the login" looks like from
//   here.
//
//   AN HQ ACCOUNT — the owner, a manager, a registrar, a viewer — moves
//   around by design. Those are listed and never flagged, because flagging
//   normal behaviour is how a screen teaches people to ignore it.
//
// The test is the role's SCOPE, which the app already keeps: "own_location"
// means tied to one station, "all" means free to roam. Nothing new to
// maintain, and a role changed on the Roles page changes this too.
//
// ── On speed, and on crying wolf ────────────────────────────────────────
//
// Every device checks in once a minute. Three minutes of silence shows amber
// — fast, as asked, and usually nothing: a reboot, a lift in the road, a
// laptop lid. Ten minutes shows red, because by then it is not a blip.
//
// The exact time of the last check-in is always on screen either way, so
// "details and very fast" does not depend on the colour at all.
//
// ── What this can never tell you ────────────────────────────────────────
//
// A station with no internet cannot report that it has no internet. All that
// ever arrives at HQ is silence, and a switched-off PC is indistinguishable
// from a dead line. Both mean "you cannot reach it", which is the useful
// part; this module therefore says "not reachable" and never guesses why.
//
// Nothing here touches React or the network, so all of it is run for real by
// scripts-check-devices.mjs.

export const QUIET_AFTER_MS = 3 * 60 * 1000;
export const UNREACHABLE_AFTER_MS = 10 * 60 * 1000;

// A machine first seen inside this window is still "new" — the strongest
// single sign that a login has been handed to somebody else.
export const NEW_DEVICE_MS = 24 * 60 * 60 * 1000;

// Below this, a device is too old to say anything about today.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const ms = (v) => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Is this machine's line actually healthy, or just audible?
 *
 * [2026-09-16] "Connected" used to mean only "checked in recently". Pong Ro
 * was showing "Couldn't reach the server just now" on its own screen at the
 * same moment HQ showed it green. Both were true about different instants;
 * HQ's was the one that misled.
 *
 * A machine now reports what IT knows — how many check-ins it missed before
 * this one got through, and what its offline queue is holding. Any of that is
 * enough to say "patchy" rather than a flat green.
 */
export function hasTrouble(device) {
  if (!device) return false;
  return (device.missed_checkins || 0) > 0
    || (device.pending_ops || 0) > 0
    || !!device.stuck;
}

/** 'ok' | 'quiet' | 'gone' — how long since this device last said anything. */
export function reachability(lastSeen, now = Date.now()) {
  const t = ms(lastSeen);
  if (t === null) return "gone";
  const age = now - t;
  if (age >= UNREACHABLE_AFTER_MS) return "gone";
  if (age >= QUIET_AFTER_MS) return "quiet";
  return "ok";
}

/** The worst of a set — a station is only as reachable as its best machine. */
export function bestOf(states) {
  if (states.includes("ok")) return "ok";
  if (states.includes("quiet")) return "quiet";
  return "gone";
}

/** Is this account tied to one station, or free to move around? */
export function isStationAccount(profile) {
  if (!profile) return false;
  if (profile.isOwner) return false;
  const scope = profile.roleObj?.scope || (profile.role === "admin" ? "all" : "own_location");
  return scope === "own_location" && !!profile.location_id;
}

/**
 * What is worth pointing at about one device.
 *
 * Returns a list of flag keys, worst first. An empty list means nothing to
 * say, which is what most rows are on most days.
 */
export function deviceFlags(device, { profile, newestVersion, now = Date.now() } = {}) {
  const flags = [];
  const reach = reachability(device?.last_seen_at, now);
  if (reach === "gone") flags.push("gone");
  else if (reach === "quiet") flags.push("quiet");

  if (newestVersion && device?.app_version && device.app_version !== newestVersion) {
    flags.push("behind");
  }

  // The rest only apply to an account that belongs to one station.
  if (isStationAccount(profile)) {
    if (device?.platform && device.platform !== "PC") flags.push("not_a_pc");
    // [2026-09-16] "new machine" is NOT every machine's first day.
    //
    // On the rollout it fired on all of them, so the two stations that had
    // done exactly what was asked were the only two marked as needing
    // attention. Wrong signal entirely.
    //
    // A first machine is just a machine. What is worth pointing at is a
    // SECOND one appearing later for an account that already had one — which
    // is what being handed a login looks like. That needs to know about the
    // account's other devices, so it is decided in buildBoard, not here.
    // [2026-09-16] A station PC sits on one connection all day. An address it
    // has never used before is the honest version of "where is this" — far
    // more use than a city, which in Cambodia usually names the internet
    // provider rather than the building. See src/deviceNet.js.
    if (device?.first_ip && device?.last_ip && device.first_ip !== device.last_ip) {
      flags.push("new_network");
    }
  }
  return flags;
}

const SEVERITY = { gone: 4, behind: 3, not_a_pc: 3, new_network: 3, new_device: 2, quiet: 1 };
const worst = (flags) => flags.reduce((n, f) => Math.max(n, SEVERITY[f] || 0), 0);

/**
 * Everything the Station Health panel draws, computed in one place.
 *
 * @param sessions  rows from device_sessions, each carrying user_id, location_id,
 *                  device_id, app_version, platform, browser, first/last_seen_at
 * @param profiles  from api.getProfiles() — id, full_name, location_id, roleObj, isOwner
 * @param locations every station, so one with nobody signed in still appears
 * @param runningVersion  the version THIS browser is on, so a first rollout has
 *                  something to compare against before anyone else reports
 */
export function buildBoard({
  sessions = [],
  profiles = [],
  locations = [],
  runningVersion = null,
  now = Date.now(),
} = {}) {
  const byId = new Map(profiles.map((p) => [p.id, p]));

  // Only what is recent enough to describe today.
  const live = sessions.filter((s) => {
    const t = ms(s?.last_seen_at);
    if (t === null || now - t >= STALE_AFTER_MS) return false;
    // Signed out and gone quiet since. Keeping it would leave a dead tab
    // sitting on the screen all day under "signed in", which it is not.
    if (s?.signed_out_at && reachability(s.last_seen_at, now) === "gone") return false;
    return true;
  });

  // The newest build anyone has seen, this browser included. No release list
  // to keep in step — the newest thing seen IS the newest thing.
  let newest = runningVersion && runningVersion !== "dev" ? runningVersion : "";
  for (const s of live) if (s.app_version && s.app_version > newest) newest = s.app_version;

  const devicesOf = new Map();          // location id -> rows
  const perAccount = new Map();         // user id -> device count
  const roaming = [];                   // HQ accounts, never flagged

  for (const s of live) {
    const profile = byId.get(s.user_id) || null;
    perAccount.set(s.user_id, (perAccount.get(s.user_id) || 0) + 1);
    const row = {
      ...s,
      // An account with no full name shows the part before the @ rather than
      // the whole address — "boss@paddytrade.local" read back at SISEN as a
      // stranger who was signed in.
      name: profile?.full_name || String(profile?.email || "").split("@")[0] || "—",
      profile,
      reach: reachability(s.last_seen_at, now),
      flags: deviceFlags(s, { profile, newestVersion: newest, now }),
    };
    if (isStationAccount(profile)) {
      const key = s.location_id || profile?.location_id || null;
      if (!devicesOf.has(key)) devicesOf.set(key, []);
      devicesOf.get(key).push(row);
    } else {
      roaming.push(row);
    }
  }

  // A station account on more than one machine at once is the thing SISEN
  // actually asked about. It can only be known once every device is counted,
  // so it is added here rather than in deviceFlags.
  for (const rows of devicesOf.values()) {
    for (const r of rows) {
      const count = perAccount.get(r.user_id) || 0;
      if (count > 1 && !r.flags.includes("shared_login")) r.flags.push("shared_login");
      // A machine that turned up in the last day, for an account that was
      // already using another one. One machine appearing on its own is a
      // station being set up; a second one appearing beside it is not.
      const first = ms(r.first_seen_at);
      if (count > 1 && first !== null && now - first < NEW_DEVICE_MS && !r.flags.includes("new_device")) {
        r.flags.push("new_device");
      }
    }
  }

  const stations = locations.map((loc) => {
    const devices = (devicesOf.get(loc.id) || [])
      .sort((a, b) => worst(b.flags) - worst(a.flags) || ms(b.last_seen_at) - ms(a.last_seen_at));
    const reach = devices.length ? bestOf(devices.map((d) => d.reach)) : "none";
    // Heard from, but having a bad time of it. Not green, not red.
    const patchy = reach === "ok" && devices.some(hasTrouble);
    const behind = devices.filter((d) => d.app_version && newest && d.app_version !== newest);
    const flags = [...new Set(devices.flatMap((d) => d.flags))];
    return {
      id: loc.id,
      name: loc.name,
      devices,
      reach: patchy ? "patchy" : reach,
      behind: behind.length,
      upToDate: devices.length > 0 && behind.length === 0 && reach !== "gone",
      flags,
      rank: reach === "none" ? 3
        : reach === "gone" ? 5
          : behind.length ? 4
            : patchy ? 2.5
              : flags.length ? 2
                : 1,
    };
  }).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));

  return {
    newest,
    stations,
    roaming: roaming.sort((a, b) => ms(b.last_seen_at) - ms(a.last_seen_at)),
    reachable: stations.filter((s) => ["ok", "patchy", "quiet"].includes(s.reach)).length,
    current: stations.filter((s) => s.upToDate).length,
    deviceCount: live.length,
    // Nothing has reported yet — a fresh install, or the migration has not
    // been run. The push button is pointless in that state and says so.
    silent: live.length === 0,
  };
}

/**
 * Which STATIONS have a save that is stuck, seen from HQ.
 *
 * [2026-09-17] SISEN: *"how can this happen again and again. the red issue
 * and the stuck or lost ticket"*.
 *
 * The ticket was never lost. On 12 September a payment at Ping Pong started
 * failing, the app held it on that PC, kept retrying, and raised a red banner
 * reading "tell an admin now".
 *
 * Then it sat there for FIVE DAYS.
 *
 * Not because anything was broken — because the alarm was on the station's own
 * screen and nowhere else. SISEN found it by walking up to the machine. An
 * alarm only the person standing next to it can see is not an alarm, it is a
 * note; and the one person who could have fixed it was the one person not
 * looking at that screen.
 *
 * Every machine already reports what its queue is holding on every check-in —
 * `pending_ops` and `stuck` arrive at HQ once a minute and nothing was done
 * with them. This turns those columns into something that finds the owner
 * instead of waiting to be found.
 *
 * Deliberately NOT "how long it has been stuck": nothing records when a queue
 * first went bad, and adding that means changing `report_device`, which every
 * station calls every minute. Putting a hot-path rewrite in the way of an
 * alarm is how the 15:03 outage happened. The alarm ships first; the age can
 * follow on its own migration.
 *
 * `devices` is what api.getDeviceSessions() returns; `locations` is the list
 * of stations, for the name. One row per STATION, not per machine — HQ does
 * not care which PC, only which shed to ring.
 */
export function stuckStations(devices, locations = []) {
  const nameOf = new Map((locations || []).map((l) => [l.id, l.name]));
  const byStation = new Map();

  for (const d of devices || []) {
    // `stuck` means the server has rejected the same save over and over; that
    // never clears itself. A queue merely waiting for a connection is not
    // this, and must not cry wolf beside it.
    if (!d || !d.stuck) continue;
    const key = d.location_id || "unassigned";
    const at = byStation.get(key) || {
      locationId: d.location_id || null,
      station: nameOf.get(d.location_id) || "—",
      pending: 0,
      devices: 0,
    };
    at.pending += Number(d.pending_ops) || 0;
    at.devices += 1;
    byStation.set(key, at);
  }

  // Worst first: the station holding the most unsaved work is the one to ring.
  return [...byStation.values()].sort((a, b) => b.pending - a.pending);
}

/** One line for the bell. Kept out of the component so a test can read it. */
export function stuckSummary(rows) {
  if (!rows || rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + (r.pending || 0), 0);
  return { stations: rows.length, pending: total, worst: rows[0] };
}
