// One fetch, one computation, five statements.
//
// [2026-09-14] Balance Sheet, Income Statement, Cash Flow, Inventory and
// Shareholder's Records all describe the same month at the same stations, so
// they must not each fetch their own data and compute their own answer — that
// is exactly how two screens end up showing two different profits for
// September and nobody can say which is right.
//
// This hook is the single source: it fetches once, hands everything to
// computeStatements(), and every page renders a slice of the same result.
//
// The fetch is deliberately AS-AT, not period-filtered: `from` is left off on
// purpose. A balance sheet figure is a position on a date — what a farmer is
// owed on 30 September, whenever the paddy was bought — so cutting the data at
// the period start would make old debts vanish and value the shed from one
// month's prices. computeStatements takes the period slice itself.

import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { computeStatements } from "./statements.js";
import { rangeKey, dayAfter } from "./reportQuery.js";

export function useStatements({ selectedLocationIds = [], startDate = null, endDate = null } = {}) {
  const [raw, setRaw] = useState({
    txs: [], payments: [], adjustments: [], stations: [],
    partners: [], capitalEntries: [], loanEntries: [], assets: null, settings: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Finance Setup may not be in the database yet. That is a setup step, not a
  // failure: the statements still compute, with those lines reading "not
  // entered", and the pages say which file adds them.
  const [setupMissing, setSetupMissing] = useState(false);

  const rk = rangeKey({ selectedLocationIds, startDate, endDate });

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");

    // Only the END of the range is pushed into the query. See the note above.
    const asAt = {};
    if (selectedLocationIds.length === 1) asAt.locationId = selectedLocationIds[0];
    if (endDate) asAt.to = endDate;

    const soft = (p, fallback) => p.catch(() => fallback);
    // [2026-09-19] Money inputs are NOT soft. Payments, stock adjustments,
    // partner capital and loans used to go through soft() above, so a slow
    // link that timed out the payments fetch produced a Balance Sheet, Income
    // Statement and Cash Flow computed as if nobody had ever been paid:
    // "owed to farmers" equal to every purchase ever made, cash collected 0,
    // and no warning anywhere on the page. A table that does not exist yet is
    // a setup step and still falls back quietly; any other failure now stops
    // the page with its error, which is the only honest thing to show.
    const money = (p) => p.catch((e) => {
      if (/relation .* does not exist|schema cache|does not exist/i.test(e?.message || "")) {
        setSetupMissing(true);
        return [];
      }
      throw e;
    });
    // A missing Finance Setup table must not take the whole page down, but it
    // must not pass silently either — the flag drives a visible notice.
    const setup = (p, fallback) => p.catch((e) => {
      if (/relation .* does not exist|schema cache|does not exist/i.test(e?.message || "")) setSetupMissing(true);
      return fallback;
    });

    Promise.all([
      api.getTransactions(asAt),
      api.getLocations(),
      money(api.getPayments(endDate ? { to: endDate } : {})),
      money(api.getStockAdjustments(endDate ? { endDate: dayAfter(endDate) } : {})),
      soft(api.getPartners(), []),
      money(api.getPartnerCapitalEntries()),
      money(api.getBankLoans()),
      setup(api.getFixedAssets(), null),      // null, not [] — see statements.js
      setup(api.getFinanceSettings(), {}),
    ])
      .then(([txs, stations, payments, adjustments, partners, capitalEntries, loanEntries, assets, settings]) => {
        if (!alive) return;
        setRaw({ txs, stations, payments, adjustments, partners, capitalEntries, loanEntries, assets, settings });
      })
      .catch((e) => { if (alive) setError(e?.message || "Couldn't load the financial data."); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [rk]); // eslint-disable-line react-hooks/exhaustive-deps

  // The stations in scope ARE the consolidation: one station, three, or all.
  const stations = useMemo(
    () => (selectedLocationIds.length ? raw.stations.filter((s) => selectedLocationIds.includes(s.id)) : raw.stations),
    [raw.stations, rk]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => computeStatements({
    asAtTxs: raw.txs,
    payments: raw.payments,
    adjustments: raw.adjustments,
    stations,
    partners: raw.partners,
    capitalEntries: raw.capitalEntries,
    loanEntries: raw.loanEntries,
    assets: raw.assets,
    settings: raw.settings,
    startDate, endDate,
  }), [raw, stations, startDate, endDate]);

  return { data, stations, loading, error, setupMissing, raw };
}
