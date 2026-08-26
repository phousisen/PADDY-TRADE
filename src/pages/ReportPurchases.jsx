import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { paidStatusMap } from "./ReportOverview.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

export default function ReportPurchases({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [allRows, setAllRows] = useState([]);
  const [payments, setPayments] = useState([]);
  const [groupBy, setGroupBy] = useState("party");
  const [view, setView] = useState("summary");

  useEffect(() => {
    api.getTransactions({ type: "BUY" }).then(setAllRows);
    api.getPayments({ type: "pay_supplier" }).then(setPayments).catch(() => setPayments([]));
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
  // payments) — use the most recent pay_date as "the date it was paid".
  const paidDateByTx = useMemo(() => {
    const map = {};
    payments.forEach((p) => {
      if (!p.transaction_id) return;
      if (!map[p.transaction_id] || p.pay_date > map[p.transaction_id]) map[p.transaction_id] = p.pay_date;
    });
    return map;
  }, [payments]);

  // Paid/remaining is computed live from the real payments ledger (see
  // paidStatusMap), not from the transaction's own payment_status field —
  // that field doesn't update itself when a payment is recorded later via
  // "Record Payment", so it can silently drift from reality.
  const paidMap = useMemo(() => paidStatusMap(rows, payments), [rows, payments]);

  // "By Item" — mirrors the old bookkeeping system's "Purchases by Item
  // Detail" report: bills grouped by paddy type, each shown with its
  // paid/unpaid status and a running balance per type.
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className={`flex gap-2 ${view === "byitem" ? "opacity-40 pointer-events-none" : ""}`}>
          <span className="text-xs font-medium text-slate-400 self-center">Group by:<span className="font-khmer">តាមក្រុម៖</span></span>
          {[{ v: "party", l: "Supplier", lkm: "អ្នកផ្គត់ផ្គង់" }, { v: "product", l: "Paddy Type", lkm: "ប្រភេទស្រូវ" }, { v: "location", l: "Location", lkm: "ទីតាំង" }].map((o) => (
            <button key={o.v} onClick={() => setGroupBy(o.v)} className={`rounded-lg border px-3 py-1.5 text-sm ${groupBy === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}<span className="font-khmer block text-[10px] font-normal">{o.lkm}</span></button>
          ))}
        </div>
        <div className="flex gap-2">
          {[{ v: "summary", l: "Summary", lkm: "សេចក្តីសង្ខេប" }, { v: "detail", l: "Detail", lkm: "ព័ត៌មានលម្អិត" }, { v: "byitem", l: "By Item", lkm: "តាមប្រភេទទំនិញ" }].map((o) => (
            <button key={o.v} onClick={() => setView(o.v)} className={`rounded-lg border px-3 py-1.5 text-sm ${view === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}<span className="font-khmer block text-[10px] font-normal">{o.lkm}</span></button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-4">
        <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Total Purchased<span className="font-khmer block">ទិញសរុប</span></p>
          <p className="text-2xl font-bold text-slate-800">{fmt2(totalQty)} kg</p>
        </div>
        <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Total Spent<span className="font-khmer block">ចំណាយសរុប</span></p>
          <p className="text-2xl font-bold text-slate-800">{fmtRiel(totalAmount)}</p>
        </div>
      </div>

      {view === "byitem" ? (
        <div>
          {byItemGroups.map((g) => (
            <div key={g.name} className="mb-5 rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <h3 className="font-semibold text-slate-700">{g.name}</h3>
                <p className="text-xs text-slate-400">{fmt2(g.totalQty)} kg · {fmtRiel(g.totalAmount)}</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="px-5 py-2 font-medium">Date<span className="font-khmer block">កាលបរិច្ឆេទ</span></th>
                    <th className="px-5 py-2 font-medium">Bill #<span className="font-khmer block">លេខវិក្កយបត្រ</span></th>
                    <th className="px-5 py-2 font-medium">Note<span className="font-khmer block">កំណត់ចំណាំ</span></th>
                    <th className="px-5 py-2 font-medium">Source (Truck/Driver)<span className="font-khmer block">ប្រភព (ឡាន/អ្នកបើកបរ)</span></th>
                    <th className="px-5 py-2 font-medium">Paid<span className="font-khmer block">បានទូទាត់</span></th>
                    <th className="px-5 py-2 font-medium">Qty (kg)<span className="font-khmer block">បរិមាណ (គីឡូក្រាម)</span></th>
                    <th className="px-5 py-2 font-medium">Cost Price<span className="font-khmer block">តម្លៃដើម</span></th>
                    <th className="px-5 py-2 font-medium">Amount<span className="font-khmer block">ទឹកប្រាក់</span></th>
                    <th className="px-5 py-2 font-medium">Balance<span className="font-khmer block">សមតុល្យ</span></th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-5 py-2.5 text-slate-500">{r.tx_date}</td>
                      <td className="px-5 py-2.5 font-medium text-slate-700">{r.code}</td>
                      <td className="px-5 py-2.5 text-slate-500">{r.note || "—"}</td>
                      <td className="px-5 py-2.5 text-slate-600">{r.driver_name || r.partyName}</td>
                      <td className={`px-5 py-2.5 font-medium ${r.payStatus === "paid" ? "text-emerald-600" : r.payStatus === "partial" ? "text-amber-600" : "text-rose-500"}`}>
                        {r.payStatus === "paid" ? (<>Paid<span className="font-khmer block text-xs font-normal">បានទូទាត់</span></>) : r.payStatus === "partial" ? (<>Partial<span className="font-khmer block text-xs font-normal">ដោយផ្នែក</span></>) : (<>Unpaid<span className="font-khmer block text-xs font-normal">មិនទាន់ទូទាត់</span></>)}
                        {r.payStatus === "partial" && <div className="text-xs font-normal text-slate-400">{fmtRiel(r.paidSoFar)} paid<span className="font-khmer">បានទូទាត់</span></div>}
                        {r.payStatus !== "unpaid" && r.paidDate && <div className="text-xs font-normal text-slate-400">{r.paidDate}</div>}
                      </td>
                      <td className="px-5 py-2.5 text-slate-700">{fmt2(r.quantity_kg)}</td>
                      <td className="px-5 py-2.5 text-slate-700">{fmtRiel(r.price_per_kg)}</td>
                      <td className="px-5 py-2.5 font-medium text-slate-800">{fmtRiel(r.amount)}</td>
                      <td className="px-5 py-2.5 text-slate-700">{fmtRiel(r.runningBalance)}</td>
                    </tr>
                  ))}
                  {g.rows.length === 0 && (
                    <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-slate-400">No purchases for this type yet.<span className="font-khmer block">មិនទាន់មានការទិញសម្រាប់ប្រភេទនេះនៅឡើយទេ។</span></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
          {byItemGroups.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400 shadow-sm">No purchases yet.<span className="font-khmer block">មិនទាន់មានការទិញនៅឡើយទេ។</span></div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          {view === "summary" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">{groupBy === "party" ? (<>Supplier<span className="font-khmer block">អ្នកផ្គត់ផ្គង់</span></>) : groupBy === "product" ? (<>Paddy Type<span className="font-khmer block">ប្រភេទស្រូវ</span></>) : (<>Location<span className="font-khmer block">ទីតាំង</span></>)}</th>
                  <th className="px-5 py-3 font-medium">Transactions<span className="font-khmer block">ប្រតិបត្តិការ</span></th>
                  <th className="px-5 py-3 font-medium">Qty (kg)<span className="font-khmer block">បរិមាណ (គីឡូក្រាម)</span></th>
                  <th className="px-5 py-3 font-medium">Amount<span className="font-khmer block">ទឹកប្រាក់</span></th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g) => (
                  <tr key={g.name} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-700">{g.name}</td>
                    <td className="px-5 py-3 text-slate-600">{g.count}</td>
                    <td className="px-5 py-3 text-slate-700">{fmt2(g.qty)}</td>
                    <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(g.amount)}</td>
                  </tr>
                ))}
                {grouped.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">No purchases yet.<span className="font-khmer block">មិនទាន់មានការទិញនៅឡើយទេ។</span></td></tr>}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Date<span className="font-khmer block">កាលបរិច្ឆេទ</span></th>
                  <th className="px-5 py-3 font-medium">Receipt<span className="font-khmer block">បង្កាន់ដៃ</span></th>
                  <th className="px-5 py-3 font-medium">Supplier<span className="font-khmer block">អ្នកផ្គត់ផ្គង់</span></th>
                  <th className="px-5 py-3 font-medium">Truck/Driver<span className="font-khmer block">ឡាន/អ្នកបើកបរ</span></th>
                  <th className="px-5 py-3 font-medium">Paddy Type<span className="font-khmer block">ប្រភេទស្រូវ</span></th>
                  <th className="px-5 py-3 font-medium">Location<span className="font-khmer block">ទីតាំង</span></th>
                  <th className="px-5 py-3 font-medium">Qty (kg)<span className="font-khmer block">បរិមាណ (គីឡូក្រាម)</span></th>
                  <th className="px-5 py-3 font-medium">Amount<span className="font-khmer block">ទឹកប្រាក់</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3 text-slate-500">{r.tx_date}</td>
                    <td className="px-5 py-3 font-medium text-slate-700">{r.code}</td>
                    <td className="px-5 py-3 text-slate-700">{r.partyName}</td>
                    <td className="px-5 py-3 text-slate-500">{r.driver_name || "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{r.productName}</td>
                    <td className="px-5 py-3 text-slate-600">{r.stationName}</td>
                    <td className="px-5 py-3 text-slate-700">{fmt2(r.quantity_kg)}</td>
                    <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(r.amount)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">No purchases yet.<span className="font-khmer block">មិនទាន់មានការទិញនៅឡើយទេ។</span></td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
