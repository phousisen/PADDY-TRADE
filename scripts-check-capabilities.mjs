// Who can do what — asserted, not assumed.
//
// [2026-09-15] This guards the change that stopped the two HQ finance accounts
// reaching Users, Roles and Settings. The thing that would actually hurt is
// not a finance account seeing one screen too many — it is an upgrade that
// locks a station manager out of the weighbridge at 6am. So the first block
// below is entirely about accounts that must NOT change.
//
//   node scripts-check-capabilities.mjs

import { canWithProfile, CAP } from "./src/capabilities.js";
import { ALL_PERMISSION_KEYS } from "./src/permissions.js";

let failures = 0;
function ok(cond, msg, extra) {
  if (!cond) { failures++; console.log("  FAIL " + msg, extra === undefined ? "" : extra); }
}

// --- the accounts as they actually exist -----------------------------------
const OWNER = { role: "admin", isOwner: true, permissions: ALL_PERMISSION_KEYS };

// A seeded role from before this change, with nothing recorded against it.
const LEGACY_ADMIN = { role: "admin", isOwner: false, permissions: [] };
const LEGACY_STAFF = { role: "staff", isOwner: false, permissions: [] };

// A role row that exists but whose permissions column came back null.
const NULL_PERMS = { role: "admin", isOwner: false, permissions: null };

// The new role.
const HQ_FINANCE = {
  role: "admin", isOwner: false,
  permissions: [
    "view_dashboard", "view_reports", "view_audit_log", "manage_parties",
    "record_payments", "edit_payments", "create_transactions", "adjust_stock",
    "request_changes", "approve_change_requests", "edit_transactions",
  ],
};

const STATION_MANAGER = {
  role: "staff", isOwner: false,
  permissions: ["view_dashboard", "create_transactions", "record_payments", "request_changes", "manage_parties"],
};

console.log("Capabilities\n");

// ===========================================================================
// 1. Nothing that exists today may change
// ===========================================================================
for (const key of ALL_PERMISSION_KEYS) {
  ok(canWithProfile(OWNER, key) === true, `Owner lost ${key}`);
  ok(canWithProfile(LEGACY_ADMIN, key) === true, `a legacy admin with no permissions recorded lost ${key}`);
  ok(canWithProfile(LEGACY_STAFF, key) === false, `a legacy staff account gained ${key}`);
  ok(canWithProfile(NULL_PERMS, key) === true, `an admin whose permissions came back null lost ${key}`);
}
// The station manager keeps exactly what its role says, and nothing else.
for (const key of ALL_PERMISSION_KEYS) {
  const expect = STATION_MANAGER.permissions.includes(key);
  ok(canWithProfile(STATION_MANAGER, key) === expect,
     `station manager: ${key} should be ${expect}`);
}
console.log("  1. no existing account changes · Owner, legacy admin, legacy staff, null permissions, station manager");

// ===========================================================================
// 2. The HQ Finance role is narrowed where it should be, and only there
// ===========================================================================
const MUST_HAVE = [CAP.approveChangeRequests, CAP.editTransactions, "view_reports", "view_audit_log", "record_payments"];
const MUST_NOT = [CAP.manageUsers, CAP.manageRoles, CAP.manageSettings, CAP.manageLocations,
                  CAP.editWeights, CAP.cancelTransactions, "manage_admins"];
for (const k of MUST_HAVE) ok(canWithProfile(HQ_FINANCE, k) === true, `HQ Finance is missing ${k}`);
for (const k of MUST_NOT) ok(canWithProfile(HQ_FINANCE, k) === false, `HQ Finance can still ${k}`);
console.log(`  2. HQ Finance · has ${MUST_HAVE.length} it needs, blocked on ${MUST_NOT.length} it must not have`);

// ===========================================================================
// 3. The edges
// ===========================================================================
ok(canWithProfile(null, CAP.manageUsers) === false, "a missing profile was granted manage_users");
ok(canWithProfile(undefined, CAP.manageUsers) === false, "an undefined profile was granted manage_users");
ok(canWithProfile({ role: "admin", permissions: [] }, CAP.manageUsers) === true,
   "a legacy admin with no isOwner field lost manage_users");
ok(canWithProfile({ role: "staff", permissions: undefined }, CAP.manageUsers) === false,
   "a staff account with undefined permissions was granted manage_users");
// An unknown key is not a wildcard.
ok(canWithProfile(HQ_FINANCE, "not_a_real_permission") === false, "an unknown permission key returned true");
// ...but a legacy admin still gets it, because legacy admins are unrestricted.
ok(canWithProfile(LEGACY_ADMIN, "not_a_real_permission") === true,
   "a legacy admin stopped being unrestricted");
console.log("  3. edges · no profile, no isOwner, undefined permissions, unknown key");

// ===========================================================================
// 4. Every key the app gates on is a real key
// ===========================================================================
for (const [name, key] of Object.entries(CAP)) {
  ok(ALL_PERMISSION_KEYS.includes(key), `CAP.${name} is "${key}", which is not in the permission catalog`);
}
ok(ALL_PERMISSION_KEYS.includes("edit_weights"), "edit_weights is missing from the catalog");
ok(new Set(ALL_PERMISSION_KEYS).size === ALL_PERMISSION_KEYS.length, "the permission catalog has a duplicate key");
console.log(`  4. every gated key exists · ${ALL_PERMISSION_KEYS.length} permissions, no duplicates`);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
