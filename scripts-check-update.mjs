// scripts-check-update.mjs — the guard on "is this station running old code?"
//
// [2026-09-16] WHAT THIS IS FOR
//
// Reang Kesey ran pre-merge code for three days and re-created a merged-away
// paddy type three times. Nothing was wrong with the merge or the station:
// a service worker only looks for new code when the page LOADS, and that
// machine's app had been open all week.
//
// SISEN: "each location doesnt know or there system wont auto update until
// they refresh their app or close and open again. how to fix this. i need a
// professional version of the system. like top level."
//
// The mechanism has four moving parts and every one of them fails silently:
//
//   1. the build stamps a version into the bundle AND into version.json
//   2. the running app compares the two
//   3. it reloads, but only when nobody is mid-ticket
//   4. every browser reports its version so HQ can see and push
//
// A break in any of them looks exactly like "everything is fine" from the
// outside — which is the whole reason the original problem went unnoticed
// for three days. So each is asserted separately, and the decisions (is it
// outdated? is somebody busy? should it reload yet?) are run for real.
//
// Run: node scripts-check-update.mjs

import { readFileSync } from "node:fs";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};

const vite = readFileSync("vite.config.js", "utf8");
const main = readFileSync("src/main.jsx", "utf8");
const app = readFileSync("src/App.jsx", "utf8");
const banner = readFileSync("src/components/UpdateBanner.jsx", "utf8");
const versions = readFileSync("src/components/StationVersions.jsx", "utf8");
const api = readFileSync("src/api.js", "utf8");
const sql = readFileSync("app_version_control.sql", "utf8");

const upd = await import("./src/appUpdate.js");

// ── 1. the build stamps itself, in both places ───────────────────────────

console.log("\n1. The build stamps a version into the bundle and beside it");

ok("vite defines __APP_VERSION__", /__APP_VERSION__:\s*JSON\.stringify\(APP_VERSION\)/.test(vite));
ok("vite emits version.json", vite.includes('fileName: "version.json"') && vite.includes("emitFile"));
ok("the version file plugin is actually in the plugin list", /plugins:\s*\[\s*versionFile\(\)/.test(vite));
ok("the stamp is built in Cambodia time, like every other date",
   /buildVersion[\s\S]{0,400}Asia\/Phnom_Penh/.test(vite));

// version.json must NOT be precached, or the app would ask the service
// worker what version the service worker already decided to keep — which is
// exactly the loop this whole mechanism exists to break.
const glob = vite.match(/globPatterns:\s*\[([^\]]*)\]/)?.[1] || "";
ok("version.json is not precached by the service worker",
   !/json/.test(glob), `globPatterns: ${glob.trim()}`);

// The proven reload path must stay exactly as it was.
// A person must be able to open /version.json and read it. Without this the
// navigation fallback hands them the app shell instead, which looks exactly
// like a build that never happened.
ok("version.json is reachable by typing the address",
   /navigateFallbackDenylist:\s*\[\/\^\\\/version\\\.json/.test(vite));
ok('registerType is still "autoUpdate"', vite.includes('registerType: "autoUpdate"'));
ok("skipWaiting is still on", /skipWaiting:\s*true/.test(vite));
ok("clientsClaim is still on", /clientsClaim:\s*true/.test(vite));

const version = readFileSync("src/version.js", "utf8");
ok("APP_VERSION falls back to \"dev\" outside a build", version.includes('"dev"'));
ok("src/version.js reads the define, not a hardcoded string",
   version.includes("__APP_VERSION__"));

// ── 2. the comparison ────────────────────────────────────────────────────

console.log("\n2. Deciding whether this browser is behind");

ok("a different version is outdated", upd.isOutdated("2026.09.15-0900", "2026.09.16-1742"));
ok("the same version is not", !upd.isOutdated("2026.09.16-1742", "2026.09.16-1742"));
// The three cannot-tell cases. Every one of them must be silent: a station
// must never be nagged, or reloaded, because a fetch failed.
ok("no answer from the server is not an update", !upd.isOutdated("2026.09.16-1742", null));
ok("an empty answer is not an update", !upd.isOutdated("2026.09.16-1742", ""));
ok("a dev build is never told it is behind", !upd.isOutdated("dev", "2026.09.16-1742"));
ok("a dev server never pushes an update", !upd.isOutdated("2026.09.16-1742", "dev"));

// fetchServerVersion must swallow everything a bad line can do.
const quiet = [
  ["a network error", async () => { throw new Error("offline"); }],
  ["a 404", async () => ({ ok: false, status: 404, json: async () => ({}) })],
  ["HTML instead of JSON", async () => ({ ok: true, json: async () => { throw new Error("not json"); } })],
  ["JSON with no version", async () => ({ ok: true, json: async () => ({ hello: 1 }) })],
];
for (const [what, f] of quiet) {
  ok(`${what} reads as "cannot tell", not a crash`, (await upd.fetchServerVersion(f)) === null);
}
ok("a good answer is read",
   (await upd.fetchServerVersion(async () => ({ ok: true, json: async () => ({ version: "2026.09.16-1742" }) })))
   === "2026.09.16-1742");

// The cache is the enemy here — the whole point is to get past it.
const seen = [];
await upd.fetchServerVersion(async (url, opts) => { seen.push([url, opts]); return { ok: true, json: async () => ({ version: "x" }) }; });
ok("the version fetch bypasses the cache", seen[0]?.[1]?.cache === "no-store");
ok("the version fetch is unique per call", /\?t=\d+/.test(seen[0]?.[0] || ""));

// ── 3. the reload waits for the station, but not forever ─────────────────

console.log("\n3. The reload never lands mid-ticket");

const fakeDoc = (tag, modal = false) => ({
  activeElement: tag ? { tagName: tag, isContentEditable: false } : null,
  querySelector: (sel) => (modal && sel === ".fixed.inset-0" ? {} : null),
});
const NOW = 1_000_000;
const justNow = NOW - 1000;
const agesAgo = NOW - 10 * 60 * 1000;

ok("typing in a field is busy",
   upd.looksBusy({ doc: fakeDoc("INPUT"), lastActivityAt: justNow, now: NOW }));
ok("a modal open with somebody there is busy",
   upd.looksBusy({ doc: fakeDoc(null, true), lastActivityAt: justNow, now: NOW }));
// THE BUG IN THE FIRST VERSION OF THIS FILE: a station PC left with the
// cursor parked in a search box counted as busy forever, so the check was
// skipped every hour of every working day and nothing ever said why.
ok("a field left focused with nobody there is NOT busy",
   !upd.looksBusy({ doc: fakeDoc("INPUT"), lastActivityAt: agesAgo, now: NOW }));
ok("an idle screen is not busy",
   !upd.looksBusy({ doc: fakeDoc(null), lastActivityAt: justNow, now: NOW }));
ok("no document at all is treated as busy", upd.looksBusy({ doc: null }));

// Run the reload decision on a fake clock.
// [2026-09-16] async, because the reload itself is now async.
//
// reloadWhenFree() used to call registration.update() and reload on the very
// next line without waiting for it — which is what reloaded a station onto
// the OLD precached bundle and put the update strip straight back up, three
// or four times in a row. It now awaits the service worker before reloading,
// so the fake reload below lands a microtask later than it used to and this
// helper has to wait for it. The timings it asserts are unchanged.
async function runReload({ busyFor = 0, deadlineMs = null, ticks = 60 }) {
  let t = 0;
  let reloaded = null;
  const timers = [];
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  globalThis.setInterval = (fn) => { timers.push(fn); return timers.length; };
  globalThis.clearInterval = () => {};
  upd.reloadWhenFree({
    isBusy: () => t < busyFor,
    reload: () => { if (reloaded === null) reloaded = t; },
    deadlineMs,
    idleMs: 20000,
    now: () => t,
  });
  for (let i = 0; i < ticks; i += 1) {
    t += 2000;
    timers.forEach((fn) => fn());
    // Let go()'s awaits settle inside the same simulated instant, so the
    // recorded time is still the tick the reload was DECIDED on.
    if (reloaded === null) await Promise.resolve().then(() => {}).then(() => {}).then(() => {});
  }
  globalThis.setInterval = realSet; globalThis.clearInterval = realClear;
  return reloaded;
}

ok("an idle screen reloads after the quiet period, not instantly",
   await runReload({ busyFor: 0 }) >= 20000 && await runReload({ busyFor: 0 }) <= 24000,
   `reloaded at ${await runReload({ busyFor: 0 })}ms`);
ok("a busy screen is left alone until it goes quiet",
   await runReload({ busyFor: 60000 }) >= 80000, `reloaded at ${await runReload({ busyFor: 60000 })}ms`);
ok("an automatic update NEVER interrupts somebody who keeps working",
   await runReload({ busyFor: Infinity, ticks: 200 }) === null);
ok("a push from HQ does give up waiting eventually",
   await runReload({ busyFor: Infinity, deadlineMs: 60000, ticks: 200 }) >= 60000,
   `reloaded at ${await runReload({ busyFor: Infinity, deadlineMs: 60000, ticks: 200 })}ms`);
ok("the deadline for a pushed update is five minutes",
   upd.FORCED_RELOAD_AFTER_MS === 5 * 60 * 1000);
ok("the version check runs every five minutes, not once an hour",
   upd.VERSION_CHECK_MS === 5 * 60 * 1000);

// The reload must not wait for the offline queue to drain: a station with
// no internet would then never update at all, and a reload cannot lose
// queued work — it lives in localStorage.
ok("the reload does not wait for the offline queue",
   !readFileSync("src/appUpdate.js", "utf8").includes("getQueue"));

// ── 4. it is wired in, and HQ can see it ─────────────────────────────────

console.log("\n4. Wired in, reported, and pushable");

ok("the service worker registration is kept for the reload",
   main.includes("window.__paddytradeSW"));
ok("the banner is mounted in App", app.includes("<UpdateBanner />"));
ok("the banner watches for a new version", banner.includes("watchForUpdates"));
ok("the banner reports this browser's version", banner.includes("api.reportAppVersion(APP_VERSION)"));
ok("the banner obeys a push from HQ", banner.includes("reload_requested_at"));
// A push made BEFORE this page loaded must not count, or every reload would
// see the same timestamp and reload again, forever.
// [2026-09-19] Compared against the first value THIS page read, never this
// PC's own clock: a PC whose clock is behind saw every old push as new and
// reloaded forever (audit F28).
ok("an old push cannot cause a reload loop",
   /seenReloadAt\.current === undefined\)\s*\{\s*seenReloadAt\.current = at;\s*return;/.test(banner),
   "the first reload time read after load must be taken as the baseline, not acted on");
ok("a push is never judged by this PC's clock",
   !/reload_requested_at[\s\S]{0,600}Date\.now\(\)/.test(banner) && !banner.includes("openedAt"),
   "the push must not be compared with Date.now()");
// The banner is a top strip, not a full-screen overlay — if it matched the
// modal selector it would report itself as "somebody is busy" and nothing
// would ever reload.
ok("the banner does not look like a modal to the busy check",
   !banner.includes("fixed inset-0"));

ok("api can report a version", api.includes("async reportAppVersion(version)"));
ok("reporting a version never throws", /async reportAppVersion[\s\S]{0,400}catch/.test(api));
ok("a view-only account still reports its version",
   /ALWAYS_ALLOWED[\s\S]{0,600}"reportAppVersion"/.test(api));
ok("api can read the push flag", api.includes("async getAppControl()"));
ok("an un-migrated database reads as \"never pushed\", not an error",
   /async getAppControl\(\)[\s\S]{0,400}if \(error\) return null;/.test(api));
ok("api can push", api.includes("async requestStationReload()"));

// [2026-09-16] Was tied to the panel's heading key, which moved when the two
// station panels were merged into one table. A guard tied to a label punishes
// renaming the label; this checks the thing that actually matters — that the
// screen shows a version PER STATION, not one number for the whole company.
ok("the HQ screen shows a version column per station",
   versions.includes('t("st_col_version")') && versions.includes("shortVersion(shown)"));
ok("the push button is owner-only on screen too", versions.includes("profile?.isOwner"));

// ── 5. the SQL adds, and never alters ────────────────────────────────────

console.log("\n5. The migration only adds");

ok("it adds the column idempotently", sql.includes("add column if not exists app_version"));
ok("report_app_version only touches the caller's own row",
   /report_app_version[\s\S]{0,700}where id = auth\.uid\(\)/.test(sql));
ok("the control table can only ever hold one row",
   /app_control[\s\S]{0,300}primary key default true check \(id\)/.test(sql));
ok("row level security is on for it", sql.includes("alter table public.app_control enable row level security"));
ok("nobody can write the control table directly",
   !/create policy[^;]*app_control[^;]*for (update|insert|all)/i.test(sql));
ok("pushing is refused for anyone but the owner",
   sql.includes("raise exception 'Only the owner can push an update to the stations'"));
ok("it works whether permissions are jsonb or text[]",
   sql.includes("to_jsonb(r.permissions) ? 'manage_admins'"));
// The one thing that would be dangerous: quietly replacing a function this
// session has never read.
for (const forbidden of ["touch_last_seen", "acknowledge_logout", "request_logout", "drop table", "drop column"]) {
  ok(`the migration does not touch ${forbidden}`,
     !new RegExp(`(create or replace function[^;]*|drop [^;]*)${forbidden.replace(/ /g, "\\s+")}`, "i").test(sql));
}

console.log(failed ? `\n${failed} FAILED` : "\nThe update path is intact: a station cannot silently sit on old code.");
process.exit(failed ? 1 : 0);
