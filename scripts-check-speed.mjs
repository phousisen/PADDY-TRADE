// scripts-check-speed.mjs — the two things that made every screen slow.
//
// [2026-09-19] SISEN: "i was always told that the app function really slow
// and laggy". Two background loops ran on every open device, all day:
//
//   1. The live-weight box asked for the weight every 150 ms without waiting
//      for the last answer — on a PC with no scale program, requests piled up
//      and each one also went to Supabase (~7 a second per open screen) — and
//      re-drew the whole weighing form on every answer.
//   2. Every 15 s, the idle sync downloaded every farmer and buyer and wrote
//      them all into browser storage, freezing the page while it wrote.
//
// Run: node scripts-check-speed.mjs
import { readFileSync } from "node:fs";
let failed = 0;
const ok = (name, cond) => { if (cond) console.log(`  ok    ${name}`); else { failed += 1; console.log(`  FAIL  ${name}`); } };

// Comments are removed first: the explanation of the old bug quotes it.
const code = (f) => readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
// [2026-09-21] The loop moved to scaleWatch.js (one watcher per station
// scale, shared by every weight box and the background scale guard). The
// same rules are checked there.
const lw = code("src/scaleWatch.js");
const box = code("src/components/LiveWeightBox.jsx");
ok("live weight: no fixed 150 ms interval (requests cannot pile up)", !/setInterval\(/.test(lw) && !/setInterval\(/.test(box));
ok("live weight: the next request is scheduled when this one ends", /store\.timer = setTimeout\(\(\) => tick\(store, gen\), next\)/.test(lw));
ok("live weight: a PC with no scale program is re-asked every 5 s, not every 150 ms", /const LOCAL_RETRY_MS = 5000;/.test(lw) && /tryLocal \? await pollLocalBridge\(\) : null/.test(lw));
ok("live weight: the cloud reading is fetched once a second while a weight box is open, every 5 s otherwise",
   /const CLOUD_FAST_MS = 1000;/.test(lw) && /const CLOUD_SLOW_MS = 5000;/.test(lw) && /next = fg \? CLOUD_FAST_MS : CLOUD_SLOW_MS;/.test(lw));
ok("live weight: the form is only re-drawn when the weight changes (or once a second)",
   /if \(reading\?\.weight_kg !== prevW \|\| reading\?\.source !== prevSrc \|\| live !== prevLive \|\| now - \(store\.drawnAt \|\| 0\) >= 1000\)/.test(lw));
ok("live weight: printing does not start a second loop", /if \(!isPrinting\(\)\)/.test(lw) && !/afterprint", \(\) => \{[^}]*tick\(/.test(lw));
// [2026-09-22] Pong Ro: the pause stuck on after the first weigh-in slip
// printed, and every weight box after it said "Scale not connected".
ok("live weight: the print pause can never outlive the print (20 s cap)", /const PRINT_PAUSE_MAX_MS = 20000;/.test(lw) && /Date\.now\(\) - printingSince > PRINT_PAUSE_MAX_MS/.test(lw));
ok("live weight: opening a weight box ends any print pause", /if \(foreground\) printingSince = 0;/.test(lw));
ok("live weight: a stopped and restarted watcher does not leave two loops", /store\.running && store\.gen === gen/.test(lw));
ok("live weight: two weight boxes on one station share one poll", /const stores = new Map\(\);/.test(lw) && /subscribeScale\(locationId, redraw/.test(box));

const q = code("src/offlineQueue.js");
ok("idle sync: the farmer/buyer download is at most every 10 minutes",
   /const IDLE_LOOKUP_REFRESH_MS = 10 \* 60 \* 1000;/.test(q) &&
   /if \(navigator\.onLine && Date\.now\(\) - lastIdleLookupRefreshAt >= IDLE_LOOKUP_REFRESH_MS\)/.test(q) &&
   !/if \(getQueue\(\)\.length === 0\) \{\s*if \(navigator\.onLine\) refreshLookupCaches\(\);/.test(q));

console.log(failed ? `\n${failed} FAILED` : "\nNo background loop is hammering the server or the page.");
process.exit(failed ? 1 : 0);
