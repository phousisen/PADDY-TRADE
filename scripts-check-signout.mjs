// scripts-check-signout.mjs — why was this machine signed out?
//
// [2026-09-17] SISEN, twice: "why do we always get logged out".
//
// Five things can end a session and the app kept no record of which one did,
// so every answer was a guess. This guard protects the thing that makes the
// record worth trusting:
//
//   · EVERY deliberate sign-out path writes its reason down FIRST. One path
//     that forgets makes its sign-outs look like expiries, and an expiry is
//     the answer that sends SISEN to change a Supabase setting. A guess is bad;
//     a confident wrong answer is worse.
//   · AN UNEXPLAINED SIGNED_OUT IS RECORDED AS "expired". That is the whole
//     diagnostic value — it is the only way to tell "this app logged you out"
//     from "your login died".
//   · NOTING A REASON CAN NEVER BLOCK A SIGN-OUT. Someone pressing Log out on
//     a shared station PC must be logged out even if storage is broken.
//   · A STALE NOTE IS NOT AN EXPLANATION. Logging out on Monday must not be
//     blamed for Friday.
//
// Run: node scripts-check-signout.mjs

import { readFileSync } from "node:fs";
import {
  noteSignOut, readSignOutNote, clearSignOutNote, wasDeliberate, shouldShowNote,
  reasonKey, needsAttention, REASONS, NOTE_FRESH_MS, SHOW_FOR_MS,
} from "./src/signOutReason.js";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};

// A localStorage that behaves, so the pure functions can be exercised at all.
function installStorage(impl) {
  globalThis.localStorage = impl;
}
function workingStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

console.log("\n1. Writing it down, and reading it back");

installStorage(workingStorage());
clearSignOutNote();
ok("nothing recorded reads as nothing", readSignOutNote() === null);

noteSignOut(REASONS.USER);
const n1 = readSignOutNote();
ok("a reason survives", n1 && n1.reason === "user", JSON.stringify(n1));
ok("and carries when", !!n1.at && Number.isFinite(new Date(n1.at).getTime()));

noteSignOut(REASONS.HQ_DEVICE);
ok("the newest reason wins", readSignOutNote().reason === "hq_device");

clearSignOutNote();
ok("clearing works", readSignOutNote() === null);

console.log("\n2. A broken note must never block a sign-out");

// A station PC in private mode, or with storage full. The person pressed
// Log out; they get logged out.
installStorage({
  getItem() { throw new Error("denied"); },
  setItem() { throw new Error("denied"); },
  removeItem() { throw new Error("denied"); },
});
let threw = false;
try { noteSignOut(REASONS.USER); } catch { threw = true; }
ok("writing a note cannot throw", threw === false);
threw = false;
try { readSignOutNote(); } catch { threw = true; }
ok("reading one cannot throw", threw === false);
ok("and an unreadable note reads as none", readSignOutNote() === null);
threw = false;
try { clearSignOutNote(); } catch { threw = true; }
ok("clearing cannot throw", threw === false);

installStorage({ getItem: () => "{not json", setItem() {}, removeItem() {} });
ok("junk in storage is not a note", readSignOutNote() === null);
installStorage({ getItem: () => JSON.stringify({ at: "now" }), setItem() {}, removeItem() {} });
ok("a note with no reason is not a note", readSignOutNote() === null);

console.log("\n3. Deliberate, or the login simply died");

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

ok("a fresh note means this app did it",
   wasDeliberate({ note: { reason: "user", at: iso(now - 1000) }, now }) === true);
ok("no note at all means it did not",
   wasDeliberate({ note: null, now }) === false,
   "this is what becomes 'expired' — the answer SISEN actually needs");
ok("a note older than the window is not an explanation",
   wasDeliberate({ note: { reason: "user", at: iso(now - NOTE_FRESH_MS - 1) }, now }) === false,
   "logging out on Monday must not be blamed for Friday");
ok("an 'expired' note is never itself deliberate",
   wasDeliberate({ note: { reason: "expired", at: iso(now) }, now }) === false,
   "otherwise one expiry would mask the next");
ok("a note from the future is not deliberate either",
   wasDeliberate({ note: { reason: "user", at: iso(now + 60_000) }, now }) === false);
ok("an unparsable date is not deliberate",
   wasDeliberate({ note: { reason: "user", at: "yesterday" }, now }) === false);

console.log("\n4. What the login screen shows");

ok("a note from a minute ago is shown",
   shouldShowNote({ note: { reason: "expired", at: iso(now - 60_000) }, now }) === true);
ok("one from last week is not",
   shouldShowNote({ note: { reason: "expired", at: iso(now - SHOW_FOR_MS - 1) }, now }) === false,
   "a login screen carrying a week-old complaint is noise");
ok("a backwards clock does not hide it forever",
   shouldShowNote({ note: { reason: "expired", at: iso(now + 5_000) }, now }) === true);
ok("no note shows nothing", shouldShowNote({ note: null, now }) === false);

ok("only an expired login is flagged for attention",
   needsAttention(REASONS.EXPIRED) === true);
for (const r of ["user", "everywhere", "hq_device", "hq_forced", "password"]) {
  ok(`  '${r}' explains itself — no amber box`, needsAttention(r) === false);
}

console.log("\n5. Every reason has words, in both languages");

const i18n = readFileSync("src/i18n.jsx", "utf8");
const enBlock = i18n.slice(i18n.indexOf("\n  en: {"), i18n.indexOf("\n  km: {"));
const kmBlock = i18n.slice(i18n.indexOf("\n  km: {"));
const allKeys = [...Object.values(REASONS).map(reasonKey), "so_reason_unknown", "st_signout_hint"];
for (const k of [...new Set(allKeys)]) {
  ok(`  ${k} — English`, new RegExp(`\\b${k}:`).test(enBlock));
  ok(`  ${k} — Khmer`, new RegExp(`\\b${k}:`).test(kmBlock));
}
ok("an unknown reason still has words, rather than printing the key",
   reasonKey("something_new") === "so_reason_unknown");

const kmLines = kmBlock.split("\n").filter((l) => /^\s+(so_reason_[a-z_]+|st_signout_hint):/.test(l));
const stillEnglish = kmLines.filter((l) => {
  const v = l.slice(l.indexOf(":") + 1);
  return /"[A-Za-z][^"]{3,}"/.test(v) && !/[ក-៿]/.test(v);
});
ok("no Khmer entry is still English", stillEnglish.length === 0, stillEnglish.join("\n          "));

console.log("\n6. EVERY sign-out path writes a reason first");

// The one that matters most. A path that forgets makes its own sign-outs
// indistinguishable from an expired login, which is the answer that sends
// somebody to change a Supabase setting that was never the problem.
// Between the note and the sign-out, only comment lines may appear.
const C = String.raw`(?:\s*\/\/[^\n]*\n)*\s*`;
const paths = [
  // [2026-09-19] Each path must now also say its SCOPE. supabase-js defaults
  // signOut() to "global" — every device on the account — so a bare call is
  // exactly the bug that silently signed out every other device sharing a
  // login. "local" everywhere, except the two places that mean everywhere.
  ["src/AuthContext.jsx", "the person pressing Log out (this device only)",
    new RegExp(String.raw`noteSignOut\([^\n]*REASONS\.USER\);\s*\n` + C + String.raw`const \{ error \} = await supabase\.auth\.signOut\(\{ scope: "local" \}\);`)],
  ["src/AuthContext.jsx", "the heartbeat's forced logout (this device only)",
    new RegExp(String.raw`noteSignOut\(REASONS\.HQ_FORCED\);\s*\n` + C + String.raw`await supabase\.auth\.signOut\(\{ scope: "local" \}\);`)],
  ["src/components/UpdateBanner.jsx", "HQ signing this machine out (this machine only)",
    new RegExp(String.raw`noteSignOut\(REASONS\.HQ_DEVICE\);\s*\n` + C + String.raw`try \{ await supabase\.auth\.signOut\(\{ scope: "local" \}\)`)],
  ["src/components/Topbar.jsx", "sign out everywhere (deliberately global)",
    new RegExp(String.raw`noteSignOut\(REASONS\.EVERYWHERE\);\s*\n` + C + String.raw`const \{ error \} = await supabase\.auth\.signOut\(\{ scope: "global" \}\)`)],
  ["src/pages/SetPassword.jsx", "finishing a password change (deliberately global)",
    new RegExp(String.raw`noteSignOut\(REASONS\.PASSWORD\);\s*\n` + C + String.raw`await supabase\.auth\.signOut\(\{ scope: "global" \}\)`)],
];
for (const [file, what, re] of paths) {
  ok(`  ${what}`, re.test(readFileSync(file, "utf8")), `${file} signs out without saying why`);
}

// [2026-09-19] No sign-out may leave its scope to the library default.
{
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = d + "/" + n;
    return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(n) ? [p] : [];
  });
  const bare = walk("src").filter((p) => /auth\.signOut\(\s*\)/.test(readFileSync(p, "utf8")));
  ok("no sign-out leaves its scope to the default (which is every device)", bare.length === 0, bare.join(", "));
}

// And nothing new has crept in unrecorded.
const SIGNOUT_FILES = ["src/AuthContext.jsx", "src/components/UpdateBanner.jsx",
                       "src/components/Topbar.jsx", "src/pages/SetPassword.jsx"];
let calls = 0;
for (const f of SIGNOUT_FILES) {
  calls += (readFileSync(f, "utf8").match(/supabase\.auth\.signOut\(/g) || []).length;
}
// 6 = the five paths above, plus logout()'s local-scope retry on a failed
// network call, which is the SAME sign-out and already has its note.
ok("no unaccounted sign-out call has appeared", calls === 6,
   `found ${calls} — a new one needs its own noteSignOut() and a line in this guard`);

const auth = readFileSync("src/AuthContext.jsx", "utf8");
ok("an unexplained SIGNED_OUT is recorded as expired",
   /if \(!wasDeliberate\(\{ note: readSignOutNote\(\) \}\)\) \{\s*\n\s*noteSignOut\(REASONS\.EXPIRED\);/.test(auth),
   "this is the whole point — it separates 'the app did it' from 'the login died'");

console.log("\n6b. The reason must be the REAL reason");

// [2026-09-17] SISEN's login screen read "You signed out." when he had not.
// The sync banner's own "Sign in again" button — only ever shown when the
// login has ALREADY expired — called the same logout() as the menu item, so
// an expiry was recorded as a deliberate sign-out.
//
// That is this feature failing at its own job. The whole point is to separate
// "the app did it" from "your login died", and it was labelling the second as
// the first, on the one screen built to tell them apart.
ok("logout() takes a reason rather than assuming one",
   /async function logout\(reason = REASONS\.USER\)/.test(auth),
   "not every caller is a person pressing Log out");
ok("and a caller that passes junk still records something sane",
   /typeof reason === "string" \? reason : REASONS\.USER/.test(auth));
ok("the expired-login banner records EXPIRED, not USER",
   /onSignInAgain=\{\(\) => logout\(REASONS\.EXPIRED\)\}/.test(readFileSync("src/components/Topbar.jsx", "utf8")),
   "that button is only shown when the login has already died");

console.log("\n6c. The login screen gives nothing away");

// SISEN: "why would u put a suggestion for the real account on there".
// The Name box hinted "boss, or 012934050" — a real username and a real phone
// number, on the one screen a stranger can reach without signing in. Half a
// login, printed on the door.
{
  const dict = readFileSync("src/i18n.jsx", "utf8");
  ok("no real account name in the login hint", !/login_name_hint: "boss/.test(dict));
  ok("no real phone number either", !/login_name_hint:[^\n]*012934050/.test(dict));
  ok("the hint still says what SHAPE to type",
     /login_name_hint: "your name or phone number"/.test(dict),
     "generic is the goal, useless is not");
}

console.log("\n7. It reaches HQ");

ok("the note is handed in on the next sign-in, not at sign-out",
   /_event === "SIGNED_IN"[\s\S]{0,600}note_signout/.test(auth),
   "a session that has ended cannot write to the database");
ok("and cleared once it has been handed in", /note_signout[\s\S]{0,300}clearSignOutNote\(\)/.test(auth));
ok("reporting it can never break signing in", /note_signout[\s\S]{0,300}\.catch\(\(\) => \{\}\)/.test(auth));

const sql = readFileSync("signout_reason.sql", "utf8");
ok("the browser's reason is checked against a known list, not stored as typed",
   /case lower\(coalesce\(p_reason[\s\S]*?else null[\s\S]*?end;/.test(sql));
ok("an unknown reason stores nothing", /if v_reason is null then\s*\n\s*return;/.test(sql));
ok("a device with a wrong clock cannot stamp a silly time",
   /v_at > now\(\) \+ interval '1 day' or v_at < timestamptz '2025-01-01'/.test(sql),
   "phone clocks are wrong often enough that the app calibrates its own");
ok("a machine can only write its OWN row", /and user_id = auth\.uid\(\)/.test(sql));
ok("the columns are added if-not-exists, so the file is safe to re-run",
   /add column if not exists last_signout_reason/.test(sql));

const api = readFileSync("src/api.js", "utf8");
ok("the Stations panel actually reads the new columns",
   /last_signout_reason, last_signout_at/.test(api),
   "columns nobody selects answer nobody's question");
const sv = readFileSync("src/components/StationVersions.jsx", "utf8");
ok("and shows them", /d\.last_signout_reason/.test(sv));
ok("amber only for the cause worth chasing", /needsAttention\(d\.last_signout_reason\)/.test(sv));

console.log(failed ? `\n${failed} FAILED\n` : "\nall ok\n");
process.exit(failed ? 1 : 0);
