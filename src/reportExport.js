// Builds and downloads a multi-sheet Excel (.xlsx) workbook for the
// Financial Reports section. Every sheet mirrors the exact same filtering
// and calculation logic used by the on-screen report it corresponds to
// (Overview, Purchases, Sales, Accounts Payable/Receivable, Stock, Cash
// Flow, Tax), using whatever Location/Date filters are currently active.
import * as XLSX from "xlsx";
import { getAccurateNow } from "./supabaseClient.js";
import { computeFinancials, paidStatusMap } from "./pages/ReportOverview.jsx";

// Cambodia's current date/time (independent of the viewing device's own
// timezone/clock), used to stamp the exported filename.
export function cambodiaTimestamp(d = getAccurateNow()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}`;
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function ageBucket(days) {
  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "90+ days";
}

function activeFilter(rows, selectedLocationIds, startDate, endDate) {
  return rows
    .filter((r) => (r.hq_status || "processing") !== "cancelled")
    .filter((r) => !selectedLocationIds.length || selectedLocationIds.includes(r.location_id))
    .filter((r) => !startDate || r.tx_date >= startDate)
    .filter((r) => !endDate || r.tx_date <= endDate);
}

function groupSum(rows, keyFn) {
  const map = {};
  rows.forEach((r) => {
    const k = keyFn(r) || "—";
    if (!map[k]) map[k] = { name: k, count: 0, qty: 0, amount: 0 };
    map[k].count += 1;
    map[k].qty += Number(r.quantity_kg || 0);
    map[k].amount += Number(r.amount || 0);
  });
  return Object.values(map).sort((a, b) => b.amount - a.amount);
}

function outstandingFor(rows, payments) {
  const today = getAccurateNow();
  return rows
    .map((tx) => {
      const paid = payments.filter((p) => p.transaction_id === tx.id).reduce((s, p) => s + Number(p.amount), 0);
      const remaining = Math.max(0, Number(tx.total_with_tax ?? tx.amount) - paid);
      const days = Math.floor((today - new Date(tx.tx_date)) / (1000 * 60 * 60 * 24));
      return { ...tx, remaining, days, bucket: ageBucket(days) };
    })
    .filter((tx) => tx.remaining > 0.01)
    .sort((a, b) => b.days - a.days);
}

function sheet(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }];
  return ws;
}

export function buildReportWorkbook({ txs, payments, stations, capitalEntries = [], loanEntries = [], selectedLocationIds = [], startDate = null, endDate = null }) {
  const wb = XLSX.utils.book_new();
  const rangeLabel = `Date range: ${startDate || "All time"} to ${endDate || "All time"}`;
  const filteredStations = selectedLocationIds.length ? stations.filter((s) => selectedLocationIds.includes(s.id)) : stations;
  const activeTxs = activeFilter(txs, selectedLocationIds, startDate, endDate);
  const capRows = capitalEntries
    .filter((e) => !selectedLocationIds.length || selectedLocationIds.includes(e.location_id))
    .filter((e) => !startDate || e.entry_date >= startDate)
    .filter((e) => !endDate || e.entry_date <= endDate);
  const loanRows = loanEntries
    .filter((e) => !selectedLocationIds.length || selectedLocationIds.includes(e.location_id))
    .filter((e) => !startDate || e.entry_date >= startDate)
    .filter((e) => !endDate || e.entry_date <= endDate);

  // ---------------- Overview (P&L + Balance Sheet + By Location) ----------------
  const calc = computeFinancials(activeTxs, filteredStations, capitalEntries, loanEntries, payments);
  const byLocation = filteredStations.map((s) => {
    const stationTxs = activeTxs.filter((x) => x.location_id === s.id);
    return { station: s, ...computeFinancials(stationTxs, [s], capitalEntries, loanEntries, payments) };
  });
  // Buy/Sell counts, kg, and amounts per location for the summary table
  // below. Uses the same activeTxs already filtered to the selected
  // locations/date range — for a location-scoped account that's just their
  // one station (enforced server-side), so filteredStations naturally has
  // one row and the TOTAL row below matches it; for the admin/boss account
  // it's every station plus a real grand total.
  const buySellByLocation = filteredStations.map((s) => {
    const stationTxs = activeTxs.filter((x) => x.location_id === s.id);
    const buys = stationTxs.filter((t) => t.type === "BUY");
    const sells = stationTxs.filter((t) => t.type === "SELL");
    return {
      name: s.name,
      buyCount: buys.length,
      buyKg: buys.reduce((sum, t) => sum + Number(t.quantity_kg || 0), 0),
      buyAmount: buys.reduce((sum, t) => sum + Number(t.amount || 0), 0),
      sellCount: sells.length,
      sellKg: sells.reduce((sum, t) => sum + Number(t.quantity_kg || 0), 0),
      sellAmount: sells.reduce((sum, t) => sum + Number(t.amount || 0), 0),
    };
  });
  const buySellTotal = buySellByLocation.reduce((t, r) => ({
    buyCount: t.buyCount + r.buyCount,
    buyKg: t.buyKg + r.buyKg,
    buyAmount: t.buyAmount + r.buyAmount,
    sellCount: t.sellCount + r.sellCount,
    sellKg: t.sellKg + r.sellKg,
    sellAmount: t.sellAmount + r.sellAmount,
  }), { buyCount: 0, buyKg: 0, buyAmount: 0, sellCount: 0, sellKg: 0, sellAmount: 0 });
  XLSX.utils.book_append_sheet(wb, sheet([
    ["PaddyTrade — Financial Overview"],
    [rangeLabel],
    [],
    ["Profit & Loss", "Amount (៛)"],
    ["Total Sales (Revenue)", round2(calc.totalSell)],
    ["Total Purchases (COGS)", round2(-calc.totalBuy)],
    ["Gross Profit", round2(calc.grossProfit)],
    [],
    ["Balance Sheet — Assets", "Amount (៛)"],
    ["Inventory on hand", round2(calc.inventoryValue)],
    ["Accounts Receivable", round2(calc.accountsReceivable)],
    ["Cash (estimate)", round2(Math.max(0, calc.cashEstimate))],
    ["Total Assets", round2(calc.totalAssets)],
    [],
    ["Balance Sheet — Liabilities", "Amount (៛)"],
    ["Accounts Payable", round2(calc.accountsPayable)],
    ["Bank Loans Outstanding", round2(calc.bankLoansOutstanding)],
    ["Total Liabilities", round2(calc.totalLiabilities)],
    [],
    ["Balance Sheet — Equity", "Amount (៛)"],
    ["Partner Capital", round2(calc.partnerCapital)],
    ["Retained Earnings", round2(calc.retainedEarnings)],
    ["Equity (net worth)", round2(calc.equity)],
    [],
    ["By Location"],
    ["Location", "Sales", "Purchases", "Profit", "Inventory", "Payable", "Bank Loans", "Partner Capital", "Equity"],
    ...byLocation.map((r) => [r.station.name, round2(r.totalSell), round2(r.totalBuy), round2(r.grossProfit), round2(r.inventoryValue), round2(r.accountsPayable), round2(r.bankLoansOutstanding), round2(r.partnerCapital), round2(r.equity)]),
    [],
    ["Buy & Sell Summary by Location"],
    ["Location", "Buy Transactions", "Buy Qty In (kg)", "Total Buy Cost (៛)", "Sell Transactions", "Sell Qty Out (kg)", "Total Sales (៛)"],
    ...buySellByLocation.map((r) => [r.name, r.buyCount, round2(r.buyKg), round2(r.buyAmount), r.sellCount, round2(r.sellKg), round2(r.sellAmount)]),
    ["TOTAL — All Locations", buySellTotal.buyCount, round2(buySellTotal.buyKg), round2(buySellTotal.buyAmount), buySellTotal.sellCount, round2(buySellTotal.sellKg), round2(buySellTotal.sellAmount)],
  ]), "Overview");

  // ---------------- Purchases ----------------
  const buyRows = activeTxs.filter((t) => t.type === "BUY");
  const buyPaidMap = paidStatusMap(buyRows, payments);
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Purchases — Detail"],
    [rangeLabel],
    [],
    ["Date", "Receipt", "Supplier", "Truck/Driver", "Paddy Type", "Location", "Paid", "Cost Price (៛/kg)", "Qty (kg)", "Amount (៛)"],
    ...buyRows.map((r) => [r.tx_date, r.code, r.partyName, r.driver_name || "", r.productName, r.stationName, (buyPaidMap[r.id]?.remaining || 0) <= 0.01 ? "Paid" : "Unpaid", round2(r.price_per_kg), round2(r.quantity_kg), round2(r.amount)]),
    [],
    ["Summary by Supplier"],
    ["Supplier", "Transactions", "Qty (kg)", "Amount (៛)"],
    ...groupSum(buyRows, (r) => r.partyName).map((g) => [g.name, g.count, round2(g.qty), round2(g.amount)]),
  ]), "Purchases");

  // ---------------- Sales ----------------
  const sellRows = activeTxs.filter((t) => t.type === "SELL");
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Sales — Detail"],
    [rangeLabel],
    [],
    ["Date", "Receipt", "Customer", "Paddy Type", "Location", "Qty (kg)", "Amount (៛)"],
    ...sellRows.map((r) => [r.tx_date, r.code, r.partyName, r.productName, r.stationName, round2(r.quantity_kg), round2(r.amount)]),
    [],
    ["Summary by Customer"],
    ["Customer", "Transactions", "Qty (kg)", "Amount (៛)"],
    ...groupSum(sellRows, (r) => r.partyName).map((g) => [g.name, g.count, round2(g.qty), round2(g.amount)]),
  ]), "Sales");

  // ---------------- Accounts Payable ----------------
  const payablesOutstanding = outstandingFor(buyRows, payments.filter((p) => p.type === "pay_supplier"));
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Accounts Payable — Outstanding"],
    [rangeLabel],
    [],
    ["Total Outstanding (៛)", round2(payablesOutstanding.reduce((s, r) => s + r.remaining, 0))],
    [],
    ["Date", "Receipt", "Supplier", "Location", "Age (days)", "Amount Owed (៛)"],
    ...payablesOutstanding.map((r) => [r.tx_date, r.code, r.partyName, r.stationName, r.days, round2(r.remaining)]),
  ]), "Accounts Payable");

  // ---------------- Accounts Receivable ----------------
  const receivablesOutstanding = outstandingFor(sellRows, payments.filter((p) => p.type === "receive_customer"));
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Accounts Receivable — Outstanding"],
    [rangeLabel],
    [],
    ["Total Outstanding (៛)", round2(receivablesOutstanding.reduce((s, r) => s + r.remaining, 0))],
    [],
    ["Date", "Receipt", "Customer", "Location", "Age (days)", "Amount Owed (៛)"],
    ...receivablesOutstanding.map((r) => [r.tx_date, r.code, r.partyName, r.stationName, r.days, round2(r.remaining)]),
  ]), "Accounts Receivable");

  // ---------------- Stock ----------------
  const sortedAllTxs = txs.slice().sort((a, b) => (a.tx_date + a.tx_time > b.tx_date + b.tx_time ? 1 : -1));
  const stockTxs = activeFilter(sortedAllTxs, selectedLocationIds, startDate, endDate);
  const running = {};
  const movements = stockTxs.map((tx) => {
    const delta = tx.type === "BUY" ? Number(tx.quantity_kg) : -Number(tx.quantity_kg);
    running[tx.location_id] = (running[tx.location_id] || 0) + delta;
    return { ...tx, delta, runningBalance: running[tx.location_id] };
  });
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Stock — Current Summary"],
    [],
    ["Location", "Current Stock (kg)", "Capacity (kg)", "% Full"],
    ...filteredStations.map((s) => [s.name, round2(s.current_stock_kg), round2(s.capacity_kg), Math.round((Number(s.current_stock_kg) / Number(s.capacity_kg)) * 100)]),
    [],
    ["Movement Detail"],
    [rangeLabel],
    ["Date", "Receipt", "Location", "Type", "Change (kg)", "Running Balance"],
    ...movements.map((m) => [m.tx_date, m.code, m.stationName, m.type, round2(m.delta), round2(m.runningBalance)]),
  ]), "Stock");

  // ---------------- Cash Flow ----------------
  const cashPayments = payments
    .filter((p) => !selectedLocationIds.length || selectedLocationIds.includes(p.location_id))
    .filter((p) => !startDate || p.pay_date >= startDate)
    .filter((p) => !endDate || p.pay_date <= endDate);
  const sortedPayments = cashPayments.slice().sort((a, b) => (a.pay_date + a.created_at < b.pay_date + b.created_at ? -1 : 1));
  const TYPE_LABELS = {
    pay_supplier: "Paid to supplier",
    receive_customer: "Received from customer",
    expense: "Expense",
    transfer: "Fund transfer",
    journal: "Journal entry",
    capital_in: "Partner capital in",
    capital_out: "Partner capital out",
    loan_in: "Bank loan drawn",
    loan_out: "Bank loan repaid",
  };
  const IS_INFLOW = {
    pay_supplier: false,
    receive_customer: true,
    expense: false,
    transfer: false,
    journal: null,
    capital_in: true,
    capital_out: false,
    loan_in: true,
    loan_out: false,
  };
  let bal = 0;
  const ledger = sortedPayments.map((p) => {
    const isInflow = IS_INFLOW[p.type] ?? false;
    const signedAmount = isInflow ? Number(p.amount) : -Number(p.amount);
    bal += signedAmount;
    return { ...p, signedAmount, balance: bal };
  }).reverse();
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Cash Flow — Ledger"],
    [rangeLabel],
    [],
    ["Date", "Type", "Note", "Recorded by", "Amount (៛)", "Balance (៛)"],
    ...ledger.map((p) => [p.pay_date, TYPE_LABELS[p.type] || p.type, p.memo || "", p.createdByName, round2(p.signedAmount), round2(p.balance)]),
  ]), "Cash Flow");

  // ---------------- Capital & Loans ----------------
  const capByPartner = {};
  capRows.forEach((e) => {
    const k = e.partner_id;
    if (!capByPartner[k]) capByPartner[k] = { name: e.partnerName, location: e.stationName, contributed: 0, withdrawn: 0 };
    if (e.type === "contribution") capByPartner[k].contributed += Number(e.amount);
    else capByPartner[k].withdrawn += Number(e.amount);
  });
  const loansByLender = {};
  loanRows.forEach((e) => {
    const k = `${e.lender_name}__${e.location_id}`;
    if (!loansByLender[k]) loansByLender[k] = { name: e.lender_name, location: e.stationName, borrowed: 0, repaid: 0 };
    if (e.type === "borrow") loansByLender[k].borrowed += Number(e.amount);
    else loansByLender[k].repaid += Number(e.amount);
  });
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Capital & Loans"],
    [rangeLabel],
    [],
    ["Partner Capital — by Partner"],
    ["Partner", "Location", "Contributed (៛)", "Withdrawn (៛)", "Net Capital (៛)"],
    ...Object.values(capByPartner).map((r) => [r.name, r.location, round2(r.contributed), round2(r.withdrawn), round2(r.contributed - r.withdrawn)]),
    [],
    ["Partner Capital — Entry Detail"],
    ["Date", "Partner", "Location", "Type", "Amount (៛)", "Note"],
    ...capRows.map((e) => [e.entry_date, e.partnerName, e.stationName, e.type, round2(e.amount), e.note || ""]),
    [],
    ["Bank Loans — by Lender"],
    ["Lender", "Location", "Borrowed (៛)", "Repaid (៛)", "Outstanding (៛)"],
    ...Object.values(loansByLender).map((r) => [r.name, r.location, round2(r.borrowed), round2(r.repaid), round2(r.borrowed - r.repaid)]),
    [],
    ["Bank Loans — Entry Detail"],
    ["Date", "Lender", "Location", "Type", "Amount (៛)", "Note"],
    ...loanRows.map((e) => [e.entry_date, e.lender_name, e.stationName, e.type, round2(e.amount), e.note || ""]),
  ]), "Capital & Loans");

  // ---------------- Tax ----------------
  const taxTxs = activeTxs.filter((t) => t.tax_applicable).slice().sort((a, b) => (a.tx_date < b.tx_date ? 1 : -1));
  const outputTax = taxTxs.filter((t) => t.type === "SELL").reduce((s, t) => s + Number(t.tax_amount || 0), 0);
  const inputTax = taxTxs.filter((t) => t.type === "BUY").reduce((s, t) => s + Number(t.tax_amount || 0), 0);
  const netPayable = outputTax - inputTax;
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Tax — Taxable Transactions"],
    [rangeLabel],
    [],
    ["Output Tax (collected on sales)", round2(outputTax)],
    ["Input Tax (paid on purchases)", round2(inputTax)],
    [netPayable >= 0 ? "Net Tax Payable" : "Net Tax Refundable", round2(Math.abs(netPayable))],
    [],
    ["Date", "Receipt", "Type", "Party", "Subtotal (៛)", "Rate (%)", "Tax (៛)", "Total (៛)"],
    ...taxTxs.map((t) => [t.tx_date, t.code, t.type, t.partyName, round2(t.amount), Number(t.tax_rate), round2(t.tax_amount), round2(t.total_with_tax)]),
  ]), "Tax");

  return wb;
}

export function downloadReportWorkbook(data, filename) {
  const wb = buildReportWorkbook(data);
  XLSX.writeFile(wb, filename);
}
