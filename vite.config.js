import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
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
