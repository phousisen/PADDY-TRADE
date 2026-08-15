import { useEffect, useState } from "react";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

const ACTION_LABELS = {
  edit_transaction: "Edited a transaction",
  edit_payment: "Corrected a payment amount",
  cancel_transaction: "Cancelled a transaction",
};

function describeChange(log) {
  const before = log.old_data || {};
  const after = log.new_data || {};
  const parts = [];
  if (before.amount !== undefined && after.amount !== undefined && before.amount !== after.amount) {
    parts.push(`Amount: ${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}`);
  }
  if (before.price_per_kg !== undefined && after.price_per_kg !== undefined && before.price_per_kg !== after.price_per_kg) {
    parts.push(`Price/kg: ${fmtRiel(before.price_per_kg)} → ${fmtRiel(after.price_per_kg)}`);
  }
  if (before.payment_status !== undefined && after.payment_status !== undefined && before.payment_status !== after.payment_status) {
    parts.push(`Status: ${before.payment_status} → ${after.payment_status}`);
  }
  return parts.length ? parts.join(" · ") : "—";
}

export default function ReportAuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAuditLogs().then((data) => { setLogs(data); setLoading(false); });
  }, []);

  return (
    <div>
      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        Every correction made to a transaction or payment amount is recorded here — who made it, when, and what it was before.
      </div>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-3 font-medium">When</th>
              <th className="px-3 py-3 font-medium">Who</th>
              <th className="px-3 py-3 font-medium">Action</th>
              <th className="px-3 py-3 font-medium">What changed</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-5 py-3 text-slate-500">{new Date(l.created_at).toLocaleString()}</td>
                <td className="px-3 py-3 font-medium text-slate-700">{l.userName}</td>
                <td className="px-3 py-3 text-slate-600">{ACTION_LABELS[l.action] || l.action}</td>
                <td className="px-3 py-3 text-slate-700">{describeChange(l)}</td>
              </tr>
            ))}
            {logs.length === 0 && !loading && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">No corrections have been made yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
