import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countedStates, isCounted } from '../src/game/fate.js'
import { Colony } from '../src/game/colony.js'
import { allocateCells, badgeText, overflowFor } from '../src/world/plots.js'

const settingsOf = (v) => ({ get: (k) => v[k] })

test('defaults count active and idle only', () => {
  const s = countedStates(settingsOf({ countActive: true, countIdle: true, countInactive: false, countArchived: false }))
  assert.deepEqual([...s].sort(), ['active', 'idle'])
  assert.equal(isCounted({ state: 'inactive' }, s), false)
  assert.equal(isCounted({ state: 'idle' }, s), true)
})

test('tiles = ceil(counted / threadsPerTile), min 1', () => {
  const cells = (size, perCell) => allocateCells([{ id: 'a', size }], new Map(), { perCell }).get('a').length
  assert.equal(cells(0, 7), 1)
  assert.equal(cells(7, 7), 1)
  assert.equal(cells(8, 7), 2)
  assert.equal(cells(8, 4), 2)
  assert.equal(cells(9, 4), 3)
  assert.equal(cells(30, 1), cells(30, 0)) // clamped to 1
})

/**
 * What the map does with threads it has no room for.
 *
 * `_syncPlate` is a method on `Colony`, but everything it needs is a plot, a number and the
 * label group — so it is exercised through the prototype with a stand-in group, the same trick
 * `tests/worksite.test.mjs` plays on `_workSite`. `createLabel` wants a canvas and there is
 * none under node, so the plate itself is stubbed: what is under test is *when* the plate is
 * rebuilt and what text it is given.
 */
test('the plate is rebuilt only when the overflow number changes', () => {
  const built = []
  const group = { add: () => {}, remove: () => {} }
  const colony = {
    labelGroup: group,
    _makeLabel: (name, accent, badge) => {
      built.push(badge)
      return { position: { set: () => {} }, userData: {} }
    },
  }
  const plot = { name: 'repo', accent: 0x6fd3ff, labelAnchor: { x: 0, z: 0 }, label: null }

  Colony.prototype._syncPlate.call(colony, plot, 0)
  assert.deepEqual(built, [''], 'the first plate is always built')
  Colony.prototype._syncPlate.call(colony, plot, 0)
  assert.equal(built.length, 1, 'and not rebuilt for the same number')
  Colony.prototype._syncPlate.call(colony, plot, 3)
  assert.deepEqual(built, ['', '+3'], 'the badge appears')
  assert.equal(plot.overflow, 3)
  Colony.prototype._syncPlate.call(colony, plot, 0)
  assert.deepEqual(built, ['', '+3', ''], 'and goes again')
})

test('overflow and the badge agree with the tile formula', () => {
  // Seven a tile: the default setting fills a zone exactly, so nothing is ever hidden.
  assert.equal(overflowFor(7, 1), 0)
  // Fourteen threads a tile is the user asking for a denser map; the plate says what it cost.
  assert.equal(badgeText(overflowFor(14, 1)), '+7')
})
