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
    const first = ms(device?.first_seen_at);
    if (first !== null && now - first < NEW_DEVICE_MS) flags.push("new_device");
  }
  return flags;
}

const SEVERITY = { gone: 4, behind: 3, not_a_pc: 3, new_device: 2, quiet: 1 };
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
    return t !== null && now - t < STALE_AFTER_MS;
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
      name: profile?.full_name || "—",
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
      if ((perAccount.get(r.user_id) || 0) > 1 && !r.flags.includes("shared_login")) {
        r.flags.push("shared_login");
      }
    }
  }

  const stations = locations.map((loc) => {
    const devices = (devicesOf.get(loc.id) || [])
      .sort((a, b) => worst(b.flags) - worst(a.flags) || ms(b.last_seen_at) - ms(a.last_seen_at));
    const reach = devices.length ? bestOf(devices.map((d) => d.reach)) : "none";
    const behind = devices.filter((d) => d.app_version && newest && d.app_version !== newest);
    const flags = [...new Set(devices.flatMap((d) => d.flags))];
    return {
      id: loc.id,
      name: loc.name,
      devices,
      reach,
      behind: behind.length,
      upToDate: devices.length > 0 && behind.length === 0 && reach !== "gone",
      flags,
      rank: reach === "none" ? 3
        : reach === "gone" ? 5
          : behind.length ? 4
            : flags.length ? 2
              : 1,
    };
  }).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));

  return {
    newest,
    stations,
    roaming: roaming.sort((a, b) => ms(b.last_seen_at) - ms(a.last_seen_at)),
    reachable: stations.filter((s) => s.reach === "ok" || s.reach === "quiet").length,
    current: stations.filter((s) => s.upToDate).length,
    deviceCount: live.length,
    // Nothing has reported yet — a fresh install, or the migration has not
    // been run. The push button is pointless in that state and says so.
    silent: live.length === 0,
  };
}
