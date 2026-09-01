import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { getAccurateNow } from "../supabaseClient.js";
import { SummaryStrip, SummaryCell, TableCard, Table, Th, Td, Tr, AgeBadge } from "../components/ReportUI.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

function ageBucket(days) {
  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "90+ days";
}

const TYPE = "BUY";
const PAY_TYPE = "pay_supplier";
const PARTY_LABEL = "Supplier";

export default function ReportPayables({ selectedLocationIds = [], startDate = null, endDate = null }) {
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
        // outstanding" — as if every supplier had been paid in full —
        // instead of saying the load itself had failed.
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

  // Splits what's owed by paddy type — like separate AP sub-accounts per
  // item (AP Sen Krob, AP IR, AP Srangae, etc.) in the old bookkeeping
  // system, instead of one lump Accounts Payable total.
  const byProduct = useMemo(() => {
    const map = {};
    outstanding.forEach((r) => {
      const k = r.productName || "—";
      if (!map[k]) map[k] = { name: k, count: 0, amount: 0 };
      map[k].count += 1;
      map[k].amount += r.remaining;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [outstanding]);

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}

      <SummaryStrip>
        <SummaryCell label="Total Outstanding" value={fmtRiel(totalOutstanding)} tone="neg" />
      </SummaryStrip>

      <div className="mb-4 flex flex-wrap gap-2">
        {[{ v: "aging", l: "Aging Summary" }, { v: "party", l: `By ${PARTY_LABEL}` }, { v: "location", l: "By Location" }, { v: "product", l: "By Paddy Type" }, { v: "detail", l: "Detail" }].map((o) => (
          <button key={o.v} onClick={() => setView(o.v)} className={`rounded-lg border px-3 py-1.5 text-[13.5px] ${view === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
        ))}
      </div>

      {view === "aging" && (
        <TableCard title="Aging Summary">
          <Table>
            <thead>
              <tr><Th>Age</Th><Th num>Transactions</Th><Th num>Amount Owed</Th></tr>
            </thead>
            <tbody>
              {byBucket.map((b) => (
                <Tr key={b.bucket}>
                  <Td><AgeBadge bucket={b.bucket} /></Td>
                  <Td num>{b.count}</Td>
                  <Td num>{fmtRiel(b.amount)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}
      {view === "party" && (
        <TableCard title={`By ${PARTY_LABEL}`}>
          <Table>
            <thead>
              <tr><Th>{PARTY_LABEL}</Th><Th num>Transactions</Th><Th num>Amount Owed</Th></tr>
            </thead>
            <tbody>
              {byParty.map((p) => (
                <Tr key={p.name}>
                  <Td name>{p.name}</Td>
                  <Td num>{p.count}</Td>
                  <Td num>{fmtRiel(p.amount)}</Td>
                </Tr>
              ))}
              {loading && byParty.length === 0 && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
              {byParty.length === 0 && !loading && !loadError && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Nothing outstanding.</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      )}
      {view === "location" && (
        <TableCard title="By Location">
          <Table>
            <thead>
              <tr><Th>Location</Th><Th num>Transactions</Th><Th num>Amount Owed</Th></tr>
            </thead>
            <tbody>
              {byLocation.map((p) => (
                <Tr key={p.name}>
                  <Td name>{p.name}</Td>
                  <Td num>{p.count}</Td>
                  <Td num>{fmtRiel(p.amount)}</Td>
                </Tr>
              ))}
              {loading && byLocation.length === 0 && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
              {byLocation.length === 0 && !loading && !loadError && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Nothing outstanding.</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      )}
      {view === "product" && (
        <TableCard title="By Paddy Type">
          <Table>
            <thead>
              <tr><Th>Paddy Type</Th><Th num>Transactions</Th><Th num>Amount Owed</Th></tr>
            </thead>
            <tbody>
              {byProduct.map((p) => (
                <Tr key={p.name}>
                  <Td name>{p.name}</Td>
                  <Td num>{p.count}</Td>
                  <Td num>{fmtRiel(p.amount)}</Td>
                </Tr>
              ))}
              {loading && byProduct.length === 0 && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
              {byProduct.length === 0 && !loading && !loadError && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Nothing outstanding.</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      )}
      {view === "detail" && (
        <TableCard title="Detail">
          <Table>
            <thead>
              <tr><Th>Date</Th><Th>Receipt</Th><Th>{PARTY_LABEL}</Th><Th>Location</Th><Th>Age</Th><Th num>Amount Owed</Th></tr>
            </thead>
            <tbody>
              {outstanding.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.tx_date}</Td>
                  <Td name>{r.code}</Td>
                  <Td>{r.partyName}</Td>
                  <Td>{r.stationName}</Td>
                  <Td>
                    <AgeBadge bucket={r.bucket} />
                    <span className="ml-1.5 text-[11.5px] text-slate-400">{r.days}d</span>
                  </Td>
                  <Td num>{fmtRiel(r.remaining)}</Td>
                </Tr>
              ))}
              {loading && outstanding.length === 0 && <Tr><td colSpan={6} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
              {outstanding.length === 0 && !loading && !loadError && <Tr><td colSpan={6} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Nothing outstanding.</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}
