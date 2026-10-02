import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { NodeIO } from '@gltf-transform/core'
import { readKit } from '../tools/kit-read.mjs'
import { configureKits } from '../src/world/kit.js'
import { validateManifest } from '../src/themes/schema.js'
import { manifest } from '../src/themes/medieval/manifest.js'
import { setIslandFootprint, terrainHeight, underWater, SHORE_BAND } from '../src/world/setting.js'
import { PLOT_CELL, PLOT_RINGS, ringOf, setCeremonyCell, worldToHex } from '../src/world/plots.js'
import { Colony } from '../src/game/colony.js'
import { createWater as createPlanetWater } from '../src/world/water.js'
import {
  ANCHOR,
  APRON,
  BERTH,
  Boat,
  CLEARANCE,
  DINGHY_AT,
  DINGHY_LIFT,
  DOCK_SCALE,
  DOOR_OUT,
  FREEBOARD,
  PIER_HALF,
  PIER_OUT,
  SAIL_TIME,
  SHIP_BEAM,
  SHIP_SCALE,
  SHIP_SET,
  dinghyLift,
  shipAt,
} from '../src/themes/medieval/boat.js'
import { DOOR_HOLD, SCALE } from '../src/themes/medieval/wall.js'

const GLB = 'public/assets/medieval/medieval.glb'

/**
 * How wide an astronaut is. `AGENT_RADIUS` in `src/game/colony.js`, which is not exported —
 * a private number of the engine's, and the only thing the boat owes it is that the door
 * stands outside the disc the colony blocks with it.
 */
const AGENT_RADIUS = 0.26
/** The navigation grid is a square of this half-width. `HALF` in `src/agents/navigation.js`. */
const NAV_HALF = 56
/** The scale the harbour's parts are built at — the village's, times `DOCK_SCALE`. */
const DOCK_UNIT = SCALE * DOCK_SCALE
/** The ship's own, which is larger: it is the arrival rather than the furniture. */
const SHIP_UNIT = SCALE * SHIP_SCALE
/** Where the pier stops, in world units along the water axis from the ceremony cell. */
const PIER_HEAD = PIER_OUT + PIER_HALF

const valley = manifest.settings.find((s) => s.id === 'valley')

/**
 * A boat with no kit behind it — which is every boat for its first few frames, and the only
 * kind a test without a browser can have.
 *
 * `configureKits` points the loader at a file that is not there, so `loadKit()` rejects, the
 * constructor's own `catch` swallows it and `_build` never runs. Everything the engine
 * actually reads off a ceremony — the door, the three numbers, the voyage clock — answers
 * from the group's frame and needs no geometry at all, which is the property being checked as
 * much as it is the way the check is arranged.
 */
function makeBoat() {
  configureKits({ base: { file: 'not-a-file.glb' } }, (f) => f)
  const scene = new THREE.Scene()
  const cellPos = cellWorld(valley.ceremony.cell)
  const boat = new Boat(scene, cellPos, valley)
  return boat
}

/** Flat-top axial hex → world, at the plot lattice's own cell size. `hexToWorld` in plots.js. */
function cellWorld({ q, r }) {
  const size = 7.6
  return new THREE.Vector3(size * 1.5 * q, 0, size * Math.sqrt(3) * (r + q / 2))
}

/**
 * A point in the harbour's own frame — x seaward along the water axis, z across it — put back
 * into the world, off the group's real matrix rather than off the axis by hand.
 *
 * Everything the ship is placed by is in that frame, and everything the terrain answers is in
 * the world, so this is the join. Built once: the group never moves in x or z.
 */
let _frame = null
function local(x, z) {
  if (!_frame) {
    const boat = makeBoat()
    // The only place a test wants the drawn matrix, so the render walk is faked here rather
    // than in `makeBoat` — every other test wants the boat exactly as the colony finds it,
    // un-rendered.
    boat.group.updateMatrixWorld(true)
    _frame = boat.group.matrixWorld.clone()
    boat.dispose()
  }
  return new THREE.Vector3(x, 0, z).applyMatrix4(_frame)
}

/** Signed distance along the valley's coast axis: `d > from` is sea. */
const along = (x, z) => x * valley.coast.axis[0] + z * valley.coast.axis[1]

/**
 * Every mesh node's bounds in its own frame, off the built glb, read once.
 *
 * Simpler than `tests/castle.test.mjs`'s walk, and deliberately so: nothing the boat is made
 * of has children. The dock, the ship and the rowing boat are each one flat node.
 */
let _bounds = null
async function bounds() {
  if (_bounds) return _bounds
  const doc = await new NodeIO().read(GLB)
  _bounds = new Map()
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const into = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      const lo = pos.getMin([])
      const hi = pos.getMax([])
      into.min = into.min.map((v, i) => Math.min(v, lo[i]))
      into.max = into.max.map((v, i) => Math.max(v, hi[i]))
    }
    _bounds.set(node.getName(), into)
  }
  return _bounds
}

// ── the pack ───────────────────────────────────────────────────────────────────────────

/**
 * The hull's four corners at the berth, in the group's own frame — the ship is a box lying
 * across the pier's line, `SHIP_BEAM` either side of `BERTH` along the axis and half its
 * length either side of `SHIP_SET` across it.
 */
async function hullCorners(at = BERTH) {
  const box = (await bounds()).get('ship')
  const out = []
  for (const x of [at - SHIP_BEAM, at + SHIP_BEAM]) {
    for (const z of [SHIP_SET + box.min[2] * SHIP_UNIT, SHIP_SET + box.max[2] * SHIP_UNIT]) out.push({ x, z })
  }
  return out
}

/** Every piece the dock is made of has to be in the kit, or the valley has no way in. */
test('the dock, the ship and the rowing boat are packed', async () => {
  const k = await readKit(GLB)
  for (const name of ['building_docks_blue', 'ship', 'boat']) {
    assert.ok(k.nodes.has(name), `${name} is in the kit`)
  }
  assert.ok(!k.nodes.has('ship_red_full'), 'and the red hull went with the blue one')
})

/**
 * The hull is the pack's *neutral* ship, and which swatches it samples is the whole of that
 * choice — so it is pinned rather than left to be noticed on screen.
 *
 * Six cells: wood for the hull and mast, the sail canvas, a stone fitting at the bow, and one
 * pennant each in the faction's blue (24), the old red ship's own paint (25) and the torch's
 * flame (26). Cell 26 is the one cell in the village that burns, so the masthead pennant glows
 * after dark — accepted, and it is 36 of the hull's 1580 triangles. What this assertion is
 * actually for is the other way round: a repack that put the flame swatch across the *sails*
 * would light a bonfire in the bay and nothing else would fail.
 */
test('the ship is the pack’s neutral hull, painted from six swatches', async () => {
  const k = await readKit(GLB)
  assert.deepEqual(k.nodes.get('ship').cells, [2, 6, 21, 24, 25, 26])
})

/**
 * The dock is a plank walkway, not a hex tile, and it brings no sea of its own.
 *
 * This is the question a tile-authored pack always raises, and the answer decides whether the
 * piece has to be taken apart before it is laid on a shore that already has water — the way
 * the castle's arch is taken `solo` to leave its door leaves behind. It does not. `hex_grass`
 * is the pack's tile and spans the full 2.31 in z; this spans 0.5, which is a gangway across
 * a tile rather than the tile. The bit of it that reaches a whole unit below the planks is
 * three pilings, and they are the reason the group is turned to put local +x seaward: the
 * pack gives legs only to that half.
 *
 * (The atlas says the same. Sampled out of the glb, the sea swatches are cells 8 and 9 —
 * #62a0d0 and #257ebc — and the dock paints 2, 5, 6, 24, 29, 30 and 31: two stones, two
 * woods, the faction blue and three canvas tones. No water anywhere on it. That is not
 * asserted here because cell 24 *is* #257ebc — the faction's blue and the deep sea are one
 * swatch in this pack — so the colour proves nothing the geometry does not prove better.)
 */
test('the dock is a pier with legs, and brings no water with it', async () => {
  const k = await readKit(GLB)
  const dock = k.nodes.get('building_docks_blue')
  // One primitive, so there is no `solo` to take even if there were something to drop.
  assert.equal(dock.primitives, 1)

  const box = await bounds()
  const pier = box.get('building_docks_blue')
  const tile = box.get('hex_grass')
  assert.ok(pier.max[2] - pier.min[2] < (tile.max[2] - tile.min[2]) / 4, 'a gangway, not a tile')
  assert.ok(Math.abs(pier.max[0] - pier.min[0] - (tile.max[0] - tile.min[0])) < 1e-3, 'and a tile long')
  // The pilings reach as deep as a tile body, which is what a leg over water has to do.
  assert.ok(pier.min[1] <= tile.min[1] + 1e-3, 'the legs reach the bed')
})

/**
 * The pier's half-length is the pack's, scaled: the dock runs from -1 to +1 in model units.
 *
 * At `SCALE * DOCK_SCALE`, not `SCALE`. The harbour is built half again as big as the village
 * it serves and the villagers are not scaled with it, which is the one thing that makes the
 * pier read as a working pier from a hundred units away rather than as a toy.
 */
test('the pier is two model units of deck at the harbour scale', async () => {
  const box = await bounds()
  const pier = box.get('building_docks_blue')
  assert.equal(DOCK_SCALE, 1.5)
  // The packer welds and quantises, so a face authored at 1 comes back at 1.00001; the
  // tolerance is for that and nothing else.
  assert.ok(Math.abs(PIER_HALF - (pier.max[0] - pier.min[0]) * 0.5 * SCALE * DOCK_SCALE) < 1e-3)
  // And it is bigger than a villager-scaled one would be, which is the point of the constant.
  assert.ok(PIER_HALF > (pier.max[0] - pier.min[0]) * 0.5 * SCALE)
})

// ── the numbers the colony reads ───────────────────────────────────────────────────────

test('the ceremony exposes the contract the colony reads', () => {
  const boat = makeBoat()
  assert.equal(boat.kind, 'boat')
  assert.equal(boat.clearance, CLEARANCE)
  assert.equal(boat.apron, APRON)
  for (const method of ['door', 'update', 'ping', 'dispose']) assert.equal(typeof boat[method], 'function', method)
  assert.ok(boat.group.isObject3D)
  boat.dispose()
})

/**
 * The three radii have to agree with each other and with the pier between them, and nothing
 * else checks it: an arrival that spawns inside the navigation obstacle can never path out of
 * it, and one that spawns under the apron's edge is standing in a hay bale.
 */
test('the door clears the navigation obstacle and stays under the apron', () => {
  // A clear margin, not a hair: the obstacle is rasterised into half-metre cells and an agent
  // standing 5 cm outside a disc is an agent the grid may well have inside it.
  assert.ok(DOOR_OUT > CLEARANCE + AGENT_RADIUS + 0.3, 'arrivals stand clear of the navigation obstacle')
  assert.ok(DOOR_OUT < APRON, 'and under the apron, so nothing is planted on the threshold')
  assert.ok(APRON > PIER_OUT + PIER_HALF, 'the apron covers the whole pier')
  // The apron no longer has to reach the berth, and deliberately does not. Everything seaward
  // of the beach is bare before it is asked: `createScatter` plants nothing under
  // `water.level + SHORE_BAND`, and on this bank that floor is crossed *landward* of the
  // ceremony cell, so the disc's whole job is the dry ground behind the dock. Reaching the
  // berth would only clear more meadow. See `APRON`.
  const [ax, az] = valley.coast.axis
  const cell = cellWorld(valley.ceremony.cell)
  const groundAt = (t) => terrainHeight(cell.x + ax * t, cell.z + az * t, valley)
  assert.ok(groundAt(0) < valley.water.level + SHORE_BAND, 'the cell itself is already inside the bare band')
})

/**
 * The same rule again, measured off the built object rather than off the constants: the
 * threshold has to be landward of the cell by more than the disc the colony blocks there.
 *
 * Worth having twice. The constants say what was intended; this says what `door()` actually
 * returns after the group's `atan2` turn and its matrix, which is the number an arriving
 * villager is placed at.
 */
/**
 * The threshold stands in a *different lattice cell* from the dock, which is the whole reason
 * `Colony._blockedCells` reserves the cell under `door()` at all.
 *
 * A castle or a lander is centred on its cell and 7 units out of a 7.6-unit cell lands back
 * inside it; a pier's cell is a shore station and its threshold is a cell of its own. Pinned
 * here because the number is load-bearing in a place no rendering test reaches: get it wrong
 * and a repo is dealt the ground its neighbours' arrivals walk out of.
 */
test('the threshold stands in its own cell, one landward of the dock', () => {
  const boat = makeBoat()
  const door = boat.door()
  assert.deepEqual(worldToHex(door.x, door.z), { q: -2, r: 0 })
  assert.notDeepEqual(worldToHex(door.x, door.z), valley.ceremony.cell, 'not the dock’s own cell')

  // And this boat has never been rendered, which is the state `Colony._blockedCells` and the
  // first batch of arrivals find it in. `door()` composes the group's own transform rather
  // than reading `matrixWorld`, which three only fills in while drawing, so it is right this
  // early: the group goes straight into the scene, so its local matrix *is* its world matrix.
  const g = boat.group
  const composed = new THREE.Vector3()
    .copy(boat.doorLocal)
    .applyMatrix4(new THREE.Matrix4().compose(g.position, g.quaternion, g.scale))
  assert.equal(composed.x, door.x)
  assert.equal(composed.z, door.z)

  // And it got there without touching the scene: the matrix three would have written is still
  // the identity it was constructed with.
  assert.ok(g.matrixWorld.equals(new THREE.Matrix4()), 'door() composed no scene state')
  boat.dispose()
})

test('door() is landward of the cell by more than the blocked disc', () => {
  const boat = makeBoat()
  const cell = cellWorld(valley.ceremony.cell)
  const door = boat.door()
  const back = Math.hypot(door.x - cell.x, door.z - cell.z)
  assert.ok(back > boat.clearance + AGENT_RADIUS, `door is ${back.toFixed(2)} out, disc is ${(boat.clearance + AGENT_RADIUS).toFixed(2)}`)
  assert.ok(along(door.x, door.z) < along(cell.x, cell.z), 'and landward, not seaward')
  boat.dispose()
})

/**
 * The door is landward of the dock, on the flat top of the bank, and inside the navigation
 * grid — which the ceremony cell itself is not: the cell's x is -57.00 against a half-width
 * of 56. Where exactly is `DOOR_OUT`'s to explain; that it is walkable ground within reach of
 * the crew's own square is the contract.
 */
test('the door lands above the dock, on dry ground, inside the navigation grid', () => {
  const boat = makeBoat()
  const door = boat.door()

  const cell = cellWorld(valley.ceremony.cell)
  const [ax, az] = valley.coast.axis
  // Straight landward of the cell: the door is the cell walked back along the water axis.
  //
  // The tolerance is a five-thousandth because the manifest's axis is not quite a unit vector
  // — [-0.9848, 0.1736] is 0.999985 long, three decimal places of a bearing — and the group's
  // turn comes out of `atan2`, which normalises it. Over the door's own 7.5 that is a little
  // over a ten-thousandth of a unit and nothing anywhere cares; a real error here is a whole
  // quadrant.
  assert.ok(Math.abs(door.x - (cell.x - ax * DOOR_OUT)) < 5e-4, 'the door is landward along the axis')
  assert.ok(Math.abs(door.z - (cell.z - az * DOOR_OUT)) < 5e-4)
  assert.ok(Math.abs(door.x) <= NAV_HALF && Math.abs(door.z) <= NAV_HALF, 'inside the navigation grid')

  // And on ground a villager can stand on: not merely dry, but the colony's own flat floor,
  // which runs from about -0.3 to +0.2. A threshold down on the beach would have arrivals
  // climbing the bank before they could start walking.
  const y = terrainHeight(door.x, door.z, valley)
  assert.ok(Math.abs(y) < 0.5, `the threshold is on the colony floor (${y.toFixed(2)})`)
  assert.ok(along(door.x, door.z) < along(cell.x, cell.z), 'and landward of the dock')
  boat.dispose()
})

/**
 * The cell the manifest chose, held against the shore it was chosen for: the pier's foot on
 * the beach, its head over water, and every one of the pack's three pilings past the
 * waterline. This is the check the manifest's note is the reasoning for, and the only thing
 * that would catch the coast being re-cut under it.
 */
test('the pier stands with its foot on the beach and its head over water', () => {
  const cell = cellWorld(valley.ceremony.cell)
  const [ax, az] = valley.coast.axis
  const at = (t) => terrainHeight(cell.x + ax * t, cell.z + az * t, valley)
  const foot = PIER_OUT - PIER_HALF
  const head = PIER_OUT + PIER_HALF

  assert.ok(at(foot) > valley.water.level, 'the foot is on dry ground')
  assert.ok(at(head) < valley.water.level, 'the head is over water')
  // The pack's three pilings, at 0.11, 0.56 and 0.97 of a model unit from the dock's origin.
  // They are the reason the piece is turned the way it is, and they have to be in the sea.
  for (const piling of [0.11, 0.56, 0.97]) {
    assert.ok(at(PIER_OUT + piling * DOCK_UNIT) < valley.water.level, `the piling at ${piling} stands in water`)
  }
  // The deck is level and the bank is not, and the one place they are made to agree is the
  // foot: the planks come down on the ground exactly where they begin, so the pier neither
  // starts in mid-air nor disappears into the bank. Everything seaward of it is over a bed
  // that falls away, which is what a pier on legs is.
  const deck = valley.water.level + FREEBOARD
  assert.ok(Math.abs(deck - at(foot)) < 0.1, `the deck meets the ground at the foot (${(deck - at(foot)).toFixed(2)})`)
  assert.ok(deck > valley.water.level, 'and rides above the sea, so the pilings show')

  /**
   * Villagers cannot walk out onto the planks, which used to be the navigation obstacle's job
   * alone and is now mostly the shore's.
   *
   * `Colony._rebuildNavigation` blocks every square under `water.level + SHORE_BAND`, and on a
   * bank this gentle that floor is crossed *landward* of the ceremony cell — so the pier's own
   * foot, three units seaward of the cell, stands on ground the grid already refuses. The
   * obstacle at `CLEARANCE + AGENT_RADIUS` is margin on the dry bank behind it. Both halves
   * are asserted because either one alone would let a villager onto the beach.
   */
  let waterline = 0
  for (let lo = 0, hi = 24, i = 0; i < 60; i++) {
    waterline = (lo + hi) / 2
    if (at(waterline) > valley.water.level) lo = waterline
    else hi = waterline
  }
  let floor = 0
  for (let lo = -24, hi = waterline, i = 0; i < 60; i++) {
    floor = (lo + hi) / 2
    if (at(floor) > valley.water.level + SHORE_BAND) lo = floor
    else hi = floor
  }
  assert.ok(floor < foot, `the grid's wet floor at ${floor.toFixed(2)} is landward of the pier's foot at ${foot.toFixed(2)}`)
  assert.ok(CLEARANCE + AGENT_RADIUS > -floor, 'and the obstacle covers the dry bank back to it')
})

/**
 * The T berth: the ship lies *across* the head of the pier, a unit off the planks, rather than
 * alongside them or through them.
 *
 * Three things have to hold at once and none of them is visible in a still that catches the
 * ship at its mooring, which most stills do. The hull must not reach the pier — a ship drawn
 * through 7.8 units of planking is the one failure that reads as a bug rather than as a
 * choice; it must not stand so far off that the T comes apart; and it has to be long enough
 * across the pier's line for the shape to be a T at all.
 */
test('the ship berths across the head of the pier, clear of the planks', async () => {
  const box = (await bounds()).get('ship')
  const beam = (box.max[0] - box.min[0]) * SHIP_UNIT
  const length = (box.max[2] - box.min[2]) * SHIP_UNIT

  assert.equal(SHIP_SCALE, 4.4)
  // The tolerance is a proportion of the scale rather than a fixed distance, because what it
  // absorbs is a rounding in *model* units: the packer welds and quantises a face authored at
  // 0.502 back to 0.5018969, and `SHIP_BEAM` quotes the pack's three decimals. A world-unit
  // literal for that is a literal that has to be doubled every time the ship is.
  assert.ok(Math.abs(SHIP_BEAM - beam / 2) < 2e-4 * SHIP_UNIT, 'SHIP_BEAM is half the beam the pack authors')
  assert.ok(length > 2 * PIER_HALF, 'the ship is longer than the pier it lies across')

  // A clear unit of water between the hull and the planks, and not much more than one.
  const gap = BERTH - SHIP_BEAM - PIER_HEAD
  assert.ok(gap >= 0.8, `the hull stands ${gap.toFixed(2)} off the pier head`)
  assert.ok(gap < 2, 'and is made fast to it rather than moored out in the bay')

  // Amidships on the pier's own line, so the T has two arms of the same length.
  const arms = [SHIP_SET + box.max[2] * SHIP_UNIT, -(SHIP_SET + box.min[2] * SHIP_UNIT)]
  assert.ok(Math.abs(arms[0] - arms[1]) < 0.1, `the pier meets the ship amidships (${arms.map((a) => a.toFixed(2))})`)

  assert.ok(ANCHOR > BERTH + PIER_HALF, 'the mooring is well clear of the pier head')
  assert.ok(BERTH > PIER_HEAD, 'the berth is past the pier head, not beside the planks')
})

/**
 * Every corner of the berthed hull is over water, and so is every corner of it at the mooring.
 *
 * The ship lies across the shore now rather than along it, which puts its two ends a long way
 * from the line the berth was measured on — 6.46 either side — and the valley's ground is
 * noisy as well as sloped. A hull end aground on the beach is exactly the kind of thing a
 * still taken at the mooring would never show.
 */
test('the berthed ship floats at every corner, and so does the moored one', async () => {
  for (const [name, at] of [['berth', BERTH], ['mooring', ANCHOR]]) {
    for (const { x, z } of await hullCorners(at)) {
      const w = local(x, z)
      const ground = terrainHeight(w.x, w.z, valley)
      assert.ok(ground < valley.water.level, `the ${name} corner at (${x.toFixed(1)}, ${z.toFixed(1)}) is over water`)
    }
  }
  /**
   * And it is open water at the berth, not the last inch of the shelf.
   *
   * A unit and a quarter rather than the three this used to ask for, because the sea itself is
   * shallower: `depth` came down from 10 to 7 with the gentle bank, so the bed at the near side
   * lies 1.55 under the surface where it used to lie 5.1. That costs the picture nothing — the
   * pack authors `ship` from y 0 upward, so the hull draws nothing at all and floats
   * wherever the plane is — and what the assertion is actually for is that the near side is
   * past the slope rather than resting on it.
   */
  const mid = local(BERTH - SHIP_BEAM, SHIP_SET)
  assert.ok(terrainHeight(mid.x, mid.z, valley) < valley.water.level - 1.25, 'the near side lies in open water')
})

/**
 * The rowing boat is landward of the pier head, so the ship does not come down on top of it,
 * and still on water rather than on sand.
 *
 * It used to lie three quarters of the way out on the pier's far side, which was open water
 * while the ship moored alongside. The T berth brings a hull to within a unit of the head, and
 * a dinghy left out there would be under it twice a minute.
 */
test('the rowing boat is tied up landward of the ship’s berth', async () => {
  const dinghy = (await bounds()).get('boat')
  assert.ok(DINGHY_AT.x < PIER_HEAD, 'the dinghy is landward of the pier head')
  assert.ok(BERTH - SHIP_BEAM - DINGHY_AT.x > 2, 'and well clear of the berthed hull')

  // Its own corners, turned on its mooring, are all past the waterline.
  const turn = 0.6
  const half = { x: dinghy.max[0] * DOCK_UNIT, z: dinghy.max[2] * DOCK_UNIT }
  const reach = Math.abs(half.x * Math.cos(turn)) + Math.abs(half.z * Math.sin(turn))
  const w = local(DINGHY_AT.x - reach, DINGHY_AT.z)
  assert.ok(terrainHeight(w.x, w.z, valley) < valley.water.level, 'the dinghy floats rather than sitting on sand')

  // Beside the planks rather than under them.
  assert.ok(Math.abs(DINGHY_AT.z) > 0.25 * DOCK_UNIT + dinghy.max[0] * DOCK_UNIT, 'it lies off the pier’s edge')
})

// ── the voyage ─────────────────────────────────────────────────────────────────────────

/** Run the clock at a fixed step, as the engine does, and hand back the simulation time. */
function run(boat, seconds, from = 0, dt = 1 / 60) {
  let elapsed = from
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    elapsed += dt
    boat.update(dt, elapsed)
  }
  return elapsed
}

/**
 * The whole ceremony, on the clock: tied up at rest, out to sea when a villager comes
 * through, held off there, and back alongside exactly where it started.
 *
 * **Rest is the berth**, which is the pose that matters most: a valley nobody is looking at
 * is rendered at voyage 0, so 0 has to be a ship made fast to its own pier rather than one
 * standing eight units off it. The voyage is the event.
 *
 * "Exactly" is the other word that matters. The old gate's doors were damped and snapped to
 * zero at the tail because a damped value never arrives; this one is driven at a fixed rate
 * instead, so both ends of the run are hit on the nose — and a quiet valley has to render the
 * same pixels every time or the visual baseline is worthless.
 */
test('a ping stands the ship out to sea, holds it, and brings it back exactly alongside', () => {
  const boat = makeBoat()
  // Rest: the ship lies at the berth and stays there however long nothing happens.
  assert.equal(boat.voyage, 0)
  assert.equal(shipAt(boat.voyage), BERTH)
  let t = run(boat, 3)
  assert.equal(boat.voyage, 0)
  assert.equal(shipAt(boat.voyage), BERTH, 'a quiet valley leaves the ship tied up')

  boat.ping()
  // Half way through the run it is under way and has not arrived — and seaward of the berth,
  // which is the direction the whole thing was turned round to get right.
  t = run(boat, SAIL_TIME / 2, t)
  assert.ok(boat.voyage > 0.3 && boat.voyage < 0.7, `under way (${boat.voyage.toFixed(3)})`)
  assert.ok(shipAt(boat.voyage) > BERTH, 'it leaves the pier rather than arriving at it')
  // By the end of the sail time it is on its mooring — exactly, not nearly.
  t = run(boat, SAIL_TIME / 2 + 0.05, t)
  assert.equal(boat.voyage, 1)
  assert.equal(shipAt(boat.voyage), ANCHOR)

  // And it lies off for the hold rather than turning round the moment it gets there.
  t = run(boat, DOOR_HOLD - 0.2, t)
  assert.equal(boat.voyage, 1, 'still on its mooring through the hold')

  // Then it comes home, and lands back alongside exactly.
  t = run(boat, 0.4, t)
  assert.ok(boat.voyage < 1 && boat.voyage > 0, `under way again (${boat.voyage.toFixed(3)})`)
  t = run(boat, SAIL_TIME, t)
  assert.equal(boat.voyage, 0)
  assert.equal(shipAt(boat.voyage), BERTH)
  boat.dispose()
})

/** A second ping while the ship is out pushes the run home back rather than restarting it. */
test('a ping while the ship is out extends the visit', () => {
  const boat = makeBoat()
  boat.ping()
  let t = run(boat, SAIL_TIME + DOOR_HOLD - 0.3)
  assert.equal(boat.voyage, 1)
  boat.ping()
  t = run(boat, DOOR_HOLD, t)
  assert.equal(boat.voyage, 1, 'the hold was pushed out, not restarted from the berth')
  boat.dispose()
})

/** The clock runs whether or not the kit ever arrives — the ship is a number before it is a mesh. */
test('the voyage runs with no geometry behind it', () => {
  const boat = makeBoat()
  assert.equal(boat.ship, null)
  boat.ping()
  // Seventy-two steps of a sixtieth sum to a hair under 1.2, so the run is over by the sail
  // time to within a rounding error and exactly over on the frame after it. The clamp is what
  // makes that second number exact, and exact is what the visual baseline is diffed on.
  const t = run(boat, SAIL_TIME)
  assert.ok(1 - boat.voyage < 1e-9, `on the mooring within the sail time (${boat.voyage})`)
  run(boat, 1 / 60, t)
  assert.equal(boat.voyage, 1)
  boat.dispose()
})

// ── the manifest ───────────────────────────────────────────────────────────────────────

/**
 * The valley's `ceremony` block, held against the schema that has to accept it — the kind is
 * one the theme declares it can build, and the cell is axial integers.
 */
test("the valley's ceremony block validates against the medieval manifest", () => {
  assert.deepEqual(validateManifest(manifest), [])
  assert.deepEqual(valley.ceremony, { kind: 'boat', cell: { q: -3, r: 1 } })
  assert.ok(manifest.ceremonies.includes('boat'))

  // A kind outside the declared list, and a cell that is not a lattice cell, are both errors.
  const i = manifest.settings.findIndex((s) => s.id === 'valley')
  const bad = structuredClone(manifest)
  bad.settings[i].ceremony.kind = 'raft'
  assert.ok(validateManifest(bad).includes(`settings[${i}].ceremony.kind: "raft" is not in ceremonies`))
  const off = structuredClone(manifest)
  off.settings[i].ceremony.cell = { q: -3, r: 1.5 }
  assert.ok(validateManifest(off).includes(`settings[${i}].ceremony.cell: expected {q, r}`))
})

/** The theme builds what it declares: `boat` is dispatched, not warned about and fallen back from. */
test('the medieval theme builds a boat when the setting asks for one', async () => {
  configureKits({ base: { file: 'not-a-file.glb' } }, (f) => f)
  const { default: medieval } = await import('../src/themes/medieval/index.js')
  const scene = new THREE.Scene()
  const made = medieval.hooks.ceremony(scene, cellWorld(valley.ceremony.cell), medieval.manifest, valley)
  assert.equal(made.kind, 'boat')
  assert.equal(made.clearance, CLEARANCE)
  made.dispose()

  // And a castle for a setting that names nothing, which is the other two.
  const forest = medieval.manifest.settings.find((s) => s.id === 'forest')
  const castle = medieval.hooks.ceremony(scene, new THREE.Vector3(-22.8, 0, 13.2), medieval.manifest, forest)
  assert.equal(castle.kind, 'castle')
  castle.dispose()
})

// ── every coast ────────────────────────────────────────────────────────────────────────

/** Every village world whose arrival is a ship. */
const BOATS = manifest.settings.filter((s) => s.ceremony?.kind === 'boat')

/**
 * The ship on a setting's own dock, and the ground in its harbour's frame: `ground(x, z)` is the
 * terrain `x` seaward along the boat's own axis and `z` across it, off the group's real matrix.
 */
function harbourOn(setting) {
  configureKits({ base: { file: 'not-a-file.glb' } }, (f) => f)
  const boat = new Boat(new THREE.Scene(), cellWorld(setting.ceremony.cell ?? manifest.plots.ceremonyCell), setting)
  boat.group.updateMatrixWorld(true)
  const frame = boat.group.matrixWorld.clone()
  const ground = (x, z = 0) => {
    const w = new THREE.Vector3(x, 0, z).applyMatrix4(frame)
    return terrainHeight(w.x, w.z, setting)
  }
  return { boat, ground }
}

/**
 * The valley's harbour, asked of every coast the village moors a ship on: the door on dry ground
 * past the beach, the planks' foot on the sand, the head and the pilings in the water, the ship
 * berthed in open water and floating at every corner, and the walk in from the door dry.
 *
 * "Past the beach" is each sea's own: the valley's `coast` keeps its bank `SHORE_BAND` high, and
 * upstream's worlds without one paint their sand `shore.band` over the level — the height its
 * scatter keeps its land plants above. A colony floor at 0 over a sea at -1.6 can never be
 * `SHORE_BAND` clear of it, and does not need to be.
 */
function assertHarbour(setting, label = setting.id) {
  const { boat, ground } = harbourOn(setting)
  const level = setting.water.level
  const pierOut = setting.ceremony.pierOut ?? PIER_OUT
  const berth = setting.ceremony.berth ?? BERTH
  const door = boat.door()
  const doorY = terrainHeight(door.x, door.z, setting)
  const beach = setting.coast ? SHORE_BAND : setting.shore.band
  assert.ok(doorY > level + beach, `${label}: the door's ground ${doorY.toFixed(2)} is past the beach (${(level + beach).toFixed(2)})`)
  assert.ok(Math.abs(doorY) < 0.5, `${label}: and on the colony floor`)

  const foot = ground(pierOut - PIER_HALF)
  assert.ok(foot > level, `${label}: the pier's foot is on dry ground`)
  assert.ok(Math.abs(level + FREEBOARD - foot) <= FREEBOARD, `${label}: and the deck meets it within FREEBOARD (${(level + FREEBOARD - foot).toFixed(2)})`)
  assert.ok(ground(pierOut + PIER_HALF) < level, `${label}: the head is over water`)
  for (const piling of [0.11, 0.56, 0.97]) assert.ok(ground(pierOut + piling * DOCK_UNIT) < level, `${label}: the piling at ${piling} stands in water`)

  assert.ok(ground(berth - SHIP_BEAM, SHIP_SET) < level - 1.25, `${label}: the hull's near side lies in open water`)
  assert.ok(ground(berth) < level - 1.25, `${label}: and so does the berth`)
  return { boat, ground, level, berth, door }
}

test('a ship moors on every coast the village has', async () => {
  assert.deepEqual(BOATS.map((s) => s.id).sort(), ['beach', 'ocean', 'valley'])
  const box = (await bounds()).get('ship')
  for (const setting of BOATS) {
    // The island as a colony with nothing on show leaves it: the dock and its beach.
    if (setting.shape === 'island') setIslandFootprint([cellWorld(setting.ceremony.cell)], PLOT_CELL)
    const { boat, ground, level, berth, door } = assertHarbour(setting)
    for (const x of [berth - SHIP_BEAM, berth + SHIP_BEAM])
      for (const z of [SHIP_SET + box.min[2] * SHIP_UNIT, SHIP_SET + box.max[2] * SHIP_UNIT])
        assert.ok(ground(x, z) < level, `${setting.id}: the hull's corner at (${x.toFixed(1)}, ${z.toFixed(1)}) floats`)
    // The rowing boat moves out with the pier, so it still floats beside it.
    assert.ok(ground(DINGHY_AT.x + ((setting.ceremony.pierOut ?? PIER_OUT) - PIER_OUT) - 1.14, DINGHY_AT.z) < level, `${setting.id}: the rowing boat floats`)
    // The walk in, every half unit from the door to the middle, never wades.
    const len = Math.hypot(door.x, door.z)
    for (let s = 0; s <= len; s += 0.5) {
      const x = door.x - (door.x * s) / len
      const z = door.z - (door.z * s) / len
      assert.ok(!underWater(x, z, setting), `${setting.id}: the walk in crosses water ${s} from the door`)
    }
    boat.dispose()
  }
})

/**
 * The ships ride the swell: on every coast the village moors one, the ship's origin stands on
 * the sea's own surface (`heightAt` of upstream's water, handed over by `setSea`) frame after
 * frame, out on its voyage and back, and the rowing boat rides it its sea's `dinghyLift` proud.
 * The kit is not loaded under node, so the two hulls are stand-in nodes put where `_build` puts
 * the meshes; the arithmetic under test is `_float`'s, the only thing that moves them.
 * The group stands at the cell's ground, as `Colony._buildTerrain` sets it.
 */
test('the ship rides the sea’s own heightAt on the valley, Shoreline and Archipelago', () => {
  const ids = []
  for (const setting of BOATS) {
    if (setting.shape === 'island') setIslandFootprint([cellWorld(setting.ceremony.cell)], PLOT_CELL)
    const heightAt = (x, z) => terrainHeight(x, z, setting)
    const sea = createPlanetWater({ planet: setting, heightAt, quality: 'low' })
    const { boat } = harbourOn(setting)
    const cell = cellWorld(setting.ceremony.cell)
    boat.group.position.y = heightAt(cell.x, cell.z)
    boat.ship = new THREE.Object3D()
    boat.ship.position.z = SHIP_SET
    boat.dinghy = new THREE.Object3D()
    boat.dinghy.position.set(DINGHY_AT.x + (boat.pierOut - PIER_OUT), 0, DINGHY_AT.z)
    boat.group.add(boat.ship, boat.dinghy)
    boat.setSea((x, z, t) => sea.heightAt(x, z, t))

    const ship = new THREE.Vector3()
    const dinghy = new THREE.Vector3()
    const ys = []
    let elapsed = 3.25
    for (let frame = 0; frame < 60; frame++) {
      if (frame === 10) boat.ping()
      elapsed += 1 / 60
      boat.update(1 / 60, elapsed)
      boat.group.updateMatrixWorld(true)
      boat.ship.getWorldPosition(ship)
      boat.dinghy.getWorldPosition(dinghy)
      const surface = sea.heightAt(ship.x, ship.z, elapsed)
      assert.ok(Math.abs(ship.y - surface) < 1e-6, `${setting.id}: frame ${frame}, the ship at ${ship.y} on a sea at ${surface}`)
      const under = sea.heightAt(dinghy.x, dinghy.z, elapsed) + dinghyLift(setting.water.waveHeight)
      assert.ok(Math.abs(dinghy.y - under) < 1e-6, `${setting.id}: frame ${frame}, the rowing boat at ${dinghy.y} over ${under}`)
      ys.push(ship.y)
    }
    // And the swell is live: the ship rises and falls with it, and sailed out on the ping.
    assert.ok(Math.max(...ys) - Math.min(...ys) > 0.01, `${setting.id}: the ship moved ${(Math.max(...ys) - Math.min(...ys)).toFixed(4)}`)
    assert.ok(boat.voyage > 0, `${setting.id}: and was under way`)
    ids.push(setting.id)
    boat.dispose()
    sea.dispose()
  }
  assert.deepEqual(ids.sort(), ['beach', 'ocean', 'valley'])
})

/**
 * The rowing boat's floor stays over every sea it rides. Its floor is 0.12 over its origin and
 * its corners 1.31 out, and the swell can rise at most 1.1795 × `waveHeight` per unit, so the
 * sea can stand 1.545 × `waveHeight` over the origin under the hull: the lift has to cover what
 * of that the floor does not. The valley keeps the four hundredths it rode at before the lift
 * was sized per sea; Shoreline's and Archipelago's rougher swells lift it higher.
 */
test('the rowing boat is lifted clear of each sea’s steepest swell', () => {
  const lifts = {}
  for (const setting of BOATS) {
    const { boat } = harbourOn(setting)
    const waveHeight = setting.water.waveHeight
    assert.equal(boat.dinghyLift, dinghyLift(waveHeight))
    assert.ok(0.12 + boat.dinghyLift > 1.1795 * 1.31 * waveHeight, `${setting.id}: the floor clears a ${waveHeight} swell`)
    lifts[setting.id] = boat.dinghyLift
    boat.dispose()
  }
  assert.equal(lifts.valley, DINGHY_LIFT)
  assert.equal(DINGHY_LIFT, 0.04)
  assert.ok(lifts.valley < lifts.beach && lifts.beach < lifts.ocean, JSON.stringify(lifts))
})

/** With no sea handed over the ship bobs on its own sine about the level, as it always did. */
test('without a sea the ship bobs on its own about the level', () => {
  const { boat } = harbourOn(valley)
  boat.ship = new THREE.Object3D()
  boat.group.add(boat.ship)
  boat.setSea(null)
  boat.update(1 / 60, 2)
  assert.equal(boat.ship.position.y, valley.water.level - boat.group.position.y + Math.sin(2 * 0.9) * 0.08)
  boat.dispose()
})

test('the valley names no pier or berth of its own, so it moors exactly as it always has', () => {
  assert.equal(valley.ceremony.pierOut, undefined)
  assert.equal(valley.ceremony.berth, undefined)
  const { boat } = harbourOn(valley)
  assert.equal(boat.pierOut, PIER_OUT)
  assert.equal(boat.berth, BERTH)
  assert.equal(shipAt(1, boat.berth), ANCHOR)
  boat.dispose()
})

/**
 * The island once it has grown round a whole colony: every cell the guard leaves dealable is
 * land, and the harbour still has to be a harbour — the same pier, berth and walk in, and a
 * clear sea lane from the berth out past the last cell of the lattice, because the colony keeps
 * the wedge in front of the dock for the water (`_blockedCells`).
 */
test("Archipelago's harbour stays open with the island grown round every cell it can hold", async () => {
  const ocean = BOATS.find((s) => s.id === 'ocean')
  setCeremonyCell(ocean.ceremony.cell)
  const { boat } = harbourOn(ocean)
  const blocked = Colony.prototype._blockedCells.call({ setting: ocean, theme: { manifest }, ceremony: boat })
  boat.dispose()
  const lattice = []
  for (let q = -PLOT_RINGS; q <= PLOT_RINGS; q++)
    for (let r = -PLOT_RINGS; r <= PLOT_RINGS; r++) if (ringOf({ q, r }) <= PLOT_RINGS && !blocked.has(`${q},${r}`)) lattice.push({ q, r })
  assert.ok(lattice.length > 30, `${lattice.length} cells dealable`)
  setIslandFootprint([...lattice, ocean.ceremony.cell].map(cellWorld), PLOT_CELL)
  const { ground, level, berth, door } = assertHarbour(ocean, 'ocean grown')
  const box = (await bounds()).get('ship')
  for (const x of [berth - SHIP_BEAM, berth + SHIP_BEAM])
    for (const z of [SHIP_SET + box.min[2] * SHIP_UNIT, SHIP_SET + box.max[2] * SHIP_UNIT]) assert.ok(ground(x, z) < level, `the hull's corner at (${x.toFixed(1)}, ${z.toFixed(1)}) floats`)
  // The lane out: from the berth to forty units past the furthest cell, on the pier's line and
  // the ship's, all of it sea.
  const dock = cellWorld(ocean.ceremony.cell)
  const d = Math.hypot(dock.x, dock.z)
  const out = Math.max(...lattice.map((c) => { const p = cellWorld(c); return (p.x * dock.x + p.z * dock.z) / d })) - d + 40
  for (const across of [0, SHIP_SET]) for (let t = berth; t <= out; t += 0.5) assert.ok(ground(t, across) < level, `the lane runs aground ${t.toFixed(1)} out`)
  const len = Math.hypot(door.x, door.z)
  for (let s = 0; s <= len; s += 0.5) assert.ok(!underWater(door.x - (door.x * s) / len, door.z - (door.z * s) / len, ocean), `the walk in crosses water ${s} from the door`)
})
