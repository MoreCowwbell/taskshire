import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import generate, { FLAME } from '../src/themes/medieval/torch.mjs'
import { manifest } from '../src/themes/medieval/manifest.js'

/**
 * The one part of the medieval kit nobody drew: a wall torch, authored straight into the
 * packed document so `weld` and `dedup` treat it exactly like a model off the pack.
 *
 * The flame is cell 26, not the plan's cell 20. Cell 20 is `#daae7d` beige in three of the
 * pack's four seasonal repaints and `#8eaebc` blue-grey in the fourth — and the fourth is
 * winter, which is the atlas the mountain setting wears and therefore the one shot that has
 * to show a *burning* torch. Cell 26 is `#f9aa4e` in all four, is sampled by nothing else in
 * either kit (so declaring it emissive lights the flame and nothing else), and reads as fire
 * on its own albedo in daylight rather than relying on the emissive term to carry it.
 */
test('the torch generator adds one node that samples the wood, iron and flame cells', () => {
  const doc = new Document()
  const scene = doc.createScene('s')
  doc.getRoot().setDefaultScene(scene)
  doc.createBuffer()
  doc.createMaterial('hexagons_medieval')
  generate(doc, scene, 'torch')
  const node = scene.listChildren().find((n) => n.getName() === 'torch')
  assert.ok(node, 'node added')
  const prim = node.getMesh().listPrimitives()[0]
  const pos = prim.getAttribute('POSITION')
  assert.ok(pos.getMin([])[1] >= -1e-6, 'base at y=0')
  assert.ok(pos.getMax([])[1] > 0.3, 'taller than a barrel')
  const uv = prim.getAttribute('TEXCOORD_0')
  const cells = new Set()
  for (let i = 0; i < uv.getCount(); i++) {
    const [u, v] = uv.getElement(i, [])
    cells.add(Math.floor(v * 4) * 8 + Math.floor(u * 8))
  }
  assert.ok(cells.has(6), 'wood')
  assert.ok(cells.has(4), 'iron')
  assert.ok(cells.has(26), 'flame')
  assert.deepEqual([...cells].sort((a, b) => a - b), [4, 6, 26], 'and nothing else')
})

/** One primitive, one material, indexed, with a normal per vertex — a packed model's shape. */
test('the torch is one indexed primitive on the document material', () => {
  const doc = new Document()
  const scene = doc.createScene('s')
  doc.getRoot().setDefaultScene(scene)
  doc.createBuffer()
  const material = doc.createMaterial('hexagons_medieval')
  generate(doc, scene, 'torch')
  const prims = scene
    .listChildren()
    .find((n) => n.getName() === 'torch')
    .getMesh()
    .listPrimitives()
  assert.equal(prims.length, 1)
  const prim = prims[0]
  assert.equal(prim.getMaterial(), material)
  const count = prim.getAttribute('POSITION').getCount()
  assert.equal(prim.getAttribute('NORMAL').getCount(), count)
  assert.equal(prim.getAttribute('TEXCOORD_0').getCount(), count)
  const idx = prim.getIndices()
  assert.ok(idx.getCount() > 0 && idx.getCount() % 3 === 0, 'whole triangles')
  for (let i = 0; i < idx.getCount(); i++) assert.ok(idx.getScalar(i) < count, 'index in range')
})

/** Normals are per face and unit length: a flat-shaded torch, like everything else in the pack. */
test('every normal is unit length', () => {
  const doc = new Document()
  const scene = doc.createScene('s')
  doc.getRoot().setDefaultScene(scene)
  doc.createBuffer()
  doc.createMaterial('hexagons_medieval')
  generate(doc, scene, 'torch')
  const normal = scene
    .listChildren()
    .find((n) => n.getName() === 'torch')
    .getMesh()
    .listPrimitives()[0]
    .getAttribute('NORMAL')
  for (let i = 0; i < normal.getCount(); i++) {
    const [x, y, z] = normal.getElement(i, [])
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-5, `normal ${i} is unit length`)
  }
})

/** Thin enough that the kerb clutter's nav radius stays at its floor. */
test('the torch is a thin stick, not a barrel', () => {
  const doc = new Document()
  const scene = doc.createScene('s')
  doc.getRoot().setDefaultScene(scene)
  doc.createBuffer()
  doc.createMaterial('hexagons_medieval')
  generate(doc, scene, 'torch')
  const pos = scene
    .listChildren()
    .find((n) => n.getName() === 'torch')
    .getMesh()
    .listPrimitives()[0]
    .getAttribute('POSITION')
  const min = pos.getMin([])
  const max = pos.getMax([])
  assert.ok(max[0] - min[0] < 0.1, 'narrow in x')
  assert.ok(max[2] - min[2] < 0.1, 'narrow in z')
  assert.ok(max[1] > 0.5 && max[1] < 0.6, 'about 0.55 pack units tall')
})

/**
 * The flame is one decision in two files. `torch.mjs` paints the cone from `FLAME.cell`; the
 * manifest declares that same cell emissive so the cone actually burns. Nothing warns you if
 * the two drift — the torch just goes out, in the one shot (`mountain-night`) that exists to
 * show it lit — so the pairing is asserted rather than trusted.
 *
 * The manifest is pure data with no `three` in it, and `torch.mjs` has no imports at all, so
 * both load under `node --test` exactly as they load in the browser.
 */
test('the manifest lights the cell the torch is painted from', () => {
  assert.equal(FLAME.cell, 26)
  const pbr = manifest.kits.base.pbr[FLAME.cell]
  assert.ok(pbr, `pbr[${FLAME.cell}] is declared`)
  assert.equal(pbr.emissive, FLAME.emissive)
  assert.equal(pbr.emissiveIntensity, FLAME.intensity)
  assert.equal(manifest.kits.base.cells.FLAME, FLAME.cell, 'the named cell is the same cell')
})

/** The flame cell burns and the stake does not: only cell 26 carries an emissive term. */
test('the flame is the only cell in the base kit declared emissive', () => {
  const lit = Object.entries(manifest.kits.base.pbr).filter(([, v]) => v.emissive !== undefined)
  assert.deepEqual(
    lit.map(([cell]) => Number(cell)),
    [FLAME.cell]
  )
})

/**
 * Both recipes the batch lights carry a torch, and neither torch reaches the recipe's
 * footprint — `colony.js` blocks a nav disc of `footprint * 0.8` around a building, so a
 * torch that became the widest part of its recipe would fence the villagers off their own
 * plot to light a wall. The bounds are the packed node's, read with `inspect-kit`.
 */
test('the tavern and the watchtower carry torches that do not widen them', () => {
  const flat = (kind) => manifest.buildings.kinds[kind].parts.filter((p) => p.node === 'torch')
  const tavern = flat('tavern')
  const watchtower = flat('watchtower')
  assert.equal(tavern.length, 2, 'one torch either side of the tavern door')
  assert.equal(watchtower.length, 1, 'one at the tower door')
  // Half the torch's own footprint, from its packed bounds: x ±0.045, z ±0.039.
  const TORCH = { x: 0.045, z: 0.039 }
  const FOOT = { tavern: 1.051, watchtower: 0.79 }
  for (const [kind, parts] of [
    ['tavern', tavern],
    ['watchtower', watchtower],
  ]) {
    for (const p of parts) {
      assert.ok(Math.abs(p.x) + TORCH.x <= FOOT[kind], `${kind} torch at x ${p.x} stays inside the footprint`)
      assert.ok(Math.abs(p.z) + TORCH.z <= FOOT[kind], `${kind} torch at z ${p.z} stays inside the footprint`)
      assert.ok(p.z > 0, `${kind} torch stands in front of the door, not behind the building`)
    }
  }
})
