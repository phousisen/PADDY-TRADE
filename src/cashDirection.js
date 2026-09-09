// [2026-09-09] Which way each kind of payment moves the cash.
//
// This lived only inside ReportCashFlow.jsx. The dashboard now shows a cash
// figure too, and two copies of this table would eventually disagree — one
// gets a new payment type, the other doesn't, and then the dashboard and the
// Cash Flow report show different numbers for the same money with nothing to
// say which is right. So it lives in one place and both import it.
//
// `journal` is deliberately null rather than true or false: a journal
// adjustment can go either way and the type alone does not say which. Every
// reader resolves it with `?? false`, which is what ReportCashFlow has always
// done — so a journal entry currently counts as money OUT. That is worth
// knowing and worth revisiting, but it is left exactly as it was: changing it
// here would silently move the Cash Flow report's running balance.
export const IS_INFLOW = {
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

// +amount for money coming in, −amount for money going out.
export function signedAmount(payment) {
  const inflow = IS_INFLOW[payment?.type] ?? false;
  const amount = Number(payment?.amount || 0);
  return inflow ? amount : -amount;
}

// What the business is holding, from every payment recorded up to now.
//
// It counts recorded PAYMENTS, not what transactions are worth: a sale
// nobody has paid for yet adds nothing here — it sits in "owed by buyers"
// instead. Voided payments never arrive (api.getPayments excludes them), and
// a cancelled transaction's payments are voided, so cancelled money leaves
// this figure by itself.
export function cashOnHand(payments) {
  let inflow = 0, outflow = 0;
  for (const p of payments || []) {
    const a = Number(p?.amount || 0);
    if (!a) continue;
    if (IS_INFLOW[p.type] ?? false) inflow += a;
    else outflow += a;
  }
  return { inflow, outflow, net: inflow - outflow };
}
