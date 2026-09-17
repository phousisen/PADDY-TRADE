import { useEffect } from "react";
import { buildSheet, shares, shortHeading } from "../expenseSheet.js";
import { dmy, dmyTime, weekday } from "../dateFormat.js";
import { useLanguage } from "../i18n.jsx";

// The expense report on paper.
//
// [2026-09-17] SISEN asked for this three times before it was right:
//
//   "i need help making sure we can print out the expenses file"
//   "this really take up the paper space, i think its better to create a
//    proper collum or what"
//   "why land scape, its a waste, make it portait"
//
// So: A4 PORTRAIT, one page, a proper matrix. Days down, categories across,
// totals on both edges. Nothing indents and nothing repeats, which is what
// took the month from four sheets to one.
//
// ── The page size problem, and why this overlay exists ──
//
// index.css pins `@page { size: 210mm 140mm }` for the ticket printer, and
// @page is global — a second one would fight it and whichever loses takes the
// tickets down with it. So this does not print through the app at all. It
// writes a complete, standalone document into a hidden iframe with its own
// @page rule and prints THAT. The app's own print setup is never touched, the
// station's ticket printing cannot be affected by anything in this file, and
// "Save as PDF" is a destination in the same dialog.
//
// ── What makes seven money columns fit 210mm ──
//
//   · one-word column headings (ប្រេង, not ប្រេងឥន្ធនៈ) — shortened for the
//     HEADING only, never in the data
//   · the weekday beside the date in grey rather than in its own column
//   · tabular figures, so columns align without padding between them
//   · 10.5px body type, which is smaller than the screen and correct for
//     paper — a printed page is held at half the distance of a monitor
//
// ── What is deliberately still on it ──
//
// Days nobody filed. A gap on a sheet that gets signed has to be visible;
// skipping it quietly claims nothing was spent. See expenseSheet.js, whose
// sums this only renders — the arithmetic is checked in scripts-check-sheet.mjs.
export default function ExpenseSheetPrint({
  rows, days, marks, scopeLabel, periodLabel, byWhom, onDone,
}) {
  const { t, lang } = useLanguage();
  const sheet = buildSheet({ rows, days, marks, maxCols: 5, otherLabel: t("ex_other") });
  const strip = shares(sheet);

  const fmt = (n) => (n ? Math.round(n).toLocaleString("en-US") : "—");

  useEffect(() => {
    const html = documentFor({ sheet, strip, scopeLabel, periodLabel, byWhom, t, lang, fmt });
    const frame = document.createElement("iframe");
    // Off-screen rather than display:none — a hidden frame is not laid out,
    // and a frame with no layout prints blank.
    frame.setAttribute("style", "position:fixed;right:0;bottom:0;width:0;height:0;border:0;");
    document.body.appendChild(frame);

    const win = frame.contentWindow;
    win.document.open();
    win.document.write(html);
    win.document.close();

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // Left a moment: removing the frame the instant print() returns can
      // cancel the job on some Chrome builds.
      setTimeout(() => { try { frame.remove(); } catch { /* already gone */ } }, 1000);
      if (onDone) onDone();
    };

    // Fonts must be in before the dialog opens or Khmer measures wrong and
    // the columns land in the wrong places.
    const go = () => {
      const ready = win.document.fonts ? win.document.fonts.ready : Promise.resolve();
      ready.then(() => { win.focus(); win.print(); finish(); }).catch(() => { win.print(); finish(); });
    };
    if (win.document.readyState === "complete") go();
    else win.addEventListener("load", go);

    return () => { try { frame.remove(); } catch { /* already gone */ } };
    // Built once, on open. Re-running it mid-print would replace the document
    // under the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// A whole document as a string. Nothing here can reach the app's stylesheet,
// which is the point — see the note about @page above.
function documentFor({ sheet, strip, scopeLabel, periodLabel, byWhom, t, lang, fmt }) {
  // Escaped with four separate replaces rather than one character class.
  // A class holding angle brackets — /[&<>"]/g — reads as an unclosed JSX
  // fragment to scripts-check-jsx.mjs, and the guard is right not to guess:
  // see its note about regex literals. Same result, no ambiguity.
  const esc = (v) => String(v ?? "")
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");

  const heads = sheet.columns.map((c) =>
    `<th class="${c.kh ? "kh" : ""}">${esc(shortHeading(c.name))}</th>`).join("");

  const body = sheet.rows.map((r) => {
    const blank = r.state === "blank";
    const note = blank ? t("ex_not_entered") : r.state === "nothing" ? t("ex_nothing_spent") : "";
    const cells = sheet.columns.map((c) =>
      `<td class="${c.kh ? "kh" : ""}">${fmt(r.cells[c.key])}</td>`).join("");
    return `<tr class="${blank ? "b" : ""}">
      <td class="l">${esc(dmy(r.day))}<span class="wd">${esc(weekday(r.day, t))}</span>${
        note ? `<span class="tag">${esc(note)}</span>` : ""}</td>
      ${cells}<td class="tt">${fmt(r.total)}</td></tr>`;
  }).join("");

  const foots = sheet.columns.map((c) =>
    `<td class="${c.kh ? "kh" : ""}">${fmt(sheet.colTotals[c.key])}</td>`).join("");

  const shareCells = strip.map((s) =>
    `<div class="sh"><i>${esc(shortHeading(s.name))}</i><b class="${s.kh ? "kh" : ""}">${
      fmt(s.amount)}<span class="p">${s.pct}%</span></b></div>`).join("");

  return `<!doctype html><html lang="${lang === "km" ? "km" : "en"}"><head><meta charset="utf-8">
<title>${esc(t("ex_print_title"))}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;500;600;700;800&display=swap">
<style>
  /* This document's own page size. The app's 210x140 ticket page cannot
     reach in here, and this cannot reach out. */
  @page { size: A4 portrait; margin: 12mm 10mm; }
  *{box-sizing:border-box}
  body{margin:0;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact;
       font-family:"Noto Sans Khmer",ui-sans-serif,system-ui,"Segoe UI",sans-serif}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;
        border-bottom:2px solid #111827;padding-bottom:9px}
  .head h1{margin:0;font-size:18px;font-weight:800;letter-spacing:-.01em}
  .head .s{margin:3px 0 0;font-size:11px;color:#6b7280}
  .head .co{text-align:right}
  .head .co b{display:block;font-size:11.5px;font-weight:800;letter-spacing:.02em}
  .head .co span{display:block;font-size:9.5px;color:#6b7280;margin-top:2px;font-variant-numeric:tabular-nums}
  .scope{display:flex;border:1px solid #d1d5db;border-radius:2px;margin-top:11px;overflow:hidden}
  .sc{flex:1;padding:5px 8px;border-right:1px solid #d1d5db;min-width:0}
  .sc:last-child{border-right:0}
  .sc i{display:block;font-style:normal;font-size:8px;letter-spacing:.05em;color:#9ca3af;
        text-transform:uppercase;margin-bottom:1px;white-space:nowrap}
  .sc b{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  table{width:100%;border-collapse:collapse;margin-top:11px;table-layout:fixed}
  thead th{font-size:8.5px;color:#9ca3af;font-weight:700;padding:0 4px 4px;text-align:right;
           border-bottom:1.5px solid #111827;white-space:nowrap}
  thead th.l{text-align:left;padding-left:2px;width:96px}
  thead th.kh{color:#a16207}
  thead th.tt{color:#111827;width:82px}
  tbody td{font-size:10px;padding:3px 4px;text-align:right;border-bottom:1px solid #eef1f4;
           font-variant-numeric:tabular-nums;color:#374151;white-space:nowrap}
  tbody td.l{text-align:left;padding-left:2px;color:#111827;font-weight:700;font-size:10.5px}
  tbody td.l .wd{font-weight:400;color:#6b7280;margin-left:4px;font-size:9px}
  tbody td.kh{color:#a16207;font-weight:700}
  tbody td.tt{font-weight:800;color:#111827;font-size:10.5px}
  tbody tr:nth-child(even){background:#fafbfc}
  tbody tr.b td,tbody tr.b td.l,tbody tr.b td.l .wd{color:#9ca3af}
  .tag{display:inline-block;background:#f3f4f6;color:#6b7280;border-radius:2px;padding:0 4px;
       font-size:8px;font-weight:700;margin-left:4px;vertical-align:1px}
  tfoot td{font-size:11px;font-weight:800;padding:7px 4px;border-top:1.5px solid #111827;
           text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  tfoot td.l{text-align:left;padding-left:2px}
  tfoot td.kh{color:#a16207}
  .share{display:flex;margin-top:11px;border:1px solid #d1d5db;border-radius:2px;overflow:hidden}
  .sh{flex:1;padding:6px 8px;border-right:1px solid #d1d5db;min-width:0}
  .sh:last-child{border-right:0}
  .sh i{display:block;font-style:normal;font-size:8px;color:#9ca3af;text-transform:uppercase;
        letter-spacing:.04em;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sh b{font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  .sh b.kh{color:#a16207}
  .sh .p{font-size:8.5px;color:#9ca3af;margin-left:3px;font-weight:600}
  .sign{display:flex;gap:30px;margin-top:22px}
  .sg{flex:1}.sg .line{border-bottom:1px solid #111827;height:30px}
  .sg p{margin:4px 0 0;font-size:9px;color:#6b7280}
  .foot{margin-top:14px;display:flex;justify-content:space-between;font-size:8.5px;color:#9ca3af;
        border-top:1px solid #d1d5db;padding-top:5px;font-variant-numeric:tabular-nums}
  /* A month that does run over keeps its headings on the next sheet. */
  thead{display:table-header-group} tfoot{display:table-footer-group} tr{break-inside:avoid}
</style></head><body>
  <div class="head">
    <div><h1>${esc(t("ex_print_title"))}</h1><p class="s">${esc(t("ex_print_sub"))}</p></div>
    <div class="co"><b>PADDYTRADE</b>
      <span>${esc(dmyTime(new Date()))}</span>
      <span>${esc(byWhom || "")}</span></div>
  </div>

  <div class="scope">
    <div class="sc"><i>${esc(t("ex_locations"))}</i><b>${esc(scopeLabel)}</b></div>
    <div class="sc"><i>${esc(t("db_period"))}</i><b>${esc(periodLabel)}</b></div>
    <div class="sc"><i>${esc(t("ex_print_filed"))}</i><b>${sheet.filedDays} / ${sheet.rows.length}</b></div>
    <div class="sc"><i>${esc(t("ex_total"))}</i><b>${fmt(sheet.grand)} ៛</b></div>
  </div>

  <table>
    <thead><tr><th class="l">${esc(t("ex_day"))}</th>${heads}<th class="tt">${esc(t("ex_total"))}</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td class="l">${esc(t("ex_total"))}</td>${foots}<td class="tt">${fmt(sheet.grand)}</td></tr></tfoot>
  </table>

  <div class="share">${shareCells}</div>

  <div class="sign">
    <div class="sg"><div class="line"></div><p>${esc(t("ex_print_prepared"))}</p></div>
    <div class="sg"><div class="line"></div><p>${esc(t("ex_print_checked"))}</p></div>
    <div class="sg"><div class="line"></div><p>${esc(t("ex_print_approved"))}</p></div>
  </div>

  <div class="foot">
    <span>PaddyTrade · ${esc(t("ex_print_title"))} · ${esc(scopeLabel)} · ${esc(periodLabel)}</span>
    <span>${esc(dmy(new Date()))}</span>
  </div>
</body></html>`;
}
