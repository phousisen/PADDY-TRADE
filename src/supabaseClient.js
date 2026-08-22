import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in a .env file locally, or in your Vercel project's Environment Variables."
  );
}

// Station WiFi is sometimes "connected" but has no real internet (router up,
// ISP/modem down) — the browser's default fetch has no timeout for that
// case, so every Supabase call could previously hang for 60s+ before
// failing, instead of failing fast and letting the app's offline mode take
// over. That hang is what made the app *feel* slow instead of just offline.
// This wraps every request the Supabase client makes with an 8s timeout.
const FETCH_TIMEOUT_MS = 8000;
function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: options.signal || controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
});
