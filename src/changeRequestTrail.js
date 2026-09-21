// [2026-09-21] Who decided each change request, when, and what the ticket
// said BEFORE an approved change was applied.
//
// SISEN: "before we could track the details on what have changed in details
// etc, and who accepted it". The page compared each request with the ticket
// as it is now — right while the request waits, wrong once it is approved,
// because by then the ticket already holds the new values ("No field
// differences on file"). The values from before survive in the Activity Log
// entry written at the moment of approval; this matches those entries back
// to their requests. Pure — tested by scripts-check-cr-history.
//
//   approve_change_request: record_id = the transaction, old_data = the
//                           ticket before, user = who approved
//   reject_change_request:  record_id = the request, user = who rejected
//
// One transaction can have several requests over time, so an approval entry
// is matched to the request whose own decision time (resolved_at) it is
// closest to; for a request decided before resolved_at existed, the first
// approval entry after the request was made.

const ms = (iso) => (iso ? new Date(iso).getTime() : NaN);

export function matchDecisions(rows, logs, names = {}) {
  const out = new Map();
  const approveByTx = new Map();
  const rejectByReq = new Map();
  for (const l of logs || []) {
    const map = l.action === "approve_change_request" ? approveByTx : l.action === "reject_change_request" ? rejectByReq : null;
    if (!map) continue;
    if (!map.has(l.record_id)) map.set(l.record_id, []);
    map.get(l.record_id).push(l);
  }
  // Each approval entry may belong to one request only.
  const used = new Set();
  const decided = (rows || []).filter((r) => r.status === "approved" || r.status === "rejected")
    .sort((a, b) => ms(a.created_at) - ms(b.created_at));
  for (const r of decided) {
    let log = null;
    if (r.status === "approved") {
      const cands = (approveByTx.get(r.transaction_id) || [])
        .filter((l) => !used.has(l) && !(ms(l.created_at) < ms(r.created_at)));
      if (cands.length) {
        const target = ms(r.resolved_at);
        log = Number.isFinite(target)
          ? cands.reduce((best, l) => (Math.abs(ms(l.created_at) - target) < Math.abs(ms(best.created_at) - target) ? l : best))
          : cands.reduce((best, l) => (ms(l.created_at) < ms(best.created_at) ? l : best));
        used.add(log);
      }
    } else {
      const cands = rejectByReq.get(r.id) || [];
      log = cands[0] || null;
    }
    const byName = (r.resolved_by && names[r.resolved_by]) || log?.userName || "";
    out.set(r.id, {
      byName,
      at: r.resolved_at || log?.created_at || null,
      // Only an approval changes the ticket, so only an approval needs the
      // "before" from the log. A rejected request changed nothing: the ticket
      // as it is now is what it was then.
      before: r.status === "approved" ? (log?.old_data || null) : null,
      rejectReason: r.reject_reason || log?.new_data?.rejected_reason || null,
      found: !!log,
    });
  }
  return out;
}

// The request's "current" side for the comparison: the ticket as it was just
// before the change for an approved request, the ticket as it is now
// otherwise. `null` when an approved request's before-values are not on
// record (an approval older than the Activity Log).
export function beforeSide(req, decision) {
  if (req.status !== "approved") {
    return { tx: req.transactions || {}, partyName: req.currentPartyName };
  }
  if (!decision?.before) return null;
  const b = decision.before;
  return { tx: { ...(req.transactions || {}), ...b }, partyName: b.partyName ?? b.parties?.name ?? req.currentPartyName };
}
