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
  const [savingGroup, setSavingGroup] = useState(null);
  const [savedGroup, setSavedGroup] = useState(null);

  async function load() {
    const data = await api.getSettings();
    setValues(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function setField(key, val) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  async function saveGroup(group) {
    setSavingGroup(group.key);
    const entries = {};
    group.fields.forEach((f) => { entries[f.key] = values[f.key] || ""; });
    try {
      await api.updateSettings(entries);
      setSavedGroup(group.key);
      setTimeout(() => setSavedGroup(null), 2000);
    } catch (err) {
      alert(err.message || String(err));
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
        ) : (
          <div className="grid max-w-5xl grid-cols-2 gap-5">
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
