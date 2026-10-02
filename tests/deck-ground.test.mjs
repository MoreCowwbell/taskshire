/**
 * No deck is laid under a hill.
 *
 * A plot's deck is a slab at one fixed height, `plots.deckTop`, wherever its cell is, and the
 * crew walks on that height. `Colony._blockedCells` refused ground that would leave the slab
 * floating and ground that tilts across it, but not ground that is simply *higher* — so with
 * every repo on show a Compact dealt the forest out to rings five and six, where the far-field
 * hills stand evenly above the deck, and the tiles and a villager were drawn inside the hill
 * (2026-09-27).
 *
 * The same holds in upstream's worlds, which had no guard at all: the deck stands at `deckTop`
 * there too, and the far-field hills of every space world but the two islands stand over it
 * from ring 4 out. So the rule runs on every setting of both themes (2026-09-28), and these
 * tests walk every world each theme lists, against that theme's own manifest.
 *
 * `_blockedCells` is exercised through the prototype with the real settings and terrain, and a
 * stand-in ceremony at the origin: everything it reads is the setting, the manifest and one
 * transform. The ocean's island is shaped around the colony, so its ground is read around a
 * fixed footprint — the centre cell and its six neighbours, as the world golden builds it —
 * except where a test swaps in another with `withIslandFootprint`, which puts it back.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Colony } from '../src/game/colony.js'
import { coastAxis, islandFootprint, setIslandFootprint, terrainHeight, withIslandFootprint } from '../src/world/setting.js'
import { PLOT_CELL, PLOT_RINGS, allocateCells, ceremonyCell, hexToWorld, ringOf, setCeremonyCell, wedgeCells } from '../src/world/plots.js'
import { manifest } from '../src/themes/medieval/manifest.js'
import { manifest as space } from '../src/themes/space/manifest.js'
import { WORLDS } from '../src/worlds/index.js'
import { resolveSetting } from '../src/worlds/resolve.js'

const blockedFor = (setting, theme = manifest) =>
  Colony.prototype._blockedCells.call({
    setting,
    theme: { manifest: theme },
    ceremony: { group: new THREE.Group(), doorLocal: new THREE.Vector3() },
  })

/** Every pair each theme lists today, with the manifest it is built under. */
const PAIRS = [
  ...space.settings.map((setting) => ({ theme: space, setting })),
  ...manifest.settings.map((setting) => ({ theme: manifest, setting })),
]

// The island's footprint is module state; set once, and only `withIslandFootprint` moves it.
setIslandFootprint(
  [
    [0, 0],
    [1, -1],
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
  ].map(([q, r]) => hexToWorld(q, r)),
  PLOT_CELL
)

/** Every lattice cell out to `rings`, innermost first. */
function cells(rings = PLOT_RINGS) {
  const out = []
  for (let q = -rings; q <= rings; q++) for (let r = -rings; r <= rings; r++) if (ringOf({ q, r }) <= rings) out.push({ q, r })
  return out
}

/** The seven samples the rules read: the centre and the six corners. */
function seven(setting, { q, r }) {
  const { x, z } = hexToWorld(q, r)
  const out = [terrainHeight(x, z, setting)]
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i
    out.push(terrainHeight(x + PLOT_CELL * Math.cos(a), z + PLOT_CELL * Math.sin(a), setting))
  }
  return out
}

/** The highest of the seven samples. */
const highest = (setting, cell) => Math.max(...seven(setting, cell))

const forest = manifest.settings.find((s) => s.id === 'forest')

test('no dealable cell on any setting of either theme has ground above the deck', () => {
  assert.equal(PAIRS.length, 30)
  for (const { theme, setting } of PAIRS) {
    const blocked = blockedFor(setting, theme)
    const buried = cells().filter((c) => !blocked.has(`${c.q},${c.r}`) && highest(setting, c) > theme.plots.deckTop)
    assert.deepEqual(buried, [], `${setting.id}: dealable cells under the hill`)
  }
})

test('no space world deals a repo onto ground above the deck', () => {
  // More repos than the lattice has room for, so the allocator deals out to the last ring it
  // will and every cell it has left to give is tried.
  const crowd = Array.from({ length: 80 }, (_, i) => ({ id: `repo-${i}`, size: 42 }))
  setCeremonyCell(space.plots.ceremonyCell)
  for (const setting of space.settings) {
    const dealt = [...allocateCells(crowd, new Map(), { blocked: blockedFor(setting, space) }).values()].flat()
    // Out past the first ring the guard refuses on any world, or this proves nothing.
    assert.ok(dealt.some((c) => ringOf(c) >= 4), `${setting.id}: dealt nothing past ring 3`)
    const buried = dealt.filter((c) => highest(setting, c) > space.plots.deckTop).map((c) => `${c.q},${c.r}`)
    assert.deepEqual(buried, [], `${setting.id}: repos dealt under the hill`)
  }
})

test('an island judged whole stays buildable once it has grown round a crowd', () => {
  // The guard judges an island with every lattice cell as land, because a dealt cell always
  // becomes land. So the verdict has to hold once the island really has grown round what was
  // dealt: nothing buried, and in the village nothing floating either. The village does not
  // list the ocean yet, so it is the library's, in the village's dressing.
  const crowd = Array.from({ length: 80 }, (_, i) => ({ id: `repo-${i}`, size: 6 }))
  for (const [name, theme] of [
    ['village', manifest],
    ['space', space],
  ]) {
    const ocean = theme.settings.find((s) => s.id === 'ocean') ?? resolveSetting(WORLDS.ocean, theme.dressing)
    setCeremonyCell(ocean.ceremony?.cell || theme.plots.ceremonyCell)
    const blocked = blockedFor(ocean, theme)
    // One tile per size unit, so the crowd is far bigger than the room and the deal reaches the
    // last cell the guard leaves.
    const dealt = [...allocateCells(crowd, new Map(), { perCell: 1, blocked }).values()].flat()
    assert.ok(dealt.length > 0, `${name}: nothing dealt on the ocean`)
    const grown = [...dealt, ceremonyCell()].map(({ q, r }) => hexToWorld(q, r))
    const floor = theme === manifest ? -theme.plots.deckSkirt : -Infinity
    const bad = withIslandFootprint(grown, PLOT_CELL, () =>
      dealt.filter((c) => {
        const s = seven(ocean, c)
        return Math.max(...s) > theme.plots.deckTop || Math.min(...s) < floor
      })
    )
    assert.deepEqual(bad.map((c) => `${c.q},${c.r}`), [], `${name}: dealt cells off the deck's range on the grown island`)
  }
})

test('withIslandFootprint puts back the footprint it found, even when fn throws', () => {
  const ocean = space.settings.find((s) => s.id === 'ocean')
  const far = hexToWorld(11, -5)
  const was = islandFootprint()
  const heightWas = terrainHeight(far.x, far.z, ocean)
  const ring3 = [
    [3, 0],
    [0, 3],
    [-3, 3],
    [-3, 0],
    [0, -3],
    [3, -3],
  ].map(([q, r]) => hexToWorld(q, r))
  let inside = null
  const got = withIslandFootprint(ring3, PLOT_CELL, () => {
    inside = islandFootprint()
    return 'done'
  })
  assert.equal(got, 'done')
  assert.notEqual(inside.cells, was.cells, 'the footprint was never swapped')
  assert.equal(inside.cells.length, 6)
  assert.equal(islandFootprint().cells, was.cells)
  assert.equal(islandFootprint().reach, was.reach)
  assert.ok(Object.is(terrainHeight(far.x, far.z, ocean), heightWas))

  const boom = new Error('boom')
  assert.throws(
    () =>
      withIslandFootprint(ring3, PLOT_CELL + 3, () => {
        throw boom
      }),
    (e) => e === boom
  )
  assert.equal(islandFootprint().cells, was.cells)
  assert.equal(islandFootprint().reach, was.reach)
  assert.ok(Object.is(terrainHeight(far.x, far.z, ocean), heightWas))
})

test('a hilltop that is evenly high is refused, not only a slope', () => {
  // The forest's ground as it stood when the bug was seen. Its own id, because the terrain
  // sampler is memoised per setting id.
  const hilly = { ...forest, id: 't-forest-hills-1', hills: 1 }
  // Measured: 3.10 at its highest sample and under `maxTilt` of spread, so only the new rule
  // can refuse it.
  assert.ok(highest(hilly, { q: 0, r: -6 }) > 3)
  assert.ok(blockedFor(hilly).has('0,-6'))
})

test('the forest still fits a village with every repo on show', () => {
  // The owner's colony with all four states counted: 31 repos, 61 tiles at seven a tile.
  const blocked = blockedFor(forest)
  const dealable = cells(5).filter((c) => !blocked.has(`${c.q},${c.r}`)).length
  assert.ok(dealable >= 61, `forest rings 0-5 deal ${dealable} cells`)
})

/**
 * Every world of either theme has room for the owner's colony with every repo on show: 31
 * repos on 61 tiles (3 of four tiles, 5 of three, 11 of two, 12 of one, as in
 * `unplaced.test.mjs`). With the guard on, twelve village worlds and five space ones dealt
 * fewer than 61 cells until their far hills were moved out (2026-09-29); now every pair deals
 * at least that many, and the allocator deals the whole colony, each repo in one piece.
 */
test('every world of either theme deals the owner\'s whole colony', () => {
  const PER_CELL = 7
  const tiles = [4, 4, 4, 3, 3, 3, 3, 3, ...Array(11).fill(2), ...Array(12).fill(1)]
  const colony = tiles.map((t, i) => ({ id: `repo-${String(i + 1).padStart(2, '0')}`, size: PER_CELL * t - 6, tiles: t }))
  assert.equal(colony.length, 31)
  assert.equal(tiles.reduce((a, b) => a + b, 0), 61)
  const near = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2 === 1
  for (const { theme, setting } of PAIRS) {
    const name = `${theme === space ? 'space' : 'village'}/${setting.id}`
    setCeremonyCell(setting.ceremony?.cell || theme.plots.ceremonyCell)
    const blocked = blockedFor(setting, theme)
    const arrival = `${ceremonyCell().q},${ceremonyCell().r}`
    const room = cells().filter((c) => !blocked.has(`${c.q},${c.r}`) && `${c.q},${c.r}` !== arrival).length
    assert.ok(room >= 61, `${name} deals ${room} cells`)

    const dealt = allocateCells(colony, new Map(), { perCell: PER_CELL, blocked })
    for (const repo of colony) {
      const got = dealt.get(repo.id) || []
      assert.equal(got.length, repo.tiles, `${name}: ${repo.id} dealt ${got.length} of ${repo.tiles} tiles`)
      // One piece: every tile reachable from the first through the repo's own tiles.
      const seen = [got[0]]
      for (const c of seen) for (const n of got) if (!seen.includes(n) && near(c, n)) seen.push(n)
      assert.equal(seen.length, got.length, `${name}: ${repo.id} is dealt in pieces`)
    }
  }
  setCeremonyCell(manifest.plots.ceremonyCell)
})

/**
 * 61 points filling a cell's hexagon: the centre and rings of 6, 12, 18 and 24 on a triangular
 * lattice a quarter of the cell radius apart — denser than the 19 the burial rule reads, so it
 * sees the ground between them.
 */
function sixtyOne({ q, r }) {
  const { x, z } = hexToWorld(q, r)
  const step = (i) => [(PLOT_CELL / 4) * Math.cos((Math.PI / 3) * (i % 6)), (PLOT_CELL / 4) * Math.sin((Math.PI / 3) * (i % 6))]
  const out = [[x, z]]
  for (let k = 1; k <= 4; k++)
    for (let i = 0; i < 6; i++) {
      const [ax, az] = step(i)
      const [bx, bz] = step(i + 2)
      for (let j = 0; j < k; j++) out.push([x + k * ax + j * bx, z + k * az + j * bz])
    }
  return out
}

/**
 * Between the burial rule's 19 points the ground may still rise a little over a deck, but no
 * more than 0.12 on any pair: the worst, measured on this dense lattice over every dealable cell,
 * is 0.111 on space Luna's `-1,8`, where seven samples had let ground stand 0.94 over a deck
 * on space Dune (2026-09-29). The ocean is read with its island grown to every dealable cell
 * and the arrival's, as it stands once the colony has filled it.
 */
test('no dealable cell on any pair has ground more than 0.12 over its deck between samples', () => {
  assert.equal(PAIRS.length, 30)
  for (const { theme, setting } of PAIRS) {
    const name = `${theme === space ? 'space' : 'village'}/${setting.id}`
    setCeremonyCell(setting.ceremony?.cell || theme.plots.ceremonyCell)
    const blocked = blockedFor(setting, theme)
    const arrival = ceremonyCell()
    const dealable = cells().filter((c) => !blocked.has(`${c.q},${c.r}`) && !(c.q === arrival.q && c.r === arrival.r))
    const worst = () => Math.max(...dealable.flatMap((c) => sixtyOne(c).map(([x, z]) => terrainHeight(x, z, setting))))
    const top =
      setting.shape === 'island'
        ? withIslandFootprint([...dealable, arrival].map(({ q, r }) => hexToWorld(q, r)), PLOT_CELL, worst)
        : worst()
    assert.ok(top <= theme.plots.deckTop + 0.12, `${name}: ground ${(top - theme.plots.deckTop).toFixed(3)} over the deck`)
  }
  setCeremonyCell(manifest.plots.ceremonyCell)
})

test("no repo is dealt the village ocean's harbour", () => {
  // The whole lattice asked for and more, so every cell the guard leaves is dealt.
  const crowd = Array.from({ length: 80 }, (_, i) => ({ id: `repo-${i}`, size: 6 }))
  const ocean = manifest.settings.find((s) => s.id === 'ocean')
  assert.equal(ocean.ceremony.kind, 'boat')
  setCeremonyCell(ocean.ceremony.cell)
  const dealt = [...allocateCells(crowd, new Map(), { perCell: 1, blocked: blockedFor(ocean) }).values()].flat()
  assert.ok(dealt.length > 30, `${dealt.length} cells dealt`)
  const dock = hexToWorld(ocean.ceremony.cell.q, ocean.ceremony.cell.r)
  // Even a narrow wedge straight out from the dock has to be empty; the colony's is wider.
  const harbour = new Set(wedgeCells(dock, coastAxis(ocean, dock), Math.PI / 3).map((c) => `${c.q},${c.r}`))
  assert.ok(harbour.size > 10)
  assert.deepEqual(dealt.map((c) => `${c.q},${c.r}`).filter((k) => harbour.has(k)), [])
})

/**
 * No deck stands in upstream's planet water (a `water` with a `level`, the valley's among them): on every
 * pair that has one, no dealable cell has any of its seven samples below the level. The village
 * refused these already by its floor; the space theme has none, and dealt decks into the sea on
 * the beach and the ocean until the rule was said outright (2026-09-29). The ocean is read with
 * its island grown to every dealable cell and the arrival's.
 */
test('no dealable cell on any pair stands in upstream water', () => {
  assert.equal(PAIRS.length, 30)
  const watered = []
  for (const { theme, setting } of PAIRS) {
    const water = setting.water
    if (!water || !Number.isFinite(water.level)) continue
    const name = `${theme === space ? 'space' : 'village'}/${setting.id}`
    watered.push(name)
    setCeremonyCell(setting.ceremony?.cell || theme.plots.ceremonyCell)
    const blocked = blockedFor(setting, theme)
    const arrival = ceremonyCell()
    const dealable = cells().filter((c) => !blocked.has(`${c.q},${c.r}`) && !(c.q === arrival.q && c.r === arrival.r))
    const wet = () => dealable.filter((c) => Math.min(...seven(setting, c)) < water.level).map((c) => `${c.q},${c.r}`)
    const got =
      setting.shape === 'island'
        ? withIslandFootprint([...dealable, arrival].map(({ q, r }) => hexToWorld(q, r)), PLOT_CELL, wet)
        : wet()
    assert.deepEqual(got, [], `${name}: dealable cells in the water`)
  }
  setCeremonyCell(manifest.plots.ceremonyCell)
  // Not vacuous: the two worlds the rule was written for are among them.
  assert.ok(watered.includes('space/beach') && watered.includes('space/ocean'), watered.join(' '))
})

test('a cell whose centre is dry and one corner is in the water is refused', () => {
  // Space's beach, whose ground does not read the water's level, with the level raised to sit
  // just over one dealable cell's lowest corner and under its centre and every other corner.
  // Its own id, because the terrain sampler is memoised per setting id.
  const beach = space.settings.find((s) => s.id === 'beach')
  setCeremonyCell(space.plots.ceremonyCell)
  const open = blockedFor(beach, space)
  // The gap between the lowest corner and the next-lowest sample, centre included.
  const gap = (c) => {
    const [centre, ...corners] = seven(beach, c)
    corners.sort((a, b) => a - b)
    return { low: corners[0], next: Math.min(centre, corners[1]) }
  }
  const cell = cells().find((c) => {
    if (open.has(`${c.q},${c.r}`)) return false
    const { low, next } = gap(c)
    return next - low > 0.1
  })
  assert.ok(cell, 'no dealable beach cell with one corner well below the rest')
  const { low, next } = gap(cell)
  const level = (low + next) / 2
  const raised = { ...beach, id: 't-beach-wet-corner', water: { ...beach.water, level } }
  const [centre, ...corners] = seven(raised, cell)
  assert.ok(centre >= level, 'the centre is dry')
  assert.equal(corners.filter((h) => h < level).length, 1, 'one corner is wet')
  assert.ok(blockedFor(raised, space).has(`${cell.q},${cell.r}`), `${cell.q},${cell.r} dealt with a corner in the water`)
  setCeremonyCell(manifest.plots.ceremonyCell)
})
