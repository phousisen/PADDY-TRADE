import { useEffect, useMemo, useState } from "react";
import { Search, Save, ScanLine, ChevronDown, Ticket } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import PhotoUpload from "../components/PhotoUpload.jsx";
import WeightField from "../components/WeightField.jsx";
import Receipt from "./Receipt.jsx";
import { api, normalizePaperTicketNo } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { errText } from "../errText.js";
import { useAuth } from "../AuthContext.jsx";
import { getAccurateNow } from "../supabaseClient.js";
import {
  withTimeout, resolvePartyIdOffline, resolveProductIdOffline, updatePartyOffline,
  createTransactionOffline, createPaymentOffline, logAuditOffline,
  suggestNextPaperTicketNo, recordPaperTicketNo, getCachedTransactions,
} from "../offlineQueue.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting — used as the default so the
// date box starts on "today" for Cambodia, not wherever the browser is set.
function cambodiaDateStr(d = getAccurateNow()) {
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

// [2026-09-12] A fold-away section. Everything this form ever collected is
// still on it — the eight things that get filled in on every single ticket
// sit on top, and the rest (vehicle, bank, deductions, VAT, photos) lives
// in one of these, one click away. Nothing REQUIRED to save is ever hidden
// inside one, so a fold can never be the reason a save is refused.
//
// `filled` puts a small green dot on a closed section that has something in
// it, so a number typed in earlier and then folded away can't be forgotten.
function Fold({ title, hint, filled, children }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-slate-600 group-open:text-slate-800">{title}</span>
          {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
          {filled && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" title="Something is filled in here" />}
        </span>
        <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 px-5 py-4">{children}</div>
    </details>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1 block text-xs text-slate-500";

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
  // [2026-09-12] The number written on the paper booklet ticket. The
  // weighbridge board has always asked for this; this form never did, so a
  // manually-entered load was the one kind of transaction that could not be
  // matched back to the book. Required here now, exactly as it is there.
  const [paperTicketNo, setPaperTicketNo] = useState("");
  // A number already used at this station. Set on the first Save attempt;
  // pressing Save again with the same number goes through (the database
  // allows the duplicate and flags it — see
  // allow_paper_ticket_no_duplicates_with_alert.sql), because sometimes the
  // booklet really does repeat and refusing outright would just stop staff
  // recording a load that genuinely happened.
  const [dupWarn, setDupWarn] = useState(null);
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
  // [2026-09-12] `grossKg` is the FIRST weigh (weigh IN), `tareKg` the
  // SECOND (weigh OUT) — the same two database columns the weighbridge
  // board fills, so a manual entry and a ticket-derived one are the same
  // shape of record. What the two weights MEAN flips with the direction of
  // the trade, which is the bug this fixes:
  //
  //   BUY  — the truck arrives LOADED and leaves EMPTY.  net = in − out
  //   SELL — the truck arrives EMPTY and leaves LOADED.  net = out − in
  //
  // This form did `gross − tare` on both, so every Sell came out negative,
  // was clamped to zero by the Math.max below, and saved as a 0 kg load
  // worth 0 ៛ with no error shown. `WeighingTickets.jsx` has always had
  // this right (see its own netKg) — only this screen was wrong.
  const [grossKg, setGrossKg] = useState("");
  const [tareKg, setTareKg] = useState("");
  // The instant each weight was captured. On a station with a live scale
  // that IS the moment of weighing, and it is what fills the IN/OUT rows on
  // the printed receipt. Stamped once, when the box first gets a value, and
  // cleared if the box is emptied — not re-stamped on every keystroke, so
  // it stays the capture moment rather than the last-typed-character
  // moment.
  const [grossAt, setGrossAt] = useState(null);
  const [tareAt, setTareAt] = useState(null);
  const stampOnFirstValue = (v, setStamp) => {
    const has = v !== "" && v != null;
    setStamp((prev) => (has ? prev || getAccurateNow().toISOString() : null));
  };
  const onGrossChange = (v) => { setGrossKg(v); stampOnFirstValue(v, setGrossAt); };
  const onTareChange = (v) => { setTareKg(v); stampOnFirstValue(v, setTareAt); };
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
  // The global "unsynced changes" banner in Topbar.jsx now covers this —
  // Save below never actually waits on the network (see handleSubmit), and
  // that banner is what tells staff whether a save has actually reached
  // PaddyTrade yet or is still waiting on this device, on every screen, not
  // just this one.

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

  // Same booklet, same rule as the weighbridge board: tickets are
  // pre-numbered and used in order, so once a number has been typed in for
  // a station, suggest the next one. Only ever fills a BLANK box, so it can
  // never overwrite a number staff already typed — and it is only a
  // suggestion (spoiled ticket, different booklet, back-entering an older
  // day) which is why it stays fully editable.
  const suggestStationId = isAdmin ? stationId : profile?.location_id;
  useEffect(() => {
    if (suggestStationId && !paperTicketNo) {
      const suggested = suggestNextPaperTicketNo(suggestStationId);
      if (suggested) setPaperTicketNo(suggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestStationId]);

  // Any edit to the number clears a standing duplicate warning — otherwise
  // typing a corrected number and pressing Save would silently use the
  // "they already confirmed it" path meant for the old one.
  useEffect(() => { setDupWarn(null); }, [paperTicketNo]);

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

  // See the comment on grossKg/tareKg above. A Buy loses weight between the
  // two weighs, a Sell gains it.
  const weighInKg = parseFloat(grossKg) || 0;
  const weighOutKg = parseFloat(tareKg) || 0;
  const rawNetKg = isBuy ? weighInKg - weighOutKg : weighOutKg - weighInKg;
  const netKg = Math.max(0, rawNetKg);
  // Both weighs entered but the wrong way round. Previously this silently
  // became a 0 kg, 0 ៛ transaction — the clamp above hid it and Save went
  // through. Now it is said out loud, on screen and at Save.
  const bothWeighed = String(grossKg).trim() !== "" && String(tareKg).trim() !== "";
  const weightsReversed = bothWeighed && rawNetKg <= 0;
  const reversedMessage = isBuy
    ? "Weigh In must be MORE than Weigh Out on a purchase — the truck arrives loaded and leaves empty."
    : "Weigh Out must be MORE than Weigh In on a sale — the truck arrives empty and leaves loaded.";
  // A capture instant is only sent if it lands on the day this transaction
  // is dated — see where it is used in handleSubmit for why.
  const stampIfOnTxDate = (iso) =>
    (iso && cambodiaDateStr(new Date(iso)) === txDate ? iso : null);
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
    if (!isAdmin && !effectiveStationId) { setError(t("err_no_location_assigned")); return; }
    // Price is only required for a Buy — it's already agreed with the
    // farmer on the paper ticket by this point. A Sell can be saved with
    // no price yet (the buyer hasn't settled on one), matching Weighing
    // Tickets' own Finish Ticket flow — it gets corrected later from the
    // Transactions list once it's actually agreed. See finalPricePerKg
    // below for how a blank price is actually stored.
    // Checked BEFORE the generic "fill in the required fields" below, so a
    // reversed pair of weights says what is actually wrong instead of
    // pointing at a form that looks completely filled in.
    if (weightsReversed) { setError(reversedMessage + " Check the two weights."); return; }
    if (!partyQuery.trim() || !effectiveStationId || !productQuery.trim() || netKg <= 0 || (isBuy && !pricePerKg)) { setError(t("required_fields")); return; }
    if (!txDate) { setError(t("err_need_tx_date")); return; }
    // [2026-09-12] The paper booklet number, now required here exactly as
    // it is on the weighbridge board. Without it a back-entered load is
    // unmatchable against the book, which is the only independent check
    // anyone has on what this form recorded.
    if (!paperTicketNo.trim()) { setError(t("err_need_paper_ticket")); return; }

    // Entry sanity check on that number — same shape as NewTicketModal's in
    // WeighingTickets.jsx, and for the same reason: two devices can each
    // enter a load before either has synced the other's, so this asks the
    // live database first (bounded, so a bad connection can never hang a
    // save) and falls back to this device's own cache when offline.
    //
    // Unlike the board, a match here WARNS rather than refuses. This form
    // is what gets used to re-type a day out of the book after the fact,
    // where a genuinely repeated booklet number is a real thing that
    // happens — refusing outright would leave a load that physically
    // happened unrecorded, which is worse. Pressing Save a second time with
    // the same number goes through and the database flags the pair.
    const trimmedTicketNo = normalizePaperTicketNo(paperTicketNo) || "";
    if (trimmedTicketNo && dupWarn?.ticketNo !== trimmedTicketNo) {
      let dupMatch = null;
      if (navigator.onLine) {
        try {
          dupMatch = await withTimeout(
            api.findTransactionByPaperTicketNo({ locationId: effectiveStationId, paperTicketNo: trimmedTicketNo }),
            3500, null
          );
        } catch { dupMatch = null; }
      }
      if (!dupMatch) {
        dupMatch = getCachedTransactions().find(
          (tx) => tx.location_id === effectiveStationId &&
            (normalizePaperTicketNo(tx.paper_ticket_no) || "").toLowerCase() === trimmedTicketNo.toLowerCase()
        ) || null;
      }
      if (dupMatch) {
        setDupWarn({
          ticketNo: trimmedTicketNo,
          code: dupMatch.code || null,
          partyName: dupMatch.party_name || dupMatch.partyName || null,
        });
        return;
      }
    }
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

      // Buy always has a real number (required above). Sell stores an
      // actual null — not 0 — whenever the price was left blank, same
      // reasoning as Weighing Tickets' own price-not-given-yet state (see
      // WeighingTickets.jsx's submitFinish()): so the receipt and every
      // report can tell "no price yet" apart from "genuinely priced at 0."
      const finalPricePerKg = isBuy ? (parseFloat(pricePerKg) || 0) : (pricePerKg.trim() === "" ? null : (parseFloat(pricePerKg) || 0));
      // A Sell with no price yet can't actually be "Paid" — there's
      // nothing to have paid. Force it to Credit (still owed) rather than
      // silently recording a real ₣0 "payment received" below, regardless
      // of whatever the Payment Status dropdown happens to say.
      const finalPaymentStatus = !isBuy && finalPricePerKg == null ? "credit" : paymentStatus;

      const tx = await createTransactionOffline({
        type, locationId: effectiveStationId, partyId, productId,
        quantityKg: netKg, pricePerKg: finalPricePerKg, paymentStatus: finalPaymentStatus, userId: session.user.id,
        txDate,
        qualityGrade: isBuy ? (qualityGrade.trim() || null) : null,
        taxApplicable, taxRate: parseFloat(taxRate) || 0,
        moisturePct: parseFloat(moisturePct) || 0, mixturePct: parseFloat(mixturePct) || 0,
        outthrowPct: parseFloat(outthrowPct) || 0, deductionKg: parseFloat(deductionKg) || 0,
        staffFee: staffFeeAmt,
        note: note.trim() || null,
        carPlate: carPlate.trim() || null,
        driverName: driverName.trim() || null,
        paperTicketNo: paperTicketNo.trim() || null,
        // [2026-09-12] The two weighs themselves, not just the net.
        //
        // Until now a manually-entered Buy/Sell sent only `quantityKg`, so
        // `gross_kg`/`tare_kg` landed null and the receipt's IN/OUT table
        // printed "—  —  —" on both rows with nothing but a Net Weight —
        // even though staff had typed (or the scale had captured) both
        // numbers a moment earlier. They are the same two columns the
        // weighbridge board fills, so a manual entry now prints an
        // identical ticket.
        grossKg: grossKg === "" ? null : weighInKg,
        tareKg: tareKg === "" ? null : weighOutKg,
        // The capture instants — but ONLY when they fall on the day this
        // transaction is dated. Back-entering yesterday's load today would
        // otherwise stamp today onto the IN/OUT rows and print a receipt
        // whose weigh dates contradict its own transaction date — exactly
        // the defect fixed in Receipt.jsx on 2026-09-06. When they do not
        // match, the weights still print; only the date/time columns stay
        // blank, which is honest: nobody knows what time yesterday's truck
        // actually crossed the scale.
        grossAt: stampIfOnTxDate(grossAt),
        tareAt: stampIfOnTxDate(tareAt),
        receiptPhotoUrl, paymentProofUrl,
        // Display-only fields — see the comment on createTransactionOffline
        // in offlineQueue.js for why these matter even offline: without
        // them, this entry would show up blank on the Transactions list
        // (no farmer/buyer name, no station) until the real sync fills it
        // in for real.
        partyName, partyIdNumber: partyPhone || partyIdNumber || "",
        bankName: partyBankName, bankAccount: partyBankAccount,
        productName: productQuery.trim(), stationName: myStation?.name,
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
          code: tx.code, type, partyName, quantityKg: netKg, pricePerKg: finalPricePerKg,
          amount: tx.amount, stationName: myStation?.name, txDate: tx.tx_date, paymentStatus: finalPaymentStatus,
          paperTicketNo: paperTicketNo.trim() || null,
        },
        userId: session.user.id,
      });

      // If it was entered as already paid, record that cash movement immediately
      // so it shows up correctly in Accounts Payable/Receivable and Cash Flow.
      // finalPaymentStatus is never "paid" when finalPricePerKg is null (see
      // above), so this can't fire a real ₣0 "payment received" record for
      // a transaction nobody has actually agreed a price on yet.
      if (finalPaymentStatus === "paid") {
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

      // [2026-09-06] Online but the server did not confirm the save in
      // time: everything above (transaction, payment, audit entries) is
      // safely queued and will land on its own — but NO receipt is shown
      // or printed for it, per direction after Jomnoum's TKT-521806 /
      // TKT-872042. Throwing here (after the payment/audit are queued, on
      // purpose — see createTransactionOffline's comment) shows the
      // message in the form's existing error slot; the Save button is
      // re-enabled by `finally`, but the message tells staff NOT to
      // re-enter it (a second Save would queue a duplicate).
      // [2026-09-07] Print always — an unconfirmed save is flagged on the
      // receipt screen (needs_verification) and keeps retrying from both
      // the browser queue and the station PC relay; the database itself
      // now guarantees it can't be saved twice.
      // Remember this booklet number for this station so the NEXT entry
      // starts on the one after it — same shared counter the weighbridge
      // board uses, so the two screens stay on one running sequence instead
      // of each suggesting from its own.
      recordPaperTicketNo(effectiveStationId, paperTicketNo.trim());

      setSavedTx({
        ...tx,
        partyName, partyIdNumber: partyPhone || partyIdNumber || "",
        bank_name: partyBankName, bank_account: partyBankAccount,
        product_name: productQuery.trim(), stationName: myStation?.name,
      });
    } catch (err) {
      const isNetworkError = err.message && (err.message.includes("fetch") || err.message.includes("network") || err.message.includes("Failed"));
      setError(isNetworkError ? t("err_no_server") : errText(t, err, "err_generic"));
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
        {/* [2026-08-31] grid-cols-1 lg:grid-cols-3 instead of a flat
            grid-cols-3 — same fix as Dashboard's Location Performance /
            Live Feed row: this form + its summary panel used to squeeze
            into a third of the screen each on phone. Now stacks full-width
            (form first, summary panel below it) below the lg breakpoint,
            unchanged on desktop/laptop. */}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            {/* ==============================================================
                [2026-09-12] THE FAST PATH.

                This used to be three numbered sections of roughly twenty
                boxes, every one of them on screen at once, with the four
                things that are actually typed on every ticket scattered
                across all three. Rearranged — nothing removed — so the
                eight fields a normal load needs read straight down in the
                order they happen at the scale: which paper ticket, which
                day, who, what, how heavy, what price, paid or not.

                Everything else is still here, in the fold-away sections
                below. Nothing required to save is hidden inside one.
               ============================================================== */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[190px_1fr_1fr]">
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gold-700">
                    <Ticket size={12} /> Paper Ticket No.
                  </label>
                  <input
                    value={paperTicketNo}
                    onChange={(e) => setPaperTicketNo(e.target.value)}
                    placeholder="e.g. 092152"
                    className="w-full rounded-lg border border-gold-500 bg-gold-50 px-3 py-2 text-lg font-bold tracking-wide text-slate-800 outline-none focus:border-gold-700 focus:ring-2 focus:ring-gold-100"
                  />
                </div>
                <div>
                  <label className={labelCls}>Transaction Date</label>
                  <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} max={cambodiaDateStr()} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("station")}</label>
                  {isAdmin ? (
                    <select value={stationId} onChange={(e) => setStationId(e.target.value)} className={inputCls}>
                      {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      {myStation?.name || (stationsLoaded ? "—" : "…")}
                    </div>
                  )}
                </div>
              </div>
              {dupWarn ? (
                <p className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                  Ticket <b>{dupWarn.ticketNo}</b> has already been used at this station
                  {dupWarn.code ? ` — ${dupWarn.code}` : ""}{dupWarn.partyName ? `, ${dupWarn.partyName}` : ""}.
                  Check the book. If the number really is right, press Save again and it will go through — both
                  entries will be marked so they can be looked at later.
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-slate-400">
                  The number on the paper booklet ticket — this is what ties this entry back to the book.
                  Suggested from the last one used at this station; type over it if it's wrong.
                </p>
              )}

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="relative">
                  <label className={labelCls}>Phone number</label>
                  <Search size={15} className="pointer-events-none absolute left-3 top-[30px] text-slate-400" />
                  <input value={partyPhone} onChange={(e) => { setPartyPhone(e.target.value); setSelectedParty(null); }} placeholder="Search by phone"
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
                  <p className="mt-1 text-[11px] text-slate-400">Lots of people share a name — phone finds the right person.</p>
                </div>
                <div>
                  <label className={labelCls}>{isBuy ? t("section1_seller") : t("section1_buyer")} Name</label>
                  <input value={partyQuery} onChange={(e) => { setPartyQuery(e.target.value); setSelectedParty(null); }} placeholder="Type name, or pick a match" className={inputCls} />
                </div>
              </div>

              <div className={`mt-3 grid grid-cols-1 gap-3 ${isBuy ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                <div>
                  <label className={labelCls}>{t("product")}</label>
                  <input list="product-options" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Type or pick" className={inputCls} />
                  <datalist id="product-options">
                    {products.map((p) => <option key={p.id} value={p.name} />)}
                  </datalist>
                </div>
                {isBuy && (
                  <div>
                    <label className={labelCls}>{t("quality_grade")}</label>
                    <input list="grade-options" value={qualityGrade} onChange={(e) => { setQualityGrade(e.target.value); setPriceOverridden(false); }} className={inputCls} />
                    <datalist id="grade-options">
                      <option value="A">{t("grade_a")}</option>
                      <option value="B">{t("grade_b")}</option>
                      <option value="C">{t("grade_c")}</option>
                    </datalist>
                    <p className="mt-1 text-[11px] text-slate-400">A/B/C fills the price in.</p>
                  </div>
                )}
                <div>
                  <label className={labelCls}>{t("price_per_kg")}</label>
                  <input type="number" min="0" step="0.01" value={pricePerKg}
                    onChange={(e) => { setPricePerKg(e.target.value); setPriceOverridden(true); }}
                    placeholder="0.00" className={inputCls} />
                  {isBuy
                    ? <p className="mt-1 text-[11px] text-slate-400">From the grade — edit to override.</p>
                    : <p className="mt-1 text-[11px] text-slate-400">Optional — leave blank if no price agreed yet.</p>}
                </div>
              </div>
            </section>

            {/* ===== Weight ===== */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                <ScanLine size={14} /> {t("section2_weighbridge")}
              </h3>
              {/* [2026-09-12] The labels now say which weigh this is and
                  what state the truck is in, instead of "Gross"/"Tare" —
                  which are only meaningful on a Buy and are the exact words
                  that made a Sell get entered backwards. Same wording as the
                  weighbridge board's Weigh In / Weigh Out steps. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <WeightField
                  locationId={effectiveLocationId}
                  label={isBuy ? "Weigh In — loaded truck (kg)" : "Weigh In — empty truck (kg)"}
                  labelKm="ថ្លឹងទម្ងន់ចូល"
                  scaleLabel={isBuy ? "Live Scale Weight (loaded truck)" : "Live Scale Weight (empty truck)"}
                  value={grossKg}
                  onChange={onGrossChange}
                  isAdmin={isAdmin}
                />
                <WeightField
                  locationId={effectiveLocationId}
                  label={isBuy ? "Weigh Out — empty truck (kg)" : "Weigh Out — loaded truck (kg)"}
                  labelKm="ថ្លឹងទម្ងន់ចេញ"
                  scaleLabel={isBuy ? "Live Scale Weight (empty truck)" : "Live Scale Weight (loaded truck)"}
                  value={tareKg}
                  onChange={onTareChange}
                  isAdmin={isAdmin}
                />
              </div>
              <div className={`mt-3 flex items-baseline justify-between rounded-lg px-4 py-3 ${weightsReversed ? "bg-rose-50" : "bg-brand-50"}`}>
                <p className={`text-xs font-medium ${weightsReversed ? "text-rose-700/80" : "text-brand-700/70"}`}>{t("net_weight")}</p>
                <p className={`text-3xl font-bold ${weightsReversed ? "text-rose-700" : "text-brand-800"}`}>
                  {fmt2(netKg)} <span className={`text-base font-medium ${weightsReversed ? "text-rose-600" : "text-brand-600"}`}>KG</span>
                </p>
              </div>
              {weightsReversed && (
                <p className="mt-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700">
                  <b>The two weights are the wrong way round.</b> {reversedMessage} Swap them, or re-capture from the scale — this cannot be saved as it stands.
                </p>
              )}
              {parseFloat(deductionKg) > 0 && (
                <p className="mt-1 text-right text-xs text-brand-700/70">
                  Payable: <span className="font-semibold text-brand-800">{fmt2(payableKg)} kg</span> (after {fmt2(parseFloat(deductionKg))} kg deduction)
                </p>
              )}
            </section>

            {/* ===== Payment status + note ===== */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>{t("payment_status")}</label>
                  <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className={inputCls}>
                    {isBuy ? (
                      <>
                        <option value="pending">{t("pendingpay")}</option>
                        {!isBankTransfer && <option value="paid">{t("paid")}</option>}
                      </>
                    ) : (<><option value="paid">{t("paid")}</option><option value="credit">{t("credit")}</option><option value="deposit">{t("deposit")}</option></>)}
                  </select>
                  {isBankTransfer && <p className="mt-1 text-[11px] text-slate-400">{bankName} transfer — stays Pending until HQ sends the money and records it (Transactions → Pay Supplier).</p>}
                </div>
                <div>
                  <label className={labelCls}>Note (optional)</label>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="anything worth remembering" className={inputCls} />
                </div>
              </div>
            </section>

            {/* ==============================================================
                Fold-away. Everything the old form showed all at once and
                that a normal load never touches.
               ============================================================== */}
            <Fold title="Vehicle & driver" hint="plate, driver name" filled={!!(carPlate || driverName)}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>{t("car_plate_number")}</label>
                  <input value={carPlate} onChange={(e) => setCarPlate(e.target.value)} placeholder="e.g. 2AB-1234" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("driver_name")}</label>
                  <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="e.g. PhaNith" className={inputCls} />
                </div>
              </div>
            </Fold>

            {isBuy ? (
              <Fold
                title="Bank details"
                hint={bankName ? `${bankName}${bankAccount ? ` · ${bankAccount}` : ""}` : "how this seller gets paid"}
                filled={!!(bankName || bankAccount)}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>{t("bank_name")}</label>
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
                      <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Type bank name" className={`mt-2 ${inputCls}`} />
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>{t("bank_account")}</label>
                    <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={inputCls} />
                  </div>
                </div>
                {bankName && bankName !== "Cash" && (
                  <div className="mt-4">
                    <PhotoUpload
                      label="Bank QR Code" kind="party-bank-qr"
                      url={bankQrUrl} onUploaded={setBankQrUrl}
                      hint={`Photo of this farmer's ${bankName} QR code — saved to their profile, not just this transaction`}
                    />
                  </div>
                )}
              </Fold>
            ) : (
              <Fold title="Company & destination" hint="where this load is going" filled={!!company}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>{t("company_name")}</label>
                    <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{t("destination")}</label>
                    <input list="destination-options" value={destination} onChange={(e) => setDestination(e.target.value)} className={inputCls} />
                    <datalist id="destination-options">
                      <option value="dest_hq">{t("dest_hq")}</option>
                      <option value="dest_factory">{t("dest_factory")}</option>
                      <option value="dest_border">{t("dest_border")}</option>
                      <option value="dest_other">{t("dest_other")}</option>
                    </datalist>
                  </div>
                </div>
              </Fold>
            )}

            <Fold
              title="Quality deduction"
              hint="moisture, mixture, outthrow, kg off"
              filled={!!(moisturePct || mixturePct || outthrowPct || deductionKg)}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Moisture %</label>
                  <input type="number" min="0" step="0.1" value={moisturePct} onChange={(e) => setMoisturePct(e.target.value)} placeholder="0" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Mixture %</label>
                  <input type="number" min="0" step="0.1" value={mixturePct} onChange={(e) => setMixturePct(e.target.value)} placeholder="0" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Outthrow %</label>
                  <input type="number" min="0" step="0.1" value={outthrowPct} onChange={(e) => setOutthrowPct(e.target.value)} placeholder="0" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Deduction (kg)</label>
                  <input type="number" min="0" step="0.01" value={deductionKg} onChange={(e) => setDeductionKg(e.target.value)} placeholder="0" className={inputCls} />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Moisture/Mixture/Outthrow are for your records — only Deduction (kg) actually reduces the payable weight used for pricing. Stock still reflects the full physical weight received.</p>
            </Fold>

            {isBuy && (
              <Fold title="Staff / carrying fee" hint="only if our men unloaded for them" filled={!!staffFee}>
                <input type="number" min="0" step="0.01" value={staffFee} onChange={(e) => setStaffFee(e.target.value)} placeholder="0"
                  className={`max-w-[200px] ${inputCls}`} />
                <p className="mt-2 text-[11px] text-slate-400">Only if our staff had to carry the paddy for this seller because they had no labor of their own — this amount is charged to them and comes off what they're paid.</p>
              </Fold>
            )}

            <Fold
              title="VAT & photos"
              hint="tax, receipt photo, payment proof"
              filled={taxApplicable || !!receiptPhotoUrl || !!paymentProofUrl}
            >
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
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
              <div className="mt-3">
                <PhotoUpload
                  label="Physical Receipt Photo" kind="receipt"
                  url={receiptPhotoUrl} onUploaded={setReceiptPhotoUrl}
                  hint="Photo of the printed weighbridge ticket/receipt (optional)"
                />
              </div>
              {showPaymentProofUpload && (
                <div className="mt-3">
                  <PhotoUpload
                    label="Bank QR / Payment Proof Photo" kind="payment-proof"
                    url={paymentProofUrl} onUploaded={setPaymentProofUrl}
                    hint="Photo of the bank transfer QR code or payment confirmation"
                  />
                </div>
              )}
            </Fold>
            {error && <p className="text-sm text-rose-500">{error}</p>}
          </div>

          <div className="lg:col-span-1">
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
