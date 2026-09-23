// [2026-09-23] THE WORDS THE ACTIVITY LOG USES, in one place.
//
// These used to live inside ReportAuditLog.jsx. They moved here the day a
// ticket got its own History panel (Transactions.jsx → TicketHistory.jsx):
// two screens describing the same recorded action must not be free to
// describe it differently, or the same entry reads one way in the log and
// another way on the ticket, and people stop trusting both.
//
// Nothing here talks to the database or to React — it only turns a recorded
// audit row into a sentence.
import { dmyTime } from "./dateFormat.js";

export function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
// Every timestamp elsewhere in PaddyTrade is shown in Cambodia's own
// wall-clock time regardless of the viewing device's timezone (see e.g.
// cambodiaDateStr/cambodiaNow in the other pages) — this table was the one
// place still using the browser's default toLocaleString(), which shows a
// different time to anyone viewing from outside Cambodia's timezone.
export function fmtCambodiaDateTime(iso) {
  if (!iso) return "—";
  return dmyTime(iso);
}

// [2026-09-19] Every action the app writes has a label and a filter group
// (twelve of them used to show as raw names like "void_payment" and could
// only be found under "All activity"), and every label is in both languages
// (audit F29).
export const ACTION_META = {
  create_transaction: "transaction", edit_transaction: "transaction", cancel_transaction: "transaction",
  restore_transaction: "transaction", reopen_ticket: "transaction", restore_declined_ticket: "transaction",
  confirm_buyer_sale: "transaction",
  submit_change_request: "request", approve_change_request: "request", reject_change_request: "request",
  record_payment: "payment", edit_payment: "payment", void_payment: "payment", edit_expense: "payment",
  update_party_bank: "payment",
  change_role: "user", set_password: "user", list_emails: "user",
  add_partner: "capital", add_capital_entry: "capital", add_loan_entry: "capital",
  adjust_stock: "stock", request_stock_reset: "stock", approve_stock_reset: "stock", reverse_stock_adjustment: "stock",
  // [2026-09-21] The scale guard (scaleGuard.js): a station's scale going
  // below zero and back, and an Owner allowing one capture past the guard.
  scale_below_zero: "transaction", scale_back_to_zero: "transaction", scale_capture_override: "transaction",
  // [2026-09-21] Expense confirmation (expense_confirmation.sql).
  confirm_expense_day: "payment", send_back_expense_day: "payment",
  approve_expense_change: "payment", reject_expense_change: "payment",
  // [2026-09-23] An Owner/admin setting a negative shed level back to 0
  // (Dashboard.jsx), and renaming an expense category across every row that
  // carries it (api.renameExpenseCategory).
  force_stock_zero: "stock", rename_expense_category: "payment",
};

export const CATEGORIES = ["all", "payment", "transaction", "request", "stock", "user", "capital", "other"];

export function actionMeta(action, t) {
  const category = ACTION_META[action] || "other";
  const key = `al_act_${action}`;
  const label = ACTION_META[action] ? t(key) : action;
  return { label, category };
}

export function refLabel(log) {
  const before = log.old_data || {};
  const after = log.new_data || {};
  const code = after.code || before.code;
  const partyName = after.partyName || before.partyName;
  if (code && partyName) return `${code} · ${partyName}`;
  return code || partyName || "";
}

export function describeChange(log, t) {
  const before = log.old_data || {};
  const after = log.new_data || {};
  const action = log.action;
  const ref = refLabel(log);
  const parts = [];

  switch (action) {
    case "create_transaction":
      if (ref) parts.push(ref);
      if (after.amount !== undefined) parts.push(t("al_amount", { v: fmtRiel(after.amount) }));
      if (after.stationName) parts.push(t("al_location", { v: after.stationName }));
      if (after.paymentStatus) parts.push(t("al_status", { v: after.paymentStatus }));
      break;

    case "record_payment":
      if (ref) parts.push(ref);
      if (after.amount !== undefined) parts.push(t("al_amount", { v: fmtRiel(after.amount) }));
      if (after.method) parts.push(t("al_method", { v: after.method }));
      if (after.memo) parts.push(after.memo);
      break;

    case "edit_payment":
      if (ref) parts.push(ref);
      if (before.amount !== undefined && after.amount !== undefined) {
        parts.push(t("al_amount", { v: `${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}` }));
      }
      break;

    case "submit_change_request":
      if (ref) parts.push(ref);
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      break;

    case "approve_change_request":
    case "reject_change_request":
      if (ref) parts.push(ref);
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      if (action === "approve_change_request") {
        if (before.amount !== undefined && after.amount !== undefined && before.amount !== after.amount) {
          parts.push(t("al_amount", { v: `${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}` }));
        }
        if (before.price_per_kg !== undefined && after.price_per_kg !== undefined && before.price_per_kg !== after.price_per_kg) {
          parts.push(t("al_price", { v: `${fmtRiel(before.price_per_kg)} → ${fmtRiel(after.price_per_kg)}` }));
        }
      }
      break;

    case "scale_below_zero":
    case "scale_back_to_zero":
    case "scale_capture_override":
      if (after.weightKg !== undefined) parts.push(t("al_scale_weight", { v: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(after.weightKg) }));
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      break;

    case "confirm_expense_day":
    case "send_back_expense_day":
      if (after.stationName) parts.push(after.stationName);
      if (after.day) parts.push(after.day);
      if (after.total !== undefined) parts.push(t("al_amount", { v: fmtRiel(after.total) }));
      if (after.corrected) parts.push(t("xr_corrected"));
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      break;

    case "approve_expense_change":
    case "reject_expense_change":
      if (after.day) parts.push(after.day);
      if (after.category) parts.push(`${after.category}: ${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}`);
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      break;

    // [2026-09-23] Both of these are one line: what it was, what it is now.
    case "force_stock_zero":
      if (after.stationName) parts.push(after.stationName);
      if (after.kg !== undefined) parts.push(t("al_onhand", { v: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(after.kg) }));
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      break;

    case "rename_expense_category":
      if (before.category || after.category) parts.push(`${before.category || "—"} → ${after.category || "—"}`);
      if (after.rows !== undefined) parts.push(t("al_cat_rows", { n: after.rows }));
      break;

    case "cancel_transaction":
      if (ref) parts.push(ref);
      if (after.amount !== undefined) parts.push(t("al_amount", { v: fmtRiel(after.amount) }));
      break;

    case "change_role":
      if (after.fullName) parts.push(after.fullName);
      if (after.role) parts.push(t("al_new_role", { v: after.role }));
      break;

    case "add_partner":
      if (after.name) parts.push(t("al_partner", { v: after.name }));
      break;

    case "add_capital_entry":
      if (after.partnerName) parts.push(after.partnerName);
      if (after.amount !== undefined) parts.push(fmtRiel(after.amount));
      if (after.type) parts.push(after.type === "contribution" ? t("al_contribution") : t("al_withdrawal"));
      break;

    case "add_loan_entry":
      if (after.lenderName) parts.push(after.lenderName);
      if (after.amount !== undefined) parts.push(fmtRiel(after.amount));
      if (after.type) parts.push(after.type === "borrow" ? t("al_loan_drawn") : t("al_loan_repaid"));
      break;

    default:
      // Fallback for older or unrecognized log entries
      if (ref) parts.push(ref);
      if (before.amount !== undefined && after.amount !== undefined && before.amount !== after.amount) {
        parts.push(t("al_amount", { v: `${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}` }));
      }
      if (before.price_per_kg !== undefined && after.price_per_kg !== undefined && before.price_per_kg !== after.price_per_kg) {
        parts.push(t("al_price", { v: `${fmtRiel(before.price_per_kg)} → ${fmtRiel(after.price_per_kg)}` }));
      }
      if (before.payment_status !== undefined && after.payment_status !== undefined && before.payment_status !== after.payment_status) {
        parts.push(t("al_status", { v: `${before.payment_status} → ${after.payment_status}` }));
      }
  }

  return parts.length ? parts.join(" · ") : "—";
}

