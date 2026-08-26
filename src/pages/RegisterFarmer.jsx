// Public self-registration page for farmers/sellers -- reached by
// scanning a QR code posted at a station's entrance, e.g.
// https://yourapp.vercel.app/?register=1&loc=<location id>
//
// No login is needed here on purpose: a farmer scans the code with their
// own phone, fills in their name/phone/bank details once, and that's it
// -- no password to remember. Matched by phone number, so scanning again
// later (e.g. their bank account changed) just updates the same record
// instead of creating a duplicate.
//
// This writes through a single narrow database function
// (register_farmer, see migration_add_farmer_registration.sql) using the
// public "anon" key -- not a broad table permission -- so this page can
// only ever create/update a party's own name/phone/bank info. It can't
// read, edit, or delete anything else in the system.

import { useState } from "react";
import { supabase } from "../supabaseClient.js";

const inputCls = "w-full rounded-lg border border-slate-300 px-4 py-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1.5 block text-sm font-medium text-slate-600";

export default function RegisterFarmer({ locationId }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [qrFile, setQrFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("Please enter your name and phone number. / សូមបញ្ចូលឈ្មោះ និងលេខទូរស័ព្ទ។");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let bankQrUrl = null;
      if (qrFile) {
        const ext = qrFile.name.split(".").pop() || "jpg";
        const path = `bank-qr/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("transaction-photos").upload(path, qrFile, { cacheControl: "3600", upsert: false });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("transaction-photos").getPublicUrl(path);
        bankQrUrl = data.publicUrl;
      }
      const { error: rpcErr } = await supabase.rpc("register_farmer", {
        p_name: name.trim(),
        p_phone: phone.trim(),
        p_bank_name: bankName.trim() || null,
        p_bank_account: bankAccount.trim() || null,
        p_bank_qr_url: bankQrUrl,
        p_location_id: locationId || null,
      });
      if (rpcErr) throw rpcErr;
      setDone(true);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again. / មានបញ្ហា សូមព្យាយាមម្ដងទៀត។");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">✓</div>
          <h1 className="mb-2 text-lg font-bold text-slate-800">Thank you! / សូមអរគុណ!</h1>
          <p className="text-sm leading-relaxed text-slate-500">
            Your information has been saved. Please tell our staff your phone number when you arrive.
            <br /><br />
            ព័ត៌មានរបស់អ្នកត្រូវបានរក្សាទុក។ សូមប្រាប់លេខទូរស័ព្ទរបស់អ្នកទៅបុគ្គលិកនៅពេលអ្នកមកដល់។
          </p>
          <p className="mt-4 rounded-lg bg-slate-50 py-2 text-base font-semibold text-slate-700">{phone}</p>
          <button
            onClick={() => { setDone(false); setName(""); setPhone(""); setBankName(""); setBankAccount(""); setQrFile(null); }}
            className="mt-4 text-sm text-brand-600 underline"
          >
            Register someone else / ចុះឈ្មោះម្នាក់ទៀត
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-bold text-slate-800">Farmer Registration<span className="font-khmer block text-sm font-normal text-slate-500">ការចុះឈ្មោះកសិករ</span></h1>
        <p className="mb-5 text-sm text-slate-400">ចុះឈ្មោះកសិករ — fill this in once, we'll remember it next time.</p>

        <div className="mb-4">
          <label className={labelCls}>Your Name / ឈ្មោះ *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Sok Dara" />
        </div>
        <div className="mb-4">
          <label className={labelCls}>Phone Number / លេខទូរស័ព្ទ *</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} type="tel" placeholder="0XX XXX XXX" />
        </div>
        <div className="mb-4">
          <label className={labelCls}>Bank Name / ធនាគារ</label>
          <input value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputCls} placeholder="e.g. ABA" />
        </div>
        <div className="mb-4">
          <label className={labelCls}>Bank Account Number / លេខគណនី</label>
          <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={inputCls} />
        </div>
        <div className="mb-5">
          <label className={labelCls}>Photo of Your Bank QR Code (optional) / QR ធនាគារ</label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setQrFile(e.target.files?.[0] || null)}
            className="w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
          />
        </div>

        {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-brand-600 py-3 text-base font-medium text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {saving ? "Saving… / កំពុងរក្សាទុក…" : "Submit / ដាក់ស្នើ"}
        </button>
      </form>
    </div>
  );
}
