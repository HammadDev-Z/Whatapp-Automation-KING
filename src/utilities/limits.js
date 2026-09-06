'use strict';

// Pure helpers for the daily per-group / per-category code quota (migration 006).
// This is a SEPARATE concern from GroupRateLimiter (burst/anti-spam); these
// functions decide the 24h business window and how far a request may be filled.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Pakistan Standard Time is a fixed UTC+5 (no DST), so a constant offset is exact.
const PAKISTAN_OFFSET_MS = 5 * HOUR_MS;

function toMs(value) {
  return value instanceof Date ? value.getTime() : Number(value);
}

// The most recent instant at which the local Pakistan clock read 12:00, at or
// before `now`, returned as a UTC Date.
function latestPakistanNoon(now) {
  const local = toMs(now) + PAKISTAN_OFFSET_MS;
  const localMidnight = Math.floor(local / DAY_MS) * DAY_MS;
  let localNoon = localMidnight + 12 * HOUR_MS;
  if (localNoon > local) localNoon -= DAY_MS; // today's noon not reached yet
  return new Date(localNoon - PAKISTAN_OFFSET_MS);
}

// Start of the group's currently-active 24h limit window, as a UTC Date.
//   manualStart == null -> latestPakistanNoon(now)
//   manualStart set     -> that anchor advanced forward in whole 24h steps to
//                          the latest step <= now (so a manual reset keeps
//                          rolling every 24h from the instant it was pressed,
//                          it does not snap back to noon).
function activeLimitWindowStart(manualStart, now) {
  const nowMs = toMs(now);
  if (manualStart === null || manualStart === undefined) return latestPakistanNoon(nowMs);
  const startMs = toMs(manualStart);
  if (startMs >= nowMs) return new Date(startMs);
  const steps = Math.floor((nowMs - startMs) / DAY_MS);
  return new Date(startMs + steps * DAY_MS);
}

// How much of `requested` may be issued given `used` codes already taken this
// window and a `dailyLimit` (null/undefined = unlimited).
function clampToLimit(requested, used, dailyLimit) {
  if (dailyLimit === null || dailyLimit === undefined) {
    return { allowed: requested, limitReached: false, clamped: false };
  }
  const remaining = Math.max(0, Number(dailyLimit) - Number(used));
  const allowed = Math.min(requested, remaining);
  return { allowed, limitReached: allowed === 0, clamped: allowed < requested };
}

module.exports = { latestPakistanNoon, activeLimitWindowStart, clampToLimit, PAKISTAN_OFFSET_MS, DAY_MS };
