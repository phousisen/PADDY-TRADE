import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in a .env file locally, or in your Vercel project's Environment Variables."
  );
}

// Station WiFi is sometimes "connected" but has no real internet (router up,
// ISP/modem down) — the browser's default fetch has no timeout for that
// case, so every Supabase call could previously hang for 60s+ before
// failing, instead of failing fast and letting the app's offline mode take
// over. That hang is what made the app *feel* slow instead of just offline.
// This wraps every request the Supabase client makes with an 8s timeout.
const FETCH_TIMEOUT_MS = 8000;
function fetchWithTimeout(url, options = {}) {
  // Auth requests (session refresh, sign-in, sign-out) are deliberately
  // left OUT of this timeout. Aborting a normal data request just means
  // that one query fails and the app falls back to cached data — low
  // stakes. But aborting a token-refresh request is a much bigger deal:
  // Supabase's own auth library can treat that abort as a real failure
  // and sign the whole app out, even though the connection was only
  // being slow, not actually down. That was almost certainly the cause
  // of staff getting randomly logged out on ordinary flaky station WiFi
  // — the 8s cutoff has nothing to do with whether the request would
  // have succeeded, just whether it happened to be slow at that exact
  // moment. Auth requests instead get the browser's own default (much
  // longer) timeout, so a slow-but-real connection has time to actually
  // finish instead of being mistaken for a dead session.
  const urlString = typeof url === "string" ? url : url?.url || "";
  if (urlString.includes("/auth/v1/")) return fetch(url, options);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: options.signal || controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
});

// [2026-08-28] Guards against a real incident at the Thapedey station: a
// browser tab's login quietly went stale — its access token expired, and
// supabase-js's own background auto-refresh silently stopped keeping up
// (this can happen after a tab sits open a long time, or a PC goes to
// sleep and wakes up later) — and every save after that failed with "new
// row violates row-level security policy", which had NOTHING to do with
// permissions: the request simply wasn't authenticated as anyone anymore,
// and the database was correctly treating it the same as a stranger with
// no login at all. Nothing in the UI looked wrong (the profile/name still
// showed normally, from cached data), so this was very confusing to
// diagnose, and even logging out and back in through the app didn't
// always clear it if the stale token was still what got restored on
// reload.
//
// Rather than wait to discover a dead login from a confusing downstream
// error, this checks the token's real expiry BEFORE every sync attempt
// (see offlineQueue.js's trySync) and refreshes it proactively if it's
// already expired or about to be. If refreshing also fails, that means
// the login is genuinely gone and needs a real sign-in again — the caller
// then shows a plain "please sign in again" message instead of a
// confusing permissions-looking one, and — importantly — none of the
// still-queued, not-yet-saved changes are touched or lost: they stay
// exactly as they are in this browser and pick right back up the moment
// someone signs back in, no re-typing needed.
const SESSION_REFRESH_BUFFER_SECONDS = 120;
export async function ensureFreshSession() {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    // No session at all just means nobody's logged in on this device —
    // AuthContext's own login screen already handles that case; nothing
    // for the sync loop to do here.
    if (!session) return true;

    const expiresAt = session.expires_at; // unix seconds
    const nowSeconds = Date.now() / 1000;
    if (!expiresAt || expiresAt - nowSeconds > SESSION_REFRESH_BUFFER_SECONDS) {
      return true; // Comfortably valid — nothing to do.
    }

    const { data: refreshed, error } = await supabase.auth.refreshSession();
    return !error && !!refreshed?.session;
  } catch (_err) {
    // Couldn't even check right now (e.g. genuinely offline) — that's a
    // normal offline situation, not proof the login itself is dead, so
    // don't block syncing on it; a real save attempt will fail (and
    // retry) the ordinary way if there's truly no connection.
    return true;
  }
}
