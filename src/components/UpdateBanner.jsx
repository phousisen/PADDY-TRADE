import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { api } from "../api.js";
import { APP_VERSION } from "../version.js";
import { getDeviceId, describeDevice } from "../deviceId.js";
import { getPlace } from "../deviceNet.js";
import { supabase } from "../supabaseClient.js";
import { onSyncStatusChange } from "../offlineQueue.js";
import {
  watchForUpdates, trackActivity, looksBusy, reloadWhenFree,
  FORCED_RELOAD_AFTER_MS,
} from "../appUpdate.js";

// The one thing on screen that says a station is about to take new code.
//
// [2026-09-16] SISEN: "each location doesnt know or there system wont auto
// update until they refresh their app or close and open again ... i need a
// professional version of the system. like top level."
//
// Three jobs, all of them small:
//
//   1. Tell HQ what this browser is running, every couple of minutes. That
//      is the only reason the HQ version list has anything in it.
//   2. Watch for a newer version on the server, and when there is one, say
//      so here and reload the page as soon as nobody is mid-ticket.
//   3. Obey a push from HQ — the same thing, but it does not wait forever.
//
// It renders nothing at all until one of those happens, so on a normal day
// this component is invisible.

// [2026-09-16] Once a minute, not once every two. SISEN: "its best to know
// in details and very fast." Three missed check-ins is what turns a station
// amber, so the check-in itself has to be quick or "fast" means nothing. It
// is one small call — at five stations that is a few hundred bytes a minute.
const REPORT_MS = 60 * 1000;

export default function UpdateBanner() {
  const { t } = useLanguage();
  const [newVersion, setNewVersion] = useState(null);
  const [pushed, setPushed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const activity = useRef(null);
  const openedAt = useRef(Date.now());

  // ── 1 & 3. report this version, and watch for a push from HQ ───────────
  useEffect(() => {
    let cancelled = false;

    const deviceId = getDeviceId();
    const { platform, browser } = describeDevice();

    // [2026-09-16] SISEN, looking at Pong Ro's screen saying it could not
    // reach the server while HQ's screen said Connected: "and its funny how
    // it says connected in the station health."
    //
    // He was right. "Connected" only ever meant "this machine checked in
    // within three minutes", which on a patchy line is entirely compatible
    // with a page read failing ten seconds later.
    //
    // A machine cannot report trouble WHILE it is having it — but it can
    // report it the moment the line comes back. So every check-in now
    // carries how many attempts failed before this one got through, and what
    // the offline queue is holding.
    let missed = 0;
    let sync = { pending: 0, stuck: false };
    const stopSync = onSyncStatusChange((st) => { sync = st || sync; });

    async function tick() {
      // One call does both jobs: it records this MACHINE, and keeps the
      // account's own version column in step. If the database has not had
      // device_sessions.sql run yet it returns false, and the older
      // account-only report still happens — so an app that reaches a station
      // before the migration does still reports something useful.
      // The city is a hint from a free lookup, cached for hours and silent on
      // failure; the ADDRESS is read server-side from the request itself, so
      // nothing here can claim to be somewhere it is not. See deviceNet.js.
      const place = await getPlace();
      const { ok, signOut } = await api.reportDevice({
        deviceId, version: APP_VERSION, platform, browser,
        city: place?.city, region: place?.region, country: place?.country,
        missed, pending: sync.pending || 0, stuck: !!sync.stuck,
      });
      if (!ok) {
        // Count it and say so on the next one that gets through.
        missed += 1;
        api.reportAppVersion(APP_VERSION);
      } else {
        missed = 0;
      }

      // HQ has signed this machine out. The database cleared the request as
      // it answered, so this happens once and cannot loop.
      if (signOut) {
        try { await supabase.auth.signOut(); } catch { /* already gone */ }
        return;
      }
      try {
        const control = await api.getAppControl();
        const at = control?.reload_requested_at;
        // Only a push made AFTER this page loaded counts. Otherwise every
        // reload would see the same old timestamp and reload again, forever.
        if (!cancelled && at && new Date(at).getTime() > openedAt.current) setPushed(true);
      } catch {
        // Offline, or not migrated yet. Nothing here is worth an error.
      }
    }

    tick();
    const timer = setInterval(tick, REPORT_MS);
    return () => { cancelled = true; clearInterval(timer); stopSync?.(); };
  }, []);

  // ── 2. watch for a newer build ─────────────────────────────────────────
  useEffect(() => {
    activity.current = trackActivity();
    const stop = watchForUpdates({ onUpdate: (v) => setNewVersion(v) });
    return () => { stop(); activity.current?.stop(); };
  }, []);

  // ── the reload itself ──────────────────────────────────────────────────
  //
  // An update found on its own waits for the screen to be free, with no
  // deadline — running yesterday's code for another ten minutes is never
  // worse than pulling the page out from under a half-typed ticket.
  //
  // A push from HQ waits too, but not forever: SISEN pressed the button
  // because something needs to reach the stations now.
  useEffect(() => {
    if (!newVersion && !pushed) return undefined;
    setReloading(true);
    const cancel = reloadWhenFree({
      // No tracker means "cannot tell", and cannot-tell must read as busy —
      // the wrong way round here reloads the page under somebody's hands.
      isBusy: () => {
        const tracker = activity.current;
        return tracker ? looksBusy({ lastActivityAt: tracker.lastActivityAt() }) : true;
      },
      deadlineMs: pushed ? FORCED_RELOAD_AFTER_MS : null,
      registration: window.__paddytradeSW || null,
    });
    return cancel;
  }, [newVersion, pushed]);

  if (!newVersion && !pushed) return null;

  // BOTTOM, not a strip across the top.
  //
  // A fixed bar at top-0 would sit over the Topbar on every screen — the page
  // title, the sync warning, the "view details" button — and, at any z-index
  // above 60, over an open modal's header as well. This has to be impossible
  // to miss without covering anything, so it sits at the bottom, clear of
  // MobileNav (z-40, bottom-0, phones only), and every page already reserves
  // 6rem of bottom padding for that bar. z-30 keeps it under both MobileNav
  // and every modal.
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-5 print:hidden">
      <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-brand-700 bg-brand-600 px-4 py-2.5 text-white shadow-xl">
        <RefreshCw size={15} className={`shrink-0 ${reloading ? "animate-spin" : ""}`} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {pushed ? t("upd_pushed") : t("upd_available")}
          </p>
          <p className="truncate text-[11px] text-brand-100/80">{t("upd_waiting")}</p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25"
        >
          {t("upd_now")}
        </button>
      </div>
    </div>
  );
}
