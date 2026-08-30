import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, CheckCircle2, AlertTriangle, Filter, MapPin, Lock, Flag, Wallet, Pencil, RotateCcw, Camera, ImageOff, Printer, WifiOff, RefreshCw, Loader2, ChevronRight, ChevronLeft, Ban, Undo2 } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import LocationFilter from "../components/LocationFilter.jsx";
import DateRangeFilter from "../components/DateRangeFilter.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { supabase, getAccurateNow } from "../supabaseClient.js";
import { onSyncStatusChange, getCachedTransactions, mergeServerTransactions, isTransactionPendingSync, getCachedPayments, mergeServerPayments, withTimeout } from "../offlineQueue.js";
import { downloadLedgerWorkbook } from "../ledgerExport.js";
import { cambodiaTimestamp } from "../reportExport.js";
import Receipt from "./Receipt.jsx";

// Bounds how long a fresh load waits on the server before giving up and
// falling back to whatever's cached on this device (see load() below) —
// without this, a connection that's technically "online" but stalled
// (weak signal, captive portal, a slow query) left this list stuck with
// nothing on screen and no explanation, since the request itself never
// resolved OR rejected. 12s is long enough that a normal, even sluggish,
// load still completes for real — same idea as withTimeout's other uses
// in this app, just longer since this is the primary data for the page,
// not a nice-to-have shortcut.
const LOAD_TIMEOUT_MS = 12000;

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
// Short date+time for the expandable row detail below (gross_at/tare_at
// are full timestamps, unlike tx_date/tx_time above) — always read as
// Cambodia wall-clock time regardless of the viewing device's own
// timezone, same reasoning as every other date helper in this file.
function fmtWeighTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}
// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting.
function cambodiaDateStr(d = getAccurateNow()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// Splits a stored gross_at/tare_at timestamp into the plain
// YYYY-MM-DD / HH:mm strings that <input type="date"> and
// <input type="time"> expect, read as Cambodia wall-clock time regardless
// of the viewing device's own timezone — same idea as splitCambodiaTimestamp
// in Receipt.jsx, just in the 24h/ISO shape these two input types need
// instead of the "23 Aug 26" / "2:31 PM" shape used for display there.
function splitCambodiaTimestampForInputs(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  // Midnight can come back as "24" from this formatter in some browsers —
  // normalize it to "00" so the <input type="time"> doesn't reject it.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}
// The reverse — a Cambodia-local date + time picked in the edit form,
// combined into the UTC ISO timestamp the database actually stores.
// Cambodia is a fixed UTC+7 with no daylight saving, so appending that
// offset directly and letting the Date constructor do the UTC conversion
// is exact, no manual hour math needed.
function combineCambodiaToISO(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}:00+07:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
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

// Same idea as resolvePartyId above, for the paddy type (product) field in
// Edit Transaction — keep the original product if untouched, reuse an
// existing product on an exact name match, or create a new one. Mirrors
// resolveProductIdOffline in offlineQueue.js (the New Buy/Sell form's own
// version of this), just as a direct online call rather than going through
// the offline queue — Edit Transaction is already an online-only,
// password-confirmed action.
async function resolveProductId(typedName, originalName, originalProductId) {
  const trimmed = (typedName || "").trim();
  if (trimmed === (originalName || "").trim()) return originalProductId;
  const all = await api.getProducts().catch(() => []);
  const exact = (all || []).find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact.id;
  const created = await api.createProduct(trimmed);
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
  const [payDate, setPayDate] = useState(cambodiaDateStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isBuy = tx.type === "BUY";

  const paying = parseFloat(amount) || 0;
  const newRemaining = Math.max(0, remaining - paying);
  const overpaying = paying > remaining;

  async function submit() {
    setError("");
    setSaving(true);
    try {
      await onSubmit(parseFloat(amount), method, memo, payDate);
    } catch (err) {
      // Without this, a dropped connection left this button saying
      // "Saving..." forever with no way to know it failed or try again.
      setError(err.message || "Couldn't save this payment — check your connection and try again.");
      setSaving(false);
    }
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

        <label className="mb-1 block text-xs text-slate-500">Payment Date</label>
        <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} max={cambodiaDateStr()}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

        <label className="mb-1 block text-xs text-slate-500">Note (optional)</label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. partial payment"
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

        {error && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40">{t("cancel")}</button>
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

function EditTransactionModal({ tx, locations = [], userEmail, userId, t, onClose, onSubmit }) {
  const isBuy = tx.type === "BUY";
  const [locationId, setLocationId] = useState(tx.location_id || "");
  const [partyQuery, setPartyQuery] = useState(tx.partyName || "");
  // tx.productName comes back as the literal string "—" (see api.js's
  // getTransactions()) when a transaction has no product_id at all, not an
  // empty string — normalize that here so the input starts genuinely blank
  // instead of showing a dash the staff member would have to notice and
  // delete first.
  const initialProductName = tx.productName && tx.productName !== "—" ? tx.productName : "";
  const [productQuery, setProductQuery] = useState(initialProductName);
  const [products, setProducts] = useState([]);
  useEffect(() => { api.getProducts().then(setProducts).catch(() => {}); }, []);
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
  const [recordedByName, setRecordedByName] = useState(tx.recorded_by_name || "");
  const [note, setNote] = useState(tx.note || "");
  const [txDate, setTxDate] = useState(tx.tx_date || cambodiaDateStr());
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [grossKg, setGrossKg] = useState(String(tx.gross_kg ?? ""));
  const [tareKg, setTareKg] = useState(String(tx.tare_kg ?? ""));
  const grossSplit = splitCambodiaTimestampForInputs(tx.gross_at);
  const tareSplit = splitCambodiaTimestampForInputs(tx.tare_at);
  const [grossInDate, setGrossInDate] = useState(grossSplit.date);
  const [grossInTime, setGrossInTime] = useState(grossSplit.time);
  const [tareOutDate, setTareOutDate] = useState(tareSplit.date);
  const [tareOutTime, setTareOutTime] = useState(tareSplit.time);

  const newAmount = Math.max(0, Math.max(0, (parseFloat(quantityKg) || 0) - (parseFloat(deductionKg) || 0)) * (parseFloat(pricePerKg) || 0) - (isBuy ? (parseFloat(staffFee) || 0) : 0));
  const canSubmit = !saving && password && partyQuery.trim() && productQuery.trim() && parseFloat(quantityKg) > 0 && parseFloat(pricePerKg) >= 0;

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
      const productId = await resolveProductId(productQuery, initialProductName, tx.product_id);
      await onSubmit({
        partyId,
        productId,
        locationId,
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
        recordedByName: recordedByName.trim() || null,
        note: note.trim() || null,
        txDate,
        grossKg: grossKg.trim() !== "" ? (parseFloat(grossKg) || 0) : null,
        tareKg: tareKg.trim() !== "" ? (parseFloat(tareKg) || 0) : null,
        grossAt: combineCambodiaToISO(grossInDate, grossInTime),
        tareAt: combineCambodiaToISO(tareOutDate, tareOutTime),
        oldData: {
          location_id: tx.location_id, stationName: tx.stationName,
          party_id: tx.party_id, partyName: tx.partyName, product_id: tx.product_id, productName: tx.productName,
          quantity_kg: tx.quantity_kg, price_per_kg: tx.price_per_kg,
          amount: tx.amount, payment_status: tx.payment_status, quality_grade: tx.quality_grade, tax_applicable: tx.tax_applicable,
          tax_rate: tx.tax_rate, moisture_pct: tx.moisture_pct, mixture_pct: tx.mixture_pct, outthrow_pct: tx.outthrow_pct,
          deduction_kg: tx.deduction_kg, staff_fee: tx.staff_fee, car_plate: tx.car_plate, driver_name: tx.driver_name,
          recorded_by_name: tx.recorded_by_name, note: tx.note, tx_date: tx.tx_date,
          gross_kg: tx.gross_kg, gross_at: tx.gross_at, tare_kg: tx.tare_kg, tare_at: tx.tare_at,
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

            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-500">{t("product")}</label>
              <input list="et-product-options" value={productQuery} onChange={(e) => setProductQuery(e.target.value)}
                placeholder="Type or pick a product"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              <datalist id="et-product-options">
                {products.map((p) => <option key={p.id} value={p.name} />)}
              </datalist>
              {productQuery.trim() && productQuery.trim() !== initialProductName.trim() && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Will be matched to an existing product with this name, or added as new, when saved.
                </p>
              )}
            </div>

            {locations.length > 0 && (
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-slate-500">Location</label>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                {locationId !== tx.location_id && (
                  <p className="mt-1 text-[11px] text-amber-600">Moving this to a different location — its stock will move too.</p>
                )}
              </div>
            )}

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
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-500">{isBuy ? "Buyer" : "Seller"} <span className="text-slate-400">(staff who recorded this)</span></label>
              <input value={recordedByName} onChange={(e) => setRecordedByName(e.target.value)} placeholder="Staff name"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              <p className="mt-1 text-[11px] text-slate-400">This is the name printed on the receipt's own "{isBuy ? "Buyer" : "Seller"}" line — not the {isBuy ? "farmer" : "buyer"} above.</p>
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

          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-medium text-slate-500">Weigh In / Weigh Out (optional — for the printed receipt)</p>
            <p className="mb-2 text-[11px] text-slate-400">Fill these in for a transaction that was typed in manually, so the receipt shows real dates, times, and weights instead of "—". Leave blank to leave the receipt as-is.</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Weigh-In (kg)</label>
                <input type="number" min="0" step="0.01" value={grossKg} onChange={(e) => setGrossKg(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">In Date</label>
                <input type="date" value={grossInDate} onChange={(e) => setGrossInDate(e.target.value)} max={cambodiaDateStr()} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">In Time</label>
                <input type="time" value={grossInTime} onChange={(e) => setGrossInTime(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Weigh-Out (kg)</label>
                <input type="number" min="0" step="0.01" value={tareKg} onChange={(e) => setTareKg(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Out Date</label>
                <input type="date" value={tareOutDate} onChange={(e) => setTareOutDate(e.target.value)} max={cambodiaDateStr()} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Out Time</label>
                <input type="time" value={tareOutTime} onChange={(e) => setTareOutTime(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              </div>
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

// `onChanged`: tells the Transactions list to reload after a payment here
// is edited — this modal keeps its own local payment history (`payments`
// state below) for speed, but the parent list's Remaining/Paid/HQ
// confirmation columns are computed from ITS OWN copy of the payments
// table (see remainingByTx), which would otherwise sit stale — showing
// "Paid" for a transaction that was just edited back to only partially
// paid — until the next full page reload. This is exactly the "changed
// the amount back and it should auto-update" case the HQ confirmation
// column is meant to handle automatically.
function PaymentsModal({ tx, userEmail, userId, t, onClose, onChanged }) {
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
      oldData: { amount: editPayment.amount },
      newData: { amount: newAmount, code: tx.code, partyName: tx.partyName },
      userId,
    });
    setEditPayment(null);
    load();
    onChanged?.();
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
                    <td className="px-3 py-2 text-slate-500">
                      {p.pay_date}
                      {p.created_at && (
                        <span className="ml-1 text-slate-400">
                          {new Date(p.created_at).toLocaleTimeString([], { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit" })}
                        </span>
                      )}
                    </td>
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
          <PhotoPane label="Seller's Bank QR Code (to pay)" url={tx.bank_qr_url} />
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
    try {
      await onSubmit(parseFloat(amount));
    } catch (err) {
      // Same "stuck on Saving..." risk as recording a new payment — if the
      // save itself fails (e.g. connection drops right after the password
      // check succeeds), show why instead of freezing the button forever.
      setError(err.message || "Couldn't save this correction — check your connection and try again.");
      setSaving(false);
      return;
    }
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

// Sell only — records the buyer's own weight/price once the truck has been
// driven off-station and weighed/settled at the buyer's place. Deliberately
// no password step here (unlike ConfirmCancelModal above): this doesn't
// destroy or exclude anything, it's just entering a number that was agreed
// somewhere else, so the friction of a password wasn't worth adding. Starts
// pre-filled with the station's own numbers — if nothing changed, Admin can
// just confirm as-is.
function ConfirmBuyerSaleModal({ tx, t, onClose, onSubmit }) {
  const [weight, setWeight] = useState(String(tx.station_quantity_kg ?? tx.quantity_kg ?? ""));
  const [price, setPrice] = useState(String(tx.station_price_per_kg ?? tx.price_per_kg ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const stationKg = Number(tx.station_quantity_kg ?? tx.quantity_kg ?? 0);
  const stationPrice = Number(tx.station_price_per_kg ?? tx.price_per_kg ?? 0);
  const buyerKg = parseFloat(weight) || 0;
  const buyerPrice = parseFloat(price) || 0;
  const deductionKg = tx.deduction_kg || 0;
  const lossKg = stationKg - buyerKg;
  const lossPct = stationKg > 0 ? (lossKg / stationKg) * 100 : 0;
  const newTotal = Math.max(0, (buyerKg - deductionKg)) * buyerPrice;

  async function submit() {
    setError("");
    setSaving(true);
    try {
      await onSubmit(buyerKg, buyerPrice);
    } catch (err) {
      setError(err.message || "Couldn't save this confirmation — check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl overflow-hidden">
        <div className="bg-gradient-to-br from-rose-600 to-rose-700 px-5 py-4 text-white">
          <h3 className="font-semibold">Confirm Buyer's Final Numbers</h3>
          <p className="text-xs text-rose-100">{tx.code} · {tx.partyName}</p>
        </div>
        <div className="p-5">
          <div className="mb-4 space-y-1 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
            <div className="flex justify-between text-slate-400"><span>Recorded at the station</span><span></span></div>
            <div className="flex justify-between"><span className="text-slate-500">Weight</span><span className="font-medium text-slate-700">{fmt2(stationKg)} kg</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Price per kg</span><span className="font-medium text-slate-700">{fmtRiel(stationPrice)}</span></div>
          </div>

          <label className="mb-1 block text-xs text-slate-500">Buyer's Final Weight (kg)</label>
          <input type="number" min="0" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} autoFocus
            className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />

          <label className="mb-1 block text-xs text-slate-500">Buyer's Final Price per kg (Riel)</label>
          <input type="number" min="0" step="1" value={price} onChange={(e) => setPrice(e.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />

          <div className={`space-y-1 rounded-lg border px-3 py-2.5 text-sm ${lossKg > 0 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-brand-100 bg-brand-50 text-brand-700"}`}>
            <div className="flex justify-between">
              <span>{lossKg >= 0 ? "Weight lost in transit" : "Weight gained"}</span>
              <span className="font-bold">{fmt2(Math.abs(lossKg))} kg{stationKg > 0 ? ` (${Math.abs(lossPct).toFixed(1)}%)` : ""}</span>
            </div>
            <div className="flex justify-between"><span>New Total</span><span className="font-bold">{fmtRiel(newTotal)}</span></div>
          </div>

          {error && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40">{t("cancel")}</button>
          <button
            disabled={saving || !weight || !price || buyerKg <= 0 || buyerPrice <= 0}
            onClick={submit}
            className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-40"
          >
            {saving ? "Saving..." : "Confirm & Update Sale"}
          </button>
        </div>
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
  // Section 37: some station PCs' mouse/trackpad can't scroll the table
  // sideways at all (no horizontal scroll wheel, no two-finger swipe), so
  // there was no way to reach the Print button even though the table is
  // technically scrollable. These two on-screen arrow buttons scroll the
  // table by clicking instead, no gesture required.
  const tableScrollRef = useRef(null);
  const scrollTable = (dir) => tableScrollRef.current?.scrollBy({ left: dir * 420, behavior: "smooth" });
  const [type, setType] = useState("");
  // Kept as two separate toggles rather than one combined "unpaid" flag —
  // "Unpaid" only ever means money owed to a farmer on a Buy, "Not
  // Received" only ever means money not yet collected from a buyer on a
  // Sell. Mixing them together made the single button ambiguous.
  const [unpaidBuysOnly, setUnpaidBuysOnly] = useState(false);
  const [notReceivedOnly, setNotReceivedOnly] = useState(false);
  const [locations, setLocations] = useState([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  // Date range filter (defaults to "All Time" — null/null) — filtered
  // locally against tx_date, same approach as the location filter below,
  // rather than round-tripping to the server for every date change.
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [exportingLedger, setExportingLedger] = useState(false);
  const [exportLedgerError, setExportLedgerError] = useState("");
  // Consolidated "Filters" popover — Unpaid (Buys), Not Received (Sells),
  // Date Range and Location all live inside it now instead of each being
  // its own button in the toolbar. None of the state or logic for any of
  // those four filters changed at all — this is purely which button
  // reveals them.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef(null);
  useEffect(() => {
    if (!filtersOpen) return;
    function onDocClick(e) {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [filtersOpen]);
  // Client-side pagination — 20 rows per page. Deliberately NOT part of
  // load() or the offline cache/merge logic above: every transaction for
  // the current type/filters is still fetched and merged exactly as
  // before, this only slices what's already loaded for display, so the
  // pagination has zero effect on what data is available or how it syncs.
  const PAGE_SIZE = 20;
  const [pageNum, setPageNum] = useState(1);
  const [requestTx, setRequestTx] = useState(null);
  const [payTx, setPayTx] = useState(null);
  const [editTx, setEditTx] = useState(null);
  const [cancelConfirmTx, setCancelConfirmTx] = useState(null);
  // Sell only — the transaction currently open in the "Confirm Buyer's
  // Final Numbers" screen (null when closed). See ConfirmBuyerSaleModal
  // above and submitConfirmBuyerSale below.
  const [confirmSaleTx, setConfirmSaleTx] = useState(null);
  const [viewPaymentsTx, setViewPaymentsTx] = useState(null);
  const [photosTx, setPhotosTx] = useState(null);
  // Reprinting a receipt for a transaction that's already been saved —
  // same Receipt component used right after finishing a ticket, just
  // opened from the list instead, for whenever a copy gets lost, smudged,
  // or a farmer/buyer needs another one later.
  const [receiptTx, setReceiptTx] = useState(null);
  const [loading, setLoading] = useState(true);
  // Whether the last attempt to reach the server actually failed (as
  // opposed to just still being in progress) — lets the page tell staff
  // "can't reach the server right now" instead of leaving them staring at
  // a spinner forever, or a blank list, with no explanation.
  const [loadError, setLoadError] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ online: true, syncing: false, pending: 0 });
  // Which rows have their detail panel open (Price/kg, Weigh In, Weigh
  // Out, etc.) — a Set so more than one row can be expanded at once,
  // independent of each other, without cluttering the already-wide table
  // with extra columns. See visibleRows.map below.
  const [expandedTxIds, setExpandedTxIds] = useState(() => new Set());
  function toggleExpand(id) {
    setExpandedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function load() {
    // Only show the big "Loading…" state the very first time — once
    // something's already on screen, a background refresh (e.g. right
    // after the offline queue finishes syncing) shouldn't make the whole
    // list flash/reload in front of someone reading it.
    if (rows.length === 0) setLoading(true);
    // No connection at all — skip straight to "couldn't reach the server"
    // instead of waiting out a request that can't succeed. But unlike
    // before, this no longer leaves the list empty: fall back to what's
    // cached on this device — both transactions from the last successful
    // load, and any Buy/Sell finalized or entered on this device that
    // hasn't synced yet (see createTransactionOffline/finalizeTicketOffline
    // in offlineQueue.js). A weigh-in that's already been finalized and
    // printed was never actually lost while offline — it just had nowhere
    // to show up on THIS list until now. The 15s retry effect below (and
    // the online/sync-triggered effects) pick a real reload back up
    // automatically the moment there's a real connection again.
    if (!navigator.onLine) {
      setRows(getCachedTransactions().filter((tx) => !type || tx.type === type));
      setPayments(getCachedPayments());
      setLoadError(true);
      setLoading(false);
      return;
    }
    try {
      // Wrapped in withTimeout (see LOAD_TIMEOUT_MS above) so a connection
      // that's stalled rather than cleanly failed still gives up and falls
      // back to cache instead of leaving this list blank indefinitely — a
      // timeout resolves to null just like the catch block below handles a
      // real error, so both paths land in the same fallback.
      const result = await withTimeout(
        Promise.all([
          api.getTransactions({ type: type || undefined }),
          api.getPayments(isAdmin ? {} : { locationId: profile?.location_id }),
        ]),
        LOAD_TIMEOUT_MS,
        null
      );
      if (!result) throw new Error("Timed out waiting for a response.");
      const [txData, payData] = result;
      // Folds the server's confirmed rows together with anything still
      // only-local on this device (see mergeServerTransactions) instead of
      // just replacing the list outright, so a transaction that finished
      // syncing a split second before this fetch ran doesn't briefly
      // disappear, and one still mid-sync isn't overwritten by a stale
      // server response that predates it. Same idea for payments, so the
      // Paid/Remaining amounts stay right too.
      setRows(mergeServerTransactions(txData));
      setPayments(mergeServerPayments(payData));
      setLoadError(false);
    } catch (err) {
      // Most likely this device has no real internet right now (or has
      // WiFi but can't actually reach the server — same thing from here).
      // Keep showing whatever was already on screen; if this is a fresh
      // load with nothing there yet, fall back to the on-device cache
      // rather than an empty list, same as the offline branch above.
      console.warn("[Transactions] load failed:", err?.message || err);
      setRows((prev) => (prev.length > 0 ? prev : getCachedTransactions().filter((tx) => !type || tx.type === type)));
      setPayments((prev) => (prev.length > 0 ? prev : getCachedPayments()));
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [type]);

  // Same pattern as the Weighing Tickets board: watch the offline sync
  // queue and refresh this list on its own once there's actually
  // something new to show, so a Buy/Sell finalized on this device (or any
  // other station) appears here the moment it really reaches the shared
  // database — nobody has to remember to reload the page.
  useEffect(() => {
    const unsub = onSyncStatusChange(setSyncStatus);
    return unsub;
  }, []);
  useEffect(() => {
    if (!syncStatus.syncing && syncStatus.pending === 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus.syncing, syncStatus.pending]);
  // And the moment the browser itself comes back online, in case the very
  // first load() above happened to fail because this page was opened
  // while offline.
  useEffect(() => {
    if (syncStatus.online && loadError) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus.online]);
  // Covers the remaining case: a one-off failed request (a slow response
  // that timed out, a brief blip) while the connection never actually
  // dropped and nothing was queued to trigger the sync-based refresh
  // above. Keep quietly retrying every 15s until a load actually
  // succeeds, same safety-net interval the offline queue itself uses.
  useEffect(() => {
    if (!loadError) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadError]);

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
    if (startDate) out = out.filter((tx) => tx.tx_date >= startDate);
    if (endDate) out = out.filter((tx) => tx.tx_date <= endDate);
    return out;
  }, [rows, unpaidBuysOnly, notReceivedOnly, remainingByTx, selectedLocationIds, startDate, endDate]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  // Jump back to page 1 whenever the underlying filter set changes — a
  // "page 3" that made sense for one filter combination is almost never
  // meaningful for the next one.
  useEffect(() => {
    setPageNum(1);
  }, [type, unpaidBuysOnly, notReceivedOnly, selectedLocationIds, startDate, endDate]);
  // Safety net for the case above missing something (e.g. a background
  // reload after a sync shrinks the list while someone's sitting on the
  // last page) — never leave pageNum pointing past the real last page.
  useEffect(() => {
    setPageNum((p) => Math.min(p, totalPages));
  }, [totalPages]);
  const pagedRows = useMemo(
    () => visibleRows.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE),
    [visibleRows, pageNum]
  );

  // Exports the "IMPORT / EXPORT" coupon-ledger workbook (grouped by
  // product, with Sub-Total/TOTAL rows) that replaces the old plain CSV —
  // modeled directly on the paper/old-system report format the station
  // already uses. Always pulls every Buy AND Sell transaction fresh from
  // the server (not just whatever's in the on-screen Buy/Sell/Unpaid tab
  // right now), since both an IMPORT and an EXPORT section are always
  // shown together — only the Location filter and Date Range filter
  // already active on this page carry over into what's exported.
  async function exportLedger() {
    setExportingLedger(true);
    setExportLedgerError("");
    try {
      const [allTxs, settings] = await Promise.all([
        api.getTransactions(),
        // api.getSettings() already resolves to a plain { key: value } map
        // (see api.js), not an array of rows — every other caller in the
        // app (Receipt.jsx, TransactionForm.jsx, WeighingTickets.jsx,
        // SettingsPage.jsx) uses it this same way. Fall back to {} on
        // failure, not [], so the lookups below never hit a non-object.
        api.getSettings().catch(() => ({})),
      ]);
      const settingsMap = settings || {};
      const companyName = settingsMap.company_name_kh || settingsMap.company_name || "PaddyTrade";
      downloadLedgerWorkbook(
        { txs: allTxs, selectedLocationIds, startDate, endDate, companyName },
        `PaddyTrade_Ledger_${cambodiaTimestamp()}.xlsx`
      );
    } catch (err) {
      setExportLedgerError(err.message || "Export failed — check your connection and try again.");
    } finally {
      setExportingLedger(false);
    }
  }

  async function submitRequest(reason, proposedData) {
    const created = await api.createChangeRequest({
      transactionId: requestTx.id,
      requestedBy: session.user.id,
      locationId: profile.location_id,
      reason,
      proposedData,
    });
    await api.logAudit({
      action: "submit_change_request",
      tableName: "change_requests",
      recordId: created.id,
      newData: { code: requestTx.code, partyName: requestTx.partyName, reason },
      userId: session.user.id,
    });
    setRequestTx(null);
  }

  async function submitPayment(amount, method, memo, payDate) {
    const created = await api.createPayment({
      type: payTx.type === "BUY" ? "pay_supplier" : "receive_customer",
      transactionId: payTx.id,
      locationId: payTx.location_id,
      amount,
      method,
      payDate: payDate || cambodiaDateStr(),
      memo,
      userId: session.user.id,
    });
    await api.logAudit({
      action: "record_payment",
      tableName: "payments",
      recordId: created.id,
      newData: { amount, method, memo: memo || null, payDate: payDate || cambodiaDateStr(), code: payTx.code, partyName: payTx.partyName, txType: payTx.type },
      userId: session.user.id,
    });
    setPayTx(null);
    load();
  }

  // Restoring a cancelled transaction — the only other thing hq_status is
  // ever used for besides "cancelled" itself (see HQ confirmation column
  // below: Processing/Paid is now always derived live from the real
  // remaining balance, never stored). Any non-"cancelled" value works here;
  // "processing" is just a clear default to leave in the database.
  async function restoreTransaction(tx) {
    setRows((prev) => prev.map((r) => (r.id === tx.id ? { ...r, hq_status: "processing" } : r)));
    try {
      await api.updateHqStatus(tx.id, "processing");
      await api.logAudit({
        action: "restore_transaction",
        tableName: "transactions",
        recordId: tx.id,
        oldData: { hq_status: "cancelled" },
        newData: { hq_status: "processing", code: tx.code, partyName: tx.partyName },
        userId: session.user.id,
      });
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
      await api.logAudit({
        action: "cancel_transaction",
        tableName: "transactions",
        recordId: tx.id,
        oldData: { hq_status: tx.hq_status || "processing" },
        newData: { hq_status: "cancelled", code: tx.code, partyName: tx.partyName, amount: tx.amount },
        userId: session.user.id,
      });
    } catch (err) {
      load();
    }
  }

  async function submitConfirmBuyerSale(buyerKg, buyerPrice) {
    const tx = confirmSaleTx;
    const updated = await api.confirmBuyerSale(tx.id, {
      quantityKg: buyerKg,
      pricePerKg: buyerPrice,
      deductionKg: tx.deduction_kg || 0,
      userId: session.user.id,
    });
    await api.logAudit({
      action: "confirm_buyer_sale",
      tableName: "transactions",
      recordId: tx.id,
      oldData: { quantity_kg: tx.quantity_kg, price_per_kg: tx.price_per_kg, amount: tx.amount, code: tx.code, partyName: tx.partyName },
      newData: { quantity_kg: updated.quantity_kg, price_per_kg: updated.price_per_kg, amount: updated.amount, station_quantity_kg: tx.station_quantity_kg, station_price_per_kg: tx.station_price_per_kg },
      userId: session.user.id,
    });
    setConfirmSaleTx(null);
    load();
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
        // Deliberately NOT caught here — swallowing this used to let the
        // edit "succeed" (the transaction now says Paid) while the actual
        // payment record silently failed to save, leaving Cash Flow and
        // Accounts Payable/Receivable quietly wrong with no sign anything
        // was off. Letting it throw surfaces the error in the modal
        // instead, same as any other save failure.
        const createdPayment = await api.createPayment({
          type: payType,
          transactionId: editTx.id,
          locationId: updated.location_id,
          amount: stillOwed,
          method: "cash",
          payDate: cambodiaDateStr(),
          memo: "Marked paid via Edit Transaction",
          userId: session.user.id,
        });
        await api.logAudit({
          action: "record_payment",
          tableName: "payments",
          recordId: createdPayment.id,
          newData: { amount: stillOwed, method: "cash", memo: "Marked paid via Edit Transaction", code: editTx.code, partyName: editTx.partyName, txType: editTx.type },
          userId: session.user.id,
        });
      }
    }
    await api.logAudit({
      action: "edit_transaction",
      tableName: "transactions",
      recordId: editTx.id,
      oldData,
      newData: {
        code: editTx.code, partyName: editTx.partyName, location_id: updated.location_id,
        party_id: updated.party_id, product_id: updated.product_id, quantity_kg: updated.quantity_kg, price_per_kg: updated.price_per_kg, amount: updated.amount,
        payment_status: updated.payment_status, quality_grade: updated.quality_grade, tax_applicable: updated.tax_applicable,
        tax_rate: updated.tax_rate, moisture_pct: updated.moisture_pct, mixture_pct: updated.mixture_pct, outthrow_pct: updated.outthrow_pct,
        deduction_kg: updated.deduction_kg, staff_fee: updated.staff_fee, car_plate: updated.car_plate, driver_name: updated.driver_name, note: updated.note, tx_date: updated.tx_date,
      },
      userId: session.user.id,
    });
    setEditTx(null);
    load();
  }

  // Drives the "Filters" button's count badge and the plain-text summary
  // next to it — purely presentational, reads the same state the four
  // filters underneath it already use.
  // Only counts what's actually inside the Filters popover now — Date
  // Range and Location are their own visible controls again, so they're
  // not part of this badge.
  const activeFilterCount = (unpaidBuysOnly ? 1 : 0) + (notReceivedOnly ? 1 : 0);

  // Page numbers to show in the pagination bar: always first, last, the
  // current page and its immediate neighbors, with "…" filling any gap —
  // avoids printing 40+ page buttons in a row on a long list.
  const pageNumbers = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - pageNum) <= 1) pageNumbers.push(p);
    else if (pageNumbers[pageNumbers.length - 1] !== "…") pageNumbers.push("…");
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
      {/* The global "unsynced changes" banner in Topbar.jsx now covers the
          general offline/syncing state on every page. This list still keeps
          its own syncStatus subscription above (for the auto-reload effect
          when a sync finishes) and its own banner just below for a load
          failure specifically, which is a different condition. */}
      {loadError && syncStatus.online && (
        <div className="flex items-center gap-2 bg-rose-50 px-6 py-2 text-xs font-medium text-rose-700">
          <WifiOff size={13} /> Couldn't reach the server just now — showing the last data loaded. Retrying automatically.
        </div>
      )}
      <main className="flex-1 overflow-y-auto p-6">
        {!isAdmin && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-gold-300 bg-gold-50 px-3 py-2 text-xs text-gold-700">
            <Lock size={14} /> {t("cannot_edit")}
          </div>
        )}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
              {[{ v: "", l: t("all") }, { v: "BUY", l: t("buy") }, { v: "SELL", l: t("sell") }].map((opt) => (
                <button key={opt.v} onClick={() => setType(opt.v)} className={`rounded-md px-4 py-1.5 text-sm font-medium ${type === opt.v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{opt.l}</button>
              ))}
            </div>

            {/* Filters popover now only holds Unpaid (Buys) / Not Received
                (Sells) — Date Range and Location are their own visible
                controls again, right next to it, same as before. */}
            <div className="relative" ref={filtersRef}>
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${filtersOpen || activeFilterCount > 0 ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <Filter size={13} /> Filters
                {activeFilterCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-slate-200 px-1 text-[10.5px] font-semibold text-slate-600">{activeFilterCount}</span>
                )}
              </button>
              {filtersOpen && (
                <div className="absolute left-0 top-full z-20 mt-2 w-max min-w-[280px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setUnpaidBuysOnly((v) => !v)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${unpaidBuysOnly ? "border-rose-400 bg-rose-50 text-rose-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>Unpaid (Buys)</button>
                    <button onClick={() => setNotReceivedOnly((v) => !v)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${notReceivedOnly ? "border-gold-300 bg-gold-50 text-gold-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>Not Received (Sells)</button>
                  </div>
                  {(unpaidBuysOnly || notReceivedOnly) && (
                    <button
                      onClick={() => { setUnpaidBuysOnly(false); setNotReceivedOnly(false); }}
                      className="mt-2 text-xs font-medium text-slate-400 hover:text-slate-600"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>

            <DateRangeFilter startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
            {isAdmin && locations.length > 1 && (
              <LocationFilter locations={locations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportLedger} disabled={exportingLedger} title={exportingLedger ? "Exporting..." : t("export_ledger")} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {exportingLedger ? <Loader2 size={15} className="animate-spin text-slate-400" /> : <Download size={15} />}
            </button>
            <button onClick={() => setPage("new-buy")} className="flex items-center gap-2 rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"><Plus size={14} /> {t("new_buy")}</button>
            <button onClick={() => setPage("new-sell")} className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"><Plus size={14} /> {t("new_sell")}</button>
          </div>
        </div>
        {exportLedgerError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
            <span>{exportLedgerError}</span>
            <button onClick={exportLedger} className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        )}

        <div className="mb-2 flex items-center justify-end gap-2">
          <span className="text-xs text-slate-400">Can't scroll with your mouse? Use these:</span>
          <button onClick={() => scrollTable(-1)} title="Scroll table left" className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => scrollTable(1)} title="Scroll table right" className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
            <ChevronRight size={16} />
          </button>
        </div>

        <div ref={tableScrollRef} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {/* Section 36: per request, went back to this table's original
                  format instead of the merged 9-column layout (section 34) or
                  the card layout (section 35). Only 3 changes from the
                  original: Transaction ID no longer has its own column — it's
                  stacked below the Type badge; Photos no longer has its own
                  column — it's stacked below the HQ Confirmation pill; the
                  Status column (the confirmed/needs-attention icon) is
                  removed entirely (the icon isn't shown anywhere anymore). */}
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                <th className="w-8 px-2 py-3"></th>
                <th className="px-5 py-3 font-semibold">#</th>
                <th className="px-3 py-3 font-semibold">Ticket #</th>
                <th className="px-3 py-3 font-semibold">Type</th>
                <th className="px-3 py-3 font-semibold">{t("col_date")}</th>
                <th className="px-3 py-3 font-semibold">{t("col_station")}</th>
                <th className="px-3 py-3 font-semibold">{t("col_party")}</th>
                <th className="px-3 py-3 font-semibold">{t("col_qty")}</th>
                <th className="px-3 py-3 font-semibold">{t("col_amount")}</th>
                <th className="px-3 py-3 font-semibold">Paid</th>
                <th className="px-3 py-3 font-semibold">Remaining</th>
                <th className="px-3 py-3 font-semibold">{t("hq_confirmation")}</th>
                <th className="px-3 py-3 font-semibold">{t("col_action")}</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((tx, i) => {
                const isCancelled = (tx.hq_status || "processing") === "cancelled";
                const remaining = remainingByTx[tx.id] || 0;
                // Processing vs Paid is no longer something anyone picks —
                // it's the real remaining balance talking. A payment
                // recorded, edited, or removed changes `remaining` (via
                // remainingByTx above, which reads straight from the
                // payments table), so this is always correct the moment
                // the page reloads, with no separate flag that can drift
                // out of sync with what was actually paid.
                const hqStatus = isCancelled ? "cancelled" : remaining <= 0.01 ? "paid" : "processing";
                const isBuy = tx.type === "BUY";
                const isExpanded = expandedTxIds.has(tx.id);
                // Buy weighs the truck in loaded, out empty; Sell weighs it
                // in empty, out loaded (see ledgerExport.js's buildRow and
                // api.js's finalizeTicket for the same reasoning) — label
                // each weighing accordingly rather than always saying
                // "in"/"out" with no context.
                const payableKg = Math.max(0, (tx.quantity_kg || 0) - (tx.deduction_kg || 0));
                return (
                  <Fragment key={tx.id}>
                  <tr className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${isCancelled ? "opacity-50" : ""}`}>
                    <td className="px-2 py-3.5">
                      <button onClick={() => toggleExpand(tx.id)} title={isExpanded ? "Hide details" : "Show weigh-in, weigh-out & price details"}
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-brand-600">
                        <ChevronRight size={15} className={`transition-transform ${isExpanded ? "rotate-90 text-brand-600" : ""}`} />
                      </button>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">{(pageNum - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-3 py-3.5">
                      {/* Ticket # — the paper ticket number staff actually
                          write on and search by, now its own column instead
                          of buried under the Type badge. The RCP-xxx receipt
                          code moved down here as a small secondary line;
                          falls back to the receipt code alone on any older
                          row saved before paper_ticket_no was captured. */}
                      {tx.paper_ticket_no ? (
                        <>
                          <div className="font-bold text-slate-800">{tx.paper_ticket_no}</div>
                          <div className="text-xs text-slate-400">{tx.code}</div>
                        </>
                      ) : (
                        <div className="font-bold text-slate-800">{tx.code}</div>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={`flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${tx.type === "BUY" ? "bg-brand-100 text-brand-700" : "bg-rose-100 text-rose-700"}`}>
                        {tx.type === "BUY" ? "▲ BUY" : "▼ SELL"}
                      </span>
                      {isTransactionPendingSync(tx.id) && (
                        <span title="Saved on this device, still waiting to sync to PaddyTrade's shared database" className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200">
                          <RefreshCw size={9} /> Not synced
                        </span>
                      )}
                      {tx.station_quantity_kg != null && (
                        tx.buyer_confirmed_at ? (
                          <span title="The buyer's final weight/price were confirmed and are what's used everywhere else" className="ml-1 flex w-fit items-center gap-1 rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                            ✓ Confirmed
                          </span>
                        ) : (
                          <span title="Recorded at the station only — still waiting on the buyer's own weight/price" className="ml-1 flex w-fit items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            ⏳ Pending buyer confirmation
                          </span>
                        )
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-500">{tx.tx_date}<div className="text-xs text-slate-400">{fmtTime(tx.tx_time)}</div></td>
                    <td className="px-3 py-3 text-slate-600"><div className="flex items-center gap-1"><MapPin size={12} className="text-slate-300" />{tx.stationName}</div></td>
                    <td className="px-3 py-3"><p className="font-medium text-slate-700">{tx.partyName}</p>{tx.partyIdNumber && <p className="text-xs text-slate-400">{tx.partyIdNumber}</p>}{(tx.car_plate || tx.driver_name) && <p className="text-xs text-slate-400">🚚 {[tx.driver_name, tx.car_plate].filter(Boolean).join(" · ")}</p>}{tx.recorded_by_name && <p className="text-xs text-slate-400">{tx.type === "BUY" ? "Buyer" : "Seller"}: {tx.recorded_by_name}</p>}</td>
                    <td className="px-3 py-3 text-slate-700">{fmt2(tx.quantity_kg)}</td>
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {fmtRiel(tx.total_with_tax ?? tx.amount)}
                      {tx.tax_applicable && <p className="text-[10px] font-normal text-slate-400">incl. {tx.tax_rate}% VAT</p>}
                    </td>
                    <td className="px-3 py-3.5">
                      <button onClick={() => setViewPaymentsTx(tx)} className="font-medium text-brand-600 underline decoration-dotted hover:text-brand-700">
                        {fmtRiel(Math.max(0, (tx.total_with_tax ?? tx.amount) - remaining))}
                      </button>
                    </td>
                    <td className="px-3 py-3.5">
                      {isCancelled ? (
                        <span className="text-xs text-slate-400">Excluded from reports</span>
                      ) : remaining > 0.01 ? (
                        isAdmin ? (
                          <button onClick={() => setPayTx(tx)} className="flex items-center gap-1 rounded-md border border-gold-300 bg-gold-50 px-2 py-1 text-xs font-medium text-gold-700 hover:bg-gold-100">
                            <Wallet size={12} /> {fmtRiel(remaining)}
                          </button>
                        ) : (
                          <span className="flex items-center gap-1 rounded-md border border-gold-100 bg-gold-50/60 px-2 py-1 text-xs font-medium text-gold-700" title="Only HQ Admin / Owner can record a payment against a remaining balance">
                            <Wallet size={12} /> {fmtRiel(remaining)}
                          </span>
                        )
                      ) : (
                        <span className="text-xs font-medium text-brand-600">Settled</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span title={isCancelled ? "" : "Follows the Remaining balance automatically — Settled means Paid, anything owed means Processing."}
                        className={`flex w-fit items-center rounded-md border px-2 py-1 text-xs font-medium ${HQ_STATUS_STYLES[hqStatus]}`}>
                        {t(`hq_${hqStatus}`)}
                      </span>
                      <button onClick={() => setPhotosTx(tx)} className="mt-1 flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-brand-300 hover:text-brand-700">
                        <Camera size={12} /> {[tx.receipt_photo_url, tx.payment_proof_url, tx.bank_qr_url].filter(Boolean).length}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setReceiptTx(tx)} title="View / print receipt" className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-brand-300 hover:text-brand-700">
                          <Printer size={12} /> Receipt
                        </button>
                        {isAdmin ? (
                          <button onClick={() => setEditTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-brand-300 hover:text-brand-700">
                            <Pencil size={12} /> Edit
                          </button>
                        ) : (
                          <button onClick={() => setRequestTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-amber-300 hover:text-amber-600">
                            <Flag size={12} /> {t("request_change")}
                          </button>
                        )}
                        {isAdmin && !isCancelled && tx.station_quantity_kg != null && !tx.buyer_confirmed_at && (
                          <button onClick={() => setConfirmSaleTx(tx)} title="Record the buyer's own weight/price once the truck has been settled at the buyer's place" className="flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100">
                            <CheckCircle2 size={12} /> Confirm Sale
                          </button>
                        )}
                        {isAdmin && (
                          isCancelled ? (
                            <button onClick={() => restoreTransaction(tx)} title="Un-cancel — bring this transaction back into reports and the ledger" className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-emerald-300 hover:text-emerald-700">
                              <Undo2 size={12} /> Restore
                            </button>
                          ) : (
                            <button onClick={() => setCancelConfirmTx(tx)} title="Cancel this transaction — excludes it from reports and the ledger" className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-rose-300 hover:text-rose-600">
                              <Ban size={12} /> Cancel
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-slate-50 bg-slate-50/70">
                      <td></td>
                      <td colSpan={11} className="px-5 py-4">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                          <div>
                            <p className="text-[10.5px] uppercase tracking-wide text-slate-400">Price / kg</p>
                            {tx.price_per_kg != null ? (
                              <p className="text-sm font-semibold text-slate-800">{fmtRiel(tx.price_per_kg)}</p>
                            ) : (
                              <p className="text-sm font-medium text-slate-400">Not set yet</p>
                            )}
                          </div>
                          <div>
                            <p className="text-[10.5px] uppercase tracking-wide text-slate-400">Weigh In {isBuy ? "(loaded)" : "(empty)"}</p>
                            {tx.gross_kg != null ? (
                              <>
                                <p className="text-sm font-semibold text-slate-800">{fmt2(tx.gross_kg)} kg</p>
                                {tx.gross_at && <p className="text-xs text-slate-400">{fmtWeighTime(tx.gross_at)}</p>}
                              </>
                            ) : (
                              <p className="text-sm font-medium text-slate-400">Not recorded (entered manually)</p>
                            )}
                          </div>
                          <div>
                            <p className="text-[10.5px] uppercase tracking-wide text-slate-400">Weigh Out {isBuy ? "(empty)" : "(loaded)"}</p>
                            {tx.tare_kg != null ? (
                              <>
                                <p className="text-sm font-semibold text-slate-800">{fmt2(tx.tare_kg)} kg</p>
                                {tx.tare_at && <p className="text-xs text-slate-400">{fmtWeighTime(tx.tare_at)}</p>}
                              </>
                            ) : (
                              <p className="text-sm font-medium text-slate-400">Not recorded (entered manually)</p>
                            )}
                          </div>
                          <div>
                            <p className="text-[10.5px] uppercase tracking-wide text-slate-400">Net Weight</p>
                            <p className="text-sm font-semibold text-slate-800">{fmt2(tx.quantity_kg)} kg</p>
                          </div>
                          {(tx.deduction_kg || 0) > 0 && (
                            <>
                              <div>
                                <p className="text-[10.5px] uppercase tracking-wide text-slate-400">Deduction</p>
                                <p className="text-sm font-semibold text-slate-800">{fmt2(tx.deduction_kg)} kg</p>
                              </div>
                              <div>
                                <p className="text-[10.5px] uppercase tracking-wide text-slate-400">Payable Weight</p>
                                <p className="text-sm font-semibold text-slate-800">{fmt2(payableKg)} kg</p>
                              </div>
                            </>
                          )}
                          <div>
                            <p className="text-[10.5px] uppercase tracking-wide text-slate-400">Truck</p>
                            <p className="text-sm font-semibold text-slate-800">{tx.car_plate || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10.5px] uppercase tracking-wide text-slate-400">Recorded By</p>
                            <p className="text-sm font-semibold text-slate-800">{tx.recorded_by_name || "—"}</p>
                          </div>
                        </div>
                        {tx.station_quantity_kg != null && (() => {
                          const stationKg = Number(tx.station_quantity_kg);
                          const buyerKg = Number(tx.quantity_kg);
                          const lossKg = stationKg - buyerKg;
                          const lossPct = stationKg > 0 ? (lossKg / stationKg) * 100 : 0;
                          return (
                            <div className="mt-4 border-t border-slate-200 pt-3">
                              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                                {tx.buyer_confirmed_at ? "Station vs. Buyer — confirmed" : "Station vs. Buyer — awaiting buyer confirmation"}
                              </p>
                              <div className="grid grid-cols-3 gap-4 rounded-lg border border-slate-200 bg-white p-3">
                                <div>
                                  <p className="text-[10.5px] uppercase tracking-wide text-slate-400">Station Recorded</p>
                                  <p className="text-sm font-bold text-slate-800">{fmt2(stationKg)} kg</p>
                                  <p className="text-xs text-slate-500">{fmtRiel(tx.station_price_per_kg)}/kg</p>
                                </div>
                                <div>
                                  <p className="text-[10.5px] uppercase tracking-wide text-slate-400">Buyer Confirmed{tx.buyer_confirmed_at ? " (official)" : ""}</p>
                                  {tx.buyer_confirmed_at ? (
                                    <>
                                      <p className="text-sm font-bold text-slate-800">{fmt2(buyerKg)} kg</p>
                                      <p className="text-xs text-slate-500">{fmtRiel(tx.price_per_kg)}/kg</p>
                                    </>
                                  ) : (
                                    <p className="text-sm font-medium text-slate-400">Not confirmed yet</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-[10.5px] uppercase tracking-wide text-slate-400">{lossKg >= 0 ? "Lost in Transit" : "Gained"}</p>
                                  {tx.buyer_confirmed_at ? (
                                    <>
                                      <p className="text-sm font-bold text-rose-600">{fmt2(Math.abs(lossKg))} kg</p>
                                      <p className="text-xs text-rose-500">{Math.abs(lossPct).toFixed(1)}%</p>
                                    </>
                                  ) : (
                                    <p className="text-sm font-medium text-slate-400">—</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
              {pagedRows.length === 0 && loading && <tr><td colSpan={13} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {pagedRows.length === 0 && !loading && <tr><td colSpan={13} className="px-5 py-10 text-center text-sm text-slate-400">{(unpaidBuysOnly || notReceivedOnly) ? "Nothing matches — everything here is settled." : t("no_transactions")}</td></tr>}
            </tbody>
          </table>
        </div>

        {visibleRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-4 text-sm text-slate-500">
            <div>
              Showing <span className="font-semibold text-slate-800">{(pageNum - 1) * PAGE_SIZE + 1}–{Math.min(pageNum * PAGE_SIZE, visibleRows.length)}</span> of{" "}
              <span className="font-semibold text-slate-800">{visibleRows.length}</span> transactions
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPageNum((p) => Math.max(1, p - 1))}
                  disabled={pageNum === 1}
                  className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-slate-200 bg-white ${pageNum === 1 ? "text-slate-300" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  <ChevronLeft size={14} />
                </button>
                {pageNumbers.map((p, idx) =>
                  p === "…" ? (
                    <span key={`ellipsis-${idx}`} className="flex h-[30px] w-[30px] items-center justify-center text-slate-300">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPageNum(p)}
                      className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg text-sm font-medium ${p === pageNum ? "bg-brand-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  onClick={() => setPageNum((p) => Math.min(totalPages, p + 1))}
                  disabled={pageNum === totalPages}
                  className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-slate-200 bg-white ${pageNum === totalPages ? "text-slate-300" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </main>
      {requestTx && <RequestChangeModal tx={requestTx} t={t} onClose={() => setRequestTx(null)} onSubmit={submitRequest} />}
      {payTx && <RecordPaymentModal tx={payTx} remaining={remainingByTx[payTx.id] || 0} t={t} onClose={() => setPayTx(null)} onSubmit={submitPayment} />}
      {editTx && <EditTransactionModal tx={editTx} locations={locations} userEmail={session.user.email} userId={session.user.id} t={t} onClose={() => setEditTx(null)} onSubmit={submitEdit} />}
      {viewPaymentsTx && <PaymentsModal tx={viewPaymentsTx} userEmail={session.user.email} userId={session.user.id} t={t} onClose={() => setViewPaymentsTx(null)} onChanged={load} />}
      {photosTx && <PhotosModal tx={photosTx} onClose={() => setPhotosTx(null)} />}
      {receiptTx && (
        <div className="fixed inset-0 z-50 bg-white">
          <Receipt tx={receiptTx} onDone={() => setReceiptTx(null)} />
        </div>
      )}
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
      {confirmSaleTx && (
        <ConfirmBuyerSaleModal
          tx={confirmSaleTx}
          t={t}
          onClose={() => setConfirmSaleTx(null)}
          onSubmit={submitConfirmBuyerSale}
        />
      )}
    </div>
  );
}
