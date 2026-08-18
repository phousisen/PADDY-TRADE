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
        <div id="receipt-root" className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 text-center">
            <p className="text-lg font-bold text-slate-800">{companyName}</p>
            {companyNameKh && <p className="text-sm text-slate-500">{companyNameKh}</p>}
            <p className="text-xs text-slate-400">{companyAddress}</p>
            {companyPhone && <p className="text-xs text-slate-400">{companyPhone}</p>}
            {companyTaxId && <p className="text-xs text-slate-400">Tax ID: {companyTaxId}</p>}
          </div>
          <div className="mb-3 flex justify-between border-t border-b border-dashed border-slate-200 py-2 text-xs text-slate-500">
            <span>Receipt #: <span className="font-medium text-slate-700">{tx.code}</span></span>
            <span>{tx.tx_date} {fmtTime(tx.tx_time)}</span>
          </div>

          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {isBuy ? "Seller (Farmer)" : "Buyer"}
          </p>
          <div className="mb-3 space-y-0.5 text-sm text-slate-700">
            <p>{tx.partyName}</p>
            {tx.partyIdNumber && <p className="text-xs text-slate-400">Phone: {tx.partyIdNumber}</p>}
          </div>

          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Weight Details</p>
          <div className="mb-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Net Weight</span><span className="font-medium text-slate-700">{fmt2(tx.quantity_kg)} kg</span></div>
            {tx.quality_grade && <div className="flex justify-between"><span className="text-slate-500">Quality Grade</span><span className="font-medium text-slate-700">{tx.quality_grade}</span></div>}
            {(tx.moisture_pct > 0 || tx.mixture_pct > 0 || tx.outthrow_pct > 0) && (
              <div className="flex justify-between text-xs text-slate-400">
                <span>Moisture {tx.moisture_pct}% · Mixture {tx.mixture_pct}% · Outthrow {tx.outthrow_pct}%</span>
              </div>
            )}
            {tx.deduction_kg > 0 && (
              <>
                <div className="flex justify-between"><span className="text-slate-500">Deduction</span><span className="font-medium text-rose-600">-{fmt2(tx.deduction_kg)} kg</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Payable Weight</span><span className="font-medium text-slate-700">{fmt2(tx.payable_kg ?? (tx.quantity_kg - tx.deduction_kg))} kg</span></div>
              </>
            )}
            <div className="flex justify-between"><span className="text-slate-500">Price per kg</span><span className="font-medium text-slate-700">{fmtRiel(tx.price_per_kg)}</span></div>
            {tx.car_plate && <div className="flex justify-between"><span className="text-slate-500">Car Plate</span><span className="font-medium text-slate-700">{tx.car_plate}</span></div>}
          </div>
          {tx.note && <p className="mb-3 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">{tx.note}</p>}

          {tx.tax_applicable && (
            <div className="mb-3 space-y-1 border-t border-dashed border-slate-200 pt-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="text-slate-700">{fmtRiel(tx.amount)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">VAT ({tx.tax_rate}%)</span><span className="text-slate-700">{fmtRiel(tx.tax_amount)}</span></div>
            </div>
          )}

          <div className="mt-3 rounded-lg bg-brand-50 p-3 text-center">
            <p className="text-xs text-brand-700/70">Total Amount</p>
            <p className="text-2xl font-bold text-brand-800">{fmtRiel(tx.total_with_tax ?? tx.amount)}</p>
          </div>

          <p className="mt-4 whitespace-pre-line text-center text-xs text-slate-400">{footerNote}</p>
        </div>
      </main>
    </div>
  );
}
