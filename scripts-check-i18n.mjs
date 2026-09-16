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
  "src/App.jsx": 2,
  "src/components/AddLocationModal.jsx": 5,
  "src/components/AddUserModal.jsx": 12,
  "src/components/DateRangeFilter.jsx": 4,
  "src/components/EditedBadge.jsx": 4,
  "src/components/LiveWeightBox.jsx": 1,
  "src/components/LocationFilter.jsx": 2,
  "src/components/MobileNav.jsx": 2,
  "src/components/MonthlyClosePanel.jsx": 11,
  "src/components/RenameLocationModal.jsx": 4,
  "src/components/Sidebar.jsx": 1,
  "src/components/StationDaysReview.jsx": 7,
  "src/components/Topbar.jsx": 18,
  "src/components/WeightField.jsx": 2,
  "src/pages/ChangeRequests.jsx": 22,
  "src/pages/DailyBook.jsx": 2,
  "src/pages/DataCheck.jsx": 21,
  "src/pages/Expenses.jsx": 1,
  "src/pages/LocationDetail.jsx": 15,
  "src/pages/LocationsPage.jsx": 19,
  "src/pages/Login.jsx": 1,
  "src/pages/Receipt.jsx": 20,
  "src/pages/ReceiptTemplateEditor.jsx": 1,
  "src/pages/RegisterFarmer.jsx": 11,
  "src/pages/RegisterPartyStaff.jsx": 3,
  "src/pages/ReportAuditLog.jsx": 6,
  "src/pages/ReportCapital.jsx": 44,
  "src/pages/ReportFinanceSetup.jsx": 37,
  "src/pages/ReportPayables.jsx": 30,
  "src/pages/ReportPurchases.jsx": 31,
  "src/pages/ReportReceivables.jsx": 24,
  "src/pages/ReportSales.jsx": 30,
  "src/pages/ReportShrinkage.jsx": 28,
  "src/pages/ReportStock.jsx": 14,
  "src/pages/ReportTax.jsx": 14,
  "src/pages/RolesPage.jsx": 22,
  "src/pages/SetPassword.jsx": 8,
  "src/pages/SettingsPage.jsx": 5,
  "src/pages/StationHealth.jsx": 6,
  "src/pages/StockInventory.jsx": 1,
  "src/pages/TransactionForm.jsx": 41,
  "src/pages/Transactions.jsx": 169,
  "src/pages/UsersPage.jsx": 26,
  "src/pages/WeighingTickets.jsx": 98
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
  for (const m of src.matchAll(/\b(placeholder|title|subtitle|label|aria-label|hint|en)\s*=\s*"([^"]{3,90})"/g)) {
    if (WORDY.test(m[2])) n += 1;
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

const dict = fs.readFileSync(path.join("src", "i18n.jsx"), "utf8");
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

console.log(
  failures === 0
    ? "\nAll checks passed. English cannot creep back in.\n"
    : `\n${failures} FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
