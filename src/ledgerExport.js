// Builds the "IMPORT / EXPORT" coupon-style Excel ledger for the
// Transactions List page's Export button — modeled directly on the
// station's existing paper/old-system report format (grouped by product,
// with a Sub-Total per product and a grand TOTAL per section), so it can
// replace that old report rather than staff needing two different files.
//
// [2026-09-01] Rebuilt on ExcelJS (was SheetJS's free "xlsx" package, which
// can only write plain, unstyled cells) so this can actually look like a
// real printed ledger — letterhead, colored/bold headers, borders, shaded
// Sub-Total/TOTAL rows, a frozen header row, and a landscape print layout —
// and to split IMPORT/EXPORT into two tabs instead of one long stacked
// sheet, matching the sample SISEN approved. Two real bugs fixed at the
// same time, not just styling:
//   - Net was recomputed here as gross_kg - tare_kg, which only happens to
//     be right for a Buy. A Sell is weighed empty-then-loaded (see
//     finalizeTicket() in api.js), so that same subtraction came out
//     negative for every Sell row. Net now just reads tx.quantity_kg
//     directly — the same authoritative, always-correctly-signed net
//     weight every other page in the app already trusts (Dashboard,
//     LocationDetail, Transactions' payableKg, the Amount this same row
//     already shows) — rather than re-deriving it a second, inconsistent
//     way. W In/W Out still show the raw gross_kg/tare_kg readings as
//     before, just no longer used to compute Net.
//   - Added a "Ticket #" column (tx.paper_ticket_no) right after Coupon
//     No. — the handwritten number from the physical quality ticket at
//     weigh-in, already shown elsewhere in the app as "Ticket No." and
//     distinct from the system-generated Coupon No./tx.code next to it.
//
// Column mapping decisions (confirmed with the user before building this):
//   - Buyer column = whoever recorded the transaction (tx.recorded_by_name),
//     the same on every row regardless of BUY/SELL — not the counterparty.
//   - Seller column = the actual counterparty on the transaction
//     (tx.partyName) — the farmer on a BUY, the customer on a SELL.
//   - Truck column = Car Plate and Truck/Driver Name combined, e.g.
//     "3A-3850 - Driver Name" (either one alone if only one is on file).
//   - Tare(%) / Tare Weight / Actual: if a real moisture/mixture deduction
//     was recorded on that transaction (deduction_kg > 0), show the real
//     deduction and the true payable weight. Otherwise those columns stay
//     blank and Actual = Net, matching a transaction with no deduction.
import ExcelJS from "exceljs";

const UNIT_LABEL = "R"; // Riel — every amount in PaddyTrade is Riel, matches the old format's Unit column

// Brand tokens, same values as tailwind.config.js's brand/gold scales —
// ARGB (Excel wants an alpha channel first, "FF" = fully opaque).
const BRAND = "FF217A4F";
const BRAND_DARK = "FF1B5238";
const GOLD_FILL = "FFFBF6E9";
const GOLD_LINE = "FFC7972C";
const SLATE = "FF64748B";
const LIGHT_FILL = "FFF3FBF6";
const WHITE = "FFFFFFFF";
const GRID_LINE = "FFD9D9D9";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Cambodia-timezone-safe date/time formatting (Asia/Phnom_Penh, independent
// of the viewing device's own timezone) — same pattern used throughout the
// rest of the app (see cambodiaNow() in api.js/offlineQueue.js).
function cambodiaParts(value) {
  const d = new Date(value);
  if (isNaN(d)) return null;
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return parts;
}
function fmtDateDMY(value) {
  const p = cambodiaParts(value);
  return p ? `${p.day}/${p.month}/${p.year}` : "";
}
function fmtTimeHM(value) {
  const p = cambodiaParts(value);
  return p ? `${p.hour}:${p.minute}` : "";
}

const HEADERS = ["Coupon No.", "Ticket #", "Truck", "Date In", "Date Out", "Tm in", "Tm Out", "Seller", "Buyer",
  "W In", "W Out", "Net", "Tare(%)", "Tare Weight", "Actual", "Price", "Amount", "Unit", "Remarks"];
const COL_WIDTHS = [14, 12, 20, 12, 12, 8, 8, 16, 14, 10, 10, 10, 9, 11, 10, 10, 14, 6, 18];
const COL_COUNT = HEADERS.length; // 19
// 1-indexed column numbers (matches HEADERS order above).
const DECIMAL_COLS = new Set([10, 11, 12, 13, 14, 15, 16]); // W In..Price
const INT_COLS = new Set([17]); // Amount (Riel — no cents anywhere else in the app)
const CENTER_COLS = new Set([2, 18]); // Ticket #, Unit

const thinGrid = { style: "thin", color: { argb: GRID_LINE } };
const borderAll = { top: thinGrid, left: thinGrid, right: thinGrid, bottom: thinGrid };

function activeFilter(rows, selectedLocationIds, startDate, endDate) {
  return rows
    .filter((r) => (r.hq_status || "processing") !== "cancelled")
    .filter((r) => !selectedLocationIds.length || selectedLocationIds.includes(r.location_id))
    .filter((r) => !startDate || r.tx_date >= startDate)
    .filter((r) => !endDate || r.tx_date <= endDate);
}

function buildRow(tx) {
  const hasWeighInOut = tx.gross_kg != null && tx.tare_kg != null;
  // Always the transaction's own authoritative net weight — see the
  // file-level comment above for why this used to be recomputed from
  // gross_kg/tare_kg here (and why that went negative for Sells).
  const net = Number(tx.quantity_kg || 0);
  const dateIn = hasWeighInOut ? fmtDateDMY(tx.gross_at) : fmtDateDMY(tx.tx_date);
  const dateOut = hasWeighInOut ? fmtDateDMY(tx.tare_at) : fmtDateDMY(tx.tx_date);
  const tmIn = hasWeighInOut ? fmtTimeHM(tx.gross_at) : "";
  const tmOut = hasWeighInOut ? fmtTimeHM(tx.tare_at) : "";
  const deductionKg = Number(tx.deduction_kg || 0);
  const hasDeduction = deductionKg > 0.001;
  const tarePct = hasDeduction && net > 0 ? round2((deductionKg / net) * 100) : "";
  const tareWeight = hasDeduction ? round2(deductionKg) : "";
  const actual = hasDeduction ? round2(net - deductionKg) : round2(net);
  const truck = [tx.car_plate, tx.driver_name].filter(Boolean).join(" - ");

  return [
    tx.code,
    tx.paper_ticket_no || "",
    truck,
    dateIn,
    dateOut,
    tmIn,
    tmOut,
    tx.partyName || "",
    tx.recorded_by_name || "",
    hasWeighInOut ? round2(tx.gross_kg) : "",
    hasWeighInOut ? round2(tx.tare_kg) : "",
    round2(net),
    tarePct,
    tareWeight,
    actual,
    round2(tx.price_per_kg),
    round2(tx.amount),
    UNIT_LABEL,
    tx.note || "",
  ];
}

// Groups a section's rows by product (preserving first-seen order).
function groupByProduct(rows) {
  const order = [];
  const groups = {};
  rows.forEach((tx) => {
    const key = tx.productName || "—";
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(tx);
  });
  return order.map((name) => ({ name, txs: groups[name] }));
}

function styleCell(cell, { bold, italic, size, color, fill, align, border, numFmt, wrap } = {}) {
  cell.font = { bold: !!bold, italic: !!italic, size: size || 10, color: { argb: color || "FF1E293B" } };
  if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.alignment = { horizontal: align || "left", vertical: "center", wrapText: !!wrap };
  if (border) cell.border = border;
  if (numFmt) cell.numFmt = numFmt;
}

function writeLetterhead(ws, row, { companyName, singleStation, sectionLabel, startDate, endDate }) {
  ws.mergeCells(row, 1, row, COL_COUNT);
  styleCell(ws.getCell(row, 1), { bold: true, size: 15, color: BRAND_DARK, align: "center" });
  ws.getCell(row, 1).value = companyName || "PaddyTrade";
  row += 1;

  if (singleStation?.stationAddress) {
    ws.mergeCells(row, 1, row, COL_COUNT);
    styleCell(ws.getCell(row, 1), { size: 9, color: SLATE, align: "center" });
    ws.getCell(row, 1).value = singleStation.stationAddress;
    row += 1;
  }
  if (singleStation?.stationPhone) {
    ws.mergeCells(row, 1, row, COL_COUNT);
    styleCell(ws.getCell(row, 1), { size: 9, color: SLATE, align: "center" });
    ws.getCell(row, 1).value = `Tel: ${singleStation.stationPhone}`;
    row += 1;
  }
  row += 1;

  ws.mergeCells(row, 1, row, COL_COUNT);
  styleCell(ws.getCell(row, 1), { bold: true, size: 12, color: WHITE, fill: BRAND, align: "center" });
  ws.getCell(row, 1).value = sectionLabel;
  row += 1;

  ws.mergeCells(row, 1, row, COL_COUNT);
  styleCell(ws.getCell(row, 1), { italic: true, size: 9.5, color: SLATE, align: "center" });
  ws.getCell(row, 1).value = `FROM: ${startDate ? fmtDateDMY(startDate) : "—"} 00:00  TO: ${endDate ? fmtDateDMY(endDate) : "—"} 23:59`;
  row += 2;

  return row;
}

function writeHeaderRow(ws, row) {
  HEADERS.forEach((h, i) => {
    const cell = ws.getCell(row, i + 1);
    styleCell(cell, { bold: true, size: 10, color: WHITE, fill: BRAND, align: "center", border: borderAll, wrap: true });
    cell.value = h;
  });
  ws.getRow(row).height = 26;
  return row + 1;
}

function writeProductRow(ws, row, productName) {
  ws.mergeCells(row, 1, row, COL_COUNT);
  const cell = ws.getCell(row, 1);
  styleCell(cell, { bold: true, size: 10, color: BRAND_DARK, fill: LIGHT_FILL, align: "left" });
  cell.alignment.indent = 1;
  cell.value = `PRODUCT: ${productName}`;
  return row + 1;
}

function writeDataRow(ws, row, values) {
  values.forEach((v, i) => {
    const col = i + 1;
    const cell = ws.getCell(row, col);
    const isNum = typeof v === "number";
    let align = "left";
    if (isNum) align = "right";
    else if (CENTER_COLS.has(col)) align = "center";
    styleCell(cell, {
      size: 9.5, align, border: borderAll,
      numFmt: isNum ? (DECIMAL_COLS.has(col) ? "#,##0.00" : INT_COLS.has(col) ? "#,##0" : undefined) : undefined,
      color: col === 2 ? SLATE : undefined,
    });
    cell.value = v === "" || v === null || v === undefined ? null : v;
  });
  return row + 1;
}

function writeSummaryRow(ws, row, { label, itemCount, net, actual, amount, style }) {
  const fill = style === "total" ? BRAND_DARK : GOLD_FILL;
  const color = style === "total" ? WHITE : BRAND_DARK;
  const border = style === "total"
    ? { top: { style: "medium", color: { argb: BRAND_DARK } }, bottom: { style: "medium", color: { argb: BRAND_DARK } }, left: thinGrid, right: thinGrid }
    : { top: { style: "thin", color: { argb: GOLD_LINE } }, bottom: thinGrid, left: thinGrid, right: thinGrid };
  const size = style === "total" ? 10.5 : 9.5;

  for (let col = 1; col <= COL_COUNT; col++) {
    const cell = ws.getCell(row, col);
    styleCell(cell, { bold: true, size, color, fill, border, align: col > 9 ? "right" : "left" });
  }
  ws.getCell(row, 1).value = label;
  ws.getCell(row, 8).value = `${itemCount}  Item`;
  ws.getCell(row, 12).value = net;
  ws.getCell(row, 12).numFmt = "#,##0.00";
  ws.getCell(row, 15).value = actual;
  ws.getCell(row, 15).numFmt = "#,##0.00";
  ws.getCell(row, 17).value = amount;
  ws.getCell(row, 17).numFmt = "#,##0";
  return row + 1;
}

function setupPrint(ws, headerRow) {
  ws.pageSetup.orientation = "landscape";
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0, footer: 0 };
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
}

function buildSheet(wb, tabName, sectionLabel, rows, { companyName, singleStation, startDate, endDate }) {
  const ws = wb.addWorksheet(tabName);
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  let row = writeLetterhead(ws, 1, { companyName, singleStation, sectionLabel, startDate, endDate });
  const headerRow = row;
  row = writeHeaderRow(ws, row);
  const firstDataRow = row;

  const groups = groupByProduct(rows);
  let grandCount = 0, grandNet = 0, grandActual = 0, grandAmount = 0;
  groups.forEach(({ name, txs }) => {
    row = writeProductRow(ws, row, name);
    let subNet = 0, subActual = 0, subAmount = 0;
    txs.forEach((tx) => {
      const r = buildRow(tx);
      row = writeDataRow(ws, row, r);
      subNet += Number(r[11]) || 0;
      subActual += Number(r[14]) || 0;
      subAmount += Number(r[16]) || 0;
    });
    row = writeSummaryRow(ws, row, {
      label: "Sub-Total", itemCount: txs.length,
      net: round2(subNet), actual: round2(subActual), amount: round2(subAmount), style: "subtotal",
    });
    grandCount += txs.length; grandNet += subNet; grandActual += subActual; grandAmount += subAmount;
  });

  row = writeSummaryRow(ws, row, {
    label: "TOTAL", itemCount: grandCount,
    net: round2(grandNet), actual: round2(grandActual), amount: round2(grandAmount), style: "total",
  });

  // Keeps the column header row on screen while scrolling through a long
  // section — the letterhead above it scrolls away, the header doesn't.
  ws.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
  setupPrint(ws, headerRow);
  return ws;
}

export function buildLedgerWorkbook({ txs, selectedLocationIds = [], startDate = null, endDate = null, companyName = "" }) {
  const filtered = activeFilter(txs, selectedLocationIds, startDate, endDate);
  const buyRows = filtered.filter((t) => t.type === "BUY");
  const sellRows = filtered.filter((t) => t.type === "SELL");

  // Only show one station's address/phone in the letterhead when every row
  // in view really does belong to one location — otherwise it would be
  // misleading to print a single address over a mixed, multi-location report.
  const distinctLocationIds = new Set(filtered.map((t) => t.location_id));
  const singleStation = distinctLocationIds.size === 1 ? filtered[0] : null;

  const wb = new ExcelJS.Workbook();
  wb.creator = companyName || "PaddyTrade";
  wb.created = new Date();

  buildSheet(wb, "Import (Buy)", "IMPORT", buyRows, { companyName, singleStation, startDate, endDate });
  buildSheet(wb, "Export (Sell)", "EXPORT", sellRows, { companyName, singleStation, startDate, endDate });

  return wb;
}

export async function downloadLedgerWorkbook(data, filename) {
  const wb = buildLedgerWorkbook(data);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Freeing the object URL right after the click still lets the download
  // through (the browser has already grabbed the blob by then) — same
  // pattern as every other blob download in the app (Receipt.jsx's PDF
  // export, PhotoUpload's preview links).
  URL.revokeObjectURL(url);
}
