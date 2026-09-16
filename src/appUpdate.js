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
// Uploading to GitHub does not reach a browser that is already open. Nothing
// shipped can fix a station that never asks whether anything shipped.
//
// ── What this does ───────────────────────────────────────────────────────
//
// Asks, roughly once an hour, while the app sits open. The registration is
// already configured with registerType "autoUpdate" and workbox skipWaiting
// (see vite.config.js), so when a check finds new code the page reloads
// itself. That behaviour is unchanged and deliberately untouched — only the
// asking is new.
//
// ── Why the check is gated ───────────────────────────────────────────────
//
// Because the reload follows the check, gating the check gates the reload.
// A reload discards whatever is typed and not yet saved. At 06:00 with a
// truck on the scale and a half-entered ticket, losing that is worse than
// running yesterday's code for another hour.
//
// So a check is skipped whenever somebody is plainly in the middle of
// something — a field focused, or a window open over the page. Skipping
// costs nothing: it asks again an hour later, and again when the tab is
// brought back, and again when the connection returns. What it can never do
// is pull the page out from under someone mid-ticket.

// Frequent enough that a station can never be more than about an hour behind
// a fix; rare enough to be invisible on a bad connection.
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Is somebody in the middle of something?
 *
 * Deliberately cautious — when in doubt it answers "yes" and the check waits
 * for the next hour. The cost of waiting is an hour of old code; the cost of
 * being wrong is a lost ticket.
 */
export function looksBusy(doc = typeof document === "undefined" ? null : document) {
  if (!doc) return true;
  const el = doc.activeElement;
  const tag = el && el.tagName ? el.tagName.toUpperCase() : "";
  // Someone is typing.
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el && el.isContentEditable) return true;
  // A modal is open over the page. Every modal in this app is a fixed,
  // full-screen overlay — New Ticket, Finish Ticket, Edit, Void, Change
  // Request, the password prompt. If the markup for those ever changes, the
  // focus check above still covers the case that matters most.
  if (doc.querySelector(".fixed.inset-0")) return true;
  return false;
}

/**
 * Ask the browser to check for new code, on a timer and at the moments a
 * station PC naturally reaches without the page ever reloading.
 *
 * Tolerant by design: a station with no connection fails this check every
 * hour for as long as it is offline, and that must be silent and must never
 * affect anything else. The scale keeps working with no internet — that is
 * what the offline queue is for.
 *
 * Returns a function that stops the checks.
 */
export function startUpdateChecks(registration, {
  intervalMs = UPDATE_CHECK_MS,
  isBusy = looksBusy,
} = {}) {
  if (!registration || typeof registration.update !== "function") return () => {};

  const tick = () => {
    if (isBusy()) return;
    try {
      const r = registration.update();
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {
      // Offline, or the browser refused. Try again next hour.
    }
  };

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
    clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") window.removeEventListener("online", tick);
  };
}
