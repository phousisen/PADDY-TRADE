// scripts-check-station-stock.mjs — the station's stock count on its Dashboard.
// [2026-09-20] SISEN: stations must be able to reset to 0 or enter the weighed
// leftover from the Dashboard, and nothing they do may change stock until HQ
// approves. Run: node scripts-check-station-stock.mjs
import { readFileSync } from "node:fs";
const { canAdjustDirectly } = await import("./src/stockReset.js");
let failed = 0;
const ok = (n, c) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${n}`); if (!c) failed++; };
const src = (f) => readFileSync(`src/${f}`, "utf8");

console.log("\nWho may change stock directly");
ok("HQ admin: yes", canAdjustDirectly({ isAdmin: true, roleScope: "all" }));
ok("HQ role with adjust_stock: yes", canAdjustDirectly({ hasAdjustPermission: true, roleScope: "all" }));
ok("station role WITH adjust_stock: no — it must ask", !canAdjustDirectly({ hasAdjustPermission: true, roleScope: "own_location" }));
ok("view-only: no", !canAdjustDirectly({ isAdmin: true, roleScope: "all", isViewOnly: true }));
for (const f of ["pages/StockInventory.jsx", "pages/LocationDetail.jsx"]) {
  ok(`${f} uses the HQ-only rule`, /canAdjustDirectly\(\{/.test(src(f)) && !/const canAdjustStock = \(isAdmin \|\| hasPermission\("adjust_stock"\)\)/.test(src(f)));
}

console.log("\nThe Dashboard card");
const card = src("components/StationStockCard.jsx");
const dash = src("pages/Dashboard.jsx");
ok("the card only ever files a request", /api\.requestStockReset\(/.test(card) && !/recordStockAdjustment/.test(card));
ok("Reset to 0 opens the form with 0 in it", /setModal\(\{ initialCount: "0" \}\)/.test(card));
ok("the form accepts a starting count", /initialCount = ""/.test(src("components/StockResetModal.jsx")));
ok("withdraw needs a second tap", /if \(!confirmWithdraw\) \{ setConfirmWithdraw\(true\); return; \}/.test(card));
ok("Dashboard shows the card to station accounts", /<StationStockCard/.test(dash) && /const isStationView = !isAdmin && !!profile\?\.location_id;/.test(dash));
ok("stations do not get Active locations or the one-row performance table", /\{!isStationView && \(\s*<>/.test(dash) && /\{!isStationView && \(\s*<div className="overflow-hidden rounded-2xl/.test(dash));
ok("settling on the Dashboard is HQ-only", /canSettleRole = isAdmin && !isViewOnly && profile\?\.roleScope === "all"/.test(dash));

console.log(failed ? `\n${failed} FAILED` : "\nStations ask; only HQ changes stock.");
process.exit(failed ? 1 : 0);
