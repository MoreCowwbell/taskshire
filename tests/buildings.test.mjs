import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { configureKits, loadKit, loadLazyKit } from '../src/world/kit.js'
import { BUILDING_RADIUS, configureBuildings, createBuilding, createRuin, footprintOf } from '../src/world/buildings.js'
import { manifest } from '../src/themes/medieval/manifest.js'
import { resolveSettings } from '../src/worlds/resolve.js'

/**
 * How much ground a building stands on, and whether a ruin is measured on its own.
 *
 * The navigation grid inflates `userData.footprint` into the circle it blocks around a
 * building, and `setRuin` used to swap the geometry and leave that number at the house's.
 * A repo far enough gone is rubble on the ground, and the rubble is a different shape from
 * the house — so the crew was routed around ground nothing stands on and walked through
 * ground something does.
 */

const GLB = { base: 'public/assets/medieval/medieval.glb', decay: 'public/assets/medieval/decay.glb' }

test('footprintOf is the half-width of the square that contains the box', () => {
  const box = new THREE.Box3(new THREE.Vector3(-1, 0, -0.5), new THREE.Vector3(0.7, 3, 0.9))
  assert.equal(footprintOf(box), 1, 'the largest absolute ground extent, whichever side it is on')
  // Height is not a ground axis, however tall the thing is.
  const tall = new THREE.Box3(new THREE.Vector3(-0.2, 0, -0.2), new THREE.Vector3(0.2, 40, 0.2))
  assert.equal(footprintOf(tall), 0.2)
})

/**
 * The real kits behind `part()`, out of the real files, through the engine's own loader —
 * the same four browser globals `tests/surfaces.test.mjs` and `tests/keep.test.mjs` invent,
 * for the same reasons: `fetch` over a local path, `ProgressEvent`, `self`, and a `document`
 * whose `<img>` reports a successful decode and holds no pixels. Nothing here reads a texel;
 * the geometry's bounding box is the whole of what is under test.
 *
 * Both kits, because a ruin lives in the lazy one. `loadKit()` takes the base and skips
 * `decay` exactly as the browser does, and `loadLazyKit('decay')` is the fetch the colony
 * makes the first time a zone starts to fade.
 */
let loaded = null
const invented = []
let realFetch = null
function withKits() {
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
  configureKits({ base: { file: 'medieval.glb' }, decay: { file: 'decay.glb', lazy: true } }, (file) =>
    file === 'decay.glb' ? `file-under-test:${GLB.decay}` : `file-under-test:${GLB.base}`
  )
  loaded = loadKit()
    .then(() => loadLazyKit('decay'))
    .then(() => {
      configureBuildings(manifest.buildings, manifest.palette, manifest.plots, manifest.decay, { settings: manifest.settings })
    })
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

test('a ruin is measured on its own geometry, and the house’s numbers come back', async () => {
  await withKits()

  // `home` is the kind id in `manifest.buildings.kinds`; `building_home_A_blue` is the node
  // its recipe draws from.
  const mesh = createBuilding({ seed: 7, kind: 'home' })
  const house = { footprint: mesh.userData.footprint, height: mesh.userData.height }
  assert.ok(house.footprint > 0, `the house stands on something, got ${house.footprint}`)

  const geo = createRuin({ seed: 7 })
  assert.ok(geo, 'the decay kit is in, so there is a ruin to fall down to')

  mesh.userData.setRuin(geo)
  assert.equal(mesh.geometry, geo, 'the mesh is wearing the ruin')
  assert.equal(mesh.userData.footprint, footprintOf(geo.boundingBox))
  assert.equal(mesh.userData.height, geo.boundingBox.max.y)
  // Different numbers, not the same ones by luck. Seed 7's `home` draws the optional tree at
  // x -0.95, so this house's recipe reaches 3.07 and the ruin 2.42 — the grid was blocking most
  // of a metre of ground the rubble does not stand on. The fix is not a shrink, it is the right
  // number, and a ruin next to a bare house node goes the other way.
  //
  // 2.419 is the fallen-house recipe's own widest extent: the beam thrown clear at x -0.66,
  // turned 2.3 rad at s 0.8, whose furthest vertex lands at -0.930 in pack units, times
  // `BUILDING_SCALE` 2.6. The design spec's 0.944 and the plan's corrected 0.9637 are both the
  // rotated *bounding box's* corner rather than the geometry's own reach — a log pile is a
  // rounded stack that does not fill its own box, so the box corner overstates it by three
  // hundredths and names the wrong part. This is measured on the vertices.
  assert.ok(Math.abs(mesh.userData.footprint - 2.419) < 0.01, `the ruin's own width, got ${mesh.userData.footprint}`)
  // And it is shorter than the house node it replaces, which a heap of a house has to be:
  // `building_home_A_blue` stands 0.930 model units and the ruin 0.833.
  assert.ok(geo.boundingBox.max.y < 0.93 * 2.6, `the ruin is shorter than a house, got ${geo.boundingBox.max.y}`)
  assert.notEqual(mesh.userData.footprint, house.footprint)
  assert.notEqual(mesh.userData.height, house.height)

  mesh.userData.setRuin(null)
  assert.equal(mesh.userData.footprint, house.footprint, 'exactly the house’s again')
  assert.equal(mesh.userData.height, house.height)
})

/**
 * The ruin is a house that fell down, assembled out of the pack, rather than the one heap it
 * used to be — and it is made of *literals*, which is not a detail.
 *
 * Nothing in the recipe is a `rand` or `jitter` form, so it spends no draws from
 * `expandRecipe`'s stream (exactly as the old one-part recipe did), every ghost in the colony
 * gets the same ruin, and the footprint the navigation grid reads is a single provable number
 * rather than a worst case over every yaw the dice could have rolled. Variety is a pick list
 * away once the read is confirmed; it is not free, and today it buys nothing.
 */
test('the ruin is a fallen house of literal parts', () => {
  const parts = manifest.decay.ruin.parts
  assert.equal(parts.length, 7)
  assert.deepEqual(
    new Set(parts.map((p) => p.node)),
    new Set(['building_destroyed', 'building_stage_C', 'resource_lumber', 'rock_single_B'])
  )
  for (const p of parts) {
    for (const f of ['x', 'y', 'z', 'ry', 's', 'stage']) {
      if (f in p) assert.equal(typeof p[f], 'number', `${p.node}.${f} is a literal, not a random form`)
    }
  }
})

/** And so the seed cannot move it: two threads far enough gone fall down the same way. */
test('every ghost falls down the same way', async () => {
  await withKits()
  const a = createRuin({ seed: 1 })
  const b = createRuin({ seed: 99 })
  assert.ok(a && b, 'the decay kit is in')
  assert.equal(a.attributes.position.count, b.attributes.position.count)
  assert.deepEqual(a.boundingBox.min.toArray(), b.boundingBox.min.toArray())
  assert.deepEqual(a.boundingBox.max.toArray(), b.boundingBox.max.toArray())
})

/**
 * Upstream's fit goes with his yard: a `'reserved'` yard keeps its props `BUILDING_RADIUS` from
 * every slot, so each building is scaled down until it stays inside that radius at any yaw.
 * Any other yard leaves `BUILDING_SCALE` exactly as the manifest says.
 */
test('a reserved yard fits every building inside BUILDING_RADIUS, and only that yard', async (t) => {
  await withKits()
  const reconfigure = (plots) => configureBuildings(manifest.buildings, manifest.palette, plots, manifest.decay, { settings: manifest.settings })
  t.after(() => reconfigure(manifest.plots))
  const reach = (mesh) => {
    const p = mesh.geometry.attributes.position
    let r = 0
    for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)))
    return r
  }
  const kinds = Object.keys(manifest.buildings.kinds)
  reconfigure(manifest.plots)
  const open = kinds.map((kind) => reach(createBuilding({ seed: 7, kind })))
  assert.ok(open.some((r) => r > BUILDING_RADIUS), 'some building reaches past the radius unfitted')
  reconfigure({ ...manifest.plots, yard: 'reserved' })
  const fitted = kinds.map((kind) => reach(createBuilding({ seed: 7, kind })))
  for (const [i, r] of fitted.entries()) assert.ok(r <= BUILDING_RADIUS + 1e-5, `${kinds[i]} reaches ${r}`)
})

/**
 * The planet tint is wired into the building shader when any of the theme's settings carries a
 * `buildingTint` — which is where the colony reads it from — however the setting came by it: a
 * world's dressing, a biome's, the default, or written out by hand. Left out of it otherwise,
 * including for a dressing entry of a world the theme does not list. Space tints its desert;
 * the village tints nothing.
 */
test('the building tint uniforms exist only where a setting carries a tint', async (t) => {
  await withKits()
  const { manifest: space } = await import('../src/themes/space/manifest.js')
  const reconfigure = (settings) =>
    configureBuildings(manifest.buildings, manifest.palette, manifest.plots, manifest.decay, { settings })
  t.after(() => reconfigure(manifest.settings))
  const tint = { buildingTint: 0xc9a176 }
  const dressed = (dressing) => resolveSettings(manifest.worlds, dressing)
  for (const [name, settings] of [
    ['space', space.settings],
    ['a world', dressed({ worlds: { forest: tint } })],
    ['a biome', dressed({ biomes: { green: tint } })],
    ['the default', dressed({ default: tint })],
    ['by hand', [...manifest.settings, { ...manifest.settings[0], id: 'clay', ...tint }]],
  ]) {
    reconfigure(settings)
    const on = createBuilding({ seed: 7, kind: 'home' }).userData.uniforms
    assert.ok(on.uCellPlanetTint, `${name}: the tint mask is wired`)
    assert.ok(on.uPlanetTintAmount, `${name}: and its amount`)
  }
  for (const [name, settings] of [
    ['the village', manifest.settings],
    // Every world is listed now, so the unlisted one is left out of the list by hand.
    ['an unlisted world', resolveSettings(['forest', 'valley', 'mountain'], { worlds: { moon: tint } })],
    ['none', undefined],
  ]) {
    reconfigure(settings)
    const off = createBuilding({ seed: 7, kind: 'home' }).userData.uniforms
    assert.equal(off.uCellPlanetTint, undefined, name)
    assert.equal(off.uPlanetTintAmount, undefined, name)
  }
})
