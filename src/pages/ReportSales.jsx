import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { paidStatusMap } from "./ReportOverview.jsx";
import { SummaryStrip, SummaryCell, TableCard, Table, Th, Td, Tr, Tfoot } from "../components/ReportUI.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

export default function ReportSales({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [allRows, setAllRows] = useState([]);
  const [payments, setPayments] = useState([]);
  const [groupBy, setGroupBy] = useState("party");
  const [view, setView] = useState("summary");

  useEffect(() => {
    api.getTransactions({ type: "SELL" }).then(setAllRows);
    api.getPayments({ type: "receive_customer" }).then(setPayments).catch(() => setPayments([]));
  }, []);

  const rows = allRows
    .filter((r) => (r.hq_status || "processing") !== "cancelled")
    .filter((r) => !selectedLocationIds.length || selectedLocationIds.includes(r.location_id))
    .filter((r) => !startDate || r.tx_date >= startDate)
    .filter((r) => !endDate || r.tx_date <= endDate);

  const grouped = useMemo(() => {
    const key = groupBy === "party" ? "partyName" : groupBy === "product" ? "productName" : "stationName";
    const map = {};
    rows.forEach((r) => {
      const k = r[key] || "—";
      if (!map[k]) map[k] = { name: k, count: 0, qty: 0, amount: 0 };
      map[k].count += 1;
      map[k].qty += Number(r.quantity_kg);
      map[k].amount += Number(r.amount);
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [rows, groupBy]);

  // A transaction can have more than one payment logged against it (partial
  // payments) — use the most recent pay_date as "the date it was received".
  const paidDateByTx = useMemo(() => {
    const map = {};
    payments.forEach((p) => {
      if (!p.transaction_id) return;
      if (!map[p.transaction_id] || p.pay_date > map[p.transaction_id]) map[p.transaction_id] = p.pay_date;
    });
    return map;
  }, [payments]);

  // Received/remaining is computed live from the real payments ledger (see
  // paidStatusMap), not from the transaction's own payment_status field —
  // that field doesn't update itself when a payment is recorded later via
  // "Record Payment", so it can silently drift from reality.
  const paidMap = useMemo(() => paidStatusMap(rows, payments), [rows, payments]);

  // "By Item" — the Sales version of the Purchases "By Item" report: bills
  // grouped by paddy type, each shown with its received/unreceived status
  // and a running balance per type.
  const byItemGroups = useMemo(() => {
    const map = {};
    rows.forEach((r) => {
      const k = r.productName || "—";
      if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    return Object.keys(map).sort().map((name) => {
      const sorted = map[name].slice().sort((a, b) => {
        const pa = (paidMap[a.id]?.remaining || 0) <= 0.01 ? 0 : 1;
        const pb = (paidMap[b.id]?.remaining || 0) <= 0.01 ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return a.tx_date < b.tx_date ? -1 : a.tx_date > b.tx_date ? 1 : a.code < b.code ? -1 : 1;
      });
      let bal = 0;
      const withBalance = sorted.map((r) => {
        bal += Number(r.amount);
        const remaining = paidMap[r.id]?.remaining || 0;
        const paidSoFar = paidMap[r.id]?.paid || 0;
        const status = remaining <= 0.01 ? "paid" : paidSoFar > 0 ? "partial" : "unpaid";
        return { ...r, runningBalance: bal, paidDate: paidDateByTx[r.id] || null, payStatus: status, remaining, paidSoFar };
      });
      return {
        name,
        rows: withBalance,
        totalQty: sorted.reduce((s, r) => s + Number(r.quantity_kg), 0),
        totalAmount: sorted.reduce((s, r) => s + Number(r.amount), 0),
      };
    });
  }, [rows, paidDateByTx, paidMap]);

  const totalQty = rows.reduce((s, r) => s + Number(r.quantity_kg), 0);
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div>
      <SummaryStrip>
        <SummaryCell label="Total Sold" value={`${fmt2(totalQty)} kg`} />
        <SummaryCell label="Total Revenue" value={fmtRiel(totalAmount)} />
      </SummaryStrip>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className={`flex flex-wrap gap-2 ${view === "byitem" ? "opacity-40 pointer-events-none" : ""}`}>
          <span className="self-center text-[11.5px] font-medium text-slate-400">Group by:</span>
          {[{ v: "party", l: "Customer" }, { v: "product", l: "Paddy Type" }, { v: "location", l: "Location" }].map((o) => (
            <button key={o.v} onClick={() => setGroupBy(o.v)} className={`rounded-lg border px-3 py-1.5 text-[13.5px] ${groupBy === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {[{ v: "summary", l: "Summary" }, { v: "detail", l: "Detail" }, { v: "byitem", l: "By Item" }].map((o) => (
            <button key={o.v} onClick={() => setView(o.v)} className={`rounded-lg border px-3 py-1.5 text-[13.5px] ${view === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
          ))}
        </div>
      </div>

      {view === "byitem" ? (
        <div>
          {byItemGroups.map((g) => (
            <TableCard
              key={g.name}
              title={g.name}
              right={<span className="text-[11.5px] font-normal text-slate-400">{fmt2(g.totalQty)} kg · {fmtRiel(g.totalAmount)}</span>}
              className="mb-4"
            >
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th><Th>Bill #</Th><Th>Note</Th><Th>Buyer / Truck</Th><Th>Received</Th>
                    <Th num>Qty (kg)</Th><Th num>Sale Price</Th><Th num>Amount</Th><Th num>Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <Tr key={r.id}>
                      <Td>{r.tx_date}</Td>
                      <Td name>{r.code}</Td>
                      <Td>{r.note || "—"}</Td>
                      <Td>{r.partyName}{r.driver_name ? ` · ${r.driver_name}` : ""}</Td>
                      <Td className={r.payStatus === "paid" ? "!text-brand-700 !font-semibold" : r.payStatus === "partial" ? "!text-amber-600 !font-semibold" : "!text-rose-600 !font-semibold"}>
                        {r.payStatus === "paid" ? "Received" : r.payStatus === "partial" ? "Partial" : "Not Received"}
                        {r.payStatus === "partial" && <div className="text-[11px] font-normal text-slate-400">{fmtRiel(r.paidSoFar)} received</div>}
                        {r.payStatus !== "unpaid" && r.paidDate && <div className="text-[11px] font-normal text-slate-400">{r.paidDate}</div>}
                      </Td>
                      <Td num>{fmt2(r.quantity_kg)}</Td>
                      <Td num>{fmtRiel(r.price_per_kg)}</Td>
                      <Td num>{fmtRiel(r.amount)}</Td>
                      <Td num>{fmtRiel(r.runningBalance)}</Td>
                    </Tr>
                  ))}
                  {g.rows.length === 0 && (
                    <Tr><td colSpan={9} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No sales for this type yet.</td></Tr>
                  )}
                </tbody>
                {g.rows.length > 0 && (
                  <Tfoot>
                    <tr>
                      <td colSpan={5}>Total</td>
                      <td className="text-right">{fmt2(g.totalQty)}</td>
                      <td></td>
                      <td className="text-right">{fmtRiel(g.totalAmount)}</td>
                      <td></td>
                    </tr>
                  </Tfoot>
                )}
              </Table>
            </TableCard>
          ))}
          {byItemGroups.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-[13.5px] text-slate-400">No sales yet.</div>
          )}
        </div>
      ) : view === "summary" ? (
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>{groupBy === "party" ? "Customer" : groupBy === "product" ? "Paddy Type" : "Location"}</Th>
                <Th num>Transactions</Th><Th num>Qty (kg)</Th><Th num>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <Tr key={g.name}>
                  <Td name>{g.name}</Td>
                  <Td num>{g.count}</Td>
                  <Td num>{fmt2(g.qty)}</Td>
                  <Td num>{fmtRiel(g.amount)}</Td>
                </Tr>
              ))}
              {grouped.length === 0 && <Tr><td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No sales yet.</td></Tr>}
            </tbody>
            {grouped.length > 0 && (
              <Tfoot>
                <tr>
                  <td>Total</td>
                  <td className="text-right">{rows.length}</td>
                  <td className="text-right">{fmt2(totalQty)}</td>
                  <td className="text-right">{fmtRiel(totalAmount)}</td>
                </tr>
              </Tfoot>
            )}
          </Table>
        </TableCard>
      ) : (
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th><Th>Receipt</Th><Th>Customer</Th><Th>Paddy Type</Th><Th>Location</Th>
                <Th num>Qty (kg)</Th><Th num>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.tx_date}</Td>
                  <Td name>{r.code}</Td>
                  <Td>{r.partyName}</Td>
                  <Td>{r.productName}</Td>
                  <Td>{r.stationName}</Td>
                  <Td num>{fmt2(r.quantity_kg)}</Td>
                  <Td num>{fmtRiel(r.amount)}</Td>
                </Tr>
              ))}
              {rows.length === 0 && <Tr><td colSpan={7} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No sales yet.</td></Tr>}
            </tbody>
            {rows.length > 0 && (
              <Tfoot>
                <tr>
                  <td colSpan={5}>Total</td>
                  <td className="text-right">{fmt2(totalQty)}</td>
                  <td className="text-right">{fmtRiel(totalAmount)}</td>
                </tr>
              </Tfoot>
            )}
          </Table>
        </TableCard>
      )}
    </div>
  );
}
