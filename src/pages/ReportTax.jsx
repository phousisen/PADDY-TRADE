import { useEffect, useMemo, useState } from "react";
import { ReceiptText } from "lucide-react";
import { api } from "../api.js";
import { SummaryStrip, SummaryCell, TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

export default function ReportTax({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const [allTxs, setAllTxs] = useState([]);
  const [view, setView] = useState("summary");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  function load() {
    setLoading(true);
    setLoadError("");
    api.getTransactions()
      .then(setAllTxs)
      .catch((err) => {
        // Without this, a failed/dropped request silently showed "No
        // taxable transactions" — as if nothing taxable had ever happened
        // — instead of saying the load itself had failed.
        setLoadError(err.message || "Couldn't load this report — check your connection and try again.");
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const txs = allTxs
    .filter((t) => (t.hq_status || "processing") !== "cancelled")
    .filter((t) => t.tax_applicable)
    .filter((t) => !selectedLocationIds.length || selectedLocationIds.includes(t.location_id))
    .filter((t) => !startDate || t.tx_date >= startDate)
    .filter((t) => !endDate || t.tx_date <= endDate);

  const outputTax = txs.filter((t) => t.type === "SELL").reduce((s, t) => s + Number(t.tax_amount || 0), 0);
  const inputTax = txs.filter((t) => t.type === "BUY").reduce((s, t) => s + Number(t.tax_amount || 0), 0);
  const netPayable = outputTax - inputTax;

  const sorted = useMemo(() => txs.slice().sort((a, b) => (a.tx_date < b.tx_date ? 1 : -1)), [txs]);

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}

      <SummaryStrip>
        <SummaryCell label="Output Tax (collected on sales)" value={fmtRiel(outputTax)} tone="pos" />
        <SummaryCell label="Input Tax (paid on purchases)" value={fmtRiel(inputTax)} />
        <SummaryCell
          label={netPayable >= 0 ? "Net Tax Payable" : "Net Tax Refundable"}
          value={fmtRiel(Math.abs(netPayable))}
          tone={netPayable >= 0 ? "neg" : "pos"}
        />
      </SummaryStrip>

      <TableCard title="Taxable Transactions" right={<ReceiptText size={14} className="text-slate-300" />}>
        <Table>
          <thead>
            <tr>
              <Th>Date</Th><Th>Receipt</Th><Th>Type</Th><Th>Party</Th>
              <Th num>Subtotal</Th><Th num>Rate</Th><Th num>Tax</Th><Th num>Total</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <Tr key={t.id}>
                <Td>{t.tx_date}</Td>
                <Td name>{t.code}</Td>
                <Td><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${t.type === "BUY" ? "bg-brand-50 text-brand-700" : "bg-rose-50 text-rose-600"}`}>{t.type}</span></Td>
                <Td>{t.partyName}</Td>
                <Td num>{fmtRiel(t.amount)}</Td>
                <Td num>{t.tax_rate}%</Td>
                <Td num>{fmtRiel(t.tax_amount)}</Td>
                <Td num name>{fmtRiel(t.total_with_tax)}</Td>
              </Tr>
            ))}
            {loading && sorted.length === 0 && <Tr><td colSpan={8} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></Tr>}
            {sorted.length === 0 && !loading && !loadError && <Tr><td colSpan={8} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No taxable transactions recorded yet.</td></Tr>}
          </tbody>
        </Table>
      </TableCard>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
        Only transactions with "Apply VAT" checked at entry show up here. Tax rates are fully editable per transaction — nothing is assumed automatically.
      </div>
    </div>
  );
}
