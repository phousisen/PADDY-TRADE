// Does every JSX element in every page close, and close in the right order?
//
// [2026-09-14] Written after a layout fix moved the Daily Book's root from a
// bare <main> into a `h-screen … flex-col` shell — the kind of edit that adds
// one opening tag at the top and one closing tag 150 lines later, where a
// miscount is invisible by eye and only shows up as a failed Vercel build
// several minutes after the upload.
//
// There is no bundler or parser in this environment (the npm registry is
// blocked), so this is a hand-written scanner rather than a real parse. It is
// deliberately narrow: it finds element tags and balances them, and knows
// enough about strings, comments, braces and self-closing tags not to be
// fooled by them. It does NOT type-check, resolve imports (that is
// scripts-check-imports.mjs) or understand anything about React.
//
// Run: node scripts-check-jsx.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// HTML void elements never carry a closing tag even without a trailing slash.
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "area",
  "base", "col", "embed", "source", "track", "wbr"]);

// A quote character is only a STRING opener in JavaScript context. In JSX text
// an apostrophe is just an apostrophe — "doesn't", "the day's total" — and
// skipping to the next one swallows whatever closing tags lie between, which
// is what made the first version of this file report 64 phantom failures in
// code that builds perfectly well.
//
// The tell is the character in front of it: a string opener follows an
// OPERATOR or an opening bracket, or a keyword (`return "x"`). Anything else —
// a letter, a hyphen, an em dash, a Khmer character — is punctuation sitting
// in text. Listing what DOES open a string is the safe direction here: these
// pages are full of quotes, apostrophes and non-Latin script.
//
// Returns the index to continue from: past the string if it was one, one
// character on if it was not.
function skipQuote(src, i) {
  const before = src.slice(0, i).trimEnd();
  const prev = before.slice(-1);
  const isOpener =
    prev === "" ||
    "=(,:[{;?&|+-*/!<>%^~".includes(prev) ||
    /\b(return|typeof|case|await|yield|new|delete|void|in|of|do|else|instanceof)$/.test(before);
  return isOpener ? skipString(src, i) : i + 1;
}

// Past a string that is known to start at i. Template literals hold `${…}`
// holes, and a hole can hold ANOTHER template literal — this page has one:
//   title={`${t.truck} truck${t.otherVeh ? ` · ${t.otherVeh} other` : ""}`}
// A scanner that just runs to the next backtick stops at the INNER one, ends
// the string in the middle, and mis-reads everything after it. So a hole is
// stepped over by brace matching, which steps over its own strings in turn.
function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === q) return j + 1;
    if (q === "`" && c === "$" && src[j + 1] === "{") { j = skipBraces(src, j + 1); continue; }
    j++;
  }
  return j;
}

// Past the `}` matching the `{` at i.
function skipBraces(src, i) {
  let depth = 0, j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") { j = skipQuote(src, j); continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
    j++;
  }
  return j;
}

function jsxFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsxFiles(p, out);
    else if (p.endsWith(".jsx")) out.push(p);
  }
  return out;
}

// Walk the source once. Inside a tag we track quotes and brace depth, so an
// attribute like className={`a ${x > 1 ? "b" : "c"}`} cannot end the tag early.
function scanTags(src) {
  const tags = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];

    // comments and strings OUTSIDE a tag — skip wholesale
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2); i = i < 0 ? n : i + 2; continue; }
    // A quote character is only a STRING opener in JavaScript context. In JSX
    // text an apostrophe is just an apostrophe — "doesn't", "the day's total"
    // — and skipping to the next one swallows whatever closing tags lie
    // between, which is what made the first version of this file report 64
    // phantom failures in code that builds perfectly well.
    //
    // The tell is the character before it: a JS string opener follows an
    // operator or a bracket, never a letter or a digit.
    if (c === '"' || c === "'" || c === "`") { i = skipQuote(src, i); continue; }

    if (c !== "<") { i++; continue; }

    // <name …>, </name>, or <> / </>  — anything else is a comparison operator
    let j = i + 1;
    const closing = src[j] === "/";
    if (closing) j++;
    const start = j;
    while (j < n && /[A-Za-z0-9_.$]/.test(src[j])) j++;
    const name = src.slice(start, j);
    if (!name) {
      // fragment <> or </> only; a bare "<" elsewhere is arithmetic
      if (src[j] === ">") { tags.push({ name: "<>", closing, self: false, at: i }); i = j + 1; continue; }
      i++; continue;
    }
    if (!/^[A-Za-z]/.test(name)) { i++; continue; }

    // walk to this tag's own ">"
    let depth = 0, self = false;
    while (j < n) {
      const d = src[j];
      if (d === '"' || d === "'" || d === "`") {
        // Same rule as outside a tag, and it matters MORE here: an attribute
        // can hold JSX of its own — subtitle={<>…this doesn't move it…</>} —
        // and treating that apostrophe as a string opener eats the braces
        // that close the attribute, so the tag never ends and the rest of the
        // component is swallowed with it.
        j = skipQuote(src, j); continue;
      }
      if (d === "{") { depth++; j++; continue; }
      if (d === "}") { depth--; j++; continue; }
      if (depth === 0 && d === ">") { self = src[j - 1] === "/"; break; }
      j++;
    }
    if (j >= n) break;
    tags.push({ name, closing, self: self || VOID.has(name), at: i });
    i = j + 1;
  }
  return tags;
}

const lineOf = (src, at) => src.slice(0, at).split("\n").length;

let failures = 0;
let files = 0, total = 0;

for (const file of jsxFiles("src")) {
  const src = readFileSync(file, "utf8");
  const tags = scanTags(src);
  const stack = [];
  files++; total += tags.length;

  for (const tg of tags) {
    if (tg.self) continue;
    if (!tg.closing) { stack.push(tg); continue; }
    const open = stack.pop();
    if (!open) {
      failures++;
      console.log(`  FAIL ${file}:${lineOf(src, tg.at)} — </${tg.name}> closes nothing`);
    } else if (open.name !== tg.name) {
      failures++;
      console.log(`  FAIL ${file}:${lineOf(src, tg.at)} — </${tg.name}> closes <${open.name}> opened at line ${lineOf(src, open.at)}`);
    }
  }
  for (const open of stack) {
    failures++;
    console.log(`  FAIL ${file}:${lineOf(src, open.at)} — <${open.name}> is never closed`);
  }
}

console.log(failures === 0
  ? `Every JSX element closes in order — ${total.toLocaleString("en-US")} tags across ${files} files.`
  : `\n${failures} UNBALANCED TAG(S)`);
process.exit(failures === 0 ? 0 : 1);
