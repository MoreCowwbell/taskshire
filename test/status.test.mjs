import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAsking, statusFor } from '../src/game/colony.js'

// ── what a quiet villager does ────────────────────────────────────────────────────────
// An idle session asks for you until it is marked viewed; after that it winds down by how
// long it has been quiet: potters about, then sits down after a day, then naps after three.

const NOW = Date.UTC(2026, 8, 22)
const HOUR = 60 * 60 * 1000
const idle = (hoursQuiet, extra = {}) => ({ state: 'idle', lastActivityAt: NOW - hoursQuiet * HOUR, ...extra })

test('an idle session asks for you until it is viewed', () => {
  assert.equal(statusFor(idle(2), NOW), 'waiting')
  assert.equal(statusFor(idle(200), NOW), 'waiting')
  assert.equal(isAsking(idle(2)), true)
  assert.equal(isAsking(idle(2, { viewed: true })), false)
})

test('a viewed idle session potters, then sits after a day, then naps after three', () => {
  assert.equal(statusFor(idle(2, { viewed: true }), NOW), 'idle')
  assert.equal(statusFor(idle(30, { viewed: true }), NOW), 'resting')
  assert.equal(statusFor(idle(80, { viewed: true }), NOW), 'sleeping')
})

test('unread still asks, and working or errored still wins over viewed', () => {
  assert.equal(statusFor(idle(2, { viewed: true, unread: true }), NOW), 'waiting')
  assert.equal(statusFor({ state: 'active', lastActivityAt: NOW, viewed: true }, NOW), 'working')
  assert.equal(statusFor(idle(2, { viewed: true, hasError: true }), NOW), 'blocked')
})
