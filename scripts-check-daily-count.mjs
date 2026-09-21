// scripts-check-daily-count.mjs — the evening stock count, end to end.
//
// [2026-09-21] SISEN: "what if its just staff reseting without anything and
// the hq didnt even bother to check". The answer is a routine, not a better
// form: every station counts every evening, small differences finish
// themselves, and only what is outside the allowance reaches HQ — which is
// what makes HQ read it. The rules live in daily_stock_count.sql; these are
// the ones that must never quietly change.
//
// Run: node scripts-check-daily-count.mjs

import { readFileSync } from "node:fs";
let failed = 0;
const ok = (n, c) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${n}`); if (!c) failed++; };
const sql = readFileSync("daily_stock_count.sql", "utf8");
const count = readFileSync("src/components/StockCountModal.jsx", "utf8");
const hq = readFileSync("src/pages/ChangeRequests.jsx", "utf8");
const api = readFileSync("src/api.js", "utf8");
const shrink = readFileSync("src/pages/ReportShrinkage.jsx", "utf8");

console.log("\nThe rule in the database");
ok("the difference is measured against the paddy BOUGHT since the last count",
   /create or replace function public\.bought_since_last_count/.test(sql) && /v_pct\s*:=\s*case when v_bought > 0/.test(sql));
ok("no buying since the last count means it can never apply itself",
   /v_pct is null and abs\(v_loss\) >= 0\.005/.test(sql));
ok("an Owner-only count is never applied automatically", /v_auto := not v_owner/.test(sql));
ok("emptying a shed the book says still holds paddy is Owner-only",
   /p_counted_kg = 0 and v_expected > v_pol\.owner_zero_book_kg/.test(sql));
ok("a photo is required once the difference is outside the allowance",
   /if not v_auto and v_pol\.require_photo/.test(sql));
ok("the Owner rule is enforced when approving too",
   /v_req\.requires_owner and not coalesce\(v_owner, false\)/.test(sql));
ok("approving still applies the difference to the stock AS IT IS NOW",
   /v_new_kg := greatest\(0, v_now_kg \+ \(v_req\.counted_kg - v_req\.book_kg_at_request\)\)/.test(sql));
ok("nobody answers their own count", /cannot approve your own count/.test(sql));
ok("the station guard still blocks every other way in, and only this function is let through",
   /current_setting\('paddytrade\.stock_write', true\)/.test(sql) && /Only head office can change a station/.test(sql));
ok("the limits live in one row that can be changed without a new app version",
   /create table if not exists public\.stock_count_policy/.test(sql));

console.log("\nThe screens");
ok("the count form is blind", !/station\.current_stock_kg/.test(count) && /sc_blind_note/.test(count));
ok("the app never decides — it sends one number", /api\.submitStockCount\(/.test(count) && !/tolerance/.test(count));
ok("api.submitStockCount calls the one function", /rpc\("submit_stock_count"/.test(api));
ok("the limits are read, not hardcoded in the screen", /getStockCountPolicy/.test(api) && /getStockCountPolicy/.test(hq));
ok("HQ sees the day's buying behind the count", /cr_sc_bought_since/.test(hq));
ok("HQ sees the loss as a percentage, with the allowance beside it", /cr_sc_pct_label/.test(hq) && /cr_sc_normal/.test(hq));
ok("HQ sees whether a photo came with it", /cr_sc_photo/.test(hq) && /cr_sc_no_photo/.test(hq));
ok("Shrinkage reports the loss as a percentage of the paddy bought",
   /rs_loss_pct_label/.test(shrink) && /lossPct\(/.test(shrink));
ok("the percentage divides by the SELECTED stations' buying only", /wanted\.size && !wanted\.has\(tx\.location_id\)/.test(shrink));

console.log("\nChange Requests: two tabs, not mixed");
ok("a Transaction tab and a Stock tab, each with its own count", /cr_tab_tx/.test(hq) && /cr_tab_stock/.test(hq) && /stockCounts\.pending/.test(hq));
ok("each tab has its own waiting / approved / rejected filter", /setTxFilter/.test(hq) && /setStFilter/.test(hq));
ok("the stock tab shows the automatic ones too", /stFilter === "auto"/.test(hq) && /cr_h_auto/.test(hq));
ok("the stock tab loads every status, not only pending", /getStockResetRequests\(\{\}\)/.test(hq));

console.log(failed ? `\n${failed} FAILED` : "\nThe evening count holds: measured against buying, small ones close themselves, the rest reach HQ.");
process.exit(failed ? 1 : 0);
