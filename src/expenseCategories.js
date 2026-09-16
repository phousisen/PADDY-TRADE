// Expense categories — one shared list, and a check that a "new" one is
// genuinely new.
//
// [2026-09-16] SISEN: "allow them to add more list of category incase its
// not there."
//
// ── Why this is allowed here, when it was removed from paddy types ────────
//
// The paddy type list broke because each DEVICE kept its own list in
// localStorage and matching was blind to invisible characters. Twenty people
// at five stations each built a private list, and the same rice became a
// separate type at every station.
//
// Expenses are different in the two ways that mattered:
//
//   1. The list is derived from the expenses themselves, in the database.
//      There is no per-device list. A category used at HQ is on the list
//      everywhere, immediately.
//
//   2. One or two people at HQ type every expense, from daily sheets the
//      stations send in. Not twenty people at five weighbridges.
//
// So adding a category is safe. What is NOT safe is adding one that already
// exists under a spelling nobody can see the difference in — which is what
// nearlyTheSame() below is for.

// The same normalisation the products table uses. It is not product-specific:
// it strips the zero-width characters a Khmer keyboard inserts, settles
// Unicode normalisation, and collapses stray spaces. See src/productName.js
// for the full account of why each step is there.
import { cleanProductName, productKey } from "./productName.js";

export const cleanCategory = cleanProductName;
export const categoryKey = productKey;

// The categories offered before anyone has recorded anything. Every category
// actually used is merged in on top of these, so this list only ever seeds —
// it never limits what can exist.
//
// [2026-09-16] ថ្លៃកូនដៃ is a commission the business pays a staff member for
// bringing farmers in. It is deliberately NOT inside "Staff": salary barely
// moves month to month, commission moves with how much paddy is bought, and
// averaged together neither figure can be read. SISEN is actively trying to
// bring it down, which is impossible to see if it is buried in a total.
export const COMMISSION_CATEGORY = "ថ្លៃកូនដៃ";

export const SEED_CATEGORIES = [
  COMMISSION_CATEGORY,
  "Salary",
  "Fuel",
  "Carrying Service",
  "Rent",
  "Utilities",
  "Repairs & Maintenance",
];

export function isCommission(category) {
  return categoryKey(category) === categoryKey(COMMISSION_CATEGORY);
}

/**
 * The category list: the seeds, plus every category actually used, with
 * anything that is the same category under a different spelling folded
 * together. Commission first, then the rest in the order they were seeded,
 * then anything added since.
 *
 * @param {Array<{category?: string}>} rows  expense rows
 */
export function categoryList(rows) {
  const seen = new Map(); // key -> the spelling to show
  const push = (name) => {
    const clean = cleanCategory(name);
    if (!clean) return;
    const key = categoryKey(clean);
    if (!seen.has(key)) seen.set(key, clean);
  };
  SEED_CATEGORIES.forEach(push);
  (rows || []).forEach((r) => push(r?.category));
  return Array.from(seen.values());
}

// How different two words have to be before they are treated as different
// categories. One edit apart ("Fule" / "Fuel") is a typo worth asking about;
// two or more is a different word.
const NEARLY_MAX_EDITS = 1;

// Edit distance, capped, WITH transposition counted as a single edit.
//
// [2026-09-16] Plain Levenshtein was wrong here and the guard caught it.
// "Fule" for "Fuel" is two substitutions to Levenshtein, so a one-edit rule
// missed it — and swapping two letters is the commonest typing mistake
// there is. This is the optimal string alignment variant: a swap of two
// adjacent characters costs one, like an insert or a delete.
//
// The strings are a few words long, so the full matrix is cheap.
function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > NEARLY_MAX_EDITS) return NEARLY_MAX_EDITS + 1;

  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      // …ab… against …ba…
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      row[j] = v;
      if (v < best) best = v;
    }
    // Nothing on this row is close enough, and distance never decreases.
    if (best > NEARLY_MAX_EDITS) return NEARLY_MAX_EDITS + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Is this "new" category actually one that already exists?
 *
 * Returns the existing category it matches, or null.
 *
 *   exact   — the same category, seen through invisible characters, spacing
 *             and capitals. Never offer to create this; it IS the category.
 *   near    — one character out. Worth asking "did you mean…?" before making
 *             a second row that will sit beside the first on every report.
 *
 * @returns {{name: string, exact: boolean} | null}
 */
export function nearlyTheSame(typed, existing) {
  const key = categoryKey(typed);
  if (!key) return null;

  for (const name of existing || []) {
    if (categoryKey(name) === key) return { name, exact: true };
  }
  // A one-character slip is only meaningful on a word long enough for one
  // character to be a slip rather than the whole difference.
  if (key.length < 4) return null;
  for (const name of existing || []) {
    if (editDistance(key, categoryKey(name)) <= NEARLY_MAX_EDITS) {
      return { name, exact: false };
    }
  }
  return null;
}

/**
 * Totals by category for a set of expense rows, folded by key so two
 * spellings of one category never appear as two lines.
 *
 * Commission is returned separately from everything else, because every
 * screen that shows expenses has to keep it on its own line — the Daily
 * Book's columns are ថ្លៃកូនដៃ / other / total.
 */
export function splitByCategory(rows) {
  const map = new Map();
  let commission = 0;
  let other = 0;
  for (const row of rows || []) {
    const amount = Number(row?.amount) || 0;
    const clean = cleanCategory(row?.category) || "—";
    const key = categoryKey(clean);
    const at = map.get(key) || { category: clean, amount: 0, count: 0 };
    at.amount += amount;
    at.count += 1;
    map.set(key, at);
    if (isCommission(clean)) commission += amount;
    else other += amount;
  }
  const categories = Array.from(map.values()).sort((a, b) => {
    // Commission always leads, then by size.
    if (isCommission(a.category) !== isCommission(b.category)) return isCommission(a.category) ? -1 : 1;
    return b.amount - a.amount;
  });
  return { categories, commission, other, total: commission + other };
}
