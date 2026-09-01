import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
// Every timestamp elsewhere in PaddyTrade is shown in Cambodia's own
// wall-clock time regardless of the viewing device's timezone (see e.g.
// cambodiaDateStr/cambodiaNow in the other pages) — this table was the one
// place still using the browser's default toLocaleString(), which shows a
// different time to anyone viewing from outside Cambodia's timezone.
function fmtCambodiaDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return `${date}, ${time}`;
}

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
  const [loadError, setLoadError] = useState("");
  const [category, setCategory] = useState("all");

  function load() {
    setLoading(true);
    setLoadError("");
    api.getAuditLogs()
      .then((data) => setLogs(data))
      .catch((err) => {
        // Without this, a failed/dropped request left this page stuck
        // showing nothing, with no error and no way to retry.
        setLoadError(err.message || "Couldn't load the activity log — check your connection and try again.");
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const categories = ["all", "payment", "transaction", "request", "user", "capital"];

  const filteredLogs = useMemo(() => {
    if (category === "all") return logs;
    return logs.filter((l) => actionMeta(l.action).category === category);
  }, [logs, category]);

  return (
    <div>
      <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
        Every action taken in the system — new transactions, payments recorded, edits, approvals, and cancellations — is logged here with who did it and when, so you can trace back any mistake, especially around payments.
      </div>

      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-lg border px-3 py-1.5 text-[13.5px] ${
              category === c
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <TableCard>
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((l) => {
              const meta = actionMeta(l.action);
              return (
                <Tr key={l.id}>
                  <Td className="whitespace-nowrap">{fmtCambodiaDateTime(l.created_at)}</Td>
                  <Td name className="whitespace-nowrap">{l.userName}</Td>
                  <Td className="whitespace-nowrap">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        meta.category === "payment" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {meta.label}
                    </span>
                  </Td>
                  <Td>{describeChange(l)}</Td>
                </Tr>
              );
            })}
            {loading && filteredLogs.length === 0 && (
              <Tr><td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>
            )}
            {filteredLogs.length === 0 && !loading && !loadError && (
              <Tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">
                  No activity recorded yet{category !== "all" ? ` for ${CATEGORY_LABELS[category].toLowerCase()}` : ""}.
                </td>
              </Tr>
            )}
          </tbody>
        </Table>
      </TableCard>
    </div>
  );
}
