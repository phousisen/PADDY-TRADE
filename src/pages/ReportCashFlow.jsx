import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";

function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

const TYPE_LABELS = {
  pay_supplier: "Paid to supplier",
  receive_customer: "Received from customer",
  expense: "Expense",
  transfer: "Fund transfer",
  journal: "Journal entry",
};

const IS_INFLOW = { pay_supplier: false, receive_customer: true, expense: false, transfer: false, journal: null };

function AddEntryForm({ profile, onAdd }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("expense");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    setSaving(true);
    await onAdd({ type, amount: parseFloat(amount), memo });
    setSaving(false);
    setAmount("");
    setMemo("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
        <Plus size={14} /> Add Cash Entry
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <label className="mb-1 block text-xs text-slate-500">Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
          <option value="expense">Expense (money out)</option>
          <option value="transfer">Fund Transfer</option>
          <option value="journal">Journal Adjustment</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">Amount (៛)</label>
        <input type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
      </div>
      <div className="flex-1 min-w-[160px]">
        <label className="mb-1 block text-xs text-slate-500">Note</label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. fuel, staff pay" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
      </div>
      <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {saving ? "Saving..." : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
        Cancel
      </button>
    </form>
  );
}

export default function ReportCashFlow({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { profile, session } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [allPayments, setAllPayments] = useState([]);

  async function load() {
    const data = await api.getPayments(isAdmin ? {} : { locationId: profile?.location_id });
    setAllPayments(data);
  }
  useEffect(() => { load(); }, []);

  const payments = allPayments
    .filter((p) => !selectedLocationIds.length || selectedLocationIds.includes(p.location_id))
    .filter((p) => !startDate || p.pay_date >= startDate)
    .filter((p) => !endDate || p.pay_date <= endDate);

  const ledger = useMemo(() => {
    const sorted = payments.slice().sort((a, b) => (a.pay_date + a.created_at < b.pay_date + b.created_at ? -1 : 1));
    let balance = 0;
    return sorted.map((p) => {
      const isInflow = p.type === "receive_customer";
      const signedAmount = isInflow ? Number(p.amount) : -Number(p.amount);
      balance += signedAmount;
      return { ...p, signedAmount, balance };
    }).reverse();
  }, [payments]);

  const totalIn = payments.filter((p) => p.type === "receive_customer").reduce((s, p) => s + Number(p.amount), 0);
  const totalOut = payments.filter((p) => p.type !== "receive_customer").reduce((s, p) => s + Number(p.amount), 0);

  async function addEntry({ type, amount, memo }) {
    await api.createPayment({
      type,
      transactionId: null,
      locationId: profile.location_id,
      amount,
      method: "cash",
      payDate: new Date().toISOString().slice(0, 10),
      memo,
      userId: session.user.id,
    });
    load();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-slate-400">Total In</p>
            <p className="text-xl font-bold text-emerald-600">{fmtRiel(totalIn)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-slate-400">Total Out</p>
            <p className="text-xl font-bold text-rose-600">{fmtRiel(totalOut)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-slate-400">Net</p>
            <p className={`text-xl font-bold ${totalIn - totalOut >= 0 ? "text-slate-800" : "text-rose-600"}`}>{fmtRiel(totalIn - totalOut)}</p>
          </div>
        </div>
        {profile?.location_id || isAdmin ? <AddEntryForm profile={profile} onAdd={addEntry} /> : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Note</th>
              <th className="px-5 py-3 font-medium">Recorded by</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((p) => (
              <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-5 py-3 text-slate-500">{p.pay_date}</td>
                <td className="px-5 py-3 text-slate-700">{TYPE_LABELS[p.type] || p.type}</td>
                <td className="px-5 py-3 text-slate-600">{p.memo || "—"}</td>
                <td className="px-5 py-3 text-slate-500">{p.createdByName}</td>
                <td className={`px-5 py-3 font-medium ${p.signedAmount >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{p.signedAmount >= 0 ? "+" : ""}{fmtRiel(p.signedAmount)}</td>
                <td className="px-5 py-3 text-slate-700">{fmtRiel(p.balance)}</td>
              </tr>
            ))}
            {ledger.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">No cash movements recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
