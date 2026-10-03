// [2026-10-03] Guard for the "full check" fixes T1, T2, T4, T6, T9, T10, W6,
// W8, W9 (offlineQueue.js, api.js, WeighingTickets.jsx, ChangeRequests.jsx,
// Transactions.jsx). npm is blocked here, so: the one piece of pure logic that
// decides what a station PC remembers (carryLocalOnly) is cut out of the real
// source and RUN; the rest is asserted to still be in the source.
import { readFileSync } from "fs";

const oq = readFileSync("src/offlineQueue.js", "utf8");
const api = readFileSync("src/api.js", "utf8");
const wt = readFileSync("src/pages/WeighingTickets.jsx", "utf8");
const cr = readFileSync("src/pages/ChangeRequests.jsx", "utf8");
const tx = readFileSync("src/pages/Transactions.jsx", "utf8");

let failed = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failed++;
};

// Cut a `const name = (…) => { … };` arrow function out of the source.
function extractArrow(src, name) {
  const start = src.indexOf(`const ${name} = (`);
  if (start < 0) return null;
  const open = src.indexOf("{", src.indexOf("=>", start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(src.indexOf("(", start), i + 1); }
  }
  return null;
}

// ---- T1 + T10: what a station keeps from its own copy of a ticket --------
const carrySrc = extractArrow(oq, "carryLocalOnly");
ok(!!carrySrc, "carryLocalOnly found in offlineQueue.js");
// eslint-disable-next-line no-new-func
const carry = carrySrc ? new Function(`return (${carrySrc});`)() : () => ({});

// Reopened at HQ from another computer: this PC knew it finished.
let out = carry(
  { id: "T", stage: "weighed_in", transaction_id: null, gross_kg: 12000, tare_kg: null },
  { id: "T", stage: "finalized", transaction_id: "OLD", pending_tx_id: "OLD", pending_tx_code: "RCP-1-A", gross_kg: 12000, gross_source: "scale", tare_kg: 4000, tare_source: "typed" },
);
ok(out.pending_tx_id === undefined && out.pending_tx_code === undefined, "T1: reopened ticket forgets the cancelled transaction id/code");
ok(out.gross_source === "scale", "T10: gross_source kept while the server weight is the same");
ok(out.tare_source === undefined, "T10: tare_source dropped when Reopen cleared the tare");

// Sent back on this device (discardStuckFinalize): keeps the pair (09-11 rule).
out = carry(
  { id: "T", stage: "weighed_out", transaction_id: null, gross_kg: 12000, tare_kg: 4000 },
  { id: "T", stage: "weighed_out", transaction_id: null, pending_tx_id: "TX", pending_tx_code: "RCP-2-A", gross_kg: 12000, tare_kg: 4000, tare_source: "scale" },
);
ok(out.pending_tx_id === "TX" && out.pending_tx_code === "RCP-2-A", "T1: a sent-back ticket keeps its one transaction id");
ok(out.tare_source === "scale", "T10: tare_source kept while the server tare is the same");

// Weight changed on another PC: the label no longer describes it.
out = carry(
  { id: "T", stage: "weighed_in", transaction_id: null, gross_kg: 12500 },
  { id: "T", stage: "weighed_in", gross_kg: 12000, gross_source: "typed" },
);
ok(out.gross_source === undefined, "T10: gross_source dropped when the weight changed elsewhere");

// ---- T2: server's existing transaction wins for receipt + payment --------
ok(/serverTxRow = serverTx;/.test(oq) && /SERVER_FIELDS/.test(oq) && /"amount"/.test(oq), "T2: finalizeTicketOffline overlays the server row's numbers");
ok(/if \(id && transactionId && amount != null\) \{[\s\S]{0,400}\.eq\("id", id\)\.is\("voided_at", null\)/.test(api), "T2: api.createPayment checks the server even when an id is supplied");
ok(/result\.id !== localPayId/.test(oq), "T2: a twin handed back by the server replaces the local preview in the payment cache");

// ---- T4: weigh-in/out times stamped at capture, not at sync -------------
ok(/grossAt: hasGross \? nowIso : undefined/.test(oq), "T4: createTicket op carries grossAt");
ok(/type: "setTicketTare", ticketId: id, payload: \{ tareKg, tareAt, userId \}/.test(oq), "T4: setTicketTare op carries tareAt");
ok(/type: "setTicketGross", ticketId: id, payload: \{ grossKg, grossAt, userId \}/.test(oq), "T4: setTicketGross op carries grossAt");
ok(/gross_at: hasGross \? \(grossAt \|\| getAccurateNow\(\)\.toISOString\(\)\) : null/.test(api), "T4: api.createTicket uses grossAt, server time only as fallback");
ok(/tare_at: tareAt \|\| getAccurateNow\(\)\.toISOString\(\)/.test(api), "T4: api.setTicketTare uses tareAt, server time only as fallback");

// ---- T10: source of each weight reaches the transaction -----------------
ok(/receiptPhotoUrl, grossSource, tareSource \} \}\);/.test(oq), "T10: finalize op carries grossSource/tareSource");
ok(/grossSource: grossSource === "scale" \|\| grossSource === "typed" \? grossSource : null/.test(api), "T10: api.finalizeTicket passes only allowed source values");
ok(/noteWeightSource\(ticket\.location_id, v, setTareSource\)/.test(wt) && /tareSource, userId: session\.user\.id \}/.test(wt), "T10: Finish records where the tare came from");

// ---- T6 / T9 / W6 --------------------------------------------------------
ok(/txCancelled \? \(/.test(tx) && /tx_undo_void_tx_cancelled/.test(tx), "T6: Undo void is not offered on a cancelled transaction");
ok(/_before: \{/.test(tx), "T9: a new change request records what each field said before");
ok(/type: weightsChanged \? tx\.type : undefined/.test(cr), "T9: approval passes type so weights re-derive the net");
ok(/const pick = \(k\) => \(changes\(k\) \? p\[k\] : rawNow\[k\]\);/.test(cr), "T9: unchanged fields go back as the row holds them now");
ok(/reject_reason: rejectReason \|\| null,\n\s*rejected_reason:/.test(cr), "W6: audit note uses reject_reason (old key kept for the trail reader)");

// ---- W8 / W9 ------------------------------------------------------------
// Comment lines stripped first — the dated notes themselves name the old code.
const code = (txt) => txt.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const printCounts = code(api.slice(api.indexOf("async getPrintCounts("), api.indexOf("async renameExpenseCategory(")));
ok(!/\.limit\(2000\)/.test(printCounts) && /fetchAll\(/.test(printCounts), "W8: print counts paged, no .limit(2000)");
const rename = code(api.slice(api.indexOf("async renameExpenseCategory("), api.indexOf("async getExpenseEdits(")));
ok(/fetchAll\(/.test(rename), "W8: category rename reads every expense row");
const resets = code(api.slice(api.indexOf("async getStockResetRequests("), api.indexOf("async getPendingStockReset(")));
ok(/fetchAll\(/.test(resets) && !/\.order\(/.test(resets), "W8: stock reset requests paged, no .order() inside");
const marks = code(api.slice(api.indexOf("async getExpenseDayMarks("), api.indexOf("async markExpenseDayEmpty(")));
ok(/fetchAll\(/.test(marks), "W8: expense day marks paged");
const createLoc = code(api.slice(api.indexOf("async createLocation("), api.indexOf("async createLocation(") + 600));
ok(!/updated_ago:/.test(createLoc), "W9: new locations no longer store updated_ago text");

console.log(failed ? `\n${failed} FAILED.` : "\nAll full-check (03/10) guards passed.");
process.exit(failed ? 1 : 0);
