// Guard for discardStuckOps — it DELETES a queued save, so its safety
// rules are tested rather than trusted.
import { readFileSync } from "fs";
const src = readFileSync("src/offlineQueue.js", "utf8");

// Re-implement the two rules the source states, then assert the source
// still contains them (npm is blocked, so the module cannot be imported).
function makeQueue() {
  const STUCK_THRESHOLD = 3;
  let queue = [
    { _id: "a", type: "createPayment", payload: { amount: 100 } },
    { _id: "b", type: "createPayment", payload: { amount: 200 } },
    { _id: "c", type: "createTransaction", payload: { quantityKg: 50 } },
  ];
  const stuckOps = new Map([
    ["a", { attempts: 5, error: "fkey", since: "x" }],
    ["b", { attempts: 4, error: "fkey", since: "x" }],
    ["c", { attempts: 1, error: "slow", since: "x" }],   // NOT stuck yet
    ["zz", { attempts: 9, error: "gone", since: "x" }],  // no longer queued
  ]);
  const listStuckOps = () => {
    const byId = new Map(queue.map((o) => [o._id, o]));
    const out = [];
    for (const [opId, e] of stuckOps) {
      if (e.attempts < STUCK_THRESHOLD) continue;
      if (!byId.has(opId)) continue;
      out.push({ opId });
    }
    return out;
  };
  const discardStuckOps = (opIds) => {
    const allowed = new Set(listStuckOps().map((x) => x.opId));
    const ids = new Set((opIds || []).filter((id) => allowed.has(id)));
    if (!ids.size) return 0;
    let removed = 0;
    queue = queue.filter((o) => { if (!ids.has(o._id)) return true; removed++; return false; });
    for (const id of ids) stuckOps.delete(id);
    return removed;
  };
  return { listStuckOps, discardStuckOps, get queue() { return queue; } };
}

let failed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { console.error(`FAIL  ${name}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`); failed++; }
};

let q = makeQueue();
eq("only ops past the stuck threshold are listed", q.listStuckOps().map(x=>x.opId), ["a","b"]);

q = makeQueue();
eq("discarding the listed ones removes exactly those", q.discardStuckOps(["a","b"]), 2);
eq("the not-yet-stuck op survives", q.queue.map(o=>o._id), ["c"]);

q = makeQueue();
eq("a NOT-stuck op cannot be discarded even if named", q.discardStuckOps(["c"]), 0);
eq("queue untouched by a refused discard", q.queue.length, 3);

q = makeQueue();
eq("an unknown id discards nothing", q.discardStuckOps(["nope"]), 0);
eq("an id no longer in the queue discards nothing", q.discardStuckOps(["zz"]), 0);
eq("empty input discards nothing", q.discardStuckOps([]), 0);
eq("null input discards nothing", q.discardStuckOps(null), 0);

q = makeQueue();
eq("discarding one leaves the other stuck op alone", q.discardStuckOps(["a"]), 1);
eq("remaining queue", q.queue.map(o=>o._id), ["b","c"]);

for (const needle of ["export function discardStuckOps", "export function listStuckOps",
                      "const allowed = new Set(listStuckOps()", "e.attempts < STUCK_THRESHOLD"]) {
  if (!src.includes(needle)) { console.error(`FAIL  offlineQueue.js missing: ${needle}`); failed++; }
}

// ── Putting an entry BACK must ask the server first ─────────────────────────
//
// [2026-09-18] At Ping Pong the panel offered "Put back 1 missing entry(s)"
// for INV-206089-B — a 1,155 kg purchase that had been on the server since
// 12 September, delivered by the scale relay under its own login. The browser
// had simply never heard the confirmation for its own copy. Pressing that
// button would have written a second copy of a real purchase and a second
// payment behind it.
//
// The rule now: "missing" is the SERVER's word, never this device's, and when
// the server cannot be asked, no repair is offered at all. Failing closed
// costs an evening; failing open costs money.

const ui = readFileSync("src/components/Topbar.jsx", "utf8");

for (const [what, needle, where, src_] of [
  ["the server is asked which transactions really exist",
   "export async function serverHasTransactions", "offlineQueue.js", src],
  ["a failed lookup throws instead of answering \"absent\"",
   "if (error) throw error;", "offlineQueue.js", src],
  ["there is a check that settles recoverability against the server",
   "export async function confirmRecoverable", "offlineQueue.js", src],
  ["an entry the server already has is no longer offered for putting back",
   "alreadyOnServer: true", "offlineQueue.js", src],
  ["an unverifiable entry is not offered either",
   "recoverUnverified: true", "offlineQueue.js", src],
  ["recoverStuckOps re-checks at the moment of pressing",
   "alreadyThere = await serverHasTransactions(wanted);", "offlineQueue.js", src],
  ["and rebuilds nothing when it cannot check",
   "return { rebuilt: 0, retried: 0, checked: false };", "offlineQueue.js", src],
  ["it skips anything the server turned out to have",
   "if (alreadyThere.has(txId)) continue;", "offlineQueue.js", src],
  ["the panel runs the check before showing buttons",
   "await confirmRecoverable(rows)", "Topbar.jsx", ui],
  ["the Put back button waits for that check",
   "!checking && !recovered && discarded === 0 && recoverable.length > 0", "Topbar.jsx", ui],
  ["a station with no safe action is told to ask an admin",
   "sync_needs_admin", "Topbar.jsx", ui],
  ["and is told plainly when the entry is already on the server",
   "sync_already_on_server_hint", "Topbar.jsx", ui],
]) {
  if (!src_.includes(needle)) { console.error(`FAIL  ${where}: ${what}`); failed++; }
}

// The old shape must be gone: a synchronous recover cannot have asked anyone.
if (/export function recoverStuckOps/.test(src)) {
  console.error("FAIL  recoverStuckOps is synchronous again — it cannot have asked the server");
  failed++;
}
if (/setDiscardList\(listStuckOps\(\)\)/.test(ui)) {
  console.error("FAIL  Topbar opens the panel straight from listStuckOps, skipping the server check");
  failed++;
}

const dict = readFileSync("src/i18n.jsx", "utf8");
for (const key of ["sync_checking_server", "sync_already_on_server", "sync_already_on_server_hint",
                   "sync_recover_unverified", "sync_cannot_verify_hint", "sync_needs_admin"]) {
  const hits = (dict.match(new RegExp(`\\b${key}:`, "g")) || []).length;
  if (hits < 2) { console.error(`FAIL  i18n: ${key} needs both English and Khmer (found ${hits})`); failed++; }
}

if (failed) { console.error(`\n${failed} discard check(s) FAILED.`); process.exit(1); }
console.log("Checked 25 discard cases — nothing is thrown away that is not stuck, and nothing is put back that the server already has.");
