import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";

const AuthContext = createContext(null);

// How often each logged-in browser "checks in" — both to mark itself as
// active for the Users page, and to notice if an HQ Admin/Owner has forced
// it to log out.
const HEARTBEAT_MS = 20000;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // The moment this browser tab started up. A forced-logout flag only
  // matters if it was set AFTER this — otherwise a leftover flag from a
  // past logout would immediately kick the user again on their next login.
  const openedAtRef = useRef(new Date());

  async function loadProfile(userId) {
    // Try the full query with the roles join first.
    const { data, error } = await supabase
      .from("profiles")
      .select("*, roles(id, name, scope, permissions)")
      .eq("id", userId)
      .single();

    if (!error) {
      setProfile({
        ...data,
        roleName: data.roles?.name || data.role,
        permissions: data.roles?.permissions || [],
        roleScope: data.roles?.scope || (data.role === "admin" ? "all" : "own_location"),
        isOwner: (data.roles?.permissions || []).includes("manage_admins"),
      });
      return;
    }

    // The roles table/column may not exist yet if the SQL migration hasn't
    // been run (or hasn't been run yet in this exact order). Rather than
    // lock everyone out of the app, fall back to the plain profile so
    // login still works — the new role features just won't be active
    // until that migration is applied.
    console.warn("Roles join failed, falling back to plain profile:", error.message);
    const fallback = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (fallback.error) {
      console.error("Failed to load profile", fallback.error);
      setProfile(null);
      return;
    }
    setProfile({
      ...fallback.data,
      roleName: fallback.data.role,
      permissions: [],
      roleScope: fallback.data.role === "admin" ? "all" : "own_location",
      isOwner: false,
    });
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session) await loadProfile(session.user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session) {
        await loadProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => listener.subscription.unsubscribe();
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
