import { useEffect, useState } from "react";
import { Check, X, Eye } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { supabase } from "../supabaseClient.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting.
function cambodiaDateStr(d = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function DiffRow({ label, current, proposed }) {
  const changed = String(current ?? "") !== String(proposed ?? "");
  return (
    <div className={`grid grid-cols-3 gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0 ${changed ? "bg-amber-50/60" : ""}`}>
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-600">{current ?? "—"}</span>
      <span className={changed ? "font-semibold text-amber-700" : "text-slate-600"}>{proposed ?? "—"}</span>
    </div>
  );
}

function ReviewRequestModal({ req, userEmail, t, onClose, onApprove, onReject }) {
  const tx = req.transactions || {};
  const p = req.proposed_data;
  const isBuy = tx.type === "BUY";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const currentAmount = tx.amount;
  const proposedAmount = p
    ? Math.max(0, Math.max(0, (p.quantityKg || 0) - (p.deductionKg || 0)) * (p.pricePerKg || 0) - (isBuy ? (p.staffFee || 0) : 0))
    : null;

  async function approve() {
    setError("");
    setSaving(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: userEmail, password });
    if (authError) {
      // Show Supabase's real reason instead of always assuming a typo —
      // a hardcoded "incorrect" message here hides anything else that
      // could be going wrong (rate limiting, network, etc).
      setError(authError.message || "Incorrect password.");
      setSaving(false);
      return;
    }
    await onApprove(req);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><Eye size={16} className="text-brand-600" /> Review Change Request</h3>
        <p className="mb-3 text-xs text-slate-400">{req.transactionCode} · Requested by {req.requestedByName} · {new Date(req.created_at).toLocaleString()}</p>

        <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <span className="font-medium text-slate-500">Reason: </span>{req.reason}
        </div>

        {!p ? (
          <p className="rounded-lg border border-slate-200 p-3 text-sm text-slate-500">
            This is an older-style request with no structured proposal attached — just the reason above. Approving it here only marks it approved; make any correction yourself via Edit Transaction.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="grid grid-cols-3 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
              <span>Field</span><span>Current</span><span>Requested</span>
            </div>
            <DiffRow label={isBuy ? "Seller" : "Buyer"} current={req.currentPartyName} proposed={p.partyName} />
            <DiffRow label="Weight (kg)" current={fmt2(tx.quantity_kg)} proposed={fmt2(p.quantityKg)} />
            <DiffRow label="Price per kg" current={fmtRiel(tx.price_per_kg)} proposed={fmtRiel(p.pricePerKg)} />
            {isBuy && <DiffRow label="Quality Grade" current={tx.quality_grade || "—"} proposed={p.qualityGrade || "—"} />}
            <DiffRow label="Payment Status" current={tx.payment_status} proposed={p.paymentStatus} />
            <DiffRow label="VAT" current={tx.tax_applicable ? `${tx.tax_rate}%` : "No"} proposed={p.taxApplicable ? `${p.taxRate}%` : "No"} />
            <DiffRow label="Deduction (kg)" current={fmt2(tx.deduction_kg)} proposed={fmt2(p.deductionKg)} />
            {isBuy && <DiffRow label="Staff / Carrying Fee" current={fmtRiel(tx.staff_fee || 0)} proposed={fmtRiel(p.staffFee || 0)} />}
            <DiffRow label="Moisture / Mixture / Outthrow %" current={`${tx.moisture_pct || 0} / ${tx.mixture_pct || 0} / ${tx.outthrow_pct || 0}`} proposed={`${p.moisturePct || 0} / ${p.mixturePct || 0} / ${p.outthrowPct || 0}`} />
            <DiffRow label="Car Plate" current={tx.car_plate || "—"} proposed={p.carPlate || "—"} />
            <DiffRow label="Truck / Driver Name" current={tx.driver_name || "—"} proposed={p.driverName || "—"} />
            <DiffRow label="Note" current={tx.note || "—"} proposed={p.note || "—"} />
            <DiffRow label="Total Amount" current={fmtRiel(currentAmount)} proposed={fmtRiel(proposedAmount)} />
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => onReject(req)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"><X size={14} /> {t("reject")}</button>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("cancel")}</button>
        </div>

        {p && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <label className="mb-1 block text-xs text-slate-500">Enter your own login password to approve &amp; apply these changes to the transaction</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" name="approve-own-password-not-autofillable"
              className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            {error && <p className="mb-2 text-xs text-rose-500">{error}</p>}
            <button disabled={saving || !password} onClick={approve} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              <Check size={16} /> {saving ? "Applying..." : "Approve & Apply to Transaction"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChangeRequests() {
  const { t } = useLanguage();
  const { session } = useAuth();
  const [rows, setRows] = useState([]);
  const [reviewReq, setReviewReq] = useState(null);

  async function load() { setRows(await api.getChangeRequests()); }
  useEffect(() => { load(); }, []);

  async function approveAndApply(req) {
    const tx = req.transactions;
    const p = req.proposed_data;
    const oldData = { ...tx };
    const updated = await api.updateTransaction(tx.id, {
      quantityKg: p.quantityKg,
      pricePerKg: p.pricePerKg,
      paymentStatus: p.paymentStatus,
      qualityGrade: p.qualityGrade,
      taxApplicable: p.taxApplicable,
      taxRate: p.taxRate,
      deductionKg: p.deductionKg,
      staffFee: p.staffFee,
      moisturePct: p.moisturePct,
      mixturePct: p.mixturePct,
      outthrowPct: p.outthrowPct,
      note: p.note,
      carPlate: p.carPlate,
      driverName: p.driverName,
      partyId: p.partyId,
    });
    // Same reasoning as the direct Edit Transaction flow: approving a
    // request that sets Payment Status to "Paid" should also make sure
    // real money is on file for it, so Cash Flow and every payments-based
    // report actually reflect it instead of just this one label.
    if (updated.payment_status === "paid") {
      try {
        const payType = tx.type === "BUY" ? "pay_supplier" : "receive_customer";
        const existing = await api.getPaymentsForTransaction(tx.id);
        const alreadyPaid = existing.filter((pm) => pm.type === payType).reduce((s, pm) => s + Number(pm.amount), 0);
        const stillOwed = Math.max(0, Number(updated.total_with_tax ?? updated.amount) - alreadyPaid);
        if (stillOwed > 0.01) {
          const createdPayment = await api.createPayment({
            type: payType,
            transactionId: tx.id,
            locationId: updated.location_id,
            amount: stillOwed,
            method: "cash",
            payDate: cambodiaDateStr(),
            memo: "Marked paid via approved change request",
            userId: session.user.id,
          });
          await api.logAudit({
            action: "record_payment",
            tableName: "payments",
            recordId: createdPayment.id,
            newData: { amount: stillOwed, method: "cash", memo: "Marked paid via approved change request", code: req.transactionCode, partyName: req.currentPartyName, txType: tx.type },
            userId: session.user.id,
          });
        }
      } catch (payErr) {
        console.error("Auto-payment record failed", payErr);
      }
    }
    await api.logAudit({
      action: "approve_change_request",
      tableName: "transactions",
      recordId: tx.id,
      oldData: { ...oldData, code: req.transactionCode, partyName: req.currentPartyName },
      newData: { ...updated, code: req.transactionCode },
      userId: session.user.id,
    });
    await api.resolveChangeRequest(req.id, "approved");
    setReviewReq(null);
    load();
  }

  async function reject(req) {
    await api.resolveChangeRequest(req.id, "rejected");
    await api.logAudit({
      action: "reject_change_request",
      tableName: "change_requests",
      recordId: req.id,
      newData: { code: req.transactionCode, partyName: req.currentPartyName, reason: req.reason },
      userId: session.user.id,
    });
    setReviewReq(null);
    load();
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("requests_title")} subtitle={t("requests_subtitle")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">{t("col_id")}</th>
                <th className="px-3 py-3 font-medium">{t("requested_by")}</th>
                <th className="px-3 py-3 font-medium">{t("requested_on")}</th>
                <th className="px-3 py-3 font-medium">{t("reason")}</th>
                <th className="px-3 py-3 font-medium">Redo?</th>
                <th className="px-3 py-3 font-medium">{t("col_status")}</th>
                <th className="px-3 py-3 font-medium">{t("col_action")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 align-top hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{r.transactionCode}</td>
                  <td className="px-3 py-3 text-slate-600">{r.requestedByName}</td>
                  <td className="px-3 py-3 text-slate-500">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-3 max-w-xs text-slate-600">{r.reason}</td>
                  <td className="px-3 py-3 text-xs text-slate-400">{r.proposed_data ? "Yes" : "Reason only"}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${r.status === "pending" ? "bg-amber-50 text-amber-600" : r.status === "approved" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>{t(`status_${r.status}`)}</span>
                  </td>
                  <td className="px-3 py-3">
                    {r.status === "pending" ? (
                      <button onClick={() => setReviewReq(r)} className="flex items-center gap-1 rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700"><Eye size={12} /> Review</button>
                    ) : <span className="text-xs text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">{t("no_requests")}</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
      {reviewReq && (
        <ReviewRequestModal
          req={reviewReq}
          userEmail={session.user.email}
          t={t}
          onClose={() => setReviewReq(null)}
          onApprove={approveAndApply}
          onReject={reject}
        />
      )}
    </div>
  );
}
