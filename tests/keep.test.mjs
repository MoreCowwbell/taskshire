import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { NodeIO } from '@gltf-transform/core'
import { readKit } from '../tools/kit-read.mjs'
import { configureKits, loadKit, part } from '../src/world/kit.js'
import { validateManifest } from '../src/themes/schema.js'
import { manifest } from '../src/themes/medieval/manifest.js'
import { SCALE, WALL_STEP, placePart } from '../src/themes/medieval/wall.js'
import {
  BANNER_BAND,
  BANNER_BEAT,
  BANNER_OUT,
  BANNER_SWAY,
  BANNER_TALL,
  BANNER_Y,
  DOOR_OUT,
  KEEP_HALF_X,
  KEEP_HALF_Z,
  Keep,
  TOWER_GAP,
  TRAFFIC_DECAY,
  TRAFFIC_MAX,
  apronFor,
  bannerLift,
  clearanceFor,
  faceUnder,
  rearBlockFor,
  towerOutFor,
  towerRearFor,
} from '../src/themes/medieval/keep.js'
import { SMALL, STYLE as CASTLE, STYLES as CASTLE_SIZES } from '../src/themes/medieval/castle.js'
import { STYLE as FORTRESS } from '../src/themes/medieval/fortress.js'

const GLB = 'public/assets/medieval/medieval.glb'

/**
 * How wide an astronaut is. `AGENT_RADIUS` in `src/game/colony.js`, which is not exported —
 * it is a private number of the engine's, and the only thing a keep owes it is that the door
 * stands outside the disc the colony blocks with it.
 */
const AGENT_RADIUS = 0.26

/** Every style: the castle at its two sizes, and the fortress. */
const STYLES = [CASTLE, SMALL, FORTRESS]

/**
 * Every node's bounds in its own frame, *including its children* — which is what `part()`
 * bakes. The towers' caps and the cannon's turret are children, so a bounds read that stopped
 * at the node itself would measure a tower with no roof on it.
 */
let _bounds = null
async function bounds() {
  if (_bounds) return _bounds
  const doc = await new NodeIO().read(GLB)
  _bounds = new Map()
  const walk = (node, ox, oy, oz, into) => {
    const [tx, ty, tz] = node.getTranslation()
    const x = ox + tx
    const y = oy + ty
    const z = oz + tz
    const mesh = node.getMesh()
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')
        const min = pos.getMin([])
        const max = pos.getMax([])
        into.min = into.min.map((v, i) => Math.min(v, [x, y, z][i] + min[i]))
        into.max = into.max.map((v, i) => Math.max(v, [x, y, z][i] + max[i]))
      }
    }
    for (const kid of node.listChildren()) walk(kid, x, y, z, into)
  }
  for (const node of doc.getRoot().listNodes()) {
    if (node.getParentNode?.()) continue
    const into = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    walk(node, 0, 0, 0, into)
    if (Number.isFinite(into.min[0])) _bounds.set(node.getName(), into)
  }
  return _bounds
}

/**
 * One node's geometry the way `part()` hands it over: its own mesh and its children's, each
 * child's translation baked in, in the node's own model units.
 *
 * Only `faceUnder` needs it — everything else in this file works off bounds — but it has to
 * be the whole piece, because what the banner hangs on is the shaft and what the bounding box
 * reaches is the cap.
 */
async function geometryOf(name) {
  const doc = await new NodeIO().read(GLB)
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name)
  const out = []
  const walk = (n, ox, oy, oz) => {
    const [tx, ty, tz] = n.getTranslation()
    const x = ox + tx
    const y = oy + ty
    const z = oz + tz
    const mesh = n.getMesh()
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')
        for (let i = 0; i < pos.getCount(); i++) {
          const v = pos.getElement(i, [])
          out.push(v[0] + x, v[1] + y, v[2] + z)
        }
      }
    }
    for (const kid of n.listChildren()) walk(kid, x, y, z)
  }
  walk(node, 0, 0, 0)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3))
  return geo
}

/**
 * A keep with no kit behind it — which is every keep for its first few frames, and the only
 * kind a test without a browser can have.
 *
 * `configureKits` points the loader at a file that is not there, so `loadKit()` rejects, the
 * constructor's own `catch` swallows it and `_build` never runs. Everything the engine reads
 * off a ceremony — the door and the two radii — answers from the style and the group's frame
 * and needs no geometry at all, which is the property being checked as much as it is the way
 * the check is arranged.
 */
function makeKeep(style, position = new THREE.Vector3(-22.8, 0, 13.16)) {
  configureKits({ base: { file: 'not-a-file.glb' } }, (f) => f)
  const scene = new THREE.Scene()
  const keep = new Keep(scene, position, style)
  return keep
}

/**
 * A keep with the real kit behind it, built the way the browser builds it.
 *
 * Everything above this line asks what the pack authored, and gltf-transform answers that
 * without a renderer. The banners are a different question — where a *mesh* ended up after
 * `_build` placed it — and the only honest way to ask it is to run `_build`. So three's
 * GLTFLoader is given the four browser globals `node --test` has not got, exactly as
 * `tests/surfaces.test.mjs` does and for the same reasons: `fetch` over a local path (node's
 * own has no file scheme), `ProgressEvent`, `self`, and a `document` whose `<img>` reports a
 * successful decode and holds no pixels. Nothing here looks at a texture.
 *
 * All four go back in `after()`. The tests that want an *empty* keep still get one whichever
 * order they run in, because `configureKits` (`src/world/kit.js`) both empties every kit's
 * `parts` map and drops the promise `loadKit` had cached: `makeKeep`'s own `configureKits`
 * call therefore leaves nothing of the real kit behind for a later keep to build out of, and
 * the fresh `loadKit()` its constructor makes is a first attempt on the missing file rather
 * than the settled medieval promise handed back again.
 */
let loaded = null
const invented = []
let realFetch = null
function withKit() {
  if (loaded) return loaded
  if (!('ProgressEvent' in globalThis)) {
    globalThis.ProgressEvent = class ProgressEvent {
      constructor(type, init) {
        Object.assign(this, { type }, init)
      }
    }
    invented.push('ProgressEvent')
  }
  if (!('self' in globalThis)) {
    globalThis.self = globalThis
    invented.push('self')
  }
  if (!('document' in globalThis)) {
    globalThis.document = { createElementNS: () => fakeImage() }
    invented.push('document')
  }
  realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const name = String(url?.url ?? url)
    if (!name.startsWith('file-under-test:')) return realFetch(url)
    const bytes = await readFile(name.slice('file-under-test:'.length))
    return new Response(bytes, { status: 200, headers: { 'Content-Length': String(bytes.byteLength) } })
  }
  configureKits({ base: { file: 'medieval.glb' } }, () => `file-under-test:${GLB}`)
  loaded = loadKit()
  return loaded
}

after(() => {
  if (realFetch) globalThis.fetch = realFetch
  for (const name of invented) delete globalThis[name]
})

/** An `<img>` that reports a successful decode the moment it is given a source. */
function fakeImage() {
  const listeners = {}
  return {
    width: 1,
    height: 1,
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    removeEventListener: () => {},
    set src(value) {
      this._src = value
      queueMicrotask(() => (listeners.load || []).forEach((fn) => fn({ target: this })))
    },
    get src() {
      return this._src
    },
  }
}

/** A fully built keep: the kit in, `_build` run, the banners hung. */
async function builtKeep(style) {
  await withKit()
  const keep = new Keep(new THREE.Scene(), new THREE.Vector3(-22.8, 0, 13.16), style)
  // `_build` runs off the loader's promise, which has already settled — one turn of the
  // microtask queue is all it is waiting on.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return keep
}

// ── the pack ───────────────────────────────────────────────────────────────────────────

/** Every piece either style names has to be in the kit, or a village comes up with no keep. */
test('every piece of both keeps is packed', async () => {
  const k = await readKit(GLB)
  for (const style of STYLES) {
    for (const node of [style.keep, style.tower, style.banner, style.plinth]) {
      if (node) assert.ok(k.nodes.has(node), `${node} is in the kit`)
    }
  }
  // The two kinds are two buildings, not one in two paints: nothing but the keep mesh itself
  // is shared between them.
  assert.notEqual(CASTLE.tower, FORTRESS.tower)
  assert.ok(FORTRESS.plinth && !CASTLE.plinth, 'only the fortress stands its towers on plinths')
})

/**
 * The keep's half-width and half-depth are literals in `keep.js`, because `clearance` and
 * `apron` have to answer before the kit has loaded. This is the only thing holding them to
 * the pack they were measured off, and every number in both styles is built on them.
 */
test('the keep constants are the keep the pack actually ships', async () => {
  const boxes = await bounds()
  for (const style of STYLES) {
    const box = boxes.get(style.keep)
    assert.ok(Math.abs(box.max[0] - KEEP_HALF_X) < 1e-3, `${style.keep} is ${KEEP_HALF_X} to the flank`)
    assert.ok(Math.abs(box.min[0] + KEEP_HALF_X) < 1e-3, 'and symmetric about its own centre')
    assert.ok(Math.abs(box.max[2] - KEEP_HALF_Z) < 1e-3, `${style.keep} is ${KEEP_HALF_Z} deep`)
    assert.ok(Math.abs(box.min[2] + KEEP_HALF_Z) < 1e-3)
  }
  // Both kinds are the same mesh in two paints, which is what lets one pair of numbers serve
  // both styles.
  const green = boxes.get(CASTLE.keep)
  const blue = boxes.get(FORTRESS.keep)
  assert.deepEqual(green.min, blue.min)
  assert.deepEqual(green.max, blue.max)
})

// ── the shape ──────────────────────────────────────────────────────────────────────────

/**
 * A tower stands free of the keep's flank by a quarter of a wall unit — the whole of
 * `towerOut`, re-derived from the glb rather than taken on trust.
 *
 * This is the number that makes the building read as a keep with towers rather than as one
 * lump: too little and the silhouettes merge from the map camera, too much and they stop
 * being the same building. Nothing else checks it, and the pack moving under it is the one
 * way it can go wrong.
 */
test('the towers clear the keep’s flanks by a quarter of a wall unit', async () => {
  const boxes = await bounds()
  for (const style of STYLES) {
    const tower = boxes.get(style.tower)
    assert.ok(Math.abs(style.towerOut - towerOutFor(style, tower.max[0])) < 0.01, `${style.kind}: towerOut is measured`)

    // And the same again as the gap it actually leaves: the tower's near edge against the
    // keep's flank, both at their own scales.
    const keepFlank = KEEP_HALF_X * style.keepScale
    const towerNear = style.towerOut + tower.min[0] * style.towerScale
    assert.ok(Math.abs(towerNear - keepFlank - TOWER_GAP) < 0.01, `${style.kind}: the gap is ${TOWER_GAP}`)
  }
})

/**
 * The towers stand on the keep's *rear* flanks: nothing reaches forward of the keep's own
 * front face, so the whole approach — the face, the threshold and the ground the arrivals
 * appear on — is open, and nothing stands between them and the camera.
 *
 * At the back the three pieces finish level, within a hundredth of a model unit, which is what
 * `towerBack` is chosen for.
 */
test('the towers stand on the keep’s rear flanks and finish level with it', async () => {
  const boxes = await bounds()
  for (const style of STYLES) {
    const tower = boxes.get(style.tower)
    const keepFront = KEEP_HALF_Z * style.keepScale
    const keepBack = -keepFront
    const towerFront = style.towerBack + tower.max[2] * style.towerScale
    const towerBack = style.towerBack + tower.min[2] * style.towerScale
    assert.ok(towerFront < keepFront, `${style.kind}: no tower reaches forward of the keep`)
    assert.ok(Math.abs(towerBack - keepBack) < 0.02, `${style.kind}: the backs finish level`)
  }
})

/**
 * The keep overtops its own towers, which is what makes it the keep.
 *
 * The margin is deliberately different between the two — the forest's towers are about half
 * the keep's height and the mountain's, carried up on plinths, nearly all of it — and that
 * difference is the thing that makes the two arrivals read as different buildings rather than
 * as one recoloured.
 */
test('the keep overtops its towers, and by different margins', async () => {
  const boxes = await bounds()
  const ratio = (style) => {
    const tower = boxes.get(style.tower).max[1]
    const lift = style.plinth ? boxes.get(style.plinth).max[1] : 0
    return ((tower + lift) * style.towerScale) / (boxes.get(style.keep).max[1] * style.keepScale)
  }
  for (const style of STYLES) assert.ok(ratio(style) < 1, `${style.kind}: the keep is the tallest thing`)
  assert.ok(ratio(FORTRESS) - ratio(CASTLE) > 0.25, 'the two silhouettes are not the same building')
})

/**
 * The plinth is the tower's own footprint, so it needs no offset of its own and the tower
 * stands squarely on it rather than overhanging.
 *
 * `keep.js` reads the lift off the geometry rather than writing it down, which is what lets a
 * style name any base in the pack; this is the check that the base it does name is one a tower
 * can stand on.
 */
test('the fortress’s plinth carries its tower squarely', async () => {
  const boxes = await bounds()
  const plinth = boxes.get(FORTRESS.plinth)
  const tower = boxes.get(FORTRESS.tower)
  for (const axis of [0, 2]) {
    assert.ok(plinth.min[axis] <= tower.min[axis] + 1e-3, `the plinth is at least as wide on ${axis}`)
    assert.ok(plinth.max[axis] >= tower.max[axis] - 1e-3)
  }
  assert.ok(plinth.min[1] > -1e-3, 'it stands on the ground it is placed at')
  assert.ok(plinth.max[1] > 1, 'and lifts the tower by a storey')
})

/**
 * A banner hangs flat on the stone that is actually behind it — which is not the stone its
 * tower's bounding box reaches.
 *
 * This is the whole reason `faceUnder` exists. Every tower in the pack is a hexagonal prism
 * carrying a door, a parapet, a cap and sometimes a gun, so the box runs to 0.58 or 0.69 while
 * the shaft the cloth covers stops at 0.44. The gatehouse hung its banners off an absolute
 * that matched a box, and they floated the difference; on these two towers that would have
 * been up to 1.09 world units of blue rectangle standing in mid-air.
 */
test('each banner hangs on the stone actually behind it, not off the bounding box', async () => {
  const boxes = await bounds()
  for (const style of STYLES) {
    const geo = await geometryOf(style.tower)
    const banner = boxes.get(style.banner)
    const face = faceUnder(geo, BANNER_Y, BANNER_Y + BANNER_TALL)

    // The measurement is doing work: the shaft under the banner is well short of the box.
    geo.computeBoundingBox()
    assert.ok(face < geo.boundingBox.max.z - 0.1, `${style.kind}: the box overstates the face`)

    // And the banner lands on it — outside the stone, and against it rather than in mid-air.
    const gap = BANNER_OUT + banner.min[2]
    assert.ok(gap > 0, `${style.kind}: the banner hangs outside the wall`)
    assert.ok(gap * style.towerScale * SCALE < 0.1, 'and flat against it')

    // The cloth is no wider than the strip of shaft that was measured for it, and hangs on
    // the tower's own centre line, which is the facet that faces the road.
    assert.ok(banner.max[0] <= BANNER_BAND, 'the sampled band covers the cloth')
    assert.ok(Math.abs(banner.max[0] + banner.min[0]) < 1e-3, 'the banner is centred on its own origin')

    // On the tower rather than under it, and clear of whatever carries it.
    assert.ok(BANNER_Y > 0.4, 'the banner is up the tower, not at its foot')
    assert.ok(Math.abs(banner.max[1] - BANNER_TALL) < 1e-3, 'the banner is the height the constant says')
    assert.ok(BANNER_Y + banner.max[1] < boxes.get(style.tower).max[1], 'and stops short of the parapet')
  }
})

// ── the banners move ───────────────────────────────────────────────────────────────────

/**
 * The lift never goes negative, which is the whole reason the sine is folded rather than
 * taken raw: negative is the cloth inside the tower, and it hangs two centimetres off the
 * stone, so there is no slack to absorb it.
 *
 * Swept over a couple of beats and the whole range of traffic a `ping` can bank, because the
 * failure would be a sign, and a sign is wrong everywhere or nowhere.
 */
test('a banner is never lifted into its own tower', () => {
  const peak = BANNER_SWAY * 2
  for (const traffic of [0, 0.25, 1, 1.5, TRAFFIC_MAX]) {
    for (let step = 0; step < 400; step++) {
      const elapsed = step * 0.0157
      for (const i of [0, 1]) {
        const lift = bannerLift(traffic, elapsed, i)
        assert.ok(lift >= 0, `lift ${lift} at traffic ${traffic}, t ${elapsed}, banner ${i}`)
        assert.ok(lift <= peak + 1e-12, 'and never past twice the sway, which is what the cap buys')
      }
    }
  }
  // Traffic does raise it: the same instant, busy, is further off the wall.
  const t = 0.4
  assert.ok(bannerLift(1, t, 0) > bannerLift(0, t, 0), 'a village coming through stirs the cloth')
  assert.equal(bannerLift(TRAFFIC_MAX, t, 0), bannerLift(1, t, 0), 'and past 1 the beat is already full')
})

/**
 * At the trough the banner is *exactly* flat, not nearly — the rest pose the pack authored,
 * to the bit. A quiet keep is what the two forest baselines are rendered in, and a lift of
 * 1e-17 is a rotation matrix, which is a different float, which is a different pixel.
 */
test('the trough is the pack’s own rest pose, to the bit', () => {
  for (const i of [0, 1]) {
    // Where the beat's argument lands on 3π/2, which is where the sine is −1.
    const elapsed = ((3 * Math.PI) / 2 - i * 1.7) / BANNER_BEAT
    assert.equal(bannerLift(0, elapsed, i), 0, `banner ${i} hangs flat at the trough`)
    assert.equal(bannerLift(TRAFFIC_MAX, elapsed, i), 0, 'and traffic cannot lift it off the trough')
  }
  // The two towers are not in step, which is what the phase is for.
  const elapsed = ((3 * Math.PI) / 2) / BANNER_BEAT
  assert.ok(bannerLift(0, elapsed, 1) > 0.01, 'the other banner is mid-beat while this one is flat')
})

/**
 * The traffic count is the gate's, and the part that matters is the bottom of it: it reaches
 * exactly 0 rather than decaying toward it, so a keep nobody has used for a couple of seconds
 * renders identically every run. The top matters too — `TRAFFIC_MAX` is what stops a busy
 * morning leaving the cloth streaming.
 */
test('traffic tops up on a ping and falls back to exactly nothing', () => {
  const keep = makeKeep(CASTLE)
  assert.equal(keep.traffic, 0)
  keep.ping()
  assert.equal(keep.traffic, 1, 'one villager through the door is one')

  // Two seconds of frames. 1.5 a second against a count of 1 clears it in two thirds of that.
  for (let step = 0; step < 120; step++) keep.update(1 / 60, step / 60, false)
  assert.equal(keep.traffic, 0, 'and it lands on zero rather than approaching it')

  // The cap, which is four pings' worth of arrivals in one frame.
  for (let n = 0; n < 4; n++) keep.ping()
  assert.equal(keep.traffic, TRAFFIC_MAX, 'a rush banks no more than the cap')
  keep.update(1, 1, false)
  assert.equal(keep.traffic, TRAFFIC_MAX - TRAFFIC_DECAY, 'and bleeds away at the gate’s rate')
  keep.dispose()
})

/**
 * Which way the cloth swings, checked with three's own maths rather than by hand — it is the
 * one thing in this feature that is a coin toss on paper and a banner through a tower if it
 * lands wrong.
 *
 * Local +z is inward: the group is turned so the keep's face looks back at the colony, the
 * road runs out of the front, and `faceUnder` measured the stone the banner hangs on as the
 * furthest +z vertex of the shaft. So the hem has to swing to +z.
 */
test('a lifted banner swings out over the road, not into the stone', () => {
  const h = BANNER_TALL * SCALE
  for (const lift of [0.02, BANNER_SWAY, BANNER_SWAY * 2]) {
    const hem = new THREE.Vector3(0, -h, 0).applyEuler(new THREE.Euler(-lift, 0, 0))
    assert.ok(hem.z > 0, `a lift of ${lift} carries the hem out to +z, toward the colony`)
    assert.ok(hem.y > -h, 'and up, because a cloth that lifts gets shorter against the wall')
    assert.ok(Math.abs(hem.length() - h) < 1e-9, 'the rod holds: the cloth turns, it does not stretch')
  }
  // And at rest it hangs straight down the wall.
  const rest = new THREE.Vector3(0, -h, 0).applyEuler(new THREE.Euler(-0, 0, 0))
  assert.equal(rest.z, 0)
})

/**
 * The built keep: two banners, hung rather than baked, in exactly the place `placePart` used
 * to bake them.
 *
 * This is the check the change is really about. Unbaking a piece means rebuilding its offset
 * out of a mesh transform and a shifted origin, and the way that goes wrong is quietly — half
 * a banner's height up or down the tower reads as a design choice rather than as a bug. So the
 * reference is a call to `placePart` itself on the same part, and the two boxes have to agree
 * to a micrometre.
 */
test('each banner is hung where the baked one stood', async () => {
  for (const style of STYLES) {
    const keep = await builtKeep(style)
    const hung = keep.group.children.filter((o) => o.name === 'banner')
    assert.equal(hung.length, 2, `${style.kind}: a banner on each tower`)
    assert.ok(hung.every((m, n) => m === keep.banners[n]), 'and `banners` is what the frame loop turns')

    // The two measurements `_build` takes off the geometry, taken again the same way.
    const towerUnit = SCALE * style.towerScale
    const face = faceUnder(part(style.tower), BANNER_Y, BANNER_Y + BANNER_TALL)
    let plinth = 0
    if (style.plinth) {
      const geo = part(style.plinth)
      geo.computeBoundingBox()
      plinth = geo.boundingBox.max.y
    }

    const sides = [-1, 1]
    for (let i = 0; i < 2; i++) {
      const mesh = hung[i]

      // The origin is the rod at the cloth's top edge, not the hem it was authored from —
      // which is what makes `rotation.x` a banner lifting rather than a banner sweeping.
      mesh.geometry.computeBoundingBox()
      const own = mesh.geometry.boundingBox
      assert.ok(Math.abs(own.max.y) < 1e-6, `${style.kind}: the cloth hangs from the mesh's own origin`)
      assert.ok(Math.abs(own.min.y + BANNER_TALL * towerUnit) < 1e-6, 'its whole height below it')

      // And the pose, against `placePart` itself — called, not restated. A hand-written copy of
      // its arithmetic would go on agreeing with a banner that had drifted if the copy drifted
      // with it, so the reference is the function the old build actually went through, handed
      // the same part and the same `at`. `part()` cuts a fresh geometry each call, so this one
      // is nobody else's, and the group it is placed in is never added to a scene: it exists to
      // hold the mesh while its box is read.
      const reference = placePart(
        new THREE.Group(),
        keep.material,
        part(style.banner),
        {
          x: sides[i] * style.towerOut,
          y: (plinth + BANNER_Y) * style.towerScale,
          z: style.towerBack + (face + BANNER_OUT) * style.towerScale,
        },
        towerUnit
      )
      reference.geometry.computeBoundingBox()
      // `placePart` bakes the offset into the geometry and leaves the mesh at its group's
      // origin, so both boxes are read in the keep's own frame: the baked one straight off the
      // geometry, the hung one off its geometry plus the `position` that replaced the bake.
      const baked = reference.geometry.boundingBox
      const got = own.clone().translate(mesh.position)
      for (const axis of ['x', 'y', 'z']) {
        assert.ok(Math.abs(got.min[axis] - baked.min[axis]) < 1e-6, `${style.kind}: banner ${i} ${axis} min`)
        assert.ok(Math.abs(got.max[axis] - baked.max[axis]) < 1e-6, `${style.kind}: banner ${i} ${axis} max`)
      }

      // Still flat on the stone `faceUnder` found, on the far side of it.
      const stone = (style.towerBack + face * style.towerScale) * SCALE
      assert.ok(got.min.z > stone, `${style.kind}: banner ${i} hangs outside the shaft`)
      assert.ok(got.min.z - stone < 0.1, 'and against it rather than in mid-air')
    }

    // A quiet keep leaves them alone; a busy one does not.
    keep.update(1 / 60, ((3 * Math.PI) / 2) / BANNER_BEAT, false)
    // `=== 0` rather than `assert.equal`, which parts −0 from 0. The negation in `update` hands
    // back −0 at the trough and three builds the identity out of either.
    assert.ok(hung[0].rotation.x === 0, `${style.kind}: flat at the trough, to the bit`)
    keep.ping()
    keep.update(1 / 60, 0.4, false)
    assert.ok(hung[0].rotation.x < 0, 'and lifted off the wall once the village is moving')
    keep.dispose()
  }
})

// ── the rear tower ─────────────────────────────────────────────────────────────────────

/**
 * The mountain's third cannon tower stands directly behind the keep, its own gap behind the
 * keep's back face, and it is the fortress's alone — the forest's castle keeps its two.
 *
 * `towerRear` is a measurement like `towerOut` and this re-derives it from the glb, which is the
 * whole check on it: the only way it can go wrong is the pack changing under it. The face the
 * measurement is taken from is the tower's own *-z* extent, because the piece is turned to point
 * its cannon away from the keep.
 */
test('the fortress’s rear tower keeps the flanks’ own gap behind the keep', async () => {
  const boxes = await bounds()
  const tower = boxes.get(FORTRESS.tower)

  assert.equal(CASTLE.towerRear, undefined, 'the forest keeps its two towers')
  assert.ok(
    Math.abs(FORTRESS.towerRear + towerRearFor(FORTRESS, -tower.min[2])) < 0.01,
    `towerRear is measured, got ${FORTRESS.towerRear}`
  )

  // And the same again as the gap it actually leaves: the keep's back face against the turned
  // tower's near face, both at their own scales.
  const keepBack = -KEEP_HALF_Z * FORTRESS.keepScale
  const towerNear = FORTRESS.towerRear - tower.min[2] * FORTRESS.towerScale
  assert.ok(Math.abs(keepBack - towerNear - TOWER_GAP) < 0.01, `the gap is ${TOWER_GAP}`)

  // The reason it needs a navigation disc of its own: the one the colony puts at the ceremony
  // cell does not reach it, and `clearance` cannot be grown to — it would swallow the door.
  const nearEdge = Math.abs(towerNear) * SCALE
  assert.ok(
    nearEdge > clearanceFor(FORTRESS) + AGENT_RADIUS,
    `the clearance disc stops at ${clearanceFor(FORTRESS) + AGENT_RADIUS} and the tower starts at ${nearEdge}`
  )
  assert.ok(DOOR_OUT < clearanceFor(FORTRESS) + AGENT_RADIUS + 2, 'and the door is on the other side of the keep')
})

/**
 * The disc the colony fences the rear tower off with: one circle about the tower's own origin,
 * big enough to hold its far corner, placed in world space without a matrix.
 *
 * Computed in the constructor rather than after the build, because the colony asks for
 * navigation before the kit has landed — the same reason `clearance` and `apron` are literals
 * and derivations rather than bounds reads.
 */
test('the rear tower is fenced off, and only the fortress has one', async () => {
  const boxes = await bounds()
  const at = new THREE.Vector3(-22.8, 0, 0)
  const yaw = Math.PI / 2

  assert.deepEqual(rearBlockFor(CASTLE, at, yaw), [], 'a style with no rear tower blocks nothing')

  const blocks = rearBlockFor(FORTRESS, at, yaw)
  assert.equal(blocks.length, 1)
  const [block] = blocks
  // Local -z is away from the colony; at this yaw that is world -x.
  assert.ok(Math.abs(block.x - (at.x + FORTRESS.towerRear * SCALE)) < 1e-6, `at ${block.x}`)
  assert.ok(Math.abs(block.z - at.z) < 1e-6)

  // It holds the whole piece: the far corner of a tower on a plinth, about that origin.
  const tower = boxes.get(FORTRESS.tower)
  const unit = FORTRESS.towerScale * SCALE
  const far = Math.hypot(tower.max[2] * unit, tower.max[0] * unit)
  assert.ok(block.r >= far - 1e-6, `the disc is ${block.r} and the far corner ${far}`)
})

/**
 * A style that declares a rear tower and forgets to measure its disc is still fenced off.
 *
 * This is the one failure in the whole hook that would be *silent*. `towerRearBlock * towerScale
 * * SCALE` on a missing field is `NaN`; `Navigation` squares the radius and compares, every
 * comparison against `NaN` is false, and the tower would become a piece of stone the crew walks
 * straight through — with the mesh still standing there and nothing anywhere reporting it. So the
 * radius falls back to what the style's own offsets already carry, and the bound it lands on is
 * the real one: the fortress's own far corner, which is what the disc is for.
 */
test('a rear tower with no measured disc is still fenced off', async () => {
  const boxes = await bounds()
  const { towerRearBlock, ...unmeasured } = FORTRESS
  assert.equal(towerRearBlock, 0.75, 'the fortress does measure one — this is the style without it')

  const [block] = rearBlockFor(unmeasured, new THREE.Vector3(-22.8, 0, 0), Math.PI / 2)
  assert.ok(Number.isFinite(block.r) && block.r > 0, `a finite disc, got ${block.r}`)

  const tower = boxes.get(FORTRESS.tower)
  const unit = FORTRESS.towerScale * SCALE
  const far = Math.hypot(tower.max[2] * unit, tower.max[0] * unit)
  assert.ok(block.r >= far - 1e-6, `the fallback holds the piece: ${block.r} against ${far}`)
  // And it is a bound rather than a measurement, so it is never the tighter of the two: the
  // literal is what `fortress.js` should carry and this is only what stops a forgotten one
  // opening a hole.
  const measured = rearBlockFor(FORTRESS, new THREE.Vector3(-22.8, 0, 0), Math.PI / 2)[0].r
  assert.ok(block.r >= measured - 1e-6, `the fallback errs generous: ${block.r} against ${measured}`)
})

/**
 * The built fortress: three plinths and three towers against the castle's bare two, and the rear
 * gun pointing out over the mountain rather than into the back of the keep.
 *
 * The half turn is the thing worth measuring rather than reasoning about. The pack authors the
 * cannon along +z — the barrel reaches 0.545 against the turret's 0.315 — and the keep's +z
 * faces the colony, so an unturned rear tower aims its gun at the building in front of it.
 * Turned, what the pack put at +z is at -z, which is what these two bounds say.
 */
test('the rear tower is turned so its cannon points away from the keep', async () => {
  const boxes = await bounds()
  const tower = boxes.get(FORTRESS.tower)
  const unit = FORTRESS.towerScale * SCALE
  const origin = FORTRESS.towerRear * SCALE

  const fortress = await builtKeep(FORTRESS)
  const built = (keep) => keep.group.children.filter((o) => o.name !== 'banner').length
  assert.equal(built(fortress), 7, 'keep, three plinths, three towers')
  assert.equal(fortress.group.children.filter((o) => o.name === 'banner').length, 2, 'and still two banners')

  const rear = fortress.group.children.find((o) => o.name === 'rear-tower')
  assert.ok(rear, 'the rear tower is named so it can be found')
  rear.geometry.computeBoundingBox()
  const box = rear.geometry.boundingBox
  assert.ok(Math.abs(box.min.z - (origin - tower.max[2] * unit)) < 1e-3, `the barrel is at ${box.min.z}`)
  assert.ok(Math.abs(box.max.z - (origin - tower.min[2] * unit)) < 1e-3, `and its back at ${box.max.z}`)

  const castle = await builtKeep(CASTLE)
  assert.equal(built(castle), 3, 'the forest gets a keep and two towers')
  assert.equal(castle.group.children.find((o) => o.name === 'rear-tower'), undefined)
})

// ── the numbers the colony reads ───────────────────────────────────────────────────────

test('both ceremonies expose the contract the colony reads', () => {
  for (const style of STYLES) {
    const keep = makeKeep(style)
    assert.equal(keep.kind, style.kind)
    assert.equal(keep.clearance, clearanceFor(style))
    assert.equal(keep.apron, apronFor(style))
    for (const method of ['door', 'update', 'ping', 'dispose']) assert.equal(typeof keep[method], 'function', method)
    assert.ok(keep.group.isObject3D)
    // A keep has nothing that opens, so neither of these may throw or need a clock.
    keep.ping()
    keep.update(1 / 60, 3, false)
    keep.dispose()
  }
})

/**
 * The clearance holds the keep front to back and the door stands outside the disc the colony
 * blocks with it — which is the one that cannot be got wrong quietly: an arrival inside that
 * obstacle can never path out of it, so it comes through and stands there for good.
 *
 * The margin is the boat's rule, 0.3 past `clearance + AGENT_RADIUS`, and for the boat's
 * reason: the obstacle is rasterised into half-metre cells and an agent standing five
 * centimetres outside a disc is an agent the grid may well have inside it.
 */
test('the clearance holds the keep’s depth and the door clears it', () => {
  for (const style of STYLES) {
    const clearance = clearanceFor(style)
    assert.ok(clearance >= KEEP_HALF_Z * style.keepScale * SCALE, `${style.kind}: the clearance holds the keep`)
    assert.ok(DOOR_OUT > clearance + AGENT_RADIUS + 0.3, `${style.kind}: arrivals stand clear of the obstacle`)
    assert.ok(DOOR_OUT < apronFor(style), 'and under the apron, so nothing is planted on the threshold')
    // In front of the keep's own face, which is where arrivals have to appear.
    assert.ok(DOOR_OUT > KEEP_HALF_Z * style.keepScale * SCALE + 1, `${style.kind}: and out in front of the wall`)
  }
  // The threshold stays inside the ceremony's own cell, whatever bearing it is turned to: the
  // lattice is 7.6-unit hexagons, so the nearest cell boundary is 6.58 out.
  assert.ok(DOOR_OUT < (7.6 * Math.sqrt(3)) / 2, 'the threshold is in the cell the allocator reserved')
})

/**
 * The apron covers the whole building and a wall unit past it, or the forest's rim scatter
 * grows through a tower.
 */
test('the apron covers the outer tower and a wall unit past it', async () => {
  const boxes = await bounds()
  for (const style of STYLES) {
    const tower = boxes.get(style.tower)
    const far = (style.towerOut + tower.max[0] * style.towerScale) * SCALE
    const apron = apronFor(style)
    assert.ok(apron > far, `${style.kind}: apron ${apron.toFixed(2)} covers the ${far.toFixed(2)} the towers reach`)
    assert.ok(Math.abs(apron - far - WALL_STEP * SCALE) < 0.05, 'by exactly one wall unit')
    // And the keep itself, which is narrower than the towers are far out.
    assert.ok(apron > KEEP_HALF_X * style.keepScale * SCALE)
  }
})

/**
 * `door()` answers in world space, turned by the group's own `atan2`, and it is the number an
 * arriving villager is actually placed at. The constants say what was intended; this says
 * what came out.
 *
 * The keep here has never been rendered — `makeKeep` adds it to a scene and stops — which is
 * the state the colony and the first batch of arrivals actually find it in.
 */
test('door() lands in front of the keep, on the road back into the village', () => {
  const at = new THREE.Vector3(-22.8, 0, 13.16)
  for (const style of STYLES) {
    const keep = makeKeep(style, at)
    const door = keep.door()
    const out = Math.hypot(door.x - at.x, door.z - at.z)
    assert.ok(Math.abs(out - DOOR_OUT) < 1e-6, `${style.kind}: the threshold is DOOR_OUT from the cell`)
    assert.ok(out > keep.clearance + AGENT_RADIUS, 'outside the disc the colony blocks')
    // Toward the middle of the colony rather than away from it: the door is the cell walked
    // back along its own bearing from the origin.
    assert.ok(Math.hypot(door.x, door.z) < Math.hypot(at.x, at.z), 'and inward, not out into the trees')

    // And it is right *before* any render walk: `door()` composes the group's own transform
    // rather than reading `matrixWorld`, which three only fills in while drawing. Both the
    // colony (reserving the cell under the threshold) and the first batch of arrivals ask this
    // early, and the group goes straight into the scene, so its local matrix *is* its world
    // matrix.
    const g = keep.group
    const composed = new THREE.Vector3()
      .copy(keep.doorLocal)
      .applyMatrix4(new THREE.Matrix4().compose(g.position, g.quaternion, g.scale))
    assert.ok(Math.abs(composed.x - door.x) < 1e-6, `${style.kind}: the composed threshold is the drawn one`)
    assert.ok(Math.abs(composed.z - door.z) < 1e-6)

    // And it got there without touching the scene: the matrix three would have written is
    // still the identity it was constructed with.
    assert.ok(g.matrixWorld.equals(new THREE.Matrix4()), `${style.kind}: door() composed no scene state`)
    keep.dispose()
  }
})

// ── the manifest ───────────────────────────────────────────────────────────────────────

/**
 * The two settings' `ceremony` blocks, held against the schema that has to accept them — each
 * kind is one the theme declares it can build, and neither moves off the default cell.
 */
test('the forest and the mountain name their own keeps', () => {
  assert.deepEqual(validateManifest(manifest), [])
  const forest = manifest.settings.find((s) => s.id === 'forest')
  const mountain = manifest.settings.find((s) => s.id === 'mountain')
  assert.deepEqual(forest.ceremony, { kind: 'castle' })
  assert.deepEqual(mountain.ceremony, { kind: 'fortress' })
  assert.deepEqual(manifest.ceremonies, ['castle', 'fortress', 'boat'])
  // No cell of their own: both take `plots.ceremonyCell`, where the castle has always stood.
  assert.deepEqual(manifest.plots.ceremonyCell, { q: -2, r: 1 })

  // A kind outside the declared list is an error rather than a silent fall back to the castle.
  const i = manifest.settings.findIndex((s) => s.id === 'forest')
  const bad = structuredClone(manifest)
  bad.settings[i].ceremony.kind = 'donjon'
  assert.ok(validateManifest(bad).includes(`settings[${i}].ceremony.kind: "donjon" is not in ceremonies`))
})

/**
 * The castle's two sizes. `standard` is the forest's keep, untouched; `small` is the same green
 * keep and towers a size down, and every number of it is re-derived from the glb by the shape
 * tests above, which run over it like any other style.
 */
test('the castle comes in a standard and a small size', () => {
  assert.deepEqual(Object.keys(CASTLE_SIZES), ['standard', 'small'])
  assert.equal(CASTLE_SIZES.standard, CASTLE)
  assert.equal(CASTLE_SIZES.small, SMALL)
  assert.deepEqual(CASTLE, {
    kind: 'castle',
    keep: 'building_castle_green',
    tower: 'building_tower_B_green',
    banner: 'banner_green_full',
    keepScale: 1.6,
    towerScale: 1.3,
    towerOut: 2.86,
    towerBack: -0.9,
    banners: true,
  })
  assert.deepEqual(SMALL, { ...CASTLE, keepScale: 1.1, towerScale: 0.9, towerOut: 2.13, towerBack: -0.62 })
  assert.ok(DOOR_OUT - (clearanceFor(SMALL) + AGENT_RADIUS) >= 0.3, 'the door clears the small keep')
  assert.deepEqual(manifest.ceremonySizes, { castle: ['standard', 'small'], fortress: ['grand'] })
})

/** A size is one the theme builds that kind in, and a boat's pier numbers are positive. */
test('the schema holds a ceremony size to its kind', () => {
  const forest = manifest.settings.findIndex((s) => s.id === 'forest')
  const valley = manifest.settings.findIndex((s) => s.id === 'valley')
  const errors = (i, extra) => {
    // A new block, not the shared one: the worlds dressed by the default share one object.
    const m = structuredClone(manifest)
    m.settings[i].ceremony = { ...m.settings[i].ceremony, ...extra }
    return validateManifest(m)
  }
  const at = (i) => `settings[${i}].ceremony`
  assert.deepEqual(errors(forest, { size: 'small' }), [])
  assert.deepEqual(errors(forest, { kind: 'fortress', size: 'grand' }), [])
  assert.deepEqual(errors(forest, { kind: 'fortress', size: 'small' }), [`${at(forest)}.size: "small" is not a size of fortress`])
  assert.deepEqual(errors(forest, { kind: 'castle', size: 'huge' }), [`${at(forest)}.size: "huge" is not a size of castle`])
  assert.deepEqual(errors(valley, { size: 'standard' }), [`${at(valley)}.size: "boat" comes in no sizes`])
  assert.deepEqual(errors(valley, { pierOut: 4, berth: 9 }), [])
  for (const bad of [0, -1, Number.NaN, '4'])
    for (const key of ['pierOut', 'berth'])
      assert.deepEqual(errors(valley, { [key]: bad }), [`${at(valley)}.${key}: expected a finite number above 0`], `${key} ${String(bad)}`)
  // The sizes themselves: only kinds the theme builds, each a list of names.
  assert.ok(validateManifest({ ...manifest, ceremonySizes: { raft: ['small'] } }).includes('ceremonySizes.raft: "raft" is not in ceremonies'))
  assert.ok(validateManifest({ ...manifest, ceremonySizes: { castle: [] } }).includes('ceremonySizes.castle: expected a non-empty array of names'))
})

/** The theme builds what it declares: both kinds are dispatched, neither falls back. */
test('the medieval theme builds the keep each setting asks for', async () => {
  configureKits({ base: { file: 'not-a-file.glb' } }, (f) => f)
  const { default: medieval } = await import('../src/themes/medieval/index.js')
  const scene = new THREE.Scene()
  for (const id of ['forest', 'mountain']) {
    const setting = medieval.manifest.settings.find((s) => s.id === id)
    const made = medieval.hooks.ceremony(scene, new THREE.Vector3(-22.8, 0, 13.16), medieval.manifest, setting)
    assert.equal(made.kind, setting.ceremony.kind)
    made.dispose()
  }
  // And a castle for a setting that names nothing at all, which is what the default is for.
  const made = medieval.hooks.ceremony(scene, new THREE.Vector3(-22.8, 0, 13.16), medieval.manifest, { id: 'nowhere' })
  assert.equal(made.kind, 'castle')
  assert.equal(made.clearance, clearanceFor(CASTLE), 'at the standard size')
  made.dispose()
  // The small castle when a setting asks for it.
  const small = medieval.hooks.ceremony(scene, new THREE.Vector3(-22.8, 0, 13.16), medieval.manifest, {
    id: 'nowhere',
    ceremony: { kind: 'castle', size: 'small' },
  })
  assert.equal(small.kind, 'castle')
  assert.equal(small.clearance, clearanceFor(SMALL))
  assert.equal(small.apron, apronFor(SMALL))
  small.dispose()
})
