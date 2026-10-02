import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry } from '../src/core/rng.js'
import { planDecay, revealAt, ruined, swapPlan, visibleAt } from '../src/world/decay.js'

/**
 * The plot geometry the rules are held against, spelled out here rather than imported: the
 * real constants live in `world/plots.js`, which pulls in three, and the whole point of
 * `world/decay.js` is that it can be reasoned about without a browser. These are the medieval
 * theme's own numbers — a 7.6 cell pulled in a hair, slots on the 0.58 ring.
 */
const TILE = 7.6 * 0.992
const SLOT_RING = TILE * 0.58

/** Cell centre first, then the six around it — the order `Plot._buildSlots` produces. */
function slotsFor(centers) {
  const out = []
  for (const { x, z } of centers) {
    out.push({ x, z })
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6
      out.push({ x: x + Math.cos(a) * SLOT_RING, z: z + Math.sin(a) * SLOT_RING })
    }
  }
  return out
}

const CENTERS = [
  { x: 0, z: 0 },
  { x: 11.4, z: 6.58 },
]
const SLOTS = slotsFor(CENTERS)
/** A handful of kerb props, at the radii `_buildClutter` actually places them at. */
const CLUTTER = [
  { name: 'barrel', x: TILE * 0.55, z: 0, r: 0.6, top: 0.5 },
  { name: 'torch', x: -TILE * 0.8, z: TILE * 0.2, r: 0.45, top: 1.3 },
  { name: 'haybale', x: 11.4 + TILE * 0.6, z: 6.58 - TILE * 0.3, r: 0.9, top: 0.6 },
]
const NAMES = ['tree_single_A_cut', 'tree_single_B_cut', 'tree_single_A', 'rock_single_B']

const plan = (seed = 1, over = {}) =>
  planDecay({
    centers: CENTERS,
    tile: TILE,
    slots: SLOTS,
    clutterSpots: CLUTTER,
    rand: mulberry(seed),
    perCell: 8,
    names: NAMES,
    scale: [1.2, 2.0],
    ...over,
  })

test('the same seed lays out the same dressing', () => {
  assert.deepEqual(plan(7), plan(7))
  // …and a different one does not, or the whole colony would grow the same bush.
  assert.notDeepEqual(plan(7), plan(8))
})

test('nothing grows through a building, a kerb prop or another sapling', () => {
  const spots = plan(3)
  assert.ok(spots.length > 8, `expected a full-ish plan, got ${spots.length}`)
  for (const s of spots) {
    // Clear of every slot of every cell, occupied or not.
    for (const slot of SLOTS) assert.ok(Math.hypot(s.x - slot.x, s.z - slot.z) >= 1.9, `${s.name} is on a slot`)
    for (const c of CLUTTER) assert.ok(Math.hypot(s.x - c.x, s.z - c.z) >= c.r + 0.45, `${s.name} is in the ${c.name}`)
  }
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z) >= 0.9, 'two props in one hole')
    }
  }
})

test('everything stands inside its own cell, short of the kerb', () => {
  for (const s of plan(5)) {
    const d = Math.min(...CENTERS.map((c) => Math.hypot(s.x - c.x, s.z - c.z)))
    assert.ok(d < TILE * 0.84, `${s.name} is out on the kerb at ${d.toFixed(2)}`)
  }
})

test('the reveal ramp rises through the fade and never reaches it', () => {
  const spots = plan(11)
  let last = -1
  for (const s of spots) {
    assert.ok(s.at >= 0 && s.at < 1, `at ${s.at} is outside [0, 1)`)
    assert.ok(s.at >= last, 'the ramp went backwards')
    last = s.at
  }
  // The first prop of a plot is out the moment the zone starts to go.
  assert.equal(spots[0].at, 0)
})

test('sizes and yaws stay inside the ranges the manifest names', () => {
  for (const s of plan(13)) {
    assert.ok(s.s >= 1.2 && s.s <= 2.0, `scale ${s.s}`)
    assert.ok(s.ry >= 0 && s.ry < Math.PI * 2, `yaw ${s.ry}`)
    assert.ok(NAMES.includes(s.name))
  }
})

test('cells are filled round-robin, so a zone thickens evenly', () => {
  // Seed 13 is a plan that placed all sixteen; a crowded draw skips a prop rather than
  // searching for room for it, and a skipped prop is the one thing that breaks the alternation.
  const spots = plan(13)
  assert.equal(spots.length, 16)
  const cellOf = (s) => (Math.hypot(s.x, s.z) < Math.hypot(s.x - 11.4, s.z - 6.58) ? 0 : 1)
  assert.deepEqual(spots.slice(0, 4).map(cellOf), [0, 1, 0, 1])
})

test('nothing is planned for a plot with no cells, no names or no budget', () => {
  assert.deepEqual(plan(1, { centers: [] }), [])
  assert.deepEqual(plan(1, { names: [] }), [])
  assert.deepEqual(plan(1, { perCell: 0 }), [])
})

test('the count on screen starts at nothing and only ever grows', () => {
  const spots = plan(19)
  assert.equal(visibleAt(spots, 0), 0)
  let last = 0
  for (let f = 0; f <= 1.0001; f += 0.05) {
    const n = visibleAt(spots, f)
    assert.ok(n >= last, `the dressing thinned between ${f - 0.05} and ${f}`)
    last = n
  }
  assert.equal(visibleAt(spots, 1), spots.length)
})

test('a crate opens as soon as the zone goes, the last one near the end', () => {
  const names = ['barrel', 'crate_A_small', 'sack', 'crate_B_small', 'torch', 'bucket_water']
  const swap = { crate_A_small: 'crate_open', crate_B_small: 'crate_open', bucket_water: 'bucket_empty' }
  assert.deepEqual(swapPlan(names, swap), [
    { index: 1, name: 'crate_A_small', replacement: 'crate_open', at: 0 },
    { index: 3, name: 'crate_B_small', replacement: 'crate_open', at: 1 / 3 },
    { index: 5, name: 'bucket_water', replacement: 'bucket_empty', at: 2 / 3 },
  ])
})

test('a yard with nothing to exchange plans no swaps', () => {
  assert.deepEqual(swapPlan(['barrel', 'sack'], { crate_A_small: 'crate_open' }), [])
  assert.deepEqual(swapPlan(['barrel'], {}), [])
  assert.deepEqual(swapPlan([]), [])
})

test('the ruin arrives at the threshold, not a hair before it', () => {
  assert.equal(ruined(0.699, 0.7), false)
  assert.equal(ruined(0.7, 0.7), true)
  assert.equal(ruined(1, 0.7), true)
  assert.equal(ruined(0, 0.7), false)
})

test('revealAt is the even ramp both the shader and the plan read', () => {
  assert.equal(revealAt(0, 4), 0)
  assert.equal(revealAt(3, 4), 0.75)
})
