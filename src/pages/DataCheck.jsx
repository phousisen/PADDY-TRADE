import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Search, AlertTriangle, History, RefreshCw, CheckCircle2 } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";

// [2026-09-09] Data Check — the screen that would have caught CN 000261 on
// the day instead of six days later.
//
// The story it exists for: on 07/09 a Jomnoum sale was finished with the
// two scale readings in the wrong boxes, because the empty weighing was
// never taken and staff put the only number they had into the first field.
// The net computed as -33,780 kg, the app clamped it to zero, and the
// station's stock claimed it still held 33,780 kg of rice that had already
// left on a truck. Nothing in the app showed this. It surfaced only because
// the stock total on the dashboard looked wrong, and it took two days to
// prove what had happened.
//
// Two tabs, two different jobs:
//
//   Checks   — reads v_ticket_mismatches (ticket_mismatch_view_v2.sql).
//              The weighing ticket is the physical record; the transaction
//              is a copy of it, and stock/receipts/reports all run on the
//              copy. This lists every place the two disagree. An EMPTY list
//              is the normal state — that is the whole point. A list that
//              always has rows on it stops being read.
//
//   History  — reads row_history (row_history_2026-09-09.sql), the
//              database's own permanent record of every change to money,
//              weight, stock and permissions across 15 tables. Written by a
//              database trigger, not by this app, so it also captures
//              changes made directly in the Supabase editor, and nobody can
//              edit or delete it — including this app.
//
// Both reads are read-only, and both are safe for a view-only account
// (api.js's proxy allows any method whose name starts with "get").

const REASON_META = {
  copy_differs: {
    label: "Transaction ≠ ticket",
    tone: "amber",
    plain: "Someone corrected one of these and not the other. The scale reading and the transaction no longer agree.",
  },
  station_weight_zero: {
    label: "Station weight is zero",
    tone: "rose",
    plain: "The ticket shows a real load but the station weight was saved as zero, so this station's stock is holding rice that already left.",
  },
  ticket_impossible: {
    label: "Ticket can't be true",
    tone: "rose",
    plain: "On a sale the truck must leave heavier than it arrived; on a purchase, lighter. This one doesn't. The two readings are almost certainly in the wrong boxes.",
  },
};

const TONE = {
  rose: { chip: "bg-rose-100 text-rose-700", card: "border-rose-200 bg-rose-50/40" },
  amber: { chip: "bg-amber-100 text-amber-700", card: "border-amber-200 bg-amber-50/40" },
};

// Only the columns a person would actually ask about. Anything changed that
// isn't listed here still shows, using its raw column name — better an ugly
// label than a change nobody is told about.
const FIELD_LABELS = {
  gross_kg: "Weigh-in (kg)", tare_kg: "Weigh-out (kg)",
  gross_at: "Weigh-in time", tare_at: "Weigh-out time",
  quantity_kg: "Net weight (kg)", station_quantity_kg: "Station weight (kg)",
  price_per_kg: "Price per kg", amount: "Amount", total_with_tax: "Total with tax",
  payment_status: "Payment status", hq_status: "Status", tx_date: "Transaction date",
  paper_ticket_no: "Paper ticket no.", quality_grade: "Grade", deduction_kg: "Deduction (kg)",
  staff_fee: "Staff fee", note: "Note", car_plate: "Truck plate", stage: "Ticket stage",
  current_stock_kg: "Stock on hand (kg)", adjustment_kg: "Stock adjustment (kg)",
  bank_name: "Bank", bank_account: "Bank account", name: "Name", phone: "Phone",
  role: "Role", location_id: "Station", product_id: "Paddy type", party_id: "Farmer / buyer",
};

// Columns that change on their own and would bury the real edit.
const NOISE_FIELDS = new Set(["updated_at", "updated_ago", "paper_ticket_no_normalized", "payable_kg", "tax_amount"]);

const TABLE_LABELS = {
  transactions: "Transaction", weighing_tickets: "Weighing ticket", payments: "Payment",
  stock_adjustments: "Stock adjustment", parties: "Farmer / buyer", locations: "Station",
  profiles: "User", roles: "Role", products: "Paddy type", partners: "Partner",
  bank_loans: "Bank loan", partner_capital_entries: "Capital entry",
  change_requests: "Change request", scale_readings: "Scale reading", system_settings: "Setting",
};

function fmtNum(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return new Intl.NumberFormat("en-US").format(n);
}

function fmtValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return new Intl.NumberFormat("en-US").format(v);
  const s = String(v);
  // Timestamps are shown in Cambodia time, same as every other screen.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(d);
    }
  }
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Phnom_Penh", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

// What actually changed between the two snapshots. An INSERT has no
// old_data and a DELETE has no new_data, so both sides are handled.
function diffFields(oldData, newData) {
  const o = oldData || {};
  const n = newData || {};
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => !NOISE_FIELDS.has(k));
  const out = [];
  for (const k of keys) {
    const a = o[k] ?? null;
    const b = n[k] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push({ key: k, label: FIELD_LABELS[k] || k, from: a, to: b });
  }
  // Weights and money first — that is what anyone opening this is looking for.
  const priority = ["gross_kg", "tare_kg", "quantity_kg", "station_quantity_kg", "price_per_kg", "amount"];
  out.sort((x, y) => {
    const ix = priority.indexOf(x.key), iy = priority.indexOf(y.key);
    if (ix !== -1 || iy !== -1) return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
    return x.label.localeCompare(y.label);
  });
  return out;
}

function describeRow(r) {
  const reasons = String(r.reason || "").split(" + ").filter(Boolean);
  return reasons.map((k) => REASON_META[k]).filter(Boolean);
}

function MismatchCard({ row }) {
  const metas = describeRow(row);
  const worst = metas.some((m) => m.tone === "rose") ? "rose" : "amber";
  const isBuy = row.type === "BUY";
  return (
    <div className={`rounded-xl border p-4 ${TONE[worst].card}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${isBuy ? "bg-brand-100 text-brand-700" : "bg-rose-100 text-rose-700"}`}>
              {isBuy ? "▲ BUY" : "▼ SELL"}
            </span>
            <span className="font-bold text-slate-800">{row.paper_ticket_no || row.code}</span>
            {row.paper_ticket_no && <span className="text-xs text-slate-400">{row.code}</span>}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {row.station_name || "—"} · {row.tx_date || "—"}{row.party_name ? ` · ${row.party_name}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {metas.map((m) => (
            <span key={m.label} className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${TONE[m.tone].chip}`}>{m.label}</span>
          ))}
        </div>
      </div>

      {metas.map((m) => (
        <p key={m.label} className="mt-2 text-xs leading-relaxed text-slate-600">{m.plain}</p>
      ))}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[460px] text-xs">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-slate-400">
              <th className="pb-1 text-left font-bold">&nbsp;</th>
              <th className="pb-1 text-right font-bold">Weigh-in</th>
              <th className="pb-1 text-right font-bold">Weigh-out</th>
              <th className="pb-1 text-right font-bold">Net</th>
            </tr>
          </thead>
          <tbody className="font-medium tabular-nums text-slate-700">
            <tr className="border-t border-slate-200">
              <td className="py-1.5 text-slate-500">Scale (ticket)</td>
              <td className="py-1.5 text-right">{fmtNum(row.ticket_weigh_in_kg)}</td>
              <td className="py-1.5 text-right">{fmtNum(row.ticket_weigh_out_kg)}</td>
              <td className={`py-1.5 text-right ${Number(row.ticket_net_kg) <= 0 ? "font-bold text-rose-600" : ""}`}>{fmtNum(row.ticket_net_kg)}</td>
            </tr>
            <tr className="border-t border-slate-200">
              <td className="py-1.5 text-slate-500">Transaction</td>
              <td className={`py-1.5 text-right ${row.tx_weigh_in_kg !== row.ticket_weigh_in_kg ? "font-bold text-amber-700" : ""}`}>{fmtNum(row.tx_weigh_in_kg)}</td>
              <td className={`py-1.5 text-right ${row.tx_weigh_out_kg !== row.ticket_weigh_out_kg ? "font-bold text-amber-700" : ""}`}>{fmtNum(row.tx_weigh_out_kg)}</td>
              <td className="py-1.5 text-right">{fmtNum(row.tx_quantity_kg)}</td>
            </tr>
            {row.station_quantity_kg !== null && row.station_quantity_kg !== undefined && (
              <tr className="border-t border-slate-200">
                <td className="py-1.5 text-slate-500">Station weight (drives stock)</td>
                <td className="py-1.5 text-right text-slate-300">—</td>
                <td className="py-1.5 text-right text-slate-300">—</td>
                <td className={`py-1.5 text-right ${Number(row.station_quantity_kg) === 0 ? "font-bold text-rose-600" : ""}`}>{fmtNum(row.station_quantity_kg)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryCard({ entry }) {
  const fields = useMemo(() => diffFields(entry.old_data, entry.new_data), [entry.old_data, entry.new_data]);
  const snap = entry.new_data || entry.old_data || {};
  const ticket = snap.paper_ticket_no || snap.code || snap.name || entry.record_id?.slice(0, 8) || "—";
  const actionMeta = {
    INSERT: { label: "Created", chip: "bg-brand-100 text-brand-700" },
    UPDATE: { label: "Changed", chip: "bg-amber-100 text-amber-700" },
    DELETE: { label: "Deleted", chip: "bg-rose-100 text-rose-700" },
  }[entry.action] || { label: entry.action, chip: "bg-slate-100 text-slate-600" };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${actionMeta.chip}`}>{actionMeta.label}</span>
            <span className="text-xs font-semibold text-slate-500">{TABLE_LABELS[entry.table_name] || entry.table_name}</span>
            <span className="font-bold text-slate-800">{ticket}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">{fmtWhen(entry.changed_at)} · by {entry.userName}</div>
        </div>
      </div>

      {entry.action === "UPDATE" && fields.length === 0 && (
        <p className="mt-2 text-xs text-slate-400">No visible field changed.</p>
      )}

      {entry.action === "UPDATE" && fields.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wide text-slate-400">
                <th className="pb-1 text-left font-bold">Field</th>
                <th className="pb-1 text-left font-bold">Before</th>
                <th className="pb-1 text-left font-bold">After</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.key} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 font-medium text-slate-600">{f.label}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-400 line-through">{fmtValue(f.from)}</td>
                  <td className="py-1.5 font-semibold tabular-nums text-slate-800">{fmtValue(f.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entry.action !== "UPDATE" && (
        <p className="mt-2 text-xs text-slate-500">
          {entry.action === "INSERT" ? "This record was created." : "This record was deleted. Its full contents are kept in the history and can never be removed."}
        </p>
      )}
    </div>
  );
}

export default function DataCheck() {
  const [tab, setTab] = useState("checks");
  const [mismatches, setMismatches] = useState(null);
  const [history, setHistory] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadChecks = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setMismatches(await api.getTicketMismatches());
    } catch (e) {
      // The view lives in the database (ticket_mismatch_view_v2.sql). If it
      // has not been created yet, say so plainly instead of showing a raw
      // PostgREST error nobody can act on.
      setError(
        /v_ticket_mismatches|does not exist|schema cache/i.test(e?.message || "")
          ? "The ticket check hasn't been set up in the database yet. Ask your administrator to run ticket_mismatch_view_v2.sql."
          : (e?.message || "Could not load the ticket checks.")
      );
    } finally { setLoading(false); }
  }, []);

  const loadHistory = useCallback(async (q) => {
    setLoading(true); setError("");
    try {
      setHistory(await api.getRowHistory({ ticketNo: q, limit: 100 }));
    } catch (e) {
      setError(
        /row_history|does not exist|schema cache/i.test(e?.message || "")
          ? "The change history hasn't been set up in the database yet. Ask your administrator to run row_history_2026-09-09.sql."
          : (e?.message || "Could not load the change history.")
      );
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === "checks" && mismatches === null) loadChecks();
    if (tab === "history" && history === null) loadHistory("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const clean = tab === "checks" && Array.isArray(mismatches) && mismatches.length === 0;

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Data Check" subtitle="Where the paperwork and the scale disagree, and everything that has been changed" />
      <main className="flex-1 overflow-y-auto bg-paper p-6">

        <div className="mb-5 flex gap-2">
          <button
            onClick={() => setTab("checks")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${tab === "checks" ? "bg-brand-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            <ShieldCheck size={15} /> Checks
            {Array.isArray(mismatches) && mismatches.length > 0 && (
              <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">{mismatches.length}</span>
            )}
          </button>
          <button
            onClick={() => setTab("history")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${tab === "history" ? "bg-brand-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            <History size={15} /> Change history
          </button>
          <button
            onClick={() => (tab === "checks" ? loadChecks() : loadHistory(search))}
            disabled={loading}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
        )}

        {tab === "checks" && (
          <>
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-slate-300" />
              <span>
                The weighing ticket is what the scale actually read. The transaction is a copy of it, and the stock, receipts and reports
                all run on the copy. Anything listed here means the two no longer tell the same story — check the paper ticket before
                trusting either figure. An empty list is the normal state.
              </span>
            </div>

            {loading && mismatches === null && <p className="px-1 py-10 text-center text-sm text-slate-400">Loading…</p>}

            {clean && (
              <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-6 py-12 text-center">
                <CheckCircle2 size={30} className="mx-auto mb-3 text-brand-600" />
                <p className="text-sm font-bold text-slate-700">Every transaction agrees with its weighing ticket.</p>
                <p className="mt-1 text-xs text-slate-500">Nothing needs looking at.</p>
              </div>
            )}

            {Array.isArray(mismatches) && mismatches.length > 0 && (
              <div className="space-y-3">
                {mismatches.map((row) => <MismatchCard key={row.transaction_id} row={row} />)}
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            <form
              onSubmit={(e) => { e.preventDefault(); loadHistory(search); }}
              className="mb-4 flex flex-wrap items-center gap-2"
            >
              <div className="relative flex-1 min-w-[220px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Paper ticket number — e.g. CN 000261"
                  className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Search</button>
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); loadHistory(""); }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
            </form>

            <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
              <History size={14} className="mt-0.5 shrink-0 text-slate-300" />
              <span>
                Every change to money, weight, stock and permissions is recorded here permanently, with what it was before and what it
                became. The database writes this itself, so it also captures changes made outside the app — and nobody can edit or delete
                it. Recording started on 9 September 2026; anything before that date is not here.
              </span>
            </div>

            {loading && history === null && <p className="px-1 py-10 text-center text-sm text-slate-400">Loading…</p>}

            {Array.isArray(history) && history.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
                <p className="text-sm font-semibold text-slate-600">
                  {search ? `Nothing recorded for "${search}" yet.` : "Nothing recorded yet."}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {search
                    ? "Either nothing has changed on that ticket since recording started, or the number is different — check the paper ticket."
                    : "Changes will appear here as soon as anyone edits something."}
                </p>
              </div>
            )}

            {Array.isArray(history) && history.length > 0 && (
              <div className="space-y-3">
                {history.map((entry) => <HistoryCard key={entry.id} entry={entry} />)}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
