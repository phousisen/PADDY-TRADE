// [2026-09-03] Shared, pure (non-React) extraction of the day-by-day stock
// math that already powers StockInventory.jsx's "Daily Stock Ledger" table
// — pulled out into its own module so LocationDetail.jsx's phone-only
// per-location ledger (see the day-card design approved in the Claude
// Design canvas) can reuse the EXACT same, already-twice-bugfixed logic
// instead of re-deriving it a third time. See StockInventory.jsx's own
// comment above its buildDailyLedger() for the full history of what went
// wrong before and why the fixes below (same-day-after-reset activity,
// which calendar day an early-morning reset counts against) matter.
//
// Deliberately does NOT include the per-paddy-type ("byProduct") breakdown
// StockInventory.jsx's version also builds — that needs a product catalog
// and per-product average price that only that page currently loads, and
// no current design (StockInventory's own table or LocationDetail's day
// cards) needs it here. If a future caller does, extend `bucket()` /
// the per-day push below the same way StockInventory.jsx's local copy
// already does, rather than forking this file.

// Cambodia's current calendar date (YYYY-MM-DD) for an arbitrary moment —
// same helper duplicated (identically) across most pages in this app; kept
// duplicated here too rather than adding a new cross-cutting import, but
// this is now the one copy StockInventory.jsx's own ledger math relies on
// via effectiveAdjDateStr/buildDailyLedgerRows below.
export function cambodiaDateStr(d) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// The hour of day (0-23), Cambodia time — used to tell a "just after
// midnight" reset apart from one that genuinely happened during the day.
export function cambodiaHour(d) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", hour: "2-digit", hour12: false }).format(d));
}

// The calendar date a stock adjustment counts against. Same day its
// created_at falls on, EXCEPT a "Daily reset" done in the first few hours
// after midnight — the normal closing-out-the-night habit — which counts
// against the day before instead, so that day's row ends at a clean 0.00 kg
// and the new day opens fresh with only its own real activity.
export function effectiveAdjDateStr(a) {
  const at = new Date(a.created_at);
  if (a.reason === "reset" && cambodiaHour(at) < 4) {
    return cambodiaDateStr(new Date(at.getTime() - 24 * 60 * 60 * 1000));
  }
  return cambodiaDateStr(at);
}

// Builds one row per calendar day that had real activity (a transaction or
// a stock adjustment) at `locationId`: Opening (= previous day's Closing),
// Bought In / Spent, Sold Out / Earned, Adjusted (net kg from any stock
// adjustment(s) that day — negative for a loss/write-off, positive for a
// recount finding more than expected), Value Lost (riel, loss days only),
// and Closing. Replays every event in the order it actually happened (by
// real timestamp) so a same-day reset only ever wipes out what came before
// it — anything bought or sold after it that same day still lands on top
// of the new balance instead of being silently discarded.
//
// `txs` — every transaction visible to the caller (any location, any
// status); this function does its own active-status + location filtering.
// `adjustments` — every stock_adjustments row visible to the caller (any
// location); same filtering applied.
export function buildDailyLedgerRows({ txs, adjustments, locationId }) {
  const activeTxs = (txs || []).filter(
    (tx) => tx.location_id === locationId && tx.tx_date && (tx.hq_status || "processing") !== "cancelled"
  );
  const adjEvents = (adjustments || []).filter((a) => a.location_id === locationId && a.created_at);
  if (activeTxs.length === 0 && adjEvents.length === 0) return [];

  const byDate = {};
  function bucket(date) {
    return (byDate[date] = byDate[date] || { date, buyKg: 0, sellKg: 0, buyAmt: 0, sellAmt: 0, timeline: [] });
  }
  for (const tx of activeTxs) {
    const b = bucket(tx.tx_date);
    const kg = Number(tx.quantity_kg) || 0;
    const riel = Number(tx.total_with_tax ?? tx.amount) || 0;
    if (tx.type === "BUY") { b.buyKg += kg; b.buyAmt += riel; }
    else { b.sellKg += kg; b.sellAmt += riel; }
    b.timeline.push({ ts: tx.created_at ? new Date(tx.created_at).getTime() : 0, deltaKg: tx.type === "BUY" ? kg : -kg });
  }
  for (const a of adjEvents) {
    bucket(effectiveAdjDateStr(a)).timeline.push({ ts: new Date(a.created_at).getTime(), adj: a });
  }

  const dates = Object.keys(byDate).sort();
  let runningKg = 0;
  const rows = [];
  for (const date of dates) {
    const b = byDate[date];
    const opening = runningKg;
    const timeline = [...b.timeline].sort((x, y) => x.ts - y.ts);
    let cursor = opening;
    let adjustedKg = 0;
    let valueLostToday = 0;
    for (const ev of timeline) {
      if (ev.adj) {
        const a = ev.adj;
        const kg = Number(a.adjustment_kg);
        adjustedKg += kg;
        cursor = Number(a.new_stock_kg);
        if (kg < 0) valueLostToday += Number(a.value_lost) || 0;
      } else {
        cursor += ev.deltaKg;
      }
    }
    const closing = cursor;
    rows.push({
      date,
      opening,
      boughtKg: b.buyKg,
      spentAmt: b.buyAmt,
      soldKg: b.sellKg,
      earnedAmt: b.sellAmt,
      adjustedKg,
      valueLostToday,
      closing,
    });
    runningKg = closing;
  }
  return rows;
}
