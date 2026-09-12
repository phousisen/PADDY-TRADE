import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
// [2026-09-12] These were CALLED on this page but never imported, so the
// whole tab threw a ReferenceError before it painted anything.
import { queryRangeAdj, rangeKey } from "../reportQuery.js";
import { SummaryStrip, SummaryCell, TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
function fmtSignedRiel(n) { return `${n > 0 ? "+" : n < 0 ? "−" : ""}${new Intl.NumberFormat("en-US").format(Math.abs(Math.round(n || 0)))} ៛`; }

// [2026-09-11] What an adjustment was worth, in riel.
//
// A LOSS already carries value_lost, written at the moment it was
// recorded, so that exact figure is used — it is what was true on the day,
// at the price of the day, and must never be silently re-priced later.
//
// A GAIN never had one. record_stock_adjustment stored price_per_kg only
// when the adjustment was negative, so every gain was kept in kilograms
// and nothing else. Reang Kesey settled +35 kg on 11 September: the Settle
// screen worked out what it was worth, showed the figure, and threw it
// away. adjustment_gain_value_2026-09-11.sql keeps the price for gains too
// and back-fills the rows already recorded; this multiplies it out.
//
// Returns null when there is no price to work from, so the column shows a
// dash rather than a confident zero.
function adjustmentValue(a) {
  const kg = Number(a.adjustment_kg) || 0;
  if (kg < 0) {
    if (a.value_lost != null) return -Math.abs(Number(a.value_lost));
    if (a.price_per_kg != null) return -Math.abs(kg * Number(a.price_per_kg));
    return null;
  }
  if (kg > 0 && a.price_per_kg != null) return kg * Number(a.price_per_kg);
  return null;
}

const REASON_LABELS = {
  moisture: "Moisture loss",
  spillage: "Spillage / handling",
  recount: "Recount correction",
  other: "Other",
};

// Same Cambodia-timezone-safe date extraction used everywhere else in the
// app (Transactions.jsx, TransactionForm.jsx) — created_at is a full UTC
// timestamp, so this reads it back as the calendar date it actually was
// at the station (UTC+7, no daylight saving) rather than whatever date it
// happens to be in the viewing device's own timezone.
function cambodiaDateOnly(iso) {
  if (!iso) return "";
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(iso)).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "short", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit" }).format(d);
  return `${date} · ${time}`;
}

// Stock Loss report — a plain, honest record of how much paddy each
// location has lost (or occasionally regained, from a recount) beyond
// what Buy/Sell alone accounts for. This reads only from
// stock_adjustments (see api.recordStockAdjustment, wired up from the
// "Adjust" button on the Stock page) — it does not attempt to re-derive
// loss from anything else, since that's exactly the number staff already
// measured by hand when they recorded each adjustment.
export default function ReportShrinkage({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [allAdjustments, setAllAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Station names come from api.getStockAdjustments()'s own join (each
  // row already carries stationName) — no separate getLocations() call
  // needed here.
  function load() {
    setLoading(true);
    setLoadError("");
    // [2026-09-10] Period and station asked of the database — reportQuery.js.
    api.getStockAdjustments(queryRangeAdj({ selectedLocationIds, startDate, endDate }))
      .then(setAllAdjustments)
      .catch((err) => {
        setLoadError(err.message || "Couldn't load this report — check your connection and try again.");
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [rangeKey({ selectedLocationIds, startDate, endDate })]);

  const adjustments = useMemo(() => {
    return allAdjustments
      .filter((a) => !selectedLocationIds.length || selectedLocationIds.includes(a.location_id))
      .filter((a) => !startDate || cambodiaDateOnly(a.created_at) >= startDate)
      .filter((a) => !endDate || cambodiaDateOnly(a.created_at) <= endDate);
  }, [allAdjustments, selectedLocationIds, startDate, endDate]);

  // `priced` counts only the rows that actually have a value, so a total
  // built from three adjustments where one has no price says so instead
  // of quietly understating itself.
  const totals = useMemo(() => {
    let lossKg = 0, gainKg = 0, lossRiel = 0, gainRiel = 0, priced = 0, valued = 0;
    for (const a of adjustments) {
      const kg = Number(a.adjustment_kg) || 0;
      const v = adjustmentValue(a);
      if (kg < 0) lossKg += -kg; else gainKg += kg;
      if (v != null) {
        valued += 1;
        if (v < 0) lossRiel += -v; else gainRiel += v;
      }
      if (a.price_per_kg != null) priced += 1;
    }
    return {
      lossKg, gainKg, netKg: gainKg - lossKg,
      lossRiel, gainRiel, netRiel: gainRiel - lossRiel,
      count: adjustments.length, valued, unpriced: adjustments.length - valued, priced,
    };
  }, [adjustments]);

  const byLocation = useMemo(() => {
    const map = {};
    for (const a of adjustments) {
      const key = a.location_id;
      map[key] = map[key] || { locationName: a.stationName, lossKg: 0, gainKg: 0, lossRiel: 0, gainRiel: 0, count: 0 };
      const kg = Number(a.adjustment_kg) || 0;
      const v = adjustmentValue(a);
      if (kg < 0) map[key].lossKg += -kg; else map[key].gainKg += kg;
      if (v != null) { if (v < 0) map[key].lossRiel += -v; else map[key].gainRiel += v; }
      map[key].count += 1;
    }
    return Object.values(map).sort((a, b) => b.lossKg - a.lossKg);
  }, [adjustments]);

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}

      <SummaryStrip>
        <SummaryCell label="Total Loss" value={`${fmt2(totals.lossKg)} kg`}
          sub={totals.lossRiel > 0 ? `worth ${fmtRiel(totals.lossRiel)}` : "moisture, spillage, and other recorded loss"} tone="neg" />
        <SummaryCell label="Total Gain" value={`${fmt2(totals.gainKg)} kg`}
          sub={totals.gainRiel > 0 ? `worth ${fmtRiel(totals.gainRiel)}` : "from recount corrections, if any"} tone="pos" />
        <SummaryCell label="Net difference" value={`${totals.netKg >= 0 ? "+" : "−"}${fmt2(Math.abs(totals.netKg))} kg`}
          sub={`${totals.valued > 0 ? `${fmtSignedRiel(totals.netRiel)} across ` : ""}${totals.count} adjustment(s)${totals.unpriced > 0 ? ` · ${totals.unpriced} with no price recorded` : ""}`}
          tone={totals.netKg < 0 ? "neg" : "pos"} />
      </SummaryStrip>

      {/* [2026-09-11] Said once, plainly, at the top of the report that
          shows the money — because the obvious reading of "gain" is
          "profit", and that reading double-counts. The 35 kg Reang Kesey
          gained on 11 Sept were already paid for by the buyer: the sale
          was recorded at the real weigh-out weight. The stock ledger was
          simply behind. A loss is the mirror image — that paddy was
          already paid for when it was bought, and the cost already sits
          in purchases. */}
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
        <span className="font-semibold">These figures are not profit or cost.</span>{" "}
        They measure how far the weighing is out, and what that is worth. Money for paddy that
        was sold is already recorded on the sale, and paddy that was lost was already paid for
        on the purchase — counting either again here would record the same kilograms twice.
      </div>

      <TableCard title="By Location" className="mb-4">
        <Table>
          <thead>
            <tr>
              <Th>Location</Th><Th num>Adjustments</Th>
              <Th num>Loss (kg)</Th><Th num>Loss (៛)</Th>
              <Th num>Gain (kg)</Th><Th num>Gain (៛)</Th>
              <Th num>Net (kg)</Th><Th num>Net (៛)</Th>
            </tr>
          </thead>
          <tbody>
            {byLocation.map((l) => {
              const netKg = l.gainKg - l.lossKg;
              const netRiel = l.gainRiel - l.lossRiel;
              const netCls = netKg < 0 ? "!text-rose-600 !font-semibold" : "!text-brand-700 !font-semibold";
              return (
                <Tr key={l.locationName}>
                  <Td name>{l.locationName}</Td>
                  <Td num>{l.count}</Td>
                  <Td num className="!text-rose-600">{l.lossKg > 0 ? `-${fmt2(l.lossKg)}` : "—"}</Td>
                  <Td num className="!text-rose-600">{l.lossRiel > 0 ? `−${new Intl.NumberFormat("en-US").format(Math.round(l.lossRiel))}` : "—"}</Td>
                  <Td num className="!text-brand-700">{l.gainKg > 0 ? `+${fmt2(l.gainKg)}` : "—"}</Td>
                  <Td num className="!text-brand-700">{l.gainRiel > 0 ? `+${new Intl.NumberFormat("en-US").format(Math.round(l.gainRiel))}` : "—"}</Td>
                  <Td num className={netCls}>{netKg >= 0 ? "+" : ""}{fmt2(netKg)}</Td>
                  {/* A station whose adjustments have no price at all shows
                      a dash here rather than a misleading 0. */}
                  <Td num className={netCls}>{l.lossRiel === 0 && l.gainRiel === 0 ? "—" : fmtSignedRiel(netRiel)}</Td>
                </Tr>
              );
            })}
            {loading && byLocation.length === 0 && <Tr><td colSpan={8} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
            {byLocation.length === 0 && !loading && !loadError && <Tr><td colSpan={8} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No stock adjustments recorded for this period.</td></Tr>}
          </tbody>
        </Table>
      </TableCard>

      <TableCard title="Adjustment History">
        <Table>
          <thead>
            <tr>
              <Th>Date</Th><Th>Location</Th><Th>Previous → New (kg)</Th><Th num>Change (kg)</Th>
              <Th num>Price/kg</Th><Th num>Worth (៛)</Th>
              <Th>Reason</Th><Th>Note</Th><Th>Recorded By</Th>
            </tr>
          </thead>
          <tbody>
            {adjustments.map((a) => {
              const kg = Number(a.adjustment_kg) || 0;
              const value = adjustmentValue(a);
              const cls = kg < 0 ? "!text-rose-600 !font-semibold" : "!text-brand-700 !font-semibold";
              return (
                <Tr key={a.id}>
                  <Td>{fmtDateTime(a.created_at)}</Td>
                  <Td>{a.stationName}</Td>
                  <Td>{fmt2(a.previous_stock_kg)} → {fmt2(a.new_stock_kg)}</Td>
                  <Td num className={cls}>{kg >= 0 ? "+" : ""}{fmt2(kg)}</Td>
                  <Td num className="!text-slate-500">{a.price_per_kg != null ? new Intl.NumberFormat("en-US").format(Math.round(a.price_per_kg)) : "—"}</Td>
                  {/* A dash, never a zero: no price recorded is a different
                      fact from "worth nothing". */}
                  <Td num className={value == null ? "!text-slate-300" : cls}>{value == null ? "—" : fmtSignedRiel(value)}</Td>
                  <Td><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{REASON_LABELS[a.reason] || a.reason}</span></Td>
                  <Td className="!text-slate-400">{a.note || "—"}</Td>
                  <Td>{a.adjustedByName}</Td>
                </Tr>
              );
            })}
            {loading && adjustments.length === 0 && <Tr><td colSpan={9} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
            {adjustments.length === 0 && !loading && !loadError && <Tr><td colSpan={9} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No stock adjustments recorded for this period.</td></Tr>}
          </tbody>
        </Table>
      </TableCard>
    </div>
  );
}
