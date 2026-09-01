import { useState } from "react";
import { Scale, RotateCcw } from "lucide-react";
import WeightField from "./WeightField.jsx";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }

// [2026-08-31] Pulled out of StockInventory.jsx (unchanged behavior) so
// LocationDetail.jsx can reuse the exact same modal instead of duplicating
// ~110 lines of it — same component, two callers now.
export const ADJUSTMENT_REASONS = [
  { value: "reset", label: "Daily reset — remaining treated as lost" },
  { value: "moisture", label: "Moisture loss (dried out)" },
  { value: "spillage", label: "Spillage / handling loss" },
  { value: "recount", label: "Recount correction" },
  { value: "other", label: "Other" },
];

// Recording what's actually on the scale right now for a location, when
// it no longer matches the running total the system has been keeping.
// This is the one place in the app that intentionally SETS stock to an
// exact number instead of nudging it by a transaction's own weight — see
// api.recordStockAdjustment. Deliberately online-only (same as renaming a
// location or editing a role) rather than offline-first like the
// Weighing Tickets board: this is a periodic reconciliation step done at
// a normal moment, not something that has to survive a truck arriving
// mid-storm with no signal.
// `todayAvgBuyPrice`: that station's weighted-average Buy price for today
// (total riel paid ÷ total kg bought today — same two numbers already on
// the Dashboard's "Total Buy (Today)" card), or null when nothing's been
// bought there yet today. Only ever used to prefill the price field below,
// which stays editable either way.
// `isAdmin`: passed straight through to WeightField below — same
// anti-fraud rule as every other weight capture in the app (Weighing
// Tickets, TransactionForm): staff can't type a weight in at all, only
// press "Capture This Weight" while the scale is live. Admin/Owner logins
// still get a small emergency "Enter manually" override if the scale
// itself is down.
export function AdjustStockModal({ station, todayAvgBuyPrice, t, isAdmin, onClose, onSubmit }) {
  const previous = Number(station.current_stock_kg) || 0;
  // [2026-09-01] Starts blank, not prefilled with the old stock number —
  // this has to be a fresh reading someone actually captured off the
  // scale, not a number that happens to already be sitting in the box.
  // "Reset to 0" below still sets it directly, since there's nothing to
  // weigh in that case.
  const [newStockKg, setNewStockKg] = useState("");
  // Defaults to "moisture" — this is the overnight-drying case (paddy left
  // in stock overnight loses weight before it's re-weighed the next
  // morning), still fully editable to "reset" (nothing physically left —
  // the "Reset to 0" shortcut below picks this automatically), "spillage",
  // "recount", or "other".
  const [reason, setReason] = useState("moisture");
  const [note, setNote] = useState("");
  // Blank by default (per the standing decision: never guess a price when
  // there's nothing to base it on) — prefilled only when this station
  // actually had a Buy today, still editable regardless.
  const [priceInput, setPriceInput] = useState(todayAvgBuyPrice != null ? String(Math.round(todayAvgBuyPrice)) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const next = parseFloat(newStockKg);
  const hasValidNext = newStockKg.trim() !== "" && Number.isFinite(next) && next >= 0;
  const delta = hasValidNext ? next - previous : 0;
  const isLoss = hasValidNext && delta < -0.005;
  const price = parseFloat(priceInput);
  const hasPrice = priceInput.trim() !== "" && Number.isFinite(price) && price >= 0;
  const valueLost = isLoss && hasPrice ? Math.abs(delta) * price : null;
  const canSubmit = !saving && hasValidNext;

  // One tap for the daily habit this was built for: today's leftover stock
  // becomes 0, reason defaults to the dedicated "reset" option, and the
  // price field keeps whatever it already had (today's average, if any).
  function useResetToZero() {
    setNewStockKg("0");
    setReason("reset");
  }

  async function submit() {
    setError("");
    setSaving(true);
    try {
      await onSubmit({ newStockKg: next, reason, note: note.trim() || null, pricePerKg: isLoss && hasPrice ? price : null });
    } catch (err) {
      // Same reasoning as every other save-with-a-modal in this app: if it
      // fails (dropped connection, permissions gap), say so instead of
      // leaving the button stuck on "Saving..." with no explanation.
      setError(err.message || "Couldn't save this adjustment — check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><Scale size={16} className="text-brand-600" /> Adjust Stock — {station.name}</h3>
        <p className="mb-4 text-xs text-slate-400">Use this when what's actually on the scale doesn't match what the system shows — paddy naturally loses some weight over time from moisture drying out, spillage, or handling.</p>

        <div className="mb-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
          <div><span className="text-slate-500">System currently shows</span> <span className="font-medium text-slate-700">{fmt2(previous)} kg</span></div>
          {previous > 0 && (
            <button type="button" onClick={useResetToZero} className="flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">
              <RotateCcw size={11} /> Reset to 0
            </button>
          )}
        </div>

        <div className="mb-3">
          <WeightField
            locationId={station.id}
            label="Actual weighed amount now (kg)"
            scaleLabel="Live Scale Weight"
            value={newStockKg}
            onChange={setNewStockKg}
            isAdmin={isAdmin}
          />
        </div>

        {hasValidNext && (
          <div className={`mb-3 rounded-lg px-3 py-2.5 text-sm ${delta < -0.005 ? "bg-rose-50 text-rose-700" : delta > 0.005 ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500"}`}>
            {Math.abs(delta) < 0.005 ? "No change from what the system already shows." : `${delta < 0 ? "Loss" : "Gain"} of ${fmt2(Math.abs(delta))} kg will be recorded.`}
          </div>
        )}

        {isLoss && (
          <>
            <label className="mb-1 block text-xs text-slate-500">Price per kg (Riel) — for valuing this loss</label>
            <input type="number" min="0" step="1" value={priceInput} onChange={(e) => setPriceInput(e.target.value)}
              placeholder={todayAvgBuyPrice == null ? "No Buy today yet — type in a price" : ""}
              className="mb-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            <p className="mb-3 text-[11px] text-slate-400">
              {todayAvgBuyPrice != null
                ? "Auto-filled from today's average Buy price at this station — editable."
                : "Nothing bought here yet today to average — type a price in, or leave blank to skip valuing this loss."}
            </p>
            {valueLost != null && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm">
                <span className="font-medium text-amber-700">Estimated Value Lost</span>
                <span className="font-bold text-amber-700">{fmtRiel(valueLost)}</span>
              </div>
            )}
          </>
        )}

        <label className="mb-1 block text-xs text-slate-500">Reason</label>
        <select value={reason} onChange={(e) => setReason(e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
          {ADJUSTMENT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>

        <label className="mb-1 block text-xs text-slate-500">Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any extra detail worth recording"
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

        {error && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40">{t("cancel")}</button>
          <button disabled={!canSubmit} onClick={submit} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">
            {saving ? "Saving…" : "Record Adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}
