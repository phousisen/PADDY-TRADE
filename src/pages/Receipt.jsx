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
// Every piece of text and every visual (size/color/bold/alignment) choice on
// the printed ticket, gathered in one place so it can be edited from the
// Receipt Template page (Owner-only — see ReceiptTemplateEditor.jsx) instead
// of only ever being changed here in code. This object IS the "out of the
// box" look — it matches the original hand-verified coupon wording and the
// sizes this ticket has always printed at — so a station that never opens
// the Receipt Template page gets the exact same ticket as before.
//
// Saved as one JSON blob under system_settings (key "receipt_template"), the
// same generic settings table company_name_kh/company_address/etc already
// live in — no separate database table needed.
// ---------------------------------------------------------------------------
export const DEFAULT_RECEIPT_TEMPLATE = {
  labels: {
    ticketTypeBuyEn: "WEIGHT TICKET / IMPORT",
    ticketTypeBuyKh: "ទិញចូល",
    ticketTypeSellEn: "WEIGHT TICKET / EXPORT",
    ticketTypeSellKh: "លក់ចេញ",
    numberInKh: "លេខរៀង",
    numberInEn: "Number in",
    dateKh: "ថ្ងៃ ខែ ឆ្នាំ",
    dateEn: "Date",
    productKh: "ទំនិញ",
    productEn: "Product",
    driverNameKh: "ឈ្មោះអ្នកបើកបរ",
    driverNameEn: "Driver Name",
    sellerKh: "អ្នកលក់",
    sellerEn: "Seller",
    buyerKh: "អ្នកទិញ",
    buyerEn: "Buyer",
    itemKh: "ចូល/ចេញ",
    itemEn: "Item",
    truckNumberKh: "លេខឡាន",
    truckNumberEn: "Truck Number",
    weightDateKh: "ថ្ងៃ ខែ ឆ្នាំ",
    weightDateEn: "Date",
    timeKh: "ពេលវេលា",
    timeEn: "Time",
    weightKh: "ទំងន់",
    weightEn: "Weight",
    inKh: "ចូល",
    inEn: "IN",
    outKh: "ចេញ",
    outEn: "OUT",
    netWKh: "ទំងន់សុទ្ធ",
    netWEn: "NET W.",
    priceKh: "តម្លៃ",
    priceEn: "PRICE",
    amountKh: "តម្លៃសរុប",
    amountEn: "AMOUNT",
    operatorKh: "អ្នកថ្លឹង",
    operatorEn: "Operator",
    driverKh: "អ្នកបើកបរ",
    driverEn: "Driver",
    kgLabel: "Kg",
  },
  style: {
    headerAlign: "center", // "center" | "left"
    titleSizePx: 30,
    titleColor: "#0f172a",
    subLineSizePx: 18,
    subLineColor: "#0f172a",
    ticketTypeSizePx: 16,
    // The small bilingual field captions ("Number in", "Product", "Seller"…)
    // used to be a lighter gray (Tailwind slate-600) that read faint on some
    // printers — darkened by default here. Still separately adjustable from
    // the filled-in values below so the two stay visually distinct.
    labelColor: "#334155",
    valueColor: "#0f172a",
    valueBold: true,
    bodyFontSizePx: 14,
  },
};

// Deep-merges a saved template (possibly missing newer fields, or entirely
// absent) onto the defaults above, so the ticket always has every field it
// needs to render even if the saved JSON is partial or stale.
export function mergeReceiptTemplate(saved) {
  const s = saved || {};
  return {
    labels: { ...DEFAULT_RECEIPT_TEMPLATE.labels, ...(s.labels || {}) },
    style: { ...DEFAULT_RECEIPT_TEMPLATE.style, ...(s.style || {}) },
  };
}

// ---------------------------------------------------------------------------
// Exact replica of Baitang's real printed weight ticket (a physical carbon-
// copy coupon book before this app existed) — verified field-for-field,
// including exact Khmer wording, against the original .xls forms
// (Coupon_Import.xls / Coupon_Export.xls). Two versions exist on paper: an
// "Import" coupon used when buying from a farmer, and an "Export" coupon
// used when selling to a buyer — which one prints is decided by
// isBuy below, exactly matching the BUY/SELL ticket type already used
// throughout the rest of the app.
//
// All wording comes from `tpl.labels`, all sizing/color/bold/alignment from
// `tpl.style` (see DEFAULT_RECEIPT_TEMPLATE above) — nothing here is
// hardcoded text anymore, so an Owner can correct/restyle any of it from the
// Receipt Template page without a code change.
// ---------------------------------------------------------------------------
export function ExactWeightTicket({ tx, isBuy, tpl, companyNameKh, companyAddressKh, companyPhoneLine, productName, hasWeighInOut, inStamp, outStamp }) {
  const L = tpl.labels;
  const S = tpl.style;

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
  const counterpartyLabelKh = isBuy ? L.sellerKh : L.buyerKh;
  const counterpartyLabelEn = isBuy ? L.sellerEn : L.buyerEn;
  const ownSideLabelKh = isBuy ? L.buyerKh : L.sellerKh;
  const ownSideLabelEn = isBuy ? L.buyerEn : L.sellerEn;
  const ownSideName = tx.recorded_by_name || companyNameKh;

  const cell = "border border-slate-900 px-2 py-1";
  const labelStyle = { ...FONT_BODY, color: S.labelColor };
  const valueStyle = { color: S.valueColor, fontWeight: S.valueBold ? 700 : 500 };

  return (
    <div>
      {/* Header — company name/address/phone, exact wording and fonts from
          the real coupon. Alignment, size, and color all come from the
          template so an Owner can fix a header that prints off-center or
          too faint without needing a code change. */}
      <div className="text-center" style={{ textAlign: S.headerAlign }}>
        <p className="font-bold" style={{ ...FONT_TITLE, fontSize: S.titleSizePx, color: S.titleColor }}>{companyNameKh}</p>
        <p className="font-bold" style={{ ...FONT_BOLD, fontSize: S.subLineSizePx, color: S.subLineColor }}>{companyAddressKh}</p>
        <p className="font-bold" style={{ ...FONT_BOLD, fontSize: S.subLineSizePx, color: S.subLineColor }}>{companyPhoneLine}</p>
        <p className="mt-1 font-bold" style={{ fontSize: S.ticketTypeSizePx, color: S.titleColor }}>
          {isBuy
            ? <>{L.ticketTypeBuyEn} ( <span style={FONT_BODY}>{L.ticketTypeBuyKh}</span> )</>
            : <>{L.ticketTypeSellEn} ( <span style={FONT_BODY}>{L.ticketTypeSellKh}</span> )</>}
        </p>
      </div>

      {/* Info block — two label/value columns, same order as the coupon. */}
      <table className="mt-2 w-full" style={{ fontSize: S.bodyFontSizePx }}>
        <tbody>
          <tr>
            <td className="w-[13%] whitespace-nowrap py-0.5 align-top" style={labelStyle}>{L.numberInKh}</td>
            <td className="w-[13%] py-0.5 align-top" style={labelStyle}>{L.numberInEn}</td>
            <td className="w-[24%] border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{numberIn}</td>
            <td className="w-[26%] whitespace-nowrap py-0.5 pl-3 align-top" style={labelStyle}>{L.dateKh}&nbsp;&nbsp;&nbsp;{L.dateEn}</td>
            <td className="w-[24%] border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{tx.tx_date}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top" style={labelStyle}>{L.productKh}</td>
            <td className="py-0.5 align-top" style={labelStyle}>{L.productEn}</td>
            <td className="border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{productName}</td>
            <td className="whitespace-nowrap py-0.5 pl-3 align-top" style={labelStyle}>{L.driverNameKh} {L.driverNameEn}</td>
            <td className="border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{tx.driver_name || "—"}</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap py-0.5 align-top" style={labelStyle}>{counterpartyLabelKh}</td>
            <td className="py-0.5 align-top" style={labelStyle}>{counterpartyLabelEn}</td>
            <td className="border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{tx.partyName}</td>
            <td className="whitespace-nowrap py-0.5 pl-3 align-top" style={labelStyle}>{ownSideLabelKh}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{ownSideLabelEn}</td>
            <td className="border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{ownSideName}</td>
          </tr>
        </tbody>
      </table>

      {/* Weight grid — Item / Truck Number / Date / Time / Weight, same 5
          columns, IN then OUT then NET W. / PRICE / AMOUNT, same as the
          coupon's own table. */}
      <table className="mt-2 w-full border-collapse" style={{ fontSize: S.bodyFontSizePx }}>
        <thead>
          <tr style={labelStyle}>
            <th className={`${cell} w-[13%] font-normal`}>{L.itemKh} {L.itemEn}</th>
            <th className={`${cell} w-[19%] font-normal`}>{L.truckNumberKh} {L.truckNumberEn}</th>
            <th className={`${cell} w-[16%] font-normal`}>{L.weightDateKh} {L.weightDateEn}</th>
            <th className={`${cell} w-[24%] font-normal`}>{L.timeKh} {L.timeEn}</th>
            <th className={`${cell} w-[21%] font-normal`} colSpan={2}>{L.weightKh} {L.weightEn}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cell} style={labelStyle}>{L.inKh}&nbsp;&nbsp;&nbsp;&nbsp;{L.inEn}</td>
            <td className={cell} style={valueStyle}>{tx.car_plate || "—"}</td>
            <td className={cell} style={valueStyle}>{hasWeighInOut ? inStamp.date : "—"}</td>
            <td className={cell} style={valueStyle}>{hasWeighInOut ? inStamp.time : "—"}</td>
            <td className={`${cell} text-right`} style={valueStyle}>{hasWeighInOut ? fmt2(tx.gross_kg) : "—"}</td>
            <td className={`${cell} text-center font-bold`} style={{ color: S.valueColor }}>{L.kgLabel}</td>
          </tr>
          <tr>
            <td className={cell} style={labelStyle}>{L.outKh}&nbsp;&nbsp;&nbsp;{L.outEn}</td>
            <td className={cell} style={valueStyle}>{tx.car_plate || "—"}</td>
            <td className={cell} style={valueStyle}>{hasWeighInOut ? outStamp.date : "—"}</td>
            <td className={cell} style={valueStyle}>{hasWeighInOut ? outStamp.time : "—"}</td>
            <td className={`${cell} text-right`} style={valueStyle}>{hasWeighInOut ? fmt2(tx.tare_kg) : "—"}</td>
            <td className={`${cell} text-center font-bold`} style={{ color: S.valueColor }}>{L.kgLabel}</td>
          </tr>
          <tr>
            <td className={`${cell} text-right`} colSpan={4} style={labelStyle}>{L.netWKh}&nbsp;&nbsp;&nbsp;&nbsp;{L.netWEn}</td>
            <td className={`${cell} text-right font-bold`} style={{ color: S.valueColor }}>{fmt2(tx.quantity_kg)}</td>
            <td className={`${cell} text-center font-bold`} style={{ color: S.valueColor }}>{L.kgLabel}</td>
          </tr>
          <tr>
            <td className={`${cell} text-right`} colSpan={4} style={labelStyle}>{L.priceKh}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{L.priceEn}</td>
            <td className={`${cell} text-right`} colSpan={2} style={valueStyle}>{fmtRiel(tx.price_per_kg)}</td>
          </tr>
          <tr>
            <td className={`${cell} text-right`} colSpan={4} style={labelStyle}>{L.amountKh}&nbsp;{L.amountEn}</td>
            <td className={`${cell} text-right font-bold`} colSpan={2} style={{ color: S.valueColor }}>{fmtRiel(tx.amount)}</td>
          </tr>
          <tr>
            <td className="pt-6 pb-1 text-center" colSpan={2}>
              <div className="mx-auto mb-1 w-4/5 border-t border-dotted border-slate-700" />
              <span style={labelStyle}>{L.operatorKh} {L.operatorEn}</span>
            </td>
            <td className="pt-6 pb-1 text-center" colSpan={4}>
              <div className="mx-auto mb-1 w-4/5 border-t border-dotted border-slate-700" />
              <span style={labelStyle}>{L.driverKh} {L.driverEn}</span>
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

  // The Owner-editable template (wording + size/color/bold/alignment) — see
  // ReceiptTemplateEditor.jsx. Stored as one JSON blob under system_settings
  // key "receipt_template"; falls back to the built-in defaults (the
  // ticket's original look) if it's never been customized or fails to
  // parse for any reason.
  let savedTpl = null;
  if (settings.receipt_template) {
    try { savedTpl = JSON.parse(settings.receipt_template); } catch { savedTpl = null; }
  }
  const tpl = mergeReceiptTemplate(savedTpl);

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
        <div id="receipt-root" className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ExactWeightTicket
            tx={tx}
            isBuy={isBuy}
            tpl={tpl}
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
