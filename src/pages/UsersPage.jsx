import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";

const SCOPE_STYLES = { all: "bg-brand-100 text-brand-700", own_location: "bg-slate-100 text-slate-600" };

export default function UsersPage() {
  const { profile: me } = useAuth();
  const isOwner = !!me?.isOwner;
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [u, r, l] = await Promise.all([api.getProfiles(), api.getRoles(), api.getLocations()]);
    setUsers(u);
    setRoles(r);
    setLocations(l);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

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

  const rolesForPicker = (u) => (isOwner ? roles : roles.filter((r) => r.scope === "own_location"));

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Users" subtitle="Everyone with access to PaddyTrade" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          Creating a brand-new login is still done in Supabase (Authentication → Users) — once that's done, assign their role and location right here. {!isOwner && "As HQ Admin, you can manage Manager/Staff-tier accounts; only Owner can change Owner or HQ Admin-level accounts."}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Location</th>
                <th className="px-3 py-3 font-medium">Access</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const editable = canEdit(u);
                const scope = u.roleObj?.scope || "own_location";
                return (
                  <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-700">{u.full_name}</td>
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
                    <td className="px-3 py-3 text-right">
                      {editable && u.roleObj?.name !== "Suspended" && u.id !== me.id && (
                        <button onClick={() => suspend(u)} className="text-xs text-rose-500 hover:text-rose-700">Suspend</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && !loading && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
