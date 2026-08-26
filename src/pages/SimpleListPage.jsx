import { useEffect, useMemo, useState } from "react";
import { Search, PlusCircle } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { paidStatusMap } from "./ReportOverview.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

export default function SimpleListPage({ title, kind, onBuyFor, onSellFor, onOpenParty }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (kind === "stations") {
      api.getLocations().then(setRows);
      return;
    }

    const partyType = kind === "suppliers" ? "supplier" : "buyer";
    const txType = kind === "suppliers" ? "BUY" : "SELL";
    const payType = kind === "suppliers" ? "pay_supplier" : "receive_customer";

    Promise.all([
      api.getParties({ type: partyType }),
      api.getTransactions({ type: txType }),
      api.getPayments({ type: payType }).catch(() => []),
    ]).then(([parties, txs, payments]) => {
      // Paid vs. still-owed is computed live from the real payments ledger
      // (same paidStatusMap used on the Transactions list and every
      // report), not from the transaction's own payment_status field —
      // that field doesn't update itself once a payment is recorded later,
      // so it can quietly drift from what's actually been paid.
      // Cancelled transactions must not count toward a farmer/buyer's
      // totals here — same rule as every report and the Transaction
      // History table on their own profile page. Without this, a
      // cancelled sale still added its kg/amount into "Total Sold" /
      // "Amount Received" on this list even though it never really
      // happened.
      const activeTxs = txs.filter((tx) => (tx.hq_status || "processing") !== "cancelled");
      const paidMap = paidStatusMap(activeTxs, payments);
      const totalsByParty = {};
      activeTxs.forEach((tx) => {
        if (!totalsByParty[tx.party_id]) totalsByParty[tx.party_id] = { count: 0, qty: 0, amount: 0, paid: 0, remaining: 0 };
        totalsByParty[tx.party_id].count += 1;
        totalsByParty[tx.party_id].qty += Number(tx.quantity_kg);
        totalsByParty[tx.party_id].amount += Number(tx.amount);
        totalsByParty[tx.party_id].paid += paidMap[tx.id]?.paid || 0;
        totalsByParty[tx.party_id].remaining += paidMap[tx.id]?.remaining || 0;
      });
      setRows(
        parties.map((p) => ({
          ...p,
          ...(totalsByParty[p.id] || { count: 0, qty: 0, amount: 0, paid: 0, remaining: 0 }),
        }))
      );
    });
  }, [kind]);

  // Search by name or phone number — lets HQ staff quickly find a farmer
  // or buyer they've talked to before instead of scrolling the whole list.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.phone || "").toLowerCase().includes(q));
  }, [rows, search]);

  const columns =
    kind === "stations"
      ? [
          { key: "name", label: "Name", labelKm: "ឈ្មោះ" },
          { key: "name_kh", label: "Khmer", labelKm: "ភាសាខ្មែរ" },
          { key: "current_stock_kg", label: "Stock (kg)", labelKm: "ស្តុក (គីឡូក្រាម)" },
          { key: "capacity_kg", label: "Capacity (kg)", labelKm: "សមត្ថភាព (គីឡូក្រាម)" },
        ]
      : kind === "suppliers"
      ? [
          { key: "name", label: "Name", labelKm: "ឈ្មោះ" },
          { key: "phone", label: "Phone", labelKm: "ទូរស័ព្ទ" },
          { key: "id_number", label: "ID", labelKm: "អត្តសញ្ញាណប័ណ្ណ" },
          { key: "bank_name", label: "Bank", labelKm: "ធនាគារ" },
          { key: "bank_account", label: "Account No.", labelKm: "លេខគណនី" },
          { key: "bank_qr_url", label: "QR Code", labelKm: "កូដ QR", render: (v) => v ? <a href={v} target="_blank" rel="noreferrer" className="text-brand-600 underline decoration-dotted hover:text-brand-700">View<span className="font-khmer ml-1">មើល</span></a> : "—" },
          { key: "count", label: "Transactions", labelKm: "ប្រតិបត្តិការ" },
          { key: "qty", label: "Total Bought (kg)", labelKm: "សរុបទិញ (គីឡូក្រាម)", render: (v) => fmt2(v) },
          { key: "paid", label: "Amount Paid", labelKm: "ចំនួនបានបង់", render: (v) => <span className="text-emerald-600">{fmtRiel(v)}</span> },
          { key: "remaining", label: "Amount Unpaid", labelKm: "ចំនួនមិនទាន់បង់", render: (v) => (v > 0.01 ? <span className="font-medium text-rose-500">{fmtRiel(v)}</span> : <span className="text-slate-400">{fmtRiel(0)}</span>) },
        ]
      : [
          { key: "name", label: "Name", labelKm: "ឈ្មោះ" },
          { key: "phone", label: "Phone", labelKm: "ទូរស័ព្ទ" },
          { key: "company", label: "Company", labelKm: "ក្រុមហ៊ុន" },
          { key: "count", label: "Transactions", labelKm: "ប្រតិបត្តិការ" },
          { key: "qty", label: "Total Sold (kg)", labelKm: "សរុបលក់ (គីឡូក្រាម)", render: (v) => fmt2(v) },
          { key: "paid", label: "Amount Received", labelKm: "ចំនួនបានទទួល", render: (v) => <span className="text-emerald-600">{fmtRiel(v)}</span> },
          { key: "remaining", label: "Amount Not Received", labelKm: "ចំនួនមិនទាន់ទទួល", render: (v) => (v > 0.01 ? <span className="font-medium text-amber-600">{fmtRiel(v)}</span> : <span className="text-slate-400">{fmtRiel(0)}</span>) },
        ];

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={title} />
      <main className="flex-1 overflow-y-auto p-6">
        {kind !== "stations" && (
          <div className="mb-4 relative w-full max-w-xs">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </div>
        )}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                {columns.map((c) => <th key={c.key} className="px-5 py-3 font-medium whitespace-nowrap">{c.label}<span className="font-khmer block text-[10px] font-normal">{c.labelKm}</span></th>)}
                {(onBuyFor || onSellFor) && <th className="px-5 py-3 font-medium whitespace-nowrap">Action<span className="font-khmer block text-[10px] font-normal">សកម្មភាព</span></th>}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  {columns.map((c) => (
                    <td key={c.key} className="px-5 py-3 text-slate-700 whitespace-nowrap">
                      {c.key === "name" && onOpenParty ? (
                        <button onClick={() => onOpenParty(r)} className="font-medium text-brand-700 underline decoration-dotted hover:text-brand-800">
                          {r.name || "—"}
                        </button>
                      ) : c.render ? (
                        c.render(r[c.key])
                      ) : (
                        r[c.key] || "—"
                      )}
                    </td>
                  ))}
                  {(onBuyFor || onSellFor) && (
                    <td className="px-5 py-3 whitespace-nowrap">
                      <button
                        onClick={() => (onBuyFor ? onBuyFor(r) : onSellFor(r))}
                        className="flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        <PlusCircle size={13} /> {onBuyFor ? (<>New Buy<span className="font-khmer block text-[10px] font-normal">ទិញថ្មី</span></>) : (<>New Sell<span className="font-khmer block text-[10px] font-normal">លក់ថ្មី</span></>)}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + ((onBuyFor || onSellFor) ? 1 : 0)} className="px-5 py-10 text-center text-sm text-slate-400">
                    {rows.length === 0 ? (<>No records visible to your account.<span className="font-khmer block">មិនមានកំណត់ត្រាដែលមើលឃើញសម្រាប់គណនីរបស់អ្នកទេ។</span></>) : (<>No matches for your search.<span className="font-khmer block">មិនមានលទ្ធផលដូចនឹងការស្វែងរករបស់អ្នកទេ។</span></>)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
