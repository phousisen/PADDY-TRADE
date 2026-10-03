import { useEffect, useMemo, useState, useRef } from "react";
import { api } from "../api.js";
// [2026-09-12] These were CALLED on this page but never imported, so the
// whole tab threw a ReferenceError before it painted anything.
import { queryRange, rangeKey } from "../reportQuery.js";
import { getAccurateNow } from "../supabaseClient.js";
import { cambodiaDateStr } from "../dailyLedger.js";
import { SummaryStrip, SummaryCell, TableCard, Table, Th, Td, Tr, AgeBadge } from "../components/ReportUI.jsx";
import { dmy } from "../dateFormat.js";
import { useLanguage } from "../i18n.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

function ageBucket(days) {
  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "90+ days";
}

const TYPE = "BUY";
const PAY_TYPE = "pay_supplier";
const PARTY_LABEL = "Supplier";

export default function ReportPayables({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { t } = useLanguage();
  const [allRows, setAllRows] = useState([]);
  const [payments, setPayments] = useState([]);
  const [view, setView] = useState("aging");
  const [loading, setLoading] = useState(true);
  const loadSeq = useRef(0);
  const [loadError, setLoadError] = useState("");

  function load() {
    // [2026-09-19] Only the newest request may fill the page: changing the
    // station or dates quickly let an older, slower answer land last (audit F12).
    const my = ++loadSeq.current;
    const live = () => my === loadSeq.current;
    setLoading(true);
    setLoadError("");
    // [2026-09-10] Period and station asked of the database — reportQuery.js.
    // Payments stay unfiltered by date: this report needs to know what has
    // been paid against a transaction whenever that happened, not only
    // inside the period on screen.
    api.getTransactions({ type: TYPE, ...queryRange({ selectedLocationIds, startDate: null, endDate }) })
      .then(async (tx) => {
        // [2026-09-12] Payments are bounded by the TRANSACTIONS on screen,
        // not by the period — a sale inside the period can still be paid
        // outside it, so the date was never the right bound. See
        // api.getPayments' transactionIds option.
        // [2026-09-19] Only payments made by the end date: a bill paid on
        // 3 Sep showed as paid on a report ending 31 Aug (Overview did not).
        const pay = await api.getPayments({ type: PAY_TYPE, transactionIds: tx.map((t) => t.id), to: endDate || undefined });
        return [tx, pay];
      })
      .then(([tx, pay]) => {
        if (!live()) return;
        setAllRows(tx);
        setPayments(pay);
      })
      .catch((err) => {
        if (!live()) return;
        // Without this, a failed/dropped request silently showed "Nothing
        // outstanding" — as if every supplier had been paid in full —
        // instead of saying the load itself had failed.
        setLoadError(err.message || t("rcap_err_load"));
      })
      .finally(() => { if (live()) setLoading(false); });
  }
  useEffect(() => { load(); }, [rangeKey({ selectedLocationIds, startDate, endDate })]);

  // [2026-09-19] SPEED: memoised, so the list below is not rebuilt on every
  // render; and payments are added up per transaction once.
  const rows = useMemo(() => allRows
    .filter((r) => (r.hq_status || "processing") !== "cancelled")
    .filter((r) => !selectedLocationIds.length || selectedLocationIds.includes(r.location_id))
    // [2026-09-19] What is OWED is an as-at figure: every unpaid bill up to the
    // end of the period, however old — not only bills dated inside it. This
    // used to keep only the period's own transactions, so from Overview's
    // "Owed to farmers" (an as-at total) a click landed on a smaller number
    // with nothing saying why. Only the end date applies now.
    .filter((r) => !endDate || r.tx_date <= endDate),
  [allRows, selectedLocationIds.join(","), endDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const paidByTx = useMemo(() => {
    const m = new Map();
    for (const p of payments) if (p.transaction_id) m.set(p.transaction_id, (m.get(p.transaction_id) || 0) + (Number(p.amount) || 0));
    return m;
  }, [payments]);

  const outstanding = useMemo(() => {
    const todayStr = cambodiaDateStr(getAccurateNow());
    return rows
      .map((tx) => {
        const paid = paidByTx.get(tx.id) || 0;
        const remaining = Math.max(0, Number(tx.total_with_tax ?? tx.amount) - paid);
        // [2026-09-19] Whole Phnom Penh calendar days between two plain dates.
        // new Date("2026-09-19") is UTC midnight, which is 07:00 in Cambodia,
        // so between midnight and 7am today's bills showed "-1d" and every
        // age boundary was seven hours out.
        const days = Math.round((Date.parse(todayStr) - Date.parse(String(tx.tx_date).slice(0, 10))) / 86400000);
        return { ...tx, remaining, days, bucket: ageBucket(days) };
      })
      .filter((tx) => tx.remaining > 0.01)
      .sort((a, b) => b.days - a.days);
  }, [rows, paidByTx]);

  const totalOutstanding = outstanding.reduce((s, r) => s + r.remaining, 0);

  const byBucket = useMemo(() => {
    const buckets = ["0-30 days", "31-60 days", "61-90 days", "90+ days"];
    return buckets.map((b) => ({
      bucket: b,
      count: outstanding.filter((r) => r.bucket === b).length,
      amount: outstanding.filter((r) => r.bucket === b).reduce((s, r) => s + r.remaining, 0),
    }));
  }, [outstanding]);

  const byParty = useMemo(() => {
    const map = {};
    outstanding.forEach((r) => {
      // [2026-09-19] Keyed by the party's id. Keyed by name, two different
      // farmers who happen to share one — two "Sok Dara"s — were shown as a
      // single row with both debts added together.
      const k = r.party_id || `name:${r.partyName || "—"}`;
      if (!map[k]) map[k] = { id: k, name: r.partyName || "—", count: 0, amount: 0 };
      map[k].count += 1;
      map[k].amount += r.remaining;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [outstanding]);

  const byLocation = useMemo(() => {
    const map = {};
    outstanding.forEach((r) => {
      const k = r.stationName || "—";
      if (!map[k]) map[k] = { name: k, count: 0, amount: 0 };
      map[k].count += 1;
      map[k].amount += r.remaining;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [outstanding]);

  // Splits what's owed by paddy type — like separate AP sub-accounts per
  // item (AP Sen Krob, AP IR, AP Srangae, etc.) in the old bookkeeping
  // system, instead of one lump Accounts Payable total.
  const byProduct = useMemo(() => {
    const map = {};
    outstanding.forEach((r) => {
      const k = r.productName || "—";
      if (!map[k]) map[k] = { name: k, count: 0, amount: 0 };
      map[k].count += 1;
      map[k].amount += r.remaining;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [outstanding]);

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">{t("retry_label")}</button>
        </div>
      )}

      <SummaryStrip>
        <SummaryCell label={t("rpay_total_outstanding")} value={fmtRiel(totalOutstanding)} tone="neg" />
      </SummaryStrip>

      <div className="mb-4 flex flex-wrap gap-2">
        {[{ v: "aging", l: t("rpay_aging") }, { v: "party", l: t("rpay_by_supplier") }, { v: "location", l: t("rpay_by_location") }, { v: "product", l: t("rpay_by_paddy") }, { v: "detail", l: t("rpay_detail") }].map((o) => (
          <button key={o.v} onClick={() => setView(o.v)} className={`rounded-lg border px-3 py-1.5 text-[13.5px] ${view === o.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{o.l}</button>
        ))}
      </div>

      {view === "aging" && (
        <TableCard title={t("rpay_aging")}>
          <Table>
            <thead>
              <tr><Th>{t("rpay_age")}</Th><Th num>{t("col_tx_count")}</Th><Th num>{t("rpay_amount_owed")}</Th></tr>
            </thead>
            <tbody>
              {byBucket.map((b) => (
                <Tr key={b.bucket}>
                  <Td><AgeBadge bucket={b.bucket} /></Td>
                  <Td num>{b.count}</Td>
                  <Td num>{fmtRiel(b.amount)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}
      {view === "party" && (
        <TableCard title={t("rpay_by_supplier")}>
          <Table>
            <thead>
              <tr><Th>{t("rpay_supplier")}</Th><Th num>{t("col_tx_count")}</Th><Th num>{t("rpay_amount_owed")}</Th></tr>
            </thead>
            <tbody>
              {byParty.map((p) => (
                <Tr key={p.id || p.name}>
                  <Td name>{p.name}</Td>
                  <Td num>{p.count}</Td>
                  <Td num>{fmtRiel(p.amount)}</Td>
                </Tr>
              ))}
              {loading && byParty.length === 0 && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">{t("loading_label")}</td></Tr>}
              {byParty.length === 0 && !loading && !loadError && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">{t("rpay_nothing")}</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      )}
      {view === "location" && (
        <TableCard title={t("rpay_by_location")}>
          <Table>
            <thead>
              <tr><Th>{t("col_location")}</Th><Th num>{t("col_tx_count")}</Th><Th num>{t("rpay_amount_owed")}</Th></tr>
            </thead>
            <tbody>
              {byLocation.map((p) => (
                <Tr key={p.id || p.name}>
                  <Td name>{p.name}</Td>
                  <Td num>{p.count}</Td>
                  <Td num>{fmtRiel(p.amount)}</Td>
                </Tr>
              ))}
              {loading && byLocation.length === 0 && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">{t("loading_label")}</td></Tr>}
              {byLocation.length === 0 && !loading && !loadError && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">{t("rpay_nothing")}</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      )}
      {view === "product" && (
        <TableCard title={t("rpay_by_paddy")}>
          <Table>
            <thead>
              <tr><Th>{t("paddy_type_col")}</Th><Th num>{t("col_tx_count")}</Th><Th num>{t("rpay_amount_owed")}</Th></tr>
            </thead>
            <tbody>
              {byProduct.map((p) => (
                <Tr key={p.id || p.name}>
                  <Td name>{p.name}</Td>
                  <Td num>{p.count}</Td>
                  <Td num>{fmtRiel(p.amount)}</Td>
                </Tr>
              ))}
              {loading && byProduct.length === 0 && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">{t("loading_label")}</td></Tr>}
              {byProduct.length === 0 && !loading && !loadError && <Tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">{t("rpay_nothing")}</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      )}
      {view === "detail" && (
        <TableCard title={t("rpay_detail")}>
          <Table>
            <thead>
              <tr><Th>{t("col_date")}</Th><Th>{t("tx_receipt")}</Th><Th>{t("rpay_supplier")}</Th><Th>{t("col_location")}</Th><Th>{t("rpay_age")}</Th><Th num>{t("rpay_amount_owed")}</Th></tr>
            </thead>
            <tbody>
              {outstanding.map((r) => (
                <Tr key={r.id}>
                  <Td>{dmy(r.tx_date)}</Td>
                  <Td name>{r.code}</Td>
                  <Td>{r.partyName}</Td>
                  <Td>{r.stationName}</Td>
                  <Td>
                    <AgeBadge bucket={r.bucket} />
                    <span className="ml-1.5 text-[11.5px] text-slate-400">{t("rpay_days_short", { n: r.days })}</span>
                  </Td>
                  <Td num>{fmtRiel(r.remaining)}</Td>
                </Tr>
              ))}
              {loading && outstanding.length === 0 && <Tr><td colSpan={6} className="px-4 py-10 text-center text-[13.5px] text-slate-400">{t("loading_label")}</td></Tr>}
              {outstanding.length === 0 && !loading && !loadError && <Tr><td colSpan={6} className="px-4 py-10 text-center text-[13.5px] text-slate-400">{t("rpay_nothing")}</td></Tr>}
            </tbody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}
