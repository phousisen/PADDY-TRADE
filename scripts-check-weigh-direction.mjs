// Guard for WHICH WAY ROUND the two weighs go, and for the two weighs
// reaching the printed ticket at all.
//
// TWO REAL DEFECTS, both found on 2026-09-12 by the owner, both on the
// manual New Buy / New Sell form:
//
//  1. A SELL's net weight came out ZERO. The form computed
//     `net = weighIn - weighOut` for both directions. On a purchase that is
//     right — the truck arrives loaded and leaves empty. On a SALE it is
//     backwards: the truck arrives EMPTY and leaves LOADED, so the
//     subtraction is the other way round. Every Sell therefore produced a
//     negative number, which `Math.max(0, …)` quietly turned into 0. The
//     form then showed "0.00 KG" and "Total 0 ៛" and would have SAVED that
//     — a real truckload of paddy recorded as nothing, with no error
//     anywhere. Live example: 18,680 in / 54,230 out = 35,550 kg, shown as
//     0.00. `WeighingTickets.jsx` has always had this right; only this
//     screen was wrong, which is why it survived so long.
//
//  2. The printed ticket's Weigh In / Weigh Out table was EMPTY on every
//     manual entry — "—" in all six cells, with only a Net Weight and a
//     total underneath. The two weights were on screen when it was saved;
//     they were simply never passed to the save, so `gross_kg`/`tare_kg`
//     landed null. A weight ticket with a total and no working out is not
//     a weight ticket.
//
// npm is blocked here, so the rules are re-implemented and the source is
// then asserted to still contain them.
import { readFileSync } from "fs";
import { liveSource } from "./scripts-live-source.mjs";
const form = readFileSync("src/pages/TransactionForm.jsx", "utf8");
const queue = readFileSync("src/offlineQueue.js", "utf8");
const board = liveSource("src/pages/WeighingTickets.jsx");
const receipt = readFileSync("src/pages/Receipt.jsx", "utf8");

let failed = 0;
const ok = (name, cond) => { if (!cond) { console.error(`FAIL  ${name}`); failed++; } };
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL  ${name}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
    failed++;
  }
};

// ---------------------------------------------------------------------
// 1. THE DIRECTION RULE. Mirrors TransactionForm.jsx's rawNetKg.
//
//    gross_kg is always the FIRST weigh (weigh IN), tare_kg always the
//    SECOND (weigh OUT). The COLUMN NAMES never move — only what the
//    truck is carrying at each weigh changes with the direction.
// ---------------------------------------------------------------------
function rawNet(type, weighIn, weighOut) {
  return type === "BUY" ? weighIn - weighOut : weighOut - weighIn;
}
function net(type, weighIn, weighOut) {
  return Math.max(0, rawNet(type, weighIn, weighOut));
}

// A purchase: the truck arrives LOADED, tips its paddy, leaves EMPTY.
eq("BUY — loaded in, empty out", net("BUY", 12895, 7105), 5790);
eq("BUY — the real Jomnoum ticket", net("BUY", 14725, 4310), 10415);

// A sale: the truck arrives EMPTY, is loaded, leaves HEAVY.
eq("SELL — empty in, loaded out", net("SELL", 18680, 54230), 35550);
eq("SELL — a second case", net("SELL", 7105, 12895), 5790);

// THE BUG ITSELF: the old rule, applied to a sale.
const oldRule = (a, b) => Math.max(0, a - b);
eq("the OLD rule silently reported a real 35,550 kg sale as zero",
   oldRule(18680, 54230), 0);
ok("the new rule does not", net("SELL", 18680, 54230) > 0);

// Symmetry: the same pair of numbers is a valid load in exactly one
// direction. If it reads as a load both ways round, the rule is not
// actually distinguishing anything.
for (const [a, b] of [[12895, 7105], [18680, 54230], [20000, 5000]]) {
  const asBuy = rawNet("BUY", a, b) > 0;
  const asSell = rawNet("SELL", a, b) > 0;
  if (asBuy === asSell) {
    console.error(`FAIL  ${a}/${b} reads the same as a Buy and a Sell — the direction rule is doing nothing`);
    failed++;
  }
}

// ---------------------------------------------------------------------
// 2. REVERSED ENTRY IS SAID OUT LOUD, NOT CLAMPED TO ZERO.
//    The clamp is what made defect 1 invisible: a wrong entry became a
//    0 kg transaction that saved without complaint. The clamp stays (a
//    negative weight must never reach the database) but it must no
//    longer be SILENT.
// ---------------------------------------------------------------------
function reversed(type, weighIn, weighOut, inTyped = true, outTyped = true) {
  const both = inTyped && outTyped;
  return both && rawNet(type, weighIn, weighOut) <= 0;
}
ok("a Sell typed the Buy way round is flagged", reversed("SELL", 54230, 18680));
ok("a Buy typed the Sell way round is flagged", reversed("BUY", 7105, 12895));
ok("a correct Sell is not flagged", !reversed("SELL", 18680, 54230));
ok("a correct Buy is not flagged", !reversed("BUY", 12895, 7105));
ok("two identical weights are flagged — that is a zero load, not a load",
   reversed("BUY", 9000, 9000));
ok("a half-filled form is NOT flagged — staff are still weighing",
   !reversed("BUY", 12895, 0, true, false));
ok("an empty form is NOT flagged", !reversed("SELL", 0, 0, false, false));

// ---------------------------------------------------------------------
// 3. The form carries the corrected rule, the honest labels, and the
//    warning.
// ---------------------------------------------------------------------
ok("the form computes the net by direction",
   form.includes("const rawNetKg = isBuy ? weighInKg - weighOutKg : weighOutKg - weighInKg;"));
ok("the clamp is still there — a negative weight never reaches the database",
   form.includes("const netKg = Math.max(0, rawNetKg);"));
ok("a reversed pair is detected", form.includes("const weightsReversed = bothWeighed && rawNetKg <= 0;"));
ok("...and is refused at Save with its own message, before the generic one",
   form.indexOf("if (weightsReversed) { setError(") > 0 &&
   form.indexOf("if (weightsReversed) { setError(") < form.indexOf('setError(t("required_fields"))'));
ok("...and is shown on screen before Save is ever pressed",
   form.includes("{weightsReversed && (") && form.includes("The two weights are the wrong way round."));
// The labels are what made this happen. "Gross" and "Tare" only mean
// anything on a purchase; on a sale they invite exactly the reversed entry
// above. Each box must say which weigh it is AND what the truck is carrying.
for (const label of [
  '"Weigh In — loaded truck (kg)" : "Weigh In — empty truck (kg)"',
  '"Weigh Out — empty truck (kg)" : "Weigh Out — loaded truck (kg)"',
]) {
  if (!form.includes(label)) {
    console.error(`FAIL  the weight boxes no longer say which weigh and what state the truck is in: ${label}`);
    failed++;
  }
}
ok("the old direction-blind rule is gone for good",
   !form.includes("Math.max(0, (parseFloat(grossKg) || 0) - (parseFloat(tareKg) || 0))"));

// ---------------------------------------------------------------------
// 4. THE FORM AND THE BOARD MUST AGREE. Two screens recording the same
//    truckload must never disagree about how much paddy it was. This is
//    the assertion that would have caught the original defect: the board
//    was right the whole time.
// ---------------------------------------------------------------------
ok("the weighbridge board computes a Sell the same way round",
   board.includes("ticket.tare_kg - ticket.gross_kg"));
ok("the weighbridge board computes a Buy the same way round",
   board.includes("ticket.gross_kg - ticket.tare_kg"));
// And the board's own live calculation at Finish Ticket.
ok("the board's Finish Ticket agrees too",
   board.includes("? (ticket.gross_kg || 0) - (parseFloat(tareWeight) || 0)") &&
   board.includes(": (parseFloat(tareWeight) || 0) - (ticket.gross_kg || 0)"));

// ---------------------------------------------------------------------
// 4b. THE BOARD'S CLAMP MUST NOT BE SILENT EITHER.
//
//     Getting the direction right was never the board's problem — it had
//     that from the start. What it had no reaction to was the result
//     coming out negative. Math.max turned it into 0, submitFinish only
//     checked that the weigh-out box held SOME number, and Finish Ticket
//     went ahead and created a real 0 kg / 0 ៛ transaction.
//
//     Six of them, 23-29 August, across three stations, every one with a
//     weighing ticket behind it carrying the same reversed pair. Two of
//     those trucks GAINED weight on a Buy ticket (+23,725 kg and
//     +34,140 kg) — a truck that gains weight is being loaded, so those
//     are very probably sales started as purchases, and a ticket's type
//     cannot be changed afterwards. That is why this has to stop at the
//     board, in front of someone who can see the truck, rather than be
//     corrected later from Transactions.
//
//     This is the busy screen. Fixing only the manual form would have
//     left the door that all six actually came through wide open.
// ---------------------------------------------------------------------
ok("the board refuses a net of zero or less at Finish Ticket",
   board.includes("const netNow = isBuy ? grossKgNow - tareKg : tareKg - grossKgNow;") &&
   board.includes("if (netNow <= 0) {"));
ok("...computed by direction, like the form",
   /const netNow = isBuy \? grossKgNow - tareKg : tareKg - grossKgNow;/.test(board));
ok("...and refused AFTER the weigh-out box is known to be filled, so the message is the useful one",
   board.indexOf("if (!tareKg || tareKg <= 0)") < board.indexOf("if (netNow <= 0) {"));
ok("the refusal message says which way round the weights belong, in both languages",
   board.includes('setError(t(isBuy ? "err_weight_buy" : "err_weight_sell"') &&
   (readFileSync("src/i18n.jsx", "utf8").match(/\berr_weight_(buy|sell):/g) || []).length === 4);
ok("it quotes the actual numbers back, so staff can see which is wrong",
   /tare: tareKg\.toLocaleString\(\)[\s\S]{0,120}gross: grossKgNow\.toLocaleString\(\)/.test(board));
// The board's guard predates the form's by five days (Jomnoum CN 000261,
// 2026-09-07). It is asserted here so the two screens can never again
// diverge on the one rule they must agree about.
ok("the board still clamps for display — a negative weight never reaches the database",
   board.includes("const netKg = Math.max(0, isBuy"));

// ---------------------------------------------------------------------
// 5. THE WEIGHTS REACH THE PRINTED TICKET. Four hops, same reasoning as
//    the paper ticket number: a break in any one of them prints a ticket
//    with a total and no working out, and reports success.
// ---------------------------------------------------------------------
ok("hop 1/4 — the form sends the first weigh",
   form.includes("grossKg: grossKg === \"\" ? null : weighInKg,"));
ok("hop 1/4 — the form sends the second weigh",
   form.includes("tareKg: tareKg === \"\" ? null : weighOutKg,"));
ok("hop 2/4 — createTransactionOffline accepts all four",
   /export async function createTransactionOffline\(\{[^}]*grossKg[^}]*grossAt[^}]*tareKg[^}]*tareAt[^}]*\}\)/s.test(queue));

const createTxBody = queue.slice(queue.indexOf("export async function createTransactionOffline"));
ok("hop 3/4 — they are in the queued payload, so an offline save still prints them",
   createTxBody.includes("grossKg: grossKg ?? null, grossAt: grossAt || null,") &&
   createTxBody.includes("tareKg: tareKg ?? null, tareAt: tareAt || null,"));
ok("hop 3/4 — they are on the cached row the receipt reads a second after Save",
   createTxBody.includes("\n    gross_kg: grossKg ?? null,") &&
   createTxBody.includes("\n    tare_kg: tareKg ?? null,"));
ok("hop 3/4 — they are in the station PC relay copy too",
   createTxBody.includes("\n      gross_kg: grossKg ?? null, gross_at: grossAt || null,"));
ok("hop 4/4 — a recovered stuck save carries them back",
   queue.includes("grossKg: tx.gross_kg ?? null,") && queue.includes("tareKg: tx.tare_kg ?? null,"));

// ---------------------------------------------------------------------
// 6. THE RECEIPT PRINTS A WEIGHT IT HAS, even with no clock reading.
//
//    The old code asked ONE question — "is there a gross weight?" — and
//    used the answer for the weight column AND the date AND the time. So
//    a back-dated entry, where nobody can honestly say what time
//    yesterday's truck crossed the scale, printed a dash in the WEIGHT
//    column too. The number is known; only the clock reading is not.
// ---------------------------------------------------------------------
function cell(weightKg, stampIso) {
  return {
    weight: weightKg != null ? `${weightKg} kg` : "—",
    time: stampIso ? "12:37 PM" : "—",
  };
}
eq("a weigh with a timestamp prints both", cell(12895, "2026-09-12T05:37:00Z"),
   { weight: "12895 kg", time: "12:37 PM" });
eq("a weigh with NO timestamp still prints its weight", cell(12895, null),
   { weight: "12895 kg", time: "—" });
eq("a weigh that never happened prints nothing", cell(null, null),
   { weight: "—", time: "—" });

ok("the receipt asks about the weight and the clock separately",
   receipt.includes("const hasWeighIn = tx.gross_kg != null;") &&
   receipt.includes("const hasWeighOut = tx.tare_kg != null;"));
ok("the IN row prints its weight whenever there is one",
   receipt.includes('{hasWeighIn ? `${fmt2(tx.gross_kg)} kg` : "—"}'));
ok("the OUT row prints its weight whenever there is one",
   receipt.includes('{hasWeighOut ? `${fmt2(tx.tare_kg)} kg` : "—"}'));
ok("the one flag that gated all six cells is gone",
   !receipt.includes("hasWeighInOut"));
// splitCambodiaTimestamp already returns "—"/"—" for a null instant, so the
// date/time cells need no flag of their own — but that must stay true.
ok("a missing instant still renders a dash, not a crash or today's date",
   receipt.includes('if (!iso) return { date: "—", time: "—" };'));

// ---------------------------------------------------------------------
// 7. A BACK-DATED ENTRY MUST NOT STAMP TODAY ONTO ITS WEIGH ROWS.
//    Receipt.jsx was fixed on 2026-09-06 for exactly this: a ticket
//    weighed one day and finished the next printed the wrong date in its
//    IN row. Inventing a capture instant for a load typed in from the
//    book days later would reintroduce it from the other end.
// ---------------------------------------------------------------------
function stampIfOnTxDate(stampDate, txDate) {
  return stampDate && stampDate === txDate ? "kept" : null;
}
eq("a weight captured today on a transaction dated today keeps its time",
   stampIfOnTxDate("2026-09-12", "2026-09-12"), "kept");
eq("a load typed in today but dated yesterday gets NO invented time",
   stampIfOnTxDate("2026-09-12", "2026-09-11"), null);
eq("no capture instant at all stays null", stampIfOnTxDate(null, "2026-09-12"), null);
ok("the form applies that rule",
   form.includes("const stampIfOnTxDate = (iso) =>") &&
   form.includes("(iso && cambodiaDateStr(new Date(iso)) === txDate ? iso : null)"));
ok("the capture instant is stamped once, not re-stamped on every keystroke",
   form.includes("setStamp((prev) => (has ? prev || getAccurateNow().toISOString() : null));"));

if (failed) { console.error(`\n${failed} weigh-direction check(s) FAILED.`); process.exit(1); }
console.log("Checked 50 weigh-direction cases — a Sell gains weight, a Buy loses it, and both weighs reach the ticket.");
