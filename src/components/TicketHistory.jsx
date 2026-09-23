import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { actionMeta, describeChange, fmtCambodiaDateTime } from "../auditText.js";

// [2026-09-23] THE HISTORY OF THIS ONE TICKET.
//
// SISEN: "we will need to know that the transaction that is being made was
// from whome and what time was it. thats seperateted from the weighing time
// not related… where will we see the action they make".
//
// The Activity Log has always held the answer, but finding one ticket in it
// meant knowing the day and reading past everything else that happened that
// day. This is the same recorded entries, for this ticket only, in the order
// they happened — open a transaction and the story is under it.
//
// It records NOTHING. Every line here was already written the moment the
// action happened, which is what makes it worth trusting.
export default function TicketHistory({ transactionId }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError("");
    api.getTransactionHistory(transactionId)
      .then((data) => { if (alive) setRows(data); })
      // Never fatal. A ticket whose history cannot be read still shows its
      // ticket — the panel just says so.
      .catch((e) => { if (alive) { setRows([]); setError(e.message || ""); } });
    return () => { alive = false; };
  }, [transactionId]);

  return (
    <div className="mt-4 border-t border-slate-200 pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
        <History size={12} /> {t("th_title")}
      </p>

      {rows === null && <p className="text-[12.5px] text-slate-400">{t("loading_label")}</p>}
      {rows !== null && rows.length === 0 && (
        <p className="text-[12.5px] text-slate-400">{error ? t("th_unavailable") : t("th_empty")}</p>
      )}

      {rows !== null && rows.length > 0 && (
        // Columns, not a wrapping sentence: the times line up under each
        // other, so a ticket typed in a day late is visible at a glance
        // rather than having to be read for.
        <ol className="flex flex-col gap-2.5">
          {rows.map((l) => {
            const meta = actionMeta(l.action, t);
            return (
              // One column on a phone, three on a screen wide enough for them.
              <li key={l.id} className="grid grid-cols-1 gap-x-3 gap-y-0.5 text-[12.5px] sm:grid-cols-[130px_120px_1fr]">
                <span className="tabular-nums text-slate-400">{fmtCambodiaDateTime(l.created_at)}</span>
                <span className="truncate font-semibold text-slate-700">{l.userName}</span>
                <span className="min-w-0">
                  <span className="mr-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{meta.label}</span>
                  <span className="text-slate-500">{describeChange(l, t)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
