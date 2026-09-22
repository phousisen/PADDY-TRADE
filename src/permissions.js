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
      // [2026-09-15] Split in two. "edit_transactions" is now the INFO fields
      // — party, plate, driver, product, paper ticket number, note, quality.
      // Those are wrong often and cost nothing to fix. The weighbridge
      // figures and the price are what decide what a farmer is paid, so they
      // get their own permission, and a role without it has to raise a
      // Change Request with a reason instead.
      { key: "edit_transactions", label: "Edit a saved transaction's details (party, plate, note…)" },
      { key: "edit_weights", label: "Change a recorded weight or price directly" },
      { key: "cancel_transactions", label: "Cancel a transaction" },
    ],
  },
  {
    label: "Payments",
    permissions: [
      { key: "record_payments", label: "Record payments to/from parties" },
      { key: "edit_payments", label: "Correct a mistaken payment amount" },
      // [2026-09-16] Expenses arrive as a daily sheet from each station and
      // are typed in at HQ, so recording and correcting them is a different
      // job from paying a farmer — and a mistyped expense is corrected far
      // more often than a payment is.
      { key: "record_expenses", label: "Record daily expenses" },
      { key: "edit_expenses", label: "Correct a recorded expense" },
      // [2026-09-21] The second person. SISEN: "i want to let the manager go
      // through it and confirm the expenses ... so we know that the expenses
      // is there because 2 people has agreed". Give this to the finance
      // MANAGER's role only — never to the role of the person who types the
      // expenses in. See expense_confirmation.sql.
      { key: "confirm_expenses", label: "Confirm expenses & decide expense change requests (manager)" },
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
      { key: "adjust_stock", label: "Record a daily stock adjustment (moisture/spillage loss)" },
      // [2026-09-17] For a station that has counted its shed and needs the
      // book changed to match. This does NOT move stock — it files a request
      // HQ has to approve. A role with `adjust_stock` never needs it; that
      // role can already set the figure directly.
      { key: "request_stock_reset", label: "Ask HQ to correct this station's stock" },
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
