/**
 * Packs a KayKit asset pack into one glb.
 *
 * Both packs the colony uses are built the same way: a directory of single-model .gltf
 * files that all reference one gradient atlas. Loading them as shipped would be a request
 * per model for what is, in the end, a single material and a bag of geometry — so they are
 * merged here into one document with one texture, and every model kept as a named scene
 * node the runtime can look up.
 *
 * Usage: build-kit.mjs <json config>
 * `{ src, out, models, subdirs, atlases, generated, assetsSrc }`, with `src` absolute,
 * `out` and `generated[].module` repo-root-relative (or absolute), and `models` null for
 * "everything in the directory".
 */
import { NodeIO } from '@gltf-transform/core'
import { dedup, mergeDocuments, prune, unpartition, weld } from '@gltf-transform/functions'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findModel } from './kit-read.mjs'

/** The repo root, so `out` and generated modules mean the same thing from any cwd. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const [CFG_JSON] = process.argv.slice(2)
if (!CFG_JSON) {
  console.error('usage: build-kit.mjs <json config>')
  process.exit(1)
}
/**
 * @type {{
 *   src: string, out: string, models?: string[] | null, subdirs?: boolean,
 *   atlases?: Record<string, string>,
 *   generated?: {module: string, name: string}[],
 *   assetsSrc?: string,
 * }}
 */
const cfg = JSON.parse(CFG_JSON)
const SRC = cfg.src
// `resolve(ROOT, abs)` returns an absolute input unchanged, so a config may name either.
const OUT = resolve(ROOT, cfg.out)

// The raw packs are not checked in — the built glb is. Re-running this without them is what
// happens on a fresh clone, and it should be a no-op rather than a broken install.
if (!existsSync(SRC)) {
  if (existsSync(OUT)) {
    console.log(`build-kit: no source pack, keeping the existing ${OUT}`)
    process.exit(0)
  }
  console.error(`build-kit: missing ${SRC} — see README, "Where the art comes from"`)
  process.exit(1)
}

/**
 * The models to pack, in a stable order.
 *
 * A flat pack is read straight out of `src`. A pack that files its models by category —
 * the Medieval Hexagon pack keeps buildings, tiles and decoration in separate folders — is
 * searched recursively instead, so a config names *what* to pack and never where it sits.
 * Either way the list is sorted by file name, because merge order decides the bytes of the
 * output and a directory listing is not a promise.
 *
 * @returns {string[]} paths, ascending by base name
 */
function discover() {
  const entries = []
  if (cfg.models) {
    for (const name of cfg.models) {
      const file = cfg.subdirs ? findModel(SRC, name) : existsSync(join(SRC, `${name}.gltf`)) ? join(SRC, `${name}.gltf`) : null
      if (file) entries.push({ base: `${name}.gltf`, file })
    }
    const missing = cfg.models.filter((n) => !entries.some((e) => e.base === `${n}.gltf`))
    if (missing.length) throw new Error(`${SRC}: no such model: ${missing.join(', ')}`)
  } else if (cfg.subdirs) {
    for (const e of readdirSync(SRC, { withFileTypes: true, recursive: true })) {
      if (e.isFile() && e.name.endsWith('.gltf')) entries.push({ base: e.name, file: join(e.parentPath ?? e.path, e.name) })
    }
  } else {
    for (const f of readdirSync(SRC)) if (f.endsWith('.gltf')) entries.push({ base: f, file: join(SRC, f) })
  }
  entries.sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0))
  return entries.map((e) => e.file)
}

const files = discover()
if (!files.length) throw new Error(`${SRC}: nothing to pack`)

const io = new NodeIO()
const doc = await io.read(files[0])
const scene = doc.getRoot().getDefaultScene()

for (const file of files.slice(1)) {
  mergeDocuments(doc, await io.read(file))
}

// mergeDocuments brings each source document's scene along with it; fold them all into the
// first so the result is one scene of named nodes rather than one scene per model.
for (const s of doc.getRoot().listScenes()) {
  if (s === scene) continue
  for (const child of s.listChildren()) scene.addChild(child)
  s.dispose()
}

// Hand-authored parts — the torch nobody drew — are added here, before the transforms, so
// weld and dedup treat them exactly like a packed model.
for (const g of cfg.generated || []) {
  const { default: generate } = await import(pathToFileURL(resolve(ROOT, g.module)).href)
  await generate(doc, scene, g.name)
}

await doc.transform(
  weld(),
  dedup(), // every model carries its own copy of one atlas and one material
  prune(),
  unpartition() // merged documents each bring their own buffer; a glb may only have one
)

/**
 * The seasonal repaints, embedded as extra textures nothing references.
 *
 * They go in *after* the transforms — `prune` would drop an unreferenced texture and
 * `unpartition` has already settled the buffer — and are named after the file they came
 * from, which is the name `kits.<k>.atlases` in a manifest matches them by.
 */
const baseTexture = doc.getRoot().listTextures()[0]
const baseSize = baseTexture?.getSize?.() || null
for (const rel of Object.values(cfg.atlases || {})) {
  const file = join(cfg.assetsSrc || SRC, rel)
  if (!existsSync(file)) throw new Error(`${OUT}: no atlas image ${file}`)
  const name = basename(file).replace(/\.png$/i, '')
  if (doc.getRoot().listTextures().some((t) => t.getName() === name)) continue
  const texture = doc.createTexture(name).setImage(readFileSync(file)).setMimeType('image/png')
  // A season is swapped in by handing the same UVs a different image, so a sheet on another
  // grid does not repaint the kit — it slices every mesh's cell out of the wrong place.
  const size = texture.getSize()
  if (baseSize && size && (size[0] !== baseSize[0] || size[1] !== baseSize[1]))
    throw new Error(
      `${OUT}: atlas "${name}" is ${size[0]}x${size[1]} but the kit atlas is ${baseSize[0]}x${baseSize[1]} — every sheet must repaint the same grid`
    )
}

const root = doc.getRoot()
console.log(
  `${basename(OUT)}: ${scene.listChildren().length} nodes, ${root.listMaterials().length} material, ${root.listTextures().length} texture`
)

mkdirSync(dirname(OUT), { recursive: true })
await io.write(OUT, doc)
