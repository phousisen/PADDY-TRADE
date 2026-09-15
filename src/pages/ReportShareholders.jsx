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
import { useLanguage } from "../i18n.jsx";
import { TableCard } from "../components/ReportUI.jsx";
import { Explain, StatementHead, StationChips, ScopeBar, Amount, fmt, fmtKg, isKnown } from "../components/StatementUI.jsx";
import { AlertTriangle } from "lucide-react";

const TH = "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap";
const TD = "px-4 py-2.5 text-[13px] border-b border-slate-50 whitespace-nowrap";

export default function ReportShareholders({ selectedLocationIds = [], setSelectedLocationIds, startDate = null, endDate = null }) {
  const { t } = useLanguage();
  const { data, stations, raw, loading, error } = useStatements({ selectedLocationIds, startDate, endDate });

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">{t("loading_label")}</div>;
  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>;

  const { holdings, people } = data.shareholders;
  const period = startDate && endDate ? t("st_period_between", { a: startDate, b: endDate }) : t("st_period_all");

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
        title={t("sh_title")}
        scope={stations.length === 1 ? stations[0].name : t("st_stations_n", { n: stations.length })}
        period={period}
      />
      <StationChips stations={raw.stations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
      <ScopeBar stations={stations} />

      {(missingStations.length > 0 || offStations.length > 0) && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
          <span className="inline-flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> {t("sh_warn_t")}</span>{" "}
          {missingStations.length > 0 && <>{t("sh_warn_missing", { list: missingStations.join(", ") })} </>}
          {offStations.length > 0 && <>{t("sh_warn_off", { list: offStations.join(", ") })} </>}
          {t("sh_warn_where")}
        </div>
      )}

      {holdings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">
          {t("sh_empty")}
        </div>
      ) : (
        <div className="space-y-5">
          <TableCard title={t("sh_bystation")} right={<span className="text-[11.5px] font-normal text-slate-400">{t("sh_bystation_r")}</span>}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className={TH}>{t("sh_th_holder")}</th>
                    <th className={TH}>{t("st_station")}</th>
                    <th className={`${TH} text-right`}>{t("sh_th_capital")}</th>
                    <th className={`${TH} text-right`}>{t("sh_th_share")}</th>
                    <th className={`${TH} text-right`}>{t("sh_th_volkg")}</th>
                    <th className={`${TH} text-right`}>{t("sh_th_value")}</th>
                    <th className={`${TH} text-right`}>{t("sh_th_profit")}</th>
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
                          : <Amount v={null} why={t("sh_noshare_why")} />}
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
            title={t("sh_across")}
            right={<span className="text-[11.5px] font-normal text-slate-400">{t("sh_across_r")}</span>}
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className={TH}>{t("sh_th_holder")}</th>
                    <th className={TH}>{t("sh_th_holdings")}</th>
                    <th className={`${TH} text-right`}>{t("sh_th_capital")}</th>
                    <th className={`${TH} text-right`}>{t("sh_th_volkg")}</th>
                    <th className={`${TH} text-right`}>{t("sh_th_value")}</th>
                    <th className={`${TH} text-right`}>{t("sh_th_profit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.name} className="hover:bg-slate-50/60">
                      <td className={`${TD} font-medium text-slate-800`}>{p.name}</td>
                      <td className={`${TD} text-slate-500`}>
                        {p.stations > 1 ? t("sh_nstations", { n: p.stations }) : t("sh_onestation")}
                        {p.partial && (
                          <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700 ring-1 ring-amber-200">
                            <AlertTriangle size={9} /> {t("sh_partial")}
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
            <Explain>
              <p className="border-t border-slate-100 px-4 py-3 text-[11.5px] leading-relaxed text-slate-400">
                {t("sh_foot")}
              </p>
            </Explain>
          </TableCard>
        </div>
      )}
    </div>
  );
}
