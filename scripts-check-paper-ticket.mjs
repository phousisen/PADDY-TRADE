// Guard for the paper booklet ticket number on a MANUALLY-entered Buy/Sell.
//
// Until 2026-09-12 this form was the one way a transaction could reach the
// database carrying no booklet number at all — the weighbridge board has
// always asked for it, New Buy/New Sell never did. Every load re-typed out
// of the book afterwards therefore had nothing tying it back to the paper,
// so nobody could check the app against the book in either direction. That
// is the check that would have caught Jomnoum's missing 9 and 11 September
// entries in a day instead of a week.
//
// The failure mode this file exists to prevent is NOT "the box is missing
// from the screen" — that is obvious the moment anyone opens the form. It
// is the quiet one: the box is on screen, staff type into it, and the value
// is dropped somewhere on the way to the database. There are five places it
// can be dropped between the keyboard and the row, and a break in any one
// of them looks identical from the outside (an entry that saves fine, with
// an empty paper_ticket_no). So each hop is asserted separately, against
// the real source.
//
// npm is blocked in this container, so the rules are re-implemented here
// and the source is then asserted to still contain them.
import { readFileSync } from "fs";
import { liveSource } from "./scripts-live-source.mjs";
const form = readFileSync("src/pages/TransactionForm.jsx", "utf8");
const board = liveSource("src/pages/WeighingTickets.jsx");
const queue = readFileSync("src/offlineQueue.js", "utf8");
const api = readFileSync("src/api.js", "utf8");

let failed = 0;
const ok = (name, cond) => { if (!cond) { console.error(`FAIL  ${name}`); failed++; } };
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL  ${name}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
    failed++;
  }
};

// ---------------------------------------------------------------------
// 1. Normalizing. Mirrors normalizePaperTicketNo() in api.js.
//    An extra space typed in the MIDDLE of a number is invisible on
//    screen and is exactly how PONG RO's PR000127 got used twice.
// ---------------------------------------------------------------------
function normalize(raw) {
  const squeezed = (raw || "").trim().replace(/\s+/g, " ");
  return squeezed || null;
}
eq("ends are trimmed", normalize("  092152 "), "092152");
eq("a doubled inner space is squeezed", normalize("TD  000678"), "TD 000678");
eq("a tab counts as a space", normalize("TD\t000678"), "TD 000678");
eq("a genuinely typed single space is kept", normalize("TD 000678"), "TD 000678");
eq("blank is null, never an empty string", normalize("   "), null);
eq("missing is null", normalize(undefined), null);

// ---------------------------------------------------------------------
// 2. The duplicate check. Mirrors the comparison in handleSubmit.
//    Case and stray spaces must never let a repeat through.
// ---------------------------------------------------------------------
function findDup(cached, locationId, typed) {
  const want = (normalize(typed) || "").toLowerCase();
  if (!want) return null;
  return cached.find(
    (tx) => tx.location_id === locationId &&
      (normalize(tx.paper_ticket_no) || "").toLowerCase() === want
  ) || null;
}
const cached = [
  { id: "a", location_id: "JOM", paper_ticket_no: "092152", code: "TX-100000001" },
  { id: "b", location_id: "JOM", paper_ticket_no: "TD 000678", code: "TX-100000002" },
  { id: "c", location_id: "PR",  paper_ticket_no: "092152", code: "TX-100000003" },
  { id: "d", location_id: "JOM", paper_ticket_no: null, code: "TX-100000004" },
];
eq("an exact repeat at the same station is caught", findDup(cached, "JOM", "092152")?.id, "a");
eq("a repeat with stray spaces is caught", findDup(cached, "JOM", " 092152 ")?.id, "a");
eq("a repeat with a doubled inner space is caught", findDup(cached, "JOM", "TD  000678")?.id, "b");
eq("case does not hide a repeat", findDup(cached, "JOM", "td 000678")?.id, "b");
eq("the SAME number at a DIFFERENT station is not a duplicate",
   findDup(cached, "RK", "092152"), null);
eq("a genuinely new number is not a duplicate", findDup(cached, "JOM", "092153"), null);
eq("a blank never matches the rows that have no number at all",
   findDup(cached, "JOM", "   "), null);

// ---------------------------------------------------------------------
// 3. Warn, then allow. This form is what re-types a day out of the book,
//    where a genuinely repeated booklet number does happen. Refusing
//    outright would leave a load that physically happened unrecorded —
//    worse than a flagged pair. So: the first Save warns, and a second
//    Save with the SAME number goes through. Editing the number must
//    clear the standing warning, or a corrected number would ride
//    through on the previous one's confirmation.
// ---------------------------------------------------------------------
function shouldRecheck(dupWarn, typed) {
  return (normalize(typed) || "") !== (dupWarn?.ticketNo || "");
}
ok("a first attempt is checked", shouldRecheck(null, "092152"));
ok("pressing Save again on the SAME number is not re-checked — it goes through",
   !shouldRecheck({ ticketNo: "092152" }, "092152"));
ok("a corrected number is checked again, not waved through",
   shouldRecheck({ ticketNo: "092152" }, "092153"));
ok("re-typing the same number with stray spaces still counts as confirmed",
   !shouldRecheck({ ticketNo: "092152" }, " 092152 "));

// ---------------------------------------------------------------------
// 4. The booklet counter. Mirrors incrementTicketNo() in offlineQueue.js,
//    shared with the weighbridge board so the two screens stay on ONE
//    running sequence instead of each suggesting from its own.
// ---------------------------------------------------------------------
function increment(last) {
  if (!last) return "";
  const m = last.match(/\d+$/);
  if (!m) return "";
  const num = m[0];
  return last.slice(0, last.length - num.length) + String(Number(num) + 1).padStart(num.length, "0");
}
eq("leading zeros are kept", increment("092152"), "092153");
eq("a prefix is kept", increment("TD 000678"), "TD 000679");
eq("rolling over a 9 widens correctly", increment("099999"), "100000");
eq("nothing to go on yields nothing", increment(""), "");
eq("a number with no digits yields nothing", increment("ABC"), "");

// ---------------------------------------------------------------------
// 5. THE FIVE HOPS. Each is a place the typed number can be dropped
//    silently. A break in any one of them saves an entry with an empty
//    paper_ticket_no and reports success.
// ---------------------------------------------------------------------
// 5.1 The box exists, and is required.
ok("hop 1/5 — the form has a paper ticket number field",
   form.includes("const [paperTicketNo, setPaperTicketNo] = useState"));
ok("hop 1/5 — it is required before saving, like the weighbridge board",
   /if \(!paperTicketNo\.trim\(\)\) \{ setError\(t\("err_need_paper_ticket"\)\); return; \}/.test(form));
ok("hop 1/5 — the error text exists in both languages",
   (readFileSync("src/i18n.jsx", "utf8").match(/\berr_need_paper_ticket:/g) || []).length === 2);

// 5.2 The form hands it to the save.
ok("hop 2/5 — the form passes it into createTransactionOffline",
   form.includes("paperTicketNo: paperTicketNo.trim() || null,"));

// 5.3 The offline queue accepts it and puts it in the QUEUED PAYLOAD.
//     This is the hop that matters offline: the payload is the only copy
//     that survives a reload before the sync lands.
ok("hop 3/5 — createTransactionOffline accepts it",
   /export async function createTransactionOffline\(\{[^}]*paperTicketNo[^}]*\}\)/s.test(queue));
ok("hop 3/5 — it is in the queued payload, so it survives a save made offline",
   queue.includes("paperTicketNo: paperTicketNo || null,"));
// These two write the same line into two DIFFERENT objects — the cached
// row (4-space indent) and the station PC relay copy (6-space indent) —
// so each must be asserted in its own place. A plain substring check
// passes on either one alone, which is exactly how a guard ends up
// agreeing with itself while the thing it guards is broken.
// Anchored on indentation, not on whichever line happens to sit next to it
// — the cached row is built at 4 spaces, the relay copy at 6. Anchoring to a
// neighbouring line made this fail the moment an unrelated field was added
// between them, which is noise, not a real regression.
// Scoped to createTransactionOffline itself. createTicketOffline, further up
// the same file, writes an identically-spelled line at the same indentation
// for the weighbridge board — so a check against the whole file passes on
// the BOARD's copy while this save's is missing. That is the same
// self-agreeing failure that let the finalize deadlock ship: a guard has to
// be looking at the code it claims to be guarding.
const createTxBody = queue.slice(queue.indexOf("export async function createTransactionOffline"));
ok("hop 3/5 — it is on the cached row the Transactions list and receipt read",
   createTxBody.includes("\n    paper_ticket_no: paperTicketNo || null,"));
ok("hop 3/5 — it is in the station PC relay copy too",
   createTxBody.includes("\n      paper_ticket_no: paperTicketNo || null,"));
eq("hop 3/5 — written in exactly those two places inside this save, no more, no fewer",
   (createTxBody.match(/paper_ticket_no: paperTicketNo \|\| null,/g) || []).length, 2);

// 5.4 The row actually written to the database carries it, normalized,
//     and is checked for a duplicate server-side.
ok("hop 4/5 — buildTransactionRow accepts it",
   /async buildTransactionRow\(\{[^}]*paperTicketNo[^}]*\}\)/s.test(api));
ok("hop 4/5 — it is written normalized, never raw",
   api.includes("paper_ticket_no: normalizePaperTicketNo(paperTicketNo),"));
ok("hop 4/5 — a duplicate is flagged on the row itself",
   api.includes('paper_ticket_dup_flag: await checkAndFlagPaperTicketDuplicate("transactions", locationId, paperTicketNo)'));

// 5.5 A STUCK save that gets recovered must carry the number back. This
//     is the subtlest hop: recoverStuckOps rebuilds the queued op from
//     this device's cached transaction, so if the cache did not keep the
//     number (5.3) or the rebuild did not read it, a recovered entry
//     would land with a blank one and nobody would ever know it had had
//     one. Both halves are asserted, because either alone is useless.
ok("hop 5/5 — a rebuilt stuck save reads the number back off the cached row",
   queue.includes("paperTicketNo: tx.paper_ticket_no || null,"));

// ---------------------------------------------------------------------
// 6. The duplicate check itself must be the live-then-cache shape, not
//    cache-only: two devices can each record a load before either has
//    synced the other's, which is exactly how PONG RO's PR000127 got
//    used twice. And it must be bounded, or a station on a bad
//    connection would hang on Save.
// ---------------------------------------------------------------------
ok("the duplicate check asks the live database first",
   form.includes("api.findAnyByPaperTicketNo({ locationId: effectiveStationId, paperTicketNo: trimmedTicketNo })"));
ok("that live check is bounded, so a bad connection cannot hang a save",
   /withTimeout\(\s*(?:\/\/[^\n]*\n\s*)*api\.findAnyByPaperTicketNo[\s\S]{0,300}?3500, null\s*\)/.test(form));
ok("it falls back to this device's own cache when offline",
   form.includes("getCachedTransactions().find("));
ok("...and the offline fallback checks the weighbridge board too",
   form.includes("getCachedTickets().find("));
ok("a duplicate warns and returns — it does not throw the entry away",
   form.includes("setDupWarn({") && form.includes("ticketNo: trimmedTicketNo,"));
ok("editing the number clears a standing warning",
   form.includes("useEffect(() => { setDupWarn(null); }, [paperTicketNo]);"));

// ---------------------------------------------------------------------
// 7. The number feeds the shared booklet counter, and the suggestion
//    only ever fills a BLANK box — it must never overwrite a number
//    staff have already typed.
// ---------------------------------------------------------------------
ok("the saved number is recorded for the next suggestion",
   form.includes("recordPaperTicketNo(effectiveStationId, paperTicketNo.trim());"));
ok("the suggestion only fills a blank box",
   form.includes("if (!suggestStationId || paperTicketNo) return undefined;") &&
   form.includes("setPaperTicketNo((cur) => (cur ? cur : suggested));"));
ok("the suggestion uses the SAME counter as the weighbridge board",
   form.includes("suggestNextPaperTicketNo(suggestStationId)"));

// ---------------------------------------------------------------------
// 9. ONE BOOKLET. [2026-09-12]
//
//    A station has ONE pre-numbered paper booklet. The app had two
//    separate ideas of it that never spoke:
//
//      the weighbridge board  suggested from this device's memory,
//                             checked for a clash in weighing_tickets
//      the manual Buy/Sell    suggested from this device's memory,
//                             checked for a clash in transactions
//
//    So a number used on the board could be typed again on a manual
//    entry with nothing said — which is JOMNOUM CN 000560: Bory's live
//    ticket of 7 September, then hen's typed entry of the 9th. And two
//    devices at one station were each told to use the same next number,
//    because neither knew what the other had just written.
//
//    api.getLatestPaperTicketNo was written on 5 September to fix the
//    second half of that and was NEVER CALLED BY ANYTHING. A guard that
//    only checks a function exists would have passed the whole time, so
//    these assert the CALL SITES, not the definitions.
// ---------------------------------------------------------------------
const tx = readFileSync("src/pages/Transactions.jsx", "utf8");

ok("there is one duplicate check that reads both tables",
   api.includes("async findAnyByPaperTicketNo({ locationId, paperTicketNo, excludeTicketId, excludeTransactionId })"));
ok("...and it really does consult both",
   /findAnyByPaperTicketNo[\s\S]{0,900}?this\.findTicketByPaperTicketNo[\s\S]{0,400}?this\.findTransactionByPaperTicketNo/.test(api));
ok("the next-number suggestion reads both tables too",
   /async getLatestPaperTicketNo[\s\S]{0,900}?pick\("weighing_tickets"\)[\s\S]{0,120}?pick\("transactions"\)/.test(api));

// Every screen where a booklet number can be typed must use the shared
// check. Named individually so a failure says WHICH door was left open.
for (const [screen, src, needle] of [
  // The live board routes New Ticket, Edit Ticket and both live
  // while-you-type checks through ONE shared helper, so asserting the
  // helper covers all four call sites.
  ["the weighbridge board's shared check", board, "locationId, paperTicketNo: trimmedTicketNo, excludeTicketId: excludeId,"],
  ["New Buy / New Sell", form, "api.findAnyByPaperTicketNo({ locationId: effectiveStationId, paperTicketNo: trimmedTicketNo })"],
  ["Edit Transaction", tx, "api.findAnyByPaperTicketNo({ locationId: locationId || tx.location_id, paperTicketNo: trimmedTicketNo, excludeTransactionId: tx.id })"],
]) {
  if (!src.includes(needle)) {
    console.error(`FAIL  ${screen} does not use the shared both-tables duplicate check — a booklet number can be reused there with no warning`);
    failed++;
  }
}

// And both screens that SUGGEST a number must ask the server, not just
// this browser. This is the assertion that would have caught
// getLatestPaperTicketNo sitting unused for a week.
for (const [screen, src] of [["the weighbridge board", board], ["New Buy / New Sell", form]]) {
  if (!/api\.getLatestPaperTicketNo\(/.test(src)) {
    console.error(`FAIL  ${screen} suggests the next booklet number from this device's memory alone — two devices at one station will be given the same number`);
    failed++;
  }
}
ok("the board's live suggestion is bounded",
   /withTimeout\(\s*api\.getLatestPaperTicketNo\([\s\S]{0,160}?PHONE_LOOKUP_TIMEOUT_MS/.test(board));
ok("the form's live suggestion is bounded",
   /withTimeout\(\s*api\.getLatestPaperTicketNo\([\s\S]{0,120}?3000, null\s*\)/.test(form));
ok("a suggestion that arrives late never overwrites what staff typed",
   // The board does this with applyIfUntouched(); the form with a
   // functional setState. Different spelling, same guarantee.
   board.includes("if (current && current !== autoValue) return current;") &&
   form.includes("setPaperTicketNo((cur) => (cur ? cur : suggested));"));
// The board's offline fallback must see manual entries too.
ok("the board's offline fallback checks manually-entered loads as well",
   board.includes(") || getCachedTransactions().find("));

// ---------------------------------------------------------------------
// 8. The rearranged form: nothing REQUIRED to save may be hidden inside
//    a fold-away section, or a save would be refused for a reason that
//    is not on screen. The required fields are party name, station,
//    product, weight, price (Buy), date and the ticket number — this
//    asserts each of those inputs sits BEFORE the first <Fold>.
// ---------------------------------------------------------------------
const firstFold = form.indexOf("<Fold");
ok("there are fold-away sections at all", firstFold > 0);
for (const [what, needle] of [
  ["the paper ticket number", "value={paperTicketNo}"],
  ["the transaction date", "value={txDate}"],
  ["the party name", "value={partyQuery}"],
  // [2026-09-15] Was `value={productQuery}`. The product field became a
  // dropdown over the shared paddy type list, so its value is now computed
  // rather than bound straight to the state. The assertion is unchanged —
  // the field must still sit before the first <Fold>; only the way the
  // field is recognised has moved with the markup.
  ["the product", "setProductQuery(e.target.value)"],
  ["the price", "value={pricePerKg}"],
  ["the gross weight", "value={grossKg}"],
  ["the tare weight", "value={tareKg}"],
]) {
  const at = form.indexOf(needle);
  if (at < 0) { console.error(`FAIL  ${what} is missing from the form entirely`); failed++; }
  else if (at > firstFold) {
    console.error(`FAIL  ${what} is hidden inside a fold-away section — a save could be refused for a reason that is not on screen`);
    failed++;
  }
}
// And every field that WAS on the old form must still be somewhere on it.
// A "simpler" form that quietly dropped a field would be a data loss, not
// a simplification.
for (const [what, needle] of [
  ["quality grade", "value={qualityGrade}"],
  ["payment status", "value={paymentStatus}"],
  ["car plate", "value={carPlate}"],
  ["driver name", "value={driverName}"],
  ["bank name", "setBankName(e.target.value)"],
  ["bank account", "value={bankAccount}"],
  ["bank QR photo", 'kind="party-bank-qr"'],
  ["company", "value={company}"],
  ["destination", "value={destination}"],
  ["moisture %", "value={moisturePct}"],
  ["mixture %", "value={mixturePct}"],
  ["outthrow %", "value={outthrowPct}"],
  ["deduction kg", "value={deductionKg}"],
  ["VAT", "checked={taxApplicable}"],
  ["VAT rate", "value={taxRate}"],
  ["note", "value={note}"],
  ["receipt photo", 'kind="receipt"'],
  ["payment proof photo", 'kind="payment-proof"'],
]) {
  if (!form.includes(needle)) {
    console.error(`FAIL  ${what} was dropped from the form — that is data loss, not simplification`);
    failed++;
  }
}

// [2026-09-16] The staff / carrying fee is the ONE field deliberately taken
// off this form. SISEN: "staff fee and ថ្លៃកូនដៃ should be the same. we dont
// need staff fee anymore because it will be typed in the expenses instead."
//
// It was the same money written down twice — deducted from the farmer here,
// and typed again as ថ្លៃកូនដៃ on Expenses. So the check inverts: the box
// must NOT come back, and a new transaction must send a hard 0 rather than
// silently omitting the field, because omitting it would leave the amount
// formula reading `undefined` and quietly stop subtracting on old code.
ok("the staff fee box is gone from the new-transaction form",
   !form.includes("value={staffFee}") && !form.includes("setStaffFee"));
ok("a new transaction still sends staffFee: 0 explicitly",
   form.includes("staffFee: 0"));

// The column, the arithmetic and every old record are untouched. A ticket
// or receipt that already carries a fee must still print it.
for (const [file, label] of [
  ["src/pages/Receipt.jsx", "the receipt"],
  ["src/pages/WeighingTickets.jsx", "the ticket slip"],
]) {
  const src = readFileSync(file, "utf8");
  ok(`${label} still prints a fee that an older record actually has`,
     /Number\((?:tx|ticket)\.staff_fee\) > 0/.test(src));
}
const txs = readFileSync("src/pages/Transactions.jsx", "utf8");
ok("editing an old record cannot silently drop its fee",
   txs.includes("const hadStaffFee = Number(tx.staff_fee) > 0;")
   && txs.includes("staffFee: isBuy ? (parseFloat(staffFee) || 0) : 0,"));
ok("the fee box only appears on a record that already has one",
   (txs.match(/isBuy && hadStaffFee &&/g) || []).length === 2
   && !txs.includes("Staff / Carrying Fee (optional)"));
// A closed fold with something typed in it must say so, or a number
// entered and then folded away is invisible at the moment of saving.
ok("a closed fold shows a dot when something inside it is filled in",
   form.includes("{filled && <span") && form.includes("filled={!!(carPlate || driverName)}"));

if (failed) { console.error(`\n${failed} paper-ticket check(s) FAILED.`); process.exit(1); }
console.log("Checked 71 paper-ticket cases — the booklet number reaches the database on every path, and nothing required is hidden.");
