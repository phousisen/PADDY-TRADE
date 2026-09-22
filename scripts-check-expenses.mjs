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
import {
  windowFor, shiftAnchor, filterRows, totals, byPeriod, byCategory, byStation,
  stationsOn, periodKeyOf, isoWeekKey, childGrain, daysInWindow, mergeByCategory,
  planDaySave,
} from "./src/expenseBook.js";

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

console.log("\n4. Day, week, month, year — and they must agree\n");

// 90 days of expenses across three stations, some commission some not.
const LOCS = [{ id: "L1", name: "JOMNOUM" }, { id: "L2", name: "PING PONG" }, { id: "L3", name: "PONG RO" }];
const book = [];
let seed = 20260916;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = 0; i < 90; i += 1) {
  const d = new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);
  for (const l of LOCS) {
    if (rnd() < 0.12) continue;                       // some days nobody entered
    book.push({ pay_date: d, location_id: l.id, category: COMMISSION_CATEGORY, amount: Math.round(rnd() * 40 + 10) * 1000 });
    book.push({ pay_date: d, location_id: l.id, category: rnd() < 0.5 ? "Fuel" : "Salary", amount: Math.round(rnd() * 90 + 20) * 1000 });
  }
}

const whole = totals(book);
const sumOf = (ps) => ps.reduce((a, p) => ({
  commission: a.commission + p.commission, other: a.other + p.other, total: a.total + p.total,
}), { commission: 0, other: 0, total: 0 });

const days = byPeriod(book, "day");
const weeks = byPeriod(book, "week");
const months = byPeriod(book, "month");
const years = byPeriod(book, "year");

for (const [name, ps] of [["days", days], ["weeks", weeks], ["months", months], ["years", years]]) {
  const s2 = sumOf(ps);
  check(`${name} add up to the same total`, s2.total === whole.total, `${s2.total} vs ${whole.total}`);
  check(`${name} keep commission apart correctly`, s2.commission === whole.commission, `${s2.commission} vs ${whole.commission}`);
}
check("commission plus other is the total, at every grain",
  days.every((d) => d.commission + d.other === d.total)
  && weeks.every((w) => w.commission + w.other === w.total)
  && months.every((m) => m.commission + m.other === m.total));
check("grouping by category loses nothing",
  byCategory(book).reduce((a, c) => a + c.amount, 0) === whole.total);
check("grouping by station loses nothing",
  sumOf(byStation(book, LOCS)).total === whole.total);
check("periods come back newest first",
  months[0].key > months[months.length - 1].key, JSON.stringify(months.map((m) => m.key)));

// Week keys: 1 Jan 2026 is a Thursday, so it belongs to ISO week 1.
check("ISO week of 1 Jan 2026 is week 1", isoWeekKey("2026-01-01") === "2026-W01", isoWeekKey("2026-01-01"));
// 1 Jan 2023 was a Sunday — ISO puts it in the LAST week of 2022.
check("1 Jan 2023 belongs to 2022's last week", isoWeekKey("2023-01-01") === "2022-W52", isoWeekKey("2023-01-01"));
check("period keys are the right shape",
  periodKeyOf("2026-09-16", "day") === "2026-09-16"
  && periodKeyOf("2026-09-16", "month") === "2026-09"
  && periodKeyOf("2026-09-16", "year") === "2026");

console.log("\n5. The window the arrows move\n");

const wDay = windowFor("day", "2026-09-16");
check("day and week grains are read one month at a time",
  wDay.from === "2026-09-01" && wDay.to === "2026-09-30", JSON.stringify(wDay));
check("February is 28 days in 2026, not 30",
  windowFor("day", "2026-02-10").to === "2026-02-28", windowFor("day", "2026-02-10").to);
check("a leap February is 29",
  windowFor("day", "2024-02-10").to === "2024-02-29", windowFor("day", "2024-02-10").to);
check("the month grain is read one year at a time",
  windowFor("month", "2026-09-16").from === "2026-01-01" && windowFor("month", "2026-09-16").to === "2026-12-31");
check("the year grain has no window and no arrows",
  windowFor("year", "2026-09-16").from === null && windowFor("year", "2026-09-16").unit === null);
check("stepping back from January lands in December",
  shiftAnchor("day", "2026-01-15", -1).slice(0, 7) === "2025-12", shiftAnchor("day", "2026-01-15", -1));
check("stepping a month grain moves a whole year",
  shiftAnchor("month", "2026-06-01", -1).slice(0, 4) === "2025");
check("filtering by window and station both bite",
  filterRows(book, { from: "2026-06-01", to: "2026-06-30", locationIds: ["L1"] })
    .every((r) => r.pay_date <= "2026-06-30" && r.location_id === "L1"));

console.log("\n6. A blank day is not a zero day\n");

const DAY = "2026-06-02";
const st = stationsOn(DAY, LOCS,
  [{ pay_date: DAY, location_id: "L1", category: "Fuel", amount: 50000 }],
  [{ day: DAY, location_id: "L2" }]);
check("a station that spent money reads as spent",
  st.find((x) => x.id === "L1").state === "spent");
check("a station marked empty reads as nothing, not blank",
  st.find((x) => x.id === "L2").state === "nothing");
check("a station nobody entered reads as blank",
  st.find((x) => x.id === "L3").state === "blank");
check("every station appears, including the ones with nothing",
  st.length === LOCS.length);
check("opening a day shows stations; opening bigger shows the grain below",
  childGrain("day") === null && childGrain("week") === "day"
  && childGrain("month") === "day" && childGrain("year") === "month");

console.log("\n7. The screen keeps its promises\n");

const src = fs.readFileSync(path.join("src", "pages", "Expenses.jsx"), "utf8");
const apiSrc = fs.readFileSync(path.join("src", "api.js"), "utf8");

check("a day with nothing spent is recorded, not left blank",
  /markExpenseDayEmpty/.test(src) && /markExpenseDayEmpty/.test(apiSrc));
check("recording money on a day clears the 'nothing spent' mark",
  /clearExpenseDayMark/.test(src) && /clearExpenseDayMark/.test(apiSrc));
// [2026-09-17] Rewritten for the card, not the old table row.
//
// This used to look for `s.state === "blank" ? null`, which was the exact
// line that printed a dash instead of a zero in the old five-thin-rows
// layout. Opening a day now gives a card per station with its CATEGORIES in
// it (SISEN: "i want to be able to see what the spending is on each day —
// for each location"), so that line is gone and the distinction lives in
// DayStation's `filed` / `nothing` instead.
//
// The RULE is unchanged and is what matters: a station that spent nothing
// and a station that never filed must not look the same. One is a fact about
// the business; the other is a fact about the paperwork.
check("the table tells a real zero from a day nobody entered",
  /ex_nothing_spent/.test(src) && /ex_not_entered/.test(src)
  && /station\.state === "spent"/.test(src)
  && /station\.state === "nothing"/.test(src)
  && /nothing \? t\("ex_nothing_spent"\) : t\("ex_not_entered"\)/.test(src));
check("a station that has not filed still offers the button to file it",
  /filed \? t\("ex_open"\) : t\("ex_enter"\)/.test(src));
check("one station chosen drops the station header — there is nothing to label",
  /only \? "" : "px-3 pb-2\.5"/.test(src) && /if \(only\) \{/.test(src));
check("reaching back past today asks for a password",
  /needsPassword/.test(src) && /ConfirmPassword/.test(src)
  && /sheet\.day !== today/.test(src));
check("adding to an empty box does NOT ask for a password",
  /payload\.changesExisting && needsPassword/.test(src));
check("an amendment is written to the audit log with its reason",
  /action:\s*"edit_expense"/.test(apiSrc) && /reason:\s*\(reason \|\| ""\)/.test(apiSrc));
check("amending only writes the fields actually passed",
  /if \(amount !== undefined\) patch\.amount/.test(apiSrc)
  && /if \(category !== undefined\) patch\.category/.test(apiSrc));
check("the amount box has no width class that can be beaten",
  /const fieldBase = "rounded-lg/.test(src) && !/const inputCls = "w-full rounded-lg[\s\S]*?amountCls = `\$\{inputCls\}/.test(src));
check("the entry sheet is behind a button, not on the page",
  /ex_enter_a_day/.test(src) && /sheet && \(/.test(src));
check("the table can be grouped three ways",
  /GROUPS = \[\["period"/.test(src));
check("all four grains are offered",
  /GRAINS = \[\["day", "ex_day"\], \["week", "ex_week"\], \["month", "ex_month"\], \["year", "ex_year"\]\]/.test(src));
// [2026-09-16] The assertions above used to match the English words on
// screen, and broke the moment the page was translated — a guard tied to
// interface text punishes translating it. They match i18n keys now.
// Whether any English is LEFT on this screen is scripts-check-i18n.mjs's
// job; it has a detector tuned for it and a per-file ratchet.
check("recording and correcting are separate permissions",
  /record_expenses/.test(fs.readFileSync(path.join("src", "permissions.js"), "utf8"))
  && /edit_expenses/.test(fs.readFileSync(path.join("src", "permissions.js"), "utf8")));


console.log("\n8. A missing day is visible, and a duplicate can be fixed\n");

// daysInWindow lists the CALENDAR, not the rows that happen to exist.
{
  const ds = daysInWindow("2026-09-01", "2026-09-30", "2026-09-16");
  check("every day up to today is listed, not just the ones with expenses",
    ds.length === 16, `got ${ds.length}`);
  check("newest first, like every other grain",
    ds[0] === "2026-09-16" && ds[ds.length - 1] === "2026-09-01", `${ds[0]} … ${ds[ds.length - 1]}`);
  check("future days are not listed — an empty 30th is not a gap",
    !ds.includes("2026-09-30"));
  check("a month already past lists all of its days",
    daysInWindow("2026-08-01", "2026-08-31", "2026-09-16").length === 31);
  check("February 2026 has 28",
    daysInWindow("2026-02-01", "2026-02-28", "2026-12-31").length === 28);
}

// mergeByCategory — the bug that made a duplicate unfixable.
{
  const day = [
    { id: "a", category: "Fuel", amount: 150000 },
    { id: "b", category: "Fuel", amount: 150000 },   // the duplicate
    { id: "c", category: COMMISSION_CATEGORY, amount: 80000 },
  ];
  const m = mergeByCategory(day);
  const fuel = m.get(categoryKey("Fuel"));
  check("two rows of one category read as ONE line", m.size === 2, `got ${m.size}`);
  check("and the line shows their SUM, not one of them",
    fuel.amount === 300000, `got ${fuel.amount}`);
  check("both rows are kept, so saving can collapse them",
    fuel.rows.length === 2 && fuel.rows[0].id === "a" && fuel.rows[1].id === "b");
  check("a category with one row is untouched",
    m.get(categoryKey(COMMISSION_CATEGORY)).rows.length === 1);
  check("spellings that differ invisibly merge too",
    mergeByCategory([{ id: "x", category: "Fuel", amount: 1 },
                     { id: "y", category: "Fu​el", amount: 2 }]).size === 1);
}

const src2 = fs.readFileSync(path.join("src", "pages", "Expenses.jsx"), "utf8");
check("the sheet sums duplicates rather than showing one of them",
  /mergeByCategory\(existingRows\)/.test(src2));
check("saving voids the extra rows instead of leaving them",
  /voidPayment\(x\.id/.test(src2));
check("an empty day is listed and marked, not omitted",
  /empty: true/.test(src2) && /ex_not_entered/.test(src2));
check("every alert can open the day it is about",
  /setSheet\(\{ day: a\.day, locationId: a\.locationId \}\)/.test(src2));
check("the duplicate alert names its category",
  /cleanCategory\(row\?\.category\)/.test(src2));


console.log("\n9. A written figure is locked\n");

const src3 = fs.readFileSync(path.join("src", "pages", "Expenses.jsx"), "utf8");
check("a figure already saved renders locked, not as an open box",
  // [2026-09-21] Also locked when the sheet cannot be edited at all (a day the
  // manager has confirmed, seen by staff) — the rule is unchanged.
  /const locked = !!saved && \(!unlocked \|\| !canEdit\);/.test(src3));
check("an EMPTY box stays open — adding is not editing",
  /const locked = !!saved && \(!unlocked/.test(src3) && !/const locked = !unlocked;/.test(src3));
check("unlocking asks for the password",
  /onUnlock=\{\(\) => setPwPrompt\(\{ unlockOnly: true \}\)\}/.test(src3));
check("unlocking alone changes nothing — it opens the boxes",
  /if \(p\.unlockOnly\) setUnlocked\(true\);/.test(src3));
check("who changed it and when is shown beside the figure",
  /ex_changed_by/.test(src3) && /edit\.by/.test(src3) && /edit\.at/.test(src3));
check("a change still needs a reason",
  /const mustExplain = changesExisting;/.test(src3));
check("saving no longer jumps to another station",
  !/setSheet\(\{ day: sheet\.day, locationId: next\.id \}\)/.test(src3)
  && /setJustSaved\(true\)/.test(src3));
check("the lock resets when the sheet moves to another day or station",
  /setJustSaved\(false\); setUnlocked\(false\);/.test(src3));

const apiSrc3 = fs.readFileSync(path.join("src", "api.js"), "utf8");
check("who edited is read from audit_logs, nothing new stored",
  /getExpenseEdits/.test(apiSrc3) && /\.eq\("action", "edit_expense"\)/.test(apiSrc3));
check("the newest edit per row wins",
  /if \(out\[row\.record_id\]\) continue;/.test(apiSrc3));

// ---------------------------------------------------------------------------
// Erasing a figure must actually erase it
//
// [2026-09-17] SISEN: "why even after i edit and erase some excpenses. its not
// gone. make this function properly. like srsly this has to be very
// professional."
//
// He was right, and the cause was one line — the sheet filtered out every
// empty box before the save saw it, so an emptied box and a box that never
// held anything were the same thing: nothing. There was no way to take a
// wrongly entered expense off a day at all.
//
// Three ways this can go wrong again, worst first:
//
//   · ERASING SILENTLY DOES NOTHING. The original bug. The figure stays, the
//     person believes they removed it, and every total downstream is wrong
//     with nobody looking.
//   · ERASING TAKES OUT ONE ROW OF TWO. A day with a duplicate pair would
//     read as emptied on screen while still carrying half the money.
//   · ERASING SLIPS THROUGH WITHOUT A REASON. Taking 1.2 million riel off a
//     day is a bigger act than changing it. It needs the same password and
//     the same written reason, or the trail has a hole exactly where the
//     money left.
// ---------------------------------------------------------------------------
{
  const rows = (...a) => a.map(([id, category, amount]) => ({ id, category, amount }));
  const merge = (rs) => mergeByCategory(rs);

  const day = rows(
    ["p1", "ថ្លៃកូនដៃ", 1206950],
    ["p2", "ថ្លៃចូក", 582725],
    ["p3", "ផ្សេងៗ", 125000],
  );
  const shown = ["ថ្លៃកូនដៃ", "ថ្លៃចូក", "ផ្សេងៗ", "Salary", "Fuel"];
  const K = categoryKey;

  const same = planDaySave({
    shown, merged: merge(day),
    amounts: { [K("ថ្លៃកូនដៃ")]: "1206950", [K("ថ្លៃចូក")]: "582725", [K("ផ្សេងៗ")]: "125000" },
  });
  check("nothing typed differently is not a change", same.changesExisting === false);
  check("and removes nothing", same.removals.length === 0);
  check("but still sends every figure", same.entries.length === 3);

  const cleared = planDaySave({
    shown, merged: merge(day),
    amounts: { [K("ថ្លៃកូនដៃ")]: "1206950", [K("ថ្លៃចូក")]: "", [K("ផ្សេងៗ")]: "125000" },
  });
  check("an emptied box becomes a REMOVAL, not silence", cleared.removals.length === 1,
        JSON.stringify(cleared.removals));
  check("and names the right category", cleared.removals[0].category === "ថ្លៃចូក");
  check("and carries the row to void", cleared.removals[0].rows.map((r) => r.id).join() === "p2");
  check("and carries what is being taken off", cleared.removals[0].amount === 582725);
  check("the cleared category is NOT sent as an entry",
        !cleared.entries.some((e) => e.category === "ថ្លៃចូក"));
  check("the other two are untouched", cleared.entries.length === 2);
  check("removing counts as changing an existing figure — password and reason",
        cleared.changesExisting === true,
        "taking money off a day is at least as serious as altering it");

  const untouched = planDaySave({
    shown, merged: merge(day),
    amounts: { [K("ថ្លៃកូនដៃ")]: "1206950", [K("ថ្លៃចូក")]: "582725", [K("ផ្សេងៗ")]: "125000", [K("Salary")]: "" },
  });
  check("an always-empty box removes nothing", untouched.removals.length === 0,
        "otherwise every blank line on the sheet would try to delete something");
  check("and is not a change", untouched.changesExisting === false);

  const all = planDaySave({ shown, merged: merge(day), amounts: {} });
  check("clearing every box removes every figure", all.removals.length === 3);
  check("and sends no entries", all.entries.length === 0);

  const dup = rows(["a", "ថ្លៃចូក", 300000], ["b", "ថ្លៃចូក", 282725]);
  const dupCleared = planDaySave({
    shown: ["ថ្លៃចូក"], merged: merge(dup), amounts: { [K("ថ្លៃចូក")]: "" },
  });
  check("a duplicated category removes ALL its rows", dupCleared.removals[0].rows.length === 2,
        "one row left behind would look emptied while still holding money");
  check("and reports the full amount", dupCleared.removals[0].amount === 582725);

  const edited = planDaySave({
    shown, merged: merge(day),
    amounts: { [K("ថ្លៃកូនដៃ")]: "109300", [K("ថ្លៃចូក")]: "582725", [K("ផ្សេងៗ")]: "125000" },
  });
  check("changing a figure is still a change", edited.changesExisting === true);
  check("and is not a removal", edited.removals.length === 0);

  const junk = planDaySave({
    shown, merged: merge(day),
    amounts: { [K("ថ្លៃកូនដៃ")]: "abc", [K("ថ្លៃចូក")]: "582725", [K("ផ្សេងៗ")]: "125000" },
  });
  check("unreadable text is treated as empty, so it cannot silently keep a figure",
        junk.removals.length === 1 && junk.removals[0].category === "ថ្លៃកូនដៃ");

  check("a zero is a figure, not an erasure",
        planDaySave({
          shown: ["ថ្លៃចូក"], merged: merge(rows(["z", "ថ្លៃចូក", 5000])),
          amounts: { [K("ថ្លៃចូក")]: "0" },
        }).removals.length === 0,
        "0 means 'nothing was spent on this', which is a recorded fact");

  console.log("  erasing a figure removes it, and says so first");
}

// The screen must actually use the planner, and the save must VOID rather than
// delete — the record of a removed expense has to survive it.
{
  const page = fs.readFileSync(path.join("src", "pages", "Expenses.jsx"), "utf8");
  check("the day sheet uses planDaySave", /planDaySave\(\{ shown, amounts, merged/.test(page),
        "the old inline filter is what dropped emptied boxes");
  check("the old drop-every-empty-box filter is gone",
        !/\.filter\(\(e\) => e\.amount != null\)/.test(page));
  check("removals reach the save", /onSave\(\{ entries, removals/.test(page));
  check("and are voided, not deleted", /api\.voidPayment\(row\.id/.test(page));
  check("every row of a removal is voided", /for \(const row of r\.rows\)/.test(page));
  check("the sheet says what it is about to take off", /ex_removing_title/.test(page));
  check("and marks the box that will remove something", /ex_will_remove/.test(page));
}

console.log(
  failures === 0
    ? `\nAll checks passed. Commission stands alone; a category is only new when it is.\n`
    : `\n${failures} FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
