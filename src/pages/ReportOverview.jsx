import { useEffect, useMemo, useState } from "react";
import { TrendingUp, Scale, Wallet, MapPin } from "lucide-react";
import { api } from "../api.js";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }

function computeFinancials(txs, stations) {
  const buys = txs.filter((x) => x.type === "BUY");
  const sells = txs.filter((x) => x.type === "SELL");
  const totalBuy = buys.reduce((s, x) => s + Number(x.amount), 0);
  const totalSell = sells.reduce((s, x) => s + Number(x.amount), 0);
  const grossProfit = totalSell - totalBuy;
  const accountsPayable = buys.filter((x) => x.payment_status === "pending").reduce((s, x) => s + Number(x.total_with_tax ?? x.amount), 0);
  const accountsReceivable = sells.filter((x) => x.payment_status && x.payment_status !== "paid").reduce((s, x) => s + Number(x.total_with_tax ?? x.amount), 0);
  const paidBuy = buys.filter((x) => x.payment_status === "paid").reduce((s, x) => s + Number(x.total_with_tax ?? x.amount), 0);
  const paidSell = sells.filter((x) => !x.payment_status || x.payment_status === "paid").reduce((s, x) => s + Number(x.total_with_tax ?? x.amount), 0);
  const cashEstimate = paidSell - paidBuy;
  const totalBuyKg = buys.reduce((s, x) => s + Number(x.quantity_kg), 0) || 1;
  const avgCostPerKg = totalBuy / totalBuyKg;
  const totalStockKg = stations.reduce((s, x) => s + Number(x.current_stock_kg), 0);
  const inventoryValue = totalStockKg * avgCostPerKg;
  const totalAssets = inventoryValue + accountsReceivable + Math.max(0, cashEstimate);
  const totalLiabilities = accountsPayable;
  const equity = totalAssets - totalLiabilities;
  return { totalBuy, totalSell, grossProfit, accountsPayable, accountsReceivable, cashEstimate, inventoryValue, totalAssets, totalLiabilities, equity };
}

export default function ReportOverview({ selectedLocationIds = [] }) {
  const [txs, setTxs] = useState([]);
  const [stations, setStations] = useState([]);

  useEffect(() => {
    Promise.all([api.getTransactions(), api.getLocations()]).then(([t, s]) => { setTxs(t); setStations(s); });
  }, []);

  const filteredStations = selectedLocationIds.length ? stations.filter((s) => selectedLocationIds.includes(s.id)) : stations;
  const activeTxs = txs.filter((t) => (t.hq_status || "processing") !== "cancelled");
  const filteredTxs = selectedLocationIds.length ? activeTxs.filter((t) => selectedLocationIds.includes(t.location_id)) : activeTxs;

  const calc = useMemo(() => computeFinancials(filteredTxs, filteredStations), [filteredTxs, filteredStations]);

  const byLocation = useMemo(() => {
    return filteredStations.map((s) => {
      const stationTxs = activeTxs.filter((x) => x.location_id === s.id);
      const c = computeFinancials(stationTxs, [s]);
      return { station: s, ...c };
    });
  }, [activeTxs, filteredStations]);

  const Row = ({ label, value, bold, indent }) => (
    <div className={`flex items-center justify-between border-b border-slate-50 py-2.5 text-sm last:border-0 ${indent ? "pl-4" : ""}`}>
      <span className={bold ? "font-semibold text-slate-800" : "text-slate-500"}>{label}</span>
      <span className={bold ? "font-semibold text-slate-800" : "text-slate-700"}>{fmt(value)} ៛</span>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-700"><TrendingUp size={16} className="text-brand-600" /> Profit &amp; Loss</h3>
          <Row label="Total Sales (Revenue)" value={calc.totalSell} />
          <Row label="Total Purchases (COGS)" value={-calc.totalBuy} />
          <Row label="Gross Profit" value={calc.grossProfit} bold />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-700"><Scale size={16} className="text-brand-600" /> Balance Sheet</h3>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Assets</p>
          <Row label="Inventory on hand" value={calc.inventoryValue} indent />
          <Row label="Accounts Receivable" value={calc.accountsReceivable} indent />
          <Row label="Cash (estimate)" value={Math.max(0, calc.cashEstimate)} indent />
          <Row label="Total Assets" value={calc.totalAssets} bold />
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Liabilities</p>
          <Row label="Accounts Payable" value={calc.accountsPayable} indent />
          <Row label="Total Liabilities" value={calc.totalLiabilities} bold />
          <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5"><Row label="Equity (net worth)" value={calc.equity} bold /></div>
        </div>
      </div>

      {byLocation.length > 1 && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
            <MapPin size={16} className="text-brand-600" />
            <h3 className="font-semibold text-slate-700">By Location</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2 font-medium">Location</th>
                <th className="px-5 py-2 font-medium">Sales</th>
                <th className="px-5 py-2 font-medium">Purchases</th>
                <th className="px-5 py-2 font-medium">Profit</th>
                <th className="px-5 py-2 font-medium">Inventory</th>
                <th className="px-5 py-2 font-medium">Payable</th>
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
        Simplified model: inventory is valued at average purchase cost, and cost of goods sold is approximated from total purchases rather than matched item-by-item.
      </div>
    </div>
  );
}
