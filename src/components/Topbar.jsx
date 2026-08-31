import { useEffect, useState } from "react";
import { Search, Bell, WifiOff, RefreshCw, AlertTriangle } from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { onSyncStatusChange } from "../offlineQueue.js";

// Global "unsynced changes" banner — lives here (not in individual pages)
// specifically because Topbar is rendered on every real page in the app.
// Before this, each of the 3 pages that deal with offline saves
// (TransactionForm, Transactions, WeighingTickets) rendered its own copy of
// this banner, and every OTHER page (Dashboard, Reports, etc.) showed
// nothing at all — so a device with changes stuck unsynced was invisible
// the moment staff navigated away from the one screen that happened to
// mention it. This makes it impossible to be on any screen in the app
// without seeing that something hasn't reached the shared database yet.
function SyncStatusBanner({ onSignInAgain }) {
  const [status, setStatus] = useState({ online: true, syncing: false, pending: 0, stuck: false, sessionExpired: false });
  useEffect(() => onSyncStatusChange(setStatus), []);

  if (status.pending === 0 && !status.stuck && !status.sessionExpired) return null;

  // [2026-08-28] This browser's login itself expired and couldn't renew
  // itself automatically (see ensureFreshSession in supabaseClient.js) —
  // checked and shown BEFORE the generic "stuck" case below on purpose,
  // since a dead login is what was actually behind a real incident at
  // Thapedey that first showed up looking like a permissions problem
  // ("row-level security policy for table products"), which sent
  // troubleshooting the wrong way for a long time. The fix here is just
  // signing in again — nothing queued on this device is touched or lost
  // by doing that; it all resumes and saves normally right after.
  if (status.sessionExpired) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-600 px-6 py-2 text-xs font-semibold text-white">
        <div className="flex items-center gap-2">
          <AlertTriangle size={13} />
          Your login has expired.{status.pending > 0 ? ` ${status.pending} change${status.pending === 1 ? "" : "s"} on this device ${status.pending === 1 ? "is" : "are"} saved safely and waiting — nothing will be lost.` : ""} Sign in again to keep going.
        </div>
        <button
          type="button"
          onClick={onSignInAgain}
          className="shrink-0 rounded-md bg-white/15 px-3 py-1 font-semibold hover:bg-white/25"
        >
          Sign In Again
        </button>
      </div>
    );
  }

  // Genuinely stuck: we ARE online, but the same change has failed to save
  // several times in a row for a real reason (bad data, a permissions
  // problem, a server-side bug) — not something that fixes itself by
  // waiting, because the connection is already back. This is the case that
  // matters most: everything behind it in the queue is blocked too, and
  // nothing about it looks any different from a normal brief delay unless
  // we say so explicitly.
  if (status.stuck) {
    return (
      <div className="flex flex-col gap-0.5 bg-rose-600 px-6 py-2 text-xs font-semibold text-white">
        <div className="flex items-center gap-2">
          <AlertTriangle size={13} />
          {status.pending} change{status.pending === 1 ? "" : "s"} on this device {status.pending === 1 ? "has" : "have"} failed to save to PaddyTrade repeatedly since {status.stuckSince ? new Date(status.stuckSince).toLocaleTimeString([], { timeZone: "Asia/Phnom_Penh", hour: "numeric", minute: "2-digit" }) : "earlier"} — this will NOT fix itself. Do not close this browser or clear its data. Tell an admin now.
        </div>
        {status.lastStuckError && (
          <div className="pl-[21px] font-normal text-rose-100">
            Reason shown by the server ({status.stuckCount === 1 ? "1 ticket affected" : `${status.stuckCount} tickets affected`}): "{status.lastStuckError}" — share this exact text with an admin.
          </div>
        )}
      </div>
    );
  }

  if (!status.online) {
    return (
      <div className="flex items-center gap-2 bg-amber-50 px-6 py-2 text-xs font-medium text-amber-700">
        <WifiOff size={13} />
        No internet — working offline. {status.pending > 0 ? `${status.pending} change${status.pending === 1 ? "" : "s"} saved on this device only, waiting to sync once it's back — don't close this browser or clear its data until then.` : "Anything you save is kept on this device until the connection returns."}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-brand-50 px-6 py-2 text-xs font-medium text-brand-700">
      <RefreshCw size={13} className={status.syncing ? "animate-spin" : ""} />
      {status.syncing ? "Connected — syncing to PaddyTrade…" : `Connected — ${status.pending} change${status.pending === 1 ? "" : "s"} waiting to sync…`}
    </div>
  );
}

export default function Topbar({ title, subtitle }) {
  const { t } = useLanguage();
  const { profile, logout } = useAuth();
  return (
    <>
      {/* [2026-08-31] Mobile fix: the search box (w-64) + profile block used
          to always render, which left almost no room for the title on a
          phone-width screen and forced it to wrap onto 2-3 lines, pushing
          into the content below. Below md, both are hidden (neither one is
          wired to any actual behavior yet — the search input has no
          onChange, the bell has no onClick — so nothing functional is lost)
          and the title gets `truncate` so it stays on one line instead of
          wrapping. At md+ this renders exactly as before: same search box,
          same bell, same profile block, nothing about the PC layout changes. */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-7 md:py-4">
        <div className="min-w-0">
          {title && <h1 className="truncate text-lg font-bold tracking-tight text-slate-800 md:text-xl">{title}</h1>}
          {subtitle && <p className="mt-0.5 truncate text-xs text-slate-400">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3 md:gap-4">
          <div className="relative hidden md:block">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder={t("search_placeholder")} className="w-64 rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100" />
          </div>
          <button className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-100">
            <Bell size={17} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold-500" />
          </button>
          {profile && (
            <div className="hidden items-center gap-2.5 border-l border-slate-200 pl-4 md:flex">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-semibold text-white shadow-sm">
                {(profile.full_name || "U").charAt(0).toUpperCase()}
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-700">{profile.full_name}</p>
                <p className="text-xs text-slate-400">{t(`role_${profile.role}`)}</p>
              </div>
            </div>
          )}
        </div>
      </header>
      <SyncStatusBanner onSignInAgain={logout} />
    </>
  );
}
