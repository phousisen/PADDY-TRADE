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

// A wide gap between the Khmer word and the English word on the same line,
// matching the spacing used on the real paper coupon for the "own side"
// field (e.g. "អ្នកទិញ              Buyer") — kept as one constant so both
// the Buy and Sell version of that line line up the same way.
const LABEL_GAP = " ".repeat(14);

// ---------------------------------------------------------------------------
// Every piece of text on the ticket, and every adjustable style knob, lives
// here as ONE plain object — this is what the Owner-only Receipt Template
// page (ReceiptTemplateEditor.jsx) reads, edits, and saves (as JSON, under
// the existing generic `system_settings` table, key "receipt_template" — no
// new database table needed). Printing always merges whatever was saved
// onto these defaults (see mergeReceiptTemplate below), so a ticket never
// breaks just because a field was added here after someone already saved a
// customized template.
// ---------------------------------------------------------------------------
export const DEFAULT_RECEIPT_TEMPLATE = {
  labels: {
    ticketTypeBuyEn: "WEIGHT TICKET / IMPORT",
    ticketTypeBuyKh: "ទិញចូល",
    ticketTypeSellEn: "WEIGHT TICKET / EXPORT",
    ticketTypeSellKh: "លក់ចេញ",
    numberInEn: "Number in",
    numberInKh: "លេខរៀង",
    dateEn: "Date",
    dateKh: "ថ្ងៃ ខែ ឆ្នាំ",
    productEn: "Product",
    productKh: "ទំនិញ",
    driverNameEn: "Driver Name",
    driverNameKh: "ឈ្មោះអ្នកបើកបរ",
    sellerEn: "Seller",
    sellerKh: "អ្នកលក់",
    buyerEn: "Buyer",
    buyerKh: "អ្នកទិញ",
    itemEn: "Item",
    itemKh: "ចូល/ចេញ",
    truckNumberEn: "Truck Number",
    truckNumberKh: "លេខឡាន",
    weightDateEn: "Date",
    weightDateKh: "ថ្ងៃ ខែ ឆ្នាំ",
    timeEn: "Time",
    timeKh: "ពេលវេលា",
    weightEn: "Weight",
    weightKh: "ទំងន់",
    inEn: "IN",
    inKh: "ចូល",
    outEn: "OUT",
    outKh: "ចេញ",
    netWEn: "NET W.",
    netWKh: "ទំងន់សុទ្ធ",
    priceEn: "PRICE",
    priceKh: "តម្លៃ",
    amountEn: "AMOUNT",
    amountKh: "តម្លៃសរុប",
    kgLabel: "Kg",
    operatorEn: "Operator",
    operatorKh: "អ្នកថ្លឹង",
    driverEn: "Driver",
    driverKh: "អ្នកបើកបរ",
  },
  // Sizes bumped up from the original defaults (30/18/16/14px) after the
  // Owner asked for clearer text on the actual printed ticket — the ticket
  // prints on a small 220mm x 140mm continuous-feed paper (see index.css),
  // so slightly larger, bolder text goes a long way toward legibility
  // without changing the paper size itself. Owner can still fine-tune any
  // of these from the Receipt Template page.
  style: {
    headerAlign: "center",
    titleSizePx: 34,
    titleColor: "#0f172a",
    subLineSizePx: 20,
    subLineColor: "#0f172a",
    ticketTypeSizePx: 19,
    labelColor: "#1e293b",
    valueColor: "#000000",
    valueBold: true,
    bodyFontSizePx: 17,
  },
};

// Deep-merges a saved template (possibly missing fields added after it was
// last saved, or entirely null/corrupt) onto the defaults above, so both
// the printed ticket and the editor always have every key filled in.
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
// throughout the rest of the app. Every word and every size/color below
// comes from `tpl` (see DEFAULT_RECEIPT_TEMPLATE above) instead of being
// hardcoded, so the Owner-only Receipt Template page can change any of it.
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
  const counterpartyLabelKh = isBuy ? L.sellerKh : ` ${L.buyerKh}`;
  const counterpartyLabelEn = isBuy ? L.sellerEn : L.buyerEn;
  const ownSideLabel = isBuy ? `${L.buyerKh}${LABEL_GAP}${L.buyerEn}` : `${L.sellerKh}${LABEL_GAP}${L.sellerEn}`;
  const ownSideName = tx.recorded_by_name || companyNameKh;

  const cell = "border border-slate-900 px-2 py-1";
  const labelStyle = { ...FONT_BODY, color: S.labelColor };
  const valueStyle = { color: S.valueColor, fontWeight: S.valueBold ? 700 : 500 };
  const bodyPx = { fontSize: `${S.bodyFontSizePx}px` };

  return (
    <div style={bodyPx}>
      {/* Header — company name/address/phone, exact wording and fonts from
          the real coupon. */}
      <div style={{ textAlign: S.headerAlign }}>
        <p className="font-bold" style={{ ...FONT_TITLE, fontSize: `${S.titleSizePx}px`, color: S.titleColor }}>{companyNameKh}</p>
        <p className="font-bold" style={{ ...FONT_BOLD, fontSize: `${S.subLineSizePx}px`, color: S.subLineColor }}>{companyAddressKh}</p>
        <p className="font-bold" style={{ ...FONT_BOLD, fontSize: `${S.subLineSizePx}px`, color: S.subLineColor }}>{companyPhoneLine}</p>
        <p className="mt-1 font-bold" style={{ fontSize: `${S.ticketTypeSizePx}px` }}>
          {isBuy
            ? <>{L.ticketTypeBuyEn} ( <span style={FONT_BODY}>{L.ticketTypeBuyKh}</span> )</>
            : <>{L.ticketTypeSellEn} ( <span style={FONT_BODY}>{L.ticketTypeSellKh}</span> )</>}
        </p>
      </div>

      {/* Info block — two label/value columns, same order as the coupon. */}
      <table className="mt-2 w-full" style={bodyPx}>
        <tbody>
          <tr>
            <td className="w-[13%] whitespace-nowrap py-0.5 align-top" style={labelStyle}>{L.numberInKh}</td>
            <td className="w-[13%] py-0.5 align-top" style={{ color: S.labelColor }}>{L.numberInEn}</td>
            <td className="w-[24%] border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{numberIn}</td>
            <td className="w-[26%] whitespace-nowrap py-0.5 pl-3 align-top" style={labelStyle}>{L.dateKh}&nbsp;&nbsp;&nbsp;{L.dateEn}</td>
            <td className="w-[24%] border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{tx.tx_date}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top" style={labelStyle}>{L.productKh}</td>
            <td className="py-0.5 align-top" style={{ color: S.labelColor }}>{L.productEn}</td>
            <td className="border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{productName}</td>
            <td className="whitespace-nowrap py-0.5 pl-3 align-top" style={labelStyle}>{L.driverNameKh} {L.driverNameEn}</td>
            <td className="border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{tx.driver_name || "—"}</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap py-0.5 align-top" style={labelStyle}>{counterpartyLabelKh}</td>
            <td className="py-0.5 align-top" style={{ color: S.labelColor }}>{counterpartyLabelEn}</td>
            <td className="border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{tx.partyName}</td>
            <td className="whitespace-nowrap py-0.5 pl-3 align-top" style={labelStyle}>{ownSideLabel}</td>
            <td className="border-b border-slate-500 py-0.5 align-top" style={valueStyle}>{ownSideName}</td>
          </tr>
        </tbody>
      </table>

      {/* Weight grid — Item / Truck Number / Date / Time / Weight, same 5
          columns, IN then OUT then NET W. / PRICE / AMOUNT, same as the
          coupon's own table. */}
      <table className="mt-2 w-full border-collapse" style={bodyPx}>
        <thead>
          <tr style={FONT_BODY}>
            <th className={`${cell} w-[13%] font-normal`}>{L.itemKh} {L.itemEn}</th>
            <th className={`${cell} w-[19%] font-normal`}>{L.truckNumberKh} {L.truckNumberEn}</th>
            <th className={`${cell} w-[16%] font-normal`}>{L.weightDateKh} {L.weightDateEn}</th>
            <th className={`${cell} w-[24%] font-normal`}>{L.timeKh} {L.timeEn}</th>
            <th className={`${cell} w-[21%] font-normal`} colSpan={2}>{L.weightKh} {L.weightEn}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cell} style={FONT_BODY}>{L.inKh}&nbsp;&nbsp;&nbsp;&nbsp;{L.inEn}</td>
            <td className={cell}>{tx.car_plate || "—"}</td>
            <td className={cell}>{hasWeighInOut ? inStamp.date : "—"}</td>
            <td className={cell}>{hasWeighInOut ? inStamp.time : "—"}</td>
            <td className={`${cell} text-right font-medium`}>{hasWeighInOut ? fmt2(tx.gross_kg) : "—"}</td>
            <td className={`${cell} text-center font-bold`}>{L.kgLabel}</td>
          </tr>
          <tr>
            <td className={cell} style={FONT_BODY}>{L.outKh}&nbsp;&nbsp;&nbsp;{L.outEn}</td>
            <td className={cell}>{tx.car_plate || "—"}</td>
            <td className={cell}>{hasWeighInOut ? outStamp.date : "—"}</td>
            <td className={cell}>{hasWeighInOut ? outStamp.time : "—"}</td>
            <td className={`${cell} text-right font-medium`}>{hasWeighInOut ? fmt2(tx.tare_kg) : "—"}</td>
            <td className={`${cell} text-center font-bold`}>{L.kgLabel}</td>
          </tr>
          <tr>
            <td className={`${cell} text-right`} colSpan={4} style={FONT_BODY}>{L.netWKh}&nbsp;&nbsp;&nbsp;&nbsp;{L.netWEn}</td>
            <td className={`${cell} text-right font-bold`}>{fmt2(tx.quantity_kg)}</td>
            <td className={`${cell} text-center font-bold`}>{L.kgLabel}</td>
          </tr>
          {/* A ticket sent out for pricing later (price_per_kg not yet set)
              never had a real amount to print — showing "0 ៛" here would
              read as a completed, free transaction. Print a plain dash
              instead so it's obviously still pending. */}
          <tr>
            <td className={`${cell} text-right`} colSpan={4} style={FONT_BODY}>{L.priceKh}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{L.priceEn}</td>
            <td className={`${cell} text-right font-medium`} colSpan={2}>{tx.price_per_kg != null ? fmtRiel(tx.price_per_kg) : "—"}</td>
          </tr>
          <tr>
            <td className={`${cell} text-right`} colSpan={4} style={FONT_BODY}>{L.amountKh} {L.amountEn}</td>
            <td className={`${cell} text-right font-bold`} colSpan={2}>{tx.price_per_kg != null ? fmtRiel(tx.amount) : "—"}</td>
          </tr>
          <tr>
            <td className="pt-6 pb-1 text-center" colSpan={2}>
              <div className="mx-auto mb-1 w-4/5 border-t border-dotted border-slate-700" />
              <span style={FONT_BODY}>{L.operatorKh} {L.operatorEn}</span>
            </td>
            <td className="pt-6 pb-1 text-center" colSpan={4}>
              <div className="mx-auto mb-1 w-4/5 border-t border-dotted border-slate-700" />
              <span style={FONT_BODY}>{L.driverKh} {L.driverEn}</span>
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

  // The Owner's customized wording/style (Receipt Template page), parsed
  // from JSON and merged onto the built-in defaults — falls back to plain
  // defaults if nothing was ever saved, or if the saved JSON is corrupt.
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
        <div id="receipt-root" className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 text-sm shadow-sm">
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
