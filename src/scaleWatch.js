// [2026-09-21] ONE watcher per station scale, shared by every screen.
//
// The poll loop used to live inside useLiveWeight, so it only ran while a
// weight box was open. That was fine for showing a number, but not for the
// scale guard (scaleGuard.js): the dangerous moment at REANG KESEY — the
// truck driving off a scale that had been zeroed with it on board — happens
// between tickets, when no weight box is open. So:
//
//   · App.jsx keeps a quiet background subscription to the station's own
//     scale on a station PC, all day. It polls gently (every 0.5 s from this
//     PC's scale program; every 5 s from the cloud if that is not running).
//   · A weight box on screen joins the same watcher and it speeds up to the
//     usual 150 ms. Two boxes open at once share one poll, not two.
//   · Every live reading goes through the guard; the guard's memory is kept
//     in this PC's storage, so a reload does not forget that the scale went
//     below zero.
//   · Going below zero, and coming back to 0, is written to the Activity Log
//     once each — by the station PC only, from its own scale program, so HQ
//     looking at the same scale from the cloud does not log it again.
import { api } from "./api.js";
import { withTimeout } from "./offlineQueue.js";
import { getAccurateNow } from "./supabaseClient.js";
import {
  freshGuard, observe, addSample, captureStatus, markCapture, serialize, deserialize, isStable,
} from "./scaleGuard.js";

const LOCAL_BRIDGE_URL = "http://127.0.0.1:8787/weight";
const FAST_MS = 150;          // a weight box is open
const SLOW_MS = 500;          // background only
const CLOUD_FAST_MS = 1000;
const CLOUD_SLOW_MS = 5000;
const LOCAL_RETRY_MS = 5000;
const CLOUD_TIMEOUT_MS = 2500;
const LIVE_MS = 6000;         // a reading older than this is "not connected"
const STORE_KEY = (loc) => `pt_scale_guard_${loc}`;

let auditUserId = null;
export function setScaleWatchUser(id) { auditUserId = id || null; }

let printing = typeof window !== "undefined" && !!window.matchMedia?.("print").matches;
if (typeof window !== "undefined") {
  window.addEventListener("beforeprint", () => { printing = true; });
  window.addEventListener("afterprint", () => { printing = false; });
}

async function pollLocalBridge() {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(LOCAL_BRIDGE_URL, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.weight_kg === null || data.weight_kg === undefined) return null;
    return { weight_kg: data.weight_kg, updated_at: data.updated_at, location_id: data.location_id || null, source: "local" };
  } catch {
    return null;
  }
}

function readStored(loc) {
  try { return deserialize(localStorage.getItem(STORE_KEY(loc))); } catch { return freshGuard(); }
}

const stores = new Map();

function makeStore(loc) {
  return {
    loc,
    listeners: new Set(),
    foreground: 0,
    reading: null,
    guard: readStored(loc),
    samples: [],
    timer: null,
    running: false,
    localMissAt: 0,
    savedAt: 0,
    version: 0,
  };
}

function isLive(reading) {
  if (!reading?.updated_at) return false;
  const nowMs = reading.source === "cloud" ? getAccurateNow().getTime() : Date.now();
  return nowMs - new Date(reading.updated_at).getTime() < LIVE_MS;
}

function save(store, force) {
  const now = Date.now();
  if (!force && now - store.savedAt < 5000) return;
  store.savedAt = now;
  try { localStorage.setItem(STORE_KEY(store.loc), serialize(store.guard)); } catch { /* private window — memory only */ }
}

function logEvent(store, event, weightKg) {
  if (!auditUserId) return;
  api.logAudit({
    action: event === "below" ? "scale_below_zero" : "scale_back_to_zero",
    tableName: "locations",
    recordId: store.loc,
    oldData: null,
    newData: { weightKg, at: new Date().toISOString() },
    userId: auditUserId,
  });
}

function notify(store) {
  store.version += 1;
  for (const fn of store.listeners) { try { fn(); } catch { /* one bad listener must not stop the rest */ } }
}

function take(store, reading) {
  const prevW = store.reading?.weight_kg;
  const prevSrc = store.reading?.source;
  const prevLive = isLive(store.reading);
  store.reading = reading;
  const live = isLive(reading);
  if (live) {
    const now = Date.now();
    const { guard, event } = observe(store.guard, reading.weight_kg, now);
    const changedEpisode = guard.belowSince !== store.guard.belowSince;
    store.guard = guard;
    store.samples = addSample(store.samples, reading.weight_kg, now);
    save(store, changedEpisode);
    if (event && reading.source === "local") logEvent(store, event, Number(reading.weight_kg));
  }
  // Re-draw on any change, and at least once a second so "moving → steady"
  // and "connected" stay true to the clock.
  const now = Date.now();
  if (reading?.weight_kg !== prevW || reading?.source !== prevSrc || live !== prevLive || now - (store.drawnAt || 0) >= 1000) {
    store.drawnAt = now;
    notify(store);
  }
}

async function tick(store, gen) {
  // `gen` ends a loop that was stopped and restarted while it was waiting on
  // a reply — otherwise the restart would leave two loops running.
  const alive = () => store.running && store.gen === gen;
  if (!alive()) return;
  const fg = store.foreground > 0;
  let next = fg ? FAST_MS : SLOW_MS;
  if (!printing) {
    const tryLocal = !store.localMissAt || Date.now() - store.localMissAt >= LOCAL_RETRY_MS;
    const local = tryLocal ? await pollLocalBridge() : null;
    if (!alive()) return;
    if (tryLocal) store.localMissAt = local ? 0 : Date.now();
    // The scale program on THIS PC only knows THIS PC's scale — a reading for
    // another station is set aside and the chosen station's cloud reading used.
    if (local && (!local.location_id || local.location_id === store.loc)) {
      take(store, local);
    } else {
      const cloud = await withTimeout(api.getLiveWeight(store.loc).catch(() => null), CLOUD_TIMEOUT_MS, null);
      if (!alive()) return;
      take(store, cloud ? { ...cloud, source: "cloud" } : null);
      next = fg ? CLOUD_FAST_MS : CLOUD_SLOW_MS;
    }
  }
  store.timer = setTimeout(() => tick(store, gen), next);
}

function start(store) {
  if (store.running) return;
  store.running = true;
  store.gen = (store.gen || 0) + 1;
  tick(store, store.gen);
}
function stop(store) {
  store.running = false;
  clearTimeout(store.timer);
  store.timer = null;
  save(store, true);
}

// Join the watcher for one station. `foreground` = a weight box is on screen.
export function subscribeScale(loc, listener, { foreground = true } = {}) {
  if (!loc) return () => {};
  let store = stores.get(loc);
  if (!store) { store = makeStore(loc); stores.set(loc, store); }
  store.listeners.add(listener);
  if (foreground) store.foreground += 1;
  // A box just opened: ask the PC's own scale program again straight away
  // instead of waiting out a background retry.
  if (foreground) store.localMissAt = 0;
  start(store);
  return () => {
    store.listeners.delete(listener);
    if (foreground) store.foreground = Math.max(0, store.foreground - 1);
    if (store.listeners.size === 0) stop(store);
  };
}

export function scaleSnapshot(loc, { by = null } = {}) {
  const store = stores.get(loc);
  if (!store) return { connected: false, weightKg: undefined, source: undefined, status: "offline", stable: false, guard: freshGuard() };
  const connected = isLive(store.reading);
  const weightKg = store.reading?.weight_kg;
  const status = connected ? captureStatus(store.guard, store.samples, weightKg, Date.now(), { by }) : "offline";
  const stable = connected && isStable(store.samples, Date.now());
  return { connected, weightKg, source: store.reading?.source, status, stable, guard: store.guard, version: store.version };
}

// A weight box captured a number: remember it, so the same truck cannot be
// captured again on another ticket without the platform showing 0 between.
export function recordCapture(loc, { by, weightKg }) {
  const store = stores.get(loc);
  if (!store) return;
  store.guard = markCapture(store.guard, { now: Date.now(), by, weightKg });
  save(store, true);
  notify(store);
}

// Test hook only (scripts-check-scale-guard / the page harness).
export function __resetScaleWatch() {
  for (const s of stores.values()) stop(s);
  stores.clear();
}
