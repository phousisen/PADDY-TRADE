import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { SummaryStrip, SummaryCell, TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

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
    api.getStockAdjustments()
      .then(setAllAdjustments)
      .catch((err) => {
        setLoadError(err.message || "Couldn't load this report — check your connection and try again.");
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const adjustments = useMemo(() => {
    return allAdjustments
      .filter((a) => !selectedLocationIds.length || selectedLocationIds.includes(a.location_id))
      .filter((a) => !startDate || cambodiaDateOnly(a.created_at) >= startDate)
      .filter((a) => !endDate || cambodiaDateOnly(a.created_at) <= endDate);
  }, [allAdjustments, selectedLocationIds, startDate, endDate]);

  const totals = useMemo(() => {
    let lossKg = 0, gainKg = 0;
    for (const a of adjustments) {
      const kg = Number(a.adjustment_kg) || 0;
      if (kg < 0) lossKg += -kg; else gainKg += kg;
    }
    return { lossKg, gainKg, netKg: gainKg - lossKg, count: adjustments.length };
  }, [adjustments]);

  const byLocation = useMemo(() => {
    const map = {};
    for (const a of adjustments) {
      const key = a.location_id;
      map[key] = map[key] || { locationName: a.stationName, lossKg: 0, gainKg: 0, count: 0 };
      const kg = Number(a.adjustment_kg) || 0;
      if (kg < 0) map[key].lossKg += -kg; else map[key].gainKg += kg;
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
        <SummaryCell label="Total Loss" value={`${fmt2(totals.lossKg)} kg`} sub="moisture, spillage, and other recorded loss" tone="neg" />
        <SummaryCell label="Total Gain" value={`${fmt2(totals.gainKg)} kg`} sub="from recount corrections, if any" tone="pos" />
        <SummaryCell label="Adjustments Recorded" value={totals.count} sub={`net ${totals.netKg >= 0 ? "+" : ""}${fmt2(totals.netKg)} kg over this period`} />
      </SummaryStrip>

      <TableCard title="By Location" className="mb-4">
        <Table>
          <thead>
            <tr>
              <Th>Location</Th><Th num>Adjustments</Th><Th num>Loss (kg)</Th><Th num>Gain (kg)</Th><Th num>Net (kg)</Th>
            </tr>
          </thead>
          <tbody>
            {byLocation.map((l) => (
              <Tr key={l.locationName}>
                <Td name>{l.locationName}</Td>
                <Td num>{l.count}</Td>
                <Td num className="!text-rose-600">{l.lossKg > 0 ? `-${fmt2(l.lossKg)}` : "—"}</Td>
                <Td num className="!text-brand-700">{l.gainKg > 0 ? `+${fmt2(l.gainKg)}` : "—"}</Td>
                <Td num className={l.gainKg - l.lossKg < 0 ? "!text-rose-600 !font-semibold" : "!text-brand-700 !font-semibold"}>
                  {l.gainKg - l.lossKg >= 0 ? "+" : ""}{fmt2(l.gainKg - l.lossKg)}
                </Td>
              </Tr>
            ))}
            {loading && byLocation.length === 0 && <Tr><td colSpan={5} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
            {byLocation.length === 0 && !loading && !loadError && <Tr><td colSpan={5} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No stock adjustments recorded for this period.</td></Tr>}
          </tbody>
        </Table>
      </TableCard>

      <TableCard title="Adjustment History">
        <Table>
          <thead>
            <tr>
              <Th>Date</Th><Th>Location</Th><Th>Previous → New (kg)</Th><Th num>Change (kg)</Th><Th>Reason</Th><Th>Note</Th><Th>Recorded By</Th>
            </tr>
          </thead>
          <tbody>
            {adjustments.map((a) => (
              <Tr key={a.id}>
                <Td>{fmtDateTime(a.created_at)}</Td>
                <Td>{a.stationName}</Td>
                <Td>{fmt2(a.previous_stock_kg)} → {fmt2(a.new_stock_kg)}</Td>
                <Td num className={Number(a.adjustment_kg) < 0 ? "!text-rose-600 !font-semibold" : "!text-brand-700 !font-semibold"}>
                  {Number(a.adjustment_kg) >= 0 ? "+" : ""}{fmt2(a.adjustment_kg)}
                </Td>
                <Td><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{REASON_LABELS[a.reason] || a.reason}</span></Td>
                <Td className="!text-slate-400">{a.note || "—"}</Td>
                <Td>{a.adjustedByName}</Td>
              </Tr>
            ))}
            {loading && adjustments.length === 0 && <Tr><td colSpan={7} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
            {adjustments.length === 0 && !loading && !loadError && <Tr><td colSpan={7} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No stock adjustments recorded for this period.</td></Tr>}
          </tbody>
        </Table>
      </TableCard>
    </div>
  );
}
