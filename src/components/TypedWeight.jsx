import { useRef } from "react";
import { Scale } from "lucide-react";
import { useLiveWeight } from "./LiveWeightBox.jsx";
import { recordCapture } from "../scaleWatch.js";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(Number(n) || 0)); }

// [2026-09-22] A WEIGHT THAT IS TYPED, with the scale as a shortcut.
//
// SISEN, on the manual Buy/Sell form: "i notice, this part are mainly KG
// typed down not usually with the scale anymore."
//
// He is right about what this screen is for. The weighbridge itself has its
// own screen (Tickets), where a weight can only come off the scale and staff
// cannot type one — that rule is untouched and is what stops a station
// inventing a load. THIS form is the office copying a paper ticket into the
// system, often days later and never beside the scale, so the box has to be
// a box. Two thirds of the screen used to be taken up by "Scale not
// connected" on a PC that has no scale and never will.
//
// So: a plain kg box. If a scale IS live at the chosen station and its
// reading passes the scale guard, one small button appears that fills the
// box with it — and that capture is recorded exactly as it is on the
// weighbridge screen, so the guard still knows this truck was captured.
// `source` — "typed" | "scale" | null — is shown under the box so a ticket
// copied from paper can never be mistaken for one weighed here. SISEN:
// "how about we also mark it in the transaction on its ticket to note that
// we isnt the original weigh in, but its a typed down".
export default function TypedWeight({ locationId, label, labelKm, hint, value, onChange, source }) {
  const byRef = useRef(`tw_${Math.random().toString(36).slice(2)}`);
  const { connected, weightKg, status } = useLiveWeight(locationId, { by: byRef.current });
  const canUseScale = connected && status === "ok" && Number(weightKg) > 0;

  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium text-slate-500">
        {label}
        {labelKm && <span className="font-khmer block text-[12px] text-brand-600">{labelKm}</span>}
      </label>
      <div className="relative">
        <input
          type="number" min="0" step="0.01" inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value, "typed")}
          placeholder="0"
          className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-4 pr-12 text-right text-[22px] font-bold tabular-nums text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-slate-400">kg</span>
      </div>
      {/* Only a TYPED weight is marked. One taken off the scale says nothing,
          because that is the normal way — see Transactions.jsx. */}
      {source === "typed" && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11.5px] font-semibold text-amber-700">✎ Typed</p>
      )}
      {canUseScale ? (
        <button
          type="button"
          onClick={() => { onChange(String(weightKg), "scale"); recordCapture(locationId, { by: byRef.current, weightKg: Number(weightKg) }); }}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-brand-100 bg-brand-50 px-2.5 py-1.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-100"
        >
          <Scale size={13} /> Use the scale · {fmt(weightKg)} kg
        </button>
      ) : (
        hint && <p className="mt-1.5 text-[11.5px] text-slate-400">{hint}</p>
      )}
    </div>
  );
}
