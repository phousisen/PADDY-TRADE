import { useEffect, useState } from "react";
import { api } from "../api.js";
import { withTimeout } from "../offlineQueue.js";

// Bounds the Supabase cloud-fallback read below — this path only runs when
// the local bridge (same-machine, effectively instant) didn't answer, e.g.
// this station's bridge.js isn't running, or someone's checking a location's
// live weight from a different computer entirely. A degraded-but-not-fully-
// down connection could otherwise leave this fetch hanging indefinitely,
// which — combined with poll() re-firing every POLL_INTERVAL_MS — could
// stack up an unbounded number of pending requests, the same class of bug
// fixed earlier
// on the Weighing Tickets and Transactions pages (see BOARD_LOAD_TIMEOUT_MS /
// LOAD_TIMEOUT_MS there).
const CLOUD_FALLBACK_TIMEOUT_MS = 2500;

// The small bridge program running at each location (see the
// weighbridge-agent folder) now also runs its own tiny local web server on
// this computer, at this address — reading it is a same-machine request
// that never touches the internet at all, unlike the Supabase table below
// which does. Checking this FIRST means the scale stays "connected" here
// 24/7 whenever the bridge program is running and the scale is plugged in,
// completely independent of whether this computer's internet is working.
const LOCAL_BRIDGE_URL = "http://127.0.0.1:8787/weight";

// How often to check the local bridge for a fresh reading. This is a
// same-machine request answered straight from bridge.js's in-memory state
// (no disk, no network) — real-world measured cost is low single-digit
// milliseconds, so polling faster does not meaningfully add load. [2026-08-27]
// Lowered from 400ms after on-site feedback that the display looked
// noticeably behind a fast-changing scale — the KELI D2008 sends a new frame
// roughly every 150-200ms (confirmed from a real debug-mode console capture
// at the Ping Pong station), so 400ms meant the screen could lag up to
// ~400ms behind the true reading. 150ms tracks the scale's own frame rate
// closely enough that further lowering it would not show anything sooner,
// since bridge.js can't report a reading it hasn't received yet.
const POLL_INTERVAL_MS = 150;

async function pollLocalBridge() {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(LOCAL_BRIDGE_URL, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.weight_kg === null || data.weight_kg === undefined) return null;
    return { weight_kg: data.weight_kg, updated_at: data.updated_at, source: "local" };
  } catch {
    // Nothing running on localhost:8787 — either the bridge program isn't
    // running on THIS computer, or this is a different device (e.g. an
    // admin checking in from home). Not an error, just means we fall back
    // to the cloud reading below.
    return null;
  }
}

// Live weighbridge connection — tries this same computer's local bridge
// server first (works with zero internet), and only falls back to
// Supabase's `scale_readings` table (needs internet) if nothing answers
// locally. Either way, a reading older than a few seconds is treated as
// "not connected" so a stale number never gets mistaken for a live one.
export function useLiveWeight(locationId) {
  const [reading, setReading] = useState(null);

  useEffect(() => {
    if (!locationId) { setReading(null); return; }
    let cancelled = false;
    // [2026-08-26] Pause this poll (and the re-renders it causes) while a
    // print is in progress. This component can still be mounted (just
    // hidden underneath the receipt/slip overlay — see index.css) when
    // someone prints, and Chrome's print-preview renderer has been hanging
    // on "Loading preview…" on some station PCs. A component re-rendering
    // several times a second the whole time a print dialog is open is a
    // plausible way to stop the page from ever reaching the idle state
    // Chrome needs to finish generating a preview — pausing it is a safe,
    // free bit of extra insurance on top of the animation fix in
    // index.css, whether or not it turns out to be the actual cause.
    let printing = typeof window !== "undefined" && window.matchMedia?.("print").matches;

    async function poll() {
      if (printing) return;
      const local = await pollLocalBridge();
      if (cancelled) return;
      if (local) { setReading(local); return; }
      const cloud = await withTimeout(api.getLiveWeight(locationId).catch(() => null), CLOUD_FALLBACK_TIMEOUT_MS, null);
      if (!cancelled) setReading(cloud ? { ...cloud, source: "cloud" } : null);
    }

    const handleBeforePrint = () => { printing = true; };
    const handleAfterPrint = () => { printing = false; poll(); };
    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [locationId]);

  const ageMs = reading?.updated_at ? Date.now() - new Date(reading.updated_at).getTime() : Infinity;
  const connected = ageMs < 6000;
  return { connected, weightKg: reading?.weight_kg, source: reading?.source };
}

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

export default function LiveWeightBox({ locationId, label, onUse }) {
  const { connected, weightKg } = useLiveWeight(locationId);
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${connected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
        <div>
          <p className={`text-xs font-medium ${connected ? "text-emerald-700" : "text-slate-400"}`}>{connected ? (label || "Live Scale Weight") : "Scale not connected"}</p>
          <p className={`text-lg font-bold ${connected ? "text-emerald-800" : "text-slate-300"}`}>{connected ? `${fmt2(weightKg)} kg` : "— kg"}</p>
        </div>
      </div>
      {connected && onUse && (
        <button type="button" onClick={() => onUse(weightKg)}
          className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
          Use This
        </button>
      )}
    </div>
  );
}
