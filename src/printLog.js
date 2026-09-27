// [2026-09-27] EVERY TIME A RECEIPT IS PRINTED, AND WHEN.
//
// SISEN: "tracking how much reciept they have printed for each transaction,
// and what time they have printed… everytime thye wanna print, it should show
// the time."
//
// One load, one receipt. A second receipt for the same load is either a
// farmer who lost the first one — normal, and worth being able to see — or
// two pieces of paper being used as two loads. Nothing in this system has
// ever recorded which.
//
// ── What it can honestly say ──────────────────────────────────────────────
//
// It records that PRINT WAS ASKED FOR: which ticket, who, when, and from
// which screen. It CANNOT know whether paper came out. The browser hands the
// job to Windows and never hears back — pressing Print and then cancelling at
// the printer dialog looks exactly the same from here.
//
// So the number is "times Print was pressed". Everything below is named that
// way on purpose. A figure called "receipts printed" that is really "print
// attempts" is the kind of number people make decisions on and then discover
// was never what they thought.
//
// It is pure: it reads recorded entries and counts them. It prints nothing,
// records nothing and blocks nothing.

export const PRINT_ACTION = "print_receipt";

/**
 * Every print of one transaction, oldest first — the order they happened,
 * because this is a story about a piece of paper being made twice.
 *
 * @param {Array<{action?: string, created_at?: string, userName?: string,
 *                newData?: {from?: string, copy?: number}}>} rows audit entries
 * @returns {Array<{at: number, atIso: string, who: string, from: string, copy: number}>}
 */
export function printsOf(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r || r.action !== PRINT_ACTION) continue;
    const data = r.new_data || r.newData || {};
    // The moment Print was pressed, as the printing device recorded it. A
    // station that printed offline sends its entry later, and the row's own
    // created_at would then be the time it synced, not the time it printed.
    const iso = data.at || r.created_at;
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) continue;
    out.push({
      at: ms,
      atIso: iso,
      who: r.userName || "",
      // "receipt" or "slip" — the final receipt, or the weigh-in slip. They
      // are different pieces of paper and a reprint of one says nothing
      // about the other.
      from: data.from || "receipt",
      copy: 0, // filled in below, from the order rather than from the record
    });
  }
  out.sort((a, b) => a.at - b.at);
  // The copy number is worked out HERE, not taken from what was written down
  // at the time. A station that was offline records its print without knowing
  // what the others have done; only the full list, in order, knows which copy
  // a given print really was.
  const seen = new Map();
  for (const p of out) {
    const n = (seen.get(p.from) || 0) + 1;
    seen.set(p.from, n);
    p.copy = n;
  }
  return out;
}

/** How many times Print was pressed for this kind of paper. */
export function printCount(rows, from = "receipt") {
  return printsOf(rows).filter((p) => p.from === from).length;
}

/**
 * What the NEXT print of this paper would be — the number that goes on it.
 * 1 is the original and carries no copy mark; 2 and up say so, on the paper.
 */
export function nextCopyNumber(rows, from = "receipt") {
  return printCount(rows, from) + 1;
}

/**
 * The date and time as a weighbridge writes it: numbers only, Cambodia's own
 * clock, whatever the device is set to. Matches the dd/mm/yyyy convention
 * used on every other printed document here — a receipt read months later
 * must not depend on who printed it or where they were standing.
 */
export function fmtPrintedAt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Phnom_Penh",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}
