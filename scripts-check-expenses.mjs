// Proves the expense category logic, and that commission never merges away.
//
// [2026-09-16] Run:  node scripts-check-expenses.mjs
//
// WHY THIS EXISTS
//
// Two things on this screen are easy to get wrong and invisible when wrong:
//
//   1. Whether a "new" category is genuinely new. Too strict and staff
//      cannot add one; too loose and ថ្លៃកូនដៃ quietly becomes two lines on
//      every report, exactly as សែន ក្រអូប became seven paddy types.
//
//   2. Whether ថ្លៃកូនដៃ stays on its own. SISEN asked for it separated
//      because he is trying to cut it, and a commission averaged into salary
//      cannot be seen to move.

import fs from "node:fs";
import path from "node:path";
import {
  COMMISSION_CATEGORY, SEED_CATEGORIES, categoryKey, categoryList,
  isCommission, nearlyTheSame, splitByCategory,
} from "./src/expenseCategories.js";

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`); }
}

console.log("\n1. Commission is its own category, always\n");

check("the commission category has a name", !!COMMISSION_CATEGORY.trim());
check("it is seeded, so it exists before anyone records anything",
  SEED_CATEGORIES.some(isCommission));
check("Salary is NOT the commission", !isCommission("Salary"));
check("nothing else is mistaken for it",
  !["Fuel", "Rent", "Utilities", "Repairs & Maintenance", "Carrying Service"].some(isCommission));
check("it is recognised through invisible characters",
  isCommission(`${COMMISSION_CATEGORY}​`));
check("it is recognised with stray spacing",
  isCommission(`  ${COMMISSION_CATEGORY} `));
check("an empty value is not the commission",
  !isCommission("") && !isCommission(null) && !isCommission(undefined));

const rows = [
  { category: COMMISSION_CATEGORY, amount: 1340000 },
  { category: "Salary", amount: 2150000 },
  { category: "Fuel", amount: 690000 },
  // The same commission again, carrying a zero-width space.
  { category: `ថ្លៃកូនដៃ​`, amount: 60000 },
];
const split = splitByCategory(rows);

check("commission is totalled apart from everything else",
  split.commission === 1400000, `got ${split.commission}`);
check("everything else is totalled together",
  split.other === 2840000, `got ${split.other}`);
check("the two add up to the whole",
  split.total === 4240000 && split.total === split.commission + split.other,
  `got ${split.total}`);
check("an invisible-character duplicate folds into ONE line",
  split.categories.filter((c) => isCommission(c.category)).length === 1,
  JSON.stringify(split.categories.map((c) => c.category)));
check("commission leads the list, whatever its size",
  isCommission(split.categories[0].category),
  JSON.stringify(split.categories.map((c) => c.category)));
check("no amount is lost when spellings fold together",
  split.categories.reduce((s, c) => s + c.amount, 0) === 4240000);

console.log("\n2. A new category is only new when it is\n");

const existing = categoryList([{ category: "Fuel" }, { category: "Rent" }]);

const exact = nearlyTheSame("fuel", existing);
check("the same word in different case is the SAME category",
  exact && exact.exact && exact.name === "Fuel", JSON.stringify(exact));

const invisible = nearlyTheSame("Fu​el", existing);
check("a zero-width character does not make a new category",
  invisible && invisible.exact, JSON.stringify(invisible));

const spaced = nearlyTheSame("  Fuel  ", existing);
check("stray spaces do not make a new category",
  spaced && spaced.exact, JSON.stringify(spaced));

const typo = nearlyTheSame("Fule", existing);
check("a one-letter slip is offered as a near match, not an exact one",
  typo && !typo.exact && typo.name === "Fuel", JSON.stringify(typo));

// Transposition — the commonest typing mistake, and the one plain edit
// distance misses. Each of these is ONE swap from the real word.
for (const [typed, real] of [["Fule","Fuel"],["Rnet","Rent"],["Salray","Salary"]]) {
  const m = nearlyTheSame(typed, categoryList([{ category: real }]));
  check(`"${typed}" is offered as "${real}"`, m && !m.exact && m.name === real, JSON.stringify(m));
}

check("a genuinely different word is NOT blocked",
  nearlyTheSame("Police fee", existing) === null);
check("another genuinely different word is not blocked",
  nearlyTheSame("Bank charges", existing) === null);
check("an empty name matches nothing",
  nearlyTheSame("", existing) === null && nearlyTheSame("   ", existing) === null);

// Short words are where a one-edit rule does damage: "Tax" and "Fax" are one
// edit apart and are not the same thing.
check("short words are not near-matched to each other",
  nearlyTheSame("Tax", categoryList([{ category: "Fax" }])) === null);
check("but a short word still matches itself exactly",
  (nearlyTheSame("tax", categoryList([{ category: "Tax" }])) || {}).exact === true);

console.log("\n3. The list itself\n");

const list = categoryList([
  { category: "Fuel" }, { category: "fuel" }, { category: "  Fuel" },
  { category: "Police fee" }, { category: null }, { category: "" },
]);
check("one entry per real category, however it was spelled",
  list.filter((n) => categoryKey(n) === categoryKey("Fuel")).length === 1,
  JSON.stringify(list));
check("blank and null categories are dropped",
  !list.some((n) => !n || !n.trim()));
check("a category used but not seeded still appears",
  list.some((n) => categoryKey(n) === categoryKey("Police fee")));
check("commission is on the list before anything is recorded",
  categoryList([]).some(isCommission));

console.log("\n4. The screen keeps its promises\n");

const src = fs.readFileSync(path.join("src", "pages", "Expenses.jsx"), "utf8");
const apiSrc = fs.readFileSync(path.join("src", "api.js"), "utf8");

check("a day with nothing spent is recorded, not left blank",
  /markExpenseDayEmpty/.test(src) && /markExpenseDayEmpty/.test(apiSrc));
check("recording money on a day clears the 'nothing spent' mark",
  /clearExpenseDayMark/.test(src) && /clearExpenseDayMark/.test(apiSrc));
check("the grid tells a real zero from a day nobody entered",
  /Nothing spent — recorded/.test(src) && /Nobody has entered this day/.test(src));
check("reaching back past today asks for a password",
  /editLocked/.test(src) && /ConfirmPassword/.test(src));
check("an amendment is written to the audit log with its reason",
  /action:\s*"edit_expense"/.test(apiSrc) && /reason:\s*\(reason \|\| ""\)/.test(apiSrc));
check("amending only writes the fields actually passed",
  /if \(amount !== undefined\) patch\.amount/.test(apiSrc)
  && /if \(category !== undefined\) patch\.category/.test(apiSrc));
check("recording and correcting are separate permissions",
  /record_expenses/.test(fs.readFileSync(path.join("src", "permissions.js"), "utf8"))
  && /edit_expenses/.test(fs.readFileSync(path.join("src", "permissions.js"), "utf8")));

console.log(
  failures === 0
    ? `\nAll checks passed. Commission stands alone; a category is only new when it is.\n`
    : `\n${failures} FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
