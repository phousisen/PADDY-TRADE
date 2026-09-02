import { supabase, getAccurateNow } from "./supabaseClient.js";
import { isViewOnlyMode, ViewOnlyError } from "./viewOnlyGuard.js";

// Widened from a 4-digit (1000-9999, ~9,000 possible values) space to
// 6-digit (~900,000) — the 4-digit space was small enough that, across two
// stations' worth of tickets over time, random collisions had become a
// real, recurring occurrence rather than a theoretical one (see
// insertWithFreshCodeOnCollision above for how a collision is now also
// recovered from automatically, rather than getting permanently stuck).
function genCode(type) {
  const n = Math.floor(100000 + Math.random() * 899999);
  return type === "BUY" ? `RCP-${n}-A` : `INV-${n}-B`;
}

function genTicketCode() {
  const n = Math.floor(100000 + Math.random() * 899999);
  return `TKT-${n}`;
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

const rawApi = {
  async getLocations() {
    const { data, error } = await supabase.from("locations").select("*").order("name");
    if (error) throw error;
    return data;
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
    const { data, error } = await supabase.from("profiles").select("*, locations(name), roles(id, name, scope, permissions)").order("full_name");
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

  async updateProfileRole(id, { roleId, locationId, role, fullName }) {
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
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", id).select().single();
    if (error) throw error;
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
    const { data, error } = await supabase.from("roles").select("*").order("scope").order("name");
    if (error) {
      console.warn("Roles table not available yet:", error.message);
      return [];
    }
    return data;
  },

  async createRole({ name, scope, permissions }) {
    const { data, error } = await supabase.from("roles").insert({ name, scope, permissions }).select().single();
    if (error) throw error;
    return data;
  },

  async updateRole(id, { name, scope, permissions }) {
    const { data, error } = await supabase.from("roles").update({ name, scope, permissions }).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteRole(id) {
    const { error } = await supabase.from("roles").delete().eq("id", id);
    if (error) throw error;
  },

  async updateLocation(id, { name, nameKh }) {
    const { data, error } = await supabase.from("locations").update({ name, name_kh: nameKh }).eq("id", id).select().single();
    if (error) throw error;
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
    let query = supabase
      .from("stock_adjustments")
      .select("*, locations(name), profiles(full_name)")
      .order("created_at", { ascending: false });
    if (locationId) query = query.eq("location_id", locationId);
    // created_at is a full timestamp, not a plain date — bracket the whole
    // day in Cambodia's own calendar (UTC+7, no DST) rather than UTC's, so
    // "Today"/"This Week" from the shared Reports date filter lines up
    // with what staff actually mean by "today" at the station.
    if (startDate) query = query.gte("created_at", `${startDate}T00:00:00+07:00`);
    if (endDate) query = query.lte("created_at", `${endDate}T23:59:59+07:00`);
    const { data, error } = await query;
    if (error) throw error;
    return data.map((a) => ({ ...a, stationName: a.locations?.name || "—", adjustedByName: a.profiles?.full_name || "—" }));
  },

  // `pricePerKg` is only ever meaningful for a LOSS (adjustmentKg < 0) — the
  // per-kg value used to put a real riel figure on paddy that's being
  // written off (moisture/spillage/a daily reset), typically the day's
  // weighted-average Buy price at that location (see StockInventory.jsx).
  // Left null for a gain (recount finding more than expected) or when no
  // price was available/entered — `valueLost` then stays null too rather
  // than silently computing off a missing price.
  async recordStockAdjustment({ locationId, previousStockKg, newStockKg, reason, note, userId, pricePerKg }) {
    const adjustmentKg = Math.round((newStockKg - previousStockKg) * 100) / 100;
    const valueLost = adjustmentKg < 0 && pricePerKg != null
      ? Math.round(Math.abs(adjustmentKg) * pricePerKg * 100) / 100
      : null;
    const { data, error } = await supabase
      .from("stock_adjustments")
      .insert({
        location_id: locationId,
        previous_stock_kg: previousStockKg,
        new_stock_kg: newStockKg,
        adjustment_kg: adjustmentKg,
        reason,
        note: note || null,
        adjusted_by: userId,
        price_per_kg: adjustmentKg < 0 ? (pricePerKg ?? null) : null,
        value_lost: valueLost,
      })
      .select()
      .single();
    if (error) throw error;
    // The only place in the whole app that intentionally SETS a location's
    // stock to an exact number rather than nudging it by one transaction's
    // weight — this is what actually makes the adjustment take effect.
    const { error: updateErr } = await supabase
      .from("locations")
      .update({ current_stock_kg: newStockKg, updated_ago: "just now" })
      .eq("id", locationId);
    if (updateErr) throw updateErr;
    return data;
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

  async createUserAccount({ email, password, fullName, roleId, locationId }) {
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
    // Small delay to let the DB trigger finish inserting the profile row first.
    await new Promise((r) => setTimeout(r, 700));
    const { error: updateError } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (updateError) throw updateError;
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
  async inviteUserAccount({ email, fullName, roleId, locationId }) {
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
    await new Promise((r) => setTimeout(r, 700));
    const { error: updateError } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (updateError) throw updateError;
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
    const row = id ? { id, name } : { name };
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
      if (error?.code === "23505" && name) {
        const { data: existing, error: fetchErr } = await supabase
          .from("products")
          .select("*")
          .ilike("name", name)
          .limit(1);
        if (!fetchErr && existing && existing.length) return existing[0];
      }
      throw error;
    }
  },

  // Partners (investors) at a location, and the running ledger of their
  // capital contributions/withdrawals. Admin-only (enforced by RLS) — see
  // migration_partner_capital_bank_loans.sql.
  async getPartners(locationId) {
    let query = supabase.from("partners").select("*, locations(name)").order("name");
    if (locationId) query = query.eq("location_id", locationId);
    const { data, error } = await query;
    if (error) throw error;
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

  async getPartnerCapitalEntries() {
    const { data, error } = await supabase
      .from("partner_capital_entries")
      .select("*, partners(name), locations(name)")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
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
    }
    return data;
  },

  // Bank loans (outside lenders) at a location — a flat borrow/repay
  // ledger, the same style as the payments table. Admin-only.
  async getBankLoans() {
    const { data, error } = await supabase
      .from("bank_loans")
      .select("*, locations(name)")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
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
  async getParties({ type, q, qPhone, phone, locationId } = {}) {
    let query = supabase.from("parties").select("*").order("name");
    if (type) query = query.eq("type", type);
    if (q) query = query.ilike("name", `%${q}%`);
    if (qPhone) query = query.ilike("phone", `%${qPhone}%`);
    if (phone) query = query.eq("phone", phone);
    if (locationId) query = query.eq("location_id", locationId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
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
  async updateParty(id, { name, phone, idNumber, bankName, bankAccount, bankQrUrl, idPhotoUrl, verifiedAt, verifiedBy }) {
    const patch = {};
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

  async getTransactions({ type, locationId } = {}) {
    let query = supabase
      .from("transactions")
      // address/phone: per-location fields (see add_location_address_phone.sql)
      // used on the printed receipt header — falls back to "—" below if a
      // location hasn't had them filled in yet.
      .select("*, locations(name, address, phone), parties(name, id_number), products(name)")
      .order("created_at", { ascending: false });
    if (type) query = query.eq("type", type);
    if (locationId) query = query.eq("location_id", locationId);
    const { data, error } = await query;
    if (error) throw error;
    return data.map((t) => ({
      ...t,
      stationName: t.locations?.name || "—",
      stationAddress: t.locations?.address || "",
      stationPhone: t.locations?.phone || "",
      partyName: t.parties?.name || "—",
      partyIdNumber: t.parties?.id_number || "",
      productName: t.products?.name || "—",
    }));
  },

  async createTransaction({ id, code, type, locationId, partyId, productId, quantityKg, pricePerKg, paymentStatus, userId, qualityGrade, taxApplicable, taxRate, moisturePct, mixturePct, outthrowPct, deductionKg, note, carPlate, driverName, receiptPhotoUrl, paymentProofUrl, txDate, staffFee, paperTicketNo, bankQrUrl, grossKg, grossAt, tareKg, tareAt, recordedByName }) {
    const payableKg = Math.max(0, quantityKg - (deductionKg || 0));
    // Staff/carrying fee (rare — only when our own staff carries the paddy
    // for a farmer who didn't bring labor) comes straight off what's paid,
    // same stage as the weight deduction above but in cash instead of kg.
    const amount = Math.round(Math.max(0, payableKg * pricePerKg - (staffFee || 0)) * 100) / 100;
    // `txDate` lets staff back-date an entry (e.g. logging a truckload the
    // next morning that was actually weighed the day before) — falls back
    // to right now, in Cambodia's timezone, if nothing was picked.
    const { date: defaultDate, time: txTime } = cambodiaNow();
    const row = {
      ...(id ? { id } : {}),
      code: code || genCode(type),
      type,
      tx_date: txDate || defaultDate,
      tx_time: txTime,
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
      quality_grade: qualityGrade || null,
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
      paper_ticket_no: paperTicketNo || null,
      bank_qr_url: bankQrUrl || null,
      recorded_by_name: recordedByName || null,
    };
    // `id` is optional — passed by finalizeTicket when a weighing ticket
    // is finalized offline, so a retried sync reuses the same id instead
    // of creating a second transaction.
    return insertWithFreshCodeOnCollision("transactions", row, () => genCode(type));
  },

  // Weighing Tickets — the digital version of the paper ticket that
  // travels between the scale and the drop-off area. A ticket moves
  // through stages (arrived -> weighed_in -> priced -> weighed_out ->
  // finalized), picked up by whichever staff member is handling that
  // stage, several in progress at once. Finalizing one creates a real
  // transaction via the existing createTransaction path above, so
  // everything downstream (reports, stock, AP/AR) is unaffected.

  async getTickets({ locationId, stages, limit } = {}) {
    let query = supabase
      .from("weighing_tickets")
      // address/phone: per-location fields (see add_location_address_phone.sql)
      // used on the printed Weigh-In Slip header.
      .select("*, locations(name, address, phone), gross_profile:gross_by(full_name), priced_profile:priced_by(full_name), tare_profile:tare_by(full_name), created_profile:created_by(full_name)")
      .order("created_at", { ascending: false });
    if (locationId) query = query.eq("location_id", locationId);
    if (stages && stages.length) query = query.in("stage", stages);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
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
  async createTicket({ id, code, type, locationId, partyId, partyName, phone, bankName, bankAccount, carPlate, driverName, productId, productName, userId, paperTicketNo, bankQrUrl, recordedByName, grossKg }) {
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
      paper_ticket_no: paperTicketNo || null,
      bank_qr_url: bankQrUrl || null,
      recorded_by_name: recordedByName || null,
    };
    return insertWithFreshCodeOnCollision("weighing_tickets", row, genTicketCode);
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
  async updateTicketInfo(id, { partyId, partyName, phone, carPlate, driverName, productId, productName, paperTicketNo, grossKg, userId }) {
    const patch = {};
    if (partyId !== undefined) patch.party_id = partyId || null;
    if (partyName !== undefined) patch.party_name = partyName;
    if (phone !== undefined) patch.phone = phone || null;
    if (carPlate !== undefined) patch.car_plate = carPlate || null;
    if (driverName !== undefined) patch.driver_name = driverName || null;
    if (productId !== undefined) patch.product_id = productId || null;
    if (productName !== undefined) patch.product_name = productName;
    if (paperTicketNo !== undefined) patch.paper_ticket_no = paperTicketNo || null;
    if (grossKg !== undefined) {
      patch.gross_kg = grossKg;
      patch.gross_at = getAccurateNow().toISOString();
      patch.gross_by = userId;
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
      throw error;
    }
    return data;
  },

  async setTicketPrice(id, { qualityGrade, moisturePct, mixturePct, outthrowPct, deductionKg, pricePerKg, staffFee, taxApplicable, taxRate, priceNote, userId, decline, bankName, bankAccount, bankQrUrl }) {
    const patch = {
      quality_grade: qualityGrade || null,
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
      .select()
      .single();
    if (error) {
      // Same reasoning as setTicketGross above: the ticket is gone, not a
      // real failure — nothing to retry.
      if (error.code === "PGRST116") return null;
      throw error;
    }
    return data;
  },

  async setTicketTare(id, { tareKg, userId }) {
    const { data, error } = await supabase
      .from("weighing_tickets")
      .update({ tare_kg: tareKg, tare_at: getAccurateNow().toISOString(), tare_by: userId, stage: "weighed_out" })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      if (error.code === "PGRST116") return null;
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
  async finalizeTicket(id, { userId, txDate, transactionId, transactionCode, receiptPhotoUrl }) {
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
    const tx = await this.createTransaction({
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
      paymentStatus: ticket.type === "BUY" ? "pending" : (ticket.price_per_kg == null ? "credit" : "paid"),
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
    const { error: updateErr } = await supabase
      .from("weighing_tickets")
      .update({ stage: "finalized", transaction_id: tx.id })
      .eq("id", id);
    if (updateErr) throw updateErr;
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
    if (ticket.transaction_id) {
      const { error: cancelErr } = await supabase
        .from("transactions")
        .update({ hq_status: "cancelled" })
        .eq("id", ticket.transaction_id);
      if (cancelErr) throw cancelErr;
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
    if (error) throw error;
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

  async getChangeRequests() {
    const { data, error } = await supabase
      .from("change_requests")
      .select(
        "*, transactions(id, code, type, quantity_kg, price_per_kg, payment_status, quality_grade, tax_applicable, tax_rate, deduction_kg, moisture_pct, mixture_pct, outthrow_pct, note, car_plate, driver_name, amount, party_id, staff_fee, paper_ticket_no, parties(name)), profiles!change_requests_requested_by_fkey(full_name)"
      )
      .order("created_at", { ascending: false });
    if (error) throw error;
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

  async resolveChangeRequest(id, status) {
    const { data, error } = await supabase.from("change_requests").update({ status }).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async updateHqStatus(id, hqStatus) {
    const { data, error } = await supabase.from("transactions").update({ hq_status: hqStatus }).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async updateTransaction(id, { quantityKg, pricePerKg, paymentStatus, qualityGrade, taxApplicable, taxRate, deductionKg, moisturePct, mixturePct, outthrowPct, note, carPlate, driverName, partyId, productId, txDate, staffFee, locationId, recordedByName, grossKg, grossAt, tareKg, tareAt, paperTicketNo }) {
    const payableKg = Math.max(0, quantityKg - (deductionKg || 0));
    const amount = Math.round(Math.max(0, payableKg * pricePerKg - (staffFee || 0)) * 100) / 100;
    const { data, error } = await supabase
      .from("transactions")
      .update({
        quantity_kg: quantityKg, price_per_kg: pricePerKg, amount, payment_status: paymentStatus, quality_grade: qualityGrade || null,
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
        // number, or none at all, had no way to be corrected. No
        // uniqueness check here (unlike the Weighing Tickets board's
        // duplicate warning) — this is a deliberate manual fix, not
        // day-to-day entry.
        ...(paperTicketNo !== undefined ? { paper_ticket_no: paperTicketNo || null } : {}),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
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

  async getPaymentsForTransaction(transactionId) {
    const { data, error } = await supabase
      .from("payments")
      .select("*, profiles(full_name)")
      .eq("transaction_id", transactionId)
      .order("created_at");
    if (error) throw error;
    return data.map((p) => ({ ...p, createdByName: p.profiles?.full_name || "—" }));
  },

  async updatePayment(id, amount) {
    const { data, error } = await supabase.from("payments").update({ amount }).eq("id", id).select().single();
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

  async getAuditLogs() {
    const { data, error } = await supabase.from("audit_logs").select("*, profiles(full_name)").order("created_at", { ascending: false });
    if (error) throw error;
    return data.map((l) => ({ ...l, userName: l.profiles?.full_name || "—" }));
  },

  async getPayments({ locationId, type } = {}) {
    let query = supabase.from("payments").select("*, profiles(full_name)").order("pay_date", { ascending: false }).order("created_at", { ascending: false });
    if (locationId) query = query.eq("location_id", locationId);
    if (type) query = query.eq("type", type);
    const { data, error } = await query;
    if (error) throw error;
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
