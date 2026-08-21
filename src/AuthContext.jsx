import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";

const AuthContext = createContext(null);

// How often each logged-in browser "checks in" — both to mark itself as
// active for the Users page, and to notice if an HQ Admin/Owner has forced
// it to log out.
const HEARTBEAT_MS = 20000;

// If we're offline, supabase.auth.getSession() can sit waiting to reach the
// server (e.g. to refresh an expired token) instead of failing fast — with
// nothing else guarding it, that used to leave the whole app stuck on the
// "Loading…" screen forever. If startup hasn't finished within this many
// milliseconds, we stop waiting and fall back to whatever was saved on this
// device the last time someone logged in here, so the app still opens while
// offline.
const STARTUP_TIMEOUT_MS = 5000;

// The one piece of the signed-in state we keep a local copy of, purely so
// the app can still open while offline. Nothing new or more sensitive than
// what's already sitting in this browser's page each time someone is
// logged in — just a snapshot of it, kept on this device only.
const CACHED_PROFILE_KEY = "paddytrade_cached_profile";

function loadCachedProfile() {
  try {
    const raw = localStorage.getItem(CACHED_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_err) {
    return null;
  }
}

function cacheProfile(profile) {
  try {
    if (profile) localStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
  } catch (_err) {
    // Storage unavailable/full — not worth failing login over.
  }
}

// A rough, plain-language guess at the browser/OS someone is using, read
// straight from the browser itself (not a precise device fingerprint) —
// just enough for the Users page to show e.g. "Chrome on Windows".
function describeDevice() {
  if (typeof navigator === "undefined" || !navigator.userAgent) return "Unknown device";
  const ua = navigator.userAgent;

  let os = "Unknown OS";
  if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Unknown browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/CriOS|Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";

  return `${browser} on ${os}`;
}

// Asks a free public lookup service what IP this browser is connecting
// from, and roughly where that IP is registered (city/country). This is
// the same technique most consumer apps use for "new login location"
// alerts — it's approximate (VPNs/mobile data can throw it off) and
// self-reported by the browser, not a precise or tamper-proof fingerprint.
// If the lookup fails for any reason, login still proceeds normally —
// this only adds a nice-to-have detail for the Users page.
async function lookupIpLocation() {
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (!res.ok) return { ip: null, location: null };
    const data = await res.json();
    const parts = [data.city, data.country_name].filter(Boolean);
    return { ip: data.ip || null, location: parts.length ? parts.join(", ") : null };
  } catch (_err) {
    return { ip: null, location: null };
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // The moment this browser tab started up. A forced-logout flag only
  // matters if it was set AFTER this — otherwise a leftover flag from a
  // past logout would immediately kick the user again on their next login.
  const openedAtRef = useRef(new Date());

  // Returns true if it actually managed to load a profile from the server
  // (and set it via setProfile), false otherwise. Callers use this to know
  // when they need to fall back to the cached copy themselves — this
  // function deliberately does NOT clear an existing profile to null on
  // failure, so a caller that already has something on screen doesn't get
  // yanked back to the login page just because one background refresh
  // failed (e.g. a momentary network blip).
  async function loadProfile(userId) {
    try {
      // Try the full query with the roles join first.
      const { data, error } = await supabase
        .from("profiles")
        .select("*, roles(id, name, scope, permissions)")
        .eq("id", userId)
        .single();

      if (!error) {
        const built = {
          ...data,
          roleName: data.roles?.name || data.role,
          permissions: data.roles?.permissions || [],
          roleScope: data.roles?.scope || (data.role === "admin" ? "all" : "own_location"),
          isOwner: (data.roles?.permissions || []).includes("manage_admins"),
        };
        setProfile(built);
        cacheProfile(built);
        return true;
      }

      // The roles table/column may not exist yet if the SQL migration
      // hasn't been run (or hasn't been run yet in this exact order).
      // Rather than lock everyone out of the app, fall back to the plain
      // profile so login still works — the new role features just won't
      // be active until that migration is applied.
      console.warn("Roles join failed, falling back to plain profile:", error.message);
      const fallback = await supabase.from("profiles").select("*").eq("id", userId).single();
      if (fallback.error) {
        console.error("Failed to load profile", fallback.error);
        return false;
      }
      const built = {
        ...fallback.data,
        roleName: fallback.data.role,
        permissions: [],
        roleScope: fallback.data.role === "admin" ? "all" : "own_location",
        isOwner: false,
      };
      setProfile(built);
      cacheProfile(built);
      return true;
    } catch (_err) {
      // Genuinely offline (the fetch itself failed) — the caller falls
      // back to whatever was cached from the last successful load.
      return false;
    }
  }

  // Loads the real profile from the server; if that fails (e.g. no
  // internet), falls back to the last copy saved on this device rather
  // than leaving the app with no profile at all — which is what used to
  // bounce people back to the login screen the moment WiFi dropped, even
  // though their session itself was still perfectly valid.
  async function loadProfileWithOfflineFallback(userId) {
    const ok = await loadProfile(userId);
    if (!ok) {
      const cached = loadCachedProfile();
      if (cached) setProfile(cached);
    }
  }

  useEffect(() => {
    // `settled` makes sure only ONE of "the real Supabase check finished"
    // or "we gave up and used the offline fallback" ever gets to decide
    // what the app opens with — whichever happens first wins, so a slow
    // network response that trickles in afterwards can't suddenly bounce
    // someone back to the login screen.
    let settled = false;

    async function init() {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        if (settled) return;
        setSession(session);
        if (session) await loadProfileWithOfflineFallback(session.user.id);
      } catch (_err) {
        // Genuinely offline with nothing else to go on — the timeout
        // fallback below covers this.
      } finally {
        if (!settled) {
          settled = true;
          setLoading(false);
        }
      }
    }

    init();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const cached = loadCachedProfile();
      if (cached) {
        setProfile(cached);
        // We don't have a real Supabase session object yet, but a couple
        // of other places just check "is someone logged in" / need the
        // user id (the heartbeat, logout) — this minimal stand-in covers
        // that until the real session arrives via onAuthStateChange.
        setSession((prev) => prev || { user: { id: cached.id }, offline: true });
      }
      setLoading(false);
    }, STARTUP_TIMEOUT_MS);

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session) {
        await loadProfileWithOfflineFallback(session.user.id);
        // Only record a fresh "login" on an actual sign-in — not on a page
        // reload restoring an existing session, and not on a background
        // token refresh, both of which also fire through this callback.
        if (_event === "SIGNED_IN") {
          lookupIpLocation().then(({ ip, location }) => {
            // Wrapped in Promise.resolve() because Supabase's query builder
            // isn't a real Promise until it's awaited/wrapped — calling
            // .catch() straight on it throws "...catch is not a function"
            // and login-tracking failures were showing up as uncaught
            // errors in the console instead of being quietly ignored.
            Promise.resolve(
              supabase.rpc("record_login", { device_info: describeDevice(), ip_address: ip, ip_location: location })
            ).catch(() => {});
          });
        }
      } else {
        setProfile(null);
      }
    });

    return () => { clearTimeout(timer); listener.subscription.unsubscribe(); };
  }, []);

  // Heartbeat: while someone is logged in, periodically mark this browser
  // as active and check whether an admin has forced this session to log
  // out. Both checks happen through narrow database functions (not a
  // direct table read/write of sensitive columns) — see
  // migration_active_users_admin.sql.
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;

    async function tick() {
      try {
        await supabase.rpc("touch_last_seen");
        const { data } = await supabase
          .from("profiles")
          .select("logout_requested_at")
          .eq("id", session.user.id)
          .single();
        if (!cancelled && data?.logout_requested_at && new Date(data.logout_requested_at) > openedAtRef.current) {
          await supabase.rpc("acknowledge_logout");
          await supabase.auth.signOut();
        }
      } catch (_err) {
        // Transient network/RPC errors here shouldn't crash the app or log
        // anyone out — just try again on the next tick.
      }
    }

    tick();
    const interval = setInterval(tick, HEARTBEAT_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [session?.user?.id]);

  async function login(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  function hasPermission(key) {
    return Array.isArray(profile?.permissions) && profile.permissions.includes(key);
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
