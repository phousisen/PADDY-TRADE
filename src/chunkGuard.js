// A page that outlived the build it came from.
//
// [2026-09-16] SISEN, after uploading a new version:
//
//     "everytime we upload new zip. the sytem will ask to update like 3-4
//      times on repeat then it sometimes crash like this"
//
// — with a screenshot of the app's top bar and nothing under it.
//
// WHAT IS ACTUALLY HAPPENING
//
// The app is not one file. It is a shell plus a dozen pieces that load only
// when they are needed, and every piece carries a hash of its contents in
// its own file name. Deploy a new build and every hash changes; the old
// files are gone from the server within seconds.
//
// So a phone that has had the app open since before the deploy is holding a
// page that knows the OLD names. Open a screen it has not opened yet and it
// asks for a file that no longer exists anywhere. The request 404s, the
// import rejects, and the app dies mid-render — top bar drawn, nothing
// under it.
//
// WHY ErrorBoundary DID NOT CATCH IT
//
// A React error boundary catches something THROWN WHILE RENDERING. This is a
// network request failing inside a promise, so it surfaces as an unhandled
// rejection with no component anywhere near it. The boundary never sees it,
// which is why the screen went blank again after the boundary shipped.
//
// WHAT THIS DOES
//
// Listens for that specific failure and reloads once. A reload fetches the
// current index.html and the current file names, and the screen the person
// asked for opens normally — they see a flicker instead of a dead app.
//
// ONCE is the whole design. If the reload lands on a page that fails the
// same way, reloading again would spin forever, so the second failure is
// left to the error screen, which at least says something. The marker lives
// in sessionStorage: it clears when the app is properly closed, so a genuine
// failure tomorrow is still handled.

const FLAG = "paddytrade_chunk_reloaded";

// Every browser words this differently, and the words are all we get.
const PATTERNS = [
  /loading chunk/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading css chunk/i,
  /'text\/html' is not a valid javascript mime type/i,
];

/**
 * Does this look like a page asking for a file the server has replaced?
 *
 * Deliberately narrow. A reload is a blunt instrument — it throws away
 * anything typed and not yet saved — so it must not fire for an ordinary
 * network blip or a failed data request. Only the module loader's own
 * failures qualify; everything else belongs to the error screen.
 */
export function looksLikeStaleChunk(message) {
  const text = String(message || "");
  if (!text) return false;
  return PATTERNS.some((re) => re.test(text));
}

/** Has this tab already recovered once? */
export function alreadyRecovered(storage) {
  try {
    const s = storage || (typeof sessionStorage === "undefined" ? null : sessionStorage);
    return s ? s.getItem(FLAG) === "1" : false;
  } catch {
    // Storage blocked. Treat it as "already recovered" — refusing to reload
    // shows a readable error screen, while reloading with no way to remember
    // it could loop forever. Between a message and a spin, take the message.
    return true;
  }
}

export function markRecovered(storage) {
  try {
    const s = storage || (typeof sessionStorage === "undefined" ? null : sessionStorage);
    if (s) s.setItem(FLAG, "1");
  } catch { /* nothing to do — alreadyRecovered() returns true in this case */ }
}

/**
 * The decision, kept pure so scripts-check-chunk.mjs can run every branch.
 */
export function shouldRecover({ message, recovered }) {
  if (recovered) return false;
  return looksLikeStaleChunk(message);
}

/**
 * Start listening. Called once, from main.jsx.
 *
 * @returns {() => void} stop listening
 */
export function startChunkGuard({
  win = typeof window === "undefined" ? null : window,
  storage,
  reload,
} = {}) {
  if (!win) return () => {};

  const recover = (message) => {
    if (!shouldRecover({ message, recovered: alreadyRecovered(storage) })) return false;
    markRecovered(storage);
    // A plain reload is enough: index.html is served with no-cache, so it
    // comes back naming the files that exist now.
    if (typeof reload === "function") reload();
    else win.location.reload();
    return true;
  };

  // Vite's own event, fired when a preloaded module cannot be fetched. This
  // is the earliest and most reliable signal, and it is specific — nothing
  // else raises it.
  const onPreload = (e) => { recover(e?.payload?.message || "failed to fetch dynamically imported module"); };
  // The general case: an import that rejects with nothing catching it.
  const onRejection = (e) => { recover(e?.reason?.message || e?.reason); };
  // And a script tag that fails outright.
  const onError = (e) => { recover(e?.message || e?.error?.message); };

  win.addEventListener("vite:preloadError", onPreload);
  win.addEventListener("unhandledrejection", onRejection);
  win.addEventListener("error", onError);

  return () => {
    win.removeEventListener("vite:preloadError", onPreload);
    win.removeEventListener("unhandledrejection", onRejection);
    win.removeEventListener("error", onError);
  };
}
