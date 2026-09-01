// [2026-09-01] Landing page for the "Email Invite" flow (see AddUserModal.jsx
// / api.inviteUserAccount). Reached only via the link inside the invite
// email, e.g. https://yourapp.vercel.app/?setpassword=1 -- clicking that
// link is what signs the browser into a short-lived Supabase "recovery"
// session (Supabase does this automatically from the token in the link, the
// same mechanism as a normal "forgot password" email). This page's only job
// is to let that person pick their own real password, then send them to the
// normal login screen -- their throwaway signup password (invisible to them
// and to any Admin) is discarded and never used again.
//
// This is checked in App.jsx BEFORE the normal session/login gate, exactly
// like ?register=1 -- so it works the same whether or not this browser
// happens to already be signed in as someone else.
import { useState } from "react";
import { supabase } from "../supabaseClient.js";

const inputCls = "w-full rounded-lg border border-slate-300 px-4 py-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1.5 block text-sm font-medium text-slate-600";

export default function SetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Requires the short-lived recovery session that clicking the emailed
      // link already created in this browser -- if that's missing or has
      // expired, Supabase returns an error here instead of silently failing.
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      // Sign this recovery session out so they land on the normal login
      // screen and sign in fresh with the password they just chose, instead
      // of being dropped straight into the app from a recovery session.
      await supabase.auth.signOut();
      setDone(true);
    } catch (err) {
      setError(
        err.message?.includes("session")
          ? "This invite link has expired or was already used. Ask an Admin to send a new one."
          : err.message || "Something went wrong. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">✓</div>
          <h1 className="mb-2 text-lg font-bold text-slate-800">Password set</h1>
          <p className="text-sm leading-relaxed text-slate-500">You can now sign in with your new password.</p>
          <a href="/" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-bold text-slate-800">Set your password</h1>
        <p className="mb-5 text-sm text-slate-400">Choose a password for your PaddyTrade account.</p>

        <div className="mb-4">
          <label className={labelCls}>New password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" className={inputCls} autoFocus />
        </div>

        <div className="mb-4">
          <label className={labelCls}>Confirm password</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
        </div>

        {error && <p className="mb-4 text-sm text-rose-500">{error}</p>}

        <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? "Saving..." : "Set password"}
        </button>
      </form>
    </div>
  );
}
