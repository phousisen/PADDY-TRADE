// Khmer means Khmer — the ratchet.
//
// [2026-09-16] SISEN: "i kept repeating that make sure if its khmer version,
// make it all khmer and look at this daily book, nothing is in khmer
// translated. not just this there are more. check everything please."
//
// He was right and the number was 907 hardcoded English strings across 44
// files. Every one of them shows in English on a Khmer screen, whatever the
// language switch says.
//
// This script does three things:
//
//   1. COUNTS the hardcoded English left in each file and compares it with
//      the BASELINE below. A file may go DOWN and never UP. New code cannot
//      add an English string, and a translated screen cannot quietly regress.
//
//   2. Checks the dictionary is at exact parity — every key in both
//      languages, no orphans either way.
//
//   3. Checks every t("key") used anywhere in the app actually resolves, in
//      BOTH languages. A missing key renders as the key itself, which is how
//      "wt_select_paddy_type" ends up printed on a weighbridge screen.
//
// WHEN YOU TRANSLATE A FILE, LOWER ITS NUMBER HERE. The whole point is that
// the baseline can only shrink.

import fs from "node:fs";
import path from "node:path";

const BASELINE = {
  "src/pages/ReportCapital.jsx": 44,
  "src/pages/WeighingTickets.jsx": 40,
  "src/pages/TransactionForm.jsx": 38,
  "src/pages/ReportFinanceSetup.jsx": 37,
  "src/pages/ReportPurchases.jsx": 31,
  "src/pages/ReportPayables.jsx": 30,
  "src/pages/ReportSales.jsx": 30,
  "src/pages/ReportShrinkage.jsx": 28,
  "src/pages/UsersPage.jsx": 26,
  "src/pages/ReportReceivables.jsx": 24,
  "src/pages/ChangeRequests.jsx": 22,
  "src/pages/RolesPage.jsx": 22,
  "src/pages/DataCheck.jsx": 21,
  "src/pages/Receipt.jsx": 20,
  "src/pages/LocationsPage.jsx": 19,
  "src/components/Topbar.jsx": 18,
  "src/pages/LocationDetail.jsx": 15,
  "src/pages/ReportStock.jsx": 14,
  "src/pages/ReportTax.jsx": 14,
  "src/components/AddUserModal.jsx": 12,
  "src/components/MonthlyClosePanel.jsx": 11,
  "src/pages/RegisterFarmer.jsx": 11,
  "src/pages/SetPassword.jsx": 8,
  "src/components/StationDaysReview.jsx": 7,
  "src/pages/ReportAuditLog.jsx": 6,
  "src/components/AddLocationModal.jsx": 5,
  "src/pages/SettingsPage.jsx": 5,
  "src/components/DateRangeFilter.jsx": 4,
  "src/components/EditedBadge.jsx": 4,
  "src/pages/RegisterPartyStaff.jsx": 3,
  "src/App.jsx": 2,
  "src/components/MobileNav.jsx": 2,
  "src/components/WeightField.jsx": 2,
  "src/pages/Transactions.jsx": 2,
  "src/components/LiveWeightBox.jsx": 1,
  "src/components/Sidebar.jsx": 1,
  "src/pages/DailyBook.jsx": 1,
  "src/pages/Expenses.jsx": 1,
  "src/pages/ReceiptTemplateEditor.jsx": 1,
  "src/pages/StockInventory.jsx": 1,
};

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.jsx$/.test(e.name)) out.push(p);
  }
  return out;
}

// A run of English words a person would actually read on screen. Comments are
// stripped first — prose in a comment is documentation, not interface.
const WORDY = /[A-Za-z][A-Za-z'’]{2,}/;
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "")
   .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");

function countEnglish(file) {
  const src = strip(fs.readFileSync(file, "utf8"));
  let n = 0;
  // JSX text between tags
  for (const m of src.matchAll(/>\s*([A-Za-z][^<>{}\n]{2,80}?)\s*</g)) {
    const t = m[1].trim();
    if (WORDY.test(t) && !/^[A-Z_]+$/.test(t)) n += 1;
  }
  // a user-visible prop handed a bare string
  //
  // [2026-09-17] EXCEPT where the same element also carries the Khmer.
  // WeighingTickets renders its field labels through small bilingual
  // components — `<NewTicketFieldLabel en="Ticket #" km="លេខសំបុត្រ" />`,
  // `<SectionHeader title="Weigh Out" titleKm="…" />`. Those ARE translated;
  // counting them told SISEN 16 strings on his busiest screen were English
  // when they were already Khmer, which makes the whole number untrustworthy
  // and sends someone to "fix" working code.
  //
  // The pairing has to be read off the SAME element, not the file, or one
  // km= anywhere would excuse every en= everywhere.
  const bilingual = new Set();
  for (const el of src.matchAll(/<[A-Za-z][^>]*?>/gs)) {
    const tag = el[0];
    if (/\bkm\s*=\s*"/.test(tag)) {
      for (const a of tag.matchAll(/\ben\s*=\s*"([^"]{3,90})"/g)) bilingual.add(`en\u0000${a[1]}`);
    }
    if (/\btitleKm\s*=\s*"/.test(tag)) {
      for (const a of tag.matchAll(/\btitle\s*=\s*"([^"]{3,90})"/g)) bilingual.add(`title\u0000${a[1]}`);
    }
  }
  for (const m of src.matchAll(/\b(placeholder|title|subtitle|label|aria-label|hint|en)\s*=\s*"([^"]{3,90})"/g)) {
    if (!WORDY.test(m[2])) continue;
    if (bilingual.has(`${m[1]}\u0000${m[2]}`)) continue;
    n += 1;
  }
  return n;
}

let failures = 0;
const fail = (msg) => { failures += 1; console.log("  FAIL  " + msg); };

console.log("\n1. No screen may gain English\n");

let total = 0, improved = 0;
for (const f of files("src")) {
  if (f.endsWith("i18n.jsx")) continue;
  const key = f.replace(/\\/g, "/");
  const now = countEnglish(f);
  total += now;
  const was = BASELINE[key] ?? 0;
  if (now > was) fail(`${key}: ${was} → ${now} hardcoded English strings. Use t("…").`);
  else if (now < was) improved += was - now;
}
if (improved) console.log(`  ok    ${improved} string(s) translated since the baseline — lower the numbers in BASELINE`);
console.log(`  ok    ${total} hardcoded English strings remain (baseline ${Object.values(BASELINE).reduce((a, b) => a + b, 0)})`);

console.log("\n2. The dictionary is at parity\n");

// [2026-09-16] Comments come out BEFORE any key is read.
//
// A `//` note inside the dictionary explaining a new key happened to contain
// the words `English controls: "so not clean and professional"`, and that is
// the exact shape of a dictionary entry. The guard duly reported a key
// called `controls` present in English and missing in Khmer, and stopped a
// build over a sentence. A guard that can be broken by a comment teaches
// people not to write comments.
const dict = fs.readFileSync(path.join("src", "i18n.jsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");

function entries(lang) {
  const i = dict.indexOf("\n  " + lang + ": {");
  const j = dict.indexOf("\n  },", i);
  const m = new Map();
  // several keys share a line, and values contain escaped quotes
  for (const x of dict.slice(i, j).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"((?:[^"\\]|\\.)*)"/g)) m.set(x[1], x[2]);
  return m;
}
const en = entries("en"), km = entries("km");
const onlyEn = [...en.keys()].filter((k) => !km.has(k));
const onlyKm = [...km.keys()].filter((k) => !en.has(k));
if (onlyEn.length) fail(`in en but not km: ${onlyEn.join(", ")}`);
if (onlyKm.length) fail(`in km but not en: ${onlyKm.join(", ")}`);
if (!onlyEn.length && !onlyKm.length) console.log(`  ok    ${en.size} keys, both languages, no orphans`);

console.log("\n3. Every key the app asks for exists\n");

let unresolved = 0;
for (const f of files("src").concat(
  fs.readdirSync("src").filter((n) => /\.js$/.test(n)).map((n) => path.join("src", n)),
)) {
  const src = fs.readFileSync(f, "utf8");
  for (const k of new Set([...src.matchAll(/\bt\(\s*"([a-z][a-z0-9_]*)"\s*\)/g)].map((m) => m[1]))) {
    if (!en.has(k)) { fail(`t("${k}") in ${f} has no English`); unresolved += 1; }
    else if (!km.has(k)) { fail(`t("${k}") in ${f} has no Khmer`); unresolved += 1; }
  }
}
if (!unresolved) console.log("  ok    every t() key resolves in both languages");

// [2026-09-17] A Khmer entry that is still English is WORSE than a missing one.
//
// Missing shows up as a crash or a blank. English-in-the-Khmer-column looks
// finished: the key is there, the parity check above is happy, and the screen
// quietly speaks English to somebody who cannot read it. Found by this very
// check on the day it was written — `role_admin` had sat as "HQ Admin" in the
// Khmer dictionary, next to two siblings that were properly translated.
//
// A Khmer value is only suspicious when it has NO Khmer letters at all AND
// contains a real English word. "5451", "kg", "QR", "{station}" are all fine.
const KHMER_LETTER = /[\u1780-\u17FF]/;
const ENGLISH_WORD = /[A-Za-z]{4,}/;
// The brand is the brand in both languages.
const BRAND_KEYS = new Set(["appName"]);
{
  const kmBlock = dict.slice(dict.indexOf("\n  km: {"));
  let englishInKhmer = 0;
  for (const m of kmBlock.matchAll(/^\s*([a-z][A-Za-z0-9_]*)\s*:\s*"((?:[^"\\]|\\.)*)"/gm)) {
    const [, key, value] = m;
    if (BRAND_KEYS.has(key)) continue;
    if (KHMER_LETTER.test(value)) continue;
    if (!ENGLISH_WORD.test(value)) continue;
    fail(`km.${key} is still English: "${value}"`);
    englishInKhmer += 1;
  }
  if (!englishInKhmer) console.log("  ok    no Khmer entry is secretly still English");
}

console.log(
  failures === 0
    ? "\nAll checks passed. English cannot creep back in.\n"
    : `\n${failures} FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
