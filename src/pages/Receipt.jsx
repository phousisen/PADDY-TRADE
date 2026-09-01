import { useEffect, useState } from "react";
import { Printer, ArrowLeft, AlertTriangle } from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { api } from "../api.js";
import { isTransactionPendingSync, onSyncStatusChange } from "../offlineQueue.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
function splitCambodiaTimestamp(iso) {
  if (!iso) return { time: "—" };
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return { time };
}
function ddmmyyyy(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

// ---------------------------------------------------------------------------
// Final approved design [2026-08-25]: replaces the earlier exact-paper-
// coupon replica with the bordered, lines-only monochrome layout shared
// with the Weigh-In Slip (WeighingTickets.jsx's TicketSlip) — logo +
// per-location address/phone header, doc-type badge with ticket/truck
// number, dotted field grid, bordered weight table, Quality +
// Price&Payment cards (QR built into the payment card), bold bordered
// Total Amount band, generous signature space. Verified against a real
// print-height render at 122mm of the 140mm physical form.
//
// NOTE: this intentionally replaces the earlier ExactWeightTicket /
// DEFAULT_RECEIPT_TEMPLATE customization system (labels/sizes editable via
// a separate Owner-only Receipt Template settings page). That editor page
// no longer has any effect on what gets printed — its route in App.jsx now
// shows a plain notice instead of rendering it, so it can't silently look
// like it's doing something when it isn't, and can't crash on the removed
// exports it used to read from this file.
//
// NOTE: bank_name/bank_account aren't currently stored on a finalized
// transaction — only bank_qr_url is carried over from the weighing ticket
// (see api.js's finalizeTicket). Prints "—" for Bank/Account until those
// two columns are added and wired through; the QR image works today.
//
// stationAddress/stationPhone: per-location fields (see
// add_location_address_phone.sql + api.js's getTransactions/getTickets)
// — falls back to the global company_address/company_phone from Settings
// (fetched below) if a location hasn't had them filled in yet, same
// fallback TicketSlip already uses, so a missing per-location value never
// just prints a blank header.
// ---------------------------------------------------------------------------
function ExactWeightTicket({ tx, isBuy, stationAddress, stationPhone }) {
  const inStamp = splitCambodiaTimestamp(tx.gross_at);
  const outStamp = splitCambodiaTimestamp(tx.tare_at);
  const hasWeighInOut = tx.gross_kg != null;
  const productName = tx.product_name || tx.productName || "—";

  const partyLabelKh = isBuy ? "អ្នកលក់" : "អ្នកទិញ";
  const partyLabelEn = isBuy ? "Seller" : "Buyer";
  const staffLabelKh = isBuy ? "អ្នកទិញ" : "អ្នកលក់";
  const staffLabelEn = isBuy ? "Buyer (staff)" : "Seller (staff)";

  return (
    <div id="receipt-root">
      {/* [2026-08-30] Only set when the ~7s wait for sync confirmation ran
          out (see finalizeTicketOffline/createTransactionOffline in
          offlineQueue.js) — not shown for the ordinary brief "still
          syncing" moment every transaction passes through.
          [2026-09-01] Originally printed onto the physical page on
          purpose (unlike the no-print banner further down, which only
          ever showed on this screen), so whoever walked away holding the
          paper would see it too. Per explicit request, it's now
          print-hidden (see the `.verify-band` rule inside @media print in
          index.css) — this still renders and is still visible right here
          on screen exactly as before, it just no longer appears on the
          printed slip itself. */}
      {tx.needs_verification && (
        <div className="verify-band">
          <span className="tri">⚠</span>
          <span>NOT YET CONFIRMED SAVED — check the Needs Attention panel if this isn't on Transactions soon.</span>
        </div>
      )}
      <div className="head">
        <img className="head-logo" src="/logo-paitong.png" alt="Company logo" />
        <div className="head-mid">
          <div className="co-address">{stationAddress || "—"}</div>
          <div className="co-phone">Tel: {stationPhone || "—"}</div>
        </div>
        <div className="head-right">
          <span className="doc-type">Weight Ticket — {isBuy ? "Import" : "Export"}</span>
          <div className="doc-no">No. {tx.code}</div>
          <div className="doc-sub">Truck No. {tx.car_plate || "—"}</div>
        </div>
      </div>

      <div className="fields">
        <div className="field"><span className="lbl"><span className="kh">ទំនិញ</span><span className="en">Product</span></span><span className="val">{productName}</span></div>
        <div className="field"><span className="lbl"><span className="kh">ថ្ងៃ</span><span className="en">Date</span></span><span className="val">{ddmmyyyy(tx.tx_date)}</span></div>
        <div className="field"><span className="lbl"><span className="kh">{partyLabelKh}</span><span className="en">{partyLabelEn}</span></span><span className="val">{tx.partyName}{tx.partyIdNumber ? ` · ${tx.partyIdNumber}` : ""}</span></div>
        <div className="field"><span className="lbl"><span className="kh">អ្នកបើកបរ</span><span className="en">Driver</span></span><span className="val">{tx.driver_name || "—"}{tx.driver_phone ? ` · ${tx.driver_phone}` : ""}</span></div>
        <div className="field"><span className="lbl"><span className="kh">លេខសំបុត្រ</span><span className="en">Ticket No.</span></span><span className="val">{tx.paper_ticket_no || tx.code}</span></div>
        <div className="field"><span className="lbl"><span className="kh">{staffLabelKh}</span><span className="en">{staffLabelEn}</span></span><span className="val">{tx.recorded_by_name || "—"}</span></div>
      </div>

      <table className="weights">
        <thead>
          <tr>
            <th><span className="kh">ចូល/ចេញ</span><span className="en">Item</span></th>
            <th><span className="kh">ថ្ងៃ</span><span className="en">Date</span></th>
            <th><span className="kh">ពេលវេលា</span><span className="en">Time</span></th>
            <th className="num"><span className="kh">ទម្ងន់</span><span className="en">Weight</span></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>ចូល IN</td>
            <td>{hasWeighInOut ? ddmmyyyy(tx.tx_date) : "—"}</td>
            <td>{hasWeighInOut ? inStamp.time : "—"}</td>
            <td className="num">{hasWeighInOut ? `${fmt2(tx.gross_kg)} kg` : "—"}</td>
          </tr>
          <tr>
            <td>ចេញ OUT</td>
            <td>{hasWeighInOut ? ddmmyyyy(tx.tx_date) : "—"}</td>
            <td>{hasWeighInOut ? outStamp.time : "—"}</td>
            <td className="num">{hasWeighInOut ? `${fmt2(tx.tare_kg)} kg` : "—"}</td>
          </tr>
          <tr className="net">
            <td colSpan={3}>ទម្ងន់សុទ្ធ Net Weight</td>
            <td className="num">{fmt2(tx.quantity_kg)} kg</td>
          </tr>
        </tbody>
      </table>

      <div className="cards">
        <div className="card quality">
          <div className="card-h">គុណភាព · Quality</div>
          <div className="row"><span className="k">Grade</span><span className="v">{tx.quality_grade || "—"}</span></div>
          <div className="row"><span className="k">Moisture</span><span className="v">{fmt2(tx.moisture_pct)}%</span></div>
          <div className="row"><span className="k">Mixture / Outthrow</span><span className="v">{fmt2(tx.mixture_pct)}% / {fmt2(tx.outthrow_pct)}%</span></div>
          <div className="row"><span className="k">Deduction</span><span className="v">{fmt2(tx.deduction_kg)} kg</span></div>
        </div>
        <div className="card payment">
          <div className="payment-fields">
            <div className="card-h">តម្លៃ និង ការទូទាត់ · Price &amp; Payment</div>
            <div className="row price"><span className="k">Price / kg</span><span className="v">{tx.price_per_kg != null ? fmtRiel(tx.price_per_kg) : "—"}</span></div>
            <div className="row"><span className="k">Bank</span><span className="v">—</span></div>
            {isBuy && <div className="row"><span className="k">Staff Fee</span><span className="v">{tx.staff_fee ? fmtRiel(tx.staff_fee) : "—"}</span></div>}
            <div className="row"><span className="k">Account</span><span className="v">—</span></div>
          </div>
          <div className="payment-qr">
            {tx.bank_qr_url
              ? <img src={tx.bank_qr_url} alt="Payment QR" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              : "QR"}
          </div>
        </div>
      </div>

      {tx.price_per_kg != null && (
        <div className="total-band">
          <span className="lab">តម្លៃសរុប · Total Amount</span>
          <span className="amt">{fmtRiel(tx.total_with_tax ?? tx.amount)}</span>
        </div>
      )}

      <div className="sig-row">
        <div className="sig-box"><div className="sig-line"></div><span className="kh">អ្នកថ្លឹង</span> <span className="en">Operator</span></div>
        <div className="sig-box"><div className="sig-line"></div><span className="kh">អ្នកបើកបរ</span> <span className="en">Driver</span></div>
      </div>
    </div>
  );
}

export default function Receipt({ tx, onDone }) {
  const { t } = useLanguage();
  const isBuy = tx.type === "BUY";

  const [pendingSync, setPendingSync] = useState(() => isTransactionPendingSync(tx.id));
  useEffect(() => {
    const unsub = onSyncStatusChange(() => setPendingSync(isTransactionPendingSync(tx.id)));
    return unsub;
  }, [tx.id]);

  // Global company address/phone (Settings page) — only used as a fallback
  // if this transaction's own per-location address/phone is missing (e.g.
  // an older transaction from before add_location_address_phone.sql was
  // run, or a location that hasn't had those fields filled in yet).
  const [settings, setSettings] = useState({});
  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  const stationAddress = tx.stationAddress || settings.company_address || "";
  const stationPhone = tx.stationPhone || settings.company_phone || "";

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

      {pendingSync && (
        <div className="no-print flex items-center gap-2 bg-rose-600 px-6 py-2.5 text-xs font-semibold text-white">
          <AlertTriangle size={14} />
          Not yet saved to PaddyTrade's server — this transaction only exists on this device so far. Do not close this browser, clear its data, or switch devices until it finishes syncing (see the banner at the top of the screen), or this record could be lost even though it's already printed.
        </div>
      )}

      <main className="flex-1 overflow-y-auto bg-slate-100 p-6">
        <ExactWeightTicket tx={tx} isBuy={isBuy} stationAddress={stationAddress} stationPhone={stationPhone} />
      </main>
    </div>
  );
}
