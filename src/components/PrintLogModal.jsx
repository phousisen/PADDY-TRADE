import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { printsOf, fmtPrintedAt } from "../printLog.js";

// [2026-09-27] EVERY RECEIPT ONE TICKET HAS PRODUCED — opened from the ×N on
// its Receipt button.
//
// SISEN: "for the print number, can open and see details right".
//
// One row per press of Print: which sheet it was, when, and who. Read from
// the entries recorded the moment each print happened; this screen records
// nothing. The sheet number is worked out from the order (printLog.js), so a
// station that printed while offline still lands in the right place.
export default function PrintLogModal({ tx, onClose }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    api.getTransactionHistory(tx.id)
      .then((r) => { if (alive) setRows(printsOf(r).filter((p) => p.from === "receipt")); })
      // Never fatal — the list simply says it could not be read.
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [tx.id]);

  const n = rows ? rows.length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="flex items-center gap-2 text-[15px] font-bold text-slate-800">
              <Printer size={16} className={n > 1 ? "text-gold-700" : "text-slate-400"} />
              {rows === null ? t("loading_label") : t(n === 1 ? "ph_count_one" : "ph_count_many", { n })}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {t("tx_ticket_no")} {tx.paper_ticket_no || "—"} · {tx.code}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label={t("xr_close")}>
            <X size={16} />
          </button>
        </div>

        {rows !== null && rows.length === 0 && (
          <p className="px-5 py-6 text-sm text-slate-400">{t("ph_none")}</p>
        )}

        {rows !== null && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                <th className="whitespace-nowrap px-5 py-2 font-semibold">{t("pl_sheet")}</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">{t("pl_when")}</th>
                <th className="whitespace-nowrap px-5 py-2 font-semibold">{t("pl_who")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.atIso + p.copy} className="border-b border-slate-50 last:border-0">
                  <td className="whitespace-nowrap px-5 py-2.5">
                    <span className="font-semibold tabular-nums text-slate-800">{p.copy}</span>
                    <span className="ml-2 text-xs text-slate-400">{p.copy === 1 ? t("ph_original") : t("pl_reprint")}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-600">{fmtPrintedAt(p.atIso)}</td>
                  <td className="px-5 py-2.5 font-medium text-slate-700">{p.who || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
