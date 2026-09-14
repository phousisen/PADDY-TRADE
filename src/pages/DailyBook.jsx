// Reports → Daily Book. Read-only: every figure is computed from transactions,
// payments and stock counts already recorded, so nothing on this page can be
// typed or edited. Change a transaction and the day, its week, its month and
// the year all move together — see periodBook.js for why they cannot disagree.
//
// The four views are GRANULARITY, not a drill-down: "By day" is one row per
// trading day, "By week" one row per week, "By month" one row per month. A row
// at any grain opens what is inside it.

import { Fragment, useEffect, useMemo, useState } from "react";
import api from "../api.js";
import LocationFilter from "../components/LocationFilter.jsx";
import { buildDays, rollup, buildPeriods, isoWeek, cambodiaToday } from "../periodBook.js";

const GRAINS = [
  ["days", "By day"],
  ["weeks", "By week"],
  ["months", "By month"],
  ["year", "Year total"],
];

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---- formatting -----------------------------------------------------------
// Decimals sit in a lighter grey so the eye lands on the whole kilos.
function Kg({ v }) {
  if (!v) return <span className="text-slate-200">—</span>;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const i = s.lastIndexOf(".");
  return <>{s.slice(0, i)}<span className="text-slate-300">{s.slice(i)}</span></>;
}
function Riel({ v }) {
  if (!v) return <span className="text-slate-200">—</span>;
  return <>{Math.round(v).toLocaleString("en-US")}</>;
}
function Signed({ v }) {
  if (!v) return <span className="text-slate-200">—</span>;
  return (
    <span className={v >= 0 ? "font-semibold text-brand-700" : "font-semibold text-orange-700"}>
      {v >= 0 ? "+" : "−"} {Math.abs(Math.round(v)).toLocaleString("en-US")}
    </span>
  );
}

function labelFor(period, grain) {
  if (grain === "days") {
    const [y, m, d] = period.key.split("-").map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    return { main: `${DW[dow]} ${String(d).padStart(2, "0")} ${MS[m - 1]}`, sub: "" };
  }
  if (grain === "weeks") {
    const f = period.days[0], l = period.days[period.days.length - 1];
    const fd = Number(f.date.slice(8)), ld = Number(l.date.slice(8));
    return {
      main: `Week ${period.key.slice(6)}`,
      sub: `${fd} ${MS[Number(f.date.slice(5, 7)) - 1]} – ${ld} ${MS[Number(l.date.slice(5, 7)) - 1]} · ${period.days.length} trading days`,
    };
  }
  if (grain === "months") {
    return { main: `${MONTHS[Number(period.key.slice(5, 7)) - 1]} ${period.key.slice(0, 4)}`, sub: `${period.days.length} trading days` };
  }
  return { main: period.key, sub: `${period.days.length} trading days` };
}

// ---- the row --------------------------------------------------------------
const TD = "border-b border-slate-50 px-3.5 py-3 text-right tabular-nums text-slate-600 whitespace-nowrap";
const BUY = "bg-brand-600/[0.03]";
const SELL = "bg-orange-600/[0.03]";
const STK = "bg-sky-700/[0.04]";

function LedgerRow({ label, sub, t, variant, onClick, onLoads, open }) {
  const tot = variant === "total";
  const wk = variant === "week";
  const cls = (extra = "") =>
    `${TD} ${tot ? "!bg-brand-700 !text-white font-semibold !border-0" : wk ? "!bg-slate-50/70 font-semibold text-slate-900 border-t border-slate-200" : open ? "!bg-brand-50" : ""} ${tot ? "" : extra}`;

  const Loads = ({ n, title }) =>
    n ? (
      <span
        title={title}
        onClick={onLoads ? (e) => { e.stopPropagation(); onLoads(); } : undefined}
        className={tot || wk ? "font-semibold" :
          "inline-flex h-[22px] min-w-[24px] cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white px-1.5 text-[12.5px] font-semibold text-slate-900 hover:border-brand-300 hover:text-brand-700"}
      >{n}</span>
    ) : <span className="text-slate-200">—</span>;

  return (
    <tr onClick={onClick} className={onClick ? "cursor-pointer hover:[&>td]:bg-brand-50" : ""}>
      <td className={`${cls()} sticky left-0 z-[2] text-left ${tot ? "" : wk ? "!bg-slate-50/70" : open ? "!bg-brand-50" : "bg-white"}`}>
        <span className="flex flex-col">
          <b className="text-[13px] font-semibold tracking-tight">{label}</b>
          {sub && <small className={`text-[10.5px] ${tot ? "text-brand-200" : "text-slate-400"}`}>{sub}</small>}
        </span>
      </td>

      <td className={`${cls(BUY)} text-center`}><Loads n={t.buyLoads} title={`${t.truck} truck · ${t.koyun} koyun · ${t.tractor} tractor${t.otherVeh ? ` · ${t.otherVeh} other` : ""} — click to see them`} /></td>
      <td className={cls(BUY)}><Kg v={t.boughtKg} /></td>
      <td className={cls(BUY)}>{t.buyPricePerKg ? t.buyPricePerKg.toFixed(2) : <span className="text-slate-200">—</span>}</td>
      <td className={cls(BUY)}><Riel v={t.spent} /></td>

      <td className={`${cls(SELL)} text-center border-l border-slate-200`}><Loads n={t.sellLoads} title="click to see the loads" /></td>
      <td className={cls(SELL)}><Kg v={t.soldKg} /></td>
      <td className={cls(SELL)}><Riel v={t.received} /></td>

      <td className={`${cls()} border-l border-slate-200`}><Riel v={t.staff} /></td>
      <td className={cls()}><Riel v={t.otherExp} /></td>
      <td className={cls()}><Riel v={t.expenses} /></td>

      <td className={`${cls(STK)} border-l border-slate-200`}>{t.lostKg ? <Signed v={t.lostKg} /> : <span className="text-slate-200">—</span>}</td>
      <td className={cls(STK)}>{t.lostValue ? <Signed v={t.lostValue} /> : <span className="text-slate-200">—</span>}</td>
      <td className={cls(STK)}><Kg v={t.closingKg} /></td>
      <td className={cls(STK)}>{t.costPerKg ? t.costPerKg.toFixed(2) : <span className="text-slate-200">—</span>}</td>
      <td className={cls(STK)}><Riel v={t.closingValue} /></td>

      <td className={`${cls()} border-l border-slate-200`}><Signed v={t.profit} /></td>
      <td className={cls()}><Signed v={t.cash} /></td>
    </tr>
  );
}

// ---- the day drawer -------------------------------------------------------
function DayDrawer({ day, txs, payments }) {
  const dayTxs = txs.filter((tx) => tx.tx_date === day.date && (tx.hq_status || "processing") !== "cancelled");
  const buys = dayTxs.filter((t) => t.type === "BUY");
  const sells = dayTxs.filter((t) => t.type === "SELL");
  const exps = payments.filter((p) => p.type === "expense" && p.pay_date === day.date);
  const mix = [day.truck && `${day.truck} truck`, day.koyun && `${day.koyun} koyun`,
    day.tractor && `${day.tractor} tractor`, day.otherVeh && `${day.otherVeh} other`].filter(Boolean).join(" · ");

  const Line = ({ label, a, b, tone }) => (
    <div className="flex items-center gap-3 border-b border-slate-50 px-4 py-2.5 text-[13px] last:border-0">
      <span className="flex-1 text-slate-600">{label}</span>
      <span className={`tabular-nums font-semibold ${tone === "g" ? "text-brand-700" : tone === "r" ? "text-orange-700" : "text-slate-900"}`}>{a}</span>
      {b !== undefined && <span className="w-40 text-right tabular-nums font-semibold text-slate-900">{b}</span>}
    </div>
  );
  const Mini = ({ title, children }) => (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <h5 className="border-b border-slate-100 bg-white px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">{title}</h5>
      {children}
    </div>
  );
  const TicketTable = ({ rows, who }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr className="bg-slate-50/60">
          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ticket</th>
          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">Vehicle</th>
          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">{who}</th>
          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Net kg</th>
          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Price</th>
          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Amount ៛</th>
        </tr></thead>
        <tbody>
          {rows.map((tx) => (
            <tr key={tx.id} className="hover:bg-slate-50/60">
              <td className="border-b border-slate-50 px-4 py-2.5 font-semibold text-slate-900">{tx.paper_ticket_no || tx.code || "—"}</td>
              <td className="border-b border-slate-50 px-4 py-2.5 text-slate-600">{tx.car_plate || "—"}</td>
              <td className="border-b border-slate-50 px-4 py-2.5 text-slate-600">{tx.parties?.name || "—"}</td>
              <td className="border-b border-slate-50 px-4 py-2.5 text-right tabular-nums text-slate-600"><Kg v={Number(tx.quantity_kg) || 0} /></td>
              <td className="border-b border-slate-50 px-4 py-2.5 text-right tabular-nums text-slate-600">{Number(tx.price_per_kg) ? Number(tx.price_per_kg).toFixed(2) : "—"}</td>
              <td className="border-b border-slate-50 px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900"><Riel v={Number(tx.amount) || 0} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="bg-brand-50 px-5 pb-5 pt-4">
      {day.shortfallKg > 0 && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-[13px] text-orange-900">
          <b>{day.shortfallKg.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg shipped that the books say was not in the shed.</b>{" "}
          It has been costed at {day.costPerKg ? day.costPerKg.toFixed(2) : "the prevailing rate"} so the profit is not overstated — but something is missing:
          a purchase not recorded, a weight mistyped, or a ticket entered at the wrong station.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Mini title="What moved through the shed">
          <Line label="Opening — last night's closing" a={<Kg v={day.openingKg} />} b={<><Riel v={day.openingValue} /> ៛</>} />
          <Line label={`+ Bought · ${day.buyLoads} loads`} a={<>+ <Kg v={day.boughtKg} /></>} b={<>+ <Riel v={day.spent} /> ៛</>} tone="g" />
          <Line label={`− Sold · ${day.sellLoads} loads at ${day.costPerKg ? day.costPerKg.toFixed(2) : "—"} cost`} a={<>− <Kg v={day.soldKg} /></>} b={<>− <Riel v={day.cogs} /> ៛</>} tone="r" />
          <Line label={`± Counted difference · ${day.counted ? "count taken" : "no count taken"}`}
            a={day.lostKg ? <Signed v={day.lostKg} /> : <span className="text-slate-300">—</span>}
            b={day.lostValue ? <Signed v={day.lostValue} /> : <span className="text-slate-300">—</span>} />
          <div className="flex items-center gap-3 bg-slate-50 px-4 py-2.5 text-[13px]">
            <span className="flex-1 font-semibold text-slate-900">Overnight in the shed</span>
            <span className="tabular-nums font-semibold text-slate-900"><Kg v={day.closingKg} /> kg</span>
            <span className="w-40 text-right tabular-nums font-semibold text-slate-900"><Riel v={day.closingValue} /> ៛</span>
          </div>
        </Mini>

        <Mini title="Profit, and the cash behind it">
          <Line label="Sales" a={<>+ <Riel v={day.received} /> ៛</>} tone="g" />
          <Line label="Cost of the paddy that left the shed" a={<>− <Riel v={day.cogs} /> ៛</>} tone="r" />
          <Line label="Staff fees" a={day.staff ? <>− <Riel v={day.staff} /> ៛</> : "—"} tone={day.staff ? "r" : ""} />
          <Line label="Other expenses" a={day.otherExp ? <>− <Riel v={day.otherExp} /> ៛</> : "—"} tone={day.otherExp ? "r" : ""} />
          <Line label="Stock lost — counted" a={day.lostValue < 0 ? <>− <Riel v={-day.lostValue} /> ៛</> : "—"} tone={day.lostValue < 0 ? "r" : ""} />
          <div className="flex items-center gap-3 bg-brand-700 px-4 py-2.5 text-[13px] text-white">
            <span className="flex-1 font-semibold">Profit</span>
            <span className="tabular-nums font-semibold">{day.profit >= 0 ? "+" : "−"} {Math.abs(Math.round(day.profit)).toLocaleString("en-US")} ៛</span>
          </div>
          <Line label="Cash — received less paid less expenses" a={<>{day.cash >= 0 ? "+" : "−"} <Riel v={Math.abs(day.cash)} /> ៛</>} />
          <Line label="The difference is paddy bought and not yet sold" a={<>{day.profit - day.cash >= 0 ? "+" : "−"} <Riel v={Math.abs(day.profit - day.cash)} /> ៛</>} />
        </Mini>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Mini title={`Buy — ${day.buyLoads} loads${mix ? ` · ${mix}` : ""}`}>
          {buys.length ? <TicketTable rows={buys} who="Seller" /> : <p className="px-4 py-5 text-[13px] text-slate-400">Nothing bought this day.</p>}
        </Mini>
        <Mini title={`Sell — ${day.sellLoads} loads`}>
          {sells.length ? <TicketTable rows={sells} who="Buyer" /> : <p className="px-4 py-5 text-[13px] text-slate-400">Nothing sold this day.</p>}
        </Mini>
      </div>

      {exps.length > 0 && (
        <div className="mt-4">
          <Mini title={`Expenses — ${exps.length} ${exps.length === 1 ? "entry" : "entries"}`}>
            {exps.map((p, i) => (
              <Line key={p.id || i} label={<><span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{p.category || "Other"}</span>{p.memo || "—"}</>}
                a={<><Riel v={Number(p.amount) || 0} /> ៛</>} />
            ))}
          </Mini>
        </div>
      )}
    </div>
  );
}

// ---- the page -------------------------------------------------------------
export default function DailyBook() {
  const today = cambodiaToday();
  const [locations, setLocations] = useState([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  const [grain, setGrain] = useState("days");
  const [month, setMonth] = useState(today.slice(0, 7));   // "" = whole year
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState({ txs: [], payments: [], adjustments: [] });

  const year = today.slice(0, 4);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const locKey = selectedLocationIds.join(",");

  useEffect(() => { api.getLocations().then(setLocations).catch(() => {}); }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    // One station is pushed into the query; several are filtered in the
    // browser, exactly as reportQuery.js does for every other report.
    const one = selectedLocationIds.length === 1 ? selectedLocationIds[0] : undefined;
    Promise.all([
      api.getTransactions({ locationId: one, from, to }),
      api.getPayments({ locationId: one, type: "expense", from, to }),
      api.getStockAdjustments({ locationId: one, startDate: from, endDate: to }),
    ])
      .then(([txs, payments, adjustments]) => { if (alive) setRaw({ txs, payments, adjustments }); })
      .catch((e) => { if (alive) setError(e.message || "Could not load the Daily Book."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [locKey, from, to]);

  const days = useMemo(
    () => buildDays({ ...raw, locationIds: selectedLocationIds }),
    [raw, locKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const scoped = useMemo(
    () => (month ? days.filter((d) => d.date.startsWith(month)) : days),
    [days, month]
  );
  const periods = useMemo(() => buildPeriods(scoped, grain), [scoped, grain]);
  const totals = useMemo(() => rollup(scoped), [scoped]);

  const months = useMemo(() => [...new Set(days.map((d) => d.date.slice(0, 7)))].sort(), [days]);

  const TH = "px-3.5 pb-2.5 text-right text-[10px] font-semibold text-slate-400 whitespace-nowrap";
  const GH = "px-3.5 pb-1.5 pt-2.5 text-center text-[9.5px] font-bold uppercase tracking-[0.14em]";

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-[15px] font-semibold text-slate-900">Daily Book</h1>
        <span className="rounded-md bg-gold-50 px-2 py-0.5 text-[10.5px] font-semibold text-gold-700 ring-1 ring-gold-300">
          Auto-generated · read only
        </span>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Show</span>
        <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
          {GRAINS.map(([g, label]) => (
            <button key={g} onClick={() => { setGrain(g); setOpen(null); }}
              className={`border-r border-slate-200 px-3.5 py-1.5 text-[13px] last:border-r-0 ${
                grain === g ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-500 hover:bg-slate-50"}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="ml-2 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Period</span>
        <select value={month} onChange={(e) => { setMonth(e.target.value); setOpen(null); }}
          disabled={grain === "year"}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 disabled:opacity-50">
          <option value="">Whole year {year}</option>
          {months.map((m) => <option key={m} value={m}>{MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}</option>)}
        </select>
        <div className="ml-auto">
          <LocationFilter locations={locations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>}
      {loading && <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">Loading…</div>}

      {!loading && !periods.length && (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">
          Nothing recorded for this period.
        </div>
      )}

      {!loading && periods.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[12.5px] tabular-nums">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[3] bg-white" />
                  <th className={`${GH} ${BUY} text-brand-700`} colSpan={4}>Buy</th>
                  <th className={`${GH} ${SELL} text-orange-700`} colSpan={3}>Sell</th>
                  <th className={GH} colSpan={3}>Expenses</th>
                  <th className={`${GH} ${STK} text-sky-800`} colSpan={5}>Stock</th>
                  <th className={GH} colSpan={2}>Result</th>
                </tr>
                <tr>
                  <th className="sticky left-0 z-[3] border-b border-slate-200 bg-white px-3.5 pb-2.5 text-left text-[10px] font-semibold text-slate-400">Period</th>
                  <th className={`${TH} ${BUY} border-b border-slate-200 text-center`}>Loads</th>
                  <th className={`${TH} ${BUY} border-b border-slate-200`}>Weight kg</th>
                  <th className={`${TH} ${BUY} border-b border-slate-200`}>Price ៛</th>
                  <th className={`${TH} ${BUY} border-b border-slate-200`}>Spent ៛</th>
                  <th className={`${TH} ${SELL} border-b border-slate-200 border-l text-center`}>Loads</th>
                  <th className={`${TH} ${SELL} border-b border-slate-200`}>Weight kg</th>
                  <th className={`${TH} ${SELL} border-b border-slate-200`}>Received ៛</th>
                  <th className={`${TH} border-b border-l border-slate-200`}>Staff ៛</th>
                  <th className={`${TH} border-b border-slate-200`}>Other ៛</th>
                  <th className={`${TH} border-b border-slate-200`}>Total ៛</th>
                  <th className={`${TH} ${STK} border-b border-l border-slate-200`}>Lost kg</th>
                  <th className={`${TH} ${STK} border-b border-slate-200`}>Value ៛</th>
                  <th className={`${TH} ${STK} border-b border-slate-200`}>Closing kg</th>
                  <th className={`${TH} ${STK} border-b border-slate-200`}>Cost ៛/kg</th>
                  <th className={`${TH} ${STK} border-b border-slate-200`}>Value ៛</th>
                  <th className={`${TH} border-b border-l border-slate-200`}>Profit ៛</th>
                  <th className={`${TH} border-b border-slate-200`}>Cash ៛</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p, i) => {
                  const { main, sub } = labelFor(p, grain);
                  const isDay = grain === "days";
                  const day = isDay ? p.days[0] : null;
                  const isOpen = isDay && open === p.key;
                  // A week subtotal after each week, so a long month still
                  // reads in chunks. Weeks only — a month view is already short.
                  const nextP = periods[i + 1];
                  const endsWeek = isDay && nextP && isoWeek(p.key).key !== isoWeek(nextP.key).key;
                  const lastOfAll = isDay && !nextP;
                  const weekDays = (endsWeek || lastOfAll)
                    ? scoped.filter((d) => isoWeek(d.date).key === isoWeek(p.key).key) : null;

                  return (
                    <Fragment key={p.key}>
                      <LedgerRow
                        label={main} sub={sub} t={p.totals}
                        open={isOpen}
                        onClick={isDay ? () => setOpen(isOpen ? null : p.key)
                          : () => { setGrain("days"); setMonth(p.days[0].date.slice(0, 7)); }}
                        onLoads={isDay ? () => setOpen(isOpen ? null : p.key) : undefined}
                      />
                      {isOpen && (
                        <tr>
                          <td colSpan={18} className="border-b border-slate-200 p-0">
                            <DayDrawer day={day} txs={raw.txs} payments={raw.payments} />
                          </td>
                        </tr>
                      )}
                      {weekDays && weekDays.length > 1 && (
                        <LedgerRow variant="week"
                          label={`Week ${isoWeek(p.key).week}`} sub={`${weekDays.length} trading days`}
                          t={rollup(weekDays)} />
                      )}
                    </Fragment>
                  );
                })}
                <LedgerRow variant="total"
                  label={month ? `${MONTHS[Number(month.slice(5, 7)) - 1]} total` : `${year} total`}
                  sub={`${totals.days} trading days`} t={totals} />
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-[11.5px] text-slate-400">
            <span><b className="font-semibold text-slate-600">Loads</b> is how many trucks came in — click the number for the vehicles and their tickets</span>
            <span><b className="font-semibold text-slate-600">Price</b> is what was paid that day · <b className="font-semibold text-slate-600">Cost ៛/kg</b> is what the whole shed cost — the same number on a day the shed empties</span>
            <span><b className="font-semibold text-slate-600">Profit</b> = sales − cost of the paddy sold − expenses · <b className="font-semibold text-slate-600">Cash</b> = received − paid − expenses</span>
            <span><b className="font-semibold text-slate-600">Closing kg</b> is a level — it never adds up down the column</span>
          </div>
        </div>
      )}

      <p className="mt-4 text-[11.5px] leading-relaxed text-slate-400">
        Every figure is read from transactions, payments, expense entries and stock counts already recorded.
        Nothing here can be typed or edited — change a transaction and this row, its week, its month and the
        year all recalculate.
      </p>
    </div>
  );
}
