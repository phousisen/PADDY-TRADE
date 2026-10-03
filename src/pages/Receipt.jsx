import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Printer, ArrowLeft, AlertTriangle } from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { api } from "../api.js";
import { getAccurateNow } from "../supabaseClient.js";
import { isTransactionPendingSync, onSyncStatusChange, logAuditOffline } from "../offlineQueue.js";
import { dmy, hm } from "../dateFormat.js";
import { nextCopyNumber, fmtPrintedAt, PRINT_ACTION, printsOf } from "../printLog.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
// [2026-09-06] Used to only compute `time`, never `date` — which is
// exactly why the IN/OUT rows below both fell back to tx.tx_date (the
// single date the whole transaction was finalized on) instead of each
// row's own real date. Harmless when Finish Ticket happens the same day
// as weigh-in, but a ticket weighed in one day and only finished the
// next (confirmed live on a Jomnoum ticket, weighed in on the 5th,
// finished on the 6th) printed an IN row with the correct time but the
// WRONG date — today's, not the 5th's. Now returns both, matching the
// same-named function in WeighingTickets.jsx (the Weigh-In Slip, which
// never had this bug), so each row can use its own timestamp's actual
// date instead of borrowing the transaction's.
function splitCambodiaTimestamp(iso) {
  if (!iso) return { date: "—", time: "—" };
  return { date: dmy(iso), time: hm(iso) };
}
function ddmmyyyy(dateStr) {
  if (!dateStr) return "—";
  return dmy(dateStr);
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
function ExactWeightTicket({ tx, isBuy, stationAddress, stationPhone, copyNo = 1, printedLabel = "", printedBy = "" }) {
  // [2026-09-09] Only the NOT-CONFIRMED band is translated here. The ticket
  // body itself is a printed legal-ish document with Khmer and English
  // deliberately side by side on every line; that stays as it is. The band
  // is the one part that is an instruction to the person holding the paper.
  const { t } = useLanguage();
  const inStamp = splitCambodiaTimestamp(tx.gross_at);
  const outStamp = splitCambodiaTimestamp(tx.tare_at);
  // [2026-09-12] The weight and its timestamp are now asked about
  // separately. They used to be one flag (`tx.gross_kg != null`), which
  // meant a row with a real weight but no recorded instant — every
  // back-dated manual entry, where nobody can honestly say what time
  // yesterday's truck crossed the scale — printed a dash in the WEIGHT
  // column too. The number is known; only the clock reading is not.
  const hasWeighIn = tx.gross_kg != null;
  const hasWeighOut = tx.tare_kg != null;
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
          <span>{t("sync_not_confirmed")}</span>
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
          {/* [2026-09-27] THE SHEET NUMBER COSTS NO HEIGHT.
              SISEN: "why not just expand it" — the 4mm left clear at the
              foot is not spare, it absorbs the drift of continuous-feed
              paper, and content run to the edge eventually prints across the
              perforation. So the tracking number goes where a number already
              is: the receipt number, with the sheet on the end. The original
              prints exactly as it does today, with no /1. */}
          <div className="doc-no">No. {copyNo > 1 ? `${tx.code}/${copyNo}` : tx.code}</div>
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
            <td>{inStamp.date}</td>
            <td>{inStamp.time}</td>
            <td className="num">{hasWeighIn ? `${fmt2(tx.gross_kg)} kg` : "—"}</td>
          </tr>
          <tr>
            <td>ចេញ OUT</td>
            <td>{outStamp.date}</td>
            <td>{outStamp.time}</td>
            <td className="num">{hasWeighOut ? `${fmt2(tx.tare_kg)} kg` : "—"}</td>
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
            {/* [2026-09-16] Only on a record that actually carries one. The fee
                stopped being collected on 16 Sept — it is typed as ថ្លៃកូនដៃ on
                Expenses now — but every receipt printed before that must still
                reprint exactly as it was issued. */}
            {isBuy && Number(tx.staff_fee) > 0 && <div className="row"><span className="k">Staff Fee</span><span className="v">{fmtRiel(tx.staff_fee)}</span></div>}
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

      {/* [2026-09-27] NOTHING ANNOUNCES ITSELF ON THIS PAPER.
          SISEN: "no, it shouldnt have this, its not a professional reciept.
          just a small number that track for us to understand."

          He is right. A band saying NOT THE ORIGINAL turns a document a
          farmer is handed into an accusation. The tracking belongs to the
          business, not to the person receiving it: the time along the foot,
          and a sheet number in the corner that is different on every sheet.
          Quiet on the paper, complete in the system. */}
      <div className="printed-at">
        <span className="when">{printedLabel}</span>
        {printedBy && <span className="who">· {printedBy}</span>}
      </div>
    </div>
  );
}

export default function Receipt({ tx, onDone, profileName = "", onPrinted }) {
  const { t } = useLanguage();
  // [2026-09-27] The print record has to carry a name. Without user_id the
  // entry lands with a blank "who", which is the one column anyone looking
  // at a reprint actually wants.
  const { session, profile } = useAuth();
  const printedByName = profileName || profile?.full_name || "";
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

  // [2026-09-27] WHICH COPY THIS IS, AND WHEN IT WAS MADE.
  //
  // The copy number comes from what has already been recorded for this
  // ticket, not from a counter on this device: a station that printed while
  // offline still knows its place once its entry syncs.
  //
  // A failure to read the history must never stop a receipt printing — a
  // farmer is standing there. On failure this prints as copy 1 with the time,
  // which is exactly what the old receipt did, plus a time.
  const [printedRows, setPrintedRows] = useState([]);
  useEffect(() => {
    let alive = true;
    api.getTransactionHistory(tx.id)
      .then((rows) => { if (alive) setPrintedRows(rows || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [tx.id]);

  // The time on the paper is the moment the print actually starts, not the
  // moment the page was opened — someone can leave a receipt on screen for an
  // hour. `beforeprint` fires for the button AND for Ctrl+P, so the line
  // cannot be dodged by printing from the browser's own menu.
  const [printedAt, setPrintedAt] = useState(() => getAccurateNow().toISOString());

  // [2026-09-27] THE NUMBER HAS TO MOVE ON EVERY PRESS, NOT EVERY OPEN.
  //
  // SISEN: "what if in order to open a reciept it loads the the next number
  // but then when it comes to printing, they are able to print copy 2 many
  // times or 3 many times."
  //
  // He is right, and the first version had exactly that hole. The copy number
  // was worked out once, when the page opened. Pressing Print five times gave
  // five sheets all saying COPY 2, all carrying the same sheet number — which
  // is worse than no marking at all, because five identical sheets look like
  // evidence that only one copy was ever made.
  //
  // `printsHere` counts presses made on this screen since it opened, and sits
  // on top of whatever was already recorded. Press three times and the paper
  // reads COPY 2, COPY 3, COPY 4, with three different sheet numbers.
  const [printsHere, setPrintsHere] = useState(0);
  const copyNo = nextCopyNumber(printedRows) + printsHere;

  useEffect(() => {
    const onBefore = () => {
      // Cambodia's corrected clock, not this PC's own (full check T11).
      const at = getAccurateNow().toISOString();
      // flushSync, not a plain setState: `beforeprint` is the last moment the
      // page can be changed before the printer takes its picture, and React
      // would otherwise batch this update until after the sheet had already
      // been rendered. Without it the paper carries the PREVIOUS number —
      // the same bug in a different place.
      // Only the time changes before the picture is taken. The number must
      // NOT move yet: whatever is on screen right now is what this sheet is.
      // Moving it here printed COPY 3 for the second copy — caught by
      // pressing four times in a row and reading the paper each time.
      flushSync(() => { setPrintedAt(at); });
      // Recorded through the same audit trail as everything else, so it shows
      // up in the Activity Log and under the ticket with no new table. The
      // number written down is the one on the paper.
      // Queued, not sent: a station with no signal still prints, and its
      // print still has to be counted. The entry goes out with the next sync.
      // `at` is the moment of printing — the row's own created_at is the
      // moment it reached the server, which for an offline station can be
      // hours later. printLog.js reads `at` first.
      // Never allowed to stop the print: a view-only account refuses to
      // queue anything, and the farmer still needs the paper.
      try {
        logAuditOffline({
          action: PRINT_ACTION,
          tableName: "transactions",
          recordId: tx.id,
          userId: session?.user?.id,
          newData: { from: "receipt", copy: copyNo, at, code: tx.code, stationName: tx.stationName },
        });
      } catch { /* see above */ }
    };
    // The number moves once the sheet is out, ready for the next press.
    // `afterprint` fires whether they printed or cancelled at the printer —
    // which is right, because this counts presses, not sheets of paper, and
    // that is what the screen and the report both say it counts.
    // [2026-09-29] Tell the screen that opened this receipt, so its ×N
    // goes up straight away instead of waiting for a reload (daily check,
    // 28 Sep). The print record itself is queued above and may reach the
    // server a moment later; the list must not wait for that.
    const onAfter = () => { setPrintsHere((n) => n + 1); if (onPrinted) onPrinted(); };
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, [tx.id, tx.code, tx.stationName, copyNo, session?.user?.id, onPrinted]);

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

      {/* [2026-09-27] WHAT HAS ALREADY BEEN PRINTED, BEFORE PRINTING AGAIN.
          On screen only (no-print) — never on the paper. Whoever is about to
          press Print sees that this ticket already has receipts out, and
          when, and by whom. Grey for one earlier print, gold from two. */}
      {(() => {
        const done = printsOf(printedRows).filter((p) => p.from === "receipt");
        if (done.length === 0) return null;
        return (
          <div className={`no-print flex flex-wrap items-center gap-4 border-b px-6 py-2.5 text-[13px] ${done.length > 1 ? "border-gold-300 bg-gold-50" : "border-slate-200 bg-slate-50"}`}>
            <span className={`flex items-center gap-1.5 font-semibold ${done.length > 1 ? "text-gold-700" : "text-slate-600"}`}>
              <Printer size={14} /> {t(done.length > 1 ? "rc_already_many" : "rc_already_one", { n: done.length })}
            </span>
            {done.map((p) => (
              <span key={p.atIso + p.copy} className="tabular-nums text-slate-500">{fmtPrintedAt(p.atIso)} · {p.who || "—"}</span>
            ))}
          </div>
        );
      })()}

      {pendingSync && (
        <div className="no-print flex items-center gap-2 bg-rose-600 px-6 py-2.5 text-xs font-semibold text-white">
          <AlertTriangle size={14} />
          Not yet saved to PaddyTrade's server — this transaction only exists on this device so far. Do not close this browser, clear its data, or switch devices until it finishes syncing (see the banner at the top of the screen), or this record could be lost even though it's already printed.
        </div>
      )}

      <main className="flex-1 overflow-y-auto bg-slate-100 p-6">
        <ExactWeightTicket
          tx={tx} isBuy={isBuy} stationAddress={stationAddress} stationPhone={stationPhone}
          copyNo={copyNo}
          printedLabel={fmtPrintedAt(printedAt)}
          printedBy={printedByName}
        />
      </main>
    </div>
  );
}
