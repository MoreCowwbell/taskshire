import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'
import { readKit } from '../tools/kit-read.mjs'
import { configureKits, hasPart, hasSolo } from '../src/world/kit.js'
import { DOOR_HINGE, DOOR_OPEN, hasHingedArch } from '../src/themes/medieval/wall.js'

const GLB = 'public/assets/medieval/medieval.glb'

/**
 * `harvest` only fills `kit.solo` for a node that is itself a mesh, so a name can be a part
 * without being a solo part. The arch's hinged fallback needs to ask both questions.
 */
test('hasSolo is false for a kit that does not exist', () => {
  assert.equal(hasSolo('wall_straight_gate', 'nope'), false)
})

test('hasSolo and hasPart are both false on a configured kit nothing has loaded into', () => {
  configureKits({ base: { file: 'x.glb' } }, (f) => f)
  assert.equal(hasPart('wall_straight_gate'), false)
  assert.equal(hasSolo('wall_straight_gate'), false)
})

// ── the pack's own hinges ──────────────────────────────────────────────────────────────

/**
 * The arch and its two swinging leaves, and the `hangDoors` / `swingDoors` arithmetic in
 * `wall.js` that hangs them.
 *
 * These checks lived in `tests/castle.test.mjs` while the village's arrival was a gate that
 * had grown a castle around it. The arrival is a keep now — no wall, no arch, no doors — and
 * `keep.js` calls none of this. The pack still ships the pieces and `wall.js` still owns the
 * hinge code, so the coverage moves here rather than going out with the gate: this is a check
 * on the *kit*, and it is the only thing that would notice a repack flattening the hierarchy
 * and quietly giving a future gate an archway with no doors in it, or one drawn twice.
 */
test('the arch keeps both door leaves as nodes of their own', async () => {
  const k = await readKit(GLB)
  for (const name of ['wall_straight_gate', 'wall_straight_gate_door_left', 'wall_straight_gate_door_right']) {
    assert.ok(k.nodes.has(name), `${name} is in the kit`)
    // Kit rule 5: only a single-primitive node can be taken `solo`, and only a `solo` arch
    // leaves the leaves out of the piece they hang in.
    assert.equal(k.nodes.get(name).primitives, 1, `${name} is one primitive`)
  }
})

/**
 * The leaves are children of the arch, hung on the jambs at x = ±0.45 model units.
 *
 * That offset is `DOOR_HINGE` in `wall.js`: `kit.js` bakes a part into its own node's frame,
 * so a leaf arrives centred on its hinge and `hangDoors` puts the jamb back by hand. If the
 * pack ever moved the pivot, the doors would swing about the wrong point and nothing else
 * would complain.
 */
test('each leaf hangs on its own jamb, a child of the arch', async () => {
  const doc = await new NodeIO().read(GLB)
  const arch = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === 'wall_straight_gate')
  const children = Object.fromEntries(arch.listChildren().map((n) => [n.getName(), n]))
  assert.deepEqual(Object.keys(children).sort(), ['wall_straight_gate_door_left', 'wall_straight_gate_door_right'])
  const hinge = (name) => children[name].getTranslation()
  assert.ok(Math.abs(hinge('wall_straight_gate_door_left')[0] - DOOR_HINGE) < 1e-3, 'the left leaf hangs on +x')
  assert.ok(Math.abs(hinge('wall_straight_gate_door_right')[0] + DOOR_HINGE) < 1e-3, 'the right leaf hangs on -x')
  for (const name of Object.keys(children)) {
    const [, y, z] = hinge(name)
    assert.ok(Math.abs(y) < 1e-6 && Math.abs(z) < 1e-6, `${name} pivots in the wall's own plane`)
  }
})

/**
 * A leaf runs from its hinge in to the middle of the arch, so shut they meet at x = 0 and
 * open they swing clear of the jamb rather than through it. The signs in `swingDoors` —
 * `-swing` on the left leaf, `+swing` on the right — are what turn both the same way, and
 * `DOOR_OPEN` is far enough round to read as open from the map camera.
 */
test('the leaves reach inward from their hinges and meet at the centre', async () => {
  const doc = await new NodeIO().read(GLB)
  const box = (name) => {
    const node = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === name)
    const pos = node.getMesh().listPrimitives()[0].getAttribute('POSITION')
    return { min: pos.getMin([]), max: pos.getMax([]) }
  }
  const left = box('wall_straight_gate_door_left')
  const right = box('wall_straight_gate_door_right')
  // In its own frame each leaf starts at the hinge (x = 0) and runs 0.45 toward the middle.
  assert.ok(Math.abs(left.max[0]) < 1e-3 && Math.abs(left.min[0] + DOOR_HINGE) < 1e-3, 'the left leaf reaches -x')
  assert.ok(Math.abs(right.min[0]) < 1e-3 && Math.abs(right.max[0] - DOOR_HINGE) < 1e-3, 'the right leaf reaches +x')
  // Thin in z: a leaf standing in the wall's plane, not a block filling the arch.
  for (const b of [left, right]) assert.ok(b.max[2] - b.min[2] < 0.25, 'a leaf, not a plug')
  // Wide open, the free edge stands clear of the wall's own plane rather than folding back
  // along it: a leaf 0.45 long swung through `DOOR_OPEN` carries its tip 0.42 out over the
  // road, which is what makes an open gate read as open from the map camera.
  assert.ok(Math.sin(DOOR_OPEN) * DOOR_HINGE > 0.3, 'a leaf swings out of the archway')
})

/**
 * The hinged fallback. `hasHingedArch` asks three questions of the kit, and anything built
 * before the glb has loaded — which is every ceremony, for the first few frames — must answer
 * no rather than throw.
 */
test('an arch is not hinged until the kit holding it is loaded', () => {
  configureKits({ base: { file: 'x.glb' } }, (f) => f)
  assert.equal(hasHingedArch(), false)
})

test('medieval borrows the space nature kit, without a copy', async () => {
  const { manifest } = await import('../src/themes/medieval/manifest.js')
  assert.equal(manifest.kits.nature.file, '../space/nature.glb')
  assert.equal(manifest.kits.nature.vertexColors, true)
  assert.ok(!manifest.kits.nature.lazy)
})
