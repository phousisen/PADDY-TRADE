import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Phone, IdCard, Landmark, Building2, PlusCircle, QrCode } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import Receipt from "./Receipt.jsx";
import { api } from "../api.js";
import { paidStatusMap } from "./ReportOverview.jsx";
import { useLanguage } from "../i18n.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

// Full profile for one farmer or buyer — everything about them in one
// place: their contact/bank info, running totals, and a complete history
// of every truckload bought from (or sold to) them, with real paid/unpaid
// status per bill (not the static payment_status field — see paidStatusMap).
//
// [2026-09-03] `hideAmounts` — set by RegistrarShell.jsx for the Registrar
// role: they can see that transactions happened (dates, bill #s, locations,
// paddy types, quantities) without seeing any money — no bill amount, no
// paid/partial/unpaid status, and the row-click-for-receipt behavior is
// switched off too (a receipt is exactly the amount they shouldn't see).
// Defaults to false so Staff/Admin (via App.jsx) see the page unchanged.
export default function PartyDetail({ partyId, kind, setPage, onBuyFor, onSellFor, hideAmounts = false }) {
  const { t } = useLanguage();
  const isSupplier = kind === "suppliers";
  const [party, setParty] = useState(null);
  const [rows, setRows] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingTx, setViewingTx] = useState(null);

  useEffect(() => {
    const partyType = isSupplier ? "supplier" : "buyer";
    const txType = isSupplier ? "BUY" : "SELL";
    const payType = isSupplier ? "pay_supplier" : "receive_customer";
    setLoading(true);
    Promise.all([
      api.getParties({ type: partyType }),
      api.getTransactions({ type: txType }),
      api.getPayments({ type: payType }).catch(() => []),
    ]).then(([parties, txs, pays]) => {
      setParty(parties.find((p) => p.id === partyId) || null);
      setRows(txs.filter((t) => t.party_id === partyId));
      setPayments(pays);
      setLoading(false);
    });
  }, [partyId, kind]);

  const paidDateByTx = useMemo(() => {
    const map = {};
    payments.forEach((p) => {
      if (!p.transaction_id) return;
      if (!map[p.transaction_id] || p.pay_date > map[p.transaction_id]) map[p.transaction_id] = p.pay_date;
    });
    return map;
  }, [payments]);

  const paidMap = useMemo(() => paidStatusMap(rows, payments), [rows, payments]);

  const history = useMemo(() => {
    return rows
      .slice()
      .sort((a, b) => (a.tx_date + (a.tx_time || "") < b.tx_date + (b.tx_time || "") ? 1 : -1))
      .map((r) => {
        const isCancelled = (r.hq_status || "processing") === "cancelled";
        const remaining = paidMap[r.id]?.remaining || 0;
        const paidSoFar = paidMap[r.id]?.paid || 0;
        // A cancelled bill is never "paid"/"partial"/"unpaid" — those
        // labels describe money still owed on a real transaction, and a
        // cancelled one isn't counted in the totals above at all. Without
        // this it silently showed as "Received" like any other row, which
        // is exactly what looked wrong: the summary cards above (correctly)
        // skip cancelled rows, but this table used to show every row with
        // no way to tell which ones were cancelled.
        const status = isCancelled ? "cancelled" : remaining <= 0.01 ? "paid" : paidSoFar > 0 ? "partial" : "unpaid";
        return { ...r, payStatus: status, isCancelled, remaining, paidSoFar, paidDate: paidDateByTx[r.id] || null };
      });
  }, [rows, paidMap, paidDateByTx]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => (r.hq_status || "processing") !== "cancelled");
    const completed = active.filter((r) => (paidMap[r.id]?.remaining || 0) <= 0.01);
    const partial = active.filter((r) => (paidMap[r.id]?.remaining || 0) > 0.01 && (paidMap[r.id]?.paid || 0) > 0);
    const unpaid = active.filter((r) => (paidMap[r.id]?.remaining || 0) > 0.01 && (paidMap[r.id]?.paid || 0) <= 0.01);
    return {
      count: active.length,
      qty: active.reduce((s, r) => s + Number(r.quantity_kg), 0),
      amount: active.reduce((s, r) => s + Number(r.amount), 0),
      paid: active.reduce((s, r) => s + (paidMap[r.id]?.paid || 0), 0),
      remaining: active.reduce((s, r) => s + (paidMap[r.id]?.remaining || 0), 0),
      completedCount: completed.length,
      partialCount: partial.length,
      unpaidCount: unpaid.length,
    };
  }, [rows, paidMap]);

  if (loading) {
    return (
      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <Topbar title={isSupplier ? t("party_farmer") : t("party_buyer")} />
        <main className="flex flex-1 items-center justify-center text-sm text-slate-400">{t("loading_label")}</main>
      </div>
    );
  }

  if (!party) {
    return (
      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <Topbar title={isSupplier ? t("party_farmer") : t("party_buyer")} />
        <main className="flex-1 overflow-y-auto p-6">
          <button onClick={() => setPage(kind)} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
            <ArrowLeft size={15} /> {t("party_back_to", { name: isSupplier ? t("nav_suppliers") : t("nav_buyers") })}
          </button>
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400 shadow-sm">{isSupplier ? t("party_not_found_supplier") : t("party_not_found_buyer")}</div>
        </main>
      </div>
    );
  }

  // Clicking a row shows the same final receipt that printed at Finish
  // Ticket / New Buy-Sell — pulling Bank/Bank Account/QR from this farmer's
  // current profile (rather than only whatever was on file the moment
  // this particular truckload was entered), so it always reflects their
  // latest payment details, and falling back to the transaction's own
  // saved QR photo if this specific bill used a different one.
  if (viewingTx) {
    return (
      <Receipt
        tx={{
          ...viewingTx,
          partyName: party.name,
          partyIdNumber: party.phone || party.id_number || "",
          bank_name: party.bank_name,
          bank_account: party.bank_account,
          bank_qr_url: viewingTx.bank_qr_url || party.bank_qr_url,
        }}
        onDone={() => setViewingTx(null)}
      />
    );
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={party.name} subtitle={isSupplier ? t("party_farmer_profile") : t("party_buyer_profile")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={() => setPage(kind)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
            <ArrowLeft size={15} /> {t("party_back_to", { name: isSupplier ? t("nav_suppliers") : t("nav_buyers") })}
          </button>
          {(isSupplier ? onBuyFor : onSellFor) && (
            <button
              onClick={() => (isSupplier ? onBuyFor(party) : onSellFor(party))}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              <PlusCircle size={14} /> {isSupplier ? t("party_new_buy_for", { name: party.name }) : t("party_new_sell_for", { name: party.name })}
            </button>
          )}
        </div>

        {/* Contact & bank info */}
        <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><Phone size={13} /> {t("col_phone")}</div>
            <p className="text-sm font-medium text-slate-800">{party.phone || "—"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><IdCard size={13} /> {t("id_number")}</div>
            <p className="text-sm font-medium text-slate-800">{party.id_number || "—"}</p>
          </div>
          {isSupplier ? (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><Landmark size={13} /> {t("card_bank")}</div>
                <p className="text-sm font-medium text-slate-800">{party.bank_name || "—"}</p>
                <p className="text-xs text-slate-400">{party.bank_account || "—"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><QrCode size={13} /> {t("col_qr")}</div>
                {party.bank_qr_url ? (
                  <a href={party.bank_qr_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-600 underline decoration-dotted hover:text-brand-700">{t("party_view_qr")}</a>
                ) : (
                  <p className="text-sm text-slate-400">—</p>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:col-span-2">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><Building2 size={13} /> {t("col_company")}</div>
              <p className="text-sm font-medium text-slate-800">{party.company || "—"}</p>
            </div>
          )}
        </div>

        {/* Running totals — Registrar (hideAmounts) gets just the two
            quantity-only tiles below, no paid/partial/unpaid breakdown and
            no money tiles at all. */}
        <div className={`mb-5 grid grid-cols-2 gap-4 ${hideAmounts ? "" : "md:grid-cols-4"}`}>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-400">{t("col_tx_count")}</p>
            <p className="text-xl font-bold text-slate-800">{stats.count}</p>
            {!hideAmounts && <p className="mt-1 text-xs text-slate-400">{t("party_tx_breakdown", { completed: stats.completedCount, partial: stats.partialCount, unpaid: stats.unpaidCount })}</p>}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-400">{isSupplier ? t("card_total_bought") : t("card_total_sold")}</p>
            <p className="text-xl font-bold text-slate-800">{fmt2(stats.qty)} kg</p>
            {!hideAmounts && <p className="mt-1 text-xs text-slate-400">{fmtRiel(stats.amount)}</p>}
          </div>
          {!hideAmounts && (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-400">{isSupplier ? t("col_amount_paid") : t("col_amount_received")}</p>
                <p className="text-xl font-bold text-emerald-600">{fmtRiel(stats.paid)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-400">{isSupplier ? t("col_amount_unpaid") : t("col_amount_not_received")}</p>
                <p className={`text-xl font-bold ${stats.remaining > 0.01 ? "text-rose-500" : "text-slate-400"}`}>{fmtRiel(stats.remaining)}</p>
              </div>
            </>
          )}
        </div>

        {/* Transaction history */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="font-semibold text-slate-700">{t("party_tx_history")}</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">{t("col_date")}</th>
                <th className="px-5 py-3 font-medium">{t("party_bill_no")}</th>
                <th className="px-5 py-3 font-medium">{t("col_station")}</th>
                <th className="px-5 py-3 font-medium">{t("paddy_type_col")}</th>
                <th className="px-5 py-3 font-medium">{t("driver_name")}</th>
                <th className="px-5 py-3 font-medium">{t("col_qty")}</th>
                {!hideAmounts && <th className="px-5 py-3 font-medium">{t("party_amount")}</th>}
                {!hideAmounts && <th className="px-5 py-3 font-medium">{t("col_status")}</th>}
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr
                  key={r.id}
                  onClick={hideAmounts ? undefined : () => setViewingTx(r)}
                  title={hideAmounts ? undefined : t("party_click_receipt")}
                  className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${hideAmounts ? "" : "cursor-pointer"} ${r.isCancelled ? "opacity-50" : ""}`}
                >
                  <td className="px-5 py-3 text-slate-500">{r.tx_date}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{r.code}</td>
                  <td className="px-5 py-3 text-slate-600">{r.stationName}</td>
                  <td className="px-5 py-3 text-slate-600">{r.productName}</td>
                  <td className="px-5 py-3 text-slate-500">{r.driver_name || "—"}</td>
                  <td className="px-5 py-3 text-slate-700">{fmt2(r.quantity_kg)}</td>
                  {!hideAmounts && <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(r.amount)}</td>}
                  {!hideAmounts && (
                    <td className={`px-5 py-3 font-medium ${r.payStatus === "cancelled" ? "text-slate-400 line-through" : r.payStatus === "paid" ? "text-emerald-600" : r.payStatus === "partial" ? "text-amber-600" : "text-rose-500"}`}>
                      {r.payStatus === "cancelled" ? t("hq_cancelled") : r.payStatus === "paid" ? (isSupplier ? t("paid") : t("card_received")) : r.payStatus === "partial" ? t("party_partial") : (isSupplier ? t("card_unpaid") : t("card_not_received"))}
                      {r.payStatus === "cancelled" && <div className="text-xs font-normal text-slate-400 no-underline">{t("party_not_counted")}</div>}
                      {r.payStatus === "partial" && <div className="text-xs font-normal text-slate-400">{t("party_of_amount", { paid: fmtRiel(r.paidSoFar), total: fmtRiel(r.amount) })}</div>}
                      {r.payStatus !== "unpaid" && r.payStatus !== "cancelled" && r.paidDate && <div className="text-xs font-normal text-slate-400">{r.paidDate}</div>}
                    </td>
                  )}
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={hideAmounts ? 6 : 8} className="px-5 py-10 text-center text-sm text-slate-400">{t("party_no_tx", { name: party.name })}</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
