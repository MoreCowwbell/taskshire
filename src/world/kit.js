import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * The model kits — KayKit's *Space Base Bits* and *Forest Nature Pack* (both CC0), each
 * packed into one glb by `tools/build-kit.mjs` and loaded exactly once here.
 *
 * Their shared design is what makes them worth building on: every model in a pack UVs into
 * a single 1024px gradient atlas and therefore shares a single material, so a colony
 * assembled out of one collapses to the same one-draw-call-per-building shape the
 * procedural generators had. Nothing downstream needs to know a model came from a file
 * rather than a primitive — `part()` hands back a plain BufferGeometry with its node
 * transform already baked in.
 *
 * The base kit's atlas is an 8x4 grid of gradient swatches and every model UVs into it, so
 * a *cell index* is a stable name for a material. That is what lets the building shader
 * repaint one swatch — the gold trim band, cell 11 — into each repo's accent colour without
 * touching a texture or splitting the mesh.
 *
 * Which kits exist, how their atlas is divided, which cells are worth naming and how each
 * one behaves under light are all theme data: `configureKits` fills the registry from the
 * manifest before anything asks for a part.
 *
 * The two kits keep separate part registries because they have separate atlases: a geometry
 * can only carry one material, so a habitat and a fir tree can never merge into one mesh.
 */

/**
 * Filled by `configureKits` from the theme manifest before `loadKit` runs. Files are served
 * straight out of `public/`, not bundled — a glb is opaque to Vite and there is nothing to
 * gain from hashing a file the loader fetches by hand anyway.
 */
let KITS = {}
let assetUrl = (file) => `${import.meta.env.BASE_URL}assets/${file}`

let loading = null

/**
 * Install a theme's kit table. Must run before `loadKit()`.
 *
 * @param {Record<string, object>} kits    `manifest.kits`
 * @param {(file: string) => string} urlFor  the theme's `assetUrl`
 */
export function configureKits(kits, urlFor) {
  if (urlFor) assetUrl = urlFor
  KITS = {}
  for (const [name, spec] of Object.entries(kits || {})) {
    // `grid`, not `atlas`: the manifest's `atlas` is the cell layout, while `atlas` on a
    // loaded kit is the texture itself, which `atlasTexture` hands to every material.
    KITS[name] = {
      ...spec,
      grid: spec.atlas || { cols: 8, rows: 4 },
      parts: new Map(),
      solo: new Map(),
      atlas: null,
      // A kit `loadKit()` leaves alone, for `loadLazyKit` to fetch the first time something
      // needs it, and the promise that fetch is memoised on. See `loadLazyKit`.
      lazy: Boolean(spec.lazy),
      loading: null,
      // The named seasonal sheets the manifest declares, and their decoded images once
      // loaded. A kit that declares none keeps both empty and never swaps.
      atlases: spec.atlases || null,
      images: new Map(),
    }
  }
  loading = null
}

/**
 * Load every kit that is not `lazy`. Idempotent, and safe to call from several places — the
 * first call owns the requests and everybody else awaits the same promise.
 */
export function loadKit() {
  if (!loading) {
    const loader = new GLTFLoader()
    loading = Promise.all(
      Object.values(KITS)
        .filter((kit) => !kit.lazy)
        .map((kit) => loader.loadAsync(assetUrl(kit.file)).then((gltf) => absorb(gltf, kit)))
    ).then(() => KITS)
  }
  return loading
}

/**
 * Load one kit `loadKit()` deliberately skipped, and hand back the kit record.
 *
 * Memoised on the kit itself rather than in the module's one `loading`, so several callers
 * — and several plots starting to fade in the same frame — share the one request, while the
 * kits that did load at boot are untouched.
 *
 * The point of the lazy half is what a kit costs *before* anybody looks at it. Harvesting a
 * glb builds a geometry per node, and three stamps every geometry, material and texture with
 * a `generateUUID` that spends four draws of `Math.random` — which under the snapshot harness
 * is the one seeded stream the villagers are seated from. A kit that is registered and never
 * loaded spends nothing, so a theme can declare dressing that most worlds never allocate.
 *
 * @param {string} name  a key of the theme's `kits`
 * @returns {Promise<object>} the kit record, with `parts` and `solo` filled
 */
export function loadLazyKit(name) {
  const kit = KITS[name]
  if (!kit) return Promise.reject(new Error(`kit: no kit named "${name}"`))
  if (!kit.loading) {
    kit.loading = new GLTFLoader()
      .loadAsync(assetUrl(kit.file))
      .then((gltf) => absorb(gltf, kit))
      .then(() => kit)
  }
  return kit.loading
}

/**
 * Take a loaded glb into a kit record: bake every node into `parts` and `solo`, keep the
 * atlas texture, and decode any seasonal sheets it declares.
 *
 * Shared by both loaders so a lazy kit is a kit in every respect — `hasPart` and `part` read
 * the same tables whichever door it came in through.
 */
function absorb(gltf, kit) {
  gltf.scene.updateMatrixWorld(true)
  for (const node of gltf.scene.children) harvest(node, kit)
  kit.atlas = findAtlas(gltf.scene)
  if (kit.atlases) return loadAtlasImages(gltf, kit)
}

/**
 * Bake one node into geometry in its own local frame, twice.
 *
 * `parts` gets the node *with* everything under it, which is what a recipe usually wants —
 * a rover arrives with its wheels on. `solo` gets the node's own mesh alone, which is what
 * a recipe wants when a sub-part has to move independently: the pack names a turbine's
 * rotor and a garage's door separately precisely because those are the bits that turn and
 * slide, and a spinning rotor has to be built from a tower that has not already got one.
 *
 * Sub-nodes are harvested as parts in their own right as well.
 */
function harvest(node, kit) {
  const inverse = new THREE.Matrix4().copy(node.matrixWorld).invert()
  const bake = (mesh) => {
    const geo = mesh.geometry.clone()
    // Into the *node's* frame, not the scene's, so a part drops in at its own origin.
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
    return normalize(geo, Boolean(kit.vertexColors))
  }

  const all = []
  node.traverse((child) => {
    if (child.isMesh) all.push(bake(child))
  })

  if (all.length) {
    const merged = all.length === 1 ? all[0].clone() : BufferGeometryUtils.mergeGeometries(all, false)
    merged.computeBoundingBox()
    kit.parts.set(node.name, merged)
  }
  if (node.isMesh) {
    const own = bake(node)
    own.computeBoundingBox()
    kit.solo.set(node.name, own)
  }
  all.forEach((g) => g.dispose())

  for (const child of node.children) harvest(child, kit)
}

/**
 * Reduce a loaded primitive to exactly `position`, `normal` and `uv`, each a plain float
 * attribute of its own.
 *
 * Merging is unforgiving about this. glTF is free to interleave attributes into one buffer
 * view, to store UVs as normalised shorts, and to omit a channel a given mesh does not use
 * — and `mergeGeometries` refuses any set that does not match exactly, which is how a
 * building of eight parts ends up as no building at all. Rebuilding each channel is cheap
 * (it happens once, at load) and it means a recipe can mix any two models in the pack.
 */
function normalize(geo, keepColor = false) {
  const out = new THREE.BufferGeometry()
  const count = geo.attributes.position.count

  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['uv', 2],
    // Only a vertex-coloured kit keeps this, and only where the model carries it; an atlas
    // kit never gets the channel even if its file happens to have one, so every atlas kit's
    // geometry — and with it every theme that uses none — is exactly what it was.
    ['color', 3],
  ]) {
    const src = geo.getAttribute(name)
    if (name === 'color' && (!keepColor || !src)) continue
    const data = new Float32Array(count * size)
    if (src) {
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < size; k++) data[i * size + k] = src.getComponent(i, k)
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size))
  }

  if (geo.index) out.setIndex(Array.from(geo.index.array))
  if (!geo.getAttribute('normal')) out.computeVertexNormals()
  geo.dispose()
  return out
}

/**
 * The seasonal atlases the packer embedded as extra sheets. Nothing in the scene references
 * them, so GLTFLoader never parses them on its own and they are pulled off the parser by
 * hand — and only their *images* are kept: the material's texture stays the one object every
 * material shares, and a season is that texture with another image.
 *
 * They are looked up as glTF *images* rather than as textures. An unreferenced sheet reaches
 * the file as an entry in `images` with a name on it and no entry in `textures` at all —
 * glTF only lists a texture that some material samples — so `getDependency('texture', …)`
 * has nothing to resolve. `loadImageSource` decodes the image on its own, which is all that
 * is wanted here.
 */
async function loadAtlasImages(gltf, kit) {
  const parser = gltf.parser
  const byName = new Map((parser.json.images || []).map((img, i) => [img.name, i]))
  for (const [season, imageName] of Object.entries(kit.atlases)) {
    const index = byName.get(imageName)
    if (index === undefined) {
      throw new Error(`kit: ${kit.file} has no texture image named "${imageName}" for atlas "${season}"`)
    }
    const tex = await parser.loadImageSource(index, parser.textureLoader)
    kit.images.set(season, tex.image)
  }
}

/**
 * Put a season on every kit that has one. The atlas texture object is shared by every
 * material in the theme, so replacing its image re-skins buildings, scatter, clutter and
 * the ceremony in one upload. Kits without `atlases` are left alone; a name a kit does not
 * know falls back to its first declared atlas.
 */
export function setKitAtlas(name) {
  for (const kit of Object.values(KITS)) {
    if (!kit.atlases || !kit.atlas) continue
    const key = name && kit.images.has(name) ? name : Object.keys(kit.atlases)[0]
    const image = kit.images.get(key)
    if (!image || kit.atlas.image === image) continue
    kit.atlas.image = image
    kit.atlas.needsUpdate = true
  }
}

function findAtlas(scene) {
  let texture = null
  scene.traverse((o) => {
    if (!texture && o.isMesh && o.material?.map) texture = o.material.map
  })
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace
    // Swatches are gradients that fill a whole cell; filtering across a cell boundary
    // bleeds one material into the next along every UV seam in the pack.
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = 4
  }
  return texture
}

/**
 * A part's geometry, cloned so callers may transform it freely. Unknown names throw.
 *
 * `solo` leaves the node's children behind — the tower without its rotor, the garage
 * without its door.
 */
export function part(name, kit = 'base', { solo = false } = {}) {
  const geo = (solo ? KITS[kit]?.solo : KITS[kit]?.parts)?.get(name)
  if (!geo) throw new Error(`kit: no ${solo ? 'solo ' : ''}part named "${name}" in the ${kit} kit`)
  return geo.clone()
}

export function hasPart(name, kit = 'base') {
  return KITS[kit]?.parts.has(name) ?? false
}

/**
 * Whether a part can be taken `solo`. `harvest` fills `solo` only for a node that is itself
 * a mesh, so a multi-primitive node is a part but not a solo part.
 */
export function hasSolo(name, kit = 'base') {
  return KITS[kit]?.solo.has(name) ?? false
}

export function atlasTexture(kit = 'base') {
  return KITS[kit]?.atlas ?? null
}

/** Columns and rows in a kit's gradient atlas. */
export function atlasGrid(kit = 'base') {
  return KITS[kit]?.grid ?? { cols: 8, rows: 4 }
}

/**
 * Whether a kit paints with vertex colours instead of an atlas — the space theme's `nature`
 * kit (Kenney's Nature Kit, packed by `tools/build-nature.mjs`), declared in its manifest
 * with `vertexColors: true`. Every atlas kit answers false.
 */
export function kitUsesVertexColors(kit = 'base') {
  return Boolean(KITS[kit]?.vertexColors)
}

/** Whether a kit has finished loading, so a recipe can fall back rather than throw. */
export function kitReady(kit = 'base') {
  return (KITS[kit]?.parts.size ?? 0) > 0
}

/**
 * A named cell's index. Unknown names throw — a theme that misspells a swatch says so at
 * configure time rather than painting the wrong material.
 */
export function cellIndex(kit, name) {
  const idx = KITS[kit]?.cells?.[name]
  if (idx === undefined) throw new Error(`kit: no cell named "${name}" in the ${kit} kit`)
  return idx
}

/**
 * A mask, one float per atlas cell, uploaded as a uniform array. Shaders index it by cell
 * rather than sampling a second texture, which keeps the whole idea to 128 bytes.
 */
function cellMask(cells, value = 1, kit = 'base') {
  const { cols, rows } = atlasGrid(kit)
  const mask = new Float32Array(cols * rows)
  for (const cell of cells) mask[cell] = value
  return mask
}

/** The swatches the accent repaints, as a mask. */
export function accentMask(kit = 'base') {
  return cellMask(
    (KITS[kit]?.accentCells || []).map((n) => cellIndex(kit, n)),
    1,
    kit
  )
}

/**
 * Roughness, metalness and self-emission per cell. Defaults are Kay's own (0.6, 0) and no
 * glow; a kit that declares only some of the three leaves the rest at the default.
 */
export function pbrTables(kit = 'base') {
  const { cols, rows } = atlasGrid(kit)
  const n = cols * rows
  const roughness = new Float32Array(n).fill(0.6)
  const metalness = new Float32Array(n).fill(0.0)
  const emissive = new Float32Array(n * 3)
  const emissiveIntensity = new Float32Array(n)
  for (const [cell, v] of Object.entries(KITS[kit]?.pbr || {})) {
    if (v.roughness !== undefined) roughness[cell] = v.roughness
    if (v.metalness !== undefined) metalness[cell] = v.metalness
    if (v.emissive !== undefined) {
      const c = new THREE.Color(v.emissive)
      emissive[cell * 3] = c.r
      emissive[cell * 3 + 1] = c.g
      emissive[cell * 3 + 2] = c.b
      emissiveIntensity[cell] = v.emissiveIntensity ?? 1
    }
  }
  return { roughness, metalness, emissive, emissiveIntensity }
}

/**
 * How hard a kit's accent cells glow after dark, as a multiplier on the night term.
 *
 * The default is the space theme's own long-standing literal, so a kit that says nothing
 * computes exactly the product it always did. A theme lights its trim to suit its own
 * fiction: a habitat's window strips are electric light and want the full value, a
 * thatched roof lit by torches wants a fraction of it.
 */
export function accentGlow(kit = 'base') {
  const v = KITS[kit]?.accentGlow
  return typeof v === 'number' ? v : 1.15
}

/** Whether any cell of a kit glows on its own. Decides whether shaders carry the term at all. */
export function hasEmissive(kit = 'base') {
  return Object.values(KITS[kit]?.pbr || {}).some((v) => v.emissive !== undefined)
}

/** GLSL for the per-cell emissive term. `cellExpr` names an `int` holding the atlas cell. */
export function emissiveChunk(cellExpr) {
  return `totalEmissiveRadiance += uCellEmissive[ ${cellExpr} ] * uCellEmissiveIntensity[ ${cellExpr} ];`
}

/**
 * Give a plain atlas material the per-cell glow. Used by anything that draws kit parts
 * without the building shader — the kerb clutter, a ceremony built from parts. Does nothing
 * at all for a kit with no emissive cell, so the space materials compile unchanged: no
 * `onBeforeCompile`, no cache key, the same object handed straight back.
 */
export function decorateCellEmissive(material, kit = 'base') {
  if (!hasEmissive(kit)) return material
  const { cols, rows } = atlasGrid(kit)
  const tables = pbrTables(kit)
  // The plot that owns this material flips it when the zone fades; a material nobody
  // flips (the ceremony's parts) keeps its lights on.
  const lightsOut = { value: 0 }
  material.userData.uLightsOut = lightsOut
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader) => {
    prev?.(shader)
    shader.uniforms.uCellEmissive = { value: tables.emissive }
    shader.uniforms.uCellEmissiveIntensity = { value: tables.emissiveIntensity }
    shader.uniforms.uLightsOut = lightsOut
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n         varying vec2 vCellUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n         vCellUv = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec2 vCellUv;
         uniform vec3 uCellEmissive[ ${cols * rows} ];
         uniform float uCellEmissiveIntensity[ ${cols * rows} ];
         uniform float uLightsOut;

         // Which swatch of the gradient atlas this fragment landed in.
         int cellOf( vec2 uv ) {
           int cx = int( clamp( floor( uv.x * ${cols}.0 ), 0.0, ${cols - 1}.0 ) );
           int cy = int( clamp( floor( uv.y * ${rows}.0 ), 0.0, ${rows - 1}.0 ) );
           return cy * ${cols} + cx;
         }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         int cellE = cellOf( vCellUv );
         ${emissiveChunk('cellE')}
         totalEmissiveRadiance *= 1.0 - uLightsOut;`
      )
  }
  // Compose rather than replace: three's own key carries the material's compile-time flags,
  // and dropping it would let two materials that differ only in those flags share a program.
  const prevKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `${prevKey()}|cellEmissive:${kit}`
  return material
}
