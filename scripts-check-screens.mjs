// scripts-check-screens.mjs — the screen fixes of 19 September 2026.
//
// [2026-09-19] SISEN: "how about we fix all". These are the findings from
// reading the ~30 smaller screens line by line. Each check below names the
// finding it holds in place, so a later edit that quietly undoes one fails
// here instead of on a station.
//
// Reads code, not the database. Run: node scripts-check-screens.mjs

import { readFileSync } from "node:fs";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};
const src = (f) => readFileSync(`src/${f}`, "utf8");

console.log("\nMoney and records");
const reg = src("pages/RegisterPartyStaff.jsx");
ok("F5  a re-save does not move 'verified' to today",
   !/const verifiedStamp = isVerifiable \?/.test(reg) && /stampNow = isVerifiable && \(!orig \|\| \(bankChanged \? freshQr : !wasVerified\)\)/.test(reg));
ok("F6  the bank-change 'before' is the record as opened, not this device's cache",
   /const orig = editingId \? openedParty : null;/.test(reg) && !/const orig = idx >= 0 \? list\[idx\] : null;/.test(reg));
ok("F6  server search results win over the cached copy",
   /\[\.\.\.byName, \.\.\.byPhone, \.\.\.cacheMatches\]/.test(reg));
ok("F24 the 'Verified' badge needs verified_at", /notVerified = !missingBank && !p\.verified_at/.test(reg));

const party = src("pages/PartyDetail.jsx");
ok("F18 a failed load is shown, not 'Loading…' forever", /\.catch\(\(err\) => \{\s*if \(alive\) setLoadError/.test(party));
ok("F18 a failed payments load is not swallowed", !/getPayments\([^)]*\)\.catch\(\(\) => \[\]\)/.test(party));
ok("F9  the total includes tax, like paid and unpaid", /amount: active\.reduce\(\(s, r\) => s \+ billOf\(r\), 0\)/.test(party));

const api = src("api.js");
ok("new accounts: the role/station update must really change a row",
   /async function applyNewAccountProfile[\s\S]{0,1200}data\.length === 1/.test(api) &&
   (api.match(/await applyNewAccountProfile\(userId, patch\)/g) || []).length === 2);
ok("zero-row updates say what happened, not 'cannot coerce'",
   (api.match(/throw friendlyWriteError\(error\)/g) || []).length >= 6);

const roles = src("pages/RolesPage.jsx");
ok("F16 moving someone between roles keeps the old admin/staff column in step and logs it",
   /updateProfileRole\(profileId, \{ roleId: newRoleId, role: legacyRole \}\)/.test(roles) && /action: "change_role"/.test(roles));

const close = src("components/MonthlyClosePanel.jsx");
ok("F17 the running month cannot be closed",
   /!closed && !running && ready && canClose/.test(close) && /if \(isRunning\(month\)\) \{ setError/.test(close));

console.log("\nDates and clocks");
const banner = src("components/UpdateBanner.jsx");
ok("F28 an HQ push is not judged by this PC's clock", !banner.includes("openedAt") && banner.includes("seenReloadAt"));
const locs = src("pages/LocationsPage.jsx");
ok("F7  Locations periods are Cambodia dates compared as text",
   !/setHours\(0, 0, 0, 0\)/.test(locs) && /String\(tx\.tx_date \|\| ""\)\.slice\(0, 10\) < start/.test(locs));
const shr = src("pages/ReportShrinkage.jsx");
ok("F11 shrinkage dates a count by the shared after-midnight rule", /effectiveAdjDateStr\(a\) >= startDate/.test(shr));
const stock = src("pages/ReportStock.jsx");
ok("F8  the stock movement balance is carried from the start and includes counts",
   /getStockAdjustments\(/.test(stock) && /asAt = \{ \.\.\.range, from: undefined \}/.test(stock));

console.log("\nFailures that looked like success");
const sv = src("components/StationVersions.jsx");
ok("F19 a dropped connection does not hide Station Health for good",
   /catch \(err\) \{[\s\S]{0,700}permission denied[\s\S]{0,200}else setError\(t\("st_load_stale"\)\)/.test(sv));
ok("F25 Station Health does not download every transaction every 30 s", /getTransactions\(\{ from: sinceStr \}\)/.test(sv));
const days = src("components/StationDaysReview.jsx");
ok("F20 the days check looks back far enough for last month", /getDaysAwaitingHq\(62\)/.test(days));
ok("F20 a failed days check is said, not hidden", /setLoadFailed\(true\)/.test(days));
const dc = src("pages/DataCheck.jsx");
ok("F21 no 'all clear' over a failed re-check", /mismatches\.length === 0 && !error && !loading/.test(dc));
const fs = src("pages/FinanceStart.jsx");
ok("F22 'nothing entered' is not claimed from a failed load", !/p\.then\(\(v\) => v\)\.catch\(\(\) => d\)/.test(fs));
const rep = src("pages/Reports.jsx");
ok("F22 the Excel export does not silently drop capital, loans or counts", !/getBankLoans\(\)\.catch\(\(\) => \[\]\)/.test(rep));
for (const f of ["pages/LocationDetail.jsx", "pages/StockInventory.jsx"]) {
  ok(`F2  ${f}: a failed stock-count load is said`, /adjLost = true/.test(src(f)) && /setAdjFailed\(adjLost\)/.test(src(f)));
}
const login = src("pages/Login.jsx");
ok("F26 no internet is not reported as a wrong password", /netErr \? t\("login_error_network"\)/.test(login));

console.log("\nFilters");
for (const f of ["ReportPayables", "ReportReceivables", "ReportShrinkage", "ReportStock", "ReportTax", "ReportAuditLog"]) {
  ok(`F12 ${f}: only the newest request fills the page`, /const my = \+\+loadSeq\.current;/.test(src(`pages/${f}.jsx`)));
}
for (const f of ["ReportPurchases", "ReportSales", "ReportOverview"]) {
  ok(`F12 ${f}: a stale answer is dropped`, /return \(\) => \{ alive = false; \};/.test(src(`pages/${f}.jsx`)));
}
const lf = src("components/LocationFilter.jsx");
ok("F1  the station button shows several stations as several", /many \? t\("st_stations_n"/.test(lf));
const al = src("pages/ReportAuditLog.jsx");
ok("F29 the activity log follows the station filter", /wanted\.has\(l\.userLocationId\)/.test(al));
ok("F29 every action the app logs has a label", ["void_payment", "set_password", "adjust_stock", "approve_stock_reset", "update_party_bank", "reopen_ticket"].every((a) => al.includes(a)));
const drf = src("components/DateRangeFilter.jsx");
ok("F13 a one-sided date range reads 'From …' / 'Until …'", /t\("drf_from"/.test(drf) && /t\("drf_until"/.test(drf));

console.log("\nView-only");
const top = src("components/Topbar.jsx");
ok("a shared view-only login cannot change the password, 2FA or sign every phone out",
   /function AccountSecurityModal[\s\S]{0,600}const \{ isViewOnly \} = useAuth\(\)/.test(top) && /\{isViewOnly \? \(/.test(top));
ok("F15 Users hides write controls", /if \(!writable\) return false;/.test(src("pages/UsersPage.jsx")));
ok("F15 Roles opens read-only (and all-station roles for non-Owners)", /readOnly=\{isViewOnly \|\| \(!isOwner && editing\.scope === "all"\)\}/.test(roles));
ok("F15 Settings locks its fields", /<fieldset disabled=\{isViewOnly\}/.test(src("pages/SettingsPage.jsx")));
ok("F15 Change Requests hides approve/reject", (src("pages/ChangeRequests.jsx").match(/readOnly=\{isViewOnly\}/g) || []).length === 2);
ok("F15 Capital hides its entry forms", /\{!isViewOnly && <AddCapitalEntryForm/.test(src("pages/ReportCapital.jsx")));

console.log("\nOther");
ok("F27 the 'edited' history is not cut at 20 rows", /getRowHistory\(\{ recordId: transactionId, limit: 500 \}\)/.test(src("components/EditedBadge.jsx")));
for (const f of ["pages/StockInventory.jsx", "pages/LocationDetail.jsx"]) {
  ok(`F14 ${f}: the logged 'before' is the database's`, /saved\?\.previous_stock_kg \?\? previousStockKg/.test(src(f)));
}

console.log(failed ? `\n${failed} FAILED` : "\nEvery screen fix of 19 September is in place.");
process.exit(failed ? 1 : 0);
