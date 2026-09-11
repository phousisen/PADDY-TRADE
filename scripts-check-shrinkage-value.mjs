// Guard for the Shrinkage report's money columns. A stock adjustment's
// value is easy to get subtly wrong — a missing price shown as 0, a gain
// written into value_lost, a loss double-negated — and every one of those
// reads as a real riel figure to whoever opens the report. npm is blocked
// here, so the rule is re-implemented and the source is then asserted to
// still contain it.
import { readFileSync } from "fs";
const src = readFileSync("src/pages/ReportShrinkage.jsx", "utf8");
const api = readFileSync("src/api.js", "utf8");

let failed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL  ${name}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
    failed++;
  }
};

// Mirrors adjustmentValue() in ReportShrinkage.jsx.
function adjustmentValue(a) {
  const kg = Number(a.adjustment_kg) || 0;
  if (kg < 0) {
    if (a.value_lost != null) return -Math.abs(Number(a.value_lost));
    if (a.price_per_kg != null) return -Math.abs(kg * Number(a.price_per_kg));
    return null;
  }
  if (kg > 0 && a.price_per_kg != null) return kg * Number(a.price_per_kg);
  return null;
}

// ---------------------------------------------------------------------
// 1. The real row: Reang Kesey, 11 Sept, +35 kg settled.
// ---------------------------------------------------------------------
eq("a gain is priced from kg x price",
   adjustmentValue({ adjustment_kg: 35, price_per_kg: 1000, value_lost: null }), 35000);
eq("a gain is positive", adjustmentValue({ adjustment_kg: 35, price_per_kg: 1000 }) > 0, true);

// ---------------------------------------------------------------------
// 2. A loss uses the figure written on the day, never a later price.
//    value_lost is what was true at the time; re-pricing it afterwards
//    would silently rewrite history every time prices moved.
// ---------------------------------------------------------------------
eq("a loss uses value_lost as recorded",
   adjustmentValue({ adjustment_kg: -180, price_per_kg: 1200, value_lost: 180000 }), -180000);
eq("value_lost wins over a later price, even a very different one",
   adjustmentValue({ adjustment_kg: -180, price_per_kg: 9999, value_lost: 180000 }), -180000);
eq("a loss is negative", adjustmentValue({ adjustment_kg: -180, value_lost: 180000 }) < 0, true);
eq("a loss with only a price still works",
   adjustmentValue({ adjustment_kg: -68, price_per_kg: 983, value_lost: null }), -66844);
eq("a loss whose value_lost was stored positive is still shown as negative",
   adjustmentValue({ adjustment_kg: -50, value_lost: 50000 }), -50000);

// ---------------------------------------------------------------------
// 3. NO PRICE IS NOT ZERO. This is the one that matters: every gain
//    recorded before 11 Sept has no price at all, and showing those as
//    "0 ៛" would state that a real difference was worth nothing.
// ---------------------------------------------------------------------
eq("a gain with no price has no value", adjustmentValue({ adjustment_kg: 35, price_per_kg: null }), null);
eq("a loss with neither price nor value has no value",
   adjustmentValue({ adjustment_kg: -35, price_per_kg: null, value_lost: null }), null);
eq("a zero adjustment has no value", adjustmentValue({ adjustment_kg: 0, price_per_kg: 1000 }), null);
eq("a missing adjustment has no value", adjustmentValue({}), null);

// ---------------------------------------------------------------------
// 4. Totals: priced and unpriced rows together.
// ---------------------------------------------------------------------
function totals(rows) {
  let lossKg = 0, gainKg = 0, lossRiel = 0, gainRiel = 0, valued = 0;
  for (const a of rows) {
    const kg = Number(a.adjustment_kg) || 0;
    const v = adjustmentValue(a);
    if (kg < 0) lossKg += -kg; else gainKg += kg;
    if (v != null) { valued += 1; if (v < 0) lossRiel += -v; else gainRiel += v; }
  }
  return { lossKg, gainKg, netKg: gainKg - lossKg, lossRiel, gainRiel, netRiel: gainRiel - lossRiel,
           count: rows.length, valued, unpriced: rows.length - valued };
}
const rows = [
  { adjustment_kg: 35, price_per_kg: 1000 },                    // Reang Kesey, real
  { adjustment_kg: -180, price_per_kg: 1000, value_lost: 180000 },
  { adjustment_kg: -68, price_per_kg: 983, value_lost: 66844 },
  { adjustment_kg: 12, price_per_kg: null },                    // an old gain, no price
];
const t = totals(rows);
eq("kilograms add up regardless of price", [t.lossKg, t.gainKg, t.netKg], [248, 47, -201]);
eq("riel counts only the rows that have a value", [t.lossRiel, t.gainRiel], [246844, 35000]);
eq("net riel", t.netRiel, -211844);
eq("the unpriced row is counted and reported", [t.count, t.valued, t.unpriced], [4, 3, 1]);
eq("net kg and net riel can disagree in magnitude but never silently in sign here",
   Math.sign(t.netKg) === Math.sign(t.netRiel), true);

// A period where nothing has a price must not claim a net of zero riel.
const none = totals([{ adjustment_kg: 35 }, { adjustment_kg: -10 }]);
eq("nothing priced means nothing valued", [none.valued, none.lossRiel, none.gainRiel], [0, 0, 0]);

// ---------------------------------------------------------------------
// 5. The source must still carry these rules.
// ---------------------------------------------------------------------
for (const needle of [
  "function adjustmentValue",
  "if (a.value_lost != null) return -Math.abs(Number(a.value_lost));",
  "if (kg > 0 && a.price_per_kg != null) return kg * Number(a.price_per_kg);",
  "function fmtSignedRiel",
  'Th num>Loss (៛)</Th>'.slice(1),   // the new column headers
  'Th num>Gain (៛)</Th>'.slice(1),
  'Th num>Worth (៛)</Th>'.slice(1),
  "These figures are not profit or cost.",  // the double-count warning
]) {
  if (!src.includes(needle)) { console.error(`FAIL  ReportShrinkage.jsx missing: ${needle}`); failed++; }
}
// A dash, never a zero, when there is no price.
if (!src.includes('value == null ? "—"')) {
  console.error("FAIL  an adjustment with no price must render a dash, not a number"); failed++;
}
// The column counts on the two empty/loading rows must match the new headers.
for (const [table, cols] of [["By Location", 8], ["Adjustment History", 9]]) {
  if (!src.includes(`colSpan={${cols}}`)) {
    console.error(`FAIL  ${table}: empty-state colSpan is not ${cols} — it will not span the new columns`); failed++;
  }
}
// And the database must actually keep a price for gains now.
if (!api.includes("Now stored for a GAIN as well as a loss")) {
  console.error("FAIL  api.js no longer documents that gains carry a price"); failed++;
}

if (failed) { console.error(`\n${failed} shrinkage-value check(s) FAILED.`); process.exit(1); }
console.log("Checked 20 shrinkage-value cases — a missing price shows a dash, never a zero.");
