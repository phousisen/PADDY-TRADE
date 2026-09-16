import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// [2026-09-16] THE BUILD STAMPS ITSELF.
//
// SISEN: "each location doesnt know or there system wont auto update until
// they refresh their app ... i need a professional version of the system."
//
// Nothing in the app could say which version a station was running, so a
// station could be days behind (Reang Kesey was, three times) and the only
// way to find out was to walk there.
//
// Every build now produces one string — 2026.09.16-1742-a1b2c3d, Cambodia
// time plus the commit — and puts it in two places:
//
//   · baked into the bundle, as __APP_VERSION__ (see src/version.js), so a
//     running page knows what IT is, and reports it to HQ on the heartbeat
//     it already sends;
//   · written to version.json beside the bundle, so a running page can ask
//     the server what the NEWEST one is with a plain fetch — no service
//     worker in the way, nothing a cache can swallow.
//
// The difference between those two is the whole update mechanism. See
// src/appUpdate.js.
function buildVersion() {
  const p = {};
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Phnom_Penh",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  const stamp = `${p.year}.${p.month}.${p.day}-${p.hour}${p.minute}`;
  // Vercel hands the commit to the build; a local build asks git. Neither
  // is required — the timestamp alone is already unique per build.
  let sha = process.env.VERCEL_GIT_COMMIT_SHA || "";
  if (!sha) {
    try { sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
    catch { sha = ""; }
  }
  return sha ? `${stamp}-${String(sha).slice(0, 7)}` : stamp;
}

const APP_VERSION = buildVersion();

// Writes version.json into the build output. Not in public/, because that
// would be a file in the repo that every build fights over — this is
// generated, so it is emitted.
//
// Deliberately .json: the service worker precaches
// **/*.{js,css,html,ico,png,svg,woff2} and does NOT precache .json, so this
// one file always comes from the network and always tells the truth.
function versionFile() {
  return {
    name: "paddytrade-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: APP_VERSION, builtAt: new Date().toISOString() }),
      });
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    versionFile(),
    react(),
    // Makes PaddyTrade installable (an icon on the desktop/home screen,
    // no browser address bar) and — most importantly — caches the app
    // itself on the device the first time it's opened with internet. After
    // that, the app opens and works even with zero connection at all
    // (weighing tickets, transactions, everything already saves locally
    // and syncs later — see offlineQueue.js). Only truly new data that has
    // never been seen on this device before (a brand-new farmer looked up
    // for the first time, for example) needs a live connection.
    VitePWA({
      // [2026-09-16] Deliberately left as "autoUpdate", with skipWaiting and
      // clientsClaim below unchanged. That path is proven on all five
      // stations, and switching it to "prompt" would leave every currently
      // installed app — which is running the OLD registration code — waiting
      // for a message it does not know how to ask for. The new machinery in
      // src/appUpdate.js sits ALONGSIDE this: it decides WHEN the page turns
      // over, and this decides what happens when it does.
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "PaddyTrade",
        short_name: "PaddyTrade",
        description: "Baitang Kampuchea Plc. — live paddy trading management",
        theme_color: "#217A4F",
        background_color: "#F3FBF6",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the whole built app (JS/CSS/HTML/icons) so it can open
        // completely offline once it's been visited here at least once.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        // [2026-09-16] …but NOT for version.json.
        //
        // navigateFallback hands the app shell to any address typed in the
        // bar, so opening /version.json in a browser showed the Dashboard and
        // looked exactly like a failed build. The app itself was never
        // affected — a fetch() is not a navigation request, so it always
        // reached the real file — but a system nobody can check by hand is
        // not one anybody should be asked to trust.
        //
        // With this, typing the address shows the version, on any machine,
        // including a station's.
        navigateFallbackDenylist: [/^\/version\.json/],
        // Make a fresh deploy take over immediately instead of waiting for
        // every open tab/window of the installed app to be fully closed
        // first — without this, a station's installed app can keep quietly
        // running yesterday's code for a long time after a fix has shipped.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Google Fonts — cache them too so the Khmer/Latin fonts don't
            // silently disappear the first time the app opens offline.
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
