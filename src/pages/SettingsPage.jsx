import { useEffect, useState } from "react";
import { Building2, ReceiptText, Wheat, FileText, Check } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";

const FIELD_GROUPS = [
  {
    key: "company",
    title: "Company Profile",
    subtitle: "Shown on printed receipts",
    icon: Building2,
    fields: [
      { key: "company_name", label: "Company Name", placeholder: "PaddyTrade" },
      { key: "company_name_kh", label: "Company Name (Khmer)", placeholder: "" },
      { key: "company_address", label: "Address", placeholder: "Battambang, Cambodia" },
      { key: "company_phone", label: "Phone", placeholder: "+855 XX XXX XXX" },
      { key: "company_tax_id", label: "Tax ID / VAT Registration No.", placeholder: "" },
    ],
  },
  {
    key: "tax",
    title: "Tax Defaults",
    subtitle: "Pre-fills the VAT rate on new transactions — still editable per transaction",
    icon: ReceiptText,
    fields: [
      { key: "default_vat_rate", label: "Default VAT Rate (%)", placeholder: "10", type: "number" },
    ],
  },
  {
    key: "grading",
    title: "Grade Pricing",
    subtitle: "Auto-fills the price per kg when a Buy transaction's quality grade is A, B, or C",
    icon: Wheat,
    fields: [
      { key: "price_grade_a_per_kg", label: "Grade A — Price per kg (៛)", placeholder: "1200", type: "number" },
      { key: "price_grade_b_per_kg", label: "Grade B — Price per kg (៛)", placeholder: "1100", type: "number" },
      { key: "price_grade_c_per_kg", label: "Grade C — Price per kg (៛)", placeholder: "950", type: "number" },
    ],
  },
  {
    key: "receipt",
    title: "Receipt Footer",
    subtitle: "A short note printed at the bottom of every receipt",
    icon: FileText,
    fields: [
      { key: "receipt_footer_note", label: "Footer Note", placeholder: "Thank you for your business.", type: "textarea" },
    ],
  },
];

export default function SettingsPage() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingGroup, setSavingGroup] = useState(null);
  const [savedGroup, setSavedGroup] = useState(null);
  const [groupErrors, setGroupErrors] = useState({});

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api.getSettings();
      setValues(data);
    } catch (err) {
      // Without this, a failed/dropped request left this page stuck on
      // "Loading…" forever with no way to tell what went wrong or retry.
      setLoadError(err.message || "Couldn't load settings — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function setField(key, val) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  async function saveGroup(group) {
    setSavingGroup(group.key);
    setGroupErrors((prev) => ({ ...prev, [group.key]: "" }));
    const entries = {};
    group.fields.forEach((f) => { entries[f.key] = values[f.key] || ""; });
    try {
      await api.updateSettings(entries);
      setSavedGroup(group.key);
      setTimeout(() => setSavedGroup(null), 2000);
    } catch (err) {
      setGroupErrors((prev) => ({ ...prev, [group.key]: err.message || "Couldn't save — check your connection and try again." }));
    } finally {
      setSavingGroup(null);
    }
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Settings" subtitle="Company-wide configuration" />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : loadError ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        ) : (
          <div className="grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-2">
            {FIELD_GROUPS.map((group) => (
              <div key={group.key} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-1 flex items-center gap-2">
                  <group.icon size={17} className="text-brand-600" />
                  <h3 className="font-semibold text-slate-700">{group.title}</h3>
                </div>
                <p className="mb-4 text-xs text-slate-400">{group.subtitle}</p>

                <div className="space-y-3">
                  {group.fields.map((f) => (
                    <div key={f.key}>
                      <label className="mb-1 block text-xs text-slate-500">{f.label}</label>
                      {f.type === "textarea" ? (
                        <textarea
                          value={values[f.key] || ""} onChange={(e) => setField(f.key, e.target.value)} placeholder={f.placeholder} rows={2}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                        />
                      ) : (
                        <input
                          type={f.type || "text"} value={values[f.key] || ""} onChange={(e) => setField(f.key, e.target.value)} placeholder={f.placeholder}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                        />
                      )}
                    </div>
                  ))}
                </div>

                {groupErrors[group.key] && <p className="mt-3 text-xs text-rose-500">{groupErrors[group.key]}</p>}
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => saveGroup(group)}
                    disabled={savingGroup === group.key}
                    className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {savedGroup === group.key ? (<><Check size={14} /> Saved</>) : savingGroup === group.key ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
