// What machine is this, and what should it be called on screen?
//
// [2026-09-16] SISEN: "i want to see how many devices are logged into each
// account ... we just want to track who is actually in the system."
//
// A browser has no name and no serial number, so it is given one: a random id,
// made once, kept in localStorage, and reported on every check-in. That id is
// what turns "Sophal is signed in" into "Sophal is signed in on the Reang
// Kesey PC and on a phone".
//
// NOTHING IDENTIFYING IS COLLECTED. No IP address, no hardware id, no
// location beyond the station the account already belongs to. The id is
// random and means nothing outside this app; the label is a rough guess at
// "PC or phone, which browser", read from the user agent string every website
// already receives. That is the whole point — enough to tell two machines
// apart on a screen, and no more.
//
// The id is per BROWSER PROFILE, not per computer: signing in with a
// different browser, or in a private window, looks like a different machine.
// At a weighbridge that is the honest answer — a second browser IS a second
// place someone is signed in.

const KEY = "paddytrade.deviceId";

/** A short random id. Crypto where available, Math.random where not. */
function makeId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    }
  } catch {
    // Some older browsers expose crypto but throw on randomUUID.
  }
  let out = "";
  for (let i = 0; i < 16; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/**
 * This machine's id, made on first use and kept afterwards.
 *
 * localStorage can throw — a private window, storage full, a locked-down
 * station PC. When it does, a fresh id is handed back for this page only.
 * That machine then looks new on every reload, which is untidy but harmless;
 * what must never happen is the app failing to start over a name tag.
 */
export function getDeviceId(storage) {
  let store = storage;
  if (store === undefined) {
    try { store = typeof localStorage === "undefined" ? null : localStorage; }
    catch { store = null; }
  }
  if (!store) return makeId();
  try {
    const found = store.getItem(KEY);
    if (found && /^[0-9a-z]{8,64}$/i.test(found)) return found;
    const made = makeId();
    store.setItem(KEY, made);
    return made;
  } catch {
    return makeId();
  }
}

/** The last four characters — what the screen shows, so two rows can be told apart. */
export function shortDeviceId(id) {
  const s = String(id || "");
  return s ? `#${s.slice(-4)}` : "—";
}

/**
 * "PC" / "Phone" / "Tablet", and the browser name.
 *
 * Deliberately coarse. The only question this has to answer is the one SISEN
 * asked — station staff should be on the station PC, so a phone is worth
 * noticing. Anything finer would be a guess dressed up as a fact.
 */
export function describeDevice(ua) {
  const s = String(ua || (typeof navigator === "undefined" ? "" : navigator.userAgent) || "");

  let platform = "PC";
  if (/\biPad\b/i.test(s) || (/\bTablet\b/i.test(s)) || (/\bAndroid\b/i.test(s) && !/\bMobile\b/i.test(s))) {
    platform = "Tablet";
  } else if (/\bMobi|\biPhone\b|\bAndroid\b|\bWindows Phone\b/i.test(s)) {
    platform = "Phone";
  }

  // Order matters: Edge and Opera both claim to be Chrome, and Chrome claims
  // to be Safari. Most specific first, or every browser reads as Safari.
  let browser = "Browser";
  if (/\bEdg\//i.test(s)) browser = "Edge";
  else if (/\bOPR\/|\bOpera\b/i.test(s)) browser = "Opera";
  else if (/\bSamsungBrowser\//i.test(s)) browser = "Samsung";
  else if (/\bFirefox\//i.test(s)) browser = "Firefox";
  else if (/\bChrome\//i.test(s)) browser = "Chrome";
  else if (/\bSafari\//i.test(s)) browser = "Safari";

  return { platform, browser };
}

/** "PC · Chrome · #7f3a" */
export function deviceLabel(id, ua) {
  const { platform, browser } = describeDevice(ua);
  return `${platform} · ${browser} · ${shortDeviceId(id)}`;
}
