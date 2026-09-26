// scripts-check-expense-review.mjs — every expense has two people behind it.
//
// [2026-09-21] SISEN: "i want to let the manager go through it and confirm
// the expenses and all so we know that the expenses is there because 2
// people has agreed so they can be responsible." And: "how can a staff
// correct the manager's confirm or edit unless they can make a request".
//
// The rules are enforced by expense_confirmation.sql; this checks the screen
// reads them the same way, and that the SQL still carries them.
//
// Run: node scripts-check-expense-review.mjs
import { readFileSync, existsSync } from "node:fs";
import { buildReviewDays, statusOf, summarize, confirmedShare, dayMark, canConfirmDay, lockedFor } from "./src/expenseReview.js";

let failed = 0;
const ok = (name, cond) => { if (cond) console.log(`  ok    ${name}`); else { failed += 1; console.log(`  FAIL  ${name}`); } };

const STAFF = "u_staff", MGR = "u_mgr";
const L1 = "pp", L2 = "td";
const locations = [{ id: L1, name: "PING PONG" }, { id: L2, name: "THAPEDEY" }];
const e = (loc, day, cat, amt, by = STAFF) => ({ location_id: loc, pay_date: day, category: cat, amount: amt, created_by: by, createdByName: by === STAFF ? "Sophea" : "Manager", created_at: `${day}T11:00:00Z` });
const expenses = [
  e(L1, "2026-09-20", "Fuel", 150000), e(L1, "2026-09-20", "Carrying Service", 300000),
  e(L2, "2026-09-20", "Fuel", 100000),
  e(L1, "2026-09-19", "Rent", 60000),
  e(L2, "2026-09-19", "Fuel", 5000, MGR),
  e(L1, "2026-09-18", "Fuel", 70000),
];
const reviews = [
  { location_id: L1, day: "2026-09-19", status: "confirmed", is_current: true, corrected: false, decided_by_name: "Manager" },
  { location_id: L1, day: "2026-09-18", status: "confirmed", is_current: false },
  { location_id: L2, day: "2026-09-20", status: "sent_back", is_current: true, note: "check fuel" },
];
const days = buildReviewDays({ expenses, reviews, locations, userId: MGR });
const get = (loc, day) => days.find((d) => d.locationId === loc && d.day === day);

ok("one station-day per row, totals added", days.length === 5 && get(L1, "2026-09-20").total === 450000);
ok("newest day first", days[0].day === "2026-09-20" && days[days.length - 1].day === "2026-09-18");
ok("no review yet → waiting (new)", get(L1, "2026-09-20").status === "waiting" && get(L1, "2026-09-20").why === "new");
ok("confirmed and unchanged → confirmed", get(L1, "2026-09-19").status === "confirmed");
ok("confirmed but changed since → waiting (changed)", get(L1, "2026-09-18").status === "waiting" && get(L1, "2026-09-18").why === "changed");
ok("sent back, unchanged → sent back", get(L2, "2026-09-20").status === "sent_back");
ok("sent back, then fixed → waiting (fixed)", statusOf({ status: "sent_back", is_current: false }).why === "fixed");
ok("staff answered 'it is right' → waiting (replied)", statusOf({ status: "resubmitted", is_current: true }).why === "replied");

// [2026-09-25] REVERSED ON PURPOSE. SISEN: "the financehq manager should not
// need a confirmation from me." Holding confirm_expenses is now the whole
// test — station staff never hold it, so the two-person rule still stands
// everywhere it was meant to. See expenseReview.js and
// FOR-SUPABASE-expense-selfconfirm.sql.
ok("a manager CAN confirm a day they entered themselves", canConfirmDay(get(L2, "2026-09-19"), { canConfirm: true, userId: MGR }));
ok("...and still nobody without the permission can, own day or not", !canConfirmDay(get(L2, "2026-09-19"), { canConfirm: false, userId: MGR }));
ok("manager can confirm a day staff entered", canConfirmDay(get(L1, "2026-09-20"), { canConfirm: true, userId: MGR }));
ok("nobody without the permission can confirm", !canConfirmDay(get(L1, "2026-09-20"), { canConfirm: false, userId: STAFF }));
ok("a confirmed day is not offered again", !canConfirmDay(get(L1, "2026-09-19"), { canConfirm: true, userId: MGR }));
ok("a confirmed day is locked for staff", lockedFor(get(L1, "2026-09-19"), { canConfirm: false }));
ok("…but not for the manager (who corrects it)", !lockedFor(get(L1, "2026-09-19"), { canConfirm: true }));
ok("a waiting day is not locked", !lockedFor(get(L1, "2026-09-20"), { canConfirm: false }));

const s = summarize(days, { from: "2026-09-01", requests: [{ status: "pending" }, { status: "approved" }] });
ok("boxes: waiting 3 · confirmed 1 · sent back 1 · 1 request", s.waiting.n === 3 && s.confirmed.n === 1 && s.sentBack.n === 1 && s.requests.n === 1);
ok("boxes: amounts", s.confirmed.amount === 60000 && s.sentBack.amount === 100000);
const share = confirmedShare(days, { from: "2026-09-01", to: "2026-09-30" });
ok("report: confirmed vs not yet, nothing lost", share.confirmed === 60000 && share.open === 450000 + 100000 + 5000 + 70000);
ok("report: one station filter", confirmedShare(days, { locationIds: [L2] }).confirmed === 0);
ok("report day mark: sent back wins", dayMark(days, "2026-09-20").kind === "sent_back");
ok("report day mark: 1 of 2 waiting", (() => { const m = dayMark(days, "2026-09-19"); return m.kind === "waiting" && m.n === 1 && m.of === 2; })());
ok("report day mark: all confirmed", dayMark(days, "2026-09-19", [L1]).kind === "confirmed");

// The rules must live in the database, not only here.
const sqlPath = "expense_confirmation.sql";
if (existsSync(sqlPath)) {
  const sql = readFileSync(sqlPath, "utf8");
  // confirm_expense_day is replaced by a later file. The install script above
  // still carries the ORIGINAL body, so anything about that one function has
  // to be read from the last file that rewrote it — otherwise this guard is
  // checking a version of the database nobody is running any more.
  const laterPath = "FOR-SUPABASE-expense-selfconfirm.sql";
  // Comments stripped: that file QUOTES the old rule while explaining why it
  // is gone, and a guard that reads the explanation as the code would fail on
  // a correct file.
  const liveSql = (existsSync(laterPath) ? readFileSync(laterPath, "utf8") : sql)
    .split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
  ok("SQL: only confirm_expenses / Owner may confirm", /expense_can\('confirm_expenses'\)/.test(sql) && /Only the manager or the Owner can confirm expenses/.test(sql));
  // [2026-09-25] This used to assert the opposite — that the database refuses
  // a day you entered yourself (`if v_mine = v_rows then`). That rule is being
  // removed by FOR-SUPABASE-expense-selfconfirm.sql, so a guard still checking
  // for it would pass while describing a database that no longer exists. The
  // permission check above is now the whole test, here and in the database.
  ok("SQL: the self-confirm refusal is gone from the live function",
     !/if v_mine = v_rows then/.test(liveSql),
     "run FOR-SUPABASE-expense-selfconfirm.sql — until then HQ's own day still lands on the Owner");
  ok("SQL: a confirmed day is locked for staff by a trigger", /create trigger trg_guard_confirmed_expense_day/.test(sql) && /EXPENSE_DAY_CONFIRMED/.test(sql));
  ok("SQL: the lock only looks at expense rows", /Only expense rows are this trigger's business/.test(sql));
  ok("SQL: a change after confirming un-confirms it (fingerprint)", /expense_day_fingerprint/.test(sql) && /is_current/.test(sql));
  ok("SQL: nobody decides their own change request", /You cannot decide your own request/.test(sql));
  ok("SQL: approving a request re-confirms the day", /Confirmed again, as it now stands/.test(sql));
  ok("SQL: removed figures are voided, never deleted", !/delete from public\.payments/i.test(sql));
} else {
  console.log("  skip  expense_confirmation.sql not in this folder");
}

const page = readFileSync("src/pages/Expenses.jsx", "utf8");
ok("page: staff sheet is read-only on a confirmed day", /canEdit=\{canRecord && !sheetLocked\}/.test(page));
ok("page: confirm permission must be ticked (or Owner), never assumed", /profile\.permissions\.includes\("confirm_expenses"\)/.test(page));
ok("page: works as before without the SQL (reviews stays null)", /api\.getExpenseReviews\(\)\.catch\(\(\) => null\)/.test(page) && /const showReviewTab = reviews !== null/.test(page));
const perms = readFileSync("src/permissions.js", "utf8");
ok("Roles page offers the new permission", /key: "confirm_expenses"/.test(perms));
const rev = readFileSync("src/components/ExpenseReview.jsx", "utf8");
ok("confirming needs the tick and a password", /const canPress = allowed && checked && password && reasonOk && !busy;/.test(rev) && /checkPassword\(userEmail, password\)/.test(rev));
ok("a correction needs a reason", /const reasonOk = !correcting \|\| reason\.trim\(\)\.length >= 10;/.test(rev));
ok("staff on a confirmed day can only request", /api\.requestExpenseChange\(/.test(rev) && !/api\.updateExpense\([^)]*\)[^;]*;\s*\/\/ staff/.test(rev));

console.log(failed ? `\n${failed} FAILED` : "\nA station's expenses need two people; a manager signs their own.");
process.exit(failed ? 1 : 0);
