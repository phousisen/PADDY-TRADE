// scripts-check-session.mjs — coming back to an app left in a pocket.
//
// [2026-09-16] SISEN, about the account his parents use on their phones:
//
//     "it always logged them out and or sometimes the data is all 0 that they
//      need to log out and log back in to see it back. its never auto."
//     "how to make sure that we wont have to log in and log out anymore."
//
// A phone suspends a backgrounded app, which stops the login token renewing
// itself. The page that comes back is the SAME page — it does not reload and
// nothing on it re-asks. So either the figures are hours old, or something
// re-asks with a dead token and row-level security returns nothing, and a
// business with 181 tonnes in its sheds reads as 0.
//
// A screen that shows 0 when it means "I could not ask" is the worst possible
// answer, so the decision logic is run for real here rather than eyeballed.
//
// Run: node scripts-check-session.mjs

import { readFileSync } from "node:fs";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};

const w = await import("./src/sessionWatch.js");
const client = readFileSync("src/supabaseClient.js", "utf8");
const main = readFileSync("src/main.jsx", "utf8");

console.log("\n1. When coming back is worth a re-fetch");

const NOW = 1_700_000_000_000;
const ago = (s) => NOW - s * 1000;

ok("a renewed login always re-fetches — what is on screen was fetched with the old one",
   w.shouldRefetch({ hiddenAt: null, refreshed: true, now: NOW }));
ok("away for two minutes re-fetches",
   w.shouldRefetch({ hiddenAt: ago(120), refreshed: false, now: NOW }));
ok("away all night re-fetches",
   w.shouldRefetch({ hiddenAt: ago(60 * 60 * 9), refreshed: false, now: NOW }));
// Glancing at a message and coming straight back must not reload the screen
// under someone — on a station PC that is a page moving while it is read.
ok("a five-second glance at another app does NOT re-fetch",
   !w.shouldRefetch({ hiddenAt: ago(5), refreshed: false, now: NOW }));
ok("never having left does not re-fetch",
   !w.shouldRefetch({ hiddenAt: null, refreshed: false, now: NOW }));
ok("the threshold is 30 seconds", w.AWAY_LONG_ENOUGH_MS === 30 * 1000);

// [2026-09-16] Found by this guard, not by reading the code: reconnecting is
// its own case. The app may never have been hidden — the line simply dropped
// and came back — and every request made while it was down had failed, so
// what is on screen is whatever loaded before the drop.
ok("reconnecting always re-fetches, even if the app never went away",
   w.shouldRefetch({ hiddenAt: null, refreshed: false, reason: "online", now: NOW }));
ok("an app restored without ever being seen to leave re-fetches",
   w.shouldRefetch({ hiddenAt: null, refreshed: false, reason: "restored", now: NOW }));

console.log("\n2. The watcher itself");

function fakeEnv() {
  const listeners = {};
  const add = (k, fn) => { (listeners[k] ||= []).push(fn); };
  const remove = (k, fn) => { listeners[k] = (listeners[k] || []).filter((x) => x !== fn); };
  return {
    listeners,
    fire: (k) => (listeners[k] || []).map((fn) => fn()),
    doc: { visibilityState: "visible", addEventListener: add, removeEventListener: remove },
    win: { addEventListener: add, removeEventListener: remove },
  };
}

// The login is made fresh BEFORE anything is announced — asking first and
// renewing after is exactly the order that produced the zeros.
{
  const env = fakeEnv();
  const order = [];
  const stop = w.startSessionWatch({
    ensureFresh: async () => { order.push("renew"); return true; },
    doc: env.doc, win: env.win,
  });
  const off = w.onShouldRefetch(() => order.push("refetch"));
  env.doc.visibilityState = "hidden"; await Promise.all(env.fire("visibilitychange"));
  await new Promise((r) => setTimeout(r, 40));
  env.doc.visibilityState = "visible"; await Promise.all(env.fire("visibilitychange"));
  await new Promise((r) => setTimeout(r, 10));
  ok("the login is renewed before any screen is told to ask again",
     order[0] === "renew", order.join(" → "));
  off(); stop();
}

// Reconnecting is its own moment: the app may never have been hidden.
{
  const env = fakeEnv();
  let renewed = 0;
  const stop = w.startSessionWatch({
    ensureFresh: async () => { renewed += 1; return true; },
    doc: env.doc, win: env.win,
  });
  await Promise.all(env.fire("online"));
  ok("coming back online renews the login", renewed === 1);
  stop();
}

// iOS restores a backgrounded app with pageshow rather than visibilitychange.
//
// pageshow ALSO fires on an ordinary first load, when every screen is about to
// fetch on mount anyway — so the watcher ignores it for the first two seconds.
// The clock is injected here to test both sides of that.
{
  const env = fakeEnv();
  let renewed = 0;
  let clock = 1_000_000;
  const stop = w.startSessionWatch({
    ensureFresh: async () => { renewed += 1; return true; },
    doc: env.doc, win: env.win, now: () => clock,
  });
  await Promise.all(env.fire("pageshow"));
  ok("the pageshow of an ordinary first load is ignored", renewed === 0);

  clock += 60 * 60 * 1000;   // an hour in a pocket
  await Promise.all(env.fire("pageshow"));
  ok("an iPhone restoring the app an hour later is handled", renewed === 1);
  stop();
}

// A login that is genuinely gone is the app's own "please sign in again"
// path. Shouting here would produce a second, competing message.
{
  const env = fakeEnv();
  const stop = w.startSessionWatch({
    ensureFresh: async () => false,
    doc: env.doc, win: env.win,
  });
  ok("a dead login does not throw out of the watcher", true);
  stop();
}

// One screen failing must not stop the others being told.
{
  const env = fakeEnv();
  const told = [];
  const stop = w.startSessionWatch({ ensureFresh: async () => true, doc: env.doc, win: env.win });
  const a = w.onShouldRefetch(() => { throw new Error("one screen blew up"); });
  const b = w.onShouldRefetch(() => told.push("b"));
  await Promise.all(env.fire("online"));
  await new Promise((r) => setTimeout(r, 10));
  ok("a screen that throws does not stop the rest being told", told.includes("b"));
  a(); b(); stop();
}

// Stopping must actually stop.
{
  const env = fakeEnv();
  let renewed = 0;
  const stop = w.startSessionWatch({ ensureFresh: async () => { renewed += 1; return true; }, doc: env.doc, win: env.win });
  stop();
  await Promise.all(env.fire("online"));
  ok("stopping removes the listeners", renewed === 0);
}

ok("no document or window at all is survivable",
   typeof w.startSessionWatch({ ensureFresh: async () => true, doc: null, win: null }) === "function");

console.log("\n3. Wired in, and the login is kept on the device");

ok("the watcher is started once, from main.jsx",
   main.includes("startSessionWatch({ ensureFresh: ensureFreshSession })"));
ok("the login is kept on the device", /persistSession:\s*true/.test(client));
ok("the login renews itself in the background", /autoRefreshToken:\s*true/.test(client));
ok("a password-reset link can still finish", /detectSessionInUrl:\s*true/.test(client));
ok("the 8-second request timeout is untouched", client.includes("FETCH_TIMEOUT_MS = 8000"));

// The three pages SISEN's parents use must ask again when the app returns.
for (const [file, label] of [
  ["src/pages/Dashboard.jsx", "Dashboard"],
  ["src/pages/DailyBook.jsx", "Daily Book"],
  ["src/pages/Expenses.jsx", "Expenses"],
]) {
  const src = readFileSync(file, "utf8");
  ok(`${label} asks again when the app comes back`,
     src.includes("useRefetchSignal()") && /\[[^\]]*\brefetch\]/.test(src),
     "needs useRefetchSignal() and refetch in the effect's dependencies");
}

// ── 4 ─ a device with no login may not sync ────────────────────────────────
//
// [2026-09-17] The whole of that day's damage came from one line saying a
// missing session was fine. It is not fine. A request with no login is not
// refused by Supabase — it runs as the signed-out `anon` role, which under
// row-level security can see NO rows. Every queued save then fails with a
// message that names the wrong problem:
//
//   · finalize_weighing_ticket → "weighing ticket <id> not found", for a
//     ticket sitting right there, already finalized  (Jomnoum, 14,697
//     database errors in one day)
//   · an insert → "new row violates row-level security policy for payments"
//     (Ping Pong, the same day)
//
// Neither reads as "sign in again", so nothing ever stopped retrying.

console.log("\n4. A device with no login does not sync");

ok("no session means NOT ok to sync",
   /if \(!session\) return false;/.test(client),
   "ensureFreshSession must return false when there is no session at all — "
   + "returning true lets the queue fire every write as the anonymous role");

ok("and the old line is really gone",
   !/if \(!session\) return true;/.test(client),
   "the 17 September fault is back");

ok("the queue stops instead of retrying when auth says no",
   /const authOk = await ensureFreshSession\(\);\s*\n\s*if \(!authOk\) \{\s*\n\s*sessionExpired = true;/
     .test(readFileSync("src/offlineQueue.js", "utf8")),
   "offlineQueue must set sessionExpired and return, not carry on");

ok("a genuinely offline device is still allowed to try",
   /catch \(_err\) \{[\s\S]*?return true;/.test(client),
   "no connection is not the same as no login — that path must still return true");

console.log(failed
  ? `\n${failed} FAILED`
  : "\nComing back to the app re-asks with a live login — and a device with no login never writes as nobody.");
process.exit(failed ? 1 : 0);
