import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, CheckCircle2, AlertTriangle, Filter, MapPin, Lock, Flag, Wallet, Pencil, RotateCcw, Camera, ImageOff, Printer, WifiOff, RefreshCw, Loader2, ChevronRight, ChevronLeft, Ban, Undo2, Search, X } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import LocationFilter from "../components/LocationFilter.jsx";
import DateRangeFilter from "../components/DateRangeFilter.jsx";
// [2026-09-09] Marks a figure that was corrected after the ticket was
// finished, so it no longer looks identical to one straight off the scale.
import EditedBadge from "../components/EditedBadge.jsx";
import { api, normalizePaperTicketNo } from "../api.js";
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
  const [paperTicketNo, setPaperTicketNo] = useState(tx.paper_ticket_no || "");
  const [recordedByName, setRecordedByName] = useState(tx.recorded_by_name || "");
  const [note, setNote] = useState(tx.note || "");
  const [txDate, setTxDate] = useState(tx.tx_date || cambodiaDateStr());
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // [2026-09-04] This screen is what actually produced the real PONG RO
  // duplicates (PR000127, then PR000209) — it's the only place a paper
  // ticket number gets typed in with no live check at all, unlike the
  // ticket board (see WeighingTickets.jsx's own Entry Sanity Check). Adds
  // the same kind of "heads up, already used" warning here, but
  // non-blocking — saving always still goes through either way (see
  // checkAndFlagPaperTicketDuplicate in api.js), this is only the chance
  // to catch it before saving.
  const [dupWarning, setDupWarning] = useState(null);

  const [grossKg, setGrossKg] = useState(String(tx.gross_kg ?? ""));
  const [tareKg, setTareKg] = useState(String(tx.tare_kg ?? ""));
  const grossSplit = splitCambodiaTimestampForInputs(tx.gross_at);
  const tareSplit = splitCambodiaTimestampForInputs(tx.tare_at);
  const [grossInDate, setGrossInDate] = useState(grossSplit.date);
  const [grossInTime, setGrossInTime] = useState(grossSplit.time);
  const [tareOutDate, setTareOutDate] = useState(tareSplit.date);
  const [tareOutTime, setTareOutTime] = useState(tareSplit.time);

  // [2026-09-03] Weigh-In/Weigh-Out (grossKg/tareKg — added earlier so a
  // manually-entered transaction's receipt could show real scale numbers)
  // and Quantity/Net Weight (quantityKg — what the Total Amount is
  // actually computed from) used to be two completely independent
  // fields, edited separately, with nothing keeping them in sync.
  // Correcting a mis-typed Weigh-Out here silently left Quantity (and the
  // Total Amount computed from it) stale — exactly the bug reported live:
  // editing Weigh-Out from 7070 to 7030 changed what the receipt's
  // Weigh-Out row shows, but Net Weight/Total Amount kept using the old
  // 7070 figure since nothing ever told them to recompute.
  // Net weight is always the truck's loaded weight minus its empty
  // weight (direction depends on Buy vs Sell, same as WeighingTickets.jsx's
  // own live net-weight calc) — so whenever both are filled in, Quantity
  // is now derived from them automatically instead of being a second,
  // separately-typed number that can drift out of step. It stays freely
  // editable, as before, whenever either one is left blank (a fully
  // manual entry with no real scale data at all).
  // [2026-09-08] Never for a Sell the buyer has already confirmed: its
  // quantity is the buyer's figure, not the station's weights, and this
  // effect used to silently snap it back to gross/tare on open (audit #5).
  const buyerConfirmed = !!tx.buyer_confirmed_at;
  useEffect(() => {
    if (buyerConfirmed) return;
    const g = parseFloat(grossKg);
    const w = parseFloat(tareKg);
    if (grossKg.trim() === "" || tareKg.trim() === "" || isNaN(g) || isNaN(w)) return;
    const net = Math.max(0, isBuy ? g - w : w - g);
    setQuantityKg(net.toFixed(2));
  }, [grossKg, tareKg, isBuy, buyerConfirmed]);

  const netIsDerived = !buyerConfirmed && grossKg.trim() !== "" && tareKg.trim() !== "" && !isNaN(parseFloat(grossKg)) && !isNaN(parseFloat(tareKg));

  const newAmount = Math.max(0, Math.max(0, (parseFloat(quantityKg) || 0) - (parseFloat(deductionKg) || 0)) * (parseFloat(pricePerKg) || 0) - (isBuy ? (parseFloat(staffFee) || 0) : 0));
  const canSubmit = !saving && password && partyQuery.trim() && productQuery.trim() && parseFloat(quantityKg) > 0 && parseFloat(pricePerKg) >= 0;

  async function submit(e) {
    e.preventDefault();
    setError("");
    // Live duplicate check — only when the number is actually being
    // changed to something new (not just re-saving the same number this
    // transaction already had). Uses the transactions table specifically
    // (see findTransactionByPaperTicketNo in api.js), since that's the
    // table this screen actually writes to.
    const trimmedTicketNo = normalizePaperTicketNo(paperTicketNo) || "";
    const originalTrimmed = normalizePaperTicketNo(tx.paper_ticket_no) || "";
    if (trimmedTicketNo && trimmedTicketNo.toLowerCase() !== originalTrimmed.toLowerCase()) {
      let dupMatch = null;
      try {
        dupMatch = await withTimeout(
          // [2026-09-12] Both tables — a number already on a weighbridge
          // ticket could be typed in here with nothing said. See
          // findAnyByPaperTicketNo in api.js.
          api.findAnyByPaperTicketNo({ locationId: locationId || tx.location_id, paperTicketNo: trimmedTicketNo, excludeTransactionId: tx.id }),
          3500,
          null
        );
      } catch {
        dupMatch = null;
      }
      if (dupMatch) {
        setDupWarning({ ticketNo: trimmedTicketNo, match: dupMatch });
        return;
      }
    }
    await doSave();
  }

  // [2026-09-04] Split out of submit() so "Save anyway" on the duplicate
  // warning below can go straight to the actual save (password prompt
  // included) without re-running the check that already found the match
  // being saved over.
  async function doSave() {
    setSaving(true);
    setError("");
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
        type: tx.type,
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
        paperTicketNo: paperTicketNo.trim() || null,
        recordedByName: recordedByName.trim() || null,
        note: note.trim() || null,
        txDate,
        grossKg: grossKg.trim() !== "" ? (parseFloat(grossKg) || 0) : null,
        tareKg: tareKg.trim() !== "" ? (parseFloat(tareKg) || 0) : null,
        grossAt: combineCambodiaToISO(grossInDate, grossInTime),
        tareAt: combineCambodiaToISO(tareOutDate, tareOutTime),
        // Tells updateTransaction not to re-derive quantity from the
        // weights for a buyer-confirmed Sell (see the effect above).
        keepQuantity: buyerConfirmed,
        oldData: {
          location_id: tx.location_id, stationName: tx.stationName,
          party_id: tx.party_id, partyName: tx.partyName, product_id: tx.product_id, productName: tx.productName,
          quantity_kg: tx.quantity_kg, price_per_kg: tx.price_per_kg,
          amount: tx.amount, payment_status: tx.payment_status, quality_grade: tx.quality_grade, tax_applicable: tx.tax_applicable,
          tax_rate: tx.tax_rate, moisture_pct: tx.moisture_pct, mixture_pct: tx.mixture_pct, outthrow_pct: tx.outthrow_pct,
          deduction_kg: tx.deduction_kg, staff_fee: tx.staff_fee, car_plate: tx.car_plate, driver_name: tx.driver_name,
          paper_ticket_no: tx.paper_ticket_no,
          recorded_by_name: tx.recorded_by_name, note: tx.note, tx_date: tx.tx_date,
          gross_kg: tx.gross_kg, gross_at: tx.gross_at, tare_kg: tx.tare_kg, tare_at: tx.tare_at,
        },
      });
      setDupWarning(null);
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

            <div className="col-span-2 rounded-lg border border-dashed border-brand-300 bg-brand-50/50 p-2.5">
              <label className="mb-1 block text-xs text-slate-500">Paper Ticket Number</label>
              <input value={paperTicketNo} onChange={(e) => { setPaperTicketNo(e.target.value); setDupWarning(null); }} placeholder="e.g. CN000157"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              <p className="mt-1 text-[11px] text-slate-500">The number printed on the physical quality ticket booklet. Leave blank if this transaction never had one.</p>
              {dupWarning && (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
                  <p className="text-xs text-amber-800">
                    <strong>Heads up:</strong> "{dupWarning.ticketNo}" is already recorded here{dupWarning.match?.party_name ? ` for ${dupWarning.match.party_name}` : ""}
                    {dupWarning.match?.created_at ? ` on ${new Date(dupWarning.match.created_at).toLocaleDateString()}` : ""}. Double-check the paper slip — if it's really the same number twice, you can still save; it'll be flagged for an admin to look into.
                  </p>
                  <button type="button" disabled={saving} onClick={doSave}
                    className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60">
                    {saving ? "Saving…" : "Save anyway"}
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">
                Quantity (kg) / Net Weight
                {netIsDerived && <span className="ml-1 font-normal text-brand-600">(from Weigh In/Out below)</span>}
              </label>
              <input type="number" min="0" step="0.01" value={quantityKg} onChange={(e) => setQuantityKg(e.target.value)}
                readOnly={netIsDerived}
                title={netIsDerived ? "Calculated from Weigh-In and Weigh-Out below. Edit those two fields to change this, or clear one of them to type this in manually." : undefined}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 ${netIsDerived ? "border-slate-200 bg-slate-50 text-slate-600" : "border-slate-200"}`} />
              {netIsDerived && (
                <p className="mt-1 text-[11px] text-slate-400">Calculated automatically from Weigh-In and Weigh-Out below (Net Weight = {isBuy ? "Weigh-In − Weigh-Out" : "Weigh-Out − Weigh-In"}). Clear either weight field below to type this in manually instead.</p>
              )}
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
            <p className="mb-2 text-[11px] text-slate-400">Fill these in for a transaction that was typed in manually, so the receipt shows real dates, times, and weights instead of "—". Leave blank to leave the receipt as-is. Whenever both are filled in, Quantity/Net Weight above is calculated from them automatically — edit the weights here rather than Quantity directly, so they never disagree.</p>
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
  const [voidPaymentTx, setVoidPayment] = useState(null);

  // [2026-09-09] includeVoided: a voided payment must not COUNT anywhere,
  // but it must still be visible here — that is the difference between
  // voiding and deleting. It shows greyed out with its reason, so the
  // history reads as what actually happened rather than as if the payment
  // never existed.
  async function load() {
    setLoading(true);
    const data = await api.getPaymentsForTransaction(tx.id, { includeVoided: true });
    setPayments(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function voidPayment(payment, reason) {
    await api.voidPayment(payment.id, reason);
    await api.logAudit({
      action: "void_payment", tableName: "payments", recordId: payment.id,
      oldData: { amount: payment.amount, voided_at: null },
      newData: { amount: payment.amount, voided_reason: reason, code: tx.code, partyName: tx.partyName },
      userId,
    });
    setVoidPayment(null);
    await load();
    onChanged?.();
  }

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
                {payments.map((p) => {
                  const voided = !!p.voided_at;
                  // A payment voided because its transaction was cancelled is
                  // the trigger's to own — it comes back by itself if the
                  // transaction is restored, so it must not be un-voided by
                  // hand here.
                  const byCancel = p.voided_reason === "Transaction cancelled";
                  return (
                    <tr key={p.id} className={`border-b border-slate-50 last:border-0 ${voided ? "bg-slate-50/70" : ""}`}>
                      <td className="px-3 py-2 text-slate-500">
                        {p.pay_date}
                        {p.created_at && (
                          <span className="ml-1 text-slate-400">
                            {new Date(p.created_at).toLocaleTimeString([], { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit" })}
                          </span>
                        )}
                        {voided && (
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            <span className="font-semibold text-slate-500">Voided</span>
                            {p.voided_reason ? ` — ${p.voided_reason}` : ""}
                          </div>
                        )}
                      </td>
                      <td className={`px-3 py-2 font-medium ${voided ? "text-slate-400 line-through" : "text-slate-800"}`}>{fmtRiel(p.amount)}</td>
                      <td className={`px-3 py-2 ${voided ? "text-slate-400" : "text-slate-500"}`}>{p.createdByName}</td>
                      <td className="px-3 py-2 text-right">
                        {voided ? (
                          byCancel ? (
                            <span className="text-[11px] text-slate-400">comes back if restored</span>
                          ) : (
                            <button onClick={() => api.unvoidPayment(p.id).then(() => { load(); onChanged?.(); })}
                              className="text-[11px] font-medium text-slate-400 hover:text-brand-600">Undo void</button>
                          )
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditPayment(p)} title="Correct the amount" className="text-slate-400 hover:text-brand-600"><Pencil size={13} /></button>
                            <button onClick={() => setVoidPayment(p)} title="This payment should not exist" className="text-slate-400 hover:text-rose-600"><Ban size={13} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
      {voidPaymentTx && (
        <VoidPaymentModal payment={voidPaymentTx} onClose={() => setVoidPayment(null)} onSubmit={(reason) => voidPayment(voidPaymentTx, reason)} />
      )}
    </div>
  );
}

// [2026-09-09] Voiding a payment, as opposed to correcting its amount.
//
// Two different mistakes, two different fixes:
//   Edit  — the payment happened, the number is wrong.
//   Void  — the payment should not exist at all: entered twice, or against
//           the wrong transaction.
//
// Voiding was previously done by editing the amount to zero, which left a
// meaningless zero row and no record of why. A voided payment now stays
// visible with its reason, stops counting everywhere, and can be undone.
function VoidPaymentModal({ payment, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) { setError("Please say why — it is kept on the record."); return; }
    setBusy(true); setError("");
    try { await onSubmit(reason.trim()); }
    catch (err) { setError(err.message || "Could not void this payment."); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700">
          <Ban size={16} className="text-rose-500" /> Void this payment
        </h3>
        <p className="mb-3 text-xs text-slate-400">
          {fmtRiel(payment.amount)} · {payment.pay_date}
        </p>
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
          It stops counting towards what has been paid, and leaves Cash Flow. It is not deleted —
          it stays here with your reason, and you can undo it.
          <span className="mt-1.5 block text-slate-500">
            If the payment did happen and only the amount is wrong, use the pencil to correct it instead.
          </span>
        </div>
        <form onSubmit={submit}>
          <label className="mb-1 block text-xs text-slate-500">Why? <span className="text-rose-500">*</span></label>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} autoFocus rows={2}
            placeholder="e.g. Entered twice by mistake"
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
          />
          {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={busy || !reason.trim()} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
              {busy ? "Voiding…" : "Void payment"}
            </button>
          </div>
        </form>
      </div>
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

// ---- Station check (2026-09-07) --------------------------------------------
// Every station PC keeps its own daily log of finished tickets, written by
// the scale program the instant a receipt prints (PaddyTrade_Logs\<date>.csv
// in the weighbridge folder — see relay.js there). This reads that file and
// compares it, ticket by ticket, against what the system actually holds:
//   missing   — on the station's log, not in the system (a lost save)
//   mismatch  — in both, but kg or amount differ (a mix-up / later edit)
//   doubled   — the system holds more than one live transaction for the
//               same paper ticket number at that station (a duplicate)
// Codes match on the log's transaction_code OR server_code (the server can
// answer a retry with the row it already had), then on paper number + kg.
function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const header = (rows.shift() || []).map((h) => h.trim());
  return rows.filter((r) => r.some((v) => v !== "")).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function StationCheckModal({ allRows, loadError, locations, onClose }) {
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  // [2026-09-12] allRows is null until every transaction has actually
  // been downloaded. Comparing a station's CSV against a partial list
  // reports tickets as missing that are not missing at all, which is the
  // opposite of what this tool is for — so it refuses to run rather than
  // answer from incomplete data.
  const ready = Array.isArray(allRows);
  const norm = (v) => normalizePaperTicketNo(v) || "";
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; };

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(""); setResult(null); setFileName(file.name);
    if (!ready) {
      setError("Still loading every transaction to check against — wait a moment and choose the file again.");
      return;
    }
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length || !("transaction_code" in rows[0])) {
        setError("This doesn't look like a station log — expected a file from the weighbridge folder's PaddyTrade_Logs, e.g. 2026-09-07.csv.");
        return;
      }
      const live = allRows.filter((tx) => tx.hq_status !== "cancelled");
      const byCode = new Map(live.map((tx) => [tx.code, tx]));
      const missing = [], mismatch = [], ok = [];
      for (const r of rows) {
        let tx = byCode.get(r.transaction_code) || (r.server_code && byCode.get(r.server_code)) || null;
        if (!tx && r.paper_ticket_no) {
          const pn = norm(r.paper_ticket_no), kg = num(r.net_kg);
          tx = live.find((x) => norm(x.paper_ticket_no) === pn && kg != null && Math.abs((x.quantity_kg || 0) - kg) < 0.01) || null;
        }
        if (!tx) { missing.push(r); continue; }
        const kg = num(r.net_kg), amt = num(r.amount_riel);
        const kgOff = kg != null && Math.abs((tx.quantity_kg || 0) - kg) >= 0.01;
        const amtOff = amt != null && Math.abs((tx.amount || 0) - amt) >= 1;
        if (kgOff || amtOff) mismatch.push({ log: r, tx, kgOff, amtOff }); else ok.push({ log: r, tx });
      }
      // Doubled: same station + same paper number, more than one live row.
      const groups = new Map();
      for (const tx of live) {
        if (!tx.paper_ticket_no) continue;
        const k = `${tx.location_id}|${norm(tx.paper_ticket_no)}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(tx);
      }
      const logPapers = new Set(rows.map((r) => norm(r.paper_ticket_no)).filter(Boolean));
      const doubled = [...groups.values()].filter((g) => g.length > 1 && g.some((tx) => logPapers.has(norm(tx.paper_ticket_no))));
      setResult({ total: rows.length, missing, mismatch, ok, doubled });
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  const locName = (id) => locations.find((l) => l.id === id)?.name || "";
  const fmtKg = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  const fmtR = (n) => `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="font-bold text-slate-800">Station check</h3>
            <p className="text-xs text-slate-500">Compare a station PC's daily log against what the system holds.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-brand-400 hover:bg-brand-50/40">
            <span className="text-sm font-semibold text-slate-700">Choose the station's log file</span>
            <span className="mt-1 text-xs text-slate-500">On the station PC: weighbridge folder → <span className="font-mono">PaddyTrade_Logs</span> → <span className="font-mono">2026-09-07.csv</span> (one file per day)</span>
            {fileName && <span className="mt-2 rounded bg-white px-2 py-0.5 text-xs font-medium text-brand-700">{fileName}</span>}
            <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={!ready} className="hidden" />
          </label>
          {/* [2026-09-12] Said plainly, before a file is even chosen: this
              check cannot run without the complete list, and it will not
              guess. */}
          {loadError && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{loadError}</p>}
          {!ready && !loadError && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">Loading every transaction to check against\u2026</p>}
          {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          {result && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-lg bg-slate-50 p-2"><div className="text-lg font-bold text-slate-800">{result.total}</div>on station log</div>
                <div className={`rounded-lg p-2 ${result.missing.length ? "bg-rose-50" : "bg-emerald-50"}`}><div className={`text-lg font-bold ${result.missing.length ? "text-rose-700" : "text-emerald-700"}`}>{result.missing.length}</div>missing in system</div>
                <div className={`rounded-lg p-2 ${result.mismatch.length ? "bg-amber-50" : "bg-emerald-50"}`}><div className={`text-lg font-bold ${result.mismatch.length ? "text-amber-700" : "text-emerald-700"}`}>{result.mismatch.length}</div>numbers differ</div>
                <div className={`rounded-lg p-2 ${result.doubled.length ? "bg-rose-50" : "bg-emerald-50"}`}><div className={`text-lg font-bold ${result.doubled.length ? "text-rose-700" : "text-emerald-700"}`}>{result.doubled.length}</div>doubled in system</div>
              </div>
              {result.missing.length === 0 && result.mismatch.length === 0 && result.doubled.length === 0 && (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">Every ticket on this station's log is in the system with the same weight and amount, and none is doubled.</p>
              )}
              {result.missing.length > 0 && (
                <div>
                  <h4 className="mb-1 text-sm font-bold text-rose-700">Missing in the system — the receipt printed, the save never arrived</h4>
                  <table className="w-full text-xs"><thead><tr className="text-left text-slate-400"><th className="py-1">Time</th><th>Paper #</th><th>Code</th><th>Party</th><th className="text-right">Net kg</th><th className="text-right">Amount</th><th>Log says</th></tr></thead><tbody>
                    {result.missing.map((r, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1">{r.time}</td><td>{r.paper_ticket_no}</td><td className="font-mono">{r.transaction_code}</td><td>{r.party}</td><td className="text-right">{fmtKg(num(r.net_kg))}</td><td className="text-right">{fmtR(num(r.amount_riel))}</td><td>{r.status}</td></tr>)}
                  </tbody></table>
                  <p className="mt-1 text-[11px] text-slate-500">If the log says "waiting", the station PC is still trying to send it — check it is on and online. If it says "confirmed", the transaction was later cancelled or edited in the system.</p>
                </div>
              )}
              {result.mismatch.length > 0 && (
                <div>
                  <h4 className="mb-1 text-sm font-bold text-amber-700">Numbers differ between the station log and the system</h4>
                  <table className="w-full text-xs"><thead><tr className="text-left text-slate-400"><th className="py-1">Paper #</th><th>Code</th><th className="text-right">Log kg</th><th className="text-right">System kg</th><th className="text-right">Log amount</th><th className="text-right">System amount</th></tr></thead><tbody>
                    {result.mismatch.map((m, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1">{m.log.paper_ticket_no}</td><td className="font-mono">{m.tx.code}</td><td className={`text-right ${m.kgOff ? "font-bold text-amber-700" : ""}`}>{fmtKg(num(m.log.net_kg))}</td><td className={`text-right ${m.kgOff ? "font-bold text-amber-700" : ""}`}>{fmtKg(m.tx.quantity_kg)}</td><td className={`text-right ${m.amtOff ? "font-bold text-amber-700" : ""}`}>{fmtR(num(m.log.amount_riel))}</td><td className={`text-right ${m.amtOff ? "font-bold text-amber-700" : ""}`}>{fmtR(m.tx.amount)}</td></tr>)}
                  </tbody></table>
                  <p className="mt-1 text-[11px] text-slate-500">A difference is expected if HQ edited the transaction or confirmed the buyer's final numbers after the receipt printed.</p>
                </div>
              )}
              {result.doubled.length > 0 && (
                <div>
                  <h4 className="mb-1 text-sm font-bold text-rose-700">Doubled in the system — more than one live transaction for one paper ticket</h4>
                  {result.doubled.map((g, i) => (
                    <div key={i} className="mb-2 rounded-lg border border-rose-200 p-2 text-xs">
                      <div className="font-semibold text-slate-700">{g[0].paper_ticket_no} · {locName(g[0].location_id)} · {g[0].partyName}</div>
                      {g.map((tx) => <div key={tx.id} className="mt-0.5 font-mono text-slate-600">{tx.code} — {fmtKg(tx.quantity_kg)} kg — {fmtR(tx.amount)} — {tx.tx_date} {tx.tx_time || ""}</div>)}
                      <div className="mt-1 text-[11px] text-slate-500">Keep the one the receipt shows; Cancel the other from the Transactions list.</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// [2026-09-09] Two changes here, both from the "a cancelled transaction must
// come to zero in everything" rule:
//
//   1. A reason is now required. Cancelling used to leave nothing behind but
//      a status change — a 30-tonne purchase could disappear from the books
//      with no record of why or who decided.
//   2. The warning about already-paid money used to say the opposite of what
//      now happens. Money against a cancelled transaction is voided
//      automatically by the database (cancel_to_zero_2026-09-09.sql), so it
//      leaves Cash Flow with the rice instead of staying behind. It is
//      voided, never deleted, and comes back if the transaction is restored.
function ConfirmCancelModal({ tx, alreadyPaid, userEmail, t, onClose, onConfirm }) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!reason.trim()) {
      setError("Please say why this is being cancelled — it is kept on the record.");
      return;
    }
    setChecking(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: userEmail, password });
    setChecking(false);
    if (authError) {
      setError("Incorrect password.");
      return;
    }
    onConfirm(reason.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><AlertTriangle size={16} className="text-rose-500" /> Confirm Cancellation</h3>
        <p className="mb-3 text-xs text-slate-400">{tx.code} · {tx.partyName} · {fmtRiel(tx.amount)}</p>

        {alreadyPaid > 0.01 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
            {fmtRiel(alreadyPaid)} has already been recorded as paid against this transaction. Cancelling removes it from Cash Flow
            as well, so this transaction comes to zero everywhere. The payment is not deleted — it stays on record, marked as
            voided, and comes back if this transaction is ever restored. <b>If the money really did leave the business, get it back
            or record it as an expense</b> — the books will no longer show it.
          </div>
        )}

        <form onSubmit={submit}>
          <label className="mb-1 block text-xs text-slate-500">
            Why is this being cancelled? <span className="text-rose-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            rows={2}
            placeholder="e.g. Truck turned back — load never delivered"
            className="mb-3 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
          />
          <label className="mb-1 block text-xs text-slate-500">Enter your password to confirm</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
            className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
          {error && <p className="mb-2 text-sm text-rose-500">{error}</p>}

          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("cancel")}</button>
            <button type="submit" disabled={checking || !password || !reason.trim()} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
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
  // [2026-09-08] A Sell finished with "price not given yet" has amount 0,
  // so remaining is 0 — which used to read as Paid/Settled and drop it out
  // of Receivables entirely (audit #4). It is its own state now.
  unpriced: "bg-orange-50 text-orange-700 border-orange-300",
};
// True for a Sell that has no agreed price yet (amount 0 by construction).
function isUnpricedTx(tx) {
  return tx.type === "SELL" && (tx.hq_status || "processing") !== "cancelled" && (tx.price_per_kg == null || Number(tx.amount || 0) === 0);
}

export default function Transactions({ setPage }) {
  const { t } = useLanguage();
  const { profile, session } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [rows, setRows] = useState([]);
  const [payments, setPayments] = useState([]);
  // [2026-09-09] { transactionId: { edit_count, last_changed_at } } for the
  // "edited" badge. Loaded separately from the list and allowed to fail —
  // api.getTransactionEdits() returns {} rather than throwing, so a station
  // whose database does not have v_transaction_edits yet simply sees no
  // badges instead of a broken Transactions screen.
  const [edits, setEdits] = useState({});
  // Section 37: some station PCs' mouse/trackpad can't scroll the table
  // sideways at all (no horizontal scroll wheel, no two-finger swipe), so
  // there was no way to reach the Print button even though the table is
  // technically scrollable. These two on-screen arrow buttons scroll the
  // table by clicking instead, no gesture required.
  const tableScrollRef = useRef(null);
  const scrollTable = (dir) => tableScrollRef.current?.scrollBy({ left: dir * 420, behavior: "smooth" });
  const [type, setType] = useState("");
  // [2026-09-01] A real, working search — the header's "Search
  // transactions..." box was purely decorative (no onChange, wired to
  // nothing) and got removed; this replaces it with one that actually
  // filters. Same fields/approach as Weighing Tickets' own search: ticket
  // code, party name, car plate, and the paper Quality Ticket No. — the
  // things someone actually has in hand when looking a transaction up.
  const [search, setSearch] = useState("");
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
  const [stationCheckOpen, setStationCheckOpen] = useState(false);
  // null = not loaded yet (or the load failed). Never [] as a stand-in
  // for "everything", so the modal can tell "no data" from "no answer".
  const [stationCheckRows, setStationCheckRows] = useState(null);
  const [stationCheckError, setStationCheckError] = useState("");
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
      // Badge data, deliberately AFTER the list is on screen and not inside
      // the Promise.all above: it is decoration on top of the numbers, and
      // it must never delay or fail the load of the numbers themselves.
      api.getTransactionEdits().then(setEdits).catch(() => setEdits({}));
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

  // [2026-09-09] Two maps rather than one — see each one's comment below.
  // [2026-09-10] One pass over the payments, not one pass PER TRANSACTION.
  //
  // Both maps below used to scan the whole payment list for every row —
  // twice over, once each. At 2,787 transactions and a similar number of
  // payments that is about 16 million comparisons on the main thread every
  // time this screen re-renders, which is a visible freeze and gets four
  // times worse each time the business doubles. Grouping the payments by
  // transaction id first makes it one pass over each list.
  const paidByTx = useMemo(() => {
    const map = new Map();
    for (const p of payments) {
      if (!p.transaction_id) continue;
      const key = `${p.transaction_id}|${p.type}`;
      map.set(key, (map.get(key) || 0) + Number(p.amount || 0));
    }
    return map;
  }, [payments]);

  const paidFor = (tx) =>
    paidByTx.get(`${tx.id}|${tx.type === "BUY" ? "pay_supplier" : "receive_customer"}`) || 0;

  // remainingByTx keeps its old meaning — never below zero — because the
  // Unpaid filter, the Record Payment box and the HQ status column are all
  // built on "how much is still owed", and an overpayment is not a debt.
  const remainingByTx = useMemo(() => {
    const map = {};
    for (const tx of rows) {
      map[tx.id] = Math.max(0, Number(tx.total_with_tax ?? tx.amount) - paidFor(tx));
    }
    return map;
  }, [rows, paidByTx]);

  // overpaidByTx carries what that Math.max(0, …) throws away. Until 09/09
  // an overpayment simply disappeared: pay a farmer 100,000 too much and
  // the row read "Settled", exactly like one paid correctly. The money was
  // gone and nothing on screen said so. (Same shape of bug as CN 000261 —
  // a clamp hiding a number that mattered.)
  const overpaidByTx = useMemo(() => {
    const map = {};
    for (const tx of rows) {
      const over = paidFor(tx) - Number(tx.total_with_tax ?? tx.amount);
      // A riel or two either way is rounding, not an overpayment.
      if (over > 0.01) map[tx.id] = over;
    }
    return map;
  }, [rows, paidByTx]);

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
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((tx) =>
        (tx.code || "").toLowerCase().includes(q) ||
        (tx.partyName || "").toLowerCase().includes(q) ||
        (tx.car_plate || "").toLowerCase().includes(q) ||
        (tx.paper_ticket_no || "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, unpaidBuysOnly, notReceivedOnly, remainingByTx, selectedLocationIds, startDate, endDate, search]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  // Jump back to page 1 whenever the underlying filter set changes — a
  // "page 3" that made sense for one filter combination is almost never
  // meaningful for the next one.
  useEffect(() => {
    setPageNum(1);
  }, [type, unpaidBuysOnly, notReceivedOnly, selectedLocationIds, startDate, endDate, search]);
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
      // Now async (ExcelJS's write step is a Promise, unlike the old
      // SheetJS XLSX.writeFile which was synchronous) — awaited so a
      // failure here lands in the catch below instead of an unhandled
      // rejection, and so the "Exporting…" spinner doesn't stop before
      // the file's actually finished generating.
      await downloadLedgerWorkbook(
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

  // [2026-09-09] Takes the reason the modal now requires. The money side is
  // not done here — the database voids any payment against a cancelled
  // transaction (cancel_to_zero_2026-09-09.sql), so it holds for a cancel
  // made through any route, not just this screen. load() afterwards so the
  // remaining/paid figures on screen reflect the voided payments.
  async function confirmCancel(reason) {
    const tx = cancelConfirmTx;
    setCancelConfirmTx(null);
    setRows((prev) => prev.map((r) => (r.id === tx.id ? { ...r, hq_status: "cancelled" } : r)));
    try {
      await api.updateHqStatus(tx.id, "cancelled", { cancelReason: reason });
      await api.logAudit({
        action: "cancel_transaction",
        tableName: "transactions",
        recordId: tx.id,
        oldData: { hq_status: tx.hq_status || "processing" },
        newData: { hq_status: "cancelled", code: tx.code, partyName: tx.partyName, amount: tx.amount, cancel_reason: reason || null },
        userId: session.user.id,
      });
    } catch (err) {
      // fall through to load() — the row's true state comes from the server
    } finally {
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
    // [2026-09-08] Only when the status actually CHANGED to Paid in this
    // edit. Sells finished from a ticket used to land as "paid" with no
    // payment row, so ANY later edit (a plate typo) minted a full cash
    // receipt dated today (audit #1). An unchanged "paid" is left alone.
    if (updated.payment_status === "paid" && editTx.payment_status !== "paid") {
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
        deduction_kg: updated.deduction_kg, staff_fee: updated.staff_fee, car_plate: updated.car_plate, driver_name: updated.driver_name,
        paper_ticket_no: updated.paper_ticket_no, note: updated.note, tx_date: updated.tx_date,
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
          <WifiOff size={13} /> {t("offline_banner_short")}
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

            {/* [2026-09-01] Real search — ticket code, party name, car
                plate, or paper Quality Ticket No. Filters the already-
                loaded list client-side, same as every other control in
                this toolbar (Unpaid/Not Received, date range, location). */}
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ticket #, name, plate..."
                className="w-56 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-7 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500" title="Clear search">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Filters popover now only holds Unpaid (Buys) / Not Received
                (Sells) — Date Range and Location are their own visible
                controls again, right next to it, same as before. */}
            <div className="relative" ref={filtersRef}>
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${filtersOpen || activeFilterCount > 0 ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <Filter size={13} /> {t("filters_btn")}
                {activeFilterCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-slate-200 px-1 text-[10.5px] font-semibold text-slate-600">{activeFilterCount}</span>
                )}
              </button>
              {filtersOpen && (
                <div className="absolute left-0 top-full z-20 mt-2 w-max min-w-[280px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setUnpaidBuysOnly((v) => !v)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${unpaidBuysOnly ? "border-rose-400 bg-rose-50 text-rose-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{t("filter_unpaid_buys")}</button>
                    <button onClick={() => setNotReceivedOnly((v) => !v)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${notReceivedOnly ? "border-gold-300 bg-gold-50 text-gold-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{t("filter_not_received")}</button>
                  </div>
                  {(unpaidBuysOnly || notReceivedOnly) && (
                    <button
                      onClick={() => { setUnpaidBuysOnly(false); setNotReceivedOnly(false); }}
                      className="mt-2 text-xs font-medium text-slate-400 hover:text-slate-600"
                    >
                      {t("clear_btn")}
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
            {isAdmin && (
              <button
                onClick={async () => {
                  // All types, all stations, fresh from the server — the
                  // list on screen may be filtered to one tab/station.
                  //
                  // [2026-09-12] It must NEVER fall back to `rows`.
                  //
                  // This tool compares a station PC's daily CSV against
                  // the system and reports what is missing. It used to
                  // substitute the on-screen list — one tab, one station,
                  // 20 rows a page — whenever the full download timed out
                  // or failed, and then present that as "all types, all
                  // stations". The answer it gave was a list of tickets
                  // that are not missing at all. A tool whose whole job is
                  // to find missing data must never invent some.
                  //
                  // The download grows with the business and will pass 15
                  // seconds on a slow link well inside the first year, so
                  // this is not a rare path. Better to say it could not
                  // check than to answer wrongly.
                  setStationCheckError("");
                  setStationCheckRows(null);
                  setStationCheckOpen(true);
                  try {
                    const all = await withTimeout(api.getTransactions(), 60000, null);
                    if (!all) throw new Error("timeout");
                    setStationCheckRows(all);
                  } catch {
                    setStationCheckRows(null);
                    setStationCheckError(
                      "Could not load every transaction to check against — the connection was too slow or dropped. " +
                      "Nothing is wrong with your data; this check simply could not run. Try again on a better connection."
                    );
                  }
                }}
                title="Station check — compare a station PC's daily log with the system"
                className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <CheckCircle2 size={14} /> Station check
              </button>
            )}
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
            <button onClick={exportLedger} className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100">{t("retry_btn")}</button>
          </div>
        )}

        {/* [2026-08-31] This "scroll with these" hint and the table itself
            are both desktop-only now (hidden md:hidden below) — a phone
            gets its own card list instead (md:hidden block right after the
            table), so there's no sideways-scrolling table on a touchscreen
            to explain in the first place. Nothing here changes at md+. */}
        <div className="mb-2 hidden items-center justify-end gap-2 md:flex">
          <span className="text-xs text-slate-400">Can't scroll with your mouse? Use these:</span>
          <button onClick={() => scrollTable(-1)} title="Scroll table left" className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => scrollTable(1)} title="Scroll table right" className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
            <ChevronRight size={16} />
          </button>
        </div>

        <div ref={tableScrollRef} className="hidden rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto md:block">
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
                const isUnpriced = isUnpricedTx(tx);
                const hqStatus = isCancelled ? "cancelled" : isUnpriced ? "unpriced" : remaining <= 0.01 ? "paid" : "processing";
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
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-800">{tx.paper_ticket_no}</span>
                            {/* [2026-09-04] Set by checkAndFlagPaperTicketDuplicate
                                (api.js) when this number is also on file
                                elsewhere at this station — saving isn't
                                blocked anymore, so this badge is how an
                                admin actually finds one to look into. */}
                            {tx.paper_ticket_dup_flag && (
                              <span title="This paper ticket number is also used on another ticket/transaction at this station — worth double-checking against the paper slip." className="inline-flex items-center gap-0.5 rounded-full border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                                ⚠ Dup #
                              </span>
                            )}
                          </div>
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
                    <td className="px-3 py-3 text-slate-700">
                      {fmt2(tx.quantity_kg)}
                      {edits[tx.id] && <EditedBadge transactionId={tx.id} editCount={edits[tx.id].edit_count} />}
                    </td>
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
                      ) : isUnpriced ? (
                        <span className="rounded-md border border-orange-300 bg-orange-50 px-2 py-1 text-xs font-medium text-orange-700" title="Finished without an agreed price — set the price in Edit, then the amount owed appears here.">No price yet</span>
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
                      ) : overpaidByTx[tx.id] ? (
                        <span
                          className="flex w-fit items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700"
                          title={`${fmtRiel(overpaidByTx[tx.id])} more has been paid than this transaction is worth. Correct or void the payment in Payment History, or record the refund.`}
                        >
                          <AlertTriangle size={12} /> Overpaid {fmtRiel(overpaidByTx[tx.id])}
                        </span>
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
                            <p className="text-sm font-semibold text-slate-800">
                              {fmt2(tx.quantity_kg)} kg
                              {edits[tx.id] && <EditedBadge transactionId={tx.id} editCount={edits[tx.id].edit_count} />}
                            </p>
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
              {pagedRows.length === 0 && !loading && <tr><td colSpan={13} className="px-5 py-10 text-center text-sm text-slate-400">{search.trim() ? `No matches for "${search.trim()}"` : (unpaidBuysOnly || notReceivedOnly) ? "Nothing matches — everything here is settled." : t("no_transactions")}</td></tr>}
            </tbody>
          </table>
        </div>

        {/* [2026-08-31] Phone card list — same rows, data, and action
            handlers as the table above (approved via mockup), just laid
            out as cards instead of 13 table columns. hidden at md+ since
            the table already covers that. Tap a card to expand the same
            weigh-in/weigh-out detail the table's chevron shows. */}
        <div className="flex flex-col gap-3 md:hidden">
          {pagedRows.map((tx) => {
            const isCancelled = (tx.hq_status || "processing") === "cancelled";
            const remaining = remainingByTx[tx.id] || 0;
            const isUnpriced = isUnpricedTx(tx);
            const hqStatus = isCancelled ? "cancelled" : isUnpriced ? "unpriced" : remaining <= 0.01 ? "paid" : "processing";
            const isBuy = tx.type === "BUY";
            const isExpanded = expandedTxIds.has(tx.id);
            const payableKg = Math.max(0, (tx.quantity_kg || 0) - (tx.deduction_kg || 0));
            const photoCount = [tx.receipt_photo_url, tx.payment_proof_url, tx.bank_qr_url].filter(Boolean).length;
            return (
              <div key={`card-${tx.id}`} className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${isCancelled ? "opacity-50" : ""}`}>
                <div className={`absolute inset-y-4 left-0 w-1 rounded-full ${isBuy ? "bg-brand-500" : "bg-rose-400"}`} />
                <div className="pl-3">
                  <button onClick={() => toggleExpand(tx.id)} className="flex w-full items-start justify-between gap-2 text-left">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${isBuy ? "bg-brand-100 text-brand-700" : "bg-rose-100 text-rose-700"}`}>
                          {isBuy ? "▲ BUY" : "▼ SELL"}
                        </span>
                        <span className="font-bold text-slate-800">{tx.paper_ticket_no || tx.code}</span>
                        {tx.paper_ticket_dup_flag && (
                          <span title="This paper ticket number is also used on another ticket/transaction at this station — worth double-checking against the paper slip." className="inline-flex items-center gap-0.5 rounded-full border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                            ⚠ Dup #
                          </span>
                        )}
                        {isTransactionPendingSync(tx.id) && (
                          <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            <RefreshCw size={9} /> {t("not_synced")}
                          </span>
                        )}
                      </div>
                      {tx.paper_ticket_no && <p className="mt-0.5 text-xs text-slate-400">{tx.code}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-slate-400">{tx.tx_date}</p>
                      <p className="text-xs text-slate-400">{fmtTime(tx.tx_time)}</p>
                    </div>
                  </button>

                  <p className="mt-2 font-semibold text-slate-800">{tx.partyName}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><MapPin size={11} className="text-slate-300" />{tx.stationName}</span>
                    {(tx.car_plate || tx.driver_name) && <span>🚚 {[tx.driver_name, tx.car_plate].filter(Boolean).join(" · ")}</span>}
                  </div>

                  <div className="mt-2.5 flex gap-2">
                    <div className="rounded-lg bg-slate-50 px-3 py-1.5">
                      <p className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400">{t("word_weight")}</p>
                      <p className="text-sm font-bold text-slate-800">
                        {fmt2(tx.quantity_kg)} kg
                        {edits[tx.id] && <EditedBadge transactionId={tx.id} editCount={edits[tx.id].edit_count} />}
                      </p>
                    </div>
                    {tx.price_per_kg != null && (
                      <div className="rounded-lg bg-slate-50 px-3 py-1.5">
                        <p className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400">{t("price_per_kg")}</p>
                        <p className="text-sm font-bold text-slate-800">{fmtRiel(tx.price_per_kg)}</p>
                      </div>
                    )}
                  </div>

                  {tx.station_quantity_kg != null && (
                    tx.buyer_confirmed_at ? (
                      <span className="mt-2 flex w-fit items-center gap-1 rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">✓ {t("tx_confirmed")}</span>
                    ) : (
                      <span className="mt-2 flex w-fit items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">⏳ {t("tx_pending_confirm")}</span>
                    )
                  )}

                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                    <div>
                      {isCancelled ? (
                        <span className="text-xs text-slate-400">{t("tx_excluded")}</span>
                      ) : isUnpriced ? (
                        <span className="rounded-md border border-orange-300 bg-orange-50 px-2 py-1 text-xs font-medium text-orange-700">{t("hq_unpriced")}</span>
                      ) : remaining > 0.01 ? (
                        isAdmin ? (
                          <button onClick={() => setPayTx(tx)} className="flex items-center gap-1 rounded-md border border-gold-300 bg-gold-50 px-2 py-1 text-xs font-medium text-gold-700 hover:bg-gold-100">
                            <Wallet size={12} /> {t("tx_due", { amount: fmtRiel(remaining) })}
                          </button>
                        ) : (
                          <span className="flex items-center gap-1 rounded-md border border-gold-100 bg-gold-50/60 px-2 py-1 text-xs font-medium text-gold-700">
                            <Wallet size={12} /> {t("tx_due", { amount: fmtRiel(remaining) })}
                          </span>
                        )
                      ) : overpaidByTx[tx.id] ? (
                        <span className="flex w-fit items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                          <AlertTriangle size={12} /> {t("tx_overpaid", { amount: fmtRiel(overpaidByTx[tx.id]) })}
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-brand-600">{t("tx_settled")}</span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-extrabold text-slate-800">{fmtRiel(tx.total_with_tax ?? tx.amount)}</p>
                      {tx.tax_applicable && <p className="text-[10px] text-slate-400">{t("tx_incl_vat", { rate: tx.tax_rate })}</p>}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-slate-100 pt-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("weigh_in_label")} {isBuy ? t("loaded_suffix") : t("empty_suffix")}</p>
                        <p className="text-sm font-semibold text-slate-800">{tx.gross_kg != null ? `${fmt2(tx.gross_kg)} kg` : t("not_recorded")}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("weigh_out_label")} {isBuy ? t("empty_suffix") : t("loaded_suffix")}</p>
                        <p className="text-sm font-semibold text-slate-800">{tx.tare_kg != null ? `${fmt2(tx.tare_kg)} kg` : t("not_recorded")}</p>
                      </div>
                      {(tx.deduction_kg || 0) > 0 && (
                        <>
                          <div><p className="text-[10px] uppercase tracking-wide text-slate-400">{t("deduction_label")}</p><p className="text-sm font-semibold text-slate-800">{fmt2(tx.deduction_kg)} kg</p></div>
                          <div><p className="text-[10px] uppercase tracking-wide text-slate-400">{t("payable_weight_label")}</p><p className="text-sm font-semibold text-slate-800">{fmt2(payableKg)} kg</p></div>
                        </>
                      )}
                      <div><p className="text-[10px] uppercase tracking-wide text-slate-400">{t("recorded_by_label")}</p><p className="text-sm font-semibold text-slate-800">{tx.recorded_by_name || "—"}</p></div>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <button onClick={() => setReceiptTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500"><Printer size={12} /> {t("btn_receipt")}</button>
                    <button onClick={() => setPhotosTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500"><Camera size={12} /> {t("btn_photos")} ({photoCount})</button>
                    <button onClick={() => setViewPaymentsTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500"><Wallet size={12} /> {t("btn_payments")}</button>
                    {isAdmin ? (
                      <button onClick={() => setEditTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500"><Pencil size={12} /> {t("btn_edit")}</button>
                    ) : (
                      <button onClick={() => setRequestTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500"><Flag size={12} /> {t("request_change")}</button>
                    )}
                    {isAdmin && !isCancelled && tx.station_quantity_kg != null && !tx.buyer_confirmed_at && (
                      <button onClick={() => setConfirmSaleTx(tx)} className="flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700"><CheckCircle2 size={12} /> {t("btn_confirm_sale")}</button>
                    )}
                    {isAdmin && (
                      isCancelled ? (
                        <button onClick={() => restoreTransaction(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500"><Undo2 size={12} /> {t("btn_restore")}</button>
                      ) : (
                        <button onClick={() => setCancelConfirmTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500"><Ban size={12} /> {t("btn_cancel_tx")}</button>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {pagedRows.length === 0 && loading && <p className="py-10 text-center text-sm text-slate-400">{t("loading_label")}</p>}
          {pagedRows.length === 0 && !loading && <p className="py-10 text-center text-sm text-slate-400">{search.trim() ? `No matches for "${search.trim()}"` : (unpaidBuysOnly || notReceivedOnly) ? t("tx_nothing_settled") : t("no_transactions")}</p>}
        </div>

        {visibleRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-4 text-sm text-slate-500">
            <div>
              {t("tx_showing", {
                a: (pageNum - 1) * PAGE_SIZE + 1,
                b: Math.min(pageNum * PAGE_SIZE, visibleRows.length),
                c: visibleRows.length,
              })}
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
      {stationCheckOpen && (
        <StationCheckModal allRows={stationCheckRows} loadError={stationCheckError} locations={locations} onClose={() => setStationCheckOpen(false)} />
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
