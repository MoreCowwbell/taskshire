/**
 * Checks a theme's built kits against its manifest: every node a recipe, a scatter table or
 * the kerb clutter names exists in the kit it is looked up in, every declared atlas cell is
 * actually painted by some geometry, the crew rig has the attachment bones, and every clip
 * the engine plays is in the crew glb.
 *
 * The manifest's own shape is checked first by `src/themes/schema.js`, the same function the
 * app runs at theme load — so a missing field is reported here in the words the boot path
 * would use, and only a manifest that passes it is held against the glbs.
 *
 * Usage: validate-kit.mjs <themeId>   (non-zero exit, one line per failure)
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readKit } from './kit-read.mjs'
import { REQUIRED_KITS, validateManifest } from '../src/themes/schema.js'

/**
 * Every node name a recipe can produce, without running it.
 *
 * `let` steps bind a name to a node prefix and the two arms of an `if` bind it differently,
 * so bindings are sets and the arms are walked on copies whose results are unioned back:
 * after `if … then tower='windturbine_tall' else tower='windturbine_low'`, a later
 * `{ node: { var: 'tower', suffix: '_fan' } }` has to check *both* fan nodes.
 *
 * @param {object[]} steps
 * @param {Map<string, Set<string>>} vars
 * @param {Set<string>} out    node names
 * @param {Set<string>} unresolved   variables used as a node with nothing bound to them
 * @param {Set<string>} solo   node names a step asks for *solo*
 */
function nodeNames(steps, vars = new Map(), out = new Set(), unresolved = new Set(), solo = new Set()) {
  for (const s of steps) {
    if ('let' in s) {
      if ('value' in s) vars.set(s.let, new Set([s.value]))
      continue
    }
    if ('if' in s) {
      const copy = () => new Map([...vars].map(([k, v]) => [k, new Set(v)]))
      const arms = [copy(), copy()]
      nodeNames(s.then || [], arms[0], out, unresolved, solo)
      nodeNames(s.else || [], arms[1], out, unresolved, solo)
      for (const arm of arms) {
        for (const [k, v] of arm) {
          const cur = vars.get(k) || new Set()
          for (const x of v) cur.add(x)
          vars.set(k, cur)
        }
      }
      continue
    }
    const n = s.node ?? s.ring?.node ?? s.grid?.node
    if (n === undefined || n === null) continue
    const mine = new Set()
    if (typeof n === 'string') mine.add(n)
    else if (Array.isArray(n)) n.forEach((x) => mine.add(x))
    else if (n.var) {
      const bound = vars.get(n.var)
      if (!bound?.size) unresolved.add(n.var)
      else for (const base of bound) mine.add(`${base}${n.suffix || ''}`)
    }
    for (const name of mine) {
      out.add(name)
      if (s.solo) solo.add(name)
    }
  }
  return { out, unresolved, solo }
}

/**
 * Holds a manifest against the glbs sitting in `dir`.
 *
 * Split out from the command line so `tests/kit-read.test.mjs` can run it over the real
 * space kits with a deliberately broken manifest.
 *
 * @param {object} manifest
 * @param {string} dir  where the theme's built glbs live, e.g. `public/assets/space`
 * @returns {Promise<{errors: string[], kits: Record<string, object>}>}
 */
export async function checkKit(manifest, dir) {
  const errors = []
  const kits = {}

  for (const [name, spec] of Object.entries(manifest.kits || {})) {
    const path = join(dir, spec.file)
    if (!existsSync(path)) {
      errors.push(`kits.${name}: ${path} does not exist`)
      continue
    }
    kits[name] = await readKit(path, spec.atlas)
    const used = new Set([...kits[name].nodes.values()].flatMap((n) => n.cells))
    for (const [cell, idx] of Object.entries(spec.cells || {})) {
      // "Used" means some triangle's UVs land in the cell. A cell only ever reached by the
      // accent repaint would still be listed here, because the shader recolours cells the
      // geometry already samples rather than moving UVs — so an unused cell is a cell no
      // model in this kit paints, and naming it can only mislead the next recipe.
      if (!used.has(idx)) errors.push(`kits.${name}.cells.${cell}: cell ${idx} is not sampled by any mesh in ${spec.file}`)
    }
    // Same argument for a glow: an emissive override on a cell no triangle lands in lights
    // nothing, and reads in the manifest as a lamp the theme thinks it has.
    for (const [cell, v] of Object.entries(spec.pbr || {})) {
      if (v?.emissive === undefined) continue
      if (!used.has(+cell)) errors.push(`kits.${name}.pbr.${cell}: emissive cell ${+cell} is not sampled by any mesh in ${spec.file}`)
    }
    // A season names a glTF image the packer embedded. `setKitAtlas` falls back to the kit's
    // first atlas when it cannot find one, so a typo here swaps in the wrong season rather
    // than throwing — which is why the name is held against the file.
    for (const [season, img] of Object.entries(spec.atlases || {})) {
      if (!kits[name].textures.includes(img)) errors.push(`kits.${name}.atlases.${season}: no texture image named "${img}" in ${spec.file}`)
    }
  }

  // The two kit names the engine hardcodes. A theme may ship more, but a theme without these
  // builds no buildings and plants no scatter, so their absence is an error rather than a
  // reason to skip the checks below.
  for (const [name, why] of Object.entries(REQUIRED_KITS)) {
    if (!manifest.kits?.[name]) errors.push(`kits.${name}: missing — ${why}`)
  }

  if (kits.base) {
    for (const [kind, recipe] of Object.entries(manifest.buildings?.kinds || {})) {
      const { out, unresolved, solo } = nodeNames(recipe.parts || [])
      for (const v of unresolved) errors.push(`buildings.kinds.${kind}: node variable "${v}" is never bound`)
      for (const n of out) if (!kits.base.nodes.has(n)) errors.push(`buildings.kinds.${kind}: no node "${n}" in the base kit`)
      // `solo` means "this node's own mesh, without its children", and `kit.js` fills that
      // table only from a three `Mesh`. A node whose glTF mesh holds several primitives
      // arrives as a `Group` of meshes instead, so the name resolves here and throws at the
      // first build — the one failure that passes a validator and still breaks the app.
      for (const n of solo) {
        const prims = kits.base.nodes.get(n)?.primitives ?? 1
        if (prims > 1)
          errors.push(
            `buildings.kinds.${kind}: node "${n}" is asked for solo but has ${prims} primitives — three's loader makes that a Group, and only a Mesh can be taken solo`
          )
      }
    }
    for (const n of manifest.plots?.clutter || []) if (!kits.base.nodes.has(n)) errors.push(`plots.clutter: no node "${n}" in the base kit`)
  }
  // A scatter entry is looked up in the kit it names — `kit`, since the space theme's nature
  // kit arrived with upstream's worlds (2026-09-24) — and in `forest` when it names none.
  for (const [name, list] of Object.entries(manifest.scatter || {})) {
    for (const r of list) {
      const kitName = r.kit || 'forest'
      const kit = kits[kitName]
      if (kit && !kit.nodes.has(r.part)) errors.push(`scatter.${name}: no node "${r.part}" in the ${kitName} kit`)
    }
  }

  // What a ghost town grows over itself. Every name in the block is looked up in one kit of
  // the theme's own choosing rather than in `base`, because the dressing is usually a kit of
  // its own and a lazy one at that — nothing loads it until a zone fades, so a name that is
  // not in it would otherwise throw on the first ghost and nowhere else.
  if (manifest.decay) {
    const decay = manifest.decay
    const kit = kits[decay.kit]
    if (!kit) errors.push(`decay.kit: no kit named "${decay.kit}"`)
    else {
      const check = (name, where) => {
        if (!kit.nodes.has(name)) errors.push(`${where}: no node "${name}" in kit "${decay.kit}"`)
      }
      for (const n of decay.scatter || []) check(n, 'decay.scatter')
      // The keys are clutter the base kit places; only what they are swapped *for* has to be
      // in the decay kit.
      for (const n of Object.values(decay.swap || {})) check(n, 'decay.swap')
      const { out, unresolved, solo } = nodeNames(decay.ruin?.parts || [])
      for (const v of unresolved) errors.push(`decay.ruin: node variable "${v}" is never bound`)
      for (const n of out) check(n, 'decay.ruin')
      // The ruin is a recipe like a building's and goes through the same composer, so the solo
      // trap is the same one: a node of several primitives loads as a `Group`, `kit.js` fills
      // `solo` only from a `Mesh`, and the name resolves here and throws at the first building
      // that falls down — late, and only for a theme somebody has left alone long enough.
      for (const n of solo) {
        const prims = kit.nodes.get(n)?.primitives ?? 1
        if (prims > 1)
          errors.push(
            `decay.ruin: node "${n}" is asked for solo but has ${prims} primitives — three's loader makes that a Group, and only a Mesh can be taken solo`
          )
      }
    }
  }

  const crewPath = join(dir, manifest.crew?.file || '')
  if (!manifest.crew?.file || !existsSync(crewPath)) {
    errors.push(`crew.file: ${crewPath} does not exist`)
    return { errors, kits }
  }
  const crew = await readKit(crewPath)
  // `colourwayFor` slices the crew atlas into this many columns. The packer records the grid
  // it actually built in the glb's root extras, so the two can be held against each other
  // rather than discovered as a body wearing a sliver of its neighbour's sheet.
  if (manifest.crew.colourways !== undefined && crew.extras?.crewAtlas) {
    const cols = crew.extras.crewAtlas.cols
    if (cols !== manifest.crew.colourways)
      errors.push(`crew.colourways: manifest says ${manifest.crew.colourways} but ${manifest.crew.file} was packed with ${cols} columns`)
  }
  // `crew.js` matches attachment bones with exactly this normalisation, because three's
  // loader sanitises a dot out of a node name on the way in: `hand.r` and `handr` are the
  // same bone. Matching any tighter here would fail a rig the engine loads happily.
  const plain = (n) => n.replace(/[.\s_]/g, '').toLowerCase()
  const bones = new Set(crew.bones.map(plain))
  for (const [role, bone] of Object.entries(manifest.crew.attach || {})) {
    if (!bones.has(plain(bone))) errors.push(`crew.attach.${role}: no bone "${bone}" in ${manifest.crew.file}`)
  }
  const clips = new Set(crew.clips)
  for (const [key, c] of Object.entries(manifest.crew.clips || {})) {
    if (!clips.has(c?.name)) errors.push(`crew.clips.${key}: no clip "${c?.name}" in ${manifest.crew.file}`)
  }
  // Each character wears the skinned meshes the packer named `<mesh>` or `<mesh>_<Part>`;
  // `crew.js` throws at bake time when none of them is there, which is a blank screen rather
  // than a message, so the prefix is held against the glb here.
  const skinnedNodes = [...crew.nodes.keys()].filter((n) => !crew.statics.includes(n))
  ;(manifest.crew.characters || []).forEach((c, i) => {
    if (!skinnedNodes.some((n) => n === c.mesh || n.startsWith(`${c.mesh}_`)))
      errors.push(`crew.characters[${i}].mesh: no skinned node "${c.mesh}*" in ${manifest.crew.file}`)
  })
  // Hand tools live in the crew glb as unskinned nodes; the props hook names them and cannot
  // be read from here, so the manifest lists them and the list is what gets checked.
  for (const n of manifest.crew.propNodes || []) {
    if (!crew.statics.includes(n)) errors.push(`crew.propNodes: no static node "${n}" in ${manifest.crew.file}`)
  }
  // A state's clip reaches the glb through `crew.clips`, so the pair of checks is the chain.
  // An entry is a key, or `{ default, byCharacter }` — every clip in it walks the same chain.
  for (const [state, entry] of Object.entries(manifest.stateClips || {})) {
    const keys = typeof entry === 'string' ? [entry] : [entry?.default, ...Object.values(entry?.byCharacter || {})]
    for (const key of keys) if (!manifest.crew.clips?.[key]) errors.push(`stateClips.${state}: "${key}" is not a key in crew.clips`)
  }
  return { errors, kits }
}

function fail(list) {
  for (const e of list) console.error(`✗ ${e}`)
  process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [id] = process.argv.slice(2)
  if (!id) {
    console.error('usage: validate-kit.mjs <themeId>')
    process.exit(2)
  }
  const file = resolve('src/themes', id, 'manifest.js')
  if (!existsSync(file)) fail([`no manifest at ${file}`])
  const { manifest } = await import(pathToFileURL(file).href)
  // The theme's features too, as the boot path passes them: some fields are required by one.
  const index = resolve('src/themes', id, 'index.js')
  const features = existsSync(index) ? (await import(pathToFileURL(index).href)).default?.features : undefined
  const bad = validateManifest(manifest, features)
  if (bad.length) fail(bad.map((e) => `manifest: ${e}`))

  const dir = join('public', manifest.assetDir || 'assets')
  const { errors, kits } = await checkKit(manifest, dir)
  if (errors.length) fail(errors)
  console.log(
    `${id}: kit ok — ${Object.keys(kits).length} kits, ${Object.keys(manifest.buildings.kinds).length} recipes, ${Object.keys(manifest.crew.clips).length} clips`
  )
}
