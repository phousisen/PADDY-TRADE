// scripts-check-stockbytype.mjs — the per-paddy-type stock rule, run for real.
//
// [2026-09-19] Stock Inventory and the Sell screen each had their own rule
// and they disagreed: one emptied every type after ANY count (even a small
// midday loss), the other ignored counts altogether and subtracted quality
// deductions. Both now use src/stockByType.js. This runs it on cases worked
// out by hand, and checks both screens actually call it.
//
// Run: node scripts-check-stockbytype.mjs

import { readFileSync } from "node:fs";
const { stockByType, avgCostByType } = await import("./src/stockByType.js");

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};
const near = (a, b) => Math.abs((a || 0) - b) < 0.01;

const L = "loc-1";
const tx = (type, product_id, kg, at, extra = {}) => ({
  type, product_id, quantity_kg: kg, location_id: L, created_at: at, hq_status: "processing", ...extra,
});
const adj = (kg, at, reason = "recount") => ({ location_id: L, adjustment_kg: kg, created_at: at, reason });

console.log("\n1. Buys and sells");
let r = stockByType({ locationId: L, txs: [
  tx("BUY", "A", 1000, "2026-09-01T02:00:00Z"),
  tx("BUY", "B", 500, "2026-09-01T03:00:00Z"),
  tx("SELL", "A", 300, "2026-09-01T04:00:00Z"),
] });
ok("A = 1000 - 300", near(r.A, 700), JSON.stringify(r));
ok("B = 500", near(r.B, 500), JSON.stringify(r));

r = stockByType({ locationId: L, txs: [
  tx("BUY", "A", 1000, "2026-09-01T02:00:00Z", { deduction_kg: 40 }),
] });
ok("a quality deduction does not remove paddy from the shed", near(r.A, 1000), JSON.stringify(r));

r = stockByType({ locationId: L, txs: [
  tx("BUY", "A", 1000, "2026-09-01T02:00:00Z"),
  tx("BUY", "A", 999, "2026-09-01T02:30:00Z", { hq_status: "cancelled" }),
  tx("BUY", "A", 777, "2026-09-01T02:30:00Z", { location_id: "other" }),
] });
ok("cancelled and other stations do not count", near(r.A, 1000), JSON.stringify(r));

console.log("\n2. A midday loss count (audit F4)");
r = stockByType({ locationId: L,
  txs: [tx("BUY", "A", 600, "2026-09-01T02:00:00Z"), tx("BUY", "B", 400, "2026-09-01T03:00:00Z")],
  adjustments: [adj(-100, "2026-09-01T06:00:00Z")],
});
ok("a 10% loss takes 10% of each type, not all of it", near(r.A, 540) && near(r.B, 360), JSON.stringify(r));

r = stockByType({ locationId: L,
  txs: [tx("BUY", "A", 600, "2026-09-01T02:00:00Z"), tx("BUY", "B", 400, "2026-09-02T03:00:00Z")],
  adjustments: [adj(-100, "2026-09-01T06:00:00Z")],
});
ok("a buy AFTER the count is not scaled", near(r.A, 500) && near(r.B, 400), JSON.stringify(r));

console.log("\n3. A reset");
r = stockByType({ locationId: L,
  txs: [tx("BUY", "A", 600, "2026-09-01T02:00:00Z"), tx("BUY", "B", 400, "2026-09-02T03:00:00Z")],
  adjustments: [adj(-600, "2026-09-01T20:00:00Z", "reset")],
});
ok("a reset empties what was there; later buys stand", near(r.A, 0) && near(r.B, 400), JSON.stringify(r));

console.log("\n4. Never below zero");
r = stockByType({ locationId: L, txs: [tx("SELL", "A", 50, "2026-09-01T02:00:00Z")] });
ok("a type sold past zero shows 0, not a negative stock", near(r.A, 0), JSON.stringify(r));

console.log("\n5. Average cost per type (audit F3)");
const c = avgCostByType([
  { type: "BUY", product_id: "A", quantity_kg: 30000, price_per_kg: 1000 },
  { type: "BUY", product_id: "A", quantity_kg: 100, price_per_kg: 2000 },
  { type: "SELL", product_id: "A", quantity_kg: 1000, price_per_kg: 5000 },
]);
ok("weighted by kg, Buys only", Math.abs(c.A - (30000 * 1000 + 100 * 2000) / 30100) < 0.001, String(c.A));

console.log("\n6. Both screens use it");
const inv = readFileSync("src/pages/StockInventory.jsx", "utf8");
const wt = readFileSync("src/pages/WeighingTickets.jsx", "utf8");
ok("Stock Inventory calls stockByType", /stockByType\(\{/.test(inv));
ok("Stock Inventory no longer has the 'last adjustment wipes everything' rule", !inv.includes("lastAdjustmentAtByLocation"));
ok("the Sell list calls stockByType", /stockByType\(\{/.test(wt));
ok("the Sell list fetches stock counts", /getStockAdjustments\(\{\s*locationId:\s*ticket\.location_id/.test(wt));
ok("the Sell list no longer subtracts deductions", !/quantity_kg \|\| 0\) - Number\(tx\.deduction_kg/.test(wt));

console.log(failed ? `\n${failed} FAILED` : "\nPer-type stock: one rule, both screens.");
process.exit(failed ? 1 : 0);
