import { useEffect, useMemo, useState } from "react";
import { Download, Plus, CheckCircle2, AlertTriangle, Filter, MapPin, Lock, Flag, Wallet, Pencil, RotateCcw, Camera, ImageOff } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import LocationFilter from "../components/LocationFilter.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { supabase } from "../supabaseClient.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
function fmtTime(t) {
  if (!t) return "";
  const [hh, mm] = t.split(":");
  let h = parseInt(hh, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mm} ${period}`;
}
// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting.
function cambodiaDateStr(d = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// "Request a change" doesn't edit the live transaction — it redoes the Buy/Sell
// entry with corrected values and files it as a pending proposal. Nothing on
// the real transaction changes unless/until an HQ Admin/Owner approves it.
// Resolve a typed farmer/buyer name to a party id: keep the original party
// if the name wasn't touched, reuse an existing farmer/buyer if the typed
// name matches one exactly, or create a brand-new record — same as the New
// Buy/Sell form does when it sees an unrecognized name.
async function resolvePartyId(typedName, originalName, originalPartyId, type) {
  const trimmed = (typedName || "").trim();
  if (trimmed === (originalName || "").trim()) return originalPartyId;
  const matches = await api.getParties({ type, q: trimmed }).catch(() => []);
  const exact = (matches || []).find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact.id;
  const created = await api.createParty({ name: trimmed, type });
  return created.id;
}

function RequestChangeModal({ tx, t, onClose, onSubmit }) {
  const isBuy = tx.type === "BUY";
  const [partyQuery, setPartyQuery] = useState(tx.partyName || "");
  const [quantityKg, setQuantityKg] = useState(String(tx.quantity_kg ?? ""));
  const [pricePerKg, setPricePerKg] = useState(String(tx.price_per_kg ?? ""));
  const [qualityGrade, setQualityGrade] = useState(tx.quality_grade || "");
  const [paymentStatus, setPaymentStatus] = useState(tx.payment_status || (isBuy ? "pending" : "paid"));
  const [taxApplicable, setTaxApplicable] = useState(!!tx.tax_applicable);
  const [taxRate, setTaxRate] = useState(String(tx.tax_rate ?? "10"));
  const [moisturePct, setMoisturePct] = useState(String(tx.moisture_pct ?? ""));
  const [mixturePct, setMixturePct] = useState(String(tx.mixture_pct ?? ""));
  const [outthrowPct, setOutthrowPct] = useState(String(tx.outthrow_pct ?? ""));
  const [deductionKg, setDeductionKg] = useState(String(tx.deduction_kg ?? ""));
  const [staffFee, setStaffFee] = useState(String(tx.staff_fee ?? ""));
  const [carPlate, setCarPlate] = useState(tx.car_plate || "");
  const [driverName, setDriverName] = useState(tx.driver_name || "");
  const [note, setNote] = useState(tx.note || "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const newAmount = Math.max(0, Math.max(0, (parseFloat(quantityKg) || 0) - (parseFloat(deductionKg) || 0)) * (parseFloat(pricePerKg) || 0) - (isBuy ? (parseFloat(staffFee) || 0) : 0));
  const canSubmit = reason.trim() && parseFloat(quantityKg) > 0 && parseFloat(pricePerKg) >= 0 && partyQuery.trim() && !saving;

  async function submit() {
    setError("");
    setSaving(true);
    try {
      const partyId = await resolvePartyId(partyQuery, tx.partyName, tx.party_id, isBuy ? "supplier" : "buyer");
      const proposedData = {
        partyId,
        partyName: partyQuery.trim(),
        quantityKg: parseFloat(quantityKg) || 0,
        pricePerKg: parseFloat(pricePerKg) || 0,
        qualityGrade: isBuy ? (qualityGrade.trim() || null) : null,
        paymentStatus,
        taxApplicable,
        taxRate: taxApplicable ? (parseFloat(taxRate) || 0) : 0,
        moisturePct: parseFloat(moisturePct) || 0,
        mixturePct: parseFloat(mixturePct) || 0,
        outthrowPct: parseFloat(outthrowPct) || 0,
        deductionKg: parseFloat(deductionKg) || 0,
        staffFee: isBuy ? (parseFloat(staffFee) || 0) : 0,
        carPlate: carPlate.trim() || null,
        driverName: driverName.trim() || null,
        note: note.trim() || null,
      };
      await onSubmit(reason.trim(), proposedData);
    } catch (err) {
      setError(err.message || "Couldn't submit this request. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><RotateCcw size={16} className="text-amber-500" /> Redo This {isBuy ? "Buy" : "Sell"} Entry</h3>
        <p className="mb-3 text-xs text-slate-400">
          {tx.code} · Current: {fmt2(tx.quantity_kg)} kg × {fmtRiel(tx.price_per_kg)}/kg = {fmtRiel(tx.amount)}
        </p>
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          This does not change the saved transaction. It sends these corrected values to HQ as a pending request — nothing updates until an HQ Admin or Owner approves it.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="relative col-span-2">
            <label className="mb-1 block text-xs text-slate-500">{isBuy ? "Seller (Farmer)" : "Buyer"}</label>
            <input
              value={partyQuery}
              onChange={(e) => setPartyQuery(e.target.value)}
              placeholder={isBuy ? "Farmer name" : "Buyer name"}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            {partyQuery.trim() && partyQuery.trim() !== (tx.partyName || "").trim() && (
              <p className="mt-1 text-[11px] text-slate-400">
                {isBuy ? "Farmer" : "Buyer"} will be matched to an existing one with this name, or added as new, once approved. You can browse existing names on the {isBuy ? "Farmers" : "Buyers"} page.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">Weight (kg)</label>
            <input type="number" min="0" step="0.01" value={quantityKg} onChange={(e) => setQuantityKg(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Price per kg (៛)</label>
            <input type="number" min="0" step="0.01" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          </div>

          {isBuy && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">Quality Grade</label>
              <input list="rc-grade-options" value={qualityGrade} onChange={(e) => setQualityGrade(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              <datalist id="rc-grade-options"><option value="A" /><option value="B" /><option value="C" /></datalist>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-slate-500">Payment Status</label>
            <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
              {isBuy ? (<><option value="pending">Pending</option><option value="paid">Paid</option></>) : (<><option value="paid">Paid</option><option value="credit">Credit</option><option value="deposit">Deposit</option></>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">Car Plate Number</label>
            <input value={carPlate} onChange={(e) => setCarPlate(e.target.value)} placeholder="e.g. 2AB-1234"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Truck / Driver Name</label>
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="e.g. PhaNith"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-xs font-medium text-slate-500">Quality Deduction (optional)</p>
          <div className="grid grid-cols-4 gap-2">
            <div><label className="mb-1 block text-[11px] text-slate-400">Moisture %</label><input type="number" min="0" step="0.1" value={moisturePct} onChange={(e) => setMoisturePct(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
            <div><label className="mb-1 block text-[11px] text-slate-400">Mixture %</label><input type="number" min="0" step="0.1" value={mixturePct} onChange={(e) => setMixturePct(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
            <div><label className="mb-1 block text-[11px] text-slate-400">Outthrow %</label><input type="number" min="0" step="0.1" value={outthrowPct} onChange={(e) => setOutthrowPct(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
            <div><label className="mb-1 block text-[11px] text-slate-400">Deduction (kg)</label><input type="number" min="0" step="0.01" value={deductionKg} onChange={(e) => setDeductionKg(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
          </div>
        </div>

        {isBuy && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-medium text-slate-500">Staff / Carrying Fee (optional)</p>
            <input type="number" min="0" step="0.01" value={staffFee} onChange={(e) => setStaffFee(e.target.value)} placeholder="0"
              className="w-full max-w-[200px] rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            <p className="mt-1.5 text-[11px] text-slate-400">Only if our staff had to carry the paddy for this seller because they had no labor of their own — comes off what they're paid.</p>
          </div>
        )}

        <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={taxApplicable} onChange={(e) => setTaxApplicable(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400" />
            Apply VAT
          </label>
          {taxApplicable && (
            <div className="flex items-center gap-1.5">
              <input type="number" min="0" step="0.1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              <span className="text-sm text-slate-500">%</span>
            </div>
          )}
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs text-slate-500">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        </div>

        <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">New total amount</span><span className="font-bold text-slate-800">{fmtRiel(newAmount)}</span></div>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs text-slate-500">{t("reason_label")}</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reason_placeholder")} rows={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        </div>

        {error && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40">{t("cancel")}</button>
          <button disabled={!canSubmit} onClick={submit} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">{saving ? "Submitting…" : t("submit_request")}</button>
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
  const isBuy = tx.type === "BUY";
  const [partyQuery, setPartyQuery] = useState(tx.partyName || "");
  const [quantityKg, setQuantityKg] = useState(String(tx.quantity_kg ?? ""));
  const [pricePerKg, setPricePerKg] = useState(String(tx.price_per_kg ?? ""));
  const [qualityGrade, setQualityGrade] = useState(tx.quality_grade || "");
  const [paymentStatus, setPaymentStatus] = useState(tx.payment_status || (isBuy ? "pending" : "paid"));
  const [taxApplicable, setTaxApplicable] = useState(!!tx.tax_applicable);
  const [taxRate, setTaxRate] = useState(String(tx.tax_rate ?? "10"));
  const [moisturePct, setMoisturePct] = useState(String(tx.moisture_pct ?? ""));
  const [mixturePct, setMixturePct] = useState(String(tx.mixture_pct ?? ""));
  const [outthrowPct, setOutthrowPct] = useState(String(tx.outthrow_pct ?? ""));
  const [deductionKg, setDeductionKg] = useState(String(tx.deduction_kg ?? ""));
  const [staffFee, setStaffFee] = useState(String(tx.staff_fee ?? ""));
  const [carPlate, setCarPlate] = useState(tx.car_plate || "");
  const [driverName, setDriverName] = useState(tx.driver_name || "");
  const [note, setNote] = useState(tx.note || "");
  const [txDate, setTxDate] = useState(tx.tx_date || cambodiaDateStr());
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const newAmount = Math.max(0, Math.max(0, (parseFloat(quantityKg) || 0) - (parseFloat(deductionKg) || 0)) * (parseFloat(pricePerKg) || 0) - (isBuy ? (parseFloat(staffFee) || 0) : 0));
  const canSubmit = !saving && password && partyQuery.trim() && parseFloat(quantityKg) > 0 && parseFloat(pricePerKg) >= 0;

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: userEmail, password });
    if (authError) {
      setError(authError.message || "Incorrect password.");
      setSaving(false);
      return;
    }
    try {
      const partyId = await resolvePartyId(partyQuery, tx.partyName, tx.party_id, isBuy ? "supplier" : "buyer");
      await onSubmit({
        partyId,
        quantityKg: parseFloat(quantityKg) || 0,
        pricePerKg: parseFloat(pricePerKg) || 0,
        paymentStatus,
        qualityGrade: isBuy ? (qualityGrade.trim() || null) : null,
        taxApplicable,
        taxRate: taxApplicable ? (parseFloat(taxRate) || 0) : 0,
        moisturePct: parseFloat(moisturePct) || 0,
        mixturePct: parseFloat(mixturePct) || 0,
        outthrowPct: parseFloat(outthrowPct) || 0,
        deductionKg: parseFloat(deductionKg) || 0,
        staffFee: isBuy ? (parseFloat(staffFee) || 0) : 0,
        carPlate: carPlate.trim() || null,
        driverName: driverName.trim() || null,
        note: note.trim() || null,
        txDate,
        oldData: {
          party_id: tx.party_id, partyName: tx.partyName, quantity_kg: tx.quantity_kg, price_per_kg: tx.price_per_kg,
          amount: tx.amount, payment_status: tx.payment_status, quality_grade: tx.quality_grade, tax_applicable: tx.tax_applicable,
          tax_rate: tx.tax_rate, moisture_pct: tx.moisture_pct, mixture_pct: tx.mixture_pct, outthrow_pct: tx.outthrow_pct,
          deduction_kg: tx.deduction_kg, staff_fee: tx.staff_fee, car_plate: tx.car_plate, driver_name: tx.driver_name, note: tx.note, tx_date: tx.tx_date,
        },
      });
    } catch (err) {
      setError(err.message || "Couldn't save these changes. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><Pencil size={16} className="text-brand-600" /> Edit Transaction</h3>
        <p className="mb-3 text-xs text-slate-400">{tx.code} · {tx.partyName}</p>

        <form onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-500">{isBuy ? "Seller (Farmer)" : "Buyer"}</label>
              <input value={partyQuery} onChange={(e) => setPartyQuery(e.target.value)}
                placeholder={isBuy ? "Farmer name" : "Buyer name"}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              {partyQuery.trim() && partyQuery.trim() !== (tx.partyName || "").trim() && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Will be matched to an existing {isBuy ? "farmer" : "buyer"} with this name, or added as new, when saved.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Quantity (kg)</label>
              <input type="number" min="0" step="0.01" value={quantityKg} onChange={(e) => setQuantityKg(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Price per kg (៛)</label>
              <input type="number" min="0" step="0.01" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            </div>

            {isBuy && (
              <div>
                <label className="mb-1 block text-xs text-slate-500">Quality Grade</label>
                <input list="et-grade-options" value={qualityGrade} onChange={(e) => setQualityGrade(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                <datalist id="et-grade-options"><option value="A" /><option value="B" /><option value="C" /></datalist>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-slate-500">Payment Status</label>
              <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                {isBuy ? (<><option value="pending">Pending</option><option value="paid">Paid</option></>) : (<><option value="paid">Paid</option><option value="credit">Credit</option><option value="deposit">Deposit</option></>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Car Plate Number</label>
              <input value={carPlate} onChange={(e) => setCarPlate(e.target.value)} placeholder="e.g. 2AB-1234"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Truck / Driver Name</label>
              <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="e.g. PhaNith"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-medium text-slate-500">Quality Deduction (optional)</p>
            <div className="grid grid-cols-4 gap-2">
              <div><label className="mb-1 block text-[11px] text-slate-400">Moisture %</label><input type="number" min="0" step="0.1" value={moisturePct} onChange={(e) => setMoisturePct(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
              <div><label className="mb-1 block text-[11px] text-slate-400">Mixture %</label><input type="number" min="0" step="0.1" value={mixturePct} onChange={(e) => setMixturePct(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
              <div><label className="mb-1 block text-[11px] text-slate-400">Outthrow %</label><input type="number" min="0" step="0.1" value={outthrowPct} onChange={(e) => setOutthrowPct(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
              <div><label className="mb-1 block text-[11px] text-slate-400">Deduction (kg)</label><input type="number" min="0" step="0.01" value={deductionKg} onChange={(e) => setDeductionKg(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
            </div>
          </div>

          {isBuy && (
            <div className="mt-3 rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-xs font-medium text-slate-500">Staff / Carrying Fee (optional)</p>
              <input type="number" min="0" step="0.01" value={staffFee} onChange={(e) => setStaffFee(e.target.value)} placeholder="0"
                className="w-full max-w-[200px] rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              <p className="mt-1.5 text-[11px] text-slate-400">Only if our staff had to carry the paddy for this seller because they had no labor of their own — comes off what they're paid.</p>
            </div>
          )}

          <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={taxApplicable} onChange={(e) => setTaxApplicable(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400" />
              Apply VAT
            </label>
            {taxApplicable && (
              <div className="flex items-center gap-1.5">
                <input type="number" min="0" step="0.1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                <span className="text-sm text-slate-500">%</span>
              </div>
            )}
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs text-slate-500">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs text-slate-500">Transaction Date</label>
            <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} max={cambodiaDateStr()}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          </div>

          <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">New total amount</span><span className="font-bold text-slate-800">{fmtRiel(newAmount)}</span></div>
          </div>

          <label className="mb-1 mt-3 block text-xs text-slate-500">Enter your password to confirm this change</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="off" name="confirm-own-password-not-autofillable"
            className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          {error && <p className="mb-2 text-sm text-rose-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40">{t("cancel")}</button>
            <button type="submit" disabled={!canSubmit} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
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

function PhotoPane({ label, url }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img src={url} alt={label} className="h-48 w-full rounded-lg border border-slate-200 object-contain bg-slate-50 hover:opacity-90" />
          <p className="mt-1 text-center text-[11px] text-brand-600">Click to open full size</p>
        </a>
      ) : (
        <div className="flex h-48 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-300">
          <ImageOff size={20} />
          <p className="text-xs">Not uploaded</p>
        </div>
      )}
    </div>
  );
}

function PhotosModal({ tx, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><Camera size={16} className="text-brand-600" /> Photos</h3>
        <p className="mb-3 text-xs text-slate-400">{tx.code} · {tx.partyName}</p>
        <div className="grid grid-cols-2 gap-4">
          <PhotoPane label="Physical Receipt" url={tx.receipt_photo_url} />
          <PhotoPane label="Bank QR / Payment Proof" url={tx.payment_proof_url} />
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Close</button>
        </div>
      </div>
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
  // Kept as two separate toggles rather than one combined "unpaid" flag —
  // "Unpaid" only ever means money owed to a farmer on a Buy, "Not
  // Received" only ever means money not yet collected from a buyer on a
  // Sell. Mixing them together made the single button ambiguous.
  const [unpaidBuysOnly, setUnpaidBuysOnly] = useState(false);
  const [notReceivedOnly, setNotReceivedOnly] = useState(false);
  const [locations, setLocations] = useState([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  const [requestTx, setRequestTx] = useState(null);
  const [payTx, setPayTx] = useState(null);
  const [editTx, setEditTx] = useState(null);
  const [cancelConfirmTx, setCancelConfirmTx] = useState(null);
  const [viewPaymentsTx, setViewPaymentsTx] = useState(null);
  const [photosTx, setPhotosTx] = useState(null);
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

  // Only HQ Admin sees every location's transactions — staff logins are
  // already scoped to their own location, so the picker only makes sense
  // (and only loads) for admins.
  useEffect(() => {
    if (isAdmin) api.getLocations().then(setLocations).catch(() => {});
  }, [isAdmin]);

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

  // Applies the Unpaid/Not Received toggles (each scoped to its own
  // transaction type) and the location picker on top of whatever the
  // All/Buy/Sell filter already loaded from the server.
  const visibleRows = useMemo(() => {
    let out = rows;
    if (unpaidBuysOnly || notReceivedOnly) {
      out = out.filter((tx) => {
        const owed = (remainingByTx[tx.id] || 0) > 0.01;
        if (!owed) return false;
        return tx.type === "BUY" ? unpaidBuysOnly : notReceivedOnly;
      });
    }
    if (selectedLocationIds.length) {
      out = out.filter((tx) => selectedLocationIds.includes(tx.location_id));
    }
    return out;
  }, [rows, unpaidBuysOnly, notReceivedOnly, remainingByTx, selectedLocationIds]);

  function exportCsv() {
    const header = ["#", "Type", "Transaction ID", "Date", "Location", "Party", "Car Plate", "Truck/Driver", "Qty (kg)", "Amount (Riel)", "Paid (Riel)", "Remaining (Riel)", "HQ Status"];
    const lines = visibleRows.map((tx, i) => {
      const remaining = remainingByTx[tx.id] || 0;
      return [i + 1, tx.type, tx.code, tx.tx_date, tx.stationName, tx.partyName, tx.car_plate || "", tx.driver_name || "", tx.quantity_kg, tx.amount, Math.max(0, (tx.total_with_tax ?? tx.amount) - remaining), remaining, tx.hq_status || "processing"];
    });
    const csv = [header, ...lines].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "transactions.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function submitRequest(reason, proposedData) {
    await api.createChangeRequest({
      transactionId: requestTx.id,
      requestedBy: session.user.id,
      locationId: profile.location_id,
      reason,
      proposedData,
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
      payDate: cambodiaDateStr(),
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
    // Setting Payment Status to "Paid" here only changes that label — it
    // doesn't by itself move any real money. If there's no payment on file
    // that actually covers the balance, record one now for the remainder,
    // the same way a Buy/Sell marked "paid" at creation already does. This
    // keeps Cash Flow and every report that reads real payments (Purchases
    // by Item, Accounts Payable/Receivable, the Balance Sheet) in sync with
    // what this Payment Status dropdown says, instead of the two drifting
    // apart.
    if (updated.payment_status === "paid") {
      const payType = editTx.type === "BUY" ? "pay_supplier" : "receive_customer";
      const alreadyPaid = payments
        .filter((p) => p.transaction_id === editTx.id && p.type === payType)
        .reduce((s, p) => s + Number(p.amount), 0);
      const stillOwed = Math.max(0, Number(updated.total_with_tax ?? updated.amount) - alreadyPaid);
      if (stillOwed > 0.01) {
        try {
          await api.createPayment({
            type: payType,
            transactionId: editTx.id,
            locationId: editTx.location_id,
            amount: stillOwed,
            method: "cash",
            payDate: cambodiaDateStr(),
            memo: "Marked paid via Edit Transaction",
            userId: session.user.id,
          });
        } catch (payErr) {
          console.error("Auto-payment record failed", payErr);
        }
      }
    }
    await api.logAudit({
      action: "edit_transaction",
      tableName: "transactions",
      recordId: editTx.id,
      oldData,
      newData: {
        party_id: updated.party_id, quantity_kg: updated.quantity_kg, price_per_kg: updated.price_per_kg, amount: updated.amount,
        payment_status: updated.payment_status, quality_grade: updated.quality_grade, tax_applicable: updated.tax_applicable,
        tax_rate: updated.tax_rate, moisture_pct: updated.moisture_pct, mixture_pct: updated.mixture_pct, outthrow_pct: updated.outthrow_pct,
        deduction_kg: updated.deduction_kg, staff_fee: updated.staff_fee, car_plate: updated.car_plate, driver_name: updated.driver_name, note: updated.note, tx_date: updated.tx_date,
      },
      userId: session.user.id,
    });
    setEditTx(null);
    load();
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar
        title={t("tx_title")}
        subtitle={
          !isAdmin
            ? t("my_location")
            : selectedLocationIds.length === 0
            ? t("all_locations")
            : selectedLocationIds.length === 1
            ? locations.find((l) => l.id === selectedLocationIds[0])?.name || t("all_locations")
            : `${selectedLocationIds.length} locations selected`
        }
      />
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
            <button onClick={() => setUnpaidBuysOnly((v) => !v)} className={`rounded-lg border px-3 py-1.5 text-sm ${unpaidBuysOnly ? "border-rose-400 bg-rose-50 text-rose-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>Unpaid (Buys)</button>
            <button onClick={() => setNotReceivedOnly((v) => !v)} className={`rounded-lg border px-3 py-1.5 text-sm ${notReceivedOnly ? "border-amber-400 bg-amber-50 text-amber-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>Not Received (Sells)</button>
            <button className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"><Filter size={14} /> {t("filter")}</button>
            {isAdmin && locations.length > 1 && (
              <LocationFilter locations={locations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
            )}
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
                <th className="px-3 py-3 font-medium">Photos</th>
                <th className="px-3 py-3 font-medium">{t("hq_confirmation")}</th>
                <th className="px-3 py-3 font-medium">{t("col_action")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((tx, i) => {
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
                    <td className="px-3 py-3 text-slate-500">{tx.tx_date}<div className="text-xs text-slate-400">{fmtTime(tx.tx_time)}</div></td>
                    <td className="px-3 py-3 text-slate-600"><div className="flex items-center gap-1"><MapPin size={12} className="text-slate-300" />{tx.stationName}</div></td>
                    <td className="px-3 py-3"><p className="font-medium text-slate-700">{tx.partyName}</p>{tx.partyIdNumber && <p className="text-xs text-slate-400">{tx.partyIdNumber}</p>}{(tx.car_plate || tx.driver_name) && <p className="text-xs text-slate-400">🚚 {[tx.driver_name, tx.car_plate].filter(Boolean).join(" · ")}</p>}</td>
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
                        isAdmin ? (
                          <button onClick={() => setPayTx(tx)} className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100">
                            <Wallet size={12} /> {fmtRiel(remaining)}
                          </button>
                        ) : (
                          <span className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1 text-xs font-medium text-amber-600" title="Only HQ Admin / Owner can record a payment against a remaining balance">
                            <Wallet size={12} /> {fmtRiel(remaining)}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-emerald-600">Settled</span>
                      )}
                    </td>
                    <td className="px-3 py-3">{tx.status === "confirmed" ? <CheckCircle2 size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-amber-500" />}</td>
                    <td className="px-3 py-3">
                      <button onClick={() => setPhotosTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-brand-300 hover:text-brand-700">
                        <Camera size={12} /> {[tx.receipt_photo_url, tx.payment_proof_url].filter(Boolean).length}
                      </button>
                    </td>
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
              {visibleRows.length === 0 && !loading && <tr><td colSpan={14} className="px-5 py-10 text-center text-sm text-slate-400">{(unpaidBuysOnly || notReceivedOnly) ? "Nothing matches — everything here is settled." : t("no_transactions")}</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
      {requestTx && <RequestChangeModal tx={requestTx} t={t} onClose={() => setRequestTx(null)} onSubmit={submitRequest} />}
      {payTx && <RecordPaymentModal tx={payTx} remaining={remainingByTx[payTx.id] || 0} t={t} onClose={() => setPayTx(null)} onSubmit={submitPayment} />}
      {editTx && <EditTransactionModal tx={editTx} userEmail={session.user.email} userId={session.user.id} t={t} onClose={() => setEditTx(null)} onSubmit={submitEdit} />}
      {viewPaymentsTx && <PaymentsModal tx={viewPaymentsTx} userEmail={session.user.email} userId={session.user.id} t={t} onClose={() => setViewPaymentsTx(null)} />}
      {photosTx && <PhotosModal tx={photosTx} onClose={() => setPhotosTx(null)} />}
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
