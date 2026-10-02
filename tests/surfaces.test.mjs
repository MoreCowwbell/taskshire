import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { configureKits, loadKit } from '../src/world/kit.js'
import {
  deckGeometry,
  kerbInset,
  DECK_TEXTURE_SCALE,
  RELIEF_STRENGTH,
  sampleLattice,
  wrapOffsets,
} from '../src/themes/medieval/surfaces.js'

const GLB = 'public/assets/medieval/medieval.glb'

/** The engine's own plot numbers, which `configurePlots` hands the builder per cell. */
const TILE = 7.6 * 0.992
const TOP = 0.45
const SKIRT = 0.4

/**
 * Put the real kit behind `part()`, out of the real file, through the engine's own loader.
 *
 * `tests/boat.test.mjs` reads the same glb with gltf-transform, which is enough when the
 * question is what the pack authored. This one is about what `deckGeometry` does to a part
 * after `kit.js` has harvested it — the bake into the node's frame, the attribute rebuild —
 * so it has to be the same path the browser takes, and three's GLTFLoader wants four browser
 * globals that `node --test` has not got:
 *
 * - `fetch` over a local path, because the loader takes a URL and node's own fetch has no
 *   file scheme. It is handed the bytes and nothing else changes.
 * - `ProgressEvent`, which `FileLoader` constructs per chunk to report progress nobody reads.
 * - `self`, which `GLTFParser.loadImageSource` reads `URL` off.
 * - `document.createElementNS`, for the `<img>` the texture loader decodes the atlas into.
 *   Nothing here looks at a pixel, so the stand-in reports success and holds no image; the
 *   geometry is what is under test and it arrives whole either way.
 *
 * All four are put back in `after()`. A test file gets its own process today, so nothing else
 * would see them — but a stubbed `fetch` left standing is exactly the kind of thing that is
 * harmless until the day the runner shares a process, and then it is a mystery.
 */
let loaded = null
/** The globals this file created, to be deleted again — as against ones node already had. */
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

const cell = (over = {}) =>
  deckGeometry({ tile: TILE, top: TOP, skirt: SKIRT, x: 0, z: 0, textureScale: DECK_TEXTURE_SCALE, ...over })

/**
 * The tile comes back flat-top, at the engine's radius, with its top face at y 0 and its
 * floor exactly where the prism's was.
 *
 * Every number here is one the rest of the colony is measured against. The corners on ±X are
 * what makes a cell agree with its six neighbours and with the kerb bars around it; the top
 * at 0 is what lets the engine place the tile by that face alone; and the floor at
 * −(top + skirt) is the depth the coast rule and the terrain were tuned for. The pack's own
 * tile is a full unit deep, which at this scale is six and a half.
 */
test('the deck cell is the pack’s tile, turned flat-top and cut to the engine’s slab', async () => {
  await withKit()
  const geo = cell()
  const box = geo.boundingBox

  assert.ok(Math.abs(box.max.x - TILE) < 1e-3, `corners on ±X at the tile radius (${box.max.x})`)
  assert.ok(Math.abs(box.min.x + TILE) < 1e-3)
  // The apothem, across the flats: the circumradius times cos 30°, 6.529 at this radius.
  assert.ok(Math.abs(box.max.z - TILE * Math.cos(Math.PI / 6)) < 1e-3, `flats on ±Z (${box.max.z})`)
  assert.equal(box.max.y, 0, 'the top face is the origin, so the engine places it by that')
  // A float32 buffer, so the floor comes back as −0.85000002: the tolerance is the storage.
  assert.ok(Math.abs(box.min.y + (TOP + SKIRT)) < 1e-6, `floor at ${box.min.y}`)

  // The bounding sphere is recomputed too — a stale one, sized to a tile six units deep,
  // culls the cell while you are looking at it.
  assert.ok(geo.boundingSphere.radius < TILE * 1.1, `sphere of ${geo.boundingSphere.radius}`)
})

/**
 * Only the bottom ring moved. The chamfer that gives the tile its bevelled edge sits a third
 * of a unit under the top face, and the whole look of the deck — seven cells with visible
 * seams between them — is that band; pulling it up with the rest would flatten the tile into
 * a plain prism with a kit texture on it.
 */
test('pulling the tile up moves the 23 bottom vertices and nothing else', async () => {
  await withKit()
  const pos = cell().attributes.position
  const s = TILE / 1.1547

  let onFloor = 0
  let inChamfer = 0
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    assert.ok(y <= 0 && y >= -(TOP + SKIRT) - 1e-6, `vertex ${i} at ${y} is inside the slab`)
    if (Math.abs(y + (TOP + SKIRT)) < 1e-6) onFloor++
    // The pack's chamfer runs from y 0 down to −0.05, which is −0.326 at plot scale.
    if (Math.abs(y + 0.05 * s) < 1e-4) inChamfer++
  }
  assert.equal(onFloor, 23, 'the bottom ring, and only it')
  assert.ok(inChamfer > 0, 'the bevel is still a bevel')
})

/**
 * `uv1` is the world-planar projection the relief normal map reads, offset by the cell's own
 * centre so the clumps run across a whole plot rather than repeating per tile. Channel 0 is
 * the pack's own unwrap and must come through untouched — it is what points each face at its
 * swatch in the gradient atlas.
 */
test('the cell carries a second UV set, projected from the plot’s own centre', async () => {
  await withKit()
  const at = { x: 11.31, z: -6.53 }
  const geo = cell(at)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const uv1 = geo.attributes.uv1

  assert.ok(uv1, 'there is a uv1')
  assert.equal(uv1.count, pos.count)
  for (let i = 0; i < pos.count; i++) {
    assert.ok(Math.abs(uv1.getX(i) - (pos.getX(i) + at.x) / DECK_TEXTURE_SCALE) < 1e-6, `u of vertex ${i}`)
    assert.ok(Math.abs(uv1.getY(i) - (pos.getZ(i) + at.z) / DECK_TEXTURE_SCALE) < 1e-6, `v of vertex ${i}`)
  }

  // And the atlas UVs are the pack's, which is why this is a second set rather than a rewrite.
  const plain = cell()
  for (let i = 0; i < uv.count; i++) {
    assert.equal(uv.getX(i), plain.attributes.uv.getX(i))
    assert.equal(uv.getY(i), plain.attributes.uv.getY(i))
  }
})

/**
 * The inset clears the bevel: the kerb sits on the flat top of the tile rather than tipped
 * over its edge, and still keeps the hair of daylight the engine's own kerb always had.
 */
test('the kerb inset is the chamfer plus the engine’s own gap', async () => {
  assert.ok(Math.abs(kerbInset(TILE) - (0.05 + 0.05 * (TILE / 1.1547))) < 1e-9)
  assert.ok(Math.abs(kerbInset(TILE) - 0.3768) < 1e-3, `0.377 at the engine's tile (${kerbInset(TILE)})`)
  // A proportion of the tile, not a fixed distance: half the radius is half the bevel.
  assert.ok(kerbInset(TILE / 2) < kerbInset(TILE))
  assert.ok(kerbInset(1.1547) > 0.05, 'and never less than the gap it starts from')
})

/**
 * No kit, no tile — and the engine falls back to its own prism. This is the whole of the
 * failure path: a glb that did not load leaves the village with plots rather than with holes.
 *
 * Last in the file, because it takes the loaded kit away again.
 */
test('without the kit there is no cell to build', () => {
  configureKits({ base: { file: 'not-a-file.glb' } }, (f) => f)
  loaded = null
  assert.equal(cell(), null)
})

// ── the grass relief ───────────────────────────────────────────────────────────────────

/**
 * The lattice the swell and the blades' lean are both drawn from tiles, and that is the whole
 * reason a plot of seven hex cells reads as one meadow: the sheet is laid over `uv1` as a
 * world-planar projection, so its left edge meets its own right edge somewhere inside every
 * plot in the colony. A lattice that did not wrap would put a seam there.
 *
 * Drawn against a fixed sequence rather than a real lattice so the expectation is arithmetic:
 * 4 × 4 values, the first sixteen integers over sixteen.
 */
const GRID = 4
const CELLS = Float32Array.from({ length: GRID * GRID }, (_, i) => i / (GRID * GRID))

test('the relief lattice wraps on both axes', () => {
  for (const w of [0, 0.13, 0.5, 0.77]) {
    assert.equal(sampleLattice(CELLS, GRID, 0, w), sampleLattice(CELLS, GRID, 1, w), `u wraps at w ${w}`)
    assert.equal(sampleLattice(CELLS, GRID, w, 0), sampleLattice(CELLS, GRID, w, 1), `w wraps at u ${w}`)
  }
})

/**
 * And it stays inside the values it was given, because it is a convex combination of four of
 * them. A sample that overshot would drive the swell's grey out of 0…255 and clip, which is a
 * flat patch in the middle of a field whose whole job is not to have any.
 */
test('the relief lattice never overshoots its own values', () => {
  const lo = Math.min(...CELLS)
  const hi = Math.max(...CELLS)
  for (let i = 0; i < 200; i++) {
    const u = i / 200
    const w = ((i * 37) % 200) / 200
    const v = sampleLattice(CELLS, GRID, u, w)
    assert.ok(v >= lo - 1e-6 && v <= hi + 1e-6, `sample ${v} at (${u}, ${w})`)
  }
})

/**
 * A blade stroke near an edge is drawn again on the far side, so the marks tile as well as the
 * swell does. The old discs were clipped instead, and the wrapped Sobel only half hid the seam
 * that left along every tile boundary — which on a green built out of tiles is every seam.
 */
test('a mark near an edge is drawn again on the far side', () => {
  assert.deepEqual(wrapOffsets(256, 512, 8), [0], 'a mark in the middle is drawn once')
  assert.deepEqual(wrapOffsets(1, 512, 8), [0, 512], 'one against the near edge comes back on the far one')
  assert.deepEqual(wrapOffsets(511, 512, 8), [0, -512], 'and the other way round')
  assert.deepEqual(wrapOffsets(8.5, 512, 8), [0], 'a mark the border cannot reach is drawn once')
})

/** The field carries its slope in the swell now, so it is Sobelled softer than the discs were. */
test('the relief is Sobelled softer than the old disc field', () => {
  assert.equal(RELIEF_STRENGTH, 0.55)
})
