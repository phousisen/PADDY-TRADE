import React from "react";

// The screen that shows instead of nothing.
//
// [2026-09-16] SISEN, signing in to the new Viewer account for the first
// time: "okay now i can login but the screen is plain white".
//
// WHY IT WAS WHITE
//
// React unmounts the ENTIRE app when any component throws while rendering,
// and with nothing there to catch it, what is left is the bare page — the
// cream of `body { bg-paper }` and not one word. No message, no clue. The
// app had no boundary anywhere, so every crash it has ever had looked
// exactly like this one, including the one underneath: a menu icon used
// but never imported, which only ran for a view-only account and therefore
// waited until the first view-only account existed.
//
// A blank screen is the worst failure a weighbridge can have: it cannot be
// told apart from a dead phone, a bad line, or the business being empty,
// and it gives the person nothing to repeat back down a phone.
//
// WHY IT DOES NOT USE t()
//
// This component wraps LanguageProvider — it has to, or a crash inside the
// provider would go uncaught and produce the very blank page it exists to
// prevent. So there is no translator in scope here, and calling one would
// risk throwing inside the screen that handles throwing. The language is
// read straight from where LanguageProvider keeps it instead, and the few
// words needed are held below in both languages. Recorded as 4 permitted
// strings in scripts-check-i18n.mjs's baseline, with this as the reason.
const TEXT = {
  km: {
    title: "មានបញ្ហាបច្ចេកទេស",
    body: "កម្មវិធីមិនអាចបង្ហាញទំព័រនេះបានទេ។ ទិន្នន័យដែលបានកត់ត្រាទុកមិនប៉ះពាល់ទេ — នេះជាបញ្ហារបស់កម្មវិធី មិនមែនទិន្នន័យរបស់អ្នកទេ។",
    retry: "ព្យាយាមម្តងទៀត",
    signOut: "ចាកចេញ",
    hint: "បើវាកើតឡើងម្តងទៀត សូមផ្ញើអក្សរក្នុងប្រអប់ប្រផេះខាងលើ — វាប្រាប់ពីបញ្ហាពិតប្រាកដ។",
  },
  en: {
    title: "Something went wrong",
    body: "PaddyTrade stopped before it could draw this screen. Nothing you have recorded is affected — this is the app, not your data.",
    retry: "Try again",
    signOut: "Sign out",
    hint: "If it happens again, send the grey text above — it names the exact fault.",
  },
};

// The same key LanguageProvider writes, read without it. Wrapped because a
// private window or blocked storage must not throw here of all places, and
// defaulting to Khmer matches what the app itself does on a fresh device.
function pickLang() {
  try {
    return localStorage.getItem("paddytrade_lang") === "en" ? "en" : "km";
  } catch {
    return "km";
  }
}

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
    // is reachable, and the component stack names which screen died.
    console.error("PaddyTrade crashed:", error, info?.componentStack);
  }

  // Signing out is the escape hatch that a reload is not. If the crash is
  // caused by something about THIS account — as the first one was — then
  // reloading lands straight back on it, forever. Clearing the stored login
  // first means the next load starts clean.
  handleSignOut = () => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-") || k.includes("paddytrade_profile")) localStorage.removeItem(k);
      }
    } catch { /* storage blocked — reload anyway */ }
    window.location.replace("/");
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const s = TEXT[pickLang()];
    const message = String(error?.message || error || "Unknown error");

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-800">{s.title}</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">{s.body}</p>

          {/* Never translated, and selectable on purpose: this is the line
              to read out or send on, and it must arrive unchanged. */}
          <pre className="mt-4 max-h-40 select-all overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[11.5px] leading-relaxed text-slate-600">
            {message}
          </pre>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => window.location.reload()}
              className="min-w-[120px] flex-1 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              {s.retry}
            </button>
            <button
              onClick={this.handleSignOut}
              className="min-w-[120px] flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {s.signOut}
            </button>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-slate-400">{s.hint}</p>
        </div>
      </div>
    );
  }
}
