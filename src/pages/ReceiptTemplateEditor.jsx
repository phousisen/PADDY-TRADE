// Retired [2026-08-25] — Receipt.jsx now uses a fixed, verified print design
// (logo + per-location address/phone, matching the Weigh-In Slip) and no
// longer exports DEFAULT_RECEIPT_TEMPLATE / mergeReceiptTemplate /
// ExactWeightTicket for this page to read and customize. This file used to
// import those three names from Receipt.jsx — once they were removed, that
// import broke the whole production build (Vite/Rollup fails the entire
// build if ANY imported module has an unresolved named import, even if the
// component using it is never actually rendered).
//
// App.jsx no longer renders <ReceiptTemplateEditor /> — it shows a plain
// "no longer used" notice for the "receipt-template" route instead. This
// file is kept as a tiny harmless placeholder (rather than deleted) purely
// so nothing importing it can ever break the build again.
export default function ReceiptTemplateEditor() {
  return (
    <div className="p-8 text-center text-sm text-slate-500">
      <p className="mb-1 text-base font-semibold text-slate-700">Receipt Template — no longer used</p>
      <p>Printed receipts and weigh-in slips now use a fixed design (with the company logo and each location's own address/phone). This page no longer has any effect on what gets printed.</p>
    </div>
  );
}
