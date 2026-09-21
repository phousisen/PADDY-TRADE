import { supabase, getAccurateNow } from "./supabaseClient.js";
import { isViewOnlyMode, ViewOnlyError } from "./viewOnlyGuard.js";
// [2026-09-10] One definition of "the same paddy type", shared with the
// database's product_key(). See src/productName.js.
import { cleanProductName, findProductByName } from "./productName.js";

// [2026-09-04] THAPEDEY had two different transactions both showing paper
// ticket number "TD 000678" — even though add_paper_ticket_no_unique_
// constraint.sql (2026-09-03) already made this "impossible" after the
// PONG RO / PR000127 incident. Root cause: every duplicate check in the
// app — this one included, before this fix — only trims the ends of what
// staff typed and lowercases it, exactly matching the database rule's own
// lower(trim(...)) comparison. Neither one collapses extra SPACES TYPED IN
// THE MIDDLE. A browser always visually collapses "TD 000678" and
// "TD  000678" (two spaces) down to looking identical, so a number typed
// with one extra/missing space in the middle sails straight past both the
// on-screen warning and the database rule, which see them as two
// completely different pieces of text.
//
// Fix: every place that saves a paper ticket number now runs it through
// this first, so the exact same "TD 000678" (however many spaces were
// actually typed) always ends up stored as the exact same characters —
// closing the gap at its source instead of trying to special-case every
// comparison that reads it back. Squeezes to a single space rather than
// removing spaces entirely, so a genuinely-typed "TD 000678" still reads
// the same way on screen and on the printed receipt — this only removes
// the invisible, accidental duplication of a space, not a real one.
export function normalizePaperTicketNo(raw) {
  const squeezed = (raw || "").trim().replace(/\s+/g, " ");
  return squeezed || null;
}

// Widened from a 4-digit (1000-9999, ~9,000 possible values) space to
// 6-digit (~900,000) — the 4-digit space was small enough that, across two
// stations' worth of tickets over time, random collisions had become a
// real, recurring occurrence rather than a theoretical one (see
// insertWithFreshCodeOnCollision above for how a collision is now also
// recovered from automatically, rather than getting permanently stuck).
// [2026-09-12] Nine digits, not six — and the reason is arithmetic, not
// taste.
//
// The old space was 100000-999998: 899,999 possible codes, for every
// transaction the business will ever record. That is the birthday problem
// with a very small room. The chance that a NEW code collides with one
// already stored is simply rows / 899,999:
//
//     today      ~3,000 rows    0.3%   (already happening)
//     year 5   ~185,000 rows     21%
//     year 10  ~368,000 rows     41%
//
// At year 10 that is two saves in five needing an extra round trip to the
// server, inside the Finish Ticket timeout, on a weighbridge's weak
// connection — and insertWithFreshCodeOnCollision only retries five
// times, so about one save in 200 would fail outright in front of a
// farmer. It also silently rewrites the code AFTER the receipt has
// printed, so the paper and the system disagree.
//
// One billion codes takes year 10 from 41% to 0.04% — roughly a dozen
// retries a year across the whole business, and no hard failures. Three
// more digits on a receipt is a cheap price. crypto is used rather than
// Math.random because it is uniform and available in every browser this
// runs on; the old expression also never produced 999999, which is the
// kind of small wrongness that hides bigger ones.
const CODE_SPACE = 1_000_000_000; // 9 digits
function randomCodeNumber() {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return String(buf[0] % CODE_SPACE).padStart(9, "0");
  } catch {
    return String(Math.floor(Math.random() * CODE_SPACE)).padStart(9, "0");
  }
}

function genCode(type) {
  const n = randomCodeNumber();
  return type === "BUY" ? `RCP-${n}-A` : `INV-${n}-B`;
}

// [2026-09-11] The only quality values the transactions table accepts —
// CHECK (quality_grade = ANY (ARRAY['A','B','C'])), blank allowed. See
// buildTransactionRow for the incident: one screen offered 1/2/3, so the
// first ticket ever given a quality took the whole sale down with it.
// Applied at every write that touches this column, so a value that
// cannot be stored is dropped rather than blocking the trade.
const QUALITY_GRADES = ["A", "B", "C"];
function normalizeQualityGrade(value) {
  const v = String(value ?? "").trim().toUpperCase();
  return QUALITY_GRADES.includes(v) ? v : null;
}

function genTicketCode() {
  return `TKT-${randomCodeNumber()}`;
}

// Used when a row is created with a client-supplied id (offline queue —
// see offlineQueue.js). Normally that's a plain insert. But if the same
// save gets retried (e.g. it actually landed on the server, but the
// confirmation never reached the device before it lost connection), a
// second insert with the same id would fail with a duplicate-key error.
// Rather than needing a separate "update" permission for that retry, we
// just recognize that specific error and fetch the row that's already
// there instead — the retry ends up a no-op, and nothing new is written.
async function insertOrFetchExisting(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select();
  if (!error) {
    // The new row normally comes straight back. On the rare device/account
    // where it comes back empty instead (RLS can hide a row from being
    // read back immediately after a write, even though the write itself
    // succeeded), don't treat that as a failure — the offline sync queue
    // stops and retries forever on any error here, so wrongly throwing
    // would permanently jam every change queued behind this one.
    return (data && data[0]) || row;
  }
  if (row.id && error.code === "23505") {
    const { data: existing, error: fetchErr } = await supabase.from(table).select("*").eq("id", row.id);
    if (!fetchErr && existing && existing.length) return existing[0];
  }
  throw error;
}

// weighing_tickets and transactions both give each row a short, friendly
// on-screen code (TKT-####, RCP-####-A, INV-####-B) picked at random on
// the device, with no way to check it against the rest of the database
// before saving. With few enough rows on file that's fine — but with
// enough tickets/transactions accumulated across both stations over time,
// two of them landing on the exact same random code was only a matter of
// when, not if (this is the actual cause of the "stuck, not syncing"
// tickets seen Aug 2026 — the offline queue retries a failed save with
// the EXACT SAME payload every time, so once a code collides, retrying
// with that same colliding code can never succeed on its own). This
// recognizes specifically that situation and tries again with a freshly
// generated code instead of giving up — a handful of attempts is enough
// that colliding twice in a row is astronomically unlikely.
async function insertWithFreshCodeOnCollision(table, row, regenerateCode) {
  try {
    return await insertOrFetchExisting(table, row);
  } catch (error) {
    if (error?.code !== "23505" || !/code/i.test(String(error?.message || ""))) throw error;
    let lastError = error;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await insertOrFetchExisting(table, { ...row, code: regenerateCode() });
      } catch (retryError) {
        lastError = retryError;
        if (retryError?.code === "23505" && /code/i.test(String(retryError?.message || ""))) continue;
        throw retryError;
      }
    }
    throw lastError;
  }
}

// [2026-09-03] Turns the raw Postgres error from
// add_paper_ticket_no_unique_constraint.sql's unique index into something
// a station can actually read and act on, instead of the default
// "duplicate key value violates unique constraint ..." text — which, for
// this one specifically, is exactly what a station would otherwise see
// sitting in the "stuck" sync banner (Topbar.jsx) with no idea what it
// means. Matched by index name rather than just error.code === "23505" so
// this never misfires on some other constraint's collision (like the
// `code`-collision retry above, which is checked and handled first
// anyway) — returns null for anything else so the caller just re-throws
// the original error unchanged.
function friendlyPaperTicketNoError(error, paperTicketNo) {
  // [2026-09-04] The unique index this used to translate an error for
  // (add_paper_ticket_no_unique_constraint.sql) was removed — see
  // allow_paper_ticket_no_duplicates_with_alert.sql and
  // checkAndFlagPaperTicketDuplicate below. Left in place as a harmless
  // fallback (it simply never matches anymore) rather than ripped out,
  // in case any environment still has an older version of that index.
  if (error?.code === "23505" && /paper_ticket_no_per_location/.test(String(error?.message || ""))) {
    const trimmed = (paperTicketNo || "").trim();
    return new Error(
      `Paper ticket No.${trimmed ? ` "${trimmed}"` : ""} is already recorded for this station — it can't be used twice. Check the number on the paper slip.`
    );
  }
  return null;
}

// [2026-09-04] Replaces the hard block above. A reused paper ticket number
// is no longer rejected — SISEN's call, after PONG RO's "PR000209" got
// stuck in the sync queue over a number that turned out to not clearly be
// a real duplicate. Instead, every save now checks first (against the
// generated `paper_ticket_no_normalized` column — see
// allow_paper_ticket_no_duplicates_with_alert.sql — which is normalized
// the exact same way normalizePaperTicketNo above stores it), and if the
// number is already on file for this station, flags BOTH the new row and
// whatever existing row(s) it matches (paper_ticket_dup_flag = true) —
// that's what lights up the small warning badge in the Tickets/
// Transactions list for an admin to look into. The save itself always
// still goes through; this only ever adds a flag, never blocks anything.
async function checkAndFlagPaperTicketDuplicate(table, locationId, paperTicketNo, excludeId) {
  const normalized = normalizePaperTicketNo(paperTicketNo);
  if (!normalized || !locationId) return false;
  let query = supabase
    .from(table)
    .select("id")
    .eq("location_id", locationId)
    .eq("paper_ticket_no_normalized", normalized);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) {
    // A failed CHECK should never hold up the actual save — worst case
    // here is a missed badge, not a stuck ticket (which is the exact
    // problem this whole change exists to get away from).
    console.warn("paper ticket duplicate check failed:", error);
    return false;
  }
  const matches = data || [];
  if (matches.length === 0) return false;
  const ids = matches.map((m) => m.id);
  const { error: flagError } = await supabase.from(table).update({ paper_ticket_dup_flag: true }).in("id", ids);
  if (flagError) console.warn("failed to flag existing paper ticket duplicate:", flagError);
  return true;
}

// The database server's clock defaults to UTC, not Cambodia time — so we
// stamp every transaction with Cambodia's actual wall-clock date/time here
// instead of relying on a DB-side default, regardless of what timezone the
// user's own device happens to be set to. Uses getAccurateNow() (see
// supabaseClient.js), not the device's raw clock directly — a station PC's
// own clock can simply be set wrong, which no amount of timezone math can
// fix on its own; getAccurateNow() corrects for that using Supabase's own
// server time.
function cambodiaNow() {
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  })
    .formatToParts(getAccurateNow())
    .forEach((p) => { parts[p.type] = p.value; });
  const hour = parts.hour === "24" ? "00" : parts.hour; // midnight edge case in some Intl implementations
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}:${parts.second}`,
  };
}

// Supabase's functions.invoke() gives a generic "non-2xx status" message on
// error by default — this pulls out the actual reason our admin-users Edge
// Function sent back (e.g. "Only the Owner account can do this."), if any.
// [2026-09-19] "Cannot coerce the result to a single JSON object" is what
// the database says when an update matched no row — a record that is gone,
// or one this account is not allowed to change. That raw text reached the
// screen. It is replaced here with what it means.
function friendlyWriteError(error) {
  if (error?.code === "PGRST116") {
    const e = new Error("Nothing was changed: this record was not found, or this account is not allowed to change it. Refresh and try again; if it keeps happening, ask the Owner.");
    e.code = "PGRST116";
    return e;
  }
  return error;
}

// [2026-09-19] Puts a new account's role, station and view-only flag onto
// the profile row the signup trigger creates.
//
// It used to wait a fixed 0.7 s and update once. If the trigger had not
// finished, or the row could not be seen, the update matched nothing, raised
// no error, and the screen said "Account created" — for an account with no
// role and no station. Now it retries for a few seconds, checks that a row
// was really changed, keeps the older admin/staff column in step with the
// role (as the Users page does), and says plainly if it could not.
async function applyNewAccountProfile(userId, patch) {
  const full = { ...patch };
  if (patch.role_id) {
    const { data: r } = await supabase.from("roles").select("scope").eq("id", patch.role_id).maybeSingle();
    if (r?.scope) full.role = r.scope === "all" ? "admin" : "staff";
  }
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((res) => setTimeout(res, attempt === 0 ? 700 : 750));
    const { data, error } = await supabase.from("profiles").update(full).eq("id", userId).select("id");
    if (!error && data && data.length === 1) return;
    lastError = error;
  }
  throw new Error(
    "The login was created, but its role and station could not be set" +
    (lastError?.message ? ` (${lastError.message})` : "") +
    ". Set them on the Users page before anyone uses this account."
  );
}

// The columns a total needs — see getTransactions({ lean: true }).
const LEAN_TX_COLUMNS = "id, code, type, location_id, party_id, product_id, quantity_kg, deduction_kg, price_per_kg, amount, total_with_tax, payment_status, hq_status, tx_date, tx_time, created_at";

async function extractFnError(error) {
  try {
    if (error?.context && typeof error.context.json === "function") {
      const body = await error.context.json();
      if (body?.error) return body.error;
    }
  } catch (_e) {
    // fall through to the generic message below
  }
  return error?.message || String(error);
}

// ===========================================================================
// [2026-09-09] PAGED FETCH — the fix for the worst defect found so far.
// ===========================================================================
// Supabase/PostgREST caps EVERY request at 1,000 rows. It does not error, it
// does not warn — it just hands back the first 1,000 and the app carries on
// as if that were everything.
//
// Every list fetch in this file was written without paging, so once a table
// passed 1,000 rows the whole app quietly went wrong: the dashboard showed
// "993 transactions" for a business with thousands, Jomnoum's page reported
// 1,014,590 kg bought when the database held 1,951,575, stock read negative,
// and every financial report — balance sheet, payables, receivables, tax,
// cash flow — computed its totals from the most recent 1,000 rows only.
//
// Nothing about the screen said so. That is what makes it the worst kind of
// bug: wrong numbers that look exactly like right ones.
//
// fetchAll() walks the pages until a short page comes back, so a caller gets
// every row or an error — never a silent half-answer. `makeQuery` must BUILD
// a fresh query each call: a Supabase builder is single-use once awaited.
//
// [2026-09-09, same day — a flaw in the first version of this fix]
//
// The first version let each caller keep its own `.order("created_at", desc)`
// and paged with .range() on top of that. That is WRONG while rows are being
// inserted, which at five weighbridges is every few minutes:
//
//   page 1 = rows 0..999 of "newest first"
//   ... a farmer's load is finished at a station, a new row goes to the TOP ...
//   page 2 = rows 1000..1999 of a list where everything has shifted down one
//
// so the row that was at position 999 is fetched a SECOND time. Totals come
// out inflated, and inflated by a different amount on every page load — which
// is exactly the "it was different just now" that gave this away.
//
// The fix is to page by a key that never moves: the row's own id, ascending.
// A row inserted mid-walk lands at the END, after the pages already taken, so
// it is either picked up on the last page or missed until the next load —
// never duplicated, never skipped from what was already there. The caller's
// display order is then applied in JS, so what it receives is unchanged.
//
// HARD_ROW_CAP is a seatbelt, not a limit: at 500,000 rows something is very
// wrong (a missing filter, a runaway join), and it throws rather than
// silently returning a partial set, which is the exact failure being fixed.
const PAGE_SIZE = 1000;
const HARD_ROW_CAP = 500000;

// Comparators for restoring each caller's display order after the walk.
// `desc("a", "b")` sorts by a descending, then b descending as a tiebreak.
function desc(...fields) {
  return (x, y) => {
    for (const f of fields) {
      const a = x[f] ?? "", b = y[f] ?? "";
      if (a < b) return 1;
      if (a > b) return -1;
    }
    return 0;
  };
}
function asc(...fields) {
  return (x, y) => {
    for (const f of fields) {
      const a = x[f] ?? "", b = y[f] ?? "";
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  };
}

// keyColumn must be unique and never change — the row's own id for a table.
// For a VIEW with no id, pass the column that uniquely identifies a row.
// sort is applied once, after every page is in, so the caller sees exactly
// the order it saw before this function existed.
// [2026-09-10] Proper keyset paging: each page asks for rows AFTER the last
// id it saw, rather than "skip the first N".
//
// I first rewrote this to fetch pages in parallel, because three sequential
// round trips per screen is most of why the app feels slow. Then I checked
// what that costs: parallel pages have to be addressed by OFFSET, and an
// offset walk over a table people are inserting into loses rows — a ticket
// finished at a station mid-walk shifts every later page by one, and one row
// silently never arrives. That is the same class of defect as the 1,000-row
// cap, traded for speed. Not acceptable here.
//
// Keyset paging is immune to it: "give me the next 1,000 rows with an id
// greater than this one" means nothing inserted behind the cursor can shift
// anything ahead of it. It is sequential by nature, so the speed has to come
// from asking for FEWER ROWS — a date range, one station — which is the real
// fix and is being done screen by screen. Small tables still cost exactly
// one round trip, as they always did.
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
    if (after === undefined || after === null) {
      throw new Error(
        `Cannot page safely: "${keyColumn}" is missing on a returned row. ` +
        "Refusing to guess rather than returning a partial answer."
      );
    }
    if (rows.length >= HARD_ROW_CAP) {
      throw new Error(
        `Refusing to load more than ${HARD_ROW_CAP} rows in one go — this query is missing a filter. ` +
        "Nothing was shown rather than showing a partial answer."
      );
    }
  }
  // Belt and braces: a duplicate can only appear if the key column is not
  // actually unique, which would be a schema mistake rather than a race —
  // but a double-counted transaction is expensive enough to be worth one
  // pass of a Set.
  if (rows.length > 1 && rows[0] && rows[0][keyColumn] !== undefined) {
    const seen = new Set();
    let dupes = 0;
    const unique = [];
    for (const r of rows) {
      const k = r[keyColumn];
      if (seen.has(k)) { dupes++; continue; }
      seen.add(k);
      unique.push(r);
    }
    if (dupes > 0) {
      console.warn(`[fetchAll] dropped ${dupes} duplicate row(s) on ${keyColumn}`);
      return sort ? unique.sort(sort) : unique;
    }
  }
  return sort ? rows.sort(sort) : rows;
}

const rawApi = {
  async getLocations() {
    return await fetchAll(() => supabase.from("locations").select("*"), { sort: asc("name") });
  },

  // Live weighbridge connection — reads the single "current weight" row a
  // location's bridge program keeps updated. Returns null (not an error)
  // if the table doesn't exist yet (migration not run) or nothing has ever
  // reported in for this location, so callers can just treat "no live
  // weight" the same as "not connected."
  async getLiveWeight(locationId) {
    if (!locationId) return null;
    const { data, error } = await supabase
      .from("scale_readings")
      .select("weight_kg, updated_at")
      .eq("location_id", locationId)
      .maybeSingle();
    if (error) return null;
    return data;
  },

  async getProfiles() {
    const { data, error } = await supabase.from("profiles").select("*, locations(name), roles(id, name, scope, permissions, view_only)").order("full_name");
    if (error) {
      // The roles table/relationship may not exist yet if that migration
      // hasn't been run — fall back to plain profiles so this page doesn't
      // just go blank with no explanation.
      const fallback = await supabase.from("profiles").select("*, locations(name)").order("full_name");
      if (fallback.error) throw fallback.error;
      return fallback.data.map((p) => ({ ...p, locationName: p.locations?.name || "—", roleObj: null, rolesTableMissing: true }));
    }
    return data.map((p) => ({ ...p, locationName: p.locations?.name || "—", roleObj: p.roles || null }));
  },

  async updateProfileRole(id, { roleId, locationId, role, fullName, viewOnly }) {
    const patch = {};
    if (roleId !== undefined) patch.role_id = roleId;
    if (locationId !== undefined) patch.location_id = locationId;
    if (fullName !== undefined) patch.full_name = fullName;
    // `role` here is the older, simpler admin/staff text column that most
    // of the app still reads directly (Sidebar sections, page access,
    // the Transactions read-only lock) — it predates the granular Roles
    // table. Passing it through keeps the two in sync so a Role change on
    // the Users page actually takes effect everywhere, not just in that
    // dropdown's own label.
    if (role !== undefined) patch.role = role;
    // [2026-09-02] The actual on/off switch for viewOnlyGuard.js — this is
    // the piece that was missing before: the guard logic existed, but
    // nothing in the app could ever set this column. Lets the Users page
    // flip an existing account between "can edit" and "view only".
    if (viewOnly !== undefined) patch.view_only = viewOnly;
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", id).select().single();
    if (error) throw friendlyWriteError(error);
    return data;
  },

  // Marks the current browser as "active" — called on a repeating timer
  // while someone is logged in, so the Users page can show who's currently
  // using the app. Runs through a narrow database function rather than a
  // direct table update, so it can't be used to change anything else.
  async touchLastSeen() {
    const { error } = await supabase.rpc("touch_last_seen");
    if (error) throw error;
  },

  // [2026-09-16] Reports the version this browser is actually running, on the
  // same heartbeat that already marks it active. That one string is what lets
  // HQ answer "is Reang Kesey on the new code?" without walking there.
  //
  // Silent on failure, always. A station on a bad line, or one whose database
  // has not had app_version_control.sql run yet, must carry on weighing paddy
  // — a version report is the least important thing this app does.
  async reportAppVersion(version) {
    try {
      await supabase.rpc("report_app_version", { p_version: version || null });
    } catch {
      // Not yet migrated, or offline. Try again on the next heartbeat.
    }
  },

  // [2026-09-16] One row per machine, so HQ can count devices and see which
  // stations have gone quiet. SISEN: "we just want to track who is actually
  // in the system."
  //
  // This replaces reportAppVersion on the heartbeat — it writes the device
  // row AND keeps profiles.app_version / last_seen_at in step, so everything
  // that already reads those is unaffected. Returns false if the database has
  // not had device_sessions.sql run yet, and the caller falls back.
  async reportDevice({ deviceId, version, platform, browser, city, region, country, missed, pending, stuck }) {
    try {
      const { data, error } = await supabase.rpc("report_device", {
        p_device_id: deviceId,
        p_version: version || null,
        p_platform: platform || null,
        p_browser: browser || null,
        p_city: city || null,
        p_region: region || null,
        p_country: country || null,
        // [2026-09-16] What the STATION itself knows about its line. A machine
        // cannot report trouble while it is having it, but it can report it
        // the moment the line comes back — which is the honest version of
        // "Connected". See device_trouble.sql.
        p_missed: missed || 0,
        p_pending: pending || 0,
        p_stuck: !!stuck,
      });
      // true means HQ has asked for THIS machine to be signed out. The
      // database clears the request as it answers, so this can never loop.
      if (error) return { ok: false, signOut: false };
      return { ok: true, signOut: data === true };
    } catch {
      return { ok: false, signOut: false };
    }
  },

  // [2026-09-16] Owner only, enforced in the database. The machine finds out
  // on its next check-in, so it takes up to a minute — and anything typed
  // there and not yet saved is lost, which is why the screen says so before
  // asking.
  async signOutDevice(deviceId, userId) {
    const { error } = await supabase.rpc("sign_out_device", {
      p_device_id: deviceId, p_user_id: userId,
    });
    if (error) throw error;
  },

  // Every machine one account is signed in on.
  async signOutAccount(userId) {
    const { data, error } = await supabase.rpc("sign_out_account", { p_user_id: userId });
    if (error) throw error;
    return data;
  },

  // Every machine seen in the last day. Read-only, and it carries no address
  // or hardware detail — only the random id each browser gave itself.
  async getDeviceSessions() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("device_sessions")
      .select("device_id, user_id, location_id, app_version, platform, browser, first_seen_at, last_seen_at, first_ip, last_ip, ip_changed_at, city, region, country, signout_requested_at, signed_out_at, signout_by, missed_checkins, pending_ops, stuck, last_signout_reason, last_signout_at")
      .gte("last_seen_at", since)
      .order("last_seen_at", { ascending: false });
    // Not migrated yet reads as "nothing to show", never as an error — the
    // panel then falls back to the account-level view it had before.
    if (error) return null;
    return data || [];
  },

  // The moment HQ last pressed "Update all stations now", plus nothing else.
  // Returns null when the table does not exist yet, which reads the same as
  // "nobody has ever pushed" — so an un-migrated database simply behaves the
  // way it did before this feature existed.
  async getAppControl() {
    const { data, error } = await supabase
      .from("app_control")
      .select("reload_requested_at, updated_at")
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data || null;
  },

  // Owner only — enforced in the database, not here. Tells every station's
  // browser to take the new code as soon as its screen is free.
  async requestStationReload() {
    const { data, error } = await supabase.rpc("request_station_reload");
    if (error) throw error;
    return data;
  },

  // Called by a user's own browser once it has acted on a forced logout,
  // so the flag doesn't linger and re-trigger on a future login.
  async acknowledgeLogout() {
    const { error } = await supabase.rpc("acknowledge_logout");
    if (error) throw error;
  },

  // HQ Admin/Owner only (enforced in the database): flags another user's
  // active session to sign out next time their browser checks in.
  async requestLogout(targetUserId) {
    const { error } = await supabase.rpc("request_logout", { target_user_id: targetUserId });
    if (error) throw error;
  },

  // Owner only (enforced server-side): fetches every account's email via
  // the admin-users Edge Function, since emails live in Supabase's
  // protected auth system, not a table the app can query directly.
  async listUserEmails() {
    const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "list_emails" } });
    if (error) throw new Error(await extractFnError(error));
    return data?.emails || [];
  },

  // Owner only (enforced server-side): sets a brand-new password for
  // another user's account via the admin-users Edge Function. The old
  // password is never seen or needed — this simply replaces it.
  async adminSetPassword(targetUserId, newPassword) {
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action: "set_password", targetUserId, newPassword },
    });
    if (error) throw new Error(await extractFnError(error));
    return data;
  },

  async getRoles() {
    try {
      return await fetchAll(() => supabase.from("roles").select("*"), { sort: asc("scope", "name") });
    } catch (e) {
      console.warn("Roles table not available yet:", e.message);
      return [];
    }
  },

  // [2026-09-16] viewOnly: a role can now BE view-only, rather than it being a
  // tick box remembered separately on every person given that role. Omitted
  // rather than defaulted, so a database that has not had viewer_role.sql run
  // yet is never sent a column it does not have.
  async createRole({ name, scope, permissions, viewOnly }) {
    const row = { name, scope, permissions };
    if (viewOnly !== undefined) row.view_only = !!viewOnly;
    const { data, error } = await supabase.from("roles").insert(row).select().single();
    if (error) throw error;
    return data;
  },

  async updateRole(id, { name, scope, permissions, viewOnly }) {
    const patch = { name, scope, permissions };
    if (viewOnly !== undefined) patch.view_only = !!viewOnly;
    const { data, error } = await supabase.from("roles").update(patch).eq("id", id).select().single();
    if (error) throw friendlyWriteError(error);
    return data;
  },

  async deleteRole(id) {
    const { error } = await supabase.from("roles").delete().eq("id", id);
    if (error) throw error;
  },

  async updateLocation(id, { name, nameKh }) {
    const { data, error } = await supabase.from("locations").update({ name, name_kh: nameKh }).eq("id", id).select().single();
    if (error) throw friendlyWriteError(error);
    return data;
  },

  // Stock adjustments — paddy loses real weight over time (moisture
  // drying out, spillage, handling loss), so the running total built
  // purely from Buy/Sell transactions will drift from what's actually on
  // the scale eventually. This is the one intentional exception to "stock
  // only moves via a transaction": staff record what's physically there
  // right now, and the location's stock is reset to match exactly, with
  // the difference logged (why, how much, by whom, when) instead of just
  // silently overwritten.
  async getStockAdjustments({ locationId, startDate, endDate } = {}) {
    // [2026-09-09] Paged — see fetchAll.
    const makeQuery = () => {
    let query = supabase
      .from("stock_adjustments")
      .select("*, locations(name), profiles(full_name)");
    // [2026-09-19] No .order() inside a paged query. postgrest-js's .order()
    // ADDS to the sort rather than replacing it, so fetchAll's own
    // `order=id.asc` + `id > last` walk became `order=created_at.desc,id.asc`
    // — and page 2 was no longer "the rows after page 1". Past 1,000 rows,
    // some were never fetched, and the de-duplication hid the repeats. The
    // sort now happens after the walk (the `sort:` option below).
    if (locationId) query = query.eq("location_id", locationId);
    // created_at is a full timestamp, not a plain date — bracket the whole
    // day in Cambodia's own calendar (UTC+7, no DST) rather than UTC's, so
    // "Today"/"This Week" from the shared Reports date filter lines up
    // with what staff actually mean by "today" at the station.
    if (startDate) query = query.gte("created_at", `${startDate}T00:00:00+07:00`);
    if (endDate) query = query.lte("created_at", `${endDate}T23:59:59+07:00`);
      return query;
    };
    const data = await fetchAll(makeQuery, { sort: desc("created_at") });
    return data.map((a) => ({ ...a, stationName: a.locations?.name || "—", adjustedByName: a.profiles?.full_name || "—" }));
  },

  // `pricePerKg` puts a real riel figure on an adjustment — typically the
  // station's own weighted-average Buy price (see StockInventory.jsx and
  // station_ticket_floor()).
  //
  // [2026-09-11] Now stored for a GAIN as well as a loss. It used to be
  // kept only when the adjustment was negative, so a gain survived in
  // kilograms and nothing else: Reang Kesey settled +35 kg on 11 September,
  // the Settle screen worked out what it was worth, showed the figure and
  // then dropped it, and Reports → Shrinkage could never price a gain.
  // See adjustment_gain_value_2026-09-11.sql, which also back-fills the
  // gains already recorded.
  //
  // `valueLost` still means money LOST, so the database writes it for
  // losses only — a gain is not a loss of zero, and a positive number in a
  // column named value_lost would corrupt every total that sums it
  // (dailyLedger.js, LocationDetail, Stock Inventory). Shrinkage multiplies
  // kg by price for gains instead. Both stay null when no price was
  // available, so the report shows a dash rather than a confident zero.
  // [2026-09-12] `effectiveDate` — which DAY this adjustment counts
  // against, when that is not today.
  //
  // A station that buys until late often closes the day the next morning.
  // Counted on the morning it was entered, the previous day closes owing
  // paddy it never owed and the new day OPENS negative — a state a shed
  // cannot be in. The app already did this silently for a reset done
  // before 4am (effectiveAdjDateStr in dailyLedger.js); this makes it a
  // deliberate choice, and — unlike the JS-only rule — it moves the stored
  // timestamp so the DATABASE's own ledger snapshots agree too. Without
  // that the Dashboard would keep showing the old opening figure, because
  // its opening and closing balances come from the server, not the browser.
  //
  // The real entry time is preserved in the note by the SQL function, so
  // nothing about who did what and when is lost.
  async recordStockAdjustment({ locationId, previousStockKg, newStockKg, reason, note, userId, pricePerKg, effectiveDate }) {
    // [2026-09-08] One atomic database call (record_stock_adjustment in
    // week1_hardening_2026-09-08.sql). It reads the station's CURRENT
    // stock under lock — not the number this screen loaded minutes ago —
    // writes the adjustment row, and the recompute trigger sets the total.
    // The old two-step version (insert, then set current_stock_kg to the
    // screen's number) could record a wrong loss forever if a sale had
    // synced in between (audit #15). previousStockKg/userId are no longer
    // needed but kept in the signature so callers don't change.
    void previousStockKg; void userId;
    const { data, error } = await supabase
      .rpc("record_stock_adjustment", {
        p_location_id: locationId,
        p_new_stock_kg: newStockKg,
        p_reason: reason,
        p_note: note || null,
        p_price_per_kg: pricePerKg ?? null,
        p_effective_date: effectiveDate ?? null,
      })
      .single();
    if (error) throw error;
    return data;
  },

  // ── Stock reset requests ────────────────────────────────────────────────
  // [2026-09-17] SISEN: "i want each location to be able to reset their stock
  // to 0 to get it as a stock loss, but will need hq above to confirm and
  // accept it."
  //
  // Nothing here writes stock. Filing a request only records the ask; the
  // stock moves inside resolve_stock_reset() on approval, through the same
  // record_stock_adjustment() the Adjust Stock button has always used. See
  // stock_reset_requests.sql.
  async requestStockReset({ locationId, countedKg, reason, note, pricePerKg }) {
    const { data, error } = await supabase.rpc("request_stock_reset", {
      p_location_id: locationId,
      p_counted_kg: countedKg,
      p_reason: reason || "recount",
      p_note: note || null,
      p_price_per_kg: pricePerKg ?? null,
    });
    if (error) throw error;
    return data;
  },

  // [2026-09-21] THE EVENING COUNT. One call does the whole thing: the
  // database works out the difference, measures it against the paddy bought
  // since the last count, and either applies it (inside the allowance) or
  // files it for HQ. Nothing here decides anything — see daily_stock_count.sql.
  //
  // Returns {status:"applied"|"pending", expected_kg, counted_kg, loss_kg,
  //          loss_pct, bought_since_kg, requires_owner, tolerance_pct}.
  async submitStockCount({ locationId, countedKg, note, photoUrl, pricePerKg }) {
    const { data, error } = await supabase.rpc("submit_stock_count", {
      p_location_id: locationId,
      p_counted_kg: countedKg,
      p_note: note || null,
      p_photo_url: photoUrl || null,
      p_price_per_kg: pricePerKg ?? null,
    });
    if (error) throw error;
    return data;
  },

  // The limits, kept in one database row so they can be changed without a
  // new version of the app. Falls back to the same defaults the database
  // ships with, so a screen still works if the table is not there yet.
  async getStockCountPolicy() {
    const fallback = { tolerance_pct: 1, owner_pct: 2, owner_zero_book_kg: 500, require_photo: true };
    try {
      const { data, error } = await supabase.from("stock_count_policy").select("*").eq("id", 1).single();
      if (error || !data) return fallback;
      return data;
    } catch {
      return fallback;
    }
  },

  async cancelStockReset(id) {
    const { error } = await supabase.rpc("cancel_stock_reset", { p_id: id });
    if (error) throw error;
  },

  async resolveStockReset(id, approve, { rejectReason } = {}) {
    const { error } = await supabase.rpc("resolve_stock_reset", {
      p_id: id, p_approve: !!approve, p_reject_reason: rejectReason || null,
    });
    if (error) throw error;
  },

  // Row-level security decides the scope: a station sees its own station's
  // requests and nothing else, HQ sees every one. Nothing is filtered here —
  // a filter in the browser is a preference, not a boundary.
  //
  // Returns [] rather than throwing when the table is not there yet, so an
  // app that reaches a station before the migration does still opens.
  async getStockResetRequests({ status = null, locationId = null } = {}) {
    try {
      let query = supabase
        .from("stock_reset_requests")
        .select("*, locations(name, name_kh), requester:profiles!stock_reset_requests_requested_by_fkey(full_name), resolver:profiles!stock_reset_requests_resolved_by_fkey(full_name)")
        .order("requested_at", { ascending: false });
      if (status) query = query.eq("status", status);
      if (locationId) query = query.eq("location_id", locationId);
      const { data, error } = await query;
      // [2026-09-19] Only a table that does not exist yet means "none". Any
      // other failure — a lapsed login, a timeout — used to come back as an
      // empty list too, so HQ saw "nothing pending" while a station sat
      // waiting on a stock reset that nobody knew about.
      if (error) {
        if (/relation .* does not exist|schema cache|could not find/i.test(error.message || "")) return [];
        throw error;
      }
      return (data || []).map((r) => ({
        ...r,
        stationName: r.locations?.name || "—",
        stationNameKh: r.locations?.name_kh || "",
        requestedByName: r.requester?.full_name || "—",
        resolvedByName: r.resolver?.full_name || "",
      }));
    } catch (err) {
      if (/relation .* does not exist|schema cache|could not find/i.test(err?.message || "")) return [];
      throw err;
    }
  },

  // What the station's own screen needs: is one already waiting?
  async getPendingStockReset(locationId) {
    const rows = await this.getStockResetRequests({ status: "pending", locationId });
    return rows[0] || null;
  },

  async getPendingStockResetCount() {
    try {
      const { count, error } = await supabase
        .from("stock_reset_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) return 0;
      return count || 0;
    } catch {
      return 0;
    }
  },

  async uploadTransactionPhoto(file, kind) {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${kind}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("transaction-photos").upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from("transaction-photos").getPublicUrl(path);
    return data.publicUrl;
  },

  async createLocation({ name, nameKh, capacityKg }) {
    const { data, error } = await supabase
      .from("locations")
      .insert({ name, name_kh: nameKh || "", capacity_kg: capacityKg || 0, current_stock_kg: 0, updated_ago: "just now" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async createUserAccount({ email, password, fullName, roleId, locationId, viewOnly }) {
    // Use a separate, throwaway Supabase client for this so it doesn't
    // touch the admin's own logged-in session — signUp() would otherwise
    // switch the current browser session to the newly created user.
    const { createClient } = await import("@supabase/supabase-js");
    const tempClient = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await tempClient.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    if (error) throw error;
    const userId = data.user?.id;
    if (!userId) throw new Error("Account created, but no user id was returned.");
    // The signup trigger creates a basic profile row; now set their real name/role/location.
    const patch = { full_name: fullName };
    if (roleId) patch.role_id = roleId;
    if (locationId !== undefined) patch.location_id = locationId || null;
    // [2026-09-02] So an account can be created ALREADY locked to view-only
    // — no separate "flip it on after" step needed, e.g. for a family
    // member who should never accidentally be able to save/edit anything.
    if (viewOnly) patch.view_only = true;
    await applyNewAccountProfile(userId, patch);
    return { id: userId, emailConfirmed: !!data.user?.confirmed_at, session: data.session };
  },

  // [2026-09-01] "Email Invite" -- creates the account exactly like
  // createUserAccount() above (same throwaway client, same profile patch),
  // but instead of an Admin typing a password for them, this makes up a
  // random one that's never shown to anyone and never usable, then sends
  // the new user Supabase's standard password-recovery email so THEY pick
  // their own password. Deliberately reuses resetPasswordForEmail() rather
  // than a real "invite" API, because a real invite (auth.admin.
  // inviteUserByEmail) needs a service-role key, which can't safely live in
  // this client-side app -- see SetPassword.jsx for where the emailed link
  // lands. Does not touch createUserAccount() or the admin-users Edge
  // Function at all, so the existing "type a password" flow and the
  // existing Users page (list emails / reset password) are unaffected.
  async inviteUserAccount({ email, fullName, roleId, locationId, viewOnly }) {
    const { createClient } = await import("@supabase/supabase-js");
    const tempClient = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const throwawayPassword = crypto.randomUUID() + crypto.randomUUID();
    const { data, error } = await tempClient.auth.signUp({ email, password: throwawayPassword, options: { data: { full_name: fullName } } });
    if (error) throw error;
    const userId = data.user?.id;
    if (!userId) throw new Error("Account created, but no user id was returned.");
    const patch = { full_name: fullName };
    if (roleId) patch.role_id = roleId;
    if (locationId !== undefined) patch.location_id = locationId || null;
    if (viewOnly) patch.view_only = true;
    await applyNewAccountProfile(userId, patch);
    const { error: resetError } = await tempClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/?setpassword=1`,
    });
    if (resetError) throw new Error("Account was created, but the invite email couldn't be sent: " + resetError.message);
    return { id: userId };
  },

  async getProducts() {
    const { data, error } = await supabase.from("products").select("*").order("name");
    if (error) throw error;
    return data;
  },

  // `id` is optional — passed by the offline queue when this product was
  // already created locally (with a client-generated UUID) while offline,
  // so re-sending it once the connection returns reuses the same id
  // instead of making a duplicate.
  async createProduct(name, id) {
    // [2026-09-10] Store the CLEANED name. Zero-width characters and stray
    // spaces from a Khmer keyboard are what created seven copies of
    // "សែន ក្រអូប"; cleaning here means the database and the app agree on
    // what the name is, and the unique index on product_key(name) can do its
    // job. See src/productName.js.
    const cleaned = cleanProductName(name);
    const row = id ? { id, name: cleaned } : { name: cleaned };
    try {
      return await insertOrFetchExisting("products", row);
    } catch (error) {
      // Same situation as createParty above: two devices (or two tickets
      // on the same device, before either has synced) can each decide a
      // paddy type is new. insertOrFetchExisting already handles a retry
      // of the exact same insert (conflict on id); if the database
      // rejected this for any OTHER reason, the only other realistic
      // cause is a duplicate product name — reuse the existing one
      // instead of leaving the queue stuck forever on an insert that can
      // never succeed.
      // [2026-09-10] Was `.ilike("name", name)` — an exact, case-insensitive
      // match, which could never find the row it had just collided with. The
      // collision is precisely between two names that are NOT equal as
      // strings: one carries an invisible character the other does not.
      // Match on the same key the database's unique index uses instead.
      if (error?.code === "23505" && cleaned) {
        const { data: existing, error: fetchErr } = await supabase
          .from("products")
          .select("*");
        if (!fetchErr && existing) {
          const match = findProductByName(existing, cleaned);
          if (match) return match;
        }
      }
      throw error;
    }
  },

  // Partners (investors) at a location, and the running ledger of their
  // capital contributions/withdrawals. Admin-only (enforced by RLS) — see
  // migration_partner_capital_bank_loans.sql.
  async getPartners(locationId) {
    const makeQuery = () => {
    let query = supabase.from("partners").select("*, locations(name)");
    if (locationId) query = query.eq("location_id", locationId);
      return query;
    };
    const data = await fetchAll(makeQuery, { sort: asc("name") });
    return data.map((p) => ({ ...p, locationName: p.locations?.name || "—" }));
  },

  async createPartner({ name, locationId, note, userId }) {
    const { data, error } = await supabase
      .from("partners")
      .insert({ name, location_id: locationId, note: note || null, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // [2026-09-12] Paged, like every other list fetch in this file.
  //
  // This was the last one left on a bare .order() with no limit and no
  // paging — and PostgREST silently caps such a query at 1,000 rows and
  // returns no error at all. At even one capital entry a day that ceiling
  // arrives inside three years, after which the equity line on the
  // Balance Sheet would be computed from the newest 1,000 entries only
  // and quietly understate what the partners have put in. Nothing would
  // have flagged it: the page would keep rendering a confident number.
  // This is exactly the defect fetchAll was written to kill (see the
  // 1,000-row incident in the project log); this call site was missed.
  async getPartnerCapitalEntries() {
    const makeQuery = () =>
      supabase
        .from("partner_capital_entries")
        .select("*, partners(name), locations(name)");
    // [2026-09-19] No .order() inside a paged query. postgrest-js's .order()
    // ADDS to the sort rather than replacing it, so fetchAll's own
    // `order=id.asc` + `id > last` walk became `order=created_at.desc,id.asc`
    // — and page 2 was no longer "the rows after page 1". Past 1,000 rows,
    // some were never fetched, and the de-duplication hid the repeats. The
    // sort now happens after the walk (the `sort:` option below).
    const data = await fetchAll(makeQuery, { sort: desc("entry_date", "created_at") });
    return data.map((e) => ({ ...e, partnerName: e.partners?.name || "—", stationName: e.locations?.name || "—" }));
  },

  async createPartnerCapitalEntry({ partnerId, locationId, type, amount, entryDate, note, userId }) {
    const { data, error } = await supabase
      .from("partner_capital_entries")
      .insert({ partner_id: partnerId, location_id: locationId, type, amount, entry_date: entryDate, note: note || null, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    // Mirror this into the real cash ledger too, so Cash Flow and the
    // Balance Sheet's "Cash (estimate)" actually move when real money comes
    // in or goes out — not just the Partner Capital equity line. Best
    // effort: if this second write fails, the capital entry itself has
    // still been recorded, so nothing is lost.
    try {
      await api.createPayment({
        type: type === "contribution" ? "capital_in" : "capital_out",
        transactionId: null,
        locationId,
        amount,
        method: "partner_capital",
        payDate: entryDate,
        memo: `Partner capital ${type === "contribution" ? "in" : "out"}${note ? ` — ${note}` : ""}`,
        userId,
      });
    } catch (linkErr) {
      console.warn("Capital entry saved, but mirroring it to the cash ledger failed:", linkErr);
      // [2026-09-19] Reported back, not just logged. The entry itself saved,
      // so throwing would invite a second entry; staying silent left Partner
      // Capital / Bank Loans moved while Cash Flow and the cash estimate did
      // not, with the screen saying everything had worked. The caller now
      // shows this.
      return { ...data, cashLedgerError: linkErr?.message || String(linkErr) };
    }
    return data;
  },

  // ---- Finance Setup ------------------------------------------------------
  // [2026-09-14] The figures the financial statements need that the
  // weighbridge can never work out on its own: who owns what share of a
  // station, what the business owns that wears out, and the cash that was in
  // the safe before the system started. See migration_finance_setup.sql.
  //
  // Every one of these is allowed to be absent. A missing row is not an
  // error and is never turned into a zero — statements.js reads it as "not
  // entered" and the reports print it that way, because zero would be a claim
  // nobody made.

  // A partner's ownership share OF A STATION. Separate from their capital,
  // deliberately: at Pong Ro the split does not follow the money put in.
  async updatePartnerShare(partnerId, sharePct) {
    const value = sharePct === "" || sharePct === null || sharePct === undefined
      ? null : Number(sharePct);
    const { data, error } = await supabase
      .from("partners")
      .update({ share_pct: value })
      .eq("id", partnerId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getFixedAssets() {
    // Paged like everything else — an asset register is small today, but the
    // 1,000-row default is exactly the trap this codebase has been bitten by
    // before (see the project log), and a silently truncated register would
    // understate depreciation forever without anything looking wrong.
    const data = await fetchAll(
      () => supabase.from("fixed_assets").select("*, locations(name)"),
      { sort: desc("in_service_date", "created_at") });
    return data.map((a) => ({ ...a, stationName: a.locations?.name || "—" }));
  },

  async createFixedAsset({ locationId, name, category, cost, usefulLifeYears, inServiceDate, note, userId }) {
    const { data, error } = await supabase
      .from("fixed_assets")
      .insert({
        location_id: locationId, name, category: category || null,
        cost: Number(cost), useful_life_years: Number(usefulLifeYears),
        in_service_date: inServiceDate, note: note || null, created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteFixedAsset(id) {
    const { error } = await supabase.from("fixed_assets").delete().eq("id", id);
    if (error) throw error;
  },

  // Returns a map keyed by location id, which is the shape statements.js
  // wants. A station with no row simply is not in the map, and every figure
  // for it reads as not entered.
  async getFinanceSettings() {
    const { data, error } = await supabase.from("finance_settings").select("*");
    if (error) throw error;
    const map = {};
    for (const row of data || []) map[row.location_id] = row;
    return map;
  },

  async saveFinanceSettings({ locationId, openingCash, openingCashDate, taxRatePct, interestRatePct, note, userId }) {
    // An empty box means "still not entered", so it is written back as NULL
    // rather than 0 — the difference is the whole point of this table.
    const n = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
    const { data, error } = await supabase
      .from("finance_settings")
      .upsert({
        location_id: locationId,
        opening_cash: n(openingCash),
        opening_cash_date: openingCashDate || null,
        tax_rate_pct: n(taxRatePct),
        interest_rate_pct: n(interestRatePct),
        note: note || null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "location_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Bank loans (outside lenders) at a location — a flat borrow/repay
  // ledger, the same style as the payments table. Admin-only.
  async getBankLoans() {
    const data = await fetchAll(
      () => supabase.from("bank_loans").select("*, locations(name)"),
      { sort: desc("entry_date", "created_at") });
    return data.map((e) => ({ ...e, stationName: e.locations?.name || "—" }));
  },

  async createBankLoanEntry({ locationId, lenderName, type, amount, entryDate, note, userId }) {
    const { data, error } = await supabase
      .from("bank_loans")
      .insert({ location_id: locationId, lender_name: lenderName, type, amount, entry_date: entryDate, note: note || null, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    // Mirror this into the real cash ledger too, so Cash Flow and the
    // Balance Sheet's "Cash (estimate)" actually move when a loan is drawn
    // or repaid — not just the Bank Loans liability line. Best effort: if
    // this second write fails, the loan entry itself has still been recorded.
    try {
      await api.createPayment({
        type: type === "borrow" ? "loan_in" : "loan_out",
        transactionId: null,
        locationId,
        amount,
        method: "bank_loan",
        payDate: entryDate,
        memo: `${lenderName} — ${type === "borrow" ? "loan drawn" : "loan repaid"}${note ? ` — ${note}` : ""}`,
        userId,
      });
    } catch (linkErr) {
      console.warn("Loan entry saved, but mirroring it to the cash ledger failed:", linkErr);
      // [2026-09-19] Reported back, not just logged. The entry itself saved,
      // so throwing would invite a second entry; staying silent left Partner
      // Capital / Bank Loans moved while Cash Flow and the cash estimate did
      // not, with the screen saying everything had worked. The caller now
      // shows this.
      return { ...data, cashLedgerError: linkErr?.message || String(linkErr) };
    }
    return data;
  },

  // `q` searches by name (exact-match-or-create flows elsewhere in the
  // app), `qPhone` searches by phone as-you-type (partial match — used by
  // the New Buy/Sell search box, since phone numbers are unique but many
  // farmers share the same name), and `phone` does an exact phone match
  // (used for one-shot lookups like the Weighing Ticket phone field).
  // `locationId` is optional and left out entirely for callers that
  // intentionally want the whole table (e.g. building the offline cache,
  // or an HQ Admin view spanning every station) — pass it whenever the
  // lookup is meant to stay scoped to one station, so a same-named
  // buyer/seller at a different location doesn't get matched instead.
  // [2026-09-19] One farmer or buyer by id — the profile page used to
  // download every farmer to find one.
  async getPartyById(id) {
    const { data, error } = await supabase.from("parties").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async getParties({ type, q, qPhone, phone, locationId } = {}) {
    // [2026-09-09] Paged — see fetchAll.
    const makeQuery = () => {
    let query = supabase.from("parties").select("*");
    if (type) query = query.eq("type", type);
    if (q) query = query.ilike("name", `%${q}%`);
    if (qPhone) query = query.ilike("phone", `%${qPhone}%`);
    if (phone) query = query.eq("phone", phone);
    if (locationId) query = query.eq("location_id", locationId);
      return query;
    };
    return await fetchAll(makeQuery, { sort: asc("name") });
  },

  // `id` is optional — used by the offline queue to replay a party that
  // was already created locally with a client-generated UUID, so a
  // retried sync op reuses that same id instead of making a duplicate.
  // idPhotoUrl/verifiedAt/verifiedBy [2026-08-31]: the "farmer/buyer holding
  // their own bank QR" identity photo, and who confirmed the profile as
  // verified and when — see migration_registration_feature.sql. All three
  // are optional and every existing caller (offline queue replay, the old
  // public self-registration page) simply omits them, so this stays fully
  // backward-compatible — nothing about an existing call site's behavior
  // changes.
  async createParty({ id, name, type, phone, idNumber, bankName, bankAccount, bankQrUrl, idPhotoUrl, verifiedAt, verifiedBy, company, destination, locationId }) {
    const row = {
      ...(id ? { id } : {}),
      name,
      type,
      phone,
      id_number: idNumber,
      bank_name: bankName,
      bank_account: bankAccount,
      bank_qr_url: bankQrUrl || null,
      id_photo_url: idPhotoUrl || null,
      verified_at: verifiedAt || null,
      verified_by: verifiedBy || null,
      company,
      destination,
      location_id: locationId,
    };
    try {
      return await insertOrFetchExisting("parties", row);
    } catch (error) {
      // Two devices (or two tickets on the same device, right after a
      // long stretch offline) can both decide "this is a new supplier"
      // for the same phone number at the same station before either one
      // has synced. The database only allows one party per phone number
      // per location (constraint parties_unique_phone_per_location) —
      // when THAT specific rule is what failed, reuse the record that's
      // already there instead of leaving the offline queue permanently
      // stuck retrying an insert that can never succeed.
      // (offlineQueue.js's runOp() checks whether the id it gets back
      // here differs from the id it asked for, and fixes up anything
      // already pointing at the id that didn't end up being used.)
      if (phone && locationId && error?.code === "23505" && String(error?.message || "").includes("parties_unique_phone_per_location")) {
        const { data: existing, error: fetchErr } = await supabase
          .from("parties")
          .select("*")
          .eq("phone", phone)
          .eq("location_id", locationId)
          .limit(1);
        if (!fetchErr && existing && existing.length) return existing[0];
      }
      throw error;
    }
  },

  // Widened [2026-08-31] to also cover name/phone/idNumber/the identity
  // photo/verified stamp, for the new staff-facing registration screen
  // ("complete this farmer's existing profile" instead of creating a
  // second, separate record for the same person). Every existing caller
  // that only ever passed bankName/bankAccount/bankQrUrl keeps working
  // exactly as before — the new fields are only patched when actually
  // provided, same as the original three already worked.
  async updateParty(id, { name, phone, idNumber, bankName, bankAccount, bankQrUrl, idPhotoUrl, verifiedAt, verifiedBy, clearPendingBank }) {
    const patch = {};
    if (clearPendingBank) { patch.pending_bank_name = null; patch.pending_bank_account = null; patch.pending_bank_qr_url = null; patch.pending_bank_requested_at = null; }
    if (name !== undefined) patch.name = name;
    if (phone !== undefined) patch.phone = phone;
    if (idNumber !== undefined) patch.id_number = idNumber;
    if (bankName !== undefined) patch.bank_name = bankName;
    if (bankAccount !== undefined) patch.bank_account = bankAccount;
    if (bankQrUrl !== undefined) patch.bank_qr_url = bankQrUrl;
    if (idPhotoUrl !== undefined) patch.id_photo_url = idPhotoUrl;
    if (verifiedAt !== undefined) patch.verified_at = verifiedAt;
    if (verifiedBy !== undefined) patch.verified_by = verifiedBy;
    const { data, error } = await supabase.from("parties").update(patch).eq("id", id).select();
    if (error) throw error;
    // Same reasoning as insertOrFetchExisting above: a save that legitimately
    // changed the row can still come back with zero rows read afterward.
    // Requiring exactly one row back (the old `.single()` here) turned that
    // into a hard error every single retry, forever — which is exactly what
    // was stuck: a "10 changes waiting to sync" queue that never clears.
    return (data && data[0]) || { id, ...patch };
  },

  async getSettings() {
    const { data, error } = await supabase.from("system_settings").select("*");
    if (error) throw error;
    const map = {};
    data.forEach((s) => { map[s.key] = s.value; });
    return map;
  },

  async updateSetting(key, value) {
    const { error } = await supabase.from("system_settings").upsert({ key, value: String(value) }, { onConflict: "key" });
    if (error) throw error;
  },

  async updateSettings(entries) {
    const rows = Object.entries(entries).map(([key, value]) => ({ key, value: String(value ?? "") }));
    const { error } = await supabase.from("system_settings").upsert(rows, { onConflict: "key" });
    if (error) throw error;
  },

  // [2026-09-10] `from` / `to` / `partyId` filter in the DATABASE.
  //
  // Every report and the dashboard used to download the entire transactions
  // table and then throw away everything outside the period on screen. At
  // 2,787 rows that is merely wasteful; at 100,000 the screen stops
  // loading. The date pickers now change the QUERY, not just what is drawn
  // afterwards, which is what makes the app survive years of growth.
  //
  // `from`/`to` are plain Cambodia calendar dates (YYYY-MM-DD) matched
  // against tx_date — the day the transaction belongs to, which is the day
  // Finish was pressed and the receipt printed.
  //
  // All four are optional and omitting them behaves exactly as before, so
  // a caller that genuinely needs everything (the yearly close, a
  // reconciliation) is unchanged.
  // `limit` short-circuits the paged walk entirely: "the latest N", newest
  // first, in one bounded request. That is what the dashboard's live feed
  // wants — eight rows — and it should never have been getting them by
  // downloading the table and slicing it.
  async getTransactions({ type, locationId, from, to, partyId, limit, lean = false } = {}) {
    // [2026-09-09] Paged. Before this it returned the newest 1,000 rows and
    // every all-time total in the app was computed from that slice.
    //
    // [2026-09-19] SPEED: `lean: true` fetches only the columns needed to add
    // up weights and money, with no joined names. For screens that only
    // total things (stock, station tiles), that is a fraction of the download.
    const makeQuery = () => {
    let query = supabase
      .from("transactions")
      // address/phone: per-location fields (see add_location_address_phone.sql)
      // used on the printed receipt header — falls back to "—" below if a
      // location hasn't had them filled in yet.
      .select(lean ? LEAN_TX_COLUMNS : "*, locations(name, address, phone), parties(name, id_number, phone), products(name)");
    if (type) query = query.eq("type", type);
    if (locationId) query = query.eq("location_id", locationId);
    if (partyId) query = query.eq("party_id", partyId);
    if (from) query = query.gte("tx_date", from);
    if (to) query = query.lte("tx_date", to);
      return query;
    };
    // Ordering is applied after the walk, not inside it — see fetchAll.
    let data;
    if (limit) {
      const { data: rows, error } = await makeQuery()
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      data = rows || [];
    } else {
      data = await fetchAll(makeQuery, { sort: desc("created_at") });
    }
    return data.map((t) => ({
      ...t,
      stationName: t.locations?.name || "—",
      stationAddress: t.locations?.address || "",
      stationPhone: t.locations?.phone || "",
      partyName: t.parties?.name || "—",
      // [2026-09-07] Shown next to the name on the receipt and the list.
      // Was id_number only — most farmers have none on file, so a receipt
      // reprinted from Transactions showed nothing after the name, while
      // one printed straight after Finish showed the phone typed on the
      // ticket. Phone first, ID number as the fallback, on both paths.
      partyIdNumber: t.parties?.phone || t.parties?.id_number || "",
      productName: t.products?.name || "—",
    }));
  },

  // [2026-09-06] Pulled out of createTransaction below so finalizeTicket
  // can build the exact same row — every field, every computed amount,
  // the same duplicate-ticket-number flag — WITHOUT going through a
  // separate insert of its own. Pure aside from the one await (the
  // duplicate check needs to read the table first); nothing here touches
  // the database.
  async buildTransactionRow({ id, code, type, locationId, partyId, productId, quantityKg, pricePerKg, paymentStatus, userId, qualityGrade, taxApplicable, taxRate, moisturePct, mixturePct, outthrowPct, deductionKg, note, carPlate, driverName, receiptPhotoUrl, paymentProofUrl, txDate, txTime, staffFee, paperTicketNo, bankQrUrl, grossKg, grossAt, tareKg, tareAt, recordedByName }) {
    const payableKg = Math.max(0, quantityKg - (deductionKg || 0));
    // Staff/carrying fee (rare — only when our own staff carries the paddy
    // for a farmer who didn't bring labor) comes straight off what's paid,
    // same stage as the weight deduction above but in cash instead of kg.
    const amount = Math.round(Math.max(0, payableKg * pricePerKg - (staffFee || 0)) * 100) / 100;
    // `txDate` lets staff back-date an entry (e.g. logging a truckload the
    // next morning that was actually weighed the day before) — falls back
    // to right now, in Cambodia's timezone, if nothing was picked.
    // [2026-09-08] txDate/txTime are what the device stamped at the moment
    // of the save. Finish Ticket never passed them, so a ticket finished
    // offline at 23:40 and synced at 07:10 got the NEXT day's date here
    // (audit #2). "Now" is only the fallback for callers that send none.
    const { date: defaultDate, time: defaultTime } = cambodiaNow();
    const row = {
      ...(id ? { id } : {}),
      code: code || genCode(type),
      type,
      tx_date: txDate || defaultDate,
      tx_time: txTime || defaultTime,
      location_id: locationId,
      party_id: partyId,
      product_id: productId,
      quantity_kg: quantityKg,
      price_per_kg: pricePerKg,
      amount,
      payment_status: paymentStatus,
      // Sell-only snapshot of what was recorded when the sale was first
      // created — the truck's own weigh-out weight and the price agreed
      // (if any) at that point, before it's driven to the buyer and
      // weighed/priced again there. Never touched again after this —
      // quantity_kg/price_per_kg/amount above are the ones that switch to
      // the buyer's confirmed numbers once that happens (see
      // confirmBuyerSale below), so this pair stays the permanent "what we
      // sent out" reference for measuring transport loss. Buy has no
      // second weighing elsewhere, so this is left null there.
      station_quantity_kg: type === "SELL" ? quantityKg : null,
      station_price_per_kg: type === "SELL" ? pricePerKg : null,
      created_by: userId,
      // [2026-09-11] A quality letter is a note. It must never be the
      // reason a truckload cannot be recorded.
      //
      // The database enforces CHECK (quality_grade IN ('A','B','C')), and
      // one screen had been offering 1/2/3 since the field was built. The
      // first person ever to use it lost a 39.5 million riel sale into the
      // stuck queue — no retry could ever succeed, because the value
      // itself was the problem. The dropdown is fixed, but the shape of
      // that failure is what matters: a decorative field permanently
      // blocking a real sale. Anything that is not a grade the database
      // accepts is dropped here instead, so the sale always lands.
      quality_grade: normalizeQualityGrade(qualityGrade),
      tax_applicable: !!taxApplicable,
      tax_rate: taxApplicable ? (taxRate || 0) : 0,
      moisture_pct: moisturePct || 0,
      mixture_pct: mixturePct || 0,
      outthrow_pct: outthrowPct || 0,
      deduction_kg: deductionKg || 0,
      note: note || null,
      car_plate: carPlate || null,
      driver_name: driverName || null,
      receipt_photo_url: receiptPhotoUrl || null,
      // Weigh In / Weigh Out numbers — carried over from the weighing
      // ticket (undefined for a manually-entered Buy/Sell, which only
      // ever has one net weight) so a reopened receipt can show the real
      // IN/OUT table again, not just right after it was first saved.
      gross_kg: grossKg ?? null,
      gross_at: grossAt || null,
      tare_kg: tareKg ?? null,
      tare_at: tareAt || null,
      payment_proof_url: paymentProofUrl || null,
      staff_fee: staffFee || 0,
      paper_ticket_no: normalizePaperTicketNo(paperTicketNo),
      // [2026-09-04] See checkAndFlagPaperTicketDuplicate above — checked
      // before the insert so the flag lands in this SAME row the moment
      // it's created, not as a separate update right after.
      // [2026-09-19] excludeId: a retry (or the station relay saving the same
      // entry at the same moment) found its OWN earlier copy and flagged it
      // a duplicate of itself, burying the real duplicates.
      paper_ticket_dup_flag: await checkAndFlagPaperTicketDuplicate("transactions", locationId, paperTicketNo, id),
      bank_qr_url: bankQrUrl || null,
      recorded_by_name: recordedByName || null,
    };
    return row;
  },

  // `id` is optional — passed by finalizeTicket when a weighing ticket
  // is finalized offline, so a retried sync reuses the same id instead
  // of creating a second transaction.
  async createTransaction(fields) {
    const row = await this.buildTransactionRow(fields);
    try {
      return await insertWithFreshCodeOnCollision("transactions", row, () => genCode(fields.type));
    } catch (error) {
      // friendlyPaperTicketNoError is now dead code in practice (see its
      // own comment above) — left as a harmless fallback.
      throw friendlyPaperTicketNoError(error, fields.paperTicketNo) || error;
    }
  },

  // Weighing Tickets — the digital version of the paper ticket that
  // travels between the scale and the drop-off area. A ticket moves
  // through stages (arrived -> weighed_in -> priced -> weighed_out ->
  // finalized), picked up by whichever staff member is handling that
  // stage, several in progress at once. Finalizing one creates a real
  // transaction via the existing createTransaction path above, so
  // everything downstream (reports, stock, AP/AR) is unaffected.

  async getTickets({ locationId, stages, limit } = {}) {
    const makeQuery = () => {
    let query = supabase
      .from("weighing_tickets")
      // address/phone: per-location fields (see add_location_address_phone.sql)
      // used on the printed Weigh-In Slip header.
      .select("*, locations(name, address, phone), gross_profile:gross_by(full_name), priced_profile:priced_by(full_name), tare_profile:tare_by(full_name), created_profile:created_by(full_name)");
    if (locationId) query = query.eq("location_id", locationId);
    if (stages && stages.length) query = query.in("stage", stages);
      return query;
    };
    // [2026-09-09] A caller that asked for a limit gets exactly that, one
    // request. A caller that asked for everything now actually gets
    // everything instead of the newest 1,000 — see fetchAll.
    let data;
    if (limit) {
      const { data: page, error } = await makeQuery()
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      data = page || [];
    } else {
      data = await fetchAll(makeQuery, { sort: desc("created_at") });
    }
    return data.map((t) => ({
      ...t,
      stationName: t.locations?.name || "—",
      stationAddress: t.locations?.address || "",
      stationPhone: t.locations?.phone || "",
      grossByName: t.gross_profile?.full_name,
      pricedByName: t.priced_profile?.full_name,
      tareByName: t.tare_profile?.full_name,
      createdByName: t.created_profile?.full_name,
    }));
  },

  // [2026-09-03] A live, server-side check for the Entry Sanity Check on
  // New Ticket / Edit Ticket (see WeighingTickets.jsx) — deliberately its
  // own small targeted query rather than reusing getTickets, since this
  // runs on every submit and only ever needs "does one row already exist",
  // not the whole board. Added after a real duplicate (PONG RO, paper
  // ticket PR000127, used on two separate tickets) got through the
  // old check, which only ever looked at this device's own local cache —
  // two different devices, neither yet synced with the other, each
  // thought the number was free. Checking the server directly closes that
  // gap; the database's own constraint (see
  // add_paper_ticket_no_unique_constraint.sql) is what makes it a real
  // guarantee rather than just a better-informed warning.
  async findTicketByPaperTicketNo({ locationId, paperTicketNo, excludeId }) {
    // [2026-09-04] Normalized the same way it'll be stored (see
    // normalizePaperTicketNo above) — comparing the raw, un-squeezed input
    // against already-normalized stored values is exactly what let
    // "TD 000678" / "TD  000678" (an extra space, invisible on screen)
    // through as if they were different numbers.
    const trimmed = normalizePaperTicketNo(paperTicketNo) || "";
    if (!locationId || !trimmed) return null;
    // ilike does a case-insensitive match, but % and _ are wildcards to
    // it — escape them so a paper ticket number that happens to contain
    // one (unlikely, but it's free-typed text) is matched literally
    // instead of as a pattern.
    const escaped = trimmed.replace(/[%_\\]/g, (c) => `\\${c}`);
    let query = supabase
      .from("weighing_tickets")
      .select("id, code, party_name, created_at")
      .eq("location_id", locationId)
      .ilike("paper_ticket_no", escaped)
      .limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) throw error;
    return (data && data[0]) || null;
  },

  // [2026-09-05] The real "what's the last ticket number used at this
  // location" — across BOTH Buy and Sell (one shared paper booklet, used
  // in order regardless of type) and every device, not just whatever this
  // one browser happens to remember (see suggestNextPaperTicketNo in
  // offlineQueue.js, which only knows what THIS device last typed in).
  // Without this, two staff on two different phones/tablets at the same
  // station could each get told to use the same "next" number — one
  // making a Buy ticket, the other a Sell — since neither device's local
  // memory knew what the other had just entered. Used to suggest the next
  // number in New Ticket; never blocks anything by itself.
  //
  // [2026-09-12] NOW READS BOTH TABLES. It only ever looked at
  // `weighing_tickets`, so a station whose last few loads were typed
  // straight into New Buy/New Sell (the manual form) would be told to
  // carry on from a number the booklet had already moved well past. One
  // paper booklet is one sequence; which screen a load happened to be
  // recorded on is irrelevant to what number comes next.
  async getLatestPaperTicketNo(locationId) {
    if (!locationId) return null;
    const pick = async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select("paper_ticket_no, created_at")
        .eq("location_id", locationId)
        .not("paper_ticket_no", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data && data[0]) || null;
    };
    const [fromTickets, fromTransactions] = await Promise.all([
      pick("weighing_tickets"),
      pick("transactions"),
    ]);
    if (!fromTickets) return fromTransactions?.paper_ticket_no || null;
    if (!fromTransactions) return fromTickets.paper_ticket_no || null;
    // Whichever was written most recently is the one the booklet is on.
    return (new Date(fromTransactions.created_at) > new Date(fromTickets.created_at)
      ? fromTransactions.paper_ticket_no
      : fromTickets.paper_ticket_no) || null;
  },

  // [2026-09-12] ONE BOOKLET, ONE CHECK.
  //
  // Until now there were two separate duplicate checks that never spoke to
  // each other: findTicketByPaperTicketNo looked only at weighing_tickets,
  // findTransactionByPaperTicketNo only at transactions. A number used on
  // the weighbridge board could therefore be reused on a manually-entered
  // Buy/Sell, and neither screen would say a word.
  //
  // That is not hypothetical. JOMNOUM CN 000560 was on Bory's live ticket
  // of 7 September and was then typed again onto hen's 9 September entry
  // during the re-entry after the station PC failed. Same station, same
  // booklet, same number, two records, no warning anywhere.
  //
  // The paper booklet does not know which screen a load was recorded on.
  // Neither should this. Returns the first match found in either table, or
  // null. `kind` tells the caller what it collided with so the warning can
  // say something useful.
  async findAnyByPaperTicketNo({ locationId, paperTicketNo, excludeTicketId, excludeTransactionId }) {
    const trimmed = normalizePaperTicketNo(paperTicketNo) || "";
    if (!locationId || !trimmed) return null;
    const [onTicket, onTransaction] = await Promise.all([
      this.findTicketByPaperTicketNo({ locationId, paperTicketNo: trimmed, excludeId: excludeTicketId })
        .catch(() => null),
      this.findTransactionByPaperTicketNo({ locationId, paperTicketNo: trimmed, excludeId: excludeTransactionId })
        .catch(() => null),
    ]);
    // A finalized ticket and its own transaction share a number by design,
    // so report the transaction when both exist — it is the record that
    // survives, and the one staff can actually go and look at.
    if (onTransaction) return { ...onTransaction, kind: "transaction" };
    if (onTicket) return { ...onTicket, kind: "ticket" };
    return null;
  },

  // [2026-09-04] Same idea as findTicketByPaperTicketNo above, but against
  // the transactions table — used by EditTransactionModal (Transactions.jsx)
  // to show the same kind of "heads up, already used" warning BEFORE
  // saving, instead of only finding out from the paper_ticket_dup_flag
  // badge afterward. This is the one screen that's actually produced a
  // real duplicate before (PONG RO/PR000127, PONG RO/PR000209), since it's
  // the only place a paper ticket number can be typed in with no
  // connection at all to the weighing ticket board.
  async findTransactionByPaperTicketNo({ locationId, paperTicketNo, excludeId }) {
    const trimmed = normalizePaperTicketNo(paperTicketNo) || "";
    if (!locationId || !trimmed) return null;
    const escaped = trimmed.replace(/[%_\\]/g, (c) => `\\${c}`);
    let query = supabase
      .from("transactions")
      .select("id, code, created_at, parties(name)")
      .eq("location_id", locationId)
      .ilike("paper_ticket_no", escaped)
      .limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) throw error;
    const row = (data && data[0]) || null;
    if (!row) return null;
    // Flatten the joined party name so callers can read match.party_name
    // the same way findTicketByPaperTicketNo's result already works.
    return { id: row.id, code: row.code, created_at: row.created_at, party_name: row.parties?.name || null };
  },

  // `id` is optional — passed by the offline queue when a ticket was
  // already opened locally (client-generated UUID) while offline, so a
  // retried sync reuses that same id instead of opening a second ticket.
  //
  // `grossKg` is optional too, but in practice always present — every
  // real caller (NewTicketModal) requires a weight before it will even
  // let staff submit the form. It's captured in this SAME insert, not a
  // separate setTicketGross update right after (see createTicketOffline
  // in offlineQueue.js for the full story of why this changed on
  // 2026-09-01): before, a ticket was always created with no weight first
  // and then patched a moment later, so any interruption between those
  // two saves — a dropped connection, a closed tab, a sync error — could
  // leave a ticket permanently stuck on the board showing "—" for weight
  // (first seen live at Jomnoum). Folding the weight into the same
  // request means a ticket that reaches the server always already has
  // one; there's no window where it can exist without it.
  async createTicket({ id, code, type, locationId, partyId, partyName, phone, bankName, bankAccount, carPlate, driverName, productId, productName, userId, paperTicketNo, bankQrUrl, recordedByName, grossKg, note }) {
    const hasGross = grossKg != null;
    const row = {
      ...(id ? { id } : {}),
      code: code || genTicketCode(),
      type,
      location_id: locationId,
      party_id: partyId || null,
      party_name: partyName,
      phone: phone || null,
      bank_name: bankName || null,
      bank_account: bankAccount || null,
      car_plate: carPlate || null,
      driver_name: driverName || null,
      product_id: productId || null,
      product_name: productName,
      stage: hasGross ? "weighed_in" : "arrived",
      gross_kg: hasGross ? grossKg : null,
      gross_at: hasGross ? getAccurateNow().toISOString() : null,
      gross_by: hasGross ? userId : null,
      created_by: userId,
      paper_ticket_no: normalizePaperTicketNo(paperTicketNo),
      paper_ticket_dup_flag: await checkAndFlagPaperTicketDuplicate("weighing_tickets", locationId, paperTicketNo, id),
      bank_qr_url: bankQrUrl || null,
      recorded_by_name: recordedByName || null,
      // [2026-09-15] weighing_tickets.note — text, nullable, verified against
      // information_schema before this line was written, NOT against a file
      // in the repo. That mistake took all five stations down this morning.
      //
      // Set only when staff picked the "Other" paddy type and said what the
      // rice is. Every other ticket sends null, which is what the column
      // already held for every row.
      note: note || null,
    };
    try {
      return await insertWithFreshCodeOnCollision("weighing_tickets", row, genTicketCode);
    } catch (error) {
      throw friendlyPaperTicketNoError(error, paperTicketNo) || error;
    }
  },

  // [2026-09-18] "The update matched zero rows" means two completely
  // different things, and the offline queue could only hear one of them.
  //
  //   (a) the ticket is GONE from the server — a database reset ran while
  //       this device was offline. Nothing to do, and everything else queued
  //       for that ticket is equally pointless.
  //   (b) the ticket is FINALIZED, so the .neq("stage","finalized") guard
  //       matched nothing. The ticket is perfectly fine; this one step is
  //       simply already past.
  //
  // Both returned null. offlineQueue's runOp reads null as (a) and calls
  // dropOtherOpsForGoneTicket, which deletes the queued finalizeTicket AND
  // the createPayment behind it, AND the cached copy of the transaction —
  // so the farmer's cash payment is thrown away while the purchase itself,
  // delivered by the station relay under its own login, sits on the server
  // marked unpaid. Receipt in hand, nothing in the books, no error anywhere.
  //
  // This tells them apart by asking. Found → hand back the row, so the step
  // counts as done and the rest of the queue proceeds. Not found → null,
  // which now genuinely means gone.
  async ticketStepAlreadyDoneOrGone(id) {
    const { data, error } = await supabase
      .from("weighing_tickets")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    // Could not check (offline, server error) — say nothing rather than
    // claim the ticket is gone. Throwing leaves the op queued for a retry,
    // which is the safe direction: nothing is deleted on a guess.
    if (error) throw error;
    return data || null;
  },

  async setTicketGross(id, { grossKg, userId }) {
    const { data, error } = await supabase
      .from("weighing_tickets")
      .update({ gross_kg: grossKg, gross_at: getAccurateNow().toISOString(), gross_by: userId, stage: "weighed_in" })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      // PGRST116 = the update matched zero rows: this ticket doesn't
      // exist on the server anymore (most likely a database reset ran
      // after this device queued the change while offline). Nothing left
      // to update — treat it as already-handled instead of leaving the
      // whole offline queue stuck forever retrying a ticket that's gone.
      if (error.code === "PGRST116") return null;
      throw error;
    }
    return data;
  },

  // Corrects the basic weigh-in details on a ticket that's still open
  // (waiting for Finish Ticket) — a mistyped plate number, the wrong
  // paddy type picked, a phone number fixed after the fact, or even the
  // gross weight itself if it was captured wrong. Deliberately does NOT
  // touch `stage` — editing a ticket's info doesn't move it through the
  // board, only Finish Ticket / Decline do that. Only the fields actually
  // passed in get updated, so a partial edit never blanks out the rest.
  async updateTicketInfo(id, { partyId, partyName, phone, carPlate, driverName, productId, productName, paperTicketNo, grossKg, grossAt, userId }) {
    const patch = {};
    if (partyId !== undefined) patch.party_id = partyId || null;
    if (partyName !== undefined) patch.party_name = partyName;
    if (phone !== undefined) patch.phone = phone || null;
    if (carPlate !== undefined) patch.car_plate = carPlate || null;
    if (driverName !== undefined) patch.driver_name = driverName || null;
    if (productId !== undefined) patch.product_id = productId || null;
    if (productName !== undefined) patch.product_name = productName;
    if (paperTicketNo !== undefined) {
      patch.paper_ticket_no = normalizePaperTicketNo(paperTicketNo);
      // This function isn't given the ticket's location_id directly (its
      // callers only ever pass the fields actually being changed) — fetched
      // fresh here rather than widening every caller's payload just for
      // this one check.
      const { data: existingTicket } = await supabase.from("weighing_tickets").select("location_id").eq("id", id).single();
      if (existingTicket?.location_id) {
        patch.paper_ticket_dup_flag = await checkAndFlagPaperTicketDuplicate("weighing_tickets", existingTicket.location_id, paperTicketNo, id);
      }
    }
    // [2026-09-19] "Don't ever change the weigh-in date." An edit only ever
    // CORRECTS the weight; the weigh-in time stays what it was. It used to be
    // re-stamped to now (and again, later, at sync time) on every edit, even a
    // plate typo, because the edit form always sends the weight. The time is
    // set only when this is the ticket's FIRST weigh-in, and then it is the
    // moment staff saved it on the device (grossAt), not the sync time.
    if (grossKg !== undefined) {
      patch.gross_kg = grossKg;
      if (grossAt) {
        patch.gross_at = grossAt;
        patch.gross_by = userId;
      }
    }
    const { data, error } = await supabase
      .from("weighing_tickets")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      // Same reasoning as setTicketGross above: the ticket is gone, not a
      // real failure — nothing to retry.
      if (error.code === "PGRST116") return null;
      throw friendlyPaperTicketNoError(error, paperTicketNo) || error;
    }
    return data;
  },

  async setTicketPrice(id, { qualityGrade, moisturePct, mixturePct, outthrowPct, deductionKg, pricePerKg, staffFee, taxApplicable, taxRate, priceNote, userId, decline, bankName, bankAccount, bankQrUrl }) {
    const patch = {
      // Normalized here too, so a ticket can never carry a quality the
      // transactions table will reject when it is finalized.
      quality_grade: normalizeQualityGrade(qualityGrade),
      moisture_pct: moisturePct || 0,
      mixture_pct: mixturePct || 0,
      outthrow_pct: outthrowPct || 0,
      deduction_kg: deductionKg || 0,
      price_per_kg: decline ? null : pricePerKg,
      staff_fee: staffFee || 0,
      tax_applicable: !!taxApplicable,
      tax_rate: taxApplicable ? (taxRate || 0) : 0,
      price_note: priceNote || null,
      priced_at: getAccurateNow().toISOString(),
      priced_by: userId,
      stage: decline ? "declined" : "priced",
    };
    // [2026-09-18] The guard below (.neq("stage","finalized")) is the same one
    // setTicketTare has carried since 2026-09-07, and it was missing here.
    // That mattered because Finish Ticket queues setTicketPrice BEFORE
    // setTicketTare: a replayed price write knocked a finalized ticket back
    // to "priced", which re-opened the door for the tare write, which knocked
    // it to "weighed_out", which blinded finalize_weighing_ticket's
    // already-finalized check — and a second transaction, with a second
    // payment, went through for one truckload. The tare guard alone could not
    // hold that line, because this write ran first and undid it.
    // Which bank (or Cash) and QR to pay this farmer with — left out
    // entirely (not overwritten with a blank) on calls that don't pass
    // them, like a quick Decline.
    if (bankName !== undefined) patch.bank_name = bankName || null;
    if (bankAccount !== undefined) patch.bank_account = bankAccount || null;
    if (bankQrUrl !== undefined) patch.bank_qr_url = bankQrUrl || null;
    const { data, error } = await supabase
      .from("weighing_tickets")
      .update(patch)
      .eq("id", id)
      .neq("stage", "finalized")
      .select()
      .single();
    if (error) {
      // Zero rows: either the ticket is finalized (fine — this step is
      // already past) or it is genuinely gone. Ask, rather than assume the
      // destructive one. See ticketStepAlreadyDoneOrGone above.
      if (error.code === "PGRST116") return await api.ticketStepAlreadyDoneOrGone(id);
      throw error;
    }
    return data;
  },

  async setTicketTare(id, { tareKg, userId }) {
    const { data, error } = await supabase
      .from("weighing_tickets")
      .update({ tare_kg: tareKg, tare_at: getAccurateNow().toISOString(), tare_by: userId, stage: "weighed_out" })
      .eq("id", id)
      // [2026-09-07] Never touch a ticket that is already finalized. A
      // re-pressed Finish Ticket (after the browser gave up on a save the
      // server had actually completed) re-queues this tare write first —
      // and it used to knock the ticket from "finalized" back to
      // "weighed_out", which blinded finalize_weighing_ticket's
      // "already finalized?" check and let a second transaction through
      // (Jomnoum, 2026-09-07). The database has the same guard as a
      // trigger (see finalize_weighing_ticket_atomic_v3.sql); this just
      // saves the round-trip. No row matched → PGRST116 → null below.
      .neq("stage", "finalized")
      .select()
      .single();
    if (error) {
      // See ticketStepAlreadyDoneOrGone: a finalized ticket matched zero rows
      // here, and returning null for that used to make the queue delete this
      // ticket's finalize AND the farmer's cash payment.
      if (error.code === "PGRST116") return await api.ticketStepAlreadyDoneOrGone(id);
      throw error;
    }
    return data;
  },

  async cancelTicket(id) {
    const { error } = await supabase.from("weighing_tickets").update({ stage: "cancelled" }).eq("id", id);
    if (error) throw error;
  },

  // Turns a fully weighed-out, priced ticket into a real transaction —
  // reusing createTransaction above so every report/screen that already
  // reads the transactions table works without any changes.
  async finalizeTicket(id, { userId, txDate, txTime, paymentStatus, transactionId, transactionCode, receiptPhotoUrl }) {
    const { data: ticket, error: fetchErr } = await supabase.from("weighing_tickets").select("*").eq("id", id).single();
    if (fetchErr) {
      // Same reasoning as setTicketGross above: nothing to finalize if
      // the ticket itself no longer exists on the server.
      if (fetchErr.code === "PGRST116") return null;
      throw fetchErr;
    }
    // If this ticket was already finalized (e.g. this op is being replayed
    // after a connection drop right after the first attempt succeeded),
    // don't create a second transaction — just return the existing one.
    if (ticket.stage === "finalized" && ticket.transaction_id) {
      const { data: existingTx, error: txErr } = await supabase.from("transactions").select("*").eq("id", ticket.transaction_id).single();
      if (!txErr && existingTx) return existingTx;
    }
    // Buy: truck arrives LOADED (gross_kg captured first at weigh-in) and
    // leaves EMPTY (tare_kg captured second at Finish Ticket) — the paddy
    // weight is In minus Out. Sell: truck arrives EMPTY (captured first,
    // into the same gross_kg column) and leaves LOADED after being filled
    // for delivery (captured second, into tare_kg) — so the paddy weight
    // there is the other way around: Out minus In. Math.max(0, ...) is
    // just a safety floor against a real data-entry mistake — it should
    // never actually be needed when the two weighings are correct.
    const netKg = Math.max(0, ticket.type === "BUY"
      ? (ticket.gross_kg || 0) - (ticket.tare_kg || 0)
      : (ticket.tare_kg || 0) - (ticket.gross_kg || 0));
    const row = await this.buildTransactionRow({
      id: transactionId,
      code: transactionCode,
      type: ticket.type,
      locationId: ticket.location_id,
      partyId: ticket.party_id,
      productId: ticket.product_id,
      quantityKg: netKg,
      pricePerKg: ticket.price_per_kg,
      // A Sell finished with "price not given yet" (ticket.price_per_kg
      // is null — see WeighingTickets.jsx's submitFinish()) can't
      // honestly be marked "paid" — nobody has settled on an amount to
      // pay yet. Credit (still owed) is the correct starting state;
      // staff correct it once the price is actually agreed, same as
      // they already do via Edit Transaction.
      // [2026-09-08] A Sell is CREDIT (still owed) unless the station
      // explicitly recorded it as paid at the scale (paymentStatus from the
      // Finish form, which then also records the payment). It used to be
      // "paid" by default with no payment row — audit #1.
      paymentStatus: ticket.type === "BUY" ? "pending" : (ticket.price_per_kg == null ? "credit" : (paymentStatus === "paid" ? "paid" : "credit")),
      userId,
      qualityGrade: ticket.quality_grade,
      taxApplicable: ticket.tax_applicable,
      taxRate: ticket.tax_rate,
      moisturePct: ticket.moisture_pct,
      mixturePct: ticket.mixture_pct,
      outthrowPct: ticket.outthrow_pct,
      deductionKg: ticket.deduction_kg,
      note: ticket.note,
      carPlate: ticket.car_plate,
      driverName: ticket.driver_name,
      txDate,
      txTime,
      staffFee: ticket.staff_fee,
      paperTicketNo: ticket.paper_ticket_no,
      bankQrUrl: ticket.bank_qr_url,
      receiptPhotoUrl,
      grossKg: ticket.gross_kg,
      grossAt: ticket.gross_at,
      tareKg: ticket.tare_kg,
      tareAt: ticket.tare_at,
      recordedByName: ticket.recorded_by_name,
    });
    // [2026-09-06] The two writes this used to do one after another —
    // insert the transaction, THEN mark this ticket "finalized" — now
    // happen inside ONE database function call instead (see
    // finalize_weighing_ticket_atomic.sql). A dropped connection in the
    // gap between two separate requests could let the first succeed while
    // the second never happened: the receipt printed with genuinely
    // correct numbers, but the ticket itself never learned it was done,
    // so it sat there showing "Finish Ticket" forever — inviting staff to
    // press it again and create a real second transaction for the same
    // truckload (confirmed live at Jomnoum, TKT-521806 and TKT-872042, on
    // 2026-09-06). A single function call is one atomic unit in Postgres:
    // if anything inside it fails, everything it did is rolled back
    // together, so this can no longer end up half-done. The function
    // itself also re-checks "already finalized?" the same way this
    // function used to above, but INSIDE that same atomic step and with
    // the ticket row locked — so two Finish Ticket presses landing at
    // almost the same moment can't both slip past that check either.
    // [2026-09-07] Own abort signal: supabaseClient.js cuts every request
    // off at 8s, which on Jomnoum's evening connection was shorter than
    // this one call takes — the browser gave up while the server went on
    // to complete the save, and that mismatch is what produced the
    // duplicate transactions. 28s here, under offlineQueue's 30s op timeout.
    const { data: tx, error } = await supabase
      .rpc("finalize_weighing_ticket", { p_ticket_id: id, p_transaction: row })
      .abortSignal(AbortSignal.timeout(28000))
      .single();
    if (error) throw error;
    return tx;
  },

  // Undoes a ticket that got Finished against the wrong truck — staff pick
  // a ticket off the board, weigh out, price, and finalize it, and only
  // after the receipt prints do they realize it was actually a different
  // truck's ticket. HQ Admin only (see WeighingTickets.jsx's Finalized tab).
  //
  // Cancels the transaction Finish created — reusing the same hq_status
  // flag already used everywhere else in the app to keep a bad transaction
  // out of reports and the ledger export (see updateHqStatus above) — and
  // resets the ticket back to "weighed_in", clearing everything Finish
  // Ticket wrote (quality, price, tare/weigh-out, the transaction link).
  // The original weigh-in (gross_kg) is left untouched, since that step
  // happened correctly for this ticket and was never the mistake. The
  // ticket then reappears in the normal waiting queue, ready to be
  // finished again — correctly, against the right truck. A printed paper
  // receipt from the mistaken finish can't be recalled by this — staff
  // still need to void/staple that copy by hand.
  async reopenTicket(id, { userId, reason }) {
    const { data: ticket, error: fetchErr } = await supabase.from("weighing_tickets").select("*").eq("id", id).single();
    if (fetchErr) throw fetchErr;
    if (ticket.stage !== "finalized") throw new Error("Only a finished ticket can be reopened.");
    // [2026-09-19] Two fixes to a two-step operation.
    //
    //  1. The cancel below had no .select(), so an update that row-level
    //     security let match zero rows came back as SUCCESS. The ticket was
    //     then reset and unlinked while its old transaction stayed live —
    //     and finishing the ticket again handed back that old transaction,
    //     the wrong truck's numbers, as the "existing" one. Now a cancel that
    //     changed nothing stops the reopen with a plain reason.
    //  2. If the cancel worked but resetting the ticket then failed (a
    //     timeout), the transaction was left cancelled while the ticket still
    //     read finalized. It is now put back the way it was.
    let previousHqStatus = null;
    if (ticket.transaction_id) {
      const { data: before } = await supabase
        .from("transactions").select("hq_status").eq("id", ticket.transaction_id).maybeSingle();
      previousHqStatus = before?.hq_status ?? null;
      const { data: cancelled, error: cancelErr } = await supabase
        .from("transactions")
        .update({ hq_status: "cancelled" })
        .eq("id", ticket.transaction_id)
        .select("id")
        .maybeSingle();
      if (cancelErr) throw cancelErr;
      if (!cancelled) {
        throw new Error(
          "The transaction for this ticket could not be cancelled — this account is not allowed to, " +
            "or it no longer exists. Nothing has been changed."
        );
      }
    }
    const { data, error } = await supabase
      .from("weighing_tickets")
      .update({
        stage: "weighed_in",
        quality_grade: null, moisture_pct: 0, mixture_pct: 0, outthrow_pct: 0, deduction_kg: 0,
        price_per_kg: null, staff_fee: 0, tax_applicable: false, tax_rate: 0, price_note: null,
        priced_at: null, priced_by: null,
        tare_kg: null, tare_at: null, tare_by: null,
        transaction_id: null,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      if (ticket.transaction_id) {
        await supabase.from("transactions")
          .update({ hq_status: previousHqStatus })
          .eq("id", ticket.transaction_id)
          .then(() => {}, () => {});
      }
      throw error;
    }
    // Fire-and-forget, same reasoning as every other logAudit call — this
    // runs right after the real mutation above already succeeded.
    this.logAudit({
      action: "reopen_ticket",
      tableName: "weighing_tickets",
      recordId: id,
      oldData: { stage: "finalized", transactionId: ticket.transaction_id, code: ticket.code },
      newData: { stage: "weighed_in", reason, cancelledTransactionId: ticket.transaction_id },
      userId,
    });
    return data;
  },

  // [2026-09-01] "Restore" a wrongly-declined ticket (HQ Admin only) — for
  // when Decline was tapped by mistake, or the reason turned out not to
  // hold up (e.g. a re-check of the load). Mirrors reopenTicket's approach
  // one stage earlier: undoes exactly what DeclineModal/setTicketPriceOffline
  // wrote (quality/price/tax/note fields, all null'd or zeroed the same way
  // a fresh weigh-in ticket starts out) and sends the ticket back to
  // "weighed_in", so it reappears on the normal waiting queue ready to be
  // priced or declined again — correctly this time. The original weigh-in
  // (gross_kg) is untouched, since that step was never in question. No
  // transaction to cancel here — a declined ticket was never finalized.
  async restoreTicket(id, { userId, reason }) {
    const { data: ticket, error: fetchErr } = await supabase.from("weighing_tickets").select("*").eq("id", id).single();
    if (fetchErr) throw fetchErr;
    if (ticket.stage !== "declined") throw new Error("Only a declined ticket can be restored.");
    const { data, error } = await supabase
      .from("weighing_tickets")
      .update({
        stage: "weighed_in",
        quality_grade: null, moisture_pct: 0, mixture_pct: 0, outthrow_pct: 0, deduction_kg: 0,
        price_per_kg: null, staff_fee: 0, tax_applicable: false, tax_rate: 0, price_note: null,
        priced_at: null, priced_by: null,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    // Fire-and-forget, same reasoning as every other logAudit call — this
    // runs right after the real mutation above already succeeded.
    this.logAudit({
      action: "restore_declined_ticket",
      tableName: "weighing_tickets",
      recordId: id,
      oldData: { stage: "declined", priceNote: ticket.price_note, code: ticket.code },
      newData: { stage: "weighed_in", reason },
      userId,
    });
    return data;
  },

  // [2026-09-10] What every station held at the END OF A GIVEN DAY.
  //
  // The dashboard's "On hand" always showed today, whatever period was
  // selected — so the Yesterday row put yesterday's movements beside
  // today's balance and described no real moment. The ledger knows the
  // answer for any day; this asks it, for all stations, in one call.
  //
  // Returns a Map of location_id → kg. An empty Map means the function is
  // not installed yet (stock_at_close_rpc_2026-09-10.sql), and every caller
  // falls back to the station's current figure — the old behaviour — rather
  // than showing nothing.
  async getStockAtClose(date) {
    if (!date) return new Map();
    const { data, error } = await supabase.rpc("stock_at_close", { p_date: date });
    if (error) {
      console.warn("[getStockAtClose] not available:", error.message);
      return new Map();
    }
    return new Map((data || []).map((r) => [r.location_id, Number(r.kg) || 0]));
  },

  // [2026-09-11] The smallest buy ticket each station has ever written, plus
  // its average and how many tickets that is based on (see
  // station_ticket_floor_2026-09-11.sql).
  //
  // This is what decides whether a stock difference can be settled on the
  // spot. A gap SMALLER than the smallest ticket a station writes cannot be
  // a missing ticket — it has to be rain, scale drift or sweepings. A gap
  // larger than that might be a lost ticket, so the app refuses to write it
  // off and sends you to the paper book instead.
  //
  // Deliberately not a number in Settings: a setting invites "just raise it
  // this once", and a limit that can be argued up is not a limit. This one
  // only moves if the station genuinely starts writing bigger tickets.
  //
  // Fails CLOSED. Empty Map on any error (function not installed yet, no
  // permission, offline) and every caller then treats every station as
  // un-settleable — the safe direction, since the cost of not settling
  // 35 kg is nothing and the cost of wrongly settling 21 tonnes is 20
  // million riel.
  async getStationTicketFloor() {
    const { data, error } = await supabase.rpc("station_ticket_floor");
    if (error) {
      console.warn("[getStationTicketFloor] not available:", error.message);
      return new Map();
    }
    return new Map(
      (data || []).map((r) => [
        r.location_id,
        {
          floorKg: Number(r.floor_kg) || 0,
          avgKg: Number(r.avg_kg) || 0,
          ticketCount: Number(r.ticket_count) || 0,
          enoughHistory: r.enough_history === true,
          // Weighted average buy price at this station over the last 30
          // days, or null if it has bought nothing priced in that window.
          // Only ever used to put a riel figure beside the kilos — null
          // means the screen shows kilos alone rather than inventing a
          // price, same standing rule as the Adjust Stock modal.
          recentPrice: r.recent_price_per_kg == null ? null : Number(r.recent_price_per_kg),
        },
      ])
    );
  },

  // [2026-09-10] Just the number, for the badge on the bell and in the
  // sidebar. It was being answered by downloading every change request ever
  // made, each joined to its transaction, that transaction's party, and the
  // profile of whoever asked — on EVERY page change. Three screens visited
  // meant three downloads of a table nobody had opened. This asks the
  // database to count and send back no rows at all.
  // [2026-09-20] Includes stations' stock counts waiting for HQ. SISEN:
  // "where will HQ see the request?" — on Change Requests, but the red number
  // on the menu only counted edit requests, so a station's stock count sat
  // there with no badge at all. Now both are counted.
  async getPendingChangeRequestCount() {
    const [cr, sr] = await Promise.all([
      supabase.from("change_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("stock_reset_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    if (cr.error) throw cr.error;
    // The stock-count table may not exist on a database that has not had
    // stock_reset_requests.sql run; that is "none", not a failure.
    const resets = sr.error ? 0 : (sr.count || 0);
    return (cr.count || 0) + resets;
  },

  // `status` filters in the DATABASE. Every caller wants pending only; the
  // full history is one `status: null` away if a screen ever needs it.
  async getChangeRequests({ status = null } = {}) {
    const data = await fetchAll(
      () => {
        let q = supabase
        .from("change_requests")
        .select(
          // [2026-09-15] gross_kg/tare_kg added — a change request can now propose a
        // weight, and the review screen has to be able to show what it is now.
        "*, transactions(id, code, type, quantity_kg, price_per_kg, gross_kg, tare_kg, payment_status, quality_grade, tax_applicable, tax_rate, deduction_kg, moisture_pct, mixture_pct, outthrow_pct, note, car_plate, driver_name, amount, party_id, staff_fee, paper_ticket_no, parties(name)), profiles!change_requests_requested_by_fkey(full_name)"
        );
        if (status) q = q.eq("status", status);
        return q;
      },
      { sort: desc("created_at") });
    return data.map((r) => ({
      ...r,
      transactionCode: r.transactions?.code || "—",
      requestedByName: r.profiles?.full_name || "—",
      currentPartyName: r.transactions?.parties?.name || "—",
    }));
  },

  async createChangeRequest({ transactionId, requestedBy, locationId, reason, proposedData }) {
    const { data, error } = await supabase
      .from("change_requests")
      .insert({
        transaction_id: transactionId,
        requested_by: requestedBy,
        location_id: locationId,
        reason,
        proposed_data: proposedData || null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // [2026-09-15] This used to write { status } and nothing else — so who
  // approved a change and when existed only as a row in audit_logs, and the
  // Change Requests screen had to count "approved this month" off the REQUEST
  // date because there was no resolved date to count.
  //
  // The three new columns come from migration_change_request_trail.sql. They
  // are written through a soft retry rather than assumed: on a database where
  // that migration has not been run yet, the first update fails on the unknown
  // column and the second one writes the status alone, exactly as before. The
  // approval still lands; only the extra detail is missing.
  // [2026-09-19] Read at the moment of deciding, not from the list as it was
  // loaded: another admin may have decided it already, or the transaction
  // may have been cancelled since.
  async getChangeRequestState(id) {
    const { data, error } = await supabase
      .from("change_requests")
      .select("status, transactions(hq_status)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? { status: data.status, txCancelled: (data.transactions?.hq_status || "") === "cancelled" } : null;
  },

  async resolveChangeRequest(id, status, { userId, rejectReason } = {}) {
    const full = {
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: userId || null,
      reject_reason: status === "rejected" ? (rejectReason || null) : null,
    };
    let { data, error } = await supabase.from("change_requests").update(full).eq("id", id).select().single();
    if (error) {
      console.warn("resolveChangeRequest: falling back to status only —", error.message);
      ({ data, error } = await supabase.from("change_requests").update({ status }).eq("id", id).select().single());
    }
    if (error) throw friendlyWriteError(error);
    return data;
  },

  // [2026-09-09] cancelReason: cancelling used to leave no record of WHY a
  // transaction was voided, or who decided — a 30-tonne purchase could
  // vanish from the books with nothing behind it. The reason is now
  // required by the screen and stored on the row.
  //
  // The money side is handled in the database, not here: trg_void_payments_
  // with_transaction (cancel_to_zero_2026-09-09.sql) voids any payment
  // against a cancelled transaction and un-voids it if the transaction is
  // restored, so a cancelled transaction comes to zero in Cash Flow too.
  // Doing it in the database rather than in this function means it also
  // holds for a cancel made through Change Requests or the SQL editor.
  // Nothing is deleted — a voided payment stays on record, greyed out.
  async updateHqStatus(id, hqStatus, { cancelReason } = {}) {
    const { data, error } = await supabase
      .from("transactions")
      .update({
        hq_status: hqStatus,
        // Only sent on the way in to 'cancelled'. Restoring clears it in
        // the database (trg_stamp_transaction_cancel), so it is not sent
        // here — that keeps one owner for the field instead of two.
        ...(hqStatus === "cancelled" && cancelReason !== undefined
          ? { cancel_reason: (cancelReason || "").trim() || null }
          : {}),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateTransaction(id, { quantityKg, pricePerKg, paymentStatus, qualityGrade, taxApplicable, taxRate, deductionKg, moisturePct, mixturePct, outthrowPct, note, carPlate, driverName, partyId, productId, txDate, staffFee, locationId, recordedByName, grossKg, grossAt, tareKg, tareAt, paperTicketNo, type, keepQuantity }) {
    // [2026-09-03] Defense-in-depth for the Weigh-In/Weigh-Out <-> Net
    // Weight desync bug (full story: EditTransactionModal's own useEffect
    // in Transactions.jsx, added the same day this was found from a real
    // printed receipt with a wrong total). That fix keeps quantityKg in
    // sync with grossKg/tareKg, but only inside that one screen's React
    // state -- nothing stopped a *different* caller of this function from
    // passing a stale quantityKg alongside a corrected gross/tare pair.
    // This repeats the same recalculation here too, at the one place
    // every save of a transaction actually goes through, so that class of
    // bug can't quietly come back through a different screen later.
    // Only kicks in when BOTH weights AND the transaction's type are
    // present in this same call -- a caller that never touches gross/tare
    // (e.g. Change Requests approval, which doesn't pass any of these
    // three) or clears one of them back to blank leaves quantityKg
    // exactly as given, same as before this change.
    // [2026-09-08] keepQuantity: a buyer-confirmed Sell keeps the buyer's
    // quantity — never re-derived from the station's weights (audit #5).
    if (!keepQuantity && type && grossKg != null && tareKg != null) {
      const isBuy = type === "BUY";
      quantityKg = Math.max(0, isBuy ? grossKg - tareKg : tareKg - grossKg);
    }
    const payableKg = Math.max(0, quantityKg - (deductionKg || 0));
    const amount = Math.round(Math.max(0, payableKg * pricePerKg - (staffFee || 0)) * 100) / 100;
    // [2026-09-04] This is the exact screen (Edit Transaction's Paper
    // Ticket Number field) that produced the real PONG RO/PR000127 and
    // PONG RO/PR000209 duplicates — see the comment below on
    // paper_ticket_no. locationId is usually passed in already by the
    // caller; fetched fresh only if not, so the check is always scoped to
    // the right station.
    let paperTicketDupFlag;
    if (paperTicketNo !== undefined) {
      let scopeLocationId = locationId;
      if (!scopeLocationId) {
        const { data: existingTx } = await supabase.from("transactions").select("location_id").eq("id", id).single();
        scopeLocationId = existingTx?.location_id;
      }
      paperTicketDupFlag = await checkAndFlagPaperTicketDuplicate("transactions", scopeLocationId, paperTicketNo, id);
    }
    const { data, error } = await supabase
      .from("transactions")
      .update({
        quantity_kg: quantityKg, price_per_kg: pricePerKg, amount, payment_status: paymentStatus, quality_grade: normalizeQualityGrade(qualityGrade),
        tax_applicable: !!taxApplicable, tax_rate: taxApplicable ? (taxRate || 0) : 0,
        ...(deductionKg !== undefined ? { deduction_kg: deductionKg || 0 } : {}),
        ...(staffFee !== undefined ? { staff_fee: staffFee || 0 } : {}),
        ...(moisturePct !== undefined ? { moisture_pct: moisturePct || 0 } : {}),
        ...(mixturePct !== undefined ? { mixture_pct: mixturePct || 0 } : {}),
        ...(outthrowPct !== undefined ? { outthrow_pct: outthrowPct || 0 } : {}),
        ...(note !== undefined ? { note: note || null } : {}),
        ...(carPlate !== undefined ? { car_plate: carPlate || null } : {}),
        ...(driverName !== undefined ? { driver_name: driverName || null } : {}),
        ...(recordedByName !== undefined ? { recorded_by_name: recordedByName || null } : {}),
        ...(partyId !== undefined && partyId ? { party_id: partyId } : {}),
        // Paddy type — previously not editable at all after a transaction
        // was created (see the New Buy/Sell form, the only other place
        // product_id gets set). Same "only touch it if the caller actually
        // passed one" guard as every other optional field here.
        ...(productId !== undefined && productId ? { product_id: productId } : {}),
        ...(txDate !== undefined && txDate ? { tx_date: txDate } : {}),
        ...(locationId !== undefined && locationId ? { location_id: locationId } : {}),
        // Manual weigh-in/weigh-out entry (for a typed-in transaction that never
        // went through the actual scale) — null clears it back to "—" on the
        // receipt, a number/timestamp fills it in. Only touched when the caller
        // explicitly passes these keys, so every other edit path is unaffected.
        ...(grossKg !== undefined ? { gross_kg: grossKg } : {}),
        ...(grossAt !== undefined ? { gross_at: grossAt } : {}),
        ...(tareKg !== undefined ? { tare_kg: tareKg } : {}),
        ...(tareAt !== undefined ? { tare_at: tareAt } : {}),
        // The physical paper quality-ticket booklet number. Editable here
        // for the first time — previously this was only ever set/fixed on
        // the Weighing Tickets board (New Buy/Sell, or Edit Ticket while
        // still open), so a transaction that finalized with the wrong
        // number, or none at all, had no way to be corrected. [2026-09-03]
        // Used to have no uniqueness check at all here (this comment used
        // to say so, reasoning it was "a deliberate manual fix, not
        // day-to-day entry") — then got a hard database-level block after
        // the real PR000127 duplicate (add_paper_ticket_no_unique_
        // constraint.sql), which is what then stuck PR000209 in the sync
        // queue and turned out to be exactly the kind of case that
        // shouldn't be blocked outright. [2026-09-04] Switched from
        // blocking to flag-and-allow (see checkAndFlagPaperTicketDuplicate
        // above) — a reused number now saves, but shows the warning badge
        // in the Transactions list. EditTransactionModal in Transactions.jsx
        // also runs its own live pre-save check now, the same "double-check
        // before saving" pattern the ticket screens already had, rather than
        // only finding out here after the fact.
        ...(paperTicketNo !== undefined ? { paper_ticket_no: normalizePaperTicketNo(paperTicketNo), paper_ticket_dup_flag: paperTicketDupFlag } : {}),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw friendlyPaperTicketNoError(error, paperTicketNo) || error;
    return data;
  },

  // Sell only — records the buyer's actual final weight & price once the
  // truck has been to their place and weighed/priced there (see
  // Transactions.jsx's ConfirmBuyerSaleModal). Deliberately a small,
  // separate function rather than routing through updateTransaction above
  // — that function writes several fields (payment_status, quality_grade,
  // tax_applicable/tax_rate) unconditionally, so a minimal caller would
  // need to round-trip every one of them just to avoid silently wiping
  // them; a dedicated update here only ever touches the handful of fields
  // this screen actually changes. `deductionKg` is passed in from the
  // transaction's own current value (not a new one — this screen doesn't
  // edit it) purely so the new amount is computed with the same
  // payable-weight math as everywhere else. `amount` here is the same
  // pre-tax subtotal the table always stores (tax_applicable/tax_rate are
  // display-only fields on this table and are left untouched, whatever
  // they were already set to). The transaction's original
  // quantity_kg/price_per_kg (as recorded at the station) are never
  // touched here — see createTransaction's station_quantity_kg/
  // station_price_per_kg above, which is where that snapshot lives.
  async confirmBuyerSale(id, { quantityKg, pricePerKg, deductionKg, userId }) {
    const payableKg = Math.max(0, quantityKg - (deductionKg || 0));
    const subtotal = Math.round(Math.max(0, payableKg * pricePerKg) * 100) / 100;
    const { data, error } = await supabase
      .from("transactions")
      .update({
        quantity_kg: quantityKg,
        price_per_kg: pricePerKg,
        amount: subtotal,
        buyer_confirmed_at: getAccurateNow().toISOString(),
        buyer_confirmed_by: userId,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // [2026-09-09] includeVoided: a payment against a cancelled transaction is
  // voided rather than deleted (cancel_to_zero_2026-09-09.sql). It must not
  // count towards anything, but it must still be findable — so it is
  // excluded here by default and can be asked for explicitly.
  async getPaymentsForTransaction(transactionId, { includeVoided = false } = {}) {
    let query = supabase
      .from("payments")
      .select("*, profiles(full_name)")
      .eq("transaction_id", transactionId)
      .order("created_at");
    if (!includeVoided) query = query.is("voided_at", null);
    const { data, error } = await query;
    if (error) throw error;
    return data.map((p) => ({ ...p, createdByName: p.profiles?.full_name || "—" }));
  },

  async updatePayment(id, amount) {
    const { data, error } = await supabase.from("payments").update({ amount }).eq("id", id).select().single();
    if (error) throw friendlyWriteError(error);
    return data;
  },

  // [2026-09-16] Amending a recorded expense.
  //
  // updatePayment above changes the amount and nothing else, which is right
  // for a payment against a purchase — the category and the note are not
  // things a payment has. An expense has both, and a daily sheet arrives
  // with a figure against the wrong category often enough to matter.
  //
  // WHY THE REASON IS NOT A NEW COLUMN
  //
  // `payments` has no column for "why was this changed", and adding one to a
  // live table that every station writes to is exactly the sort of change
  // that stopped all five stations on 15 September. It is not needed:
  // audit_logs already carries user, action, the row's id, and the whole
  // before/after. The reason rides in new_data alongside what changed, so
  // one record holds who, when, from what, to what, and why.
  //
  // Only the fields actually passed are written — an amendment that changes
  // the amount leaves the category and the note exactly as they were.
  async updateExpense(id, { amount, category, memo, reason, userId } = {}) {
    const { data: before, error: readErr } = await supabase
      .from("payments").select("*").eq("id", id).single();
    if (readErr) throw readErr;

    const patch = {};
    if (amount !== undefined) patch.amount = amount;
    if (category !== undefined) patch.category = category;
    if (memo !== undefined) patch.memo = memo;
    if (!Object.keys(patch).length) return before;

    const { data, error } = await supabase
      .from("payments").update(patch).eq("id", id).select().single();
    if (error) throw friendlyWriteError(error);

    // Fire-and-forget, like every other logAudit call: the amendment has
    // already succeeded, and a slow audit write must not turn it into a
    // visible failure.
    api.logAudit({
      action: "edit_expense",
      tableName: "payments",
      recordId: id,
      oldData: { amount: before.amount, category: before.category, memo: before.memo },
      newData: { ...patch, reason: (reason || "").trim() || null },
      userId,
    });
    return data;
  },

  // [2026-09-16] "This station spent nothing on this day."
  //
  // On the month grid a blank cell and a genuine zero mean opposite things:
  // one is a day nobody entered, the other is a day that was checked. A
  // forgotten day makes a station look cheaper than it is, and nothing else
  // in the app can notice it because there is no row to notice.
  //
  // See expense_day_marks.sql. A zero-amount expense could not carry this —
  // it would need a category, and would then appear as a phantom line in
  // every category total.
  async getExpenseDayMarks({ from, to } = {}) {
    let query = supabase.from("expense_day_marks").select("*");
    if (from) query = query.gte("day", from);
    if (to) query = query.lte("day", to);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async markExpenseDayEmpty({ locationId, day, userId }) {
    const { data, error } = await supabase
      .from("expense_day_marks")
      .upsert({ location_id: locationId, day, marked_by: userId, marked_at: new Date().toISOString() },
              { onConflict: "location_id,day" })
      .select().single();
    if (error) throw error;
    return data;
  },

  // Recording a real expense on a day that was marked empty clears the mark —
  // the two statements contradict each other, and the money is the truth.
  async clearExpenseDayMark({ locationId, day }) {
    const { error } = await supabase
      .from("expense_day_marks").delete()
      .eq("location_id", locationId).eq("day", day);
    if (error) throw error;
  },

  // [2026-09-09] Voiding a payment.
  //
  // Until now a payment entered wrong had no clean way back: you could
  // change the amount, but a payment that should never have existed at all
  // — recorded twice, or against the wrong transaction — could only be
  // cancelled by editing it to zero, which leaves a meaningless zero row
  // and no record of why.
  //
  // Voiding uses the same columns the cancel-to-zero rule already added
  // (cancel_to_zero_2026-09-09.sql), so a voided payment behaves the same
  // way everywhere: excluded from Cash Flow, from a transaction's paid
  // total, and from what is owed — but never deleted. It stays visible,
  // greyed out, with the reason attached, and the whole change is in
  // row_history.
  //
  // Deliberately NOT reused for the automatic case: a payment voided
  // because its transaction was cancelled carries the exact reason
  // "Transaction cancelled" and is un-voided if that transaction is
  // restored. A hand-voided one uses the person's own words, so restoring
  // the transaction leaves it voided — which is right, because it was
  // wrong for its own reasons.
  async voidPayment(id, reason) {
    const text = (reason || "").trim();
    if (!text) throw new Error("Please say why this payment is being voided — it is kept on the record.");
    if (text === "Transaction cancelled") {
      // Guard the one string the cancel trigger looks for, so a hand-void
      // can never be un-voided later by restoring a transaction.
      throw new Error("Please give a specific reason rather than 'Transaction cancelled'.");
    }
    const { data, error } = await supabase
      .from("payments")
      .update({ voided_at: new Date().toISOString(), voided_reason: text })
      .eq("id", id)
      .is("voided_at", null)      // never re-void, so the first reason stands
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async unvoidPayment(id) {
    const { data, error } = await supabase
      .from("payments")
      .update({ voided_at: null, voided_reason: null })
      .eq("id", id)
      .neq("voided_reason", "Transaction cancelled")   // that one is the trigger's to own
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async logAudit({ action, tableName, recordId, oldData, newData, userId }) {
    const { error } = await supabase.from("audit_logs").insert({
      user_id: userId, action, table_name: tableName, record_id: recordId, old_data: oldData, new_data: newData,
    });
    if (error) console.error("audit log failed", error);
  },

  // Same insert as logAudit above, but re-throws on failure instead of
  // swallowing it. Used ONLY by the offline sync queue (offlineQueue.js):
  // a queued audit-log entry for a brand-new transaction/payment needs to
  // retry like every other change in that queue if it fails, not vanish
  // silently with nothing but a console.error nobody was watching. Every
  // other caller in the app calls logAudit above directly and deliberately
  // keeps its fire-and-forget behavior, since those calls happen right
  // after their real mutation already succeeded and shouldn't turn a
  // successful save into a visible error just because the audit trail
  // lagged behind it.
  async logAuditStrict({ action, tableName, recordId, oldData, newData, userId }) {
    const { error } = await supabase.from("audit_logs").insert({
      user_id: userId, action, table_name: tableName, record_id: recordId, old_data: oldData, new_data: newData,
    });
    if (error) throw error;
  },

  // [2026-09-09] Paged — see fetchAll. An audit log that silently stops at
  // 1,000 entries is worse than none: it looks complete.
  //
  // [2026-09-12] Now takes a date range, and this is the difference
  // between a page that works in year ten and one that is permanently
  // broken by then.
  //
  // Two audit rows are written for every finished ticket, so this table
  // grows at roughly 200 a day — about 73,000 a year. Unfiltered, the page
  // pulled the WHOLE table including its before/after jsonb blobs: 220
  // sequential round trips by year 3, and at about year 6.8 it crosses
  // fetchAll's HARD_ROW_CAP and throws. At that point the Activity Log is
  // dead with no filter available to work around it, which is the worst
  // possible failure for the one screen that answers "who changed this".
  //
  // `from`/`to` are Cambodia calendar dates; created_at is a full UTC
  // timestamp, so the day is bracketed in UTC+7 the same way
  // getStockAdjustments does it.
  async getAuditLogs({ from = null, to = null } = {}) {
    const makeQuery = () => {
      let q = supabase.from("audit_logs").select("*, profiles(full_name, location_id)");
      if (from) q = q.gte("created_at", `${from}T00:00:00+07:00`);
      if (to) q = q.lte("created_at", `${to}T23:59:59+07:00`);
      return q;
    };
    const data = await fetchAll(makeQuery, { sort: desc("created_at") });
    return data.map((l) => ({ ...l, userName: l.profiles?.full_name || "—", userLocationId: l.profiles?.location_id || null }));
  },

  // [2026-09-16] Who last changed each of these expense rows, and when.
  //
  // The day sheet shows a saved figure LOCKED, with the name and time of the
  // last person to change it beside it — SISEN: "make sure the written amount
  // are locked if they need to edit it, it will requires a password to show
  // who edit and date and time."
  //
  // Read from audit_logs, which updateExpense already writes with the whole
  // before/after and the reason. Nothing new is stored for this.
  async getExpenseEdits(paymentIds) {
    const ids = (paymentIds || []).filter(Boolean);
    if (!ids.length) return {};
    const { data, error } = await supabase
      .from("audit_logs")
      .select("record_id, created_at, new_data, old_data, profiles(full_name)")
      .eq("action", "edit_expense")
      .in("record_id", ids)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const out = {};
    for (const row of data || []) {
      // Ordered newest first, so the first one seen for an id is the latest.
      if (out[row.record_id]) continue;
      out[row.record_id] = {
        at: row.created_at,
        by: row.profiles?.full_name || "—",
        from: row.old_data?.amount ?? null,
        to: row.new_data?.amount ?? null,
        reason: row.new_data?.reason || "",
      };
    }
    return out;
  },

  // [2026-09-09] Daily close, per station.
  //
  // Not a lock — a signature. The monthly close refuses edits; this only
  // records that the person who was actually at the weighbridge looked at
  // the day and said it was right. A station that could not fix today's
  // obvious mistake because it already pressed a button at 5pm would simply
  // stop pressing the button, and then you lose the signature AND the
  // correction.
  //
  // It exists because the monthly close is only as trustworthy as the days
  // inside it, and HQ closes a month having never asked the five people who
  // could actually say whether it was complete.
  async getStationDay(locationId, businessDate) {
    const { data, error } = await supabase.rpc("station_day_summary", {
      p_location: locationId, p_date: businessDate,
    });
    if (error) throw error;
    // A set-returning function comes back as an array of one row.
    return (Array.isArray(data) ? data[0] : data) || null;
  },

  // [2026-09-09 v2] The recent days at one station, newest first.
  //
  // Confirming only "today" was wrong about how the stations work: buying
  // runs into the evening and the office staff go home, so a day is often
  // confirmed the next morning — or later, if the next day is busy too. A
  // design that only allows today means the day never gets confirmed at
  // all, and the signature is worthless.
  //
  // Days the station had no activity are left out by the database, so
  // nobody is asked to confirm a day they were closed.
  async getStationDays(locationId, days = 7) {
    const { data, error } = await supabase.rpc("station_days_recent", {
      p_location: locationId, p_days: days,
    });
    if (error) throw error;
    return data || [];
  },

  // paperCount is the number of ticket stubs in the station's own book for
  // that day. It is the whole point of the daily close: the system can only
  // count what ARRIVED, so a ticket whose transaction never landed is not
  // "missing" from our view — it was never here. The paper in the station's
  // hand is the only evidence it existed.
  //
  // missingTicketNo is optional and only meaningful when the counts differ.
  // A number turns "something is wrong at Jomnoum" into "find CN 000742".
  async closeStationDay({ locationId, businessDate, paperCount, missingTicketNo, note }) {
    const { data, error } = await supabase.rpc("close_station_day", {
      p_location: locationId,
      p_date: businessDate,
      p_paper_count: paperCount,
      p_missing_ticket_no: missingTicketNo || null,
      p_note: note || null,
    });
    if (error) throw error;
    return data;
  },

  // The day's paper ticket numbers, in order. Fetched ONLY after the counts
  // disagree — on an ordinary day the station answers one question and never
  // sees this list. Books are sequential, so a break in the run is very
  // likely the missing one; it is a suggestion, never an answer.
  async getStationDayTickets(locationId, businessDate) {
    const { data, error } = await supabase.rpc("station_day_tickets", {
      p_location: locationId, p_date: businessDate,
    });
    if (error) throw error;
    return data || [];
  },

  // HQ's side: days a station has confirmed that HQ has not accepted, plus
  // any day accepted while a count gap still stands.
  async getDaysAwaitingHq(days = 14) {
    const { data, error } = await supabase.rpc("days_awaiting_hq", { p_days: days });
    if (error) throw error;
    return data || [];
  },

  async hqAcceptDay({ locationId, businessDate, note }) {
    const { data, error } = await supabase.rpc("hq_accept_day", {
      p_location: locationId, p_date: businessDate, p_note: note || null,
    });
    if (error) throw error;
    return data;
  },

  async reopenStationDay({ locationId, businessDate, reason }) {
    const { data, error } = await supabase.rpc("reopen_station_day", {
      p_location: locationId, p_date: businessDate, p_reason: reason,
    });
    if (error) throw error;
    return data;
  },

  // [2026-09-09] Monthly close — the four calls behind the Monthly Close panel
  // in SettingsPage.jsx. All four are thin wrappers over database functions
  // (period_lock_COMPLETE_2026-09-09.sql); none of the rules live here, so
  // closing from this screen and closing from the SQL editor behave
  // identically and cannot drift apart.
  //
  // Note the naming: getPeriodStatus starts with "get" so a view-only account
  // can still READ which months are closed (api.js's proxy allows get*),
  // while closePeriod / reopenPeriod do not, so it cannot close or reopen.
  async getPeriodStatus() {
    const [{ data: closedThrough, error: e1 }, { data: history, error: e2 }] = await Promise.all([
      supabase.rpc("current_closed_through"),
      supabase.from("period_locks").select("*").order("id", { ascending: false }).limit(24),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    // created_by is a bare uuid — period_locks has no foreign key to profiles,
    // deliberately, so a close survives the deletion of whoever made it.
    const ids = [...new Set((history || []).map((h) => h.created_by).filter(Boolean))];
    let names = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      names = Object.fromEntries((profs || []).map((p) => [p.id, p.full_name]));
    }
    return {
      closedThrough: closedThrough || null,
      history: (history || []).map((h) => ({
        ...h,
        userName: h.created_by ? (names[h.created_by] || "—") : "SQL editor",
      })),
    };
  },

  // Read-only. Returns the FIX FIRST / HAVE A LOOK / READY rows for a period.
  async getPeriodCheck(fromDate, toDate) {
    const { data, error } = await supabase.rpc("period_ready_check", { p_from: fromDate, p_to: toDate });
    if (error) throw error;
    return data || [];
  },

  // The database refuses this if the period still has FIX FIRST problems,
  // unless force is true — and records what was closed over when it is. That
  // rule is not repeated here on purpose: one owner for it, in the database.
  async closePeriod({ through, reason, force = false }) {
    const { data, error } = await supabase.rpc("close_period", {
      p_through: through, p_reason: reason || null, p_force: !!force,
    });
    if (error) throw error;
    return data;
  },

  async reopenPeriod({ backTo, reason }) {
    const { data, error } = await supabase.rpc("reopen_period", { p_back_to: backTo, p_reason: reason });
    if (error) throw error;
    return data;
  },

  // [2026-09-09] Data Check — the two reads behind DataCheck.jsx.
  //
  // Why this page exists: on 07/09 Jomnoum's CN 000261 finished with the
  // two scale readings in the wrong boxes (the empty weighing was never
  // taken, so staff put the loaded weight in the first field). The net
  // computed as -33,780 kg, got clamped to zero, and the station looked
  // like it still held 33,780 kg of rice it had already shipped. Nobody
  // could see it for six days — it was only found because the stock
  // total looked strange.
  //
  // The weighing ticket is the physical record: what the scale read, at
  // the moment the truck was on the bridge. The transaction is a COPY of
  // it, and everything downstream (stock, receipts, reports) runs on the
  // copy. v_ticket_mismatches (ticket_mismatch_view_v2.sql) compares the
  // two and reports three faults — a copy that no longer matches its
  // ticket, a station weight of exactly zero against a real load, and a
  // ticket that is impossible on its face. An empty list is the normal
  // state, which is the only reason a list like this stays worth reading.
  async getTicketMismatches() {
    // [2026-09-09] Paged — a watchdog that silently stops listing faults at
    // 1,000 is worse than no watchdog.
    const data = await fetchAll(
      () => supabase.from("v_ticket_mismatches").select("*"),
      { keyColumn: "transaction_id", sort: desc("tx_date") });
    return data || [];
  },

  // row_history (row_history_2026-09-09.sql) is the database's own record
  // of every insert/update/delete on the 15 tables that hold money, weight,
  // stock and permissions. It is written by a trigger rather than by this
  // app, so it also captures changes made in the Supabase editor, and it
  // cannot be edited or deleted by anyone — including this app.
  //
  // audit_logs (getAuditLogs above) is a different thing and stays: it
  // records INTENT ("someone edited a transaction") in the app's own
  // words. This records FACT — every column, before and after. The weight
  // fields are not in audit_logs at all, which is exactly why CN 000261's
  // correction left no trace anywhere.
  // [2026-09-09] Which transactions have been corrected since history
  // recording began. Reads v_transaction_edits (transaction_edits_view_
  // 2026-09-09.sql), which counts only changes to weight, money or the
  // business date — a note or plate correction is not worth a badge, and a
  // cancellation already shows as Cancelled.
  //
  // Returns a plain map so the list can look each row up with no extra
  // work: { [transactionId]: { edit_count, last_changed_at } }.
  //
  // Deliberately NOT fatal: a station that has not had this view created
  // yet, or an older browser tab, gets an empty map and a list with no
  // badges — the same list it shows today. A missing badge must never
  // break the Transactions screen.
  async getTransactionEdits() {
    // Paged, and still deliberately soft-fail: a missing view must never
    // break the Transactions screen.
    let data;
    try {
      data = await fetchAll(
        () => supabase.from("v_transaction_edits").select("transaction_id, edit_count, last_changed_at"),
        { keyColumn: "transaction_id" });
    } catch (e) {
      console.warn("[edits] badge data unavailable:", e.message);
      return {};
    }
    return Object.fromEntries((data || []).map((r) => [r.transaction_id, r]));
  },

  async getRowHistory({ ticketNo, recordId, limit = 100 } = {}) {
    const base = () => supabase
      .from("row_history")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(limit);

    let rows = [];
    const q = (ticketNo || "").trim();
    // recordId wins when given — that is the badge asking "what changed on
    // THIS transaction", which is exact, rather than a ticket-number search.
    if (recordId) {
      const { data, error } = await base().eq("record_id", recordId);
      if (error) throw error;
      rows = data || [];
    } else if (q) {
      // Two passes rather than one `or()` filter: paper ticket numbers
      // contain spaces ("CN 000261"), which PostgREST's or() syntax does
      // not survive. A delete only has old_data, an insert only new_data,
      // so both sides have to be asked.
      const [newSide, oldSide] = await Promise.all([
        base().eq("new_data->>paper_ticket_no", q),
        base().eq("old_data->>paper_ticket_no", q),
      ]);
      if (newSide.error) throw newSide.error;
      if (oldSide.error) throw oldSide.error;
      const seen = new Set();
      rows = [...(newSide.data || []), ...(oldSide.data || [])].filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      }).sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
    } else {
      const { data, error } = await base();
      if (error) throw error;
      rows = data || [];
    }

    // changed_by is a plain uuid — row_history has no foreign key to
    // profiles (deliberately: a history row must survive the deletion of
    // the user who made it). Names are looked up separately and a missing
    // one degrades to the raw id rather than failing the whole read.
    const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))];
    let names = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      names = Object.fromEntries((profs || []).map((p) => [p.id, p.full_name]));
    }
    return rows.map((r) => ({
      ...r,
      userName: r.changed_by ? (names[r.changed_by] || "—") : "Database / SQL editor",
    }));
  },

  // [2026-09-09] Voided payments are excluded here, which is what makes a
  // cancelled transaction come to zero in Cash Flow. Before this, cancelling
  // took the rice off the books and left the cash on them — the one report
  // that didn't already exclude a cancelled transaction, because it reads
  // payments rather than transactions and a payment had no idea.
  // `from` / `to` are Cambodia calendar dates matched against pay_date —
  // see getTransactions above for why this moved into the query.
  // [2026-09-12] `transactionIds` — the bound the report pages actually
  // needed.
  //
  // Purchases, Sales, Payables and Receivables all filter TRANSACTIONS by
  // the chosen period but fetched EVERY payment ever recorded, and the
  // reason was sound: a sale made in September can be paid in November, so
  // narrowing payments to the period would make paid rows look unpaid.
  //
  // But the honest bound was never the date — it is the transactions on
  // screen. A payment against a transaction that is not in this report can
  // never affect it. Passing the ids the page just loaded gives exactly
  // the right answer AND stops the fetch growing with ten years of
  // history: at year 5 those four reports were dominated by a 185,000-row
  // payment download whatever period was chosen.
  //
  // An empty array means "no transactions, so no payments" and returns
  // [] without asking the server — not "no filter", which is the classic
  // way a bound like this turns into a full table scan.
  //
  // Chunked because a PostgREST `in.(...)` list travels in the URL, and a
  // few thousand uuids would exceed what servers accept.
  async getPayments({ locationId, type, includeVoided = false, from, to, transactionIds } = {}) {
    // [2026-09-09] Paged — see fetchAll. The dashboard's money position and
    // the Cash Flow report both read every payment; capped at 1,000 they were
    // simply wrong once the table grew past that.
    const base = (q) => {
      let query = q;
      if (!includeVoided) query = query.is("voided_at", null);
      if (locationId) query = query.eq("location_id", locationId);
      if (Array.isArray(type)) query = query.in("type", type);
      else if (type) query = query.eq("type", type);
      if (from) query = query.gte("pay_date", from);
      if (to) query = query.lte("pay_date", to);
      return query;
    };
    let data;
    if (transactionIds) {
      const ids = [...new Set(transactionIds.filter(Boolean))];
      if (ids.length === 0) return [];
      const CHUNK = 200;
      const chunks = [];
      for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
      const pages = await Promise.all(
        chunks.map((chunk) =>
          fetchAll(() => base(supabase.from("payments").select("*, profiles(full_name)")).in("transaction_id", chunk),
            { sort: desc("pay_date", "created_at") })
        )
      );
      // A payment belongs to exactly one transaction, so chunks cannot
      // overlap — but de-duplicate by id anyway rather than trusting that.
      const seen = new Set();
      data = [];
      for (const page of pages) for (const p of page) if (!seen.has(p.id)) { seen.add(p.id); data.push(p); }
    } else {
      data = await fetchAll(() => base(supabase.from("payments").select("*, profiles(full_name)")),
        { sort: desc("pay_date", "created_at") });
    }
    return data.map((p) => ({ ...p, createdByName: p.profiles?.full_name || "—" }));
  },

  // `id` is optional — passed by the offline queue when a payment was
  // already recorded locally (client-generated UUID) while offline, so a
  // retried sync reuses that same id instead of recording it twice.
  // `category` is optional and only meaningful for type "expense" (see
  // Expenses.jsx) — every other caller (Cash Flow's own manual entries,
  // partner capital/bank loan mirroring) simply omits it, which leaves the
  // column null exactly as before this was added.
  async createPayment({ id, type, transactionId, locationId, amount, method, payDate, memo, userId, category }) {
    const row = {
      ...(id ? { id } : {}),
      type,
      transaction_id: transactionId || null,
      location_id: locationId,
      amount,
      method,
      pay_date: payDate,
      memo,
      created_by: userId,
      ...(category !== undefined ? { category } : {}),
    };
    // [2026-09-11] Double-payment guard for the screens that do NOT send
    // a client id.
    //
    // The offline queue always supplies one, so a retried sync of the
    // same payment is recognised and fetched rather than written twice
    // (see insertOrFetchExisting). The Record Payment modal, the Edit ->
    // mark Paid action, Expenses and Cash Flow all call this directly
    // with no id at all — and every request in the app has an 8-second
    // cutoff. So a payment that COMMITS on the server but answers too
    // slowly surfaces to the user as a failure, the button re-enables,
    // and the natural second press writes a second real payment against
    // the same purchase. Nothing downstream would ever flag it: two
    // legitimate-looking rows, and a farmer or buyer recorded as paid
    // twice.
    //
    // An identical payment — same transaction, same type, same amount,
    // same day — recorded within the last two minutes is that retry, not
    // a second genuine payment. Returned as-is instead of inserted. A
    // real second instalment of the exact same amount on the same day is
    // possible in principle; two minutes apart, to the riel, is not.
    if (!id && transactionId && amount != null) {
      try {
        // [2026-09-19] Three holes closed in this match:
        //   · it ignored voided rows — so voiding a 1,000,000 ៛ bank payment
        //     and re-entering it as cash within two minutes handed back the
        //     VOIDED row, the screen said "saved", and nothing was recorded;
        //   · it ignored the method — so a farmer paid in two equal halves,
        //     one cash and one bank, lost the second half;
        //   · it used this PC's own clock — Thapedey's is hours out, which
        //     stretches "two minutes" to hours, or switches the guard off.
        const cutoff = new Date(getAccurateNow().getTime() - 2 * 60 * 1000).toISOString();
        let q = supabase
          .from("payments")
          .select("*")
          .eq("transaction_id", transactionId)
          .eq("type", type)
          .eq("amount", amount)
          .is("voided_at", null)
          .gte("created_at", cutoff);
        q = method ? q.eq("method", method) : q.is("method", null);
        const { data: recent } = await q.limit(1);
        if (recent && recent.length) return recent[0];
      } catch {
        // A failed lookup must never block a real payment — fall through
        // and insert, which is the behaviour that existed before this.
      }
    }
    return insertOrFetchExisting("payments", row);
  },
};

// [2026-09-01] Final backstop for view-only accounts (see
// viewOnlyGuard.js) — every write in the app eventually funnels through
// one of the methods above, whether directly (Users/Roles/Settings/
// Locations/Stock/Expenses/Change Requests, which call `api.*` straight
// away) or indirectly (tickets/transactions/payments/parties/products,
// which go through offlineQueue.js first and reach these same methods
// only once a sync actually runs). Rather than hand-adding a check to
// every individual write method above — 30+ of them, and an easy place to
// eventually miss one when a new method gets added later — this wraps the
// whole object in a Proxy that blocks EVERY method except the read-only
// ones by name convention. Every method in this file already follows that
// convention consistently (see the full list above): `get*`/`list*` read,
// everything else writes. A future method keeps this protection for free
// as long as it follows the same naming convention.
const ALWAYS_ALLOWED = new Set([
  // Self-service device presence / logout acknowledgement — not business
  // data, and blocking these would break a view-only account's own
  // session (e.g. it would never be able to acknowledge being signed out
  // by an admin).
  "touchLastSeen",
  "acknowledgeLogout",
  // [2026-09-16] Reporting which version this browser is running is device
  // presence, not business data, and a view-only account must still appear
  // on the HQ version list — otherwise the one screen that says who is
  // behind would have a blind spot exactly where nobody is watching.
  "reportAppVersion",
  // Same reasoning: a view-only account is still a machine somebody is signed
  // in on, and the one screen that says who is in the system must not have a
  // blind spot exactly where nobody is watching.
  "reportDevice",
]);

function isReadOnlyMethodName(name) {
  return name.startsWith("get") || name.startsWith("list") || ALWAYS_ALLOWED.has(name);
}

export const api = new Proxy(rawApi, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== "function" || isReadOnlyMethodName(prop)) return value;
    return function guardedApiMethod(...args) {
      if (isViewOnlyMode()) return Promise.reject(new ViewOnlyError());
      return value.apply(target, args);
    };
  },
});
