// Who is allowed to do what.
//
// [2026-09-15] Pulled out of AuthContext.jsx so it can be tested without a
// browser — see scripts-check-capabilities.mjs. This file decides whether an
// HQ account can reach Users, Roles and Settings, and whether it can move a
// weight. That is worth an assertion, not a hope.
//
// ── The problem this replaces ─────────────────────────────────────────────
//
// Almost every gate in the app read `profile.role === "admin"`. That column is
// written as "admin" for ANY all-locations role (UsersPage.jsx sets it from
// the role's scope), so there was no way to express "all five stations, but
// not the keys to the building". A finance account got the whole System menu.
//
// The 16 permission keys to express it already existed in permissions.js and
// were checked in exactly three places. This wires up the rest.
//
// ── The rule that makes this safe to ship ─────────────────────────────────
//
// A role with NO permissions recorded against it behaves exactly as it did
// before. Only a role with boxes explicitly ticked is narrowed. Every account
// that predates this change is therefore untouched until somebody edits its
// role on purpose — no station manager can be locked out by the upgrade
// itself, which is the failure mode that would matter at 6am at a weighbridge.

/**
 * @param {object|null} profile  the profile as AuthContext builds it
 * @param {string} key           one of ALL_PERMISSION_KEYS
 */
export function canWithProfile(profile, key) {
  if (!profile) return false;

  // Owner is never gated. `isOwner` is itself the manage_admins permission,
  // so an Owner role always has permissions recorded and never falls through
  // to the legacy branch below.
  if (profile.isOwner) return true;

  const perms = Array.isArray(profile.permissions) ? profile.permissions : [];

  // Nothing recorded → the old behaviour, exactly: admins could do everything,
  // everyone else could not. Note this is deliberately NOT "return true" —
  // a station account with no role row must not become an administrator.
  if (perms.length === 0) return profile.role === "admin";

  return perms.includes(key);
}

// The capabilities the app asks about by name, so a typo in a gate is a
// missing export rather than a silently-false permission check.
export const CAP = {
  approveChangeRequests: "approve_change_requests",
  manageLocations: "manage_locations",
  manageUsers: "manage_users",
  manageRoles: "manage_roles",
  manageSettings: "manage_settings",
  editTransactions: "edit_transactions",
  editWeights: "edit_weights",
  cancelTransactions: "cancel_transactions",
};
