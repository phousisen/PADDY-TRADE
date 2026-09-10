// [2026-09-10] Fixtures for api.js's fetchAll paging.
//
// Run:  bun scripts-check-fetchall.mjs
//
// The failure this guards against is the expensive one: a row that silently
// never arrives because something was inserted while the walk was in
// progress. That is what an OFFSET walk does, and it looks exactly like a
// lost ticket. These fixtures insert rows DURING every page.
//
// fetchAll is re-implemented here against a fake query builder rather than
// imported, because api.js pulls in the Supabase client and a browser
// environment. The two must stay identical — if you change the paging in
// api.js, change it here and re-run.

const PAGE_SIZE = 1000;
const HARD_ROW_CAP = 500000;

async function fetchAll(makeQuery, { keyColumn = "id", sort = null } = {}) {
  const rows = [];
  let after = null;
  for (;;) {
    let q = makeQuery().order(keyColumn, { ascending: true }).limit(PAGE_SIZE);
    if (after !== null) q = q.gt(keyColumn, after);
    const { data, error } = await q;
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    after = page[page.length - 1][keyColumn];
    if (after === undefined || after === null) throw new Error("missing key column");
    if (rows.length >= HARD_ROW_CAP) throw new Error("row cap");
  }
  if (rows.length > 1 && rows[0] && rows[0][keyColumn] !== undefined) {
    const seen = new Set(); const unique = []; let dupes = 0;
    for (const r of rows) {
      if (seen.has(r[keyColumn])) { dupes++; continue; }
      seen.add(r[keyColumn]); unique.push(r);
    }
    if (dupes > 0) return sort ? unique.sort(sort) : unique;
  }
  return sort ? rows.sort(sort) : rows;
}

// A table that behaves like PostgREST: caps every response at PAGE_SIZE,
// supports .order/.limit/.gt, and lets the test insert rows between pages.
function makeTable(initial, { onPage = null } = {}) {
  const store = [...initial];
  let pages = 0;
  const api = {
    rows: store,
    pages: () => pages,
    insert(row) { store.push(row); },
    query() {
      const state = { key: "id", asc: true, limit: PAGE_SIZE, gt: null };
      const q = {
        order(k, o) { state.key = k; state.asc = o?.ascending !== false; return q; },
        limit(n) { state.limit = Math.min(n, PAGE_SIZE); return q; },
        gt(k, v) { state.gt = { k, v }; return q; },
        then(resolve) {
          pages++;
          if (onPage) onPage(api, pages);
          let out = [...store];
          if (state.gt) out = out.filter((r) => r[state.gt.k] > state.gt.v);
          out.sort((a, b) => (a[state.key] < b[state.key] ? -1 : a[state.key] > b[state.key] ? 1 : 0));
          if (!state.asc) out.reverse();
          resolve({ data: out.slice(0, state.limit), error: null });
        },
      };
      return q;
    },
  };
  return api;
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  ok    ${name}`); return; }
  failures++; console.log(`  FAIL  ${name}${extra !== undefined ? `  → ${extra}` : ""}`);
}
const pad = (n) => String(n).padStart(9, "0");

console.log("\n1. Small table — one round trip, same as before paging existed");
{
  const t = makeTable(Array.from({ length: 250 }, (_, i) => ({ id: pad(i) })));
  const rows = await fetchAll(() => t.query());
  check("250 rows returned", rows.length === 250, rows.length);
  check("exactly 1 request", t.pages() === 1, t.pages());
}

console.log("\n2. Three pages, nothing changing underneath");
{
  const t = makeTable(Array.from({ length: 2787 }, (_, i) => ({ id: pad(i) })));
  const rows = await fetchAll(() => t.query());
  check("all 2,787 rows", rows.length === 2787, rows.length);
  check("no duplicates", new Set(rows.map((r) => r.id)).size === 2787);
  check("3 requests", t.pages() === 3, t.pages());
}

console.log("\n3. THE ONE THAT MATTERS — rows inserted during every page");
{
  // ids are random, like the app's uuids, so an insert lands anywhere in the
  // ordering — including behind the cursor, which is what breaks OFFSET.
  const rand = () => pad(Math.floor(Math.random() * 900000000));
  const initial = Array.from({ length: 2500 }, () => ({ id: rand(), original: true }));
  const t = makeTable(initial, {
    onPage: (tbl) => { for (let i = 0; i < 5; i++) tbl.insert({ id: rand(), inserted: true }); },
  });
  const before = new Set(initial.map((r) => r.id));
  const rows = await fetchAll(() => t.query());
  const got = new Set(rows.map((r) => r.id));
  const missing = [...before].filter((id) => !got.has(id));
  check("no original row lost", missing.length === 0, `${missing.length} missing`);
  check("no duplicates", got.size === rows.length, `${rows.length - got.size} duplicated`);
}

console.log("\n4. Same again, heavier: an insert storm on a bigger table");
{
  const rand = () => pad(Math.floor(Math.random() * 900000000));
  const initial = Array.from({ length: 6000 }, () => ({ id: rand(), original: true }));
  const t = makeTable(initial, {
    onPage: (tbl) => { for (let i = 0; i < 40; i++) tbl.insert({ id: rand() }); },
  });
  const before = new Set(initial.map((r) => r.id));
  const rows = await fetchAll(() => t.query());
  const got = new Set(rows.map((r) => r.id));
  check("no original row lost", [...before].every((id) => got.has(id)));
  check("no duplicates", got.size === rows.length);
}

console.log("\n5. An exact multiple of the page size still terminates");
{
  const t = makeTable(Array.from({ length: 2000 }, (_, i) => ({ id: pad(i) })));
  const rows = await fetchAll(() => t.query());
  check("2,000 rows", rows.length === 2000, rows.length);
  check("3 requests (the last one empty)", t.pages() === 3, t.pages());
}

console.log("\n6. Display order is applied after the walk, not during it");
{
  const t = makeTable([
    { id: "a", created_at: "2026-09-01" },
    { id: "b", created_at: "2026-09-03" },
    { id: "c", created_at: "2026-09-02" },
  ]);
  const desc = (f) => (x, y) => (x[f] < y[f] ? 1 : x[f] > y[f] ? -1 : 0);
  const rows = await fetchAll(() => t.query(), { sort: desc("created_at") });
  check("newest first", rows.map((r) => r.id).join("") === "bca", rows.map((r) => r.id).join(""));
}

console.log("\n7. An empty table is not an error");
{
  const t = makeTable([]);
  const rows = await fetchAll(() => t.query());
  check("no rows, no throw", rows.length === 0);
  check("1 request", t.pages() === 1);
}

console.log(failures === 0 ? "\nAll paging fixtures passed.\n" : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
