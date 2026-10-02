/**
 * The world golden: a fingerprint of everything the world generator builds, for every world
 * each theme lists today.
 *
 * A screenshot guards only the worlds that have one, and nine of the space worlds have none.
 * This guards all of them, in Node, in a few seconds: for each theme–world pair it builds the
 * terrain, the seas, the scatter, the grass and the floating island, and records a SHA-256 of
 * the raw bytes of every buffer they fill. Nothing is compared with a tolerance. A generator
 * that moves one vertex by one ulp, spends one extra seeded draw or plants one tree
 * differently fails here, and the message names the pair and the field.
 *
 * **What is recorded, per pair:**
 * - `terrain`: the mesh's positions and colours at every `groundDetail`;
 * - `heights`: `terrainHeight` on a 64×64 grid over the whole ground, as float64, so a
 *   reordered sum that float32 would round away is still caught;
 * - `water`: `water.js`'s sea at every quality, where the colony would build it (`halfPlane`,
 *   the valley's own flat sea until 2026-09-30, is null on every pair);
 * - `scatter`: per instanced mesh and in order, its part, count, matrices and colours — once
 *   with the kits loaded and once with the fallback shapes the page draws before they arrive;
 * - `shoreline`, `shoreReach` (coasts only; it has no meaning without one) and
 *   `underWater`, sampled the same way;
 * - `blockedCells`: `Colony._blockedCells` on a stand-in ceremony, as `deck-ground.test.mjs`
 *   calls it. Stored as the sorted cell keys, not a hash, so a changed set can be read;
 * - `settings`: the SHA-256 of the setting's `canonicalJson` (see `fixtures/canonical.mjs`);
 * - `grass` where the world grows it, and `sky`, the floating island's meshes, on `sky`;
 * - `draws`: how many global `Math.random` draws the builds spent. three.js stamps every
 *   geometry, material and texture with a UUID drawn from it, and under the page that is the
 *   stream the crew is seated from, so a generator that allocates one object more or in
 *   another order moves every villager on screen. `drawsBy` says which build spent them.
 *
 * **Deterministic, and independent of order.** The generator keeps module state — the island's
 * footprint, with the shoreline cache that follows it, and a field cache keyed by setting id
 * that holds only what the setting itself fixes (its noise, craters and islets, all seeded) —
 * so every build sets the footprint afresh, and `Math.random` is swapped for a seeded counter
 * that starts afresh for every build. A pair's record is the same whichever pairs ran before it.
 *
 * **The ocean island** is shaped around the colony's cells, so it is built around a fixed
 * footprint — the centre cell and its six neighbours — which the golden records as
 * `oceanFootprint`. The same seven cells stand in for the plots everywhere else a build asks
 * about them: the floating island's ground and rock, and where the grass may not grow.
 *
 * Regenerating: `UPDATE_GOLDEN=1 node --test tests/worlds-golden.test.mjs` rewrites
 * `tests/fixtures/worlds-golden.json`. Do that only for a change that is meant to move the
 * worlds, and read the diff: every hash that moved is a world that looks different.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { configureKits, loadKit } from '../src/world/kit.js'
import {
  GROUND_SIZE,
  SKY_MARGIN,
  createScatter,
  createTerrain,
  setIslandFootprint,
  shoreReach,
  shorelinePoints,
  terrainHeight,
  underWater,
} from '../src/world/setting.js'
import { createWater as createPlanetWater } from '../src/world/water.js'
import { createGrass } from '../src/world/grass.js'
import { createSkyIsland } from '../src/world/skyisland.js'
import { createHexIsland } from '../src/world/hexisland.js'
import { Colony } from '../src/game/colony.js'
import { PLOT_CELL, hexToWorld } from '../src/world/plots.js'
import { manifest as space } from '../src/themes/space/manifest.js'
import { manifest as medieval } from '../src/themes/medieval/manifest.js'
import { settingHash } from './fixtures/canonical.mjs'

const GOLDEN = fileURLToPath(new URL('./fixtures/worlds-golden.json', import.meta.url))
/** The kits are read out of the repository's own `public/`, wherever the runner stands. */
const PUBLIC = new URL('../public/', import.meta.url)
const UPDATE = process.env.UPDATE_GOLDEN === '1'

const THEMES = { space, medieval }

const DETAILS = ['low', 'medium', 'high']
/** The grid `heights`, `shoreReach` and `underWater` are sampled on, edge to edge. */
const GRID = 64

/** The centre cell and its six neighbours: the island's coast, and the stand-in for the plots. */
const FOOTPRINT = [
  { q: 0, r: 0 },
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
]
const FOOTPRINT_WORLD = FOOTPRINT.map(({ q, r }) => hexToWorld(q, r))

// ── hashing ───────────────────────────────────────────────────────────────────────────

const sha = (view) =>
  createHash('sha256').update(Buffer.from(view.buffer, view.byteOffset, view.byteLength)).digest('hex')
const shaNumbers = (list) => sha(Float64Array.from(list))

/** Every attribute of a geometry by name, and its index, each hashed on its own. */
function geometryHashes(geo) {
  const out = {}
  for (const name of Object.keys(geo.attributes).sort()) out[name] = sha(geo.attributes[name].array)
  if (geo.index) out.index = sha(geo.index.array)
  return out
}

/** One instanced mesh: what it draws, and the instances actually placed. */
function instanceHashes(mesh) {
  const n = mesh.count
  return {
    part: sha(mesh.geometry.attributes.position.array),
    count: n,
    matrices: sha(mesh.instanceMatrix.array.subarray(0, n * 16)),
    colors: mesh.instanceColor ? sha(mesh.instanceColor.array.subarray(0, n * 3)) : null,
  }
}

/** Every mesh under a group, in scene order, by name. */
function groupHashes(group) {
  const out = []
  group.traverse((o) => {
    if (!o.isMesh) return
    out.push({
      name: o.name,
      geometry: geometryHashes(o.geometry),
      instances: o.isInstancedMesh ? instanceHashes(o) : null,
    })
  })
  return out
}

/** `fn(x, z)` over the grid, row by row. */
function sampleGrid(fn, Type = Float64Array) {
  const out = new Type(GRID * GRID)
  const step = GROUND_SIZE / (GRID - 1)
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) out[i * GRID + j] = fn(-GROUND_SIZE / 2 + j * step, -GROUND_SIZE / 2 + i * step)
  }
  return out
}

// ── draws ─────────────────────────────────────────────────────────────────────────────

/**
 * Run one build with `Math.random` swapped for a seeded mulberry32 that counts, and hand back
 * what it returned and how many draws it took. The seed is the same for every build, so a
 * build that *used* the numbers — nothing does today — would still be reproducible.
 */
function counted(fn) {
  const real = Math.random
  let a = 20260928
  let draws = 0
  Math.random = () => {
    draws++
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  try {
    return [fn(), draws]
  } finally {
    Math.random = real
  }
}

// ── the stand-ins ─────────────────────────────────────────────────────────────────────

/** The generator's module state, put back to one known place before every build. */
function resetWorld() {
  setIslandFootprint(FOOTPRINT_WORLD, PLOT_CELL)
}

/** `Colony.onIsland` over the stand-in footprint: all ground is ground, except on a floating island. */
const onIslandFor = (setting) => (x, z) => {
  if (setting.shape !== 'sky') return true
  const reach = (PLOT_CELL + SKY_MARGIN) * 0.86
  return FOOTPRINT_WORLD.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < reach * reach)
}

/**
 * What the scatter keeps clear of: the centre cell alone, at the colony's own radius — the
 * stand-in for the arrival's apron. Not all seven: a floating island's scatter may only stand
 * on the footprint, and seven cells kept clear would leave it nothing to plant.
 */
const KEEP_CLEAR = [{ ...FOOTPRINT_WORLD[0], r: 8.6 }]

/** `_blockedCells` through the prototype, as `deck-ground.test.mjs` calls it. */
const blockedFor = (setting, manifest) =>
  [
    ...Colony.prototype._blockedCells.call({
      setting,
      theme: { manifest },
      ceremony: { group: new THREE.Group(), doorLocal: new THREE.Vector3() },
    }),
  ].sort()

// ── the kits ──────────────────────────────────────────────────────────────────────────

/**
 * The browser globals three's GLTFLoader wants, as `surfaces.test.mjs` stubs them — see the
 * note there. Installed once, put back in `after()`.
 */
const invented = []
let realFetch = null
function stubBrowser() {
  if (realFetch) return
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
    const bytes = await readFile(fileURLToPath(new URL(name.slice('file-under-test:'.length), PUBLIC)))
    return new Response(bytes, { status: 200, headers: { 'Content-Length': String(bytes.byteLength) } })
  }
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

/**
 * Load the kits a theme's scatter recipes name — the forest pack, and in space the nature kit
 * — and nothing else, or with `none` clear the registry so every recipe falls back.
 */
async function useKits(manifest, { none = false } = {}) {
  if (none) return configureKits({}, null)
  const names = new Set()
  for (const recipe of Object.values(manifest.scatter)) for (const entry of recipe) names.add(entry.kit || 'forest')
  const kits = Object.fromEntries([...names].sort().map((name) => [name, manifest.kits[name]]))
  stubBrowser()
  configureKits(kits, (file) => `file-under-test:${manifest.assetDir}/${file}`)
  await loadKit()
}

// ── the fingerprint ───────────────────────────────────────────────────────────────────

/** Everything that does not depend on the kits, for one pair. */
function fingerprint(setting, manifest) {
  const drawsBy = {}
  const build = (name, fn) => {
    resetWorld()
    const [out, draws] = counted(fn)
    drawsBy[name] = draws
    return out
  }
  const heightAt = (x, z) => terrainHeight(x, z, setting)

  const terrain = {}
  for (const detail of DETAILS) {
    const mesh = build(`terrain.${detail}`, () => createTerrain(setting, detail))
    terrain[detail] = { positions: sha(mesh.geometry.attributes.position.array), colors: sha(mesh.geometry.attributes.color.array) }
  }

  // The colony builds `water.js`'s sea for every `water`. `halfPlane` was the valley's own flat
  // sea until 2026-09-30; it is null everywhere now, and kept so no other world's record moves.
  const upstream = Boolean(setting.water)
  const water = { halfPlane: null, upstream: upstream ? {} : null }
  if (upstream) {
    for (const quality of DETAILS) {
      const sea = build(`water.upstream.${quality}`, () => createPlanetWater({ planet: setting, heightAt, quality }))
      water.upstream[quality] = geometryHashes(sea.mesh.geometry)
    }
  }

  const onIsland = onIslandFor(setting)
  const grass = build('grass', () =>
    createGrass({
      planet: setting,
      heightAt,
      blocked: (x, z) => !onIsland(x, z) || FOOTPRINT_WORLD.some((c) => Math.hypot(x - c.x, z - c.z) < PLOT_CELL),
      density: 1,
      quality: 'low',
    })
  )

  let sky = null
  if (setting.shape === 'sky') {
    const rimRadius = Math.max(PLOT_CELL, ...FOOTPRINT_WORLD.map((c) => Math.hypot(c.x, c.z) + PLOT_CELL)) + 6
    const island = build('sky.island', () => createSkyIsland({ planet: setting, heightAt, rimRadius, quality: 'medium' }))
    const p = setting.skyIsland || {}
    const rock = build('sky.rock', () =>
      createHexIsland({
        cells: FOOTPRINT_WORLD,
        cellRadius: PLOT_CELL,
        margin: SKY_MARGIN,
        palette: { soil: p.soil, rock: p.rock, vine: p.vine, moss: setting.ground.low },
        quality: 'medium',
      })
    )
    sky = { island: groupHashes(island.group), rock: groupHashes(rock.group) }
  }

  resetWorld()
  return {
    settings: settingHash(setting),
    terrain,
    heights: sha(sampleGrid(heightAt)),
    water,
    shoreline: shaNumbers(shorelinePoints(setting).flatMap((p) => [p.x, p.z])),
    shoreReach: setting.coast ? sha(sampleGrid((x, z) => shoreReach(x, z, setting))) : null,
    underWater: sha(sampleGrid((x, z) => (underWater(x, z, setting) ? 1 : 0), Uint8Array)),
    blockedCells: blockedFor(setting, manifest),
    grass: grass
      ? {
          count: grass.count,
          blade: sha(grass.mesh.geometry.attributes.position.array),
          matrices: sha(grass.mesh.instanceMatrix.array.subarray(0, grass.count * 16)),
          phase: sha(grass.mesh.geometry.attributes.aPhase.array.subarray(0, grass.count)),
          tint: sha(grass.mesh.geometry.attributes.aTint.array.subarray(0, grass.count)),
        }
      : null,
    sky,
    drawsBy,
  }
}

/** The scatter for one pair, with whatever kits are loaded right now. */
function scatterOf(setting, manifest) {
  resetWorld()
  const [group, draws] = counted(() => createScatter(setting, manifest.scatter, 1, KEEP_CLEAR, undefined, onIslandFor(setting)))
  const meshes = group.children.map((mesh) => ({
    role: mesh.userData.rim ? 'rim' : mesh.userData.ridge ? 'ridge' : 'main',
    upright: Boolean(mesh.userData.upright),
    ...instanceHashes(mesh),
  }))
  return { meshes, draws }
}

/** Every pair's record, keyed `<theme>/<world>`, in list order. */
async function buildAll() {
  const pairs = {}
  for (const [theme, manifest] of Object.entries(THEMES)) {
    await useKits(manifest, { none: true })
    for (const setting of manifest.settings) {
      const record = fingerprint(setting, manifest)
      const fallback = scatterOf(setting, manifest)
      record.scatter = { kits: null, fallback: fallback.meshes }
      record.drawsBy['scatter.fallback'] = fallback.draws
      pairs[`${theme}/${setting.id}`] = record
    }
    await useKits(manifest)
    for (const setting of manifest.settings) {
      const record = pairs[`${theme}/${setting.id}`]
      const kits = scatterOf(setting, manifest)
      record.scatter.kits = kits.meshes
      record.drawsBy['scatter.kits'] = kits.draws
      record.draws = Object.values(record.drawsBy).reduce((a, b) => a + b, 0)
    }
  }
  // `draws` first and `drawsBy` last, so the file reads count, then detail.
  for (const [key, { draws, drawsBy, ...rest }] of Object.entries(pairs)) pairs[key] = { draws, ...rest, drawsBy }
  return { oceanFootprint: FOOTPRINT, pairs }
}

// ── comparing ─────────────────────────────────────────────────────────────────────────

/** A record as `path → leaf`, with the one list worth reading kept whole. */
function flatten(value, path = '', out = new Map()) {
  if (path.endsWith('blockedCells') || value === null || typeof value !== 'object') out.set(path, value)
  else if (Array.isArray(value) && !value.length) out.set(path, [])
  else for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out)
  return out
}

const short = (v) => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? `${v.slice(0, 12)}…` : JSON.stringify(v))

/** One line per field that moved, blocked cells as the cells refused and released. */
function differences(want, got) {
  const a = flatten(want)
  const b = flatten(got)
  const lines = []
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path)
    const y = b.get(path)
    if (JSON.stringify(x) === JSON.stringify(y)) continue
    if (path === 'blockedCells' && Array.isArray(x) && Array.isArray(y)) {
      const added = y.filter((k) => !x.includes(k))
      const removed = x.filter((k) => !y.includes(k))
      lines.push(`  blockedCells: now refuses [${added.join(' ')}], no longer refuses [${removed.join(' ')}]`)
    } else {
      lines.push(`  ${path}: golden ${a.has(path) ? short(x) : '(absent)'}, built ${b.has(path) ? short(y) : '(absent)'}`)
    }
  }
  return lines
}

// ── the tests ─────────────────────────────────────────────────────────────────────────

let built = null
let golden = null

before(async () => {
  built = await buildAll()
  if (UPDATE) await writeFile(GOLDEN, `${JSON.stringify(built, null, 2)}\n`)
  golden = existsSync(GOLDEN) ? JSON.parse(await readFile(GOLDEN, 'utf8')) : null
})

test('the golden covers every world each theme lists, and the same island footprint', () => {
  assert.ok(golden, 'no tests/fixtures/worlds-golden.json — run with UPDATE_GOLDEN=1 to record it')
  assert.deepEqual(Object.keys(golden.pairs), Object.keys(built.pairs), 'the pairs, in list order')
  assert.deepEqual(golden.oceanFootprint, built.oceanFootprint, 'the footprint the ocean island is built around')
})

for (const [theme, manifest] of Object.entries(THEMES)) {
  for (const setting of manifest.settings) {
    const key = `${theme}/${setting.id}`
    test(`${key} builds exactly what the golden recorded`, () => {
      const want = golden?.pairs?.[key]
      assert.ok(want, `${key} is not in the golden — run with UPDATE_GOLDEN=1 if the world is new`)
      const lines = differences(want, built.pairs[key])
      assert.ok(!lines.length, `${key} differs from the golden in ${lines.length} field(s):\n${lines.join('\n')}`)
    })
  }
}
