import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

export default function SimpleListPage({ title, kind }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (kind === "stations") {
      api.getLocations().then(setRows);
      return;
    }

    const partyType = kind === "suppliers" ? "supplier" : "buyer";
    const txType = kind === "suppliers" ? "BUY" : "SELL";

    Promise.all([api.getParties({ type: partyType }), api.getTransactions({ type: txType })]).then(([parties, txs]) => {
      const totalsByParty = {};
      txs.forEach((tx) => {
        if (!totalsByParty[tx.party_id]) totalsByParty[tx.party_id] = { count: 0, qty: 0, amount: 0 };
        totalsByParty[tx.party_id].count += 1;
        totalsByParty[tx.party_id].qty += Number(tx.quantity_kg);
        totalsByParty[tx.party_id].amount += Number(tx.amount);
      });
      setRows(
        parties.map((p) => ({
          ...p,
          ...(totalsByParty[p.id] || { count: 0, qty: 0, amount: 0 }),
        }))
      );
    });
  }, [kind]);

  const columns =
    kind === "stations"
      ? [
          { key: "name", label: "Name" },
          { key: "name_kh", label: "Khmer" },
          { key: "current_stock_kg", label: "Stock (kg)" },
          { key: "capacity_kg", label: "Capacity (kg)" },
        ]
      : kind === "suppliers"
      ? [
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone" },
          { key: "id_number", label: "ID" },
          { key: "bank_name", label: "Bank" },
          { key: "bank_account", label: "Account No." },
          { key: "count", label: "Transactions" },
          { key: "qty", label: "Total Bought (kg)", render: (v) => fmt2(v) },
          { key: "amount", label: "Total Paid", render: (v) => fmtRiel(v) },
        ]
      : [
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone" },
          { key: "company", label: "Company" },
          { key: "count", label: "Transactions" },
          { key: "qty", label: "Total Sold (kg)", render: (v) => fmt2(v) },
          { key: "amount", label: "Total Received", render: (v) => fmtRiel(v) },
        ];

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={title} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                {columns.map((c) => <th key={c.key} className="px-5 py-3 font-medium whitespace-nowrap">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  {columns.map((c) => (
                    <td key={c.key} className="px-5 py-3 text-slate-700 whitespace-nowrap">
                      {c.render ? c.render(r[c.key]) : (r[c.key] || "—")}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-sm text-slate-400">No records visible to your account.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
