/**
 * Packs the crew rig into one glb: one body and the handful of animations the colony
 * actually plays, or a whole cast of them on a shared skeleton and a shared atlas.
 *
 * The Character Animations pack ships 161 clips across eight files and four megabytes.
 * Bot Crossing has eight behaviours. Everything not on the list below is disposed here rather
 * than downloaded and thrown away in the browser.
 *
 * Both packs are CC0 (Kay Lousberg, kaylousberg.com).
 */
import { NodeIO } from '@gltf-transform/core'
import { dedup, mergeDocuments, prune, unpartition } from '@gltf-transform/functions'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repo root, so `out` means the same thing from any cwd. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Which pack, which clips and where they land all come from the theme's `assets.config.mjs`
 * by way of `build-assets.mjs`, so a second theme can pack its own rig with this same
 * script. The whole `crew` block arrives as one JSON argument with `src` already resolved to
 * an absolute path and `assetsSrc` added, because a cast of eight characters is more
 * configuration than a positional command line can carry legibly. `out` is repo-root-relative
 * (or absolute), so the packer works from any directory.
 *
 * `clips` is `{ 'source file.glb': ['Clip', ...] }` — KayKit's own clip names, which the
 * runtime looks up by name, so it has to agree with `crew.clips` in the manifest.
 */
const [CFG_JSON] = process.argv.slice(2)
if (!CFG_JSON) {
  console.error('usage: build-crew.mjs <json config>')
  process.exit(1)
}
/**
 * @type {{
 *   src: string, rigDir: string, out: string, clips: Record<string, string[]>, assetsSrc?: string,
 *   mannequin?: string,
 *   characters?: {id: string, src: string, texture: string, colourways?: (string|null)[]}[],
 *   cell?: number,
 *   props?: {node: string, src: string}[],
 * }}
 */
const cfg = JSON.parse(CFG_JSON)
const SRC = cfg.src
const ANIMS = join(SRC, cfg.rigDir)
// `resolve(ROOT, abs)` returns an absolute input unchanged, so a config may name either.
const OUT = resolve(ROOT, cfg.out)
const WANTED = cfg.clips

// The raw packs are not checked in — the built glb is. Re-running this without them is
// what happens on a fresh clone, and it should be a no-op rather than a broken install.
if (!existsSync(SRC)) {
  if (existsSync(OUT)) {
    console.log(`build-crew: no source pack, keeping the existing ${OUT}`)
    process.exit(0)
  }
  console.error(`build-crew: missing ${SRC} — see README, "Where the art comes from"`)
  process.exit(1)
}

const io = new NodeIO()

/** A path in a character or prop entry is relative to `ASSETS_SRC`, not to this crew's pack. */
const resolveSrc = (p) => join(cfg.assetsSrc || SRC, p)

/**
 * Several characters on one rig, one atlas.
 *
 * Every Adventurer ships as its own glb with its own rig and its own 1024² texture. The
 * engine wants one skeleton (the bone-matrix bake is shared) and one material (one atlas),
 * so: the first character's rig is kept, every other character's skin is re-bound to it by
 * bone name, each texture is shrunk to a cell and laid into a grid — one row per distinct
 * texture, one column per colourway — and every mesh's UVs are moved into its column-0
 * cell. A colourway is then a per-instance U offset at draw time.
 *
 * Static props (hand tools) ride along under a `props` node, each atlased the same way: a
 * prop painted from a character's sheet lands in that character's row, any other texture
 * gets a row of its own.
 *
 * @param {typeof cfg} cfg
 * @returns {Promise<import('@gltf-transform/core').Document>}
 */
async function assembleCharacters(cfg) {
  // sharp is a native module and the single-body path has no use for it; loading it here
  // keeps the space build to the dependencies it has always had.
  const { default: sharp } = await import('sharp')

  const cell = cfg.cell || 256
  const cols = Math.max(1, ...cfg.characters.map((c) => c.colourways?.length || 1))

  // Rows are allocated in declaration order — characters first, then any prop sheet that is
  // not already one of theirs — so the same config always produces the same atlas.
  const rowNames = []
  const rowOf = (name) => {
    let r = rowNames.indexOf(name)
    if (r < 0) r = rowNames.push(name) - 1
    return r
  }

  /** `texture` may be a bare stem beside the glb, or a path relative to the glb's directory. */
  const textureBase = (c) => join(dirname(resolveSrc(c.src)), c.texture)
  const colourwaysOf = (c) => (c.colourways?.length ? c.colourways : [''])

  const docs = []
  for (const c of cfg.characters) {
    const doc = await io.read(resolveSrc(c.src))
    docs.push({
      spec: c,
      doc,
      row: rowOf(basename(c.texture)),
      // The nodes to claim after merging, recorded now while the document is still its own:
      // every character prefixes its parts with its class, so the names stay unique.
      meshNodes: doc
        .getRoot()
        .listNodes()
        .filter((n) => n.getMesh() && n.getSkin())
        .map((n) => n.getName()),
    })
  }

  const propDocs = []
  for (const p of cfg.props || []) {
    const doc = await io.read(resolveSrc(p.src))
    const tex = doc.getRoot().listTextures()[0]
    const name = basename(tex?.getName() || tex?.getURI() || '').replace(/\.png$/i, '')
    if (!name) throw new Error(`${p.src}: has no texture to atlas`)
    propDocs.push({ spec: p, doc, row: rowOf(name) })
  }
  const rows = rowNames.length

  // ── the atlas ────────────────────────────────────────────────────────────────────────
  // Fixed kernel, fixed compression, no metadata: the same sources have to give the same
  // bytes on every machine, or the committed crew.glb churns on every rebuild.
  const shrink = async (input) => sharp(input).resize(cell, cell, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer()
  const composite = []
  for (const c of docs) {
    const ways = colourwaysOf(c.spec)
    for (let col = 0; col < cols; col++) {
      // A character with fewer variants than the widest one repeats its own list rather
      // than leaving a black cell for `colourwayFor` to land on.
      const file = `${textureBase(c.spec)}${ways[col % ways.length] || ''}.png`
      if (!existsSync(file)) throw new Error(`${c.spec.id}: no texture ${file}`)
      composite.push({ input: await shrink(file), left: col * cell, top: c.row * cell })
    }
  }
  for (const p of propDocs) {
    if (docs.some((c) => c.row === p.row)) continue // a character's sheet, already placed
    const tex = p.doc.getRoot().listTextures()[0]
    const image = tex.getImage()
    if (!image) throw new Error(`${p.spec.src}: texture "${tex.getName()}" has no image data`)
    composite.push({ input: await shrink(Buffer.from(image)), left: 0, top: p.row * cell })
  }
  const atlasPng = await sharp({
    create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite(composite)
    .png({ compressionLevel: 9 })
    .toBuffer()

  // ── merge every character into the first one's document ──────────────────────────────
  const target = docs[0].doc
  const root = target.getRoot()
  const scene = root.getDefaultScene()
  const skeleton = root.listSkins()[0]
  if (!skeleton) throw new Error(`${docs[0].spec.src}: no skin to bind the cast to`)
  const jointNames = skeleton.listJoints().map((j) => j.getName())
  const jointIndex = new Map(jointNames.map((n, i) => [n, i]))
  const bindMatrices = skeleton.getInverseBindMatrices()

  for (const c of docs.slice(1)) mergeDocuments(target, c.doc)
  for (const p of propDocs) mergeDocuments(target, p.doc)

  const texture = target.createTexture('crew_atlas').setImage(atlasPng).setMimeType('image/png')
  const material = target.createMaterial('crew').setBaseColorTexture(texture).setRoughnessFactor(1).setMetallicFactor(0)

  /** Move a primitive's UVs into cell (row, col) of the atlas and paint it from the sheet. */
  const remap = (prim, row, col = 0) => {
    const uv = prim.getAttribute('TEXCOORD_0')
    if (!uv) throw new Error('crew: a primitive to atlas has no TEXCOORD_0')
    const count = uv.getCount()
    const out = new Float32Array(count * 2)
    const el = [0, 0]
    for (let i = 0; i < count; i++) {
      uv.getElement(i, el)
      out[i * 2] = (col + el[0]) / cols
      out[i * 2 + 1] = (row + el[1]) / rows
    }
    prim.setAttribute('TEXCOORD_0', target.createAccessor().setType('VEC2').setArray(out).setBuffer(root.listBuffers()[0]))
    prim.setMaterial(material)
  }

  const byName = (name) => root.listNodes().find((n) => n.getName() === name && n.getMesh() && n.getSkin())

  // Every part is renamed `body_<id>_<node>` below and the manifest claims a character's
  // parts by that prefix, so an id that extends another id with an underscore is ambiguous
  // — `body_knight`'s prefix would also match every `body_knight_archer_*` node.
  for (const a of cfg.characters) {
    for (const b of cfg.characters) {
      if (a === b) continue
      if (`body_${b.id}`.startsWith(`body_${a.id}_`))
        throw new Error(
          `crew: character id "${b.id}" is a prefix-extension of "${a.id}" — parts are matched by the "body_<id>" prefix, so the two casts would overlap`
        )
    }
  }

  for (const c of docs) {
    for (const nodeName of c.meshNodes) {
      const node = byName(nodeName)
      if (!node) throw new Error(`${c.spec.id}: node "${nodeName}" did not survive the merge`)
      rebind(c.spec.id, node, skeleton, jointNames, jointIndex, bindMatrices, target, root)
      for (const prim of node.getMesh().listPrimitives()) remap(prim, c.row, 0)
      node.setName(`body_${c.spec.id}_${nodeName}`)
      scene.addChild(node)
    }
  }

  // Hand tools sit at the origin under one group, so the engine can bake each one in its
  // own frame and hang it off a bone without unwinding a rig it never loaded.
  if (propDocs.length) {
    const propsGroup = target.createNode('props')
    scene.addChild(propsGroup)
    for (const p of propDocs) {
      const node = root.listNodes().find((n) => n.getName() === p.spec.node && n.getMesh() && !n.getSkin())
      if (!node) throw new Error(`${p.spec.src}: no unskinned node named "${p.spec.node}"`)
      for (const prim of node.getMesh().listPrimitives()) remap(prim, p.row, 0)
      propsGroup.addChild(node)
    }
  }

  // Every other rig, scene and material the merges dragged in goes; the pipeline below
  // prunes whatever is no longer reachable from the default scene.
  for (const s of root.listScenes()) if (s !== scene) s.dispose()

  // Root extras survive `prune`/`dedup` and travel with the file, so the grid the atlas was
  // actually packed on is readable by the validator instead of being taken on trust.
  root.setExtras({ ...root.getExtras(), crewAtlas: { cols, rows, cell } })

  console.log(`atlas ${cols * cell}x${rows * cell} — ${cols} colourways x ${rows} rows: ${rowNames.join(', ')}`)
  return target
}

/**
 * Re-bind one skinned node onto the kept skeleton, matching joints by name.
 *
 * The Adventurers all carry the same 23 bones and the same rest pose, but they do not list
 * them in the same order — the Knight walks the spine before the legs and the Engineer does
 * not — so JOINTS_0 has to be rewritten rather than trusted. The inverse bind matrices are
 * checked against the kept rig's while we are here: same names in a different order is a
 * remap, different bind poses would be a silently mangled body.
 */
function rebind(id, node, skeleton, jointNames, jointIndex, bindMatrices, target, root) {
  const skin = node.getSkin()
  if (skin === skeleton) return

  const from = skin.listJoints().map((j) => j.getName())
  if (from.length !== jointNames.length) {
    throw new Error(`${id}: rig has ${from.length} bones, the cast's rig has ${jointNames.length}`)
  }
  const theirs = skin.getInverseBindMatrices()
  const lut = from.map((name, i) => {
    const to = jointIndex.get(name)
    if (to === undefined) throw new Error(`${id}: bone "${name}" is not on the cast's rig`)
    if (bindMatrices && theirs) {
      const a = []
      const b = []
      bindMatrices.getElement(to, a)
      theirs.getElement(i, b)
      for (let k = 0; k < a.length; k++) {
        if (Math.abs(a[k] - b[k]) > 1e-4) throw new Error(`${id}: bone "${name}" has a different bind pose from the cast's rig`)
      }
    }
    return to
  })

  for (const prim of node.getMesh().listPrimitives()) {
    const joints = prim.getAttribute('JOINTS_0')
    if (!joints) throw new Error(`${id}: ${node.getName()} is skinned but has no JOINTS_0`)
    const count = joints.getCount()
    const out = new Uint16Array(count * 4)
    const el = [0, 0, 0, 0]
    for (let i = 0; i < count; i++) {
      joints.getElement(i, el)
      for (let k = 0; k < 4; k++) out[i * 4 + k] = lut[el[k]]
    }
    prim.setAttribute('JOINTS_0', target.createAccessor().setType('VEC4').setArray(out).setBuffer(root.listBuffers()[0]))
  }
  node.setSkin(skeleton)
}

const doc = cfg.characters?.length ? await assembleCharacters(cfg) : await io.read(join(SRC, cfg.mannequin))

for (const [file, clips] of Object.entries(WANTED)) {
  const src = await io.read(join(ANIMS, file))
  const keep = new Set(clips)

  // Drop the unwanted clips *before* merging. Merging first would pull every one of their
  // samplers and accessors into the target document, and prune() cannot tell a disposed
  // animation's buffer from a live one once they share a buffer.
  for (const anim of src.getRoot().listAnimations()) {
    if (!keep.has(anim.getName())) anim.dispose()
  }
  const got = src.getRoot().listAnimations().map((a) => a.getName())
  const missing = clips.filter((c) => !got.includes(c))
  if (missing.length) throw new Error(`${file}: no such clip: ${missing.join(', ')}`)

  mergeDocuments(doc, src)
}

const root = doc.getRoot()
const scene = root.getDefaultScene()

/**
 * Retarget every clip onto the mannequin's own bones.
 *
 * Each animation file ships a full copy of the rig for its channels to drive, and merging
 * brings all of them along — so a merged document ends up with five `hips` nodes and clips
 * that animate the four nobody is looking at. Left alone this loads without a single error
 * and renders the entire crew frozen in its bind pose, which is a miserable thing to debug.
 *
 * The bones are matched by name, which is exactly what a runtime retarget would do, except
 * done once here instead of on every load.
 */
const bones = new Map()
const index = (node) => {
  bones.set(node.getName(), node)
  node.listChildren().forEach(index)
}
scene.listChildren().forEach(index)

let retargeted = 0
let orphaned = 0
for (const anim of root.listAnimations()) {
  for (const channel of anim.listChannels()) {
    const target = channel.getTargetNode()
    if (!target) continue
    const mine = bones.get(target.getName())
    if (!mine) {
      // A channel for something the mannequin has not got — the tool-attachment sockets.
      channel.dispose()
      orphaned++
    } else if (mine !== target) {
      channel.setTargetNode(mine)
      retargeted++
    }
  }
}
console.log(`retargeted ${retargeted} channels, dropped ${orphaned} with no matching bone`)

for (const s of root.listScenes()) {
  if (s !== scene) s.dispose()
}

// Disposing those scenes orphans the duplicate rigs, their meshes and their skins without
// deleting them — prune() leaves meshes and skins alone — so the reachable set is walked
// here and everything else goes.
const live = new Set()
const reach = (node) => {
  live.add(node)
  node.listChildren().forEach(reach)
}
scene.listChildren().forEach(reach)

const liveMeshes = new Set([...live].map((n) => n.getMesh()).filter(Boolean))
const liveSkins = new Set([...live].map((n) => n.getSkin()).filter(Boolean))
for (const node of root.listNodes()) if (!live.has(node)) node.dispose()
for (const mesh of root.listMeshes()) if (!liveMeshes.has(mesh)) mesh.dispose()
for (const skin of root.listSkins()) if (!liveSkins.has(skin)) skin.dispose()

await doc.transform(dedup(), prune({ keepAttributes: false }), unpartition())

// A duplicate name would make three's loader rename one of them at parse time, and the
// clips would miss again — this time silently, so it is worth an assertion.
const names = root.listNodes().map((n) => n.getName())
const dupes = names.filter((n, i) => names.indexOf(n) !== i)
if (dupes.length) throw new Error(`duplicate node names survive: ${[...new Set(dupes)].join(', ')}`)

console.log(`animations ${root.listAnimations().length}`)
for (const a of root.listAnimations()) {
  const end = Math.max(...a.listSamplers().map((s) => s.getInput()?.getMax([])[0] ?? 0))
  console.log(`  ${a.getName().padEnd(20)} ${end.toFixed(2)}s`)
}
console.log(`meshes     ${root.listMeshes().length}`)
console.log(`skins      ${root.listSkins().map((s) => s.listJoints().length + ' joints').join(', ')}`)

mkdirSync(dirname(OUT), { recursive: true })
await io.write(OUT, doc)
