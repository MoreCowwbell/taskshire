/**
 * A wall torch, drawn by hand into the packed kit.
 *
 * The Medieval Hexagon pack has no light source in it — no lamp, no brazier, no torch — and a
 * village that goes dark at dusk with nothing burning in it reads as abandoned rather than
 * asleep. So this is the one part of the kit that is authored rather than packed: a stake, an
 * iron band, and a flame, added by `tools/build-kit.mjs` *before* `weld` and `dedup` run, so
 * the merged glb cannot tell it from a model that came off the pack.
 *
 * Everything here is in **pack units** — the frame the pack's own gltf files are authored in,
 * which `buildings.scale` and the clutter scales multiply afterwards. A barrel is 0.21 tall in
 * that frame; this is 0.56, and the kerb clutter stands it at `plots.clutterLampScale`.
 *
 * Three rules keep it looking like the rest of the kit:
 *
 * 1. **Flat swatches, sampled at the centre.** The atlas is a 8x4 grid of flat colours, so
 *    every vertex of a part carries the *same* UV — the middle of its cell. There is no
 *    gradient to line up with and no seam to get wrong.
 * 2. **A normal per face.** The pack is flat-shaded; a smoothed post next to a faceted barrel
 *    is the one thing that would give this away. Faces therefore do not share vertices.
 * 3. **The document's own material.** The packer merges 51 copies of one material and lets
 *    `dedup` fold them together; taking the first one means the torch is folded in with them
 *    and the kit still reports exactly one material and one texture.
 *
 * No imports in here at all: this runs under Node inside the packer, under `node --test`,
 * and — since the manifest reads `FLAME` from it — inside the browser bundle as well.
 */

/** 8x4, the medieval atlas. Matches `kits.base.atlas` in the manifest and `cellsOf` in kit-read. */
const COLS = 8
const ROWS = 4

/** The two swatches the stake and its band are painted from. The flame has `FLAME` below. */
const WOOD = 6
const IRON = 4

/**
 * The flame: the cell it is painted from, and how that cell burns.
 *
 * `FLAME.cell` is 26 rather than the 20 the plan named. Cell 20 is beige in the spring, summer
 * and fall repaints and *blue-grey* in the winter one — and winter is the atlas the mountain
 * setting wears, so a torch painted from it would go out exactly where it is most needed. Cell
 * 26 is `#f9aa4e` in all four sheets, is sampled by no other mesh in either medieval kit (so
 * declaring it emissive lights this flame and nothing else in the village), and carries the
 * fire on its own albedo by daylight instead of leaning on the emissive term to do all of it.
 *
 * `emissive` and `intensity` are exported rather than written into the manifest because two
 * *other* sites are tuned against them and would drift silently: `kits.base.pbr[FLAME.cell]`
 * in `manifest.js`, which is what actually makes the cell burn, and the ember colour in
 * `particles.js`, the mote that lifts off the flame and is what sells it as alight. A flame
 * and its ember are one decision, so they read one constant.
 *
 * This file is imported by the packer *and* by the manifest, so it stays dependency-free:
 * nothing here imports `three` or `node:fs`, and the browser bundle can take it whole.
 */
export const FLAME = { cell: 26, emissive: 0xff8a2a, intensity: 1.6 }

/** Measurements, all from the base of the stake at y=0. */
const POST = { radius: 0.02, top: 0.42, sides: 6 }
const BAND = { radius: 0.035, bottom: 0.4, top: 0.44, sides: 6 }
const FIRE = { radius: 0.045, bottom: 0.44, top: 0.56, sides: 6 }

/** The middle of a cell, in the UV space the atlas is indexed in: `cell = row * COLS + col`. */
function cellUv(cell) {
  return [((cell % COLS) + 0.5) / COLS, (Math.floor(cell / COLS) + 0.5) / ROWS]
}

/** A ring of `n` points at radius `r` and height `y`, starting on +x and turning towards +z. */
function ring(n, r, y) {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n
    out.push([Math.cos(a) * r, y, Math.sin(a) * r])
  }
  return out
}

/**
 * A mesh under construction: three parallel attribute arrays and an index buffer.
 *
 * Faces never share vertices, so a face can be pushed with one normal for all of its corners
 * without any neighbour averaging it away.
 */
function builder() {
  return { position: [], normal: [], uv: [], index: [] }
}

/** The unit normal of the triangle `a → b → c`, counter-clockwise seen from outside. */
function faceNormal(a, b, c) {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz) || 1
  return [nx / len, ny / len, nz / len]
}

/** One triangle, flat-shaded, painted from `cell`. */
function tri(g, a, b, c, cell) {
  const n = faceNormal(a, b, c)
  const [u, v] = cellUv(cell)
  const base = g.position.length / 3
  for (const p of [a, b, c]) {
    g.position.push(p[0], p[1], p[2])
    g.normal.push(n[0], n[1], n[2])
    g.uv.push(u, v)
  }
  g.index.push(base, base + 1, base + 2)
}

/** One planar quad `a → b → c → d`, as two triangles that share the quad's four corners. */
function quad(g, a, b, c, d, cell) {
  const n = faceNormal(a, b, c)
  const [u, v] = cellUv(cell)
  const base = g.position.length / 3
  for (const p of [a, b, c, d]) {
    g.position.push(p[0], p[1], p[2])
    g.normal.push(n[0], n[1], n[2])
    g.uv.push(u, v)
  }
  g.index.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

/** A closed prism: a side per pair of ring points, a fan on each end. */
function prism(g, { radius, sides }, bottom, top, cell) {
  const lower = ring(sides, radius, bottom)
  const upper = ring(sides, radius, top)
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    quad(g, lower[i], upper[i], upper[j], lower[j], cell)
  }
  const capTop = [0, top, 0]
  const capBottom = [0, bottom, 0]
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    tri(g, capTop, upper[j], upper[i], cell)
    tri(g, capBottom, lower[i], lower[j], cell)
  }
}

/** A cone: a side per pair of ring points meeting at the tip, and a fan closing the base. */
function cone(g, { radius, sides }, bottom, top, cell) {
  const base = ring(sides, radius, bottom)
  const apex = [0, top, 0]
  const centre = [0, bottom, 0]
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    tri(g, base[i], apex, base[j], cell)
    tri(g, centre, base[i], base[j], cell)
  }
}

/**
 * Add the torch to `scene` as a node called `name`.
 *
 * @param {import('@gltf-transform/core').Document} doc the packed document, mid-build
 * @param {import('@gltf-transform/core').Scene} scene the scene every packed model is a child of
 * @param {string} name the node name a recipe or the kerb clutter will look it up by
 * @returns {import('@gltf-transform/core').Node} the node that was added
 */
export default function generate(doc, scene, name) {
  const root = doc.getRoot()
  const material = root.listMaterials()[0]
  if (!material) throw new Error(`${name}: the document has no material to paint the torch with`)
  const buffer = root.listBuffers()[0] || doc.createBuffer()

  const g = builder()
  prism(g, POST, 0, POST.top, WOOD)
  prism(g, BAND, BAND.bottom, BAND.top, IRON)
  cone(g, FIRE, FIRE.bottom, FIRE.top, FLAME.cell)

  const primitive = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', doc.createAccessor(`${name}_position`).setType('VEC3').setArray(new Float32Array(g.position)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor(`${name}_normal`).setType('VEC3').setArray(new Float32Array(g.normal)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor(`${name}_uv`).setType('VEC2').setArray(new Float32Array(g.uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor(`${name}_index`).setType('SCALAR').setArray(new Uint16Array(g.index)).setBuffer(buffer))

  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive))
  scene.addChild(node)
  return node
}
