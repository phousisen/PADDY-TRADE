// A name declared twice in the same function is a build failure, not a bug
// you find at runtime.
//
// [2026-09-16] Run:  node scripts-check-shadow.mjs
//
// WHY THIS EXISTS
//
// Translating the Daily Book meant renaming a prop called `t` (the row's
// totals) so the translator could be called `t` like everywhere else. I
// renamed it to `tot` — which was already a local in that same function:
//
//     function LedgerRow({ label, sub, tot, variant, ... }) {
//       const tot = variant === "total";       // ← already taken
//
// Vercel refused the build. Nothing shipped that day, and the screens SISEN
// was looking at stayed on old code while we both assumed they were new —
// which sent us chasing a caching problem that did not exist.
//
// There is no JSX parser in this sandbox, so this is the narrow check for
// exactly that mistake: a destructured parameter that is re-declared with
// const/let inside its own function body.

import fs from "node:fs";
import path from "node:path";

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

let failures = 0;

for (const file of files("src")) {
  const lines = fs.readFileSync(file, "utf8").split("\n");

  // Every function declaration that destructures its argument.
  const heads = [];
  lines.forEach((l, i) => {
    const m = /^(?:export default )?function\s+(\w+)\s*\(\s*\{([^}]*)\}/.exec(l);
    if (m) heads.push({ i, name: m[1], params: m[2] });
  });

  heads.forEach((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    const names = h.params
      .split(",")
      .map((s) => s.split(":")[0].split("=")[0].trim())
      .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));

    for (let i = h.i + 1; i < end; i += 1) {
      const line = lines[i];
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      // A nested function makes its own scope — stop looking.
      if (/^\s*(?:export default )?function\s+\w/.test(line)) break;
      for (const n of names) {
        const re = new RegExp(`^\\s*(?:const|let|var)\\s+${n}\\s*=`);
        if (re.test(line)) {
          failures += 1;
          console.log(`  FAIL  ${file}:${i + 1}`);
          console.log(`        "${n}" is a parameter of ${h}`.replace("[object Object]", h.name));
          console.log(`        and is declared again here — the build will refuse this.`);
          console.log(`        ${line.trim().slice(0, 90)}`);
        }
      }
    }
  });
}

console.log(
  failures === 0
    ? "\nNo parameter is shadowed by a declaration in its own function.\n"
    : `\n${failures} duplicate declaration(s) — these WILL fail the build.\n`,
);
process.exit(failures === 0 ? 0 : 1);
