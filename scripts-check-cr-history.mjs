// scripts-check-cr-history.mjs — a decided change request still shows who
// decided it, when, and what the ticket said before.
//
// [2026-09-21] SISEN: "i noticed where are the old changes" and "before we
// could track the details on what have changed in details etc, and who
// accepted it". The page compared an approved request with the ticket as it
// is now — which already holds the new values — so it said "No field
// differences on file"; and decided requests were only ever this month's.
//
// Run: node scripts-check-cr-history.mjs
import { readFileSync } from "node:fs";
import { matchDecisions, beforeSide } from "./src/changeRequestTrail.js";

let failed = 0;
const ok = (name, cond) => { if (cond) console.log(`  ok    ${name}`); else { failed += 1; console.log(`  FAIL  ${name}`); } };

const tx = { id: "tx1", type: "BUY", quantity_kg: 5320, price_per_kg: 1150, amount: 6118000, parties: { name: "Sok" } };
const rows = [
  // two requests on the same ticket, both waiting at once, decided in the opposite order
  { id: "r1", transaction_id: "tx1", status: "approved", created_at: "2026-09-20T02:00:00Z", resolved_at: "2026-09-20T07:30:00Z", resolved_by: "u_sisen", transactions: tx, currentPartyName: "Sok" },
  { id: "r2", transaction_id: "tx1", status: "approved", created_at: "2026-09-20T03:00:00Z", resolved_at: "2026-09-20T05:00:00Z", resolved_by: null, transactions: tx, currentPartyName: "Sok" },
  { id: "r3", transaction_id: "tx2", status: "rejected", created_at: "2026-08-28T03:00:00Z", resolved_at: null, reject_reason: null, transactions: { id: "tx2" } },
  { id: "r4", transaction_id: "tx3", status: "approved", created_at: "2026-06-01T03:00:00Z", resolved_at: null, transactions: { id: "tx3" } },
  { id: "r5", transaction_id: "tx4", status: "pending", created_at: "2026-09-21T03:00:00Z", transactions: { id: "tx4" } },
];
const logs = [
  { action: "approve_change_request", record_id: "tx1", created_at: "2026-09-20T05:00:02Z", userName: "Dara HQ", old_data: { quantity_kg: 5230, amount: 6014500, partyName: "Sok" } },
  { action: "approve_change_request", record_id: "tx1", created_at: "2026-09-20T07:30:01Z", userName: "SISEN", old_data: { quantity_kg: 5300, amount: 6095000, partyName: "Sok" } },
  { action: "reject_change_request", record_id: "r3", created_at: "2026-08-28T09:00:00Z", userName: "SISEN", new_data: { rejected_reason: "Name is correct on the ID card" } },
];
const d = matchDecisions(rows, logs, { u_sisen: "SISEN" });
ok("each approval is matched to its own request by decision time", d.get("r1").before.quantity_kg === 5300 && d.get("r2").before.quantity_kg === 5230);
ok("who approved: the request's own resolved_by first", d.get("r1").byName === "SISEN");
ok("who approved: the Activity Log when resolved_by is empty", d.get("r2").byName === "Dara HQ");
ok("a rejection: who, when and why come from the log when the request has none", d.get("r3").byName === "SISEN" && d.get("r3").at === "2026-08-28T09:00:00Z" && d.get("r3").rejectReason === "Name is correct on the ID card");
ok("an old approval with no log entry says so instead of inventing values", d.get("r4").found === false && d.get("r4").before === null);
ok("waiting requests are not given a decision", !d.has("r5"));

ok("approved: compared against the ticket BEFORE, not the ticket now", beforeSide(rows[0], d.get("r1")).tx.quantity_kg === 5300);
ok("approved without a before on record: no comparison (null)", beforeSide(rows[3], d.get("r4")) === null);
ok("rejected: compared against the ticket now (it was never changed)", beforeSide(rows[2], d.get("r3")).tx.id === "tx2");

const page = readFileSync("src/pages/ChangeRequests.jsx", "utf8");
ok("the page offers This month / Last month / All time", /<PeriodSwitch period=\{period\} setPeriod=\{setPeriod\} t=\{t\} \/>/.test(page) && /\["all", t\("cr_p_all"\)\]/.test(page));
ok("counts follow the chosen period", /r\.status === "approved" && inMonth\(r\.created_at\)/.test(page) && /\[rows, thisMonthStr, period\]/.test(page));
ok("the waiting view lists the latest decided underneath", /txFilter === "pending" && txRecent\.length > 0/.test(page) && /stRecent\.length > 0/.test(page));
ok("a decided row has a Details button (it used to be a dash)", /t\(open \? "cr_hide_btn" : "cr_details_btn"\)/.test(page) && !/<span className="px-1 text-xs text-slate-300">—<\/span>/.test(page));
ok("the row names who approved or rejected", /t\(whoKey, \{ name: decision\?\.byName \|\| "—" \}\)/.test(page));
ok("decisions load after the list and never block it", /setRows\(list\);\s*loadDecisions\(list\);/.test(page));

console.log(failed ? `\n${failed} FAILED` : "\nEvery decided request shows who, when, and what changed.");
process.exit(failed ? 1 : 0);
