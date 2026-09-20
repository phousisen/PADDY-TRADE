import { useEffect, useMemo, useState, useRef } from "react";
import { api } from "../api.js";
// [2026-09-12] These were CALLED on this page but never imported, so the
// whole tab threw a ReferenceError before it painted anything.
import { queryRange, rangeKey } from "../reportQuery.js";
import { effectiveAdjDateStr, cambodiaDateStr } from "../dailyLedger.js";
import { useLanguage } from "../i18n.jsx";
import { TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

export default function ReportStock({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [allStations, setAllStations] = useState([]);
  const [allTxs, setAllTxs] = useState([]);
  const [allAdjustments, setAllAdjustments] = useState([]);
  const { t: tr } = useLanguage();
  const [view, setView] = useState("summary");
  const [loading, setLoading] = useState(true);
  const loadSeq = useRef(0);
  const [loadError, setLoadError] = useState("");

  function load() {
    // [2026-09-19] Only the newest request may fill the page: changing the
    // station or dates quickly let an older, slower answer land last (audit F12).
    const my = ++loadSeq.current;
    const live = () => my === loadSeq.current;
    setLoading(true);
    setLoadError("");
    // [2026-09-10] Period and station asked of the database — reportQuery.js.
    //
    // [2026-09-19] (audit F8) The running balance used to start at 0 on the
    // first day of the chosen period and ignore stock counts and losses, so
    // "Running Balance" on 1 September showed only September's buying. Now
    // everything up to the END of the period is fetched, counts included,
    // the balance is carried from the very first movement, and only the rows
    // inside the period are shown.
    const range = queryRange({ selectedLocationIds, startDate, endDate });
    const asAt = { ...range, from: undefined };
    // A count entered after midnight can belong to the day before, so the
    // adjustments are fetched one day past the end and dated properly below.
    const adjEnd = endDate
      ? new Date(Date.parse(`${endDate}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : undefined;
    Promise.all([
      api.getLocations(),
      api.getTransactions(asAt),
      api.getStockAdjustments({ locationId: asAt.locationId, endDate: adjEnd }),
    ])
      .then(([s, t, adj]) => {
        if (!live()) return;
        setAllStations(s);
        setAllTxs(t);
        setAllAdjustments(adj || []);
      })
      .catch((err) => {
        if (!live()) return;
        // Without this, a failed/dropped request silently showed an
        // empty report instead of saying the load itself had failed.
        setLoadError(err.message || "Couldn't load this report — check your connection and try again.");
      })
      .finally(() => { if (live()) setLoading(false); });
  }
  useEffect(() => { load(); }, [rangeKey({ selectedLocationIds, startDate, endDate })]);

  const stations = selectedLocationIds.length ? allStations.filter((s) => selectedLocationIds.includes(s.id)) : allStations;
  const inScope = (id) => !selectedLocationIds.length || selectedLocationIds.includes(id);

  // Running balance per location, carried from the first movement ever
  // recorded, counts and losses included (see load() above).
  const stationName = (id) => allStations.find((x) => x.id === id)?.name || "";
  const movements = useMemo(() => {
    const events = [];
    for (const tx of allTxs) {
      if ((tx.hq_status || "processing") === "cancelled" || !inScope(tx.location_id)) continue;
      const kg = Number(tx.quantity_kg) || 0;
      events.push({ ...tx, date: tx.tx_date, sortKey: `${tx.tx_date} ${tx.tx_time || ""}`, delta: tx.type === "BUY" ? kg : -kg });
    }
    for (const a of allAdjustments) {
      if (!a.created_at || !inScope(a.location_id)) continue;
      const date = effectiveAdjDateStr(a);
      const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(a.created_at));
      // A reset counted against the night before sorts at the END of that day.
      const countedBack = date !== cambodiaDateStr(new Date(a.created_at));
      events.push({
        id: `adj-${a.id}`, date, sortKey: `${date} ${countedBack ? "99" : clock}`,
        location_id: a.location_id, code: a.reason === "reset" ? tr("stk_mv_reset") : tr("stk_mv_count"),
        type: "ADJ", stationName: a.locations?.name || stationName(a.location_id),
        delta: Number(a.adjustment_kg) || 0,
      });
    }
    events.sort((x, y) => (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : 0));
    const running = {};
    const out = [];
    for (const e of events) {
      running[e.location_id] = (running[e.location_id] || 0) + e.delta;
      if (endDate && e.date > endDate) continue;
      if (startDate && e.date < startDate) continue;
      out.push({ ...e, stationName: e.stationName || stationName(e.location_id), runningBalance: running[e.location_id] });
    }
    return out;
  }, [allTxs, allAdjustments, allStations, selectedLocationIds.join(","), startDate, endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}
      <div className="mb-4 flex justify-end gap-2">
        {[{ v: "summary", l: "Summary" }, { v: "detail", l: "Movement Detail" }].map((o) => (
          <button key={o.v} onClick={() => setView(o.v)} className={`rounded-lg border px-3 py-1.5 text-[13.5px] ${view === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
        ))}
      </div>

      {view === "summary" ? (
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>Location</Th><Th num>Current Stock (kg)</Th><Th num>Capacity (kg)</Th><Th num>% Full</Th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                // [2026-09-10] Capacity is not required when a location is
                // created (AddLocationModal) and defaults to 0, so a brand-new
                // station divided by zero here and printed "Infinity%" — or
                // "NaN%" before its first ticket. StockInventory.jsx already
                // guarded this; these three places did not.
                const capKg = Number(s.capacity_kg) || 0;
                const pct = capKg > 0 ? Math.round((Number(s.current_stock_kg) / capKg) * 100) : null;
                return (
                  <Tr key={s.id}>
                    <Td name>{s.name}</Td>
                    <Td num>{fmt2(s.current_stock_kg)}</Td>
                    <Td num>{fmt2(s.capacity_kg)}</Td>
                    <Td num>{pct == null ? "—" : `${pct}%`}</Td>
                  </Tr>
                );
              })}
              {loading && stations.length === 0 && <Tr><td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
              {stations.length === 0 && !loading && !loadError && <Tr><td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No locations visible to your account.</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      ) : (
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th><Th>Receipt</Th><Th>Location</Th><Th>Type</Th><Th num>Change (kg)</Th><Th num>Running Balance</Th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <Tr key={m.id}>
                  <Td>{m.tx_date}</Td>
                  <Td name>{m.code}</Td>
                  <Td>{m.stationName}</Td>
                  <Td><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${m.type === "BUY" ? "bg-brand-50 text-brand-700" : m.type === "ADJ" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-600"}`}>{m.type === "ADJ" ? tr("stk_mv_adj") : m.type}</span></Td>
                  <Td num className={m.delta >= 0 ? "!text-brand-700 !font-semibold" : "!text-rose-600 !font-semibold"}>{m.delta >= 0 ? "+" : ""}{fmt2(m.delta)}</Td>
                  <Td num>{fmt2(m.runningBalance)}</Td>
                </Tr>
              ))}
              {loading && movements.length === 0 && <Tr><td colSpan={6} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
              {movements.length === 0 && !loading && !loadError && <Tr><td colSpan={6} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No stock movements yet.</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}
