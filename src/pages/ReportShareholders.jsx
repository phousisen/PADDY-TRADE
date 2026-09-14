// Reports → Shareholder's Records.
//
// [2026-09-14] Sales volume and value per shareholder, which the accountant
// asked for per branch and consolidated.
//
// The thing this page refuses to do, deliberately: invent a group-level
// percentage. Holdings belong to a STATION. Each station has its own partners
// and its own split, and at least one station's split does not follow the
// capital put in — so a percentage only means something inside its own
// station, and there is no honest way to blend five of them into one.
//
// What CAN be done is to give each holding its own station's share, then add
// each PERSON up across the stations in scope. That second table is a sum of
// amounts, never a blended percentage — and when one of a person's stations
// has no share entered, their row says so rather than quietly under-reporting.

import { useStatements } from "../useStatements.js";
import { TableCard } from "../components/ReportUI.jsx";
import { StatementHead, ScopeBar, Amount, fmt, fmtKg, isKnown } from "../components/StatementUI.jsx";
import { AlertTriangle } from "lucide-react";

const TH = "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap";
const TD = "px-4 py-2.5 text-[13px] border-b border-slate-50 whitespace-nowrap";

export default function ReportShareholders({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { data, stations, loading, error } = useStatements({ selectedLocationIds, startDate, endDate });

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">Loading…</div>;
  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>;

  const { holdings, people } = data.shareholders;
  const period = startDate && endDate ? `${startDate} to ${endDate}` : "all time";

  // A station whose shares do not add to 100% is describing something that is
  // not a whole, and the reader has to be told before they read the numbers.
  const offStations = [...new Set(holdings
    .filter((h) => h.stationShareTotal != null && Math.abs(h.stationShareTotal - 100) > 0.01 && !holdings
      .some((x) => x.stationId === h.stationId && x.sharePct === null))
    .map((h) => h.stationName))];
  const missingStations = [...new Set(holdings.filter((h) => h.sharePct === null).map((h) => h.stationName))];

  return (
    <div>
      <StatementHead
        title="Shareholder's Records"
        scope={stations.length === 1 ? stations[0].name : `${stations.length} stations`}
        period={period}
      />
      <ScopeBar stations={stations} />

      {(missingStations.length > 0 || offStations.length > 0) && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
          <span className="inline-flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> Shares need attention.</span>{" "}
          {missingStations.length > 0 && <>No share entered for some partners at <b>{missingStations.join(", ")}</b> — those holdings show as not entered rather than being guessed at. </>}
          {offStations.length > 0 && <>The shares at <b>{offStations.join(", ")}</b> do not add to 100%. </>}
          Set them under <b className="font-semibold">Reports → Finance Setup</b>.
        </div>
      )}

      {holdings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">
          No partners recorded at these stations yet. Add them under Reports → Capital &amp; Loans, then set each
          one's share under Finance Setup.
        </div>
      ) : (
        <div className="space-y-5">
          <TableCard title="By station" right={<span className="text-[11.5px] font-normal text-slate-400">a share only means something inside its own station</span>}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className={TH}>Shareholder</th>
                    <th className={TH}>Station</th>
                    <th className={`${TH} text-right`}>Capital ៛</th>
                    <th className={`${TH} text-right`}>Share</th>
                    <th className={`${TH} text-right`}>Sales volume kg</th>
                    <th className={`${TH} text-right`}>Sales value ៛</th>
                    <th className={`${TH} text-right`}>Share of profit ៛</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, idx) => (
                    <tr key={`${h.stationId}-${h.partnerId}-${idx}`} className="hover:bg-slate-50/60">
                      <td className={`${TD} font-medium text-slate-800`}>{h.name}</td>
                      <td className={`${TD} text-slate-500`}>{h.stationName}</td>
                      <td className={`${TD} text-right tabular-nums`}>{fmt(h.capital)}</td>
                      <td className={`${TD} text-right`}>
                        {isKnown(h.sharePct)
                          ? <span className="tabular-nums font-medium">{h.sharePct}%</span>
                          : <Amount v={null} why="No share entered for this partner — Reports → Finance Setup" />}
                      </td>
                      <td className={`${TD} text-right`}>{isKnown(h.volKg) ? <span className="tabular-nums">{fmtKg(h.volKg)}</span> : <Amount v={null} />}</td>
                      <td className={`${TD} text-right`}><Amount v={h.value} /></td>
                      <td className={`${TD} text-right`}><Amount v={h.profit} signed /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TableCard>

          <TableCard
            title="Each shareholder across the stations in scope"
            right={<span className="text-[11.5px] font-normal text-slate-400">amounts added up — no blended percentage</span>}
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className={TH}>Shareholder</th>
                    <th className={TH}>Holdings</th>
                    <th className={`${TH} text-right`}>Capital ៛</th>
                    <th className={`${TH} text-right`}>Sales volume kg</th>
                    <th className={`${TH} text-right`}>Sales value ៛</th>
                    <th className={`${TH} text-right`}>Share of profit ៛</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.name} className="hover:bg-slate-50/60">
                      <td className={`${TD} font-medium text-slate-800`}>{p.name}</td>
                      <td className={`${TD} text-slate-500`}>
                        {p.stations} station{p.stations > 1 ? "s" : ""}
                        {p.partial && (
                          <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700 ring-1 ring-amber-200">
                            <AlertTriangle size={9} /> one has no share set
                          </span>
                        )}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{fmt(p.capital)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{fmtKg(p.volKg)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{fmt(p.value)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{fmt(p.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-3 text-[11.5px] leading-relaxed text-slate-400">
              A row marked <b className="font-semibold text-amber-700">one has no share set</b> is incomplete on
              purpose: that station's holding is left out of the totals rather than guessed at, so the figure is
              understated and says so, instead of looking finished and being wrong.
            </p>
          </TableCard>
        </div>
      )}
    </div>
  );
}
