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
