import { useState } from "react";
import { useLiveWeight } from "./LiveWeightBox.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

// Testing period is over (PONG RO's scale is live and confirmed working)
// — staff can no longer type a weight in by hand at all. Only Admin/Owner
// logins still get the small "Enter manually" emergency override below,
// for the rare case a scale itself goes down. If another station starts
// up before its own scale is wired in, flip this back to true so staff
// there aren't blocked in the meantime.
const TESTING_ALLOW_STAFF_MANUAL_ENTRY = false;

// A weight field that, once TESTING_ALLOW_STAFF_MANUAL_ENTRY is switched
// back off, staff can only ever fill by pressing "Capture" while the scale
// is live — there is no box to type a number into, so there is nothing for
// them to fake. This is the anti-fraud rule Baitang asked for: staff can
// never type a weight.
//
// Admin/Owner logins always get a small, opt-in "Enter manually" link
// underneath — an emergency-only override for the rare case the scale
// itself is down and a truck still needs to be processed.
export default function WeightField({ locationId, label, labelKm, scaleLabel, scaleLabelKm, value, onChange, isAdmin }) {
  const { connected, weightKg } = useLiveWeight(locationId);
  const [manualMode, setManualMode] = useState(false);

  const canEnterManually = isAdmin || TESTING_ALLOW_STAFF_MANUAL_ENTRY;
  const hasValue = value !== "" && value !== null && value !== undefined;
  const showManualInput = canEnterManually && manualMode;

  return (
    <div>
      <div className={`mb-2 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${connected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
          <div>
            <p className={`text-xs font-medium ${connected ? "text-emerald-700" : "text-slate-400"}`}>
              {connected ? (scaleLabel || "Live Scale Weight") : "Scale not connected"}
              <span className="font-khmer block font-normal">{connected ? (scaleLabelKm || "ទម្ងន់ជញ្ជីងផ្ទាល់") : "ជញ្ជីងមិនទាន់ភ្ជាប់"}</span>
            </p>
            <p className={`text-lg font-bold ${connected ? "text-emerald-800" : "text-slate-300"}`}>{connected ? `${fmt2(weightKg)} kg` : "— kg"}</p>
          </div>
        </div>
        {connected && (
          <button type="button" onClick={() => onChange(String(weightKg))}
            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
            Capture This Weight
            <span className="font-khmer block font-normal">ចាប់យកទម្ងន់នេះ</span>
          </button>
        )}
      </div>

      <label className="mb-1 block text-xs text-slate-500">
        {label}
        {labelKm && <span className="font-khmer block text-brand-600">{labelKm}</span>}
      </label>

      {showManualInput ? (
        <input
          type="number" min="0" step="0.01" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="w-full rounded-lg border border-gold-300 bg-gold-50 px-3 py-2 text-sm outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-100"
        />
      ) : (
        <div className={`flex min-h-[38px] w-full items-center rounded-lg border px-3 py-2 text-sm ${hasValue ? "border-slate-200 bg-white font-medium text-slate-700" : "border-dashed border-slate-300 bg-slate-50 text-slate-400"}`}>
          {hasValue ? `${fmt2(parseFloat(value))} kg` : (
            <span>Not captured yet — press "Capture This Weight" above<span className="font-khmer block">មិនទាន់ចាប់យកនៅឡើយ — សូមចុច "ចាប់យកទម្ងន់នេះ" ខាងលើ</span></span>
          )}
        </div>
      )}

      {canEnterManually && (
        <button
          type="button"
          onClick={() => setManualMode((m) => !m)}
          className="mt-1 text-[11px] text-slate-400 underline decoration-dotted hover:text-slate-600"
        >
          {manualMode
            ? "Switch back to scale capture"
            : isAdmin
              ? "Enter manually (admin override — use only if the scale is down)"
              : "Enter manually (no scale connected at this station yet)"}
        </button>
      )}
    </div>
  );
}
