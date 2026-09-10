// [2026-09-10] Fixtures for shedStock.js — the "What's in the shed" panel
// on a location's page.
//
// Run:  bun scripts-check-shed.mjs      (or: node scripts-check-shed.mjs)
//
// The one thing every case here asserts is the same thing the panel puts on
// screen: the parts add up to the station's own stock figure. Every wrong
// number this app has shown came from arithmetic nobody could check, so this
// file exists to make that impossible for this panel.

import { buildShed } from "./src/shedStock.js";

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}${extra !== undefined ? `  → ${extra}` : ""}`);
}
function near(a, b, tol = 0.005) { return Math.abs(a - b) <= tol; }

const LOC = "loc-1";
const NOW = new Date("2026-09-10T10:00:00+07:00");
const day = (n) => {           // n days before today, as a Cambodia date
  const d = new Date(NOW); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const at = (n, hh = "09") => `${day(n)}T${hh}:00:00+07:00`;

function tx({ type, kg, name, n, hq }) {
  return {
    location_id: LOC, type, quantity_kg: kg, productName: name,
    tx_date: day(n), created_at: at(n), hq_status: hq,
  };
}
function adj({ n, newKg, hh = "09" }) {
  return { location_id: LOC, created_at: at(n, hh), new_stock_kg: newKg, adjustment_kg: 0 };
}
function run(txs, adjustments, stockKg) {
  return buildShed({ txs, adjustments, location: { id: LOC, current_stock_kg: stockKg }, now: NOW });
}

// ---------------------------------------------------------------------------
console.log("\n1. No adjustments — plain bought minus sold, by type");
{
  const txs = [
    tx({ type: "BUY",  kg: 1000, name: "សែន ក្រអូប", n: 20 }),
    tx({ type: "BUY",  kg:  500, name: "សែន ក្រអូប", n: 5 }),
    tx({ type: "SELL", kg:  300, name: "សែន ក្រអូប", n: 2 }),
    tx({ type: "BUY",  kg:  800, name: "OM 5451",    n: 3 }),
  ];
  const s = run(txs, [], 2000);
  check("two types", s.types.length === 2, s.types.length);
  check("សែន ក្រអូប = 1200", near(s.types.find((t) => t.name === "សែន ក្រអូប").kg, 1200));
  check("OM 5451 = 800", near(s.types.find((t) => t.name === "OM 5451").kg, 800));
  check("carried = 0", near(s.carriedKg, 0));
  check("adds up to station stock", near(s.diff, 0), s.diff);
  check("biggest type first", s.types[0].kg >= s.types[1].kg);
}

// ---------------------------------------------------------------------------
console.log("\n2. A stock count supersedes everything before it");
{
  const txs = [
    tx({ type: "BUY", kg: 9000, name: "សែន ក្រអូប", n: 30 }),  // before the count
    tx({ type: "BUY", kg:  400, name: "សែន ក្រអូប", n: 6 }),   // after
    tx({ type: "BUY", kg:  100, name: "OM 5451",    n: 4 }),
  ];
  const adjustments = [adj({ n: 10, newKg: 2000 })];
  const s = run(txs, adjustments, 2500);
  check("carried forward = the count", near(s.carriedKg, 2000), s.carriedKg);
  check("the 9,000 kg before the count is NOT counted again",
    near(s.types.find((t) => t.name === "សែន ក្រអូប").kg, 400), s.types[0].kg);
  check("adds up to station stock", near(s.diff, 0), s.diff);
  check("counted-on date shown", s.countedOn === day(10), s.countedOn);
}

// ---------------------------------------------------------------------------
console.log("\n3. Only the LATEST count anchors it");
{
  const txs = [
    tx({ type: "BUY", kg: 5000, name: "A", n: 20 }),
    tx({ type: "BUY", kg:  700, name: "A", n: 8 }),   // between the two counts
    tx({ type: "BUY", kg:  300, name: "B", n: 1 }),   // after the last count
  ];
  const adjustments = [adj({ n: 15, newKg: 1000 }), adj({ n: 3, newKg: 1200 })];
  const s = run(txs, adjustments, 1500);
  check("carried = the LAST count", near(s.carriedKg, 1200), s.carriedKg);
  check("only B counted after it", s.types.length === 1 && s.types[0].name === "B",
    s.types.map((t) => t.name).join(","));
  check("adds up to station stock", near(s.diff, 0), s.diff);
}

// ---------------------------------------------------------------------------
console.log("\n4. Cancelled tickets are ignored");
{
  const txs = [
    tx({ type: "BUY", kg: 1000, name: "A", n: 2 }),
    tx({ type: "BUY", kg: 5000, name: "A", n: 2, hq: "cancelled" }),
  ];
  const s = run(txs, [], 1000);
  check("cancelled excluded", near(s.types[0].kg, 1000), s.types[0].kg);
  check("adds up to station stock", near(s.diff, 0), s.diff);
}

// ---------------------------------------------------------------------------
console.log("\n5. A mismatch is reported, never hidden");
{
  const txs = [tx({ type: "BUY", kg: 1000, name: "A", n: 2 })];
  const s = run(txs, [], 1045);        // station says 45 kg more than the trades
  check("difference surfaced", near(s.diff, 45), s.diff);
  check("split still computed so it can be read", near(s.types[0].kg, 1000));
}

// ---------------------------------------------------------------------------
console.log("\n6. Sparklines end at the number on the tile");
{
  const txs = [
    tx({ type: "BUY",  kg: 600, name: "A", n: 20 }),   // before the 14-day window
    tx({ type: "BUY",  kg: 400, name: "A", n: 9 }),
    tx({ type: "SELL", kg: 250, name: "A", n: 4 }),
    tx({ type: "BUY",  kg: 150, name: "A", n: 0 }),    // today
  ];
  const s = run(txs, [], 900);
  const a = s.types[0];
  check("14 points", a.series.length === 14, a.series.length);
  check("line ends at the tile's number", near(a.series[13], a.kg), `${a.series[13]} vs ${a.kg}`);
  check("line starts at the pre-window balance", near(a.series[0], 600), a.series[0]);
  check("adds up to station stock", near(s.diff, 0), s.diff);
}

// ---------------------------------------------------------------------------
console.log("\n7. A forward-dated ticket still lands on the line");
{
  const txs = [
    tx({ type: "BUY", kg: 500, name: "A", n: 1 }),
    { location_id: LOC, type: "BUY", quantity_kg: 200, productName: "A",
      tx_date: "2026-12-31", created_at: at(0) },   // dated months ahead
  ];
  const s = run(txs, [], 700);
  const a = s.types[0];
  check("counted in the total", near(a.kg, 700), a.kg);
  check("line still ends at the total", near(a.series[13], 700), a.series[13]);
  check("adds up to station stock", near(s.diff, 0), s.diff);
}

// ---------------------------------------------------------------------------
console.log("\n8. Trades with no paddy type get their own row, not silence");
{
  const txs = [
    tx({ type: "BUY", kg: 300, name: "A", n: 2 }),
    tx({ type: "BUY", kg: 120, name: "—", n: 2 }),      // api.js's placeholder
    tx({ type: "BUY", kg:  80, name: null, n: 2 }),
  ];
  const s = run(txs, [], 500);
  const untyped = s.types.find((t) => t.name === null);
  check("untyped row exists", !!untyped);
  check("untyped = 200", untyped && near(untyped.kg, 200), untyped && untyped.kg);
  check("adds up to station stock", near(s.diff, 0), s.diff);
}

// ---------------------------------------------------------------------------
console.log("\n9. Folding the tail into \"Other\" changes nothing that adds up");
{
  const txs = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) =>
    tx({ type: "BUY", kg: (8 - i) * 100, name: n, n: 3 }));
  const total = txs.reduce((s, t) => s + t.quantity_kg, 0);
  const s = run(txs, [], total);
  check("8 real types kept", s.types.length === 8, s.types.length);
  check("6 tiles drawn", s.tiles.length === 6, s.tiles.length);
  check("last tile is Other", s.tiles[5].other === true);
  check("tiles still sum to the same total",
    near(s.tiles.reduce((a, t) => a + t.kg, 0), total));
  check("adds up to station stock", near(s.diff, 0), s.diff);
}

// ---------------------------------------------------------------------------
console.log("\n10. A negative type is shown, not swallowed");
{
  const txs = [
    tx({ type: "BUY",  kg: 1000, name: "A", n: 3 }),
    tx({ type: "SELL", kg:  200, name: "B", n: 2 }),   // sold a type never bought
  ];
  const s = run(txs, [], 800);
  const b = s.types.find((t) => t.name === "B");
  check("B is negative and present", b && near(b.kg, -200), b && b.kg);
  check("adds up to station stock", near(s.diff, 0), s.diff);
}

// ---------------------------------------------------------------------------
console.log("\n11. An empty station returns an empty panel, not a crash");
{
  const s = run([], [], 0);
  check("no types", s.types.length === 0);
  check("nothing carried", near(s.carriedKg, 0));
  check("adds up", near(s.diff, 0));
}

console.log(failures === 0
  ? "\nAll shed fixtures passed.\n"
  : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
