/**
 * Where a villager is told to stand.
 *
 * `_workSite` is a method on `Colony`, but everything it needs is arithmetic: a building's
 * position, the zone's middle, the hex lattice and the navigation grid. So it is exercised
 * through the prototype against a hand-built grid, with no scene, no kits and no roster — the
 * same trick `astronauts.test.mjs` plays on `_updateAgent`.
 *
 * The case that matters is the pocket. Two buildings whose blocked discs overlap leave a
 * handful of open cells between them that nobody can walk into, and the old code nudged a
 * blocked site to the *nearest free* cell, which is the middle of that pocket. The villager
 * then walked at the wall for eight seconds and gave up, every poll, for the life of the thread.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Colony } from '../src/game/colony.js'
import { Navigation } from '../src/agents/navigation.js'
import { cellKey, worldToHex } from '../src/world/plots.js'

/** A building at (7, 0) with the default footprint, so `stand` is the floor, 2.35. */
const BUILDING = { mesh: { position: new THREE.Vector3(7, 0, 0), userData: { footprint: 1.2 } } }
const STAND = 2.35
/** The zone's middle, west of the building: outward is +x and the preferred spot is (9.35, 0). */
const MIDDLE = { x: 0, z: 0 }

/** The world point the ring walk would try at this many degrees off the outward angle. */
const at = (deg) => ({
  x: BUILDING.mesh.position.x + Math.cos((deg * Math.PI) / 180) * STAND,
  z: BUILDING.mesh.position.z + Math.sin((deg * Math.PI) / 180) * STAND,
})

/** The lattice cells a list of ring angles falls in — which is what "on this plot" means. */
const cellsAt = (...degs) => new Set(degs.map((d) => { const p = at(d); const c = worldToHex(p.x, p.z); return cellKey(c.q, c.r) }))

/**
 * A grid with a sealed pocket around the preferred spot: a ring of blocked ground with open
 * cells inside it, exactly the shape two neighbouring buildings leave between them.
 */
function pocketGrid(centre = at(0), inner = 0.45, outer = 1.6) {
  // Pinned to the square these cases were written on: the predicate runs per cell, and the
  // pocket is a two-metre ring around one spot either way.
  const nav = new Navigation({ half: 56 })
  nav.rebuild([], (x, z) => {
    const d = Math.hypot(x - centre.x, z - centre.z)
    return d > inner && d < outer
  })
  // The door, somewhere out in the open: everything joined to it is the walkable world.
  nav.setSeed(0, 0)
  return nav
}

const site = (nav, cellKeys) =>
  Colony.prototype._workSite.call({ nav }, { middle: MIDDLE, cellKeys }, BUILDING, 0)

const near = (v, p, what) => assert.ok(Math.hypot(v.x - p.x, v.z - p.z) < 0.4, `${what}: got ${v.x.toFixed(2)},${v.z.toFixed(2)}`)

test('a reachable spot on its own plot is left exactly where it always was', () => {
  const nav = new Navigation()
  nav.rebuild([])
  nav.setSeed(0, 0)
  const v = site(nav, cellsAt(0))
  assert.equal(v.x, 7 + STAND)
  assert.equal(v.z, 0)
})

test('the inward flip still runs first, before any walking', () => {
  const nav = new Navigation()
  nav.rebuild([])
  nav.setSeed(0, 0)
  // Outward is somebody else's ground; the inside of its own zone is not.
  const v = site(nav, cellsAt(180))
  near(v, at(180), 'pulled back inside its own plot')
})

test('a site in a sealed pocket is walked round the ring until the ground is real', () => {
  const nav = pocketGrid()
  assert.equal(nav.isBlocked(at(0).x, at(0).z), false, 'the pocket is open ground')
  assert.equal(nav.isReachable(at(0).x, at(0).z), false, 'that nobody can walk into')

  // 15° and 30° are inside the wall itself; 45° is the first spot clear of it.
  const v = site(nav, cellsAt(0, 45, -45))
  near(v, at(45), 'the first reachable notch round the ring')
  assert.equal(nav.isReachable(v.x, v.z), true)
})

test('the ring walk spends the whole ring looking for the repo’s own ground first', () => {
  const nav = pocketGrid()
  // +45 is reachable but off this plot; -45 is reachable and on it. The plot wins, because a
  // villager standing in the neighbour's yard reads as belonging to the neighbour.
  const v = site(nav, cellsAt(-45))
  near(v, at(-45), 'the reachable spot on its own plot')
})

test('and settles for anywhere reachable when the plot has nothing to offer', () => {
  const nav = pocketGrid()
  const v = site(nav, new Set(['99,99']))
  near(v, at(45), 'the first reachable notch, plot or no plot')
})

test('a building ringed all the way round falls back to the nearest reachable ground', () => {
  // The wall is outside the standing ring this time, so every notch of the walk is in the pocket.
  const nav = pocketGrid(BUILDING.mesh.position, 2.6, 4.2)
  for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
    assert.equal(nav.isReachable(at(deg).x, at(deg).z), false, `${deg}° is sealed in with the building`)
  }
  const v = site(nav, cellsAt(0))
  assert.equal(nav.isReachable(v.x, v.z), true, 'it is sent somewhere it can actually stand')
  const out = Math.hypot(v.x - BUILDING.mesh.position.x, v.z - BUILDING.mesh.position.z)
  assert.ok(out > 4.2 && out < 5, `just outside the wall, at ${out.toFixed(2)}`)
})

test('a ringed building still fans its helpers apart', () => {
  // The same sealed ring as above, where every notch of the walk fails and the fallback is all
  // there is. Scanned from the building's centre it is the same answer for everybody, and a
  // thread's helpers would stand inside one another.
  const nav = pocketGrid(BUILDING.mesh.position, 2.6, 4.2)
  const spots = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((spin) =>
    // Every side of the building is this plot's own ground, so nothing is flipped inward and
    // the four helpers differ only by the spin they were given.
    Colony.prototype._workSite.call({ nav }, { middle: MIDDLE, cellKeys: cellsAt(0, 90, 180, 270) }, BUILDING, 0, spin)
  )
  const keys = new Set(spots.map((v) => `${v.x.toFixed(2)},${v.z.toFixed(2)}`))
  assert.equal(keys.size, 4, 'four different spots')
  for (const v of spots) assert.equal(nav.isReachable(v.x, v.z), true, 'every one of them reachable')
})

test('without a grid it is the plain geometry it always was', () => {
  const v = Colony.prototype._workSite.call({ nav: null }, { middle: MIDDLE, cellKeys: cellsAt(0) }, BUILDING, 0)
  assert.equal(v.x, 7 + STAND)
})
