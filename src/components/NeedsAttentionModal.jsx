import { useEffect, useState } from "react";
import { X, AlertTriangle, RefreshCw, Undo2, Trash2, Clock } from "lucide-react";
import {
  getNeedsAttentionTransactions, discardStuckFinalize, discardStuckManualEntry,
  trySync, onSyncStatusChange,
} from "../offlineQueue.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return n == null ? "—" : `${new Intl.NumberFormat("en-US").format(Math.round(n))} ៛`; }
function timeAgo(iso) {
  if (!iso) return "a moment ago";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} day(s) ago`;
}

// [2026-08-30] "Needs Attention" — direct answer to: what happens to a
// finalize/save that goes out to lunch and never confirms? Before this,
// the only place that data existed was inside this device's own
// localStorage, with nothing in the app actually showing it to anyone —
// so the only way anyone found out was comparing a paper receipt against
// the Transactions List later, and the only way to "fix" it was retyping
// the whole ticket by hand from that paper copy.
//
// Every field shown below comes straight from getCachedTransactions() —
// the exact same object the receipt itself was built from (see
// finalizeTicketOffline/createTransactionOffline in offlineQueue.js) — so
// nothing here is reconstructed or guessed, and nothing needs to be
// retyped to see it again. Reachable from the sync banner in Topbar.jsx,
// which is rendered on every page, so it's never more than one click away
// regardless of which screen someone happens to be on when they notice.
export default function NeedsAttentionModal({ onClose }) {
  const [items, setItems] = useState(() => getNeedsAttentionTransactions());
  const [retrying, setRetrying] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(null); // opId awaiting a second tap

  useEffect(() => {
    // Anything that changes the queue (a successful sync, a new failure, a
    // manual retry) fires the same status event the rest of the app
    // already listens to — refresh this list from it instead of polling.
    const unsub = onSyncStatusChange(() => setItems(getNeedsAttentionTransactions()));
    return unsub;
  }, []);

  async function retryNow() {
    setRetrying(true);
    try { await trySync(); } finally {
      setItems(getNeedsAttentionTransactions());
      setRetrying(false);
    }
  }

  function discard(item) {
    if (item.opType === "finalizeTicket") discardStuckFinalize(item.opId);
    else discardStuckManualEntry(item.opId);
    setConfirmDiscard(null);
    setItems(getNeedsAttentionTransactions());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="no-print flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between rounded-t-xl bg-rose-600 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/20 text-lg">
              <AlertTriangle size={18} />
            </div>
            <div>
              <h3 className="font-bold">Needs Attention</h3>
              <p className="mt-0.5 text-xs opacity-85">
                {items.length === 0 ? "Nothing waiting right now." : `${items.length} not yet confirmed saved to PaddyTrade's shared database.`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="flex-shrink-0 text-white/75 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-2.5">
          <p className="text-xs text-slate-500">Every field below is exactly what was saved — nothing here needs to be typed again.</p>
          <button
            onClick={retryNow}
            disabled={retrying}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <RefreshCw size={12} className={retrying ? "animate-spin" : ""} /> {retrying ? "Retrying…" : "Retry All Now"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-400">
              Nothing on this device is waiting to reach the shared database right now.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const tx = item.tx;
                const isBuy = tx.type === "BUY";
                return (
                  <div
                    key={item.opId}
                    className={`rounded-xl border p-3.5 ${item.isStuck ? "border-rose-200 bg-rose-50/50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${isBuy ? "bg-brand-100 text-brand-700" : "bg-rose-100 text-rose-700"}`}>
                            {isBuy ? "▲ BUY" : "▼ SELL"}
                          </span>
                          <span className="font-bold text-slate-800">{tx.paper_ticket_no || tx.code}</span>
                          {tx.paper_ticket_no && <span className="text-xs text-slate-400">{tx.code}</span>}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock size={11} /> queued {timeAgo(item.queuedAt)}
                          {item.attempts > 0 && ` · tried ${item.attempts} time${item.attempts === 1 ? "" : "s"}`}
                        </div>
                      </div>
                      {item.isStuck ? (
                        <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[10.5px] font-bold text-white">STUCK — needs a decision</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10.5px] font-bold text-amber-700">Waiting to sync</span>
                      )}
                    </div>

                    {item.isStuck && item.lastError && (
                      <div className="mt-2 rounded-lg bg-rose-100 px-2.5 py-1.5 text-[11px] font-medium text-rose-700">
                        Reason from the server: "{item.lastError}"
                      </div>
                    )}

                    {/* Full saved detail — this is the part that means nothing
                        ever has to be retyped from a paper copy. */}
                    <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                      <div><span className="text-slate-400">Party</span><div className="font-semibold text-slate-700">{tx.partyName || "—"}</div></div>
                      <div><span className="text-slate-400">Product</span><div className="font-semibold text-slate-700">{tx.product_name || "—"}</div></div>
                      <div><span className="text-slate-400">Station</span><div className="font-semibold text-slate-700">{tx.stationName || "—"}</div></div>
                      <div><span className="text-slate-400">Net Weight</span><div className="font-semibold text-slate-700">{fmt2(tx.quantity_kg)} kg</div></div>
                      <div><span className="text-slate-400">Price / kg</span><div className="font-semibold text-slate-700">{tx.price_per_kg != null ? fmtRiel(tx.price_per_kg) : "—"}</div></div>
                      <div><span className="text-slate-400">Amount</span><div className="font-semibold text-slate-700">{fmtRiel(tx.total_with_tax ?? tx.amount)}</div></div>
                      <div><span className="text-slate-400">Truck Plate</span><div className="font-semibold text-slate-700">{tx.car_plate || "—"}</div></div>
                      <div><span className="text-slate-400">Date</span><div className="font-semibold text-slate-700">{tx.tx_date || "—"}</div></div>
                      <div><span className="text-slate-400">Recorded By</span><div className="font-semibold text-slate-700">{tx.recorded_by_name || "—"}</div></div>
                    </div>

                    {item.isStuck && (
                      <div className="mt-3 border-t border-rose-200 pt-2.5">
                        {confirmDiscard === item.opId ? (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-medium text-rose-700">
                              {item.opType === "finalizeTicket"
                                ? "Send this ticket back to the Waiting board? All its weigh-in and price data above stays exactly as entered — nothing is lost, and this stuck attempt is cancelled so it won't also go through later."
                                : "Remove this stuck attempt? Copy the details above into a new Buy/Sell entry first if this sale is still real — once removed, this exact attempt is gone for good."}
                            </span>
                            <div className="flex gap-2">
                              <button onClick={() => discard(item)} className="rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-700">Yes, do it</button>
                              <button onClick={() => setConfirmDiscard(null)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-slate-500 hover:bg-slate-50">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDiscard(item.opId)}
                            className="flex items-center gap-1.5 rounded-lg border border-rose-300 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                          >
                            {item.opType === "finalizeTicket" ? <Undo2 size={12} /> : <Trash2 size={12} />}
                            {item.opType === "finalizeTicket" ? "Send back to Waiting board instead" : "Remove this stuck attempt"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
