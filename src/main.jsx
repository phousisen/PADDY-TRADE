import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { startSessionWatch } from "./sessionWatch.js";
import { ensureFreshSession } from "./supabaseClient.js";
import { AuthProvider } from "./AuthContext.jsx";
import { LanguageProvider } from "./i18n.jsx";
import "./index.css";

// Makes the app installable and caches it on this device, so it can be
// reopened later with zero internet connection — only actual data
// (tickets, transactions, etc.) still needs a live connection to sync,
// same as before. `immediate: true` activates the offline copy right
// away instead of waiting for the next full page reload.
//
// [2026-09-16] A service worker only looks for new code when the page LOADS.
// A station PC with the installed app open all week therefore never checks,
// and quietly runs whatever version it had when it was last opened —
// Reang Kesey was still on pre-merge code days later and kept re-creating a
// paddy type that had been merged away three times.
//
// What DECIDES that an update exists, and when the page turns over, now
// lives in appUpdate.js and UpdateBanner.jsx — a plain fetch of version.json
// that no cache can swallow, and a reload that waits until nobody is
// mid-ticket. This registration is unchanged and deliberately so: when the
// reload happens, autoUpdate + skipWaiting are what make it land on the new
// code instead of serving the old one back.
//
// The registration is parked on window so the banner can ask the service
// worker to update just before it reloads. Nothing else reads it, and the
// app works without it — a browser with no service worker at all (an old
// phone, a private window) still gets the version check and the reload.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    window.__paddytradeSW = registration || null;
  },
});

// [2026-09-16] A phone suspends an app it has put in a pocket, which stops the
// login token renewing itself, and the page that comes back is the same page —
// it does not reload and nothing on it re-asks. SISEN's parents saw that as
// being logged out, or as every figure reading 0.
//
// This renews the login the moment the app returns, BEFORE anything asks the
// database, and then tells the screens to ask again. See sessionWatch.js.
startSessionWatch({ ensureFresh: ensureFreshSession });

// Stops the mouse scroll wheel from silently changing the value of a
// focused number field — a common browser quirk where scrolling the page
// while the cursor happens to be sitting over a number input bumps its
// value up or down. Applies to every number field in the app (weights,
// prices, percentages, etc.) — staff should only ever change these by
// typing, never by an accidental scroll.
document.addEventListener(
  "wheel",
  () => {
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.type === "number") {
      document.activeElement.blur();
    }
  },
  { passive: true }
);

// [2026-09-16] ErrorBoundary is OUTSIDE both providers on purpose. React
// unmounts the entire tree when anything throws while rendering, and with
// nothing to catch it the page goes blank — which is exactly what SISEN saw
// signing in to the new Viewer account: "the screen is plain white".
//
// Wrapped outermost so it also catches a crash in the language or login
// provider itself. It renders plain Tailwind and reads no context, so it
// cannot fail for the same reason the thing it caught did.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
