import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

const ACTION_META = {
  create_transaction: { label: "Created a transaction", category: "transaction" },
  edit_transaction: { label: "Edited a transaction", category: "transaction" },
  cancel_transaction: { label: "Cancelled a transaction", category: "transaction" },
  submit_change_request: { label: "Submitted a change request", category: "request" },
  approve_change_request: { label: "Approved a change request", category: "request" },
  reject_change_request: { label: "Rejected a change request", category: "request" },
  record_payment: { label: "Recorded a payment", category: "payment" },
  edit_payment: { label: "Corrected a payment amount", category: "payment" },
  change_role: { label: "Changed a user's role", category: "user" },
  add_partner: { label: "Added a partner", category: "capital" },
  add_capital_entry: { label: "Recorded a capital entry", category: "capital" },
  add_loan_entry: { label: "Recorded a bank loan entry", category: "capital" },
};

const CATEGORY_LABELS = {
  all: "All activity",
  payment: "Payments",
  transaction: "Transactions",
  request: "Change Requests",
  user: "Users",
  capital: "Capital & Loans",
};

function actionMeta(action) {
  return ACTION_META[action] || { label: action, category: "other" };
}

function refLabel(log) {
  const before = log.old_data || {};
  const after = log.new_data || {};
  const code = after.code || before.code;
  const partyName = after.partyName || before.partyName;
  if (code && partyName) return `${code} · ${partyName}`;
  return code || partyName || "";
}

function describeChange(log) {
  const before = log.old_data || {};
  const after = log.new_data || {};
  const action = log.action;
  const ref = refLabel(log);
  const parts = [];

  switch (action) {
    case "create_transaction":
      if (ref) parts.push(ref);
      if (after.amount !== undefined) parts.push(`Amount: ${fmtRiel(after.amount)}`);
      if (after.stationName) parts.push(`Location: ${after.stationName}`);
      if (after.paymentStatus) parts.push(`Status: ${after.paymentStatus}`);
      break;

    case "record_payment":
      if (ref) parts.push(ref);
      if (after.amount !== undefined) parts.push(`Amount: ${fmtRiel(after.amount)}`);
      if (after.method) parts.push(`Method: ${after.method}`);
      if (after.memo) parts.push(after.memo);
      break;

    case "edit_payment":
      if (ref) parts.push(ref);
      if (before.amount !== undefined && after.amount !== undefined) {
        parts.push(`Amount: ${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}`);
      }
      break;

    case "submit_change_request":
      if (ref) parts.push(ref);
      if (after.reason) parts.push(`Reason: ${after.reason}`);
      break;

    case "approve_change_request":
    case "reject_change_request":
      if (ref) parts.push(ref);
      if (after.reason) parts.push(`Reason: ${after.reason}`);
      if (action === "approve_change_request") {
        if (before.amount !== undefined && after.amount !== undefined && before.amount !== after.amount) {
          parts.push(`Amount: ${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}`);
        }
        if (before.price_per_kg !== undefined && after.price_per_kg !== undefined && before.price_per_kg !== after.price_per_kg) {
          parts.push(`Price/kg: ${fmtRiel(before.price_per_kg)} → ${fmtRiel(after.price_per_kg)}`);
        }
      }
      break;

    case "cancel_transaction":
      if (ref) parts.push(ref);
      if (after.amount !== undefined) parts.push(`Amount: ${fmtRiel(after.amount)}`);
      break;

    case "change_role":
      if (after.fullName) parts.push(after.fullName);
      if (after.role) parts.push(`New role: ${after.role}`);
      break;

    case "add_partner":
      if (after.name) parts.push(`Partner: ${after.name}`);
      break;

    case "add_capital_entry":
      if (after.partnerName) parts.push(after.partnerName);
      if (after.amount !== undefined) parts.push(fmtRiel(after.amount));
      if (after.type) parts.push(after.type === "contribution" ? "Contribution" : "Withdrawal");
      break;

    case "add_loan_entry":
      if (after.lenderName) parts.push(after.lenderName);
      if (after.amount !== undefined) parts.push(fmtRiel(after.amount));
      if (after.type) parts.push(after.type === "borrow" ? "Loan drawn" : "Loan repaid");
      break;

    default:
      // Fallback for older or unrecognized log entries
      if (ref) parts.push(ref);
      if (before.amount !== undefined && after.amount !== undefined && before.amount !== after.amount) {
        parts.push(`Amount: ${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}`);
      }
      if (before.price_per_kg !== undefined && after.price_per_kg !== undefined && before.price_per_kg !== after.price_per_kg) {
        parts.push(`Price/kg: ${fmtRiel(before.price_per_kg)} → ${fmtRiel(after.price_per_kg)}`);
      }
      if (before.payment_status !== undefined && after.payment_status !== undefined && before.payment_status !== after.payment_status) {
        parts.push(`Status: ${before.payment_status} → ${after.payment_status}`);
      }
  }

  return parts.length ? parts.join(" · ") : "—";
}

export default function ReportAuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");

  useEffect(() => {
    api.getAuditLogs().then((data) => { setLogs(data); setLoading(false); });
  }, []);

  const categories = ["all", "payment", "transaction", "request", "user", "capital"];

  const filteredLogs = useMemo(() => {
    if (category === "all") return logs;
    return logs.filter((l) => actionMeta(l.action).category === category);
  }, [logs, category]);

  return (
    <div>
      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        Every action taken in the system — new transactions, payments recorded, edits, approvals, and cancellations — is logged here with who did it and when, so you can trace back any mistake, especially around payments.
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              category === c
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-3 font-medium">When</th>
              <th className="px-3 py-3 font-medium">Who</th>
              <th className="px-3 py-3 font-medium">Action</th>
              <th className="px-3 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((l) => {
              const meta = actionMeta(l.action);
              return (
                <tr key={l.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="px-3 py-3 font-medium text-slate-700 whitespace-nowrap">{l.userName}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        meta.category === "payment" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-700">{describeChange(l)}</td>
                </tr>
              );
            })}
            {filteredLogs.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">
                  No activity recorded yet{category !== "all" ? ` for ${CATEGORY_LABELS[category].toLowerCase()}` : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
