import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";

// Renaming a station.
//
// [2026-09-17] SISEN: "for the rename part. make sure only the boss can
// rename the location because this is a serious work that needs a proper
// confirmation".
//
// WHY THIS IS NOT AN ORDINARY EDIT
//
// A station's name is not a label on one screen. It is printed on every
// paper ticket the weighbridge hands a farmer, it heads every report, it is
// how the Daily Book, the stock ledger and the expense sheets are read, and
// it is the word people at five sites say to each other on the phone. Change
// it and yesterday's paper and today's screen no longer agree.
//
// Two things guard it now. Who — the button only exists for the Owner
// account (LocationDetail.jsx). And intent — this form will not save until
// the CURRENT name is typed out. That is deliberately not a tick box: a tick
// can be clicked past without reading, and typing "JOMNOUM" cannot be done
// by accident or by somebody who does not know which station they are on.
export default function RenameLocationModal({ location, onClose, onSaved }) {
  const { t } = useLanguage();
  const [name, setName] = useState(location.name);
  const [nameKh, setNameKh] = useState(location.name_kh || "");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Case and stray spaces forgiven — the point is that they knew the name,
  // not that they can match capitals.
  const tidy = (v) => String(v || "").trim().toLowerCase();
  const confirmed = tidy(confirm) === tidy(location.name);
  const changed = name.trim() !== location.name || nameKh.trim() !== (location.name_kh || "");

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setError(t("ren_need_name")); return; }
    if (!confirmed) { setError(t("ren_need_confirm", { name: location.name })); return; }
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateLocation(location.id, { name: name.trim(), nameKh: nameKh.trim() });
      onSaved(updated);
    } catch (err) {
      setError(err.message || String(err));
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">{t("ren_title")}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {/* Said before the fields, not after — a warning under a form is read
            once the decision has already been made. */}
        <div className="mb-4 flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle size={15} className="mt-px shrink-0 text-amber-600" />
          <p className="text-[12px] leading-relaxed text-amber-900">{t("ren_warning")}</p>
        </div>

        <form onSubmit={submit}>
          <label className="mb-1 block text-xs text-slate-500">{t("ren_name_en")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${field} mb-3`} />

          <label className="mb-1 block text-xs text-slate-500">{t("ren_name_km")}</label>
          <input value={nameKh} onChange={(e) => setNameKh(e.target.value)} className={`${field} mb-4`} />

          {/* Only asked once something would actually change. Making someone
              prove intent for a form they are about to close is noise. */}
          {changed && (
            <>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                {t("ren_type_current")}
              </label>
              <p className="mb-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-[13px] font-bold tracking-wide text-slate-700">
                {location.name}
              </p>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder={location.name}
                className={`${field} mb-4 ${confirmed ? "!border-brand-400 bg-brand-50/40" : ""}`}
              />
            </>
          )}

          {error && <p className="mb-3 text-sm text-rose-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
              {t("ex_cancel")}
            </button>
            <button type="submit" disabled={saving || !changed || !confirmed}
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">
              {saving ? t("ren_saving") : t("ren_save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
