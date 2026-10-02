import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_HALF, MAX_EXPANSIONS, NAV_CELL, NAV_MARGIN, Navigation, SLIDE_MIN_FRACTION, slideCounts } from '../src/agents/navigation.js'
import { latticeReach } from '../src/world/plots.js'

/**
 * The ground's own veto on the navigation grid.
 *
 * Obstacles are circles, and a coastline is not one: it is a half-plane that runs clean across
 * the crew's square. So `rebuild` takes a second argument — a predicate over world points —
 * and the two kinds of blocking have to compose rather than replace each other. No three here;
 * `Navigation` is plain typed arrays and arithmetic, which is why it can be tested at all.
 */

/** The half-plane a coast is, in the abstract: everything past `x = 10` is water. */
const sea = (x) => x > 10

test('rebuild with no predicate is exactly what it always was', () => {
  const nav = new Navigation({ half: 56 })
  nav.rebuild([{ x: 0, z: 0, r: 2 }])
  assert.equal(nav.isBlocked(0, 0), true, 'the obstacle')
  assert.equal(nav.isBlocked(20, 20), false, 'and nothing else')
  // Out past the square is blocked by the bounds, as it always was.
  assert.equal(nav.isBlocked(80, 0), true)
})

test('the predicate blocks its own cells, on top of the obstacles', () => {
  const nav = new Navigation()
  nav.rebuild([{ x: -20, z: 0, r: 3 }], (x) => sea(x))

  assert.equal(nav.isBlocked(-20, 0), true, 'the circle still blocks')
  assert.equal(nav.isBlocked(30, 5), true, 'and so does the sea')
  assert.equal(nav.isBlocked(11, -40), true, 'the whole half-plane, not a disc of it')
  assert.equal(nav.isBlocked(0, 0), false, 'the dry middle is open')
  assert.equal(nav.isBlocked(9, 20), false, 'right up to the shoreline')
})

/**
 * `nearestFree` is what a goal on blocked ground resolves to, and what walks an agent out of
 * one. A villager standing in the shallows has to be handed dry land, not the next wet cell
 * along — so the search must see the predicate's cells exactly as it sees a building's.
 */
test('nearestFree skips the predicate’s cells and lands on dry ground', () => {
  const nav = new Navigation()
  nav.rebuild([], (x) => sea(x))

  // In the shallows, which is where a villager actually ends up: handed back over the
  // shoreline rather than to the next wet cell along.
  const free = nav.nearestFree(14, 0)
  assert.ok(free, 'there is somewhere to stand')
  assert.ok(nav.toWorld(free.ix) <= 10, `landed at x=${nav.toWorld(free.ix)}`)
  assert.equal(nav.blocked[free.iz * nav.size + free.ix], 0)

  // Far out to sea it gives up, as it does inside any obstacle wider than its 24 half-cell
  // rings — twelve units of reach. That is the existing contract and the predicate does not
  // change it; what keeps it from mattering is that nothing is ever *placed* out there.
  assert.equal(nav.nearestFree(30, 0), null)

  // A point already on dry ground is handed back unmoved.
  const dry = nav.nearestFree(-4, 6)
  assert.equal(nav.toWorld(dry.ix), nav.toWorld(nav.toCell(-4)))
  assert.equal(nav.toWorld(dry.iz), nav.toWorld(nav.toCell(6)))
})

/** And a route never crosses the water: A* reads the same bitmap the predicate wrote. */
test('a path from one side of a blocked band to the other goes round it', () => {
  const nav = new Navigation()
  // A wall rather than a coast this time, so there *is* a way round: blocked between z 8 and
  // 12 for every x under 20, open past it.
  nav.rebuild([], (x, z) => z > 8 && z < 12 && x < 20)
  const path = nav.findPath(0, 0, 0, 20)
  assert.ok(path, 'there is a route')
  for (const p of path) assert.equal(nav.isBlocked(p.x, p.z), false, `waypoint at ${p.x},${p.z}`)
  // It had to come round the open end, so it cannot be the straight shot.
  assert.ok(path.length > 1, 'not a straight line through the wall')
  assert.ok(path.some((p) => p.x >= 20), 'round the end of the wall')
})

/**
 * Walking at a wall versus sliding along one.
 *
 * The axis retries in `slide` used to report success on *any* movement at all, so a villager
 * pressed square into a wall — a step of (1e-4, 0.3) against a wall on z — crept 1e-4 along x
 * and was told it had walked. `agent.blocked` stayed clear, so the eight-second escape in
 * `_step` never fired and the villager shouldered the wall until the 45-second fallback.
 *
 * The test is relative, not absolute: `_walk` scales its step down as the goal nears, so the
 * same angle has to give the same answer at any scale.
 */
test('slideCounts measures the move against the step, not against a ruler', () => {
  assert.equal(slideCounts(1, 0, 1, 0), true, 'a head-on step is all of itself')
  assert.equal(slideCounts(0, 0, 0, 0), true, 'no step asked for is no step refused')
  assert.equal(slideCounts(0.001, 0.03, 0.001, 0), false, 'square into the wall')
  assert.equal(slideCounts(0.02, 0.02, 0.02, 0), true, 'cos 45° is well over the floor')

  // The same two angles at sub-millimetre scale: 0.316 of the step and 0.243 of it. An
  // absolute floor would refuse both, which is every arriving villager.
  assert.equal(slideCounts(1e-4, 3e-4, 1e-4, 0), true)
  assert.equal(slideCounts(1e-4, 4e-4, 1e-4, 0), false)

  assert.equal(slideCounts(1, 1, 1, 0, 0.8), false, 'the fraction is the caller’s to raise')
  assert.equal(SLIDE_MIN_FRACTION, 0.3)
})

test('a step into a wall is refused outright; a shallow one still slides', () => {
  const wall = () => {
    const nav = new Navigation()
    nav.rebuild([], (x, z) => z > 5)
    return nav
  }

  // Square on: a micron of x against a third of a metre of z is walking at the wall.
  let nav = wall()
  let pos = { x: 0, z: 4.9 }
  assert.equal(nav.slide(pos, 1e-4, 0.3), false)
  assert.deepEqual(pos, { x: 0, z: 4.9 }, 'and it did not creep')

  // Forty-five degrees on: that is a slide, and x carries it.
  nav = wall()
  pos = { x: 0, z: 4.9 }
  assert.equal(nav.slide(pos, 0.3, 0.3), true)
  assert.equal(pos.x, 0.3)
  assert.equal(pos.z, 4.9, 'z is the blocked axis')

  // Straight at it with no sideways component at all: nothing to slide on.
  nav = wall()
  pos = { x: 0, z: 4.9 }
  assert.equal(nav.slide(pos, 0, 0.3), false)
  assert.deepEqual(pos, { x: 0, z: 4.9 })

  // Straight along it: the head-on branch, untouched.
  nav = wall()
  pos = { x: 0, z: 4.9 }
  assert.equal(nav.slide(pos, 0.3, 0), true)
  assert.equal(pos.x, 0.3)
  assert.equal(pos.z, 4.9)

  // An agent a wall landed on top of still walks itself out, and still reports a refusal.
  nav = wall()
  pos = { x: 0, z: 6 }
  assert.equal(nav.slide(pos, 1e-4, 0.3), false)
  assert.ok(pos.z < 6, `walked out towards the free ground, at z=${pos.z}`)
})

test('layout moves only when a rebuild changes which cells are blocked', () => {
  const nav = new Navigation()
  const houses = [{ x: 0, z: 0, r: 2 }]
  nav.rebuild(houses)
  const first = nav.layout
  assert.equal(first, 1, 'the first grid with anything on it is a new layout')

  nav.rebuild(houses)
  nav.rebuild([{ x: 0, z: 0, r: 2 }])
  assert.equal(nav.layout, first, 'a poll that rebuilds the same ground changes nothing')
  assert.equal(nav.version, 3, 'while version still counts every rebuild')

  nav.rebuild([...houses, { x: 10, z: 10, r: 1 }])
  assert.equal(nav.layout, first + 1, 'a new building is new ground')
  nav.rebuild(houses)
  assert.equal(nav.layout, first + 2, 'and so is one coming down')
})

/** A ring of posts around (20, 0), too tight to pass between: open ground nobody can walk to. */
function pocket() {
  const nav = new Navigation({ half: 56 })
  const ring = []
  for (let a = 0; a < 64; a++) ring.push({ x: 20 + 4 * Math.cos((a / 64) * 2 * Math.PI), z: 4 * Math.sin((a / 64) * 2 * Math.PI), r: 0.6 })
  // The wall in the middle is there so the straight shot fails and the search actually runs.
  nav.rebuild([...ring, { x: 0, z: 0, r: 3 }])
  return nav
}

test('findPath says whether a null path means no way through or a search cut short', () => {
  const nav = pocket()
  // The map is what knows a pocket from a long way round, so the door has to be planted first.
  nav.setSeed(-10, 0)

  assert.notEqual(nav.findPath(-10, 0, 10, 10), null)
  assert.equal(nav.lastSearch, 'found')

  assert.equal(nav.findPath(-10, 0, 20, 0), null, 'the middle of the ring')
  assert.equal(nav.lastSearch, 'unreachable', 'is walled off')

  assert.notEqual(nav.findPath(-10, 0, 10, 0), null, 'round the wall, by search')
  assert.equal(nav.findPath(-10, 0, 10, 0, 5), null, 'the same reachable goal with no budget')
  assert.equal(nav.lastSearch, 'cut', 'is not proof of a wall')
})

/**
 * The reachability map: what the colony asks *before* it sends anybody anywhere.
 *
 * The pocket inside the ring is the whole point. Every cell in it is open, `nearestFree` hands
 * them back without hesitation, and a villager sent to one presses the wall for eight seconds
 * and gives up — which is what the whole of this branch is about.
 */
test('the flood fill marks the walkable world and leaves the sealed pockets out', () => {
  const nav = pocket()
  nav.setSeed(-10, 0)

  assert.equal(nav.isReachable(-10, 0), true, 'the ground the door stands on')
  assert.equal(nav.isReachable(10, 10), true, 'and everything joined to it')
  assert.equal(nav.isReachable(20, 0), false, 'the middle of the ring is open and unreachable')
  assert.equal(nav.isBlocked(20, 0), false, 'open, to be clear')
  assert.equal(nav.isReachable(0, 0), false, 'a blocked cell is not somewhere to stand either')
  assert.equal(nav.isReachable(80, 0), false, 'nor is anywhere off the grid')
})

test('a blocked seed falls back to the nearest ground somebody can stand on', () => {
  const nav = new Navigation()
  nav.rebuild([{ x: 0, z: 0, r: 3 }])
  // Dead centre of the obstacle, which is where a castle's own threshold sits.
  nav.setSeed(0, 0)
  assert.equal(nav.isReachable(10, 10), true, 'the world outside it is still the world')
  assert.ok(nav.reachSeed >= 0, 'and the map was filled rather than abandoned')
})

test('the fill is redone when the ground or the door moves, and not otherwise', () => {
  const nav = pocket()
  nav.setSeed(-10, 0)
  const filled = nav.reachLayout
  const seed = nav.reachSeed

  nav.setSeed(-10, 0)
  assert.equal(nav.reachLayout, filled, 'the same door on the same ground is the same answer')
  nav.setSeed(-9.8, 0)
  assert.equal(nav.reachSeed, seed, 'a door that has not left its half-metre cell has not moved')

  nav.setSeed(12, 12)
  assert.notEqual(nav.reachSeed, seed, 'a door on another cell is another fill')
  nav.rebuild([])
  nav.setSeed(12, 12)
  assert.equal(nav.reachLayout, nav.layout, 'and so is ground that changed underneath it')
  assert.equal(nav.isReachable(20, 0), true, 'the ring came down; the pocket is the world again')
})

test('a door that is itself walled in is a wrong seed, not a small world', () => {
  const nav = pocket()
  // Inside the ring: the fill would cover a couple of hundred cells and call the rest of the
  // colony unreachable, which strands every villager and switches off the doorway retries.
  nav.setSeed(20, 0)
  assert.equal(nav.reachSeed, -1, 'the fill is thrown away')
  assert.equal(nav.isReachable(10, 10), true, 'and the grid answers as it did before the map')
  assert.equal(nav.isReachable(20, 0), true)
})

test('a seed with no ground at all leaves no stale fill behind', () => {
  const nav = pocket()
  nav.setSeed(-10, 0)
  assert.ok(nav.reachSeed >= 0)

  // Every cell blocked: there is nowhere to plant the door.
  nav.rebuild([], () => true)
  nav.setSeed(-10, 0)
  assert.equal(nav.reachSeed, -1)

  // The ground comes back and nobody has re-seeded yet. A fill kept from the old grid would
  // still be answering here; falling back to the grid itself cannot be wrong, only vaguer.
  nav.rebuild([])
  assert.equal(nav.isReachable(20, 0), true)
})

test('nearestReachable walks past open ground it could never get to', () => {
  const nav = pocket()
  nav.setSeed(-10, 0)

  // Standing inside the pocket: the nearest *free* cell is the pocket itself, and the nearest
  // reachable one is outside the ring. That difference is the bug this branch is named for.
  const free = nav.nearestFree(20, 0)
  assert.equal(nav.reachable[free.iz * nav.size + free.ix], 0)
  const out = nav.nearestReachable(20, 0)
  assert.ok(out, 'there is somewhere to send it')
  assert.equal(nav.reachable[out.iz * nav.size + out.ix], 1)
  assert.ok(Math.hypot(nav.toWorld(out.ix) - 20, nav.toWorld(out.iz)) > 4, 'outside the ring')

  // And on ordinary ground it is the ground itself, exactly as `nearestFree` would answer.
  const here = nav.nearestReachable(10, 10)
  assert.deepEqual(here, nav.nearestFree(10, 10))
})

test('an unseeded grid is the grid it always was', () => {
  const nav = pocket()
  assert.equal(nav.isReachable(20, 0), true, 'every open cell counts until a door is planted')
  assert.equal(nav.isReachable(0, 0), false, 'except the blocked ones')
  assert.deepEqual(nav.nearestReachable(20, 0), nav.nearestFree(20, 0))
  // And `findPath` falls back to the search alone, which cannot tell a pocket from a long walk.
  assert.equal(nav.findPath(-10, 0, 20, 0), null)
  assert.equal(nav.lastSearch, 'cut')
})

/**
 * The square has to cover every tile the allocator can hand out.
 *
 * It covered ±56 — about ring four — while the pool runs to ring eleven, so a villager on an
 * outer zone had a work site on ground the grid called solid rock: unreachable, unroutable, and
 * hunted for by a backstop that could never find anything out there.
 *
 * The extent is derived rather than guessed, and this is the join that holds the derivation to
 * the constant. `Navigation` imports nothing on purpose — it is why its tables can be held in
 * `node --test` at all — so the number lives there and the arithmetic lives here.
 */
test('the default square covers the whole lattice, and fits on the ground', () => {
  assert.equal(DEFAULT_HALF, Math.ceil((latticeReach() + NAV_MARGIN) / NAV_CELL) * NAV_CELL)
  assert.ok(DEFAULT_HALF >= latticeReach() + NAV_MARGIN, 'with the walking margin outside it')
  assert.ok(DEFAULT_HALF <= 170, 'and inside the 340 the ground plane is')
})

test('a grid at the default size routes out to the edge of the lattice', () => {
  const nav = new Navigation()
  assert.equal(nav.size, Math.ceil((DEFAULT_HALF * 2) / NAV_CELL))
  nav.rebuild([{ x: 0, z: 0, r: 3 }])
  // The furthest cell centre a zone can be dealt: ring eleven, straight down the z axis.
  const far = Math.sqrt(3) * 7.6 * 11
  assert.equal(nav.isBlocked(0, far), false, 'the outermost tile is walkable ground')
  const path = nav.findPath(0, -10, 0, far)
  assert.ok(path, 'and there is a way to it')
})

test('a grid can still be built at the old size, for the tables that were written on one', () => {
  const small = new Navigation({ half: 56 })
  assert.equal(small.half, 56)
  assert.equal(small.isBlocked(80, 0), true, 'out past the square')
})

/**
 * The ground's veto, rasterised once.
 *
 * The per-cell predicate is the expensive half of a rebuild — a coastal setting spends 3.5 ms
 * of it on the old square and would spend 37 on the new one, every poll and every time the
 * scatter is rebuilt. It is also a pure function of the setting: the sea cannot move without
 * the season or the theme moving, and either rebuilds the terrain anyway. So it is cached
 * against a key, and a rebuild starts from the mask instead of from zero.
 */
test('the ground mask is rasterised once per key and composes with the obstacles', () => {
  const nav = new Navigation({ half: 56 })
  let calls = 0
  const veto = (x) => {
    calls++
    return x > 10
  }

  assert.equal(nav.setGround(veto, 'valley'), true, 'the first mask is built')
  const first = calls
  assert.ok(first > 0)
  assert.equal(nav.setGround(veto, 'valley'), false, 'the same setting is the same answer')
  assert.equal(calls, first, 'and costs nothing')

  nav.rebuild([{ x: -20, z: 0, r: 3 }])
  assert.equal(nav.isBlocked(30, 5), true, 'the mask is in the grid without being passed again')
  assert.equal(nav.isBlocked(-20, 0), true, 'and the obstacles are on top of it')
  assert.equal(nav.isBlocked(0, 0), false)

  // A rebuild does not re-evaluate the predicate; only a new key does.
  const afterRebuild = calls
  nav.rebuild([])
  assert.equal(calls, afterRebuild)
  assert.equal(nav.setGround(veto, 'alpine'), true, 'another setting is another mask')
})

test('a rebuild predicate still composes on top of the mask', () => {
  const nav = new Navigation({ half: 56 })
  nav.setGround((x) => x > 10, 'valley')
  nav.rebuild([], (x, z) => z > 10)
  assert.equal(nav.isBlocked(20, 0), true, 'the mask')
  assert.equal(nav.isBlocked(0, 20), true, 'and the caller’s own predicate')
  assert.equal(nav.isBlocked(0, 0), false)
})

test('clearing the mask is what a dry setting does', () => {
  const nav = new Navigation({ half: 56 })
  nav.setGround((x) => x > 10, 'valley')
  nav.setGround(null, 'moon')
  nav.rebuild([])
  assert.equal(nav.isBlocked(30, 0), false, 'the sea went with the setting')
})

/**
 * What a search costs, and who is allowed to spend it.
 *
 * A ring-eleven arrival is a three-hundred-cell path: measured at 14,110–19,486 expansions
 * across a colony's worth of scatter, against a cap of 6,000 that cut every one of them short.
 * The cap goes up, and because six of those in one frame would be a visible hitch, the frame
 * shares an allowance — which needs the searches to say what they spent.
 */
test('findPath reports what the search spent', () => {
  const nav = new Navigation({ half: 56 })
  nav.rebuild([{ x: 0, z: 0, r: 3 }])

  nav.findPath(-10, 0, -9, 0)
  assert.equal(nav.lastExpansions, 0, 'a straight shot is not a search')

  // Round the obstacle: line of sight fails, so A* runs and spends something.
  const path = nav.findPath(-10, 0, 10, 0)
  assert.ok(path, 'there is a way round')
  assert.ok(nav.lastExpansions > 0, 'and it cost expansions')

  // A cap under what the search needs is a cut, and the spend is what it was allowed.
  const spent = nav.lastExpansions
  assert.equal(nav.findPath(-10, 0, 10, 0, 5), null)
  assert.equal(nav.lastSearch, 'cut')
  assert.ok(nav.lastExpansions <= 6 && nav.lastExpansions < spent, `spent ${nav.lastExpansions}`)
})

test('the cap has room for a route across the whole lattice', () => {
  assert.equal(MAX_EXPANSIONS, 24000)
})
