// scripts-check-reversal.mjs — undoing a wrong stock reset, and the ledger.
// [2026-09-21] SISEN: "why cant we undo the wrong reset ... it needs proper
// reason and alert with password", and "we dont have anywhere to track data
// on reset of gained". Run: node scripts-check-reversal.mjs
import { readFileSync } from "node:fs";
let failed = 0;
const ok = (n, c) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${n}`); if (!c) failed++; };
const sql = readFileSync("stock_reversal.sql", "utf8");
const api = readFileSync("src/api.js", "utf8");
const led = readFileSync("src/components/StockAdjustmentsLedger.jsx", "utf8");
const inv = readFileSync("src/pages/StockInventory.jsx", "utf8");

console.log("\nThe database");
ok("Owner only", /Only the Owner can undo a stock adjustment/.test(sql));
ok("never view-only", /This account is view-only/.test(sql));
ok("a proper reason (15+ characters)", /length\(trim\(coalesce\(p_reason, ''\)\)\) < 15/.test(sql));
ok("once only — and a reversal is never reversed", /stock_adjustments_one_reversal/.test(sql) && /A reversal cannot itself be reversed/.test(sql) && /already been reversed/.test(sql));
ok("lands on the SAME business day, so that day's loss cancels", /p_effective_date => case when v_day </.test(sql));
ok("the after-midnight reset rule decides that day", /v_orig\.reason = 'reset' and extract\(hour/.test(sql));
ok("not older than 14 days, never into a closed period", /more than 14 days old/.test(sql) && /current_closed_through/.test(sql));
ok("nothing is deleted — the original is marked, not removed", !/delete from public\.stock_adjustments/i.test(sql) && /set reversed_at = now\(\)/.test(sql));

console.log("\nThe app");
ok("every screen leaves an undone pair out, so figures read as if it never happened",
   /includeReversed = false/.test(api) && /!a\.reversed_at && !a\.reverses_adjustment_id/.test(api));
ok("only the ledger asks for them", /includeReversed: true/.test(led));
ok("the ledger shows gains, not only losses", /sl_gained/.test(led) && /kind === "gain"/.test(led));
ok("Lost / Gained / Undone / Net, with Net as % of paddy bought", ["sl_lost", "sl_gained", "sl_reversed", "sl_net_pct"].every((k) => led.includes(k)));
ok("an undone original is in no total", /"gone" \(an undone original\) is in no total/.test(led));
ok("Undo is Owner-only on screen too", /if \(!isOwner \|\| isViewOnly\) return false;/.test(led));
ok("Undo needs the reason AND the password", /reason\.trim\(\)\.length >= MIN_REASON && password\.length > 0/.test(led) && /signInWithPassword\(\{ email: userEmail, password \}\)/.test(led));
ok("the Stock page uses the ledger", /<StockAdjustmentsLedger/.test(inv));

console.log(failed ? `\n${failed} FAILED` : "\nA wrong reset can be undone, once, by the Owner, with a reason — and gains are finally on the page.");
process.exit(failed ? 1 : 0);
