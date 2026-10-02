import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  PLOT_CELL,
  Plot,
  SLOTS_PER_CELL,
  allocateCells,
  badgeText,
  blockedCells,
  cellKey,
  ceremonyCell,
  ceremonyPosition,
  configurePlots,
  deckMaps,
  overflowFor,
  setCeremonyCell,
  withDoorCell,
  wedgeCells,
  hexToWorld,
  ringOf,
  PLOT_RINGS,
} from '../src/world/plots.js'

/** Flat-top axial hex → world, the same arithmetic `hexToWorld` does inside the module. */
const world = (q, r) => ({ x: PLOT_CELL * 1.5 * q, z: PLOT_CELL * Math.sqrt(3) * (r + q / 2) })

/** The theme default, which `configurePlots` installs at boot and this file starts from. */
const DEFAULT = { q: -2, r: 1 }

test.afterEach(() => setCeremonyCell(DEFAULT))

/**
 * Moving the cell moves the arrival. The valley's dock stands down on the shore rather than
 * up among the plots, and this is the whole mechanism behind that: one setter, and both
 * readers — where the ceremony stands, and which cell the allocator will not hand out — come
 * from the same place.
 */
test('setCeremonyCell moves where the ceremony stands', () => {
  const before = ceremonyPosition()
  assert.ok(Math.abs(before.x - world(DEFAULT.q, DEFAULT.r).x) < 1e-9)
  assert.ok(Math.abs(before.z - world(DEFAULT.q, DEFAULT.r).z) < 1e-9)
  assert.equal(before.y, 0, 'the height is the terrain’s, put on by the colony')

  setCeremonyCell({ q: 4, r: -3 })
  assert.deepEqual(ceremonyCell(), { q: 4, r: -3 })
  const after = ceremonyPosition()
  assert.ok(Math.abs(after.x - world(4, -3).x) < 1e-9)
  assert.ok(Math.abs(after.z - world(4, -3).z) < 1e-9)
})

/** Copied in, and copied out: a caller that keeps its object must not be able to move the
 *  ceremony by mutating it afterwards, and one that mutates what it is handed must not
 *  either. Settings are shared objects read on every swap. */
test('the cell is held by value at both ends', () => {
  const cell = { q: 1, r: 1 }
  setCeremonyCell(cell)
  cell.q = 9
  assert.deepEqual(ceremonyCell(), { q: 1, r: 1 })
  const read = ceremonyCell()
  read.r = 9
  assert.deepEqual(ceremonyCell(), { q: 1, r: 1 })
})

/**
 * The cell the ceremony owns is reserved: nothing else may be placed on it, whichever cell it
 * is this minute. A repo handed the castle's ground would have a wall through its houses.
 */
test('the allocator reserves whichever cell the ceremony is on', () => {
  const projects = Array.from({ length: 18 }, (_, i) => ({ id: `p${i}`, size: 4 }))

  const before = cellsOf(allocateCells(projects))
  assert.ok(!before.has('-2,1'), 'the default cell is not handed out')

  setCeremonyCell({ q: 0, r: 0 })
  const after = cellsOf(allocateCells(projects))
  assert.ok(!after.has('0,0'), 'nor is the one it moved to')
  // And the ground it left is free again, so a colony does not lose a cell per setting change.
  assert.ok(after.has('-2,1'), 'the cell it left is back in the pool')
})

// ── the blocked set ────────────────────────────────────────────────────────────────────

/** Eighteen four-thread repos: enough to reach ring three and to be hemmed in by neighbours. */
const crowd = () => Array.from({ length: 18 }, (_, i) => ({ id: `p${i}`, size: 4 }))
const cellsOf = (layout) => new Set([...layout.values()].flat().map((c) => cellKey(c.q, c.r)))

/**
 * A blocked cell is not in the pool, so it can be neither seeded on nor grown into — the two
 * ways a zone acquires ground, and the reason this is one set rather than a check in each.
 *
 * The blocked ring here is deliberately the inner one the spiral reaches first: a set the
 * seeder happens to walk past proves nothing.
 */
test('a blocked cell is never seeded on and never grown into', () => {
  const blocked = new Set(['0,0', '1,0', '1,-1', '0,-1', '-1,0', '-1,1', '0,1'])
  const got = cellsOf(allocateCells(crowd(), new Map(), { blocked }))
  for (const k of blocked) assert.ok(!got.has(k), `${k} was handed out`)
  // Everybody still got housed: blocking the middle pushes the colony out, it does not
  // starve it.
  const layout = allocateCells(crowd(), new Map(), { blocked })
  for (const [, cells] of layout) assert.equal(cells.length, 1, 'every repo still has its tile')
})

/**
 * A zone whose *root* has gone under water is re-seeded rather than re-rooted onto whichever
 * of its old cells is still dry. The root is the zone's origin — everything standing on it is
 * placed from there — so a blob that loses it has moved anyway, and moving it somewhere
 * honest beats leaving it half in the sea.
 */
test('a zone whose root is blocked is seeded afresh, and one that keeps its root stays', () => {
  const previous = new Map([
    ['drowned', [{ q: 3, r: 0 }, { q: 3, r: -1 }]],
    ['safe', [{ q: -3, r: 0 }, { q: -3, r: 1 }]],
  ])
  const projects = [{ id: 'drowned', size: 8 }, { id: 'safe', size: 8 }]
  const layout = allocateCells(projects, previous, { blocked: new Set(['3,0']) })

  const drowned = layout.get('drowned')
  assert.equal(drowned.length, 2)
  assert.ok(!drowned.some((c) => cellKey(c.q, c.r) === '3,0'), 'the blocked root is gone')
  // Re-seeded, not re-rooted: the new root is the innermost free cell, not its old neighbour.
  assert.deepEqual(drowned[0], { q: 0, r: 0 }, 'seeded afresh from the middle')

  // And the zone that was not touched did not move a tile.
  assert.deepEqual(layout.get('safe'), [{ q: -3, r: 0 }, { q: -3, r: 1 }])
})

/**
 * The ceremony cell and the blocked set are two different reservations and both hold at once.
 * The dock's own cell is very often in the blocked set as well — the valley's is, its ground
 * being half a unit under the skirt — and neither may quietly cancel the other.
 */
test('the ceremony cell and the blocked set compose', () => {
  setCeremonyCell({ q: 0, r: 0 })
  const blocked = new Set(['1,0', '2,0', '0,0'])
  const got = cellsOf(allocateCells(crowd(), new Map(), { blocked }))
  assert.ok(!got.has('0,0'), 'the ceremony cell, which is also blocked')
  assert.ok(!got.has('1,0'))
  assert.ok(!got.has('2,0'))
  // The default, with no blocked set at all, is unchanged — every existing caller included.
  const plain = cellsOf(allocateCells(crowd()))
  assert.ok(!plain.has('0,0'))
  assert.ok(plain.has('1,0'), 'nothing else is reserved when nothing else is blocked')
})

/**
 * `blockedCells` samples the centre *and* the six corners, which is the whole point of it: a
 * hex whose middle is on the bank can still have two corners out over the water, and a plot
 * is a prism rather than a post.
 *
 * The synthetic `isDry` is a half-plane at x = 9, against a cell size of 10, and the threshold
 * is chosen to pin the corner *angle* as well as the fact that corners are sampled at all. A
 * flat-top hexagon has a corner square on +x at exactly 10; a pointy-top one — the phase three
 * builds a six-sided cylinder at, and the one this lattice is emphatically not — reaches only
 * 10·cos 30° = 8.66. So 9 is wet for the lattice as authored and dry for the wrong phase, and
 * `{-1, 0}` (centre -15, corners from -25 to -5) is clear of it either way.
 */
test('blockedCells blocks a cell whose corner is wet and keeps a fully dry one', () => {
  const isDry = (x) => x < 9
  const got = blockedCells(isDry, { rings: 1, size: 10 })
  assert.ok(got.has('0,0'), 'the straddling cell is blocked by its one flat-top corner alone')
  assert.ok(!got.has('-1,0'), 'and one wholly on the dry side is kept')
  // Its wet neighbour is blocked on the centre, which is the easy half of the test.
  assert.ok(got.has('1,0'))

  // A world that is dry everywhere blocks nothing, whatever the ring count.
  assert.equal(blockedCells(() => true, { rings: 3, size: 10 }).size, 0)
  // And one that is wet everywhere blocks every cell it walks: 1 + 3n(n+1).
  assert.equal(blockedCells(() => false, { rings: 3, size: 10 }).size, 1 + 3 * 3 * 4)
})

/**
 * The slope rule, with a synthetic sampler: a cell is refused when the ground climbs more than
 * `maxTilt` across its seven samples, whatever the coast rule made of it.
 *
 * The ground here is a plain ramp in x, so a cell's spread is the run across it times the
 * gradient: a flat-top hexagon of radius 10 is 20 wide, so a gradient of 0.1 is a spread of 2.
 * That makes the threshold arithmetic rather than a measurement, and both sides of it are
 * pinned — 2.5 keeps every cell and 1.5 keeps none.
 */
test('maxTilt blocks a cell the ground climbs across, and is off without a sampler', () => {
  const ramp = (x) => x * 0.1
  const dry = () => true

  // Off by default: no sampler, no rule, whatever the tilt of the world.
  assert.equal(blockedCells(dry, { rings: 1, size: 10 }).size, 0)
  // A sampler with no threshold is off too — `Infinity` is the manifest default.
  assert.equal(blockedCells(dry, { rings: 1, size: 10, heightAt: ramp }).size, 0)

  // The spread is 2 everywhere on a ramp this steep, so the threshold alone decides.
  assert.equal(blockedCells(dry, { rings: 1, size: 10, heightAt: ramp, maxTilt: 2.5 }).size, 0)
  assert.equal(blockedCells(dry, { rings: 1, size: 10, heightAt: ramp, maxTilt: 1.5 }).size, 7)

  // Flat ground is never blocked, however low the threshold.
  assert.equal(blockedCells(dry, { rings: 2, size: 10, heightAt: () => -3, maxTilt: 0 }).size, 0)
})

/**
 * The ceiling reads nineteen points, not seven: a hill can rise over a deck between the corners.
 *
 * The bump is a narrow peak on the edge midpoint between cell `{0, 0}`'s first two corners, at
 * `10·cos 30°` on the 30° bearing, which is also an edge midpoint of `{1, 0}` across that edge.
 * Its nearest sample of the seven, on either cell, is five units off, where the peak has fallen
 * to about 1e-11 — so the seven read flat ground and only the edge midpoints see the hill.
 */
test('the ceiling refuses a bump between two corners that the seven samples miss', () => {
  const peak = { x: 10 * Math.cos(Math.PI / 6) ** 2, z: 10 * Math.cos(Math.PI / 6) * Math.sin(Math.PI / 6) }
  const bump = (x, z) => Math.exp(-((x - peak.x) ** 2 + (z - peak.z) ** 2))
  const dry = () => true

  // The seven samples of both cells stand far below the ceiling.
  for (const [q, r] of [
    [0, 0],
    [1, 0],
  ]) {
    const { x, z } = hexToWorld(q, r, 10)
    const seven = [bump(x, z), ...[0, 1, 2, 3, 4, 5].map((i) => bump(x + 10 * Math.cos((Math.PI / 3) * i), z + 10 * Math.sin((Math.PI / 3) * i)))]
    assert.ok(Math.max(...seven) < 1e-9, `{${q}, ${r}}: the seven samples see the bump`)
  }

  const got = blockedCells(dry, { rings: 2, size: 10, heightAt: bump, ceiling: 0.5 })
  assert.deepEqual([...got].sort(), ['0,0', '1,0'])
  // No ceiling, no rule — and a ceiling above the peak refuses nothing either.
  assert.equal(blockedCells(dry, { rings: 2, size: 10, heightAt: bump }).size, 0)
  assert.equal(blockedCells(dry, { rings: 2, size: 10, heightAt: bump, ceiling: 1.5 }).size, 0)
})

/**
 * The two rules compose, and neither cancels the other: a cell may be wet, tilted, or both, and
 * the set is the union. The tilt is measured only on cells the coast rule kept — seven terrain
 * samples are not free and a blocked cell has nothing to add — which this pins by giving the
 * sampler a counter.
 */
test('the coast rule and the slope rule compose', () => {
  const isDry = (x) => x < 9
  let reads = 0
  const heightAt = (x) => {
    reads++
    return x * 0.1
  }
  const got = blockedCells(isDry, { rings: 1, size: 10, heightAt, maxTilt: 1.5 })
  // Every cell of rings 0 and 1 is either wet or too steep, so all seven are in.
  assert.equal(got.size, 7)
  // `{1,0}` and `{0,0}` fail the coast rule and are never sampled for height; the rest are.
  assert.ok(got.has('1,0'))
  assert.ok(got.has('-1,0'), 'blocked on tilt alone, being wholly on the dry side')
  // Exactly two of the seven cells survive the coast rule — `{-1,0}` and `{-1,1}`, the only two
  // whose centre and six corners all sit left of x = 9 — and each costs seven samples. Pinned to
  // the number rather than to a range, because a range would not notice the rule being hoisted
  // above the coast test and paying for all seven cells.
  assert.equal(reads, 2 * 7, 'the tilt rule samples only the cells the coast rule kept')
})

/**
 * The cell under a ceremony's threshold is reserved too.
 *
 * A castle or a lander is centred on its cell and its door lands back inside it, so this is a
 * no-op for them and always was. A pier is not centred on anything: the dock's cell is a shore
 * station out on the bank and its threshold is 7.5 units landward, which is a different cell
 * and one nothing reserved — so with enough zones a repo would be dealt the ground its own
 * neighbours' arrivals walk out of.
 */
test('withDoorCell reserves the cell the threshold stands in', () => {
  // The valley's dock: cell `{-3, 1}`, threshold at world (-26.81, -7.88), which is `{-2, 0}`.
  const got = withDoorCell(new Set(['-3,1']), -26.81, -7.88)
  assert.ok(got.has('-2,0'), 'the threshold’s own cell is reserved')
  assert.ok(got.has('-3,1'), 'and the set it was given is carried through')
  assert.equal(got.size, 2)

  // Non-mutating, so the caller's set may be a shared constant.
  const base = new Set()
  assert.notEqual(withDoorCell(base, -26.81, -7.88), base)
  assert.equal(base.size, 0)

  // A door that lands back in a cell already blocked — every castle and every lander — costs
  // nothing and hands the same set straight back.
  const already = new Set(['-2,1'])
  assert.equal(withDoorCell(already, -15.8, 0), already, 'the same set, not a copy')

  // And an allocator handed it will not seed on that cell.
  const projects = [{ id: 'solo', size: 4 }]
  const blocked = withDoorCell(new Set(), -26.81, -7.88)
  const cells = allocateCells(projects, new Map(), { blocked }).get('solo')
  assert.ok(!cells.some((c) => cellKey(c.q, c.r) === '-2,0'))
})

/**
 * Compacting is "forget the layout": a fresh allocation with no memory packs every zone
 * onto the innermost free tiles, which is what the Compact button asks for. The layout
 * that grew holes — three single-tile repos left out at ring 3 after their neighbours went —
 * comes back as three tiles touching the middle.
 */
test('an allocation with no memory packs zones onto the innermost tiles', () => {
  const hexDistance = (c) => (Math.abs(c.q) + Math.abs(c.q + c.r) + Math.abs(c.r)) / 2
  const spread = new Map([
    ['a', [{ q: 3, r: 0 }]],
    ['b', [{ q: 0, r: 3 }]],
    ['c', [{ q: -3, r: 3 }]],
  ])
  const projects = [{ id: 'a', size: 1 }, { id: 'b', size: 1 }, { id: 'c', size: 1 }]
  const kept = allocateCells(projects, spread)
  assert.deepEqual(kept.get('a'), [{ q: 3, r: 0 }], 'with memory, a zone stays where it was')

  const packed = allocateCells(projects, new Map())
  for (const [id, cells] of packed) {
    assert.equal(cells.length, 1, `${id} keeps one tile`)
    assert.ok(hexDistance(cells[0]) <= 1, `${id} lands on ring 0 or 1, got ${JSON.stringify(cells[0])}`)
  }
  const keys = new Set([...packed.values()].map((cells) => cellKey(cells[0].q, cells[0].r)))
  assert.equal(keys.size, 3, 'no two zones share a tile')
})

// ── the kerb's inset ───────────────────────────────────────────────────────────────────

/** The space theme's own plot numbers, which `configurePlots` installs at boot. */
const DECK_TOP = 0.45
const TILE = PLOT_CELL * 0.992
const APOTHEM = TILE * Math.cos(Math.PI / 6)
/** Half the kerb bar's width. `_buildBorder` puts the *centreline* this far inside the face. */
const HALF_BAR = 0.16

/**
 * A plot built with a stand-in surfaces hook.
 *
 * Everything the hook hands back is a texture or a UV table, and a `node --test` run has no
 * canvas to draw one on — but a material is happy with `undefined` for every map, so empty
 * objects are enough to get a real `Plot` built and its geometry measured. The clutter names
 * a part no kit has, which is what keeps `_buildClutter` out of the way, and the lamp posts
 * are off for the same reason.
 */
function plotWith(surf, cells = [{ q: 0, r: 0 }]) {
  configurePlots(
    {
      deckTop: DECK_TOP,
      deckSkirt: 0.4,
      palette: [0x6fd3ff],
      ceremonyCell: { q: -2, r: 1 },
      clutter: ['not-in-any-kit'],
      clutterScale: 1.35,
      clutterLamp: '',
      clutterLampScale: 1.1,
      lampPosts: false,
    },
    { deck: () => ({}), kerb: () => ({}), deckTextureScale: 4, kerbUv: { top: { v0: 0, v1: 0.5 }, side: { u: 0.5, v: 0.75 } }, ...surf }
  )
  return new Plot({ id: 'p', name: 'p', index: 0, cells, accent: 0x6fd3ff })
}

/**
 * Where the six bars of a single-cell plot actually stand, as the distance from the tile's
 * centre to each bar's centreline.
 *
 * Measured off the merged geometry rather than off the constants, because the constants are
 * what the test is holding the engine to. Every bar is one `BoxGeometry`, so the merged
 * buffer is six equal runs of vertices and the mean of a run is that bar's centre.
 */
function kerbRadii(plot) {
  const pos = plot.border.geometry.attributes.position
  const per = pos.count / 6
  const out = []
  for (let bar = 0; bar < 6; bar++) {
    let sx = 0
    let sz = 0
    for (let i = bar * per; i < (bar + 1) * per; i++) {
      sx += pos.getX(i)
      sz += pos.getZ(i)
    }
    out.push(Math.hypot(sx / per, sz / per))
  }
  return out
}

/**
 * No `kerbInset` is today's kerb, to the last decimal: the field is the opt-in and a theme
 * that never heard of it must not move. This is the half of the contract the four frozen
 * space baselines rest on.
 */
test('a theme with no kerbInset keeps the kerb exactly where it was', () => {
  const plot = plotWith({})
  for (const r of kerbRadii(plot)) assert.ok(Math.abs(r - (APOTHEM - 0.05 - HALF_BAR)) < 1e-6, `bar at ${r}`)
  plot.dispose()
})

/** A number moves the bar inboard by that much, measured from the tile's edge as before. */
test('kerbInset moves the bar in from the tile edge', () => {
  const plot = plotWith({ kerbInset: 0.38 })
  for (const r of kerbRadii(plot)) assert.ok(Math.abs(r - (APOTHEM - 0.38 - HALF_BAR)) < 1e-6, `bar at ${r}`)
  plot.dispose()
})

/**
 * And a function is resolved once, against the tile radius the engine owns.
 *
 * That is the whole reason the field may be a function: `surfaces()` runs at boot, before
 * `configurePlots` has told the theme anything, so a theme whose inset is a proportion of the
 * tile — a bevel's width — has nothing to compute it from until the engine asks.
 */
test('kerbInset may be a function of the tile radius', () => {
  const seen = []
  const plot = plotWith({
    kerbInset: (tile) => {
      seen.push(tile)
      return 0.05 + 0.05 * (tile / 1.1547)
    },
  })
  assert.deepEqual(seen, [TILE], 'resolved once, with the engine’s own tile radius')
  const want = APOTHEM - (0.05 + 0.05 * (TILE / 1.1547)) - HALF_BAR
  for (const r of kerbRadii(plot)) assert.ok(Math.abs(r - want) < 1e-6, `bar at ${r}`)
  plot.dispose()
})

// ── the deck's geometry ────────────────────────────────────────────────────────────────

/**
 * A theme that builds its own cell gets it merged, placed by its top face, and nothing else:
 * the engine's own prism is not built at all.
 *
 * The builder here hands back a unit box with its top at y 0, which is enough to prove both
 * halves — the merged deck is exactly the boxes it returned, and their tops land on
 * `deckTop` rather than half a prism below it.
 */
test('deckGeometry replaces the engine prism, placed by its top face', () => {
  const seen = []
  const plot = plotWith({
    deckGeometry: (cell) => {
      seen.push(cell)
      const geo = new THREE.BoxGeometry(1, 1, 1)
      geo.translate(0, -0.5, 0)
      return geo
    },
  })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { tile: TILE, top: DECK_TOP, skirt: 0.4, x: 0, z: 0, textureScale: 4 })

  plot.deck.geometry.computeBoundingBox()
  const box = plot.deck.geometry.boundingBox
  assert.ok(Math.abs(box.max.y - DECK_TOP) < 1e-6, `top face at ${box.max.y}`)
  assert.ok(Math.abs(box.min.y - (DECK_TOP - 1)) < 1e-6)
  assert.ok(Math.abs(box.max.x - 0.5) < 1e-6, 'the builder’s own footprint, not a hex prism')
  plot.dispose()
})

/**
 * Returning null is the fallback the whole contract rests on: a kit that failed to load
 * leaves the theme with no tile to hand over, and the plot has to be a plot anyway.
 */
test('a deckGeometry that answers null falls back to the engine prism', () => {
  const plot = plotWith({ deckGeometry: () => null })
  plot.deck.geometry.computeBoundingBox()
  const box = plot.deck.geometry.boundingBox
  assert.ok(Math.abs(box.max.y - DECK_TOP) < 1e-6)
  assert.ok(Math.abs(box.min.y - (DECK_TOP - 0.85)) < 1e-6, 'the prism, skirt and all')
  assert.ok(Math.abs(box.max.x - TILE) < 1e-6, 'a flat-top hexagon of the engine’s own radius')
  plot.dispose()
})

test('deckMaps leaves out the maps a deck did not supply, so three has nothing to warn about', () => {
  const map = new THREE.Texture()
  const normalMap = new THREE.Texture()
  // The medieval kit deck's shape: colour and relief, no roughness.
  const kit = deckMaps({ map, normalMap })
  assert.deepEqual(Object.keys(kit).sort(), ['map', 'normalMap'])
  assert.equal(kit.map, map)
  assert.deepEqual(deckMaps({ map, normalMap, roughnessMap: undefined }), kit)
  const rough = new THREE.Texture()
  assert.equal(deckMaps({ map, normalMap, roughnessMap: rough }).roughnessMap, rough)

  const warned = []
  const warn = console.warn
  console.warn = (...args) => warned.push(args.join(' '))
  try {
    // The shape the bug had, so this test would notice three no longer warning at all.
    new THREE.MeshStandardMaterial({ color: 0xffffff, map, normalMap, roughnessMap: undefined }).dispose()
    assert.equal(warned.length, 1, 'an explicit undefined is what three warns about')
    warned.length = 0
    new THREE.MeshStandardMaterial({ color: 0xffffff, ...kit, roughness: 0.82 }).dispose()
  } finally {
    console.warn = warn
  }
  assert.deepEqual(warned, [])
})

/**
 * Seven slots a tile, and nothing past them.
 *
 * `slotFor` used to answer `slots[index % slots.length]`, so a zone with more threads than
 * ground dealt the same spot twice and two buildings stood inside each other. The limit is
 * hard now: past the last slot there is no answer, and the caller counts the thread instead.
 */
test('a slot index past the last one is refused rather than wrapped', () => {
  const plot = plotWith({})
  assert.equal(plot.slots.length, SLOTS_PER_CELL, 'one tile is seven slots')
  assert.ok(plot.slotFor(6), 'the last one')
  assert.equal(plot.slotFor(7), null, 'and nothing after it')
  assert.equal(plot.worldSlot(7), null, 'including in world space')
  // Two tiles is fourteen, and the same rule at the new end.
  plot.dispose()
  const pair = plotWith({}, [{ q: 0, r: 0 }, { q: 1, r: 0 }])
  assert.equal(pair.slots.length, SLOTS_PER_CELL * 2)
  assert.ok(pair.worldSlot(13))
  assert.equal(pair.worldSlot(14), null)
  pair.dispose()
})

test('overflow is the threads a zone has no slot for', () => {
  assert.equal(overflowFor(7, 1), 0, 'a full one-tile zone')
  assert.equal(overflowFor(8, 1), 1)
  assert.equal(overflowFor(3, 1), 0, 'never negative')
  assert.equal(overflowFor(200, 9), 200 - 63, 'the nine-tile cap is 63 buildings')
  assert.equal(badgeText(0), '', 'nothing to say')
  assert.equal(badgeText(137), '+137')
})

/**
 * A zone that needs more ground and is hemmed in.
 *
 * `growBlob` gave up silently — `if (!best) break` — and the zone kept wrapping its slots.
 * Now it moves: its own cells go back on the market, and it is re-seeded on the innermost free
 * component with room for the whole of it. Only the whole of it: a jump that solves half the
 * problem is not worth making, so a zone that fits nowhere stays exactly where it stood.
 */

/** A ring of one-tile zones around `centre`, which is what boxes a zone in. */
const ringAround = ({ q, r }) =>
  [
    { q: q + 1, r },
    { q: q - 1, r },
    { q, r: r + 1 },
    { q, r: r - 1 },
    { q: q + 1, r: r - 1 },
    { q: q - 1, r: r + 1 },
  ].map((c, i) => [`wall${i}`, [c]])

test('a boxed-in zone that needs more ground moves to open ground', () => {
  // `boxed` sits at (5, 0) with all six neighbours held by one-tile repos.
  const home = { q: 5, r: 0 }
  const previous = new Map([['boxed', [home]], ...ringAround(home)])
  const projects = [
    { id: 'boxed', size: 21 }, // three tiles' worth of threads
    ...ringAround(home).map(([id]) => ({ id, size: 1 })),
  ]
  const out = allocateCells(projects, previous, { perCell: 7 })

  const cells = out.get('boxed')
  assert.equal(cells.length, 3, 'it got the ground it needed')
  assert.notEqual(cellKey(cells[0].q, cells[0].r), cellKey(home.q, home.r), 'somewhere else')
  // And it did not take it from its neighbours, who never asked to move.
  for (const [id, was] of ringAround(home)) {
    assert.deepEqual(out.get(id), was, `${id} stayed put`)
  }
  // The tile it vacated is nobody's now.
  const held = new Set([...out.values()].flat().map((c) => cellKey(c.q, c.r)))
  assert.equal(held.has(cellKey(home.q, home.r)), false, 'the old tile was given back')
})

test('a zone that fits nowhere keeps the ground it had', () => {
  // One free cell in the whole pool: (0,0), with everything else spoken for.
  const previous = new Map([['boxed', [{ q: 5, r: 0 }]], ...ringAround({ q: 5, r: 0 })])
  const projects = [
    { id: 'boxed', size: 60 }, // nine tiles' worth: there is no room for that anywhere
    ...ringAround({ q: 5, r: 0 }).map(([id]) => ({ id, size: 1 })),
  ]
  const big = allocateCells(projects, previous, { perCell: 7 })
  // Nine tiles is available in the open middle, so this one *does* move — which is the point
  // of the case below: it is the zone with nowhere to go that must not.
  assert.equal(big.get('boxed').length, 9)

  // Now block the pool down to the zone's own six-walled neighbourhood.
  const blocked = new Set()
  for (let q = -12; q <= 12; q++) {
    for (let r = -12; r <= 12; r++) {
      const ring = (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2
      if (ring <= 12 && !(q === 5 && r === 0) && !ringAround({ q: 5, r: 0 }).some(([, [c]]) => c.q === q && c.r === r)) {
        blocked.add(cellKey(q, r))
      }
    }
  }
  const stuck = allocateCells(projects, previous, { perCell: 7, blocked })
  assert.deepEqual(stuck.get('boxed'), [{ q: 5, r: 0 }], 'nowhere better, so it did not move')
})

test('a relocated zone holds its new ground on the next pass', () => {
  const home = { q: 5, r: 0 }
  const previous = new Map([['boxed', [home]], ...ringAround(home)])
  const projects = [{ id: 'boxed', size: 21 }, ...ringAround(home).map(([id]) => ({ id, size: 1 }))]
  const first = allocateCells(projects, previous, { perCell: 7 })
  const second = allocateCells(projects, first, { perCell: 7 })
  assert.deepEqual(second.get('boxed'), first.get('boxed'), 'no oscillation')
})

test('a newcomer is seeded where there is room for the whole of it', () => {
  // A one-cell hole at the very middle, and open ground further out. A three-tile newcomer
  // belongs in the open ground, not in the hole.
  const previous = new Map([
    ['a', [{ q: 1, r: 0 }]],
    ['b', [{ q: -1, r: 0 }]],
    ['c', [{ q: 0, r: 1 }]],
    ['d', [{ q: 0, r: -1 }]],
    ['e', [{ q: 1, r: -1 }]],
    ['f', [{ q: -1, r: 1 }]],
  ])
  const projects = [
    { id: 'new', size: 21 },
    ...[...previous.keys()].map((id) => ({ id, size: 1 })),
  ]
  const out = allocateCells(projects, previous, { perCell: 7 })
  assert.equal(out.get('new').length, 3)
  assert.notEqual(cellKey(out.get('new')[0].q, out.get('new')[0].r), cellKey(0, 0))
})

/**
 * Which zones the allocator actually *moved*, as opposed to which ones ended up elsewhere.
 *
 * A root tile changes for several reasons — a setting whose coast blocks the ground under a
 * zone, `threadsPerTile` lowered so a zone is re-dealt, a Compact — and only one of them is
 * the map rearranging itself behind the user's back. The toast is about that one, so the
 * relocation pass says so rather than the colony inferring it from a moved root.
 */
test('the allocator reports the zones its relocation pass moved, and only those', () => {
  const home = { q: 5, r: 0 }
  const previous = new Map([['boxed', [home]], ...ringAround(home)])
  const projects = [{ id: 'boxed', size: 21 }, ...ringAround(home).map(([id]) => ({ id, size: 1 }))]

  const relocated = new Set()
  allocateCells(projects, previous, { perCell: 7, relocated })
  assert.deepEqual([...relocated], ['boxed'], 'the one that could not grow where it stood')

  // A zone with room to grow is not a relocation, however many tiles it gains.
  const roomy = new Set()
  allocateCells([{ id: 'a', size: 21 }], new Map([['a', [{ q: 0, r: 0 }]]]), { perCell: 7, relocated: roomy })
  assert.deepEqual([...roomy], [], 'it grew, it did not move')

  // Nor is a newcomer, which has nowhere to be moved from.
  const fresh = new Set()
  allocateCells([{ id: 'a', size: 21 }], new Map(), { perCell: 7, relocated: fresh })
  assert.deepEqual([...fresh], [])

  // And a zone with nowhere better stays put, so nothing is announced about it either.
  const blocked = new Set()
  for (let q = -12; q <= 12; q++) {
    for (let r = -12; r <= 12; r++) {
      const ring = (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2
      if (ring <= 12 && !(q === 5 && r === 0) && !ringAround(home).some(([, [c]]) => c.q === q && c.r === r)) {
        blocked.add(cellKey(q, r))
      }
    }
  }
  const stuck = new Set()
  allocateCells(projects, previous, { perCell: 7, blocked, relocated: stuck })
  assert.deepEqual([...stuck], [], 'nowhere to go is not a move')
})

/**
 * A name plate goes on the overlay layer only where the engine has the overlay pass to draw
 * it. `createLabel` measures and paints on a 2D canvas; Node has none, so a context that
 * answers every call with nothing stands in — the layer is the whole of what is under test.
 */
test('a name plate rides the overlay layer only where the overlay feature exists', async (t) => {
  const { configureFeatures, resolveFeatures } = await import('../src/core/features.js')
  const { OVERLAY_LAYER } = await import('../src/core/engine.js')
  const hadDocument = 'document' in globalThis
  const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 40 }) : () => {}), set: () => true })
  if (!hadDocument) globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
  t.after(() => {
    configureFeatures(resolveFeatures())
    if (!hadDocument) delete globalThis.document
  })
  const { createLabel } = await import('../src/world/plots.js')
  configureFeatures(resolveFeatures({ overlay: true }))
  assert.ok(createLabel('alpha', '#88aaff').layers.isEnabled(OVERLAY_LAYER))
  configureFeatures(resolveFeatures())
  const plain = createLabel('alpha', '#88aaff')
  assert.ok(!plain.layers.isEnabled(OVERLAY_LAYER))
  assert.ok(plain.layers.isEnabled(0))
})

test('wedgeCells takes the cells seaward of a point and within the angle, and not the point', () => {
  const origin = hexToWorld(-1, -1)
  const axis = [origin.x / Math.hypot(origin.x, origin.z), origin.z / Math.hypot(origin.x, origin.z)]
  const keys = (cells) => cells.map((c) => `${c.q},${c.r}`)
  const narrow = keys(wedgeCells(origin, axis, (5 * Math.PI) / 180))
  assert.ok(!narrow.includes('-1,-1'), 'the apex is not in it')
  assert.ok(narrow.includes('-2,-2') && narrow.includes('-11,-11') === false, 'straight out along the axis, inside the lattice')
  for (const k of narrow) {
    const [q, r] = k.split(',').map(Number)
    assert.ok(ringOf({ q, r }) <= PLOT_RINGS)
  }
  // Widening takes in the cells either side, 30° and 60° off, and never one behind the apex.
  const wide = keys(wedgeCells(origin, axis, (63 * Math.PI) / 180))
  for (const k of ['-2,-1', '-1,-2', '-3,0', '0,-3']) assert.ok(wide.includes(k) && !narrow.includes(k), k)
  for (const k of ['0,0', '-1,0', '0,-1', '-2,0', '0,-2']) assert.ok(!wide.includes(k), `${k} is not seaward of the apex`)
})
