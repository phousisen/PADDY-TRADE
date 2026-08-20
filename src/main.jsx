import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import { AuthProvider } from "./AuthContext.jsx";
import { LanguageProvider } from "./i18n.jsx";
import "./index.css";

// Makes the app installable and caches it on this device, so it can be
// reopened later with zero internet connection — only actual data
// (tickets, transactions, etc.) still needs a live connection to sync,
// same as before. `immediate: true` activates the offline copy right
// away instead of waiting for the next full page reload.
registerSW({ immediate: true });

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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LanguageProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </LanguageProvider>
  </React.StrictMode>
);
