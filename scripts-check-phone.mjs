// scripts-check-phone.mjs — no table wider than a phone without a phone version.
//
// [2026-09-16] SISEN: "now the customize to fit different phone size to make
// it readable. especially for daily book", then "also the size isnt fit
// properly", then, on which phones: "what about if its iphone or sth. make
// sure it fit based on any size of the screen".
//
// THE PATTERN THIS CATCHES
//
// A table too wide for a phone, wrapped in overflow-x-auto. That looks like
// care — the page does not break, the table scrolls on its own. In practice
// NOBODY SCROLLS A TABLE SIDEWAYS. The columns past the fold are not hidden;
// they are simply never read, which is worse, because the figures are there
// and everyone assumes they were seen.
//
// Three screens shipped that way:
//
//     Dashboard   Location Performance   min-w-[640px]
//     Daily Book  the ledger             17 columns, ~1,100px
//     Expenses    the breakdown          min-w-[560px]
//
// On a 390pt phone the Dashboard's "On hand" — the figure the row exists
// for — was off the right-hand edge of every row.
//
// THE RULE
//
// A table that declares a minimum width a phone cannot meet must be
// `hidden md:block`, and something must render in its place below md. The
// widest phone in normal use is 430pt and the narrowest is 320, so anything
// over 420 fails here.
//
// Run: node scripts-check-phone.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Narrower than this and it fits a phone; wider and it needs an answer.
const PHONE_MAX = 420;

// Screens that still scroll sideways on a phone, and are allowed to for now.
//
// A ratchet, like scripts-check-i18n.mjs: this list may SHRINK and never
// grow. Both are admin screens that nobody opens on a phone — a Data Check
// run and a station's day-close review, both done sitting at a PC — so they
// are not worth the risk of rebuilding today. The three screens SISEN's
// parents actually use are done.
//
// Delete a line here when its screen gets a card view. Adding one is the
// thing this file exists to stop.
const KNOWN = new Set([
  "src/components/StationDaysReview.jsx",
  "src/pages/DataCheck.jsx",
]);

let failed = 0;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk("src");
const wide = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");

  lines.forEach((line, i) => {
    // A width already scoped to a breakpoint — `sm:min-w-[560px]` — only
    // applies once the screen is wide enough for it, which is the whole
    // point. Only an UNSCOPED minimum reaches a phone. Found by this
    // guard's first run flagging Expenses.jsx, which had already been
    // fixed exactly that way.
    const m = line.match(/(^|[\s"'])min-w-\[(\d+)px\]/);
    if (!m) return;
    const px = Number(m[2]);
    if (px <= PHONE_MAX) return;
    if (!/<table/.test(line)) return;

    // The wrapper is normally the line above; look a little either way so a
    // differently-formatted wrapper still counts.
    const around = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
    const hiddenOnPhone = /hidden[^"]*\bmd:block\b|\bmd:block[^"]*\bhidden\b/.test(around);

    // And something has to be there instead.
    const hasPhoneVersion = /md:hidden/.test(src);

    wide.push({ file, line: i + 1, px, hiddenOnPhone, hasPhoneVersion });
  });
}

console.log(`\nChecked ${files.length} screens for tables wider than a phone (${PHONE_MAX}px).\n`);

if (wide.length === 0) {
  console.log("  ok    no table declares a width a phone cannot meet\n");
} else {
  for (const w of wide) {
    const good = w.hiddenOnPhone && w.hasPhoneVersion;
    if (good) {
      console.log(`  ok    ${w.file}:${w.line} — ${w.px}px, hidden below md, with a card view in its place`);
    } else if (KNOWN.has(w.file)) {
      console.log(`  known ${w.file}:${w.line} — ${w.px}px, still sideways on a phone (admin screen, allowed for now)`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${w.file}:${w.line} — a ${w.px}px table on a ${PHONE_MAX}px-or-narrower screen`);
      if (!w.hiddenOnPhone) console.log("          it is not `hidden md:block`, so a phone gets a sideways scroller");
      if (!w.hasPhoneVersion) console.log("          and nothing in this file renders `md:hidden` in its place");
      console.log("          Columns past the fold are never read. Give it a card view.\n");
    }
  }
}

console.log(failed ? `\n${failed} FAILED\n` : "\nall ok\n");
process.exit(failed ? 1 : 0);
