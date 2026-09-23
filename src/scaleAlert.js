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

// [2026-09-23] A STATION WHOSE SCALE HAS GONE QUIET.
//
// SISEN, on the Ping Pong outage: "why is that… there has to be an issue,
// beacsue earlier it was connected." He found out because staff were stuck
// half way through a ticket with a truck on the platform. HQ had every
// reading it needed to know hours earlier and nothing looked at them — the
// same failure as 17 September, where five stations reported `stuck` every
// minute and nothing raised it.
//
// The window is deliberately narrow, because an alarm that fires on normal
// conditions is how the real one gets ignored:
//
//   · under QUIET_AFTER_MS — a gap this short is a reboot, a slow minute, a
//     station between trucks. Not worth a word.
//   · over GONE_HOME_MS — the station closed for the night. Every station
//     would light up every evening, which trains everyone to scroll past it.
//   · never a station that has never sent a reading at all: that is a
//     station without the agent installed, not a station that broke.
//
// So it says exactly one thing: this scale WAS working today and has stopped.
export const QUIET_AFTER_MS = 15 * 60 * 1000;
export const GONE_HOME_MS = 6 * 60 * 60 * 1000;

export function stationsWithQuietScale(readings, locations, nowMs) {
  const byId = new Map((locations || []).map((l) => [l.id, l]));
  return (readings || [])
    .filter((r) => {
      if (!byId.has(r.location_id) || r.updated_at == null) return false;
      const age = nowMs - new Date(r.updated_at).getTime();
      return age >= QUIET_AFTER_MS && age < GONE_HOME_MS;
    })
    .map((r) => ({
      id: r.location_id,
      name: byId.get(r.location_id).name,
      minutes: Math.round((nowMs - new Date(r.updated_at).getTime()) / 60000),
    }))
    .sort((a, b) => b.minutes - a.minutes);
}
