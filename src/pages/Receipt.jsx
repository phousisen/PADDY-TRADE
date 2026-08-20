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

const rowCls = "flex justify-between border-b border-slate-100 px-3 py-1.5 last:border-0";

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
  // Sell still just has one net weight, so the IN/OUT table only shows up
  // when there's actually an IN and OUT to show.
  const hasWeighInOut = tx.gross_kg != null;
  const inStamp = splitCambodiaTimestamp(tx.gross_at);
  const outStamp = splitCambodiaTimestamp(tx.tare_at);
  const hasBankDetails = tx.bank_name && tx.bank_name !== "Cash";

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
        <div id="receipt-root" className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {/* Header — company info, same as Baitang's own printed ticket */}
          <div className="mb-3 text-center">
            <p className="text-lg font-bold text-slate-800">{companyName}</p>
            {companyNameKh && <p className="text-sm text-slate-500">{companyNameKh}</p>}
            <p className="text-xs text-slate-400">{companyAddress}</p>
            {companyPhone && <p className="text-xs text-slate-400">{companyPhone}</p>}
            {companyTaxId && <p className="text-xs text-slate-400">Tax ID: {companyTaxId}</p>}
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-1 border-t border-b border-dashed border-slate-200 py-2 text-xs text-slate-500">
            <span>Receipt #: <span className="font-medium text-slate-700">{tx.code}</span></span>
            {tx.paper_ticket_no && <span>Quality Ticket No: <span className="font-medium text-slate-700">{tx.paper_ticket_no}</span></span>}
            <span>{tx.tx_date} {fmtTime(tx.tx_time)}</span>
          </div>

          {/* IN / OUT weighing table — the digital version of Baitang's own
              printed ticket table (Truck ID / Date / Time / Weight). */}
          {hasWeighInOut ? (
            <div className="mb-3 overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500">
                    <th className="px-3 py-1.5 text-left font-medium">List</th>
                    <th className="px-3 py-1.5 text-left font-medium">Truck ID</th>
                    <th className="px-3 py-1.5 text-left font-medium">Date</th>
                    <th className="px-3 py-1.5 text-left font-medium">Time</th>
                    <th className="px-3 py-1.5 text-right font-medium">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-medium text-slate-600">IN</td>
                    <td className="px-3 py-1.5 text-slate-600">{tx.car_plate || "—"}</td>
                    <td className="px-3 py-1.5 text-slate-600">{inStamp.date}</td>
                    <td className="px-3 py-1.5 text-slate-600">{inStamp.time}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-slate-700">{fmt2(tx.gross_kg)} kg</td>
                  </tr>
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-medium text-slate-600">OUT</td>
                    <td className="px-3 py-1.5 text-slate-600">{tx.car_plate || "—"}</td>
                    <td className="px-3 py-1.5 text-slate-600">{outStamp.date}</td>
                    <td className="px-3 py-1.5 text-slate-600">{outStamp.time}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-slate-700">{fmt2(tx.tare_kg)} kg</td>
                  </tr>
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td colSpan={4} className="px-3 py-1.5 font-semibold text-slate-700">Net Weight</td>
                    <td className="px-3 py-1.5 text-right font-bold text-slate-800">{fmt2(tx.quantity_kg)} kg</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className={`mb-3 overflow-hidden rounded-lg border border-slate-200 text-sm`}>
              <div className={rowCls}><span className="text-slate-500">Net Weight</span><span className="font-medium text-slate-700">{fmt2(tx.quantity_kg)} kg</span></div>
              {tx.car_plate && <div className={rowCls}><span className="text-slate-500">Car Plate</span><span className="font-medium text-slate-700">{tx.car_plate}</span></div>}
            </div>
          )}

          {/* Seller/Buyer details — name, phone, bank, all in one place so
              the printed copy carries everything needed to pay them. */}
          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {isBuy ? "Seller (Farmer)" : "Buyer"} Details
          </p>
          <div className="mb-3 overflow-hidden rounded-lg border border-slate-200 text-sm">
            <div className={rowCls}><span className="text-slate-500">Name</span><span className="font-medium text-slate-700">{tx.partyName}</span></div>
            {tx.partyIdNumber && <div className={rowCls}><span className="text-slate-500">Phone</span><span className="font-medium text-slate-700">{tx.partyIdNumber}</span></div>}
            {tx.bank_name && <div className={rowCls}><span className="text-slate-500">Bank</span><span className="font-medium text-slate-700">{tx.bank_name}</span></div>}
            {hasBankDetails && tx.bank_account && <div className={rowCls}><span className="text-slate-500">Bank Account</span><span className="font-medium text-slate-700">{tx.bank_account}</span></div>}
            {tx.driver_name && <div className={rowCls}><span className="text-slate-500">Truck / Driver</span><span className="font-medium text-slate-700">{tx.driver_name}</span></div>}
          </div>

          {/* Product, quality, and price — mirrors the Product/Buyer-Seller/
              Mixture/Price block on Baitang's own printed ticket. */}
          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Trade Details</p>
          <div className="mb-3 overflow-hidden rounded-lg border border-slate-200 text-sm">
            {tx.product_name && <div className={rowCls}><span className="text-slate-500">Product</span><span className="font-medium text-slate-700">{tx.product_name}</span></div>}
            {tx.stationName && <div className={rowCls}><span className="text-slate-500">Warehouse</span><span className="font-medium text-slate-700">{tx.stationName}</span></div>}
            {tx.quality_grade && <div className={rowCls}><span className="text-slate-500">Quality Grade</span><span className="font-medium text-slate-700">{tx.quality_grade}</span></div>}
            {(tx.moisture_pct > 0 || tx.mixture_pct > 0 || tx.outthrow_pct > 0) && (
              <div className={rowCls}><span className="text-slate-500">Moisture / Mixture / Outthrow</span><span className="font-medium text-slate-700">{tx.moisture_pct || 0}% / {tx.mixture_pct || 0}% / {tx.outthrow_pct || 0}%</span></div>
            )}
            {tx.deduction_kg > 0 && (
              <div className={rowCls}><span className="text-slate-500">Deduction</span><span className="font-medium text-rose-600">-{fmt2(tx.deduction_kg)} kg</span></div>
            )}
            {tx.deduction_kg > 0 && (
              <div className={rowCls}><span className="text-slate-500">Payable Weight</span><span className="font-medium text-slate-700">{fmt2(tx.payable_kg ?? (tx.quantity_kg - tx.deduction_kg))} kg</span></div>
            )}
            <div className={rowCls}><span className="text-slate-500">Price per kg</span><span className="font-medium text-slate-700">{fmtRiel(tx.price_per_kg)}</span></div>
          </div>

          {tx.note && <p className="mb-3 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">{tx.note}</p>}

          {(tx.tax_applicable || tx.staff_fee > 0) && (
            <div className="mb-3 space-y-1 border-t border-dashed border-slate-200 pt-2 text-sm">
              {isBuy && tx.staff_fee > 0 && (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">Goods Amount</span><span className="text-slate-700">{fmtRiel(Number(tx.amount) + Number(tx.staff_fee))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Staff / Carrying Fee</span><span className="text-rose-600">-{fmtRiel(tx.staff_fee)}</span></div>
                </>
              )}
              {tx.tax_applicable && (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="text-slate-700">{fmtRiel(tx.amount)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">VAT ({tx.tax_rate}%)</span><span className="text-slate-700">{fmtRiel(tx.tax_amount)}</span></div>
                </>
              )}
            </div>
          )}

          <div className="mt-3 rounded-lg bg-brand-50 p-3 text-center">
            <p className="text-xs text-brand-700/70">Total Amount</p>
            <p className="text-2xl font-bold text-brand-800">{fmtRiel(tx.total_with_tax ?? tx.amount)}</p>
          </div>

          {/* Signature lines — same three roles as Baitang's paper ticket
              (Statistic Officer / Seller / Weigher), for the printed copy. */}
          <div className="mt-6 grid grid-cols-3 gap-x-4 gap-y-6 text-xs text-slate-500">
            <div>Statistic Officer: ..........................</div>
            <div>{isBuy ? "Seller" : "Buyer"}: ..........................</div>
            <div>Weigher: ..........................</div>
          </div>

          <p className="mt-4 whitespace-pre-line text-center text-xs text-slate-400">{footerNote}</p>
        </div>
      </main>
    </div>
  );
}
