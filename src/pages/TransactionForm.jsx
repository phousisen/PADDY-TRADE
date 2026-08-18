import { useEffect, useMemo, useState } from "react";
import { Search, Save, ScanLine } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import PhotoUpload from "../components/PhotoUpload.jsx";
import Receipt from "./Receipt.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

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

export default function TransactionForm({ type, setPage }) {
  const isBuy = type === "BUY";
  const { t } = useLanguage();
  const { profile, session } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [stations, setStations] = useState([]);
  const [stationsLoaded, setStationsLoaded] = useState(false);
  const [products, setProducts] = useState([]);
  const [parties, setParties] = useState([]);
  const [settings, setSettings] = useState({});
  const [stationId, setStationId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [partyQuery, setPartyQuery] = useState("");
  const [selectedParty, setSelectedParty] = useState(null);
  const [partyPhone, setPartyPhone] = useState("");
  const [partyIdNumber, setPartyIdNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankIsOther, setBankIsOther] = useState(false);
  const [bankAccount, setBankAccount] = useState("");
  const [bankQrUrl, setBankQrUrl] = useState(null);
  const [carPlate, setCarPlate] = useState("");
  const [company, setCompany] = useState("");
  const [destination, setDestination] = useState("dest_hq");
  const [qualityGrade, setQualityGrade] = useState("");
  const [grossKg, setGrossKg] = useState("");
  const [tareKg, setTareKg] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  const [priceOverridden, setPriceOverridden] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(isBuy ? "pending" : "paid");
  const [taxApplicable, setTaxApplicable] = useState(false);
  const [taxRate, setTaxRate] = useState("10");
  const [moisturePct, setMoisturePct] = useState("");
  const [mixturePct, setMixturePct] = useState("");
  const [outthrowPct, setOutthrowPct] = useState("");
  const [deductionKg, setDeductionKg] = useState("");
  const [note, setNote] = useState("");
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState(null);
  const [paymentProofUrl, setPaymentProofUrl] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedTx, setSavedTx] = useState(null);
  const [draftRestored, setDraftRestored] = useState(false);

  const draftKey = `paddytrade:draft:${type}`;

  // Restore any unfinished entry from before a reload / lost connection.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        // Product, Quality Grade, and Price per KG are deliberately NOT
        // restored from a saved draft — they should always start blank on
        // a fresh form so nothing gets carried over/re-used by accident.
        setPartyQuery(d.partyQuery || "");
        setPartyPhone(d.partyPhone || "");
        setPartyIdNumber(d.partyIdNumber || "");
        setBankName(d.bankName || "");
        setBankIsOther(!!d.bankName && !BANK_OPTIONS.includes(d.bankName));
        setBankAccount(d.bankAccount || "");
        setCompany(d.company || "");
        setDestination(d.destination || "dest_hq");
        setGrossKg(d.grossKg || "");
        setTareKg(d.tareKg || "");
        setCarPlate(d.carPlate || "");
        setPaymentStatus(d.paymentStatus || (isBuy ? "pending" : "paid"));
        setDraftRestored(true);
      }
    } catch (e) {}
  }, []);

  // Save a draft as the person types, so a dropped connection or accidental
  // reload doesn't lose what they entered.
  useEffect(() => {
    // Product, Quality Grade, and Price per KG are intentionally left out
    // of the saved draft (see restore effect above).
    const draft = {
      partyQuery, partyPhone, partyIdNumber, bankName, bankAccount,
      company, destination, grossKg, tareKg, paymentStatus, carPlate,
    };
    const hasContent = partyQuery || grossKg || tareKg;
    const timeout = setTimeout(() => {
      try {
        if (hasContent) localStorage.setItem(draftKey, JSON.stringify(draft));
        else localStorage.removeItem(draftKey);
      } catch (e) {}
    }, 400);
    return () => clearTimeout(timeout);
  }, [partyQuery, partyPhone, partyIdNumber, bankName, bankAccount, company, destination, grossKg, tareKg, paymentStatus, carPlate]);

  function clearDraft() {
    try { localStorage.removeItem(draftKey); } catch (e) {}
  }

  useEffect(() => {
    api.getLocations()
      .then((st) => {
        setStations(st);
        if (!isAdmin && profile?.location_id) {
          setStationId(profile.location_id);
        } else if (isAdmin && st[0]) {
          setStationId(st[0].id);
        }
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setStationsLoaded(true));

    api.getProducts().then(setProducts).catch(() => {});
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    api.getParties({ type: isBuy ? "supplier" : "buyer", q: partyQuery }).then(setParties).catch(() => {});
  }, [partyQuery]);

  useEffect(() => {
    if (isBuy && !priceOverridden && settings[`price_grade_${qualityGrade.toLowerCase()}_per_kg`]) {
      setPricePerKg(settings[`price_grade_${qualityGrade.toLowerCase()}_per_kg`]);
    }
  }, [qualityGrade, settings, isBuy, priceOverridden]);

  useEffect(() => {
    if (settings.default_vat_rate) setTaxRate(settings.default_vat_rate);
  }, [settings]);

  const netKg = Math.max(0, (parseFloat(grossKg) || 0) - (parseFloat(tareKg) || 0));
  const payableKg = Math.max(0, netKg - (parseFloat(deductionKg) || 0));
  const paymentProofRequired = paymentStatus === "paid" || paymentStatus === "deposit";
  const total = payableKg * (parseFloat(pricePerKg) || 0);
  const taxAmount = taxApplicable ? Math.round(total * (parseFloat(taxRate) || 0)) / 100 : 0;
  const totalWithTax = total + taxAmount;
  const myStation = stations.find((s) => s.id === (isAdmin ? stationId : profile?.location_id));

  function selectParty(p) {
    setSelectedParty(p);
    setPartyQuery(p.name);
    setPartyPhone(p.phone || "");
    setPartyIdNumber(p.id_number || "");
    setBankName(p.bank_name || "");
    setBankIsOther(!!p.bank_name && !BANK_OPTIONS.includes(p.bank_name));
    setBankAccount(p.bank_account || "");
    setBankQrUrl(p.bank_qr_url || null);
    setCompany(p.company || "");
    setDestination(p.destination || "dest_hq");
  }

  async function resolveProductId() {
    const name = productQuery.trim();
    const existing = products.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const created = await api.createProduct(name);
    return created.id;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const effectiveStationId = isAdmin ? stationId : profile?.location_id;
    if (!isAdmin && !effectiveStationId) { setError("Your account has no location assigned yet. Ask HQ to assign one to your login."); return; }
    if (!partyQuery.trim() || !effectiveStationId || !productQuery.trim() || netKg <= 0 || !pricePerKg) { setError(t("required_fields")); return; }
    if (!receiptPhotoUrl) { setError("A photo of the physical receipt is required."); return; }
    if (paymentProofRequired && !paymentProofUrl) { setError("A photo of the bank QR / payment proof is required when payment is marked as done."); return; }
    setSaving(true);
    try {
      let party = selectedParty;
      if (!party && partyPhone.trim()) {
        // Someone with this exact phone number may already exist —
        // reuse them instead of creating a duplicate.
        const matches = await api.getParties({ type: isBuy ? "supplier" : "buyer", phone: partyPhone.trim() });
        if (matches.length > 0) party = matches[0];
      }
      if (!party) {
        party = await api.createParty({
          name: partyQuery.trim(),
          type: isBuy ? "supplier" : "buyer",
          phone: partyPhone,
          idNumber: partyIdNumber,
          bankName: isBuy ? bankName : undefined,
          bankAccount: isBuy ? bankAccount : undefined,
          bankQrUrl: isBuy && bankName !== "Cash" ? bankQrUrl : undefined,
          company: !isBuy ? company : undefined,
          destination: !isBuy ? destination : undefined,
          locationId: effectiveStationId,
        });
      } else if (isBuy) {
        // Existing farmer — if their bank details or QR code were corrected
        // or added here, keep their saved profile in sync.
        const patch = {};
        if (bankName !== (party.bank_name || "")) patch.bankName = bankName;
        if (bankAccount !== (party.bank_account || "")) patch.bankAccount = bankAccount;
        if (bankName !== "Cash" && bankQrUrl && bankQrUrl !== (party.bank_qr_url || "")) patch.bankQrUrl = bankQrUrl;
        if (Object.keys(patch).length > 0) {
          try { await api.updateParty(party.id, patch); } catch (err) { console.error("Party profile update failed", err); }
        }
      }
      const productId = await resolveProductId();
      const tx = await api.createTransaction({
        type, locationId: effectiveStationId, partyId: party.id, productId,
        quantityKg: netKg, pricePerKg: parseFloat(pricePerKg), paymentStatus, userId: session.user.id,
        qualityGrade: isBuy ? (qualityGrade.trim() || null) : null,
        taxApplicable, taxRate: parseFloat(taxRate) || 0,
        moisturePct: parseFloat(moisturePct) || 0, mixturePct: parseFloat(mixturePct) || 0,
        outthrowPct: parseFloat(outthrowPct) || 0, deductionKg: parseFloat(deductionKg) || 0,
        note: note.trim() || null,
        carPlate: carPlate.trim() || null,
        receiptPhotoUrl, paymentProofUrl,
      });

      // If it was entered as already paid, record that cash movement immediately
      // so it shows up correctly in Accounts Payable/Receivable and Cash Flow.
      if (paymentStatus === "paid") {
        try {
          await api.createPayment({
            type: isBuy ? "pay_supplier" : "receive_customer",
            transactionId: tx.id,
            locationId: effectiveStationId,
            amount: tx.total_with_tax ?? tx.amount,
            method: "cash",
            payDate: tx.tx_date,
            memo: "Paid at time of transaction",
            userId: session.user.id,
          });
        } catch (payErr) {
          // Don't block the receipt over this — the transaction itself saved fine.
          console.error("Auto-payment record failed", payErr);
        }
      }

      setSavedTx({ ...tx, partyName: party.name, partyIdNumber: party.phone || party.id_number || "" });
      clearDraft();
    } catch (err) {
      const isNetworkError = err.message && (err.message.includes("fetch") || err.message.includes("network") || err.message.includes("Failed"));
      setError(
        isNetworkError
          ? "Couldn't reach the server — check your connection and try again. Nothing you entered has been lost."
          : (err.message || String(err))
      );
    } finally {
      setSaving(false);
    }
  }

  if (savedTx) {
    return <Receipt tx={savedTx} onDone={() => setPage("transactions")} />;
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={isBuy ? t("new_buy_title") : t("new_sell_title")} />
      <main className="flex-1 overflow-y-auto p-6">
        {draftRestored && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <span>Restored an unfinished entry from before — check it over before saving.</span>
            <button
              type="button"
              onClick={() => { clearDraft(); window.location.reload(); }}
              className="rounded-md border border-amber-300 px-2 py-1 text-amber-700 hover:bg-amber-100"
            >
              Discard & start blank
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-5">
          <div className="col-span-2 space-y-5">
            {/* Section 1: Party Information */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-700">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-xs text-white">1</span>
                {isBuy ? t("section1_seller") : t("section1_buyer")}
              </h3>
              <div className="relative mb-3">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={partyQuery} onChange={(e) => { setPartyQuery(e.target.value); setSelectedParty(null); }} placeholder={t("search_party_placeholder")}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                {partyQuery && !selectedParty && parties.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                    {parties.map((p) => (
                      <button type="button" key={p.id} onClick={() => selectParty(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <span>{p.name}</span><span className="text-xs text-slate-400">{p.id_number}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-[11px] text-slate-400">Type a name to search, or a new name to add them.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs text-slate-500">{t("phone")}</label><input value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} placeholder="+855 XX XXX XXX" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>

                {isBuy ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">{t("bank_name")}</label>
                      <select
                        value={bankIsOther ? "__other__" : bankName}
                        onChange={(e) => {
                          if (e.target.value === "__other__") { setBankIsOther(true); setBankName(""); }
                          else { setBankIsOther(false); setBankName(e.target.value); }
                        }}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                      >
                        <option value="" disabled>Select payment method / bank</option>
                        {BANK_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                        <option value="__other__">Other...</option>
                      </select>
                      {bankIsOther && (
                        <input
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          placeholder="Type bank name"
                          className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                        />
                      )}
                    </div>
                    <div><label className="mb-1 block text-xs text-slate-500">{t("bank_account")}</label><input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                  </>
                ) : (
                  <>
                    <div><label className="mb-1 block text-xs text-slate-500">{t("company_name")}</label><input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">{t("destination")}</label>
                      <input list="destination-options" value={destination} onChange={(e) => setDestination(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                      <datalist id="destination-options">
                        <option value="dest_hq">{t("dest_hq")}</option>
                        <option value="dest_factory">{t("dest_factory")}</option>
                        <option value="dest_border">{t("dest_border")}</option>
                        <option value="dest_other">{t("dest_other")}</option>
                      </datalist>
                    </div>
                  </>
                )}

                {isAdmin && (
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">{t("station")}</label>
                    <select value={stationId} onChange={(e) => setStationId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                      {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {isBuy && bankName && bankName !== "Cash" && (
                <div className="mt-4">
                  <PhotoUpload
                    label="Bank QR Code" kind="party-bank-qr"
                    url={bankQrUrl} onUploaded={setBankQrUrl}
                    hint={`Photo of this farmer's ${bankName} QR code — saved to their profile, not just this transaction`}
                  />
                </div>
              )}
            </section>

            {/* Section 2: Weighbridge Data */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-700">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-xs text-white">2</span>
                <ScanLine size={16} /> {t("section2_weighbridge")}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs text-slate-500">{t("gross_weight")}</label><input type="number" min="0" step="0.01" value={grossKg} onChange={(e) => setGrossKg(e.target.value)} placeholder="0" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                <div><label className="mb-1 block text-xs text-slate-500">{t("tare_weight")}</label><input type="number" min="0" step="0.01" value={tareKg} onChange={(e) => setTareKg(e.target.value)} placeholder="0" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">{t("car_plate_number")}</label>
                  <input value={carPlate} onChange={(e) => setCarPlate(e.target.value)} placeholder="e.g. 2AB-1234"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                </div>
              </div>
              <div className="mt-4 rounded-lg bg-brand-50 p-4 text-center">
                <p className="text-xs text-brand-700/70">{t("net_weight")}</p>
                <p className="text-4xl font-bold text-brand-800">{fmt2(netKg)} <span className="text-lg font-medium text-brand-600">KG</span></p>
                {parseFloat(deductionKg) > 0 && (
                  <p className="mt-1 text-xs text-brand-700/70">Payable: <span className="font-semibold text-brand-800">{fmt2(payableKg)} kg</span> (after {fmt2(parseFloat(deductionKg))} kg deduction)</p>
                )}
              </div>
              <div className="mt-4">
                <PhotoUpload
                  label="Physical Receipt Photo" kind="receipt" required
                  url={receiptPhotoUrl} onUploaded={setReceiptPhotoUrl}
                  hint="Photo of the printed weighbridge ticket/receipt"
                />
              </div>
            </section>

            {/* Section 3: Quality & Pricing */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-700">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-xs text-white">3</span>
                Quality &amp; Pricing
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">{t("product")}</label>
                  <input list="product-options" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Type or pick a product"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  <datalist id="product-options">
                    {products.map((p) => <option key={p.id} value={p.name} />)}
                  </datalist>
                </div>
                {isBuy && (
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">{t("quality_grade")}</label>
                    <input list="grade-options" value={qualityGrade} onChange={(e) => { setQualityGrade(e.target.value); setPriceOverridden(false); }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                    <datalist id="grade-options">
                      <option value="A">{t("grade_a")}</option>
                      <option value="B">{t("grade_b")}</option>
                      <option value="C">{t("grade_c")}</option>
                    </datalist>
                    <p className="mt-1 text-[11px] text-slate-400">A/B/C auto-fills the price — type anything else to set your own.</p>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs text-slate-500">{t("price_per_kg")}</label>
                  <input type="number" min="0" step="0.01" value={pricePerKg}
                    onChange={(e) => { setPricePerKg(e.target.value); setPriceOverridden(true); }}
                    placeholder="0.00" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  {isBuy && <p className="mt-1 text-[11px] text-slate-400">Auto-filled from grade — edit to override</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">{t("payment_status")}</label>
                  <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                    {isBuy ? (<><option value="pending">{t("pendingpay")}</option><option value="paid">{t("paid")}</option></>) : (<><option value="paid">{t("paid")}</option><option value="credit">{t("credit")}</option><option value="deposit">{t("deposit")}</option></>)}
                  </select>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Payment status choices are fixed — they feed your Financial Reports directly.</p>

              {paymentProofRequired && (
                <div className="mt-3">
                  <PhotoUpload
                    label="Bank QR / Payment Proof Photo" kind="payment-proof" required
                    url={paymentProofUrl} onUploaded={setPaymentProofUrl}
                    hint="Photo of the bank transfer QR code or payment confirmation"
                  />
                </div>
              )}

              <div className="mt-3 rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-xs font-medium text-slate-500">Quality Deduction (optional)</p>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">Moisture %</label>
                    <input type="number" min="0" step="0.1" value={moisturePct} onChange={(e) => setMoisturePct(e.target.value)} placeholder="0"
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">Mixture %</label>
                    <input type="number" min="0" step="0.1" value={mixturePct} onChange={(e) => setMixturePct(e.target.value)} placeholder="0"
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">Outthrow %</label>
                    <input type="number" min="0" step="0.1" value={outthrowPct} onChange={(e) => setOutthrowPct(e.target.value)} placeholder="0"
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">Deduction (kg)</label>
                    <input type="number" min="0" step="0.01" value={deductionKg} onChange={(e) => setDeductionKg(e.target.value)} placeholder="0"
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">Moisture/Mixture/Outthrow are for your records — only Deduction (kg) actually reduces the payable weight used for pricing. Stock still reflects the full physical weight received.</p>
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-xs text-slate-500">Note (optional)</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. from Weighbridge Ticket WT0134"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              </div>

              <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={taxApplicable} onChange={(e) => setTaxApplicable(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400" />
                  Apply VAT
                </label>
                {taxApplicable && (
                  <div className="flex items-center gap-1.5">
                    <input type="number" min="0" step="0.1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)}
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                )}
              </div>
            </section>
            {error && <p className="text-sm text-rose-500">{error}</p>}
          </div>

          <div className="col-span-1">
            <div className="sticky top-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-semibold text-slate-700">{t("summary")}</h3>
              <div className="mb-4 rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 p-4 text-white">
                <p className="text-xs text-brand-100/80">{taxApplicable ? "Subtotal" : t("total_amount")}</p>
                <p className="mt-1 text-3xl font-bold">{fmtRiel(total)}</p>
                <p className="mt-2 text-xs text-brand-100/70">{fmt2(payableKg)} kg × {fmtRiel(parseFloat(pricePerKg) || 0)}/kg</p>
                {taxApplicable && (
                  <div className="mt-3 border-t border-white/20 pt-3">
                    <div className="flex justify-between text-xs text-brand-100/80">
                      <span>VAT ({taxRate || 0}%)</span>
                      <span>{fmtRiel(taxAmount)}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-sm font-bold">
                      <span>{t("total_amount")}</span>
                      <span>{fmtRiel(totalWithTax)}</span>
                    </div>
                  </div>
                )}
              </div>
              <button type="submit" disabled={saving} className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                <Save size={16} /> {saving ? "..." : t("save_transaction")}
              </button>
              <button type="button" onClick={() => setPage("transactions")} className="mt-2 w-full rounded-lg py-2 text-xs text-slate-400 hover:text-slate-600">← {t("back")}</button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
