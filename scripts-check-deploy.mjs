// scripts-check-deploy.mjs — what a station sees when a new version lands.
//
// [2026-09-16] SISEN, after uploading:
//
//     "we have issue here, everytime we upload new zip. the sytem will ask
//      to update like 3-4 times on repeat then it sometimes crash like this"
//
// TWO FAULTS, ONE MOMENT
//
// 1. THE REPEAT. reloadWhenFree() called registration.update() — which
//    returns a promise — and fired the reload on the very next line without
//    waiting for it. The page reloaded while the service worker was still
//    fetching, came back on the OLD precached shell, compared its old
//    version against the new version.json, and put the strip up again.
//    Three or four times, until the worker happened to finish in a gap.
//
// 2. THE CRASH. Every file in the build carries a hash of its contents in
//    its name, and a deploy changes all of them. A page open since before
//    the deploy still knows the old names; the first screen it opens that it
//    has not opened before asks for a file that no longer exists. The import
//    rejects and the app dies mid-render — top bar drawn, nothing under it.
//    ErrorBoundary cannot catch that: it is a promise rejecting in the module
//    loader, not a component throwing while rendering.
//
// Both are invisible in development, where there is no service worker doing
// this and no old build to fall off. They only appear on a real deploy to a
// real station, which is the worst possible place to find out. So the
// decisions are executed here.
//
// Run: node scripts-check-deploy.mjs

import { readFileSync } from "node:fs";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};

const upd = await import("./src/appUpdate.js");
const chunk = await import("./src/chunkGuard.js");
const updSrc = readFileSync("src/appUpdate.js", "utf8");
const banner = readFileSync("src/components/UpdateBanner.jsx", "utf8");
const main = readFileSync("src/main.jsx", "utf8");

console.log("\n1. The reload waits for the new code before it happens");

ok("reloadWhenFree awaits the service worker rather than racing it",
   /await\s+Promise\.race\(/.test(updSrc) && /waitForNewWorker/.test(updSrc),
   "reloading before the worker has the new bundle lands back on the old one,\n          which is exactly what put the strip up three or four times");
ok("there is a cap, so a bad line still gets its reload",
   typeof upd.SW_UPDATE_WAIT_MS === "number" && upd.SW_UPDATE_WAIT_MS > 0 && upd.SW_UPDATE_WAIT_MS <= 15000,
   `SW_UPDATE_WAIT_MS is ${upd.SW_UPDATE_WAIT_MS}`);

console.log("\n2. The app never reloads itself twice for the same version");

ok("a version it has not tried yet may reload",
   upd.mayAutoReload({ served: "2026.09.16-1730", reloadedFor: null }));
ok("a NEWER version may reload even after an earlier one",
   upd.mayAutoReload({ served: "2026.09.16-1800", reloadedFor: "2026.09.16-1730" }));
ok("the SAME version may not — that reload already failed to land",
   !upd.mayAutoReload({ served: "2026.09.16-1730", reloadedFor: "2026.09.16-1730" }),
   "this is the whole loop: reload, come back on old code, see the same new\n          version, reload again, forever");
ok("nothing served means nothing to reload for",
   !upd.mayAutoReload({ served: null, reloadedFor: null }));

// A tab that cannot remember must not be locked out of ever updating —
// the failure has to fall on the side of "try", or a private window would
// never update at all.
const blind = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
ok("storage being blocked does not stop an update",
   upd.mayAutoReload({ served: "x", reloadedFor: upd.readReloadedFor(blind) }));

console.log("\n3. The strip tells the truth when a reload did not take");

ok("UpdateBanner asks before reloading itself", /mayAutoReload\(/.test(banner));
ok("and remembers what it reloaded for", /rememberReloadFor\(/.test(banner));
ok("a stuck tab says to close and reopen, not 'waiting'",
   /upd_stuck/.test(banner),
   "saying 'waiting for a free moment' when nothing is coming is a lie the\n          station acts on by waiting");
ok("a push from HQ is exempt from the once-only rule",
   /!pushed && !mayAutoReload/.test(banner),
   "SISEN pressed that button on purpose");

console.log("\n4. A page that outlived its build recovers instead of dying");

for (const msg of [
  "Failed to fetch dynamically imported module: https://paddy-trade.vercel.app/assets/DailyBook-a1b2c3.js",
  "Loading chunk 42 failed.",
  "error loading dynamically imported module",
  "Importing a module script failed.",
  "Loading CSS chunk 7 failed.",
  "Expected a JavaScript module script but the server responded with a MIME type of 'text/html' is not a valid JavaScript MIME type",
]) {
  ok(`recognised: ${msg.slice(0, 44)}…`, chunk.looksLikeStaleChunk(msg));
}

// The narrow part matters as much: a reload throws away anything typed.
for (const msg of [
  "Failed to fetch",
  "NetworkError when attempting to fetch resource.",
  "TypeError: Cannot read properties of undefined (reading 'name')",
  "JWT expired",
  "",
  null,
]) {
  ok(`NOT a reload: ${String(msg).slice(0, 38) || "(empty)"}`, !chunk.looksLikeStaleChunk(msg),
     "a reload discards a half-typed ticket — it must only fire for the module\n          loader's own failures, never an ordinary network blip");
}

console.log("\n5. It recovers once, and only once");

ok("first failure recovers", chunk.shouldRecover({ message: "Loading chunk 3 failed.", recovered: false }));
ok("second failure does NOT — it would spin forever",
   !chunk.shouldRecover({ message: "Loading chunk 3 failed.", recovered: true }),
   "the second one is left to the error screen, which at least says something");
ok("an unrelated error never recovers, even on the first",
   !chunk.shouldRecover({ message: "Cannot read properties of null", recovered: false }));

// Blocked storage means "cannot remember" — which must read as "already
// recovered", because a message beats a reload loop.
ok("a tab that cannot remember shows the error rather than risking a loop",
   chunk.alreadyRecovered(blind));

console.log("\n6. It is actually started");

ok("main.jsx starts the chunk guard", /startChunkGuard\(\)/.test(main));
ok("and it is outside React, because React never sees this failure",
   !/startChunkGuard/.test(readFileSync("src/App.jsx", "utf8")));

console.log(failed ? `\n${failed} FAILED\n` : "\nall ok\n");
process.exit(failed ? 1 : 0);
