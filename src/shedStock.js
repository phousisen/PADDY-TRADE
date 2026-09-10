// [2026-09-10] "What's in the shed" — what is actually sitting at one
// station right now, split by paddy type.
//
// Built as its own pure module, like dailyLedger.js, for one reason: this
// math has to be testable on its own. Every wrong number this app has shown
// came from arithmetic that lived inside a component where nothing could
// check it. See scripts-check-shed.mjs for the fixtures that do.
//
// THE ONE RULE: the parts must add up to the station's own stock figure, and
// if they don't the panel says so rather than quietly showing a wrong split.
//
//     last stock count  +  (bought − sold, by type, since that count)
//                       =  current_stock_kg
//
// WHY THE "LAST STOCK COUNT" ANCHOR
//
// A stock adjustment is ABSOLUTE and UNTYPED. It declares the whole shed's
// weight — dailyLedger.js sets the running total to `new_stock_kg`, it does
// not add to it — and it never records which paddy type it applied to. So
// every buy and sell before the most recent adjustment has already been
// superseded by that count; splitting all-time trades by type would count
// them a second time. The walk below therefore starts at the last
// adjustment and carries its figure forward as one untyped lump, which the
// panel shows as its own tile. It is not spread across the types: nothing
// in the data says which type it is, and spreading it would be a guess
// printed as a fact.

// Cambodia's calendar date for a moment. Same helper as everywhere else in
// this app; kept local so this module imports nothing.
function cambodiaDateStr(d) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// created_at is the real moment a row was written; tx_date is the day staff
// assigned it, which can be back-dated. Whether a trade lands before or
// after a stock count is a question about real time, so created_at wins;
// tx_date at midday Cambodia is only the fallback for a row without one.
function tsOf(tx) {
  if (tx.created_at) return new Date(tx.created_at).getTime();
  if (tx.tx_date) return new Date(`${tx.tx_date}T12:00:00+07:00`).getTime();
  return 0;
}

export const SHED_UNTYPED_KEY = " untyped";
export const SHED_OTHER_KEY = " other";

/**
 * @param txs         every transaction for THIS station (any status)
 * @param adjustments every stock_adjustments row (any station — filtered here)
 * @param location    the station row, for current_stock_kg
 * @param now         Date — the app's accurate clock, injected so tests can fix it
 * @param sparkDays   how many days of history each sparkline covers
 * @param maxTiles    how many tiles before the tail folds into "Other"
 */
export function buildShed({ txs, adjustments, location, now, sparkDays = 14, maxTiles = 6 }) {
  if (!location) return null;
  const stockKg = Number(location.current_stock_kg) || 0;

  const adjHere = (adjustments || [])
    .filter((a) => a.location_id === location.id && a.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const lastAdj = adjHere.length ? adjHere[adjHere.length - 1] : null;
  const anchorTs = lastAdj ? new Date(lastAdj.created_at).getTime() : -Infinity;
  const carriedKg = lastAdj ? Number(lastAdj.new_stock_kg) || 0 : 0;

  // The sparkline window: the last `sparkDays` calendar days, oldest first.
  const days = [];
  for (let i = sparkDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(cambodiaDateStr(d));
  }
  const startDay = days[0];
  const lastDay = days[days.length - 1];

  const byType = new Map();
  for (const tx of txs || []) {
    if ((tx.hq_status || "processing") === "cancelled") continue;
    const ts = tsOf(tx);
    if (ts <= anchorTs) continue;
    const name = tx.productName && tx.productName !== "—" ? tx.productName : null;
    const key = name || SHED_UNTYPED_KEY;
    const delta = (tx.type === "BUY" ? 1 : -1) * (Number(tx.quantity_kg) || 0);
    let day = tx.tx_date || cambodiaDateStr(new Date(ts));
    // A forward-dated ticket (rare, but staff can pick any date) is drawn on
    // the last day of the window rather than off the end of it, so the line
    // always ends at the same number the tile shows.
    if (day > lastDay) day = lastDay;
    const row = byType.get(key) || { key, name, kg: 0, before: 0, byDay: new Map() };
    row.kg += delta;
    if (day < startDay) row.before += delta;
    else row.byDay.set(day, (row.byDay.get(day) || 0) + delta);
    byType.set(key, row);
  }

  const typed = [...byType.values()]
    .map((row) => {
      let run = row.before;
      const series = days.map((d) => (run += row.byDay.get(d) || 0));
      return { key: row.key, name: row.name, kg: row.kg, series };
    })
    .filter((r) => Math.abs(r.kg) > 0.005)
    .sort((a, b) => b.kg - a.kg);

  const typedKg = typed.reduce((s, r) => s + r.kg, 0);
  const computed = carriedKg + typedKg;

  // More than `maxTiles` tiles stops being readable, so the tail folds into
  // one "Other" tile. Its kg is the sum of what it replaces and typedKg is
  // taken before the fold, so folding never changes what the panel adds up
  // to — only how many boxes it draws.
  const tiles = typed.length > maxTiles
    ? typed.slice(0, maxTiles - 1).concat([{
        key: SHED_OTHER_KEY,
        name: null,
        other: true,
        kg: typed.slice(maxTiles - 1).reduce((s, r) => s + r.kg, 0),
        count: typed.length - (maxTiles - 1),
        series: null,
      }])
    : typed;

  return {
    stockKg,
    carriedKg,
    countedOn: lastAdj ? cambodiaDateStr(new Date(lastAdj.created_at)) : null,
    types: typed,
    tiles,
    typedKg,
    computed,
    // What the panel checks before it trusts its own split.
    diff: stockKg - computed,
  };
}
