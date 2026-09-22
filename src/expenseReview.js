// [2026-09-21] EXPENSE CONFIRMATION — what each station-day's status is.
//
// SISEN: "i want to let the manager go through it and confirm the expenses
// and all so we know that the expenses is there because 2 people has agreed
// so they can be responsible."
//
// One station's day of expenses is confirmed as one unit, the way it is
// entered. Three statuses, and only three, are shown to people:
//
//   waiting    — nobody has confirmed it yet, or it changed after it was
//                confirmed, or staff fixed it after it was sent back
//   confirmed  — confirmed, and still exactly as it was when confirmed
//   sent_back  — the manager sent it back and nothing has changed since
//
// `why` says which kind of waiting it is, for the one-line note under it.
// The database is the judge of "still exactly as confirmed" (is_current);
// this file only reads it. Pure — tested by scripts-check-expense-review.

export const dayKey = (locationId, day) => `${locationId}|${day}`;

function dateOf(v) { return String(v || "").slice(0, 10); }

// expenses: live expense rows (voided ones are not passed in)
// reviews:  rows from expense_day_review_status
export function buildReviewDays({ expenses = [], reviews = [], locations = [], userId = null } = {}) {
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const byKey = new Map();
  for (const r of expenses) {
    const day = dateOf(r.pay_date);
    if (!day || !r.location_id) continue;
    const k = dayKey(r.location_id, day);
    let d = byKey.get(k);
    if (!d) {
      d = { key: k, locationId: r.location_id, stationName: locName.get(r.location_id) || "—", day, rows: [], total: 0, enteredBy: [], enteredIds: new Set(), firstAt: null, lastAt: null };
      byKey.set(k, d);
    }
    d.rows.push(r);
    d.total += Number(r.amount) || 0;
    if (r.created_by && !d.enteredIds.has(r.created_by)) {
      d.enteredIds.add(r.created_by);
      d.enteredBy.push(r.createdByName || "—");
    }
    const at = r.created_at || null;
    if (at && (!d.firstAt || at < d.firstAt)) d.firstAt = at;
    if (at && (!d.lastAt || at > d.lastAt)) d.lastAt = at;
  }
  const reviewBy = new Map(reviews.map((v) => [dayKey(v.location_id, dateOf(v.day)), v]));
  const out = [];
  for (const d of byKey.values()) {
    const review = reviewBy.get(d.key) || null;
    const { status, why } = statusOf(review);
    const onlyMine = !!userId && d.enteredIds.size > 0 && [...d.enteredIds].every((id) => id === userId);
    out.push({ ...d, review, status, why, onlyMine, mine: !!userId && d.enteredIds.has(userId) });
  }
  // Newest day first; within a day, by station name.
  out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.stationName.localeCompare(b.stationName)));
  return out;
}

export function statusOf(review) {
  if (!review) return { status: "waiting", why: "new" };
  const current = review.is_current !== false;
  if (review.status === "confirmed") return current ? { status: "confirmed", why: review.corrected ? "corrected" : null } : { status: "waiting", why: "changed" };
  if (review.status === "sent_back") return current ? { status: "sent_back", why: null } : { status: "waiting", why: "fixed" };
  if (review.status === "resubmitted") return { status: "waiting", why: current ? "replied" : "fixed" };
  return { status: "waiting", why: "new" };
}

// The three boxes at the top. `from`/`to` bound the Confirmed box (this
// month); Waiting and Sent back are everything still open, whatever its date.
export function summarize(days, { from = null, to = null, requests = [] } = {}) {
  const inWin = (d) => (!from || d.day >= from) && (!to || d.day <= to);
  const sum = (list) => list.reduce((s, d) => s + d.total, 0);
  const waiting = days.filter((d) => d.status === "waiting");
  const confirmed = days.filter((d) => d.status === "confirmed" && inWin(d));
  const sentBack = days.filter((d) => d.status === "sent_back");
  const pending = requests.filter((r) => r.status === "pending");
  return {
    waiting: { n: waiting.length, amount: sum(waiting) },
    confirmed: { n: confirmed.length, amount: sum(confirmed) },
    sentBack: { n: sentBack.length, amount: sum(sentBack) },
    requests: { n: pending.length },
  };
}

// For the report: of the station-days in a set of rows, how much is confirmed.
export function confirmedShare(days, { from = null, to = null, locationIds = [] } = {}) {
  let confirmed = 0, open = 0, waiting = 0, sentBack = 0;
  for (const d of days) {
    if (from && d.day < from) continue;
    if (to && d.day > to) continue;
    if (locationIds.length && !locationIds.includes(d.locationId)) continue;
    if (d.status === "confirmed") confirmed += d.total;
    else open += d.total;
    if (d.status === "waiting") waiting += 1;
    if (d.status === "sent_back") sentBack += 1;
  }
  return { confirmed, open, waiting, sentBack };
}

// One calendar day across the stations shown: "all confirmed", "n waiting",
// "n sent back" — for the small mark beside the date in the report.
export function dayMark(days, day, locationIds = []) {
  const on = days.filter((d) => d.day === day && (!locationIds.length || locationIds.includes(d.locationId)));
  if (!on.length) return null;
  const sentBack = on.filter((d) => d.status === "sent_back").length;
  const waiting = on.filter((d) => d.status === "waiting").length;
  if (sentBack) return { kind: "sent_back", n: sentBack, of: on.length };
  if (waiting) return { kind: "waiting", n: waiting, of: on.length };
  return { kind: "confirmed", n: on.length, of: on.length };
}

// Can this person confirm this day? The database says the same; this only
// decides whether to offer the button.
export function canConfirmDay(d, { canConfirm, userId }) {
  if (!canConfirm || !d) return false;
  if (d.onlyMine || (userId && [...(d.enteredIds || [])].every((id) => id === userId) && d.enteredIds.size > 0)) return false;
  // A day sent back can still be confirmed if the manager changes their mind.
  return d.status === "waiting" || d.status === "sent_back";
}

// Is this day locked for this person on the day sheet?
export function lockedFor(d, { canConfirm }) {
  return !!d && d.status === "confirmed" && !canConfirm;
}
