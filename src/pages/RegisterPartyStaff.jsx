// Staff-facing farmer/buyer registration screen [2026-08-31].
//
// Different from RegisterFarmer.jsx (the public, no-login QR page a farmer
// fills in themselves) — this is used by a logged-in staff account, with
// two things the public page doesn't have: an explicit "search first"
// step so an existing person's profile gets completed instead of a second,
// duplicate record being created, and a second identity photo (the person
// holding their own bank QR) so a bank QR photo alone can't be mistaken
// for proof of whose it is.
//
// Reachable two ways: (1) an account whose ONLY permission is
// "manage_parties" (see App.jsx) is dropped straight onto this screen with
// no sidebar at all — that's the new narrowly-restricted "Registrar" role,
// who should never be able to reach anything else; (2) any other account
// with manage_parties can be routed here too later if wanted (not wired
// into the main sidebar yet, kept out of scope for this pass).
import { useState } from "react";
import { Search, AlertTriangle, UserPlus, CheckCircle2 } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import PhotoUpload from "../components/PhotoUpload.jsx";
import { useAuth } from "../AuthContext.jsx";
import { api } from "../api.js";

const inputCls = "w-full rounded-lg border border-slate-300 px-4 py-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1.5 block text-sm font-medium text-slate-600";
const looksLikePhone = (s) => /^[\d+\s-]+$/.test(s.trim());

function blankForm() {
  return { name: "", phone: "", type: "supplier", idNumber: "", bankName: "", bankAccount: "", bankQrUrl: null, idPhotoUrl: null };
}

export default function RegisterPartyStaff() {
  const { profile } = useAuth();
  // Owner/HQ Admin (scope "all") search/create across every station; an
  // own_location role (including the new Registrar) stays scoped to their
  // own station, same restriction already used everywhere else in the app.
  const scopedLocationId = profile?.roleScope === "all" ? undefined : profile?.location_id;

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");

  const [editingId, setEditingId] = useState(null); // an existing party's id, or null when adding someone new
  const [form, setForm] = useState(null); // null = search screen is shown; an object = the profile form is open
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  async function runSearch(e) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError("");
    setSearched(true);
    try {
      // getParties applies its filters together (not name-OR-phone), so a
      // typed-in phone number wouldn't match on name and vice versa — two
      // separate lookups, merged and de-duplicated, covers someone
      // searching by either.
      const [byName, byPhone] = await Promise.all([
        api.getParties({ q, locationId: scopedLocationId }),
        api.getParties({ qPhone: q, locationId: scopedLocationId }),
      ]);
      const merged = [...byName, ...byPhone].filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
      setResults(merged);
    } catch (err) {
      setSearchError(err.message || "Search failed — check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  function openExisting(party) {
    setEditingId(party.id);
    setForm({
      name: party.name || "",
      phone: party.phone || "",
      type: party.type || "supplier",
      idNumber: party.id_number || "",
      bankName: party.bank_name || "",
      bankAccount: party.bank_account || "",
      bankQrUrl: party.bank_qr_url || null,
      idPhotoUrl: party.id_photo_url || null,
    });
    setSaveError("");
    setSaved(false);
  }

  function openNew() {
    setEditingId(null);
    setForm({
      ...blankForm(),
      name: query && !looksLikePhone(query) ? query : "",
      phone: query && looksLikePhone(query) ? query : "",
    });
    setSaveError("");
    setSaved(false);
  }

  function closeForm() {
    setForm(null);
    setEditingId(null);
    setSaveError("");
  }

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isVerifiable = !!(form && form.bankQrUrl && form.idPhotoUrl);

  async function save() {
    if (!form.name.trim() || !form.phone.trim()) {
      setSaveError("Name and phone number are required.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      // Only ever stamped forward — completing a profile that's already
      // verified from before, without a fresh QR/identity photo this time,
      // keeps its original verified_at/verified_by rather than being wiped
      // back to unverified.
      const verifiedStamp = isVerifiable ? { verifiedAt: new Date().toISOString(), verifiedBy: profile?.id } : {};
      const shared = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        idNumber: form.idNumber.trim() || null,
        bankName: form.bankName.trim() || null,
        bankAccount: form.bankAccount.trim() || null,
        bankQrUrl: form.bankQrUrl,
        idPhotoUrl: form.idPhotoUrl,
        ...verifiedStamp,
      };
      if (editingId) {
        await api.updateParty(editingId, shared);
      } else {
        await api.createParty({ ...shared, type: form.type, locationId: profile?.location_id || null });
      }
      setSaved(true);
      setForm(null);
      setEditingId(null);
      setQuery("");
      setResults([]);
      setSearched(false);
    } catch (err) {
      setSaveError(err.message || "Could not save — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // ---- Profile form screen ----
  if (form) {
    return (
      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <Topbar title={editingId ? "Complete Profile" : "New Profile"} subtitle={editingId ? form.name : "Register a new farmer or buyer"} />
        <main className="flex-1 overflow-y-auto bg-slate-50 p-4">
          <div className="mx-auto max-w-sm space-y-4 pb-6">
            {!editingId && (
              <div className="flex rounded-lg border border-slate-200 bg-white p-1">
                {[["supplier", "Farmer (Seller)"], ["buyer", "Buyer"]].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => set("type", val)}
                    className={`flex-1 rounded-md py-2 text-sm font-medium ${form.type === val ? "bg-brand-600 text-white" : "text-slate-500"}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div>
              <label className={labelCls}>Full name</label>
              <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Sok Dara" />
            </div>
            <div>
              <label className={labelCls}>Phone number</label>
              <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} type="tel" placeholder="0XX XXX XXX" />
            </div>
            <div>
              <label className={labelCls}>ID number <span className="text-slate-400">(optional)</span></label>
              <input className={inputCls} value={form.idNumber} onChange={(e) => set("idNumber", e.target.value)} />
            </div>

            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Bank details</p>
            <div>
              <label className={labelCls}>Bank name</label>
              <input className={inputCls} value={form.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="e.g. ABA Bank" />
            </div>
            <div>
              <label className={labelCls}>Account number</label>
              <input className={inputCls} value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} placeholder="e.g. 000 123 456" />
            </div>

            <div className="flex flex-wrap gap-4 pt-1">
              <PhotoUpload label="1. Photo of the QR code" kind="party-bank-qr" required url={form.bankQrUrl} onUploaded={(url) => set("bankQrUrl", url)} hint="Clear, close-up shot" />
              <PhotoUpload label={`2. Photo of ${form.name || "them"} holding this QR`} kind="party-id-photo" required url={form.idPhotoUrl} onUploaded={(url) => set("idPhotoUrl", url)} hint="Face & QR both visible" />
            </div>

            {form.bankQrUrl && !form.idPhotoUrl && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                A QR photo alone doesn't prove whose it is — add the second photo to mark this profile verified.
              </div>
            )}
            {isVerifiable && (
              <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-xs font-medium text-brand-700">
                <CheckCircle2 size={14} className="shrink-0" /> Both photos in — this profile will be marked verified when saved.
              </div>
            )}

            {saveError && <p className="text-sm text-rose-600">{saveError}</p>}
          </div>
        </main>
        <div className="flex gap-3 border-t border-slate-200 bg-white p-4">
          <button onClick={closeForm} className="flex-1 rounded-lg border border-slate-200 py-3 text-sm font-medium text-slate-600">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-[2] rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </div>
    );
  }

  // ---- Search screen ----
  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Register Farmer / Buyer" subtitle="Search first — before adding anyone new" />
      <main className="flex-1 overflow-y-auto bg-slate-50 p-4">
        <div className="mx-auto max-w-sm space-y-3">
          {saved && (
            <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-700">
              <CheckCircle2 size={15} className="shrink-0" /> Profile saved.
            </div>
          )}

          <form onSubmit={runSearch} className="flex gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} className={inputCls} placeholder="Search by phone or name" />
            <button type="submit" disabled={searching} className="shrink-0 rounded-lg bg-brand-600 px-4 text-white disabled:opacity-50">
              <Search size={18} />
            </button>
          </form>

          {searchError && <p className="text-sm text-rose-600">{searchError}</p>}

          {searched && !searching && (
            <>
              {results.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
                  ⚠️ Found {results.length === 1 ? "an existing profile" : `${results.length} existing profiles`} — complete one below instead of adding new, if it's the same person.
                </div>
              )}
              {results.map((p) => {
                const missingBank = !p.bank_name || !p.bank_account || !p.bank_qr_url || !p.id_photo_url;
                return (
                  <button key={p.id} onClick={() => openExisting(p)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-brand-300 bg-brand-50 p-3 text-left">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.phone || "—"} · {p.type === "supplier" ? "Farmer" : "Buyer"}</p>
                      {missingBank
                        ? <p className="mt-1 text-[11px] font-semibold text-rose-600">⚠ Profile incomplete</p>
                        : <p className="mt-1 text-[11px] font-semibold text-brand-600">✓ Verified</p>}
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-brand-700">Complete →</span>
                  </button>
                );
              })}

              <button onClick={openNew} className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white py-3 text-sm font-medium text-brand-700">
                <UserPlus size={16} /> {results.length === 0 ? "No match — Create New Profile" : "Not them — Create New Profile"}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
