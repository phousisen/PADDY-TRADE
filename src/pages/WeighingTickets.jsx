import { useEffect, useMemo, useState } from "react";
import { Plus, Printer, X, ArrowRight, Ban, Check, WifiOff, RefreshCw } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import PhotoUpload from "../components/PhotoUpload.jsx";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import Receipt from "./Receipt.jsx";
import {
  startAutoSync, refreshLookupCaches, getCachedTickets, mergeServerTickets,
  resolvePartyIdOffline, resolveProductIdOffline, createTicketOffline,
  setTicketGrossOffline, setTicketPriceOffline, setTicketTareOffline, finalizeTicketOffline,
  onSyncStatusChange, pendingCountForTicket, getCachedProducts, getCachedParties, updatePartyOffline,
  suggestNextPaperTicketNo,
} from "../offlineQueue.js";

// Same bank list as the New Transaction form, so staff see the same
// choices in both places — "Cash" is first since most farmer payouts at
// the scale are cash in hand, not a bank transfer.
const BANK_OPTIONS = [
  "Cash",
  "ABA Bank",
  "ACLEDA Bank",
  "Canadia Bank",
  "Sathapana Bank",
  "Wing Bank",
  "KB Prasac Bank",
  "FTB Bank",
  "Phillip Bank",
  "Chipmong Bank",
];

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

// These are the underlying stages a ticket moves through in the database
// (unchanged from before — this is what keeps old data and the sync queue
// compatible). What changed is that the board no longer shows a separate
// screen/tab for each one: "arrived" and "weighed_in" happen together the
// instant staff open a new ticket, and "priced"/"weighed_out" happen
// together in the single "Finish Ticket" step — matching how Baitang
// actually uses two visits to the computer per truck, not four or five.
const OPEN_STAGE_IDS = ["arrived", "weighed_in", "priced", "weighed_out"];
const ALL_STAGE_IDS = [...OPEN_STAGE_IDS, "declined"];

// ---- Live weight box (same pattern as the New Transaction form) ----------

function useLiveWeight(locationId) {
  const [liveWeight, setLiveWeight] = useState(null);
  useEffect(() => {
    if (!locationId) { setLiveWeight(null); return; }
    let cancelled = false;
    async function poll() {
      const reading = await api.getLiveWeight(locationId).catch(() => null);
      if (!cancelled) setLiveWeight(reading);
    }
    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [locationId]);
  const ageMs = liveWeight?.updated_at ? Date.now() - new Date(liveWeight.updated_at).getTime() : Infinity;
  return { connected: ageMs < 6000, weightKg: liveWeight?.weight_kg };
}

function LiveWeightBox({ locationId, label, onUse }) {
  const { connected, weightKg } = useLiveWeight(locationId);
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${connected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
        <div>
          <p className={`text-xs font-medium ${connected ? "text-emerald-700" : "text-slate-400"}`}>{connected ? (label || "Live Scale Weight") : "Scale not connected"}</p>
          <p className={`text-lg font-bold ${connected ? "text-emerald-800" : "text-slate-300"}`}>{connected ? `${fmt2(weightKg)} kg` : "— kg"}</p>
        </div>
      </div>
      {connected && (
        <button type="button" onClick={() => onUse(weightKg)}
          className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
          Use This
        </button>
      )}
    </div>
  );
}

// ---- Modal shell ----------------------------------------------------------

function Modal({ title, subtitle, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`no-print w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl`}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-700">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1 block text-xs text-slate-500";

// ---- New Ticket & Weigh In (combined — one screen, like the scale software's single window) ----

function NewTicketModal({ locations, defaultLocationId, isAdmin, onClose, onCreated }) {
  const [type, setType] = useState("BUY");
  const [locationId, setLocationId] = useState(defaultLocationId || "");
  const [partyName, setPartyName] = useState("");
  const [phone, setPhone] = useState("");
  const [carPlate, setCarPlate] = useState("");
  const [driverName, setDriverName] = useState("");
  const [productName, setProductName] = useState("");
  const [paperTicketNo, setPaperTicketNo] = useState("");
  const [grossWeight, setGrossWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [phoneLookupMsg, setPhoneLookupMsg] = useState("");
  const { session } = useAuth();
  // Paddy types staff have already used before, so the field suggests them
  // instead of everyone typing (and misspelling) the same names over and
  // over — still a free-text field underneath, so a brand new type just
  // works too.
  const [productOptions] = useState(() => getCachedProducts());

  // Baitang's paper tickets come from a pre-numbered booklet, used in
  // order — so as soon as a location is known, suggest the next number
  // after whatever was last typed in for that location. Staff can still
  // edit it (a spoiled ticket, a different booklet, etc.) — this only
  // fills it in when it's still blank, so it never overwrites something
  // they already typed.
  useEffect(() => {
    if (locationId && !paperTicketNo) {
      const suggested = suggestNextPaperTicketNo(locationId);
      if (suggested) setPaperTicketNo(suggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  // Looks up a farmer/buyer that already self-registered (via the QR
  // registration page) or has been entered before, by phone number, and
  // fills in their saved name so staff don't retype it. Bank/QR details
  // (if any are already on file) are shown later, at Finish Ticket, once
  // it's actually known whether this truckload is getting paid in cash or
  // by bank transfer.
  async function lookupByPhone() {
    const trimmed = phone.trim();
    if (!trimmed) { setPhoneLookupMsg(""); return; }
    setPhoneLookupMsg("Looking up…");
    try {
      const matches = await api.getParties({ type: type === "BUY" ? "supplier" : "buyer", phone: trimmed });
      if (matches && matches.length > 0) {
        const p = matches[0];
        setPartyName(p.name || "");
        setPhoneLookupMsg(`Found: ${p.name}`);
      } else {
        setPhoneLookupMsg("No record found — fill in details below.");
      }
    } catch {
      setPhoneLookupMsg("");
    }
  }

  async function submit() {
    const kg = parseFloat(grossWeight);
    if (!locationId || !partyName.trim() || !productName.trim() || !carPlate.trim()) {
      setError("Please fill in location, party name, product, and plate number.");
      return;
    }
    if (!paperTicketNo.trim()) {
      setError("Please enter the number printed on the paper quality ticket.");
      return;
    }
    if (!kg || kg <= 0) {
      setError("Please enter the truck's gross (loaded) weight.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const partyId = await resolvePartyIdOffline(partyName, type === "BUY" ? "supplier" : "buyer", locationId, { phone });
      const productId = await resolveProductIdOffline(productName);
      const locationName = locations.find((l) => l.id === locationId)?.name;
      const ticket = createTicketOffline({
        type, locationId, locationName, partyId, partyName: partyName.trim(), phone,
        carPlate, driverName, productId, productName: productName.trim(), userId: session.user.id,
        paperTicketNo: paperTicketNo.trim(),
      });
      const weighedIn = setTicketGrossOffline(ticket.id, { grossKg: kg, userId: session.user.id });
      onCreated(weighedIn);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New Ticket — Weigh In (Loaded)" subtitle="Farmer already has their guard-issued queue slip in hand" onClose={onClose} wide>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setType("BUY")} className={`flex-1 rounded-lg border py-2 text-sm font-medium ${type === "BUY" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}>Buy (from farmer)</button>
        <button onClick={() => setType("SELL")} className={`flex-1 rounded-lg border py-2 text-sm font-medium ${type === "SELL" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}>Sell (to buyer)</button>
      </div>
      {isAdmin && (
        <div className="mb-3">
          <label className={labelCls}>Location</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
            <option value="">Select location…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Quality Ticket No.</label>
          <input value={paperTicketNo} onChange={(e) => setPaperTicketNo(e.target.value)} className={inputCls} placeholder="e.g. 092152" />
          <p className="mt-1 text-[11px] text-slate-400">Auto-suggested from the last one used — edit if it's wrong</p>
        </div>
        <div><label className={labelCls}>Vehicle Plate Number</label><input value={carPlate} onChange={(e) => setCarPlate(e.target.value)} className={inputCls} /></div>
        <div className="col-span-2">
          <label className={labelCls}>Phone (type it and tab/click away to look them up)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={lookupByPhone} className={inputCls} />
          {phoneLookupMsg && <p className={`mt-1 text-xs ${phoneLookupMsg.startsWith("Found") ? "text-emerald-600" : "text-slate-400"}`}>{phoneLookupMsg}</p>}
        </div>
        <div className="col-span-2"><label className={labelCls}>{type === "BUY" ? "Seller (Farmer) Name" : "Buyer Name"}</label><input value={partyName} onChange={(e) => setPartyName(e.target.value)} className={inputCls} /></div>
        <div>
          <label className={labelCls}>Product (paddy type)</label>
          <input list="paddy-type-options" value={productName} onChange={(e) => setProductName(e.target.value)} className={inputCls} placeholder="e.g. Sror Ngae" />
          <datalist id="paddy-type-options">
            {productOptions.map((p) => <option key={p.id} value={p.name} />)}
          </datalist>
        </div>
        <div><label className={labelCls}>Driver Name</label><input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inputCls} placeholder="optional" /></div>
      </div>

      <div className="mt-4">
        <LiveWeightBox locationId={locationId} onUse={(kg) => setGrossWeight(String(kg))} />
        <label className={labelCls}>Gross Weight — loaded truck (kg)</label>
        <input type="number" min="0" step="0.01" value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} className={inputCls} placeholder="0" />
      </div>

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
        <button disabled={saving} onClick={submit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">{saving ? "Saving…" : "Save & Print Weigh-In Slip"}</button>
      </div>
    </Modal>
  );
}

// ---- Finish Ticket (combined — price + quality, weigh out, and finalize into a receipt, all in one screen) ----

function FinishTicketModal({ ticket, onClose, onFinalized, onDeclined }) {
  const isBuy = ticket.type === "BUY";
  const [qualityGrade, setQualityGrade] = useState("");
  const [moisturePct, setMoisturePct] = useState("");
  const [mixturePct, setMixturePct] = useState("");
  const [outthrowPct, setOutthrowPct] = useState("");
  const [deductionKg, setDeductionKg] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  const [staffFee, setStaffFee] = useState("");
  const [taxApplicable, setTaxApplicable] = useState(false);
  const [taxRate, setTaxRate] = useState("10");
  const [priceNote, setPriceNote] = useState("");
  const [tareWeight, setTareWeight] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankIsOther, setBankIsOther] = useState(false);
  const [bankAccount, setBankAccount] = useState("");
  const [bankQrUrl, setBankQrUrl] = useState(null);
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { session } = useAuth();

  // Cash-or-bank-transfer, and the actual bank details/QR, aren't known
  // until now — the farmer only decides during the paper quality/price
  // step between weigh-in and weigh-out. If they've paid this farmer
  // before, prefill whatever's already saved on their profile so staff
  // don't have to retype it every truckload.
  useEffect(() => {
    const savedParty = ticket.party_id ? getCachedParties().find((p) => p.id === ticket.party_id) : null;
    const initialBank = ticket.bank_name || savedParty?.bank_name || "";
    setBankName(initialBank);
    setBankIsOther(!!initialBank && !BANK_OPTIONS.includes(initialBank));
    setBankAccount(ticket.bank_account || savedParty?.bank_account || "");
    setBankQrUrl(ticket.bank_qr_url || savedParty?.bank_qr_url || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  const netKg = Math.max(0, (ticket.gross_kg || 0) - (parseFloat(tareWeight) || 0));
  const payableKg = Math.max(0, netKg - (parseFloat(deductionKg) || 0));
  const staffFeeAmt = isBuy ? (parseFloat(staffFee) || 0) : 0;
  const subtotal = Math.max(0, payableKg * (parseFloat(pricePerKg) || 0) - staffFeeAmt);
  const taxAmount = taxApplicable ? Math.round(subtotal * (parseFloat(taxRate) || 0)) / 100 : 0;
  const total = subtotal + taxAmount;

  async function submitDecline() {
    setSaving(true);
    try {
      setTicketPriceOffline(ticket.id, { priceNote: priceNote || "Not buying", userId: session.user.id, decline: true });
      onDeclined();
    } finally {
      setSaving(false);
    }
  }

  async function submitFinish() {
    const tareKg = parseFloat(tareWeight);
    if (!pricePerKg) { setError("Please enter the price that was agreed on the paper ticket."); return; }
    if (!tareKg || tareKg <= 0) { setError("Please enter the empty truck's weight."); return; }
    if (!receiptPhotoUrl) { setError("Please take a photo of the finished, signed paper ticket."); return; }
    setError("");
    setSaving(true);
    try {
      const finalBankQrUrl = isBuy && bankName && bankName !== "Cash" ? bankQrUrl : null;
      setTicketPriceOffline(ticket.id, {
        qualityGrade, moisturePct: parseFloat(moisturePct) || 0, mixturePct: parseFloat(mixturePct) || 0,
        outthrowPct: parseFloat(outthrowPct) || 0, deductionKg: parseFloat(deductionKg) || 0,
        pricePerKg: parseFloat(pricePerKg) || 0, staffFee: parseFloat(staffFee) || 0,
        taxApplicable, taxRate: parseFloat(taxRate) || 0, priceNote, userId: session.user.id, decline: false,
        bankName, bankAccount, bankQrUrl: finalBankQrUrl,
      });
      // Keep the farmer's saved profile in sync so next time they come by,
      // their bank details/QR are already there to prefill — same as the
      // manual Buy/Sell form does.
      if (isBuy && ticket.party_id) {
        const savedParty = getCachedParties().find((p) => p.id === ticket.party_id) || {};
        const patch = {};
        if (bankName !== (savedParty.bank_name || "")) patch.bankName = bankName;
        if (bankAccount !== (savedParty.bank_account || "")) patch.bankAccount = bankAccount;
        if (finalBankQrUrl && finalBankQrUrl !== (savedParty.bank_qr_url || "")) patch.bankQrUrl = finalBankQrUrl;
        if (Object.keys(patch).length > 0) updatePartyOffline(ticket.party_id, patch);
      }
      const tareUpdated = setTicketTareOffline(ticket.id, { tareKg, userId: session.user.id });
      // No date picker here on purpose — this is finalized the moment the
      // truck is actually back and empty, so today's real date and the
      // exact time right now are always the correct answer.
      const tx = finalizeTicketOffline(tareUpdated, { userId: session.user.id, receiptPhotoUrl });
      onFinalized(tx);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Finish Ticket ${ticket.code}`} subtitle={`${ticket.party_name} · ${ticket.car_plate} · Gross: ${fmt2(ticket.gross_kg)} kg (weighed in earlier)`} onClose={onClose} wide>
      <p className={labelCls}>Whatever was already agreed on the paper ticket — grade, moisture, price</p>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={labelCls}>Quality Grade</label><input value={qualityGrade} onChange={(e) => setQualityGrade(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Moisture %</label><input type="number" value={moisturePct} onChange={(e) => setMoisturePct(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Mixture %</label><input type="number" value={mixturePct} onChange={(e) => setMixturePct(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Outthrow %</label><input type="number" value={outthrowPct} onChange={(e) => setOutthrowPct(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Deduction (kg)</label><input type="number" value={deductionKg} onChange={(e) => setDeductionKg(e.target.value)} className={inputCls} /></div>
        {isBuy && (
          <div><label className={labelCls}>Staff / Carrying Fee (optional)</label><input type="number" value={staffFee} onChange={(e) => setStaffFee(e.target.value)} className={inputCls} /></div>
        )}
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={taxApplicable} onChange={(e) => setTaxApplicable(e.target.checked)} /> Tax applicable</label>
          {taxApplicable && <input type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={`${inputCls} w-20`} />}
        </div>
        <div className="col-span-3"><label className={labelCls}>Note</label><input value={priceNote} onChange={(e) => setPriceNote(e.target.value)} className={inputCls} placeholder="optional" /></div>
      </div>

      <div className="mt-4 rounded-lg border-2 border-brand-200 bg-brand-50 p-4">
        <label className="mb-1 block text-sm font-semibold text-brand-800">Price per kg (Riel) — the price agreed on the paper ticket</label>
        <input type="number" min="0" step="1" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} placeholder="e.g. 1090"
          className="w-full rounded-lg border border-brand-300 bg-white px-3 py-3 text-lg font-semibold outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 p-4">
        <p className="mb-2 text-sm font-semibold text-slate-700">Payment Method</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Bank (or Cash)</label>
            <select
              value={bankIsOther ? "__other__" : bankName}
              onChange={(e) => {
                if (e.target.value === "__other__") { setBankIsOther(true); setBankName(""); }
                else { setBankIsOther(false); setBankName(e.target.value); }
              }}
              className={inputCls}
            >
              <option value="" disabled>Select payment method / bank</option>
              {BANK_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              <option value="__other__">Other...</option>
            </select>
            {bankIsOther && (
              <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Type bank name" className={`${inputCls} mt-2`} />
            )}
          </div>
          <div><label className={labelCls}>Bank Account</label><input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={inputCls} /></div>
        </div>
        {isBuy && bankName && bankName !== "Cash" && (
          <div className="mt-3">
            <PhotoUpload
              label="Bank QR Code (photo)"
              kind="party-bank-qr"
              url={bankQrUrl}
              onUploaded={setBankQrUrl}
              hint="Take a photo of the farmer's bank QR code so payment can be sent straight from the receipt"
            />
          </div>
        )}
      </div>

      <div className="mt-4">
        <LiveWeightBox locationId={ticket.location_id} label="Live Scale Weight (empty truck)" onUse={(kg) => setTareWeight(String(kg))} />
        <label className={labelCls}>Tare Weight — empty truck (kg)</label>
        <input type="number" min="0" step="0.01" value={tareWeight} onChange={(e) => setTareWeight(e.target.value)} className={inputCls} placeholder="0" />
      </div>

      <div className="mt-4 space-y-1.5 rounded-lg bg-slate-50 p-4 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Net Weight</span><span className="font-medium">{fmt2(netKg)} kg</span></div>
        {(parseFloat(deductionKg) || 0) > 0 && <div className="flex justify-between"><span className="text-slate-500">Payable Weight</span><span className="font-medium">{fmt2(payableKg)} kg</span></div>}
        <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="font-semibold text-slate-700">Total</span><span className="font-bold text-brand-700">{fmtRiel(total)}</span></div>
      </div>

      <div className="mt-4">
        <PhotoUpload
          label="Photo of the finished, signed paper ticket" kind="receipt" required
          url={receiptPhotoUrl} onUploaded={setReceiptPhotoUrl}
          hint="So HQ can check it against what's entered here"
        />
      </div>

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-between gap-2">
        <button onClick={submitDecline} disabled={saving} className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40">
          <Ban size={14} /> Not Buying
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
          <button disabled={saving} onClick={submitFinish} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
            <Check size={14} /> {saving ? "Saving…" : "Save, Print & Finalize"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Quick Decline (straight from the board card — no need to open the full Finish Ticket form) ----

function DeclineModal({ ticket, onClose, onDeclined }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { session } = useAuth();

  async function submit() {
    setSaving(true);
    try {
      setTicketPriceOffline(ticket.id, { priceNote: reason || "Not buying", userId: session.user.id, decline: true });
      onDeclined();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Decline Ticket ${ticket.code}`} subtitle={`${ticket.party_name} · ${ticket.car_plate}`} onClose={onClose}>
      <p className="mb-3 text-xs text-slate-400">Same as not signing the paper quality ticket — no price, no weigh-out needed. This just keeps a short record of why.</p>
      <label className={labelCls}>Reason (optional)</label>
      <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. moisture too high" />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
        <button disabled={saving} onClick={submit} className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-40">
          <Ban size={14} /> {saving ? "Saving…" : "Confirm Decline"}
        </button>
      </div>
    </Modal>
  );
}

// ---- Interim slip (printed at weigh-in, mirrors the paper queue ticket) ------

function TicketSlip({ ticket, onClose }) {
  const netKg = ticket.gross_kg != null && ticket.tare_kg != null ? Math.max(0, ticket.gross_kg - ticket.tare_kg) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <div className="no-print mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">Weigh-In Slip</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"><Printer size={13} /> Print</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
        </div>
        <div id="ticket-slip-root" className="border border-slate-300 p-4 text-sm">
          <p className="text-center text-base font-bold">Ticket {ticket.code}</p>
          <p className="text-center text-xs text-slate-500">{ticket.stationName}</p>
          {ticket.paper_ticket_no && <p className="text-center text-xs text-slate-400">Quality Ticket No. {ticket.paper_ticket_no}</p>}
          <hr className="my-2" />
          <div className="space-y-1">
            <div className="flex justify-between"><span>Truck ID</span><span className="font-medium">{ticket.car_plate}</span></div>
            <div className="flex justify-between"><span>Driver</span><span className="font-medium">{ticket.driver_name || "—"}</span></div>
            <div className="flex justify-between"><span>Product</span><span className="font-medium">{ticket.product_name}</span></div>
            <div className="flex justify-between"><span>Buyer/Seller</span><span className="font-medium">{ticket.party_name}</span></div>
            {ticket.gross_kg != null && <div className="flex justify-between"><span>IN (Gross)</span><span className="font-medium">{fmt2(ticket.gross_kg)} kg</span></div>}
            {ticket.moisture_pct != null && ticket.priced_at && <div className="flex justify-between"><span>Moisture</span><span className="font-medium">{fmt2(ticket.moisture_pct)} %</span></div>}
            {ticket.outthrow_pct != null && ticket.priced_at && <div className="flex justify-between"><span>Outthrow</span><span className="font-medium">{fmt2(ticket.outthrow_pct)} %</span></div>}
            {ticket.price_per_kg != null && ticket.priced_at && <div className="flex justify-between"><span>Price / Kg</span><span className="font-medium">{fmtRiel(ticket.price_per_kg)}</span></div>}
            {ticket.tare_kg != null && <div className="flex justify-between"><span>OUT (Tare)</span><span className="font-medium">{fmt2(ticket.tare_kg)} kg</span></div>}
            {netKg != null && <div className="flex justify-between border-t border-slate-200 pt-1"><span className="font-semibold">Net Weight</span><span className="font-bold">{fmt2(netKg)} kg</span></div>}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 text-xs">
            <div>Statistics Officer / Price Set By: ..........................</div>
            <div>Seller: ..........................</div>
            <div>Weigher: ..........................</div>
            <div>Note: ..........................</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Main page ------------------------------------------------------------

export default function WeighingTickets() {
  const { profile, session } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState("");
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("waiting");
  const [showNew, setShowNew] = useState(false);
  const [finishTicket, setFinishTicket] = useState(null);
  const [declineTicketRow, setDeclineTicketRow] = useState(null);
  const [slipTicket, setSlipTicket] = useState(null);
  const [finalReceipt, setFinalReceipt] = useState(null);
  const [syncStatus, setSyncStatus] = useState({ online: true, syncing: false, pending: 0 });

  const effectiveLocationId = isAdmin ? locationId : profile?.location_id;

  useEffect(() => {
    api.getLocations().then((locs) => {
      setLocations(locs);
      if (!isAdmin && profile?.location_id) setLocationId(profile.location_id);
    });
    // Starts trying to send any queued offline changes the moment the
    // connection is back (plus a 15s safety check), and keeps the local
    // supplier/buyer/product lookup lists fresh whenever we're online.
    startAutoSync();
    refreshLookupCaches();
    const unsub = onSyncStatusChange(setSyncStatus);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    // Only pull tickets still in progress — once finalized a ticket has
    // become a normal transaction and belongs in the Transactions list
    // instead, not on this board.
    let serverRows = null;
    try {
      serverRows = await api.getTickets({ locationId: effectiveLocationId || undefined, stages: ALL_STAGE_IDS });
    } catch {
      serverRows = null; // offline, or the request failed — fall back to the local cache below
    }
    const merged = serverRows ? mergeServerTickets(serverRows) : getCachedTickets();
    const visible = merged.filter((t) => ALL_STAGE_IDS.includes(t.stage) && (!effectiveLocationId || t.location_id === effectiveLocationId));
    setTickets(visible);
    setLoading(false);
  }
  useEffect(() => { load(); }, [effectiveLocationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once a sync round finishes with nothing left queued, refresh from the
  // server so friendly names (station, which staff member weighed it,
  // etc.) fill in for anything that was created or updated offline.
  useEffect(() => {
    if (!syncStatus.syncing && syncStatus.pending === 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus.syncing, syncStatus.pending]);

  const grouped = useMemo(() => {
    const waiting = tickets.filter((t) => OPEN_STAGE_IDS.includes(t.stage));
    const declined = tickets.filter((t) => t.stage === "declined");
    return { waiting, declined };
  }, [tickets]);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Weighing Tickets" subtitle="Weigh in once, finish the ticket once the truck's back and empty" />

      {(!syncStatus.online || syncStatus.pending > 0 || syncStatus.syncing) && (
        <div className={`flex items-center gap-2 px-6 py-2 text-xs font-medium ${!syncStatus.online ? "bg-amber-50 text-amber-700" : "bg-brand-50 text-brand-700"}`}>
          {!syncStatus.online ? <WifiOff size={13} /> : <RefreshCw size={13} className={syncStatus.syncing ? "animate-spin" : ""} />}
          {!syncStatus.online
            ? `No internet — working offline. ${syncStatus.pending > 0 ? `${syncStatus.pending} change${syncStatus.pending === 1 ? "" : "s"} will sync once it's back.` : "Everything you do here is saved on this device."}`
            : syncStatus.syncing
              ? "Connected — syncing changes to PaddyTrade…"
              : `Connected — ${syncStatus.pending} change${syncStatus.pending === 1 ? "" : "s"} waiting to sync…`}
        </div>
      )}

      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1 overflow-x-auto">
            <button onClick={() => setTab("waiting")}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${tab === "waiting" ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              Weighed In — Out for Quality Check <span className={`rounded-full px-1.5 text-xs ${tab === "waiting" ? "bg-brand-700" : "bg-slate-200"}`}>{grouped.waiting.length}</span>
            </button>
            <button onClick={() => setTab("declined")}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${tab === "declined" ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              Declined <span className={`rounded-full px-1.5 text-xs ${tab === "declined" ? "bg-brand-700" : "bg-slate-200"}`}>{grouped.declined.length}</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && locations.length > 1 && (
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                <option value="">All Locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              <Plus size={15} /> New Ticket (Weigh In)
            </button>
          </div>
        </div>
        {tab === "waiting" && <p className="mt-2 text-xs text-slate-400">A ticket shows up here once it's been weighed in — the queue slip and quality/price decision on paper happen before this, same as today.</p>}
      </div>

      <main className="flex-1 overflow-y-auto bg-slate-100 p-6">
        {loading ? (
          <p className="text-center text-sm text-slate-400">Loading…</p>
        ) : grouped[tab]?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">No tickets here right now.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grouped[tab]?.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <p className="flex items-center gap-1.5 font-semibold text-slate-800">
                      {t.code}
                      {pendingCountForTicket(t.id) > 0 && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">not synced</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">{t.stationName} · {t.type}{t.gross_at ? ` · weighed in ${new Date(t.gross_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</p>
                  </div>
                  <button onClick={() => setSlipTicket(t)} className="text-slate-400 hover:text-brand-600" title="View / print slip"><Printer size={16} /></button>
                </div>
                <div className="mb-3 space-y-0.5 text-sm">
                  <p className="text-slate-700">{t.party_name} <span className="text-slate-400">· {t.car_plate}</span></p>
                  <p className="text-slate-500">{t.product_name}</p>
                  {t.gross_kg != null && <p className="text-slate-500">Gross: {fmt2(t.gross_kg)} kg {t.grossByName && <span className="text-slate-400">by {t.grossByName}</span>}</p>}
                  {t.paper_ticket_no && <p className="text-xs text-slate-400">Quality Ticket No. {t.paper_ticket_no}</p>}
                </div>
                {tab === "waiting" && (
                  <div className="flex gap-2">
                    <button onClick={() => setFinishTicket(t)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700">
                      Finish Ticket <ArrowRight size={14} />
                    </button>
                    <button onClick={() => setDeclineTicketRow(t)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50">
                      Decline
                    </button>
                  </div>
                )}
                {tab === "declined" && <p className="text-center text-xs font-medium text-rose-500">Declined — {t.price_note || "no reason given"}</p>}
              </div>
            ))}
          </div>
        )}
      </main>

      {showNew && (
        <NewTicketModal
          locations={locations}
          defaultLocationId={effectiveLocationId}
          isAdmin={isAdmin}
          onClose={() => setShowNew(false)}
          onCreated={(t) => { setShowNew(false); load(); setSlipTicket(t); }}
        />
      )}
      {finishTicket && (
        <FinishTicketModal
          ticket={finishTicket}
          onClose={() => setFinishTicket(null)}
          onFinalized={(tx) => {
            // finalizeTicketOffline already fills in partyName/partyIdNumber
            // (Receipt.jsx's expected shape), offline or not.
            setFinalReceipt(tx);
            setFinishTicket(null);
            load();
          }}
          onDeclined={() => { setFinishTicket(null); load(); }}
        />
      )}
      {declineTicketRow && (
        <DeclineModal
          ticket={declineTicketRow}
          onClose={() => setDeclineTicketRow(null)}
          onDeclined={() => { setDeclineTicketRow(null); load(); }}
        />
      )}
      {slipTicket && <TicketSlip ticket={slipTicket} onClose={() => setSlipTicket(null)} />}
      {finalReceipt && (
        <div className="fixed inset-0 z-50 bg-white">
          <Receipt tx={finalReceipt} onDone={() => setFinalReceipt(null)} />
        </div>
      )}
    </div>
  );
}
