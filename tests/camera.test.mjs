import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

// The rig binds its pointer listeners on `window` and reads app settings, which read
// localStorage; under Node both are stand-ins, in place before the modules load. Nothing is
// stored, so every setting is its default — the fov the app starts with among them.
const noop = () => {}
globalThis.window ??= { addEventListener: noop, removeEventListener: noop }
globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop }

const { Settings } = await import('../src/core/settings.js')
const { CameraRig } = await import('../src/core/camera.js')
const { CURVE_FULL, bendPoint, setCurveView } = await import('../src/core/curve.js')
const { PLOT_CELL, PLOT_RINGS, hexToWorld, ringOf } = await import('../src/world/plots.js')
const { Colony } = await import('../src/game/colony.js')

/**
 * Picking under the world curve: a click lands on the ground drawn under the cursor, not on the
 * flat plane the bend has pulled it away from, and a click on the sky above the bent horizon
 * lands on nothing.
 *
 * The real rig at its rest pose (azimuth π/4, 56° from overhead, 62 out, the app's fov) over a
 * 1280×800 canvas. The curve is driven as `main.js` drives it, `setCurveView(rig.target,
 * rig.azimuth, worldCurve × CURVE_FULL)`, at the default 0.45. A point on the ground is bent by
 * `bendPoint` (the CPU twin of the shader's `bcBend`), projected to its pixel, and the pixel
 * handed back to `groundPoint`: it has to come back as the same point.
 */

const W = 1280
const H = 800
const CURVE = 0.45
const TOL = 0.05

function restRig() {
  const settings = new Settings()
  const camera = new THREE.PerspectiveCamera(settings.get('fov'), W / H, 0.5, 900)
  const canvas = {
    style: {},
    addEventListener: noop,
    removeEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H }),
  }
  const rig = new CameraRig(camera, canvas, settings)
  return { rig, camera }
}

/** The client pixel a world point is drawn at. */
function pixelOf(camera, p) {
  const v = p.clone().project(camera)
  return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H]
}

/** The ground point `r` out from the target, `deg` off the far bearing, bent as the shader draws it. */
function drawnGround(rig, r, deg) {
  const a = (deg * Math.PI) / 180
  const fx = -Math.sin(rig.azimuth)
  const fz = -Math.cos(rig.azimuth)
  const x = fx * Math.cos(a) - fz * Math.sin(a)
  const z = fx * Math.sin(a) + fz * Math.cos(a)
  return bendPoint(new THREE.Vector3(rig.target.x + r * x, 0, rig.target.z + r * z))
}

/** What `groundPoint` used to answer: three's ray against the plane y = 0. */
function flatPlane(camera, [col, row]) {
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2((col / W) * 2 - 1, -(row / H) * 2 + 1), camera)
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
}

const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

test('the rig starts at the rest view', () => {
  const { rig, camera } = restRig()
  assert.ok(Math.abs(rig.azimuth - Math.PI / 4) < 1e-12)
  assert.ok(Math.abs(rig.polar - THREE.MathUtils.degToRad(56)) < 1e-12)
  assert.equal(rig.distance, 62)
  assert.equal(camera.fov, 38)
  assert.equal(rig.target.lengthSq(), 0)
})

test('ring 4 on the far side: a click lands on the plot drawn under the cursor', () => {
  const { rig, camera } = restRig()
  setCurveView(rig.target, rig.azimuth, CURVE * CURVE_FULL)
  const drawn = drawnGround(rig, 4 * PLOT_CELL, 0)
  const pixel = pixelOf(camera, drawn)
  const hit = rig.groundPoint(...pixel)
  assert.ok(hit, 'the far side of ring 4 is ground, not sky')
  assert.ok(horizontal(hit, drawn) <= TOL, `lands ${horizontal(hit, drawn).toFixed(4)} from the drawn point`)
  assert.ok(Math.abs(hit.y - drawn.y) <= TOL, `at height ${hit.y.toFixed(3)}, drawn at ${drawn.y.toFixed(3)}`)
  // The flat plane, which is what this used to answer, lands most of a plot short.
  assert.ok(horizontal(flatPlane(camera, pixel), drawn) > 5)
})

test('rings 2 to 4, out to 40° either side of the far bearing, all land on the drawn ground', () => {
  const { rig, camera } = restRig()
  setCurveView(rig.target, rig.azimuth, CURVE * CURVE_FULL)
  for (const ring of [2, 3, 4]) {
    for (const deg of [0, -20, 20, -40, 40]) {
      const drawn = drawnGround(rig, ring * PLOT_CELL, deg)
      const hit = rig.groundPoint(...pixelOf(camera, drawn))
      assert.ok(hit && horizontal(hit, drawn) <= TOL, `ring ${ring}, ${deg}°: ${hit ? horizontal(hit, drawn).toFixed(4) : 'no hit'}`)
    }
  }
})

test('with the curve at 0 the answer is the flat plane, to the last bit', () => {
  const { rig, camera } = restRig()
  setCurveView(rig.target, rig.azimuth, 0)
  for (const pixel of [[640, 400], [0, 0], [1280, 800], [211.5, 97.25], [1100, 30]]) {
    const hit = rig.groundPoint(...pixel)
    const plane = flatPlane(camera, pixel)
    assert.deepEqual(hit && hit.toArray(), plane && plane.toArray(), `pixel ${pixel}`)
  }
})

test('a sky pixel picks no plot, though the flat plane under it lies among them', () => {
  const { rig, camera } = restRig()
  setCurveView(rig.target, rig.azimuth, CURVE * CURVE_FULL)
  // One plot over every cell of the lattice: whatever ground a pick lands on, it is on a plot.
  const cells = []
  for (let q = -PLOT_RINGS; q <= PLOT_RINGS; q++) {
    for (let r = -PLOT_RINGS; r <= PLOT_RINGS; r++) if (ringOf({ q, r }) <= PLOT_RINGS) cells.push(hexToWorld(q, r))
  }
  const lattice = { plotOrder: [{ center: new THREE.Vector3(), localCenters: cells }] }
  const plotAt = (p) => Colony.prototype.plotAt.call(lattice, p.x, p.z)
  // Row 156 is the last sky row down the middle of the rest view, 157 the first ground.
  for (const pixel of [[640, 10], [200, 60], [1100, 40], [640, 150], [640, 156]]) {
    assert.ok(plotAt(flatPlane(camera, pixel)), `pixel ${pixel}: the flat plane is on a plot`)
    assert.equal(rig.groundPoint(...pixel, undefined, { pick: true }), null, `pixel ${pixel}`)
  }
  assert.ok(plotAt(rig.groundPoint(640, 157, undefined, { pick: true })), 'the first ground row picks')
})

test('a pan dragged down across the horizon slides on without a jump', () => {
  const { rig } = restRig()
  setCurveView(rig.target, rig.azimuth, CURVE * CURVE_FULL)
  rig._pointerDown({ pointerId: 1, button: 0, clientX: 640, clientY: 150 })
  // The plane hit of the last sky row lies some 37 out and the bent ground just below it 60:
  // answering the plane in the sky threw the target 29 units back as the cursor crossed.
  let before = rig.target.clone()
  for (let row = 151; row <= 165; row++) {
    rig._pointerMove({ pointerId: 1, clientX: 640, clientY: row, preventDefault: noop })
    const moved = before.distanceTo(rig.target)
    assert.ok(moved < 5, `row ${row}: the target moved ${moved.toFixed(2)}`)
    before = rig.target.clone()
  }
  assert.ok(rig.target.lengthSq() > 1, 'the view moved')
})

test('a pan dragged in the sky moves the view the way it does on a flat world', () => {
  /** Drag through sky pixels with the curve at `amount`; where the target ends up. */
  const pan = (amount, path) => {
    const { rig } = restRig()
    setCurveView(rig.target, rig.azimuth, amount)
    rig._pointerDown({ pointerId: 1, button: 0, clientX: path[0][0], clientY: path[0][1] })
    for (const [x, y] of path.slice(1)) rig._pointerMove({ pointerId: 1, clientX: x, clientY: y, preventDefault: noop })
    return new THREE.Vector3(...rig.target.toArray())
  }
  // Down one column the horizon stays put, so the sky pans exactly as the flat plane does.
  const column = [[640, 20], [640, 45], [640, 70]]
  const flat = pan(0, column)
  assert.ok(flat.length() > 1, 'the flat pan moved the view')
  assert.ok(pan(CURVE * CURVE_FULL, column).distanceTo(flat) < 1e-9)
  // Across columns the horizon under the cursor moves, but the pan still goes the flat way.
  for (const path of [[[640, 20], [610, 45], [580, 70]], [[300, 120], [340, 60]], [[1100, 140], [900, 30]]]) {
    const flat = pan(0, path)
    const bent = pan(CURVE * CURVE_FULL, path)
    const cos = flat.dot(bent) / (flat.length() * bent.length())
    assert.ok(cos > 0.9, `${JSON.stringify(path)}: ${bent.toArray().map((v) => v.toFixed(2))} against ${flat.toArray().map((v) => v.toFixed(2))}`)
  }
})

test('a pan grabbed on the far side keeps the drawn ground under the cursor', () => {
  const { rig, camera } = restRig()
  setCurveView(rig.target, rig.azimuth, CURVE * CURVE_FULL)
  const grabbed = drawnGround(rig, 4 * PLOT_CELL, 20)
  const [x0, y0] = pixelOf(camera, grabbed)
  rig._pointerDown({ pointerId: 1, button: 0, clientX: x0, clientY: y0 })
  // Two moves before the next frame, so the second finds the uniforms' focus a step behind the
  // camera: the rig bends around its own target, which is the one it will be drawn around.
  const cursor = [x0 - 90, y0 + 140]
  rig._pointerMove({ pointerId: 1, clientX: x0 - 40, clientY: y0 + 60, preventDefault: noop })
  rig._pointerMove({ pointerId: 1, clientX: cursor[0], clientY: cursor[1], preventDefault: noop })
  assert.ok(rig.target.lengthSq() > 1, 'the view moved')
  // The next frame bends the world around the moved target; the grabbed point is drawn there.
  setCurveView(rig.target, rig.azimuth, CURVE * CURVE_FULL)
  const drawn = bendPoint(new THREE.Vector3(grabbed.x, 0, grabbed.z))
  const [x1, y1] = pixelOf(camera, drawn)
  assert.ok(Math.hypot(x1 - cursor[0], y1 - cursor[1]) < 0.01, `${Math.hypot(x1 - cursor[0], y1 - cursor[1])} px off`)
})

test('the wheel holds the drawn ground under the cursor while the dolly eases', () => {
  const { rig, camera } = restRig()
  setCurveView(rig.target, rig.azimuth, CURVE * CURVE_FULL)
  const anchor = drawnGround(rig, 3 * PLOT_CELL, -30)
  const cursor = pixelOf(camera, anchor)
  rig._wheel({ deltaY: -250, deltaMode: 0, clientX: cursor[0], clientY: cursor[1], preventDefault: noop })
  let frames = 0
  while (frames < 240) {
    rig.update(1 / 60)
    // The frame that lands within 0.02 of the new distance lets go of the anchor, uncorrected.
    if (!rig._zoom) break
    setCurveView(rig.target, rig.azimuth, CURVE * CURVE_FULL)
    const [x, y] = pixelOf(camera, bendPoint(new THREE.Vector3(anchor.x, 0, anchor.z)))
    assert.ok(Math.hypot(x - cursor[0], y - cursor[1]) < 0.01, `frame ${frames}: ${Math.hypot(x - cursor[0], y - cursor[1])} px off`)
    frames++
  }
  assert.ok(frames > 10 && rig.distance < 50, `the dolly ran ${frames} frames to ${rig.distance.toFixed(1)}`)
})
