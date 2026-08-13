import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";

export default function SimpleListPage({ title, kind }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (kind === "suppliers") api.getParties({ type: "supplier" }).then(setRows);
    else if (kind === "buyers") api.getParties({ type: "buyer" }).then(setRows);
    else if (kind === "stations") api.getLocations().then(setRows);
  }, [kind]);

  const columns =
    kind === "stations"
      ? [{ key: "name", label: "Name" }, { key: "name_kh", label: "Khmer" }, { key: "current_stock_kg", label: "Stock (kg)" }, { key: "capacity_kg", label: "Capacity (kg)" }]
      : [{ key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "id_number", label: "ID" }];

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={title} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                {columns.map((c) => <th key={c.key} className="px-5 py-3 font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  {columns.map((c) => <td key={c.key} className="px-5 py-3 text-slate-700">{r[c.key]}</td>)}
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
