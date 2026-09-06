'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { latestPakistanNoon, activeLimitWindowStart, clampToLimit } = require('../src/utilities/limits');

const iso = (d) => d.toISOString();

test('latestPakistanNoon: PKT is UTC+5, noon PKT = 07:00 UTC', () => {
  // 06:00 UTC = 11:00 PKT -> today's noon not reached -> yesterday 12:00 PKT
  assert.equal(iso(latestPakistanNoon(new Date('2026-03-15T06:00:00Z'))), '2026-03-14T07:00:00.000Z');
  // 08:00 UTC = 13:00 PKT -> today's noon already passed
  assert.equal(iso(latestPakistanNoon(new Date('2026-03-15T08:00:00Z'))), '2026-03-15T07:00:00.000Z');
  // exactly noon PKT
  assert.equal(iso(latestPakistanNoon(new Date('2026-03-15T07:00:00Z'))), '2026-03-15T07:00:00.000Z');
  // just before midnight UTC = 05:00 PKT next day -> still previous noon
  assert.equal(iso(latestPakistanNoon(new Date('2026-03-15T23:30:00Z'))), '2026-03-15T07:00:00.000Z');
});

test('activeLimitWindowStart: no manual anchor uses the latest PKT noon', () => {
  const now = new Date('2026-03-15T08:00:00Z');
  assert.equal(iso(activeLimitWindowStart(null, now)), '2026-03-15T07:00:00.000Z');
  assert.equal(iso(activeLimitWindowStart(undefined, now)), '2026-03-15T07:00:00.000Z');
});

test('activeLimitWindowStart: a manual anchor rolls forward in whole 24h steps', () => {
  const now = new Date('2026-03-15T08:00:00Z');
  // pressed 10 min ago -> still that instant
  assert.equal(iso(activeLimitWindowStart(new Date('2026-03-15T07:50:00Z'), now)), '2026-03-15T07:50:00.000Z');
  // pressed 3 days + 3 h ago -> advance exactly 3 days
  assert.equal(iso(activeLimitWindowStart(new Date('2026-03-12T05:00:00Z'), now)), '2026-03-15T05:00:00.000Z');
  // pressed exactly 24 h ago -> advance one day
  assert.equal(iso(activeLimitWindowStart(new Date('2026-03-14T08:00:00Z'), now)), '2026-03-15T08:00:00.000Z');
  // pressed 47 h 59 m ago -> only one whole step
  assert.equal(iso(activeLimitWindowStart(new Date('2026-03-13T08:01:00Z'), now)), '2026-03-14T08:01:00.000Z');
});

test('clampToLimit: unlimited when no limit configured', () => {
  assert.deepEqual(clampToLimit(5, 3, null), { allowed: 5, limitReached: false, clamped: false });
  assert.deepEqual(clampToLimit(5, 3, undefined), { allowed: 5, limitReached: false, clamped: false });
});

test('clampToLimit: clamps the request to whatever remains', () => {
  assert.deepEqual(clampToLimit(5, 0, 10), { allowed: 5, limitReached: false, clamped: false });
  assert.deepEqual(clampToLimit(5, 8, 10), { allowed: 2, limitReached: false, clamped: true });
  assert.deepEqual(clampToLimit(3, 0, 3), { allowed: 3, limitReached: false, clamped: false });
});

test('clampToLimit: exactly 0 remaining -> limitReached', () => {
  assert.deepEqual(clampToLimit(5, 10, 10), { allowed: 0, limitReached: true, clamped: true });
  assert.deepEqual(clampToLimit(1, 12, 10), { allowed: 0, limitReached: true, clamped: true });
});
