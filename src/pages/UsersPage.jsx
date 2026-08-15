import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";

const ROLE_STYLES = {
  admin: "bg-brand-100 text-brand-700",
  manager: "bg-sky-100 text-sky-700",
  staff: "bg-slate-100 text-slate-600",
};

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getProfiles().then((data) => { setUsers(data); setLoading(false); });
  }, []);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Users" subtitle="Everyone with access to PaddyTrade" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          This is a read-only view. To add a new login or change someone's role/location, that's still done in Supabase (Authentication → Users, then a quick SQL update) — ask if you'd like a walkthrough for a specific person.
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Location</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-700">{u.full_name}</td>
                  <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${ROLE_STYLES[u.role] || "bg-slate-100 text-slate-600"}`}>{u.role}</span></td>
                  <td className="px-3 py-3 text-slate-600">{u.role === "admin" ? "All Locations" : u.locationName}</td>
                </tr>
              ))}
              {users.length === 0 && !loading && <tr><td colSpan={3} className="px-5 py-10 text-center text-sm text-slate-400">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
