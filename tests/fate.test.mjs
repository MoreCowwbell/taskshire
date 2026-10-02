import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zoneFate, DAY_MS } from '../src/game/fate.js'

const NOW = 1_800_000_000_000
const t = (project, daysAgo, extra = {}) => ({
  id: `${project}-${daysAgo}-${Object.keys(extra).join('')}`,
  project,
  lastActivityAt: NOW - daysAgo * DAY_MS,
  state: 'inactive',
  unread: false,
  hasError: false,
  ...extra,
})
const opts = (over = {}) => ({
  now: NOW,
  activeOnly: true,
  fadeDays: 3,
  hideDays: 14,
  hidden: [],
  pinned: [],
  forgotten: [],
  ...over,
})

test('a repo touched today is shown at full strength', () => {
  const f = zoneFate([t('a', 0)], opts()).get('a')
  assert.deepEqual({ show: f.show, fade: f.fade }, { show: true, fade: 0 })
})

test('age is the newest live thread, not the oldest', () => {
  const f = zoneFate([t('a', 30), t('a', 1)], opts()).get('a')
  assert.equal(f.show, true)
  assert.equal(f.fade, 0)
  assert.equal(f.age, DAY_MS)
})

test('the fade ramps linearly from fadeDays to hideDays', () => {
  const at = (d) => zoneFate([t('a', d)], opts()).get('a').fade
  assert.equal(at(3), 0)
  assert.ok(Math.abs(at(8.5) - 0.5) < 1e-9)
  assert.ok(at(13.9) > 0.98 && at(13.9) < 1)
})

test('a repo past hideDays is gone', () => {
  const f = zoneFate([t('a', 14)], opts()).get('a')
  assert.equal(f.show, false)
  assert.equal(f.fade, 1)
})

test('an active, idle or errored thread wakes a zone whatever its age', () => {
  for (const extra of [{ state: 'active' }, { state: 'idle' }, { hasError: true }]) {
    const f = zoneFate([t('a', 40, extra)], opts()).get('a')
    assert.deepEqual({ show: f.show, fade: f.fade }, { show: true, fade: 0 }, JSON.stringify(extra))
  }
})

/**
 * The point of the whole state model: a closed session is history. A repo whose newest
 * transcript is six weeks old leaves the map even though the file is still sitting there.
 */
test('an inactive thread does not wake a zone', () => {
  const f = zoneFate([t('a', 40)], opts()).get('a')
  assert.equal(f.show, false)
  assert.equal(f.fade, 1)
})

test('a pinned repo never fades', () => {
  const f = zoneFate([t('a', 40)], opts({ pinned: ['a'] })).get('a')
  assert.deepEqual({ show: f.show, fade: f.fade }, { show: true, fade: 0 })
})

test('a hidden repo is gone even with an active thread', () => {
  const f = zoneFate([t('a', 0, { state: 'active' })], opts({ hidden: ['a'] })).get('a')
  assert.equal(f.show, false)
})

test('hidden beats pinned', () => {
  const f = zoneFate([t('a', 0)], opts({ hidden: ['a'], pinned: ['a'] })).get('a')
  assert.equal(f.show, false)
})

test('with the filter off only hidden and cleared repos leave', () => {
  const m = zoneFate([t('a', 40), t('b', 40), t('c', 40)], opts({ activeOnly: false, hidden: ['b'], forgotten: ['c'] }))
  assert.deepEqual({ show: m.get('a').show, fade: m.get('a').fade }, { show: true, fade: 0 })
  assert.equal(m.get('b').show, false)
  // Turning the filter off is a way of looking at the map, not an undo for the cleanup.
  assert.equal(m.get('c').show, false)
})

/**
 * Clearing the Gone group. The three tests below are the whole promise the button makes:
 * a cleared repo leaves whatever its age, nothing but a real thread brings it back, and the
 * day one does it is on the map again — which is what lets the caller drop it from the list.
 */
test('a cleared repo is gone, however young its last thread', () => {
  const f = zoneFate([t('a', 0)], opts({ forgotten: ['a'] })).get('a')
  assert.deepEqual({ show: f.show, fade: f.fade }, { show: false, fade: 1 })
})

test('a live thread brings a cleared repo back', () => {
  for (const extra of [{ state: 'active' }, { state: 'idle' }, { hasError: true }]) {
    const f = zoneFate([t('a', 40, extra)], opts({ forgotten: ['a'] })).get('a')
    assert.deepEqual({ show: f.show, fade: f.fade }, { show: true, fade: 0 }, JSON.stringify(extra))
  }
})

test('clearing outranks a pin, and hiding outranks clearing', () => {
  assert.equal(zoneFate([t('a', 0)], opts({ forgotten: ['a'], pinned: ['a'] })).get('a').show, false)
  // Hidden wins by being first, so a cleared repo that wakes up is still hidden if it was.
  assert.equal(zoneFate([t('a', 0, { state: 'active' })], opts({ forgotten: ['a'], hidden: ['a'] })).get('a').show, false)
})

test('hideDays is clamped above fadeDays so the ramp never divides by zero', () => {
  const f = zoneFate([t('a', 3.5)], opts({ fadeDays: 3, hideDays: 3 })).get('a')
  assert.ok(Number.isFinite(f.fade))
  assert.ok(f.fade > 0 && f.fade < 1)
  assert.equal(zoneFate([t('a', 4)], opts({ fadeDays: 3, hideDays: 3 })).get('a').show, false)
})

test('Sets are accepted for the lists and threads without a project group under "unknown"', () => {
  const m = zoneFate([t('', 0), { id: 'x', lastActivityAt: NOW }], opts({ hidden: new Set(['unknown']) }))
  assert.equal(m.get('unknown').show, false)
  assert.equal(zoneFate([t('a', 0)], opts({ forgotten: new Set(['a']) })).get('a').show, false)
})

test('a caller from before the cleared list still gets a fate', () => {
  const { forgotten, ...before } = opts()
  assert.equal(zoneFate([t('a', 0)], before).get('a').show, true)
})

test('a thread with no timestamp counts as infinitely old', () => {
  const f = zoneFate([{ id: 'x', project: 'a' }], opts()).get('a')
  assert.equal(f.show, false)
})
