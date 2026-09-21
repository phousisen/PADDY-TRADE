// scripts-check-scale-guard.mjs — a scale that is below zero, or was left
// below zero, can never have its weight captured.
//
// [2026-09-21] SISEN, on REANG KESEY's live weight reading −6,675 kg: "if
// this is a mistake, then its unacceptable". The indicator had been zeroed
// with an empty truck on it; the next truck would have weighed 6,675 kg
// light and saved. These are the rules that stop it (src/scaleGuard.js),
// played through the real sequence of readings.
//
// Run: node scripts-check-scale-guard.mjs
import { readFileSync } from "node:fs";
import {
  freshGuard, observe, addSample, captureStatus, markCapture, isStable,
  serialize, deserialize, OVERRIDABLE, GAP_MS,
} from "./src/scaleGuard.js";
import { scaleState, stationsBelowZero } from "./src/scaleAlert.js";

let failed = 0;
const ok = (name, cond) => { if (cond) console.log(`  ok    ${name}`); else { failed += 1; console.log(`  FAIL  ${name}`); } };

// Feed a run of readings, one every 200 ms, like the KELI indicator.
function feed(state, weights, stepMs = 200) {
  let { guard, samples, now } = state;
  const events = [];
  for (const w of weights) {
    now += stepMs;
    const r = observe(guard, w, now);
    guard = r.guard; if (r.event) events.push(r.event);
    samples = addSample(samples, w, now);
  }
  return { guard, samples, now, events };
}
const hold = (w, secs) => Array(Math.round(secs * 5)).fill(w);
const status = (st, w, by) => captureStatus(st.guard, st.samples, w, st.now, { by });
const start = () => ({ guard: freshGuard(), samples: [], now: 1_000_000 });

// 1. A normal truck: empty platform, truck drives on, holds.
let s = feed(start(), [...hold(0, 2), 4000, 9000, 14000, 15600, 15690, ...hold(15700, 4)]);
ok("normal truck on a scale that read 0: capture allowed", status(s, 15700, "a") === "ok");

// 2. Still rolling on.
let r = feed(start(), [...hold(0, 2), 4000, 9000, 14000]);
ok("weight still climbing: 'moving', not capturable", status(r, 14000, "a") === "moving");
r = feed(start(), [...hold(0, 2), ...hold(15700, 1.5)]);
ok("steady for only 1.5 s: still 'moving'", status(r, 15700, "a") === "moving");
r = feed(start(), [...hold(0, 2), ...Array(20).fill(0).map((_, i) => 15700 + (i % 2 ? 60 : -60))]);
ok("steady-looking but swinging ±60 kg: 'moving'", status(r, 15700, "a") === "moving");

// 3. The REANG KESEY case.
let rk = feed(start(), [...hold(0, 2), ...hold(6675, 4)]);          // empty truck on the scale
rk = feed({ ...rk, guard: rk.guard }, hold(0, 1));                  // someone presses ZERO with it on board
rk = feed(rk, [3000, 0, -3000, ...hold(-6675, 4)]);                 // truck drives off
ok("RK: scale reads −6,675 → 'below'", status(rk, -6675, "a") === "below");
ok("RK: going below zero is an event (logged once)", rk.events.filter((e) => e === "below").length === 1);
let rk2 = feed(rk, [-3000, 2000, 8000, ...hold(13325, 4)]);         // next truck, 20,000 kg real, reads 13,325
ok("RK: the next truck reads a normal-looking 13,325 kg → still blocked ('notZeroed')", status(rk2, 13325, "a") === "notZeroed");
ok("RK: 'below' can never be overridden", !OVERRIDABLE.has("below"));
ok("RK: 'notZeroed' can be overridden by the Owner", OVERRIDABLE.has("notZeroed"));
let fixed = feed(rk, [...hold(0, 2)]);                               // ZERO pressed with the platform empty
ok("RK: after ZERO on an empty platform it clears, and 'back' is logged", fixed.events.includes("back") && !fixed.guard.belowSince);
fixed = feed(fixed, [...hold(20000, 4)]);
ok("RK: after the fix the next truck captures normally", status(fixed, 20000, "a") === "ok");

// 4. Back-to-back: same truck captured again on another ticket without leaving.
let bb = feed(start(), [...hold(0, 2), ...hold(15700, 4)]);
bb = { ...bb, guard: markCapture(bb.guard, { now: bb.now, by: "ticketA", weightKg: 15700 }) };
bb = feed(bb, hold(15700, 4));
ok("same weight box can capture again (pressing Capture twice)", status(bb, 15700, "ticketA") === "ok");
ok("a different ticket cannot capture the same truck without 0 in between", status(bb, 15700, "ticketB") === "notCleared");
let bb2 = feed(bb, [...hold(0, 1), ...hold(12000, 4)]);
ok("after the platform shows 0, the next truck captures", status(bb2, 12000, "ticketB") === "ok");

// 5. A gap (PC off overnight) must not block the morning's first truck.
let night = feed(start(), [...hold(0, 1), ...hold(15700, 4)]);
night = { ...night, guard: markCapture(night.guard, { now: night.now, by: "x", weightKg: 15700 }) };
night = { ...night, now: night.now + GAP_MS * 60, samples: [] };     // hours later, nothing seen
night = feed(night, hold(9000, 4));                                 // truck already on the scale at start-up
ok("after the app was closed, a truck already on the scale is not blocked", status(night, 9000, "y") === "ok");

// 6. Empty / noise.
ok("nothing on the scale: 'empty'", status(feed(start(), hold(0, 4)), 0, "a") === "empty");
ok("±15 kg of dirt/wind counts as empty, not below zero", status(feed(start(), hold(-15, 4)), -15, "a") === "empty");

// 7. Memory survives a reload; a corrupt store starts fresh.
const kept = deserialize(serialize(rk2.guard));
ok("a reload keeps 'went below zero'", kept.belowSince === rk2.guard.belowSince);
ok("a corrupt store starts fresh", deserialize("{not json").belowSince === null);
ok("isStable needs readings across the whole window", !isStable([{ at: 0, w: 1 }], 3000));

// 8. HQ side: which stations are below zero right now.
const now = Date.parse("2026-09-21T07:00:00Z");
const recent = new Date(now - 30_000).toISOString();
const old = new Date(now - 10 * 60_000).toISOString();
ok("HQ: a fresh −6,675 reading is 'below'", scaleState({ weight_kg: -6675, updated_at: recent }, now) === "below");
ok("HQ: an old reading is 'quiet', not an alarm", scaleState({ weight_kg: -6675, updated_at: old }, now) === "quiet");
ok("HQ: −10 kg is 'ok'", scaleState({ weight_kg: -10, updated_at: recent }, now) === "ok");
const list = stationsBelowZero(
  [{ location_id: "rk", weight_kg: -6675, updated_at: recent }, { location_id: "pp", weight_kg: 0, updated_at: recent }],
  [{ id: "rk", name: "REANG KESEY" }, { id: "pp", name: "PING PONG" }], now);
ok("HQ: only REANG KESEY is listed", list.length === 1 && list[0].name === "REANG KESEY" && list[0].weightKg === -6675);

// 9. Wiring: the screens really use it.
const src = (f) => readFileSync(f, "utf8");
const wf = src("src/components/WeightField.jsx");
ok("weight box: Capture only when the guard says ok", /const canCapture = connected && effective === "ok";/.test(wf) && /\{connected && canCapture && \(/.test(wf));
ok("weight box: 'Enter manually' is hidden while the scale is below zero / not reset", /const canEnterManually = \(isAdmin \|\| TESTING_ALLOW_STAFF_MANUAL_ENTRY\) && !zeroBlocked;/.test(wf));
ok("weight box: the Owner override needs a password and is logged", /signInWithPassword/.test(wf) && /action: "scale_capture_override"/.test(wf) && /setOverride\(null\); \/\/ one capture/.test(wf));
ok("weight box: only the Owner, never view-only, sees the override", /const isOwner = !!profile\?\.isOwner && !isViewOnly;/.test(wf));
ok("weight box: a capture is remembered for the between-trucks rule", /recordCapture\(locationId, \{ by: byRef\.current, weightKg: w \}\)/.test(wf));
const app = src("src/App.jsx");
ok("station PC watches its own scale all day", /subscribeScale\(loc, \(\) => \{\}, \{ foreground: false \}\)/.test(app) && /profile\?\.roleScope === "all"\) return undefined/.test(app));
const sw = src("src/scaleWatch.js");
ok("below-zero is logged only from the station's own scale program", /if \(event && reading\.source === "local"\) logEvent/.test(sw));
ok("HQ Dashboard shows the alert", /<ScaleAlertBanner /.test(src("src/pages/Dashboard.jsx")));
ok("Station Health has a scale column", /<ScaleCell reading=\{scales\.get\(s\.id\)\}/.test(src("src/components/StationVersions.jsx")));
const al = src("src/pages/ReportAuditLog.jsx");
ok("Activity Log names the three scale actions", ["scale_below_zero", "scale_back_to_zero", "scale_capture_override"].every((a) => al.includes(`${a}: "transaction"`)));

console.log(failed ? `\n${failed} FAILED` : "\nA scale below zero, or left below zero, cannot weigh a truck.");
process.exit(failed ? 1 : 0);
