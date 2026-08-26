import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import Receipt from "./Receipt.jsx";

function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting.
function cambodiaDateStr(d = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// The exact clock time a cash entry was recorded (as opposed to `pay_date`,
// which is just the business date staff picked and can be back-dated).
function cambodiaTime(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date(iso));
}

const TYPE_LABELS = {
  pay_supplier: "Paid to supplier",
  receive_customer: "Received from customer",
  expense: "Expense",
  transfer: "Fund transfer",
  journal: "Journal entry",
  capital_in: "Partner capital in",
  capital_out: "Partner capital out",
  loan_in: "Bank loan drawn",
  loan_out: "Bank loan repaid",
};

const TYPE_LABELS_KM = {
  pay_supplier: "ទូទាត់ដល់អ្នកផ្គត់ផ្គង់",
  receive_customer: "ទទួលពីអតិថិជន",
  expense: "ការចំណាយ",
  transfer: "ការផ្ទេរប្រាក់",
  journal: "ធាតុទិនានុប្បវត្តិ",
  capital_in: "ដើមទុនដៃគូចូល",
  capital_out: "ដើមទុនដៃគូចេញ",
  loan_in: "កម្ចីធនាគារដកយក",
  loan_out: "សងកម្ចីធនាគារ",
};

const IS_INFLOW = {
  pay_supplier: false,
  receive_customer: true,
  expense: false,
  transfer: false,
  journal: null,
  capital_in: true,
  capital_out: false,
  loan_in: true,
  loan_out: false,
};

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
        <Plus size={14} /> Add Cash Entry<span className="font-khmer block text-xs font-normal">បន្ថែមធាតុសាច់ប្រាក់</span>
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <label className="mb-1 block text-xs text-slate-500">Type<span className="font-khmer block">ប្រភេទ</span></label>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
          <option value="expense">Expense (money out) — ការចំណាយ (ប្រាក់ចេញ)</option>
          <option value="transfer">Fund Transfer — ការផ្ទេរប្រាក់</option>
          <option value="journal">Journal Adjustment — ការកែតម្រូវទិនានុប្បវត្តិ</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">Amount (៛)<span className="font-khmer block">ទឹកប្រាក់ (៛)</span></label>
        <input type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
      </div>
      <div className="flex-1 min-w-[160px]">
        <label className="mb-1 block text-xs text-slate-500">Note<span className="font-khmer block">កំណត់ចំណាំ</span></label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. fuel, staff pay" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
      </div>
      <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {saving ? (<>Saving...<span className="font-khmer block text-xs font-normal">កំពុងរក្សាទុក...</span></>) : (<>Save<span className="font-khmer block text-xs font-normal">រក្សាទុក</span></>)}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
        Cancel<span className="font-khmer block text-xs">បោះបង់</span>
      </button>
    </form>
  );
}

export default function ReportCashFlow({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { profile, session } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [allPayments, setAllPayments] = useState([]);
  // Full transaction + party records — used to show "who we paid/received
  // from" on each row, and to reopen the actual receipt (bank details
  // included) when a linked row is clicked.
  const [txById, setTxById] = useState({});
  const [partyById, setPartyById] = useState({});
  const [viewingTx, setViewingTx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [payData, txData, partyData] = await Promise.all([
        api.getPayments(isAdmin ? {} : { locationId: profile?.location_id }),
        api.getTransactions(),
        api.getParties(),
      ]);
      setAllPayments(payData);
      setTxById(Object.fromEntries(txData.map((t) => [t.id, t])));
      setPartyById(Object.fromEntries(partyData.map((p) => [p.id, p])));
    } catch (err) {
      // Without this, a failed/dropped request silently showed an empty
      // cash flow — as if nothing had ever moved — instead of saying the
      // load itself had failed.
      setLoadError(err.message || "Couldn't load this report — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openPayment(p) {
    if (!p.transaction_id) return;
    const tx = txById[p.transaction_id];
    if (!tx) return;
    const party = tx.party_id ? partyById[tx.party_id] : null;
    setViewingTx({
      ...tx,
      bank_name: tx.bank_name || party?.bank_name,
      bank_account: tx.bank_account || party?.bank_account,
      bank_qr_url: tx.bank_qr_url || party?.bank_qr_url,
    });
  }

  const payments = allPayments
    .filter((p) => !selectedLocationIds.length || selectedLocationIds.includes(p.location_id))
    .filter((p) => !startDate || p.pay_date >= startDate)
    .filter((p) => !endDate || p.pay_date <= endDate)
    .map((p) => {
      const tx = p.transaction_id ? txById[p.transaction_id] : null;
      return { ...p, partyName: tx?.partyName || null, txCode: tx?.code || null };
    });

  const ledger = useMemo(() => {
    const sorted = payments.slice().sort((a, b) => (a.pay_date + a.created_at < b.pay_date + b.created_at ? -1 : 1));
    let balance = 0;
    return sorted.map((p) => {
      const isInflow = IS_INFLOW[p.type] ?? false;
      const signedAmount = isInflow ? Number(p.amount) : -Number(p.amount);
      balance += signedAmount;
      return { ...p, signedAmount, balance };
    }).reverse();
  }, [payments]);

  const totalIn = payments.filter((p) => IS_INFLOW[p.type] ?? false).reduce((s, p) => s + Number(p.amount), 0);
  const totalOut = payments.filter((p) => !(IS_INFLOW[p.type] ?? false)).reduce((s, p) => s + Number(p.amount), 0);

  async function addEntry({ type, amount, memo }) {
    await api.createPayment({
      type,
      transactionId: null,
      locationId: profile.location_id,
      amount,
      method: "cash",
      payDate: cambodiaDateStr(),
      memo,
      userId: session.user.id,
    });
    load();
  }

  if (viewingTx) {
    return (
      <div className="fixed inset-0 z-50 bg-white">
        <Receipt tx={viewingTx} onDone={() => setViewingTx(null)} />
      </div>
    );
  }

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry<span className="font-khmer block text-[11px]">ព្យាយាមម្តងទៀត</span></button>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-slate-400">Total In<span className="font-khmer block">ចំណូលសរុប</span></p>
            <p className="text-xl font-bold text-emerald-600">{fmtRiel(totalIn)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-slate-400">Total Out<span className="font-khmer block">ចំណាយសរុប</span></p>
            <p className="text-xl font-bold text-rose-600">{fmtRiel(totalOut)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-slate-400">Net<span className="font-khmer block">សុទ្ធ</span></p>
            <p className={`text-xl font-bold ${totalIn - totalOut >= 0 ? "text-slate-800" : "text-rose-600"}`}>{fmtRiel(totalIn - totalOut)}</p>
          </div>
        </div>
        {profile?.location_id || isAdmin ? <AddEntryForm profile={profile} onAdd={addEntry} /> : null}
      </div>

      <p className="mb-3 text-xs text-slate-400">
        "Running Total" only adds up the entries listed below (whatever date range/location you've filtered to) — it is not a real bank account
        balance and there is no starting/opening balance set anywhere in the system. A big negative number usually just means outgoing payments
        were recorded in this period without matching money-in entries also being recorded here (for example, capital or loan funds that came in
        before this date range, or that were received but never logged as a payment). Click any row linked to a transaction to open its receipt.
        <span className="font-khmer block mt-1">
          "សរុបបន្តបន្ទាប់" គ្រាន់តែបូកសរុបធាតុដែលបានរាយខាងក្រោម (តាមចន្លោះកាលបរិច្ឆេទ/ទីតាំងដែលបានត្រង)
          — វាមិនមែនជាសមតុល្យគណនីធនាគារពិតប្រាកដទេ ហើយគ្មានសមតុល្យចាប់ផ្តើមកំណត់នៅក្នុងប្រព័ន្ធនោះទេ។
          លេខអវិជ្ជមានច្រើនតែមានន័យថា ការទូទាត់ចេញត្រូវបានកត់ត្រាក្នុងអំឡុងពេលនេះ ដោយគ្មានធាតុប្រាក់ចូលដែលត្រូវគ្នាត្រូវបានកត់ត្រានៅទីនេះដែរ
          (ឧទាហរណ៍ ដើមទុន ឬថវិកាកម្ចីដែលចូលមុនចន្លោះកាលបរិច្ឆេទនេះ ឬដែលបានទទួលប៉ុន្តែមិនដែលបានកត់ត្រាជាការទូទាត់)។
          ចុចលើជួរណាមួយដែលភ្ជាប់ជាមួយប្រតិបត្តិការ ដើម្បីបើកបង្កាន់ដៃរបស់វា។
        </span>
      </p>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-3 font-medium">Date<span className="font-khmer block">កាលបរិច្ឆេទ</span></th>
              <th className="px-5 py-3 font-medium">Time<span className="font-khmer block">ពេលវេលា</span></th>
              <th className="px-5 py-3 font-medium">Type<span className="font-khmer block">ប្រភេទ</span></th>
              <th className="px-5 py-3 font-medium">Paid to / Received from<span className="font-khmer block">ទូទាត់ទៅ / ទទួលពី</span></th>
              <th className="px-5 py-3 font-medium">Note<span className="font-khmer block">កំណត់ចំណាំ</span></th>
              <th className="px-5 py-3 font-medium">Recorded by<span className="font-khmer block">កត់ត្រាដោយ</span></th>
              <th className="px-5 py-3 font-medium">Amount<span className="font-khmer block">ទឹកប្រាក់</span></th>
              <th className="px-5 py-3 font-medium">Running Total<span className="font-khmer block">សរុបបន្តបន្ទាប់</span></th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((p) => (
              <tr
                key={p.id}
                onClick={() => openPayment(p)}
                title={p.transaction_id ? "Click to view this transaction's receipt" : "Manual entry — not linked to a transaction"}
                className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${p.transaction_id ? "cursor-pointer" : ""}`}
              >
                <td className="px-5 py-3 text-slate-500">{p.pay_date}</td>
                <td className="px-5 py-3 text-slate-500">{cambodiaTime(p.created_at)}</td>
                <td className="px-5 py-3 text-slate-700">{TYPE_LABELS[p.type] || p.type}{TYPE_LABELS_KM[p.type] && <span className="font-khmer block text-[11px] text-slate-400">{TYPE_LABELS_KM[p.type]}</span>}</td>
                <td className="px-5 py-3 text-slate-700">{p.partyName || "—"}{p.txCode ? <span className="ml-1 text-xs text-slate-400">({p.txCode})</span> : null}</td>
                <td className="px-5 py-3 text-slate-600">{p.memo || "—"}</td>
                <td className="px-5 py-3 text-slate-500">{p.createdByName}</td>
                <td className={`px-5 py-3 font-medium ${p.signedAmount >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{p.signedAmount >= 0 ? "+" : ""}{fmtRiel(p.signedAmount)}</td>
                <td className="px-5 py-3 text-slate-700">{fmtRiel(p.balance)}</td>
              </tr>
            ))}
            {loading && ledger.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">Loading…<span className="font-khmer block">កំពុងផ្ទុក...</span></td></tr>}
            {ledger.length === 0 && !loading && !loadError && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">No cash movements recorded yet.<span className="font-khmer block">មិនទាន់មានចលនាសាច់ប្រាក់ត្រូវបានកត់ត្រានៅឡើយទេ។</span></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
