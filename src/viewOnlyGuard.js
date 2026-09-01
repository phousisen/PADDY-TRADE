// [2026-09-01] Single shared source of truth for "is the currently
// signed-in account a view-only account". Added for the "one account that
// can see everything but can't change anything" request.
//
// Why this lives in its own tiny module instead of just living inside
// AuthContext.jsx: two other files need to read this OUTSIDE of React —
// api.js (the final backstop right before any write reaches the server)
// and offlineQueue.js (so a blocked action fails immediately, before it
// ever touches the local cache or the sync queue, instead of silently
// queuing something that can only ever fail later, which would otherwise
// leave a ghost "not synced" entry stuck on screen forever and eventually
// trip the "stuck, call an admin" banner for no real reason). Neither of
// those files can use a React hook. AuthContext.jsx is the only writer —
// it calls setViewOnlyMode() whenever the signed-in profile loads or
// changes, and again on logout.
//
// This is a UI/app-layer guard, not a database-level one. It stops every
// write this app's own code can make. It does NOT stop someone from
// bypassing the app entirely (e.g. calling Supabase directly from a
// browser console) — that would need matching restrictions at the
// database (RLS) level too, which is a separate, deliberate decision.
let active = false;

export function setViewOnlyMode(isActive) {
  active = !!isActive;
}

export function isViewOnlyMode() {
  return active;
}

export class ViewOnlyError extends Error {
  constructor() {
    super("This account is set to view-only — it can look at everything, but can't save any changes.");
    this.name = "ViewOnlyError";
  }
}

// Throws synchronously — safe to call from either a plain sync function
// (createTicketOffline, etc.) or the top of an async one; either way it
// propagates to the caller's existing try/catch exactly like any other
// validation error already does (e.g. "Please enter the truck's gross
// weight"), so no calling code needs special-case handling for it.
export function assertNotViewOnly() {
  if (active) throw new ViewOnlyError();
}
