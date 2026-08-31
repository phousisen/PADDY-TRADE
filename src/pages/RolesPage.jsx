import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2, Lock, AlertTriangle } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { PERMISSION_GROUPS } from "../permissions.js";

const SCOPE_LABELS = { all: "All Locations", own_location: "Own Location Only" };
const SCOPE_STYLES = { all: "bg-brand-100 text-brand-700", own_location: "bg-slate-100 text-slate-600" };

function RoleEditor({ role, isOwner, allRoles, allProfiles, myId, onBack, onSaved, onDeleted, onMembersChanged }) {
  const [name, setName] = useState(role.name);
  const [scope, setScope] = useState(role.scope);
  const [permissions, setPermissions] = useState(role.permissions || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reassigning, setReassigning] = useState(null);
  const isNew = !role.id;

  const members = isNew ? [] : allProfiles.filter((p) => p.role_id === role.id);
  const reassignOptions = isOwner ? allRoles : allRoles.filter((r) => r.scope === "own_location");

  function toggle(key) {
    setPermissions((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  }

  async function save() {
    if (!name.trim()) { setError("Give this role a name."); return; }
    setSaving(true);
    setError("");
    try {
      if (isNew) {
        const created = await api.createRole({ name: name.trim(), scope, permissions });
        onSaved(created);
      } else {
        const updated = await api.updateRole(role.id, { name: name.trim(), scope, permissions });
        onSaved(updated);
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!window.confirm(`Delete the "${role.name}" role? Anyone currently assigned to it will need a new role.`)) return;
    setSaving(true);
    try {
      await api.deleteRole(role.id);
      onDeleted(role.id);
    } catch (err) {
      setError(err.message || String(err));
      setSaving(false);
    }
  }

  async function reassignMember(profileId, newRoleId) {
    setReassigning(profileId);
    setError("");
    try {
      await api.updateProfileRole(profileId, { roleId: newRoleId });
      onMembersChanged();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setReassigning(null);
    }
  }

  const scopeLocked = role.is_system; // never let scope change on a seed role
  const canPickAllScope = isOwner; // only Owner can grant all-location reach
  const canManageMembers = isOwner || role.scope === "own_location";

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to roles
      </button>

      {/* [2026-08-31] grid-cols-1 lg:grid-cols-3 instead of a flat
          grid-cols-3 — this form + its permissions sidebar used to squeeze
          into a third of the screen each on phone; now stacks full-width
          below the lg breakpoint, unchanged on desktop. */}
      <div className="grid max-w-4xl grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-5 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Role name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={role.is_system}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400" />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs text-slate-500">
                Location access {scopeLocked && <Lock size={11} />}
              </label>
              <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={scopeLocked || !canPickAllScope}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400">
                <option value="own_location">Own Location Only</option>
                {canPickAllScope && <option value="all">All Locations</option>}
              </select>
              {!canPickAllScope && !scopeLocked && <p className="mt-1 text-[11px] text-slate-400">Only Owner can grant all-location access.</p>}
            </div>
          </div>

          <div className="space-y-5">
            {PERMISSION_GROUPS.map((g) => (
              <div key={g.label}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>
                <div className="space-y-2">
                  {g.permissions.map((p) => {
                    const isOwnerOnlyPerm = p.key === "manage_admins";
                    const disabled = isOwnerOnlyPerm && !isOwner;
                    return (
                      <label key={p.key} className={`flex items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2 text-sm ${disabled ? "opacity-40" : "hover:bg-slate-50"}`}>
                        <input type="checkbox" checked={permissions.includes(p.key)} disabled={disabled} onChange={() => toggle(p.key)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400" />
                        <span className="text-slate-700">{p.label}</span>
                        {isOwnerOnlyPerm && <span className="ml-auto text-[10px] text-slate-400">Owner only</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {error && <p className="mt-4 text-sm text-rose-500">{error}</p>}

          <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
            {!isNew && !role.is_system ? (
              <button onClick={del} disabled={saving} className="flex items-center gap-1.5 text-sm text-rose-500 hover:text-rose-700">
                <Trash2 size={14} /> Delete role
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={onBack} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {saving ? "Saving..." : "Save Role"}
              </button>
            </div>
          </div>
        </div>

        {!isNew && (
          <div className="h-fit rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-1">
            <p className="mb-3 text-sm font-semibold text-slate-700">Accounts with this role ({members.length})</p>
            {members.length === 0 && <p className="text-xs text-slate-400">Nobody has this role right now.</p>}
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-100 p-2.5">
                  <p className="text-sm font-medium text-slate-700">{m.full_name}</p>
                  {canManageMembers ? (
                    <select value={m.role_id} disabled={reassigning === m.id} onChange={(e) => reassignMember(m.id, e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-brand-400">
                      {reassignOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  ) : (
                    <p className="mt-0.5 text-xs text-slate-400">Only Owner can move this person to a different role.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RolesPage() {
  const { profile } = useAuth();
  const isOwner = !!profile?.isOwner;
  const [roles, setRoles] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [r, p] = await Promise.all([api.getRoles(), api.getProfiles()]);
      setRoles(r);
      setProfiles(p);
    } catch (err) {
      // Without this, a failed/dropped request left the page stuck on
      // "Loading…" forever with no way to tell what went wrong or retry.
      setLoadError(err.message || "Couldn't load roles — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const rolesMissing = roles.length === 0 && !loading && !loadError;

  function employeeCount(roleId) {
    return profiles.filter((p) => p.role_id === roleId).length;
  }

  function handleSaved() {
    setEditing(null);
    load();
  }
  function handleDeleted() {
    setEditing(null);
    load();
  }

  if (editing) {
    return (
      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <Topbar title="Edit Role" />
        <main className="flex-1 overflow-y-auto p-6">
          <RoleEditor
            role={editing} isOwner={isOwner} allRoles={roles} allProfiles={profiles} myId={profile.id}
            onBack={() => setEditing(null)} onSaved={handleSaved} onDeleted={handleDeleted}
            onMembersChanged={load}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Roles" subtitle="Custom access rights for everyone in PaddyTrade" />
      <main className="flex-1 overflow-y-auto p-6">
        {loadError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        )}
        {rolesMissing ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">The roles table isn't set up yet.</p>
              <p className="mt-0.5 text-xs">Run the "paddytrade-schema-roles-owner.sql" migration in Supabase's SQL Editor, then refresh this page.</p>
            </div>
          </div>
        ) : (
          <button onClick={() => setEditing({ name: "", scope: "own_location", permissions: [], is_system: false })}
            className="mb-4 flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Plus size={15} /> Add Role
          </button>
        )}

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Access</th>
                <th className="px-3 py-3 font-medium">Permissions</th>
                <th className="px-3 py-3 font-medium">Employees</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} onClick={() => setEditing(r)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 font-medium text-slate-700">
                      {r.name}
                      {r.is_system && <Lock size={12} className="text-slate-300" />}
                    </div>
                  </td>
                  <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${SCOPE_STYLES[r.scope]}`}>{SCOPE_LABELS[r.scope]}</span></td>
                  <td className="px-3 py-3 text-slate-500">{(r.permissions || []).length} permission(s)</td>
                  <td className="px-3 py-3 text-slate-600">{employeeCount(r.id)}</td>
                </tr>
              ))}
              {loading && roles.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {roles.length === 0 && !loading && !loadError && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">No roles yet.</td></tr>}
            </tbody>
          </table>
        </div>

        {!rolesMissing && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            Location access controls what data a role can actually reach in the database (all locations vs their own). Permissions control what's shown inside that boundary. {!isOwner && "Only Owner can create a role with all-location access, or edit the \"Owner\"/\"HQ Admin\" roles."}
          </div>
        )}
      </main>
    </div>
  );
}
