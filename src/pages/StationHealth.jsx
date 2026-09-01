import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api.js";
import { getAccurateNow } from "../supabaseClient.js";

// [2026-09-01] Station Health — "Version 1" from the sample: uses only data
// the app already stores (each location's own transaction history), so
// there's no new database table and nothing new for any station's browser
// or bridge.js to report. This deliberately does NOT show real scale/sync
// connection status — that would need each station's browser and weighbridge
// agent to actively report a heartbeat somewhere, which nothing in the app
// does today. What this DOES catch: the same pattern behind the real
// Jomnoum incident (finished tickets that silently never reached the
// database) shows up here as a station gone quiet — worth a look well
// before someone notices the gap on paper days later. A station showing
// "quiet" just means no transaction has landed recently; it can't tell you
// whether that's because the scale's down or because no truck has come in
// yet, and this page says so.
function cambodiaDateStr(d = getAccurateNow()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timeAgo(iso) {
  if (!iso) return null;
  const diffMin = Math.round((getAccurateNow() - new Date(iso)) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

const STATUS_META = {
  ok: { label: "Active", border: "border-t-brand-600", pillBg: "bg-brand-50", pillText: "text-brand-700", dot: "bg-brand-600" },
  warn: { label: "Quiet", border: "border-t-amber-500", pillBg: "bg-amber-50", pillText: "text-amber-700", dot: "bg-amber-500" },
  down: { label: "No activity today", border: "border-t-rose-500", pillBg: "bg-rose-50", pillText: "text-rose-600", dot: "bg-rose-500" },
};

export default function StationHealth() {
  const [locations, setLocations] = useState([]);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [locs, transactions] = await Promise.all([api.getLocations(), api.getTransactions()]);
      setLocations(locs);
      // Same "doesn't count" convention used everywhere else in the app —
      // a cancelled transaction shouldn't make a station look more active
      // than it really is.
      setTxs(transactions.filter((t) => t.hq_status !== "cancelled"));
    } catch (err) {
      setLoadError(err.message || "Couldn't load station health — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const today = cambodiaDateStr();

  const stationStats = useMemo(() => {
    return locations.map((loc) => {
      const locTxs = txs.filter((t) => t.location_id === loc.id);
      const last = [...locTxs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      const todayCount = locTxs.filter((t) => t.tx_date === today).length;
      let status = "down";
      if (last) {
        const diffHr = (getAccurateNow() - new Date(last.created_at)) / 3600000;
        status = diffHr < 3 ? "ok" : diffHr < 24 ? "warn" : "down";
      }
      return { id: loc.id, name: loc.name, status, lastAgo: last ? timeAgo(last.created_at) : "No transactions on file", todayCount };
    });
  }, [locations, txs, today]);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Station Health" subtitle="How recently each station has recorded activity" />
      <main className="flex-1 overflow-y-auto bg-paper p-6">
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
          <Activity size={14} className="mt-0.5 shrink-0 text-slate-300" />
          <span>
            Based on each station's most recent transaction — not a live connection to the scale itself. "Quiet" just means nothing's
            landed in the database recently; it could mean a real problem, or just that no truck has come in yet.
          </span>
        </div>

        {loadError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <span>{loadError}</span>
            <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">Retry</button>
          </div>
        )}

        {loading && stationStats.length === 0 ? (
          <p className="px-1 py-10 text-center text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {stationStats.map((s) => {
              const meta = STATUS_META[s.status];
              return (
                <div key={s.id} className={`rounded-xl border border-slate-200 border-t-[3px] bg-white p-4 ${meta.border}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">{s.name}</h3>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.pillBg} ${meta.pillText}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-slate-500">
                    <p>Last transaction: <span className="font-medium text-slate-700">{s.lastAgo}</span></p>
                    <p>Today so far: <span className="font-medium text-slate-700">{s.todayCount} ticket{s.todayCount === 1 ? "" : "s"}</span></p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
