// The expense report, as a page of columns.
//
// [2026-09-17] SISEN: "i need some help making sure we can print out the
// expenses file", then, seeing the first attempt: "this really take up the
// paper space, i think its better to create a proper collum or what", and
// then "why land scape, its a waste, make it portait".
//
// WHAT THE FIRST ATTEMPT GOT WRONG
//
// It printed the screen — day, then station indented, then category indented
// again. Three levels down the page, the category names repeated on every
// single day, and a month ran to four sheets. That is a list pretending to be
// a report.
//
// A ledger is a MATRIX: days down, categories across, totals on both edges.
// Nothing repeats, nothing indents, and the bottom-right corner is the month.
// Seventeen days and seven money columns fit inside 210mm because the column
// headings are one word each and the figures are tabular.
//
// This file does the arithmetic only — no JSX, no DOM — so the sums can be
// checked directly in node. What it returns is exactly what is printed:
// if a row in here does not add up, the paper does not add up.

import { cleanCategory, categoryKey, isCommission } from "./expenseCategories.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Long names do not fit a column heading in 210mm. Shortened only for the
// HEADING — the full name is still what the screen and the database hold,
// and a name with no short form is left alone rather than cut mid-word.
const SHORT = {
  "ប្រេងឥន្ធនៈ": "ប្រេង",
  "ថ្លៃដឹកជញ្ជូន": "ដឹកជញ្ជូន",
  "ថ្លៃជួសជុល": "ជួសជុល",
  "ថ្លៃអគ្គិសនី": "អគ្គិសនី",
  "ថ្លៃទឹក": "ទឹក",
};
export function shortHeading(name) {
  const full = String(name || "").trim();
  return SHORT[full] || full;
}

/**
 * Build the sheet.
 *
 * @param rows      expense rows already filtered to the period and location
 * @param days      every day in the period, in order, as YYYY-MM-DD — INCLUDING
 *                  the ones nobody filed. A missing day must be printed, not
 *                  skipped: on a sheet people sign, a gap that is not shown
 *                  quietly claims nothing was spent.
 * @param marks     the "nothing spent today" marks, so a real zero can be told
 *                  from an empty page
 * @param maxCols   how many category columns the paper can hold. Everything
 *                  past that is added into one last column rather than
 *                  dropped — a total that does not add up is worse than a
 *                  column called "other".
 */
export function buildSheet({ rows, days, marks, maxCols = 5, otherLabel = "ផ្សេងៗ" } = {}) {
  const all = rows || [];

  // ── which categories get a column ──
  // ថ្លៃកូនដៃ always has its own, first, whatever it cost — it is the one
  // SISEN is cutting and it can never be averaged into anything else.
  const totalsByCat = new Map();
  for (const r of all) {
    const name = cleanCategory(r?.category) || "—";
    const key = categoryKey(name);
    const at = totalsByCat.get(key) || { key, name, amount: 0, kh: isCommission(name) };
    at.amount += num(r?.amount);
    totalsByCat.set(key, at);
  }
  const every = [...totalsByCat.values()];
  const commission = every.filter((c) => c.kh);
  const rest = every.filter((c) => !c.kh).sort((a, b) => b.amount - a.amount);

  const named = rest.slice(0, Math.max(0, maxCols));
  const lumped = rest.slice(Math.max(0, maxCols));
  const columns = [
    { key: "__kh", name: "ថ្លៃកូនដៃ", kh: true },
    ...named.map((c) => ({ key: c.key, name: c.name, kh: false })),
    ...(lumped.length ? [{ key: "__other", name: otherLabel, kh: false, lumped: lumped.length }] : []),
  ];
  const colOf = new Map(named.map((c) => [c.key, c.key]));

  // ── a row per day ──
  const markedDays = new Set((marks || []).map((m) => String(m.day).slice(0, 10)));
  const byDay = new Map();
  for (const r of all) {
    const d = String(r?.pay_date).slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(r);
  }

  const dayRows = (days || []).map((day) => {
    const rs = byDay.get(day) || [];
    const cells = {};
    for (const col of columns) cells[col.key] = 0;
    for (const r of rs) {
      const name = cleanCategory(r?.category) || "—";
      const key = categoryKey(name);
      const where = isCommission(name) ? "__kh" : (colOf.get(key) || "__other");
      // A category that arrived after the columns were chosen still lands
      // somewhere, so the row total is always the sum of its own cells.
      if (cells[where] === undefined) cells[where] = 0;
      cells[where] += num(r?.amount);
    }
    const total = Object.values(cells).reduce((a, b) => a + b, 0);
    return {
      day,
      cells,
      total,
      // Three states, and the sheet must show which: money was spent, the
      // station recorded that nothing was spent, or nobody filed anything.
      state: rs.length ? "spent" : markedDays.has(day) ? "nothing" : "blank",
    };
  });

  // ── the edges ──
  const colTotals = {};
  for (const col of columns) {
    colTotals[col.key] = dayRows.reduce((a, r) => a + (r.cells[col.key] || 0), 0);
  }
  const grand = dayRows.reduce((a, r) => a + r.total, 0);

  return {
    columns,
    rows: dayRows,
    colTotals,
    grand,
    commissionTotal: colTotals.__kh || 0,
    otherTotal: grand - (colTotals.__kh || 0),
    filedDays: dayRows.filter((r) => r.state !== "blank").length,
    blankDays: dayRows.filter((r) => r.state === "blank").map((r) => r.day),
    hasCommission: commission.length > 0,
  };
}

/** Each column's share of the month, for the strip under the table. */
export function shares(sheet) {
  if (!sheet || !sheet.grand) return [];
  return sheet.columns.map((c) => ({
    key: c.key,
    name: c.name,
    kh: !!c.kh,
    amount: sheet.colTotals[c.key] || 0,
    pct: Math.round(((sheet.colTotals[c.key] || 0) * 100) / sheet.grand),
  }));
}
