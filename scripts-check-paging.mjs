// [2026-09-09] Guard against the 1,000-row bug ever coming back.
//
// Supabase/PostgREST returns at most 1,000 rows per request, silently. Any
// list fetch in api.js that awaits a query directly — without .single(),
// .maybeSingle(), .limit(), .range(), or fetchAll() — will quietly return a
// partial answer once that table passes 1,000 rows, and every total computed
// from it will be wrong while looking perfectly normal.
//
// Run:  bun scripts-check-paging.mjs      (exits 1 if anything is unbounded)
import { readFileSync } from "fs";

const src = readFileSync("src/api.js", "utf8");
const lines = src.split("\n");
const bad = [];

lines.forEach((ln, i) => {
  if (!/const\s*\{\s*data(\s*:\s*\w+)?\s*(,\s*error\s*)?\}\s*=\s*await/.test(ln)) return;
  // Look back to the start of the statement and forward to its semicolon.
  const back = lines.slice(Math.max(0, i - 20), i + 1).join("\n");
  const fwd = lines.slice(i, Math.min(lines.length, i + 20)).join("\n");
  const stmt = back + "\n" + fwd;
  if (/\.single\(\)|\.maybeSingle\(\)|\.limit\(|\.range\(|\.rpc\(|fetchAll\(/.test(stmt)) return;
  if (/\.insert\(|\.update\(|\.delete\(|\.upsert\(|functions\.invoke\(|auth\./.test(stmt)) return;
  // A lookup pinned to one parent row, or to an explicit id list, can never
  // exceed 1,000 in practice.
  if (/\.eq\("(transaction_id|paper_ticket_no_normalized)"/.test(stmt)) return;
  if (/\.in\(/.test(stmt)) return;
  // `await someFactory()` — follow the factory and accept it if IT is bounded.
  const viaFactory = ln.match(/=\s*await\s+([A-Za-z_$][\w$]*)\(\s*\)/);
  if (viaFactory) {
    const def = src.match(new RegExp(`const\\s+${viaFactory[1]}\\s*=\\s*\\(\\)\\s*=>[\\s\\S]{0,600}?;`));
    if (def && /\.limit\(|\.range\(|\.single\(\)|\.maybeSingle\(\)/.test(def[0])) return;
  }
  bad.push([i + 1, ln.trim()]);
});

if (bad.length) {
  console.error("UNBOUNDED LIST FETCH — will silently stop at 1,000 rows:\n");
  for (const [n, ln] of bad) console.error(`  src/api.js:${n}  ${ln}`);
  console.error("\nWrap it in fetchAll(() => ...), or give it .limit()/.single() if one row is genuinely intended.");
  process.exit(1);
}
console.log("OK — every list fetch in api.js is paged or explicitly bounded.");
