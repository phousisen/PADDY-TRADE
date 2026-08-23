import { useEffect, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { DEFAULT_RECEIPT_TEMPLATE, mergeReceiptTemplate, ExactWeightTicket } from "./Receipt.jsx";

// Every editable Khmer/English label pair on the ticket, grouped the same
// way the printed sections are grouped, so this reads top-to-bottom the
// same order the fields actually appear on paper. `kh: null` marks a
// single-language field (just the unit "Kg", no Khmer counterpart).
const LABEL_ROWS = [
  { group: "Ticket header", title: "Ticket type — Buy", en: "ticketTypeBuyEn", kh: "ticketTypeBuyKh" },
  { group: "Ticket header", title: "Ticket type — Sell", en: "ticketTypeSellEn", kh: "ticketTypeSellKh" },
  { group: "Info block", title: "Number In", en: "numberInEn", kh: "numberInKh" },
  { group: "Info block", title: "Date", en: "dateEn", kh: "dateKh" },
  { group: "Info block", title: "Product", en: "productEn", kh: "productKh" },
  { group: "Info block", title: "Driver Name", en: "driverNameEn", kh: "driverNameKh" },
  { group: "Info block", title: "Seller", en: "sellerEn", kh: "sellerKh" },
  { group: "Info block", title: "Buyer", en: "buyerEn", kh: "buyerKh" },
  { group: "Weight grid", title: "Item (IN/OUT column)", en: "itemEn", kh: "itemKh" },
  { group: "Weight grid", title: "Truck Number", en: "truckNumberEn", kh: "truckNumberKh" },
  { group: "Weight grid", title: "Date (grid column)", en: "weightDateEn", kh: "weightDateKh" },
  { group: "Weight grid", title: "Time", en: "timeEn", kh: "timeKh" },
  { group: "Weight grid", title: "Weight", en: "weightEn", kh: "weightKh" },
  { group: "Weight grid", title: "\"IN\" row", en: "inEn", kh: "inKh" },
  { group: "Weight grid", title: "\"OUT\" row", en: "outEn", kh: "outKh" },
  { group: "Weight grid", title: "Net Weight", en: "netWEn", kh: "netWKh" },
  { group: "Weight grid", title: "Price", en: "priceEn", kh: "priceKh" },
  { group: "Weight grid", title: "Amount", en: "amountEn", kh: "amountKh" },
  { group: "Weight grid", title: "Weight unit", en: "kgLabel", kh: null },
  { group: "Signatures", title: "Operator", en: "operatorEn", kh: "operatorKh" },
  { group: "Signatures", title: "Driver", en: "driverEn", kh: "driverKh" },
];

// Sample data for the live preview only — never saved, never sent to the
// server. Picked to exercise every field on the ticket at once (a Buy
// ticket, weighed in AND out, with a recorded Buyer name) so an Owner can
// see exactly how every row above actually looks before saving.
const SAMPLE_TX = {
  code: "BT-000123",
  paper_ticket_no: "000515",
  tx_date: "23/08/2026",
  car_plate: "3A-1644",
  driver_name: "Sok Dara",
  partyName: "សែន សុគន្ធ",
  recorded_by_name: "Malis Bopha",
  gross_kg: 20180,
  gross_at: "2026-08-23T03:12:00.000Z",
  tare_kg: 15200,
  tare_at: "2026-08-23T04:05:00.000Z",
  quantity_kg: 4980,
  price_per_kg: 1250,
  amount: 6225000,
};
const SAMPLE_IN_STAMP = { date: "23 Aug 26", time: "10:12 AM" };
const SAMPLE_OUT_STAMP = { date: "23 Aug 26", time: "11:05 AM" };

const inputCls = "w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export default function ReceiptTemplateEditor() {
  const [companySettings, setCompanySettings] = useState({});
  const [tpl, setTpl] = useState(() => mergeReceiptTemplate(null));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api.getSettings();
      setCompanySettings(data);
      let saved = null;
      if (data.receipt_template) {
        try { saved = JSON.parse(data.receipt_template); } catch { saved = null; }
      }
      setTpl(mergeReceiptTemplate(saved));
    } catch (err) {
      setLoadError(err.message || "Couldn't load the receipt template — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function setLabel(key, value) {
    setTpl((prev) => ({ ...prev, labels: { ...prev.labels, [key]: value } }));
  }
  function setStyle(key, value) {
    setTpl((prev) => ({ ...prev, style: { ...prev.style, [key]: value } }));
  }

  function resetToDefaults() {
    setTpl(mergeReceiptTemplate(null));
  }

  async function save() {
    setSaving(true);
    setSaveError("");
    try {
      await api.updateSetting("receipt_template", JSON.stringify(tpl));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err.message || "Couldn't save — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const companyNameKh = companySettings.company_name_kh || "ប៉ៃតង កម្ពុជា";
  const companyAddressKh = companySettings.company_address || "ភូមិព្រៃទទឹង ឃុំរាំងកេសី ស្រុកសង្កែ ខេត្តបាត់ដំបង";
  const companyPhoneLine = companySettings.company_phone ? `Tel: ${companySettings.company_phone}` : "Tel: 012 37 36 396 / 088 96 666 52";

  let lastGroup = null;

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Receipt Template" subtitle="Owner-only — edit every word and the look of the printed weight ticket" />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : loadError ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        ) : (
          <div className="grid max-w-[1400px] grid-cols-[1fr_420px] gap-5">
            {/* ---- Left: the "Excel form" itself — one row per label, an
                English cell and a Khmer cell, editable in place. ---- */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4">
                <h3 className="font-semibold text-slate-700">Every word on the ticket</h3>
                <p className="text-xs text-slate-400">Click any cell and type to change it — exactly like editing a spreadsheet. Changes show in the preview instantly and only take effect on printed tickets after you hit Save.</p>
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                    <th className="w-[26%] border-b border-slate-200 px-4 py-2">Field</th>
                    <th className="w-[37%] border-b border-slate-200 px-3 py-2">English</th>
                    <th className="w-[37%] border-b border-slate-200 px-3 py-2">Khmer</th>
                  </tr>
                </thead>
                <tbody>
                  {LABEL_ROWS.map((row) => {
                    const showGroupHeader = row.group !== lastGroup;
                    lastGroup = row.group;
                    return (
                      <FragmentRow key={row.en} row={row} showGroupHeader={showGroupHeader} tpl={tpl} setLabel={setLabel} />
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ---- Right: style controls + live preview ---- */}
            <div className="flex flex-col gap-5">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-1 font-semibold text-slate-700">Look &amp; feel</h3>
                <p className="mb-3 text-xs text-slate-400">Font size in points, colors, and whether the header sits centered or to the left.</p>
                <div className="space-y-3">
                  <StyleRow label="Header alignment">
                    <select value={tpl.style.headerAlign} onChange={(e) => setStyle("headerAlign", e.target.value)} className={inputCls}>
                      <option value="center">Centered</option>
                      <option value="left">Left-aligned</option>
                    </select>
                  </StyleRow>
                  <StyleRow label="Company name size (pt)">
                    <input type="number" min={12} max={60} value={tpl.style.titleSizePx} onChange={(e) => setStyle("titleSizePx", Number(e.target.value) || DEFAULT_RECEIPT_TEMPLATE.style.titleSizePx)} className={inputCls} />
                  </StyleRow>
                  <StyleRow label="Company name / address / phone color">
                    <ColorInput value={tpl.style.titleColor} onChange={(v) => { setStyle("titleColor", v); setStyle("subLineColor", v); }} />
                  </StyleRow>
                  <StyleRow label="Address / phone size (pt)">
                    <input type="number" min={10} max={40} value={tpl.style.subLineSizePx} onChange={(e) => setStyle("subLineSizePx", Number(e.target.value) || DEFAULT_RECEIPT_TEMPLATE.style.subLineSizePx)} className={inputCls} />
                  </StyleRow>
                  <StyleRow label={'"Weight Ticket" line size (pt)'}>
                    <input type="number" min={10} max={40} value={tpl.style.ticketTypeSizePx} onChange={(e) => setStyle("ticketTypeSizePx", Number(e.target.value) || DEFAULT_RECEIPT_TEMPLATE.style.ticketTypeSizePx)} className={inputCls} />
                  </StyleRow>
                  <StyleRow label={'Field caption color (e.g. "Product", "Seller")'}>
                    <ColorInput value={tpl.style.labelColor} onChange={(v) => setStyle("labelColor", v)} />
                  </StyleRow>
                  <StyleRow label="Filled-in value color (names, numbers)">
                    <ColorInput value={tpl.style.valueColor} onChange={(v) => setStyle("valueColor", v)} />
                  </StyleRow>
                  <StyleRow label="Bold values">
                    <input type="checkbox" checked={tpl.style.valueBold} onChange={(e) => setStyle("valueBold", e.target.checked)} className="h-4 w-4" />
                  </StyleRow>
                  <StyleRow label="Table text size (pt)">
                    <input type="number" min={9} max={24} value={tpl.style.bodyFontSizePx} onChange={(e) => setStyle("bodyFontSizePx", Number(e.target.value) || DEFAULT_RECEIPT_TEMPLATE.style.bodyFontSizePx)} className={inputCls} />
                  </StyleRow>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {saved ? (<><Check size={14} /> Saved</>) : saving ? "Saving..." : (<><Save size={14} /> Save changes</>)}
                </button>
                <button
                  onClick={resetToDefaults}
                  title="Reset every field and style back to the original ticket"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  <RotateCcw size={14} /> Reset
                </button>
              </div>
              {saveError && <p className="-mt-3 text-xs text-rose-500">{saveError}</p>}

              <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 shadow-sm">
                <p className="mb-2 text-xs font-medium text-slate-500">Live preview — sample data only, nothing here is real</p>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4">
                  <div style={{ width: "210mm", transform: "scale(0.85)", transformOrigin: "top left" }}>
                    <ExactWeightTicket
                      tx={SAMPLE_TX}
                      isBuy
                      tpl={tpl}
                      companyNameKh={companyNameKh}
                      companyAddressKh={companyAddressKh}
                      companyPhoneLine={companyPhoneLine}
                      productName="សែន ក្រអូប"
                      hasWeighInOut
                      inStamp={SAMPLE_IN_STAMP}
                      outStamp={SAMPLE_OUT_STAMP}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StyleRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-slate-500">{label}</label>
      <div className="w-40 shrink-0">{children}</div>
    </div>
  );
}

function ColorInput({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-slate-200 p-0.5" />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}

// One row of the "Excel form" table — a group header strip (only rendered
// the first time a new group starts) plus the field name, English cell, and
// Khmer cell. Split out mainly so the group-header logic above stays simple.
function FragmentRow({ row, showGroupHeader, tpl, setLabel }) {
  return (
    <>
      {showGroupHeader && (
        <tr>
          <td colSpan={3} className="border-b border-slate-200 bg-brand-50/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
            {row.group}
          </td>
        </tr>
      )}
      <tr className="border-b border-slate-100">
        <td className="px-4 py-2 text-slate-600">{row.title}</td>
        <td className="px-3 py-1.5">
          <input value={tpl.labels[row.en] || ""} onChange={(e) => setLabel(row.en, e.target.value)} className={inputCls} />
        </td>
        <td className="px-3 py-1.5">
          {row.kh ? (
            <input value={tpl.labels[row.kh] || ""} onChange={(e) => setLabel(row.kh, e.target.value)} className={inputCls} style={{ fontFamily: "'Khmer OS', 'Khmer OS Battambang', sans-serif" }} />
          ) : (
            <span className="text-xs text-slate-300">— none —</span>
          )}
        </td>
      </tr>
    </>
  );
}
