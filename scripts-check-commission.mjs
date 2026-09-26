// scripts-check-commission.mjs — ថ្លៃកូនដៃ against the tonnes.
//
// [2026-09-17] SISEN: "i each location to show the total buy amount in tons
// that is purchased in that day so we can actually compare if the commision
// given is correct or wrong. normally every tons the commision is 10,000riels
// max".
//
// This is the first thing in the app that tells SISEN somebody has been
// overpaid. Two ways it could do harm, and both are worse than not having it:
//
//   · SAYING OVER WHEN IT IS NOT. A staff member accused over a rounding
//     error, or over a day the app simply could not measure, is a real cost
//     to a real person. Every "over" has to be arithmetic, not a guess.
//   · SAYING FINE WHEN IT IS NOT. A ceiling that is quietly wrong makes the
//     whole check worse than useless, because it is now trusted.
//
// So every branch runs here, including division by zero tonnes and the day
// a station is paid commission having bought nothing.
//
// Run: node scripts-check-commission.mjs

import { checkCommission, checkDay, tonnes, MAX_PER_TONNE, BASIS } from "./src/commissionRule.js";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};

console.log("\n1. The rule itself");

ok("the ceiling is 10,000 riel per tonne", MAX_PER_TONNE === 10_000, String(MAX_PER_TONNE));
ok("it is measured against paddy BOUGHT", BASIS === "bought", BASIS);
ok("kilograms read as tonnes — 161,560 kg is 161.56", tonnes(161_560) === 161.56, String(tonnes(161_560)));
ok("nothing weighed is nothing, not NaN", tonnes(null) === 0 && tonnes(undefined) === 0 && tonnes("x") === 0);

console.log("\n2. Under, at, and over");

// Jomnoum, 15 September: 161.56 tonnes in, 446,500 paid.
const under = checkCommission({ commission: 446_500, boughtKg: 161_560, soldKg: 136_920 });
ok("a normal day is ok", under.state === "ok", under.state);
ok("and says the rate", under.perTonne === 2764, String(under.perTonne));
ok("and the ceiling it was measured against", under.ceiling === 1_615_600, String(under.ceiling));
ok("and how much of it was used", under.pct === 28, String(under.pct));
ok("nothing is reported as over", under.overBy === 0);

// Exactly 10,000 a tonne.
const at = checkCommission({ commission: 356_000, boughtKg: 35_600, soldKg: 42_100 });
ok("exactly at the ceiling is 'at', not 'over'", at.state === "at", at.state);
ok("at the ceiling nothing is over by anything", at.overBy === 0, String(at.overBy));
ok("and the rate is exactly the ceiling", at.perTonne === MAX_PER_TONNE, String(at.perTonne));

// Ping Pong: 46 tonnes in, 610,000 paid.
const over = checkCommission({ commission: 610_000, boughtKg: 46_000, soldKg: 0 });
ok("over the ceiling is over", over.state === "over", over.state);
ok("and says by how much, in riel", over.overBy === 150_000, String(over.overBy));
ok("and the rate that produced it", over.perTonne === 13_261, String(over.perTonne));
ok("and what the ceiling was", over.ceiling === 460_000, String(over.ceiling));

console.log("\n3. Nobody is accused over arithmetic that cannot be done");

const noPay = checkCommission({ commission: 0, boughtKg: 161_560, soldKg: 0 });
ok("a day with no commission is 'none' — never a breach",
   noPay.state === "none" && noPay.overBy === 0, noPay.state);
ok("its ceiling is still worked out, so the screen can show the headroom",
   noPay.ceiling === 1_615_600);

const noBuy = checkCommission({ commission: 200_000, boughtKg: 0, soldKg: 88_000 });
ok("commission on a day with no paddy bought is 'unknown', not 'over'",
   noBuy.state === "unknown", noBuy.state);
ok("and shows no rate rather than dividing by zero",
   noBuy.perTonne === null && Number.isFinite(noBuy.overBy), JSON.stringify(noBuy));
ok("nothing anywhere is Infinity or NaN",
   Object.values(noBuy).every((v) => v === null || typeof v === "string" || Number.isFinite(v)),
   JSON.stringify(noBuy));

const nothing = checkCommission({});
ok("no arguments at all is 'none', not a crash", nothing.state === "none");
ok("junk in does not produce junk out",
   checkCommission({ commission: "x", boughtKg: "y" }).state === "none");

console.log("\n4. One riel of rounding is not a breach");

// The ceiling is itself rounded, so a figure a riel above it is the rounding,
// not somebody taking money.
const hair = checkCommission({ commission: 460_001, boughtKg: 46_000 });
ok("a riel over the ceiling is not called over", hair.state !== "over", hair.state);
const real = checkCommission({ commission: 460_500, boughtKg: 46_000 });
ok("but five hundred riel over is", real.state === "over", real.state);

console.log("\n5. A whole day, across stations");

const day = checkDay([
  { commission: 446_500, boughtKg: 161_560, soldKg: 136_920 },   // ok
  { commission: 610_000, boughtKg: 46_000, soldKg: 0 },          // over
  { commission: 356_000, boughtKg: 35_600, soldKg: 42_100 },     // at
]);
ok("the day adds every station's commission", day.ceiling === Math.round(243.16 * MAX_PER_TONNE),
   String(day.ceiling));
ok("and divides once, rather than averaging the stations' rates",
   day.perTonne === Math.round((446_500 + 610_000 + 356_000) / 243.16), String(day.perTonne));
// The point of summing first: a big clean station must not be able to hide a
// small dirty one, and a tiny station must not drag the whole day red.
ok("one station over does not by itself make the day over",
   day.state !== "over",
   "the day is only over when the day's OWN total exceeds the day's own ceiling");
ok("an empty day is 'none', not a crash", checkDay([]).state === "none");
ok("no argument at all is 'none'", checkDay().state === "none");

console.log("\n6. The screen uses it");

import { readFileSync } from "node:fs";
const exp = readFileSync("src/pages/Expenses.jsx", "utf8");
ok("Expenses imports the rule", /from "\.\.\/commissionRule\.js"/.test(exp));
// [2026-09-24] Was "shows tonnes bought AND sold" as a strip above every
// station every day. SISEN: "the expenses really look complicated". The
// tonnes bought now sit on the ថ្លៃកូនដៃ line as the working behind the
// rate — which is the only place anyone was reading them — and tonnes sold
// live in the Daily Book, where tonnage is the subject.
ok("and shows the tonnes the rate was worked out from", /tonnesBought/.test(exp));
ok("and the rate sits on the line it judges", /ex_rate_line/.test(exp) && /l\.kh && check\.perTonne !== null/.test(exp));
ok("and says nothing when the commission is within the limit",
   /check\.state === "ok" \|\| check\.state === "none" \|\| check\.state === "unknown"\) return null/.test(exp),
   "a green tick on every station every day is a line everyone learns to skip");
ok("and never prints a rate it could not work out",
   /perTonne !== null/.test(exp) || /perTonne != null/.test(exp),
   "an 'unknown' day must show no rate, not Infinity or NaN");

console.log(failed ? `\n${failed} FAILED\n` : "\nall ok\n");
process.exit(failed ? 1 : 0);
