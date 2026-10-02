/**
 * A repo with no room on a world keeps its tiles, and is named.
 *
 * The village's forest deals 205 cells; its moon, 66. Before this, a repo with no room was
 * forgotten and a repo moved off refused cells was remembered where the moon put it, so going
 * back to the forest moved both. Now neither is written to memory: the forest gets every repo
 * back on exactly the cells it had, and the moon names the ones it had no room for (2026-09-28).
 *
 * **Why the crowded roster is bigger than the owner's.** The owner's colony with every repo on
 * show is 31 repos on 61 tiles. When this was written the moon dealt 40 cells, so that colony
 * crowded it; since the moon's far hills were moved out (2026-09-29) it deals 66, and the
 * owner's colony fits. So the cases that need a full moon add two-tile repos to the owner's
 * roster until its tiles outnumber every cell the moon does not refuse by more than the largest
 * repo's four, counted here from `_blockedCells` rather than written down, so the moon is
 * crowded whatever its room becomes. The margin is there because a repo the moon has room for
 * only part of is dealt that part: a roster one tile over the room leaves one repo a tile
 * short and crowds nobody out (measured on the moon: one tile over, none crowded; five over,
 * three).
 *
 * `_syncPlots` runs through the prototype on a stand-in colony, as `deck-ground.test.mjs` runs
 * `_blockedCells`: the real memory, the real allocator and the real guard. Plot meshes want a
 * DOM, so the stand-in's `plots` answers `has()` with true and none is built.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Colony } from '../src/game/colony.js'
import { PLOT_RINGS, allocateCells, ceremonyCell, ceremonyPosition, ringOf, setCeremonyCell } from '../src/world/plots.js'
import { manifest } from '../src/themes/medieval/manifest.js'

const PER_CELL = 7
const forest = manifest.settings.find((s) => s.id === 'forest')
// The village lists every world, the moon among them, in the village's dressing.
const moon = manifest.settings.find((s) => s.id === 'moon')

/**
 * The owner's colony with every repo on show: 31 repos, 61 tiles (3 of four tiles, 5 of three,
 * 11 of two, 12 of one), each with the fewest threads that still need its tiles.
 */
function roster(extra = []) {
  const tiles = [4, 4, 4, 3, 3, 3, 3, 3, ...Array(11).fill(2), ...Array(12).fill(1)]
  const spec = tiles.map((t, i) => ({ name: `repo-${String(((i * 7) % 31) + 1).padStart(2, '0')}`, threads: PER_CELL * t - 6 }))
  return [...spec, ...extra]
    .sort((a, b) => b.threads - a.threads || a.name.localeCompare(b.name))
    .map(({ name, threads }) => [name, Array.from({ length: threads }, (_, i) => ({ id: `${name}-${i}` }))])
}

function standIn() {
  const plots = new Map()
  plots.has = () => true
  const calls = []
  const colony = Object.create(Colony.prototype)
  Object.assign(colony, {
    theme: { manifest },
    settings: { get: (k) => ({ threadsPerTile: PER_CELL })[k] },
    plotCells: new Map(),
    plots,
    plotOrder: [],
    plotGroup: new THREE.Group(),
    labelGroup: new THREE.Group(),
    usedAccents: new Set(),
    scatterGroup: null,
    island: null,
    unplaced: [],
    _syncLabels() {},
    onUnplaced: (names, added) => calls.push({ names: [...names], added: [...added] }),
  })
  return { colony, calls }
}

/** What `Colony.setSetting` does for the plots: the arrival's cell, then the guard. */
function switchTo(colony, setting) {
  colony.setting = setting
  setCeremonyCell(setting.ceremony?.cell || manifest.plots.ceremonyCell)
  const group = new THREE.Group()
  const at = ceremonyPosition()
  group.position.set(at.x, 0, at.z)
  colony.ceremony = { group, doorLocal: new THREE.Vector3() }
  colony.blockedCells = colony._blockedCells()
}

/**
 * The owner's roster and enough two-tile repos that its tiles outnumber the moon's room (every
 * cell of rings 0 to `PLOT_RINGS` that `_blockedCells` does not refuse) by more than four.
 */
function crowdedRoster() {
  const { colony } = standIn()
  switchTo(colony, moon)
  let room = 0
  for (let q = -PLOT_RINGS; q <= PLOT_RINGS; q++)
    for (let r = -PLOT_RINGS; r <= PLOT_RINGS; r++) if (ringOf({ q, r }) <= PLOT_RINGS && !colony.blockedCells.has(`${q},${r}`)) room++
  const extra = []
  for (let tiles = 61; tiles <= room + 4; tiles += 2) extra.push({ name: `extra-${String(extra.length + 1).padStart(2, '0')}`, threads: PER_CELL * 2 - 6 })
  const projects = roster(extra)
  assert.ok(projects.reduce((n, [, list]) => n + Math.ceil(list.length / PER_CELL), 0) > room + 4, 'the roster fits the moon')
  return projects
}

/** What the allocator deals for this roster on the current world, from the current memory. */
const dealt = (colony, projects) =>
  allocateCells(
    projects.map(([id, list]) => ({ id, size: list.length })),
    new Map([...colony.plotCells].map(([k, v]) => [k, v.map((c) => ({ ...c }))])),
    { perCell: PER_CELL, blocked: colony.blockedCells }
  )

const keys = (cells) => (cells || []).map((c) => `${c.q},${c.r}`).join(' ')
const memory = (colony) => new Map([...colony.plotCells].map(([name, cells]) => [name, keys(cells)]))

/** No cell is remembered by two repos. */
function assertDisjoint(colony) {
  const owner = new Map()
  for (const [name, cells] of colony.plotCells) {
    for (const c of cells) {
      const k = `${c.q},${c.r}`
      assert.ok(!owner.has(k), `${k} is remembered by ${owner.get(k)} and ${name}`)
      owner.set(k, name)
    }
  }
}

test('forest to moon and back puts every repo on the cells it had', () => {
  const { colony, calls } = standIn()
  const projects = crowdedRoster()
  switchTo(colony, forest)
  colony._syncPlots(projects)
  const home = memory(colony)
  assert.equal([...home.values()].filter(Boolean).length, projects.length, 'the whole colony fits the forest')
  assert.deepEqual(colony.unplaced, [])
  assert.equal(calls.length, 0)

  switchTo(colony, moon)
  const onMoon = dealt(colony, projects)
  const crowded = projects.map(([n]) => n).filter((n) => !onMoon.get(n)?.length).sort()
  const moved = projects.map(([n]) => n).filter((n) => onMoon.get(n)?.length && keys(onMoon.get(n)) !== home.get(n))
  // Both kinds of repo are on the moon, or this proves nothing.
  assert.ok(crowded.length > 0, 'nothing is crowded out on the moon')
  assert.ok(moved.length > 0, 'nothing is moved on the moon')
  colony._syncPlots(projects)
  assert.deepEqual(colony.unplaced, crowded)
  assert.deepEqual(calls, [{ names: crowded, added: crowded }])
  // Nothing the moon did is remembered.
  assert.deepEqual(memory(colony), home)

  // The same roster again: the set has not changed, so nobody is told twice.
  colony._syncPlots(projects)
  assert.deepEqual(colony.unplaced, crowded)
  assert.equal(calls.length, 1)

  switchTo(colony, forest)
  colony._syncPlots(projects)
  assert.deepEqual(memory(colony), home)
  assert.deepEqual(colony.unplaced, [])
})

test('a repo that arrives on the moon never lands on a cell another remembers', () => {
  const { colony } = standIn()
  const everyone = crowdedRoster()
  switchTo(colony, forest)
  colony._syncPlots(everyone)
  const home = memory(colony)
  const owner = new Map()
  for (const [name, cells] of colony.plotCells) for (const c of cells) owner.set(`${c.q},${c.r}`, name)

  // While the colony is on the moon one repo goes quiet and a newcomer of two tiles arrives.
  // The moon is full, so it takes the room the quiet repo left, which is only somewhere a
  // crowded-out repo remembers for some choices of who goes quiet: find one, or this proves
  // nothing.
  const newcomer = ['newcomer', Array.from({ length: 2 * PER_CELL - 6 }, (_, i) => ({ id: `newcomer-${i}` }))]
  switchTo(colony, moon)
  let onMoon = null
  for (const [quiet] of everyone) {
    const projects = [newcomer, ...everyone.filter(([n]) => n !== quiet)]
    const cells = dealt(colony, projects).get('newcomer') || []
    if (cells.some((c) => (owner.get(`${c.q},${c.r}`) ?? quiet) !== quiet)) {
      onMoon = projects
      break
    }
  }
  assert.ok(onMoon, 'no newcomer was dealt a remembered cell, so this proves nothing')
  colony._syncPlots(onMoon)
  assertDisjoint(colony)
  assert.equal(colony.plotCells.get('newcomer'), undefined, 'the newcomer remembers ground another repo remembers')

  // Back to the forest, everyone showing.
  switchTo(colony, forest)
  colony._syncPlots([newcomer, ...everyone])
  assertDisjoint(colony)
  for (const [name, cells] of home) assert.equal(keys(colony.plotCells.get(name)), cells, `${name} is not back on its forest cells`)
  assert.equal(colony.plotCells.get('newcomer')?.length, 2, 'the newcomer has no ground on the forest')
})

test('a repo the moon moved holds its place there while other repos change', () => {
  const { colony } = standIn()
  const everyone = roster()
  switchTo(colony, forest)
  colony._syncPlots(everyone)
  const home = memory(colony)
  switchTo(colony, moon)
  colony._syncPlots(everyone)
  const held = new Map([...colony._placedHere.cells].map(([name, cells]) => [name, keys(cells)]))
  assert.ok(held.size > 0, 'the moon moved nobody')

  // Another repo gains or loses a tile. Dealt from memory alone, some moved repo would be
  // seeded somewhere else; find such a change, or this proves nothing.
  let changed = null
  for (const [name, list] of everyone) {
    if (held.has(name)) continue
    for (const delta of [PER_CELL, -PER_CELL]) {
      if (list.length + delta < 1) continue
      const projects = everyone.map(([n, l]) => [n, n === name ? Array.from({ length: l.length + delta }, (_, i) => ({ id: `${n}-${i}` })) : l])
      const plain = dealt(colony, projects)
      if ([...held].some(([n, cells]) => plain.get(n)?.length && keys(plain.get(n)) !== cells)) {
        changed = projects
        break
      }
    }
    if (changed) break
  }
  assert.ok(changed, 'no change to another repo would move a moved repo')
  colony._syncPlots(changed)
  for (const [name, cells] of held) {
    assert.equal(keys(colony._placedHere.cells.get(name)), cells, `${name} moved on the moon`)
    assert.equal(keys(colony.plotCells.get(name)), home.get(name), `${name}'s forest cells were overwritten`)
  }

  // A new world forgets where the moon stood them.
  switchTo(colony, forest)
  colony._syncPlots(changed)
  assert.equal(colony._placedHere.cells.size, 0)
})

test('a drop on ground another repo remembers makes that repo forget it', () => {
  const { colony } = standIn()
  const everyone = roster()
  switchTo(colony, forest)
  colony._syncPlots(everyone)
  const home = memory(colony)
  const owner = new Map()
  for (const [name, cells] of colony.plotCells) for (const c of cells) owner.set(`${c.q},${c.r}`, name)

  // On the moon only the five smallest repos are showing, so there is open ground to drop on.
  const shown = everyone.slice(-5)
  switchTo(colony, moon)
  colony._syncPlots(shown)
  const standing = new Map(shown.map(([n]) => [n, colony._placedHere.cells.get(n) ?? colony.plotCells.get(n)]))
  const taken = new Set([...standing.values()].flat().map((c) => `${c.q},${c.r}`))
  const ship = `${ceremonyCell().q},${ceremonyCell().r}`
  let target = null
  for (let q = -PLOT_RINGS; q <= PLOT_RINGS && !target; q++) {
    for (let r = -PLOT_RINGS; r <= PLOT_RINGS && !target; r++) {
      const k = `${q},${r}`
      if (ringOf({ q, r }) > PLOT_RINGS || k === ship || colony.blockedCells.has(k) || taken.has(k)) continue
      if (owner.has(k) && !standing.has(owner.get(k))) target = { q, r }
    }
  }
  assert.ok(target, 'no open moon cell is remembered by a repo off the map')
  const absent = owner.get(`${target.q},${target.r}`)
  const [dropped] = shown.find(([n]) => standing.get(n).length === 1)

  // The drag, as `settleDrag` applies it: the whole visible layout, one zone moved.
  const plan = new Map(standing)
  plan.set(dropped, [target])
  const plots = colony.plots
  colony.plots = new Map([...standing].map(([n, cells]) => [n, { cells }]))
  colony.applyLayout(plan)
  colony.plots = plots
  assert.equal(keys(colony.plotCells.get(dropped)), keys([target]))
  assert.equal(colony.plotCells.has(absent), false, `${absent} still remembers the cell ${dropped} was dropped on`)
  assertDisjoint(colony)

  // Back to the forest, everyone showing: the one who forgot is dealt afresh, nobody collides.
  switchTo(colony, forest)
  colony._syncPlots(everyone)
  assertDisjoint(colony)
  assert.equal(keys(colony.plotCells.get(dropped)), keys([target]))
  assert.equal(colony.plotCells.get(absent)?.length, home.get(absent).split(' ').length, `${absent} has no ground on the forest`)
})

test('a world where everything fits names nobody', () => {
  const { colony, calls } = standIn()
  switchTo(colony, forest)
  colony._syncPlots(roster().slice(0, 5))
  assert.deepEqual(colony.unplaced, [])
  assert.equal(calls.length, 0)
})
