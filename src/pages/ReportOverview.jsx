import { useEffect, useMemo, useState } from "react";
import { TrendingUp, Scale, Wallet, MapPin } from "lucide-react";
import { api } from "../api.js";

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

  const Row = ({ label, labelKm, value, bold, indent, onClick }) => (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
      title={onClick ? "Click to view details" : undefined}
      className={`group flex items-center justify-between border-b border-slate-50 py-2.5 text-sm last:border-0 ${indent ? "pl-4" : ""} ${onClick ? "cursor-pointer rounded-md px-1.5 -mx-1.5 hover:bg-brand-50" : ""}`}
    >
      <span className={`${bold ? "font-semibold text-slate-800" : "text-slate-500"} ${onClick ? "group-hover:text-brand-700 group-hover:underline" : ""}`}>
        {label}
        {labelKm && <span className="font-khmer block text-[10px] font-normal">{labelKm}</span>}
      </span>
      <span className={bold ? "font-semibold text-slate-800" : "text-slate-700"}>{fmt(value)} ៛</span>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-700"><TrendingUp size={16} className="text-brand-600" /> Profit &amp; Loss<span className="font-khmer block text-xs font-normal text-slate-400">ចំណេញ-ខាត</span></h3>
          <Row label="Total Sales (Revenue)" labelKm="ចំណូលលក់សរុប" value={calc.totalSell} onClick={onNavigate ? () => onNavigate("sales") : undefined} />
          <Row label="Total Purchases (COGS)" labelKm="ថ្លៃដើមទំនិញលក់ (ការទិញសរុប)" value={-calc.totalBuy} onClick={onNavigate ? () => onNavigate("purchases") : undefined} />
          <Row label="Gross Profit" labelKm="ចំណេញដុល" value={calc.grossProfit} bold />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold text-slate-700"><Scale size={16} className="text-brand-600" /> Balance Sheet<span className="font-khmer block text-xs font-normal text-slate-400">តារាងតុល្យការ</span></h3>
            {onNavigate && (
              <button onClick={() => onNavigate("balancesheet")} className="text-xs font-medium text-brand-600 hover:underline">Full statement →<span className="font-khmer block text-[10px]">មើលរបាយការណ៍ពេញលេញ →</span></button>
            )}
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Assets<span className="font-khmer block normal-case tracking-normal">ទ្រព្យសកម្ម</span></p>
          <Row label="Inventory on hand" labelKm="ស្តុកទំនិញនៅសល់" value={calc.inventoryValue} indent onClick={onNavigate ? () => onNavigate("stock") : undefined} />
          <Row label="Accounts Receivable" labelKm="គណនីត្រូវទទួល" value={calc.accountsReceivable} indent onClick={onNavigate ? () => onNavigate("receivables") : undefined} />
          <Row label="Cash (estimate)" labelKm="សាច់ប្រាក់ (ប៉ាន់ស្មាន)" value={Math.max(0, calc.cashEstimate)} indent onClick={onNavigate ? () => onNavigate("cashflow") : undefined} />
          <Row label="Total Assets" labelKm="ទ្រព្យសកម្មសរុប" value={calc.totalAssets} bold />
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Liabilities<span className="font-khmer block normal-case tracking-normal">បំណុល</span></p>
          <Row label="Accounts Payable" labelKm="គណនីត្រូវបង់" value={calc.accountsPayable} indent onClick={onNavigate ? () => onNavigate("payables") : undefined} />
          <Row label="Bank Loans" labelKm="ប្រាក់កម្ចីធនាគារ" value={calc.bankLoansOutstanding} indent onClick={onNavigate ? () => onNavigate("capital") : undefined} />
          <Row label="Total Liabilities" labelKm="បំណុលសរុប" value={calc.totalLiabilities} bold />
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Equity<span className="font-khmer block normal-case tracking-normal">ដើមទុន</span></p>
          <Row label="Partner Capital" labelKm="ដើមទុនដៃគូ" value={calc.partnerCapital} indent onClick={onNavigate ? () => onNavigate("capital") : undefined} />
          <Row label="Retained Earnings" labelKm="ប្រាក់ចំណេញរក្សាទុក" value={calc.retainedEarnings} indent />
          <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5"><Row label="Equity (net worth)" labelKm="ដើមទុន (តម្លៃសុទ្ធ)" value={calc.equity} bold /></div>
        </div>
      </div>

      {byLocation.length > 1 && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
            <MapPin size={16} className="text-brand-600" />
            <h3 className="font-semibold text-slate-700">By Location<span className="font-khmer block text-xs font-normal">តាមទីតាំង</span></h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">Location<span className="font-khmer block font-normal">ទីតាំង</span></th>
                <th className="px-5 py-2 font-medium">Sales<span className="font-khmer block font-normal">ការលក់</span></th>
                <th className="px-5 py-2 font-medium">Purchases<span className="font-khmer block font-normal">ការទិញ</span></th>
                <th className="px-5 py-2 font-medium">Profit<span className="font-khmer block font-normal">ចំណេញ</span></th>
                <th className="px-5 py-2 font-medium">Inventory<span className="font-khmer block font-normal">ស្តុកទំនិញ</span></th>
                <th className="px-5 py-2 font-medium">Payable<span className="font-khmer block font-normal">ត្រូវបង់</span></th>
              </tr>
            </thead>
            <tbody>
              {byLocation.map((row) => (
                <tr key={row.station.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{row.station.name}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt(row.totalSell)}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt(row.totalBuy)}</td>
                  <td className={`px-5 py-3 font-medium ${row.grossProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(row.grossProfit)}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt(row.inventoryValue)}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt(row.accountsPayable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        <Wallet size={14} className="mt-0.5 shrink-0" />
        <span>
          Simplified model: inventory is valued at average purchase cost, and cost of goods sold is approximated from total purchases rather than matched item-by-item.
          <span className="font-khmer block">គំរូសាមញ្ញ៖ ស្តុកទំនិញត្រូវបានវាយតម្លៃតាមថ្លៃទិញជាមធ្យម ហើយថ្លៃដើមទំនិញលក់ត្រូវបានប៉ាន់ស្មានពីការទិញសរុប មិនមែនផ្គូផ្គងម្តងមួយៗទេ។</span>
          {onNavigate && (
            <span className="ml-1">
              Tip: click any Sales, Purchases, or Balance Sheet line above to jump straight to its detail report.
              <span className="font-khmer block">ជំនួយ៖ ចុចលើបន្ទាត់ណាមួយក្នុងផ្នែកការលក់ ការទិញ ឬតារាងតុល្យការខាងលើ ដើម្បីមើលរបាយការណ៍លម្អិតភ្លាមៗ។</span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
