// [2026-09-21] Which stations' scales are below zero right now, from the
// readings each station sends up. Pure — used by the HQ Dashboard banner and
// the Station Health table, and tested by scripts-check-scale-guard.
import { BELOW_KG } from "./scaleGuard.js";

// A reading older than this is not "now" — the station may be switched off.
export const SCALE_FRESH_MS = 2 * 60 * 1000;

export function scaleState(reading, nowMs) {
  if (!reading || reading.updated_at == null) return "none";
  const age = nowMs - new Date(reading.updated_at).getTime();
  if (!(age < SCALE_FRESH_MS)) return "quiet";
  return Number(reading.weight_kg) < BELOW_KG ? "below" : "ok";
}

export function stationsBelowZero(readings, locations, nowMs) {
  const byId = new Map((locations || []).map((l) => [l.id, l]));
  return (readings || [])
    .filter((r) => scaleState(r, nowMs) === "below" && byId.has(r.location_id))
    .map((r) => ({ id: r.location_id, name: byId.get(r.location_id).name, weightKg: Number(r.weight_kg) }));
}
