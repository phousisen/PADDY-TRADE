import { useState } from "react";
import { Pencil, X, Loader2 } from "lucide-react";
import { api } from "../api.js";

// [2026-09-09] The "edited" mark on a transaction whose weight, money or
// business date was changed after it was finished.
//
// Why: a figure someone corrected by hand looked exactly like one that came
// straight off the weighbridge. Corrections are ordinary work — three were
// made in the first week of September alone — but anyone reading a 9,750 kg
// purchase had no way to know whether the scale said that, or whether
// somebody typed it on Tuesday. The permanent record has held the answer
// since 09/09; this puts it where the number is being read.
//
// Deliberate limits:
//   * Never on a printed receipt. A farmer's receipt shows what he was paid;
//     internal correction history is not his business.
//   * Never inside a report total. The badge belongs where someone can act
//     on it, not in a sum.
//   * Not a warning, and nothing is blocked. It marks, it does not accuse.
//
// It also fails quietly. If the history is unreachable, or the view has not
// been created yet, the badge simply does not appear and the list is exactly
// what it is today. A missing badge must never break this screen.

const FIELD_LABELS = {
  gross_kg: "Weigh-in (kg)", tare_kg: "Weigh-out (kg)",
  quantity_kg: "Net weight (kg)", station_quantity_kg: "Station weight (kg)",
  price_per_kg: "Price per kg", amount: "Amount", total_with_tax: "Total with tax",
  deduction_kg: "Deduction (kg)", staff_fee: "Staff fee", tx_date: "Transaction date",
};

// Only the fields the badge is about. Anything else that changed in the same
// save (a note, a plate) is not what someone opening this wants to see.
const SHOWN = Object.keys(FIELD_LABELS);

function fmt(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") return new Intl.NumberFormat("en-US").format(n);
  return String(v);
}

function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

function changedFields(entry) {
  const o = entry.old_data || {}, n = entry.new_data || {};
  return SHOWN
    .filter((k) => JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null))
    .map((k) => ({ key: k, label: FIELD_LABELS[k], from: o[k] ?? null, to: n[k] ?? null }));
}

export default function EditedBadge({ transactionId, editCount }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function show(e) {
    e.stopPropagation();          // the row itself is clickable
    e.preventDefault();
    setOpen(true);
    if (entries || loading) return;
    setLoading(true); setError("");
    try {
      const rows = await api.getRowHistory({ recordId: transactionId, limit: 20 });
      setEntries(rows.filter((r) => r.action === "UPDATE" && changedFields(r).length > 0));
    } catch (err) {
      setError("Couldn't load the history for this transaction.");
    } finally { setLoading(false); }
  }

  return (
    <>
      <button
        onClick={show}
        title="This figure was changed after the ticket was finished — tap to see what"
        className="ml-1.5 inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 align-middle text-[9.5px] font-bold text-amber-700 hover:bg-amber-100"
      >
        <Pencil size={8} /> edited{editCount > 1 ? ` ×${editCount}` : ""}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-slate-700">
                  <Pencil size={14} className="text-amber-500" /> What was changed
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Straight from the permanent record. Nothing here can be edited or deleted.
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="shrink-0 text-slate-300 hover:text-slate-500"><X size={16} /></button>
            </div>

            {loading && (
              <p className="flex items-center gap-2 py-6 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </p>
            )}
            {error && <p className="py-4 text-sm text-rose-600">{error}</p>}

            {!loading && !error && entries?.length === 0 && (
              <p className="py-4 text-sm text-slate-500">
                This was changed before the permanent record began on 9 September 2026, so the
                detail isn't available.
              </p>
            )}

            {!loading && entries?.length > 0 && (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto">
                {entries.map((entry) => {
                  const fields = changedFields(entry);
                  return (
                    <div key={entry.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                      <table className="w-full text-xs">
                        <tbody>
                          {fields.map((f) => (
                            <tr key={f.key} className="border-t border-amber-200/70 first:border-0">
                              <td className="py-1.5 pr-3 text-slate-600">{f.label}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400 line-through">{fmt(f.from)}</td>
                              <td className="py-1.5 text-right font-bold tabular-nums text-slate-800">{fmt(f.to)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-2 text-[11px] text-slate-500">
                        {entry.userName || "—"} · {fmtWhen(entry.changed_at)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
