// Guard for Data Check → Money (src/moneyCheck.js). Run: node scripts-check-money.mjs
//
// The cases are the real ones found on 12/10/2026 (finance check), with the
// same numbers: the double-paid Ping Pong farmer, the 49.5M Jomnoum sale with
// nothing received, Reang Kesey's 10 ៛/kg short sales, the 0 ៛ Ping Pong load,
// and the 18 tickets closed on 19/10 by payments typed in weeks later.
import { findMoneyProblems, totalsOf, perKgHint, liveNotes, MIN_GAP } from "./src/moneyCheck.js";

let fails = 0;
const ok = (cond, msg, got) => { if (!cond) { fails++; console.log("  FAIL", msg, got === undefined ? "" : JSON.stringify(got)); } };
const T = (id, type, date, kg, total, extra = {}) => ({
  id, code: id, type, tx_date: date, quantity_kg: kg, deduction_kg: 0, price_per_kg: kg ? total / kg : 0,
  amount: total, total_with_tax: total, location_id: "L", hq_status: "processing", created_at: `${date}T03:00:00Z`, ...extra,
});
let pid = 0;
const P = (tx, amount, type, extra = {}) => ({ id: `p${++pid}`, transaction_id: tx, amount, type, pay_date: "2026-09-12", created_at: "2026-09-12T03:00:00Z", ...extra });
const BUYP = (tx, a, e) => P(tx, a, "pay_supplier", e);
const SELLP = (tx, a, e) => P(tx, a, "receive_customer", e);
const TODAY = "2026-10-12";
const run = (txs, payments, notes = [], today = TODAY) => findMoneyProblems({ txs, payments, notes, today });
const ids = (r) => r.open.map((x) => x.id).sort();
const N = (tx, problem, gap, extra = {}) => ({ id: `n-${tx}-${problem}`, transaction_id: tx, problem, gap, reason: "credit", note: "agreed with the buyer", created_at: "2026-10-13T01:00:00Z", approved_at: "2026-10-13T01:00:00Z", ...extra });

// 1. paid in full: nothing listed
{
  const r = run([T("A", "BUY", "2026-09-01", 1000, 1000000)], [BUYP("A", 1000000, { created_at: "2026-09-01T03:00:00Z" })]);
  ok(r.open.length === 0 && r.done.length === 0, "1: a fully paid ticket is not listed", ids(r));
}
// 2. paid twice with different amounts (PP INV-206089-B): paid too much
{
  const r = run([T("B", "BUY", "2026-09-12", 1155, 1178100)], [BUYP("B", 1178100), BUYP("B", 841500)]);
  ok(r.open.length === 1 && r.open[0].problems.join() === "overpaid" && r.open[0].gap === -841500, "2: paid too much, 841,500", r.open[0]?.problems);
  ok(r.totals.fixNow === 1 && r.totals.fixNowRiel === 841500, "2: fix now with riel", r.totals);
}
// 3. the same amount twice on the same day, ticket overpaid: "same payment twice" only
{
  const r = run([T("C", "BUY", "2026-09-12", 1000, 1000000)], [BUYP("C", 1000000), BUYP("C", 1000000)]);
  ok(r.open[0]?.problems.join() === "double", "3: duplicate = double (not also overpaid)", r.open[0]?.problems);
}
// 4. two equal instalments that settle the ticket exactly are NOT a problem
{
  const r = run([T("C2", "SELL", "2026-09-12", 20000, 20000000)], [SELLP("C2", 10000000), SELLP("C2", 10000000)]);
  ok(r.open.length === 0, "4: 10M + 10M on a 20M sale is fine", r.open[0]?.problems);
}
// 5. a sale with nothing received after 29 days (CN INV-556009597-B)
{
  const r = run([T("D", "SELL", "2026-09-13", 47190, 49549500)], []);
  ok(r.open[0]?.problems.join() === "owed_buyer" && r.open[0]?.gap === 49549500, "5: unpaid sale listed", r.open[0]);
  ok(r.totals.owedByBuyers === 49549500 && r.totals.owedByBuyersN === 1 && r.totals.oldestDays === 29, "5: totals", r.totals);
}
// 6. ages: a 2-day-old sale is not chased yet; a 2-day-old unpaid buy is
{
  const r = run([T("E", "SELL", "2026-10-10", 1000, 1000000), T("F", "BUY", "2026-10-10", 1000, 1000000), T("G", "BUY", "2026-10-12", 1000, 1000000)], []);
  ok(ids(r).join() === "F", "6: only the 2-day-old unpaid buy", ids(r));
}
// 7. payments are counted only by their right kind (as Transactions.jsx does)
{
  const r = run([T("H1", "BUY", "2026-09-01", 1000, 1000000)], [P("H1", 1000000, "receive_customer", { created_at: "2026-09-01T03:00:00Z" })]);
  ok(r.open[0]?.problems.includes("owed_farmer") && r.open[0]?.problems.includes("wrong_type") && r.open[0]?.paid === 0,
    "7: buyer money on a purchase is not 'paid' and is flagged", r.open[0]?.problems);
}
// 8. exactly 10 ៛/kg short (RK 05/10): the card says so — measured on paid kilos
{
  const r = run([T("H", "SELL", "2026-10-05", 38165, 36638400)], [SELLP("H", 36256750)]);
  ok(r.open[0]?.gap === 381650 && r.open[0]?.perKg === 10, "8: 381,650 on 38,165 kg = 10 ៛/kg", r.open[0]);
  ok(perKgHint(1057350, 35245) === 30, "8: RK INV-910497928-B = 30 ៛/kg");
  ok(perKgHint(6837699, 6810) === null, "8: a random gap is not called a price change");
  const d = run([T("H2", "SELL", "2026-09-01", 10000, 9500000, { deduction_kg: 500 })], [SELLP("H2", 9405000)]);
  ok(d.open[0]?.perKg === 10, "8: with a 500 kg deduction, 95,000 on 9,500 kg = 10 ៛/kg", d.open[0]);
}
// 9. 0 ៛ purchase (PP 28/09): fix now, with what the load is worth that day
{
  const r = run([T("I", "BUY", "2026-09-28", 3630, 0), T("I2", "BUY", "2026-09-28", 1000, 1000000, { created_at: "2026-09-28T03:00:00Z" })],
    [BUYP("I2", 1000000, { created_at: "2026-09-28T03:00:00Z" })]);
  ok(r.open[0]?.problems.join() === "zero_price" && r.open[0]?.estimate === 3630000, "9: priceless load, worth ≈ 3,630 kg × 1,000", r.open[0]);
}
// 10. a sale waiting for the mill's price is normal for a week, then it is fix-now
{
  const r = run([T("S0", "SELL", "2026-10-10", 5000, 0, { price_per_kg: null }), T("S1", "SELL", "2026-10-01", 5000, 0, { price_per_kg: null })], []);
  ok(ids(r).join() === "S1" && r.open[0].problems.join() === "no_sell_price" && r.open[0].severity === 1, "10: unpriced sale after 7 days = fix now", r.open.map((x) => x.problems));
}
// 11. a fully rejected load (deduction = weight) at a real price is not "no price"
{
  const r = run([T("J0", "BUY", "2026-09-01", 1000, 0, { price_per_kg: 1000, deduction_kg: 1000 })], []);
  ok(r.open.length === 0, "11: rejected load not listed", r.open[0]?.problems);
}
// 12. small gaps (< 1,000 ៛) are rounding; cancelled tickets and voided payments
{
  const r = run([T("J", "BUY", "2026-09-01", 1000, 1000500), T("K", "SELL", "2026-09-01", 1000, 1000000, { hq_status: "cancelled" }), T("L", "BUY", "2026-09-01", 1000, 1000000)],
    [BUYP("J", 1000000, { created_at: "2026-09-01T03:00:00Z" }), BUYP("L", 1000000, { voided_at: "2026-09-02" })]);
  ok(ids(r).join() === "L" && MIN_GAP === 1000, "12: only L (voided payment does not count)", ids(r));
}
// 13. paid late: the 18 of 19/10 — payment typed weeks after the ticket was entered
{
  const r = run([T("M", "SELL", "2026-09-13", 47190, 49549500)],
    [SELLP("M", 49549500, { pay_date: "2026-09-13", created_at: "2026-10-19T02:00:00Z", memo: "Marked paid by owner" })], [], "2026-10-19");
  ok(r.open[0]?.problems.join() === "paid_late" && r.open[0]?.severity === 3 && r.open[0]?.lateSum === 49549500, "13: closed late = owner check", r.open[0]);
  ok(r.totals.paidLateN === 1 && r.totals.oldestDays === 0, "13: counted as check, not as owed", r.totals);
  // a paper book typed in weeks later (ticket and payment entered together) is not late
  const b = run([T("M2", "BUY", "2026-08-20", 1000, 1000000, { created_at: "2026-09-25T03:00:00Z" })],
    [BUYP("M2", 1000000, { created_at: "2026-09-25T03:05:00Z" })], [], "2026-10-19");
  ok(b.open.length === 0, "13: back-filled paper book is not 'late'", b.open[0]?.problems);
  // never expires: still listed months later until the owner ticks it
  const o = run([T("M3", "SELL", "2026-09-30", 1000, 1000000)], [SELLP("M3", 1000000, { created_at: "2026-10-20T03:00:00Z" })], [], "2027-02-01");
  ok(o.open[0]?.problems.join() === "paid_late", "13: an unchecked late payment never drops off by itself", o.open[0]?.problems);
}
// 13a. a mill paying by bank 15 days after the sale, recorded the day it arrives, is NOT late
{
  const r = run([T("MB", "SELL", "2026-10-02", 1000, 1000000)],
    [SELLP("MB", 1000000, { pay_date: "2026-10-17", created_at: "2026-10-17T05:00:00Z" })], [], "2026-10-19");
  ok(r.open.length === 0, "13a: late money recorded on its own date is fine", r.open[0]?.problems);
  // ... but the same payment dated back to the sale day is
  const b = run([T("MB2", "SELL", "2026-10-02", 1000, 1000000)],
    [SELLP("MB2", 1000000, { pay_date: "2026-10-02", created_at: "2026-10-17T05:00:00Z", created_by: "u1" })], [], "2026-10-19");
  ok(b.open[0]?.problems.join() === "paid_late" && b.open[0].latePaidBy.join() === "u1", "13a: back-dated payment flagged, with who typed it", b.open[0]);
}
// 13b. the 10/09 back-fill (payments typed before LATE_SINCE) is never "late"
{
  const r = run([T("BF", "SELL", "2026-08-24", 1000, 1000000)], [SELLP("BF", 1000000, { created_at: "2026-09-10T03:00:00Z" })], [], "2026-09-20");
  ok(r.open.length === 0, "13b: payments before 01/10 are never late", r.open[0]?.problems);
}
// 14. explained + approved → leaves the list; pending → stays, marked waiting
{
  const tx = [T("D", "SELL", "2026-09-13", 47190, 49549500)];
  const a = run(tx, [], [N("D", "owed_buyer", 49549500)]);
  ok(a.open.length === 0 && a.done.length === 1, "14: approved note clears it", a);
  const p = run(tx, [], [N("D", "owed_buyer", 49549500, { approved_at: null })]);
  ok(p.open.length === 1 && p.open[0].waitingForOwner && p.totals.waitingForOwner === 1, "14: pending note keeps it listed", p.totals);
  ok(totalsOf(p.open).waitingForOwner === 1, "14: totalsOf gives the same totals");
}
// 15. the money moves again → the gap changes → it comes back
{
  const r = run([T("H", "SELL", "2026-10-05", 38165, 36638400)], [SELLP("H", 36256750), SELLP("H", 100000, { pay_date: "2026-10-06" })], [N("H", "owed_buyer", 381650)]);
  ok(r.open.length === 1 && r.done.length === 0, "15: a different gap is not hidden by an old note", r);
}
// 16. put back on the list
{
  const notes = [N("H", "owed_buyer", 381650, { reopened_at: "2026-10-14T01:00:00Z" })];
  const r = run([T("H", "SELL", "2026-10-05", 38165, 36638400)], [SELLP("H", 36256750)], notes);
  ok(r.open.length === 1 && liveNotes(notes).size === 0, "16: a reopened note no longer hides the ticket", r);
}
// 17. a ticket with an explainable and a fix-now problem: the note cannot clear it
{
  const r = run([T("Q", "BUY", "2026-09-01", 1000, 1000000)], [P("Q", 500000, "receive_customer", { created_at: "2026-09-01T03:00:00Z" })], [N("Q", "owed_farmer", 1000000)]);
  ok(r.open.length === 1 && r.open[0].problems.includes("wrong_type"), "17: wrong payment kind still needs fixing", r.open[0]?.problems);
}
// 18. order: fix-now first, then the biggest money
{
  const r = run([T("S1", "SELL", "2026-09-01", 1000, 5000000), T("S2", "SELL", "2026-09-01", 1000, 9000000), T("Z", "BUY", "2026-09-01", 10, 0)], []);
  ok(r.open.map((x) => x.id).join() === "Z,S2,S1", "18: order", r.open.map((x) => x.id));
}

console.log(fails ? `\n${fails} CHECK(S) FAILED` : "All money-check guards passed (1–18, 13a, 13b).");
process.exit(fails ? 1 : 0);
