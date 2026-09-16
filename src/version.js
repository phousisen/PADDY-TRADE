// What version of PaddyTrade this browser is actually running.
//
// [2026-09-16] SISEN: "everything i make an update for the system, each
// location doesnt know or there system wont auto update until they refresh
// their app or close and open again. how to fix this. i need a professional
// version of the system. like top level."
//
// The first thing a professional version needs is an ANSWER TO "WHICH ONE
// ARE THEY RUNNING". Until now nothing in the app could say. A station could
// be days behind — Reang Kesey was, three times — and the only way to find
// out was to walk there.
//
// The string is stamped into the bundle at build time by vite.config.js and
// reads like a date, on purpose, so it can be compared by eye in a phone
// call: 2026.09.16-1742-a1b2c3d is "the 16th of September, 17:42" followed
// by the exact commit. The same string is written to version.json beside the
// bundle, so a running app can ask the server what the newest one is without
// involving the service worker at all.
//
// "dev" is what you get outside a build — a guard script, a test, `vite dev`
// before the define is applied. Nothing compares versions in those places.

export const APP_VERSION =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "dev";

/** The date part only — 2026.09.16-1742 — for somewhere tight on space. */
export function shortVersion(v = APP_VERSION) {
  const s = String(v || "");
  const cut = s.indexOf("-", s.indexOf("-") + 1);
  return cut > 0 ? s.slice(0, cut) : s;
}
