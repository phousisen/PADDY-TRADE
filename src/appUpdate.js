// Making sure a station is never running last week's code.
//
// [2026-09-16] WHY THIS EXISTS
//
// Three times in two days, Reang Kesey created a paddy type that had been
// merged away hours earlier. Each time it was put back by hand; each time it
// came back. The cause was not the station and not the merge:
//
//   The app is an installed PWA. A service worker only looks for new code
//   when the page LOADS. That machine's app had been open continuously for
//   days, so it had never once checked — it was still running code from
//   before any of the fixes, holding a paddy list from before the merge, and
//   faithfully re-creating what it remembered.
//
// Uploading to GitHub does not reach a browser that is already open.
//
// SISEN: "everything i make an update for the system, each location doesnt
// know or there system wont auto update until they refresh their app or
// close and open again. how to fix this. i need a professional version of
// the system. like top level."
//
// ── The three things a top-level version needs ───────────────────────────
//
//   1. IT KNOWS. The running app compares its own stamped version against
//      version.json on the server every few minutes. That is a plain fetch,
//      not a service-worker question, so the answer is exact and cannot be
//      swallowed by a cache.
//
//   2. IT SAYS SO, AND ACTS. A strip appears at the top of the screen, and
//      the page reloads itself as soon as the station is not in the middle
//      of anything. Nobody has to know what a service worker is.
//
//   3. HQ CAN SEE AND PUSH. Every browser reports its version on the
//      heartbeat it already sends, so one screen lists all five stations and
//      what each is running. One button tells them all to take the new code
//      now. See api.reportAppVersion / requestStationReload.
//
// ── Why the reload waits ─────────────────────────────────────────────────
//
// A reload discards whatever is typed and not yet saved. At 06:00 with a
// truck on the scale and a half-entered ticket, losing that is worse than
// running yesterday's code for another ten minutes.
//
// So "busy" means a field is focused or a window is open over the page AND
// somebody has actually touched the keyboard or mouse in the last minute. A
// screen left sitting with the cursor parked in a search box is not busy —
// that was the flaw in the first version of this file, which could skip
// every check for a whole working day and never say why.
//
// Nothing here can lose a ticket that was already typed and saved: the
// offline queue lives in localStorage and survives a reload, which is why
// the reload does not wait for it to drain. A station with no internet would
// otherwise never update at all.

import { APP_VERSION } from "./version.js";

// Frequent enough that a station can never be far behind a fix; light
// enough to be invisible — version.json is a few dozen bytes.
export const VERSION_CHECK_MS = 5 * 60 * 1000;

// How long the screen must be left alone before a reload is allowed.
export const IDLE_BEFORE_RELOAD_MS = 20 * 1000;

// After this long staring at the strip, a reload happens even if someone is
// still poking at the screen. Only used for a reload HQ actually asked for —
// an automatic one is never forced.
export const FORCED_RELOAD_AFTER_MS = 5 * 60 * 1000;

// Somebody counts as present for this long after their last keystroke.
const ACTIVITY_WINDOW_MS = 60 * 1000;

/** Where the build writes the version it produced. See vite.config.js. */
export const VERSION_URL = "/version.json";

/**
 * Ask the server which version it is serving.
 *
 * Deliberately tolerant: a station with no connection fails this every few
 * minutes for as long as it is offline, and that must be silent and must
 * never affect anything else. The scale keeps working with no internet —
 * that is what the offline queue is for.
 *
 * Returns the version string, or null if it could not be read.
 */
export async function fetchServerVersion(fetchFn, url = VERSION_URL) {
  // Wrapped, not passed by reference: an unbound `fetch` can be rejected as
  // an illegal invocation in some browsers, and this is the one call the
  // whole update mechanism rests on — it must not fail quietly on one
  // station's browser and nowhere else.
  const f = fetchFn || (typeof fetch === "function" ? ((...a) => fetch(...a)) : null);
  if (!f) return null;
  try {
    // no-store, and a changing query, because the whole point is to bypass
    // every cache between here and the server.
    const res = await f(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res || !res.ok) return null;
    const body = await res.json();
    const v = body && typeof body.version === "string" ? body.version : null;
    return v || null;
  } catch {
    return null;
  }
}

/**
 * Is the server serving something other than what this page is running?
 *
 * "dev" and a missing answer both mean "cannot tell", and cannot-tell is
 * never treated as an update — a station must not be nagged, or reloaded,
 * because a fetch failed.
 */
export function isOutdated(running, served) {
  if (!served || !running) return false;
  if (running === "dev" || served === "dev") return false;
  return running !== served;
}

/**
 * Is somebody in the middle of something?
 *
 * Two conditions, both required:
 *   - the screen is in a state that could hold unsaved typing (a focused
 *     field, or a modal open over the page), AND
 *   - a human has touched this machine in the last minute.
 *
 * A station PC left with the cursor in a search box overnight satisfies the
 * first and not the second, and is correctly judged free.
 */
export function looksBusy({ doc, lastActivityAt, now = Date.now() } = {}) {
  const d = doc || (typeof document === "undefined" ? null : document);
  if (!d) return true;
  const recent = typeof lastActivityAt === "number"
    && now - lastActivityAt < ACTIVITY_WINDOW_MS;
  if (!recent) return false;
  const el = d.activeElement;
  const tag = el && el.tagName ? el.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el && el.isContentEditable) return true;
  // Every modal in this app is a fixed, full-screen overlay — New Ticket,
  // Finish Ticket, Edit, Void, Change Request, the password prompt.
  if (typeof d.querySelector === "function" && d.querySelector(".fixed.inset-0")) return true;
  return false;
}

/**
 * Watch for a new version and report it.
 *
 * This module never reloads anything by itself. It tells the caller an
 * update exists; UpdateBanner.jsx decides when the page turns over, because
 * that decision belongs next to what is on screen.
 *
 * @returns {() => void} stop watching
 */
export function watchForUpdates({
  onUpdate,
  running = APP_VERSION,
  intervalMs = VERSION_CHECK_MS,
  fetchVersion = fetchServerVersion,
} = {}) {
  let stopped = false;
  let found = null;

  const tick = async () => {
    if (stopped || found) return;
    const served = await fetchVersion();
    if (stopped || !served) return;
    if (isOutdated(running, served)) {
      found = served;
      if (typeof onUpdate === "function") onUpdate(served);
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);

  // Coming back to a machine that was asleep, and reconnecting after an
  // outage, are both moments a station PC reaches without the page ever
  // reloading — and both are good moments to ask.
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") tick();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  if (typeof window !== "undefined") window.addEventListener("online", tick);

  return () => {
    stopped = true;
    clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") window.removeEventListener("online", tick);
  };
}

/**
 * Track when a human last touched this machine.
 *
 * @returns {{ lastActivityAt: () => number, stop: () => void }}
 */
export function trackActivity(target) {
  const el = target || (typeof window === "undefined" ? null : window);
  let last = Date.now();
  if (!el || typeof el.addEventListener !== "function") {
    return { lastActivityAt: () => last, stop: () => {} };
  }
  const mark = () => { last = Date.now(); };
  const events = ["keydown", "pointerdown", "wheel", "touchstart"];
  for (const e of events) el.addEventListener(e, mark, { passive: true, capture: true });
  return {
    lastActivityAt: () => last,
    stop: () => { for (const e of events) el.removeEventListener(e, mark, { capture: true }); },
  };
}

// How long to wait for the service worker to pick up the new bundle before
// reloading anyway. Long enough for a slow line at a weighbridge, short
// enough that nobody watches a banner sit there.
export const SW_UPDATE_WAIT_MS = 8000;

/**
 * Resolve when a NEW service worker has taken control, or when the wait runs
 * out. Reloading before this is what produced the repeat-update loop.
 */
function waitForNewWorker(waitMs) {
  return new Promise((resolve) => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : null;
    if (!sw) { resolve(); return; }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      sw.removeEventListener("controllerchange", finish);
      resolve();
    };
    sw.addEventListener("controllerchange", finish);
    setTimeout(finish, waitMs);
  });
}

// ── the loop breaker ──────────────────────────────────────────────────────
//
// Even with the wait above, a reload can fail to land on the new code — a
// browser that refuses to drop a worker, a proxy holding the old bundle.
// Reloading again achieves nothing and is what the station actually sees:
// the screen turning over by itself, repeatedly, while they are working.
//
// So the version a reload was made FOR is remembered for this tab. Come back
// still not running it and the app stops reloading itself; the strip stays
// up saying so, and a human closes and reopens the app, which always works.
const RELOAD_KEY = "paddytrade_reloaded_for";

export function rememberReloadFor(version, storage) {
  try {
    const s = storage || (typeof sessionStorage === "undefined" ? null : sessionStorage);
    if (s) s.setItem(RELOAD_KEY, String(version || ""));
  } catch { /* private window — the worst case is the old behaviour */ }
}

export function readReloadedFor(storage) {
  try {
    const s = storage || (typeof sessionStorage === "undefined" ? null : sessionStorage);
    return s ? s.getItem(RELOAD_KEY) : null;
  } catch {
    return null;
  }
}

/**
 * May the app reload ITSELF for this version?
 *
 * No, if it already reloaded for exactly this version and is still not
 * running it — that reload did not take, and a second one will not either.
 */
export function mayAutoReload({ served, reloadedFor }) {
  if (!served) return false;
  return served !== reloadedFor;
}

/**
 * Reload once the station is free — or, for a reload HQ asked for, after the
 * deadline whether it is free or not.
 *
 * The service worker is asked to update first, so the reload picks up the
 * new precached bundle rather than serving the old one back and bringing
 * the strip straight back (see vite.config.js: autoUpdate + skipWaiting).
 *
 * @returns {() => void} cancel
 */
export function reloadWhenFree({
  isBusy,
  reload,
  registration,
  idleMs = IDLE_BEFORE_RELOAD_MS,
  deadlineMs = null,
  pollMs = 2000,
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  let freeSince = null;
  let done = false;

  const go = async () => {
    if (done) return;
    done = true;
    clearInterval(timer);

    // [2026-09-16] WAIT for the service worker before reloading.
    //
    // SISEN: "everytime we upload new zip. the sytem will ask to update like
    // 3-4 times on repeat then it sometimes crash".
    //
    // registration.update() returns a PROMISE and this code fired the reload
    // on the next line without waiting for it. So the page reloaded while the
    // service worker was still fetching the new bundle, came back on the OLD
    // precached shell, compared its old __APP_VERSION__ against the new
    // version.json, decided it was out of date — and put the strip up again.
    // Round and round, three or four times, until the worker happened to
    // finish between two reloads.
    //
    // Now: ask it to update, and wait for the new worker to actually take
    // control before reloading. Capped, because a station on a bad line must
    // still get its reload rather than sitting here forever; a reload after
    // the cap is exactly the old behaviour, no worse.
    try {
      const r = registration && typeof registration.update === "function"
        ? registration.update() : null;
      if (r && typeof r.then === "function") {
        await Promise.race([
          r.catch(() => {}),
          new Promise((res) => setTimeout(res, SW_UPDATE_WAIT_MS)),
        ]);
      }
      await waitForNewWorker(SW_UPDATE_WAIT_MS);
    } catch {
      // Offline, or the browser refused. Reload anyway — the precache is
      // already on the disk, and a reload is the only way to leave old code.
    }
    if (typeof reload === "function") reload();
    else if (typeof window !== "undefined") window.location.reload();
  };

  const tick = () => {
    if (done) return;
    const t = now();
    if (deadlineMs != null && t - startedAt >= deadlineMs) { go(); return; }
    if (typeof isBusy === "function" && isBusy()) { freeSince = null; return; }
    if (freeSince === null) freeSince = t;
    else if (t - freeSince >= idleMs) go();
  };

  const timer = setInterval(tick, pollMs);
  return () => { done = true; clearInterval(timer); };
}
