// scripts-check-escape.mjs — every account can change language and sign out.
//
// [2026-09-16] SISEN, on the Viewer account made for his parents:
//
//     "where where to change language wtf. so not professional"
//
// WHAT HAPPENED
//
// A view-only account has three pages, and all three fit on the phone's
// bottom tab bar — so there was nothing left to put behind the "More"
// button, and I hid the button. That reasoning was correct and completely
// beside the point: the More sheet is also the ONLY place on a phone that
// holds the LANGUAGE SWITCH and LOG OUT.
//
// So the account made for two people who read Khmer opened in whichever
// language it happened to be in, with no way to change it and no way to
// sign out. A menu is not only a list of pages.
//
// WHAT THIS ASSERTS
//
// Two controls must be reachable from every account, on every device, with
// no permission, role or view-only condition in front of them:
//
//     · the language switch
//     · Log out
//
// They are the two that get someone OUT of a state they did not choose,
// which is exactly why they can never be behind a gate. A person who
// cannot read the screen cannot find a way to fix that by reading it.
//
// Run: node scripts-check-escape.mjs

import { readFileSync } from "node:fs";

let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
};

const NAVS = [
  ["MobileNav.jsx", "src/components/MobileNav.jsx", "phone"],
  ["Sidebar.jsx", "src/components/Sidebar.jsx", "computer"],
];

// Is `line` inside a conditional that could remove it for some accounts?
// Deliberately crude and deliberately loud: this guard should complain
// about anything it cannot prove is unconditional, because the cost of a
// false alarm is a minute and the cost of a miss is the bug above.
const GATES = /isViewOnly|hasPermission|can\(|isAdmin|isStaff|isOwner|\.length\s*>\s*0/;

for (const [name, path, where] of NAVS) {
  const src = readFileSync(path, "utf8");
  const lines = src.split("\n");

  console.log(`\n${name} — the ${where}`);

  for (const [what, needle] of [["the language switch", /setLang\(/], ["Log out", /onClick=\{logout\}/]]) {
    const at = lines.findIndex((l) => needle.test(l));
    ok(`${what} exists at all`, at !== -1, `nothing in ${path} calls it`);
    if (at === -1) continue;

    // Walk back up to the nearest blank line or block start and look for a
    // condition wrapping it. A control that is rendered inside `{cond && (`
    // within a few lines is the shape that produced the bug.
    const above = lines.slice(Math.max(0, at - 6), at).join("\n");
    const gated = GATES.test(above) && /&&\s*\(?\s*$/m.test(above);
    ok(`${what} is not behind a permission or role check`, !gated,
       `something in the six lines above line ${at + 1} of ${path} can hide it:\n          ${above.trim().split("\n").filter((l) => GATES.test(l)).join("\n          ")}`);
  }

  // The button that OPENS the sheet matters as much as what is in it — on a
  // phone the two controls live inside it, so a hidden button hides them.
  if (name === "MobileNav.jsx") {
    const openIdx = lines.findIndex((l) => /setMoreOpen\(true\)/.test(l));
    const above = lines.slice(Math.max(0, openIdx - 3), openIdx).join("\n");
    ok("the More button itself is never hidden",
       openIdx !== -1 && !/&&\s*\(\s*$/m.test(above),
       "the language switch and Log out are inside that sheet — hiding the\n          button that opens it takes both away, which is the bug this guard is for");
  }
}

console.log(failed ? `\n${failed} FAILED\n` : "\nall ok\n");
process.exit(failed ? 1 : 0);
