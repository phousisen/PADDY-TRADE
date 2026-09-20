// Every date in the app, written one way.
//
// [2026-09-16] SISEN: "i noticed u put english month, how about a number date
// instead so people who pick khmer can easily understand."
//
// He was right. Dates were formatted with English month and weekday names —
// "15 Sep 2026", "Tue" — in 45 places across 12 files. On a Khmer screen those
// words mean nothing, and a language switch that leaves half the date in
// English is worse than no switch at all.
//
// THE RULE
//
//   15/09/2026   a date
//   15/09        a day inside a month already named above it
//   09/2026      a month
//   15/09/2026 16:12   a date and time
//
// Day / month / year, digits only, the order used on Cambodian paperwork. It
// reads identically in both languages, so there is nothing to translate and
// nothing that can be mistranslated.
//
// ORDINARY DIGITS, NOT KHMER ONES. Khmer has ០១២៣៤៥៦៧៨៩, but every
// weighbridge printout, bank slip and phone keypad around this business uses
// 0123456789 — a date on screen that does not match the paper beside it is
// worse than one in the wrong script.
//
// The WEEKDAY is the one part that is a word, so it is the one part that is
// translated: dow_0…dow_6 in i18n.jsx. It is kept rather than dropped because
// knowing a quiet day was a Sunday explains the quiet day.
//
// Everything here takes either a YYYY-MM-DD string or a Date/ISO timestamp,
// and every timestamp is read in Cambodia's timezone — never the viewing
// device's, which is why a ticket saved at 11pm in Phnom Penh must not appear
// on the previous day to someone looking from another country.

const TZ = "Asia/Phnom_Penh";

/** The parts of a timestamp, in Cambodia. */
function partsOf(value) {
  // A null/empty timestamp must read as "—", never as 01/01/1970 — which is
  // what new Date(null) quietly produces.
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const out = {};
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).forEach((p) => { out[p.type] = p.value; });
  return out;
}

// A plain YYYY-MM-DD is already a business date — it has no time and no
// timezone, and must never be pushed through a Date, which would shift it.
// [2026-09-19] Anchored at BOTH ends. Without the $, a full timestamp such as
// "2026-09-18T23:30:00+00:00" also matched, and its first ten characters —
// the UTC day — were used. That is 19/09 06:30 in Phnom Penh, printed as
// 18/09. Every receipt and weigh slip for a truck weighed between midnight
// and 07:00 showed the previous day's date, disagreeing with the transaction
// date on the same piece of paper. Display only: no stored date was touched.
const isPlainDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function ymdOf(value) {
  if (isPlainDate(value)) {
    const [y, m, d] = value.slice(0, 10).split("-");
    return { y, m, d };
  }
  const p = partsOf(value);
  return p ? { y: p.year, m: p.month, d: p.day } : null;
}

/** 15/09/2026 */
export function dmy(value) {
  const p = ymdOf(value);
  return p ? `${p.d}/${p.m}/${p.y}` : "—";
}

/** 15/09 — for a day sitting under a month that is already named. */
export function dm(value) {
  const p = ymdOf(value);
  return p ? `${p.d}/${p.m}` : "—";
}

/** 15/09/26 — where the line is tight, as on a printed ticket. */
export function dmy2(value) {
  const p = ymdOf(value);
  return p ? `${p.d}/${p.m}/${p.y.slice(2)}` : "—";
}

/** 09/2026 — a month. Takes "2026-09" or any date inside it. */
export function my(value) {
  const s = String(value || "");
  if (/^\d{4}-\d{2}/.test(s)) return `${s.slice(5, 7)}/${s.slice(0, 4)}`;
  const p = ymdOf(value);
  return p ? `${p.m}/${p.y}` : "—";
}

/** 15/09/2026 16:12 */
export function dmyTime(value) {
  const p = partsOf(value);
  if (!p) return "—";
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** 16:12 */
export function hm(value) {
  const p = partsOf(value);
  return p ? `${p.hour}:${p.minute}` : "—";
}

/** 01/09 – 06/09 */
export function range(from, to) {
  return `${dm(from)} – ${dm(to)}`;
}

/**
 * The weekday, in the reader's language.
 *
 * @param {string} value  a date
 * @param {(key:string)=>string} t  the translator
 */
export function weekdayKey(value) {
  const p = ymdOf(value);
  if (!p) return null;
  // Built from the numbers, in UTC, so no timezone can shift which day it is.
  const idx = new Date(Date.UTC(Number(p.y), Number(p.m) - 1, Number(p.d))).getUTCDay();
  return `dow_${idx}`;
}

export function weekday(value, t) {
  const key = weekdayKey(value);
  if (!key) return "";
  return typeof t === "function" ? t(key) : "";
}

/** 15/09 អង្គារ — a day row, with its weekday. */
export function dayWithWeekday(value, t) {
  const w = weekday(value, t);
  return w ? `${dm(value)} ${w}` : dm(value);
}

// [2026-09-16] SISEN: "for the expenses part how about add year also 2026".
// The Expenses screen therefore labels a day with dmy() + weekday() — full
// date, because its rows are read, printed and compared on their own. The
// Daily Book keeps dm() because a month picker sits above its list and
// already supplies the year.
