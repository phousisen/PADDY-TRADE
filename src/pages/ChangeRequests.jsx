import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";

export default function ChangeRequests() {
  const { t } = useLanguage();
  const [rows, setRows] = useState([]);

  async function load() { setRows(await api.getChangeRequests()); }
  useEffect(() => { load(); }, []);

  async function resolve(id, status) {
    await api.resolveChangeRequest(id, status);
    load();
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("requests_title")} subtitle={t("requests_subtitle")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">{t("col_id")}</th>
                <th className="px-3 py-3 font-medium">{t("requested_by")}</th>
                <th className="px-3 py-3 font-medium">{t("requested_on")}</th>
                <th className="px-3 py-3 font-medium">{t("reason")}</th>
                <th className="px-3 py-3 font-medium">{t("col_status")}</th>
                <th className="px-3 py-3 font-medium">{t("col_action")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 align-top hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{r.transactionCode}</td>
                  <td className="px-3 py-3 text-slate-600">{r.requestedByName}</td>
                  <td className="px-3 py-3 text-slate-500">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-3 max-w-xs text-slate-600">{r.reason}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${r.status === "pending" ? "bg-amber-50 text-amber-600" : r.status === "approved" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>{t(`status_${r.status}`)}</span>
                  </td>
                  <td className="px-3 py-3">
                    {r.status === "pending" ? (
                      <div className="flex gap-1.5">
                        <button onClick={() => resolve(r.id, "approved")} className="flex items-center gap-1 rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700"><Check size={12} /> {t("approve")}</button>
                        <button onClick={() => resolve(r.id, "rejected")} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"><X size={12} /> {t("reject")}</button>
                      </div>
                    ) : <span className="text-xs text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">{t("no_requests")}</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
