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

  async getParties({ type, q } = {}) {
    let query = supabase.from("parties").select("*").order("name");
    if (type) query = query.eq("type", type);
    if (q) query = query.ilike("name", `%${q}%`);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async createParty({ name, type, phone, idNumber, bankName, bankAccount, company, destination }) {
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

  async createTransaction({ type, locationId, partyId, productId, quantityKg, pricePerKg, paymentStatus, userId, qualityGrade }) {
    const amount = Math.round(quantityKg * pricePerKg * 100) / 100;
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
};
