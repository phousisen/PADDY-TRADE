// A station asking HQ to write its stock down to what was actually counted.
//
// [2026-09-17] SISEN: "i want each location to be able to reset their stock to
// 0 to get it as a stock loss, but will need hq above to confirm and accept
// it."
//
// He chose the counted-figure form over a plain zero button, with zero kept as
// one tap. The reason is in his own data: JOMNOUM's `5451` sits at −10,070 kg
// and Reang Kesey has settled a GAIN. A button that can only say "nothing
// left" cannot describe either, and a station that finds 300 kg would have to
// choose between claiming zero and saying nothing at all.
//
// EVERYTHING HERE IS PURE. No React, no network. The arithmetic that decides
// how many tonnes and how many riel a station is asking to write off is the
// part that has to be right, so it lives where a test can reach every branch —
// see scripts-check-stockreset.mjs.

/** Statuses a request can be in. Mirrors the database's own check constraint. */
export const RESET_STATUSES = ["pending", "approved", "rejected", "cancelled"];

/** Only one of these may be waiting per station — enforced in the database. */
export const BLOCKING_STATUS = "pending";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * What the station is actually asking for.
 *
 * Returns kilograms AND riel, because a number of kilograms means nothing to
 * the person approving it — 26,755 kg is either a rounding error or a car, and
 * only the riel figure says which.
 *
 * `lossValue` is money LOST and is 0 for a gain. A gain is not a negative
 * loss: value_lost is summed all over this app (dailyLedger, Shrinkage,
 * LocationDetail) and a negative in that column would quietly reduce real
 * losses somewhere else. Gains carry `gainValue` instead.
 */
export function describeReset({ bookKg, countedKg, pricePerKg } = {}) {
  const book = num(bookKg);
  const counted = num(countedKg);
  const price = pricePerKg == null ? null : num(pricePerKg);
  const diffKg = counted - book;              // negative = paddy is missing
  const isLoss = diffKg < 0;
  const isGain = diffKg > 0;
  const missingKg = isLoss ? -diffKg : 0;
  const hasPrice = price != null && price > 0;
  return {
    bookKg: book,
    countedKg: counted,
    diffKg,
    missingKg,
    isLoss,
    isGain,
    unchanged: diffKg === 0,
    hasPrice,
    lossValue: isLoss && hasPrice ? Math.round(missingKg * price) : 0,
    gainValue: isGain && hasPrice ? Math.round(diffKg * price) : 0,
    pricePerKg: hasPrice ? price : null,
  };
}

/**
 * Is what was typed something we are willing to send?
 *
 * Deliberately strict about the empty box. A blank field must never be read as
 * zero: "I have not typed it yet" and "the shed is empty" are the two most
 * different answers there are, and one of them writes off 27 tonnes.
 */
export function validateCount(raw, { bookKg } = {}) {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: false, error: "empty" };
  const n = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(n)) return { ok: false, error: "not_a_number" };
  if (n < 0) return { ok: false, error: "negative" };
  if (num(bookKg) === n) return { ok: false, error: "unchanged" };
  return { ok: true, value: n };
}

/**
 * Is the reason good enough to send?
 *
 * A reset with no reason is unanswerable: HQ is being asked to approve tonnes
 * of paddy disappearing on the strength of a number alone. Short is fine —
 * "rice mill took it" is a reason — but blank is not.
 */
export const MIN_REASON_CHARS = 4;
export function validateReason(raw) {
  const text = String(raw ?? "").trim();
  if (text.length < MIN_REASON_CHARS) return { ok: false, error: "too_short" };
  return { ok: true, value: text };
}

/** The whole form, in one answer the button can use. */
export function validateRequest({ count, reason, bookKg, pendingRequest } = {}) {
  if (pendingRequest) return { ok: false, error: "already_pending" };
  const c = validateCount(count, { bookKg });
  if (!c.ok) return { ok: false, error: c.error };
  const r = validateReason(reason);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, countedKg: c.value, reason: r.value };
}

/**
 * Who gets the button.
 *
 * A view-only account never does — that flag exists so a family member can
 * look without being able to start anything, and this starts something that
 * ends in tonnes being written off. Checked again in the database; this is
 * only what decides whether the button is drawn.
 */
export function canRequestReset({ isViewOnly, canAdjustStock, hasRequestPermission, isOwnStation } = {}) {
  if (isViewOnly) return false;
  if (canAdjustStock) return false;   // HQ already adjusts directly — no request needed
  return !!(hasRequestPermission || isOwnStation);
}

/** Who may answer one. Never the person who asked — see resolve_stock_reset. */
export function canResolveReset({ isViewOnly, canApprove, requestedBy, viewerId } = {}) {
  if (isViewOnly || !canApprove) return false;
  if (requestedBy && viewerId && requestedBy === viewerId) return false;
  return true;
}

/**
 * The one-line summary HQ reads first, in kilograms and riel.
 * `fmt`/`fmtRiel` are passed in so this file stays free of locale code.
 */
export function headline(req, { fmt, fmtRiel } = {}) {
  const d = describeReset({
    bookKg: req?.book_kg_at_request,
    countedKg: req?.counted_kg,
    pricePerKg: req?.price_per_kg,
  });
  const kg = fmt ? fmt : (n) => String(Math.round(n));
  const riel = fmtRiel ? fmtRiel : (n) => `${Math.round(n)}`;
  if (d.unchanged) return `${kg(d.bookKg)} kg — no change`;
  if (d.isGain) return `+${kg(d.diffKg)} kg${d.hasPrice ? ` · ${riel(d.gainValue)}` : ""}`;
  return `−${kg(d.missingKg)} kg${d.hasPrice ? ` · ${riel(d.lossValue)}` : ""}`;
}
