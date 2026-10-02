import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { readKit } from '../tools/kit-read.mjs'
import { checkKit } from '../tools/validate-kit.mjs'
import { manifest } from '../src/themes/space/manifest.js'

const DIR = 'public/assets/space'

test('spacebase.glb lists named nodes with atlas cells', async () => {
  const k = await readKit(`${DIR}/spacebase.glb`)
  assert.ok(k.nodes.has('basemodule_A'))
  assert.ok(k.nodes.get('basemodule_A').cells.includes(11), 'habitat uses the TRIM cell')
  assert.equal(k.clips.length, 0)
  assert.equal(k.bones.length, 0)
})

test('crew.glb lists bones and clips', async () => {
  const k = await readKit(`${DIR}/crew.glb`)
  assert.ok(k.bones.includes('head'))
  assert.ok(k.clips.includes('Hammering'))
})

test('the space kit passes the validator', async () => {
  const { errors, kits } = await checkKit(manifest, DIR)
  assert.deepEqual(errors, [])
  // `nature` is upstream's Kenney kit for his eight worlds, merged 2026-09-24.
  assert.deepEqual(Object.keys(kits).sort(), ['base', 'forest', 'nature'])
})

/** One line per fault, and the fault named — a broken theme should not need a debugger. */
test('a broken manifest is reported field by field', async () => {
  const broken = structuredClone(manifest)
  broken.kits.base.cells.NOPE = 5
  broken.buildings.kinds.habitat.parts[0].node = ['basemodule_A', 'no_such_module']
  broken.buildings.kinds.antenna.parts[0].then[0].value = 'no_such_tower'
  broken.plots.clutter.push('no_such_prop')
  broken.scatter.rocks[0].part = 'No_Such_Rock'
  broken.crew.attach.hand = 'flipper'
  broken.crew.clips.work.name = 'Nope'
  broken.stateClips.idle = 'notAKey'

  const { errors } = await checkKit(broken, DIR)
  const has = (prefix) => assert.ok(errors.some((e) => e.startsWith(prefix)), `${prefix} not reported in ${errors.join(' | ')}`)
  has('kits.base.cells.NOPE: cell 5 is not sampled')
  has('buildings.kinds.habitat: no node "no_such_module"')
  // Both arms of the `if` are checked, so a bad binding in one of them is still caught.
  has('buildings.kinds.antenna: no node "no_such_tower"')
  has('buildings.kinds.antenna: no node "no_such_tower_fan"')
  has('plots.clutter: no node "no_such_prop"')
  has('scatter.rocks: no node "No_Such_Rock"')
  has('crew.attach.hand: no bone "flipper"')
  has('crew.clips.work: no clip "Nope"')
  has('stateClips.idle: "notAKey" is not a key in crew.clips')
})

test('a missing kit file is one error, not a crash', async () => {
  const { errors } = await checkKit({ ...manifest, crew: { ...manifest.crew, file: 'nope.glb' } }, DIR)
  assert.equal(errors.length, 1)
  assert.ok(errors[0].startsWith('crew.file:'))
})

/** `hand.r` and `handr` are the same bone: three's loader sanitises the dot away. */
test('attachment bones match loosely, as crew.js matches them', async () => {
  const loose = structuredClone(manifest)
  loose.crew.attach.hand = 'Hand_R'
  const { errors } = await checkKit(loose, DIR)
  assert.deepEqual(errors, [])
})

test('every node in the space kit is one primitive, so every solo recipe part is buildable', async () => {
  const k = await readKit(`${DIR}/spacebase.glb`, manifest.kits.base.atlas)
  const many = [...k.nodes].filter(([, n]) => n.primitives !== 1)
  assert.deepEqual(many, [])
})

/**
 * The failure this catches passes every other check: the node exists, its cells are painted,
 * and `part(name, 'base', { solo: true })` still throws at the first build, because three's
 * loader turns a mesh of several primitives into a `Group` and `kit.js` fills its solo table
 * only from a `Mesh`. So the kit under test has to be built rather than borrowed.
 */
test('a solo part on a multi-primitive node is rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'botcrossing-kit-'))
  const doc = new Document()
  const buffer = doc.createBuffer()
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer)
  const uv = doc.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 0.1, 0, 0, 0.1])).setBuffer(buffer)
  const primitive = () => doc.createPrimitive().setAttribute('POSITION', position).setAttribute('TEXCOORD_0', uv)
  const twin = doc.createMesh('twin').addPrimitive(primitive()).addPrimitive(primitive())
  const lone = doc.createMesh('lone').addPrimitive(primitive())
  doc.createScene().addChild(doc.createNode('twin').setMesh(twin)).addChild(doc.createNode('lone').setMesh(lone))
  await new NodeIO().write(join(dir, 'tiny.glb'), doc)

  const kits = { base: { file: 'tiny.glb', atlas: { cols: 8, rows: 4 }, cells: {}, pbr: {}, accentCells: [] } }
  const parts = [
    { node: 'twin', solo: true },
    { node: 'lone', solo: true },
    { node: 'twin' },
  ]
  const { errors, kits: read } = await checkKit({ kits, buildings: { kinds: { shed: { parts } } } }, dir)
  assert.equal(read.base.nodes.get('twin').primitives, 2)
  assert.ok(
    errors.some((e) => e.startsWith('buildings.kinds.shed: node "twin" is asked for solo but has 2 primitives')),
    errors.join(' | ')
  )
  // Taking the same node whole is fine, and so is a solo part on a single-primitive node.
  assert.ok(!errors.some((e) => e.includes('"lone"')), errors.join(' | '))
})

/**
 * The packer embeds seasonal atlases as extra images, and hand tools as unskinned nodes, so
 * the reader has to report both: the validator holds `kits.<k>.atlases` against the image
 * names and `crew.propNodes` against the static ones.
 */
test('readKit reports the texture image names and static nodes', async () => {
  const crew = await readKit(`${DIR}/crew.glb`)
  assert.deepEqual(crew.textures, ['mannequin_texture'])
  assert.deepEqual(crew.statics, [])
  const base = await readKit(`${DIR}/spacebase.glb`)
  assert.deepEqual(base.textures, ['spacebits_texture'])
  // Nothing in a kit glb is skinned, so every mesh node it has is a static one.
  assert.equal(base.statics.length, base.nodes.size)
  assert.ok(base.statics.length > 70, `${base.statics.length} static nodes`)
})

test('checkKit rejects a character whose mesh is not in the crew glb', async () => {
  const bad = { ...manifest, crew: { ...manifest.crew, characters: [{ id: 'ghost', mesh: 'body_ghost' }], colourways: 1 } }
  const { errors } = await checkKit(bad, DIR)
  assert.ok(errors.includes('crew.characters[0].mesh: no skinned node "body_ghost*" in crew.glb'), errors.join(' | '))
})

test('checkKit rejects a declared atlas image the glb has not got', async () => {
  const bad = { ...manifest, kits: { ...manifest.kits, base: { ...manifest.kits.base, atlases: { spring: 'nope' } } } }
  const { errors } = await checkKit(bad, DIR)
  assert.ok(errors.includes('kits.base.atlases.spring: no texture image named "nope" in spacebase.glb'), errors.join(' | '))
})

test('checkKit rejects a propNode the crew glb has not got', async () => {
  const bad = { ...manifest, crew: { ...manifest.crew, propNodes: ['engineer_Wrench'] } }
  const { errors } = await checkKit(bad, DIR)
  assert.ok(errors.includes('crew.propNodes: no static node "engineer_Wrench" in crew.glb'), errors.join(' | '))
})

/** A `byCharacter` override reaches the glb through `crew.clips` the same as a plain key. */
test('checkKit follows a byCharacter clip through crew.clips', async () => {
  const bad = {
    ...manifest,
    stateClips: { ...manifest.stateClips, working: { default: 'work', byCharacter: { knight: 'notAKey' } } },
  }
  const { errors } = await checkKit(bad, DIR)
  assert.ok(errors.includes('stateClips.working: "notAKey" is not a key in crew.clips'), errors.join(' | '))
})

/**
 * The same argument as `kits.<k>.cells`: an emissive override on a cell no triangle lands in
 * lights nothing at all, and reads in the manifest as a lamp the theme believes it has.
 */
test('checkKit rejects an emissive cell no mesh in the kit samples', async () => {
  const base = manifest.kits.base
  const dead = base.atlas.cols * base.atlas.rows - 1
  const bad = {
    ...manifest,
    kits: { ...manifest.kits, base: { ...base, pbr: { ...base.pbr, [dead]: { roughness: 1, metalness: 0, emissive: 0xff8a2a } } } },
  }
  const { errors } = await checkKit(bad, DIR)
  assert.ok(errors.includes(`kits.base.pbr.${dead}: emissive cell ${dead} is not sampled by any mesh in spacebase.glb`), errors.join(' | '))
})

/**
 * The decay block names nodes in a kit of the theme's own choosing, and that kit is usually
 * lazy — nothing loads it until a zone fades — so a name that is not in it would throw on the
 * first ghost and nowhere else. Both ends are held here: a `kit` the theme does not ship, and
 * a node the kit has not got.
 */
test('checkKit reports a decay block whose kit the theme does not ship', async () => {
  const bad = { ...manifest, decay: { kit: 'rubble', scatter: ['rock_small'] } }
  const { errors } = await checkKit(bad, DIR)
  assert.ok(errors.includes('decay.kit: no kit named "rubble"'), errors.join(' | '))
})

test('checkKit holds every decay node against its kit', async () => {
  const { manifest: medieval } = await import('../src/themes/medieval/manifest.js')
  const dir = join('public', medieval.assetDir)
  assert.deepEqual((await checkKit(medieval, dir)).errors, [], 'the village dresses its ghosts out of nodes it actually packed')

  const decay = {
    ...medieval.decay,
    scatter: ['no_such_sapling'],
    swap: { ...medieval.decay.swap, bucket_water: 'no_such_bucket' },
    ruin: { label: 'Ruin', parts: [{ node: 'no_such_ruin' }] },
  }
  const { errors } = await checkKit({ ...medieval, decay }, dir)
  assert.ok(errors.includes('decay.scatter: no node "no_such_sapling" in kit "decay"'), errors.join(' | '))
  assert.ok(errors.includes('decay.swap: no node "no_such_bucket" in kit "decay"'), errors.join(' | '))
  assert.ok(errors.includes('decay.ruin: no node "no_such_ruin" in kit "decay"'), errors.join(' | '))
})

/**
 * `colourwayFor` slices the crew atlas into `crew.colourways` columns, so a manifest that
 * disagrees with the packed sheet dresses every body in a strip of its neighbour's. The
 * packer records the grid it built in the glb's root extras; this is that loop closed.
 */
test('readKit reports root extras, and checkKit holds crew.colourways against them', async () => {
  // The space crew is the single mannequin, packed by the other path and carrying no grid —
  // so the check has nothing to hold it against and is skipped rather than failed.
  const space = await readKit(`${DIR}/crew.glb`)
  assert.equal(space.extras?.crewAtlas, undefined)

  const { manifest: medieval } = await import('../src/themes/medieval/manifest.js')
  const dir = join('public', medieval.assetDir)
  const crew = await readKit(join(dir, medieval.crew.file))
  assert.equal(crew.extras.crewAtlas.cols, medieval.crew.colourways)

  const n = medieval.crew.colourways + 1
  const { errors } = await checkKit({ ...medieval, crew: { ...medieval.crew, colourways: n } }, dir)
  assert.ok(
    errors.includes(`crew.colourways: manifest says ${n} but ${medieval.crew.file} was packed with ${crew.extras.crewAtlas.cols} columns`),
    errors.join(' | ')
  )
})

/**
 * The helper cue is built lazily, long after boot, so a node it names that the packer never
 * wrote would not fail a load — it would bind to nothing the first time a subagent spawned.
 * The village's helm comes from the hexagon pack rather than the Adventurers, which is exactly
 * the kind of prop a repack can drop, so hold every cue node against the packed crew itself.
 */
test('the village helper cue names static nodes the crew glb packed', async () => {
  const { default: theme } = await import('../src/themes/medieval/index.js')
  const crew = await readKit(join('public', theme.manifest.assetDir, theme.manifest.crew.file))
  const specs = theme.hooks.props(theme.manifest).cues.helper()
  assert.deepEqual(specs.map((s) => s.node), ['helmet'])
  for (const spec of specs) assert.ok(crew.statics.includes(spec.node), `"${spec.node}" is not a static node in the crew glb`)
})
