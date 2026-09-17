// Why was this machine signed out?
//
// [2026-09-17] SISEN, twice now: "why do we always get logged out" — and
// earlier, about his parents' phones, "it always logged them out … how to make
// sure that we wont have to log in and log back in anymore."
//
// THE REAL PROBLEM IS NOT THE LOGGING OUT. It is that nobody knows which of
// five different things did it, so every answer so far has been a guess:
//
//   1. a Supabase project setting — one session per user, or a timeout
//   2. the login token expiring and failing to renew (phone slept)
//   3. HQ signing this machine out from the Stations panel
//   4. the heartbeat's forced-logout flag
//   5. the person pressing Log out
//
// Five causes, one symptom, no record. This file is the record. Every path in
// the app that ends a session writes down WHY first, the note survives the
// reload (it is the one thing that must outlive the session it describes), and
// the login screen shows it in plain Khmer to whoever is standing there.
//
// THE IMPORTANT ONE IS THE ABSENCE OF A NOTE. When Supabase's own library
// ends a session — an expired refresh token, a session Supabase itself
// decided to end — nothing in this app runs first. So AuthContext treats an
// unexplained SIGNED_OUT as reason "expired", and THAT is the case that tells
// SISEN the cause is the token or the project settings and not his own code.
//
// localStorage, deliberately: a session that has just ended cannot write to
// the database, and the note has to survive the reload that follows.

const KEY = "paddytrade_signout_note";

/** The five things that can end a session. Anything else is a bug. */
export const REASONS = {
  USER: "user",              // pressed Log out
  EVERYWHERE: "everywhere",  // pressed "sign out everywhere"
  HQ_DEVICE: "hq_device",    // HQ signed this machine out
  HQ_FORCED: "hq_forced",    // the heartbeat's forced-logout flag
  PASSWORD: "password",      // finished setting a password
  EXPIRED: "expired",        // nothing in this app did it — the token or the project
};

/** Write it down. Never throws: a broken note must not block a sign-out. */
export function noteSignOut(reason, extra = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      reason,
      at: new Date().toISOString(),
      ...extra,
    }));
  } catch { /* private mode, full disk — the sign-out still has to happen */ }
}

/** What ended the last session, or null if this device has never been told. */
export function readSignOutNote() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const note = JSON.parse(raw);
    if (!note || typeof note.reason !== "string") return null;
    return note;
  } catch {
    return null;
  }
}

export function clearSignOutNote() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Was the last sign-out one this app performed on purpose?
 *
 * Used by AuthContext to decide what an unexplained SIGNED_OUT means. A note
 * older than this is treated as stale — a person who logged out on Monday and
 * whose token expires on Friday must not have Friday blamed on Monday.
 */
export const NOTE_FRESH_MS = 60 * 1000;
export function wasDeliberate({ note, now = Date.now() } = {}) {
  if (!note || !note.at) return false;
  if (note.reason === REASONS.EXPIRED) return false;
  const at = new Date(note.at).getTime();
  if (!Number.isFinite(at)) return false;
  return now - at >= 0 && now - at < NOTE_FRESH_MS;
}

/**
 * The line the login screen shows.
 *
 * Only worth showing while it still explains the screen the person is looking
 * at. A note from last week is history, not an explanation, and a login screen
 * carrying a week-old complaint is noise.
 */
export const SHOW_FOR_MS = 12 * 60 * 60 * 1000;
export function shouldShowNote({ note, now = Date.now() } = {}) {
  if (!note || !note.at) return false;
  const at = new Date(note.at).getTime();
  if (!Number.isFinite(at)) return false;
  // A clock that has jumped backwards must not hide the note forever.
  if (now < at) return true;
  return now - at < SHOW_FOR_MS;
}

/** i18n key for a reason, so the screen never hardcodes English. */
export function reasonKey(reason) {
  switch (reason) {
    case REASONS.USER: return "so_reason_user";
    case REASONS.EVERYWHERE: return "so_reason_everywhere";
    case REASONS.HQ_DEVICE: return "so_reason_hq_device";
    case REASONS.HQ_FORCED: return "so_reason_hq_forced";
    case REASONS.PASSWORD: return "so_reason_password";
    case REASONS.EXPIRED: return "so_reason_expired";
    default: return "so_reason_unknown";
  }
}

/**
 * Is this a cause SISEN needs to act on, rather than one that explains itself?
 *
 * "You pressed Log out" needs nothing. "Your login expired" is the one that
 * means the Supabase session settings or the token refresh are the problem —
 * so it is the only one the login screen offers any advice about.
 */
export function needsAttention(reason) {
  return reason === REASONS.EXPIRED;
}
