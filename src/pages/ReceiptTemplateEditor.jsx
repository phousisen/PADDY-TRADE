import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, Download, RotateCcw, Save, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { cambodiaTimestamp } from "../reportExport.js";
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

// Every editable style setting, in the same "title text <-> tpl.style key"
// shape as LABEL_ROWS above, so the Excel import/export can share one
// simple lookup pattern for both sheets. The title text is what the boss
// actually sees in the "Setting" column of the downloaded file — matching
// is done on that text, so the Field/Setting columns must come back
// unchanged on re-upload (only the Value/English/Khmer columns should be
// edited). This is explained on the "Instructions" sheet of the download.
const STYLE_ROWS = [
  { title: "Header alignment (type: center or left)", key: "headerAlign" },
  { title: "Company name size (pt)", key: "titleSizePx" },
  { title: "Company name / address / phone color (hex, e.g. #0f172a)", key: "titleColor" },
  { title: "Address / phone size (pt)", key: "subLineSizePx" },
  { title: "Address / phone color (hex)", key: "subLineColor" },
  { title: "\"Weight Ticket\" line size (pt)", key: "ticketTypeSizePx" },
  { title: "Field caption color (hex, e.g. \"Product\", \"Seller\")", key: "labelColor" },
  { title: "Filled-in value color (hex, names/numbers)", key: "valueColor" },
  { title: "Bold values (type: TRUE or FALSE)", key: "valueBold" },
  { title: "Table text size (pt)", key: "bodyFontSizePx" },
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
  const fileInputRef = useRef(null);
  const [importedOk, setImportedOk] = useState(false);
  const [importError, setImportError] = useState("");
  const [showManual, setShowManual] = useState(false);

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

  // Downloads the current draft (whatever's on screen right now, saved or
  // not) as a real .xlsx file the boss can open and edit in actual Excel
  // (or Google Sheets, LibreOffice, etc.) — not this web page. Three
  // sheets: plain-language instructions, every label (English/Khmer side
  // by side), and every style setting.
  function exportToExcel() {
    const wb = XLSX.utils.book_new();

    const wsInstructions = XLSX.utils.aoa_to_sheet([
      ["How to edit the receipt in Excel"],
      [""],
      ["1. Open the \"Labels\" sheet (tab at the bottom). Only type into the English and Khmer columns — leave the Field column exactly as it is."],
      ["2. Open the \"Style\" sheet. Only type into the Value column — leave the Setting column exactly as it is."],
      ["3. Save this file, keeping it as .xlsx (File > Save, or File > Save As if your program asks)."],
      ["4. Back on the Receipt Template page in PaddyTrade, click \"Upload from Excel\" and pick this saved file."],
      ["5. Check the live preview on that page looks right, then click \"Save changes\" to make it the real receipt."],
      [""],
      ["Colors must be typed as a hex code starting with #, for example #0f172a."],
      ["Header alignment must be typed as exactly: center   or   left"],
      ["Bold values must be typed as exactly: TRUE   or   FALSE"],
    ]);
    wsInstructions["!cols"] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(wb, wsInstructions, "Instructions");

    const labelRows = [["Field", "English", "Khmer"]];
    LABEL_ROWS.forEach((row) => {
      labelRows.push([row.title, tpl.labels[row.en] || "", row.kh ? (tpl.labels[row.kh] || "") : ""]);
    });
    const wsLabels = XLSX.utils.aoa_to_sheet(labelRows);
    wsLabels["!cols"] = [{ wch: 28 }, { wch: 34 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, wsLabels, "Labels");

    const styleRows = [["Setting", "Value"]];
    STYLE_ROWS.forEach((row) => {
      const raw = tpl.style[row.key];
      styleRows.push([row.title, row.key === "valueBold" ? (raw ? "TRUE" : "FALSE") : raw]);
    });
    const wsStyle = XLSX.utils.aoa_to_sheet(styleRows);
    wsStyle["!cols"] = [{ wch: 50 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsStyle, "Style");

    XLSX.writeFile(wb, `receipt-template_${cambodiaTimestamp()}.xlsx`);
  }

  // Reads a .xlsx file back in (must have come from "Download as Excel"
  // above, or at least match its sheet names/column layout) and loads it
  // into the draft — same as typing changes into the on-screen table. It
  // does NOT save automatically; the boss still reviews the preview and
  // hits "Save changes" themselves.
  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError("");
    setImportedOk(false);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const labelsSheet = wb.Sheets["Labels"];
      const styleSheet = wb.Sheets["Style"];
      if (!labelsSheet || !styleSheet) {
        throw new Error('This doesn\'t look like a Receipt Template Excel file — it\'s missing the "Labels" or "Style" sheet. Use "Download as Excel" first to get the right format, edit that file, then upload it back.');
      }

      const labelByTitle = {};
      LABEL_ROWS.forEach((row) => { labelByTitle[row.title.trim().toLowerCase()] = row; });
      const styleByTitle = {};
      STYLE_ROWS.forEach((row) => { styleByTitle[row.title.trim().toLowerCase()] = row; });

      const newLabels = { ...tpl.labels };
      XLSX.utils.sheet_to_json(labelsSheet, { header: 1 }).slice(1).forEach((r) => {
        const match = labelByTitle[String(r[0] || "").trim().toLowerCase()];
        if (!match) return;
        newLabels[match.en] = String(r[1] ?? "").trim();
        if (match.kh) newLabels[match.kh] = String(r[2] ?? "").trim();
      });

      const newStyle = { ...tpl.style };
      const numericKeys = ["titleSizePx", "subLineSizePx", "ticketTypeSizePx", "bodyFontSizePx"];
      XLSX.utils.sheet_to_json(styleSheet, { header: 1 }).slice(1).forEach((r) => {
        const match = styleByTitle[String(r[0] || "").trim().toLowerCase()];
        if (!match) return;
        const raw = r[1];
        if (match.key === "valueBold") {
          newStyle.valueBold = String(raw).trim().toUpperCase() === "TRUE";
        } else if (match.key === "headerAlign") {
          newStyle.headerAlign = String(raw).trim().toLowerCase() === "left" ? "left" : "center";
        } else if (numericKeys.includes(match.key)) {
          const n = Number(raw);
          newStyle[match.key] = Number.isFinite(n) && n > 0 ? n : DEFAULT_RECEIPT_TEMPLATE.style[match.key];
        } else {
          const v = String(raw ?? "").trim();
          newStyle[match.key] = /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : DEFAULT_RECEIPT_TEMPLATE.style[match.key];
        }
      });

      setTpl({ labels: newLabels, style: newStyle });
      setImportedOk(true);
      setTimeout(() => setImportedOk(false), 4000);
    } catch (err) {
      setImportError(err.message || "Couldn't read that file — make sure it's the .xlsx file downloaded from this page.");
    }
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
      <Topbar title="Receipt Template" subtitle="Owner-only — edit the printed weight ticket" />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : loadError ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        ) : (
          <div className="mx-auto max-w-[820px]">
            {/* ---- Primary path: everything happens in Excel itself, not
                on this page. Download, edit in Excel, upload the saved
                file back — the page is just the loader, not the editor. ---- */}
            <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/50 p-6 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800">Edit the receipt in Excel</h3>
              <p className="mt-1.5 max-w-lg text-sm text-slate-500">
                Download the file below and open it in Excel. Type over the words you want to change, save the file, then come back here and upload it — that's the whole workflow, nothing to edit on this page.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={exportToExcel}
                  className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
                >
                  <Download size={15} /> Download as Excel
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 rounded-lg border border-brand-300 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                >
                  <Upload size={15} /> Upload from Excel
                </button>
                <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleImportFile} className="hidden" />
              </div>
              {importedOk && <p className="mt-3 text-xs font-medium text-emerald-600">Loaded from Excel — check the preview below, then hit Save changes to make it the real receipt.</p>}
              {importError && <p className="mt-3 flex items-start gap-1 text-xs text-rose-500"><AlertCircle size={12} className="mt-0.5 shrink-0" /> {importError}</p>}
            </div>

            <div className="mt-5 flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
              >
                {saved ? (<><Check size={14} /> Saved</>) : saving ? "Saving..." : (<><Save size={14} /> Save changes</>)}
              </button>
              <button
                onClick={resetToDefaults}
                title="Reset every field and style back to the original ticket"
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw size={14} /> Reset to original
              </button>
              {saveError && <p className="text-xs text-rose-500">{saveError}</p>}
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-100 p-4 shadow-sm">
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

            {/* ---- Optional fallback: the old on-page spreadsheet-style
                editor, tucked away and collapsed by default so it never
                competes with the Excel workflow above. ---- */}
            <div className="mt-6">
              <button
                onClick={() => setShowManual((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                {showManual ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Prefer not to use Excel? Edit the fields directly on this page instead
              </button>

              {showManual && (
                <div className="mt-3 grid grid-cols-[1fr_420px] gap-5">
                  <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 p-4">
                      <h3 className="font-semibold text-slate-700">Every word on the ticket</h3>
                      <p className="text-xs text-slate-400">Click any cell and type to change it — exactly like editing a spreadsheet. Changes show in the preview above instantly and only take effect on printed tickets after you hit Save.</p>
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
                </div>
              )}
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
