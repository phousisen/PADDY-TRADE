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

// Font stacks matching the real paper ticket's own fonts exactly (confirmed
// by opening the source .xls and reading its font names directly) — these
// are standard on Cambodian Windows PCs (the same PCs this gets printed
// from), so no web font loading is needed. If a device doesn't have them,
// the browser falls back to any other Khmer Unicode font it has.
const FONT_TITLE = { fontFamily: "'Khmer OS Bokor', 'Khmer OS Muol Light', serif" };
const FONT_BOLD = { fontFamily: "'Khmer OS Battambang', 'Khmer OS', sans-serif" };
const FONT_BODY = { fontFamily: "'Khmer OS', 'Khmer OS Battambang', sans-serif" };

// ---------------------------------------------------------------------------
// Exact replica of Baitang's real printed weight ticket (a physical carbon-
// copy coupon book before this app existed) — verified field-for-field,
// including exact Khmer wording, against the original .xls forms
// (Coupon_Import.xls / Coupon_Export.xls). Two versions exist on paper: an
// "Import" coupon used when buying from a farmer, and an "Export" coupon
// used when selling to a buyer — which one prints is decided by
// isBuy below, exactly matching the BUY/SELL ticket type already used
// throughout the rest of the app.
// ---------------------------------------------------------------------------
function ExactWeightTicket({ tx, isBuy, companyNameKh, companyAddressKh, companyPhoneLine, productName, hasWeighInOut, inStamp, outStamp }) {
  // "លេខរៀង / Number in" on the real paper coupon is the sequential number
  // on the guard-issued queue slip a farmer/truck already holds when they
  // arrive (see the "Quality Ticket No." field on the Weigh-In screen) —
  // not this app's own internal ticket code — so that's the more faithful
  // match here, falling back to the ticket's own code if a paper number was
  // never recorded (e.g. a manually-entered transaction).
  const numberIn = tx.paper_ticket_no || tx.code;

  // On the real coupon, the blank "Seller"/"Buyer" field on the side that
  // ISN'T the farmer/counterparty is filled in by hand with the name of
  // whichever staff member recorded this ticket (tx.recorded_by_name) —
  // falling back to the company's own name only for older tickets that
  // were created before that field existed and never had a name recorded.
  const counterpartyLabelKh = isBuy ? "អ្នកលក់" : " អ្នកទិញ";
  const counterpartyLabelEn = isBuy ? "Seller" : "Buyer";
  const ownSideLabel = isBuy ? "អ្នកទិញ              Buyer" : "អ្នកលក់              Seller";
  const ownSideName = tx.recorded_by_name || companyNameKh;

  const cell = "border border-slate-900 px-2 py-1";

  return (
    <div>
      {/* Header — company name/address/phone, exact wording and fonts from
          the real coupon. */}
      <div className="text-center">
        <p className="text-3xl font-bold" style={FONT_TITLE}>{companyNameKh}</p>
        <p className="text-lg font-bold" style={FONT_BOLD}>{companyAddressKh}</p>
        <p className="text-lg font-bold" style={FONT_BOLD}>{companyPhoneLine}</p>
        <p className="mt-1 text-base font-bold">
          {isBuy
            ? <>WEIGHT TICKET / IMPORT ( <span style={FONT_BODY}>ទិញចូល</span> )</>
            : <>WEIGHT TICKET / EXPORT ( <span style={FONT_BODY}>លក់ចេញ</span> )</>}
        </p>
      </div>

      {/* Info block — two label/value columns, same order as the coupon. */}
      <table className="mt-2 w-full text-sm">
        <tbody>
          <tr>
            <td className="w-[13%] whitespace-nowrap py-0.5 align-top" style={FONT_BODY}>លេខរៀង</td>
            <td className="w-[13%] py-0.5 align-top text-slate-600">Number in</td>
            <td className="w-[24%] border-b border-slate-500 py-0.5 align-top font-medium">{numberIn}</td>
            <td className="w-[26%] whitespace-nowrap py-0.5 pl-3 align-top" style={FONT_BODY}>ថ្ងៃ ខែ ឆ្នាំ&nbsp;&nbsp;&nbsp;Date</td>
            <td className="w-[24%] border-b border-slate-500 py-0.5 align-top font-medium">{tx.tx_date}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top" style={FONT_BODY}>ទំនិញ</td>
            <td className="py-0.5 align-top text-slate-600">Product</td>
            <td className="border-b border-slate-500 py-0.5 align-top font-medium">{productName}</td>
            <td className="whitespace-nowrap py-0.5 pl-3 align-top" style={FONT_BODY}>ឈ្មោះអ្នកបើកបរ Driver Name</td>
            <td className="border-b border-slate-500 py-0.5 align-top font-medium">{tx.driver_name || "—"}</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap py-0.5 align-top" style={FONT_BODY}>{counterpartyLabelKh}</td>
            <td className="py-0.5 align-top text-slate-600">{counterpartyLabelEn}</td>
            <td className="border-b border-slate-500 py-0.5 align-top font-medium">{tx.partyName}</td>
            <td className="whitespace-nowrap py-0.5 pl-3 align-top" style={FONT_BODY}>{ownSideLabel}</td>
            <td className="border-b border-slate-500 py-0.5 align-top font-medium">{ownSideName}</td>
          </tr>
        </tbody>
      </table>

      {/* Weight grid — Item / Truck Number / Date / Time / Weight, same 5
          columns, IN then OUT then NET W. / PRICE / AMOUNT, same as the
          coupon's own table. */}
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr style={FONT_BODY}>
            <th className={`${cell} w-[13%] font-normal`}>ចូល/ចេញ Item</th>
            <th className={`${cell} w-[19%] font-normal`}>លេខឡាន Truck Number</th>
            <th className={`${cell} w-[16%] font-normal`}>ថ្ងៃ ខែ ឆ្នាំ Date</th>
            <th className={`${cell} w-[24%] font-normal`}>ពេលវេលា Time</th>
            <th className={`${cell} w-[21%] font-normal`} colSpan={2}>ទំងន់ Weight</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cell} style={FONT_BODY}>ចូល&nbsp;&nbsp;&nbsp;&nbsp;IN</td>
            <td className={cell}>{tx.car_plate || "—"}</td>
            <td className={cell}>{hasWeighInOut ? inStamp.date : "—"}</td>
            <td className={cell}>{hasWeighInOut ? inStamp.time : "—"}</td>
            <td className={`${cell} text-right font-medium`}>{hasWeighInOut ? fmt2(tx.gross_kg) : "—"}</td>
            <td className={`${cell} text-center font-bold`}>Kg</td>
          </tr>
          <tr>
            <td className={cell} style={FONT_BODY}>ចេញ&nbsp;&nbsp;&nbsp;OUT</td>
            <td className={cell}>{tx.car_plate || "—"}</td>
            <td className={cell}>{hasWeighInOut ? outStamp.date : "—"}</td>
            <td className={cell}>{hasWeighInOut ? outStamp.time : "—"}</td>
            <td className={`${cell} text-right font-medium`}>{hasWeighInOut ? fmt2(tx.tare_kg) : "—"}</td>
            <td className={`${cell} text-center font-bold`}>Kg</td>
          </tr>
          <tr>
            <td className={`${cell} text-right`} colSpan={4} style={FONT_BODY}>ទំងន់សុទ្ធ&nbsp;&nbsp;&nbsp;&nbsp;NET W.</td>
            <td className={`${cell} text-right font-bold`}>{fmt2(tx.quantity_kg)}</td>
            <td className={`${cell} text-center font-bold`}>Kg</td>
          </tr>
          <tr>
            <td className={`${cell} text-right`} colSpan={4} style={FONT_BODY}>តម្លៃ&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;PRICE</td>
            <td className={`${cell} text-right font-medium`} colSpan={2}>{fmtRiel(tx.price_per_kg)}</td>
          </tr>
          <tr>
            <td className={`${cell} text-right`} colSpan={4} style={FONT_BODY}>តម្លៃសរុប AMOUNT</td>
            <td className={`${cell} text-right font-bold`} colSpan={2}>{fmtRiel(tx.amount)}</td>
          </tr>
          <tr>
            <td className="pt-6 pb-1 text-center" colSpan={2}>
              <div className="mx-auto mb-1 w-4/5 border-t border-dotted border-slate-700" />
              <span style={FONT_BODY}>អ្នកថ្លឹង Operator</span>
            </td>
            <td className="pt-6 pb-1 text-center" colSpan={4}>
              <div className="mx-auto mb-1 w-4/5 border-t border-dotted border-slate-700" />
              <span style={FONT_BODY}>អ្នកបើកបរ Driver</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// This layout is now an EXACT, field-for-field, wording-for-wording replica
// of Baitang's own printed paper weight ticket only (see ExactWeightTicket
// above — verified directly against the source .xls coupon files) — nothing
// else is printed below it anymore, so it matches the real coupon 1:1 for a
// clean print on the station's customized paper size.
export default function Receipt({ tx, onDone }) {
  const { t } = useLanguage();
  const isBuy = tx.type === "BUY";
  const [settings, setSettings] = useState({});

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  // Falls back to Baitang's real registered Khmer name/address/phone (as
  // printed on the actual coupon) if these settings were never filled in,
  // rather than a generic placeholder — so the ticket is correct out of the
  // box for this business, and only needs settings if it's ever reused for
  // a different company.
  const companyNameKh = settings.company_name_kh || "ប៉ៃតង កម្ពុជា";
  const companyAddressKh = settings.company_address || "ភូមិព្រៃទទឹង ឃុំរាំងកេសី ស្រុកសង្កែ ខេត្តបាត់ដំបង";
  const companyPhoneLine = settings.company_phone ? `Tel: ${settings.company_phone}` : "Tel: 012 37 36 396 / 088 96 666 52";

  // Only tickets that went through Weighing Tickets (Weigh In -> Finish
  // Ticket) carry separate gross/tare weighings — a manually-entered Buy/
  // Sell still just has one net weight, so the IN/OUT rows fall back to a
  // single blank dash rather than showing wrong numbers.
  const hasWeighInOut = tx.gross_kg != null;
  const inStamp = splitCambodiaTimestamp(tx.gross_at);
  const outStamp = splitCambodiaTimestamp(tx.tare_at);
  // A freshly-finalized ticket hands this component a snake_case
  // `product_name`; a transaction reopened later (fetched via
  // getTransactions, which joins/maps it as camelCase `productName`)
  // doesn't — accept either so the receipt reads the same either way.
  const productName = tx.product_name || tx.productName || "—";

  return (
    <div id="receipt-page" className="flex h-screen flex-1 flex-col overflow-hidden">
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
          <ExactWeightTicket
            tx={tx}
            isBuy={isBuy}
            companyNameKh={companyNameKh}
            companyAddressKh={companyAddressKh}
            companyPhoneLine={companyPhoneLine}
            productName={productName}
            hasWeighInOut={hasWeighInOut}
            inStamp={inStamp}
            outStamp={outStamp}
          />
        </div>
      </main>
    </div>
  );
}
