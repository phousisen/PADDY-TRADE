import { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { api } from "../api.js";
import { SummaryStrip, SummaryCell, ReportCard, SectionLabel, Row, TotalBox, TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }

// The `payment_status` field stored on a transaction is only what it was
// set to at creation/edit time — it does NOT update itself when someone
// later records a payment against that transaction (see Transactions.jsx
// "Record Payment"). Relying on it caused paid transactions to keep
// showing as unpaid everywhere except the Transactions list, which computes
// paid/remaining live from the real payments ledger instead. This does the
// same thing, so every report agrees with the Transactions list and with
// each other. Returns a map of transaction id -> { paid, remaining }.
export function paidStatusMap(txs, payments) {
  const txIds = new Set(txs.map((t) => t.id));
  const map = {};
  payments.forEach((p) => {
    if (!p.transaction_id || !txIds.has(p.transaction_id)) return;
    map[p.transaction_id] = (map[p.transaction_id] || 0) + Number(p.amount);
  });
  const result = {};
  txs.forEach((t) => {
    const total = Number(t.total_with_tax ?? t.amount);
    const paid = Math.min(total, map[t.id] || 0);
    result[t.id] = { paid, remaining: Math.max(0, total - paid) };
  });
  return result;
}

// capitalEntries/loanEntries are the full, unfiltered lists — this filters
// them down to whatever locations are represented in `stations` itself, the
// same way inventory value is scoped to those stations' stock. `payments`
// is likewise the full, unfiltered payments list — see paidStatusMap above.
export function computeFinancials(txs, stations, capitalEntries = [], loanEntries = [], payments = []) {
  const buys = txs.filter((x) => x.type === "BUY");
  const sells = txs.filter((x) => x.type === "SELL");
  const totalBuy = buys.reduce((s, x) => s + Number(x.amount), 0);
  const totalSell = sells.reduce((s, x) => s + Number(x.amount), 0);
  const grossProfit = totalSell - totalBuy;

  const paidMap = paidStatusMap(txs, payments);
  const accountsPayable = buys.reduce((s, x) => s + (paidMap[x.id]?.remaining || 0), 0);
  const accountsReceivable = sells.reduce((s, x) => s + (paidMap[x.id]?.remaining || 0), 0);
  const paidBuy = buys.reduce((s, x) => s + (paidMap[x.id]?.paid || 0), 0);
  const paidSell = sells.reduce((s, x) => s + (paidMap[x.id]?.paid || 0), 0);

  const stationIds = new Set(stations.map((s) => s.id));
  const bankLoansOutstanding = loanEntries
    .filter((e) => stationIds.has(e.location_id))
    .reduce((s, e) => s + (e.type === "borrow" ? Number(e.amount) : -Number(e.amount)), 0);
  const partnerCapital = capitalEntries
    .filter((e) => stationIds.has(e.location_id))
    .reduce((s, e) => s + (e.type === "contribution" ? Number(e.amount) : -Number(e.amount)), 0);

  // Cash isn't just trade proceeds — real money also comes in/out through
  // partner capital and bank loan draws/repayments, which are mirrored into
  // the payments ledger (see api.js createPartnerCapitalEntry/
  // createBankLoanEntry). Folding their net effect in here keeps Cash Flow,
  // this Cash line, and the Capital & Loans totals all consistent with
  // each other instead of Retained Earnings silently plugging the gap.
  const cashEstimate = paidSell - paidBuy + partnerCapital + bankLoansOutstanding;
  const totalBuyKg = buys.reduce((s, x) => s + Number(x.quantity_kg), 0) || 1;
  const avgCostPerKg = totalBuy / totalBuyKg;
  const totalStockKg = stations.reduce((s, x) => s + Number(x.current_stock_kg), 0);
  const inventoryValue = totalStockKg * avgCostPerKg;
  const totalAssets = inventoryValue + accountsReceivable + Math.max(0, cashEstimate);

  const totalLiabilities = accountsPayable + bankLoansOutstanding;
  const equity = totalAssets - totalLiabilities;
  // Whatever equity isn't accounted for by real partner capital is treated
  // as accumulated profit kept in the business — this keeps Assets =
  // Liabilities + Equity holding exactly, while still surfacing the real,
  // partner-entered capital number separately.
  const retainedEarnings = equity - partnerCapital;

  return {
    totalBuy, totalSell, grossProfit, accountsPayable, accountsReceivable, cashEstimate, inventoryValue,
    totalAssets, bankLoansOutstanding, totalLiabilities, partnerCapital, retainedEarnings, equity,
  };
}

export default function ReportOverview({ selectedLocationIds = [], startDate = null, endDate = null, onNavigate }) {
  const [txs, setTxs] = useState([]);
  const [stations, setStations] = useState([]);
  const [capitalEntries, setCapitalEntries] = useState([]);
  const [loanEntries, setLoanEntries] = useState([]);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    Promise.all([api.getTransactions(), api.getLocations()]).then(([t, s]) => { setTxs(t); setStations(s); });
    api.getPayments().then(setPayments).catch(() => setPayments([]));
    // Admin-only tables — a non-admin viewer (shouldn't normally reach this
    // page, but just in case) simply sees zero partner capital/bank loans
    // rather than an error.
    api.getPartnerCapitalEntries().then(setCapitalEntries).catch(() => setCapitalEntries([]));
    api.getBankLoans().then(setLoanEntries).catch(() => setLoanEntries([]));
  }, []);

  const filteredStations = selectedLocationIds.length ? stations.filter((s) => selectedLocationIds.includes(s.id)) : stations;
  const activeTxs = txs
    .filter((t) => (t.hq_status || "processing") !== "cancelled")
    .filter((t) => !startDate || t.tx_date >= startDate)
    .filter((t) => !endDate || t.tx_date <= endDate);
  const filteredTxs = selectedLocationIds.length ? activeTxs.filter((t) => selectedLocationIds.includes(t.location_id)) : activeTxs;

  const calc = useMemo(
    () => computeFinancials(filteredTxs, filteredStations, capitalEntries, loanEntries, payments),
    [filteredTxs, filteredStations, capitalEntries, loanEntries, payments]
  );

  const byLocation = useMemo(() => {
    return filteredStations.map((s) => {
      const stationTxs = activeTxs.filter((x) => x.location_id === s.id);
      const c = computeFinancials(stationTxs, [s], capitalEntries, loanEntries, payments);
      return { station: s, ...c };
    });
  }, [activeTxs, filteredStations, capitalEntries, loanEntries, payments]);

  const totalTx = filteredTxs.length;
  const buyTx = filteredTxs.filter((t) => t.type === "BUY").length;
  const sellTx = filteredTxs.filter((t) => t.type === "SELL").length;

  return (
    <div>
      <SummaryStrip>
        <SummaryCell label="Total Sales" value={`${fmt(calc.totalSell)} ៛`} sub={`${sellTx} transaction${sellTx === 1 ? "" : "s"}`} />
        <SummaryCell label="Total Purchases" value={`${fmt(calc.totalBuy)} ៛`} sub={`${buyTx} transaction${buyTx === 1 ? "" : "s"}`} />
        <SummaryCell
          label="Gross Profit"
          value={`${fmt(calc.grossProfit)} ៛`}
          sub={calc.grossProfit >= 0 ? "above purchase cost this range" : "below purchase cost this range"}
          tone={calc.grossProfit >= 0 ? "pos" : "neg"}
        />
        <SummaryCell
          label="Net Worth (Equity)"
          value={`${fmt(calc.equity)} ៛`}
          sub={calc.equity >= 0 ? "assets exceed liabilities" : "liabilities exceed assets"}
          tone={calc.equity >= 0 ? "pos" : "neg"}
        />
      </SummaryStrip>

      {/* [2026-08-31] grid-cols-1 md:grid-cols-2 instead of a flat
          grid-cols-2 — these two panels used to squeeze side by side on a
          phone screen; now stack full-width below the md breakpoint. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ReportCard title="Profit & Loss" subtitle={`${totalTx} transactions this range`}>
          <Row label="Total Sales (Revenue)" value={`${fmt(calc.totalSell)} ៛`} onClick={onNavigate ? () => onNavigate("sales") : undefined} />
          <Row label="Total Purchases (COGS)" value={`${fmt(-calc.totalBuy)} ៛`} onClick={onNavigate ? () => onNavigate("purchases") : undefined} />
          <TotalBox><Row label="Gross Profit" value={`${fmt(calc.grossProfit)} ៛`} bold tone={calc.grossProfit >= 0 ? "pos" : "neg"} /></TotalBox>
        </ReportCard>
        <ReportCard
          title="Balance Sheet"
          subtitle="As of today"
        >
          {onNavigate && (
            <button onClick={() => onNavigate("balancesheet")} className="float-right -mt-8 text-[11.5px] font-medium text-brand-600 hover:underline">Full statement →</button>
          )}
          <SectionLabel>Assets</SectionLabel>
          <Row label="Inventory on hand" value={`${fmt(calc.inventoryValue)} ៛`} indent onClick={onNavigate ? () => onNavigate("stock") : undefined} />
          <Row label="Accounts Receivable" value={`${fmt(calc.accountsReceivable)} ៛`} indent onClick={onNavigate ? () => onNavigate("receivables") : undefined} />
          <Row label="Cash (estimate)" value={`${fmt(Math.max(0, calc.cashEstimate))} ៛`} indent onClick={onNavigate ? () => onNavigate("cashflow") : undefined} />
          <Row label="Total Assets" value={`${fmt(calc.totalAssets)} ៛`} bold />
          <SectionLabel>Liabilities</SectionLabel>
          <Row label="Accounts Payable" value={`${fmt(calc.accountsPayable)} ៛`} indent onClick={onNavigate ? () => onNavigate("payables") : undefined} />
          <Row label="Bank Loans" value={`${fmt(calc.bankLoansOutstanding)} ៛`} indent onClick={onNavigate ? () => onNavigate("capital") : undefined} />
          <Row label="Total Liabilities" value={`${fmt(calc.totalLiabilities)} ៛`} bold />
          <SectionLabel>Equity</SectionLabel>
          <Row label="Partner Capital" value={`${fmt(calc.partnerCapital)} ៛`} indent onClick={onNavigate ? () => onNavigate("capital") : undefined} />
          <Row label="Retained Earnings" value={`${fmt(calc.retainedEarnings)} ៛`} indent />
          <TotalBox><Row label="Equity (net worth)" value={`${fmt(calc.equity)} ៛`} bold /></TotalBox>
        </ReportCard>
      </div>

      {byLocation.length > 1 && (
        <TableCard title="By Location" className="mt-4">
          <Table>
            <thead>
              <tr>
                <Th>Location</Th><Th num>Sales</Th><Th num>Purchases</Th><Th num>Profit</Th><Th num>Inventory</Th><Th num>Payable</Th>
              </tr>
            </thead>
            <tbody>
              {byLocation.map((row) => (
                <Tr key={row.station.id}>
                  <Td name>{row.station.name}</Td>
                  <Td num>{fmt(row.totalSell)} ៛</Td>
                  <Td num>{fmt(row.totalBuy)} ៛</Td>
                  <Td num className={row.grossProfit >= 0 ? "!text-brand-700 !font-semibold" : "!text-rose-600 !font-semibold"}>{fmt(row.grossProfit)} ៛</Td>
                  <Td num>{fmt(row.inventoryValue)} ៛</Td>
                  <Td num>{fmt(row.accountsPayable)} ៛</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
        <Wallet size={13} className="mt-0.5 shrink-0" />
        Simplified model: inventory is valued at average purchase cost, and cost of goods sold is approximated from total purchases rather than matched item-by-item.
        {onNavigate && <span className="ml-1">Tip: click any Sales, Purchases, or Balance Sheet line above to jump straight to its detail report.</span>}
      </div>
    </div>
  );
}
