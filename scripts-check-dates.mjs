// scripts-check-dates.mjs — the date guard.
//
// [2026-09-16] Two bugs this exists to stop happening again.
//
// 1. ENGLISH DATES ON A KHMER SCREEN. Dates were formatted with English
//    month and weekday names in 45 places across 12 files. SISEN: "i noticed
//    u put english month, how about a number date instead so people who pick
//    khmer can easily understand". They are now numbers, produced in exactly
//    one place — src/dateFormat.js. This guard fails if any other file grows
//    its own month or weekday name list, or asks Intl for a month NAME.
//
// 2. A REFERENCE TO A CONSTANT THAT NO LONGER EXISTS. Deleting the MONTHS
//    array from DailyBook.jsx left one line still reading MONTHS[...]. That
//    is the same class of bug as the `tot` redeclaration that broke the
//    Vercel build and cost an afternoon — the site builds or it does not,
//    and nothing I send matters until it does. scripts-check-shadow.mjs
//    checks redeclaration; this checks the other half: an ALL_CAPS constant
//    used in a file that does not declare or import it.
//
// Run: node scripts-check-dates.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`); }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk("src");
const OWNER = "src/dateFormat.js";

// ── 1. no month or weekday name lists outside dateFormat.js ───────────────

const MONTH_WORDS = /\b(January|February|March|April|June|July|August|September|October|November|December)\b/;
const MONTH_ABBR = /["'](Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)["']/;
const DAY_WORDS = /["'](Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)["']/;
const DAY_FULL = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;
// Intl asked for a month NAME — "short" or "long" — rather than digits.
const INTL_MONTH_NAME = /month:\s*["'](short|long|narrow)["']/;
const INTL_WEEKDAY = /weekday:\s*["'](short|long|narrow)["']/;

const offenders = [];
for (const f of files) {
  const norm = f.replace(/\\/g, "/");
  if (norm === OWNER) continue;
  // i18n.jsx is where the translated weekday words live — that is the point.
  if (norm === "src/i18n.jsx") continue;
  const src = readFileSync(f, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    // A comment explaining the rule is not a violation of it.
    const code = line.replace(/\/\/.*$/, "");
    if (/^\s*\*/.test(line) || /^\s*\/\//.test(line)) return;
    const hit =
      (MONTH_WORDS.test(code) && /["']/.test(code)) ? "month name" :
      MONTH_ABBR.test(code) ? "month abbreviation" :
      DAY_WORDS.test(code) ? "weekday abbreviation" :
      (DAY_FULL.test(code) && /["']/.test(code)) ? "weekday name" :
      INTL_MONTH_NAME.test(code) ? 'Intl month: "short"/"long"' :
      INTL_WEEKDAY.test(code) ? "Intl weekday:" : null;
    if (hit) offenders.push(`${norm}:${i + 1}  ${hit}  ${line.trim().slice(0, 90)}`);
  });
}
check("no English month/weekday names outside dateFormat.js",
  offenders.length === 0, offenders.join("\n          "));

// ── 2. every ALL_CAPS constant used is declared or imported ───────────────
//
// Deliberately narrow: only SCREAMING_CASE names of 3+ characters, used as
// NAME[ or NAME. or NAME(. Those are module constants — the MONTHS class of
// bug — and they are declared at the top level of the file that uses them
// or imported by name. Anything lowercase is a local or a parameter and
// needs a real parser to judge, so this does not guess at it.

// NAME[ or NAME. only — a SCREAMING_CASE call is rare, and "VAT (12%)"
// sitting in JSX text is not code.
const CONST_USE = /\b([A-Z][A-Z0-9_]{2,})\s*[[.]/g;
const globalsOK = new Set([
  "JSON", "Math", "Date", "Intl", "Number", "String", "Object", "Array",
  "Boolean", "Map", "Set", "Promise", "RegExp", "URL", "Error", "URLSearchParams",
  "TextEncoder", "TextDecoder", "AbortController", "Blob", "FileReader", "Image",
  "SVG", "PDF", "CSV", "XML", "UTC", "API", "URI", "HTML", "ID", "OK",
]);

const undef = [];
for (const f of files) {
  const norm = f.replace(/\\/g, "/");
  const src = readFileSync(f, "utf8");
  // Strip comments and strings so words inside prose are not read as code.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  const declared = new Set();
  for (const m of code.matchAll(/(?:const|let|var|function|class)\s+([A-Z][A-Z0-9_]{2,})\b/g)) declared.add(m[1]);
  for (const m of code.matchAll(/import\s*{([^}]*)}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(/\s+as\s+/).pop().trim();
      if (name) declared.add(name);
    }
  }
  for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) declared.add(m[1]);
  for (const m of code.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);

  const seen = new Set();
  for (const m of code.matchAll(CONST_USE)) {
    const name = m[1];
    if (seen.has(name) || declared.has(name) || globalsOK.has(name)) continue;
    seen.add(name);
    undef.push(`${norm}  ${name}`);
  }
}
check("every SCREAMING_CASE constant used is declared or imported in its file",
  undef.length === 0, undef.join("\n          "));

// ── 3. dateFormat.js itself still does what the app relies on ─────────────

const dfSrc = readFileSync(OWNER, "utf8");
const mod = await import("./src/dateFormat.js");

check("dateFormat.js reads Cambodia time", dfSrc.includes('"Asia/Phnom_Penh"'));
check("a plain YYYY-MM-DD never goes through a Date",
  dfSrc.includes("isPlainDate") && /if \(isPlainDate\(value\)\)/.test(dfSrc));

check("dmy  15/09/2026", mod.dmy("2026-09-15") === "15/09/2026", mod.dmy("2026-09-15"));
check("dm   15/09", mod.dm("2026-09-15") === "15/09", mod.dm("2026-09-15"));
check("dmy2 15/09/26", mod.dmy2("2026-09-15") === "15/09/26", mod.dmy2("2026-09-15"));
check("my   09/2026 from a month key", mod.my("2026-09") === "09/2026", mod.my("2026-09"));
check("my   09/2026 from a full date", mod.my("2026-09-15") === "09/2026", mod.my("2026-09-15"));
check("range 01/09 – 06/09",
  mod.range("2026-09-01", "2026-09-06") === "01/09 – 06/09", mod.range("2026-09-01", "2026-09-06"));

// 15 September 2026 is a Tuesday.
check("weekdayKey names the right day",
  mod.weekdayKey("2026-09-15") === "dow_2", mod.weekdayKey("2026-09-15"));
check("weekday is translated, never hardcoded",
  mod.weekday("2026-09-15", (k) => ({ dow_2: "អង្គារ" })[k] || k) === "អង្គារ");
check("dayWithWeekday 15/09 អង្គារ",
  mod.dayWithWeekday("2026-09-15", (k) => ({ dow_2: "អង្គារ" })[k] || k) === "15/09អង្គារ".replace("09", "09 "));

// A ticket saved at 23:40 Phnom Penh is 16:40 UTC — it must still read as
// the 15th, whatever timezone the person looking at it is sitting in.
check("a late-evening timestamp keeps its Cambodian day",
  mod.dmy("2026-09-15T16:40:00Z") === "15/09/2026", mod.dmy("2026-09-15T16:40:00Z"));
check("dmyTime 15/09/2026 23:40",
  mod.dmyTime("2026-09-15T16:40:00Z") === "15/09/2026 23:40", mod.dmyTime("2026-09-15T16:40:00Z"));
check("hm 23:40", mod.hm("2026-09-15T16:40:00Z") === "23:40", mod.hm("2026-09-15T16:40:00Z"));

// Nothing is ever shown as "Invalid Date".
for (const bad of [null, undefined, "", "not a date"]) {
  check(`${JSON.stringify(bad)} formats as — not a crash`,
    mod.dmy(bad) === "—" && mod.dmyTime(bad) === "—" && mod.hm(bad) === "—");
}

// ── 4. the Expenses labels carry the year SISEN asked for ────────────────

const book = await import("./src/expenseBook.js");
check("Expenses day row carries its year",
  book.periodLabel("2026-09-15", "day") === "15/09/2026", book.periodLabel("2026-09-15", "day"));
check("Expenses month row 09/2026",
  book.periodLabel("2026-09", "month") === "09/2026", book.periodLabel("2026-09", "month"));
check("Expenses week row is a numeric range",
  /^\d{2}\/\d{2} – \d{2}\/\d{2}$/.test(book.periodLabel("2026-W38", "week")),
  book.periodLabel("2026-W38", "week"));
check("Expenses year row is the year",
  book.periodLabel("2026", "year") === "2026");
check("windowFor month window is labelled 09/2026",
  book.windowFor("day", "2026-09-15").label === "09/2026", book.windowFor("day", "2026-09-15").label);
check("windowFor year grain holds no English",
  book.windowFor("year", "2026-09-15").label === null);

// ── 5. the weekday words exist in BOTH languages ─────────────────────────

const i18n = readFileSync("src/i18n.jsx", "utf8");
for (let i = 0; i < 7; i += 1) {
  const hits = [...i18n.matchAll(new RegExp(`dow_${i}:`, "g"))].length;
  check(`dow_${i} is in both dictionaries`, hits === 2, `found ${hits}`);
}
const khmerDow = [...i18n.matchAll(/dow_\d:\s*"([^"]*)"/g)].map((m) => m[1]);
check("the Khmer weekdays are actually Khmer",
  khmerDow.slice(7).every((w) => /[\u1780-\u17FF]/.test(w)), khmerDow.slice(7).join(" "));

console.log(failures ? `\n${failures} FAILED` : "\nall date checks passed");
process.exit(failures ? 1 : 0);
