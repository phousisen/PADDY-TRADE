import { useEffect, useMemo, useState } from "react";
import { Search, Save, ScanLine, WifiOff, RefreshCw } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import PhotoUpload from "../components/PhotoUpload.jsx";
import WeightField from "../components/WeightField.jsx";
import Receipt from "./Receipt.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import {
  withTimeout, resolvePartyIdOffline, resolveProductIdOffline, updatePartyOffline,
  createTransactionOffline, createPaymentOffline, logAuditOffline, onSyncStatusChange,
} from "../offlineQueue.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting — used as the default so the
// date box starts on "today" for Cambodia, not wherever the browser is set.
function cambodiaDateStr(d = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

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

export default function TransactionForm({ type, setPage, prefillParty, clearPrefill }) {
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
  // Defaults to today, but staff can back-date it (e.g. entering a
  // truckload that was actually weighed yesterday but only got logged now).
  const [txDate, setTxDate] = useState(cambodiaDateStr());
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
  const [driverName, setDriverName] = useState("");
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
  const [staffFee, setStaffFee] = useState("");
  const [note, setNote] = useState("");
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState(null);
  const [paymentProofUrl, setPaymentProofUrl] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedTx, setSavedTx] = useState(null);
  // Same offline-sync status used on the Weighing Tickets board — Save
  // below never actually waits on the network (see handleSubmit), so this
  // is the only thing that tells staff whether a save has actually reached
  // PaddyTrade yet or is still waiting on this device for the connection.
  const [syncStatus, setSyncStatus] = useState({ online: true, syncing: false, pending: 0 });
  useEffect(() => onSyncStatusChange(setSyncStatus), []);

  // Note: this form used to auto-save/restore a draft to the browser's
  // local storage so a dropped connection or accidental reload wouldn't
  // lose an in-progress entry. That's been removed on request — every new
  // transaction now always starts completely blank, with nothing carried
  // over from a previous attempt.

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

  // Searches by phone number, not name — lots of farmers share the exact
  // same name, but phone numbers are unique, so this is a much more
  // reliable way to find the right person.
  useEffect(() => {
    if (!partyPhone.trim()) { setParties([]); return; }
    api.getParties({ type: isBuy ? "supplier" : "buyer", qPhone: partyPhone }).then(setParties).catch(() => {});
  }, [partyPhone, isBuy]);

  useEffect(() => {
    if (isBuy && !priceOverridden && settings[`price_grade_${qualityGrade.toLowerCase()}_per_kg`]) {
      setPricePerKg(settings[`price_grade_${qualityGrade.toLowerCase()}_per_kg`]);
    }
  }, [qualityGrade, settings, isBuy, priceOverridden]);

  useEffect(() => {
    if (settings.default_vat_rate) setTaxRate(settings.default_vat_rate);
  }, [settings]);

  // Staff at the location only ever hand over cash on the spot — a bank
  // transfer to a farmer is always sent later by HQ, from HQ, never by
  // staff at the scale. So a Buy can only be marked "Paid" here when it's
  // Cash; anything paid by bank transfer has to stay "Pending" until HQ
  // records the transfer (Transactions -> Pay Supplier).
  const isBankTransfer = isBuy && !!bankName && bankName !== "Cash";

  // If staff switch the bank field away from Cash while "Paid" was already
  // selected, drop it back to "Pending" — only HQ can mark a bank-transfer
  // purchase as paid, once they've actually sent the money.
  useEffect(() => {
    if (isBankTransfer && paymentStatus === "paid") setPaymentStatus("pending");
  }, [isBankTransfer, paymentStatus]);

  const netKg = Math.max(0, (parseFloat(grossKg) || 0) - (parseFloat(tareKg) || 0));
  const payableKg = Math.max(0, netKg - (parseFloat(deductionKg) || 0));
  // Previously required before saving — dropped per Baitang's decision so
  // this matches the Weighing Tickets flow, which never required it either
  // (no camera set up at stations yet). Staff can still attach one
  // voluntarily; it's just no longer a blocker.
  const showPaymentProofUpload = !isBuy && (paymentStatus === "paid" || paymentStatus === "deposit");
  const total = payableKg * (parseFloat(pricePerKg) || 0);
  // Staff/carrying fee — rare, only when our own staff carries the paddy
  // for a farmer with no labor of their own — comes off the goods amount
  // before VAT, the same way the weight deduction above comes off before
  // pricing.
  const staffFeeAmt = isBuy ? (parseFloat(staffFee) || 0) : 0;
  const netSubtotal = Math.max(0, total - staffFeeAmt);
  const taxAmount = taxApplicable ? Math.round(netSubtotal * (parseFloat(taxRate) || 0)) / 100 : 0;
  const totalWithTax = netSubtotal + taxAmount;
  const hasBreakdown = taxApplicable || staffFeeAmt > 0;
  const myStation = stations.find((s) => s.id === (isAdmin ? stationId : profile?.location_id));
  const effectiveLocationId = isAdmin ? stationId : profile?.location_id;

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

  // Coming here from a farmer/buyer's profile page (via the "New Buy"/"New
  // Sell" button there) — prefill their info so HQ staff don't have to
  // retype the same name, bank, and account for every truckload.
  useEffect(() => {
    if (prefillParty) {
      selectParty(prefillParty);
      if (clearPrefill) clearPrefill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillParty]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const effectiveStationId = isAdmin ? stationId : profile?.location_id;
    if (!isAdmin && !effectiveStationId) { setError("Your account has no location assigned yet. Ask HQ to assign one to your login."); return; }
    if (!partyQuery.trim() || !effectiveStationId || !productQuery.trim() || netKg <= 0 || !pricePerKg) { setError(t("required_fields")); return; }
    if (!txDate) { setError("Please pick a transaction date."); return; }
    // Receipt photo is off while testing — no camera on this computer yet.
    // Re-add this check once photos are actually possible.
    setSaving(true);
    try {
      // Everything below saves to this device immediately and queues the
      // real writes for whenever the connection allows them — same
      // offline-first pattern already proven on the Weighing Tickets board
      // (see offlineQueue.js). Nothing here waits on a network call to
      // succeed, so a dropped connection can no longer wipe out what was
      // just typed in.
      let party = selectedParty;
      if (!party && partyPhone.trim() && navigator.onLine) {
        // Someone with this exact phone number may already exist — reuse
        // them instead of creating a duplicate. Bounded so a WiFi that's
        // connected but not actually reaching the internet doesn't leave
        // Save hanging — it just falls through to match-or-create by name.
        const matches = await withTimeout(
          api.getParties({ type: isBuy ? "supplier" : "buyer", phone: partyPhone.trim() }).catch(() => null),
          4000, null
        );
        if (matches && matches.length > 0) party = matches[0];
      }

      let partyId, partyName, partyBankName, partyBankAccount;
      if (party) {
        partyId = party.id;
        partyName = party.name;
        partyBankName = party.bank_name;
        partyBankAccount = party.bank_account;
        if (isBuy) {
          // Existing farmer — if their bank details or QR code were
          // corrected or added here, keep their saved profile in sync.
          const patch = {};
          if (bankName !== (party.bank_name || "")) patch.bankName = bankName;
          if (bankAccount !== (party.bank_account || "")) patch.bankAccount = bankAccount;
          if (bankName !== "Cash" && bankQrUrl && bankQrUrl !== (party.bank_qr_url || "")) patch.bankQrUrl = bankQrUrl;
          if (Object.keys(patch).length > 0) {
            updatePartyOffline(party.id, patch);
            if (patch.bankName !== undefined) partyBankName = patch.bankName;
            if (patch.bankAccount !== undefined) partyBankAccount = patch.bankAccount;
          }
        }
      } else {
        partyName = partyQuery.trim();
        partyId = await resolvePartyIdOffline(partyName, isBuy ? "supplier" : "buyer", effectiveStationId, {
          phone: partyPhone,
          idNumber: partyIdNumber,
          bankName: isBuy ? bankName : undefined,
          bankAccount: isBuy ? bankAccount : undefined,
          bankQrUrl: isBuy && bankName !== "Cash" ? bankQrUrl : undefined,
          company: !isBuy ? company : undefined,
          destination: !isBuy ? destination : undefined,
        });
        partyBankName = isBuy ? bankName : undefined;
        partyBankAccount = isBuy ? bankAccount : undefined;
      }

      const productId = await resolveProductIdOffline(productQuery.trim());

      const tx = createTransactionOffline({
        type, locationId: effectiveStationId, partyId, productId,
        quantityKg: netKg, pricePerKg: parseFloat(pricePerKg), paymentStatus, userId: session.user.id,
        txDate,
        qualityGrade: isBuy ? (qualityGrade.trim() || null) : null,
        taxApplicable, taxRate: parseFloat(taxRate) || 0,
        moisturePct: parseFloat(moisturePct) || 0, mixturePct: parseFloat(mixturePct) || 0,
        outthrowPct: parseFloat(outthrowPct) || 0, deductionKg: parseFloat(deductionKg) || 0,
        staffFee: staffFeeAmt,
        note: note.trim() || null,
        carPlate: carPlate.trim() || null,
        driverName: driverName.trim() || null,
        receiptPhotoUrl, paymentProofUrl,
      });

      // Log every new Buy/Sell to the Activity Log so it's traceable later —
      // same reasoning as logging edits/payments: an audit trail is only
      // useful for finding mistakes if it captures the original entry too,
      // not just later corrections.
      logAuditOffline({
        action: "create_transaction",
        tableName: "transactions",
        recordId: tx.id,
        newData: {
          code: tx.code, type, partyName, quantityKg: netKg, pricePerKg: parseFloat(pricePerKg),
          amount: tx.amount, stationName: myStation?.name, txDate: tx.tx_date, paymentStatus,
        },
        userId: session.user.id,
      });

      // If it was entered as already paid, record that cash movement immediately
      // so it shows up correctly in Accounts Payable/Receivable and Cash Flow.
      if (paymentStatus === "paid") {
        const createdPayment = createPaymentOffline({
          type: isBuy ? "pay_supplier" : "receive_customer",
          transactionId: tx.id,
          locationId: effectiveStationId,
          amount: tx.total_with_tax ?? tx.amount,
          method: "cash",
          payDate: tx.tx_date,
          memo: "Paid at time of transaction",
          userId: session.user.id,
        });
        logAuditOffline({
          action: "record_payment",
          tableName: "payments",
          recordId: createdPayment.id,
          newData: {
            amount: tx.total_with_tax ?? tx.amount, method: "cash", memo: "Paid at time of transaction",
            code: tx.code, partyName, txType: type,
          },
          userId: session.user.id,
        });
      }

      setSavedTx({
        ...tx,
        partyName, partyIdNumber: partyPhone || partyIdNumber || "",
        bank_name: partyBankName, bank_account: partyBankAccount,
        product_name: productQuery.trim(), stationName: myStation?.name,
      });
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
      {(!syncStatus.online || syncStatus.pending > 0 || syncStatus.syncing) && (
        <div className={`flex items-center gap-2 px-6 py-2 text-xs font-medium ${!syncStatus.online ? "bg-amber-50 text-amber-700" : "bg-brand-50 text-brand-700"}`}>
          {!syncStatus.online ? <WifiOff size={13} /> : <RefreshCw size={13} className={syncStatus.syncing ? "animate-spin" : ""} />}
          {!syncStatus.online
            ? `No internet — working offline. ${syncStatus.pending > 0 ? `${syncStatus.pending} change${syncStatus.pending === 1 ? "" : "s"} will sync once it's back.` : "Anything you save here is saved on this device."}`
            : syncStatus.syncing
              ? "Connected — syncing…"
              : `Connected — ${syncStatus.pending} change${syncStatus.pending === 1 ? "" : "s"} waiting to sync…`}
        </div>
      )}
      <main className="flex-1 overflow-y-auto p-6">
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
                <input value={partyPhone} onChange={(e) => { setPartyPhone(e.target.value); setSelectedParty(null); }} placeholder="Search by phone number"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                {partyPhone && !selectedParty && parties.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                    {parties.map((p) => (
                      <button type="button" key={p.id} onClick={() => selectParty(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <span>{p.name}</span><span className="text-xs text-slate-400">{p.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-[11px] text-slate-400">Type a phone number to search — lots of people share the same name, so phone is more reliable.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs text-slate-500">{isBuy ? t("section1_seller") : t("section1_buyer")} Name</label><input value={partyQuery} onChange={(e) => { setPartyQuery(e.target.value); setSelectedParty(null); }} placeholder="Type name, or select a match above" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>

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

                <div>
                  <label className="mb-1 block text-xs text-slate-500">Transaction Date</label>
                  <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} max={cambodiaDateStr()}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  <p className="mt-1 text-[11px] text-slate-400">Defaults to today — change it if this load was actually weighed on a different day.</p>
                </div>
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
                <WeightField
                  locationId={effectiveLocationId}
                  label={t("gross_weight")}
                  scaleLabel="Live Scale Weight"
                  value={grossKg}
                  onChange={setGrossKg}
                  isAdmin={isAdmin}
                />
                <WeightField
                  locationId={effectiveLocationId}
                  label={t("tare_weight")}
                  scaleLabel="Live Scale Weight"
                  value={tareKg}
                  onChange={setTareKg}
                  isAdmin={isAdmin}
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">{t("car_plate_number")}</label>
                  <input value={carPlate} onChange={(e) => setCarPlate(e.target.value)} placeholder="e.g. 2AB-1234"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">{t("driver_name")}</label>
                  <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="e.g. PhaNith"
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
                  label="Physical Receipt Photo" kind="receipt"
                  url={receiptPhotoUrl} onUploaded={setReceiptPhotoUrl}
                  hint="Photo of the printed weighbridge ticket/receipt (optional)"
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
                    {isBuy ? (
                      <>
                        <option value="pending">{t("pendingpay")}</option>
                        {!isBankTransfer && <option value="paid">{t("paid")}</option>}
                      </>
                    ) : (<><option value="paid">{t("paid")}</option><option value="credit">{t("credit")}</option><option value="deposit">{t("deposit")}</option></>)}
                  </select>
                  {isBankTransfer && <p className="mt-1 text-[11px] text-slate-400">Bank transfer — stays Pending until HQ sends the money and records it (Transactions → Pay Supplier).</p>}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Payment status choices are fixed — they feed your Financial Reports directly.</p>

              {showPaymentProofUpload && (
                <div className="mt-3">
                  <PhotoUpload
                    label="Bank QR / Payment Proof Photo" kind="payment-proof"
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

              {isBuy && (
                <div className="mt-3 rounded-lg border border-slate-200 p-3">
                  <p className="mb-2 text-xs font-medium text-slate-500">Staff / Carrying Fee (optional)</p>
                  <input type="number" min="0" step="0.01" value={staffFee} onChange={(e) => setStaffFee(e.target.value)} placeholder="0"
                    className="w-full max-w-[200px] rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  <p className="mt-1.5 text-[11px] text-slate-400">Only if our staff had to carry the paddy for this seller because they had no labor of their own — this amount is charged to them and comes off what they're paid.</p>
                </div>
              )}

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
                <p className="text-xs text-brand-100/80">{hasBreakdown ? "Goods Amount" : t("total_amount")}</p>
                <p className="mt-1 text-3xl font-bold">{fmtRiel(total)}</p>
                <p className="mt-2 text-xs text-brand-100/70">{fmt2(payableKg)} kg × {fmtRiel(parseFloat(pricePerKg) || 0)}/kg</p>
                {hasBreakdown && (
                  <div className="mt-3 space-y-1 border-t border-white/20 pt-3">
                    {staffFeeAmt > 0 && (
                      <div className="flex justify-between text-xs text-brand-100/80">
                        <span>Staff / Carrying Fee</span>
                        <span>-{fmtRiel(staffFeeAmt)}</span>
                      </div>
                    )}
                    {taxApplicable && (
                      <div className="flex justify-between text-xs text-brand-100/80">
                        <span>VAT ({taxRate || 0}%)</span>
                        <span>{fmtRiel(taxAmount)}</span>
                      </div>
                    )}
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
