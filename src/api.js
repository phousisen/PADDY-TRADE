import { supabase } from "./supabaseClient.js";

function genCode(type) {
  const n = Math.floor(1000 + Math.random() * 8999);
  return type === "BUY" ? `RCP-${n}-A` : `INV-${n}-B`;
}

export const api = {
  async getLocations() {
    const { data, error } = await supabase.from("locations").select("*").order("name");
    if (error) throw error;
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

  async updateProfileRole(id, { roleId, locationId }) {
    const patch = {};
    if (roleId !== undefined) patch.role_id = roleId;
    if (locationId !== undefined) patch.location_id = locationId;
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", id).select().single();
    if (error) throw error;
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

  async getProducts() {
    const { data, error } = await supabase.from("products").select("*").order("name");
    if (error) throw error;
    return data;
  },

  async createProduct(name) {
    const { data, error } = await supabase.from("products").insert({ name }).select().single();
    if (error) throw error;
    return data;
  },

  async getParties({ type, q, phone } = {}) {
    let query = supabase.from("parties").select("*").order("name");
    if (type) query = query.eq("type", type);
    if (q) query = query.ilike("name", `%${q}%`);
    if (phone) query = query.eq("phone", phone);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async createParty({ name, type, phone, idNumber, bankName, bankAccount, company, destination, locationId }) {
    const { data, error } = await supabase
      .from("parties")
      .insert({
        name,
        type,
        phone,
        id_number: idNumber,
        bank_name: bankName,
        bank_account: bankAccount,
        company,
        destination,
        location_id: locationId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
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
      .select("*, locations(name), parties(name, id_number), products(name)")
      .order("created_at", { ascending: false });
    if (type) query = query.eq("type", type);
    if (locationId) query = query.eq("location_id", locationId);
    const { data, error } = await query;
    if (error) throw error;
    return data.map((t) => ({
      ...t,
      stationName: t.locations?.name || "—",
      partyName: t.parties?.name || "—",
      partyIdNumber: t.parties?.id_number || "",
      productName: t.products?.name || "—",
    }));
  },

  async createTransaction({ type, locationId, partyId, productId, quantityKg, pricePerKg, paymentStatus, userId, qualityGrade, taxApplicable, taxRate, moisturePct, mixturePct, outthrowPct, deductionKg, note, receiptPhotoUrl, paymentProofUrl }) {
    const payableKg = Math.max(0, quantityKg - (deductionKg || 0));
    const amount = Math.round(payableKg * pricePerKg * 100) / 100;
    const { data, error } = await supabase
      .from("transactions")
      .insert({
        code: genCode(type),
        type,
        location_id: locationId,
        party_id: partyId,
        product_id: productId,
        quantity_kg: quantityKg,
        price_per_kg: pricePerKg,
        amount,
        payment_status: paymentStatus,
        created_by: userId,
        quality_grade: qualityGrade || null,
        tax_applicable: !!taxApplicable,
        tax_rate: taxApplicable ? (taxRate || 0) : 0,
        moisture_pct: moisturePct || 0,
        mixture_pct: mixturePct || 0,
        outthrow_pct: outthrowPct || 0,
        deduction_kg: deductionKg || 0,
        note: note || null,
        receipt_photo_url: receiptPhotoUrl || null,
        payment_proof_url: paymentProofUrl || null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getChangeRequests() {
    const { data, error } = await supabase
      .from("change_requests")
      .select("*, transactions(code), profiles!change_requests_requested_by_fkey(full_name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.map((r) => ({
      ...r,
      transactionCode: r.transactions?.code || "—",
      requestedByName: r.profiles?.full_name || "—",
    }));
  },

  async createChangeRequest({ transactionId, requestedBy, locationId, reason }) {
    const { data, error } = await supabase
      .from("change_requests")
      .insert({ transaction_id: transactionId, requested_by: requestedBy, location_id: locationId, reason })
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

  async updateTransaction(id, { quantityKg, pricePerKg, paymentStatus, qualityGrade, taxApplicable, taxRate, deductionKg }) {
    const payableKg = Math.max(0, quantityKg - (deductionKg || 0));
    const amount = Math.round(payableKg * pricePerKg * 100) / 100;
    const { data, error } = await supabase
      .from("transactions")
      .update({
        quantity_kg: quantityKg, price_per_kg: pricePerKg, amount, payment_status: paymentStatus, quality_grade: qualityGrade || null,
        tax_applicable: !!taxApplicable, tax_rate: taxApplicable ? (taxRate || 0) : 0,
        ...(deductionKg !== undefined ? { deduction_kg: deductionKg || 0 } : {}),
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

  async createPayment({ type, transactionId, locationId, amount, method, payDate, memo, userId }) {
    const { data, error } = await supabase
      .from("payments")
      .insert({
        type,
        transaction_id: transactionId || null,
        location_id: locationId,
        amount,
        method,
        pay_date: payDate,
        memo,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
