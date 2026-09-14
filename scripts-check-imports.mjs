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

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { dirname, resolve as resolvePath, join as joinPath } from "path";

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

// ---------------------------------------------------------------------
// [2026-09-12] PART 2 — SHARED HELPERS CALLED BUT NEVER IMPORTED.
//
// Part 1 above only looks at capitalised JSX tags. That is why it passed,
// every run, while SEVEN of the eleven report tabs were dead: Sales,
// Purchases, Tax, Stock, Payables, Receivables and Stock Loss all CALLED
// queryRange() / rangeKey() / queryRangeAdj() and none of them imported
// them. `rangeKey(...)` sits inside a useEffect dependency array, which is
// evaluated during render, so each tab threw a ReferenceError before it
// painted a single pixel. No total was wrong — there was no page.
//
// A bare function call is invisible to a JSX-tag check. This part closes
// that: for every helper this codebase exports from its own modules, any
// file that CALLS it must either import it or define it itself.
//
// Deliberately limited to our own exports. Guessing at globals would make
// this noisy and it would get switched off, which is worse than no check.
// ---------------------------------------------------------------------
// Every .js and .jsx under src/, using the same walk as above.
const allSourceFiles = [];
(function walkAll(dir) {
  for (const e of readdirSync(dir)) {
    const q = `${dir}/${e}`;
    if (statSync(q).isDirectory()) walkAll(q);
    else if (/\.jsx?$/.test(e)) allSourceFiles.push(q);
  }
})("src");

const ownExports = new Map(); // helper name -> module that exports it
for (const file of allSourceFiles) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/^export (?:async )?function ([a-z][\w$]*)/gm)) {
    ownExports.set(m[1], file);
  }
}

for (const file of allSourceFiles) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  // What this file already has: anything imported, or declared here.
  const available = new Set();
  // `import Default, { named }` as well as plain `import { named }` — the
  // first form is what produced this check's only false positive.
  for (const m of src.matchAll(/import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) available.add(name);
    }
  }
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([\w$]+)/g)) available.add(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)/g)) available.add(m[1]);

  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;   // a comment is not a call
    for (const [name, from] of ownExports) {
      if (available.has(name)) continue;
      // a real call: the name, then "(", not preceded by a dot or word char
      const re = new RegExp(`(^|[^\\w.$])${name}\\s*\\(`);
      if (re.test(line)) {
        console.log(`  MISSING  ${file}:${i + 1}  ${name}() is called but never imported (it lives in ${from})`);
        problems++;
      }
    }
  });
}


// ---------------------------------------------------------------------------
// Part 3 — a default import must have a default export to bind to.
//
// [2026-09-14] Added after DailyBook.jsx shipped with `import api from
// "../api.js"`. api.js exports `api` as a NAMED export; there is no default.
// Vite says nothing in dev — the value is simply undefined — and the build
// fails on Vercel with "default is not exported by src/api.js". Nothing in
// this repo's checks looked at it, so it reached a deploy. Now it cannot.
// ---------------------------------------------------------------------------
const DEFAULT_IMPORT = /(?:^|\n)\s*import\s+(?!type\b)([\w$]+)\s*(?:,\s*\{[^}]*\})?\s*from\s*["'](\.[^"']+)["']/g;
let badDefaults = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(DEFAULT_IMPORT)) {
    const [, binding, spec] = m;
    // resolve the specifier against the importing file
    const base = resolvePath(dirname(file), spec);
    const candidates = [base, base + ".js", base + ".jsx", joinPath(base, "index.js"), joinPath(base, "index.jsx")];
    const target = candidates.find((c) => existsSync(c) && statSync(c).isFile());
    if (!target) continue;                       // not ours to judge
    const dst = readFileSync(target, "utf8");
    const hasDefault = /(?:^|\n)\s*export\s+default\b/.test(dst);
    if (!hasDefault) {
      const named = [...dst.matchAll(/(?:^|\n)\s*export\s+(?:const|let|var|function|class|async\s+function)\s+([\w$]+)/g)].map((x) => x[1]);
      const hint = named.includes(binding)
        ? `  — it is a NAMED export, so write:  import { ${binding} } from "${spec}"`
        : named.length ? `  — that file exports: ${named.slice(0, 6).join(", ")}` : "";
      const lineNo = src.slice(0, m.index).split("\n").length;
      console.log(`  NO DEFAULT  ${file}:${lineNo}  imports \`${binding}\` as a default from ${spec}, which has no default export${hint}`);
      badDefaults++;
      problems++;
    }
  }
}
if (badDefaults === 0) console.log("Every default import binds to a real default export.");

console.log(problems === 0
  ? `\nChecked ${files.length} screens and every shared helper call — nothing is used without being imported.\n`
  : `\n${problems} missing import(s).\n`);
process.exit(problems === 0 ? 0 : 1);
