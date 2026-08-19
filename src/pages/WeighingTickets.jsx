import { useEffect, useMemo, useState } from "react";
import { Plus, Scale, Printer, X, ArrowRight, Ban, Check } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import Receipt from "./Receipt.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
function cambodiaDateStr(d = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const STAGES = [
  { id: "arrived", label: "Arrived", next: "Weigh In" },
  { id: "weighed_in", label: "Awaiting Price", next: "Set Price" },
  { id: "priced", label: "Awaiting Weigh-Out", next: "Weigh Out" },
  { id: "weighed_out", label: "Ready to Finalize", next: "Finalize" },
  { id: "declined", label: "Declined", next: null },
];

// Resolve a typed name to an existing party (exact match) or create a new
// one — same pattern used for editing transactions elsewhere in the app.
async function resolvePartyId(typedName, type, locationId, extra = {}) {
  const trimmed = (typedName || "").trim();
  if (!trimmed) return null;
  const matches = await api.getParties({ type, q: trimmed }).catch(() => []);
  const exact = (matches || []).find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact.id;
  // Brand new seller/buyer — save what was written on the ticket onto their
  // new profile too, so it's already there next time they come by.
  const created = await api.createParty({
    name: trimmed, type, locationId,
    phone: extra.phone, bankName: extra.bankName, bankAccount: extra.bankAccount,
  });
  return created.id;
}

async function resolveProductId(typedName, products) {
  const trimmed = (typedName || "").trim();
  if (!trimmed) return null;
  const existing = products.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing.id;
  const created = await api.createProduct(trimmed);
  return created.id;
}

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

function LiveWeightBox({ locationId, onUse }) {
  const { connected, weightKg } = useLiveWeight(locationId);
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${connected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
        <div>
          <p className={`text-xs font-medium ${connected ? "text-emerald-700" : "text-slate-400"}`}>{connected ? "Live Scale Weight" : "Scale not connected"}</p>
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

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`no-print w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1 block text-xs text-slate-500";

// ---- New Ticket -------------------------------------------------------

function NewTicketModal({ locations, defaultLocationId, isAdmin, onClose, onCreated }) {
  const [type, setType] = useState("BUY");
  const [locationId, setLocationId] = useState(defaultLocationId || "");
  const [partyName, setPartyName] = useState("");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [carPlate, setCarPlate] = useState("");
  const [driverName, setDriverName] = useState("");
  const [productName, setProductName] = useState("");
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { session } = useAuth();

  useEffect(() => { api.getProducts().then(setProducts).catch(() => {}); }, []);

  async function submit() {
    if (!locationId || !partyName.trim() || !productName.trim() || !carPlate.trim()) {
      setError("Please fill in location, party name, product, and plate number.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const partyId = await resolvePartyId(partyName, type === "BUY" ? "supplier" : "buyer", locationId, { phone, bankName, bankAccount });
      const productId = await resolveProductId(productName, products);
      const ticket = await api.createTicket({
        type, locationId, partyId, partyName: partyName.trim(), phone, bankName, bankAccount,
        carPlate, driverName, productId, productName: productName.trim(), userId: session.user.id,
      });
      onCreated(ticket);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New Ticket — Truck Arrival" onClose={onClose} wide>
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
        <div className="col-span-2"><label className={labelCls}>{type === "BUY" ? "Seller (Farmer) Name" : "Buyer Name"}</label><input value={partyName} onChange={(e) => setPartyName(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Bank</label><input value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Bank Account</label><input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Product (paddy type)</label><input value={productName} onChange={(e) => setProductName(e.target.value)} className={inputCls} placeholder="e.g. Sror Ngae" /></div>
        <div><label className={labelCls}>Vehicle Plate Number</label><input value={carPlate} onChange={(e) => setCarPlate(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Driver Name</label><input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inputCls} /></div>
      </div>
      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
        <button disabled={saving} onClick={submit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">{saving ? "Saving…" : "Create Ticket & Weigh In"}</button>
      </div>
    </Modal>
  );
}

// ---- Weigh In / Weigh Out (shared shape) ----------------------------------

function WeighModal({ ticket, mode, onClose, onDone }) {
  // mode: "in" (gross) or "out" (tare)
  const isIn = mode === "in";
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const { session } = useAuth();

  async function submit() {
    const kg = parseFloat(value);
    if (!kg || kg <= 0) return;
    setSaving(true);
    try {
      const updated = isIn
        ? await api.setTicketGross(ticket.id, { grossKg: kg, userId: session.user.id })
        : await api.setTicketTare(ticket.id, { tareKg: kg, userId: session.user.id });
      onDone(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isIn ? "Weigh In — Loaded" : "Weigh Out — Empty"} onClose={onClose}>
      <p className="mb-3 text-xs text-slate-400">{ticket.code} · {ticket.party_name} · {ticket.car_plate}</p>
      <LiveWeightBox locationId={ticket.location_id} onUse={(kg) => setValue(String(kg))} />
      <label className={labelCls}>{isIn ? "Gross Weight (kg)" : "Tare Weight (kg)"}</label>
      <input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} placeholder="0" />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
        <button disabled={saving || !value} onClick={submit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">{saving ? "Saving…" : "Confirm & Print Slip"}</button>
      </div>
    </Modal>
  );
}

// ---- Quality + Price --------------------------------------------------

function PriceModal({ ticket, onClose, onDone }) {
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
  const [saving, setSaving] = useState(false);
  const { session } = useAuth();

  async function submit(decline) {
    setSaving(true);
    try {
      const updated = await api.setTicketPrice(ticket.id, {
        qualityGrade, moisturePct: parseFloat(moisturePct) || 0, mixturePct: parseFloat(mixturePct) || 0,
        outthrowPct: parseFloat(outthrowPct) || 0, deductionKg: parseFloat(deductionKg) || 0,
        pricePerKg: parseFloat(pricePerKg) || 0, staffFee: parseFloat(staffFee) || 0,
        taxApplicable, taxRate: parseFloat(taxRate) || 0, priceNote, userId: session.user.id, decline,
      });
      onDone(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Quality Check & Price" onClose={onClose} wide>
      <p className="mb-3 text-xs text-slate-400">{ticket.code} · {ticket.party_name} · {ticket.car_plate} · Gross: {fmt2(ticket.gross_kg)} kg</p>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={labelCls}>Quality Grade</label><input value={qualityGrade} onChange={(e) => setQualityGrade(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Moisture %</label><input type="number" value={moisturePct} onChange={(e) => setMoisturePct(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Mixture %</label><input type="number" value={mixturePct} onChange={(e) => setMixturePct(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Outthrow %</label><input type="number" value={outthrowPct} onChange={(e) => setOutthrowPct(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Deduction (kg)</label><input type="number" value={deductionKg} onChange={(e) => setDeductionKg(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Price / kg (៛)</label><input type="number" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} className={inputCls} /></div>
        {isBuy && (
          <div><label className={labelCls}>Staff / Carrying Fee (optional)</label><input type="number" value={staffFee} onChange={(e) => setStaffFee(e.target.value)} className={inputCls} /></div>
        )}
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={taxApplicable} onChange={(e) => setTaxApplicable(e.target.checked)} /> Tax applicable</label>
          {taxApplicable && <input type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={`${inputCls} w-20`} />}
        </div>
        <div className="col-span-3"><label className={labelCls}>Note</label><input value={priceNote} onChange={(e) => setPriceNote(e.target.value)} className={inputCls} /></div>
      </div>
      <p className="mt-3 text-xs text-slate-400">Whoever sets the price here will be recorded on the printed slip — leave a blank line to sign by hand, same as the paper ticket today.</p>
      <div className="mt-4 flex justify-between gap-2">
        <button onClick={() => submit(true)} disabled={saving} className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40">
          <Ban size={14} /> Not Buying
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
          <button disabled={saving || !pricePerKg} onClick={() => submit(false)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">{saving ? "Saving…" : "Confirm Price & Print Slip"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Finalize -----------------------------------------------------------

function FinalizeModal({ ticket, onClose, onFinalized }) {
  const [txDate, setTxDate] = useState(cambodiaDateStr());
  const [saving, setSaving] = useState(false);
  const { session } = useAuth();

  const netKg = Math.max(0, (ticket.gross_kg || 0) - (ticket.tare_kg || 0));
  const payableKg = Math.max(0, netKg - (ticket.deduction_kg || 0));
  const staffFeeAmt = ticket.type === "BUY" ? (ticket.staff_fee || 0) : 0;
  const subtotal = Math.max(0, payableKg * (ticket.price_per_kg || 0) - staffFeeAmt);
  const taxAmount = ticket.tax_applicable ? Math.round(subtotal * (ticket.tax_rate || 0)) / 100 : 0;
  const total = subtotal + taxAmount;

  async function submit() {
    setSaving(true);
    try {
      const tx = await api.finalizeTicket(ticket.id, { userId: session.user.id, txDate });
      onFinalized(tx);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Finalize — Create Receipt" onClose={onClose}>
      <p className="mb-3 text-xs text-slate-400">{ticket.code} · {ticket.party_name} · {ticket.car_plate}</p>
      <div className="mb-3 space-y-1.5 rounded-lg bg-slate-50 p-4 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Gross</span><span className="font-medium">{fmt2(ticket.gross_kg)} kg</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Tare</span><span className="font-medium">{fmt2(ticket.tare_kg)} kg</span></div>
        <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="text-slate-500">Net Weight</span><span className="font-medium">{fmt2(netKg)} kg</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Price / kg</span><span className="font-medium">{fmtRiel(ticket.price_per_kg)}</span></div>
        <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="font-semibold text-slate-700">Total</span><span className="font-bold text-brand-700">{fmtRiel(total)}</span></div>
      </div>
      <label className={labelCls}>Transaction Date</label>
      <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} max={cambodiaDateStr()} className={inputCls} />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
        <button disabled={saving} onClick={submit} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">
          <Check size={14} /> {saving ? "Finalizing…" : "Finalize & Print Receipt"}
        </button>
      </div>
    </Modal>
  );
}

// ---- Interim slip (printed at each stage, mirrors the paper ticket) ------

function TicketSlip({ ticket, onClose }) {
  const netKg = ticket.gross_kg != null && ticket.tare_kg != null ? Math.max(0, ticket.gross_kg - ticket.tare_kg) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <div className="no-print mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">Ticket Slip</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"><Printer size={13} /> Print</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
        </div>
        <div id="ticket-slip-root" className="border border-slate-300 p-4 text-sm">
          <p className="text-center text-base font-bold">Ticket {ticket.code}</p>
          <p className="text-center text-xs text-slate-500">{ticket.stationName}</p>
          <hr className="my-2" />
          <div className="space-y-1">
            <div className="flex justify-between"><span>Truck ID</span><span className="font-medium">{ticket.car_plate}</span></div>
            <div className="flex justify-between"><span>Driver</span><span className="font-medium">{ticket.driver_name || "—"}</span></div>
            <div className="flex justify-between"><span>Product</span><span className="font-medium">{ticket.product_name}</span></div>
            <div className="flex justify-between"><span>Buyer/Seller</span><span className="font-medium">{ticket.party_name}</span></div>
            {ticket.gross_kg != null && <div className="flex justify-between"><span>IN (Gross)</span><span className="font-medium">{fmt2(ticket.gross_kg)} kg</span></div>}
            {ticket.moisture_pct != null && ticket.priced_at && <div className="flex justify-between"><span>Moisture</span><span className="font-medium">{fmt2(ticket.moisture_pct)} %</span></div>}
            {ticket.mixture_pct != null && ticket.priced_at && <div className="flex justify-between"><span>Mixture</span><span className="font-medium">{fmt2(ticket.mixture_pct)} %</span></div>}
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
  const [tab, setTab] = useState("arrived");
  const [showNew, setShowNew] = useState(false);
  const [weighTicket, setWeighTicket] = useState(null); // { ticket, mode }
  const [priceTicket, setPriceTicket] = useState(null);
  const [finalizeTicketRow, setFinalizeTicketRow] = useState(null);
  const [slipTicket, setSlipTicket] = useState(null);
  const [finalReceipt, setFinalReceipt] = useState(null);

  const effectiveLocationId = isAdmin ? locationId : profile?.location_id;

  useEffect(() => {
    api.getLocations().then((locs) => {
      setLocations(locs);
      if (!isAdmin && profile?.location_id) setLocationId(profile.location_id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    // Only pull tickets still in progress — once finalized (or cancelled)
    // a ticket has become a normal transaction and belongs in the
    // Transactions list instead, not on this board.
    const rows = await api
      .getTickets({ locationId: effectiveLocationId || undefined, stages: STAGES.map((s) => s.id) })
      .catch(() => []);
    setTickets(rows);
    setLoading(false);
  }
  useEffect(() => { load(); }, [effectiveLocationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const map = {};
    STAGES.forEach((s) => { map[s.id] = []; });
    tickets.forEach((t) => { if (map[t.stage]) map[t.stage].push(t); });
    return map;
  }, [tickets]);

  function handleAction(ticket, action) {
    if (action === "weighed_in_target") setWeighTicket({ ticket, mode: "in" });
    else if (action === "price") setPriceTicket(ticket);
    else if (action === "weighed_out_target") setWeighTicket({ ticket, mode: "out" });
    else if (action === "finalize") setFinalizeTicketRow(ticket);
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Weighing Tickets" subtitle="Digital ticket that follows a truck from arrival to final receipt" />

      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1 overflow-x-auto">
            {STAGES.map((s) => (
              <button key={s.id} onClick={() => setTab(s.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${tab === s.id ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                {s.label} <span className={`rounded-full px-1.5 text-xs ${tab === s.id ? "bg-brand-700" : "bg-slate-200"}`}>{grouped[s.id]?.length || 0}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && locations.length > 1 && (
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                <option value="">All Locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              <Plus size={15} /> New Ticket
            </button>
          </div>
        </div>
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
                    <p className="font-semibold text-slate-800">{t.code}</p>
                    <p className="text-xs text-slate-400">{t.stationName} · {t.type}</p>
                  </div>
                  <button onClick={() => setSlipTicket(t)} className="text-slate-400 hover:text-brand-600" title="View / print slip"><Printer size={16} /></button>
                </div>
                <div className="mb-3 space-y-0.5 text-sm">
                  <p className="text-slate-700">{t.party_name} <span className="text-slate-400">· {t.car_plate}</span></p>
                  <p className="text-slate-500">{t.product_name}</p>
                  {t.gross_kg != null && <p className="text-slate-500">Gross: {fmt2(t.gross_kg)} kg {t.grossByName && <span className="text-slate-400">by {t.grossByName}</span>}</p>}
                  {t.price_per_kg != null && <p className="text-slate-500">Price: {fmtRiel(t.price_per_kg)}/kg {t.pricedByName && <span className="text-slate-400">by {t.pricedByName}</span>}</p>}
                  {t.tare_kg != null && <p className="text-slate-500">Tare: {fmt2(t.tare_kg)} kg {t.tareByName && <span className="text-slate-400">by {t.tareByName}</span>}</p>}
                </div>
                {t.stage === "arrived" && (
                  <button onClick={() => handleAction(t, "weighed_in_target")} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700">
                    <Scale size={14} /> Weigh In <ArrowRight size={14} />
                  </button>
                )}
                {t.stage === "weighed_in" && (
                  <button onClick={() => handleAction(t, "price")} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700">
                    Set Price <ArrowRight size={14} />
                  </button>
                )}
                {t.stage === "priced" && (
                  <button onClick={() => handleAction(t, "weighed_out_target")} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700">
                    <Scale size={14} /> Weigh Out <ArrowRight size={14} />
                  </button>
                )}
                {t.stage === "weighed_out" && (
                  <button onClick={() => handleAction(t, "finalize")} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                    <Check size={14} /> Finalize
                  </button>
                )}
                {t.stage === "declined" && <p className="text-center text-xs font-medium text-rose-500">Not buying — {t.price_note || "no reason given"}</p>}
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
      {weighTicket && (
        <WeighModal
          ticket={weighTicket.ticket}
          mode={weighTicket.mode}
          onClose={() => setWeighTicket(null)}
          onDone={(updated) => { setWeighTicket(null); load(); setSlipTicket(updated); }}
        />
      )}
      {priceTicket && (
        <PriceModal
          ticket={priceTicket}
          onClose={() => setPriceTicket(null)}
          onDone={(updated) => { setPriceTicket(null); load(); setSlipTicket(updated); }}
        />
      )}
      {finalizeTicketRow && (
        <FinalizeModal
          ticket={finalizeTicketRow}
          onClose={() => setFinalizeTicketRow(null)}
          onFinalized={(tx) => {
            setFinalReceipt({ ...tx, partyName: finalizeTicketRow.party_name, partyIdNumber: finalizeTicketRow.phone });
            setFinalizeTicketRow(null);
            load();
          }}
        />
      )}
      {slipTicket && <TicketSlip ticket={slipTicket} onClose={() => setSlipTicket(null)} />}
      {finalReceipt && <Receipt tx={finalReceipt} onDone={() => setFinalReceipt(null)} />}
    </div>
  );
}
