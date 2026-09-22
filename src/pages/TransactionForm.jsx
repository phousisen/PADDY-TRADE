import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Save, Ticket } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import PhotoUpload from "../components/PhotoUpload.jsx";
import TypedWeight from "../components/TypedWeight.jsx";
import Receipt from "./Receipt.jsx";
import { api, normalizePaperTicketNo } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { errText } from "../errText.js";
import { useAuth } from "../AuthContext.jsx";
import { getAccurateNow, supabase } from "../supabaseClient.js";
import {
  withTimeout, resolvePartyIdOffline, resolveProductIdOffline, updatePartyOffline,
  createTransactionOffline, createPaymentOffline, logAuditOffline,
  suggestNextPaperTicketNo, recordPaperTicketNo, getCachedTransactions,
  incrementTicketNo, getCachedTickets,
} from "../offlineQueue.js";
import { paddyTypeOptions, paddyTypeNames, isOtherPaddyType } from "../paddyTypes.js";

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

// [2026-09-22] The fold-away section component was removed with the
// redesign: every part of the form is now its own numbered step, open.
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
  // [2026-09-15] The paddy types to offer, from the shared list — same
  // options here as at the weighbridge. This form only ever creates a new
  // transaction, so there is no existing value to preserve on the list.
  // `products` above is still loaded for everything else that uses it.
  const paddyOptions = useMemo(() => paddyTypeOptions(paddyTypeNames(products)), [products]);
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
  // [2026-09-22] Where each weight came from — typed by hand, or captured
  // off a live scale. A ticket copied from the paper book is not the same
  // thing as one weighed here, and until now nothing said which was which.
  const [grossSource, setGrossSource] = useState(null);
  const [tareSource, setTareSource] = useState(null);
  const onGrossChange = (v, src) => { setGrossKg(v); stampOnFirstValue(v, setGrossAt); setGrossSource(v === "" ? null : (src || "typed")); };
  const onTareChange = (v, src) => { setTareKg(v); stampOnFirstValue(v, setTareAt); setTareSource(v === "" ? null : (src || "typed")); };
  const typedIn = grossSource === "typed" || tareSource === "typed";
  // [2026-09-22] SISEN: "we will need a proper password for each ticket
  // also". Saving asks the person for their OWN password — the same second
  // step the manager uses to confirm expenses. It proves the ticket was
  // saved by the person whose name goes on it, not by whoever found the PC
  // unlocked, and the name and the moment are recorded with it.
  const [signPassword, setSignPassword] = useState("");
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
  // [2026-09-19] Waits 300 ms after the last keystroke, and ignores an
  // older answer that arrives after a newer one — typing a 9-digit number
  // sent 9 searches, and a slow one for "012" could replace the list.
  useEffect(() => {
    if (!partyPhone.trim()) { setParties([]); return undefined; }
    let stale = false;
    const timer = setTimeout(() => {
      api.getParties({ type: isBuy ? "supplier" : "buyer", qPhone: partyPhone })
        .then((rows) => { if (!stale) setParties(rows); })
        .catch(() => {});
    }, 300);
    return () => { stale = true; clearTimeout(timer); };
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
  //
  // [2026-09-12] Asks the SERVER first, not just this device.
  // suggestNextPaperTicketNo only knows what this one browser last typed.
  // Two people entering loads at the same station on two devices would each
  // be told to use the same next number, and the app would let them — which
  // is one of the ways a booklet number ends up on two records. The live
  // lookup reads both the weighbridge board and manually-entered loads, so
  // it reflects the booklet rather than one screen's history. Bounded, and
  // falls back to this device's memory offline or on a slow connection.
  const suggestStationId = isAdmin ? stationId : profile?.location_id;
  // [2026-09-19] The number this screen filled in by itself. When an admin
  // switches station, a number still equal to it (not typed by staff) is
  // replaced with the new station's next one, instead of keeping station A's.
  const autoTicketNoRef = useRef("");
  useEffect(() => {
    let cancelled = false;
    if (!suggestStationId) return undefined;
    if (paperTicketNo && paperTicketNo !== autoTicketNoRef.current) return undefined;
    (async () => {
      const live = await withTimeout(
        api.getLatestPaperTicketNo(suggestStationId).catch(() => null), 3000, null
      );
      if (cancelled) return;
      const suggested = incrementTicketNo(live) || suggestNextPaperTicketNo(suggestStationId);
      // Only ever fills a box that is STILL blank — staff may well have
      // typed the real number while this was in flight, and that must win.
      if (suggested) {
        setPaperTicketNo((cur) => {
          if (cur && cur !== autoTicketNoRef.current) return cur;
          autoTicketNoRef.current = suggested;
          return suggested;
        });
      }
    })();
    return () => { cancelled = true; };
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
  // [2026-09-16] The staff / carrying fee used to come off the goods amount
  // here. SISEN: "staff fee and ថ្លៃកូនដៃ should be the same. we dont need
  // staff fee anymore because it will be typed in the expenses instead." It
  // was the same money recorded twice — deducted from the farmer here, and
  // typed again as ថ្លៃកូនដៃ on Expenses. The farmer is now paid the full
  // weight × price and the fee is our own cost, recorded once, in Expenses.
  const netSubtotal = Math.max(0, total);
  const taxAmount = taxApplicable ? Math.round(netSubtotal * (parseFloat(taxRate) || 0)) / 100 : 0;
  const totalWithTax = netSubtotal + taxAmount;
  const hasBreakdown = taxApplicable;
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

  // [2026-09-19] One submit at a time, decided SYNCHRONOUSLY. `saving` is
  // React state, so it does not change until the next render — and it was
  // only set after the paper-ticket duplicate check, which waits up to 3.5 s
  // for the server. A double-click, or Enter pressed twice in any field,
  // started two saves inside that window: two transactions with different
  // codes, and two "paid at time of transaction" cash payments. The Weighing
  // Tickets board fixed the same bug on its own buttons ("audit #11"); this
  // form never got it. A ref changes immediately, so the second press is
  // turned away before anything is sent.
  const submittingRef = useRef(false);
  // [2026-09-19] The purchase/sale already created by an earlier press whose
  // PAYMENT step then failed. A second press must not create the truck
  // again — it only retries the payment. Before, the error told staff to
  // press Save again, and that created a second transaction for one truck.
  const createdTxRef = useRef(null);
  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await handleSubmitOnce(e);
    } finally {
      submittingRef.current = false;
    }
  }

  async function handleSubmitOnce(e) {
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
    // [2026-09-22] The signature. SISEN: "we will need a proper password for
    // each ticket also" — a ticket carries somebody's name, so that person
    // has to be at the keyboard. Checked against this account's own login,
    // exactly as the manager's expense confirmation does; a wrong password
    // saves nothing at all.
    if (!signPassword) { setError(t("xr_password")); return; }
    setSaving(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: session?.user?.email, password: signPassword,
      });
      if (authError) { setError(t("xr_bad_password")); setSaving(false); return; }
    } catch {
      setError(t("xr_bad_password")); setSaving(false); return;
    }
    setSaving(false);
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
    if (trimmedTicketNo && dupWarn?.ticketNo !== trimmedTicketNo && !createdTxRef.current) {
      // [2026-09-12] Checks BOTH the weighbridge board and already-recorded
      // transactions, not just transactions. One paper booklet does not care
      // which screen a load was entered on, and looking at only half of it
      // is how JOMNOUM CN 000560 ended up on Bory's live ticket of 7 Sept
      // AND on hen's typed entry of the 9th with no warning shown.
      let dupMatch = null;
      if (navigator.onLine) {
        try {
          dupMatch = await withTimeout(
            api.findAnyByPaperTicketNo({ locationId: effectiveStationId, paperTicketNo: trimmedTicketNo }),
            3500, null
          );
        } catch { dupMatch = null; }
      }
      if (!dupMatch) {
        // Offline, or the live check timed out. This device's own caches
        // are the fallback — again both of them, for the same reason.
        const sameNo = (v) =>
          (normalizePaperTicketNo(v) || "").toLowerCase() === trimmedTicketNo.toLowerCase();
        const cachedTx = getCachedTransactions().find(
          (tx) => tx.location_id === effectiveStationId && sameNo(tx.paper_ticket_no)
        );
        const cachedTicket = !cachedTx && getCachedTickets().find(
          (tk) => tk.location_id === effectiveStationId && sameNo(tk.paper_ticket_no)
        );
        dupMatch = cachedTx
          ? { ...cachedTx, kind: "transaction" }
          : (cachedTicket ? { ...cachedTicket, kind: "ticket" } : null);
      }
      if (dupMatch) {
        setDupWarn({
          ticketNo: trimmedTicketNo,
          code: dupMatch.code || null,
          partyName: dupMatch.party_name || dupMatch.partyName || null,
          kind: dupMatch.kind === "ticket" ? "ticket" : "transaction",
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
          // [2026-09-19] Only ever ADD or CORRECT, never blank out. When a
          // farmer was found by typing their phone number (without picking
          // them from the suggestion list), the bank fields on this form were
          // still empty — and "" differs from their saved ABA account, so the
          // save wrote blanks over it. Nothing on screen showed it; the next
          // payment simply had no account to go to. Clearing a farmer's bank
          // details is an edit made on purpose on the farmer's own page.
          if (bankName && bankName !== (party.bank_name || "")) patch.bankName = bankName;
          if (bankAccount && bankAccount !== (party.bank_account || "")) patch.bankAccount = bankAccount;
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

      const alreadyCreated = createdTxRef.current;
      const tx = alreadyCreated || await createTransactionOffline({
        type, locationId: effectiveStationId, partyId, productId,
        quantityKg: netKg, pricePerKg: finalPricePerKg, paymentStatus: finalPaymentStatus, userId: session.user.id,
        txDate,
        qualityGrade: isBuy ? (qualityGrade.trim() || null) : null,
        taxApplicable, taxRate: parseFloat(taxRate) || 0,
        moisturePct: parseFloat(moisturePct) || 0, mixturePct: parseFloat(mixturePct) || 0,
        outthrowPct: parseFloat(outthrowPct) || 0, deductionKg: parseFloat(deductionKg) || 0,
        staffFee: 0,
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
        grossSource, tareSource,
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
      createdTxRef.current = tx;

      // Log every new Buy/Sell to the Activity Log so it's traceable later —
      // same reasoning as logging edits/payments: an audit trail is only
      // useful for finding mistakes if it captures the original entry too,
      // not just later corrections.
      if (!alreadyCreated) logAuditOffline({
        action: "create_transaction",
        tableName: "transactions",
        recordId: tx.id,
        newData: {
          code: tx.code, type, partyName, quantityKg: netKg, pricePerKg: finalPricePerKg,
          amount: tx.amount, stationName: myStation?.name, txDate: tx.tx_date, paymentStatus: finalPaymentStatus,
          paperTicketNo: paperTicketNo.trim() || null,
          // [2026-09-22] What the Activity Log and the ticket's own History
          // need to answer "who typed this in, when, and was it weighed?"
          grossSource, tareSource, typedIn, signed: true,
          enteredAt: getAccurateNow().toISOString(),
        },
        userId: session.user.id,
      });

      // If it was entered as already paid, record that cash movement immediately
      // so it shows up correctly in Accounts Payable/Receivable and Cash Flow.
      // finalPaymentStatus is never "paid" when finalPricePerKg is null (see
      // above), so this can't fire a real ₣0 "payment received" record for
      // a transaction nobody has actually agreed a price on yet.
      if (finalPaymentStatus === "paid") {
        let createdPayment;
        try {
          createdPayment = createPaymentOffline({
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
          const e = new Error(t("tx_payment_retry"));
          e.cause = payErr;
          throw e;
        }
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
        // [2026-09-19] The station's own address/phone on the receipt, as on
        // a finished ticket — it printed head office's instead.
        stationAddress: myStation?.address || "", stationPhone: myStation?.phone || "",
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

  // [2026-09-22] REBUILT AS NUMBERED STEPS. SISEN: "now i want a proper
  // design make it very simple and understandble", and, on the extra
  // sections: "it shouldnt be in an add more".
  //
  // The form is what it always was — a paper ticket being copied in — so it
  // now reads in that order, one card per step, nothing folded away and
  // nothing hidden behind a click. Quality deduction and VAT/photos are off
  // the screen for now ("for now we dont need 8 and 9 yet"); the values they
  // set still travel with a save, at their empty defaults, so nothing that
  // reads a transaction had to change.
  const Step = ({ n, title, hint, children }) => (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-brand-100 bg-brand-50 text-[12px] font-bold text-brand-700">{n}</span>
        <b className="text-[13.5px] font-semibold text-slate-800">{title}</b>
        {hint && <span className="ml-auto text-[11.5px] text-slate-400">{hint}</span>}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={isBuy ? t("new_buy_title") : t("new_sell_title")} />
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">

            <Step n={1} title="The paper ticket" hint="from the booklet">
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
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                  Ticket <b>{dupWarn.ticketNo}</b> has already been used at this station
                  {dupWarn.kind === "ticket" ? " — on a weighbridge ticket" : ""}
                  {dupWarn.code ? ` — ${dupWarn.code}` : ""}{dupWarn.partyName ? `, ${dupWarn.partyName}` : ""}.
                  Check the book. If the number really is right, press Save again and it will go through — both
                  entries will be marked so they can be looked at later.
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-slate-400">From the booklet. Suggested from the last one used here.</p>
              )}
            </Step>

            <Step n={2} title={isBuy ? "Who sold it" : "Who bought it"}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <p className="mt-1 text-[11px] text-slate-400">Finds the right person by phone.</p>
                </div>
                <div>
                  <label className={labelCls}>{isBuy ? t("section1_seller") : t("section1_buyer")} Name</label>
                  <input value={partyQuery} onChange={(e) => { setPartyQuery(e.target.value); setSelectedParty(null); }} placeholder="Type name, or pick a match" className={inputCls} />
                </div>
              </div>
            </Step>

            {/* [2026-09-12] The two boxes say which weigh they are and what
                the truck is carrying, and the net is worked out by
                direction: a BUY arrives loaded (in − out), a SELL arrives
                empty (out − in). Getting that backwards is what recorded
                real truckloads as 0 kg in August. Guarded by
                scripts-check-weigh-direction.mjs — do not "simplify" it. */}
            <Step n={3} title="Weight" hint="first weigh in, then weigh out">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TypedWeight
                  locationId={effectiveLocationId}
                  label={isBuy ? "1. Weigh In — loaded truck" : "1. Weigh In — empty truck"}
                  labelKm="ថ្លឹងទម្ងន់ចូល"
                  hint={isBuy ? "Loaded, on arrival" : "Empty, on arrival"}
                  value={grossKg}
                  onChange={onGrossChange}
                  source={grossSource}
                />
                <TypedWeight
                  locationId={effectiveLocationId}
                  label={isBuy ? "2. Weigh Out — empty truck" : "2. Weigh Out — loaded truck"}
                  labelKm="ថ្លឹងទម្ងន់ចេញ"
                  hint={isBuy ? "Empty, after unloading" : "Loaded, before it leaves"}
                  value={tareKg}
                  onChange={onTareChange}
                  source={tareSource}
                />
              </div>
              <div className={`mt-4 flex items-baseline justify-between rounded-xl border px-4 py-3 ${weightsReversed ? "border-rose-200 bg-rose-50" : "border-brand-100 bg-brand-50"}`}>
                <p className={`text-[12.5px] font-semibold ${weightsReversed ? "text-rose-700/80" : "text-brand-700"}`}>
                  {t("net_weight")} — {isBuy ? "what was bought" : "what was sold"}
                </p>
                <p className={`text-2xl font-bold tabular-nums ${weightsReversed ? "text-rose-700" : "text-brand-800"}`}>
                  {fmt2(netKg)} <span className={`text-base font-medium ${weightsReversed ? "text-rose-600" : "text-brand-600"}`}>KG</span>
                </p>
              </div>
              {typedIn && !weightsReversed && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">
                  Typed-in copy — not weighed here.
                </p>
              )}
              {weightsReversed && (
                <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] leading-relaxed text-rose-700">
                  <b>The two weights are the wrong way round.</b> {reversedMessage} Swap them — this cannot be saved as it stands.
                </p>
              )}
            </Step>

            <Step n={4} title="Paddy and price">
              <div className={`grid grid-cols-1 gap-3 ${isBuy ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                <div>
                  <label className={labelCls}>{t("product")}</label>
                  <select
                    value={paddyOptions.includes(productQuery) ? productQuery : ""}
                    onChange={(e) => setProductQuery(e.target.value)}
                    className={inputCls}
                  >
                    <option value="" disabled>{t("wt_select_paddy_type")}</option>
                    {paddyOptions.map((name) => (
                      <option key={name} value={name}>
                        {isOtherPaddyType(name) && t("wt_other_paddy_type") !== name
                          ? `${name} · ${t("wt_other_paddy_type")}`
                          : name}
                      </option>
                    ))}
                  </select>
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
            </Step>

            <Step n={5} title="Vehicle & driver" hint="optional">
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
            </Step>

            <Step n={6} title="Payment" hint="optional">
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
            </Step>

            {isBuy ? (
              <Step n={7} title="Bank details" hint="how this seller gets paid · optional">
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
              </Step>
            ) : (
              <Step n={7} title="Company & destination" hint="where this load is going · optional">
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
              </Step>
            )}

            {error && <p className="text-sm text-rose-500">{error}</p>}
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <p className="text-[12px] text-slate-500">{isBuy ? "Total to pay the farmer" : "Total from the buyer"}</p>
                <p className="mt-1 text-[30px] font-bold tabular-nums tracking-tight text-slate-900">{fmtRiel(total)}</p>
              </div>
              <div className="px-5 py-3 text-[13px]">
                <div className="flex justify-between py-1 text-slate-600"><span>{t("net_weight")}</span><span className="font-semibold tabular-nums text-slate-800">{fmt2(payableKg)} kg</span></div>
                <div className="flex justify-between py-1 text-slate-600"><span>{t("price_per_kg")}</span><span className="font-semibold tabular-nums text-slate-800">{fmtRiel(parseFloat(pricePerKg) || 0)}</span></div>
                <div className="flex justify-between py-1 text-slate-400"><span>Paper ticket</span><span className="tabular-nums">{paperTicketNo || "—"}</span></div>
                <div className="flex justify-between py-1 text-slate-400"><span>{t("station")}</span><span className="truncate pl-2">{myStation?.name || "—"}</span></div>
              </div>
              <div className="px-5 pb-5">
                <div className="mb-3 rounded-xl border border-gold-300 bg-gold-50 px-3.5 py-3">
                  <p className="text-[12.5px] font-bold text-gold-700">Sign as {profile?.full_name || session?.user?.email || "—"}</p>
                  <input type="password" value={signPassword} onChange={(e) => setSignPassword(e.target.value)}
                    placeholder={t("xr_password")} autoComplete="current-password"
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-100" />
                </div>
                <button type="submit" disabled={saving || !signPassword} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                  <Save size={16} /> {saving ? "..." : t("save_transaction")}
                </button>
                <button type="button" onClick={() => setPage("transactions")} className="mt-2 w-full rounded-lg py-2 text-xs text-slate-400 hover:text-slate-600">← {t("back")}</button>
              </div>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
