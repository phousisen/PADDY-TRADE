import { useEffect, useState } from "react";
import { Printer, ArrowLeft } from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
function fmtTime(t) {
  if (!t) return "";
  const [hh, mm] = t.split(":");
  let h = parseInt(hh, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mm} ${period}`;
}
// Splits a timestamptz (from gross_at/tare_at) into Cambodia-local date and
// time strings for the IN/OUT weight table, same as everywhere else in the
// app that shows Cambodia wall-clock time regardless of the viewer's own
// device timezone.
function splitCambodiaTimestamp(iso) {
  if (!iso) return { date: "—", time: "—" };
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "short", year: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return { date, time };
}

// This layout deliberately mirrors Baitang's own paper "Quality Inspection"
// ticket field-for-field (weight table on top, then a two-column block —
// product/party/quality/signatures on the left, net weight/price/total on
// the right, weigher's line spanning the bottom) so staff who already know
// the paper ticket by heart can read this one the same way. Bank details
// and the bank QR photo are the only things added on top of Baitang's own
// layout, so payment can be sent straight from the printed/saved copy.
export default function Receipt({ tx, onDone }) {
  const { t } = useLanguage();
  const isBuy = tx.type === "BUY";
  const [settings, setSettings] = useState({});

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  const companyName = settings.company_name || "PaddyTrade";
  const companyNameKh = settings.company_name_kh;
  const companyAddress = settings.company_address || "Battambang, Cambodia";
  const companyPhone = settings.company_phone;
  const companyTaxId = settings.company_tax_id;
  const footerNote = settings.receipt_footer_note || "Thank you for your business!";

  // Only tickets that went through Weighing Tickets (Weigh In -> Finish
  // Ticket) carry separate gross/tare weighings — a manually-entered Buy/
  // Sell still just has one net weight, so the IN/OUT rows fall back to a
  // single blank dash rather than showing wrong numbers.
  const hasWeighInOut = tx.gross_kg != null;
  const inStamp = splitCambodiaTimestamp(tx.gross_at);
  const outStamp = splitCambodiaTimestamp(tx.tare_at);
  const hasBankDetails = tx.bank_name && tx.bank_name !== "Cash";
  // A freshly-finalized ticket hands this component a snake_case
  // `product_name`; a transaction reopened later (fetched via
  // getTransactions, which joins/maps it as camelCase `productName`)
  // doesn't — accept either so the receipt reads the same either way.
  const productName = tx.product_name || tx.productName || "—";
  const payableKg = tx.deduction_kg > 0 ? (tx.payable_kg ?? (tx.quantity_kg - tx.deduction_kg)) : null;
  // tax_amount/total_with_tax aren't columns on the transaction itself —
  // they're recomputed here from what is stored (amount, tax_applicable,
  // tax_rate) so a taxed transaction still totals correctly when reopened
  // later, not just right after it was first saved.
  const taxAmount = tx.tax_amount ?? (tx.tax_applicable ? Math.round(Number(tx.amount) * (Number(tx.tax_rate) || 0)) / 100 : 0);
  const total = tx.total_with_tax ?? (Number(tx.amount) + taxAmount);

  const cellCls = "px-2 py-1 border border-slate-300";
  const labelCellCls = `${cellCls} bg-slate-50 font-medium text-slate-600 whitespace-nowrap`;

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <div className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-800">Receipt</h1>
        <div className="flex gap-2">
          <button onClick={onDone} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            <ArrowLeft size={14} /> {t("back")}
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto bg-slate-100 p-6">
        <div id="receipt-root" className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 text-sm shadow-sm">
          {/* Header — company info, same as Baitang's own printed ticket */}
          <div className="mb-2 text-center">
            <p className="text-lg font-bold text-slate-800">{companyName}</p>
            {companyNameKh && <p className="text-sm text-slate-500">{companyNameKh}</p>}
            <p className="text-xs text-slate-400">{companyAddress}</p>
            {companyPhone && <p className="text-xs text-slate-400">{companyPhone}</p>}
            {companyTaxId && <p className="text-xs text-slate-400">Tax ID: {companyTaxId}</p>}
          </div>
          <p className="mb-1 text-center text-base font-semibold uppercase tracking-wide text-slate-700">Ticket</p>
          <div className="mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-center text-xs text-slate-400">
            <span>Receipt #: <span className="font-medium text-slate-600">{tx.code}</span></span>
            {tx.paper_ticket_no && <span>· Quality Ticket No: <span className="font-medium text-slate-600">{tx.paper_ticket_no}</span></span>}
            <span>· {tx.tx_date} {fmtTime(tx.tx_time)}</span>
          </div>

          {/* Weight table — same fields, same order, as Baitang's own
              printed ticket table (LIST / TRUCK ID / DATE / TIME / WEIGHT,
              then NET WEIGHT / MOISTURE / OUTTHROW). */}
          <table className="mb-3 w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-500">
                <th className={`${cellCls} text-left font-medium`}>List</th>
                <th className={`${cellCls} text-left font-medium`}>Truck ID</th>
                <th className={`${cellCls} text-left font-medium`}>Date</th>
                <th className={`${cellCls} text-left font-medium`}>Time</th>
                <th className={`${cellCls} text-right font-medium`}>Weight</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${cellCls} font-medium text-slate-600`}>IN</td>
                <td className={`${cellCls} text-slate-600`}>{tx.car_plate || "—"}</td>
                <td className={`${cellCls} text-slate-600`}>{hasWeighInOut ? inStamp.date : "—"}</td>
                <td className={`${cellCls} text-slate-600`}>{hasWeighInOut ? inStamp.time : "—"}</td>
                <td className={`${cellCls} text-right font-medium text-slate-700`}>{hasWeighInOut ? `${fmt2(tx.gross_kg)} KG` : "—"}</td>
              </tr>
              <tr>
                <td className={`${cellCls} font-medium text-slate-600`}>OUT</td>
                <td className={`${cellCls} text-slate-600`}>{tx.car_plate || "—"}</td>
                <td className={`${cellCls} text-slate-600`}>{hasWeighInOut ? outStamp.date : "—"}</td>
                <td className={`${cellCls} text-slate-600`}>{hasWeighInOut ? outStamp.time : "—"}</td>
                <td className={`${cellCls} text-right font-medium text-slate-700`}>{hasWeighInOut ? `${fmt2(tx.tare_kg)} KG` : "—"}</td>
              </tr>
              <tr>
                <td colSpan={4} className={labelCellCls}>Net Weight</td>
                <td className={`${cellCls} text-right font-semibold text-slate-800`}>{fmt2(tx.quantity_kg)} KG</td>
              </tr>
              <tr>
                <td colSpan={4} className={labelCellCls}>Moisture</td>
                <td className={`${cellCls} text-right text-slate-700`}>{tx.moisture_pct || 0}%</td>
              </tr>
              <tr>
                <td colSpan={4} className={labelCellCls}>Outthrow</td>
                <td className={`${cellCls} text-right text-slate-700`}>{tx.outthrow_pct || 0}%</td>
              </tr>
            </tbody>
          </table>

          {/* Two-column block — left mirrors Baitang's Product/Buyer-Seller/
              Mixture/Note/signature column, right mirrors their Net/Price/
              Total column. Bank details and the QR photo are the only
              additions to Baitang's own layout. */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 border border-slate-300 p-3">
              <p><span className="text-slate-400">CN</span> <span className="font-medium text-slate-700">{tx.code}</span></p>
              <p><span className="text-slate-400">Product name</span> <span className="font-medium text-slate-700">{productName}</span> {tx.stationName && <><span className="ml-2 text-slate-400">WH</span> <span className="font-medium text-slate-700">{tx.stationName}</span></>}</p>
              <p><span className="text-slate-400">{isBuy ? "Seller name" : "Buyer name"}</span> <span className="font-medium text-slate-700">{tx.partyName}</span></p>
              {tx.partyIdNumber && <p><span className="text-slate-400">Phone</span> <span className="font-medium text-slate-700">{tx.partyIdNumber}</span></p>}
              {tx.bank_name && <p><span className="text-slate-400">Bank</span> <span className="font-medium text-slate-700">{tx.bank_name}{hasBankDetails && tx.bank_account ? ` — ${tx.bank_account}` : ""}</span></p>}
              {tx.driver_name && <p><span className="text-slate-400">Driver</span> <span className="font-medium text-slate-700">{tx.driver_name}</span></p>}
              {tx.quality_grade && <p><span className="text-slate-400">Quality Grade</span> <span className="font-medium text-slate-700">{tx.quality_grade}</span></p>}
              <p><span className="text-slate-400">Mixture</span> <span className="font-medium text-slate-700">{tx.mixture_pct || 0}%</span></p>
              {tx.deduction_kg > 0 && (
                <p><span className="text-slate-400">Deduction</span> <span className="font-medium text-rose-600">-{fmt2(tx.deduction_kg)} KG</span> {payableKg != null && <span className="ml-2 text-slate-400">Payable</span>} {payableKg != null && <span className="font-medium text-slate-700">{fmt2(payableKg)} KG</span>}</p>
              )}
              <p className="text-slate-500">Note: {tx.note || "......"}</p>

              <div className="mt-4 space-y-4 pt-2 text-xs text-slate-500">
                <p>Statistics Officer: ..........................</p>
                <p>{isBuy ? "Seller" : "Buyer"}: ..........................</p>
              </div>
            </div>

            <div className="space-y-2 border border-slate-300 p-3">
              <p className="flex items-baseline justify-between">
                <span className="text-slate-400">Net</span>
                <span className="text-lg font-bold text-slate-800">{fmt2(tx.quantity_kg)} KG</span>
              </p>
              <p className="flex items-baseline justify-between">
                <span className="text-slate-400">Price / Kg</span>
                <span className="font-semibold text-slate-800">{fmtRiel(tx.price_per_kg)}</span>
              </p>
              {isBuy && tx.staff_fee > 0 && (
                <p className="flex items-baseline justify-between text-xs">
                  <span className="text-slate-400">Staff / Carrying Fee</span>
                  <span className="text-rose-600">-{fmtRiel(tx.staff_fee)}</span>
                </p>
              )}
              {tx.tax_applicable && (
                <p className="flex items-baseline justify-between text-xs">
                  <span className="text-slate-400">VAT ({tx.tax_rate}%)</span>
                  <span className="text-slate-700">{fmtRiel(taxAmount)}</span>
                </p>
              )}
              <div className="mt-2 rounded-lg bg-brand-50 p-3 text-center">
                <p className="text-xs text-brand-700/70">Total</p>
                <p className="text-2xl font-bold text-brand-800">{fmtRiel(total)}</p>
              </div>

              {/* Bank QR code photo, captured by staff at Weigh In, so
                  payment can be sent straight from this printed copy. */}
              {tx.bank_qr_url && (
                <div className="mt-2 text-center">
                  <p className="mb-1 text-xs text-slate-400">Scan to pay</p>
                  <img src={tx.bank_qr_url} alt="Bank QR code" className="mx-auto h-32 w-32 rounded-lg border border-slate-200 object-contain" />
                </div>
              )}
            </div>
          </div>

          {/* Weigher's signature — spans the full width, same as the bottom
              line on Baitang's own printed ticket. */}
          <div className="mt-4 border border-t-0 border-slate-300 p-3 text-xs text-slate-500">
            Weigher: ..........................
          </div>

          <p className="mt-4 whitespace-pre-line text-center text-xs text-slate-400">{footerNote}</p>
        </div>
      </main>
    </div>
  );
}
