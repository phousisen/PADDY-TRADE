// scripts-check-devices.mjs — who is in the system, and can we reach them?
//
// [2026-09-16] SISEN asked three things in one message:
//
//   "i want to see how many devices are logged into each account"
//   "if the computer network is not working, does it auto load in the system
//    that shows those station network is not connected?"
//   "we just want to track who is actually in the system"
//
// and set the rule himself:
//
//   "its normal but we want to know if its actually the staff or the staff
//    give others access to the system. and mainly staff only uses pc at the
//    station. unless its us or the manager or the registrar or viewers."
//
// So: a station account is expected to be one PC at one station; an HQ
// account moves around and must never be flagged. Flagging normal behaviour
// is how a screen teaches people to ignore it, and a screen nobody reads is
// worse than no screen — which is exactly how three days of stale code went
// unnoticed at Reang Kesey.
//
// Every rule is run for real against fixtures. Thresholds are asserted by
// number, because "very fast" and "do not cry wolf" pull in opposite
// directions and the exact minute is the whole compromise.
//
// Run: node scripts-check-devices.mjs

import { readFileSync } from "node:fs";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};

const w = await import("./src/deviceWatch.js");
const d = await import("./src/deviceId.js");
const sql = readFileSync("device_sessions.sql", "utf8");
const api = readFileSync("src/api.js", "utf8");
const banner = readFileSync("src/components/UpdateBanner.jsx", "utf8");
const panel = readFileSync("src/components/StationVersions.jsx", "utf8");

const NOW = 1_700_000_000_000;
const agoMs = (m) => new Date(NOW - m * 60000).toISOString();

// ── 1. reachability ──────────────────────────────────────────────────────

console.log("\n1. How long silence has to last before it means something");

ok("a check-in a moment ago is fine", w.reachability(agoMs(0.5), NOW) === "ok");
ok("two minutes is still fine — one missed check-in is nothing",
   w.reachability(agoMs(2), NOW) === "ok");
ok("three minutes is quiet", w.reachability(agoMs(3), NOW) === "quiet");
ok("nine minutes is still only quiet", w.reachability(agoMs(9), NOW) === "quiet");
ok("ten minutes is not reachable", w.reachability(agoMs(10), NOW) === "gone");
ok("an hour is not reachable", w.reachability(agoMs(60), NOW) === "gone");
ok("never heard from at all is not reachable", w.reachability(null, NOW) === "gone");
ok("a nonsense timestamp is not reachable, not a crash",
   w.reachability("not a date", NOW) === "gone");

// The numbers themselves. SISEN: "its best to know in details and very fast"
// — but a screen that goes red on every reboot gets ignored within a week.
ok("quiet after 3 minutes", w.QUIET_AFTER_MS === 3 * 60 * 1000);
ok("not reachable after 10 minutes", w.UNREACHABLE_AFTER_MS === 10 * 60 * 1000);
ok("the check-in is once a minute, so 3 minutes is 3 missed ones",
   banner.includes("const REPORT_MS = 60 * 1000;"));

ok("a station is as reachable as its best machine",
   w.bestOf(["gone", "ok"]) === "ok" && w.bestOf(["gone", "quiet"]) === "quiet"
   && w.bestOf(["gone", "gone"]) === "gone");

// ── 2. who may be flagged at all ─────────────────────────────────────────

console.log("\n2. Station accounts are held to one PC; HQ accounts are not");

const stationStaff = { id: "u1", full_name: "Sophal", location_id: "L1", roleObj: { scope: "own_location" } };
const manager      = { id: "u2", full_name: "Manager", location_id: "L1", roleObj: { scope: "all" } };
const owner        = { id: "u3", full_name: "SISEN", location_id: null, isOwner: true, roleObj: { scope: "all" } };
const registrar    = { id: "u4", full_name: "Registrar", location_id: null, roleObj: { scope: "all" } };
const legacyAdmin  = { id: "u5", full_name: "Old Admin", location_id: "L1", role: "admin" };

ok("a station account is a station account", w.isStationAccount(stationStaff));
ok("a manager is not", !w.isStationAccount(manager));
ok("the owner is not", !w.isStationAccount(owner));
ok("a registrar is not", !w.isStationAccount(registrar));
ok("an account from before roles existed, with role 'admin', is not",
   !w.isStationAccount(legacyAdmin));
ok("an account with no station is not", !w.isStationAccount({ roleObj: { scope: "own_location" } }));

const pcNow = { device_id: "aaaa1111", user_id: "u1", location_id: "L1",
  app_version: "2026.09.16-1734", platform: "PC", browser: "Chrome",
  first_seen_at: agoMs(60 * 24 * 7), last_seen_at: agoMs(0.5) };

ok("a station PC on the newest build, seen for a week, has nothing to say",
   w.deviceFlags(pcNow, { profile: stationStaff, newestVersion: "2026.09.16-1734", now: NOW }).length === 0);

// ── 3. the flags themselves ──────────────────────────────────────────────

console.log("\n3. What gets pointed at");

const flags = (dev, profile, newest = "2026.09.16-1734") =>
  w.deviceFlags({ ...pcNow, ...dev }, { profile, newestVersion: newest, now: NOW });

ok("old code is flagged", flags({ app_version: "2026.09.13-0904" }, stationStaff).includes("behind"));
ok("a phone at a station is flagged", flags({ platform: "Phone" }, stationStaff).includes("not_a_pc"));
ok("a tablet at a station is flagged", flags({ platform: "Tablet" }, stationStaff).includes("not_a_pc"));
ok("a machine first seen an hour ago is flagged as new",
   flags({ first_seen_at: agoMs(60) }, stationStaff).includes("new_device"));
ok("a machine first seen two days ago is not new any more",
   !flags({ first_seen_at: agoMs(60 * 48) }, stationStaff).includes("new_device"));
ok("silence is flagged", flags({ last_seen_at: agoMs(30) }, stationStaff).includes("gone"));

// THE RULE SISEN SET. The manager's phone is the manager doing their job.
ok("a manager on a phone is NOT flagged",
   flags({ platform: "Phone" }, manager).length === 0);
ok("the owner on a brand-new machine is NOT flagged",
   flags({ platform: "Phone", first_seen_at: agoMs(1) }, owner).length === 0);
ok("a manager on old code IS still flagged — that is about code, not people",
   flags({ app_version: "2026.09.13-0904" }, manager).includes("behind"));
ok("nothing is flagged as behind when no newest version is known yet",
   flags({ app_version: "2026.09.13-0904" }, stationStaff, "").length === 0);

// ── 4. one login, two machines ───────────────────────────────────────────

console.log("\n4. One login on two machines");

const profiles = [stationStaff, manager, owner];
const locations = [{ id: "L1", name: "REANG KESEY" }, { id: "L2", name: "PING PONG" }];

const twice = w.buildBoard({
  sessions: [
    { ...pcNow, device_id: "aaaa1111" },
    { ...pcNow, device_id: "bbbb2222", platform: "Phone", last_seen_at: agoMs(2) },
  ],
  profiles, locations, runningVersion: "2026.09.16-1734", now: NOW,
});
const rk = twice.stations.find((s) => s.name === "REANG KESEY");
ok("both machines are listed", rk.devices.length === 2);
ok("both are flagged as one login on two machines",
   rk.devices.every((x) => x.flags.includes("shared_login")));
ok("the phone is also flagged as not the station PC",
   rk.devices.some((x) => x.flags.includes("not_a_pc")));
ok("one machine alone is never flagged as shared",
   !w.buildBoard({ sessions: [pcNow], profiles, locations, runningVersion: "2026.09.16-1734", now: NOW })
     .stations.find((s) => s.name === "REANG KESEY")
     .devices[0].flags.includes("shared_login"));

// An HQ account on three machines is normal and must stay silent.
const roam = w.buildBoard({
  sessions: [
    { ...pcNow, user_id: "u2", device_id: "c1", location_id: null },
    { ...pcNow, user_id: "u2", device_id: "c2", location_id: null, platform: "Phone" },
    { ...pcNow, user_id: "u2", device_id: "c3", location_id: null, platform: "Tablet" },
  ],
  profiles, locations, runningVersion: "2026.09.16-1734", now: NOW,
});
ok("a manager on three machines is listed, not flagged",
   roam.roaming.length === 3 && roam.roaming.every((r) => r.flags.length === 0));
ok("a manager's machines are not counted against a station",
   roam.stations.every((s) => s.devices.length === 0));

// ── 5. the board as a whole ──────────────────────────────────────────────

console.log("\n5. The board");

const board = w.buildBoard({
  sessions: [
    { ...pcNow, device_id: "d1", user_id: "u1", location_id: "L1", last_seen_at: agoMs(30) }, // gone
    { ...pcNow, device_id: "d2", user_id: "u1", location_id: "L2", app_version: "2026.09.13-0904" },
  ],
  profiles: [stationStaff], locations, runningVersion: "2026.09.16-1734", now: NOW,
});
ok("the newest build is the highest anyone has seen",
   board.newest === "2026.09.16-1734", board.newest);
ok("an unreachable station sorts above a merely outdated one",
   board.stations[0].name === "REANG KESEY", board.stations.map((s) => s.name).join(" → "));
ok("a station with nobody signed in still appears",
   w.buildBoard({ sessions: [], profiles, locations, now: NOW }).stations.length === 2);
ok("a station with nobody signed in is not called out of date",
   w.buildBoard({ sessions: [], profiles, locations, now: NOW }).stations.every((s) => !s.upToDate));
ok("nothing reported at all is marked silent, so the push button can go grey",
   w.buildBoard({ sessions: [], profiles, locations, now: NOW }).silent === true);
ok("the push button is disabled while nothing has reported",
   panel.includes("disabled={pushing || silent}"));

// Yesterday's rows must not describe today.
ok("a machine last seen two days ago is left out entirely",
   w.buildBoard({
     sessions: [{ ...pcNow, last_seen_at: agoMs(60 * 48) }],
     profiles, locations, now: NOW,
   }).deviceCount === 0);

// ── 6. the device id and its label ───────────────────────────────────────

console.log("\n6. Naming a machine");

const mem = (() => { const m = new Map(); return {
  getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; })();
const first = d.getDeviceId(mem);
ok("an id is made on first use", /^[0-9a-f]{8,64}$/i.test(first), first);
ok("the same id comes back next time", d.getDeviceId(mem) === first);
ok("a different browser gets a different id", d.getDeviceId({ getItem: () => null, setItem: () => {} }) !== first);

// A private window, a full disk, a locked-down station PC.
const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
ok("storage that throws does not break the app",
   /^[0-9a-f]{8,64}$/i.test(d.getDeviceId(broken)));
ok("no storage at all does not break the app",
   /^[0-9a-f]{8,64}$/i.test(d.getDeviceId(null)));
ok("rubbish in storage is replaced, not trusted",
   d.getDeviceId({ getItem: () => "<script>", setItem: () => {} }).length >= 8);

const UA = {
  "Windows Chrome": ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", "PC", "Chrome"],
  "Windows Edge":   ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0", "PC", "Edge"],
  "Mac Safari":     ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "PC", "Safari"],
  "Android phone":  ["Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36", "Phone", "Chrome"],
  "iPhone":         ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Phone", "Safari"],
  "iPad":           ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1", "Tablet", "Safari"],
  "Android tablet": ["Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", "Tablet", "Chrome"],
  "Firefox":        ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0", "PC", "Firefox"],
};
for (const [label, [ua, platform, browser]] of Object.entries(UA)) {
  const got = d.describeDevice(ua);
  ok(`${label} reads as ${platform} · ${browser}`,
     got.platform === platform && got.browser === browser, `${got.platform} · ${got.browser}`);
}
ok("an unknown browser is not guessed at",
   d.describeDevice("something else entirely").browser === "Browser");
ok("the label shows the last four characters", d.deviceLabel("abcdef0123456789", UA["Windows Chrome"][0]).endsWith("#6789"));

// ── 7. the migration only adds ───────────────────────────────────────────

console.log("\n7. The migration");

ok("the table is keyed by machine AND account",
   /primary key \(device_id, user_id\)/.test(sql));
ok("first seen is never overwritten — that is what makes a machine 'new'",
   /on conflict[\s\S]{0,400}last_seen_at = now\(\)/.test(sql)
   && !/on conflict[\s\S]{0,400}first_seen_at = /.test(sql));
ok("the station comes from the profile, not from the browser",
   /select location_id into v_loc from public\.profiles where id = auth\.uid\(\)/.test(sql));
ok("a browser can only write its own row",
   /if auth\.uid\(\) is null or v_dev is null then\s*\n\s*return;/.test(sql));
ok("row level security is on", sql.includes("alter table public.device_sessions enable row level security"));
ok("nobody can write the table directly",
   !/create policy[^;]*device_sessions[^;]*for (update|insert|all)/i.test(sql));
ok("machines nobody has used for a month are forgotten",
   sql.includes("last_seen_at < now() - interval '30 days'"));
for (const forbidden of ["touch_last_seen", "report_app_version", "request_station_reload", "drop table", "drop column", "alter table public.profiles"]) {
  ok(`the migration does not touch ${forbidden}`,
     !new RegExp(`(create or replace function[^;]*|drop [^;]*|${forbidden.startsWith("alter") ? forbidden : "\\u0000"})${forbidden.replace(/ /g, "\\s+")}`, "i").test(sql));
}

// ── 8. wired in, and safe before the migration is run ────────────────────

console.log("\n8. Wired in, and harmless on a database that has not been migrated");

ok("the api can report a machine", api.includes("async reportDevice({ deviceId, version, platform, browser })"));
ok("reporting never throws", /async reportDevice[\s\S]{0,600}catch \{\s*\n\s*return false;/.test(api));
ok("a view-only account still reports its machine",
   /ALWAYS_ALLOWED[\s\S]{0,900}"reportDevice"/.test(api));
ok("an un-migrated database reads as 'nothing to show', not an error",
   /async getDeviceSessions\(\)[\s\S]{0,700}if \(error\) return null;/.test(api));
ok("only the last day is fetched", /async getDeviceSessions\(\)[\s\S]{0,400}gte\("last_seen_at"/.test(api));
ok("the heartbeat falls back to the old account-only report",
   banner.includes("if (!ok) api.reportAppVersion(APP_VERSION);"));
ok("the panel recomputes on a timer, so quiet becomes unreachable by itself",
   panel.includes("setTick((n) => n + 1)"));

console.log(failed
  ? `\n${failed} FAILED`
  : "\nWho is in the system, on what, and whether we can reach them — all checked.");
process.exit(failed ? 1 : 0);
