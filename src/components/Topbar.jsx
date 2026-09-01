import { useEffect, useRef, useState } from "react";
import { Search, Bell, WifiOff, RefreshCw, AlertTriangle, X, ShieldCheck, LogOut } from "lucide-react";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { onSyncStatusChange } from "../offlineQueue.js";
import { api } from "../api.js";
import { getAccurateNow, supabase } from "../supabaseClient.js";

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

function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((getAccurateNow() - new Date(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// [2026-09-01] Notification Center — wires up the bell icon that's sat here
// undecorated since it was first added (see the mobile-fix comment above:
// "the bell has no onClick"). Lives in Topbar for the same reason the sync
// banner does — rendered on every page, so something needing attention is
// visible no matter where staff happen to be, not just on the one page that
// caused it. Deliberately scoped to what's already computable from data the
// app already fetches, with no new database table: pending Change Requests
// (same admin-only query the Sidebar's own badge uses — fetched
// independently here since Topbar has no single shared mount point to read
// that from) and this device's own sync trouble (reusing the exact same
// onSyncStatusChange feed the banner below already subscribes to). Station-
// offline and overdue-receivable alerts are NOT included yet — the first
// needs each station's bridge.js to report a heartbeat somewhere, which
// doesn't exist today, and the second needs the aging math pulled out of
// the Receivables report into something callable from here.
function NotificationBell() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [open, setOpen] = useState(false);
  const [pendingReqs, setPendingReqs] = useState([]);
  const [syncStatus, setSyncStatus] = useState({ online: true, syncing: false, pending: 0, stuck: false, sessionExpired: false });
  const boxRef = useRef(null);

  useEffect(() => onSyncStatusChange(setSyncStatus), []);

  useEffect(() => {
    if (!isAdmin) { setPendingReqs([]); return; }
    let cancelled = false;
    api.getChangeRequests()
      .then((rows) => {
        if (cancelled) return;
        setPendingReqs(
          rows
            .filter((r) => r.status === "pending")
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        );
      })
      .catch(() => {}); // same fire-and-forget-on-failure as the Sidebar badge — a failed fetch just means no badge, not an error banner
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    if (!open) return;
    function onOutside(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  // Same priority order as SyncStatusBanner just below: a dead login first
  // (the fix is just signing in again), then a genuinely stuck save (needs
  // an admin), then plain offline-with-something-waiting. Mirrors that
  // banner's logic exactly rather than reimplementing it differently.
  const syncNotice = syncStatus.sessionExpired
    ? { kind: "session", text: "Your login has expired — sign in again to keep saving." }
    : syncStatus.stuck
    ? { kind: "stuck", text: `${syncStatus.pending} change${syncStatus.pending === 1 ? "" : "s"} on this device failed to save repeatedly — this device needs an admin's attention.` }
    : !syncStatus.online && syncStatus.pending > 0
    ? { kind: "offline", text: `${syncStatus.pending} change${syncStatus.pending === 1 ? "" : "s"} saved on this device, waiting for the connection to come back.` }
    : null;

  const count = pendingReqs.length + (syncNotice ? 1 : 0);
  const dotClass = syncNotice?.kind === "stuck" ? "bg-rose-500" : syncNotice?.kind === "session" ? "bg-indigo-500" : "bg-amber-500";

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-100"
      >
        <Bell size={17} />
        {count > 0 && <span className={`absolute right-2 top-2 h-1.5 w-1.5 rounded-full ${dotClass}`} />}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-500">Notifications</div>
          {count === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Nothing needs your attention right now.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {syncNotice && (
                <div className={`flex gap-2.5 border-b border-slate-100 px-4 py-3 ${syncNotice.kind === "stuck" ? "bg-rose-50/50" : ""}`}>
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
                  <p className="text-xs text-slate-600">{syncNotice.text}</p>
                </div>
              )}
              {pendingReqs.slice(0, 6).map((r) => (
                <div key={r.id} className="flex gap-2.5 border-b border-slate-100 px-4 py-3 last:border-0">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-700">Change Request pending review</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {r.transactions?.paper_ticket_no || r.transactionCode} · {r.requestedByName} · {timeAgo(r.created_at)}
                    </p>
                  </div>
                </div>
              ))}
              {pendingReqs.length > 6 && (
                <p className="px-4 py-2 text-center text-[11px] text-slate-400">+{pendingReqs.length - 6} more pending — see Change Requests</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// [2026-09-01] Account & Security — the profile chip in the top-right has
// sat non-clickable since it was added ("nothing about the PC layout
// changes" in the mobile-fix comment above never claimed it would stay
// non-interactive forever, it just hadn't been wired up yet). This adds a
// real "My Account" area, reachable from every page since Topbar already
// renders on all of them, no new navigation route needed.
//
// Deliberately scoped down from an earlier mockup that also showed a list
// of every device currently signed in — that isn't something the app can
// safely show from the browser (it needs an admin-level key that must
// never live in client code). What's here instead is everything that IS
// safely doable with the account's own login, all via Supabase Auth's
// standard client-side calls: real TOTP two-factor authentication (enroll/
// verify/turn off), a single "sign out everywhere" action that ends every
// session for this account at once without needing to know what they are,
// and a plain password change.
function AccountSecurityModal({ onClose }) {
  const [factors, setFactors] = useState(null); // null = still loading
  const [loadErr, setLoadErr] = useState("");
  const [enrolling, setEnrolling] = useState(null); // { factorId, qrCode, secret } while mid-setup
  const [code, setCode] = useState("");
  const [mfaErr, setMfaErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [signOutErr, setSignOutErr] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  async function loadFactors() {
    setLoadErr("");
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) { setLoadErr(error.message || "Couldn't check your 2FA status."); setFactors([]); return; }
    setFactors(data?.totp || []);
  }
  useEffect(() => { loadFactors(); }, []);

  const verifiedFactor = (factors || []).find((f) => f.status === "verified");

  async function startEnroll() {
    setMfaErr(""); setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (error) { setMfaErr(error.message || "Couldn't start 2FA setup."); return; }
    setEnrolling({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnroll() {
    if (!enrolling || code.trim().length < 6) return;
    setBusy(true); setMfaErr("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.factorId, code: code.trim() });
    setBusy(false);
    if (error) { setMfaErr(error.message || "That code didn't match — try again."); return; }
    setEnrolling(null); setCode("");
    loadFactors();
  }

  async function cancelEnroll() {
    // Clean up the half-finished, never-verified factor so it doesn't sit
    // around cluttering the account — a no-op if this somehow fails, since
    // an unverified factor was never actually protecting anything anyway.
    if (enrolling) await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }).catch(() => {});
    setEnrolling(null); setCode(""); setMfaErr("");
  }

  async function turnOff() {
    if (!verifiedFactor) return;
    setBusy(true); setMfaErr("");
    const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactor.id });
    setBusy(false);
    if (error) { setMfaErr(error.message || "Couldn't turn off 2FA."); return; }
    loadFactors();
  }

  async function changePassword() {
    setPwErr(""); setPwMsg("");
    if (pw1.length < 6) { setPwErr("Password must be at least 6 characters."); return; }
    if (pw1 !== pw2) { setPwErr("Passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) { setPwErr(error.message || "Couldn't update your password."); return; }
    setPwMsg("Password updated.");
    setPw1(""); setPw2("");
  }

  async function signOutEverywhere() {
    setSigningOut(true); setSignOutErr("");
    // scope:"global" revokes every refresh token for this account, this
    // device included — the app's own auth listener (AuthContext.jsx)
    // picks up the resulting SIGNED_OUT event and returns to the login
    // screen on its own, no manual redirect needed here.
    const { error } = await supabase.auth.signOut({ scope: "global" });
    setSigningOut(false);
    if (error) setSignOutErr(error.message || "Couldn't sign out everywhere — try again.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="font-semibold text-slate-700">Account &amp; Security</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="mb-4 rounded-lg border border-slate-200 p-4">
          <p className="mb-1 text-sm font-semibold text-slate-700">Two-Factor Authentication</p>
          <p className="mb-3 text-xs text-slate-400">Require a 6-digit code from an authenticator app in addition to your password.</p>
          {factors === null ? (
            <p className="text-xs text-slate-400">Checking…</p>
          ) : loadErr ? (
            <p className="text-xs text-rose-600">{loadErr}</p>
          ) : enrolling ? (
            <div>
              {enrolling.qrCode && <img src={enrolling.qrCode} alt="Scan with your authenticator app" className="mb-2 h-32 w-32 rounded border border-slate-200" />}
              <p className="mb-2 text-[11px] text-slate-400">Can't scan? Enter this key manually: <span className="font-mono">{enrolling.secret}</span></p>
              <input
                value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" maxLength={6}
                className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
              {mfaErr && <p className="mb-2 text-xs text-rose-600">{mfaErr}</p>}
              <div className="flex gap-2">
                <button onClick={cancelEnroll} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 disabled:opacity-40">Cancel</button>
                <button onClick={confirmEnroll} disabled={busy || code.trim().length < 6} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                  {busy ? "Confirming…" : "Confirm & turn on"}
                </button>
              </div>
            </div>
          ) : verifiedFactor ? (
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700"><span className="h-1.5 w-1.5 rounded-full bg-brand-600" /> 2FA is on</span>
              <button onClick={turnOff} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                {busy ? "…" : "Turn off"}
              </button>
            </div>
          ) : (
            <div>
              {mfaErr && <p className="mb-2 text-xs text-rose-600">{mfaErr}</p>}
              <button onClick={startEnroll} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                {busy ? "…" : "Turn on 2FA"}
              </button>
            </div>
          )}
        </div>

        <div className="mb-4 rounded-lg border border-slate-200 p-4">
          <p className="mb-1 text-sm font-semibold text-slate-700">Sign Out Everywhere</p>
          <p className="mb-3 text-xs text-slate-400">Ends every login for this account on every device at once — including this one, so you'll need to sign back in here too.</p>
          {signOutErr && <p className="mb-2 text-xs text-rose-600">{signOutErr}</p>}
          <button onClick={signOutEverywhere} disabled={signingOut} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40">
            {signingOut ? "Signing out…" : "Sign out everywhere"}
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">Change Password</p>
          <input
            type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="New password" autoComplete="new-password"
            className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          <input
            type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm new password" autoComplete="new-password"
            className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          {pwErr && <p className="mb-2 text-xs text-rose-600">{pwErr}</p>}
          {pwMsg && <p className="mb-2 text-xs text-brand-700">{pwMsg}</p>}
          <button onClick={changePassword} disabled={busy || !pw1 || !pw2} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {busy ? "Saving…" : "Change Password"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountMenu({ profile, t, logout }) {
  const [open, setOpen] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  if (!profile) return null;

  return (
    <>
      <div className="relative hidden md:block" ref={boxRef}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 border-l border-slate-200 pl-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-semibold text-white shadow-sm">
            {(profile.full_name || "U").charAt(0).toUpperCase()}
          </div>
          <div className="leading-tight text-left">
            <p className="text-sm font-semibold text-slate-700">{profile.full_name}</p>
            <p className="text-xs text-slate-400">{t(`role_${profile.role}`)}</p>
          </div>
        </button>
        {open && (
          <div className="absolute right-0 top-12 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <button
              onClick={() => { setShowSecurity(true); setOpen(false); }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <ShieldCheck size={15} className="text-slate-400" /> Account &amp; Security
            </button>
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <LogOut size={15} className="text-slate-400" /> Sign out
            </button>
          </div>
        )}
      </div>
      {showSecurity && <AccountSecurityModal onClose={() => setShowSecurity(false)} />}
    </>
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
          into the content below. Below md, both are hidden (the search
          input still has no onChange — that part's unaffected) and the
          title gets `truncate` so it stays on one line instead of wrapping.
          At md+ this renders exactly as before: same search box, same
          profile block, nothing about the PC layout changes.
          [2026-09-01] The bell itself is no longer purely decorative — see
          NotificationBell above — so it's intentionally left visible at every
          width, mobile included, rather than folded under the md breakpoint
          with the rest; something needing attention should be reachable from
          a phone-width screen too, not just desktop. */}
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
          <NotificationBell />
          <AccountMenu profile={profile} t={t} logout={logout} />
        </div>
      </header>
      <SyncStatusBanner onSignInAgain={logout} />
    </>
  );
}
