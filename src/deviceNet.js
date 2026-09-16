// Roughly where this machine is connecting from.
//
// [2026-09-16] SISEN: "are we able to have access to their ip location etc" —
// and, when given the choice, "how about all".
//
// SO, PLAINLY, WHAT THIS IS AND IS NOT:
//
//   · The ADDRESS is not read here. It is read server-side, from the request
//     itself (see device_network.sql), because a browser cannot be trusted to
//     report its own address and has no honest way of knowing it anyway.
//
//   · The CITY is read here, from a free public lookup, and is the only piece
//     of this a browser could get wrong or lie about. It is stored in its own
//     column for that reason, and shown as a hint rather than a fact. In
//     Cambodia it will frequently name the internet provider's city rather
//     than the station — Pong Ro and Reang Kesey may both read "Phnom Penh".
//
//   · REAL GPS is not collected. It needs a permission prompt on every
//     machine, which staff can refuse, and there is no honest way to take it
//     quietly. Nothing here asks.
//
// The lookup is ipwho.is: no key, HTTPS, 1,000 requests a day per address.
// This asks at most a few times a day per machine, because the answer is
// cached and only refreshed when the address itself has changed or the cache
// is a day old. There is no SLA, so every failure is silent and the rest of
// the check-in carries on without it.

const KEY = "paddytrade.deviceNet";
const ENDPOINT = "https://ipwho.is/";

// Long enough that a station uses one or two lookups a day; short enough that
// a machine moved to a different building is noticed the same day.
export const REFRESH_MS = 6 * 60 * 60 * 1000;

// Three seconds and no more. See getPlace().
export const TIMEOUT_MS = 3000;

function read(store) {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function write(store, value) {
  try { store?.setItem(KEY, JSON.stringify(value)); } catch { /* private window, full disk */ }
}

export function isFresh(cached, now = Date.now()) {
  if (!cached || typeof cached.at !== "number") return false;
  return now - cached.at < REFRESH_MS;
}

/**
 * Read the place out of whatever the lookup returned.
 *
 * Deliberately strict: anything unexpected becomes null rather than being
 * passed along, because a wrong city shown confidently is worse than none.
 */
export function placeFrom(body) {
  if (!body || typeof body !== "object" || body.success === false) return null;
  const pick = (v) => (typeof v === "string" && v.trim() && v.length < 60 ? v.trim() : null);
  const city = pick(body.city);
  const region = pick(body.region);
  const country = pick(body.country);
  if (!city && !region && !country) return null;
  return { city, region, country };
}

/**
 * This machine's rough place, from cache when it can be, from the lookup when
 * it cannot. Never throws, never blocks anything, and returns null freely.
 */
export async function getPlace({
  storage,
  fetchFn,
  now = Date.now(),
} = {}) {
  let store = storage;
  if (store === undefined) {
    try { store = typeof localStorage === "undefined" ? null : localStorage; }
    catch { store = null; }
  }

  const cached = read(store);
  if (isFresh(cached, now) && cached.place) return cached.place;

  const f = fetchFn || (typeof fetch === "function" ? ((...a) => fetch(...a)) : null);
  if (!f) return cached?.place || null;

  // A hard stop. Pong Ro is on a line that drops; a lookup that hangs would
  // hold up the check-in behind it, and a station that cannot say "I am here"
  // because it was waiting on a CITY would be an absurd way to go quiet.
  const stop = typeof AbortController === "function" ? new AbortController() : null;
  const timer = stop ? setTimeout(() => stop.abort(), TIMEOUT_MS) : null;
  try {
    const res = await f(ENDPOINT, { cache: "no-store", signal: stop?.signal });
    if (!res || !res.ok) return cached?.place || null;
    const place = placeFrom(await res.json());
    if (!place) return cached?.place || null;
    write(store, { at: now, place });
    return place;
  } catch {
    // Offline, blocked, rate-limited, timed out, or the service is down. The
    // check-in goes ahead without a city; the address still reaches the
    // database, because that is read server-side and does not depend on this.
    return cached?.place || null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Has this machine appeared on a network it has not used before?
 *
 * This is the part that is actually worth looking at. A city is a guess; an
 * address that has never been seen on this machine before is a fact, and it
 * is what "somebody took the login somewhere else" looks like from here.
 */
export function networkChanged(device) {
  if (!device) return false;
  const first = device.first_ip, last = device.last_ip;
  if (!first || !last) return false;
  return first !== last;
}

/** "Phnom Penh, Cambodia" — whatever of it is actually known. */
export function placeLabel(device) {
  if (!device) return "";
  return [device.city, device.region, device.country]
    .filter((x) => x && String(x).trim())
    .filter((x, i, all) => all.indexOf(x) === i)
    .slice(0, 2)
    .join(", ");
}
