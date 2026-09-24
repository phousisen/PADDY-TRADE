// Guard for canSettle() — the single function that decides whether a stock
// difference may be written off in one click. Every case below is a way this
// could quietly cost real money, so it is tested rather than eyeballed.
// npm is blocked in this environment, so the function is re-read from source
// rather than imported through a bundler.
import { readFileSync } from "fs";

const src = readFileSync("src/components/SettleDifferenceModal.jsx", "utf8");
const start = src.indexOf("export function canSettle");
const end = src.indexOf("\n}", start) + 2;
const body = src.slice(start, end).replace("export function", "function");
// eslint-disable-next-line no-new-func
const canSettle = new Function(`${body}; return canSettle;`)();

const JOMNOUM = { floorKg: 495, avgKg: 2065, ticketCount: 565, enoughHistory: true };
const KOYUN   = { floorKg: 300, avgKg: 900,  ticketCount: 120, enoughHistory: true };
const NEW     = { floorKg: 8000, avgKg: 8500, ticketCount: 3, enoughHistory: false };

const cases = [
  // [name, onHandKg, floor, expected]
  ["Reang Kesey's real −35 settles",              -35,      KOYUN,     true],
  ["Jomnoum's real −21,345 is refused",           -21345,   JOMNOUM,   false],
  ["exactly at the floor is refused (not <)",     -495,     JOMNOUM,   false],
  ["one kg under the floor settles",              -494,     JOMNOUM,   true],
  ["one kg over the floor is refused",            -496,     JOMNOUM,   false],
  ["a POSITIVE small figure is never settled",     35,      KOYUN,     false],
  ["a positive big figure is never settled",       13755,   JOMNOUM,   false],
  ["exactly zero is nothing to settle",            0,       JOMNOUM,   false],
  ["floating-point noise is not a difference",    -0.001,   JOMNOUM,   false],
  ["a station with too little history: refused",  -35,      NEW,       false],
  ["no floor row at all (RPC not installed)",     -35,      undefined, false],
  ["null floor",                                  -35,      null,      false],
  ["floor of zero cannot authorise anything",     -35,      { floorKg: 0, avgKg: 0, ticketCount: 99, enoughHistory: true }, false],
  ["negative floor (corrupt data) refuses",       -35,      { floorKg: -5, avgKg: 10, ticketCount: 99, enoughHistory: true }, false],
  ["NaN on hand refuses",                          NaN,     JOMNOUM,   false],
];

let failed = 0;
for (const [name, kg, floor, want] of cases) {
  const got = canSettle(kg, floor);
  if (got !== want) { console.error(`FAIL  ${name} — expected ${want}, got ${got}`); failed++; }
}
if (failed) { console.error(`\n${failed} of ${cases.length} settle checks FAILED.`); process.exit(1); }
console.log(`Checked ${cases.length} settle cases — small negatives settle, everything else is refused.`);

// [2026-09-24] SISEN: "not everything sotck should be reset to 0, it should be
// able to adjust as well for stock left overnight" and "it doesnt have the
// option to set a date for a reset. like yesterday".
console.log("");
console.log("Setting a station's stock by hand");
const rd = (f) => readFileSync(f, "utf8");
let f2 = 0;
const ok = (name, pass) => { if (pass) { console.log(`  ok    ${name}`); } else { console.error(`  FAIL  ${name}`); f2 += 1; } };
const dash = rd("src/pages/Dashboard.jsx");
const adj = rd("src/components/AdjustStockModal.jsx");
ok("a NEGATIVE station still gets the one-tap settle/fix button",
   /onHandKg < -0\.005 \? \(/.test(dash) && /perf_fix_btn/.test(dash));
ok("every OTHER station gets a control too (leftover stock is positive)",
   /perf_set_stock_btn/.test(dash) && /setAdjustLoc\(\{ loc, onHandKg \}\)/.test(dash));
ok("looking at a past period no longer hides every control",
   !/canSettleRole && periodEndsToday/.test(dash));
ok("the Dashboard reuses the SAME adjust screen, not a second one",
   /import \{ AdjustStockModal \}/.test(dash));
ok("the modal it opens is given the ledger figure the row shows",
   /current_stock_kg: adjustLoc\.onHandKg/.test(dash));
ok("the adjust screen can date the change (today / yesterday / a date)",
   /settle_date_today/.test(adj) && /settle_date_yesterday/.test(adj) && /khOldestAllowed/.test(adj));
ok("...and no further back than 7 days", /khDaysAgo\(7\)/.test(adj));
ok("...in Cambodia's calendar, not the viewer's", /timeZone: "Asia\/Phnom_Penh"/.test(adj));
ok("a change dated today still saves exactly as before (null)",
   /effectiveDate !== khToday \? effectiveDate : null/.test(adj));
ok("'Reset to 0' is still one tap when the shed really is empty", /adj_reset_to_zero/.test(adj));
for (const f of ["src/pages/StockInventory.jsx", "src/pages/LocationDetail.jsx", "src/pages/Dashboard.jsx"]) {
  ok(`${f.split("/").pop()} passes the date through to the database`,
     /effectiveDate/.test(rd(f)));
}
if (f2) { console.error(`\n${f2} FAILED.`); process.exit(1); }
console.log("\nA station's stock can be set to any figure, for any of the last 7 days.");
