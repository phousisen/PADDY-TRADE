import { useEffect, useMemo, useState, useRef } from "react";
import { api } from "../api.js";
import { rangeKey } from "../reportQuery.js";
import { TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";
import { useLanguage } from "../i18n.jsx";
// [2026-09-23] The labels and the sentences moved to src/auditText.js so the
// ticket History panel (TicketHistory.jsx) says exactly the same words about
// exactly the same recorded action.
import { CATEGORIES, actionMeta, describeChange, fmtCambodiaDateTime } from "../auditText.js";

// [2026-09-23] `personId` and `onPeople` are how the Activity Log page
// (pages/ActivityLog.jsx) adds a "who" filter without this component having
// to fetch the staff list: it already holds every entry for the period, so
// the people who actually DID something in that period are right here. Both
// are optional — Finance → Reports rendered this with neither for months.
export default function ReportAuditLog({ selectedLocationIds = [], startDate = null, endDate = null, personId = "", onPeople = null }) {
  const { t } = useLanguage();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const loadSeq = useRef(0);
  const [loadError, setLoadError] = useState("");
  const [category, setCategory] = useState("all");

  function load() {
    // [2026-09-19] Only the newest request may fill the page: changing the
    // station or dates quickly let an older, slower answer land last (audit F12).
    const my = ++loadSeq.current;
    const live = () => my === loadSeq.current;
    setLoading(true);
    setLoadError("");
    // [2026-09-12] Asks the database for the chosen period instead of
    // downloading every entry ever recorded — see api.getAuditLogs.
    api.getAuditLogs({ from: startDate, to: endDate })
      .then((data) => { if (live()) setLogs(data); })
      .catch((err) => {
        if (!live()) return;
        // Without this, a failed/dropped request left this page stuck
        // showing nothing, with no error and no way to retry.
        setLoadError(err.message || t("al_err_load"));
      })
      .finally(() => { if (live()) setLoading(false); });
  }
  // Refetch when the period changes — rangeKey gives a stable string so an
  // array prop does not retrigger this on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [rangeKey({ selectedLocationIds, startDate, endDate })]);

  // [2026-09-19] The station filter at the top of Reports used to do nothing
  // here (audit F29). A log entry has no station of its own, so it follows
  // the station of the person who did it; head-office accounts (no station)
  // show only under "All locations".
  const locKey = [...selectedLocationIds].sort().join(",");
  const filteredLogs = useMemo(() => {
    const wanted = selectedLocationIds.length ? new Set(selectedLocationIds) : null;
    return logs.filter((l) =>
      (!wanted || wanted.has(l.userLocationId)) &&
      (!personId || l.user_id === personId) &&
      (category === "all" || actionMeta(l.action, t).category === category));
  }, [logs, category, locKey, personId, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Everyone who did something in this period, by name, for the "who" filter
  // above. Reported upward rather than held here, so the filter can sit in
  // the page's own toolbar beside the station and the dates.
  useEffect(() => {
    if (!onPeople) return;
    const seen = new Map();
    for (const l of logs) if (l.user_id && !seen.has(l.user_id)) seen.set(l.user_id, l.userName || "—");
    onPeople(Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
  }, [logs]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
        {t("al_intro")}
        {selectedLocationIds.length > 0 && <span className="mt-1 block">{t("al_station_note")}</span>}
      </div>

      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">{t("retry_label")}</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-lg border px-3 py-1.5 text-[13.5px] ${
              category === c
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {t(`al_cat_${c}`)}
          </button>
        ))}
      </div>

      <TableCard>
        <Table>
          <thead>
            <tr>
              <Th>{t("al_when")}</Th>
              <Th>{t("al_who")}</Th>
              <Th>{t("al_action")}</Th>
              <Th>{t("al_details")}</Th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((l) => {
              const meta = actionMeta(l.action, t);
              return (
                <Tr key={l.id}>
                  <Td className="whitespace-nowrap">{fmtCambodiaDateTime(l.created_at)}</Td>
                  <Td name className="whitespace-nowrap">{l.userName}</Td>
                  <Td className="whitespace-nowrap">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        meta.category === "payment" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {meta.label}
                    </span>
                  </Td>
                  <Td>{describeChange(l, t)}</Td>
                </Tr>
              );
            })}
            {loading && filteredLogs.length === 0 && (
              <Tr><td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">{t("loading_label")}</td></Tr>
            )}
            {filteredLogs.length === 0 && !loading && !loadError && (
              <Tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">
                  {t("al_empty")}
                </td>
              </Tr>
            )}
          </tbody>
        </Table>
      </TableCard>
    </div>
  );
}
