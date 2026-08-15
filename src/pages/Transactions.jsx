import { useEffect, useMemo, useState } from "react";
import { Download, Plus, CheckCircle2, AlertTriangle, Filter, MapPin, Lock, Flag, Wallet, Pencil } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { supabase } from "../supabaseClient.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

function RequestChangeModal({ tx, t, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><Flag size={16} className="text-amber-500" /> {t("request_change")}</h3>
        <p className="mb-3 text-xs text-slate-400">{tx.code} · {fmt2(tx.quantity_kg)} kg · {fmtRiel(tx.amount)}</p>
        <label className="mb-1 block text-xs text-slate-500">{t("reason_label")}</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reason_placeholder")} rows={3}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("cancel")}</button>
          <button disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">{t("submit_request")}</button>
        </div>
      </div>
    </div>
  );
}

function RecordPaymentModal({ tx, remaining, t, onClose, onSubmit }) {
  const [amount, setAmount] = useState(String(remaining));
  const [method, setMethod] = useState("cash");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const isBuy = tx.type === "BUY";

  const paying = parseFloat(amount) || 0;
  const newRemaining = Math.max(0, remaining - paying);
  const overpaying = paying > remaining;

  async function submit() {
    setSaving(true);
    await onSubmit(parseFloat(amount), method, memo);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700">
          <Wallet size={16} className="text-brand-600" /> {isBuy ? "Pay Supplier" : "Receive Payment"}
        </h3>
        <p className="mb-3 text-xs text-slate-400">{tx.code} · {tx.partyName}</p>

        <label className="mb-1 block text-xs text-slate-500">Amount (៛)</label>
        <input type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

        <div className="mb-3 space-y-1 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Currently owed</span><span className="font-medium text-slate-700">{fmtRiel(remaining)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Paying now</span><span className="font-medium text-slate-700">− {fmtRiel(paying)}</span></div>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5">
            <span className="font-medium text-slate-600">New remaining balance</span>
            <span className={`font-bold ${newRemaining === 0 ? "text-emerald-600" : "text-slate-800"}`}>{fmtRiel(newRemaining)}</span>
          </div>
        </div>
        {overpaying && <p className="mb-3 text-xs text-amber-600">This is more than what is owed — the balance will just be marked fully settled.</p>}

        <label className="mb-1 block text-xs text-slate-500">Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
          <option value="cash">Cash</option>
          <option value="check">Check</option>
          <option value="bank">Bank Transfer</option>
        </select>

        <label className="mb-1 block text-xs text-slate-500">Note (optional)</label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. partial payment"
          className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("cancel")}</button>
          <button
            disabled={saving || !amount || parseFloat(amount) <= 0}
            onClick={submit}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {saving ? "Saving..." : "Record Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditTransactionModal({ tx, userEmail, userId, t, onClose, onSubmit }) {
  const [pricePerKg, setPricePerKg] = useState(String(tx.price_per_kg));
  const [paymentStatus, setPaymentStatus] = useState(tx.payment_status || "pending");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isBuy = tx.type === "BUY";

  const newAmount = Number(tx.quantity_kg) * (parseFloat(pricePerKg) || 0);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: userEmail, password });
    if (authError) {
      setError("Incorrect password.");
      setSaving(false);
      return;
    }
    await onSubmit({
      quantityKg: Number(tx.quantity_kg),
      pricePerKg: parseFloat(pricePerKg),
      paymentStatus,
      qualityGrade: tx.quality_grade,
      oldData: { price_per_kg: tx.price_per_kg, amount: tx.amount, payment_status: tx.payment_status },
    });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><Pencil size={16} className="text-brand-600" /> Edit Transaction</h3>
        <p className="mb-3 text-xs text-slate-400">{tx.code} · {tx.partyName}</p>

        <form onSubmit={submit}>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Quantity (kg)</label>
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                {fmt2(tx.quantity_kg)} <span className="ml-1 text-xs text-slate-400">(fixed — from weighbridge)</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Price per kg (៛)</label>
              <input type="number" min="0" step="0.01" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            </div>
          </div>

          <label className="mb-1 block text-xs text-slate-500">Payment Status</label>
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
            {isBuy ? (<><option value="pending">Pending</option><option value="paid">Paid</option></>) : (<><option value="paid">Paid</option><option value="credit">Credit</option><option value="deposit">Deposit</option></>)}
          </select>

          <div className="mb-4 rounded-lg bg-brand-50 px-3 py-2.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">New total amount</span><span className="font-bold text-slate-800">{fmtRiel(newAmount)}</span></div>
          </div>

          <label className="mb-1 block text-xs text-slate-500">Enter your password to confirm this change</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          {error && <p className="mb-2 text-sm text-rose-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("cancel")}</button>
            <button type="submit" disabled={saving || !password} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PaymentsModal({ tx, userEmail, userId, t, onClose }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editPayment, setEditPayment] = useState(null);

  async function load() {
    setLoading(true);
    const data = await api.getPaymentsForTransaction(tx.id);
    setPayments(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveEdit(newAmount) {
    await api.updatePayment(editPayment.id, newAmount);
    await api.logAudit({
      action: "edit_payment", tableName: "payments", recordId: editPayment.id,
      oldData: { amount: editPayment.amount }, newData: { amount: newAmount }, userId,
    });
    setEditPayment(null);
    load();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 font-semibold text-slate-700">Payment History</h3>
        <p className="mb-3 text-xs text-slate-400">{tx.code} · {tx.partyName}</p>

        <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
          {loading ? (
            <p className="p-4 text-center text-sm text-slate-400">Loading…</p>
          ) : payments.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-400">No payments recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-400">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">By</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2 text-slate-500">{p.pay_date}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{fmtRiel(p.amount)}</td>
                    <td className="px-3 py-2 text-slate-500">{p.createdByName}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setEditPayment(p)} className="text-slate-400 hover:text-brand-600"><Pencil size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Close</button>
        </div>
      </div>

      {editPayment && (
        <EditPaymentModal payment={editPayment} userEmail={userEmail} t={t} onClose={() => setEditPayment(null)} onSubmit={saveEdit} />
      )}
    </div>
  );
}

function EditPaymentModal({ payment, userEmail, t, onClose, onSubmit }) {
  const [amount, setAmount] = useState(String(payment.amount));
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: userEmail, password });
    if (authError) {
      setError("Incorrect password.");
      setSaving(false);
      return;
    }
    await onSubmit(parseFloat(amount));
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><Pencil size={16} className="text-brand-600" /> Correct Payment Amount</h3>
        <p className="mb-3 text-xs text-slate-400">Was: {fmtRiel(payment.amount)} on {payment.pay_date}</p>

        <form onSubmit={submit}>
          <label className="mb-1 block text-xs text-slate-500">Correct amount (៛)</label>
          <input type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus
            className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

          <label className="mb-1 block text-xs text-slate-500">Enter your password to confirm</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          {error && <p className="mb-2 text-sm text-rose-500">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("cancel")}</button>
            <button type="submit" disabled={saving || !password || !amount} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? "Saving..." : "Confirm Correction"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmCancelModal({ tx, alreadyPaid, userEmail, t, onClose, onConfirm }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setChecking(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: userEmail, password });
    setChecking(false);
    if (authError) {
      setError("Incorrect password.");
      return;
    }
    onConfirm();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><AlertTriangle size={16} className="text-rose-500" /> Confirm Cancellation</h3>
        <p className="mb-3 text-xs text-slate-400">{tx.code} · {tx.partyName} · {fmtRiel(tx.amount)}</p>

        {alreadyPaid > 0.01 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
            {fmtRiel(alreadyPaid)} has already been recorded as paid against this transaction. Cancelling will NOT remove that from Cash Flow — it stays on record as real cash that moved. You may want to record a matching refund entry separately.
          </div>
        )}

        <form onSubmit={submit}>
          <label className="mb-1 block text-xs text-slate-500">Enter your password to confirm</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
            className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
          {error && <p className="mb-2 text-sm text-rose-500">{error}</p>}

          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("cancel")}</button>
            <button type="submit" disabled={checking || !password} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
              {checking ? "Checking..." : "Confirm Cancellation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const HQ_STATUS_STYLES = {
  processing: "bg-amber-50 text-amber-600 border-amber-200",
  paid: "bg-emerald-50 text-emerald-600 border-emerald-200",
  cancelled: "bg-rose-50 text-rose-600 border-rose-200",
};

export default function Transactions({ setPage }) {
  const { t } = useLanguage();
  const { profile, session } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [rows, setRows] = useState([]);
  const [payments, setPayments] = useState([]);
  const [type, setType] = useState("");
  const [requestTx, setRequestTx] = useState(null);
  const [payTx, setPayTx] = useState(null);
  const [editTx, setEditTx] = useState(null);
  const [cancelConfirmTx, setCancelConfirmTx] = useState(null);
  const [viewPaymentsTx, setViewPaymentsTx] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [txData, payData] = await Promise.all([
      api.getTransactions({ type: type || undefined }),
      api.getPayments(isAdmin ? {} : { locationId: profile?.location_id }),
    ]);
    setRows(txData);
    setPayments(payData);
    setLoading(false);
  }

  useEffect(() => { load(); }, [type]);

  const remainingByTx = useMemo(() => {
    const map = {};
    rows.forEach((tx) => {
      const paid = payments
        .filter((p) => p.transaction_id === tx.id && p.type === (tx.type === "BUY" ? "pay_supplier" : "receive_customer"))
        .reduce((s, p) => s + Number(p.amount), 0);
      map[tx.id] = Math.max(0, Number(tx.total_with_tax ?? tx.amount) - paid);
    });
    return map;
  }, [rows, payments]);

  function exportCsv() {
    const header = ["#", "Type", "Transaction ID", "Date", "Location", "Party", "Qty (kg)", "Amount (Riel)", "Paid (Riel)", "Remaining (Riel)", "HQ Status"];
    const lines = rows.map((tx, i) => {
      const remaining = remainingByTx[tx.id] || 0;
      return [i + 1, tx.type, tx.code, tx.tx_date, tx.stationName, tx.partyName, tx.quantity_kg, tx.amount, Math.max(0, (tx.total_with_tax ?? tx.amount) - remaining), remaining, tx.hq_status || "processing"];
    });
    const csv = [header, ...lines].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "transactions.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function submitRequest(reason) {
    await api.createChangeRequest({
      transactionId: requestTx.id,
      requestedBy: session.user.id,
      locationId: profile.location_id,
      reason,
    });
    setRequestTx(null);
  }

  async function submitPayment(amount, method, memo) {
    await api.createPayment({
      type: payTx.type === "BUY" ? "pay_supplier" : "receive_customer",
      transactionId: payTx.id,
      locationId: payTx.location_id,
      amount,
      method,
      payDate: new Date().toISOString().slice(0, 10),
      memo,
      userId: session.user.id,
    });
    setPayTx(null);
    load();
  }

  async function changeHqStatus(id, hqStatus, tx) {
    if (hqStatus === "cancelled") {
      setCancelConfirmTx(tx);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, hq_status: hqStatus } : r)));
    try {
      await api.updateHqStatus(id, hqStatus);
    } catch (err) {
      load();
    }
  }

  async function confirmCancel() {
    const tx = cancelConfirmTx;
    setCancelConfirmTx(null);
    setRows((prev) => prev.map((r) => (r.id === tx.id ? { ...r, hq_status: "cancelled" } : r)));
    try {
      await api.updateHqStatus(tx.id, "cancelled");
    } catch (err) {
      load();
    }
  }

  async function submitEdit(fields) {
    const { oldData, ...updateFields } = fields;
    const updated = await api.updateTransaction(editTx.id, updateFields);
    await api.logAudit({
      action: "edit_transaction",
      tableName: "transactions",
      recordId: editTx.id,
      oldData,
      newData: { price_per_kg: updated.price_per_kg, amount: updated.amount, payment_status: updated.payment_status },
      userId: session.user.id,
    });
    setEditTx(null);
    load();
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("tx_title")} subtitle={isAdmin ? t("all_locations") : t("my_location")} />
      <main className="flex-1 overflow-y-auto p-6">
        {!isAdmin && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <Lock size={14} /> {t("cannot_edit")}
          </div>
        )}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-2">
            {[{ v: "", l: t("all") }, { v: "BUY", l: t("buy") }, { v: "SELL", l: t("sell") }].map((opt) => (
              <button key={opt.v} onClick={() => setType(opt.v)} className={`rounded-lg border px-3 py-1.5 text-sm ${type === opt.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{opt.l}</button>
            ))}
            <button className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"><Filter size={14} /> {t("filter")}</button>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCsv} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><Download size={14} /> {t("export_csv")}</button>
            <button onClick={() => setPage("new-buy")} className="flex items-center gap-2 rounded-lg border border-brand-600 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"><Plus size={14} /> {t("new_buy")}</button>
            <button onClick={() => setPage("new-sell")} className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"><Plus size={14} /> {t("new_sell")}</button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">#</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">{t("col_id")}</th>
                <th className="px-3 py-3 font-medium">{t("col_date")}</th>
                <th className="px-3 py-3 font-medium">{t("col_station")}</th>
                <th className="px-3 py-3 font-medium">{t("col_party")}</th>
                <th className="px-3 py-3 font-medium">{t("col_qty")}</th>
                <th className="px-3 py-3 font-medium">{t("col_amount")}</th>
                <th className="px-3 py-3 font-medium">Paid</th>
                <th className="px-3 py-3 font-medium">Remaining</th>
                <th className="px-3 py-3 font-medium">{t("col_status")}</th>
                <th className="px-3 py-3 font-medium">{t("hq_confirmation")}</th>
                <th className="px-3 py-3 font-medium">{t("col_action")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx, i) => {
                const hqStatus = tx.hq_status || "processing";
                const isCancelled = hqStatus === "cancelled";
                const remaining = remainingByTx[tx.id] || 0;
                return (
                  <tr key={tx.id} className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${isCancelled ? "opacity-50" : ""}`}>
                    <td className="px-5 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-3">
                      <span className={`flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${tx.type === "BUY" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                        {tx.type === "BUY" ? "▲ BUY" : "▼ SELL"}
                      </span>
                    </td>
                    <td className="px-3 py-3"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${tx.type === "BUY" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}>{tx.code}</span></td>
                    <td className="px-3 py-3 text-slate-500">{tx.tx_date}<div className="text-xs text-slate-400">{tx.tx_time}</div></td>
                    <td className="px-3 py-3 text-slate-600"><div className="flex items-center gap-1"><MapPin size={12} className="text-slate-300" />{tx.stationName}</div></td>
                    <td className="px-3 py-3"><p className="font-medium text-slate-700">{tx.partyName}</p>{tx.partyIdNumber && <p className="text-xs text-slate-400">{tx.partyIdNumber}</p>}</td>
                    <td className="px-3 py-3 text-slate-700">{fmt2(tx.quantity_kg)}</td>
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {fmtRiel(tx.total_with_tax ?? tx.amount)}
                      {tx.tax_applicable && <p className="text-[10px] font-normal text-slate-400">incl. {tx.tax_rate}% VAT</p>}
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={() => setViewPaymentsTx(tx)} className="text-emerald-600 underline decoration-dotted hover:text-emerald-700">
                        {fmtRiel(Math.max(0, (tx.total_with_tax ?? tx.amount) - remaining))}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      {isCancelled ? (
                        <span className="text-xs text-slate-400">Excluded from reports</span>
                      ) : remaining > 0.01 ? (
                        <button onClick={() => setPayTx(tx)} className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100">
                          <Wallet size={12} /> {fmtRiel(remaining)}
                        </button>
                      ) : (
                        <span className="text-xs text-emerald-600">Settled</span>
                      )}
                    </td>
                    <td className="px-3 py-3">{tx.status === "confirmed" ? <CheckCircle2 size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-amber-500" />}</td>
                    <td className="px-3 py-3">
                      {isAdmin ? (
                        <select
                          value={hqStatus}
                          onChange={(e) => changeHqStatus(tx.id, e.target.value, tx)}
                          className={`rounded-md border px-2 py-1 text-xs font-medium outline-none ${HQ_STATUS_STYLES[hqStatus]}`}
                        >
                          <option value="processing">{t("hq_processing")}</option>
                          <option value="paid">{t("hq_paid")}</option>
                          <option value="cancelled">{t("hq_cancelled")}</option>
                        </select>
                      ) : (
                        <span className={`rounded-md border px-2 py-1 text-xs font-medium ${HQ_STATUS_STYLES[hqStatus]}`}>
                          {t(`hq_${hqStatus}`)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {isAdmin ? (
                        <button onClick={() => setEditTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-brand-300 hover:text-brand-700">
                          <Pencil size={12} /> Edit
                        </button>
                      ) : (
                        <button onClick={() => setRequestTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-amber-300 hover:text-amber-600">
                          <Flag size={12} /> {t("request_change")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !loading && <tr><td colSpan={13} className="px-5 py-10 text-center text-sm text-slate-400">{t("no_transactions")}</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
      {requestTx && <RequestChangeModal tx={requestTx} t={t} onClose={() => setRequestTx(null)} onSubmit={submitRequest} />}
      {payTx && <RecordPaymentModal tx={payTx} remaining={remainingByTx[payTx.id] || 0} t={t} onClose={() => setPayTx(null)} onSubmit={submitPayment} />}
      {editTx && <EditTransactionModal tx={editTx} userEmail={session.user.email} userId={session.user.id} t={t} onClose={() => setEditTx(null)} onSubmit={submitEdit} />}
      {viewPaymentsTx && <PaymentsModal tx={viewPaymentsTx} userEmail={session.user.email} userId={session.user.id} t={t} onClose={() => setViewPaymentsTx(null)} />}
      {cancelConfirmTx && (
        <ConfirmCancelModal
          tx={cancelConfirmTx}
          alreadyPaid={Math.max(0, cancelConfirmTx.amount - (remainingByTx[cancelConfirmTx.id] || 0))}
          userEmail={session.user.email}
          t={t}
          onClose={() => setCancelConfirmTx(null)}
          onConfirm={confirmCancel}
        />
      )}
    </div>
  );
}
