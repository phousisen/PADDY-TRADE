// Reports → Finance Setup.
//
// [2026-09-14] The one screen where the figures the weighbridge cannot know
// get typed in: who owns what share of a station, what the business owns that
// wears out, and what was in the safe before the system started.
//
// Every financial statement reads from here. Until a figure is entered, the
// statements print "not entered" for it rather than a zero — so this page's
// real job is to show, per station, exactly WHAT IS STILL MISSING and what
// each gap costs you on the reports. That is what the readiness strip at the
// top is for.
//
// Admin only, and gated again by RLS in the database — see
// migration_finance_setup.sql.

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Check, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { ReportCard, SectionLabel, TableCard } from "../components/ReportUI.jsx";
import { cambodiaDateStr as cambodiaDateStrOf } from "../dailyLedger.js";

const fmt = (n) => (n === null || n === undefined || n === "" ? "—" : Number(n).toLocaleString("en-US"));
// [2026-09-19] This page used to build "today" by formatting the time as
// Phnom Penh text, parsing it back as THIS DEVICE's local time, then converting
// to UTC with toISOString(). On a UTC+7 PC that subtracts seven hours twice
// over, so between 00:00 and 06:59 the default date was yesterday. The shared
// helper asks Intl for the Phnom Penh calendar day directly.
const cambodiaDateStr = () => cambodiaDateStrOf(new Date());

const INPUT = "w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const LABEL = "mb-1 block text-[11px] font-medium text-slate-500";

function Missing({ children }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
      <AlertTriangle size={10} /> {children}
    </span>
  );
}
function Done({ children }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200">
      <Check size={10} /> {children}
    </span>
  );
}

export default function ReportFinanceSetup() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [locations, setLocations] = useState([]);
  const [partners, setPartners] = useState([]);
  const [assets, setAssets] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function load() {
    setError("");
    try {
      const [l, p, a, s] = await Promise.all([
        api.getLocations(), api.getPartners(), api.getFixedAssets(), api.getFinanceSettings(),
      ]);
      setLocations(l); setPartners(p); setAssets(a); setSettings(s);
    } catch (e) {
      // The tables may simply not exist yet — that is a setup step, not a
      // crash, so say which file fixes it instead of showing a raw error.
      setError(
        /relation .* does not exist|schema cache/i.test(e?.message || "")
          ? "Finance Setup's tables aren't in the database yet. Run migration_finance_setup.sql in Supabase → SQL Editor, one statement at a time, then reload this page."
          : (e?.message || "Couldn't load Finance Setup."));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const flash = (m) => { setSaved(m); setTimeout(() => setSaved(""), 2500); };

  // What is still missing, per station — this is the point of the page.
  const readiness = useMemo(() => locations.map((loc) => {
    const mine = partners.filter((p) => p.location_id === loc.id);
    const shareTotal = mine.reduce((s, p) => s + (p.share_pct == null ? 0 : Number(p.share_pct)), 0);
    const st = settings[loc.id] || {};
    return {
      loc,
      partners: mine,
      noPartners: mine.length === 0,
      sharesMissing: mine.some((p) => p.share_pct == null),
      // Shares that do not add to 100 describe something that is not a whole.
      sharesOff: mine.length > 0 && !mine.some((p) => p.share_pct == null) && Math.abs(shareTotal - 100) > 0.01,
      shareTotal,
      assets: assets.filter((a) => a.location_id === loc.id),
      openingCash: st.opening_cash,
      taxRate: st.tax_rate_pct,
    };
  }), [locations, partners, assets, settings]);

  if (!isAdmin) {
    return (
      <ReportCard title="Finance Setup">
        <p className="text-[13px] text-slate-500">
          These figures decide what every financial statement says, so only an HQ Admin can change them.
        </p>
      </ReportCard>
    );
  }

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">Loading…</div>;

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] leading-relaxed text-rose-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-[13px] font-medium text-brand-800">{saved}</div>
      )}

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
        <b className="font-semibold">Anything left blank here prints as “not entered” on the statements, never as zero.</b>{" "}
        A zero would be a claim — that the business owns nothing that wears out, or held no cash before the system
        started. The reports would rather say nothing than say something nobody told them.
      </div>

      {/* ---- what is still missing, per station ---- */}
      <TableCard title="What each station still needs">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="px-5 py-2.5">Station</th>
              <th className="px-3 py-2.5">Ownership shares</th>
              <th className="px-3 py-2.5">Asset register</th>
              <th className="px-3 py-2.5">Opening cash</th>
              <th className="px-3 py-2.5">Tax rate</th>
            </tr>
          </thead>
          <tbody>
            {readiness.map((r) => (
              <tr key={r.loc.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5 font-medium text-slate-800">{r.loc.name}</td>
                <td className="px-3 py-2.5">
                  {r.noPartners ? <Missing>no partners yet</Missing>
                    : r.sharesMissing ? <Missing>{r.partners.filter((p) => p.share_pct == null).length} not set</Missing>
                    : r.sharesOff ? <Missing>adds to {r.shareTotal}%, not 100%</Missing>
                    : <Done>{r.partners.length} partners · 100%</Done>}
                </td>
                <td className="px-3 py-2.5">
                  {r.assets.length ? <Done>{r.assets.length} assets</Done> : <Missing>no depreciation</Missing>}
                </td>
                <td className="px-3 py-2.5">
                  {r.openingCash == null ? <Missing>balance sheet won't close</Missing> : <Done>{fmt(r.openingCash)} ៛</Done>}
                </td>
                <td className="px-3 py-2.5">
                  {r.taxRate == null ? <Missing>no tax line</Missing> : <Done>{r.taxRate}%</Done>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      {/* ---- ownership shares ---- */}
      <ReportCard
        title="Ownership shares"
        subtitle="What percentage of a station each partner owns. Deliberately separate from the capital they put in — a station's split does not have to follow the money."
      >
        {locations.map((loc) => {
          const mine = partners.filter((p) => p.location_id === loc.id);
          if (!mine.length) return (
            <div key={loc.id} className="border-b border-slate-50 py-3 last:border-0">
              <SectionLabel>{loc.name}</SectionLabel>
              <p className="text-[12.5px] text-slate-400">
                No partners recorded here yet — add them under Reports → Capital &amp; Loans, then set their shares here.
              </p>
            </div>
          );
          const total = mine.reduce((s, p) => s + (p.share_pct == null ? 0 : Number(p.share_pct)), 0);
          const complete = !mine.some((p) => p.share_pct == null);
          return (
            <div key={loc.id} className="border-b border-slate-50 py-3 last:border-0">
              <SectionLabel>{loc.name}</SectionLabel>
              {mine.map((p) => (
                <ShareRow key={p.id} partner={p} onSaved={(v) => {
                  setPartners((rows) => rows.map((r) => (r.id === p.id ? { ...r, share_pct: v } : r)));
                  flash(`${p.name}'s share at ${loc.name} saved.`);
                }} />
              ))}
              <div className={`mt-1.5 text-[11.5px] font-medium ${
                !complete ? "text-amber-700" : Math.abs(total - 100) > 0.01 ? "text-rose-600" : "text-brand-700"}`}>
                {!complete
                  ? "Some shares are still blank — the Shareholder's Records will show those holdings as not entered."
                  : Math.abs(total - 100) > 0.01
                  ? `These shares add to ${total}%, not 100% — the report will be describing something that isn't a whole.`
                  : "Adds to 100%."}
              </div>
            </div>
          );
        })}
      </ReportCard>

      {/* ---- opening cash / rates ---- */}
      <ReportCard
        title="Opening balances and rates"
        subtitle="Opening cash is the money that was in the safe the day the system started. It is what closes the “unexplained” gap at the bottom of the balance sheet."
      >
        {locations.map((loc) => (
          <SettingsRow
            key={loc.id}
            loc={loc}
            value={settings[loc.id] || {}}
            userId={profile?.id}
            onSaved={(row) => { setSettings((s) => ({ ...s, [loc.id]: row })); flash(`${loc.name} saved.`); }}
            onError={setError}
          />
        ))}
      </ReportCard>

      {/* ---- fixed assets ---- */}
      <AssetsCard
        locations={locations} assets={assets} userId={profile?.id}
        onChanged={async () => { setAssets(await api.getFixedAssets()); flash("Asset register updated."); }}
        onError={setError}
      />
    </div>
  );
}

function ShareRow({ partner, onSaved }) {
  const [val, setVal] = useState(partner.share_pct == null ? "" : String(partner.share_pct));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dirty = String(partner.share_pct == null ? "" : partner.share_pct) !== val;

  async function save() {
    setBusy(true); setErr("");
    try {
      const saved = await api.updatePartnerShare(partner.id, val);
      onSaved(saved.share_pct);
    } catch (e) { setErr(e?.message || "Couldn't save."); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-3 border-b border-slate-50 py-2 last:border-0">
      <span className="flex-1 text-[13px] text-slate-700">{partner.name}</span>
      {err && <span className="text-[11.5px] text-rose-600">{err}</span>}
      <div className="flex items-center gap-1.5">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="not set"
          inputMode="decimal"
          className="w-24 rounded-lg border border-slate-200 px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
        <span className="text-[12px] text-slate-400">%</span>
      </div>
      <button
        onClick={save}
        disabled={!dirty || busy}
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-30"
      >
        {busy ? "…" : "Save"}
      </button>
    </div>
  );
}

function SettingsRow({ loc, value, userId, onSaved, onError }) {
  const [cash, setCash] = useState(value.opening_cash == null ? "" : String(value.opening_cash));
  const [date, setDate] = useState(value.opening_cash_date || "");
  const [tax, setTax] = useState(value.tax_rate_pct == null ? "" : String(value.tax_rate_pct));
  const [rate, setRate] = useState(value.interest_rate_pct == null ? "" : String(value.interest_rate_pct));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const row = await api.saveFinanceSettings({
        locationId: loc.id, openingCash: cash, openingCashDate: date,
        taxRatePct: tax, interestRatePct: rate, userId,
      });
      onSaved(row);
    } catch (e) { onError(e?.message || "Couldn't save."); }
    finally { setBusy(false); }
  }

  return (
    <div className="border-b border-slate-50 py-3 last:border-0">
      <SectionLabel>{loc.name}</SectionLabel>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div>
          <label className={LABEL}>Opening cash ៛</label>
          <input value={cash} onChange={(e) => setCash(e.target.value)} placeholder="not entered" inputMode="numeric" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>As at</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Tax rate %</label>
          <input value={tax} onChange={(e) => setTax(e.target.value)} placeholder="not entered" inputMode="decimal" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Loan interest %</label>
          <input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="not entered" inputMode="decimal" className={INPUT} />
        </div>
        <div className="flex items-end">
          <button onClick={save} disabled={busy}
            className="w-full rounded-lg bg-brand-600 px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssetsCard({ locations, assets, userId, onChanged, onError }) {
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [years, setYears] = useState("");
  const [date, setDate] = useState(cambodiaDateStr());
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!locationId || !name.trim() || !cost || !years) return;
    setBusy(true);
    try {
      await api.createFixedAsset({
        locationId, name: name.trim(), cost, usefulLifeYears: years, inServiceDate: date, userId,
      });
      setOpen(false); setName(""); setCost(""); setYears("");
      onChanged();
    } catch (e) { onError(e?.message || "Couldn't add the asset."); }
    finally { setBusy(false); }
  }

  async function remove(a) {
    try { await api.deleteFixedAsset(a.id); onChanged(); }
    catch (e) { onError(e?.message || "Couldn't remove the asset."); }
  }

  return (
    <TableCard
      title="What the business owns that wears out"
      right={
        <button onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[12.5px] font-medium text-white">
          <Plus size={13} /> Add asset
        </button>
      }
    >
      <div className="border-b border-slate-100 px-5 py-2.5 text-[12px] leading-relaxed text-slate-500">
        Trucks, scales, buildings. Each one is written down in equal parts over the years you give it, starting the
        day it went into service — that is the Depreciation line on the Income Statement and the Property and
        equipment line on the Balance Sheet. With nothing here, both read “not entered”.
      </div>

      {open && (
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 md:grid-cols-6">
          <div className="md:col-span-1">
            <label className={LABEL}>Station</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={INPUT}>
              <option value="">Choose…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={LABEL}>What is it</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hino truck 3A-1890" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Cost ៛</label>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="numeric" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Useful life, years</label>
            <input value={years} onChange={(e) => setYears(e.target.value)} inputMode="decimal" placeholder="10" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>In service from</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
          </div>
          <div className="md:col-span-6">
            <button onClick={add} disabled={busy || !locationId || !name.trim() || !cost || !years}
              className="rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40">
              {busy ? "Saving…" : "Add to the register"}
            </button>
          </div>
        </div>
      )}

      {assets.length === 0 ? (
        <p className="px-5 py-7 text-center text-[13px] text-slate-400">
          Nothing recorded yet — so the statements show depreciation and fixed assets as not entered.
        </p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="px-5 py-2.5">Asset</th>
              <th className="px-3 py-2.5">Station</th>
              <th className="px-3 py-2.5 text-right">Cost ៛</th>
              <th className="px-3 py-2.5 text-right">Life</th>
              <th className="px-3 py-2.5">In service</th>
              <th className="px-3 py-2.5 text-right">Per year ៛</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5 font-medium text-slate-800">{a.name}</td>
                <td className="px-3 py-2.5 text-slate-500">{a.stationName}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmt(a.cost)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{a.useful_life_years} yr</td>
                <td className="px-3 py-2.5 text-slate-500">{a.in_service_date}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmt(Math.round(Number(a.cost) / Number(a.useful_life_years)))}</td>
                <td className="px-3 py-2.5 text-right">
                  <button onClick={() => remove(a)} title="Remove from the register"
                    className="rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
