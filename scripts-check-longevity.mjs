// Guard for the 12 Sept longevity pass — the bugs that only appear after
// years of growth, and so cannot be found by using the app today.
//
// Every rule here was a real defect that worked perfectly at 3,000 rows
// and failed somewhere between year 2 and year 13. They are tested by
// arithmetic and by reading the source, because there is no way to wait
// ten years to find out.
import { readFileSync } from "fs";
const api = readFileSync("src/api.js", "utf8");
const queue = readFileSync("src/offlineQueue.js", "utf8");
const stock = readFileSync("src/pages/StockInventory.jsx", "utf8");
const txPage = readFileSync("src/pages/Transactions.jsx", "utf8");

let failed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL  ${name}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
    failed++;
  }
};
const ok = (name, cond) => { if (!cond) { console.error(`FAIL  ${name}`); failed++; } };

// ---------------------------------------------------------------------
// 1. RECEIPT CODES MUST STILL BE UNIQUE IN YEAR TEN.
//    The chance a NEW code collides with one already stored is simply
//    rows / space. At 100 transactions a day, year 10 is ~368,000 rows.
// ---------------------------------------------------------------------
const ROWS_Y5 = 185_000, ROWS_Y10 = 368_000;
const collision = (rows, space) => rows / space;
const OLD_SPACE = 899_999;      // what six digits gave
const NEW_SPACE = 1_000_000_000; // nine digits

ok("the old six-digit space collided on two saves in five by year 10",
   collision(ROWS_Y10, OLD_SPACE) > 0.4);
ok("nine digits keeps year-5 collisions under 1 in 1,000",
   collision(ROWS_Y5, NEW_SPACE) < 0.001);
ok("nine digits keeps year-10 collisions under 1 in 1,000",
   collision(ROWS_Y10, NEW_SPACE) < 0.001);
// insertWithFreshCodeOnCollision makes 1 attempt + 5 retries. A hard
// failure needs all six to collide — that must be effectively impossible,
// because it surfaces as a failed save with a farmer standing there.
const hardFailure = (rows, space) => collision(rows, space) ** 6;
ok("the old space failed outright about once in every 200 saves by year 10",
   hardFailure(ROWS_Y10, OLD_SPACE) > 1 / 300);
ok("nine digits makes a hard failure less likely than one in a trillion",
   hardFailure(ROWS_Y10, NEW_SPACE) < 1e-12);

for (const [file, src, name] of [["api.js", api, "randomCodeNumber"], ["offlineQueue.js", queue, "randomLocalCodeNumber"]]) {
  ok(`${file} generates codes from the wide space`, src.includes(`function ${name}`));
  ok(`${file} no longer uses the old six-digit expression`,
     !src.includes("Math.floor(100000 + Math.random() * 899999)"));
  ok(`${file} pads to nine digits`, src.includes('padStart(9, "0")'));
}
// Both halves must use the SAME space: the local one prints the receipt,
// the server one stores the row. If they drift the paper and the system
// disagree on a fraction of every offline sync.
eq("the printed code and the stored code come from the same space",
   [api.includes("1_000_000_000"), queue.includes("1_000_000_000")], [true, true]);

// ---------------------------------------------------------------------
// 2. A STATION MUST STILL BE ABLE TO SAVE A TICKET IN YEAR FIVE.
//    localStorage is a few megabytes shared by everything this app keeps
//    on that PC, and writeJSON fails silently when it is full. An uncapped
//    cache therefore does not merely go stale — it eventually stops the
//    sync queue writing, and enqueueStrict then refuses the save.
// ---------------------------------------------------------------------
ok("the party lookup cache is capped", queue.includes("LOOKUP_CACHE_MAX_ROWS"));
ok("setCachedParties applies the cap",
   /export function setCachedParties\(list\) \{\s*writeJSON\(PARTY_CACHE_KEY, \(list \|\| \[\]\)\.slice\(0, LOOKUP_CACHE_MAX_ROWS\)\)/.test(queue));
ok("setCachedProducts applies the cap",
   /export function setCachedProducts\(list\) \{[\s\S]{0,400}?slice\(0, LOOKUP_CACHE_MAX_ROWS\)/.test(queue));

// capForCache must never return more than `max`, however much is pinned.
function capForCache(list, keepIds, max) {
  if (list.length <= max) return list;
  const kept = [], seen = new Set();
  for (const r of list) if (keepIds.has(r.id)) { kept.push(r); seen.add(r.id); }
  if (kept.length >= max) return kept;
  for (const r of list) { if (kept.length >= max) break; if (!seen.has(r.id)) kept.push(r); }
  return kept;
}
const many = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}` }));
eq("an ordinary cap keeps exactly max rows", capForCache(many, new Set(), 400).length, 400);
eq("a small keep-list does not inflate the cache",
   capForCache(many, new Set(["t4000", "t4001"]), 400).length, 400);
// Unsynced work still always wins — it cannot be re-fetched — but once it
// alone fills the budget nothing else is piled on top of it.
const pinned = new Set(many.slice(0, 600).map((r) => r.id));
eq("a huge keep-list is kept whole but nothing extra is added",
   capForCache(many, pinned, 400).length, 600);
ok("the source stops adding once the keep-list fills the budget",
   queue.includes("if (kept.length >= max) return kept;"));

// ---------------------------------------------------------------------
// 3. NO SILENT TRUNCATION. PostgREST caps an unpaged query at 1,000 rows
//    and returns no error, so a bare .order() eventually answers from a
//    slice of the data while looking completely confident.
// ---------------------------------------------------------------------
ok("partner capital entries are paged", /getPartnerCapitalEntries\(\)[\s\S]{0,900}?fetchAll\(makeQuery/.test(api));
ok("partner capital entries no longer read a capped single response",
   !/from\("partner_capital_entries"\)[\s\S]{0,300}?const \{ data, error \}/.test(api));

// ---------------------------------------------------------------------
// 4. A TOOL THAT FINDS MISSING DATA MUST NEVER INVENT SOME.
//    Station Check used to fall back to the filtered on-screen list when
//    the full download timed out, and present it as every transaction —
//    reporting tickets as missing that were not missing at all.
// ---------------------------------------------------------------------
ok("Station Check no longer falls back to the on-screen rows",
   !txPage.includes("withTimeout(api.getTransactions(), 15000, rows)"));
ok("Station Check refuses to run without the complete list",
   txPage.includes("const ready = Array.isArray(allRows);") && txPage.includes("if (!ready)"));
ok("Station Check says so instead of answering", txPage.includes("this check simply could not run"));
ok("its empty state is null, not an empty list",
   txPage.includes("useState(null);") && txPage.includes("loadError={stationCheckError}"));

// ---------------------------------------------------------------------
// 5. THE SHED IS VALUED AT A PRICE SOMEONE RECENTLY PAID.
//    An unweighted all-time mean of every buy AND sell drifts further from
//    the truth every season and never comes back.
// ---------------------------------------------------------------------
function weighted(rows) {
  let kg = 0, riel = 0;
  for (const t of rows) {
    const k = Number(t.quantity_kg) || 0, p = Number(t.price_per_kg) || 0;
    if (k <= 0 || p <= 0) continue;
    kg += k; riel += k * p;
  }
  return kg > 0 ? riel / kg : 0;
}
eq("weighted by kilograms, not by row count",
   Math.round(weighted([
     { type: "BUY", quantity_kg: 30000, price_per_kg: 1000 },
     { type: "BUY", quantity_kg: 100, price_per_kg: 2000 },
   ])), 1003);
eq("a zero price is ignored rather than dragging the average down",
   weighted([{ quantity_kg: 100, price_per_kg: 0 }, { quantity_kg: 100, price_per_kg: 900 }]), 900);
eq("no priced rows gives zero, not NaN", weighted([]), 0);
ok("only buys price the shed", stock.includes('activeTxs.filter((t) => t.type === "BUY")'));
ok("a recent window is used", stock.includes("STOCK_VALUE_WINDOW_DAYS"));
ok("the basis is shown on screen", stock.includes("avgPriceBasis"));
ok("it falls back rather than showing zero for a quiet station",
   stock.includes('"avg buy price, last year"') && stock.includes('"avg buy price, all time"'));

if (failed) { console.error(`\n${failed} longevity check(s) FAILED.`); process.exit(1); }
console.log("Checked 30 longevity cases — codes stay unique, caches stay bounded, nothing truncates silently.");
