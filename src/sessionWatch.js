// Coming back to an app that has been sitting in a pocket.
//
// [2026-09-16] SISEN, about the account his parents use on their phones:
//
//     "it always logged them out and or sometimes the data is all 0 that they
//      need to log out and log back in to see it back. its never auto."
//
// WHAT WAS ACTUALLY HAPPENING
//
// A phone suspends a backgrounded app. Timers stop, so the login token's
// background refresh stops with them, and the token quietly expires. When the
// app is opened again the PAGE IS STILL THERE — it does not reload, and
// nothing on it re-asks the database. Two ways that looks:
//
//   · Nothing changes. The figures are from hours ago and no one can tell.
//   · Something does re-ask, and the database — correctly — treats an
//     expired token as a stranger and returns NOTHING. Row-level security
//     filters rather than errors, so the screen shows 0 rather than a
//     warning. Which is the worst possible answer: a business with 181 tonnes
//     in its sheds reading as empty.
//
// Signing out and back in issued a new token, which is why that "fixed" it.
//
// WHAT THIS DOES
//
// Watches for the app returning to the foreground, or the connection coming
// back. On either, it makes the login fresh BEFORE anything asks, and then
// tells the screens to ask again.
//
// A brief switch to another app is not a resume — glancing at a message and
// coming straight back should not reload anything. So a re-fetch is only
// announced when the app was away long enough for it to matter, or when the
// token actually had to be renewed.
//
// NOTHING HERE DECIDES WHAT "0" MEANS. It cannot: an empty answer from the
// database is genuinely ambiguous. What it can do is make sure the question
// was asked with a valid login, which removes the only cause anyone has seen.

// Away for less than this and nothing is re-fetched — it was a glance at
// another app, not a return.
export const AWAY_LONG_ENOUGH_MS = 30 * 1000;

/**
 * Should coming back cause a re-fetch?
 *
 * @param hiddenAt      when the app went away, or null if it never did
 * @param refreshed     did the login have to be renewed just now?
 */
export function shouldRefetch({ hiddenAt, refreshed, reason, now = Date.now() } = {}) {
  // [2026-09-16] Found by this file's own guard: on "online" the app may never
  // have been hidden at all, so the rules below said no and a station whose
  // line had just come back after an outage kept showing whatever it managed
  // to load before the line dropped. Reconnecting is always worth re-asking:
  // every request made while it was down had failed.
  if (reason === "online") return true;
  // A restored app that was never seen to go away — an iPhone waking one it
  // had suspended without a visibilitychange first.
  if (reason === "restored") return true;
  // A renewed token means the old one had expired or was about to. Whatever
  // is on screen was fetched with it, so it cannot be trusted.
  if (refreshed) return true;
  if (!hiddenAt) return false;
  return now - hiddenAt >= AWAY_LONG_ENOUGH_MS;
}

const listeners = new Set();

/** Screens subscribe; they are told when it is worth asking again. */
export function onShouldRefetch(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(reason) {
  for (const fn of [...listeners]) {
    try { fn(reason); } catch { /* one screen failing must not stop the rest */ }
  }
}

/**
 * Start watching. Called once, from main.jsx.
 *
 * @param ensureFresh  makes the login fresh; returns false if it is genuinely
 *                     gone. Injected so this whole file can be tested.
 * @returns a function that stops watching
 */
export function startSessionWatch({
  ensureFresh,
  doc = typeof document === "undefined" ? null : document,
  win = typeof window === "undefined" ? null : window,
  now = () => Date.now(),
} = {}) {
  if (!doc || !win || typeof ensureFresh !== "function") return () => {};

  let hiddenAt = null;
  let busy = false;
  // pageshow fires on an ordinary first load too, and the screens fetch on
  // mount anyway — so the first couple of seconds are not a "return".
  const startedAt = now();

  async function comeBack(reason) {
    if (busy) return;
    busy = true;
    try {
      const before = now();
      // Returns false only when the login is genuinely gone — the app's own
      // "please sign in again" path already handles that, and shouting about
      // it here would just produce a second, competing message.
      const ok = await ensureFresh();
      // A refresh that had to go to the network took time; a token that was
      // already comfortably valid returns almost instantly. That difference
      // is the only honest signal available for "did this actually renew",
      // and erring towards re-fetching is the safe direction.
      const refreshed = ok && now() - before > 150;
      if (shouldRefetch({ hiddenAt, refreshed, reason, now: now() })) announce(reason);
      hiddenAt = null;
    } finally {
      busy = false;
    }
  }

  const onVisibility = () => {
    if (doc.visibilityState === "hidden") { hiddenAt = now(); return; }
    comeBack("foreground");
  };
  const onOnline = () => comeBack("online");
  // iOS in particular fires pageshow rather than visibilitychange when an app
  // is restored from the background.
  const onPageShow = () => {
    if (now() - startedAt < 2000) return;   // the ordinary first load
    comeBack(hiddenAt ? "foreground" : "restored");
  };

  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("online", onOnline);
  win.addEventListener("pageshow", onPageShow);

  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("online", onOnline);
    win.removeEventListener("pageshow", onPageShow);
    listeners.clear();
  };
}
