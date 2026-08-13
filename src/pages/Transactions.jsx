import { useEffect, useState } from "react";
import { Download, Plus, CheckCircle2, AlertTriangle, Filter, MapPin, Lock, Flag, ShieldCheck } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

function RequestChangeModal({ tx, t, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><Flag size={16} className="text-amber-500" /> {t("request_change")}</h3>
        <p className="mb-3 text-xs text-slate-400">{tx.code} · {fmt2(tx.quantity_kg)} kg · {fmt2(tx.amount)} Riel</p>
        <label className="mb-1 block text-xs text-slate-500">{t("reason_label")}</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reason_placeholder")} rows={3}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{t("cancel")}</button>
          <button disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">{t("submit_request")}</button>
        </div>
      </div>
    </div>
  );
}

export default function Transactions({ setPage }) {
  const { t } = useLanguage();
  const { profile, session } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [rows, setRows] = useState([]);
  const [type, setType] = useState("");
  const [requestTx, setRequestTx] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const data = await api.getTransactions({ type: type || undefined });
    setRows(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [type]);

  function exportCsv() {
    const header = ["#", "Transaction ID", "Date", "Location", "Party", "Qty (kg)", "Amount (Riel)", "Status"];
    const lines = rows.map((tx, i) => [i + 1, tx.code, tx.tx_date, tx.stationName, tx.partyName, tx.quantity_kg, tx.amount, tx.status]);
    const csv = [header, ...lines].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "transactions.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function submitRequest(reason) {
    await api.createChangeRequest({
      transactionId: requestTx.id,
      requestedBy: session.user.id,
      locationId: profile.location_id,
      reason,
    });
    setRequestTx(null);
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("tx_title")} subtitle={isAdmin ? t("all_locations") : t("my_location")} />
      <main className="flex-1 overflow-y-auto p-6">
        {!isAdmin && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <Lock size={14} /> {t("cannot_edit")}
          </div>
        )}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-2">
            {[{ v: "", l: t("all") }, { v: "BUY", l: t("buy") }, { v: "SELL", l: t("sell") }].map((opt) => (
              <button key={opt.v} onClick={() => setType(opt.v)} className={`rounded-lg border px-3 py-1.5 text-sm ${type === opt.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{opt.l}</button>
            ))}
            <button className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"><Filter size={14} /> {t("filter")}</button>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCsv} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><Download size={14} /> {t("export_csv")}</button>
            <button onClick={() => setPage("new-buy")} className="flex items-center gap-2 rounded-lg border border-brand-600 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"><Plus size={14} /> {t("new_buy")}</button>
            <button onClick={() => setPage("new-sell")} className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"><Plus size={14} /> {t("new_sell")}</button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">#</th>
                <th className="px-3 py-3 font-medium">{t("col_id")}</th>
                <th className="px-3 py-3 font-medium">{t("col_date")}</th>
                <th className="px-3 py-3 font-medium">{t("col_station")}</th>
                <th className="px-3 py-3 font-medium">{t("col_party")}</th>
                <th className="px-3 py-3 font-medium">{t("col_qty")}</th>
                <th className="px-3 py-3 font-medium">{t("col_amount")}</th>
                <th className="px-3 py-3 font-medium">{t("col_status")}</th>
                <th className="px-3 py-3 font-medium">{t("col_action")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx, i) => (
                <tr key={tx.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-3"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${tx.type === "BUY" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}>{tx.code}</span></td>
                  <td className="px-3 py-3 text-slate-500">{tx.tx_date}<div className="text-xs text-slate-400">{tx.tx_time}</div></td>
                  <td className="px-3 py-3 text-slate-600"><div className="flex items-center gap-1"><MapPin size={12} className="text-slate-300" />{tx.stationName}</div></td>
                  <td className="px-3 py-3"><p className="font-medium text-slate-700">{tx.partyName}</p>{tx.partyIdNumber && <p className="text-xs text-slate-400">{tx.partyIdNumber}</p>}</td>
                  <td className="px-3 py-3 text-slate-700">{fmt2(tx.quantity_kg)}</td>
                  <td className="px-3 py-3 font-medium text-slate-800">{fmt2(tx.amount)}</td>
                  <td className="px-3 py-3">{tx.status === "confirmed" ? <CheckCircle2 size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-amber-500" />}</td>
                  <td className="px-3 py-3">
                    {isAdmin ? (
                      <span className="flex items-center gap-1 text-xs text-slate-400"><ShieldCheck size={13} /> HQ</span>
                    ) : (
                      <button onClick={() => setRequestTx(tx)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-amber-300 hover:text-amber-600">
                        <Flag size={12} /> {t("request_change")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-slate-400">{t("no_transactions")}</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
      {requestTx && <RequestChangeModal tx={requestTx} t={t} onClose={() => setRequestTx(null)} onSubmit={submitRequest} />}
    </div>
  );
}
