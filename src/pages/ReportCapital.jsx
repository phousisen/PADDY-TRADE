import { useEffect, useMemo, useState } from "react";
import { Plus, Users, Landmark } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";

function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }

// Cambodia's current calendar date (YYYY-MM-DD), independent of the
// viewing device's own timezone/clock setting.
function cambodiaDateStr(d = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function AddCapitalEntryForm({ locations, partners, onAddPartner, onAdd }) {
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState(locations[0]?.id || "");
  const [partnerId, setPartnerId] = useState("");
  const [newPartnerName, setNewPartnerName] = useState("");
  const [type, setType] = useState("contribution");
  useEffect(() => { if (!locationId && locations.length) setLocationId(locations[0].id); }, [locations]);
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(cambodiaDateStr());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const partnersForLocation = partners.filter((p) => p.location_id === locationId);

  async function submit(e) {
    e.preventDefault();
    if (!locationId || !amount || parseFloat(amount) <= 0) return;
    let usePartnerId = partnerId;
    setSaving(true);
    try {
      if (!usePartnerId && newPartnerName.trim()) {
        const created = await onAddPartner({ name: newPartnerName.trim(), locationId });
        usePartnerId = created.id;
      }
      if (!usePartnerId) { setSaving(false); return; }
      await onAdd({ partnerId: usePartnerId, locationId, type, amount: parseFloat(amount), entryDate, note });
      setAmount(""); setNote(""); setNewPartnerName(""); setPartnerId("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
        <Plus size={14} /> Add Capital Entry
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Location</label>
          <select value={locationId} onChange={(e) => { setLocationId(e.target.value); setPartnerId(""); }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Partner</label>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
            <option value="">— new partner below —</option>
            {partnersForLocation.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {!partnerId && (
          <div>
            <label className="mb-1 block text-xs text-slate-500">New partner name</label>
            <input value={newPartnerName} onChange={(e) => setNewPartnerName(e.target.value)} placeholder="e.g. Mr. Sopheak"
              className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-slate-500">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
            <option value="contribution">Put capital in</option>
            <option value="withdrawal">Take capital out</option>
          </select>
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
        <div className="flex-1 min-w-[140px]">
          <label className="mb-1 block text-xs text-slate-500">Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        </div>
        <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddLoanEntryForm({ locations, onAdd }) {
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState(locations[0]?.id || "");
  const [lenderName, setLenderName] = useState("");
  const [type, setType] = useState("borrow");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(cambodiaDateStr());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!locationId && locations.length) setLocationId(locations[0].id); }, [locations]);

  async function submit(e) {
    e.preventDefault();
    if (!locationId || !lenderName.trim() || !amount || parseFloat(amount) <= 0) return;
    setSaving(true);
    try {
      await onAdd({ locationId, lenderName: lenderName.trim(), type, amount: parseFloat(amount), entryDate, note });
      setAmount(""); setNote(""); setLenderName("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
        <Plus size={14} /> Add Loan Entry
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Location</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Bank / Lender</label>
          <input value={lenderName} onChange={(e) => setLenderName(e.target.value)} placeholder="e.g. ABA Bank"
            className="w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
            <option value="borrow">Borrowed (money in)</option>
            <option value="repay">Repaid (money out)</option>
          </select>
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
        <div className="flex-1 min-w-[140px]">
          <label className="mb-1 block text-xs text-slate-500">Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        </div>
        <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function ReportCapital({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { session } = useAuth();
  const [locations, setLocations] = useState([]);
  const [partners, setPartners] = useState([]);
  const [capitalEntries, setCapitalEntries] = useState([]);
  const [loanEntries, setLoanEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [l, p, c, b] = await Promise.all([
        api.getLocations(), api.getPartners(), api.getPartnerCapitalEntries(), api.getBankLoans(),
      ]);
      setLocations(l);
      setPartners(p);
      setCapitalEntries(c);
      setLoanEntries(b);
    } catch (err) {
      // Without this, a failed/dropped request silently showed empty
      // tables — as if there were no partners or loans on file at all —
      // instead of saying the load itself had failed.
      setLoadError(err.message || "Couldn't load this report — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const capRows = capitalEntries
    .filter((e) => !selectedLocationIds.length || selectedLocationIds.includes(e.location_id))
    .filter((e) => !startDate || e.entry_date >= startDate)
    .filter((e) => !endDate || e.entry_date <= endDate);
  const loanRows = loanEntries
    .filter((e) => !selectedLocationIds.length || selectedLocationIds.includes(e.location_id))
    .filter((e) => !startDate || e.entry_date >= startDate)
    .filter((e) => !endDate || e.entry_date <= endDate);

  const capByPartner = useMemo(() => {
    const map = {};
    capRows.forEach((e) => {
      const k = `${e.partner_id}`;
      if (!map[k]) map[k] = { name: e.partnerName, location: e.stationName, contributed: 0, withdrawn: 0 };
      if (e.type === "contribution") map[k].contributed += Number(e.amount);
      else map[k].withdrawn += Number(e.amount);
    });
    return Object.values(map).map((r) => ({ ...r, net: r.contributed - r.withdrawn })).sort((a, b) => b.net - a.net);
  }, [capRows]);

  const loansByLender = useMemo(() => {
    const map = {};
    loanRows.forEach((e) => {
      const k = `${e.lender_name}__${e.location_id}`;
      if (!map[k]) map[k] = { name: e.lender_name, location: e.stationName, borrowed: 0, repaid: 0 };
      if (e.type === "borrow") map[k].borrowed += Number(e.amount);
      else map[k].repaid += Number(e.amount);
    });
    return Object.values(map).map((r) => ({ ...r, outstanding: r.borrowed - r.repaid })).sort((a, b) => b.outstanding - a.outstanding);
  }, [loanRows]);

  const totalCapital = capByPartner.reduce((s, r) => s + r.net, 0);
  const totalOutstandingLoans = loansByLender.reduce((s, r) => s + r.outstanding, 0);

  async function addPartner({ name, locationId }) {
    const created = await api.createPartner({ name, locationId, userId: session.user.id });
    await api.logAudit({
      action: "add_partner", tableName: "partners", recordId: created.id,
      oldData: null, newData: { name, locationId }, userId: session.user.id,
    });
    setPartners((prev) => [...prev, created]);
    return created;
  }

  async function addCapitalEntry(entry) {
    const created = await api.createPartnerCapitalEntry({ ...entry, userId: session.user.id });
    const partnerName = partners.find((p) => p.id === entry.partnerId)?.name;
    await api.logAudit({
      action: "add_capital_entry", tableName: "partner_capital_entries", recordId: created?.id,
      oldData: null, newData: { ...entry, partnerName }, userId: session.user.id,
    });
    load();
  }

  async function addLoanEntry(entry) {
    const created = await api.createBankLoanEntry({ ...entry, userId: session.user.id });
    await api.logAudit({
      action: "add_loan_entry", tableName: "bank_loans", recordId: created?.id,
      oldData: null, newData: entry, userId: session.user.id,
    });
    load();
  }

  return (
    <div>
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
        </div>
      )}
      <div className="mb-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="flex items-center gap-1.5 text-xs text-slate-400"><Users size={12} /> Total Partner Capital</p>
              <p className={`text-xl font-bold ${totalCapital >= 0 ? "text-slate-800" : "text-rose-600"}`}>{fmtRiel(totalCapital)}</p>
            </div>
          </div>
          <AddCapitalEntryForm locations={locations} partners={partners} onAddPartner={addPartner} onAdd={addCapitalEntry} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Partner</th>
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Contributed</th>
                <th className="px-5 py-3 font-medium">Withdrawn</th>
                <th className="px-5 py-3 font-medium">Net Capital</th>
              </tr>
            </thead>
            <tbody>
              {capByPartner.map((r) => (
                <tr key={`${r.name}-${r.location}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{r.name}</td>
                  <td className="px-5 py-3 text-slate-600">{r.location}</td>
                  <td className="px-5 py-3 text-emerald-600">{fmtRiel(r.contributed)}</td>
                  <td className="px-5 py-3 text-rose-600">{fmtRiel(r.withdrawn)}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{fmtRiel(r.net)}</td>
                </tr>
              ))}
              {loading && capByPartner.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {capByPartner.length === 0 && !loading && !loadError && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">No partner capital recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="flex items-center gap-1.5 text-xs text-slate-400"><Landmark size={12} /> Total Bank Loans Outstanding</p>
            <p className={`text-xl font-bold ${totalOutstandingLoans > 0 ? "text-rose-600" : "text-slate-800"}`}>{fmtRiel(totalOutstandingLoans)}</p>
          </div>
          <AddLoanEntryForm locations={locations} onAdd={addLoanEntry} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Bank / Lender</th>
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Borrowed</th>
                <th className="px-5 py-3 font-medium">Repaid</th>
                <th className="px-5 py-3 font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {loansByLender.map((r) => (
                <tr key={`${r.name}-${r.location}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{r.name}</td>
                  <td className="px-5 py-3 text-slate-600">{r.location}</td>
                  <td className="px-5 py-3 text-slate-700">{fmtRiel(r.borrowed)}</td>
                  <td className="px-5 py-3 text-slate-700">{fmtRiel(r.repaid)}</td>
                  <td className={`px-5 py-3 font-medium ${r.outstanding > 0 ? "text-rose-600" : "text-slate-800"}`}>{fmtRiel(r.outstanding)}</td>
                </tr>
              ))}
              {loading && loansByLender.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {loansByLender.length === 0 && !loading && !loadError && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">No bank loans recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        These totals feed directly into the Balance Sheet's Equity (Partner Capital) and Liabilities (Bank Loans) lines.
      </div>
    </div>
  );
}
