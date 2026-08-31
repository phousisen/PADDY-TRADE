import { useEffect, useMemo, useState } from "react";
import { Plus, Printer, X, ArrowRight, Ban, Check, Search, Pencil } from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import Topbar from "../components/Topbar.jsx";
import PhotoUpload from "../components/PhotoUpload.jsx";
import WeightField from "../components/WeightField.jsx";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import Receipt from "./Receipt.jsx";
import {
  startAutoSync, refreshLookupCaches, getCachedTickets, mergeServerTickets,
  resolvePartyIdOffline, resolveProductIdOffline, createTicketOffline, editTicketOffline,
  setTicketGrossOffline, setTicketPriceOffline, setTicketTareOffline, finalizeTicketOffline,
  onSyncStatusChange, pendingCountForTicket, getCachedParties, updatePartyOffline,
  suggestNextPaperTicketNo, withTimeout, logAuditOffline,
} from "../offlineQueue.js";

// Same reasoning as the offline queue's own lookups: don't let a slow/no
// internet connection make a background phone lookup hang and, worse,
// overwrite a farmer name staff already typed while waiting on it.
const PHONE_LOOKUP_TIMEOUT_MS = 4000;

// Bounds the main board's fetch (see load() below) — same reasoning as
// PHONE_LOOKUP_TIMEOUT_MS just longer, since this is the primary data for
// the whole page rather than a background nicety. Without this, a
// connection navigator.onLine still calls "online" but that's actually
// stalled (weak signal, captive portal, a slow query) left this screen
// stuck on "Loading…" forever, because the request itself never resolved
// or rejected for setLoading(false) to run.
const BOARD_LOAD_TIMEOUT_MS = 12000;

// Bounds Finish Ticket's in-stock-paddy-type lookup (Sell only — see
// FinishTicketModal). A background nicety like the phone lookup, not the
// page's primary data, but this one fetches every transaction at a
// location rather than a single row, so it gets a bit more room than
// PHONE_LOOKUP_TIMEOUT_MS on a slow connection before falling back.
const STOCK_LOOKUP_TIMEOUT_MS = 8000;

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

// Vehicle type on the New Ticket form — same growable-list pattern as
// paddy types above. Truck gets a plate number (the original behavior);
// anything else (Koyun, Tractor, or a new type someone adds later) gets a
// bag count instead, since those don't have license plates. The combined
// "Type: value" text (e.g. "Truck: 3A-1890", "Koyun: 12 bags") is what
// actually gets saved into the ticket's existing car_plate field — no
// database change needed, and every other screen that already displays
// car_plate (board cards, receipts, Excel export, Transactions) keeps
// working without modification.
const VEHICLE_TYPE_SEED = ["Truck", "Koyun", "Tractor"];
const CUSTOM_VEHICLE_TYPES_KEY = "ptw_custom_vehicle_types_v1";
function getCustomVehicleTypes() {
  try {
    const raw = localStorage.getItem(CUSTOM_VEHICLE_TYPES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function addCustomVehicleType(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  try {
    const list = getCustomVehicleTypes();
    if (!list.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      list.push(trimmed);
      localStorage.setItem(CUSTOM_VEHICLE_TYPES_KEY, JSON.stringify(list));
    }
  } catch {
    // Storage full/unavailable — same fallback as paddy types above.
  }
}

// Same idea, for the "Buyer"/"Seller" (whoever is actually filling in the
// ticket) field below — starts empty and grows as names get typed in on
// this device via "+ Add new name…", numbered the same way so staff can
// jump to a name by pressing its number. Deliberately NOT pre-seeded with
// any real person's name here — this array is shared by every station, so
// anything hardcoded in it would show up at every location regardless of
// who actually works there (this is exactly what happened with "Malis
// Bopha", a Pong Ro staff name, showing up at Reang Kesey too).
const RECORDED_BY_NAME_SEED = [];

// Kept as a SEPARATE list per location (not one shared list device-wide),
// since the staff working the scale — and so the names worth remembering —
// are different from station to station. This only actually matters for an
// HQ Admin who can switch the Location dropdown above between stations;
// ordinary staff are always on their own single assigned location anyway.
const RECORDED_BY_NAMES_KEY_PREFIX = "ptw_recorded_by_names_v1__";
function getRecordedByNames(locationId) {
  try {
    const raw = localStorage.getItem(RECORDED_BY_NAMES_KEY_PREFIX + (locationId || "none"));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function addRecordedByName(locationId, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  try {
    const key = RECORDED_BY_NAMES_KEY_PREFIX + (locationId || "none");
    const list = getRecordedByNames(locationId);
    if (!list.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      list.push(trimmed);
      localStorage.setItem(key, JSON.stringify(list));
    }
  } catch {
    // Storage full/unavailable — worst case this device just re-offers
    // "+ Add new name…" again next time instead of remembering it.
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

// headerColor/icon are optional — only NewTicketModal passes them (colored
// banner header). Every other caller renders exactly as before, unchanged.
function Modal({ title, subtitle, onClose, children, wide, headerColor, icon }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`no-print w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl ${headerColor ? "" : "p-5"}`}>
        {headerColor ? (
          <div className={`flex items-center justify-between rounded-t-xl px-5 py-4 text-white ${headerColor}`}>
            <div className="flex items-center gap-3">
              {icon && <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/20 text-lg">{icon}</div>}
              <div>
                <h3 className="font-bold">{title}</h3>
                {subtitle && <p className="mt-0.5 text-xs opacity-85">{subtitle}</p>}
              </div>
            </div>
            <button onClick={onClose} className="text-white/75 hover:text-white flex-shrink-0"><X size={18} /></button>
          </div>
        ) : (
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-slate-700">{title}</h3>
              {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
        )}
        <div className={headerColor ? "p-5" : ""}>{children}</div>
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
// accentBg is optional — defaults to the original always-green circle, so
// nothing else changes unless a caller (FinishTicketModal) passes one in
// to match a ticket's Buy/Sell color.
// `titleKm`/`lang` are optional — only FinishTicketModal passes them (its
// Khmer-translation pass), ordered the same way NewTicketFieldLabel already
// orders Khmer-vs-English elsewhere in this file. Every other caller that
// doesn't pass them renders exactly as before (English title only). `hint`
// is deliberately left English-only even when titleKm is passed — matching
// the New Ticket redesign's own precedent of dropping long explanatory
// sentences rather than risking an awkward Khmer translation of them.
function SectionHeader({ num, title, titleKm, hint, accentBg, lang }) {
  return (
    <div className="mb-2.5 flex items-center gap-2.5">
      <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${accentBg || "bg-brand-600"}`}>{num}</div>
      <div>
        <h3 className="text-sm font-bold text-slate-800">
          {titleKm ? (
            lang === "km" ? <><span className="font-khmer">{titleKm}</span> {title}</> : <>{title} <span className="font-khmer">{titleKm}</span></>
          ) : title}
        </h3>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

// ---- New Ticket & Weigh In (combined — one screen, like the scale software's single window) ----

// Bilingual field label — order follows the app's own EN/ខ្មែរ switch
// (useLanguage()) rather than always being English-first, so this form
// matches whichever language someone already has the rest of the app set
// to. Both languages still show either way; only the order changes.
function NewTicketFieldLabel({ icon, en, km, lang }) {
  const kmEl = <span className="font-khmer">{km}</span>;
  return (
    <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-slate-600">
      <span className="text-sm leading-none">{icon}</span>
      {lang === "km" ? <>{kmEl} {en}</> : <>{en} {kmEl}</>}
    </label>
  );
}

function NewTicketSectionHead({ label, dotClass, textClass }) {
  return (
    <div className="mb-2.5 mt-5 flex items-center gap-2 first:mt-0">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      <span className={`text-[11px] font-extrabold uppercase tracking-wide ${textClass}`}>{label}</span>
    </div>
  );
}

function NewTicketModal({ locations, defaultLocationId, isAdmin, onClose, onCreated, initialType }) {
  const [type] = useState(initialType || "BUY");
  const { lang } = useLanguage();
  const [locationId, setLocationId] = useState(defaultLocationId || "");
  const [partyName, setPartyName] = useState("");
  const [phone, setPhone] = useState("");
  // Vehicle type (Truck/Koyun/Tractor/custom) + its value — a plate
  // number for Truck, a bag count for anything else. Combined into the
  // ticket's existing car_plate field at submit time; see
  // addCustomVehicleType above for why.
  const [vehicleType, setVehicleType] = useState("Truck");
  const [vehicleTypeIsCustom, setVehicleTypeIsCustom] = useState(false);
  const [vehicleValue, setVehicleValue] = useState("");
  const [vehicleTypeOptions] = useState(() => {
    const seen = new Set(VEHICLE_TYPE_SEED.map((n) => n.toLowerCase()));
    const extras = getCustomVehicleTypes().filter((name) => {
      const key = (name || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...VEHICLE_TYPE_SEED, ...extras];
  });
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
  // The seed name, plus anything typed in via "+ Add new name…" for this
  // specific location — recomputed whenever locationId changes (an HQ
  // Admin picking a different station above). Same merge/dedup approach as
  // productOptions above.
  const recordedByOptions = useMemo(() => {
    const seen = new Set(RECORDED_BY_NAME_SEED.map((n) => n.toLowerCase()));
    const extras = getRecordedByNames(locationId).filter((name) => {
      const key = (name || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...RECORDED_BY_NAME_SEED, ...extras];
  }, [locationId]);
  const [recordedByIsCustom, setRecordedByIsCustom] = useState(recordedByOptions.length === 0);
  // Switching location mid-form (Admin only) means the remembered-name list
  // just changed under this field, so re-decide list-vs-typing mode and
  // clear whatever name was picked for the old station — it isn't
  // necessarily anyone at the new one.
  useEffect(() => {
    setRecordedByIsCustom(recordedByOptions.length === 0);
    setRecordedByName("");
  }, [locationId]);

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

  // previousParty above only ever finds someone whose ticket is STILL on
  // the open board (arrived/weighed_in/priced/weighed_out/declined) — the
  // moment a ticket is finished it becomes a transaction and drops off that
  // board entirely, which used to make the "Use previous…" button vanish
  // for Buy far more often than Sell (farmers' tickets tend to get finished
  // same-day; a Sell ticket to a buyer more often sits open for a bit).
  // This fills that gap by asking the server directly for the most recent
  // FINISHED ticket of this type at this location — same shortcut, just
  // covering full history instead of only what's still in progress. It's
  // skipped entirely while offline and bounded to 1.5s, so it never adds
  // any lag; worst case the button just doesn't show.
  const [previousPartyFallback, setPreviousPartyFallback] = useState(null);
  useEffect(() => {
    setPreviousPartyFallback(null);
    if (previousParty || !locationId || !navigator.onLine) return;
    let cancelled = false;
    (async () => {
      const rows = await withTimeout(
        api.getTickets({ locationId, stages: ["finalized"], limit: 20 }).catch(() => null),
        1500,
        null
      );
      if (cancelled || !rows) return;
      const last = rows.find((t) => t.type === type && t.party_name && (t.phone || t.party_id));
      if (!last) return;
      const matchType = type === "BUY" ? "supplier" : "buyer";
      const cachedMatch = getCachedParties().find((p) => p.type === matchType && p.id === last.party_id);
      setPreviousPartyFallback({
        name: last.party_name,
        phone: cachedMatch?.phone || last.phone || "",
        bankName: cachedMatch?.bank_name || last.bank_name || "",
        bankAccount: cachedMatch?.bank_account || last.bank_account || "",
        bankQrUrl: cachedMatch?.bank_qr_url || last.bank_qr_url || null,
      });
    })();
    return () => { cancelled = true; };
  }, [type, locationId, previousParty]);

  const effectivePreviousParty = previousParty || previousPartyFallback;

  function usePreviousParty() {
    if (!effectivePreviousParty) return;
    setPartyName(effectivePreviousParty.name || "");
    setPhone(effectivePreviousParty.phone || "");
    setPhoneLookupMsg(effectivePreviousParty.phone ? `Filled in: ${effectivePreviousParty.name}` : "");
    setSavedBank(
      effectivePreviousParty.bankName || effectivePreviousParty.bankAccount || effectivePreviousParty.bankQrUrl
        ? { bankName: effectivePreviousParty.bankName, bankAccount: effectivePreviousParty.bankAccount, bankQrUrl: effectivePreviousParty.bankQrUrl }
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
  // they already typed. Now asked on both Buy and Sell (per explicit
  // request), and the shared per-location counter (suggestNextPaperTicketNo)
  // is already keyed by location only, not type, so this needed no change
  // beyond dropping the old Buy-only guard.
  useEffect(() => {
    if (locationId && !paperTicketNo) {
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
    // Product is Buy-only here now — a Sell ticket picks its paddy type at
    // Finish Ticket instead, from what's actually in stock at that point
    // (see FinishTicketModal below), since at weigh-in time for a Sell
    // nothing has actually been chosen yet.
    const isBuyTicket = type === "BUY";
    if (!locationId || !partyName.trim() || (isBuyTicket && !productName.trim()) || !vehicleType.trim()) {
      setError(`Please fill in location, party name, ${isBuyTicket ? "product, " : ""}and vehicle type.`);
      return;
    }
    // Truck keeps the original required-plate rule. Koyun/Tractor (and any
    // custom type someone adds later) use a bag count instead, which is
    // optional — a station may just not have counted bags for every load.
    if (vehicleType === "Truck" && !vehicleValue.trim()) {
      setError("Please enter the truck's plate number.");
      return;
    }
    if (!recordedByName.trim()) {
      setError(`Please enter the name of the ${type === "BUY" ? "buyer" : "seller"} filling in this ticket.`);
      return;
    }
    // Now required on both Buy and Sell — the paper quality-ticket booklet
    // number, per explicit request.
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
      // Remember a brand new paddy type on this device so it shows up as
      // its own numbered option next time (see PADDY_TYPE_SEED above) —
      // a no-op if it was already picked from the list.
      if (productIsCustom) addCustomPaddyType(productName);
      // Same for a newly-typed vehicle type and a newly-typed "Buyer"/"Seller" name.
      if (vehicleTypeIsCustom) addCustomVehicleType(vehicleType);
      if (recordedByIsCustom) addRecordedByName(locationId, recordedByName);
      // "Truck: 3A-1890" / "Koyun: 12 bags" / just "Tractor" if no bag
      // count was entered — saved into the ticket's existing car_plate
      // field (see addCustomVehicleType above for why).
      const carPlate = vehicleValue.trim() ? `${vehicleType.trim()}: ${vehicleValue.trim()}` : vehicleType.trim();
      const selectedLocation = locations.find((l) => l.id === locationId);
      const locationName = selectedLocation?.name;
      const ticket = createTicketOffline({
        type, locationId, locationName,
        locationAddress: selectedLocation?.address, locationPhone: selectedLocation?.phone,
        partyId, partyName: partyName.trim(), phone,
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

  const isBuy = type === "BUY";
  // Every color in this form follows the ticket's own direction — green
  // for Buy, rose for Sell — matching the same convention already used
  // for the board cards and the toolbar's + Buy / + Sell buttons. Written
  // out as full literal class strings (not built with string
  // interpolation) so Tailwind's build actually picks both branches up.
  const accent = isBuy
    ? { header: "bg-gradient-to-br from-brand-600 to-brand-700", dot: "bg-brand-600", text: "text-brand-700", focus: "focus:border-brand-600 focus:bg-white focus:ring-4 focus:ring-brand-100" }
    : { header: "bg-gradient-to-br from-rose-600 to-rose-700", dot: "bg-rose-600", text: "text-rose-700", focus: "focus:border-rose-600 focus:bg-white focus:ring-4 focus:ring-rose-100" };
  const fieldCls = `w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-3 text-[15px] font-semibold text-slate-800 outline-none ${accent.focus}`;

  return (
    <Modal
      headerColor={accent.header}
      icon="⚖️"
      title={<>New Ticket — {isBuy ? "Buy" : "Sell"}</>}
      subtitle="Weigh In (Loaded)"
      onClose={onClose} wide
    >
      {isAdmin && (
        <div className="mb-4">
          <label className={labelCls}>Location</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={fieldCls}>
            <option value="">Select location…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}

      <NewTicketSectionHead label="Ticket & Truck" dotClass={accent.dot} textClass={accent.text} />
      <div className="grid grid-cols-2 gap-3.5">
        {/* Now asked on both Buy and Sell, per explicit request — the
            paper quality-ticket booklet number, entered here so it matches
            what staff wrote on the physical slip. */}
        <div>
          <NewTicketFieldLabel icon="🎫" en="Ticket #" km="លេខសំបុត្រ" lang={lang} />
          <input value={paperTicketNo} onChange={(e) => setPaperTicketNo(e.target.value)} className={fieldCls} placeholder="e.g. 092152" />
        </div>
        <div>
          <NewTicketFieldLabel icon="🚚" en="Vehicle" km="យានយន្ត" lang={lang} />
          <div className="grid grid-cols-2 gap-2">
            {vehicleTypeIsCustom ? (
              <div>
                <input
                  autoFocus
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  className={fieldCls}
                  placeholder="New type"
                />
                <button
                  type="button"
                  onClick={() => { setVehicleTypeIsCustom(false); setVehicleType("Truck"); }}
                  className="mt-1 text-xs font-medium text-brand-600 hover:underline"
                >
                  ← Back to list
                </button>
              </div>
            ) : (
              <select
                value={vehicleTypeOptions.includes(vehicleType) ? vehicleType : ""}
                onChange={(e) => {
                  if (e.target.value === "__other__") { setVehicleTypeIsCustom(true); setVehicleType(""); }
                  else setVehicleType(e.target.value);
                }}
                className={fieldCls}
              >
                {vehicleTypeOptions.map((name, i) => <option key={name} value={name}>{i + 1}. {name}</option>)}
                <option value="__other__">+ Add new…</option>
              </select>
            )}
            <input
              value={vehicleValue}
              onChange={(e) => setVehicleValue(e.target.value)}
              className={fieldCls}
              placeholder={vehicleType === "Truck" ? "Plate #" : "Bags (optional)"}
            />
          </div>
        </div>
      </div>

      <NewTicketSectionHead label="People" dotClass={accent.dot} textClass={accent.text} />
      <div className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <NewTicketFieldLabel icon="📞" en="Phone" km="ទូរស័ព្ទ" lang={lang} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={lookupByPhone} className={fieldCls} />
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
          <div className="mb-1.5 flex items-center justify-between">
            <NewTicketFieldLabel icon="🌾" en={isBuy ? "Seller" : "Buyer"} km={isBuy ? "អ្នកលក់" : "អ្នកទិញ"} lang={lang} />
            {effectivePreviousParty && (
              <button
                type="button"
                onClick={usePreviousParty}
                className="mb-1.5 rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
                title={`Fill in name + phone for ${effectivePreviousParty.name}`}
              >
                Use previous {isBuy ? "seller" : "buyer"}: {effectivePreviousParty.name}
              </button>
            )}
          </div>
          <input
            list="new-ticket-party-options"
            value={partyName}
            onChange={(e) => handlePartyNameChange(e.target.value)}
            className={fieldCls}
            placeholder="Type to search or add new"
          />
          <datalist id="new-ticket-party-options">
            {partyOptions.map((name) => <option key={name} value={name} />)}
          </datalist>
        </div>
        {/* Product moved off this form for Sell — a Sell ticket now picks
            its paddy type at Finish Ticket instead, from what's actually in
            stock at that point (see FinishTicketModal). Still asked here
            for Buy, unchanged. */}
        {isBuy && (
          <div>
            <NewTicketFieldLabel icon="🌱" en="Product" km="ផលិតផល" lang={lang} />
            {productIsCustom ? (
              <div>
                <input
                  autoFocus
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className={fieldCls}
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
                className={fieldCls}
              >
                <option value="" disabled>Select paddy type…</option>
                {productOptions.map((name, i) => <option key={name} value={name}>{i + 1}. {name}</option>)}
                <option value="__other__">+ Add new type…</option>
              </select>
            )}
          </div>
        )}
        <div className={isBuy ? "" : "col-span-2"}>
          <NewTicketFieldLabel icon="🧑" en="Driver" km="អ្នកបើកបរ" lang={lang} />
          <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={fieldCls} placeholder="Optional" />
        </div>
        <div className="col-span-2">
          <NewTicketFieldLabel icon="🧾" en={isBuy ? "Buyer (you)" : "Seller (you)"} km={isBuy ? "អ្នកទិញ" : "អ្នកលក់"} lang={lang} />
          {recordedByIsCustom ? (
            <div>
              <input
                autoFocus={recordedByOptions.length > 0}
                value={recordedByName}
                onChange={(e) => setRecordedByName(e.target.value)}
                className={fieldCls}
                placeholder="Your name (whoever is filling in this ticket)"
              />
              {recordedByOptions.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setRecordedByIsCustom(false); setRecordedByName(""); }}
                  className="mt-1 text-xs font-medium text-brand-600 hover:underline"
                >
                  ← Back to list
                </button>
              )}
            </div>
          ) : (
            <select
              value={recordedByOptions.includes(recordedByName) ? recordedByName : ""}
              onChange={(e) => {
                if (e.target.value === "__other__") { setRecordedByIsCustom(true); setRecordedByName(""); }
                else setRecordedByName(e.target.value);
              }}
              className={fieldCls}
            >
              <option value="" disabled>Select your name…</option>
              {recordedByOptions.map((name, i) => <option key={name} value={name}>{i + 1}. {name}</option>)}
              <option value="__other__">+ Add new name…</option>
            </select>
          )}
        </div>
      </div>

      <NewTicketSectionHead label="Weight" dotClass={accent.dot} textClass={accent.text} />
      <div>
        {/* Buy: the truck shows up already loaded with paddy from the
            farmer, so this first weighing is the heavier "gross" number.
            Sell: it's the reverse — the truck shows up empty and only
            gets loaded (for delivery to the buyer) after Finish Ticket,
            so this first weighing is actually the lighter, empty weight.
            The label follows which one is physically true right now. */}
        <WeightField
          locationId={locationId}
          large
          label={isBuy ? "Gross Weight (kg)" : "Weight — empty truck (kg)"}
          labelKm={isBuy ? "ទម្ងន់សរុប (គីឡូក្រាម)" : "ទម្ងន់ — រថយន្តទទេ (គីឡូក្រាម)"}
          value={grossWeight}
          onChange={setGrossWeight}
          isAdmin={isAdmin}
        />
      </div>

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel<span className="font-khmer block text-xs">បោះបង់</span></button>
        <button disabled={saving} onClick={submit} className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${isBuy ? "bg-brand-600 hover:bg-brand-700" : "bg-rose-600 hover:bg-rose-700"}`}>
          {saving ? "Saving…" : (<>Save & Print Weigh-In Slip<span className="font-khmer block text-xs font-normal text-white/85">រក្សាទុក និង បោះពុម្ពសំបុត្រថ្លឹង</span></>)}
        </button>
      </div>
    </Modal>
  );
}

// ---- Edit Ticket (fix a mistake on an already-created, still-open ticket — plate typo, wrong product, a re-weigh, etc.) ----
// Deliberately does NOT touch `stage` — this only corrects the ticket's
// own details, it never moves the ticket forward through the board (that's
// still only Finish Ticket / Decline). Available to any station staff, same
// as creating the ticket in the first place — not gated to Admin, except
// for the weight field's own existing anti-fraud rule (see WeightField.jsx:
// only Admin/Owner can type a weight in by hand; everyone else can only
// re-capture it live off the scale, exactly like at weigh-in).
function EditTicketModal({ ticket, isAdmin, onClose, onSaved }) {
  const isBuy = ticket.type === "BUY";
  const [partyName, setPartyName] = useState(ticket.party_name || "");
  const [phone, setPhone] = useState(ticket.phone || "");
  const [carPlate, setCarPlate] = useState(ticket.car_plate || "");
  const [driverName, setDriverName] = useState(ticket.driver_name || "");
  const [productName, setProductName] = useState(ticket.product_name || "");
  const [paperTicketNo, setPaperTicketNo] = useState(ticket.paper_ticket_no || "");
  const [grossWeight, setGrossWeight] = useState(ticket.gross_kg != null ? String(ticket.gross_kg) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { session } = useAuth();

  // Same seed-list + "whatever's been typed on this device before" approach
  // as NewTicketModal, plus the ticket's own current product tacked on if
  // it isn't already one of those — otherwise the dropdown would open with
  // nothing selected even though the ticket clearly has a product on it.
  const [productOptions] = useState(() => {
    const seen = new Set(PADDY_TYPE_SEED.map((n) => n.toLowerCase()));
    const extras = getCustomPaddyTypes().filter((name) => {
      const key = (name || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const all = [...PADDY_TYPE_SEED, ...extras];
    const current = (ticket.product_name || "").trim();
    if (current && !all.some((n) => n.toLowerCase() === current.toLowerCase())) all.push(current);
    return all;
  });
  const [productIsCustom, setProductIsCustom] = useState(() => !productOptions.includes((ticket.product_name || "").trim()));

  const partyOptions = useMemo(() => {
    const matchType = isBuy ? "supplier" : "buyer";
    const names = getCachedParties()
      .filter((p) => p.type === matchType && (!ticket.location_id || p.location_id === ticket.location_id) && (p.name || "").trim())
      .map((p) => p.name.trim());
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!partyName.trim() || !productName.trim() || !carPlate.trim()) {
      setError("Please fill in party name, product, and plate number.");
      return;
    }
    if (isBuy && !paperTicketNo.trim()) {
      setError("Please enter the number printed on the paper quality ticket.");
      return;
    }
    const kg = grossWeight === "" ? null : parseFloat(grossWeight);
    if (grossWeight !== "" && (!kg || kg <= 0)) {
      setError("Gross weight must be a positive number.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const partyId = await resolvePartyIdOffline(partyName, isBuy ? "supplier" : "buyer", ticket.location_id, { phone });
      const productId = await resolveProductIdOffline(productName);
      if (productIsCustom) addCustomPaddyType(productName);
      const updated = editTicketOffline(ticket.id, {
        partyId, partyName: partyName.trim(), phone,
        carPlate, driverName, productId, productName: productName.trim(),
        paperTicketNo: paperTicketNo.trim(),
        grossKg: kg,
        userId: session.user.id,
      });
      onSaved(updated);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={<>Edit Ticket {ticket.code}<span className="font-khmer block text-sm font-normal text-slate-500">កែសម្រួលសំបុត្រ {ticket.code}</span></>}
      subtitle={<>Fix a mistake before Finish Ticket — this doesn't move the ticket forward<span className="font-khmer block">កែកំហុសមុននឹងបញ្ចប់សំបុត្រ — វាមិនផ្លាស់ប្តូរដំណាក់កាលសំបុត្រទេ</span></>}
      onClose={onClose} wide
    >
      <div className="grid grid-cols-2 gap-3">
        {isBuy && (
          <div>
            <label className={labelCls}>Quality Ticket No.<span className="font-khmer block text-brand-600">លេខសំបុត្រគុណភាព</span></label>
            <input value={paperTicketNo} onChange={(e) => setPaperTicketNo(e.target.value)} className={inputCls} placeholder="e.g. 092152" />
          </div>
        )}
        <div className={isBuy ? "" : "col-span-2"}><label className={labelCls}>Vehicle Plate Number<span className="font-khmer block text-brand-600">លេខផ្លាកយានយន្ត</span></label><input value={carPlate} onChange={(e) => setCarPlate(e.target.value)} className={inputCls} /></div>
        <div className="col-span-2">
          <label className={labelCls}>Phone<span className="font-khmer block text-brand-600">លេខទូរស័ព្ទ</span></label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>
            {isBuy ? "Seller (Farmer) Name" : "Buyer Name"}
            <span className="font-khmer block text-brand-600">{isBuy ? "ឈ្មោះអ្នកលក់ (កសិករ)" : "ឈ្មោះអ្នកទិញ"}</span>
          </label>
          <input list="edit-ticket-party-options" value={partyName} onChange={(e) => setPartyName(e.target.value)} className={inputCls} />
          <datalist id="edit-ticket-party-options">
            {partyOptions.map((name) => <option key={name} value={name} />)}
          </datalist>
        </div>
        <div>
          <label className={labelCls}>Product (paddy type)<span className="font-khmer block text-brand-600">ផលិតផល (ប្រភេទស្រូវ)</span></label>
          {productIsCustom ? (
            <div>
              <input autoFocus value={productName} onChange={(e) => setProductName(e.target.value)} className={inputCls} placeholder="Type the paddy type" />
              <button type="button" onClick={() => setProductIsCustom(false)} className="mt-1 text-xs font-medium text-brand-600 hover:underline">← Back to list</button>
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
        </div>
        <div><label className={labelCls}>Driver Name<span className="font-khmer block text-brand-600">ឈ្មោះអ្នកបើកបរ</span></label><input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inputCls} placeholder="optional" /></div>
      </div>

      <div className="mt-4">
        <WeightField
          locationId={ticket.location_id}
          label={isBuy ? "Gross Weight — loaded truck (kg)" : "Weight — empty truck (kg)"}
          labelKm={isBuy ? "ទម្ងន់សរុប — រថយន្តដឹកទំនិញ (គីឡូក្រាម)" : "ទម្ងន់ — រថយន្តទទេ (គីឡូក្រាម)"}
          value={grossWeight}
          onChange={setGrossWeight}
          isAdmin={isAdmin}
        />
        <p className="mt-1 text-[11px] text-slate-400">To fix a wrong weight, put the truck back on the scale and press "Capture This Weight" again.</p>
      </div>

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel<span className="font-khmer block text-xs">បោះបង់</span></button>
        <button disabled={saving} onClick={submit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">
          {saving ? "Saving…" : (<>Save Changes<span className="font-khmer block text-xs font-normal text-emerald-100">រក្សាទុកការផ្លាស់ប្តូរ</span></>)}
        </button>
      </div>
    </Modal>
  );
}

// ---- Finish Ticket (combined — price + quality, weigh out, and finalize into a receipt, all in one screen) ----

function FinishTicketModal({ ticket, onClose, onFinalized, onDeclined, isAdmin }) {
  const isBuy = ticket.type === "BUY";
  // Khmer translation pass — this form had none at all until now (see the
  // section-30d note on why it was deliberately skipped back then: the
  // Quality/Moisture/Mixture/Outthrow fields that used to live here were
  // real industry terms not worth guessing at). Those fields were removed
  // in section 30e/30f, so what's left (price, payment, weight, paddy
  // type) is ordinary business vocabulary — translated here reusing the
  // exact same terms already shipped elsewhere in the app (i18n.jsx's
  // price_per_kg/net_weight/bank_name/bank_account/quality_grade/cancel
  // keys, and New Ticket's own "ផលិតផល"/"empty truck"/"loaded truck"
  // wording) rather than inventing new ones, so nothing here contradicts
  // what staff already read on the New Ticket form or a printed receipt.
  const { lang } = useLanguage();
  // Sell only — the paddy type being sold is now picked here instead of at
  // New Ticket (see NewTicketModal's own comment on this), since a Sell
  // draws from stock rather than creating it, so it makes more sense to
  // choose once it's actually known what's on hand. Falls back to the same
  // growable local list New Ticket/Edit Ticket use if nothing loads.
  const [productName, setProductName] = useState(ticket.product_name || "");
  const [productIsCustom, setProductIsCustom] = useState(false);
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
  // null = still loading; [] = loaded, nothing currently in stock at this
  // station (falls back to productOptions above, with a warning shown).
  const [inStockProducts, setInStockProducts] = useState(null);
  const [qualityGrade, setQualityGrade] = useState("");
  const [moisturePct, setMoisturePct] = useState("");
  const [mixturePct, setMixturePct] = useState("");
  const [outthrowPct, setOutthrowPct] = useState("");
  const [deductionKg, setDeductionKg] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  // Sell only — paddy sometimes goes out to Baitang or another outside
  // buyer before a price has been agreed at all (not just "not typed in
  // yet"). Checking this is the explicit way to say that, instead of
  // relying on staff just leaving the box empty — it also blanks/locks the
  // price field so nobody accidentally types a placeholder number in.
  const [priceNotGiven, setPriceNotGiven] = useState(false);
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

  // Sell only — replays this location's real Buy/Sell transaction history
  // to work out which paddy types actually have stock left, same math
  // Stock Inventory's own "Stock by Paddy Type" breakdown uses (net
  // payable weight: +Buy, -Sell, cancelled transactions excluded), so the
  // dropdown below always agrees with what Stock Inventory would show.
  // Falls back to an empty list (not an error) on any failure or timeout —
  // the field then falls back to the full paddy-type list, with a
  // warning, rather than silently blocking a real sale.
  useEffect(() => {
    if (isBuy) return;
    let cancelled = false;
    (async () => {
      const txs = await withTimeout(
        api.getTransactions({ locationId: ticket.location_id }).catch(() => null),
        STOCK_LOOKUP_TIMEOUT_MS,
        null
      );
      if (cancelled) return;
      if (!txs) { setInStockProducts([]); return; }
      const stockByProduct = {};
      for (const tx of txs) {
        if (!tx.product_id) continue;
        if ((tx.hq_status || "processing") === "cancelled") continue;
        const payable = Math.max(0, Number(tx.quantity_kg || 0) - Number(tx.deduction_kg || 0));
        const delta = tx.type === "BUY" ? payable : -payable;
        if (!stockByProduct[tx.product_id]) stockByProduct[tx.product_id] = { kg: 0, name: tx.productName || "—" };
        stockByProduct[tx.product_id].kg += delta;
      }
      const inStock = Object.entries(stockByProduct)
        .map(([id, v]) => ({ id, name: v.name, kg: v.kg }))
        .filter((p) => p.kg > 0.5) // small threshold — ignores rounding dust, not a real remaining amount
        .sort((a, b) => b.kg - a.kg);
      setInStockProducts(inStock);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.location_id, isBuy]);

  // Buy: paddy weight is In minus Out (arrives loaded, leaves empty).
  // Sell: it's Out minus In (arrives empty, leaves loaded for delivery).
  const netKg = Math.max(0, isBuy
    ? (ticket.gross_kg || 0) - (parseFloat(tareWeight) || 0)
    : (parseFloat(tareWeight) || 0) - (ticket.gross_kg || 0));
  const payableKg = Math.max(0, netKg - (parseFloat(deductionKg) || 0));
  const staffFeeAmt = isBuy ? (parseFloat(staffFee) || 0) : 0;
  const subtotal = Math.max(0, payableKg * (priceNotGiven ? 0 : (parseFloat(pricePerKg) || 0)) - staffFeeAmt);
  const taxAmount = taxApplicable ? Math.round(subtotal * (parseFloat(taxRate) || 0)) / 100 : 0;
  const total = subtotal + taxAmount;

  async function submitDecline() {
    setSaving(true);
    try {
      setTicketPriceOffline(ticket.id, { priceNote: priceNote || (isBuy ? "Not buying" : "Not selling"), userId: session.user.id, decline: true });
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
    // Sell only — New Ticket no longer asks for the paddy type (see
    // NewTicketModal), so it has to be chosen here before a sale can
    // actually finish.
    if (!isBuy && !productName.trim()) { setError("Please select which paddy type is being sold."); return; }
    if (!tareKg || tareKg <= 0) { setError(isBuy ? "Please enter the empty truck's weight." : "Please enter the loaded truck's weight."); return; }
    // Photo of the paper ticket is off while testing — no camera on this
    // computer yet. Re-add this check once photos are actually possible.
    setError("");
    setSaving(true);
    try {
      // Sell only — save the chosen paddy type onto the ticket first (via
      // the same editTicketOffline path Edit Ticket uses for a plate/name
      // correction), so it's already there by the time finalizeTicketOffline
      // below builds the real transaction from the ticket's own fields.
      if (!isBuy) {
        const productId = await resolveProductIdOffline(productName);
        if (productIsCustom) addCustomPaddyType(productName);
        editTicketOffline(ticket.id, { productId, productName: productName.trim(), userId: session.user.id });
      }
      const finalBankQrUrl = isBuy && bankName && bankName !== "Cash" ? bankQrUrl : null;
      // Buy always has a real number here (required above). Sell stores
      // an actual null — not 0 — whenever the price isn't settled yet
      // (either the checkbox was ticked, or the field was just left
      // blank), so the receipt and every report can tell "no price yet"
      // apart from "genuinely priced at 0" and the amount doesn't print
      // as a fake ៛0.
      const finalPricePerKg = isBuy
        ? (parseFloat(pricePerKg) || 0)
        : (priceNotGiven || pricePerKg === "" ? null : (parseFloat(pricePerKg) || 0));
      setTicketPriceOffline(ticket.id, {
        qualityGrade, moisturePct: parseFloat(moisturePct) || 0, mixturePct: parseFloat(mixturePct) || 0,
        outthrowPct: parseFloat(outthrowPct) || 0, deductionKg: parseFloat(deductionKg) || 0,
        pricePerKg: finalPricePerKg, staffFee: parseFloat(staffFee) || 0,
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
      const tx = await finalizeTicketOffline(tareUpdated, { userId: session.user.id, receiptPhotoUrl });
      // Same reasoning as the manual Buy/Sell form (TransactionForm.jsx):
      // every new transaction should show up in the Activity Log, including
      // the original entry, not just later edits. This path (finalizing a
      // Weighing Ticket) never logged this at all before — found while
      // investigating a missing receipt, where it meant the Activity Log had
      // no record of any ticket-based transaction ever being created.
      logAuditOffline({
        action: "create_transaction",
        tableName: "transactions",
        recordId: tx.id,
        newData: {
          code: tx.code, type: tx.type, partyName: tx.partyName, quantityKg: tx.quantity_kg,
          pricePerKg: tx.price_per_kg, amount: tx.amount, stationName: tx.stationName, txDate: tx.tx_date,
        },
        userId: session.user.id,
      });
      onFinalized(tx);
    } catch (err) {
      // [2026-08-30] finalizeTicketOffline now throws instead of silently
      // proceeding when it can't durably save this device's copy of the
      // finalize, or can't confirm within FINISH_SYNC_TIMEOUT_MS that it
      // reached the shared database — see the 2026-08-30 audit, Part 0.
      // Before this, nothing here caught that (there was no catch at all),
      // so onFinalized(tx) never even ran, but no error ever reached the
      // person waiting either — they'd have no reason to know Finish
      // Ticket hadn't actually completed. Showing the message here means
      // an ungenerated receipt is now visible and actionable instead of
      // just as though the button never worked.
      setError(err.message || "Something went wrong finishing this ticket. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Same accent system as the New Ticket redesign — green for Buy, rose
  // for Sell, matching the board cards and toolbar. Written as full
  // literal class strings (not interpolated) so Tailwind's build picks
  // both branches up regardless of which one renders at runtime.
  const accent = isBuy
    ? { header: "bg-gradient-to-br from-brand-600 to-brand-700", circle: "bg-brand-600", priceBox: "border-brand-200 bg-brand-50", priceLabel: "text-brand-800", priceInput: "border-brand-300 focus:border-brand-500 focus:ring-brand-100", total: "text-brand-700", saveBtn: "bg-brand-600 hover:bg-brand-700" }
    : { header: "bg-gradient-to-br from-rose-600 to-rose-700", circle: "bg-rose-600", priceBox: "border-rose-200 bg-rose-50", priceLabel: "text-rose-800", priceInput: "border-rose-300 focus:border-rose-500 focus:ring-rose-100", total: "text-rose-700", saveBtn: "bg-rose-600 hover:bg-rose-700" };
  // Bolder, more visible boxes — same look as the New Ticket redesign.
  // Local to this modal only (module-level inputCls/labelCls are shared
  // by several other modals in this file and are left untouched).
  const fieldCls = "w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800 outline-none focus:border-brand-600 focus:bg-white focus:ring-4 focus:ring-brand-100";
  const fieldLabelCls = "mb-1 block text-xs font-semibold text-slate-600";

  return (
    <Modal
      headerColor={accent.header}
      icon="🏁"
      title={`Finish Ticket ${ticket.code}`}
      subtitle={`${ticket.party_name} · ${ticket.car_plate} · ${isBuy ? "Gross" : "Weighed in"}: ${fmt2(ticket.gross_kg)} kg (weighed in earlier)`}
      onClose={onClose} wide
    >
      {/* Reordered per explicit request: Price first, Payment second, the
          Weigh Out/scale step last. Quality and Note & Proof are removed
          from this form for now (not deleted — see the state variables
          and submitFinish() above/below, still fully wired) since staff
          have never actually been filling them in; easy to bring back if
          that changes. Sell also gets a new first step, Paddy Type, since
          Product moved here from New Ticket (see NewTicketModal). Numbering
          below reflects this actual order, not the original 1–5. */}

      {/* Sell only, step 1 — Product moved here from New Ticket, since a
          Sell is drawing from stock rather than creating it, so this is
          the point where it's actually known what's being sold. Lists
          only paddy types with real stock left at this station (computed
          from real transaction history — see the effect above), with each
          option showing how much is on hand. Falls back to the full
          paddy-type list (with a warning) if nothing is currently in
          stock, so a real sale is never blocked by a bookkeeping gap. */}
      {!isBuy && (
        <div className="mb-5">
          <SectionHeader num={1} accentBg={accent.circle} title="Paddy Type" titleKm="ប្រភេទស្រូវ" lang={lang} hint={`Which paddy from stock at this station is being sold to ${ticket.party_name || "the buyer"}`} />
          <div className="rounded-lg border border-slate-200 p-4">
            {productIsCustom ? (
              <div>
                <NewTicketFieldLabel icon="🌱" en="Paddy Type" km="ផលិតផល" lang={lang} />
                <input autoFocus value={productName} onChange={(e) => setProductName(e.target.value)} className={fieldCls} placeholder="Type the paddy type" />
                <button type="button" onClick={() => { setProductIsCustom(false); setProductName(""); }} className="mt-1 text-xs font-medium text-rose-600 hover:underline">
                  ← Back to list
                </button>
              </div>
            ) : inStockProducts === null ? (
              <div>
                <NewTicketFieldLabel icon="🌱" en="Paddy Type" km="ផលិតផល" lang={lang} />
                <select disabled className={fieldCls}><option>Loading what's in stock…</option></select>
              </div>
            ) : inStockProducts.length > 0 ? (
              <div>
                <NewTicketFieldLabel icon="🌱" en="Product — only what's currently in stock here" km="ផលិតផល" lang={lang} />
                <select
                  value={inStockProducts.some((p) => p.name === productName) ? productName : ""}
                  onChange={(e) => {
                    if (e.target.value === "__other__") { setProductIsCustom(true); setProductName(""); }
                    else setProductName(e.target.value);
                  }}
                  className={fieldCls}
                >
                  <option value="" disabled>Select from what's in stock…</option>
                  {inStockProducts.map((p) => <option key={p.id} value={p.name}>{p.name} — {fmt2(p.kg)} kg in stock</option>)}
                  <option value="__other__">Something else / not listed…</option>
                </select>
              </div>
            ) : (
              <div>
                <NewTicketFieldLabel icon="🌱" en="Product" km="ផលិតផល" lang={lang} />
                <p className="mb-2 text-xs font-medium text-amber-600">No recorded stock at this station right now — showing every paddy type instead.</p>
                <select
                  value={productOptions.includes(productName) ? productName : ""}
                  onChange={(e) => {
                    if (e.target.value === "__other__") { setProductIsCustom(true); setProductName(""); }
                    else setProductName(e.target.value);
                  }}
                  className={fieldCls}
                >
                  <option value="" disabled>Select paddy type…</option>
                  {productOptions.map((name, i) => <option key={name} value={name}>{i + 1}. {name}</option>)}
                  <option value="__other__">+ Add new type…</option>
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Price & Total — everything that feeds the amount owed, with the running total right below it. Net/Payable Weight here depend on the tare weight captured in the Weigh Out step below — until that's filled in, this reads 0 kg, then updates live once it's captured (no need to scroll back up). */}
      <div className="mb-5">
        <SectionHeader num={isBuy ? 1 : 2} accentBg={accent.circle} title="Price & Total" titleKm="តម្លៃ និងចំនួនសរុប" lang={lang} hint={isBuy ? "What this truckload is worth" : "Leave blank if the price isn't settled with the buyer yet — it can be added later from Transactions"} />
        <div className={`rounded-lg border-2 p-4 ${accent.priceBox}`}>
          <label className={`mb-1 block text-sm font-semibold ${accent.priceLabel}`}>
            {isBuy ? "Price per kg (Riel) — the price agreed on the paper ticket" : "Price per kg (Riel) — optional, if already agreed"}
            <span className="font-khmer block font-normal">តម្លៃក្នុងមួយ KG (រៀល)</span>
          </label>
          <input type="number" min="0" step="1" value={pricePerKg} disabled={!isBuy && priceNotGiven}
            onChange={(e) => setPricePerKg(e.target.value)} placeholder={isBuy ? "e.g. 1090" : "leave blank if not decided yet"}
            className={`w-full rounded-lg border bg-white px-3 py-3 text-lg font-semibold outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${accent.priceInput}`} />
          {!isBuy && (
            <label className={`mt-2 flex items-center gap-2 text-xs font-medium ${accent.priceLabel}`}>
              <input type="checkbox" checked={priceNotGiven}
                onChange={(e) => { setPriceNotGiven(e.target.checked); if (e.target.checked) setPricePerKg(""); }} />
              <span>Price not given yet — sending out to Baitang / another buyer for pricing<span className="font-khmer block font-normal">តម្លៃមិនទាន់សម្រេច — ផ្ញើទៅលក់ទីផ្សារក្រៅ</span></span>
            </label>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {isBuy && (
            <div><NewTicketFieldLabel icon="💰" en="Staff / Carrying Fee (optional)" km="ថ្លៃសេវា (ស្រេចចិត្ត)" lang={lang} /><input type="number" value={staffFee} onChange={(e) => setStaffFee(e.target.value)} className={fieldCls} /></div>
          )}
          <div>
            <NewTicketFieldLabel icon="⭐" en="Paddy Quality (optional)" km="ថ្នាក់គុណភាព (ស្រេចចិត្ត)" lang={lang} />
            <select value={qualityGrade} onChange={(e) => setQualityGrade(e.target.value)} className={fieldCls}>
              <option value="">Not set</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. Payment Method — decided after the total is known */}
      <div className="mb-5">
        <SectionHeader num={isBuy ? 2 : 3} accentBg={accent.circle} title="Payment Method" titleKm="វិធីទូទាត់" lang={lang} hint={`How ${ticket.party_name || "this farmer"} will be paid`} />
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <NewTicketFieldLabel icon="🏦" en="Bank (or Cash)" km="ធនាគារ (ឬសាច់ប្រាក់)" lang={lang} />
              <select
                value={bankIsOther ? "__other__" : bankName}
                onChange={(e) => {
                  if (e.target.value === "__other__") { setBankIsOther(true); setBankName(""); }
                  else { setBankIsOther(false); setBankName(e.target.value); }
                }}
                className={fieldCls}
              >
                <option value="" disabled>Select payment method / bank</option>
                {BANK_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                <option value="__other__">Other...</option>
              </select>
              {bankIsOther && (
                <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Type bank name" className={`${fieldCls} mt-2`} />
              )}
            </div>
            <div><NewTicketFieldLabel icon="🔢" en="Bank Account" km="លេខគណនីធនាគារ" lang={lang} /><input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={fieldCls} /></div>
          </div>
          {isBuy && bankName && bankName !== "Cash" && (
            <div className="mt-3">
              <PhotoUpload
                label={<>Bank QR Code (photo) <span className="font-khmer">លេខកូដ QR ធនាគារ (រូបថត)</span></>}
                kind="party-bank-qr"
                url={bankQrUrl}
                onUploaded={setBankQrUrl}
                hint="Take a photo of the farmer's bank QR code so payment can be sent straight from the receipt"
              />
            </div>
          )}
        </div>
      </div>

      {/* 3. Weigh Out — the physical action happening right now. Buy: the
          truck is empty now, having dropped off its paddy. Sell: it's the
          opposite — the truck was empty at weigh-in and is now loaded up
          for delivery to the buyer. Moved to last per explicit request. */}
      <div className="mb-1">
        <SectionHeader num={isBuy ? 3 : 4} accentBg={accent.circle} title="Weigh Out" titleKm="ថ្លឹងទម្ងន់ចេញ" lang={lang} hint={isBuy ? "The truck is empty and on the scale right now" : "The truck is now loaded and on the scale right now"} />
        <WeightField
          locationId={ticket.location_id}
          large
          label={isBuy ? "Tare Weight — empty truck (kg)" : "Weight — loaded truck (kg)"}
          labelKm={isBuy ? "ទម្ងន់ — រថយន្តទទេ (គីឡូក្រាម)" : "ទម្ងន់ — រថយន្តដឹកទំនិញ (គីឡូក្រាម)"}
          scaleLabel={isBuy ? "Live Scale Weight (empty truck)" : "Live Scale Weight (loaded truck)"}
          value={tareWeight}
          onChange={setTareWeight}
          isAdmin={isAdmin}
        />
      </div>

      {/* Net Weight / Total summary — moved here (after Weigh Out) per
          explicit request: the net weight isn't actually known until the
          truck's final weight is captured above, so showing it here reads
          more naturally than sitting above the scale step. */}
      <div className="mt-4 space-y-1.5 rounded-lg bg-slate-50 p-4 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Net Weight <span className="font-khmer">ទម្ងន់សុទ្ធ</span></span><span className="font-medium">{fmt2(netKg)} kg</span></div>
        {(parseFloat(deductionKg) || 0) > 0 && <div className="flex justify-between"><span className="text-slate-500">Payable Weight <span className="font-khmer">ទម្ងន់ត្រូវទូទាត់</span></span><span className="font-medium">{fmt2(payableKg)} kg</span></div>}
        <div className="flex justify-between border-t border-slate-200 pt-1.5">
          <span className="font-semibold text-slate-700">Total <span className="font-khmer">សរុប</span></span>
          {!isBuy && priceNotGiven ? (
            <span className="font-bold text-amber-600">Price pending <span className="font-khmer">កំពុងរង់ចាំតម្លៃ</span></span>
          ) : (
            <span className={`font-bold ${accent.total}`}>{fmtRiel(total)}</span>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-between gap-2">
        <button onClick={submitDecline} disabled={saving} className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40">
          {/* Wording follows the ticket's own direction now — "Not Buying"
              only made sense for Buy tickets; a Sell ticket that isn't
              going through says "Not Selling" instead. This is a small,
              clearly-correct fix alongside the visual pass, not something
              separately asked for — flagged to the user. */}
          <Ban size={14} /> {isBuy ? "Not Buying" : "Not Selling"} <span className="font-khmer">{isBuy ? "មិនទិញ" : "មិនលក់"}</span>
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel <span className="font-khmer">បោះបង់</span></button>
          <button disabled={saving} onClick={submitFinish} className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${accent.saveBtn}`}>
            <Check size={14} /> {saving ? <>Saving… <span className="font-khmer">កំពុងរក្សាទុក…</span></> : <>Save, Print &amp; Finalize <span className="font-khmer">រក្សាទុក បោះពុម្ព និងបញ្ចប់</span></>}
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

// ---- Confirm-the-truck step, before Finish Ticket's long form opens ------
//
// Added after staff finished a few tickets against the wrong truck — with
// several trucks in progress at once, it's easy to tap "Finish Ticket" on
// the wrong card in a busy list. This one glance, big-text check happens
// BEFORE any weighing/pricing is typed in, right where the wrong pick
// actually happens, instead of only being discoverable afterward.
function ConfirmFinishModal({ ticket, onClose, onConfirm }) {
  return (
    <Modal title="Confirm the truck" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-500">Double-check this matches the truck on the scale right now before continuing.</p>
      <div className="mb-5 rounded-lg border-2 border-brand-200 bg-brand-50 p-4 text-center">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${ticket.type === "BUY" ? "bg-brand-100 text-brand-700" : "bg-rose-100 text-rose-700"}`}>
          {ticket.type === "BUY" ? "▲ BUY" : "▼ SELL"}
        </span>
        <p className="mt-2 text-2xl font-bold text-slate-800">{ticket.car_plate || "No plate on file"}</p>
        <p className="mt-1 text-lg font-medium text-slate-700">{ticket.party_name}</p>
        <p className="text-sm text-slate-500">{ticket.product_name} · Ticket {ticket.code}{ticket.paper_ticket_no ? ` · Quality Ticket No. ${ticket.paper_ticket_no}` : ""}</p>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">This isn't it — cancel</button>
        <button onClick={onConfirm} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Yes, this is the right truck <ArrowRight size={14} />
        </button>
      </div>
    </Modal>
  );
}

// ---- Reopen a mistakenly-finished ticket (HQ Admin only) -----------------
//
// For when Finish Ticket already happened against the wrong ticket and the
// receipt already printed. Cancels the transaction it created (same
// hq_status flag already used elsewhere to keep bad transactions out of
// reports/the ledger) and sends the ticket back to the waiting queue,
// keeping only its original weigh-in, so it can be finished again against
// the right truck. See api.js's reopenTicket for exactly what's reset.
function ReopenTicketModal({ ticket, onClose, onReopened }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { session } = useAuth();

  async function submit() {
    if (!reason.trim()) { setError("Please note why this ticket is being reopened — it's kept in the audit log."); return; }
    setError("");
    setSaving(true);
    try {
      await api.reopenTicket(ticket.id, { userId: session.user.id, reason: reason.trim() });
      onReopened();
    } catch (e) {
      setError(e.message || "Couldn't reopen this ticket — check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Reopen Ticket ${ticket.code}`} subtitle={`${ticket.party_name} · ${ticket.car_plate}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">
        Use this when Finish Ticket was completed against the wrong truck. This cancels the transaction
        it created — {ticket.code} will no longer count in reports or the ledger export — and puts the
        ticket back in the waiting queue with only its original weigh-in kept, ready to be finished again.
      </p>
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
        If a receipt from this ticket was already printed and handed over, this can't recall it — void or staple that paper copy by hand.
      </div>
      <label className={labelCls}>Reason (required)</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
        placeholder="e.g. Finished against the wrong ticket — this was actually truck 3A-1205"
        className={`${inputCls} resize-none`} />
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
        <button disabled={saving} onClick={submit} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-40">
          {saving ? "Reopening…" : "Reopen Ticket"}
        </button>
      </div>
    </Modal>
  );
}

// ---- Interim slip (printed at weigh-in, mirrors the paper queue ticket) ------

// Final approved design [2026-08-25]: bordered/lines-only monochrome layout
// (no fills — safe for the dot-matrix printer), logo + per-location
// address/phone header, doc-type badge with ticket/truck number, dotted
// field grid, bordered weight table, Quality + Price&Payment cards side by
// side (QR built into the payment card), bold bordered Total Amount band,
// and generous signature space. Verified against a real print-height
// render at 131mm of the 140mm physical form — 9mm safety margin.
// Print sizing/positioning lives in index.css under #ticket-slip-root.
// Shares the exact layout approved for Receipt.jsx (see Receipt.jsx) so a
// Weigh-In Slip and the final Receipt read as the same document family.
function TicketSlip({ ticket, onClose }) {
  const [settings, setSettings] = useState({});
  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  const isBuy = ticket.type === "BUY";

  // Buy: In minus Out. Sell: Out minus In (see NewTicketModal/
  // FinishTicketModal above for why the two are reversed).
  const netKg = ticket.gross_kg != null && ticket.tare_kg != null
    ? Math.max(0, isBuy ? ticket.gross_kg - ticket.tare_kg : ticket.tare_kg - ticket.gross_kg)
    : null;
  const inStamp = splitCambodiaTimestamp(ticket.gross_at);
  const outStamp = splitCambodiaTimestamp(ticket.tare_at);

  // Same Buy/Sell role convention approved for the printed documents:
  // Buy (Import) — the party is the Seller (farmer), staff is the Buyer.
  // Sell (Export) — the party is the Buyer (customer), staff is the Seller.
  const partyLabelKh = isBuy ? "អ្នកលក់" : "អ្នកទិញ";
  const partyLabelEn = isBuy ? "Seller" : "Buyer";
  const staffLabelKh = isBuy ? "អ្នកទិញ" : "អ្នកលក់";
  const staffLabelEn = isBuy ? "Buyer (staff)" : "Seller (staff)";

  const payableKg = netKg != null ? Math.max(0, netKg - (ticket.deduction_kg || 0)) : null;
  const totalAmount = payableKg != null && ticket.price_per_kg != null
    ? Math.max(0, payableKg * ticket.price_per_kg - (isBuy ? (ticket.staff_fee || 0) : 0))
    : null;

  // DD-MM-YYYY, Cambodia calendar date — matches the approved numeric-only
  // date format (no month names) used throughout the printed documents.
  function ddmmyyyy(dateStr) {
    if (!dateStr) return "—";
    const [y, m, d] = dateStr.split("-");
    return `${d}-${m}-${y}`;
  }

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

        <div id="ticket-slip-root">
          <div className="head">
            <img className="head-logo" src="/logo-paitong.png" alt="Company logo" />
            <div className="head-mid">
              <div className="co-address">{ticket.stationAddress || settings.company_address || "—"}</div>
              <div className="co-phone">Tel: {ticket.stationPhone || settings.company_phone || "—"}</div>
            </div>
            <div className="head-right">
              <span className="doc-type">Weight Ticket — {isBuy ? "Import" : "Export"}</span>
              <div className="doc-no">No. {ticket.code}</div>
              {/* No "Truck No." label here on purpose — car_plate can now
                  read "Truck: 3A-1890" or "Koyun: 12 bags" etc. (see
                  addCustomVehicleType above), and it already names the
                  vehicle type itself, so a static "Truck No." prefix
                  would be wrong/redundant for anything but a truck. */}
              <div className="doc-sub">{ticket.car_plate || "—"}</div>
            </div>
          </div>

          <div className="fields">
            <div className="field"><span className="lbl"><span className="kh">ទំនិញ</span><span className="en">Product</span></span><span className="val">{ticket.product_name || "—"}</span></div>
            <div className="field"><span className="lbl"><span className="kh">ថ្ងៃ</span><span className="en">Date</span></span><span className="val">{ddmmyyyy(ticket.gross_at ? ticket.gross_at.slice(0, 10) : null)}</span></div>
            <div className="field"><span className="lbl"><span className="kh">{partyLabelKh}</span><span className="en">{partyLabelEn}</span></span><span className="val">{ticket.party_name}{ticket.phone ? ` · ${ticket.phone}` : ""}</span></div>
            <div className="field"><span className="lbl"><span className="kh">អ្នកបើកបរ</span><span className="en">Driver</span></span><span className="val">{ticket.driver_name || "—"}</span></div>
            <div className="field"><span className="lbl"><span className="kh">លេខសំបុត្រ</span><span className="en">Ticket No.</span></span><span className="val">{ticket.paper_ticket_no || "—"}</span></div>
            <div className="field"><span className="lbl"><span className="kh">{staffLabelKh}</span><span className="en">{staffLabelEn}</span></span><span className="val">{ticket.recorded_by_name || "—"}</span></div>
          </div>

          <table className="weights">
            <thead>
              <tr>
                <th><span className="kh">ចូល/ចេញ</span><span className="en">Item</span></th>
                <th><span className="kh">ថ្ងៃ</span><span className="en">Date</span></th>
                <th><span className="kh">ពេលវេលា</span><span className="en">Time</span></th>
                <th className="num"><span className="kh">ទម្ងន់</span><span className="en">Weight</span></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>ចូល IN</td>
                <td>{ddmmyyyy(ticket.gross_at ? ticket.gross_at.slice(0, 10) : null)}</td>
                <td>{inStamp.time}</td>
                <td className="num">{ticket.gross_kg != null ? `${fmt2(ticket.gross_kg)} kg` : "—"}</td>
              </tr>
              {ticket.tare_kg != null && (
                <tr>
                  <td>ចេញ OUT</td>
                  <td>{ddmmyyyy(ticket.tare_at ? ticket.tare_at.slice(0, 10) : null)}</td>
                  <td>{outStamp.time}</td>
                  <td className="num">{fmt2(ticket.tare_kg)} kg</td>
                </tr>
              )}
              {netKg != null && (
                <tr className="net">
                  <td colSpan={3}>ទម្ងន់សុទ្ធ Net Weight</td>
                  <td className="num">{fmt2(netKg)} kg</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="cards">
            <div className="card quality">
              <div className="card-h">គុណភាព · Quality</div>
              <div className="row"><span className="k">Grade</span><span className="v">{ticket.quality_grade || "—"}</span></div>
              <div className="row"><span className="k">Moisture</span><span className="v">{fmt2(ticket.moisture_pct)}%</span></div>
              <div className="row"><span className="k">Mixture / Outthrow</span><span className="v">{fmt2(ticket.mixture_pct)}% / {fmt2(ticket.outthrow_pct)}%</span></div>
              <div className="row"><span className="k">Deduction</span><span className="v">{fmt2(ticket.deduction_kg)} kg</span></div>
            </div>
            <div className="card payment">
              <div className="payment-fields">
                <div className="card-h">តម្លៃ និង ការទូទាត់ · Price &amp; Payment</div>
                <div className="row price"><span className="k">Price / kg</span><span className="v">{ticket.price_per_kg != null ? fmtRiel(ticket.price_per_kg) : "—"}</span></div>
                <div className="row"><span className="k">Bank</span><span className="v">{ticket.bank_name || "—"}</span></div>
                {isBuy && <div className="row"><span className="k">Staff Fee</span><span className="v">{ticket.staff_fee ? fmtRiel(ticket.staff_fee) : "—"}</span></div>}
                <div className="row"><span className="k">Account</span><span className="v">{ticket.bank_account || "—"}</span></div>
              </div>
              <div className="payment-qr">
                {ticket.bank_qr_url
                  ? <img src={ticket.bank_qr_url} alt="Payment QR" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : "QR"}
              </div>
            </div>
          </div>

          {totalAmount != null && (
            <div className="total-band">
              <span className="lab">តម្លៃសរុប · Total Amount</span>
              <span className="amt">{fmtRiel(totalAmount)}</span>
            </div>
          )}

          <div className="sig-row">
            <div className="sig-box"><div className="sig-line"></div><span className="kh">អ្នកថ្លឹង</span> <span className="en">Operator</span></div>
            <div className="sig-box"><div className="sig-line"></div><span className="kh">អ្នកបើកបរ</span> <span className="en">Driver</span></div>
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
  const [newTicketType, setNewTicketType] = useState("BUY");
  const [confirmFinishTicket, setConfirmFinishTicket] = useState(null);
  const [finishTicket, setFinishTicket] = useState(null);
  const [editTicket, setEditTicket] = useState(null);
  const [declineTicketRow, setDeclineTicketRow] = useState(null);
  const [slipTicket, setSlipTicket] = useState(null);
  const [finalReceipt, setFinalReceipt] = useState(null);
  const [syncStatus, setSyncStatus] = useState({ online: true, syncing: false, pending: 0 });
  // Finalized tab — HQ Admin only, for reopening a ticket that got
  // finished against the wrong truck (see ReopenTicketModal above). Loaded
  // on demand, separately from the main open-tickets board above, since a
  // finalized ticket isn't part of ALL_STAGE_IDS/the board's own `tickets`.
  const [finalizedTickets, setFinalizedTickets] = useState([]);
  const [loadingFinalized, setLoadingFinalized] = useState(false);
  const [reopenTicketRow, setReopenTicketRow] = useState(null);

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
    // No connection at all — skip the attempt entirely instead of waiting
    // out a request that can't succeed before falling back to the exact
    // same cache below. This is what made the board feel slow to open
    // right after this computer boots with no WiFi yet.
    if (navigator.onLine) {
      try {
        serverRows = await withTimeout(
          api.getTickets({ locationId: effectiveLocationId || undefined, stages: ALL_STAGE_IDS }),
          BOARD_LOAD_TIMEOUT_MS,
          null
        );
      } catch {
        serverRows = null; // WiFi connected but not really working — fall back to the local cache below
      }
    }
    const merged = serverRows ? mergeServerTickets(serverRows) : getCachedTickets();
    const visible = merged.filter((t) => ALL_STAGE_IDS.includes(t.stage) && (!effectiveLocationId || t.location_id === effectiveLocationId));
    setTickets(visible);
    setLoading(false);
  }
  useEffect(() => { load(); }, [effectiveLocationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loads the Finalized tab's list only when it's actually open — no point
  // fetching 30 finished tickets on every page load when almost nobody
  // needs this tab most of the time. Admin-only, same as the tab itself.
  useEffect(() => {
    if (tab !== "finalized" || !isAdmin) return;
    setLoadingFinalized(true);
    api.getTickets({ locationId: effectiveLocationId || undefined, stages: ["finalized"], limit: 30 })
      .then(setFinalizedTickets)
      .catch(() => setFinalizedTickets([]))
      .finally(() => setLoadingFinalized(false));
  }, [tab, isAdmin, effectiveLocationId]);

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

  // Same code/plate/Quality-Ticket-No. search as `grouped` above, applied
  // to the separately-loaded Finalized list.
  const visibleFinalized = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return finalizedTickets;
    return finalizedTickets.filter((t) =>
      (t.code || "").toLowerCase().includes(q) ||
      (t.car_plate || "").toLowerCase().includes(q) ||
      (t.paper_ticket_no || "").toLowerCase().includes(q)
    );
  }, [finalizedTickets, search]);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Weighing Tickets" subtitle="Weigh in once, finish the ticket once the truck's back and empty" />

      {/* The global "unsynced changes" banner in Topbar.jsx now covers this
          on every page — the syncStatus subscription below stays, since
          this board also uses it to auto-reload once a sync finishes. */}

      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1 overflow-x-auto">
            <button onClick={() => setTab("waiting")}
              className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "waiting" ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50"}`}>
              Waiting <span className="text-xs opacity-75">{grouped.waiting.length}</span>
            </button>
            <button onClick={() => setTab("declined")}
              className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "declined" ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50"}`}>
              Declined <span className="text-xs opacity-75">{grouped.declined.length}</span>
            </button>
            {isAdmin && (
              <button onClick={() => setTab("finalized")}
                className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "finalized" ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50"}`}>
                Finalized
              </button>
            )}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5 border-b border-slate-200 py-1">
              <Search size={13} className="text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ticket # or plate…"
                className="w-36 border-none bg-transparent text-sm outline-none placeholder:text-slate-400 sm:w-40"
              />
            </div>
            {isAdmin && locations.length > 1 && (
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                <option value="">All Locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <div className="flex items-center gap-2.5">
              <button onClick={() => { setNewTicketType("BUY"); setShowNew(true); }} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-8 py-3 text-[15px] font-bold text-white hover:bg-brand-700">
                <Plus size={16} /> Buy
              </button>
              <button onClick={() => { setNewTicketType("SELL"); setShowNew(true); }} className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-8 py-3 text-[15px] font-bold text-white hover:bg-rose-700">
                <Plus size={16} /> Sell
              </button>
            </div>
          </div>
        </div>
        {tab === "waiting" && <p className="mt-2 text-xs text-slate-400">A ticket shows up here once it's been weighed in — the queue slip and quality/price decision on paper happen before this, same as today.</p>}
        {tab === "finalized" && <p className="mt-2 text-xs text-slate-400">Most recently finished tickets. If Finish Ticket was completed against the wrong truck, reopen it here — see the card for what that does.</p>}
      </div>

      <main className="flex-1 overflow-y-auto bg-slate-100 p-6">
        {tab === "finalized" ? (
          loadingFinalized ? (
            <p className="text-center text-sm text-slate-400">Loading…</p>
          ) : visibleFinalized.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
              {search.trim() ? "No finished tickets match that search." : "No finished tickets yet."}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleFinalized.map((t) => (
                <div key={t.id} className={`rounded-xl border border-l-4 bg-white p-4 shadow-sm ${t.type === "BUY" ? "border-slate-200 border-l-brand-500" : "border-slate-200 border-l-rose-400"}`}>
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-800">
                        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${t.type === "BUY" ? "bg-brand-100 text-brand-700" : "bg-rose-100 text-rose-700"}`}>
                          {t.type === "BUY" ? "▲ BUY" : "▼ SELL"}
                        </span>
                        {t.code}
                      </p>
                      <p className="text-xs text-slate-400">{t.stationName}{t.tare_at ? ` · finished ${new Date(t.tare_at).toLocaleTimeString("en-US", { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit" })}` : ""}</p>
                    </div>
                    <button onClick={() => setSlipTicket(t)} className="text-slate-400 hover:text-brand-600" title="View / print slip"><Printer size={16} /></button>
                  </div>
                  <div className="mb-3 space-y-0.5 text-sm">
                    <p className="text-slate-700">{t.party_name} <span className="text-slate-400">· {t.car_plate}</span></p>
                    <p className="text-slate-500">{t.product_name}</p>
                    <p className="text-slate-500">Weigh In: {fmt2(t.gross_kg)} kg · Weigh Out: {fmt2(t.tare_kg)} kg</p>
                    {t.price_per_kg != null && <p className="text-slate-500">Price: {fmtRiel(t.price_per_kg)}/kg</p>}
                  </div>
                  <button onClick={() => setReopenTicketRow(t)} className="w-full rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50">
                    Reopen — wrong ticket was finished
                  </button>
                </div>
              ))}
            </div>
          )
        ) : loading ? (
          <p className="text-center text-sm text-slate-400">Loading…</p>
        ) : grouped[tab]?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
            {search.trim() ? "No tickets match that search." : "No tickets here right now."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grouped[tab]?.map((t) => (
              // Simplified board card [2026-08-29], approved via mockup: only
              // what's needed to act on a ticket shows by default — who,
              // truck, weight, and the Quality Ticket # (staff match this
              // against the paper slip, so it's sized the same as weight).
              // Ticket code / product / station / who-weighed-it moved into
              // one small "Details" line at the bottom instead of separate
              // sentences. Direction (Buy=green / Sell=rose) is still shown
              // via the left accent bar, same convention used everywhere
              // else (Transactions, Dashboard, Stock Report, Tax Report) —
              // just without the extra "▲ BUY" text badge on top of it.
              <div key={t.id} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className={`absolute inset-y-4 left-0 w-1 rounded-full ${t.type === "BUY" ? "bg-brand-500" : "bg-rose-400"}`} />
                <div className="pl-3">
                  <div className="mb-1 flex items-center justify-between">
                    {pendingCountForTicket(t.id) > 0 ? (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">not synced</span>
                    ) : <span />}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-300">
                        {t.gross_at ? new Date(t.gross_at).toLocaleTimeString("en-US", { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit" }) : ""}
                      </span>
                      {tab === "waiting" && (
                        <button onClick={() => setEditTicket(t)} className="text-slate-400 hover:text-brand-600" title="Edit ticket info"><Pencil size={14} /></button>
                      )}
                      <button onClick={() => setSlipTicket(t)} className="text-slate-400 hover:text-brand-600" title="View / print slip"><Printer size={15} /></button>
                    </div>
                  </div>

                  <p className="text-xl font-extrabold leading-tight text-slate-800">{t.party_name}</p>
                  {t.car_plate && <p className="mb-3 text-sm font-semibold text-slate-500">{t.car_plate}</p>}

                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Weight</p>
                      <p className="text-xl font-extrabold text-slate-800">{t.gross_kg != null ? fmt2(t.gross_kg) : "—"}</p>
                    </div>
                    <div className="rounded-lg bg-amber-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Ticket #</p>
                      <p className="text-xl font-extrabold text-amber-700">{t.paper_ticket_no || "—"}</p>
                    </div>
                  </div>

                  {tab === "waiting" && (
                    <div className="flex items-center gap-3">
                      <button onClick={() => setConfirmFinishTicket(t)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
                        Finish Ticket <ArrowRight size={14} />
                      </button>
                      <button onClick={() => setDeclineTicketRow(t)} className="text-sm font-medium text-slate-400 hover:text-rose-600">
                        Decline
                      </button>
                    </div>
                  )}
                  {tab === "declined" && <p className="text-center text-xs font-medium text-rose-500">Declined — {t.price_note || "no reason given"}</p>}

                  {/* Details line — everything that isn't needed to decide what to do
                      next, still one glance away: ticket code, product, station
                      (matters when an admin is viewing "All Locations"), and who
                      filled the ticket in (PaddyTrade staff, not the trading
                      partner — "(staff)" matches the wording on the printed slip). */}
                  <p className="mt-2 truncate text-[11px] text-slate-400" title={`${t.code} · ${t.product_name || ""}${t.stationName ? ` · ${t.stationName}` : ""}${t.recorded_by_name ? ` · ${t.type === "BUY" ? "Buyer (staff)" : "Seller (staff)"}: ${t.recorded_by_name}` : ""}`}>
                    {t.code}{t.product_name ? ` · ${t.product_name}` : ""}{t.stationName ? ` · ${t.stationName}` : ""}
                    {t.recorded_by_name ? ` · ${t.type === "BUY" ? "Buyer" : "Seller"} (staff): ${t.recorded_by_name}` : ""}
                  </p>
                </div>
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
          initialType={newTicketType}
          onClose={() => setShowNew(false)}
          onCreated={(t) => { setShowNew(false); load(); setSlipTicket(t); }}
        />
      )}
      {confirmFinishTicket && (
        <ConfirmFinishModal
          ticket={confirmFinishTicket}
          onClose={() => setConfirmFinishTicket(null)}
          onConfirm={() => { setFinishTicket(confirmFinishTicket); setConfirmFinishTicket(null); }}
        />
      )}
      {reopenTicketRow && (
        <ReopenTicketModal
          ticket={reopenTicketRow}
          onClose={() => setReopenTicketRow(null)}
          onReopened={() => {
            // Reopened ticket now belongs on the waiting board, not this
            // list — drop it immediately rather than waiting on a refetch.
            setFinalizedTickets((prev) => prev.filter((row) => row.id !== reopenTicketRow.id));
            setReopenTicketRow(null);
            load();
          }}
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
      {editTicket && (
        <EditTicketModal
          ticket={editTicket}
          isAdmin={isAdmin}
          onClose={() => setEditTicket(null)}
          onSaved={() => { setEditTicket(null); load(); }}
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
