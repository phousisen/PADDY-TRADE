// [2026-09-10] Catches the crash-on-open mistake: a component or icon used
// in JSX that was never imported.
//
// Run:  bun scripts-check-imports.mjs
//
// WHY THIS EXISTS
//
// `npm install` is blocked in the environment these changes are written in
// (403 on @supabase/supabase-js), so the app cannot be built or run here
// before delivery. Every change is read, parsed and unit-tested where the
// logic allows — but "I forgot to import the icon I just used" is invisible
// to all of that and takes the whole screen down with a white page. This
// walks every JSX file and checks that each capitalised tag is either
// imported or declared in that same file.
//
// It is a guard, not a build. It cannot tell you the app works.

import { readdirSync, statSync, readFileSync } from "fs";

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = `${dir}/${e}`;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.jsx$/.test(e)) files.push(p);
  }
})("src");

// Tags that are React's own or plain HTML written capitalised by mistake
// would be caught anyway; these are the genuine built-ins to allow.
const ALLOWED = new Set(["Fragment", "React", "Suspense", "StrictMode"]);

let problems = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");

  const declared = new Set(ALLOWED);

  // import X, {A, B as C} from "..."   /   import * as N from "..."
  for (const m of src.matchAll(/import\s+([^;]+?)\s+from\s+["'][^"']+["']/g)) {
    const clause = m[1];
    const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (star) declared.add(star[1]);
    const def = clause.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (def) declared.add(def[1]);
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const name = part.split(/\s+as\s+/).pop().trim();
        if (name) declared.add(name);
      }
    }
  }

  // anything declared in the file itself, at any depth
  for (const m of src.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  // destructured: const { A, B } = ...
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(":").pop().split("=")[0].trim();
      if (name) declared.add(name);
    }
  }

  // every capitalised JSX tag actually used
  const used = new Map(); // name -> first line
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/<([A-Z][\w$]*)/g)) {
      if (!used.has(m[1])) used.set(m[1], i + 1);
    }
  });

  for (const [name, line] of used) {
    if (!declared.has(name)) {
      console.log(`  MISSING  ${file}:${line}  <${name}> is used but never imported or declared`);
      problems++;
    }
  }
}

console.log(problems === 0
  ? `\nChecked ${files.length} screens — every component and icon used in JSX is imported.\n`
  : `\n${problems} missing import(s).\n`);
process.exit(problems === 0 ? 0 : 1);
