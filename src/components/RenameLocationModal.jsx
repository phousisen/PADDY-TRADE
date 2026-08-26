import { useState } from "react";
import { X } from "lucide-react";
import { api } from "../api.js";

export default function RenameLocationModal({ location, onClose, onSaved }) {
  const [name, setName] = useState(location.name);
  const [nameKh, setNameKh] = useState(location.name_kh || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setError("Name can't be empty."); return; }
    setSaving(true);
    try {
      const updated = await api.updateLocation(location.id, { name: name.trim(), nameKh: nameKh.trim() });
      onSaved(updated);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">Rename Location<span className="font-khmer block text-xs font-normal">ប្តូរឈ្មោះទីតាំង</span></h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <label className="mb-1 block text-xs text-slate-500">Name (English)<span className="font-khmer block">ឈ្មោះ (ភាសាអង់គ្លេស)</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

          <label className="mb-1 block text-xs text-slate-500">Name (Khmer)<span className="font-khmer block">ឈ្មោះ (ភាសាខ្មែរ)</span></label>
          <input value={nameKh} onChange={(e) => setNameKh(e.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

          {error && <p className="mb-3 text-sm text-rose-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel<span className="font-khmer block text-xs">បោះបង់</span></button>
            <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? "Saving..." : (<>Save<span className="font-khmer block text-xs font-normal">រក្សាទុក</span></>)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
