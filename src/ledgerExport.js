// Builds the "IMPORT / EXPORT" coupon-style Excel ledger for the
// Transactions List page's Export button — modeled directly on the
// station's existing paper/old-system report format (grouped by product,
// with a Sub-Total per product and a grand TOTAL per section), so it can
// replace that old report rather than staff needing two different files.
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
import * as XLSX from "xlsx";

const UNIT_LABEL = "R"; // Riel — every amount in PaddyTrade is Riel, matches the old format's Unit column

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

const HEADERS = ["Coupon No.", "Truck", "Date In", "Date Out", "Tm in", "Tm Out", "Seller", "Buyer",
  "W In", "W Out", "Net", "Tare(%)", "Tare Weight", "Actual", "Price", "Amount", "Unit", "Remarks"];

function activeFilter(rows, selectedLocationIds, startDate, endDate) {
  return rows
    .filter((r) => (r.hq_status || "processing") !== "cancelled")
    .filter((r) => !selectedLocationIds.length || selectedLocationIds.includes(r.location_id))
    .filter((r) => !startDate || r.tx_date >= startDate)
    .filter((r) => !endDate || r.tx_date <= endDate);
}

function buildRow(tx) {
  const hasWeighInOut = tx.gross_kg != null && tx.tare_kg != null;
  const net = hasWeighInOut ? Number(tx.gross_kg) - Number(tx.tare_kg) : Number(tx.quantity_kg || 0);
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

// Groups a section's rows by product (preserving first-seen order), with a
// "PRODUCT: <name>" divider and a "Sub-Total" row after each group, and a
// grand "TOTAL" row at the end — matching the old report's exact layout.
function buildSectionLines(rows) {
  const order = [];
  const groups = {};
  rows.forEach((tx) => {
    const key = tx.productName || "—";
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(tx);
  });

  const lines = [];
  let sectionCount = 0, sectionNet = 0, sectionActual = 0, sectionAmount = 0;
  order.forEach((productName) => {
    const group = groups[productName];
    lines.push([`PRODUCT: ${productName}`]);
    let subNet = 0, subActual = 0, subAmount = 0;
    group.forEach((tx) => {
      const row = buildRow(tx);
      lines.push(row);
      subNet += Number(row[10]) || 0;
      subActual += Number(row[13]) || 0;
      subAmount += Number(row[15]) || 0;
    });
    lines.push(["Sub-Total", "", "", "", "", "", `${group.length}  Item`, "", "", "",
      round2(subNet), "", 0, round2(subActual), "", round2(subAmount), "", ""]);
    sectionCount += group.length;
    sectionNet += subNet; sectionActual += subActual; sectionAmount += subAmount;
  });
  lines.push(["TOTAL", "", "", "", "", "", `${sectionCount}  Item`, "", "", "",
    round2(sectionNet), "", 0, round2(sectionActual), "", round2(sectionAmount), "", ""]);
  return lines;
}

// header/address block repeated above both the IMPORT and EXPORT sections,
// matching the original report — company name, then (only when every row
// in view is from a single location) that location's own address/phone.
function buildLetterhead(sectionLabel, companyName, singleStation, startDate, endDate) {
  const lines = [[companyName || "PaddyTrade"]];
  if (singleStation) {
    if (singleStation.stationAddress) lines.push([singleStation.stationAddress]);
    if (singleStation.stationPhone) lines.push([`Tel: ${singleStation.stationPhone}`]);
  }
  lines.push([sectionLabel]);
  lines.push([`FROM: ${startDate ? fmtDateDMY(startDate) : "—"} 00:00  TO: ${endDate ? fmtDateDMY(endDate) : "—"} 23:59`]);
  return lines;
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

  const rowsOut = [
    ...buildLetterhead("IMPORT", companyName, singleStation, startDate, endDate),
    HEADERS,
    ...buildSectionLines(buyRows),
    [],
    [],
    ...buildLetterhead("EXPORT", companyName, singleStation, startDate, endDate),
    HEADERS,
    ...buildSectionLines(sellRows),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rowsOut);
  ws["!cols"] = [
    { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 8 },
    { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 9 },
    { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 6 }, { wch: 18 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Coupon Ledger");
  return wb;
}

export function downloadLedgerWorkbook(data, filename) {
  const wb = buildLedgerWorkbook(data);
  XLSX.writeFile(wb, filename);
}
