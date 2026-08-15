// The fixed catalog of things a role can be granted. People can create
// as many custom roles as they want and name them anything — but the
// permission keys themselves map to real capabilities in the app, so
// the list of possible permissions stays fixed.
export const PERMISSION_GROUPS = [
  {
    label: "Transactions",
    permissions: [
      { key: "view_dashboard", label: "View dashboard & stock" },
      { key: "create_transactions", label: "Record new buy/sell transactions" },
      { key: "edit_transactions", label: "Edit a saved transaction's price/quantity" },
      { key: "cancel_transactions", label: "Cancel a transaction" },
    ],
  },
  {
    label: "Payments",
    permissions: [
      { key: "record_payments", label: "Record payments to/from parties" },
      { key: "edit_payments", label: "Correct a mistaken payment amount" },
    ],
  },
  {
    label: "Reports & Data",
    permissions: [
      { key: "view_reports", label: "View Financial Reports" },
      { key: "view_audit_log", label: "View the audit log" },
      { key: "manage_parties", label: "View & edit farmers/buyers" },
    ],
  },
  {
    label: "Locations",
    permissions: [
      { key: "manage_locations", label: "Rename locations, view location details" },
    ],
  },
  {
    label: "Administration",
    permissions: [
      { key: "request_changes", label: "Submit a change request to HQ" },
      { key: "approve_change_requests", label: "Approve/reject change requests" },
      { key: "manage_users", label: "Assign roles & locations to users" },
      { key: "manage_roles", label: "Create & edit custom roles" },
      { key: "manage_settings", label: "Change company-wide settings" },
      { key: "manage_admins", label: "Manage Owner/HQ Admin-level accounts (Owner only)" },
    ],
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

export function permissionLabel(key) {
  for (const g of PERMISSION_GROUPS) {
    const p = g.permissions.find((p) => p.key === key);
    if (p) return p.label;
  }
  return key;
}
