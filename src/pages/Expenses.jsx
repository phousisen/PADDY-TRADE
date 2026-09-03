import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { getAccurateNow } from "../supabaseClient.js";
import { SummaryStrip, SummaryCell, TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";

function fmt(n) { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmtRiel(n) { return `${fmt(n)} ៛`; }
// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting — same helper used by every
// other page that stamps a business date (WeighingTickets, ReportCashFlow,
// ReportCapital, ...).
function cambodiaDateStr(d = getAccurateNow()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// YYYY-MM, used to group entries into the Monthly view.
function monthOf(dateStr) { return (dateStr || "").slice(0, 7); }

// Starting categories shown even before anyone has ever logged a matching
// expense. Real categories used across the team (read straight off the
// `category` column) are merged in below, so this list only ever grows —
// it's never a hard limit on what someone can type in the form.
const SEED_CATEGORIES = ["Staff", "Fuel", "Carrying Service", "Rent", "Repairs & Maintenance", "Utilities"];

// A small fixed color per category keeps the log/table legible without
// needing anyone to assign colors by hand — same "pick from a small fixed
// palette by name" approach used for status pills elsewhere in the app.
const DOT_COLORS = ["#217A4F", "#C7972C", "#0ea5e9", "#a855f7", "#e11d48", "#0891b2", "#65a30d", "#f97316"];
function colorFor(category, allCategories) {
  const idx = allCategories.indexOf(category);
  return DOT_COLORS[(idx < 0 ? 0 : idx) % DOT_COLORS.length];
}

function AddExpenseForm({ locations, isAdmin, defaultLocationId, categories, onAdd }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(categories[0] || "");
  const [customCategory, setCustomCategory] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(cambodiaDateStr());
  const [locationId, setLocationId] = useState(defaultLocationId || locations[0]?.id || "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!locationId && (defaultLocationId || locations[0]?.id)) setLocationId(defaultLocationId || locations[0].id); }, [locations, defaultLocationId]);

  function pickCategory(v) {
    if (v === "__new__") { setAddingCustom(true); setCustomCategory(""); return; }
    setAddingCustom(false);
    setCategory(v);
  }

  async function submit(e) {
    e.preventDefault();
    const finalCategory = addingCustom ? customCategory.trim() : category;
    if (!finalCategory || !amount || parseFloat(amount) <= 0 || !locationId) return;
    setSaving(true);
    try {
      await onAdd({ category: finalCategory, amount: parseFloat(amount), entryDate, locationId, note });
      setAmount(""); setNote(""); setAddingCustom(false); setCustomCategory("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
        <Plus size={14} /> Add Expense
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <label className="mb-1 block text-xs text-slate-500">Category</label>
        {addingCustom ? (
          <input autoFocus value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="New category name"
            className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        ) : (
          <select value={category} onChange={(e) => pickCategory(e.target.value)}
            className="min-w-[150px] rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__new__">+ Add new category…</option>
          </select>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">Amount (៛)</label>
        <input type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">Date</label>
        <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
      </div>
      {(isAdmin ? locations.length > 1 : false) && (
        <div>
          <label className="mb-1 block text-xs text-slate-500">Location</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}
      <div className="min-w-[160px] flex-1">
        <label className="mb-1 block text-xs text-slate-500">Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. September staff wages"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
      </div>
      <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {saving ? "Saving..." : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
        Cancel
      </button>
    </form>
  );
}

export default function Expenses({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { profile, session, isViewOnly } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [locations, setLocations] = useState([]);
  const [allExpenses, setAllExpenses] = useState([]);
  const [logView, setLogView] = useState("daily"); // "daily" | "monthly"
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [locs, pays] = await Promise.all([
        api.getLocations(),
        api.getPayments(isAdmin ? { type: "expense" } : { locationId: profile?.location_id, type: "expense" }),
      ]);
      setLocations(locs);
      setAllExpenses(pays);
    } catch (err) {
      setLoadError(err.message || "Couldn't load expenses — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const locationName = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l.name])), [locations]);

  // This page's own date-range/location filter (from Reports' shared
  // DateRangeFilter/LocationFilter, passed down the same way every Report
  // page receives them) — separate from the always-live "Today"/"This
  // Month" summary cells below, which intentionally ignore whatever range
  // is picked here.
  const rangeExpenses = allExpenses
    .filter((p) => !selectedLocationIds.length || selectedLocationIds.includes(p.location_id))
    .filter((p) => !startDate || p.pay_date >= startDate)
    .filter((p) => !endDate || p.pay_date <= endDate);

  const today = cambodiaDateStr();
  const thisMonth = monthOf(today);
  const todayExpenses = allExpenses.filter((p) => p.pay_date === today);
  const monthExpenses = allExpenses.filter((p) => monthOf(p.pay_date) === thisMonth);
  const daysSoFarThisMonth = Math.max(1, Number(today.slice(8, 10)));

  const byCategory = useMemo(() => {
    const map = {};
    monthExpenses.forEach((p) => {
      const cat = p.category || "Other";
      map[cat] = (map[cat] || 0) + Number(p.amount);
    });
    return Object.entries(map).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }, [monthExpenses]);
  const monthTotal = monthExpenses.reduce((s, p) => s + Number(p.amount), 0);
  const topCategory = byCategory[0];

  // Real categories the team has actually used (any month, any location),
  // merged with the starting list — so the picker only ever grows and stays
  // shared across everyone instead of living per-device.
  const categories = useMemo(() => {
    const used = Array.from(new Set(allExpenses.map((p) => p.category).filter(Boolean)));
    return Array.from(new Set([...SEED_CATEGORIES, ...used]));
  }, [allExpenses]);

  const rangeTotal = rangeExpenses.reduce((s, p) => s + Number(p.amount), 0);

  const dailyRows = useMemo(() => {
    return rangeExpenses.slice().sort((a, b) => (a.pay_date + a.created_at < b.pay_date + b.created_at ? 1 : -1));
  }, [rangeExpenses]);

  const monthlyRows = useMemo(() => {
    const map = {};
    rangeExpenses.forEach((p) => {
      const m = monthOf(p.pay_date);
      if (!map[m]) map[m] = { month: m, total: 0, count: 0 };
      map[m].total += Number(p.amount);
      map[m].count += 1;
    });
    return Object.values(map).sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [rangeExpenses]);

  async function addExpense({ category, amount, entryDate, locationId, note }) {
    await api.createPayment({
      type: "expense",
      category,
      transactionId: null,
      locationId,
      amount,
      method: "cash",
      payDate: entryDate,
      memo: note,
      userId: session.user.id,
    });
    load();
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Expenses" subtitle="Staff pay, fuel, carrying service, rent, and any other operating cost — by day or by month" />
      <main className="flex-1 overflow-y-auto bg-paper p-6">
        {loadError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        )}

        <SummaryStrip>
          <SummaryCell label="Today" value={fmtRiel(todayExpenses.reduce((s, p) => s + Number(p.amount), 0))} sub={`${todayExpenses.length} entr${todayExpenses.length === 1 ? "y" : "ies"}`} />
          <SummaryCell label="This Month" value={fmtRiel(monthTotal)} sub={`${monthExpenses.length} entr${monthExpenses.length === 1 ? "y" : "ies"}`} />
          <SummaryCell label="Top Category" value={topCategory?.category || "—"} sub={topCategory ? `${fmtRiel(topCategory.amount)} this month` : "No expenses yet this month"} />
          <SummaryCell label="Avg per Day (this month)" value={fmtRiel(monthTotal / daysSoFarThisMonth)} />
        </SummaryStrip>

        {/* [2026-09-03] `!isViewOnly` — this had no permission gate at all
            before (the "Add Expense" button/form was reachable by anyone
            who could open this page). Now that a view-only account can
            reach Expenses too (see Sidebar.jsx/MobileNav.jsx), it needs to
            be hidden here — same reasoning as every other write control in
            the app: api.js's Proxy backstop would reject the actual save,
            but only after someone filled out the whole form, so hiding the
            button is what actually makes this read-only in the UI. */}
        {!isViewOnly && (
          <div className="mb-4 flex justify-end">
            <AddExpenseForm
              locations={locations}
              isAdmin={isAdmin}
              defaultLocationId={profile?.location_id}
              categories={categories}
              onAdd={addExpense}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
          <TableCard
            title="Expense Log"
            right={
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                <button onClick={() => setLogView("daily")} className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium ${logView === "daily" ? "bg-slate-900 text-white" : "text-slate-500"}`}>Daily</button>
                <button onClick={() => setLogView("monthly")} className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium ${logView === "monthly" ? "bg-slate-900 text-white" : "text-slate-500"}`}>Monthly</button>
              </div>
            }
          >
            {logView === "daily" ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th><Th>Category</Th><Th>Location</Th><Th>Note</Th><Th num>Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.map((p) => (
                    <Tr key={p.id}>
                      <Td>{p.pay_date}</Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
                          <span className="h-2 w-2 rounded-sm" style={{ background: colorFor(p.category || "Other", categories) }} />
                          {p.category || "Other"}
                        </span>
                      </Td>
                      <Td>{locationName[p.location_id] || "—"}</Td>
                      <Td>{p.memo || "—"}</Td>
                      <Td num>{fmtRiel(p.amount)}</Td>
                    </Tr>
                  ))}
                  {loading && dailyRows.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></tr>}
                  {dailyRows.length === 0 && !loading && !loadError && <tr><td colSpan={5} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No expenses recorded in this range yet.</td></tr>}
                </tbody>
                {dailyRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-slate-200 font-semibold text-slate-900">
                      <td colSpan={4} className="px-4 py-3">Total (this range)</td>
                      <td className="px-4 py-3 text-right">{fmtRiel(rangeTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </Table>
            ) : (
              <Table>
                <thead>
                  <tr><Th>Month</Th><Th num>Entries</Th><Th num>Total</Th></tr>
                </thead>
                <tbody>
                  {monthlyRows.map((r) => (
                    <Tr key={r.month}>
                      <Td name>{r.month}</Td>
                      <Td num>{r.count}</Td>
                      <Td num>{fmtRiel(r.total)}</Td>
                    </Tr>
                  ))}
                  {loading && monthlyRows.length === 0 && <tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">Loading…</td></tr>}
                  {monthlyRows.length === 0 && !loading && !loadError && <tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No expenses recorded in this range yet.</td></tr>}
                </tbody>
              </Table>
            )}
          </TableCard>

          <TableCard title="By Category — This Month">
            <Table>
              <thead>
                <tr><Th>Category</Th><Th num>Amount</Th><Th num>Share</Th></tr>
              </thead>
              <tbody>
                {byCategory.map((r) => (
                  <Tr key={r.category}>
                    <Td>
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
                        <span className="h-2 w-2 rounded-sm" style={{ background: colorFor(r.category, categories) }} />
                        {r.category}
                      </span>
                    </Td>
                    <Td num>{fmtRiel(r.amount)}</Td>
                    <Td num>{monthTotal > 0 ? `${Math.round((r.amount / monthTotal) * 100)}%` : "—"}</Td>
                  </Tr>
                ))}
                {byCategory.length === 0 && !loading && <tr><td colSpan={3} className="px-4 py-10 text-center text-[13.5px] text-slate-400">No expenses yet this month.</td></tr>}
              </tbody>
            </Table>
          </TableCard>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
          This total also flows into Cash Flow (money out) and reduces Gross Profit into Net Profit on the Financial Reports Overview tab.
        </div>
      </main>
    </div>
  );
}
