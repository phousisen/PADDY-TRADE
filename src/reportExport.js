// Builds and downloads a multi-sheet Excel (.xlsx) workbook for the
// Financial Reports section. Every sheet mirrors the exact same filtering
// and calculation logic used by the on-screen report it corresponds to
// (Overview, Purchases, Sales, Accounts Payable/Receivable, Stock, Cash
// Flow, Tax), using whatever Location/Date filters are currently active.
import * as XLSX from "xlsx";
import { getAccurateNow } from "./supabaseClient.js";
// [2026-10-03] The summary, P&L, balance and cash-flow figures come from
// statements.js now — the module the Balance Sheet, Income Statement and
// Cash Flow screens read — instead of financials.js, which disagreed with
// them on cash, VAT owed and profit with a figure not entered (full check
// M1). paidStatusMap is the same rule in both and stays for the detail sheets.
import { paidStatusMap } from "./financials.js";
import { computeStatements, cashFlowLines, unconfirmedExpenses } from "./statements.js";
import { api } from "./api.js";
import { effectiveAdjDateStr, cambodiaDateStr } from "./dailyLedger.js";

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
  // [2026-09-19] SPEED: payments added up per transaction once, not searched
  // again for every bill (3,000 bills x 30,000 payments was 90M comparisons).
  const paidById = new Map();
  for (const p of payments) {
    if (!p.transaction_id) continue;
    paidById.set(p.transaction_id, (paidById.get(p.transaction_id) || 0) + (Number(p.amount) || 0));
  }
  return rows
    .map((tx) => {
      const paid = paidById.get(tx.id) || 0;
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

// [2026-10-03] partners / assets / settings / reviews added (full check M1,
// M14): the statements need the asset register and each station's opening
// cash and tax rate, exactly as useStatements.js hands them to the screens.
// `assets` null = no register (lines read "not entered"); `reviews` null =
// expense confirmation not set up (no unconfirmed line).
export function buildReportWorkbook({ txs, payments, adjustments = [], stations, capitalEntries = [], loanEntries = [], partners = [], assets = null, settings = {}, reviews = null, selectedLocationIds = [], startDate = null, endDate = null }) {
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
  // [2026-10-03] Balances as at the end date (same as the Capital page);
  // the entry-detail lists below still show only the period.
  const capAsAt = capitalEntries
    .filter((e) => !selectedLocationIds.length || selectedLocationIds.includes(e.location_id))
    .filter((e) => !endDate || e.entry_date <= endDate);
  const loanAsAt = loanEntries
    .filter((e) => !selectedLocationIds.length || selectedLocationIds.includes(e.location_id))
    .filter((e) => !endDate || e.entry_date <= endDate);
  // [2026-10-03] The period's expense rows are taken inside computeStatements
  // now, by the same rule as the screens (full check M1).

  // ---------------- Overview (P&L + Balance Sheet + By Location) ----------------
  // [2026-09-14] Same figures as the on-screen Overview/Balance Sheet, from
  // the same module — `txs`/`payments` here are AS AT the period end (Reports
  // .jsx drops `from` for exactly this reason), and computeStatements takes
  // the period slice itself ([2026-10-03] was computeFinancials — full check M1).
  // [2026-10-03] computeStatements, as the screens (full check M1).
  const stmtArgs = { asAtTxs: txs, payments, adjustments, partners, capitalEntries, loanEntries, assets, settings, startDate, endDate };
  const st = computeStatements({ ...stmtArgs, stations: filteredStations });
  const byLocation = filteredStations.map((s) => ({ station: s, st: computeStatements({ ...stmtArgs, stations: [s] }) }));
  const inc = st.income;
  const bal = st.balance;
  // A figure nobody has entered is written as the words, never as 0 — same
  // rule as the screens (statements.js rule 2).
  const val = (v) => (v === null || v === undefined ? "not entered" : round2(v));
  const neg = (v) => (v === null || v === undefined ? null : -v);
  // Sales less the cost of the paddy sold — the Overview's "Gross Profit";
  // adds up across the by-location rows (full check M13).
  const tradingGross = (i) => i.sales - i.costOfGoodsSold;
  const unconfirmed = unconfirmedExpenses({
    payments, reviews, stationIds: filteredStations.map((s) => s.id), startDate, endDate });
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
    // [2026-10-03] Line for line the Overview screen, from computeStatements
    // (full check M1): other income, depreciation, interest and tax are
    // their own lines, and Net Profit reads "not entered" while any of them
    // is — as on the Income Statement — instead of a profit that ignores them.
    ["Total Sales (Revenue)", round2(inc.sales)],
    // [2026-09-19] The cost of the paddy SOLD, as on screen — this row showed
    // everything bought, so the three rows did not add up. And the stock
    // written off, which Net Profit already includes, now has its own row.
    ["Cost of paddy sold (COGS)", round2(-inc.costOfGoodsSold)],
    ["Gross Profit", round2(tradingGross(inc))],
    ["Other income", round2(inc.otherIncome)],
    ["Operating Expenses", round2(-inc.operatingExpenses)],
    ["Stock written off", round2(inc.inventoryLost)],
    ["Profit before depreciation, interest & tax", round2(inc.profitBeforeUnknowns)],
    ["Depreciation", val(neg(inc.depreciation))],
    ["Interest", val(neg(inc.interest))],
    ["Tax", val(neg(inc.tax))],
    ["Net Profit", val(inc.netProfit)],
    // [2026-10-03] full check M14 — counted above, as on screen, but said.
    ...(unconfirmed > 0 ? [["Expenses not yet confirmed (included above)", round2(unconfirmed)]] : []),
    [],
    ["Balance Sheet — Assets", "Amount (៛)"],
    ["Inventory on hand", round2(bal.inventoryValue)],
    ["Accounts Receivable", round2(bal.accountsReceivable)],
    // [2026-10-03] The Balance Sheet's cash: the opening balance plus every
    // movement since (full check M1). Without an opening balance it is "not
    // entered", and the movement is on the next line.
    ["Cash and bank", val(bal.cash)],
    ["Cash movement since the system began", round2(bal.cashMovement)],
    ["Current Assets", val(bal.currentAssets)],
    ["Property and equipment, net", val(bal.fixedAssetsNet)],
    ["Total Assets", val(bal.totalAssets)],
    [],
    ["Balance Sheet — Liabilities", "Amount (៛)"],
    ["Accounts Payable", round2(bal.accountsPayable)],
    ["Bank Loans Outstanding", round2(bal.loansOutstanding)],
    ["VAT owed (net)", round2(bal.vatNet)],
    ["Total Liabilities", round2(bal.totalLiabilities)],
    [],
    ["Balance Sheet — Equity", "Amount (៛)"],
    ["Partner Capital", round2(bal.partnerCapital)],
    ["Less: drawings", round2(-bal.drawings)],
    ["Retained Earnings", round2(bal.retainedEarnings)],
    ["Opening balance", round2(bal.openingEquity)],
    ["Equity (net worth)", round2(bal.equity)],
    ["Unexplained difference", val(bal.unreconciled)],
    [],
    ["By Location"],
    // [2026-10-03] "Gross Profit", not "Profit": it is sales less the cost of
    // the paddy sold, before expenses, so the rows add to more than Net
    // Profit and must not be read as it (full check M13).
    ["Location", "Sales", "Purchases", "Gross Profit", "Inventory", "Payable", "Bank Loans", "Partner Capital", "Equity"],
    ...byLocation.map(({ station, st: r }) => [station.name, round2(r.income.sales), round2(r.income.purchases), round2(tradingGross(r.income)), round2(r.balance.inventoryValue), round2(r.balance.accountsPayable), round2(r.balance.loansOutstanding), round2(r.balance.partnerCapital - r.balance.drawings), round2(r.balance.equity)]),
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
  // [2026-09-19] What is owed AS AT the end date — every bill up to then,
  // not only this period's, and only payments made by then. The period's
  // bills alone left out a farmer unpaid since July.
  const asAtRows = activeFilter(txs, selectedLocationIds, null, endDate);
  const paidByEnd = payments.filter((p) => !endDate || !p.pay_date || p.pay_date <= endDate);
  const payablesOutstanding = outstandingFor(asAtRows.filter((t) => t.type === "BUY"), paidByEnd.filter((p) => p.type === "pay_supplier"));
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
  const receivablesOutstanding = outstandingFor(asAtRows.filter((t) => t.type === "SELL"), paidByEnd.filter((p) => p.type === "receive_customer"));
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
  // [2026-09-19] Same as the Stock screen: the balance is carried from the
  // first movement ever recorded (not from 0 on the period's first day), and
  // stock counts are movements too. Only the period's rows are listed.
  const events = [];
  for (const tx of activeFilter(txs, selectedLocationIds, null, endDate)) {
    const kg = Number(tx.quantity_kg) || 0;
    events.push({ date: tx.tx_date, key: `${tx.tx_date} ${tx.tx_time || ""}`, location_id: tx.location_id,
      code: tx.code, stationName: tx.stationName, type: tx.type, delta: tx.type === "BUY" ? kg : -kg });
  }
  for (const a of adjustments) {
    if (!a.created_at) continue;
    if (selectedLocationIds.length && !selectedLocationIds.includes(a.location_id)) continue;
    const date = effectiveAdjDateStr(a);
    if (endDate && date > endDate) continue;
    const back = date !== cambodiaDateStr(new Date(a.created_at));
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Phnom_Penh", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(a.created_at));
    events.push({ date, key: `${date} ${back ? "99" : clock}`, location_id: a.location_id,
      code: a.reason === "reset" ? "Stock reset" : "Stock count",
      stationName: a.locations?.name || (stations.find((x) => x.id === a.location_id) || {}).name || "",
      type: "COUNT", delta: Number(a.adjustment_kg) || 0 });
  }
  events.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const running = {};
  const movements = [];
  for (const e of events) {
    running[e.location_id] = (running[e.location_id] || 0) + e.delta;
    if (startDate && e.date < startDate) continue;
    movements.push({ ...e, tx_date: e.date, runningBalance: running[e.location_id] });
  }
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Stock — Current Summary"],
    [],
    ["Location", "Current Stock (kg)", "Capacity (kg)", "% Full"],
    // [2026-09-10] `|| 0` then a zero test: a station with no capacity set
    // used to export the text "Infinity" into the spreadsheet cell.
    ...filteredStations.map((s) => {
      const capKg = Number(s.capacity_kg) || 0;
      return [s.name, round2(s.current_stock_kg), round2(s.capacity_kg),
              capKg > 0 ? Math.round((Number(s.current_stock_kg) / capKg) * 100) : ""];
    }),
    [],
    ["Movement Detail"],
    [rangeLabel],
    ["Date", "Receipt", "Location", "Type", "Change (kg)", "Running Balance"],
    ...movements.map((m) => [m.tx_date, m.code, m.stationName, m.type, round2(m.delta), round2(m.runningBalance)]),
  ]), "Stock");

  // ---------------- Cash Flow ----------------
  // [2026-10-03] Rebuilt on the Cash Flow screen's own figures (full check
  // M9). The old sheet was a ledger of the payments table with rules of its
  // own: the balance restarted at 0 every period, payments for sales dated
  // after the period were counted, and capital and loans were looked for as
  // payment rows — which are no longer copied there, so they vanished. The
  // totals are now st.cashflow (what the screen shows) and the lines are the
  // very rows those totals add up (cashFlowLines), so they always agree.
  const cf = st.cashflow;
  const KIND_LABELS = {
    collected: "Received from customer",
    paidOut: "Paid to farmer",
    expense: "Expense",
    capitalIn: "Partner capital in",
    drawing: "Partner drawing",
    loanIn: "Bank loan drawn",
    loanOut: "Bank loan repaid",
    asset: "Property / equipment bought",
  };
  const stationNameOf = (id) => (stations.find((x) => x.id === id) || {}).name || "";
  let cfBal = cf.openingCash === null ? 0 : cf.openingCash;
  const cfLines = cashFlowLines(cf).map((l) => {
    cfBal += l.signed;
    const r = l.row || {};
    const note = l.kind === "expense" ? [r.category, r.memo].filter(Boolean).join(" — ")
      : l.kind === "capitalIn" || l.kind === "drawing" ? [r.partnerName, r.note].filter(Boolean).join(" — ")
      : l.kind === "loanIn" || l.kind === "loanOut" ? [r.lender_name, r.note].filter(Boolean).join(" — ")
      : l.kind === "asset" ? (r.name || "")
      : (r.memo || "");
    return [l.date, KIND_LABELS[l.kind] || l.kind, r.stationName || stationNameOf(r.location_id), note,
            r.createdByName || "", round2(l.signed), round2(cfBal)];
  });
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Cash Flow"],
    [rangeLabel],
    [],
    ["Operating activities", "Amount (៛)"],
    ["Cash received from customers", round2(cf.collected)],
    ["Cash paid to farmers", round2(-cf.paidOut)],
    ["Commission paid (ថ្លៃកូនដៃ)", round2(-cf.expensesPaidIntermediary)],
    ["Other expenses paid", round2(-cf.expensesPaidOther)],
    ["Net cash from operating activities", round2(cf.cfOperating)],
    [],
    ["Investing activities", "Amount (៛)"],
    ["Property and equipment bought", val(neg(cf.assetsBought))],
    ["Net cash from investing activities", val(cf.cfInvesting)],
    [],
    ["Financing activities", "Amount (៛)"],
    ["Partner capital put in", round2(cf.capitalIn)],
    ["Bank loans, net", round2(cf.loansIn)],
    ["Partner drawings", round2(-cf.drawings)],
    ["Net cash from financing activities", round2(cf.cfFinancing)],
    [],
    ["Net movement in cash", val(cf.cfNet)],
    ["Opening cash", val(cf.openingCash)],
    ["Closing cash", val(cf.closingCash)],
    [],
    ["Lines"],
    [cf.openingCash === null
      ? "Opening cash for this period is not known (a figure above is not entered), so the balance column starts from 0 and shows the movement only."
      : "The balance column starts from the opening cash above."],
    ["Date", "Type", "Location", "Note", "Recorded by", "Amount (៛)", "Balance (៛)"],
    ...cfLines,
  ]), "Cash Flow");

  // ---------------- Capital & Loans ----------------
  const capByPartner = {};
  capAsAt.forEach((e) => {
    const k = e.partner_id;
    if (!capByPartner[k]) capByPartner[k] = { name: e.partnerName, location: e.stationName, contributed: 0, withdrawn: 0 };
    if (e.type === "contribution") capByPartner[k].contributed += Number(e.amount);
    else capByPartner[k].withdrawn += Number(e.amount);
  });
  const loansByLender = {};
  loanAsAt.forEach((e) => {
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

// [2026-10-03] The statements need the asset register and Finance Setup
// (opening cash, tax rate), and the unconfirmed-expenses line needs the
// expense confirmations — none of which the Reports page fetches (full check
// M1, M14). When the caller has not passed them they are fetched here with
// exactly the fallbacks the screens use (useStatements.js `setup`, the Daily
// Book's reviews): if one cannot be read, its lines read "not entered" on the
// screen and in the workbook alike. A caller that passes all three keeps the
// old synchronous behaviour. Either way a promise is returned — a caller
// should `await` it so a failure reaches its error message.
export function downloadReportWorkbook(data, filename) {
  const has = (k) => Object.prototype.hasOwnProperty.call(data || {}, k);
  if (has("assets") && has("settings") && has("reviews")) {
    XLSX.writeFile(buildReportWorkbook(data), filename);
    return Promise.resolve();
  }
  const soft = (p, fallback) => p.catch(() => fallback);
  return Promise.all([
    has("assets") ? data.assets : soft(api.getFixedAssets(), null),
    has("settings") ? data.settings : soft(api.getFinanceSettings(), {}),
    has("reviews") ? data.reviews : soft(api.getExpenseReviews(), null),
  ]).then(([assets, settings, reviews]) => {
    XLSX.writeFile(buildReportWorkbook({ ...data, assets, settings, reviews }), filename);
  });
}
