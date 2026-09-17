// Is the ថ្លៃកូនដៃ on this day right?
//
// [2026-09-17] SISEN:
//
//     "i each location to show the total buy amount in tons that is purchased
//      in that day so we can actually compare if the commision given is
//      correct or wrong. normally every tons the commision is 10,000riels max"
//
// THE PROBLEM THIS SOLVES
//
// ថ្លៃកូនដៃ sat on the Expenses screen as a figure with nothing to check it
// against. To know whether 610,000 ៛ was right you had to already know how
// many tonnes that station bought that day, divide in your head, and remember
// the ceiling. Nobody does that across five stations and thirty days, so an
// overpayment was never going to be found by reading the column.
//
// Now the tonnes sit above the figure and this does the division.
//
// ── TWO DECISIONS I MADE, BECAUSE THE BUILD COULD NOT WAIT ON THEM ──
//
// 1. MEASURED AGAINST PADDY BOUGHT, not sold.
//    ថ្លៃកូនដៃ is paid for bringing paddy IN, so the ceiling scales with what
//    came in. Measured against sales it would read as a breach on any day a
//    station bought hard and shipped nothing — 15 September at Ping Pong,
//    for one. Selling is shown beside it anyway, so the day still reads whole.
//    If the rule is actually against sales, `BASIS` below is the one line to
//    change and the guard will confirm it.
//
// 2. THE CEILING IS FIXED IN CODE at 10,000 ៛ per tonne.
//    Deliberately not a setting yet. A limit that anyone can edit is a limit
//    that can be quietly raised to make a figure pass, which is the exact
//    thing this is here to catch. Moving it into Settings as an Owner-only
//    field is a small change when SISEN wants it.
//
// Pure — no React, no database — so scripts-check-commission.mjs runs every
// branch of it, including the ones nobody wants to meet.

/** Riel per tonne of paddy bought. The ceiling, not the rate. */
export const MAX_PER_TONNE = 10_000;

/** Which side of the day the ceiling is measured against. */
export const BASIS = "bought";

const KG_PER_TONNE = 1000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Kilograms to tonnes, to two places — 161,560 kg reads as 161.56. */
export function tonnes(kg) {
  return num(kg) / KG_PER_TONNE;
}

/**
 * Check a station's day.
 *
 * @param commission  the ថ្លៃកូនដៃ recorded for that station on that day, riel
 * @param boughtKg    paddy bought at that station on that day
 * @param soldKg      paddy sold — shown, never used for the ceiling
 *
 * @returns
 *   state   "ok" | "at" | "over" | "none" | "unknown"
 *   perTonne  riel per tonne actually paid, or null when it cannot be worked out
 *   ceiling   the most that could have been paid
 *   overBy    riel above the ceiling, 0 when not over
 */
export function checkCommission({ commission, boughtKg, soldKg } = {}) {
  const paid = num(commission);
  const bought = num(boughtKg);
  const t = tonnes(bought);
  const ceiling = Math.round(t * MAX_PER_TONNE);

  // Nothing paid is not a breach and must not be coloured like one. A station
  // can buy all day and owe no commission.
  if (paid <= 0) {
    return { state: "none", perTonne: 0, ceiling, tonnesBought: t, tonnesSold: tonnes(soldKg), overBy: 0, pct: 0 };
  }

  // Paid something on a day with no paddy bought. NOT silently "over": it is
  // either a correction for another day, or a real mistake, and this cannot
  // tell which. Dividing by zero tonnes would print Infinity ៛/tonne, which
  // is worse than saying plainly that it cannot be checked.
  if (bought <= 0) {
    return { state: "unknown", perTonne: null, ceiling: 0, tonnesBought: 0, tonnesSold: tonnes(soldKg), overBy: 0, pct: null };
  }

  const perTonne = paid / t;
  const overBy = Math.max(0, Math.round(paid - ceiling));
  // A riel either side of the ceiling is rounding, not a breach — the ceiling
  // is itself a rounded figure. Only a real difference is called over.
  const state = overBy > 1 ? "over" : Math.round(perTonne) >= MAX_PER_TONNE ? "at" : "ok";

  return {
    state,
    perTonne: Math.round(perTonne),
    ceiling,
    tonnesBought: t,
    tonnesSold: tonnes(soldKg),
    overBy,
    pct: ceiling > 0 ? Math.round((paid * 100) / ceiling) : null,
  };
}

/**
 * The same check for a whole day across several stations.
 *
 * Deliberately sums first and divides once, rather than averaging each
 * station's rate: a station that bought 200 tonnes and one that bought 2 do
 * not get an equal say in the day's rate.
 */
export function checkDay(stations) {
  const paid = (stations || []).reduce((a, s) => a + num(s.commission), 0);
  const bought = (stations || []).reduce((a, s) => a + num(s.boughtKg), 0);
  const sold = (stations || []).reduce((a, s) => a + num(s.soldKg), 0);
  return checkCommission({ commission: paid, boughtKg: bought, soldKg: sold });
}
