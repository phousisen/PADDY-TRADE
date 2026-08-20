import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { AuthProvider } from "./AuthContext.jsx";
import { LanguageProvider } from "./i18n.jsx";
import "./index.css";

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
