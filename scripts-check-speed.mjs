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
const lw = code("src/components/LiveWeightBox.jsx");
ok("live weight: no fixed 150 ms interval (requests cannot pile up)", !/setInterval\(poll/.test(lw));
ok("live weight: the next request is scheduled when this one ends", /timer = setTimeout\(poll, next\)/.test(lw));
ok("live weight: a PC with no scale program is re-asked every 5 s, not every 150 ms", /const LOCAL_RETRY_MS = 5000;/.test(lw) && /tryLocal \? await pollLocalBridge\(\) : null/.test(lw));
ok("live weight: the cloud reading is fetched once a second", /const CLOUD_POLL_MS = 1000;/.test(lw) && /next = CLOUD_POLL_MS;/.test(lw));
ok("live weight: the form is only re-drawn when the weight changes (or once a second)", /if \(w === shown\.w && src === shown\.src && now - shown\.at < 1000\) return;/.test(lw));
ok("live weight: printing does not start a second loop", !/handleAfterPrint = \(\) => \{ printing = false; poll\(\); \}/.test(lw));

const q = code("src/offlineQueue.js");
ok("idle sync: the farmer/buyer download is at most every 10 minutes",
   /const IDLE_LOOKUP_REFRESH_MS = 10 \* 60 \* 1000;/.test(q) &&
   /if \(navigator\.onLine && Date\.now\(\) - lastIdleLookupRefreshAt >= IDLE_LOOKUP_REFRESH_MS\)/.test(q) &&
   !/if \(getQueue\(\)\.length === 0\) \{\s*if \(navigator\.onLine\) refreshLookupCaches\(\);/.test(q));

console.log(failed ? `\n${failed} FAILED` : "\nNo background loop is hammering the server or the page.");
process.exit(failed ? 1 : 0);
