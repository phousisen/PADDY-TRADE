import { useEffect, useMemo, useState } from "react";
import { Check, X, Eye } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { supabase, getAccurateNow } from "../supabaseClient.js";

// [2026-09-01] "Ticket Queue" design (Option B) — status carried by a
// colored left edge on each row/card instead of a filled pill background,
// used on the list rows, the status label itself, and the Review modal's
// own left edge (see LEFT_BORDER below) so the popup doesn't feel like a
// different app from the row that opened it.
const LEFT_BORDER = { pending: "border-l-amber-500", approved: "border-l-brand-600", rejected: "border-l-rose-500" };
const STATUS_TEXT = { pending: "text-amber-700", approved: "text-brand-700", rejected: "text-rose-600" };
const STATUS_DOT = { pending: "bg-amber-500", approved: "bg-brand-600", rejected: "bg-rose-500" };

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting.
function cambodiaDateStr(d = getAccurateNow()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// Every timestamp elsewhere in PaddyTrade is shown in Cambodia's own
// wall-clock time regardless of the viewing device's own timezone — this
// page was still using the browser's default toLocaleString()/
// toLocaleDateString(), which shows a different time to anyone viewing
// from outside Cambodia's timezone.
function fmtCambodiaDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return `${date}, ${time}`;
}
function fmtCambodiaDate(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

// [2026-09-01] Powers the redesigned list's "What They're Trying to
// Change" column — a compact, at-a-glance summary of ONLY the fields that
// actually differ, computed the exact same way ReviewRequestModal's own
// DiffRow table already does (same field list, same proposedAmount
// formula), just condensed to a few lines instead of a full table. Kept as
// its own separate function rather than refactoring the modal to share it,
// so a change here can never affect the modal's already-working approve/
// reject logic. Returns null for an older-style, reason-only request (no
// proposed_data at all) so the caller can render the reason text instead.
function summarizeChanges(req) {
  const tx = req.transactions || {};
  const p = req.proposed_data;
  if (!p) return null;
  const isBuy = tx.type === "BUY";
  const fields = [
    { label: isBuy ? "Seller" : "Buyer", cur: req.currentPartyName, next: p.partyName },
    { label: "Weight (kg)", cur: fmt2(tx.quantity_kg), next: fmt2(p.quantityKg) },
    { label: "Price/kg", cur: fmtRiel(tx.price_per_kg), next: fmtRiel(p.pricePerKg) },
    ...(isBuy ? [{ label: "Quality Grade", cur: tx.quality_grade || "—", next: p.qualityGrade || "—" }] : []),
    { label: "Payment Status", cur: tx.payment_status, next: p.paymentStatus },
    { label: "VAT", cur: tx.tax_applicable ? `${tx.tax_rate}%` : "No", next: p.taxApplicable ? `${p.taxRate}%` : "No" },
    { label: "Deduction (kg)", cur: fmt2(tx.deduction_kg), next: fmt2(p.deductionKg) },
    ...(isBuy ? [{ label: "Staff/Carrying Fee", cur: fmtRiel(tx.staff_fee || 0), next: fmtRiel(p.staffFee || 0) }] : []),
    { label: "Moisture/Mixture/Outthrow %", cur: `${tx.moisture_pct || 0}/${tx.mixture_pct || 0}/${tx.outthrow_pct || 0}`, next: `${p.moisturePct || 0}/${p.mixturePct || 0}/${p.outthrowPct || 0}` },
    { label: "Car Plate", cur: tx.car_plate || "—", next: p.carPlate || "—" },
    { label: "Truck/Driver Name", cur: tx.driver_name || "—", next: p.driverName || "—" },
    { label: "Note", cur: tx.note || "—", next: p.note || "—" },
  ];
  const changed = fields.filter((f) => String(f.cur ?? "") !== String(f.next ?? ""));
  // Same total-amount formula as ReviewRequestModal's own proposedAmount —
  // surfaced here too since a price/weight/deduction/fee change often
  // matters most as "how much does the total move," not just the raw
  // field-by-field values.
  const currentAmount = tx.amount;
  const proposedAmount = Math.max(0, Math.max(0, (p.quantityKg || 0) - (p.deductionKg || 0)) * (p.pricePerKg || 0) - (isBuy ? (p.staffFee || 0) : 0));
  if (Math.round(currentAmount) !== Math.round(proposedAmount)) {
    changed.push({ label: "Total", cur: fmtRiel(currentAmount), next: fmtRiel(proposedAmount) });
  }
  return changed;
}

function StatusPill({ status, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold ${STATUS_TEXT[status] || "text-slate-500"}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status] || "bg-slate-400"}`} />
      {label}
    </span>
  );
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
  const [rejecting, setRejecting] = useState(false);

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
    try {
      await onApprove(req);
    } catch (err) {
      // Without this, a dropped connection left the button saying
      // "Applying..." forever with no error and no way to tell whether it
      // actually went through — the request would just sit unresolved.
      setError(err.message || "Couldn't apply these changes — check your connection and try again.");
      setSaving(false);
    }
  }

  async function handleReject() {
    setError("");
    setRejecting(true);
    try {
      await onReject(req);
    } catch (err) {
      setError(err.message || "Couldn't reject this request — check your connection and try again.");
      setRejecting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border-l-[3px] bg-white p-5 shadow-xl ${LEFT_BORDER[req.status] || "border-l-slate-300"}`}>
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><Eye size={16} className="text-brand-600" /> Review Change Request</h3>
        <p className="mb-3 text-xs text-slate-400">
          {req.transactions?.paper_ticket_no || req.transactionCode}
          {req.transactions?.paper_ticket_no && <span className="text-slate-300"> ({req.transactionCode})</span>}
          {" "}· Requested by {req.requestedByName} · {fmtCambodiaDateTime(req.created_at)}
        </p>

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

        {error && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={handleReject} disabled={saving || rejecting} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40"><X size={14} /> {rejecting ? "Rejecting…" : t("reject")}</button>
          <button onClick={onClose} disabled={saving || rejecting} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40">{t("cancel")}</button>
        </div>

        {p && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <label className="mb-1 block text-xs text-slate-500">Enter your own login password to approve &amp; apply these changes to the transaction</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" name="approve-own-password-not-autofillable"
              className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            <button disabled={saving || rejecting || !password} onClick={approve} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
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

  // Same "this month" basis Stock Loss and every other summary strip in
  // the app uses — grouped by the request's own date (created_at), since
  // change_requests doesn't keep a separate resolved-on timestamp.
  const thisMonthStr = cambodiaDateStr().slice(0, 7);
  const counts = useMemo(() => {
    const pending = rows.filter((r) => r.status === "pending").length;
    const approved = rows.filter((r) => r.status === "approved" && cambodiaDateStr(new Date(r.created_at)).startsWith(thisMonthStr)).length;
    const rejected = rows.filter((r) => r.status === "rejected" && cambodiaDateStr(new Date(r.created_at)).startsWith(thisMonthStr)).length;
    return { pending, approved, rejected };
  }, [rows, thisMonthStr]);

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
      // Deliberately NOT caught here — swallowing this used to let the
      // approval "succeed" (the transaction now says Paid) while the
      // actual payment record silently failed to save, leaving Cash Flow
      // and Accounts Payable/Receivable quietly wrong with no sign
      // anything was off. Letting it throw surfaces the error in the
      // review modal instead, same as any other save failure.
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
      <main className="flex-1 overflow-y-auto bg-paper p-6">
        <div className="mb-5 flex flex-wrap items-baseline gap-x-5 gap-y-1 px-0.5 text-[13px] text-slate-400">
          <span><b className={`font-semibold tabular-nums ${counts.pending > 0 ? "text-amber-700" : "text-slate-900"}`}>{counts.pending}</b> pending</span>
          <span className="text-slate-300">·</span>
          <span><b className="font-semibold tabular-nums text-slate-900">{counts.approved}</b> approved this month</span>
          <span className="text-slate-300">·</span>
          <span><b className="font-semibold tabular-nums text-slate-900">{counts.rejected}</b> rejected this month</span>
        </div>

        {rows.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-400">{t("no_requests")}</div>
        )}

        {rows.map((r) => {
          const tx = r.transactions || {};
          const ticketNo = tx.paper_ticket_no;
          const changes = summarizeChanges(r);
          const extra = changes && changes.length > 1 ? changes.length - 1 : 0;
          return (
            <div key={r.id} className={`mb-2.5 flex items-center gap-4 rounded-lg border border-slate-200 border-l-[3px] bg-white px-4 py-3.5 hover:shadow-sm ${LEFT_BORDER[r.status] || "border-l-slate-300"}`}>
              <div className="w-20 shrink-0">
                <div className={`text-[15px] font-bold tabular-nums leading-tight ${ticketNo ? "text-slate-900" : "text-[12px] font-semibold text-slate-400"}`}>{ticketNo || "no ticket #"}</div>
                {tx.type && <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{tx.type}</div>}
              </div>
              <div className="min-w-0 flex-1">
                {changes === null ? (
                  <p className="truncate text-[13.5px] italic text-slate-600">{r.reason}</p>
                ) : changes.length === 0 ? (
                  <p className="text-[13.5px] text-slate-400">No field differences on file</p>
                ) : (
                  <p className="truncate text-[13.5px] text-slate-900">
                    <span className="font-medium text-slate-500">{changes[0].label}:</span>{" "}
                    {changes[0].cur} <span className="mx-1 text-slate-300">→</span> <span className="font-semibold">{changes[0].next}</span>
                    {extra > 0 && <span className="ml-1.5 text-[12px] font-normal text-slate-400">+{extra} more field{extra === 1 ? "" : "s"}</span>}
                  </p>
                )}
                <p className="mt-0.5 truncate text-[12px] text-slate-400">{r.requestedByName} · {fmtCambodiaDate(r.created_at)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <StatusPill status={r.status} label={t(`status_${r.status}`)} />
                {r.status === "pending" ? (
                  <button onClick={() => setReviewReq(r)} className="flex items-center gap-1 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"><Eye size={12} /> Review</button>
                ) : <span className="px-1 text-xs text-slate-300">—</span>}
              </div>
            </div>
          );
        })}
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
