import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { getAccurateNow } from "../supabaseClient.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

function ageBucket(days) {
  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "90+ days";
}

const TYPE = "SELL";
const PAY_TYPE = "receive_customer";
const PARTY_LABEL = "Customer";

export default function ReportReceivables({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [allRows, setAllRows] = useState([]);
  const [payments, setPayments] = useState([]);
  const [view, setView] = useState("aging");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  function load() {
    setLoading(true);
    setLoadError("");
    Promise.all([api.getTransactions({ type: TYPE }), api.getPayments({ type: PAY_TYPE })])
      .then(([tx, pay]) => {
        setAllRows(tx);
        setPayments(pay);
      })
      .catch((err) => {
        // Without this, a failed/dropped request silently showed "Nothing
        // outstanding" — as if every customer had paid in full — instead
        // of saying the load itself had failed.
        setLoadError(err.message || "Couldn't load this report — check your connection and try again.");
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const rows = allRows
    .filter((r) => (r.hq_status || "processing") !== "cancelled")
    .filter((r) => !selectedLocationIds.length || selectedLocationIds.includes(r.location_id))
    .filter((r) => !startDate || r.tx_date >= startDate)
    .filter((r) => !endDate || r.tx_date <= endDate);

  const outstanding = useMemo(() => {
    const today = getAccurateNow();
    return rows
      .map((tx) => {
        const paid = payments.filter((p) => p.transaction_id === tx.id).reduce((s, p) => s + Number(p.amount), 0);
        const remaining = Math.max(0, Number(tx.total_with_tax ?? tx.amount) - paid);
        const days = Math.floor((today - new Date(tx.tx_date)) / (1000 * 60 * 60 * 24));
        return { ...tx, remaining, days, bucket: ageBucket(days) };
      })
      .filter((tx) => tx.remaining > 0.01)
      .sort((a, b) => b.days - a.days);
  }, [rows, payments]);

  const totalOutstanding = outstanding.reduce((s, r) => s + r.remaining, 0);

  const byBucket = useMemo(() => {
    const buckets = ["0-30 days", "31-60 days", "61-90 days", "90+ days"];
    return buckets.map((b) => ({
      bucket: b,
      count: outstanding.filter((r) => r.bucket === b).length,
      amount: outstanding.filter((r) => r.bucket === b).reduce((s, r) => s + r.remaining, 0),
    }));
  }, [outstanding]);

  const byParty = useMemo(() => {
    const map = {};
    outstanding.forEach((r) => {
      const k = r.partyName || "—";
      if (!map[k]) map[k] = { name: k, count: 0, amount: 0 };
      map[k].count += 1;
      map[k].amount += r.remaining;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [outstanding]);

  const byLocation = useMemo(() => {
    const map = {};
    outstanding.forEach((r) => {
      const k = r.stationName || "—";
      if (!map[k]) map[k] = { name: k, count: 0, amount: 0 };
      map[k].count += 1;
      map[k].amount += r.remaining;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [outstanding]);

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-400">Total Outstanding</p>
          <p className="text-2xl font-bold text-rose-600">{fmtRiel(totalOutstanding)}</p>
        </div>
        <div className="flex gap-2">
          {[{ v: "aging", l: "Aging Summary" }, { v: "party", l: `By ${PARTY_LABEL}` }, { v: "location", l: "By Location" }, { v: "detail", l: "Detail" }].map((o) => (
            <button key={o.v} onClick={() => setView(o.v)} className={`rounded-lg border px-3 py-1.5 text-sm ${view === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        {view === "aging" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Age</th>
                <th className="px-5 py-3 font-medium">Transactions</th>
                <th className="px-5 py-3 font-medium">Amount Owed</th>
              </tr>
            </thead>
            <tbody>
              {byBucket.map((b) => (
                <tr key={b.bucket} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className={`px-5 py-3 font-medium ${b.bucket === "90+ days" ? "text-rose-600" : "text-slate-700"}`}>{b.bucket}</td>
                  <td className="px-5 py-3 text-slate-600">{b.count}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view === "party" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">{PARTY_LABEL}</th>
                <th className="px-5 py-3 font-medium">Transactions</th>
                <th className="px-5 py-3 font-medium">Amount Owed</th>
              </tr>
            </thead>
            <tbody>
              {byParty.map((p) => (
                <tr key={p.name} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{p.name}</td>
                  <td className="px-5 py-3 text-slate-600">{p.count}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(p.amount)}</td>
                </tr>
              ))}
              {loading && byParty.length === 0 && <tr><td colSpan={3} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {byParty.length === 0 && !loading && !loadError && <tr><td colSpan={3} className="px-5 py-10 text-center text-sm text-slate-400">Nothing outstanding.</td></tr>}
            </tbody>
          </table>
        )}
        {view === "location" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Transactions</th>
                <th className="px-5 py-3 font-medium">Amount Owed</th>
              </tr>
            </thead>
            <tbody>
              {byLocation.map((p) => (
                <tr key={p.name} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{p.name}</td>
                  <td className="px-5 py-3 text-slate-600">{p.count}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(p.amount)}</td>
                </tr>
              ))}
              {loading && byLocation.length === 0 && <tr><td colSpan={3} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {byLocation.length === 0 && !loading && !loadError && <tr><td colSpan={3} className="px-5 py-10 text-center text-sm text-slate-400">Nothing outstanding.</td></tr>}
            </tbody>
          </table>
        )}
        {view === "detail" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Receipt</th>
                <th className="px-5 py-3 font-medium">{PARTY_LABEL}</th>
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Age</th>
                <th className="px-5 py-3 font-medium">Amount Owed</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-500">{r.tx_date}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{r.code}</td>
                  <td className="px-5 py-3 text-slate-700">{r.partyName}</td>
                  <td className="px-5 py-3 text-slate-600">{r.stationName}</td>
                  <td className={`px-5 py-3 ${r.days > 90 ? "text-rose-600 font-medium" : "text-slate-600"}`}>{r.days} days</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(r.remaining)}</td>
                </tr>
              ))}
              {loading && outstanding.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {outstanding.length === 0 && !loading && !loadError && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">Nothing outstanding.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
