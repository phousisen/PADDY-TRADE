// [2026-09-19] Stock broken down by paddy type — ONE rule, used by Stock
// Inventory's "Stock by Paddy Type" and by the Sell screen's "in stock" list.
//
// The database keeps one stock figure per station, not one per type, so the
// breakdown is rebuilt by replaying the station's history in time order:
//
//   - a Buy adds its weighed net (quantity_kg) to its type, a Sell takes it
//     away. Deductions are a PRICE adjustment only — the paddy stays in the
//     pile — so they are not subtracted (confirmed 2026-09-01).
//   - a stock count or loss changes the station's total without saying which
//     type was lost. The types are scaled together so they add up to the new
//     total: a 10% loss takes 10% of each type. A reset to 0 empties them all.
//
// Before this, the two screens disagreed: Stock Inventory treated ANY count —
// even a small loss entered at midday — as "everything before this is gone",
// which emptied every type after a daytime count (audit F4); the Sell list
// ignored counts altogether and subtracted deductions (it said types were in
// stock that had been written off).
//
// This is an estimate by construction and is labelled as one on screen.

const num = (v) => Number(v) || 0;

/**
 * @param txs          transactions (any stations; cancelled ones are skipped)
 * @param adjustments  stock_adjustments rows (adjustment_kg is the signed change)
 * @param locationId   the station to rebuild
 * @returns {Object<string, number>}  product_id -> kg (never below 0)
 */
export function stockByType({ txs = [], adjustments = [], locationId }) {
  const events = [];
  for (const tx of txs) {
    if (tx.location_id !== locationId || !tx.product_id) continue;
    if ((tx.hq_status || "processing") === "cancelled") continue;
    const at = tx.created_at || `${tx.tx_date}T${tx.tx_time || "00:00:00"}+07:00`;
    events.push({ at: Date.parse(at) || 0, kind: "tx", tx });
  }
  for (const a of adjustments) {
    if (a.location_id !== locationId || !a.created_at) continue;
    events.push({ at: Date.parse(a.created_at) || 0, kind: "adj", a });
  }
  // Same instant: the transaction first, so a count entered right after a
  // ticket counts that ticket.
  events.sort((x, y) => x.at - y.at || (x.kind === y.kind ? 0 : x.kind === "tx" ? -1 : 1));

  const byType = {};
  for (const e of events) {
    if (e.kind === "tx") {
      const kg = num(e.tx.quantity_kg);
      byType[e.tx.product_id] = (byType[e.tx.product_id] || 0) + (e.tx.type === "BUY" ? kg : -kg);
      continue;
    }
    // Only what is actually there can be scaled: a type sold below zero
    // (paddy sold under the wrong type) holds nothing to lose.
    for (const id of Object.keys(byType)) if (byType[id] < 0) byType[id] = 0;
    const before = Object.values(byType).reduce((s, v) => s + v, 0);
    const after = before + num(e.a.adjustment_kg);
    if (e.a.reason === "reset" || after <= 0.005 || before <= 0.005) {
      if (after <= 0.005 || e.a.reason === "reset") for (const id of Object.keys(byType)) byType[id] = 0;
      // A count that FINDS paddy on an empty book cannot say which type it
      // is, so it is not shown against any.
      continue;
    }
    const f = after / before;
    for (const id of Object.keys(byType)) byType[id] *= f;
  }
  for (const id of Object.keys(byType)) if (byType[id] < 0) byType[id] = 0;
  return byType;
}

/**
 * Average BUYING price per kg of each type, weighted by weight — what a kg of
 * that type in the shed cost. The old figure averaged the price of every
 * ticket equally, Buys and Sells together, so one small premium load counted
 * as much as a 30-tonne truck (audit F3).
 */
export function avgCostByType(txs = [], locationId = null) {
  const kg = {}, amt = {};
  for (const tx of txs) {
    if (tx.type !== "BUY" || !tx.product_id) continue;
    if ((tx.hq_status || "processing") === "cancelled") continue;
    if (locationId && tx.location_id !== locationId) continue;
    const q = num(tx.quantity_kg), p = num(tx.price_per_kg);
    if (q <= 0 || p <= 0) continue;
    kg[tx.product_id] = (kg[tx.product_id] || 0) + q;
    amt[tx.product_id] = (amt[tx.product_id] || 0) + q * p;
  }
  const out = {};
  for (const id of Object.keys(kg)) out[id] = amt[id] / kg[id];
  return out;
}
