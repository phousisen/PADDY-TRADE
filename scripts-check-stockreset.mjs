// scripts-check-stockreset.mjs — a station asking HQ to write its stock down.
//
// [2026-09-17] SISEN: "i want each location to be able to reset their stock to
// 0 to get it as a stock loss, but will need hq above to confirm and accept
// it."
//
// This is the most destructive thing in PaddyTrade. One approval writes off a
// whole shed — 27 tonnes at JOMNOUM is 25.9 million riel — and there is no
// transaction behind it to check the figure against. So the failures worth
// guarding are not "does the button work":
//
//   · STOCK MOVING BEFORE HQ SAYS SO. The entire promise. If filing a request
//     can change a number, the approval is theatre.
//   · A BLANK BOX READ AS ZERO. "I have not typed it yet" and "the shed is
//     empty" must never be the same answer.
//   · A GAIN WRITTEN AS A NEGATIVE LOSS. value_lost is summed in four places;
//     a negative in it quietly cancels somebody else's real loss.
//   · APPROVING YOUR OWN. A two-person rule one person can satisfy is none.
//   · A VIEW-ONLY ACCOUNT STARTING ANY OF IT.
//
// Run: node scripts-check-stockreset.mjs

import { readFileSync } from "node:fs";
import {
  describeReset, validateCount, validateReason, validateRequest,
  canRequestReset, canResolveReset, MIN_REASON_CHARS,
} from "./src/stockReset.js";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};

const sql = readFileSync("stock_reset_requests.sql", "utf8");
const api = readFileSync("src/api.js", "utf8");
const modal = readFileSync("src/components/StockResetModal.jsx", "utf8");
const hq = readFileSync("src/pages/ChangeRequests.jsx", "utf8");
const stockPage = readFileSync("src/pages/StockInventory.jsx", "utf8");
const locPage = readFileSync("src/pages/LocationDetail.jsx", "utf8");
const i18n = readFileSync("src/i18n.jsx", "utf8");

console.log("\n1. The arithmetic — JOMNOUM's real shed");

// 27,055 kg on the book at 958.21 ៛/kg, counted empty.
const empty = describeReset({ bookKg: 27_055, countedKg: 0, pricePerKg: 958.21 });
ok("an empty shed is the whole book missing", empty.missingKg === 27_055, String(empty.missingKg));
ok("and it is a loss", empty.isLoss && !empty.isGain);
ok("priced in riel", empty.lossValue === Math.round(27_055 * 958.21), String(empty.lossValue));
ok("a loss never carries a gain figure", empty.gainValue === 0);

// 300 kg left — the case a zero-only button cannot express at all.
const some = describeReset({ bookKg: 27_055, countedKg: 300, pricePerKg: 958.21 });
ok("300 kg left is 26,755 missing, not 27,055", some.missingKg === 26_755, String(some.missingKg));
ok("and is worth less than an empty shed", some.lossValue < empty.lossValue);

// Reang Kesey settled a GAIN. This is the branch that corrupts reports.
const gain = describeReset({ bookKg: 1_000, countedKg: 1_035, pricePerKg: 1_000 });
ok("more than the book is a gain", gain.isGain && !gain.isLoss);
ok("a gain's LOSS is zero, never negative", gain.lossValue === 0, String(gain.lossValue));
ok("the gain is carried in its own field", gain.gainValue === 35_000, String(gain.gainValue));
ok("missingKg is 0 on a gain", gain.missingKg === 0);

const same = describeReset({ bookKg: 500, countedKg: 500, pricePerKg: 900 });
ok("counting exactly the book is no change", same.unchanged && !same.isLoss && !same.isGain);

const noPrice = describeReset({ bookKg: 27_055, countedKg: 0, pricePerKg: null });
ok("no price means no riel figure, not a confident zero",
   noPrice.hasPrice === false && noPrice.lossValue === 0);
ok("nothing is ever NaN or Infinity",
   Object.values(describeReset({})).every((v) => v === null || typeof v === "boolean" || Number.isFinite(v)),
   JSON.stringify(describeReset({})));

console.log("\n2. A blank box is not zero");

ok("empty is refused", validateCount("", { bookKg: 100 }).error === "empty");
ok("whitespace is refused", validateCount("   ", { bookKg: 100 }).error === "empty");
ok("but a typed 0 is accepted", validateCount("0", { bookKg: 100 }).ok === true);
ok("and a typed 0 really means 0", validateCount("0", { bookKg: 100 }).value === 0);
ok("letters are refused", validateCount("abc", { bookKg: 100 }).error === "not_a_number");
ok("negative is refused", validateCount("-5", { bookKg: 100 }).error === "negative");
ok("the book's own figure is refused — nothing to ask for",
   validateCount("100", { bookKg: 100 }).error === "unchanged");
ok("a typed thousands separator is understood", validateCount("27,055", { bookKg: 100 }).value === 27055);

console.log("\n3. Nobody writes off a shed without saying why");

ok("no reason is refused", validateReason("").error === "too_short");
ok("one character is refused", validateReason("x").error === "too_short");
ok("a short real reason is fine", validateReason("mill took it").ok === true);
ok(`the floor is ${MIN_REASON_CHARS} characters`, validateReason("a".repeat(MIN_REASON_CHARS)).ok === true);

const good = validateRequest({ count: "300", reason: "counted 17/09", bookKg: 27_055 });
ok("a complete form passes", good.ok === true);
ok("and hands back a number, not a string", good.countedKg === 300);
ok("a form with a number and no reason does not pass",
   validateRequest({ count: "300", reason: "", bookKg: 27_055 }).error === "too_short");
ok("a second request while one waits is refused in the browser too",
   validateRequest({ count: "0", reason: "empty shed", bookKg: 27_055, pendingRequest: { id: "x" } }).error === "already_pending");

console.log("\n4. Who may ask, and who may answer");

ok("a station account gets the button",
   canRequestReset({ isOwnStation: true }) === true);
ok("a VIEW-ONLY account never does",
   canRequestReset({ isViewOnly: true, isOwnStation: true }) === false,
   "this flag exists so family can look without being able to start anything");
ok("HQ does not — it sets the figure directly",
   canRequestReset({ canAdjustStock: true, isOwnStation: true }) === false);
ok("a role explicitly granted the permission does",
   canRequestReset({ hasRequestPermission: true }) === true);
ok("nobody else does", canRequestReset({}) === false);

ok("an approver may answer",
   canResolveReset({ canApprove: true, requestedBy: "a", viewerId: "b" }) === true);
ok("NOT their own request",
   canResolveReset({ canApprove: true, requestedBy: "a", viewerId: "a" }) === false,
   "a two-person rule one person can satisfy is not a rule");
ok("a view-only approver may not", canResolveReset({ canApprove: true, isViewOnly: true }) === false);
ok("someone without the permission may not", canResolveReset({ canApprove: false }) === false);

console.log("\n5. Filing a request cannot move stock");

// The one claim the whole feature rests on. Three independent readings of it.
ok("the request function never writes locations.current_stock_kg",
   !/create or replace function public\.request_stock_reset[\s\S]*?\$\$;/.exec(sql)[0].includes("update public.locations"),
   "request_stock_reset must only INSERT a row");
ok("it never calls record_stock_adjustment",
   !/create or replace function public\.request_stock_reset[\s\S]*?\$\$;/.exec(sql)[0].includes("record_stock_adjustment"));
ok("only the resolve function calls it",
   (sql.match(/perform public\.record_stock_adjustment/g) || []).length === 1);
ok("and only after checking the request was approved",
   /if not p_approve then[\s\S]*?return;[\s\S]*?end if;[\s\S]*?perform public\.record_stock_adjustment/.test(sql),
   "a rejection must return before anything moves");
ok("the browser's own request call writes no stock",
   /async requestStockReset[\s\S]*?\},/.exec(api)[0].includes("request_stock_reset") &&
   !/async requestStockReset[\s\S]*?\},/.exec(api)[0].includes("recordStockAdjustment"));

console.log("\n6. The database enforces what the screen only suggests");

ok("one pending request per station, as an index not a hope",
   /create unique index[\s\S]*?on public\.stock_reset_requests \(location_id\)[\s\S]*?where status = 'pending'/.test(sql));
ok("nobody writes the table directly",
   /revoke insert, update, delete on public\.stock_reset_requests from authenticated/.test(sql));
ok("row-level security is on", /alter table public\.stock_reset_requests enable row level security/.test(sql));
ok("a station sees its own location and no other",
   /p\.location_id = stock_reset_requests\.location_id/.test(sql));
ok("approving is permission-checked in the database",
   /resolve_stock_reset[\s\S]*?approve_change_requests/.test(sql));
ok("self-approval is blocked in the database",
   /v_req\.requested_by = auth\.uid\(\)[\s\S]*?raise exception/.test(sql));
ok("a view-only account is blocked in the database",
   /view_only[\s\S]*?raise exception 'A view-only account cannot request/.test(sql));
ok("a negative count is refused before it is stored",
   /p_counted_kg < 0[\s\S]*?raise exception/.test(sql));
ok("the book figure is read under lock, not taken from the browser",
   /select current_stock_kg into v_book[\s\S]*?for update/.test(sql));
ok("the counted figure comes from the request row, never a parameter of resolve",
   /p_new_stock_kg  => v_req\.counted_kg/.test(sql),
   "HQ approves the figure the station asked for — not one typed at approval time");
ok("only pending requests can be answered", /v_req\.status <> 'pending'[\s\S]*?raise exception/.test(sql));
ok("a station can only withdraw its own", /requested_by = auth\.uid\(\)/.test(sql));

console.log("\n7. The screens");

ok("the station modal asks for no password",
   !/signInWithPassword/.test(modal),
   "HQ approval IS the second person — a password here teaches the wrong habit");
ok("it shows the riel figure, not only kilograms", /fmtRiel\(d\.lossValue\)/.test(modal));
ok("a station with one waiting sees the receipt, not the form",
   /if \(pending\) \{/.test(modal));
ok("zero is one tap", /setCounted\("0"\)/.test(modal));
ok("but the box does not start at zero", /useState\(""\)/.test(modal));
ok("HQ's card leads with riel", /text-\[19px\] font-extrabold[\s\S]{0,200}fmtRiel/.test(hq));
ok("HQ is told when no price could be put on the loss", /sr_no_price_warning/.test(hq));
ok("HQ's approve button is disabled on your own request", /disabled=\{busy \|\| isOwn\}/.test(hq));
ok("rejecting requires a reason", /disabled=\{busy \|\| !why\.trim\(\)\}/.test(hq));
ok("the Stock page offers the button to stations", /canAskReset/.test(stockPage));
ok("and the Location page too", /canAskReset/.test(locPage));
ok("neither page shows a station the direct Adjust button",
   /canAdjustStock \? \(/.test(stockPage) && /!canAdjustStock && canAskReset/.test(locPage));

console.log("\n8. Khmer");

// Standing rule: if the app is in Khmer, everything is in Khmer.
const keys = [...new Set((modal + hq + stockPage + locPage).match(/t\("(sr_[a-z_]+|col_ask_reset)"/g) || [])]
  .map((m) => m.slice(3, -1));
ok("every new key the screens use exists", keys.length > 0);
const kmBlock = i18n.slice(i18n.indexOf("\n  km: {"));
const enBlock = i18n.slice(i18n.indexOf("\n  en: {"), i18n.indexOf("\n  km: {"));
for (const k of keys) {
  ok(`  ${k} — English`, new RegExp(`\\b${k}:`).test(enBlock));
  ok(`  ${k} — Khmer`, new RegExp(`\\b${k}:`).test(kmBlock));
}
// A Khmer entry that is still English is worse than a missing one: it looks done.
const kmLines = kmBlock.split("\n").filter((l) => /^\s+(sr_[a-z_]+|col_ask_reset):/.test(l));
const stillEnglish = kmLines.filter((l) => {
  const v = l.slice(l.indexOf(":") + 1);
  return /"[A-Za-z][^"]{3,}"/.test(v) && !/[ក-៿]/.test(v);
});
ok("no Khmer entry is still English", stillEnglish.length === 0, stillEnglish.join("\n          "));

console.log("\n9. The permission exists to be granted");

const perms = readFileSync("src/permissions.js", "utf8");
ok("request_stock_reset is in the catalog", /request_stock_reset/.test(perms));
ok("and is separate from adjust_stock", /adjust_stock[\s\S]*?request_stock_reset/.test(perms));

console.log(failed ? `\n${failed} FAILED\n` : "\nall ok\n");
process.exit(failed ? 1 : 0);
