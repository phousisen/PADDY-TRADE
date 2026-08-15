import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*, roles(id, name, scope, permissions)")
      .eq("id", userId)
      .single();
    if (error) {
      console.error("Failed to load profile", error);
      setProfile(null);
    } else {
      setProfile({
        ...data,
        roleName: data.roles?.name || data.role,
        permissions: data.roles?.permissions || [],
        roleScope: data.roles?.scope || (data.role === "admin" ? "all" : "own_location"),
        isOwner: (data.roles?.permissions || []).includes("manage_admins"),
      });
    }
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
