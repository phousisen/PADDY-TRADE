import { Fragment, useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp, Gauge, MapPin, ChevronRight, ChevronDown, Layers, Scale, RotateCcw } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { AdjustStockModal, ADJUSTMENT_REASONS } from "../components/AdjustStockModal.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { getAccurateNow } from "../supabaseClient.js";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }
// Cambodia's current calendar date (YYYY-MM-DD) — same helper as
// Transactions.jsx/WeighingTickets.jsx, reading getAccurateNow() rather
// than the device's own clock (see section 14's clock-accuracy fix).
function cambodiaDateStr(d = getAccurateNow()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function StockInventory() {
  const { t } = useLanguage();
  const { profile, session, hasPermission } = useAuth();
  const isAdmin = profile?.role === "admin";
  // Defaults to HQ Admin/Owner only until a custom role is explicitly
  // granted "adjust_stock" from the Roles page — no code change needed to
  // open this up to station staff later, just a checkbox there.
  const canAdjustStock = isAdmin || hasPermission("adjust_stock");
  const [stations, setStations] = useState([]);
  const [products, setProducts] = useState([]);
  const [txs, setTxs] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [adjustStation, setAdjustStation] = useState(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      // getStockAdjustments() is caught on its own, separately from the
      // other three — the Stock Loss Log is one section of this page, not
      // the whole thing, so a problem with IT (a bad join, a network blip)
      // should only leave that section empty, never take down stations,
      // totals, and the paddy-type breakdown along with it. Promise.all
      // without this would reject entirely the moment any one of the four
      // calls fails, and the catch block below never gets to set anything.
      const [st, tx, pr, adj] = await Promise.all([
        api.getLocations(),
        api.getTransactions(),
        api.getProducts(),
        api.getStockAdjustments().catch(() => []),
      ]);
      setStations(st);
      setTxs(tx);
      setProducts(pr);
      setAdjustments(adj);
    } catch (err) {
      // Without this, a failed/dropped request left the refresh icon
      // spinning forever with no error and no way to tell what happened.
      setLoadError(err.message || "Couldn't load stock — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submitAdjustment({ newStockKg, reason, note, pricePerKg }) {
    const station = adjustStation;
    const previousStockKg = Number(station.current_stock_kg) || 0;
    await api.recordStockAdjustment({
      locationId: station.id, previousStockKg, newStockKg, reason, note, pricePerKg, userId: session.user.id,
    });
    // Logged the same way every other significant change in the app is —
    // edits, cancellations, payments — so it shows up in the Activity Log
    // alongside everything else, not just as a number that quietly changed.
    await api.logAudit({
      action: "adjust_stock",
      tableName: "locations",
      recordId: station.id,
      oldData: { current_stock_kg: previousStockKg },
      newData: { current_stock_kg: newStockKg, reason, note, pricePerKg, stationName: station.name },
      userId: session.user.id,
    }).catch(() => {});
    setAdjustStation(null);
    load();
  }

  const totalStockKg = stations.reduce((s, x) => s + Number(x.current_stock_kg), 0);
  const totalCapacityKg = stations.reduce((s, x) => s + Number(x.capacity_kg), 0);
  const capacityPct = totalCapacityKg ? Math.round((totalStockKg / totalCapacityKg) * 100) : 0;

  // A cancelled transaction never actually moved any real paddy in or out —
  // same reasoning as every report page (Overview, Stock report, Balance
  // Sheet, Payables/Receivables, Purchases/Sales, Tax, Party Detail, Location
  // Detail all filter this out too) — so it shouldn't count toward the price
  // average or the per-paddy-type breakdown below, either.
  const activeTxs = useMemo(() => txs.filter((t) => (t.hq_status || "processing") !== "cancelled"), [txs]);

  const avgPrice = activeTxs.length ? activeTxs.reduce((s, x) => s + Number(x.price_per_kg), 0) / activeTxs.length : 0;
  const estimatedValue = Math.round(totalStockKg * avgPrice);

  const todayStr = cambodiaDateStr();

  // Today's weighted-average Buy price per station — total riel paid ÷
  // total kg bought today, the same two numbers the Dashboard's "Total Buy
  // (Today)" card already shows. Used only to prefill AdjustStockModal's
  // price field; null (no key) means nothing was bought there yet today.
  const todayAvgBuyPriceByLocation = useMemo(() => {
    const sums = {};
    for (const tx of activeTxs) {
      if (tx.type !== "BUY" || tx.tx_date !== todayStr || !tx.location_id) continue;
      const kg = Number(tx.quantity_kg) || 0;
      const amt = Number(tx.total_with_tax ?? tx.amount) || 0;
      const s = (sums[tx.location_id] = sums[tx.location_id] || { kg: 0, amt: 0 });
      s.kg += kg;
      s.amt += amt;
    }
    const out = {};
    for (const locId in sums) {
      if (sums[locId].kg > 0) out[locId] = sums[locId].amt / sums[locId].kg;
    }
    return out;
  }, [activeTxs, todayStr]);

  // [2026-09-01] Fallback for a station that hasn't bought anything YET
  // today (so todayAvgBuyPriceByLocation has no entry for it) — same
  // weighted-average calculation, just widened to that station's last 30
  // days of Buys instead of only today's. Used to still suggest a price for
  // AdjustStockModal instead of leaving it blank (previously: any stock
  // reset done before that station's first Buy of the day got recorded with
  // no price and no value at all, unless someone typed one in by hand).
  const recentAvgBuyPriceByLocation = useMemo(() => {
    const cutoff = new Date(getAccurateNow());
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cambodiaDateStr(cutoff);
    const sums = {};
    for (const tx of activeTxs) {
      if (tx.type !== "BUY" || !tx.location_id || tx.tx_date < cutoffStr) continue;
      const kg = Number(tx.quantity_kg) || 0;
      const amt = Number(tx.total_with_tax ?? tx.amount) || 0;
      const s = (sums[tx.location_id] = sums[tx.location_id] || { kg: 0, amt: 0 });
      s.kg += kg;
      s.amt += amt;
    }
    const out = {};
    for (const locId in sums) {
      if (sums[locId].kg > 0) out[locId] = sums[locId].amt / sums[locId].kg;
    }
    return out;
  }, [activeTxs]);

  // What AdjustStockModal actually receives: today's price when this
  // station bought something today (most accurate), otherwise its last-30-
  // days average (still a real, recent number instead of nothing), otherwise
  // null when there's truly nothing to base a price on at all.
  const priceSuggestionByLocation = useMemo(() => {
    const out = {};
    const ids = new Set([...Object.keys(todayAvgBuyPriceByLocation), ...Object.keys(recentAvgBuyPriceByLocation)]);
    for (const locId of ids) {
      if (todayAvgBuyPriceByLocation[locId] != null) out[locId] = { price: todayAvgBuyPriceByLocation[locId], source: "today" };
      else if (recentAvgBuyPriceByLocation[locId] != null) out[locId] = { price: recentAvgBuyPriceByLocation[locId], source: "recent" };
    }
    return out;
  }, [todayAvgBuyPriceByLocation, recentAvgBuyPriceByLocation]);

  // Stock Loss Log — every adjustment that actually reduced stock (a
  // "gain," like a recount finding more than expected, isn't a loss and
  // stays out of this specific log/summary, even though it's the same
  // underlying stock_adjustments table).
  const lossRows = useMemo(
    () => adjustments.filter((a) => Number(a.adjustment_kg) < -0.005),
    [adjustments]
  );
  const lossMonthStr = todayStr.slice(0, 7); // "YYYY-MM"
  // created_at is stored/returned as a UTC timestamp — convert to Cambodia's
  // own calendar date before comparing, rather than string-matching the raw
  // ISO value, so a loss recorded late at night doesn't get mis-bucketed
  // against UTC's date boundary instead of the station's real one.
  const lostToday = lossRows.filter((a) => a.created_at && cambodiaDateStr(new Date(a.created_at)) === todayStr);
  const lostThisMonth = lossRows.filter((a) => a.created_at && cambodiaDateStr(new Date(a.created_at)).startsWith(lossMonthStr));
  const lostTodayKg = lostToday.reduce((s, a) => s + Math.abs(Number(a.adjustment_kg)), 0);
  const lostMonthKg = lostThisMonth.reduce((s, a) => s + Math.abs(Number(a.adjustment_kg)), 0);
  const lostMonthValue = lostThisMonth.reduce((s, a) => s + Number(a.value_lost || 0), 0);

  const productsById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  // A manual stock adjustment (Reset to 0, or any other correction) sets
  // a location's own running total (current_stock_kg) directly — it has
  // no per-paddy-type breakdown of its own, since stock was never tracked
  // per type in the database to begin with (see the comment below). That
  // means a reset only zeroes out the ONE aggregate number; the per-type
  // breakdown below used to have no way to know a reset ever happened, so
  // it kept replaying transactions from the beginning of time regardless
  // — a station reset to 0kg could still show its old paddy composition
  // here forever, contradicting the 0kg total shown right above it. Fixed
  // the same way the net-stock diagnostic (see the project log) treats an
  // adjustment: a hard reset point — nothing dated before a location's
  // most recent adjustment counts toward its per-type breakdown anymore.
  // One acknowledged limitation: a real adjustment only ever corrects the
  // single aggregate number, never a specific paddy type, so a reset is
  // treated here as zeroing every type at that location, not just one —
  // there's no data to do better than that.
  const lastAdjustmentAtByLocation = useMemo(() => {
    const map = {};
    for (const a of adjustments) {
      if (!a.location_id || !a.created_at) continue;
      if (!map[a.location_id] || a.created_at > map[a.location_id]) map[a.location_id] = a.created_at;
    }
    return map;
  }, [adjustments]);

  // Stock isn't tracked per paddy type in the database — each location just
  // has one running total. To break it down by type, replay every
  // transaction's net weighed weight, adding it for Buys and subtracting it
  // for Sells, grouped by location and paddy type — skipping anything dated
  // at or before that location's last adjustment (see comment above).
  //
  // [2026-09-01] Fixed to use `quantity_kg` (the real weighed net — gross
  // minus tare) instead of `quantity_kg - deduction_kg`. Confirmed with the
  // user: a quality deduction (moisture/mixture/outthrow %) is a PRICE
  // adjustment only — nothing is physically sorted out or discarded at the
  // station, the full weighed-in paddy stays in the pile. Subtracting the
  // deduction here was silently undercounting real physical stock, and
  // disagreeing with `current_stock_kg` (the number this whole page's
  // total, and the Dashboard, are built from), which was never subtracting
  // it. This was very likely a real contributor to stock feeling like it
  // "wasn't sitting right" — the two numbers on this very page could drift
  // apart by however much deduction had accumulated.
  const stockByLocationProduct = useMemo(() => {
    const map = {};
    for (const tx of activeTxs) {
      if (!tx.location_id || !tx.product_id) continue;
      const lastAdjAt = lastAdjustmentAtByLocation[tx.location_id];
      if (lastAdjAt && tx.created_at && tx.created_at <= lastAdjAt) continue;
      const netKg = Number(tx.quantity_kg) || 0;
      const delta = tx.type === "BUY" ? netKg : -netKg;
      map[tx.location_id] = map[tx.location_id] || {};
      map[tx.location_id][tx.product_id] = (map[tx.location_id][tx.product_id] || 0) + delta;
    }
    return map;
  }, [activeTxs, lastAdjustmentAtByLocation]);

  const combinedByProduct = useMemo(() => {
    const map = {};
    for (const locId in stockByLocationProduct) {
      for (const prodId in stockByLocationProduct[locId]) {
        map[prodId] = (map[prodId] || 0) + stockByLocationProduct[locId][prodId];
      }
    }
    return map;
  }, [stockByLocationProduct]);

  // Value paddy type by its own average trade price rather than the one
  // blended average, so a premium type doesn't get under/over-valued.
  const avgPriceByProduct = useMemo(() => {
    const sums = {}, counts = {};
    for (const tx of activeTxs) {
      if (!tx.product_id) continue;
      sums[tx.product_id] = (sums[tx.product_id] || 0) + Number(tx.price_per_kg || 0);
      counts[tx.product_id] = (counts[tx.product_id] || 0) + 1;
    }
    const out = {};
    for (const id in sums) out[id] = sums[id] / counts[id];
    return out;
  }, [activeTxs]);

  function productRows(byProduct) {
    return Object.entries(byProduct)
      .filter(([, kg]) => Math.abs(kg) > 0.01)
      .map(([prodId, kg]) => ({
        id: prodId,
        name: productsById[prodId]?.name || "—",
        kg,
        value: kg * (avgPriceByProduct[prodId] ?? avgPrice),
      }))
      .sort((a, b) => b.kg - a.kg);
  }

  // ---- Daily Stock Ledger [2026-09-01] ------------------------------------
  //
  // Answers "how much stock did we have each day, and how much came in,
  // went out, or was lost" — one row per calendar day, instead of only the
  // single running total the rest of this page shows. Rebuilt live from the
  // real transaction/adjustment history every time it's viewed (never a
  // separately stored number) on purpose: current_stock_kg is a STORED
  // running total, and stored numbers are exactly what's caused stock to
  // drift out of sync before (see the fix_recalculate_current_stock.sql
  // note in the project log) — this can't drift the same way, because
  // there's nothing cached to go stale. Uses `quantity_kg` throughout (the
  // real weighed net), same physical-weight rule as the fix above.
  //
  // Each day: Opening = previous day's Closing. Buy adds, Sell subtracts.
  // A stock adjustment that day (the existing "Reset to 0"/correction
  // habit from the Stock Loss Log below) is treated as a checkpoint — the
  // gap between where the day's Buy/Sell activity alone would have landed
  // and what the adjustment actually set the total to becomes that day's
  // "Adjusted" figure, so a loss/gain shows up on the day it really
  // happened instead of only in a separate list. If more than one
  // adjustment lands on the same day, only the last one (by time) is the
  // day's real checkpoint.
  //
  // [2026-09-02] Bug fix — same-day trading AFTER a reset was being
  // silently thrown away. The station's daily-reset habit almost always
  // happens right after midnight (00:55-01:01, per the real timestamps),
  // meaning a full day of genuine buying/selling then follows it on that
  // SAME calendar date. The old version summed the whole day's Buy/Sell
  // first and only THEN overwrote the result with the adjustment's
  // new_stock_kg — discarding every kg bought or sold after the reset,
  // even though the database's own running stock total (what the
  // Dashboard reads) correctly included it the whole time. That's what
  // produced real, provable gaps between this ledger and the Dashboard
  // (3,090 kg at one station, 500 kg at another, on the exact days this
  // happened). Fixed below by replaying each day's Buy/Sell/adjustment
  // events in the order they actually happened (by real timestamp), so a
  // reset only ever wipes out what came before it — anything that
  // happens afterward that same day still counts.
  //
  // Per-paddy-type breakdown resets to zero on any day that had an
  // adjustment — a manual adjustment only ever corrects the single
  // combined number, never a specific type, so there's no way to know
  // which types made up what was corrected. Same convention this page's
  // existing combined breakdown table already uses for its one "since the
  // last reset" window, just applied at every past reset instead of only
  // the most recent one.
  function buildDailyLedger(locationId) {
    const txEvents = activeTxs.filter((tx) => tx.location_id === locationId && tx.tx_date);
    const adjEvents = adjustments.filter((a) => a.location_id === locationId && a.created_at);
    if (txEvents.length === 0 && adjEvents.length === 0) return [];

    const byDate = {};
    function bucket(date) {
      return (byDate[date] = byDate[date] || { date, buyKg: 0, sellKg: 0, buyAmt: 0, sellAmt: 0, byProduct: {}, timeline: [] });
    }
    for (const tx of txEvents) {
      const b = bucket(tx.tx_date);
      const kg = Number(tx.quantity_kg) || 0;
      // Real riel paid/received, not a re-derived estimate — same field
      // (total_with_tax, falling back to amount) the Dashboard's own
      // "Total Buy/Sell (Today)" cards already read.
      const riel = Number(tx.total_with_tax ?? tx.amount) || 0;
      if (tx.type === "BUY") {
        b.buyKg += kg;
        b.buyAmt += riel;
      } else {
        b.sellKg += kg;
        b.sellAmt += riel;
      }
      if (tx.product_id) {
        const p = (b.byProduct[tx.product_id] = b.byProduct[tx.product_id] || { in: 0, out: 0 });
        if (tx.type === "BUY") p.in += kg; else p.out += kg;
      }
      // Real clock time this transaction was saved — used below to place
      // it correctly relative to any same-day reset. The Bought/Sold
      // columns above stay whole-day totals either way; this is only for
      // getting the running Closing balance's order right.
      b.timeline.push({ ts: tx.created_at ? new Date(tx.created_at).getTime() : 0, deltaKg: tx.type === "BUY" ? kg : -kg });
    }
    for (const a of adjEvents) {
      bucket(cambodiaDateStr(new Date(a.created_at))).timeline.push({ ts: new Date(a.created_at).getTime(), adj: a });
    }

    const dates = Object.keys(byDate).sort();
    let runningKg = 0;
    let runningByProduct = {};
    const rows = [];
    for (const date of dates) {
      const b = byDate[date];
      const opening = runningKg;
      const openingByProduct = { ...runningByProduct };

      // Walk this day's events in the order they actually happened, so a
      // reset only ever wipes out what came before it — anything bought
      // or sold AFTER it that same day still lands on top of the new
      // balance instead of being discarded. See the fix note above
      // buildDailyLedger.
      const timeline = [...b.timeline].sort((x, y) => x.ts - y.ts);
      let cursor = opening;
      let adjustedKg = 0;
      const adjustmentDetails = [];
      let resetHappened = false;
      for (const ev of timeline) {
        if (ev.adj) {
          const a = ev.adj;
          // The delta this adjustment actually made, straight from its
          // own database row — not re-derived from the day's totals, so
          // it can never drift from what was really submitted (this is
          // also what "Value Lost" below already did — kg is now
          // consistent with it, instead of coming from a different,
          // whole-day calculation).
          const kg = Number(a.adjustment_kg);
          adjustedKg += kg;
          cursor = Number(a.new_stock_kg);
          resetHappened = true;
          const label = ADJUSTMENT_REASONS.find((r) => r.value === a.reason)?.label ?? a.reason;
          // [2026-09-01] Every ADJUSTMENT_REASONS label is written for the
          // normal case — stock coming in LOWER than the book expected
          // ("...remaining treated as lost", "Moisture loss (dried out)",
          // etc). That's backwards on the rarer day an adjustment actually
          // pushes the balance UP (a recount finding more than expected —
          // or, as with a negative running balance below, simply
          // correcting an already-broken number back toward reality).
          // Showing the raw "...treated as lost" text next to a positive
          // kg figure is a straight contradiction, so a gain gets its own,
          // honest phrasing instead of the reason's canned sentence.
          const displayReason = kg >= 0
            ? (a.reason === "recount" ? "Recount — more than expected" : "Corrected up")
            : label;
          adjustmentDetails.push({ kg, reason: label, displayReason, note: a.note, valueLost: a.value_lost });
        } else {
          cursor += ev.deltaKg;
        }
      }
      const closing = cursor;
      // Valued at cost (what was paid to acquire it), not resale price —
      // the standard write-off convention, and the same price the Adjust
      // modal already suggests when a loss is entered. Sums every
      // adjustment that landed this day; a day with no valued loss (an
      // adjustment recorded with no price, or a pure gain) reads as 0.
      const valueLostToday = adjustmentDetails.reduce((s, a) => s + (a.kg < 0 ? Number(a.valueLost) || 0 : 0), 0);

      const closingByProduct = { ...openingByProduct };
      for (const prodId in b.byProduct) {
        closingByProduct[prodId] = (closingByProduct[prodId] || 0) + b.byProduct[prodId].in - b.byProduct[prodId].out;
      }
      if (resetHappened) {
        for (const prodId in closingByProduct) closingByProduct[prodId] = 0;
      }

      rows.push({
        date,
        opening,
        boughtKg: b.buyKg,
        spentAmt: b.buyAmt,
        soldKg: b.sellKg,
        earnedAmt: b.sellAmt,
        adjustedKg,
        adjustmentDetails,
        valueLostToday,
        closing,
        byProduct: Object.entries(closingByProduct)
          // Keep a type with real activity that day even if it netted to
          // ~0 (bought and sold the same amount), not just a nonzero
          // closing balance — otherwise a day's Bought/Sold-that-day
          // columns could show a type that then vanishes from the list.
          .filter(([prodId, kg]) => Math.abs(kg) > 0.01 || Math.abs(b.byProduct[prodId]?.in || 0) > 0.01 || Math.abs(b.byProduct[prodId]?.out || 0) > 0.01)
          .map(([prodId, kg]) => ({
            productId: prodId,
            name: productsById[prodId]?.name || "—",
            inKg: b.byProduct[prodId]?.in || 0,
            outKg: b.byProduct[prodId]?.out || 0,
            closingKg: kg,
            value: kg * (avgPriceByProduct[prodId] ?? avgPrice),
          }))
          .sort((a, c) => c.closingKg - a.closingKg),
      });

      runningKg = closing;
      runningByProduct = closingByProduct;
    }
    return rows;
  }

  // [2026-09-01] A location's running balance can compute out negative —
  // not a bug in the math, but real transaction history saying more paddy
  // was sold than was ever recorded bought (before the ledger's first
  // known event, or from a genuine gap somewhere in that station's Buy
  // tickets). Physical stock can never actually be negative, so rather
  // than show it as if it were an ordinary number, flag it — it's a real
  // "something's missing from the records" signal worth checking, not
  // noise to hide.
  function balanceCell(kg, boldClass) {
    if (kg < -0.005) {
      return (
        <span className="font-medium text-amber-600" title="Negative running balance — this station's records show more paddy sold than was ever recorded bought up to this point. Worth checking for a missing Buy ticket earlier in its history.">
          {fmt2(kg)} kg <span className="rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">Check records</span>
        </span>
      );
    }
    return <span className={boldClass || ""}>{fmt2(kg)} kg</span>;
  }

  const [ledgerLocationId, setLedgerLocationId] = useState("");
  const [ledgerPeriod, setLedgerPeriod] = useState("30d");
  const [ledgerExpandedDate, setLedgerExpandedDate] = useState(null);

  const activeLedgerLocationId = ledgerLocationId || stations[0]?.id || "";
  const fullLedger = useMemo(
    () => (activeLedgerLocationId ? buildDailyLedger(activeLedgerLocationId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeLedgerLocationId, activeTxs, adjustments, avgPrice, avgPriceByProduct, productsById]
  );
  const ledgerRows = useMemo(() => {
    if (ledgerPeriod === "all") return fullLedger;
    const days = ledgerPeriod === "7d" ? 7 : ledgerPeriod === "30d" ? 30 : null;
    let cutoff;
    if (days) {
      const d = new Date(getAccurateNow());
      d.setDate(d.getDate() - days);
      cutoff = cambodiaDateStr(d);
    } else {
      // "month" — from the 1st of the current Cambodia calendar month.
      cutoff = `${todayStr.slice(0, 7)}-01`;
    }
    return fullLedger.filter((r) => r.date >= cutoff);
  }, [fullLedger, ledgerPeriod, todayStr]);

  // Totals row at the bottom of the ledger — same numbers as the rows
  // above, just summed across whatever period is currently selected.
  const ledgerTotals = useMemo(() => {
    const t = { boughtKg: 0, spentAmt: 0, soldKg: 0, earnedAmt: 0, adjustedKg: 0, valueLostToday: 0 };
    for (const r of ledgerRows) {
      t.boughtKg += r.boughtKg;
      t.spentAmt += r.spentAmt;
      t.soldKg += r.soldKg;
      t.earnedAmt += r.earnedAmt;
      t.adjustedKg += r.adjustedKg;
      t.valueLostToday += r.valueLostToday;
    }
    t.marginAmt = t.earnedAmt - t.spentAmt;
    t.netAmt = t.marginAmt - t.valueLostToday;
    return t;
  }, [ledgerRows]);

  const combinedRows = productRows(combinedByProduct);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("stock_title")} />
      <main className="flex-1 overflow-y-auto p-6">
        {loadError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        )}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{t("stock_title")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("stock_subtitle")}</p>
          </div>
          <button onClick={load} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {t("refresh")}
          </button>
        </div>

        <div className="mb-6 flex gap-4">
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400"><TrendingUp size={14} /><span>{t("total_stock")}</span></div>
            <p className="text-3xl font-bold text-slate-800">{fmt(totalStockKg)}<span className="ml-1 text-base font-medium text-slate-400">KG</span></p>
          </div>
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400"><Gauge size={14} /><span>{t("est_value")}</span></div>
            <p className="text-3xl font-bold text-slate-800">{(estimatedValue / 1_000_000_000).toFixed(2)}<span className="ml-1 text-base font-medium text-slate-400">Billion Riel</span></p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(capacityPct, 100)}%` }} /></div>
            <p className="mt-1 text-xs text-slate-400">{capacityPct}% {t("of_capacity")}</p>
          </div>
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400"><MapPin size={14} /><span>{t("location_count")}</span></div>
            <p className="text-3xl font-bold text-slate-800">{stations.length}</p>
            <p className="mt-1 text-xs text-slate-400">{t("locations")}</p>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="font-semibold text-slate-700">{t("stock_by_station")}</h3>
            <p className="text-xs text-slate-400">Click a location to see its paddy type breakdown</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">{t("station")}</th>
                <th className="px-5 py-2 font-medium">{t("quantity_kg")}</th>
                <th className="px-5 py-2 font-medium">{t("stock_value_col")}</th>
                <th className="px-5 py-2 font-medium">{t("updated")}</th>
                {canAdjustStock && <th className="px-5 py-2 font-medium">Adjust</th>}
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                const stationValue = Number(s.current_stock_kg) * avgPrice;
                const isOpen = expandedId === s.id;
                const rows = productRows(stockByLocationProduct[s.id] || {});
                return (
                  <Fragment key={s.id}>
                    <tr onClick={() => setExpandedId(isOpen ? null : s.id)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-5 py-3"><p className="font-medium text-slate-700">{s.name}</p><p className="text-xs text-slate-400">{s.name_kh}</p></td>
                      <td className="px-5 py-3 font-medium text-slate-700">{fmt(s.current_stock_kg)}</td>
                      <td className="px-5 py-3 font-medium text-slate-700">{fmtRiel(stationValue)}</td>
                      <td className="px-5 py-3 text-xs text-slate-400">{s.updated_ago}</td>
                      {canAdjustStock && (
                        <td className="px-5 py-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); setAdjustStation(s); }}
                            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700"
                          >
                            <Scale size={12} /> Adjust
                          </button>
                        </td>
                      )}
                      <td className="px-5 py-3 text-right">
                        {isOpen ? <ChevronDown size={16} className="ml-auto text-slate-400" /> : <ChevronRight size={16} className="ml-auto text-slate-300" />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-slate-50 bg-slate-50/60 last:border-0">
                        <td colSpan={canAdjustStock ? 6 : 5} className="px-5 py-3">
                          {rows.length === 0 ? (
                            <p className="py-2 text-center text-xs text-slate-400">No paddy type breakdown yet for this location.</p>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-slate-400">
                                  <th className="py-1.5 pl-2 font-medium">Paddy Type</th>
                                  <th className="py-1.5 font-medium">{t("quantity_kg")}</th>
                                  <th className="py-1.5 font-medium">{t("stock_value_col")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((r) => (
                                  <tr key={r.id} className="border-t border-white">
                                    <td className="py-1.5 pl-2 text-slate-600">{r.name}</td>
                                    <td className="py-1.5 font-medium text-slate-700">{fmt(r.kg)}</td>
                                    <td className="py-1.5 font-medium text-slate-700">{fmtRiel(r.value)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {loading && stations.length === 0 && (
                <tr><td colSpan={canAdjustStock ? 6 : 5} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
              )}
              {stations.length === 0 && !loading && !loadError && (
                <tr><td colSpan={canAdjustStock ? 6 : 5} className="px-5 py-10 text-center text-sm text-slate-400">No locations visible to your account.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="flex items-center gap-2 font-semibold text-slate-700"><Layers size={16} className="text-brand-600" /> Stock by Paddy Type — All Locations Combined</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">Paddy Type</th>
                <th className="px-5 py-2 font-medium">{t("quantity_kg")}</th>
                <th className="px-5 py-2 font-medium">{t("stock_value_col")}</th>
              </tr>
            </thead>
            <tbody>
              {combinedRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{r.name}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{fmt(r.kg)}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{fmtRiel(r.value)}</td>
                </tr>
              ))}
              {combinedRows.length === 0 && !loading && !loadError && (
                <tr><td colSpan={3} className="px-5 py-10 text-center text-sm text-slate-400">No stock recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="flex items-center gap-2 font-semibold text-slate-700"><RotateCcw size={16} className="text-rose-500" /> Stock Loss Log</h3>
            <p className="mt-0.5 text-xs text-slate-400">Every stock adjustment that reduced what's on hand — moisture, spillage, or a daily reset — with what it was worth at the time.</p>
          </div>
          <div className="grid grid-cols-1 divide-y divide-slate-100 border-b border-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="px-5 py-3.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Lost Today</p>
              <p className="mt-0.5 text-lg font-bold text-rose-600">{fmt2(lostTodayKg)} kg</p>
            </div>
            <div className="px-5 py-3.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Lost This Month</p>
              <p className="mt-0.5 text-lg font-bold text-rose-600">{fmt2(lostMonthKg)} kg</p>
            </div>
            <div className="px-5 py-3.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Est. Value Lost This Month</p>
              <p className="mt-0.5 text-lg font-bold text-rose-600">{fmtRiel(lostMonthValue)}</p>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">Date</th>
                <th className="px-5 py-2 font-medium">{t("station")}</th>
                <th className="px-5 py-2 font-medium">Weight Lost</th>
                <th className="px-5 py-2 font-medium">Price/kg Used</th>
                <th className="px-5 py-2 font-medium">Value Lost</th>
                <th className="px-5 py-2 font-medium">Recorded By</th>
                <th className="px-5 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {lossRows.map((a) => (
                <tr key={a.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-500">{a.created_at ? cambodiaDateStr(new Date(a.created_at)) : "—"}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{a.stationName}</td>
                  <td className="px-5 py-3 font-medium text-rose-600">{fmt2(Math.abs(a.adjustment_kg))} kg</td>
                  <td className="px-5 py-3 text-slate-600">{a.price_per_kg != null ? fmtRiel(a.price_per_kg) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-5 py-3 font-medium text-rose-600">{a.value_lost != null ? fmtRiel(a.value_lost) : <span className="font-normal text-slate-300">not valued</span>}</td>
                  <td className="px-5 py-3 text-slate-500">{a.adjustedByName}</td>
                  <td className="px-5 py-3 text-slate-400">{a.note || (ADJUSTMENT_REASONS.find((r) => r.value === a.reason)?.label ?? a.reason)}</td>
                </tr>
              ))}
              {lossRows.length === 0 && !loading && !loadError && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">No stock loss recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* [2026-09-01] Daily Stock Ledger — a real daily finance-and-stock
            record per station: one row per day (Opening / Bought In /
            Spent / Sold Out / Earned / Lost / Value Lost / Closing), each
            expandable into that day's paddy-type breakdown, plus a totals
            row for whatever period is selected. Styled deliberately like a
            finance statement — tight right-aligned figures, a total row —
            approved via sample before building (see the mockup shared
            earlier). Rebuilt live from real transaction/adjustment history
            every time it's opened — see buildDailyLedger above for why
            that's on purpose, and note that this table itself is what
            answers "how much did we spend/earn/lose" per day; nothing
            equivalent was added to the Dashboard, by request. */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="flex items-center gap-2 font-semibold text-slate-700"><Layers size={16} className="text-brand-600" /> Daily Stock Ledger</h3>
              <p className="mt-0.5 text-xs text-slate-400">What each station spent, earned, lost, and closed with — day by day.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={activeLedgerLocationId}
                onChange={(e) => { setLedgerLocationId(e.target.value); setLedgerExpandedDate(null); }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
              >
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div className="flex overflow-hidden rounded-lg border border-slate-200">
                {[["7d", "7 Days"], ["30d", "30 Days"], ["month", "This Month"], ["all", "All Time"]].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setLedgerPeriod(val)}
                    className={`px-3 py-1.5 text-xs font-semibold ${ledgerPeriod === val ? "bg-brand-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-right text-[10.5px] uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Opening</th>
                <th className="px-4 py-2.5 font-semibold">Bought In</th>
                <th className="px-4 py-2.5 font-semibold">Spent</th>
                <th className="px-4 py-2.5 font-semibold">Sold Out</th>
                <th className="px-4 py-2.5 font-semibold">Earned</th>
                <th className="px-4 py-2.5 font-semibold">Lost</th>
                <th className="px-4 py-2.5 font-semibold">Value Lost</th>
                <th className="px-4 py-2.5 font-semibold">Closing</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {[...ledgerRows].reverse().map((r) => {
                const isOpen = ledgerExpandedDate === r.date;
                return (
                  <Fragment key={r.date}>
                    <tr onClick={() => setLedgerExpandedDate(isOpen ? null : r.date)} className="cursor-pointer border-b border-slate-50 text-right last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3 text-left font-semibold text-slate-700">{r.date}</td>
                      <td className="px-4 py-3 text-slate-500">{balanceCell(r.opening)}</td>
                      <td className="px-4 py-3 text-brand-600">{r.boughtKg > 0.005 ? `+${fmt2(r.boughtKg)} kg` : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 text-slate-600">{r.spentAmt > 0.5 ? fmtRiel(r.spentAmt) : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 text-rose-500">{r.soldKg > 0.005 ? `−${fmt2(r.soldKg)} kg` : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 font-medium text-brand-700">{r.earnedAmt > 0.5 ? fmtRiel(r.earnedAmt) : <span className="font-normal text-slate-300">—</span>}</td>
                      <td className="px-4 py-3">
                        {Math.abs(r.adjustedKg) > 0.005 ? (
                          <span className={r.adjustedKg < 0 ? "font-medium text-rose-600" : "font-medium text-emerald-600"}>
                            {r.adjustedKg > 0 ? "+" : "−"}{fmt2(Math.abs(r.adjustedKg))} kg
                            {r.adjustmentDetails[r.adjustmentDetails.length - 1]?.displayReason && (
                              <span className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                                {r.adjustmentDetails[r.adjustmentDetails.length - 1].displayReason}
                              </span>
                            )}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 font-medium text-rose-600">{r.valueLostToday > 0.5 ? fmtRiel(r.valueLostToday) : <span className="font-normal text-slate-300">—</span>}</td>
                      <td className="px-4 py-3">{balanceCell(r.closing, "font-bold text-slate-800")}</td>
                      <td className="px-4 py-3 text-right">
                        {isOpen ? <ChevronDown size={16} className="ml-auto text-slate-400" /> : <ChevronRight size={16} className="ml-auto text-slate-300" />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-slate-50 bg-slate-50/60 last:border-0">
                        <td colSpan={10} className="px-5 py-3">
                          {r.byProduct.length === 0 ? (
                            <p className="py-2 text-center text-xs text-slate-400">No paddy-type activity this day.</p>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-slate-400">
                                  <th className="py-1.5 pl-2 font-medium">Paddy Type</th>
                                  <th className="py-1.5 font-medium">Bought In</th>
                                  <th className="py-1.5 font-medium">Sold Out</th>
                                  <th className="py-1.5 font-medium">Closing</th>
                                  <th className="py-1.5 font-medium">{t("stock_value_col")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.byProduct.map((p) => (
                                  <tr key={p.productId} className="border-t border-white">
                                    <td className="py-1.5 pl-2 text-slate-600">{p.name}</td>
                                    <td className="py-1.5 text-brand-600">{p.inKg > 0.005 ? `+${fmt2(p.inKg)} kg` : <span className="text-slate-300">—</span>}</td>
                                    <td className="py-1.5 text-rose-500">{p.outKg > 0.005 ? `−${fmt2(p.outKg)} kg` : <span className="text-slate-300">—</span>}</td>
                                    <td className="py-1.5 font-medium text-slate-700">{fmt2(p.closingKg)} kg</td>
                                    <td className="py-1.5 font-medium text-slate-700">{fmtRiel(p.value)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {r.adjustmentDetails.length > 0 && (
                            <div className="mt-2 space-y-1 border-t border-white pt-2">
                              {r.adjustmentDetails.map((a, i) => (
                                <p key={i} className="pl-2 text-xs text-slate-500">
                                  <span className={a.kg < 0 ? "font-medium text-rose-600" : "font-medium text-emerald-600"}>
                                    {a.kg > 0 ? "+" : ""}{fmt2(a.kg)} kg
                                  </span>
                                  {" — "}{a.displayReason}{a.note ? `: ${a.note}` : ""}
                                  {a.valueLost != null ? ` (${fmtRiel(a.valueLost)} lost)` : ""}
                                </p>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {ledgerRows.length === 0 && !loading && !loadError && (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-slate-400">No activity recorded for this station in this period.</td></tr>
              )}
            </tbody>
            {ledgerRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-brand-600 bg-brand-50/60 text-right">
                  <td className="px-4 py-3 text-left font-bold text-brand-900">
                    {ledgerPeriod === "7d" ? "7-Day" : ledgerPeriod === "30d" ? "30-Day" : ledgerPeriod === "month" ? "This Month's" : "All-Time"} Total
                  </td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 font-bold text-brand-700">+{fmt2(ledgerTotals.boughtKg)} kg</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{fmtRiel(ledgerTotals.spentAmt)}</td>
                  <td className="px-4 py-3 font-bold text-rose-600">−{fmt2(ledgerTotals.soldKg)} kg</td>
                  <td className="px-4 py-3 font-bold text-brand-700">{fmtRiel(ledgerTotals.earnedAmt)}</td>
                  <td className="px-4 py-3 font-bold text-rose-600">{Math.abs(ledgerTotals.adjustedKg) > 0.005 ? `${ledgerTotals.adjustedKg < 0 ? "−" : "+"}${fmt2(Math.abs(ledgerTotals.adjustedKg))} kg` : "—"}</td>
                  <td className="px-4 py-3 font-bold text-rose-600">{ledgerTotals.valueLostToday > 0.5 ? fmtRiel(ledgerTotals.valueLostToday) : "—"}</td>
                  <td className="px-4 py-3 font-bold text-slate-800">{fmt2(ledgerRows[ledgerRows.length - 1]?.closing ?? 0)} kg</td>
                  <td className="px-4 py-3"></td>
                </tr>
                <tr className="bg-brand-50/60 text-right">
                  <td className="px-4 pb-3 text-left text-xs font-semibold text-brand-800">Gross Margin (Earned − Spent)</td>
                  <td colSpan={5}></td>
                  <td colSpan={2} className="px-4 pb-3">
                    <span className={ledgerTotals.marginAmt >= 0 ? "font-bold text-brand-700" : "font-bold text-rose-600"}>{ledgerTotals.marginAmt >= 0 ? "+" : ""}{fmtRiel(ledgerTotals.marginAmt)}</span>
                  </td>
                  <td className="px-4 pb-3"></td>
                </tr>
                <tr className="bg-brand-50/60 text-right">
                  <td className="px-4 pb-4 text-left text-xs font-semibold text-brand-800">Net Result (Margin − Value Lost)</td>
                  <td colSpan={5}></td>
                  <td colSpan={2} className="px-4 pb-4">
                    <span className={ledgerTotals.netAmt >= 0 ? "font-bold text-brand-700" : "font-bold text-rose-600"}>{ledgerTotals.netAmt >= 0 ? "+" : ""}{fmtRiel(ledgerTotals.netAmt)}</span>
                  </td>
                  <td className="px-4 pb-4"></td>
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        </div>
      </main>

      {adjustStation && (
        <AdjustStockModal
          station={adjustStation}
          priceSuggestion={priceSuggestionByLocation[adjustStation.id] ?? null}
          t={t}
          isAdmin={isAdmin}
          onClose={() => setAdjustStation(null)}
          onSubmit={submitAdjustment}
        />
      )}
    </div>
  );
}
