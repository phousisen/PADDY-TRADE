import { useRef, useState } from "react";
import { useLiveWeight } from "./LiveWeightBox.jsx";
import { recordCapture } from "../scaleWatch.js";
import { OVERRIDABLE } from "../scaleGuard.js";
import { useAuth } from "../AuthContext.jsx";
import { useLanguage } from "../i18n.jsx";
import { supabase } from "../supabaseClient.js";
import { api } from "../api.js";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

// Testing period is over (PONG RO's scale is live and confirmed working)
// — staff can no longer type a weight in by hand at all. Only Admin/Owner
// logins still get the small "Enter manually" emergency override below,
// for the rare case a scale itself goes down. If another station starts
// up before its own scale is wired in, flip this back to true so staff
// there aren't blocked in the meantime.
const TESTING_ALLOW_STAFF_MANUAL_ENTRY = false;

// Reasons shorter than this are not reasons.
const OVERRIDE_MIN_REASON = 15;

// A weight field that staff can only ever fill by pressing "Capture" while
// the scale is live — there is no box to type a number into, so there is
// nothing for them to fake. This is the anti-fraud rule Baitang asked for:
// staff can never type a weight.
//
// Admin/Owner logins always get a small, opt-in "Enter manually" link
// underneath — an emergency-only override for the rare case the scale
// itself is down and a truck still needs to be processed.
//
// [2026-09-21] SCALE GUARD (scaleGuard.js). Capture now also has to pass the
// scale's own sanity checks: not below zero, not left below zero since, the
// platform back to 0 since this PC's last capture, and the weight holding
// steady for 3 seconds. While the scale is below zero, or has not been reset
// since, "Enter manually" is hidden too — a wrong scale must be fixed, not
// typed around. The Owner can allow ONE capture past the two "not back to 0"
// blocks, with a reason and their password; that capture is written to the
// Activity Log with the weight, the reason and the name.
export default function WeightField({ locationId, label, labelKm, scaleLabel, scaleLabelKm, value, onChange, isAdmin, large }) {
  const { t } = useLanguage();
  const { session, profile, isViewOnly } = useAuth();
  const byRef = useRef(`wf_${Math.random().toString(36).slice(2)}`);
  const { connected, weightKg, status, stable } = useLiveWeight(locationId, { by: byRef.current });
  const [manualMode, setManualMode] = useState(false);
  const [override, setOverride] = useState(null); // { reason } once the Owner allowed one capture
  const [askOverride, setAskOverride] = useState(false);

  // With an Owner override in hand, only the "not back to 0" blocks are lifted
  // — the weight must still be above zero and steady.
  const effective = override && OVERRIDABLE.has(status) ? (stable ? "ok" : "moving") : status;
  const zeroBlocked = connected && (effective === "below" || effective === "notZeroed" || effective === "notCleared");
  const canCapture = connected && effective === "ok";

  const canEnterManually = (isAdmin || TESTING_ALLOW_STAFF_MANUAL_ENTRY) && !zeroBlocked;
  const hasValue = value !== "" && value !== null && value !== undefined;
  const showManualInput = canEnterManually && manualMode;
  const isOwner = !!profile?.isOwner && !isViewOnly;

  function capture() {
    if (!canCapture) return;
    const w = Number(weightKg);
    onChange(String(weightKg));
    recordCapture(locationId, { by: byRef.current, weightKg: w });
    if (override) {
      api.logAudit({
        action: "scale_capture_override",
        tableName: "locations",
        recordId: locationId,
        oldData: { status },
        newData: { weightKg: w, reason: override.reason },
        userId: session?.user?.id,
      });
      setOverride(null); // one capture, not a standing permission
    }
  }

  const tone = !connected ? "off" : effective === "below" || effective === "notZeroed" ? "bad"
    : effective === "notCleared" || effective === "moving" ? "warn" : effective === "empty" ? "idle" : "ok";
  const boxCls = {
    off: "border-slate-200 bg-slate-50", idle: "border-emerald-200 bg-emerald-50", ok: "border-emerald-200 bg-emerald-50",
    warn: "border-amber-200 bg-amber-50", bad: "border-rose-200 bg-rose-50",
  }[tone];
  const textCls = { off: "text-slate-400", idle: "text-emerald-700", ok: "text-emerald-700", warn: "text-amber-800", bad: "text-rose-700" }[tone];
  const numCls = { off: "text-slate-300", idle: "text-emerald-800", ok: "text-emerald-800", warn: "text-amber-900", bad: "text-rose-700" }[tone];
  const dotCls = { off: "bg-slate-300", idle: "bg-emerald-500 animate-pulse", ok: "bg-emerald-500 animate-pulse", warn: "bg-amber-500 animate-pulse", bad: "bg-rose-600" }[tone];

  // The heading of the box: the caller's label in the normal states, the
  // problem itself when there is one.
  const heading = !connected ? null
    : effective === "below" ? "sg_below_title"
    : effective === "notZeroed" ? "sg_notzeroed_title"
    : effective === "notCleared" ? "sg_notcleared_title"
    : null;

  // What sits where the Capture button would be.
  const lockKey = effective === "below" ? "sg_below_lock"
    : effective === "notZeroed" ? "sg_below_lock"
    : effective === "notCleared" ? "sg_wait_zero"
    : effective === "moving" ? "sg_moving_btn"
    : effective === "empty" ? "sg_empty"
    : null;

  return (
    <div>
      <div className={`mb-2 flex items-center justify-between gap-3 rounded-lg border ${large ? "px-5 py-4" : "px-4 py-3"} ${boxCls}`}>
        <div className="flex items-center gap-2.5">
          <span className={`${large ? "h-2.5 w-2.5" : "h-2 w-2"} shrink-0 rounded-full ${dotCls}`} />
          <div>
            <p className={`${large ? "text-sm" : "text-xs"} font-medium ${textCls}`}>
              {heading ? t(heading) : connected ? (scaleLabel || "Live Scale Weight") : "Scale not connected"}
              {!heading && <span className="font-khmer block font-normal">{connected ? (scaleLabelKm || "ទម្ងន់ជញ្ជីងផ្ទាល់") : "ជញ្ជីងមិនទាន់ភ្ជាប់"}</span>}
            </p>
            <p className={`${large ? "text-2xl" : "text-lg"} font-bold tabular-nums ${numCls}`}>{connected ? `${Number(weightKg) < 0 ? "−" : ""}${fmt2(Math.abs(Number(weightKg)))} kg` : "— kg"}</p>
          </div>
        </div>
        {connected && canCapture && (
          <button type="button" onClick={capture}
            className={`shrink-0 rounded-lg border border-emerald-300 bg-white font-medium text-emerald-700 hover:bg-emerald-100 ${large ? "px-3.5 py-2 text-sm" : "px-3 py-1.5 text-xs"}`}>
            Capture This Weight
            <span className="font-khmer block font-normal">ចាប់យកទម្ងន់នេះ</span>
          </button>
        )}
        {connected && !canCapture && lockKey && (
          <span className={`max-w-[12rem] shrink-0 rounded-lg border border-dashed bg-white px-3 py-2 text-center text-[11.5px] font-semibold leading-snug ${tone === "bad" ? "border-rose-200 text-rose-700" : tone === "warn" ? "border-amber-200 text-amber-800" : "border-emerald-200 text-emerald-700"}`}>
            {t(lockKey)}
          </span>
        )}
      </div>

      {connected && (effective === "below" || effective === "notZeroed") && (
        <div className="mb-2 rounded-lg border border-rose-200 bg-white px-4 py-3 text-[12.5px] leading-relaxed text-slate-700">
          <p className="font-semibold text-rose-700">{t(effective === "below" ? "sg_fix_title" : "sg_notzeroed_body")}</p>
          <ol className="mt-1 list-decimal pl-5">
            <li>{t("sg_fix_1")}</li>
            <li>{t("sg_fix_2")}</li>
            <li>{t("sg_fix_3")}</li>
          </ol>
        </div>
      )}
      {connected && effective === "notCleared" && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-[12.5px] leading-relaxed text-amber-900">{t("sg_notcleared_body")}</p>
      )}
      {connected && effective === "moving" && (
        <p className="mb-2 text-[12px] text-amber-800">{t("sg_moving")}</p>
      )}
      {connected && isOwner && OVERRIDABLE.has(status) && !override && (
        <button type="button" onClick={() => setAskOverride(true)}
          className="mb-2 text-[12px] font-semibold text-slate-600 underline decoration-dotted hover:text-slate-900">
          {t("sg_override_btn")}
        </button>
      )}
      {override && OVERRIDABLE.has(status) && (
        <p className="mb-2 text-[12px] font-semibold text-amber-800">{t("sg_ov_allowed")}</p>
      )}

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

      {askOverride && (
        <OverrideModal
          t={t}
          email={session?.user?.email}
          weightKg={weightKg}
          onCancel={() => setAskOverride(false)}
          onAllowed={(reason) => { setOverride({ reason }); setAskOverride(false); }}
        />
      )}
    </div>
  );
}

function OverrideModal({ t, email, weightKg, onCancel, onAllowed }) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const short = Math.max(0, OVERRIDE_MIN_REASON - reason.trim().length);
  const ok = short === 0 && password.length > 0 && !busy;

  async function go() {
    if (!ok) return;
    setBusy(true); setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError(t("sg_ov_bad_password")); setBusy(false); return; }
      onAllowed(reason.trim());
    } catch (err) {
      setError(err?.message || t("sg_ov_bad_password"));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">{t("sg_ov_title")}</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{t("sg_ov_body", { kg: fmt2(weightKg) })}</p>
        <label className="mt-4 block text-xs font-medium text-slate-600">{t("sg_ov_reason")}</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          placeholder={t("sg_ov_reason_ph")}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
        {short > 0 && <p className="mt-1 text-[11.5px] text-slate-400">{t("sg_ov_more", { n: short })}</p>}
        <label className="mt-3 block text-xs font-medium text-slate-600">{t("sg_ov_password")}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
        {error && <p className="mt-2 text-[12.5px] text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">{t("sg_ov_cancel")}</button>
          <button type="button" onClick={go} disabled={!ok}
            className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40">{busy ? "…" : t("sg_ov_confirm")}</button>
        </div>
      </div>
    </div>
  );
}
