import { useEffect, useMemo, useState } from "react";
import { Plus, Printer, X, ArrowRight, Ban, Check, WifiOff, RefreshCw, Search } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import PhotoUpload from "../components/PhotoUpload.jsx";
import WeightField from "../components/WeightField.jsx";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import Receipt from "./Receipt.jsx";
import {
  startAutoSync, refreshLookupCaches, getCachedTickets, mergeServerTickets,
  resolvePartyIdOffline, resolveProductIdOffline, createTicketOffline,
  setTicketGrossOffline, setTicketPriceOffline, setTicketTareOffline, finalizeTicketOffline,
  onSyncStatusChange, pendingCountForTicket, getCachedParties, updatePartyOffline,
  suggestNextPaperTicketNo, withTimeout,
} from "../offlineQueue.js";

// Same reasoning as the offline queue's own lookups: don't let a slow/no
// internet connection make a background phone lookup hang and, worse,
// overwrite a farmer name staff already typed while waiting on it.
const PHONE_LOOKUP_TIMEOUT_MS = 4000;

// The ONLY paddy types shown by default — deliberately just these 5, in
// this order, not whatever else happens to already be sitting in the
// products table from earlier testing/history. Each option is labeled
// "1. សែន ក្រអូប" etc. so staff can jump straight to one just by pressing
// its number key while the list is focused (standard dropdown behavior:
// typing a character jumps to the option whose label starts with it) —
// the full name is still right there next to the number, never hidden.
// A type typed in via "+ Add new type…" (see productOptions below) is
// remembered on this device and appended after these as 6, 7, ... — see
// addCustomPaddyType/getCustomPaddyTypes.
const PADDY_TYPE_SEED = ["សែន ក្រអូប", "ផ្កា ម្លីះ", "ស្រង៉ែ", "ផ្កា រំដួល", "5451"];

// A staff-typed paddy type that isn't one of the 5 above still gets saved
// as a real product record on the server (via resolveProductIdOffline,
// unchanged) — but the dropdown itself intentionally does NOT pull in
// every product that's ever existed in that table (old test data, one-off
// typos, etc. would otherwise clutter it right back up). Instead, this
// device remembers just the types actually added here, so the list stays
// exactly "the 5, plus whatever's genuinely been typed in since."
const CUSTOM_PADDY_TYPES_KEY = "ptw_custom_paddy_types_v1";
function getCustomPaddyTypes() {
  try {
    const raw = localStorage.getItem(CUSTOM_PADDY_TYPES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function addCustomPaddyType(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  try {
    const list = getCustomPaddyTypes();
    if (!list.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      list.push(trimmed);
      localStorage.setItem(CUSTOM_PADDY_TYPES_KEY, JSON.stringify(list));
    }
  } catch {
    // Storage full/unavailable — worst case this device just re-offers
    // "+ Add new type…" again next time instead of remembering it.
  }
}

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
// Splits a timestamptz into Cambodia-local date/time strings — same
// formatting Receipt.jsx uses, so the slip and the final receipt read the
// same way.
function splitCambodiaTimestamp(iso) {
  if (!iso) return { date: "—", time: "—" };
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "short", year: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return { date, time };
}

// These are the underlying stages a ticket moves through in the database
// (unchanged from before — this is what keeps old data and the sync queue
// compatible). What changed is that the board no longer shows a separate
// screen/tab for each one: "arrived" and "weighed_in" happen together the
// instant staff open a new ticket, and "priced"/"weighed_out" happen
// together in the single "Finish Ticket" step — matching how Baitang
// actually uses two visits to the computer per truck, not four or five.
const OPEN_STAGE_IDS = ["arrived", "weighed_in", "priced", "weighed_out"];
const ALL_STAGE_IDS = [...OPEN_STAGE_IDS, "declined"];

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

// Small numbered section header — used to break the Finish Ticket form into
// clear steps (weigh, quality, price, payment, proof) instead of one long
// unbroken list of fields, so a new staff member can follow it top to
// bottom without guessing what comes next.
function SectionHeader({ num, title, hint }) {
  return (
    <div className="mb-2.5 flex items-center gap-2.5">
      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">{num}</div>
      <div>
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

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
  // Whatever bank name/account/QR photo this person already has on file
  // (if any) — captured the moment their phone number matches someone, so
  // it can ride along with the ticket from the very start instead of
  // waiting until Finish Ticket to show up.
  const [savedBank, setSavedBank] = useState(null);
  const { session } = useAuth();
  // Paddy types to choose from: exactly the 5-item starter list, plus
  // anything staff have typed in via "+ Add new type…" on this device
  // (see addCustomPaddyType above) — deliberately NOT everything that
  // happens to already exist in the products table.
  const [productOptions] = useState(() => {
    const seen = new Set(PADDY_TYPE_SEED.map((n) => n.toLowerCase()));
    const extras = getCustomPaddyTypes().filter((name) => {
      const key = (name || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...PADDY_TYPE_SEED, ...extras];
  });
  // Whether the Product field is showing the dropdown list, or a text box
  // for typing a brand new type not already on it.
  const [productIsCustom, setProductIsCustom] = useState(false);
  // Which staff member actually filled in this ticket — separate from the
  // logged-in account, since a station's login is often shared by several
  // people during a shift.
  const [recordedByName, setRecordedByName] = useState("");

  // "Use previous Seller/Buyer" button — the actual shortcut being asked
  // for: when the SAME person brings in several trucks back to back, staff
  // shouldn't have to ask their name and phone number again for every
  // single truck. One click grabs whoever was most recently entered as a
  // seller/buyer (of the matching Buy/Sell type) from this station's own
  // ticket history and fills in ONLY their name + phone — plate, driver,
  // and product are left alone since those genuinely differ truck to
  // truck, even for the same person.
  const previousParty = useMemo(() => {
    const matchType = type === "BUY" ? "supplier" : "buyer";
    const candidates = getCachedTickets()
      .filter((t) => t.type === type && t.party_name && (t.phone || t.party_id))
      .filter((t) => !locationId || t.location_id === locationId)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    if (candidates.length === 0) return null;
    const last = candidates[0];
    // Pull the freshest phone/bank details from the party cache if we have
    // them (ticket history only guarantees the name), falling back to
    // whatever was stored on the ticket itself.
    const cachedMatch = getCachedParties().find((p) => p.type === matchType && p.id === last.party_id);
    return {
      name: last.party_name,
      phone: cachedMatch?.phone || last.phone || "",
      bankName: cachedMatch?.bank_name || last.bank_name || "",
      bankAccount: cachedMatch?.bank_account || last.bank_account || "",
      bankQrUrl: cachedMatch?.bank_qr_url || last.bank_qr_url || null,
    };
  }, [type, locationId]);

  function usePreviousParty() {
    if (!previousParty) return;
    setPartyName(previousParty.name || "");
    setPhone(previousParty.phone || "");
    setPhoneLookupMsg(previousParty.phone ? `Filled in: ${previousParty.name}` : "");
    setSavedBank(
      previousParty.bankName || previousParty.bankAccount || previousParty.bankQrUrl
        ? { bankName: previousParty.bankName, bankAccount: previousParty.bankAccount, bankQrUrl: previousParty.bankQrUrl }
        : null
    );
  }

  // Every seller/buyer already on file for this type (and this station, if
  // one's picked) — not just the most recent one above — so the Name field
  // can offer a searchable list of everyone staff have dealt with before,
  // not only whoever the last truck happened to be.
  const partyOptions = useMemo(() => {
    const matchType = type === "BUY" ? "supplier" : "buyer";
    const names = getCachedParties()
      .filter((p) => p.type === matchType && (!locationId || p.location_id === locationId) && (p.name || "").trim())
      .map((p) => p.name.trim());
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [type, locationId]);

  // Fires on every keystroke in the Name field (not just a pick from the
  // dropdown list — a browser datalist doesn't distinguish the two, and
  // typing out an exact match by hand should work exactly the same way).
  // The moment what's typed exactly matches someone already on file, pull
  // in their phone + saved bank details too, the same as the phone lookup
  // and "Use previous" button both already do — so picking a name from
  // the list is a genuine one-step shortcut, not just the name by itself.
  function handlePartyNameChange(value) {
    setPartyName(value);
    const trimmed = value.trim();
    if (!trimmed) return;
    const matchType = type === "BUY" ? "supplier" : "buyer";
    const match = getCachedParties().find(
      (p) => p.type === matchType && (!locationId || p.location_id === locationId) && (p.name || "").trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (match) {
      setPhone(match.phone || "");
      setPhoneLookupMsg(match.phone ? `Filled in: ${match.name}` : "");
      setSavedBank(
        match.bank_name || match.bank_account || match.bank_qr_url
          ? { bankName: match.bank_name || "", bankAccount: match.bank_account || "", bankQrUrl: match.bank_qr_url || null }
          : null
      );
    }
  }

  // Baitang's paper tickets come from a pre-numbered booklet, used in
  // order — so as soon as a location is known, suggest the next number
  // after whatever was last typed in for that location. Staff can still
  // edit it (a spoiled ticket, a different booklet, etc.) — this only
  // fills it in when it's still blank, so it never overwrites something
  // they already typed. Selling to a buyer doesn't use this paper quality
  // ticket booklet at all — that's a Buy-from-farmer thing only — so this
  // is skipped entirely on the Sell side.
  useEffect(() => {
    if (type === "BUY" && locationId && !paperTicketNo) {
      const suggested = suggestNextPaperTicketNo(locationId);
      if (suggested) setPaperTicketNo(suggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, type]);

  // Looks up a farmer/buyer that already self-registered (via the QR
  // registration page) or has been entered before, by phone number, and
  // fills in their saved name so staff don't retype it. Their saved bank
  // name/account and QR photo (if any are on file) are pulled in here too
  // — the actual Payment Method fields still live at Finish Ticket (that's
  // when cash-vs-bank is really decided), but this way whatever was saved
  // last time is already attached to the ticket from the moment it's
  // created, instead of staff needing to re-enter or re-upload it later.
  async function lookupByPhone() {
    const trimmed = phone.trim();
    if (!trimmed) { setPhoneLookupMsg(""); setSavedBank(null); return; }
    setPhoneLookupMsg("Looking up…");
    // Snapshot what staff had typed before we went to the network — if
    // WiFi is up but no real internet, this used to hang with no limit
    // (see supabaseClient.js) and could still land minutes later and
    // stomp a name staff had since typed by hand.
    const nameBeforeLookup = partyName;
    try {
      const matches = await withTimeout(
        api.getParties({ type: type === "BUY" ? "supplier" : "buyer", phone: trimmed }).catch(() => null),
        PHONE_LOOKUP_TIMEOUT_MS,
        null
      );
      if (matches && matches.length > 0) {
        const p = matches[0];
        // Only auto-fill if staff hasn't typed a name in the meantime.
        if (partyName === nameBeforeLookup) setPartyName(p.name || "");
        setPhoneLookupMsg(`Found: ${p.name}`);
        setSavedBank(
          p.bank_name || p.bank_account || p.bank_qr_url
            ? { bankName: p.bank_name || "", bankAccount: p.bank_account || "", bankQrUrl: p.bank_qr_url || null }
            : null
        );
      } else if (matches === null) {
        // Timed out or failed (likely offline) — don't claim "no record".
        setPhoneLookupMsg("");
      } else {
        setPhoneLookupMsg("No record found — fill in details below.");
        setSavedBank(null);
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
    if (!recordedByName.trim()) {
      setError(`Please enter the name of the ${type === "BUY" ? "buyer" : "seller"} filling in this ticket.`);
      return;
    }
    if (type === "BUY" && !paperTicketNo.trim()) {
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
      // Remember a brand new paddy type on this device so it shows up as
      // its own numbered option next time (see PADDY_TYPE_SEED above) —
      // a no-op if it was already picked from the list.
      if (productIsCustom) addCustomPaddyType(productName);
      const locationName = locations.find((l) => l.id === locationId)?.name;
      const ticket = createTicketOffline({
        type, locationId, locationName, partyId, partyName: partyName.trim(), phone,
        carPlate, driverName, productId, productName: productName.trim(), userId: session.user.id,
        paperTicketNo: paperTicketNo.trim(),
        recordedByName: recordedByName.trim(),
        bankName: savedBank?.bankName || undefined,
        bankAccount: savedBank?.bankAccount || undefined,
        bankQrUrl: savedBank?.bankQrUrl || undefined,
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
        {/* Not shown for Sell — the paper quality ticket booklet is only
            used when buying from a farmer, so this field (and its
            required-field check below) is skipped entirely on the Sell
            side. */}
        {type === "BUY" && (
          <div>
            <label className={labelCls}>Quality Ticket No.</label>
            <input value={paperTicketNo} onChange={(e) => setPaperTicketNo(e.target.value)} className={inputCls} placeholder="e.g. 092152" />
            <p className="mt-1 text-[11px] text-slate-400">Auto-suggested from the last one used — edit if it's wrong</p>
          </div>
        )}
        <div className={type === "BUY" ? "" : "col-span-2"}><label className={labelCls}>Vehicle Plate Number</label><input value={carPlate} onChange={(e) => setCarPlate(e.target.value)} className={inputCls} /></div>
        <div className="col-span-2">
          <label className={labelCls}>Phone (type it and tab/click away to look them up)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={lookupByPhone} className={inputCls} />
          {phoneLookupMsg && <p className={`mt-1 text-xs ${phoneLookupMsg.startsWith("Found") ? "text-emerald-600" : "text-slate-400"}`}>{phoneLookupMsg}</p>}
          {savedBank && (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              {savedBank.bankQrUrl && (
                <img src={savedBank.bankQrUrl} alt="Saved bank QR code" className="h-12 w-12 flex-shrink-0 rounded border border-emerald-200 object-cover" />
              )}
              <div className="text-xs text-emerald-700">
                <p className="font-semibold">Saved payment on file — filled in automatically</p>
                <p>{savedBank.bankName || "—"}{savedBank.bankAccount ? ` · ${savedBank.bankAccount}` : ""}</p>
              </div>
            </div>
          )}
        </div>
        <div className="col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <label className={labelCls}>{type === "BUY" ? "Seller (Farmer) Name" : "Buyer Name"}</label>
            {previousParty && (
              <button
                type="button"
                onClick={usePreviousParty}
                className="mb-1 rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
                title={`Fill in name + phone for ${previousParty.name}`}
              >
                Use previous {type === "BUY" ? "seller" : "buyer"}: {previousParty.name}
              </button>
            )}
          </div>
          <input
            list="new-ticket-party-options"
            value={partyName}
            onChange={(e) => handlePartyNameChange(e.target.value)}
            className={inputCls}
            placeholder="Start typing to search, or type a new name"
          />
          <datalist id="new-ticket-party-options">
            {partyOptions.map((name) => <option key={name} value={name} />)}
          </datalist>
        </div>
        <div>
          <label className={labelCls}>Product (paddy type)</label>
          {productIsCustom ? (
            <div>
              <input
                autoFocus
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className={inputCls}
                placeholder="Type the new paddy type"
              />
              <button
                type="button"
                onClick={() => { setProductIsCustom(false); setProductName(""); }}
                className="mt-1 text-xs font-medium text-brand-600 hover:underline"
              >
                ← Back to list
              </button>
            </div>
          ) : (
            <select
              value={productOptions.includes(productName) ? productName : ""}
              onChange={(e) => {
                if (e.target.value === "__other__") { setProductIsCustom(true); setProductName(""); }
                else setProductName(e.target.value);
              }}
              className={inputCls}
            >
              <option value="" disabled>Select paddy type…</option>
              {productOptions.map((name, i) => <option key={name} value={name}>{i + 1}. {name}</option>)}
              <option value="__other__">+ Add new type…</option>
            </select>
          )}
          {!productIsCustom && <p className="mt-1 text-[11px] text-slate-400">Tip: click the list, then press a number key to jump straight to it</p>}
        </div>
        <div><label className={labelCls}>Driver Name</label><input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inputCls} placeholder="optional" /></div>
        <div className="col-span-2">
          <label className={labelCls}>{type === "BUY" ? "Buyer" : "Seller"}</label>
          <input
            value={recordedByName}
            onChange={(e) => setRecordedByName(e.target.value)}
            className={inputCls}
            placeholder="Your name (whoever is filling in this ticket)"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            {type === "BUY"
              ? "You're the one buying this paddy on PaddyTrade's behalf — put your name here, not the farmer's."
              : "You're the one selling this paddy on PaddyTrade's behalf — put your name here, not the buyer's."}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {/* Buy: the truck shows up already loaded with paddy from the
            farmer, so this first weighing is the heavier "gross" number.
            Sell: it's the reverse — the truck shows up empty and only
            gets loaded (for delivery to the buyer) after Finish Ticket,
            so this first weighing is actually the lighter, empty weight.
            The label follows which one is physically true right now. */}
        <WeightField
          locationId={locationId}
          label={type === "BUY" ? "Gross Weight — loaded truck (kg)" : "Weight — empty truck (kg)"}
          value={grossWeight}
          onChange={setGrossWeight}
          isAdmin={isAdmin}
        />
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

function FinishTicketModal({ ticket, onClose, onFinalized, onDeclined, isAdmin }) {
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

  // Buy: paddy weight is In minus Out (arrives loaded, leaves empty).
  // Sell: it's Out minus In (arrives empty, leaves loaded for delivery).
  const netKg = Math.max(0, isBuy
    ? (ticket.gross_kg || 0) - (parseFloat(tareWeight) || 0)
    : (parseFloat(tareWeight) || 0) - (ticket.gross_kg || 0));
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
    // Buy: the price was already agreed with the farmer on the paper
    // ticket, so it's required here. Sell: the price to the buyer often
    // isn't settled yet at this point — the ticket can be finished with
    // price left blank (0), and corrected later from the Transactions
    // list once it's actually agreed.
    if (isBuy && !pricePerKg) { setError("Please enter the price that was agreed on the paper ticket."); return; }
    if (!tareKg || tareKg <= 0) { setError(isBuy ? "Please enter the empty truck's weight." : "Please enter the loaded truck's weight."); return; }
    // Photo of the paper ticket is off while testing — no camera on this
    // computer yet. Re-add this check once photos are actually possible.
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
    <Modal title={`Finish Ticket ${ticket.code}`} subtitle={`${ticket.party_name} · ${ticket.car_plate} · ${isBuy ? "Gross" : "Weighed in"}: ${fmt2(ticket.gross_kg)} kg (weighed in earlier)`} onClose={onClose} wide>
      {/* 1. Weigh Out — the physical action happening right now. Buy: the
          truck is empty now, having dropped off its paddy. Sell: it's the
          opposite — the truck was empty at weigh-in and is now loaded up
          for delivery to the buyer. */}
      <div className="mb-5">
        <SectionHeader num={1} title="Weigh Out" hint={isBuy ? "The truck is empty and on the scale right now" : "The truck is now loaded and on the scale right now"} />
        <WeightField
          locationId={ticket.location_id}
          label={isBuy ? "Tare Weight — empty truck (kg)" : "Weight — loaded truck (kg)"}
          scaleLabel={isBuy ? "Live Scale Weight (empty truck)" : "Live Scale Weight (loaded truck)"}
          value={tareWeight}
          onChange={setTareWeight}
          isAdmin={isAdmin}
        />
      </div>

      {/* 2. Quality — transcribed from the paper ticket */}
      <div className="mb-5">
        <SectionHeader num={2} title="Quality" hint="The grade and quality readings already agreed on the paper ticket" />
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-200 p-4">
          <div><label className={labelCls}>Quality Grade</label><input value={qualityGrade} onChange={(e) => setQualityGrade(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Moisture %</label><input type="number" value={moisturePct} onChange={(e) => setMoisturePct(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Mixture %</label><input type="number" value={mixturePct} onChange={(e) => setMixturePct(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Outthrow %</label><input type="number" value={outthrowPct} onChange={(e) => setOutthrowPct(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Deduction (kg)</label><input type="number" value={deductionKg} onChange={(e) => setDeductionKg(e.target.value)} className={inputCls} /></div>
        </div>
      </div>

      {/* 3. Price & Total — everything that feeds the amount owed, with the running total right below it */}
      <div className="mb-5">
        <SectionHeader num={3} title="Price & Total" hint={isBuy ? "What this truckload is worth" : "Leave blank if the price isn't settled with the buyer yet — it can be added later from Transactions"} />
        <div className="rounded-lg border-2 border-brand-200 bg-brand-50 p-4">
          <label className="mb-1 block text-sm font-semibold text-brand-800">
            {isBuy ? "Price per kg (Riel) — the price agreed on the paper ticket" : "Price per kg (Riel) — optional, if already agreed"}
          </label>
          <input type="number" min="0" step="1" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} placeholder={isBuy ? "e.g. 1090" : "leave blank if not decided yet"}
            className="w-full rounded-lg border border-brand-300 bg-white px-3 py-3 text-lg font-semibold outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {isBuy && (
            <div><label className={labelCls}>Staff / Carrying Fee (optional)</label><input type="number" value={staffFee} onChange={(e) => setStaffFee(e.target.value)} className={inputCls} /></div>
          )}
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={taxApplicable} onChange={(e) => setTaxApplicable(e.target.checked)} /> Tax applicable</label>
            {taxApplicable && <input type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={`${inputCls} w-20`} />}
          </div>
        </div>
        <div className="mt-3 space-y-1.5 rounded-lg bg-slate-50 p-4 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Net Weight</span><span className="font-medium">{fmt2(netKg)} kg</span></div>
          {(parseFloat(deductionKg) || 0) > 0 && <div className="flex justify-between"><span className="text-slate-500">Payable Weight</span><span className="font-medium">{fmt2(payableKg)} kg</span></div>}
          <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="font-semibold text-slate-700">Total</span><span className="font-bold text-brand-700">{fmtRiel(total)}</span></div>
        </div>
      </div>

      {/* 4. Payment Method — decided after the total is known */}
      <div className="mb-5">
        <SectionHeader num={4} title="Payment Method" hint={`How ${ticket.party_name || "this farmer"} will be paid`} />
        <div className="rounded-lg border border-slate-200 p-4">
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
      </div>

      {/* 5. Note & Proof — wraps up the ticket; the required photo is the last thing before Save */}
      <div className="mb-1">
        <SectionHeader num={5} title="Note & Proof" hint="Optional note, and the signed paper ticket for HQ to check against" />
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="mb-3"><label className={labelCls}>Note</label><input value={priceNote} onChange={(e) => setPriceNote(e.target.value)} className={inputCls} placeholder="optional" /></div>
          <PhotoUpload
            label="Photo of the finished, signed paper ticket" kind="receipt"
            url={receiptPhotoUrl} onUploaded={setReceiptPhotoUrl}
            hint="So HQ can check it against what's entered here (optional)"
          />
        </div>
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
  const [settings, setSettings] = useState({});
  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  // Buy: In minus Out. Sell: Out minus In (see NewTicketModal/
  // FinishTicketModal above for why the two are reversed).
  const netKg = ticket.gross_kg != null && ticket.tare_kg != null
    ? Math.max(0, ticket.type === "BUY" ? ticket.gross_kg - ticket.tare_kg : ticket.tare_kg - ticket.gross_kg)
    : null;
  const inStamp = splitCambodiaTimestamp(ticket.gross_at);
  const outStamp = splitCambodiaTimestamp(ticket.tare_at);
  const isPriced = !!ticket.priced_at;
  const cellCls = "px-2 py-1.5 border border-slate-300";
  const labelCellCls = `${cellCls} bg-slate-50 font-medium text-slate-600 whitespace-nowrap`;
  const rowCls = "flex justify-between border-b border-slate-100 px-3 py-2 last:border-0";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="no-print mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">Weigh-In Slip</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"><Printer size={13} /> Print</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
        </div>
        <div id="ticket-slip-root" className="rounded-lg border border-slate-300 p-6 text-sm">
          {/* Header — same company info style as the final receipt */}
          <div className="mb-3 text-center">
            <p className="text-lg font-bold text-slate-800">{settings.company_name || "PaddyTrade"}</p>
            {settings.company_name_kh && <p className="text-sm text-slate-500">{settings.company_name_kh}</p>}
            <p className="text-xs text-slate-400">{settings.company_address || "Battambang, Cambodia"}</p>
            {settings.company_phone && <p className="text-xs text-slate-400">{settings.company_phone}</p>}
          </div>
          <p className="text-center text-lg font-bold text-slate-800">Ticket {ticket.code}</p>
          <p className="text-center text-xs text-slate-500">{ticket.stationName} · {ticket.type === "BUY" ? "Buy (from farmer)" : "Sell (to buyer)"}</p>
          {ticket.paper_ticket_no && <p className="text-center text-xs text-slate-400">Quality Ticket No. {ticket.paper_ticket_no}</p>}

          {/* Weight table — same LIST/TRUCK ID/DATE/TIME/WEIGHT layout as
              the final receipt, so this reads consistently once printed. */}
          <table className="my-4 w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-500">
                <th className={`${cellCls} text-left font-medium`}>List</th>
                <th className={`${cellCls} text-left font-medium`}>Truck ID</th>
                <th className={`${cellCls} text-left font-medium`}>Date</th>
                <th className={`${cellCls} text-left font-medium`}>Time</th>
                <th className={`${cellCls} text-right font-medium`}>Weight</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${cellCls} font-medium text-slate-600`}>IN</td>
                <td className={`${cellCls} text-slate-600`}>{ticket.car_plate || "—"}</td>
                <td className={`${cellCls} text-slate-600`}>{inStamp.date}</td>
                <td className={`${cellCls} text-slate-600`}>{inStamp.time}</td>
                <td className={`${cellCls} text-right font-medium text-slate-700`}>{ticket.gross_kg != null ? `${fmt2(ticket.gross_kg)} KG` : "—"}</td>
              </tr>
              {ticket.tare_kg != null && (
                <tr>
                  <td className={`${cellCls} font-medium text-slate-600`}>OUT</td>
                  <td className={`${cellCls} text-slate-600`}>{ticket.car_plate || "—"}</td>
                  <td className={`${cellCls} text-slate-600`}>{outStamp.date}</td>
                  <td className={`${cellCls} text-slate-600`}>{outStamp.time}</td>
                  <td className={`${cellCls} text-right font-medium text-slate-700`}>{fmt2(ticket.tare_kg)} KG</td>
                </tr>
              )}
              {netKg != null && (
                <tr>
                  <td colSpan={4} className={labelCellCls}>Net Weight</td>
                  <td className={`${cellCls} text-right font-semibold text-slate-800`}>{fmt2(netKg)} KG</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Truck / party details */}
          <div className="mb-3 overflow-hidden rounded-lg border border-slate-200">
            <div className={rowCls}><span className="text-slate-500">{ticket.type === "BUY" ? "Seller (Farmer)" : "Buyer"}</span><span className="font-medium text-slate-700">{ticket.party_name}</span></div>
            {ticket.phone && <div className={rowCls}><span className="text-slate-500">Phone</span><span className="font-medium text-slate-700">{ticket.phone}</span></div>}
            <div className={rowCls}><span className="text-slate-500">Product</span><span className="font-medium text-slate-700">{ticket.product_name}</span></div>
            <div className={rowCls}><span className="text-slate-500">Driver</span><span className="font-medium text-slate-700">{ticket.driver_name || "—"}</span></div>
          </div>

          {/* Once quality/price has been set, show it here too — useful if
              this slip gets reprinted after Finish Ticket. */}
          {isPriced && (
            <div className="mb-3 overflow-hidden rounded-lg border border-slate-200">
              {ticket.quality_grade && <div className={rowCls}><span className="text-slate-500">Quality Grade</span><span className="font-medium text-slate-700">{ticket.quality_grade}</span></div>}
              <div className={rowCls}><span className="text-slate-500">Moisture / Outthrow</span><span className="font-medium text-slate-700">{fmt2(ticket.moisture_pct)}% / {fmt2(ticket.outthrow_pct)}%</span></div>
              {ticket.price_per_kg != null && <div className={rowCls}><span className="text-slate-500">Price / Kg</span><span className="font-medium text-slate-700">{fmtRiel(ticket.price_per_kg)}</span></div>}
              {ticket.bank_name && <div className={rowCls}><span className="text-slate-500">Bank</span><span className="font-medium text-slate-700">{ticket.bank_name}{ticket.bank_name !== "Cash" && ticket.bank_account ? ` — ${ticket.bank_account}` : ""}</span></div>}
            </div>
          )}

          {/* Signature lines — larger and more spaced out for an actual pen */}
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 text-xs text-slate-500">
            <div>Statistics Officer / Price Set By: ..........................</div>
            <div>{ticket.type === "BUY" ? "Seller" : "Buyer"}: ..........................</div>
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
  const [search, setSearch] = useState("");
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
    const q = search.trim().toLowerCase();
    // Search by ticket number, vehicle plate, or Quality Ticket No. — the
    // things staff actually have in hand when looking a truck up (the
    // driver rarely knows the farmer's exact registered name).
    const matches = (t) =>
      !q ||
      (t.code || "").toLowerCase().includes(q) ||
      (t.car_plate || "").toLowerCase().includes(q) ||
      (t.paper_ticket_no || "").toLowerCase().includes(q);
    const waiting = tickets.filter((t) => OPEN_STAGE_IDS.includes(t.stage) && matches(t));
    const declined = tickets.filter((t) => t.stage === "declined" && matches(t));
    return { waiting, declined };
  }, [tickets, search]);

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
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ticket # or plate…"
                className="w-48 rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:w-56"
              />
            </div>
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
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
            {search.trim() ? "No tickets match that search." : "No tickets here right now."}
          </p>
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
                  {t.recorded_by_name && <p className="text-xs text-slate-400">{t.type === "BUY" ? "Buyer" : "Seller"}: {t.recorded_by_name}</p>}
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
          isAdmin={isAdmin}
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
