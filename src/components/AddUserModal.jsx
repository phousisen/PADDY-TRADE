import { useState } from "react";
import { X } from "lucide-react";
import { api } from "../api.js";

export default function AddUserModal({ roles, locations, isOwner, onClose, onCreated }) {
  const pickableRoles = isOwner ? roles : roles.filter((r) => r.scope === "own_location");
  const [mode, setMode] = useState("password"); // "password" | "invite"
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(pickableRoles[0]?.id || "");
  const [locationId, setLocationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedRole = roles.find((r) => r.id === roleId);

  async function submit(e) {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) {
      setError("Fill in a name and email.");
      return;
    }
    if (mode === "password" && password.length < 6) {
      setError("Fill in a name, email, and a password of at least 6 characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const locationForRole = selectedRole?.scope === "all" ? null : locationId || null;
      if (mode === "invite") {
        // Reuses the exact same account-creation path as "Set a password
        // now" below, just with a made-up password nobody uses -- see
        // api.inviteUserAccount for the full explanation.
        await api.inviteUserAccount({ email: email.trim(), fullName: fullName.trim(), roleId, locationId: locationForRole });
        setNotice(`Invite sent to ${email.trim()}. They'll get an email with a link to set their own password and sign in.`);
        setTimeout(() => onCreated(), 3500);
        return;
      }
      const result = await api.createUserAccount({
        email: email.trim(), password, fullName: fullName.trim(), roleId,
        locationId: locationForRole,
      });
      if (!result.emailConfirmed) {
        setNotice("Account created. Since this project may require email confirmation, if they can't log in right away, check Supabase → Authentication → Settings and turn off \"Confirm email\", or manually confirm them from Authentication → Users.");
        setTimeout(() => onCreated(), 3500);
      } else {
        onCreated();
      }
    } catch (err) {
      setError(err.message || String(err));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">Add User</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {notice ? (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">{notice}</p>
        ) : (
          <form onSubmit={submit}>
            <div className="mb-3 flex rounded-lg bg-slate-100 p-1 text-xs font-medium">
              <button type="button" onClick={() => setMode("password")}
                className={`flex-1 rounded-md py-1.5 ${mode === "password" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500"}`}>
                Set a password now
              </button>
              <button type="button" onClick={() => setMode("invite")}
                className={`flex-1 rounded-md py-1.5 ${mode === "invite" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500"}`}>
                Email them an invite
              </button>
            </div>

            <label className="mb-1 block text-xs text-slate-500">Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

            <label className="mb-1 block text-xs text-slate-500">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

            {mode === "password" ? (
              <>
                <label className="mb-1 block text-xs text-slate-500">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters"
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              </>
            ) : (
              <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] text-slate-500">
                They'll get an email with a link to choose their own password — no password to hand them yourself.
              </p>
            )}

            <label className="mb-1 block text-xs text-slate-500">Role</label>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
              {pickableRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>

            {selectedRole?.scope !== "all" && (
              <>
                <label className="mb-1 block text-xs text-slate-500">Location</label>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                  <option value="">— none —</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </>
            )}

            {error && <p className="mb-3 text-sm text-rose-500">{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {saving ? (mode === "invite" ? "Sending..." : "Creating...") : (mode === "invite" ? "Send Invite" : "Add User")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
