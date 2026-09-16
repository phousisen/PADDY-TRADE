// The Expenses screen's arithmetic — day, week, month, year, and the three
// ways of grouping the same rows.
//
// [2026-09-16] Nothing here touches React or the network, so the whole thing
// is testable from a script (see scripts-check-expenses.mjs). SISEN:
// "we focus on eevryday, week, month and year data" and "too many boxes, why
// not customize it and make it more convinient" — three tables saying the
// same thing became one table with a Rows-by switch, and this is what feeds
// it.
//
// THE RULE, same as the Daily Book's: every level is the same rows added up.
// Nothing is stored, nothing is computed a second way, so a month can never
// disagree with the days inside it.
//
// ថ្លៃកូនដៃ is carried separately at EVERY level, never merged into a total.
// It is a commission paid per kilo to one staff member per station, SISEN is
// actively cutting it, and a figure averaged in with salary cannot be seen to
// move. See expenseCategories.js.

import { isCommission, categoryKey, cleanCategory } from "./expenseCategories.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ── period keys ───────────────────────────────────────────────────────────

export function isoWeekKey(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;      // Monday = 0
  dt.setUTCDate(dt.getUTCDate() + 3 - dow);  // that week's Thursday
  const year = dt.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((dt - jan1) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function periodKeyOf(dateStr, grain) {
  const s = String(dateStr || "");
  if (grain === "week") return isoWeekKey(s);
  if (grain === "month") return s.slice(0, 7);
  if (grain === "year") return s.slice(0, 4);
  return s.slice(0, 10);
}

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

export function monthName(ym) {
  const m = Number(String(ym).slice(5, 7));
  return MONTHS[m - 1] || "";
}

/** The Monday and Sunday of an ISO week key, as YYYY-MM-DD. */
export function weekRange(key) {
  const [y, w] = String(key).split("-W").map(Number);
  // 4 January is always in ISO week 1.
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - dow);
  const mon = new Date(week1Mon);
  mon.setUTCDate(week1Mon.getUTCDate() + (w - 1) * 7);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(mon), to: iso(sun) };
}

export function periodLabel(key, grain) {
  if (grain === "year") return key;
  if (grain === "month") return `${monthName(key)} ${key.slice(0, 4)}`;
  if (grain === "week") {
    const { from, to } = weekRange(key);
    const d = (s) => Number(s.slice(8, 10));
    const sameMonth = from.slice(0, 7) === to.slice(0, 7);
    return sameMonth
      ? `${d(from)}–${d(to)} ${monthName(from).slice(0, 3)}`
      : `${d(from)} ${monthName(from).slice(0, 3)} – ${d(to)} ${monthName(to).slice(0, 3)}`;
  }
  return `${Number(key.slice(8, 10))} ${monthName(key).slice(0, 3)}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function weekdayOf(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || "";
}

// ── the window the page is looking through ────────────────────────────────
//
// Day and week grains are read a month at a time; months a year at a time;
// the year grain shows everything. So the arrows move whatever unit is one
// step ABOVE the grain, which is the only thing that makes sense — stepping
// month-by-month through a list of months would be a list of one.

export function windowFor(grain, anchor) {
  if (grain === "year") return { from: null, to: null, label: "All years", unit: null };
  if (grain === "month") {
    const y = String(anchor).slice(0, 4);
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: y, unit: "year" };
  }
  const ym = String(anchor).slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(last).padStart(2, "0")}`,
    label: `${monthName(ym)} ${y}`,
    unit: "month",
  };
}

export function shiftAnchor(grain, anchor, by) {
  if (grain === "year") return anchor;
  if (grain === "month") {
    const y = Number(String(anchor).slice(0, 4)) + by;
    return `${y}-01-01`;
  }
  const [y, m] = String(anchor).slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// ── the rows ──────────────────────────────────────────────────────────────

/** Commission, other and total for a set of expense rows. */
export function totals(rows) {
  let commission = 0, other = 0;
  for (const r of rows || []) {
    const amt = num(r?.amount);
    if (isCommission(r?.category)) commission += amt;
    else other += amt;
  }
  return { commission, other, total: commission + other };
}

const inWindow = (date, from, to) =>
  (!from || date >= from) && (!to || date <= to);

export function filterRows(rows, { from, to, locationIds } = {}) {
  const scope = Array.isArray(locationIds) && locationIds.length ? new Set(locationIds) : null;
  return (rows || []).filter((r) => {
    if (!r || !r.pay_date) return false;
    if (!inWindow(String(r.pay_date).slice(0, 10), from, to)) return false;
    if (scope && !scope.has(r.location_id)) return false;
    return true;
  });
}

/**
 * Rows grouped by period, newest first.
 * Each carries its own rows so a row can be opened without a second pass.
 */
export function byPeriod(rows, grain) {
  const map = new Map();
  for (const r of rows || []) {
    const key = periodKeyOf(String(r.pay_date).slice(0, 10), grain);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, rs]) => ({ key, label: periodLabel(key, grain), rows: rs, ...totals(rs) }));
}

/** Rows grouped by category, commission always first, then by size. */
export function byCategory(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const name = cleanCategory(r?.category) || "—";
    const key = categoryKey(name);
    const at = map.get(key) || { key, category: name, amount: 0, rows: [] };
    at.amount += num(r?.amount);
    at.rows.push(r);
    map.set(key, at);
  }
  return [...map.values()].sort((a, b) => {
    if (isCommission(a.category) !== isCommission(b.category)) return isCommission(a.category) ? -1 : 1;
    return b.amount - a.amount;
  });
}

/** Rows grouped by station, in the order the locations list gives them. */
export function byStation(rows, locations) {
  const map = new Map();
  for (const r of rows || []) {
    const id = r?.location_id;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(r);
  }
  return (locations || [])
    .map((l) => ({ id: l.id, name: l.name, rows: map.get(l.id) || [], ...totals(map.get(l.id) || []) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Every day in a window, with what each station did on it — including the
 * days and stations with NOTHING, which is the point.
 *
 * A station's day is one of three things and they are not interchangeable:
 *   spent   — money, and a figure
 *   nothing — checked, and someone said so (expense_day_marks)
 *   blank   — nobody has entered it
 *
 * A blank day makes a station look CHEAPER than it is, and no report can
 * flag a row that does not exist.
 */
export function stationsOn(day, locations, rows, marks) {
  const byLoc = new Map();
  for (const r of rows || []) {
    if (String(r.pay_date).slice(0, 10) !== day) continue;
    if (!byLoc.has(r.location_id)) byLoc.set(r.location_id, []);
    byLoc.get(r.location_id).push(r);
  }
  const marked = new Set(
    (marks || []).filter((m) => String(m.day).slice(0, 10) === day).map((m) => m.location_id),
  );
  return (locations || []).map((l) => {
    const rs = byLoc.get(l.id) || [];
    const state = rs.length ? "spent" : marked.has(l.id) ? "nothing" : "blank";
    return { id: l.id, name: l.name, state, rows: rs, ...totals(rs) };
  });
}

/**
 * Every day in a window, up to and including `upTo`.
 *
 * [2026-09-16] byPeriod() builds its rows FROM the expense rows, so a day
 * nobody entered produces no row and simply is not listed. That made the
 * whole "nothing spent" versus "nobody entered" distinction invisible on the
 * screen it was built for — a forgotten day cannot be seen, and a forgotten
 * day makes a station look cheaper than it is.
 *
 * The Day grain lists the calendar instead, and hangs whatever was recorded
 * off it. Future days are excluded: an empty 30 September in the middle of
 * the month is not a gap, it just has not happened.
 */
export function daysInWindow(from, to, upTo) {
  const out = [];
  if (!from || !to) return out;
  const last = upTo && upTo < to ? upTo : to;
  const [y, m, d] = String(from).split("-").map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  while (true) {
    const iso = cur.toISOString().slice(0, 10);
    if (iso > last) break;
    out.push(iso);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out.reverse();   // newest first, like every other grain
}

/**
 * Rows on a day, grouped by category, so two rows of ONE category read as
 * one line with one figure.
 *
 * [2026-09-16] The day sheet used to key existing rows by category into a
 * Map, which silently kept only the LAST of any duplicate pair. The sheet
 * then showed one figure, the day's real total was higher than what it
 * displayed, and saving updated one row and left the other — so a duplicate
 * could never be corrected from the screen that reported it.
 */
export function mergeByCategory(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const key = categoryKey(r?.category);
    const at = map.get(key) || { key, category: r?.category, amount: 0, rows: [] };
    at.amount += num(r?.amount);
    at.rows.push(r);
    map.set(key, at);
  }
  return map;
}

/**
 * What to show when a period row is opened.
 *
 * A day opens into its stations — that is where the Open button lives, and
 * where a missing station is visible. Anything larger opens into the grain
 * below it, so a year is four taps from one station's Tuesday.
 */
export function childGrain(grain) {
  if (grain === "year") return "month";
  if (grain === "month") return "day";
  if (grain === "week") return "day";
  return null;
}
