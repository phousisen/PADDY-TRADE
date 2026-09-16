import React from "react";

// The screen that shows instead of nothing.
//
// [2026-09-16] SISEN, signing in to the new Viewer account for the first
// time: "okay now i can login but the screen is plain white".
//
// WHY IT WAS WHITE
//
// React unmounts the ENTIRE app when any component throws while rendering,
// and if nothing is there to catch it, what is left is a blank page. No
// message, no clue, nothing in front of the person it happened to. The app
// had no boundary anywhere — so every crash, from the first one ever
// written to the next one, looked exactly like this.
//
// A blank screen is the worst possible failure for a weighbridge: it is
// indistinguishable from a dead phone, a bad line, or the business being
// empty, and it tells the person nothing they can act on or repeat back.
//
// WHAT THIS DOES
//
// Catches the crash and says what happened, in a screen anyone can act on:
// try again, or sign out and back in. It also prints the error where it can
// be read aloud down a phone line, because the first thing anyone needs at
// 6am is to be able to say WHICH error, not "it's white".
//
// This does not fix any crash. It makes crashes visible, which is what
// turned a day of guessing into a fixable report.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept in the console as well as on screen: on a station PC the console
    // is reachable, and the component stack says which screen died.
    console.error("PaddyTrade crashed:", error, info?.componentStack);
  }

  // Signing out is the escape hatch that a reload is not. If the crash is
  // caused by something about THIS account — a role with no row, a profile
  // half-written — reloading lands straight back on it, forever. Clearing
  // the cached profile first means the next load starts clean.
  handleSignOut = () => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-") || k.includes("paddytrade")) localStorage.removeItem(k);
      }
    } catch { /* private window, or storage blocked — reload anyway */ }
    window.location.replace("/");
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const message = String(error?.message || error || "Unknown error");

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-800">Something went wrong</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            PaddyTrade stopped before it could draw this screen. Nothing you have
            recorded is affected — this is the app, not your data.
          </p>

          {/* Selectable on purpose: this is the line to read out or send on. */}
          <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[11.5px] leading-relaxed text-slate-600">
            {message}
          </pre>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Try again
            </button>
            <button
              onClick={this.handleSignOut}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-slate-400">
            If it happens again, send the grey text above — it names the exact fault.
          </p>
        </div>
      </div>
    );
  }
}
