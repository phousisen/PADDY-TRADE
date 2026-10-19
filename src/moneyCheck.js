// [2026-10-19] Data Check → Money. Every ticket where the money does not match.
//
// The story it exists for: on 12/10 the finance check found 19 tickets whose
// money did not match the ticket, the oldest a month old — a 49.5M ៛ Jomnoum
// sale with nothing received, a Ping Pong farmer paid twice, four Reang Kesey
// sales each exactly 10 ៛/kg short, 0 ៛ loads. Every one of them was already
// in the app; no screen put them in one place, so nobody saw them until an
// outside check read the whole table. Then 18 were closed in one go by
// payments nobody had checked. This is that check, inside the app, live —
// and it also shows payments recorded long after their ticket, so a list can
// never again be "cleaned" without the owner seeing it.
//
// Pure: takes the rows the page fetched and returns the list. Nothing here
// reads the network or React, so scripts-check-money.mjs tests it.
//
// MONEY IS COUNTED EXACTLY AS Transactions.jsx COUNTS IT (paidFor): on a Buy
// only "pay_supplier" payments, on a Sell only "receive_customer". Anything
// else attached to a ticket is its own problem (wrong_type), never "paid".
//
// What is listed (cancelled tickets never are; gaps under 1,000 ៛ are
// rounding):
//   FIX NOW (1) — wrong records; only fixing the record clears them
//     zero_price    a Buy with kilos but no price
//     no_sell_price a Sell still without its price after BUYER_DAYS
//     double        paid too much AND two identical payments (same kind, amount, day)
//     overpaid      paid / received more than the ticket
//     wrong_type    a payment of the wrong kind on the ticket
//   OWED (2) — money still to move
//     owed_farmer   a Buy not fully paid after FARMER_DAYS
//     owed_buyer    a Sell not fully received after BUYER_DAYS
//   CHECK (3)
//     paid_late     "recorded late": a payment typed in more than LATE_DAYS
//                   after the date written on it (back-dated), since
//                   LATE_SINCE. A mill paying by bank two weeks after the
//                   sale, recorded the day it arrives, is NOT late. Stays
//                   listed until checked — it never just expires. The person
//                   who typed the payment cannot check it.
//
// Only owed_farmer, owed_buyer and paid_late can be "explained" (EXPLAINABLE);
// paid_late never by the person who typed that payment. A wrong record is fixed, not explained. An
// explanation by anyone but the owner waits for the owner's OK and does not
// clear the ticket until then (a limit by amount was tried and is easy to
// walk under with a small part-payment first). The database enforces the
// same rules (FOR-SUPABASE-money-check-notes-2026-10-19.sql).

export const MIN_GAP = 1000;
export const FARMER_DAYS = 2;        // every finished Buy is paid on the spot
export const BUYER_DAYS = 7;         // a Sell may be paid by bank a few days later
export const LATE_DAYS = 7;
// Payments recorded before this day are never "late": the 10/09 clean-up
// back-filled 141 old sales as paid in one go, on purpose and already checked.
export const LATE_SINCE = "2026-10-01";
export const EXPLAINABLE = ["owed_farmer", "owed_buyer", "paid_late"];
export const OWNER_ONLY = [];

const SEVERITY = { zero_price: 1, no_sell_price: 1, double: 1, overpaid: 1, wrong_type: 1, owed_farmer: 2, owed_buyer: 2, paid_late: 3 };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const billOf = (tx) => num(tx.total_with_tax ?? tx.amount);
const payableKg = (tx) => Math.max(0, num(tx.quantity_kg) - num(tx.deduction_kg));
const matchingType = (tx) => (tx.type === "BUY" ? "pay_supplier" : "receive_customer");

// Calendar days between two YYYY-MM-DD dates (or ISO timestamps, read as
// their Cambodia date by the caller).
export function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toIso).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

// Cambodia date of a timestamp (UTC+7, no daylight saving).
export function khDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso || "").slice(0, 10);
  return new Date(t + 7 * 3600000).toISOString().slice(0, 10);
}

// A gap that is a whole number of riel per kilo (5, 10, 30 ៛/kg …) almost
// always means the price changed after the money moved — the mill cut the
// price, or the ticket was edited. Measured on the kilos actually paid for.
export function perKgHint(gap, kg) {
  const k = num(kg);
  const g = Math.abs(num(gap));
  if (k <= 0 || g <= 0) return null;
  const whole = Math.round(g / k);
  if (whole < 1 || whole > 100) return null;
  return Math.abs(g - whole * k) < 1 ? whole : null;
}

export const noteKey = (txId, problem) => `${txId}|${problem}`;

// Newest live (not put back) note per ticket + problem.
export function liveNotes(notes) {
  const out = new Map();
  for (const n of notes || []) {
    if (n.reopened_at) continue;
    const k = noteKey(n.transaction_id, n.problem);
    const prev = out.get(k);
    if (!prev || String(n.created_at) > String(prev.created_at)) out.set(k, n);
  }
  return out;
}

const median = (xs) => {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export function findMoneyProblems({ txs = [], payments = [], notes = [], today }) {
  const byTx = new Map();
  for (const p of payments) {
    if (!p.transaction_id || p.voided_at) continue;
    if (!byTx.has(p.transaction_id)) byTx.set(p.transaction_id, []);
    byTx.get(p.transaction_id).push(p);
  }
  // For a priceless load: what it is roughly worth. That station's usual
  // price that day for the same kind (buy / sell); else any station that
  // day; else the nearest days at that station; else that kind's usual price.
  const prices = new Map();
  const addP = (k, v) => { if (!prices.has(k)) prices.set(k, []); prices.get(k).push(v); };
  for (const t of txs) {
    const v = num(t.price_per_kg);
    if (v <= 0 || (t.hq_status || "processing") === "cancelled") continue;
    addP(`${t.type}|${t.location_id}|${t.tx_date}`, v);
    addP(`${t.type}|*|${t.tx_date}`, v);
    addP(`${t.type}|${t.location_id}|*`, v);
    addP(`${t.type}|*|*`, v);
  }
  const priceFor = (t) => {
    const near = [];
    for (let d = -3; d <= 3; d++) {
      const day = new Date(Date.parse(`${t.tx_date}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
      near.push(...(prices.get(`${t.type}|${t.location_id}|${day}`) || []));
    }
    return median(prices.get(`${t.type}|${t.location_id}|${t.tx_date}`) || [])
      || median(prices.get(`${t.type}|*|${t.tx_date}`) || [])
      || median(near)
      || median(prices.get(`${t.type}|*|*`) || []);
  };
  const explained = liveNotes(notes);

  const rows = [];
  for (const t of txs) {
    if ((t.hq_status || "processing") === "cancelled") continue;
    const isBuy = t.type === "BUY";
    const total = billOf(t);
    const kgPaid = payableKg(t);
    const mine = byTx.get(t.id) || [];
    const right = mine.filter((p) => p.type === matchingType(t));
    const wrong = mine.filter((p) => p.type !== matchingType(t));
    const paid = right.reduce((s, p) => s + num(p.amount), 0);
    const wrongSum = wrong.reduce((s, p) => s + num(p.amount), 0);
    const gap = Math.round(total - paid);           // > 0 still owed, < 0 too much
    const age = today ? daysBetween(t.tx_date, today) : 0;
    const noPrice = t.price_per_kg == null || num(t.price_per_kg) <= 0;

    const problems = [];
    if (isBuy && noPrice && kgPaid > 0) problems.push("zero_price");
    if (!isBuy && noPrice && kgPaid > 0 && age >= BUYER_DAYS) problems.push("no_sell_price");
    if (-gap >= MIN_GAP) {
      const seen = new Map();
      let dup = false;
      for (const p of right) {
        const k = `${Math.round(num(p.amount))}|${String(p.pay_date || "").slice(0, 10)}`;
        if (seen.has(k) && Math.round(num(p.amount)) >= MIN_GAP) dup = true;
        seen.set(k, 1);
      }
      problems.push(dup ? "double" : "overpaid");
    }
    if (Math.abs(wrongSum) >= MIN_GAP) problems.push("wrong_type");
    if (gap >= MIN_GAP && total > 0) {
      if (isBuy && age >= FARMER_DAYS) problems.push("owed_farmer");
      if (!isBuy && age >= BUYER_DAYS) problems.push("owed_buyer");
    }
    // Recorded late = typed in more than LATE_DAYS after the date written on
    // the payment. That is a back-dated entry: the cash book of an earlier
    // day changed weeks afterwards. (A bank payment that simply arrives late
    // is dated the day it arrives and is not flagged.)
    const entered = t.created_at ? khDate(t.created_at) : t.tx_date;
    const late = right.filter((p) => p.created_at && p.pay_date
      && daysBetween(String(p.pay_date).slice(0, 10), khDate(p.created_at)) > LATE_DAYS
      && khDate(p.created_at) >= LATE_SINCE);
    const lateSum = Math.round(late.reduce((s, p) => s + num(p.amount), 0));
    if (late.length) problems.push("paid_late");
    if (!problems.length) continue;

    const est = problems.includes("zero_price") || problems.includes("no_sell_price")
      ? Math.round(kgPaid * priceFor(t))
      : 0;
    // The amount each problem is about — what a note must match.
    const gapFor = (p) => (p === "paid_late" ? lateSum : p === "wrong_type" ? Math.round(wrongSum) : gap);

    const noteFor = {};
    let cleared = true;
    for (const p of problems) {
      const n = explained.get(noteKey(t.id, p));
      const fits = n && Math.abs(Math.round(num(n.gap)) - gapFor(p)) < 1;
      noteFor[p] = fits ? n : null;
      if (!(fits && n.approved_at)) cleared = false;
    }

    rows.push({
      id: t.id,
      code: t.code,
      paperNo: t.paper_ticket_no || "",
      type: t.type,
      locationId: t.location_id,
      stationName: t.stationName || "—",
      partyId: t.party_id || null,
      partyName: t.partyName || "",
      recordedBy: t.created_by || null,
      date: t.tx_date,
      enteredOn: entered,
      age,
      kg: num(t.quantity_kg),
      kgPaid,
      price: num(t.price_per_kg),
      total,
      paid,
      gap,
      wrongSum: Math.round(wrongSum),
      lateSum,
      estimate: est,
      perKg: Math.abs(gap) >= MIN_GAP ? perKgHint(gap, kgPaid) : null,
      payments: [...right, ...wrong].sort((a, b) => String(a.created_at || a.pay_date).localeCompare(String(b.created_at || b.pay_date))),
      latePaymentIds: late.map((p) => p.id),
      latePaidBy: [...new Set(late.map((p) => p.created_by).filter(Boolean))],
      problems,
      gapFor: Object.fromEntries(problems.map((p) => [p, gapFor(p)])),
      notes: noteFor,
      waitingForOwner: problems.some((p) => noteFor[p] && !noteFor[p].approved_at),
      severity: Math.min(...problems.map((p) => SEVERITY[p])),
      cleared,
    });
  }

  // Biggest money first inside each group; the oldest breaks a tie.
  const weight = (r) => Math.max(Math.abs(r.gap), r.estimate, r.lateSum, Math.abs(r.wrongSum));
  const order = (a, b) => a.severity - b.severity || weight(b) - weight(a) || String(a.date).localeCompare(String(b.date));
  const open = rows.filter((r) => !r.cleared).sort(order);
  const done = rows.filter((r) => r.cleared).sort(order);

  return { open, done, totals: totalsOf(open) };
}

// The summary boxes. A function of the open rows alone, so a station's
// totals are just its own rows.
export function totalsOf(open) {
  const sum = (list, f) => list.reduce((s, r) => s + f(r), 0);
  const fixNow = open.filter((r) => r.severity === 1);
  const buyers = open.filter((r) => r.problems.includes("owed_buyer"));
  const farmers = open.filter((r) => r.problems.includes("owed_farmer"));
  const check = open.filter((r) => r.problems.includes("paid_late"));
  return {
    fixNow: fixNow.length,
    fixNowRiel: sum(fixNow, (r) => Math.max(Math.abs(r.gap), r.estimate, Math.abs(r.wrongSum))),
    owedByBuyers: sum(buyers, (r) => r.gap),
    owedByBuyersN: buyers.length,
    owedToFarmers: sum(farmers, (r) => r.gap),
    owedToFarmersN: farmers.length,
    paidLateN: check.length,
    paidLateRiel: sum(check, (r) => r.lateSum),
    oldestDays: open.filter((r) => r.severity < 3).reduce((m, r) => Math.max(m, r.age), 0),
    waitingForOwner: open.filter((r) => r.waitingForOwner).length,
  };
}
