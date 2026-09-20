// scripts-check-login.mjs — signing in with a name instead of an email.
//
// [2026-09-16] SISEN, with a phone number typed into the Email box:
//
//     "what if it can be username doesnt have to be email also can?"
//
// The login table only stores email addresses. PaddyTrade has quietly been
// working around that for months — `boss@paddytrade.local` is a username with
// a domain stuck on the end. This makes it official.
//
// Two things can go badly wrong and neither shows up on screen:
//
//   · A name converted differently in two places means an account created as
//     one login cannot sign in with the other. Nobody would ever guess why.
//   · An invite sent to a made-up domain leaves someone waiting for an email
//     that does not exist anywhere and never will.
//
// So the rules are executed here, not read.
//
// Run: node scripts-check-login.mjs

import { readFileSync } from "node:fs";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};

const L = await import("./src/loginName.js");
const login = readFileSync("src/pages/Login.jsx", "utf8");
const addUser = readFileSync("src/components/AddUserModal.jsx", "utf8");

console.log("\n1. A typed name becomes a login the database accepts");

ok("boss -> boss@paddytrade.com",
   L.toLoginEmail("boss") === "boss@paddytrade.com", L.toLoginEmail("boss"));
ok("a phone number works — what SISEN actually typed",
   L.toLoginEmail("012934050") === "012934050@paddytrade.com", L.toLoginEmail("012934050"));
// [2026-09-16] Supabase refused "012934050@paddytrade.local" outright:
// its account system checks the domain ending against real ones, and
// .local is not one. Nothing in the app can argue with that, so new
// accounts must never be created on it again.
ok("new accounts are NEVER made on .local — Supabase rejects the address",
   !L.toLoginEmail("boss").endsWith(".local") && L.LOGIN_DOMAIN === "paddytrade.com",
   `LOGIN_DOMAIN is ${L.LOGIN_DOMAIN}`);
ok("capitals and stray spaces do not create a second, different account",
   L.toLoginEmail("  BOSS ") === L.toLoginEmail("boss"));
ok("a space inside a name becomes a dot, not a broken address",
   L.toLoginEmail("reang kesey") === "reang.kesey@paddytrade.com", L.toLoginEmail("reang kesey"));
ok("Khmer is dropped rather than rejected by the database",
   L.toLoginEmail("ចំណោម2") === "2@paddytrade.com", L.toLoginEmail("ចំណោម2"));
ok("nothing typed stays nothing — the form decides what to say about it",
   L.toLoginEmail("") === "" && L.toLoginEmail(null) === "" && L.toLoginEmail(undefined) === "");
ok("no address ever ends up with a dot next to the @",
   !/[.]@/.test(L.toLoginEmail(".boss.")) && !/[.]@/.test(L.toLoginEmail("boss ")), L.toLoginEmail(".boss."));
ok("a name typed twice over converts to the same thing both times",
   L.toLoginEmail(L.toLoginEmail("boss")) === L.toLoginEmail("boss"));

console.log("\n2. Real addresses are left exactly as they are");

ok("a gmail address is untouched",
   L.toLoginEmail("sisen@gmail.com") === "sisen@gmail.com");
ok("an address typed with capitals still signs in — logins are lower case",
   L.toLoginEmail("SISEN@Gmail.com") === "sisen@gmail.com");
ok("the accounts already in use keep working",
   L.toLoginEmail("boss@paddytrade.local") === "boss@paddytrade.local" &&
   L.toLoginEmail("cnregister@paddytrade.com") === "cnregister@paddytrade.com" &&
   L.toLoginEmail("baitang@paddytrade.com") === "baitang@paddytrade.com");

console.log("\n3. A name signs in whichever domain its account was made on");

// The trap this section exists to catch: moving new accounts to
// paddytrade.com would silently break boss@paddytrade.local — SISEN's own
// login — if signing in only ever tried one domain.
ok("typing 'boss' tries the new domain first",
   L.loginCandidates("boss")[0] === "boss@paddytrade.com", JSON.stringify(L.loginCandidates("boss")));
ok("and falls back to the old one, so boss@paddytrade.local still signs in",
   L.loginCandidates("boss").includes("boss@paddytrade.local"), JSON.stringify(L.loginCandidates("boss")));
ok("a real address is tried once and never guessed at",
   L.loginCandidates("sisen@gmail.com").length === 1 &&
   L.loginCandidates("sisen@gmail.com")[0] === "sisen@gmail.com");
ok("every candidate is a full address — no bare name ever reaches the database",
   L.loginCandidates("boss").every((c) => c.includes("@")));
ok("nothing typed produces nothing to try",
   L.loginCandidates("").length === 0 && L.loginCandidates("   ").length === 0);
ok("a name of pure Khmer produces nothing rather than '@paddytrade.com'",
   L.loginCandidates("ចំណោម").length === 0, JSON.stringify(L.loginCandidates("ចំណោម")));
ok("the first candidate always matches what Add User would have created",
   L.loginCandidates("012934050")[0] === L.toLoginEmail("012934050"),
   "if these ever disagree, an account can be created that can never sign in");

console.log("\n4. An invite is only offered where an email can arrive");

ok("a real address can be invited", L.isRealAddress("sisen@gmail.com"));
ok("a bare name cannot be invited", !L.isRealAddress("boss"));
ok("our own fake domain cannot be invited — no mailbox exists there",
   !L.isRealAddress("boss@paddytrade.local"));
ok("the other fake domain cannot be invited either",
   !L.isRealAddress("cnregister@paddytrade.com"));
ok("any .local address is refused, not just ours",
   !L.isRealAddress("someone@office.local"));
ok("a domain with no dot is refused", !L.isRealAddress("boss@gmail"));
ok("two @ signs are refused", !L.isRealAddress("a@b@gmail.com"));
ok("an address with a space in it is refused", !L.isRealAddress("si sen@gmail.com"));
ok("nothing typed is refused", !L.isRealAddress("") && !L.isRealAddress(null));

console.log("\n5. What is shown back to a person");

ok("the made-up domain is hidden — SISEN sees 'boss', not the whole address",
   L.loginLabel("boss@paddytrade.local") === "boss", L.loginLabel("boss@paddytrade.local"));
ok("the other house domain is hidden too",
   L.loginLabel("cnregister@paddytrade.com") === "cnregister");
ok("a genuine address is shown in full — hiding half of it would be a lie",
   L.loginLabel("sisen@gmail.com") === "sisen@gmail.com");
ok("nothing in, nothing out", L.loginLabel("") === "" && L.loginLabel(null) === "");

console.log("\n6. The two screens actually use it");

ok("Login.jsx tries every domain a name could belong to",
   /loginCandidates\s*\(/.test(login) && /from\s+"\.\.\/loginName\.js"/.test(login),
   "signing in against only one domain locks boss@paddytrade.local out");
ok("the Login box no longer demands an @ before it will submit",
   !/type="email"/.test(login),
   "type=\"email\" makes the browser refuse a bare name, before any of our code runs");
ok("Add User converts before creating the account",
   /toLoginEmail\s*\(/.test(addUser) && /from\s+"\.\.\/loginName\.js"/.test(addUser));
ok("Add User no longer demands an @ either",
   !/type="email"/.test(addUser));
ok("Add User still refuses to send an invite to an address that cannot receive one",
   /isRealAddress\s*\(/.test(addUser),
   "without this, an invite to 012934050@paddytrade.local is silently never delivered");

console.log(failed ? `\n${failed} FAILED\n` : "\nall ok\n");
process.exit(failed ? 1 : 0);
