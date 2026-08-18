import { useEffect, useRef, useState } from "react";
import { Plus, AlertTriangle, LogOut, KeyRound, Mail, Circle } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import AddUserModal from "../components/AddUserModal.jsx";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { supabase } from "../supabaseClient.js";

const SCOPE_STYLES = { all: "bg-brand-100 text-brand-700", own_location: "bg-slate-100 text-slate-600" };

// A user counts as "currently active" if their browser checked in within
// this window — the app pings every 20s, so a couple of missed pings still
// count as active before flipping to offline.
const ACTIVE_WINDOW_MS = 75000;
const LIST_REFRESH_MS = 30000;

function isOnline(u) {
  if (!u.last_seen_at) return false;
  return Date.now() - new Date(u.last_seen_at).getTime() < ACTIVE_WINDOW_MS;
}

function relativeTime(dateStr) {
  if (!dateStr) return "Never";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function SetPasswordModal({ user, ownerEmail, onClose, onDone }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ownPassword, setOwnPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const canSubmit = newPassword.length >= 6 && newPassword === confirmPassword && ownPassword.length > 0;

  async function submit() {
    setError("");
    if (newPassword.length < 6) { setError("New password must be at least 6 characters."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords don't match."); return; }
    setSaving(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: ownerEmail, password: ownPassword });
    if (authError) {
      setError("Your password was incorrect.");
      setSaving(false);
      return;
    }
    try {
      await api.adminSetPassword(user.id, newPassword);
      onDone();
    } catch (err) {
      setError(err.message || String(err));
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-700"><KeyRound size={16} className="text-brand-600" /> Set New Password</h3>
        <p className="mb-4 text-xs text-slate-400">For {user.full_name}. They won't be notified — let them know their new password directly.</p>

        <label className="mb-1 block text-xs text-slate-500">New password</label>
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

        <label className="mb-1 block text-xs text-slate-500">Confirm new password</label>
        <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />

        <div className="mb-3 border-t border-slate-100 pt-3">
          <label className="mb-1 block text-xs text-slate-500">Enter your own password to confirm this change</label>
          <input type="password" value={ownPassword} onChange={(e) => setOwnPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        </div>

        {error && <p className="mb-3 text-xs text-rose-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
          <button disabled={!canSubmit || saving} onClick={submit}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? "Saving..." : "Set Password"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { profile: me, session } = useAuth();
  const isOwner = !!me?.isOwner;
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [emails, setEmails] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [passwordUser, setPasswordUser] = useState(null);
  const emailsLoadedRef = useRef(false);

  async function load() {
    const [u, r, l] = await Promise.all([api.getProfiles(), api.getRoles(), api.getLocations()]);
    setUsers(u);
    setRoles(r);
    setLocations(l);
    setLoading(false);
    if (isOwner && !emailsLoadedRef.current) {
      emailsLoadedRef.current = true;
      api.listUserEmails()
        .then((list) => {
          const map = {};
          list.forEach((e) => { map[e.id] = e.email; });
          setEmails(map);
        })
        .catch((err) => console.warn("Couldn't load emails (has the admin-users Edge Function been deployed?):", err.message));
    }
  }
  useEffect(() => { load(); }, []);

  // Keep "who's online" fresh while this page is open, without the owner
  // needing to manually refresh.
  useEffect(() => {
    const interval = setInterval(() => { api.getProfiles().then(setUsers); }, LIST_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  const rolesMissing = roles.length === 0;

  // Owner can touch anyone. HQ Admin (not Owner) can only manage people
  // who currently hold an own_location-scope role — the database enforces
  // this too, this is just to keep the UI honest about what will work.
  function canEdit(u) {
    if (isOwner) return true;
    return u.roleObj?.scope === "own_location";
  }

  async function changeRole(u, roleId) {
    setSavingId(u.id);
    const oldRole = u.roleObj;
    const newRole = roles.find((r) => r.id === roleId);
    try {
      await api.updateProfileRole(u.id, { roleId });
      await api.logAudit({
        action: "change_role", tableName: "profiles", recordId: u.id,
        oldData: { role: oldRole?.name }, newData: { role: newRole?.name }, userId: me.id,
      });
      load();
    } catch (err) {
      alert(err.message || String(err));
      setSavingId(null);
    }
  }

  async function changeLocation(u, locationId) {
    setSavingId(u.id);
    try {
      await api.updateProfileRole(u.id, { locationId: locationId || null });
      load();
    } catch (err) {
      alert(err.message || String(err));
      setSavingId(null);
    }
  }

  const suspendedRole = roles.find((r) => r.name === "Suspended");

  async function suspend(u) {
    if (!suspendedRole) return;
    if (!window.confirm(`Suspend ${u.full_name}? They'll immediately lose all access until reassigned a role.`)) return;
    await changeRole(u, suspendedRole.id);
  }

  async function logOut(u) {
    const online = isOnline(u);
    const msg = online
      ? `Log ${u.full_name} out right now? Their session will end within about 20 seconds.`
      : `${u.full_name} isn't currently active, so this won't do anything immediately — it'll force them to log out the next time their browser reconnects (even if that's later). Continue?`;
    if (!window.confirm(msg)) return;
    try {
      await api.requestLogout(u.id);
      alert(online ? `${u.full_name} will be signed out shortly.` : `${u.full_name} will be signed out next time they're active.`);
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  const rolesForPicker = (u) => (isOwner ? roles : roles.filter((r) => r.scope === "own_location"));

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Users" subtitle="Everyone with access to PaddyTrade" />
      <main className="flex-1 overflow-y-auto p-6">
        {rolesMissing ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Roles aren't set up yet.</p>
              <p className="mt-0.5 text-xs">Run the "paddytrade-schema-roles-owner.sql" migration in Supabase first — until then, roles can't be assigned here.</p>
            </div>
          </div>
        ) : (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span>{!isOwner && "As HQ Admin, you can manage Manager/Staff-tier accounts; only Owner can change Owner or HQ Admin-level accounts."}</span>
            <button onClick={() => setAdding(true)} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
              <Plus size={13} /> Add User
            </button>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Name</th>
                {isOwner && <th className="px-3 py-3 font-medium">Email</th>}
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Location</th>
                <th className="px-3 py-3 font-medium">Access</th>
                <th className="px-3 py-3 font-medium">Activity</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const editable = !rolesMissing && canEdit(u);
                const scope = u.roleObj?.scope || "own_location";
                const online = isOnline(u);
                return (
                  <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-700">{u.full_name}</td>
                    {isOwner && (
                      <td className="px-3 py-3 text-slate-500">
                        {emails[u.id] ? (
                          <span className="flex items-center gap-1"><Mail size={12} className="text-slate-300" /> {emails[u.id]}</span>
                        ) : "—"}
                      </td>
                    )}
                    <td className="px-3 py-3">
                      {editable ? (
                        <select value={u.role_id || ""} disabled={savingId === u.id} onChange={(e) => changeRole(u, e.target.value)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-brand-400">
                          {rolesForPicker(u).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      ) : (
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${SCOPE_STYLES[scope]}`}>{u.roleObj?.name || u.role}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {editable && scope !== "all" ? (
                        <select value={u.location_id || ""} disabled={savingId === u.id} onChange={(e) => changeLocation(u, e.target.value)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-brand-400">
                          <option value="">— none —</option>
                          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      ) : (
                        <span className="text-slate-600">{scope === "all" ? "All Locations" : u.locationName}</span>
                      )}
                    </td>
                    <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${SCOPE_STYLES[scope]}`}>{scope === "all" ? "All Locations" : "Own Location"}</span></td>
                    <td className="px-3 py-3">
                      <span className={`flex items-center gap-1.5 text-xs ${online ? "text-emerald-600" : "text-slate-400"}`}>
                        <Circle size={8} className={online ? "fill-emerald-500 text-emerald-500" : "fill-slate-300 text-slate-300"} />
                        {online ? "Active now" : `Last seen ${relativeTime(u.last_seen_at)}`}
                      </span>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Login: {u.last_login_at ? relativeTime(u.last_login_at) : "Never"}
                        {u.last_login_device ? ` · ${u.last_login_device}` : ""}
                      </p>
                      {(u.last_login_ip || u.last_login_location) && (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {u.last_login_ip || "—"}{u.last_login_location ? ` · ${u.last_login_location}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-3">
                        {editable && u.id !== me.id && (
                          <button onClick={() => logOut(u)} className={`flex items-center gap-1 text-xs hover:text-slate-700 ${online ? "text-slate-500" : "text-slate-400"}`}>
                            <LogOut size={12} /> Log Out
                          </button>
                        )}
                        {isOwner && u.id !== me.id && (
                          <button onClick={() => setPasswordUser(u)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
                            <KeyRound size={12} /> Set Password
                          </button>
                        )}
                        {editable && u.roleObj?.name !== "Suspended" && u.id !== me.id && (
                          <button onClick={() => suspend(u)} className="text-xs text-rose-500 hover:text-rose-700">Suspend</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && !loading && <tr><td colSpan={isOwner ? 7 : 6} className="px-5 py-10 text-center text-sm text-slate-400">No users found.</td></tr>}
            </tbody>
          </table>
        </div>

        {isOwner && (
          <p className="mt-3 text-xs text-slate-400">
            Emails and password resets require the "admin-users" Edge Function to be deployed in Supabase — if the email column shows "—" for everyone, that step likely hasn't been done yet.
          </p>
        )}
      </main>

      {adding && (
        <AddUserModal
          roles={roles}
          locations={locations}
          isOwner={isOwner}
          onClose={() => setAdding(false)}
          onCreated={() => { setAdding(false); load(); }}
        />
      )}

      {passwordUser && (
        <SetPasswordModal
          user={passwordUser}
          ownerEmail={session?.user?.email}
          onClose={() => setPasswordUser(null)}
          onDone={() => { setPasswordUser(null); alert(`Password updated for ${passwordUser.full_name}.`); }}
        />
      )}
    </div>
  );
}
