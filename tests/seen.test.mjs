/**
 * `state.seen`: who the colony has met, and who it is allowed to forget.
 *
 * Two ways to get this wrong, and both are quiet. Refresh too eagerly and the colony file is
 * written every fifteen seconds forever; prune too eagerly and a thread that was in this
 * morning's scan walks out of the ship again this afternoon.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { DAY_MS } from '../src/game/fate.js'
import { SEEN_REFRESH_MS, nextArrivals, reconcileSeen } from '../src/game/seen.js'

const NOW = 1_800_000_000_000
const opts = (over = {}) => ({ now: NOW, hideDays: 14, ...over })

test('a thread nobody has met is stamped now', () => {
  const out = reconcileSeen({}, ['a'], opts())
  assert.equal(out.changed, true)
  assert.deepEqual(out.seen, { a: NOW })
})

test('a poll that has nothing to say queues no save — the same object comes back', () => {
  // The whole reason the stamp is throttled: at fifteen-second polls, a per-poll refresh would
  // be a colony write every fifteen seconds for as long as the page is open.
  const seen = { a: NOW - 60_000 }
  const out = reconcileSeen(seen, ['a'], opts())
  assert.equal(out.changed, false)
  assert.equal(out.seen, seen, 'identity, so a caller can skip the save on it alone')
})

test('a present thread older than a day is refreshed', () => {
  const out = reconcileSeen({ a: NOW - SEEN_REFRESH_MS - 1 }, ['a'], opts())
  assert.equal(out.changed, true)
  assert.deepEqual(out.seen, { a: NOW })
})

test('a thread missing from one scan is not forgotten for it', () => {
  // An adapter that threw, a drive not mounted this morning, a harness undetected for an
  // afternoon — every one of those leaves a stamp far younger than the window.
  const seen = { a: NOW - 3 * DAY_MS }
  const out = reconcileSeen(seen, [], opts())
  assert.equal(out.changed, false)
  assert.deepEqual(out.seen, { a: NOW - 3 * DAY_MS })
})

test('a thread gone from every scan for the hide window is dropped', () => {
  const out = reconcileSeen({ a: NOW - 15 * DAY_MS, b: NOW }, ['b'], opts())
  assert.equal(out.changed, true)
  assert.deepEqual(out.seen, { b: NOW })
})

test('an absent row with a junk value is dropped rather than kept forever', () => {
  const out = reconcileSeen({ a: 'yesterday', b: null }, [], opts())
  assert.equal(out.changed, true)
  assert.deepEqual(out.seen, {})
})

test('the window never falls below two days, whatever the file says', () => {
  // The slider's floor is 2; a hand-edited colony file must not be able to undercut it.
  const seen = { a: NOW - 1.5 * DAY_MS }
  assert.equal(reconcileSeen(seen, [], opts({ hideDays: 1 })).changed, false)
  assert.equal(reconcileSeen(seen, [], opts({ hideDays: 0 })).changed, false)
  assert.equal(reconcileSeen({ a: NOW - 3 * DAY_MS }, [], opts({ hideDays: 1 })).changed, true)
})

test('a seen that is not an object is treated as empty rather than thrown on', () => {
  assert.deepEqual(reconcileSeen(null, ['a'], opts()).seen, { a: NOW })
  assert.deepEqual(reconcileSeen([1, 2], ['a'], opts()).seen, { a: NOW })
})

test('the input is never mutated — the caller decides whether to adopt the result', () => {
  const seen = { a: NOW - 20 * DAY_MS }
  const out = reconcileSeen(seen, ['b'], opts())
  assert.deepEqual(seen, { a: NOW - 20 * DAY_MS })
  assert.deepEqual(out.seen, { b: NOW })
})

test('an archived or inactive thread in the scan keeps its row', () => {
  // Presence is judged on the whole scan rather than on what is drawn, so a thread the map
  // does not show is still a thread the colony has met.
  const seen = { 'codex:a': NOW - 40 * DAY_MS }
  const out = reconcileSeen(seen, ['codex:a'], opts())
  assert.deepEqual(out.seen, { 'codex:a': NOW }, 'refreshed, not pruned')
})

// ── nextArrivals: who may appear on their plot rather than walk out ─────────────────────

const none = () => false
const scan = (closedHere, open, closed, seen, hasVillager = none) =>
  nextArrivals(closedHere, { open, closed, seen: new Set(seen), hasVillager })

test('at page load, open threads already met appear in place; new ones walk out', () => {
  const { known } = scan(new Set(), ['met', 'new'], ['shut'], ['met', 'shut'])
  assert.deepEqual([...known], ['met'])
})

test('a session closed at load and resumed later walks out', () => {
  let s = scan(new Set(), [], ['a'], ['a'])
  s = scan(s.closedHere, ['a'], [], ['a'])
  assert.equal(s.known.has('a'), false)
})

test('a villager that leaves and comes back in the same visit walks out again', () => {
  let s = scan(new Set(), ['a'], [], ['a'])
  assert.equal(s.known.has('a'), true)
  s = scan(s.closedHere, [], ['a'], ['a'], (id) => id === 'a') // still walking home
  s = scan(s.closedHere, ['a'], [], ['a'])
  assert.equal(s.known.has('a'), false)
})

test('a returning thread keeps its entrance until it actually has a villager', () => {
  let s = scan(new Set(), [], ['a'], ['a'])
  // Reopened behind a hidden repo, or past the crew cap: no villager yet.
  s = scan(s.closedHere, ['a'], [], ['a'])
  s = scan(s.closedHere, ['a'], [], ['a'])
  assert.equal(s.known.has('a'), false)
  // It walked out; from here it is simply outside.
  s = scan(s.closedHere, ['a'], [], ['a'], () => true)
  assert.equal(s.closedHere.has('a'), false)
  assert.equal(s.known.has('a'), true)
})

test('a thread open all along that only now gets a villager is placed, not marched out', () => {
  let s = scan(new Set(), ['a'], [], ['a'])
  s = scan(s.closedHere, ['a'], [], ['a'])
  assert.equal(s.known.has('a'), true)
})

test('an empty scan takes nothing off the list', () => {
  let s = scan(new Set(), [], ['a'], ['a'])
  s = scan(s.closedHere, [], [], ['a'])
  assert.equal(s.closedHere.has('a'), true)
  assert.equal(scan(s.closedHere, ['a'], [], ['a']).known.has('a'), false)
})
