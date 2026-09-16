// A name declared twice in the same scope is a build failure, not a bug you
// find at runtime.
//
// Run:  node scripts-check-shadow.mjs
//
// WHY THIS EXISTS
//
// [2026-09-15] Translating the Daily Book meant renaming a prop called `t`
// (the row's totals) so the translator could be called `t` like everywhere
// else. I renamed it to `tot` — which was already a local in that same
// function:
//
//     function LedgerRow({ label, sub, tot, variant, ... }) {
//       const tot = variant === "total";       // ← already taken
//
// Vercel refused the build. Nothing shipped that day, and the screens SISEN
// was looking at stayed on old code while we both assumed they were new —
// which sent us chasing a caching problem that did not exist.
//
// [2026-09-16] The first version of this file checked exactly that one
// shape: a destructured PARAMETER re-declared in its own body. Asked to
// prove nothing in today's work could break the build, I tested it against
// the other half of the same mistake —
//
//       const tot = variant === "total";
//       const tot = 1;                         // ← two consts, one scope
//
// — and it sailed through. So did a JSX-stripping parse check I wrote to
// cover the gap: that one failed on JSX text long before it reached the
// duplicate, and reported "ok". A green light that does not mean anything
// is worse than no light at all.
//
// This is now a real scope walker. It tracks brace depth, seeds each
// function body with its own parameter names, and fails on ANY name declared
// twice where JavaScript would refuse it. There is no JSX parser in this
// sandbox (npm is blocked and esbuild's install is refused), so it works on
// the text — but it works on ALL of the text, which is the part that
// matters.

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

const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "function", "typeof",
  "new", "await", "yield", "in", "of", "do", "else", "try", "case", "default",
]);

// A `/` starts a regex literal only where a value is expected. Without this,
// the {4} in /^\d{4}-\d{2}-\d{2}T/ reads as a scope and every declaration
// after it lands in the wrong one — which is exactly how the first run of
// this rewrite blamed a perfectly good line in DataCheck.jsx.
const BEFORE_REGEX = new Set("=(,:[!&|?{};+-*%<>~^".split(""));
const BEFORE_REGEX_WORDS = new Set(["return", "typeof", "case", "in", "of", "do", "else", "yield", "await", "new", "delete", "void"]);
function isRegexStart(src, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k -= 1;
  if (k < 0) return true;
  if (BEFORE_REGEX.has(src[k])) return true;
  if (/[\w$]/.test(src[k])) {
    let w = k;
    while (w >= 0 && /[\w$]/.test(src[w])) w -= 1;
    return BEFORE_REGEX_WORDS.has(src.slice(w + 1, k + 1));
  }
  return false;
}

/**
 * Blank out comments and the insides of strings and template literals, so a
 * brace in a message can never be mistaken for a scope. Replaces with spaces
 * rather than deleting, so every character keeps its position and a reported
 * line number is the real one.
 */
function blankOutText(src) {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      let j = i; while (j < n && src[j] !== "\n") j += 1;
      blank(i, j); i = j; continue;
    }
    if (c === "/" && c2 === "*") {
      let j = i + 2; while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
      blank(i, Math.min(j + 2, n)); i = j + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j += 1; j += 1; }
      blank(i, Math.min(j + 1, n)); i = j + 1; continue;
    }
    if (c === "/" && isRegexStart(src, i)) {
      let j = i + 1, inClass = false;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        else if (src[j] === "\n") break;           // not a regex after all
        j += 1;
      }
      if (j < n && src[j] === "/") { blank(i, j + 1); i = j + 1; continue; }
    }
    if (c === "`") {
      // A template literal's ${...} holds real code with real braces, so only
      // the literal text between the holes is blanked.
      let j = i + 1;
      blank(i, i + 1);
      while (j < n && src[j] !== "`") {
        if (src[j] === "\\") { blank(j, j + 2); j += 2; continue; }
        if (src[j] === "$" && src[j + 1] === "{") {
          let depth = 1; j += 2;
          while (j < n && depth > 0) {
            if (src[j] === "{") depth += 1;
            else if (src[j] === "}") depth -= 1;
            else if (src[j] === "`") {
              // A nested template. Skip it whole; nesting deeper than this
              // does not occur in this codebase.
              j += 1;
              while (j < n && src[j] !== "`") { if (src[j] === "\\") j += 1; j += 1; }
            }
            j += 1;
          }
          continue;
        }
        blank(j, j + 1); j += 1;
      }
      blank(j, j + 1); i = j + 1; continue;
    }
    i += 1;
  }
  return out.join("");
}

/** The identifiers bound by a destructuring pattern or a parameter list. */
function namesIn(text) {
  const names = [];
  // Drop default values and nested keys: {a: b = 1, ...rest} binds b and rest.
  const cleaned = text
    .replace(/=\s*(?:\{[^{}]*\}|\[[^\][]*\]|[^,]*)/g, "")
    .replace(/\.\.\./g, "");
  for (const m of cleaned.matchAll(/([A-Za-z_$][\w$]*)\s*(:)?/g)) {
    if (m[2]) continue;               // `a:` is the key, not the binding
    if (KEYWORDS.has(m[1])) continue;
    names.push(m[1]);
  }
  // `{ a: b }` binds b — pick those up separately.
  for (const m of cleaned.matchAll(/[A-Za-z_$][\w$]*\s*:\s*([A-Za-z_$][\w$]*)/g)) {
    if (!KEYWORDS.has(m[1])) names.push(m[1]);
  }
  return [...new Set(names)];
}

/** Read the balanced group starting at `open`; returns [inner, indexAfter]. */
function readGroup(src, open) {
  const close = src[open] === "(" ? ")" : src[open] === "[" ? "]" : "}";
  let depth = 0, i = open;
  for (; i < src.length; i += 1) {
    if (src[i] === src[open]) depth += 1;
    else if (src[i] === close) { depth -= 1; if (depth === 0) break; }
  }
  return [src.slice(open + 1, i), i + 1];
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// A `for (const x of y)` declares x in the LOOP's own scope, not the
// enclosing one — so control clauses are skipped whole rather than walked,
// or two loops in one function would look like a redeclaration.
const CONTROL = new Set(["if", "while", "for", "switch"]);

function wordBefore(src, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k -= 1;
  if (k < 0 || !/[\w$]/.test(src[k])) return "";
  let w = k;
  while (w >= 0 && /[\w$]/.test(src[w])) w -= 1;
  return src.slice(w + 1, k + 1);
}

function duplicatesIn(file) {
  const raw = fs.readFileSync(file, "utf8");
  const src = blankOutText(raw);
  const problems = [];

  // Each scope is a Map of name -> line where it was declared.
  const stack = [new Map()];
  // Params waiting for the `{` of the body they belong to.
  let pending = null;

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === "{") {
      const scope = new Map();
      if (pending) { for (const n of pending) scope.set(n, -1); pending = null; }
      stack.push(scope);
      i += 1; continue;
    }
    if (c === "}") {
      if (stack.length > 1) stack.pop();
      pending = null;
      i += 1; continue;
    }

    // A parameter list: `(...)` followed by `{` or `=>`.
    //
    // The first version of this walker skipped EVERY parenthesised group it
    // met, which quietly swallowed the whole of useEffect(() => { ... }) —
    // so nothing declared inside any callback was ever checked, while the
    // run still printed "ok". Now a group is skipped only when it really is
    // a parameter list or a control clause; anything else is walked into.
    if (c === "(") {
      const prev = wordBefore(src, i);
      const [inner, after] = readGroup(src, i);
      const rest = src.slice(after, after + 8);
      if (CONTROL.has(prev)) { i = after; continue; }   // if/while/for/switch
      // Only a BLOCK body has a scope to seed. A concise arrow — (tx) =>
      // tx.hq_status !== "cancelled" — has none, and letting its parameter
      // drift onto the next block it happens to meet is how this walker
      // first accused a perfectly good `let tx` in Transactions.jsx.
      if (/^\s*=>\s*\{/.test(rest) || /^\s*\{/.test(rest) || prev === "catch") {
        pending = namesIn(inner);
        i = after; continue;
      }
      i += 1; continue;
    }

    // A declaration.
    const kw = /^(const|let)\s/.exec(src.slice(i, i + 7));
    const before = i === 0 ? " " : src[i - 1];
    if (kw && !/[\w$.]/.test(before)) {
      let j = i + kw[1].length;
      while (j < src.length && /\s/.test(src[j])) j += 1;
      let declared = [];
      if (src[j] === "{" || src[j] === "[") {
        const [inner, after] = readGroup(src, j);
        declared = namesIn(inner);
        j = after;
      } else {
        const m = /^([A-Za-z_$][\w$]*)/.exec(src.slice(j));
        if (m) { declared = [m[1]]; j += m[1].length; }
      }
      const line = lineOf(raw, i);
      const scope = stack[stack.length - 1];
      for (const n of declared) {
        if (scope.has(n)) {
          const was = scope.get(n);
          problems.push(
            `${file}:${line}  "${n}" is already declared in this scope` +
            (was > 0 ? ` (line ${was})` : " — it is a parameter of this function")
          );
        } else scope.set(n, line);
      }
      i = j; continue;
    }

    // Parameters belong to the block that comes RIGHT AFTER the list. If
    // anything else intervenes, they were not a function head after all.
    if (pending && !/[\s=>]/.test(c)) pending = null;
    i += 1;
  }
  return problems;
}

let failures = 0;
const checked = files("src");
for (const file of checked) {
  for (const p of duplicatesIn(file)) { console.error(`FAIL  ${p}`); failures += 1; }
}

if (failures) {
  console.error(`\n${failures} duplicate declaration(s) — Vercel would refuse this build.`);
  process.exit(1);
}
console.log(`No name is declared twice in one scope — ${checked.length} files.`);
