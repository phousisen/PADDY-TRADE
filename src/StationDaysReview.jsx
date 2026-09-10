import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Inbox } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";

// [2026-09-09 v4] The second signature — HQ's.
//
// The station answers "was this day complete?", which only they can answer:
// they are holding the paper. HQ answers "do I accept these figures?", which
// only HQ can answer. Two different questions, so two signatures.
//
// This list is the HQ side. It sits directly above the month-close buttons
// because it answers the question you are really asking when you close a
// month: did every station tell me their days were complete?
//
// A day with a gap stays on this list even after it is accepted, because a
// missing ticket does not stop being missing when someone presses Accept.
// It leaves the list when the gap is resolved — the ticket re-entered, or
// the station re-counts and the numbers agree.

function fmtDay(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "short" }).format(d);
}

export default function StationDaysReview() {
  const { profile, isViewOnly } = useAuth();
  const canAccept = !!profile?.isOwner && !isViewOnly;

  const [rows, setRows] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await api.getDaysAwaitingHq(14));
      setHidden(false);
    } catch {
      // Not installed in this database yet — the block simply does not
      // appear. It must never break the monthly close screen.
      setRows(null);
      setHidden(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (hidden || !rows) return null;

  async function accept(row) {
    const key = `${row.location_id}|${row.business_date}`;
    setBusyKey(key); setError("");
    try {
      await api.hqAcceptDay({ locationId: row.location_id, businessDate: row.business_date, note: null });
      await load();
    } catch (e) {
      setError(e.message || "Could not accept that day.");
    } finally { setBusyKey(null); }
  }

  const gaps = rows.filter((r) => Number(r.count_gap || 0) !== 0).length;

  return (
    <div className="mb-5 rounded-xl border-2 border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Inbox size={15} className="text-slate-400" />
          Days the stations have sent you
        </h4>
        {gaps > 0 && (
          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold text-rose-700">
            {gaps} with a missing ticket
          </span>
        )}
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
        Each station counts the stubs in its own paper book and sends you the number. The system can
        only count what arrived, so this is the only place a ticket that never reached the database
        can show up.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500">
          Nothing waiting. Every day the stations have counted has been accepted, and none of them
          reported a missing ticket.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <th className="pb-2 pr-3">Station</th>
                <th className="pb-2 pr-3">Day</th>
                <th className="pb-2 pr-3 text-right">Book</th>
                <th className="pb-2 pr-3 text-right">System</th>
                <th className="pb-2 pr-3">Missing</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${r.location_id}|${r.business_date}`;
                const gap = Number(r.count_gap || 0);
                const accepted = !!r.hq_accepted_at;
                return (
                  <tr key={key} className="border-t border-slate-200">
                    <td className="py-2.5 pr-3 font-semibold text-slate-700">{r.station_name}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{fmtDay(r.business_date)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">
                      {r.paper_ticket_count ?? "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">
                      {r.tickets_finished ?? 0}
                    </td>
                    <td className="py-2.5 pr-3">
                      {gap === 0 ? (
                        <span className="text-brand-600">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-bold text-rose-600">
                          <AlertTriangle size={12} className="shrink-0" />
                          {r.missing_ticket_no || (gap > 0 ? `${gap} not known` : `${-gap} extra`)}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {accepted ? (
                        <span className="text-[11px] font-semibold text-slate-400">Accepted</span>
                      ) : canAccept ? (
                        <button
                          onClick={() => accept(r)}
                          disabled={busyKey === key}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-50 ${
                            gap === 0 ? "bg-brand-600 hover:bg-brand-700" : "bg-amber-600 hover:bg-amber-700"}`}
                        >
                          {busyKey === key ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                          {gap === 0 ? "Accept" : "Accept anyway"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {gaps > 0 && (
        <p className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          A gap means a receipt was printed at the scale and its transaction never arrived. Check the
          station's own device first — if the ticket is sitting in the sync queue it will send itself.
          If it is not there, re-enter it from the paper stub and date it to the day it happened.
        </p>
      )}

      {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
}
