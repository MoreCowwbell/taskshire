/**
 * Packs every theme's raw art packs into the glbs that theme loads.
 *
 * A theme declares its inputs in `src/themes/<id>/assets.config.mjs`, with each `src`
 * relative to `ASSETS_SRC` (from the environment or `.env`). The raw packs are not checked
 * in and the built glbs are, so on a fresh clone — and on any machine that has only some of
 * the packs — this is a no-op: a theme is built only when *every* source it names is
 * present, because a half-rebuilt theme is worse than no rebuild at all. Pass `--force` to
 * turn a missing pack into a loud failure instead of a skip.
 *
 * Usage: build-assets.mjs [--force] [theme ...]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findModel } from './kit-read.mjs'
import { readEnv } from './read-env.mjs'

/** The repo root, so the themes, the `.env` and the spawned packers are found from any cwd. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const THEMES = join(ROOT, 'src/themes')

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const only = new Set(argv.filter((a) => !a.startsWith('--')))

// The `.env` is the repo's, so it is read from the root, and a relative value in it (the
// `.env.example` default is `./assets-src`) means relative to the repo as well — the cwd a
// packer was launched from has no meaning to a path written into a repo file. An absolute
// value passes through `resolve` unchanged.
const env = readEnv(join(ROOT, '.env'))
const ASSETS_SRC = resolve(ROOT, env.ASSETS_SRC || './assets-src')

const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const ids = readdirSync(THEMES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((id) => !only.size || only.has(id))
  .sort()

for (const id of ids) {
  const file = join(THEMES, id, 'assets.config.mjs')
  if (!existsSync(file)) continue

  /** @type {{kits?: object[], crew?: object, nature?: {src: string, out: string}}} */
  const { default: cfg } = await import(pathToFileURL(resolve(file)).href)
  const kits = cfg.kits || []

  // Every source or none: the built files are a matched set, and rebuilding two of three
  // would leave the theme half from this machine's packs and half from the last commit.
  //
  // The check reaches *inside* each pack, down to every file a builder opens by name: a
  // crew source whose mannequin or rig folder is missing used to pass here and then throw
  // out of `build-crew.mjs` — by which time the kit glbs had already been rewritten, which
  // is exactly the half-built theme this is meant to prevent. A cast of characters, their
  // colourway sheets, their hand tools and a kit's seasonal atlases are all opened by name
  // too, so they are all counted here.
  //
  // A pack that is absent is one line; a pack that is present but incomplete is the case
  // worth naming file by file, because that is the one somebody has to go and fix.
  const here = (p) => existsSync(join(ASSETS_SRC, p))
  const missing = []

  for (const kit of kits) {
    if (!here(kit.src)) {
      missing.push(kit.src)
      continue
    }
    const dir = join(ASSETS_SRC, kit.src)
    for (const model of kit.models || []) {
      const found = kit.subdirs ? findModel(dir, model) : existsSync(join(dir, `${model}.gltf`))
      if (!found) missing.push(`${kit.src}/${model}.gltf`)
    }
    for (const rel of Object.values(kit.atlases || {})) if (!here(rel)) missing.push(rel)
  }

  if (cfg.crew) {
    const c = cfg.crew
    if (!here(c.src)) missing.push(c.src)
    else {
      if (!here(`${c.src}/${c.rigDir}`)) missing.push(`${c.src}/${c.rigDir}`)
      // The animation files themselves, not just the folder: a pack that ships a different
      // set of rig glbs otherwise gets all the way to `build-crew` before it fails.
      else for (const file of Object.keys(c.clips || {})) if (!here(`${c.src}/${c.rigDir}/${file}`)) missing.push(`${c.src}/${c.rigDir}/${file}`)
      if (c.mannequin && !here(`${c.src}/${c.mannequin}`)) missing.push(`${c.src}/${c.mannequin}`)
    }
    for (const ch of c.characters || []) {
      if (!here(ch.src)) {
        missing.push(ch.src)
        continue
      }
      // The colourway sheets live wherever the character's `texture` points, which may be
      // beside the glb or a folder or two above it.
      const dir = dirname(join(ASSETS_SRC, ch.src))
      for (const way of ch.colourways?.length ? ch.colourways : ['']) {
        const sheet = join(dir, `${ch.texture}${way || ''}.png`)
        if (!existsSync(sheet)) missing.push(`${ch.src} → ${ch.texture}${way || ''}.png`)
      }
    }
    for (const p of c.props || []) if (!here(p.src)) missing.push(p.src)
  }

  // Kenney's Nature Kit (upstream, merged 2026-09-24): a pack of its own with a packer of its
  // own, because its models are flat-colour primitives that `build-nature.mjs` bakes into
  // vertex colours rather than atlas-mapped KayKit models. Only the space theme names one.
  if (cfg.nature && !here(cfg.nature.src)) missing.push(cfg.nature.src)

  if (missing.length) {
    const where = `under ${ASSETS_SRC}`
    if (force) {
      console.error(`build-assets: ${id}: missing ${missing.length} source pack(s) ${where}:`)
      for (const src of missing) console.error(`  ${src}`)
      console.error('See README, "Where the art comes from". Set ASSETS_SRC in .env (see .env.example).')
      process.exit(1)
    }
    console.log(`build-assets: ${id}: keeping the checked-in assets — no source pack ${where} for:`)
    for (const src of missing) console.log(`  ${src}`)
    continue
  }

  for (const kit of kits) {
    run('tools/build-kit.mjs', JSON.stringify({ ...kit, src: join(ASSETS_SRC, kit.src), assetsSrc: ASSETS_SRC }))
  }
  if (cfg.nature) run('tools/build-nature.mjs', join(ASSETS_SRC, cfg.nature.src), join(ROOT, cfg.nature.out))
  if (cfg.crew) {
    run('tools/build-crew.mjs', JSON.stringify({ ...cfg.crew, src: join(ASSETS_SRC, cfg.crew.src), assetsSrc: ASSETS_SRC }))
  }
}
