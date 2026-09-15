// Reports → Inventory.
//
// [2026-09-14] The inventory report the accountant asked for: by branch and
// consolidated, valued at what the paddy actually cost.
//
// The rule that shapes this page: CLOSING STOCK IS A LEVEL, NOT A TOTAL. It is
// what is in the shed at one moment, so it never adds up down a column of
// days — a month's closing is its last day's, not the sum of thirty. Adding the
// five stations ACROSS is a different matter and is perfectly valid: they are
// five different sheds at the same moment.
//
// The consolidated cost per kilo is re-derived from the pooled value over the
// pooled kilos, never averaged across stations — otherwise a shed holding
// 200 kg would pull the figure as hard as one holding 70,000.

import { useStatements } from "../useStatements.js";
import { TableCard } from "../components/ReportUI.jsx";
import { StatementHead, StatementSummary, ScopeBar, fmt, fmtKg } from "../components/StatementUI.jsx";

const TH = "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap";
const TD = "px-4 py-2.5 text-[13px] border-b border-slate-50 whitespace-nowrap tabular-nums";

export default function ReportInventory({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { data, stations, loading, error } = useStatements({ selectedLocationIds, startDate, endDate });

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">Loading…</div>;
  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>;

  const { rows, total } = data.inventory;
  const asAt = endDate || "today";
  const period = startDate && endDate ? `${startDate} to ${endDate}` : "all time";

  return (
    <div>
      <StatementHead
        title="Inventory Report"
        scope={stations.length === 1 ? stations[0].name : `${stations.length} stations`}
        period={period}
      />
      <ScopeBar stations={stations} />
      <StatementSummary cells={[
        { label: "In the shed", value: total.closingKg, riel: false, sub: "kilograms, a level not a total" },
        { label: "Value", value: total.closingValue, sub: `${fmt(total.costPerKg)} ៛/kg, re-derived` },
        { label: "Bought", value: total.boughtKg, riel: false, sub: "kg in, this period" },
        { label: "Shipped", value: total.soldKg, riel: false, sub: "kg out, this period" },
        { label: "Lost on counts", value: total.lostValue, sub: `${fmtKg(total.lostKg)} kg`, tone: "neg" },
      ]} />

      <TableCard
        title={`In the shed as at ${asAt}`}
        right={<span className="text-[11.5px] font-normal text-slate-400">valued at running weighted-average cost</span>}
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className={TH}>Station</th>
                <th className={`${TH} text-right`}>Bought kg</th>
                <th className={`${TH} text-right`}>Shipped kg</th>
                <th className={`${TH} text-right`}>Lost / gained kg</th>
                <th className={`${TH} text-right`}>Lost value ៛</th>
                <th className={`${TH} text-right`}>Closing kg</th>
                <th className={`${TH} text-right`}>Cost ៛/kg</th>
                <th className={`${TH} text-right`}>Value ៛</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className={`${TD} font-medium text-slate-800`}>{r.name}</td>
                  <td className={`${TD} text-right text-slate-600`}>{fmtKg(r.boughtKg)}</td>
                  <td className={`${TD} text-right text-slate-600`}>{fmtKg(r.soldKg)}</td>
                  <td className={`${TD} text-right ${r.lostKg < 0 ? "text-rose-600" : r.lostKg > 0 ? "text-brand-700" : "text-slate-300"}`}>
                    {r.lostKg ? fmtKg(r.lostKg) : "—"}
                  </td>
                  <td className={`${TD} text-right ${r.lostValue < 0 ? "text-rose-600" : r.lostValue > 0 ? "text-brand-700" : "text-slate-300"}`}>
                    {r.lostValue ? fmt(r.lostValue) : "—"}
                  </td>
                  <td className={`${TD} text-right font-semibold text-slate-900`}>{fmtKg(r.closingKg)}</td>
                  <td className={`${TD} text-right text-slate-600`}>{r.closingKg ? fmt(r.costPerKg) : "—"}</td>
                  <td className={`${TD} text-right font-semibold text-slate-900`}>{fmt(r.closingValue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-800 bg-slate-50 font-bold">
                <td className="px-4 py-3 text-[13px] text-slate-900">
                  {rows.length > 1 ? `Consolidated · ${rows.length} stations` : rows[0]?.name || "—"}
                </td>
                <td className="px-4 py-3 text-right text-[13px] tabular-nums text-slate-900">{fmtKg(total.boughtKg)}</td>
                <td className="px-4 py-3 text-right text-[13px] tabular-nums text-slate-900">{fmtKg(total.soldKg)}</td>
                <td className={`px-4 py-3 text-right text-[13px] tabular-nums ${total.lostKg < 0 ? "text-rose-600" : "text-slate-900"}`}>{total.lostKg ? fmtKg(total.lostKg) : "—"}</td>
                <td className={`px-4 py-3 text-right text-[13px] tabular-nums ${total.lostValue < 0 ? "text-rose-600" : "text-slate-900"}`}>{total.lostValue ? fmt(total.lostValue) : "—"}</td>
                <td className="px-4 py-3 text-right text-[13px] tabular-nums text-slate-900">{fmtKg(total.closingKg)}</td>
                <td className="px-4 py-3 text-right text-[13px] tabular-nums text-slate-900">{total.closingKg ? fmt(total.costPerKg) : "—"}</td>
                <td className="px-4 py-3 text-right text-[13px] tabular-nums text-slate-900">{fmt(total.closingValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </TableCard>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[12px] leading-relaxed text-slate-500">
          <b className="font-semibold text-slate-700">Closing kg is a level, not a total.</b> It is what is in the shed
          at one moment, so it is never the sum of the days before it. Adding the stations across this row is a
          different thing and is valid — those are separate sheds at the same moment.
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[12px] leading-relaxed text-slate-500">
          <b className="font-semibold text-slate-700">The consolidated cost per kilo is re-derived,</b> not averaged:
          pooled value over pooled kilos. Averaging the stations' rates would let a shed holding 200 kg move the
          figure as much as one holding 70,000.
        </div>
      </div>
    </div>
  );
}
