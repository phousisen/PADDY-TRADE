// [2026-09-21] SCALE GUARD — the rules for when a live weight may be captured.
//
// SISEN, looking at REANG KESEY's live weight on a New Buy: "-6,675.00 kg ...
// i think this is a serious issue here. its negative. how is that possible"
// and "if this is a mistake, then its unacceptable".
//
// It was not the app: the scale indicator itself was sending −6,675. Someone
// had pressed ZERO/TARE with an empty truck (about 6.7 t) still on the
// platform; the truck drove off and the platform read below zero. A negative
// weight could never be saved — but the NEXT truck would have read 6,675 kg
// too light, and that would have saved without anyone noticing.
//
// So a capture now has to pass, in this order:
//   below    — the scale reads below zero right now. Blocked, no override:
//              the scale must be fixed (ZERO with the platform empty).
//   notZeroed— the scale went below zero and has not shown 0 since, so even a
//              normal-looking weight is short by that amount. Blocked; the
//              Owner can allow one capture with a reason and password.
//   empty    — nothing on the scale.
//   notCleared— this PC captured a weight and the platform has not shown 0
//              since (the truck never drove off). Blocked; Owner override.
//              Only applied when the app has watched the scale the whole time
//              since that capture — after a gap (PC off, app closed) nothing
//              is known, and a truck standing on the scale first thing in the
//              morning must not be blocked by a capture made last night.
//   moving   — the weight has not held steady for 3 seconds (the truck is
//              still rolling on, or someone is standing on the edge).
//   ok
//
// Pure: no React, no network, no storage — tested by scripts-check-scale-guard.

export const ZERO_BAND_KG = 20;     // |weight| ≤ this counts as "the platform is empty"
export const BELOW_KG = -20;        // below this the scale is below zero
export const STABLE_MS = 3000;      // how long the weight must hold
export const STABLE_BAND_KG = 20;   // how much it may move while "holding"
export const GAP_MS = 60000;        // no reading for this long = we stopped watching
export const SAMPLE_KEEP_MS = 5000;

export function freshGuard() {
  return {
    belowSince: null,     // ms — first reading below zero of the current episode
    lastBelowAt: null,    // ms
    lastZeroAt: null,     // ms — last reading with the platform empty
    lastSeenAt: null,     // ms — last live reading of any kind
    watchedSince: null,   // ms — start of the current unbroken run of readings
    lastCaptureAt: null,  // ms — last capture made on this PC
    lastCaptureBy: null,  // which weight field made it (not stored)
    lastCaptureKg: null,
  };
}

// Feed one live reading in. Returns the new guard and any event worth logging:
// "below" (just went below zero) or "back" (was below, now reads 0 again).
export function observe(guard, weightKg, now) {
  const g = { ...guard };
  let event = null;
  if (weightKg == null || !Number.isFinite(Number(weightKg))) return { guard: g, event };
  const w = Number(weightKg);
  if (!g.lastSeenAt || now - g.lastSeenAt > GAP_MS) g.watchedSince = now;
  g.lastSeenAt = now;
  if (w < BELOW_KG) {
    if (!g.belowSince) { g.belowSince = now; event = "below"; }
    g.lastBelowAt = now;
  } else if (Math.abs(w) <= ZERO_BAND_KG) {
    g.lastZeroAt = now;
    if (g.belowSince) { g.belowSince = null; event = "back"; }
  }
  return { guard: g, event };
}

export function addSample(samples, weightKg, now) {
  const out = (samples || []).filter((s) => now - s.at <= SAMPLE_KEEP_MS);
  if (weightKg != null && Number.isFinite(Number(weightKg))) out.push({ at: now, w: Number(weightKg) });
  return out;
}

// Steady = readings cover (almost) the whole window and all sit within the band.
export function isStable(samples, now) {
  const win = (samples || []).filter((s) => now - s.at <= STABLE_MS);
  if (win.length < 3) return false;
  if (now - win[0].at < STABLE_MS * 0.8) return false;
  let lo = Infinity, hi = -Infinity;
  for (const s of win) { if (s.w < lo) lo = s.w; if (s.w > hi) hi = s.w; }
  return hi - lo <= STABLE_BAND_KG;
}

export function markCapture(guard, { now, by, weightKg }) {
  return { ...guard, lastCaptureAt: now, lastCaptureBy: by || null, lastCaptureKg: weightKg ?? null };
}

// What the weight box should say. `by` = the weight field asking, so the same
// form can capture again (a staff member pressing Capture twice on one ticket
// is not a second truck).
export function captureStatus(guard, samples, weightKg, now, { by = null } = {}) {
  // [2026-09-22] SISEN: "why does it always disconnect after 1 weigh in" —
  // "dont do that it makes the system error".
  //
  // The between-trucks rule ("the platform must read 0 before the next
  // capture"), the not-reset-since-below-zero rule and the 3-second steady
  // rule all blocked real weigh-ins at stations whose empty platform does
  // not sit inside ±20 kg, and to the staff it looked like the scale had
  // disconnected. They are switched off. The ONE block kept is the one that
  // cannot be wrong: a reading below zero right now.
  const w = Number(weightKg);
  if (weightKg == null || !Number.isFinite(w)) return "empty";
  if (w < BELOW_KG) return "below";
  return "ok";
}

// Which blocks the Owner may lift for one capture. "below" is never one of
// them: a scale reading below zero is wrong for every truck until it is fixed.
export const OVERRIDABLE = new Set(["notZeroed", "notCleared"]);

// Only what is worth keeping across a reload goes to storage.
export function serialize(g) {
  return JSON.stringify({
    belowSince: g.belowSince, lastBelowAt: g.lastBelowAt, lastZeroAt: g.lastZeroAt,
    lastSeenAt: g.lastSeenAt, watchedSince: g.watchedSince,
    lastCaptureAt: g.lastCaptureAt, lastCaptureKg: g.lastCaptureKg,
  });
}
export function deserialize(s) {
  const base = freshGuard();
  if (!s) return base;
  try {
    const o = JSON.parse(s);
    for (const k of Object.keys(base)) if (k in o && (o[k] === null || Number.isFinite(o[k]))) base[k] = o[k];
  } catch { /* corrupt → start fresh */ }
  base.lastCaptureBy = null;
  return base;
}
