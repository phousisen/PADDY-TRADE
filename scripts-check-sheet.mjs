// scripts-check-sheet.mjs — the printed expense sheet adds up.
//
// [2026-09-17] SISEN asked to print the expenses, then rejected the first
// two attempts: "this really take up the paper space, i think its better to
// create a proper collum or what" and "why land scape, its a waste, make it
// portait".
//
// So it is a MATRIX now — days down, categories across, totals on both edges,
// one portrait page. Which introduces the one failure a printed report must
// never have: a table whose edges disagree with its middle. Nobody checks a
// printed total with a calculator; they sign it.
//
// Three things have to hold, always:
//
//   · every row total is the sum of that row's own cells
//   · every column total is the sum of that column's own cells
//   · the grand total equals both
//
// And two rules about what is ON the paper:
//
//   · ថ្លៃកូនដៃ always has its own column, first, whatever it cost
//   · a category squeezed out by the page width is ADDED INTO "ផ្សេងៗ",
//     never dropped — a dropped figure makes the sheet lie quietly
//
// Run: node scripts-check-sheet.mjs

import { buildSheet, shares, shortHeading } from "./src/expenseSheet.js";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};

const row = (pay_date, category, amount) => ({ pay_date, category, amount });

// A month shaped like SISEN's own: ថ្លៃកូនដៃ every trading day, fuel and
// transport most days, a big repair, and two days nobody filed.
const DAYS = ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"];
const ROWS = [
  row("2026-09-11", "ថ្លៃកូនដៃ", 1_908_420),
  row("2026-09-11", "ថ្លៃជួសជុល", 1_113_000),
  row("2026-09-12", "ថ្លៃកូនដៃ", 892_000),
  row("2026-09-12", "ប្រេងឥន្ធនៈ", 741_625),
  row("2026-09-12", "ថ្លៃដឹកជញ្ជូន", 300_000),
  row("2026-09-12", "ថ្លៃអគ្គិសនី", 100_000),
  row("2026-09-13", "ថ្លៃកូនដៃ", 1_206_950),
  row("2026-09-14", "ថ្លៃកូនដៃ", 851_685),
  row("2026-09-14", "ប្រេងឥន្ធនៈ", 420_300),
  row("2026-09-14", "អាហារ", 340_000),
  row("2026-09-15", "ថ្លៃកូនដៃ", 446_500),
  // the same category twice in one day — a second fuel run
  row("2026-09-15", "ប្រេងឥន្ធនៈ", 400_000),
  row("2026-09-15", "ប្រេងឥន្ធនៈ", 365_485),
  row("2026-09-15", "អាហារ", 400_000),
];
const MARKS = [{ day: "2026-09-16", location_id: "x" }];   // nothing spent
// 17 Sept: nobody filed at all.

const sheet = buildSheet({ rows: ROWS, days: DAYS, marks: MARKS, maxCols: 5 });

console.log("\n1. The edges agree with the middle");

let rowsOk = true, detail = "";
for (const r of sheet.rows) {
  const sum = Object.values(r.cells).reduce((a, b) => a + b, 0);
  if (Math.round(sum) !== Math.round(r.total)) { rowsOk = false; detail = `${r.day}: cells ${sum} vs total ${r.total}`; }
}
ok("every day's total is the sum of its own cells", rowsOk, detail);

let colsOk = true, cdetail = "";
for (const c of sheet.columns) {
  const sum = sheet.rows.reduce((a, r) => a + (r.cells[c.key] || 0), 0);
  if (Math.round(sum) !== Math.round(sheet.colTotals[c.key])) {
    colsOk = false; cdetail = `${c.name}: cells ${sum} vs total ${sheet.colTotals[c.key]}`;
  }
}
ok("every column's total is the sum of its own cells", colsOk, cdetail);

const byRows = sheet.rows.reduce((a, r) => a + r.total, 0);
const byCols = sheet.columns.reduce((a, c) => a + sheet.colTotals[c.key], 0);
ok("the corner equals both",
   Math.round(byRows) === Math.round(sheet.grand) && Math.round(byCols) === Math.round(sheet.grand),
   `rows ${byRows} · columns ${byCols} · grand ${sheet.grand}`);

const paper = ROWS.reduce((a, r) => a + r.amount, 0);
ok("and equals every riel that went in",
   Math.round(sheet.grand) === paper, `sheet ${sheet.grand} vs rows ${paper}`);

console.log("\n2. ថ្លៃកូនដៃ is never mixed into anything");

ok("it is the first column", sheet.columns[0].key === "__kh");
ok("it is marked as itself, so it can be coloured apart", sheet.columns[0].kh === true);
ok("it carries the right figure",
   sheet.commissionTotal === 1_908_420 + 892_000 + 1_206_950 + 851_685 + 446_500,
   String(sheet.commissionTotal));
ok("everything else is everything else",
   sheet.otherTotal === sheet.grand - sheet.commissionTotal);

console.log("\n3. A narrow page loses no money");

// One column for the named categories: fuel wins it, and repair, transport,
// electricity and food must all end up in ផ្សេងៗ rather than vanishing.
const tight = buildSheet({ rows: ROWS, days: DAYS, marks: MARKS, maxCols: 1 });
ok("a squeezed-out category is added into ផ្សេងៗ, never dropped",
   Math.round(tight.grand) === paper, `tight ${tight.grand} vs rows ${paper}`);
ok("and the sheet says so", tight.columns.some((c) => c.key === "__other" && c.lumped > 0),
   JSON.stringify(tight.columns.map((c) => c.name)));
ok("ថ្លៃកូនដៃ keeps its column even at the narrowest",
   tight.columns[0].key === "__kh");
ok("the tightest possible sheet still balances",
   tight.rows.every((r) => Math.round(Object.values(r.cells).reduce((a, b) => a + b, 0)) === Math.round(r.total)));

console.log("\n4. The same category twice in one day is one cell");

const d15 = sheet.rows.find((r) => r.day === "2026-09-15");
const fuelKey = sheet.columns.find((c) => c.name === "ប្រេងឥន្ធនៈ")?.key;
ok("two fuel entries on one day add together",
   d15.cells[fuelKey] === 765_485, String(d15.cells[fuelKey]));
ok("and the day still totals correctly",
   d15.total === 446_500 + 765_485 + 400_000, String(d15.total));

console.log("\n5. A day nobody filed is printed, not skipped");

ok("every day in the period has a row", sheet.rows.length === DAYS.length);
ok("a day with money reads as spent",
   sheet.rows.find((r) => r.day === "2026-09-15").state === "spent");
ok("a day marked empty reads as nothing — a real zero",
   sheet.rows.find((r) => r.day === "2026-09-16").state === "nothing");
ok("a day nobody touched reads as blank — a hole in the paperwork",
   sheet.rows.find((r) => r.day === "2026-09-17").state === "blank");
ok("the blank days are named, so the sheet can list them",
   sheet.blankDays.length === 1 && sheet.blankDays[0] === "2026-09-17",
   JSON.stringify(sheet.blankDays));
ok("filed days are counted for the header", sheet.filedDays === 6, String(sheet.filedDays));

console.log("\n6. Shares, and headings that fit 210mm");

const sh = shares(sheet);
ok("every column has a share", sh.length === sheet.columns.length);
ok("the shares are of the grand total, not of each other",
   Math.abs(sh.reduce((a, s) => a + s.pct, 0) - 100) <= sh.length,
   JSON.stringify(sh.map((s) => `${s.name} ${s.pct}%`)));
ok("an empty sheet has no shares rather than dividing by zero",
   shares(buildSheet({ rows: [], days: DAYS, marks: [] })).length === 0
   || shares({ grand: 0 }).length === 0);

ok("a long category name is shortened for the heading only",
   shortHeading("ប្រេងឥន្ធនៈ") === "ប្រេង" && shortHeading("ថ្លៃដឹកជញ្ជូន") === "ដឹកជញ្ជូន");
ok("a name with no short form is left alone, never cut mid-word",
   shortHeading("អាហារ") === "អាហារ" && shortHeading("") === "");

console.log("\n7. Nothing at all still produces a valid sheet");

const empty = buildSheet({ rows: [], days: DAYS, marks: [] });
ok("no rows means a grand total of zero, not NaN", empty.grand === 0);
ok("every day still prints", empty.rows.length === DAYS.length);
ok("every day reads as blank", empty.rows.every((r) => r.state === "blank"));
ok("ថ្លៃកូនដៃ still has its column on an empty month",
   empty.columns[0].key === "__kh");

console.log(failed ? `\n${failed} FAILED\n` : "\nall ok\n");
process.exit(failed ? 1 : 0);
