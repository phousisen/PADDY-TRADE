// scripts-check-icons.mjs — an icon used but never imported.
//
// [2026-09-16] SISEN, signing in to the Viewer account for his parents:
//
//     "okay now i can login but the screen is plain white"
//
//     Can't find variable: BookOpen
//
// MobileNav.jsx listed BookOpen as the Daily Book tab's icon and never
// imported it. It sat there harmlessly because that line only runs for a
// VIEW-ONLY account, and no view-only account existed until that evening.
// The first person to use the feature was the first person to hit it.
//
// WHY THIS GUARD EXISTS SEPARATELY
//
// scripts-check-imports.mjs passed this file. It checks that things being
// CALLED are imported — `foo()` — and an icon is never called: it is
// written as a bare value in a data structure, `{ icon: BookOpen }`, and
// handed to React to render later. A missing one is invisible until the
// branch that renders it is reached, which can be months.
//
// That is the whole class: a component referenced as a VALUE, not a call.
// Every nav list, every column definition, every lookup table works this
// way, so this is worth checking on every file rather than the one that
// bit us.
//
// Run: node scripts-check-icons.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let failed = 0;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx|js)$/.test(name)) out.push(p);
  }
  return out;
}

// Comments have to come out FIRST, everywhere.
//
// [2026-09-16] Found by this guard's own first run: a `//` comment sitting
// INSIDE an import's braces — which is legal, and which this file's fix
// put there — made the import clause unparsable, and the guard reported
// ShieldCheck missing when it was imported on the very next word. A guard
// that cries wolf gets ignored, and an ignored guard is worse than none.
function noComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// What this file has in scope: imports of every shape, plus anything it
// declares or receives itself.
function declaredNames(source) {
  const src = noComments(source);
  const names = new Set();

  // import { A, B as C } from "..."   ·   import D, { E } from "..."
  // ·  import * as F from "..."
  for (const m of src.matchAll(/import\s+([^;]+?)\s+from\s+["'][^"']+["']/g)) {
    const clause = m[1];
    for (const part of clause.split(/,(?![^{]*\})/)) {
      const bit = part.trim();
      if (!bit) continue;
      if (bit.startsWith("{")) {
        for (const spec of bit.replace(/[{}]/g, "").split(",")) {
          const s = spec.trim();
          if (!s) continue;
          // "X as Y" binds Y, not X.
          names.add((s.includes(" as ") ? s.split(/\s+as\s+/)[1] : s).trim());
        }
      } else if (bit.startsWith("*")) {
        names.add(bit.split(/\s+as\s+/)[1]?.trim());
      } else {
        names.add(bit);
      }
    }
  }

  // Anything this file declares, at any depth — components, helpers,
  // destructured values, parameters. Deliberately generous: this guard
  // must never cry wolf, so anything that plausibly binds a capitalised
  // name counts as declared.
  for (const m of src.matchAll(/(?:const|let|var|function|class)\s+([A-Z][A-Za-z0-9_]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const s of m[1].split(",")) {
      const n = s.split(":").pop().split("=")[0].trim();
      if (n) names.add(n);
    }
  }
  for (const m of src.matchAll(/\(\s*\{([^}]*)\}\s*\)\s*=>/g)) {
    for (const s of m[1].split(",")) {
      const n = s.split(":").pop().split("=")[0].trim();
      if (n) names.add(n);
    }
  }
  // function Foo({ Icon, ... })
  for (const m of src.matchAll(/function\s+[A-Za-z0-9_]*\s*\(\s*\{([^}]*)\}/g)) {
    for (const s of m[1].split(",")) {
      const n = s.split(":").pop().split("=")[0].trim();
      if (n) names.add(n);
    }
  }

  return names;
}

// Capitalised names used as a bare VALUE rather than a call or a tag:
//   icon: BookOpen        Icon: Wallet        component: Dashboard
// These are the ones no other check catches, because nothing runs them
// at the point they are written.
function valueRefs(source) {
  const found = new Map();
  const stripped = noComments(source);

  for (const m of stripped.matchAll(/\b(icon|Icon|component|Component|as)\s*:\s*([A-Z][A-Za-z0-9_]*)/g)) {
    if (!found.has(m[2])) found.set(m[2], m[1]);
  }
  return found;
}

// Built-ins and globals that are legitimately never imported.
const GLOBAL = new Set([
  "Math", "Object", "Array", "String", "Number", "Boolean", "Date", "JSON",
  "Promise", "Map", "Set", "Error", "Intl", "React", "RegExp", "Infinity", "NaN",
]);

const files = walk("src");
const problems = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const declared = declaredNames(src);
  for (const [name, where] of valueRefs(src)) {
    if (GLOBAL.has(name)) continue;
    if (declared.has(name)) continue;
    problems.push({ file, name, where });
  }
}

console.log(`\nChecked ${files.length} files for components used as values but never imported.\n`);

if (problems.length === 0) {
  console.log("  ok    every icon/component written as a value is in scope\n");
} else {
  failed = problems.length;
  for (const p of problems) {
    console.log(`  FAIL  ${p.file}`);
    console.log(`          ${p.where}: ${p.name} — used but never imported or declared.`);
    console.log("          This is invisible until the branch that renders it runs.\n");
  }
}

process.exit(failed ? 1 : 0);
