/**
 * Reads a built kit glb the way the engine reads it: named nodes, which atlas cells their
 * geometry actually samples, the skeleton's bones and the clips.
 *
 * Pure gltf-transform — no three — so `validate-kit`, `inspect-kit` and `node --test` all
 * share one reader and none of them needs a browser.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'

/**
 * Which atlas cells a primitive samples, by bucketing the *mean* UV of every triangle.
 *
 * The atlas is a grid of flat swatches, so a triangle sits wholly inside one cell and its
 * centroid names that cell. Sampling the centroid rather than the three corners is what
 * keeps a vertex that lands exactly on a cell boundary from claiming a neighbour it never
 * paints.
 *
 * @param {import('@gltf-transform/core').Primitive} prim
 * @param {number} cols
 * @param {number} rows
 * @returns {number[]} cell indices, ascending
 */
function cellsOf(prim, cols, rows) {
  const uv = prim.getAttribute('TEXCOORD_0')
  const idx = prim.getIndices()
  if (!uv) return []
  const n = idx ? idx.getCount() : uv.getCount()
  const at = (i) => (idx ? idx.getScalar(i) : i)
  const seen = new Set()
  const u = [0, 0]
  for (let i = 0; i + 2 < n; i += 3) {
    let su = 0
    let sv = 0
    for (let k = 0; k < 3; k++) {
      uv.getElement(at(i + k), u)
      su += u[0]
      sv += u[1]
    }
    const cu = Math.min(cols - 1, Math.max(0, Math.floor((su / 3) * cols)))
    const cv = Math.min(rows - 1, Math.max(0, Math.floor((sv / 3) * rows)))
    seen.add(cv * cols + cu)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * `primitives` is how many glTF primitives the node's mesh holds, which decides what three's
 * loader builds for it: one primitive becomes a `Mesh`, several become a `Group` of meshes.
 * That distinction is invisible to a recipe that asks for the node whole and fatal to one
 * that asks for it `solo` — `kit.js` only ever fills its solo table from a `Mesh` — so the
 * count is carried out of here for the validator to hold recipes against.
 *
 * `textures` is the glTF *image* names, in the order the file lists them. gltf-transform's
 * `Texture` is the image, so `getName()` is `images[].name` — which is exactly what `kit.js`
 * matches a manifest's `atlases` values against when it pulls a season off the parser.
 *
 * `statics` names every mesh node with no skin. In a kit glb that is all of them; in a crew
 * glb it is only the hand tools the packer parked beside the bodies.
 *
 * @param {string} path  a built .glb
 * @param {{cols: number, rows: number}} atlas  the kit's atlas grid
 * `extras` is the glb's root `extras` object — where `build-crew` records the crew atlas
 * grid it packed, so a manifest's `crew.colourways` can be checked against the real file.
 *
 * @returns {Promise<{nodes: Map<string, {cells: number[], primitives: number}>, bones: string[], clips: string[], textures: string[], statics: string[], extras: object, atlas: {width: number, height: number} | null}>}
 */
export async function readKit(path, atlas = { cols: 8, rows: 4 }) {
  const doc = await new NodeIO().read(path)
  const root = doc.getRoot()
  const nodes = new Map()
  const statics = []
  const walk = (node) => {
    const mesh = node.getMesh()
    if (mesh) {
      const prims = mesh.listPrimitives()
      const cells = new Set()
      for (const p of prims) for (const c of cellsOf(p, atlas.cols, atlas.rows)) cells.add(c)
      nodes.set(node.getName(), { cells: [...cells].sort((a, b) => a - b), primitives: prims.length })
      if (!node.getSkin()) statics.push(node.getName())
    }
    node.listChildren().forEach(walk)
  }
  root.listScenes().forEach((s) => s.listChildren().forEach(walk))
  const bones = [...new Set(root.listSkins().flatMap((s) => s.listJoints().map((j) => j.getName())))]
  const clips = root.listAnimations().map((a) => a.getName())
  const textures = root.listTextures().map((t) => t.getName() || '')
  const tex = root.listTextures()[0]
  const size = tex?.getSize?.() || null
  return { nodes, bones, clips, textures, statics, extras: root.getExtras(), atlas: size ? { width: size[0], height: size[1] } : null }
}

/**
 * Find `<name>.gltf` anywhere under `dir`.
 *
 * The source packs nest their models several directories deep and inconsistently — a model
 * named in a packer config says *what* to pack, not where it sits — so the packer looks the
 * file up by name rather than making every config carry a path.
 *
 * @param {string} dir   directory to search, recursively
 * @param {string} name  the model's base name, without the extension
 * @returns {string | null} the path to the file, or null when the tree has not got it
 */
export function findModel(dir, name) {
  const want = `${name}.gltf`
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  // Files before directories, so a match beside the entry point wins over a deeper one.
  for (const e of entries) if (e.isFile() && e.name === want) return join(dir, e.name)
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const hit = findModel(join(dir, e.name), name)
    if (hit) return hit
  }
  return null
}
