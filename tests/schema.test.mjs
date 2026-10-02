import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../src/themes/schema.js'
import { manifest } from '../src/themes/space/manifest.js'
import spaceTheme from '../src/themes/space/index.js'
import villageTheme from '../src/themes/medieval/index.js'

/** The sea a coast's cases lie behind: upstream's, a level and the colours it is drawn in. */
const SEA = { level: -0.8, shallow: 0x52dcd4, deep: 0x1c6fba, foam: 0xffffff }

test('the space manifest validates', () => {
  assert.deepEqual(validateManifest(manifest), [])
})

test('missing settings is reported by name', () => {
  const errors = validateManifest({})
  assert.ok(errors.some((e) => e.startsWith('settings')))
})

test('scatter recipes referenced by settings exist', () => {
  assert.ok(manifest.scatter.rocks.length > 0)
  for (const s of manifest.settings) assert.ok(manifest.scatter[s.scatter], `${s.id} scatter ${s.scatter}`)
  const errors = validateManifest({ ...manifest, scatter: {} })
  assert.ok(errors.some((e) => e.startsWith('settings[0].scatter')))
})

test('a rim must name a scatter recipe and carry its four numbers', () => {
  const m = structuredClone(manifest)
  m.settings[0].rim = { recipe: 'nope', inner: 52, outer: 80 }
  const errors = validateManifest(m)
  assert.ok(errors.some((e) => e.includes('settings[0].rim.recipe')))
  assert.ok(errors.some((e) => e === 'settings[0].rim.count: missing'))
})

test('a coast is checked field by field when present', () => {
  const m = structuredClone(manifest)
  m.settings[0].water = { ...SEA }
  m.settings[0].coast = { axis: [-0.9659, 0.2588], from: 62 }
  assert.ok(validateManifest(m).some((e) => e === 'settings[0].coast.depth: missing'))
})

test('a whole valley — coast, sea, wall and rim — validates', () => {
  const m = structuredClone(manifest)
  m.scatter.crags = [{ part: 'rock_small', weight: 1, size: [0.3, 0.6], sink: 0.1 }]
  m.settings[0].coast = { axis: [-0.9659, 0.2588], from: 62, depth: 7 }
  m.settings[0].water = { ...SEA }
  m.settings[0].ridge = { axis: [0.2588, -0.9659], from: 52, width: 28, height: 14, recipe: 'crags', count: 700 }
  assert.deepEqual(validateManifest(m), [])
})

/**
 * The coast's two optional extras — the beach colour and the bend in the shoreline.
 *
 * Absent is the contract for every setting that had water before this batch, so the first
 * thing checked is that saying nothing is still legal. `wobble` is the one that has to be all
 * or nothing: `amp` with no `scale` is `fbm(noise, NaN)`, which is a `NaN` waterline over the
 * whole map and a terrain full of holes rather than a visible mistake.
 */
test('a coast may carry sand and a wobble, and a half-written wobble is an error', () => {
  const m = structuredClone(manifest)
  const bank = { axis: [-0.9659, 0.2588], from: 62, depth: 7 }
  m.settings[0].water = { ...SEA }

  m.settings[0].coast = { ...bank }
  assert.deepEqual(validateManifest(m), [], 'a coast with neither extra is unchanged')

  m.settings[0].coast = { ...bank, sand: 0xd8c48a, wobble: { amp: 9, scale: 0.018 } }
  assert.deepEqual(validateManifest(m), [], 'and one with both is accepted')

  m.settings[0].coast = { ...bank, wobble: { scale: 0.018 } }
  assert.ok(validateManifest(m).some((e) => e === 'settings[0].coast.wobble.amp: missing'))

  m.settings[0].coast = { ...bank, wobble: { amp: 9 } }
  assert.ok(validateManifest(m).some((e) => e === 'settings[0].coast.wobble.scale: missing'))

  m.settings[0].coast = { ...bank, sand: '#d8c48a' }
  assert.ok(validateManifest(m).some((e) => e === 'settings[0].coast.sand: expected a number'))
})

test('an axis must be two finite numbers', () => {
  const m = structuredClone(manifest)
  m.settings[0].water = { ...SEA }
  m.settings[0].coast = { axis: [-0.9659, 0.2588, 0], from: 62, depth: 7 }
  assert.ok(validateManifest(m).some((e) => e === 'settings[0].coast.axis: expected two finite numbers'))

  m.settings[0].coast.axis = [-0.9659, Number.NaN]
  assert.ok(validateManifest(m).some((e) => e === 'settings[0].coast.axis: expected two finite numbers'))
  // A non-unit axis rescales `from` and `width` on the quiet; a zero one is no coast at all.
  m.settings[0].coast.axis = [3, 4]
  assert.ok(validateManifest(m).some((e) => e === 'settings[0].coast.axis: expected a unit vector'))
  m.settings[0].coast.axis = [0, 0]
  assert.ok(validateManifest(m).some((e) => e === 'settings[0].coast.axis: expected a unit vector'))
  m.settings[0].coast.axis = [-0.9848, 0.1736]
  assert.ok(!validateManifest(m).some((e) => e.startsWith('settings[0].coast.axis')))

  // Not an array at all is said once, by the shape check, rather than twice.
  m.settings[0].coast.axis = 'west'
  const errors = validateManifest(m).filter((e) => e.startsWith('settings[0].coast.axis'))
  assert.deepEqual(errors, ['settings[0].coast.axis: expected an array'])
})

/**
 * The bank's numbers go straight into the height field, so a `NaN` or an infinity there is a
 * `NaN` or an infinite terrain over half the map. `typeof` passes both, so they are held finite.
 * And the half-plane is the `coast`'s: a `water` still carrying an `axis` was written for the
 * old shape and would draw the sea with no bank under it, so it is refused rather than ignored.
 */
test('a coast holds finite numbers and needs a sea, and a water carrying an axis is refused', () => {
  const m = structuredClone(manifest)
  const bank = { axis: [-0.9848, 0.1736], from: 40, depth: 7 }
  m.settings[0].water = { ...SEA }
  for (const [key, bad] of [['from', Number.NaN], ['from', Infinity], ['depth', Number.NaN], ['depth', -Infinity]]) {
    m.settings[0].coast = { ...bank, [key]: bad }
    assert.ok(validateManifest(m).includes(`settings[0].coast.${key}: expected a finite number`), `${key} ${bad}`)
  }
  // The bed deepens the sea by a factor: 1 is the bank as it stands, under 1 would raise it.
  for (const good of [1, 2, 2.5]) {
    m.settings[0].coast = { ...bank, bed: good }
    assert.deepEqual(validateManifest(m), [], `bed ${good}`)
  }
  for (const bad of [0.5, 0, -1, Number.NaN, Infinity]) {
    m.settings[0].coast = { ...bank, bed: bad }
    assert.ok(validateManifest(m).includes('settings[0].coast.bed: expected a finite number of at least 1'), `bed ${bad}`)
  }
  m.settings[0].coast = { ...bank, bed: '2' }
  assert.ok(validateManifest(m).includes('settings[0].coast.bed: expected a number'))
  m.settings[0].coast = { ...bank }
  m.settings[0].water = { ...SEA, axis: bank.axis }
  assert.ok(validateManifest(m).some((e) => e.startsWith('settings[0].water.axis:')))
  // And a sea behind a coast is upstream's like any other: the old flat sea's shape is not enough.
  m.settings[0].water = { level: -0.8, color: 0x3f9bd8 }
  assert.ok(validateManifest(m).includes('settings[0].water.shallow: missing'))
  delete m.settings[0].water
  assert.ok(validateManifest(m).some((e) => e.startsWith('settings[0].coast: needs')))
})

test('a ridge must name a scatter recipe and carry its numbers', () => {
  const m = structuredClone(manifest)
  m.settings[0].ridge = { axis: [0.2588, -0.9659], from: 52, width: 28, height: 14, recipe: 'nope' }
  const errors = validateManifest(m)
  assert.ok(errors.some((e) => e === 'settings[0].ridge.recipe: no recipe named "nope"'))
  assert.ok(errors.some((e) => e === 'settings[0].ridge.count: missing'))
})

/**
 * The ridge's geometry is the world's and the crags on it are the theme's dressing, so a theme
 * that dresses a world's ridge with nothing resolves to a ridge with neither `recipe` nor
 * `count` — the land still rises, bare. Either one without the other is still an error.
 */
test("a ridge's crags are optional, but come as a pair", () => {
  const m = structuredClone(manifest)
  const land = { axis: [0.2588, -0.9659], from: 52, width: 28, height: 14 }
  m.settings[0].ridge = land
  assert.deepEqual(validateManifest(m), [], 'a bare ridge validates')
  m.settings[0].ridge = { ...land, count: 700 }
  assert.ok(validateManifest(m).includes('settings[0].ridge.recipe: missing'))
  m.settings[0].ridge = [land, { ...land, recipe: 'rocks' }]
  assert.ok(validateManifest(m).includes('settings[0].ridge[1].count: missing'))
})

/**
 * A setting may carry a *list* of ridges — the mountain carries two, one across the top of the
 * frame and one closing the top right — and each entry is held against the same shape. The path
 * in the message carries the index, because "expected a unit vector" without one is a hunt
 * through a manifest for which of two walls is bent.
 */
test('a ridge may be a list, and each entry is checked by index', () => {
  const m = structuredClone(manifest)
  m.scatter.crags = [{ part: 'rock_small', weight: 1, size: [0.3, 0.6], sink: 0.1 }]
  const wall = { axis: [0.2588, -0.9659], from: 52, width: 28, height: 14, recipe: 'crags', count: 700 }

  m.settings[0].ridge = [wall, { ...wall, axis: [-0.7071, -0.7071], from: 58 }]
  assert.deepEqual(validateManifest(m), [], 'two well-formed walls validate')

  m.settings[0].ridge = [wall, { ...wall, axis: [3, 4], recipe: 'nope' }]
  const errors = validateManifest(m)
  assert.ok(errors.some((e) => e === 'settings[0].ridge[1].axis: expected a unit vector'))
  assert.ok(errors.some((e) => e === 'settings[0].ridge[1].recipe: no recipe named "nope"'))
  assert.ok(!errors.some((e) => e.startsWith('settings[0].ridge[0]')), 'the good wall is not blamed')

  // A missing field in a list entry names the entry, and an empty list is an error rather than
  // a setting that silently has no wall at all.
  m.settings[0].ridge = [{ ...wall, height: undefined }]
  assert.ok(validateManifest(m).some((e) => e === 'settings[0].ridge[0].height: missing'))
  m.settings[0].ridge = []
  assert.ok(validateManifest(m).some((e) => e === 'settings[0].ridge: expected a non-empty array'))
})

/**
 * `hills` is the multiplier on the far-field terrain term, and `plots.maxTilt` the spread the
 * allocator will lay a slab across. Both are optional and both are plain numbers, and both are
 * silent when malformed: a string `hills` is a `NaN` height over everything outside the colony,
 * and a string `maxTilt` fails `Number.isFinite` and switches the slope rule off altogether.
 */
test('hills and plots.maxTilt are optional numbers', () => {
  const m = structuredClone(manifest)
  // The Moon, which sets no hills of its own (the forest, first in group order, does).
  const i = m.settings.findIndex((s) => s.id === 'moon')
  assert.equal(m.settings[i].hills, undefined, 'absent is the default, which is 1')
  assert.deepEqual(validateManifest(m), [])

  m.settings[i].hills = 1.8
  assert.deepEqual(validateManifest(m), [])
  const badHills = `settings[${i}].hills: expected a finite number above 0`
  for (const bad of ['steep', Number.NaN, Number.POSITIVE_INFINITY, 0, -1.6]) {
    m.settings[i].hills = bad
    assert.ok(validateManifest(m).some((e) => e === badHills), `hills ${String(bad)} was accepted`)
  }
  delete m.settings[i].hills

  m.plots.maxTilt = 1.2
  assert.deepEqual(validateManifest(m), [])
  m.plots.maxTilt = 0
  assert.deepEqual(validateManifest(m), [], 'zero is a theme that refuses every slope, which is legal')
  const badTilt = 'plots.maxTilt: expected a finite number of 0 or more'
  for (const bad of ['gentle', Number.NaN, Number.POSITIVE_INFINITY, -0.5]) {
    m.plots.maxTilt = bad
    assert.ok(validateManifest(m).some((e) => e === badTilt), `maxTilt ${String(bad)} was accepted`)
  }
})

/**
 * `clearing` is read straight into the height field, so every number in it is finite, the
 * ramp runs outward (`to` past `from`, which is past the middle) and the floor sits below the
 * deck's ground (under zero). Optional: a world without one keeps the ground it always had.
 */
test('clearing is optional, and checked field by field when present', () => {
  const m = structuredClone(manifest)
  const i = m.settings.findIndex((s) => s.id === 'moon')
  assert.deepEqual(m.settings[i].clearing, { from: 55, to: 95, floor: -0.35 })
  assert.deepEqual(validateManifest(m), [])
  delete m.settings[i].clearing
  assert.deepEqual(validateManifest(m), [], 'absent is a world without one')

  const good = { from: 55, to: 95, floor: -0.35 }
  const cases = [
    ['from', 0],
    ['from', -5],
    ['to', 55],
    ['to', 40],
    ['floor', 0],
    ['floor', 0.2],
    ['from', Number.NaN],
    ['to', Number.POSITIVE_INFINITY],
    ['floor', Number.NEGATIVE_INFINITY],
    ['to', '95'],
  ]
  for (const [key, value] of cases) {
    m.settings[i].clearing = { ...good, [key]: value }
    const errors = validateManifest(m)
    assert.ok(errors.some((e) => e.startsWith(`settings[${i}].clearing.${key}: `)), `clearing.${key} ${String(value)} was accepted`)
  }
  for (const key of ['from', 'to', 'floor']) {
    const { [key]: _gone, ...rest } = good
    m.settings[i].clearing = rest
    assert.ok(validateManifest(m).some((e) => e.startsWith(`settings[${i}].clearing.${key}: `)), `clearing without ${key} was accepted`)
  }
  for (const bad of [5, 'wide', true, null, [55, 95, -0.35]]) {
    m.settings[i].clearing = bad
    assert.ok(validateManifest(m).includes(`settings[${i}].clearing: expected an object`), `clearing ${JSON.stringify(bad)} was accepted`)
  }
})

/**
 * The engine reads far more of a setting than the four colours the HUD shows, and every one
 * of them is a silent NaN if it is absent: a missing `roughness` multiplies the whole terrain
 * displacement by `undefined` and lands a flat black plane.
 */
test('a setting is checked field by field, nested keys included', () => {
  const drop = (key) => {
    const s = { ...manifest.settings[0] }
    delete s[key]
    return validateManifest({ ...manifest, settings: [s, ...manifest.settings.slice(1)] })
  }
  assert.ok(drop('roughness').includes('settings[0].roughness: missing'))
  assert.ok(drop('rock').includes('settings[0].rock: missing'))
  assert.ok(drop('horizon').includes('settings[0].horizon: missing'))
  assert.ok(drop('atmosphere').includes('settings[0].atmosphere: missing'))
  assert.ok(drop('dust').includes('settings[0].dust: missing'))
  assert.ok(drop('craters').includes('settings[0].craters: missing'))
  assert.ok(drop('companion').includes('settings[0].companion: missing'))

  // Nested keys are named in full, and a wrong type is not the same message as a missing one.
  const nested = { ...manifest.settings[0], fog: { color: 0x111111, near: 100 }, ground: 'grey' }
  const errors = validateManifest({ ...manifest, settings: [nested] })
  assert.ok(errors.includes('settings[0].fog.far: missing'), errors.join(' | '))
  assert.ok(errors.includes('settings[0].ground: expected an object'), errors.join(' | '))
  const typed = { ...manifest.settings[0], roughness: '0.9' }
  assert.ok(validateManifest({ ...manifest, settings: [typed] }).includes('settings[0].roughness: expected a number'))
})

/**
 * A setting may choose its own arrival. The kinds are the theme's, because the hook that
 * builds them is code the validator cannot read — so a theme lists what it can build in
 * `ceremonies`, and a setting naming anything else is a village with no way in and no error
 * anywhere.
 */
test('a setting ceremony is checked against the theme it belongs to', () => {
  const withCeremony = (ceremony, ceremonies) => {
    const m = structuredClone(manifest)
    m.settings[0].ceremony = ceremony
    if (ceremonies) m.ceremonies = ceremonies
    return validateManifest(m)
  }

  // The space theme declares none, so any kind at all is a mistake.
  assert.ok(withCeremony({ kind: 'castle' }).includes('settings[0].ceremony.kind: the theme declares no ceremonies'))
  // A kind outside the list is named in the message; one inside it validates.
  assert.ok(
    withCeremony({ kind: 'zeppelin' }, ['castle', 'boat']).includes('settings[0].ceremony.kind: "zeppelin" is not in ceremonies')
  )
  assert.ok(!withCeremony({ kind: 'boat' }, ['castle', 'boat']).some((e) => e.startsWith('settings[0].ceremony')))
  assert.ok(withCeremony({ kind: 7 }, ['castle']).includes('settings[0].ceremony.kind: expected a string'))

  // The cell is axial integers. A fractional one rounds to a different cell in `worldToHex`
  // than the one the arrival was placed at, which stands it on somebody else's plot.
  assert.ok(withCeremony({ cell: { q: -2, r: 1.5 } }).includes('settings[0].ceremony.cell: expected {q, r}'))
  assert.ok(withCeremony({ cell: { q: -2 } }).includes('settings[0].ceremony.cell: expected {q, r}'))
  // Both halves are optional: a setting may move the theme's default without renaming it.
  assert.deepEqual(withCeremony({ cell: { q: -3, r: 2 } }), [])
  assert.deepEqual(withCeremony({}), [])
  assert.ok(withCeremony('castle').includes('settings[0].ceremony: expected an object'))
})

/**
 * The ceremony list itself, and the one thing it changes elsewhere: a theme that declares it
 * carries `clearance` and `apron` on each arrival instead of stating one pair in `plots`.
 */
test('a ceremonies list moves the clearance and apron onto the arrivals', () => {
  const bad = structuredClone(manifest)
  bad.ceremonies = []
  assert.ok(validateManifest(bad).includes('ceremonies: expected a non-empty array'))
  bad.ceremonies = ['castle', 7]
  assert.ok(validateManifest(bad).includes('ceremonies[1]: expected a name'))

  // One fixed ceremony: the numbers stay in the manifest and are required there.
  const single = structuredClone(manifest)
  delete single.plots.ceremonyApron
  assert.ok(validateManifest(single).includes('plots.ceremonyApron: expected a number'))

  // Several: they belong to the arrivals, and the manifest is right to say nothing.
  const many = structuredClone(manifest)
  many.ceremonies = ['castle', 'boat']
  delete many.plots.ceremonyClearance
  delete many.plots.ceremonyApron
  assert.deepEqual(validateManifest(many), [])
})

test('the two kit names the engine hardcodes are required by name', () => {
  const kits = validateManifest({ ...manifest, kits: { scenery: manifest.kits.forest } })
  assert.ok(kits.some((e) => e.startsWith('kits.base: missing —')), kits.join(' | '))
  assert.ok(kits.some((e) => e.startsWith('kits.forest: missing —')), kits.join(' | '))
})

test('kits declare file, atlas, cells and pbr', () => {
  assert.equal(manifest.kits.base.file, 'spacebase.glb')
  assert.equal(manifest.kits.base.cells.TRIM, 11)
  assert.deepEqual(manifest.kits.base.accentCells, ['TRIM'])
  const errors = validateManifest({ ...manifest, kits: { base: { file: 'x.glb' } } })
  assert.ok(errors.some((e) => e.startsWith('kits.base.atlas')))
})

test('crew declares clips with loop flags and four attachment bones', () => {
  assert.equal(manifest.crew.clips.work.name, 'Hammering')
  assert.equal(manifest.crew.clips.spawn.loop, false)
  // The left hand is upstream's phone check's (merge of d05ac2f).
  assert.deepEqual(Object.keys(manifest.crew.attach), ['head', 'chest', 'hand', 'handL'])
  const errors = validateManifest({ ...manifest, crew: { file: 'crew.glb' } })
  assert.ok(errors.some((e) => e.startsWith('crew.clips')))
})

test('a clip strike is optional and range-checked', () => {
  const withStrike = (strike) => ({
    ...manifest,
    crew: { ...manifest.crew, clips: { ...manifest.crew.clips, work: { name: 'Hammering', loop: true, strike } } },
  })
  assert.deepEqual(validateManifest(withStrike(0.4)), [])
  assert.ok(validateManifest(withStrike(2)).includes('crew.clips.work.strike: expected a number in [0, 1]'))
  assert.ok(validateManifest(withStrike('0.4')).includes('crew.clips.work.strike: expected a number in [0, 1]'))
})

test('stateClips maps every status the colony emits to a crew clip key', () => {
  for (const k of ['working', 'waiting', 'blocked', 'celebrating', 'sleeping', 'sittingDown', 'idle', 'walk', 'run', 'spawn']) {
    assert.ok(manifest.crew.clips[manifest.stateClips[k]], `stateClips.${k} -> ${manifest.stateClips[k]}`)
  }
  const errors = validateManifest({ ...manifest, stateClips: { ...manifest.stateClips, working: 'nope' } })
  assert.ok(errors.some((e) => e.startsWith('stateClips.working')))
})

test('buildings declare scale, deck and recipes with a label and parts', () => {
  assert.equal(manifest.buildings.scale, 1.45)
  assert.equal(manifest.buildings.deck, 1.0)
  assert.ok(Object.keys(manifest.buildings.kinds).length >= 10)
  const errors = validateManifest({ ...manifest, buildings: { scale: 1.45, deck: 1, kinds: { habitat: { parts: [] } } } })
  assert.ok(errors.some((e) => e.startsWith('buildings.kinds.habitat.label')))
  assert.ok(errors.some((e) => e.startsWith('buildings.kinds.habitat.parts')))
})

test('plots, palette and copy', () => {
  assert.equal(manifest.plots.deckTop, 0.45)
  assert.deepEqual(manifest.plots.ceremonyCell, { q: -2, r: 1 })
  assert.ok(manifest.plots.palette.length >= 12)
  assert.equal(manifest.palette.accent, 0xc96442)
  assert.equal(manifest.palette.css['--accent'], '#c96442')
  assert.equal(manifest.copy.shipped, 'Shipped')
  // The clutter prop that takes the taller scale is named by the theme, not by `plots.js`.
  assert.equal(manifest.plots.clutterLamp, 'lights')
  assert.ok(manifest.plots.clutter.includes(manifest.plots.clutterLamp))
  const lamp = validateManifest({ ...manifest, plots: { ...manifest.plots, clutterLamp: 'floodlight' } })
  assert.ok(lamp.includes('plots.clutterLamp: "floodlight" is not in plots.clutter'), lamp.join(' | '))
  const errors = validateManifest({ ...manifest, copy: {} })
  assert.ok(errors.some((e) => e.startsWith('copy.inhabitants')))
})

test('the medieval manifest validates', async () => {
  const { manifest: medieval } = await import('../src/themes/medieval/manifest.js')
  assert.deepEqual(validateManifest(medieval), [])
})

/**
 * A theme that is only half written — a setting preset and the name of a scatter recipe, and
 * none of the blocks the engine actually builds from. It used to be the medieval stub sitting
 * in the tree; now that the village is real, the shape is kept here, because "every missing
 * block is named" is the promise a half-written theme is caught by.
 */
const HALF_WRITTEN = {
  assetDir: 'assets/medieval',
  settings: [
    {
      id: 'forest',
      name: 'Forest',
      ground: { low: 0x2f5a34, high: 0x6d9a4a, tint: 0x86ae5c },
      rock: 0x6b6f63,
      horizon: 0x7fb0c8,
      sky: { top: 0x1d4d8f, bottom: 0x9ec8e8 },
      fog: { color: 0x6b8fa8, near: 92, far: 230 },
      sun: { color: 0xfff0d4, intensity: 2.4, night: 0.13 },
      ambient: { sky: 0x88bfe8, ground: 0x3f5a30, intensity: 0.95 },
      atmosphere: 1,
      craters: 0,
      roughness: 0.75,
      scatter: 'trees',
      companion: { name: 'Moon', color: 0xdcd8cc, size: 3.2, glow: 0xfff6e0 },
      dust: 0,
    },
  ],
  scatter: {},
}

test('a half-written manifest is reported field by field', () => {
  const errors = validateManifest(HALF_WRITTEN)
  for (const field of ['kits', 'crew', 'buildings', 'stateClips', 'plots', 'palette', 'copy'])
    assert.ok(
      errors.some((e) => e.startsWith(`${field}:`)),
      `expected an error naming "${field}", got: ${errors.join('; ')}`
    )
  assert.ok(errors.includes('settings[0].scatter: no recipe named "trees"'))
})

test('crew.characters and colourways are checked', () => {
  const chars = [{ id: 'knight', mesh: 'body_knight' }, { id: 'mage', mesh: 'body_mage' }]
  const ok = validateManifest({ ...manifest, crew: { ...manifest.crew, characters: chars, colourways: 4 } })
  assert.deepEqual(ok, [])
  const bad = validateManifest({ ...manifest, crew: { ...manifest.crew, characters: [{ id: 'knight' }, { id: 'knight', mesh: 'x' }], colourways: 0 } })
  assert.ok(bad.includes('crew.characters[0].mesh: expected a string'), bad.join(' | '))
  assert.ok(bad.includes('crew.characters[1].id: duplicate "knight"'), bad.join(' | '))
  assert.ok(bad.includes('crew.colourways: expected a positive integer'), bad.join(' | '))
})

test('stateClips accepts a byCharacter override and checks its keys', () => {
  const chars = [{ id: 'knight', mesh: 'body_knight' }, { id: 'engineer', mesh: 'body_engineer' }]
  const crew = { ...manifest.crew, characters: chars, clips: { ...manifest.crew.clips, hammer: { name: 'Hammering', loop: true } } }
  const good = { ...manifest, crew, stateClips: { ...manifest.stateClips, working: { default: 'work', byCharacter: { engineer: 'hammer' } } } }
  assert.deepEqual(validateManifest(good), [])
  const bad = validateManifest({ ...good, stateClips: { ...good.stateClips, working: { default: 'nope', byCharacter: { wizard: 'hammer', knight: 'zzz' } } } })
  assert.ok(bad.includes('stateClips.working.default: "nope" is not in crew.clips'), bad.join(' | '))
  assert.ok(bad.includes('stateClips.working.byCharacter.wizard: not a declared character'), bad.join(' | '))
  assert.ok(bad.includes('stateClips.working.byCharacter.knight: "zzz" is not in crew.clips'), bad.join(' | '))
  const shape = validateManifest({ ...good, stateClips: { ...good.stateClips, working: { byCharacter: {} } } })
  assert.ok(shape.includes('stateClips.working.default: missing'), shape.join(' | '))
})

test('kit atlases and setting.atlas agree', () => {
  const kits = { ...manifest.kits, base: { ...manifest.kits.base, atlases: { spring: 'a', winter: 'a_Winter' } } }
  const settings = manifest.settings.map((s) => ({ ...s, atlas: 'winter' }))
  assert.deepEqual(validateManifest({ ...manifest, kits, settings }), [])
  const unknown = validateManifest({ ...manifest, kits, settings: manifest.settings.map((s) => ({ ...s, atlas: 'autumn' })) })
  assert.ok(unknown.includes('settings[0].atlas: "autumn" is not an atlas of kit "base"'), unknown.join(' | '))
  const orphan = validateManifest({ ...manifest, settings })
  assert.ok(orphan.includes('settings[0].atlas: no kit declares atlases'), orphan.join(' | '))
  const empty = validateManifest({ ...manifest, kits: { ...kits, base: { ...kits.base, atlases: { spring: '' } } } })
  assert.ok(empty.includes('kits.base.atlases.spring: expected an image name'), empty.join(' | '))
})

test('emissive cells are numbers', () => {
  const kits = { ...manifest.kits, base: { ...manifest.kits.base, pbr: { ...manifest.kits.base.pbr, 20: { roughness: 1, metalness: 0, emissive: 0xff8a2a, emissiveIntensity: 1.6 } } } }
  assert.deepEqual(validateManifest({ ...manifest, kits }), [])
  const bad = { ...manifest, kits: { ...kits, base: { ...kits.base, pbr: { 20: { roughness: 1, metalness: 0, emissive: 'orange' } } } } }
  assert.ok(validateManifest(bad).includes('kits.base.pbr.20.emissive: expected a number'))
})

/**
 * `hasEmissive` in `kit.js` keys off `pbr[cell].emissive` alone, so an intensity without a
 * colour is silently inert — a cell the theme believes glows and which never does.
 */
test('emissiveIntensity without emissive is rejected', () => {
  const kits = { ...manifest.kits, base: { ...manifest.kits.base, pbr: { 20: { roughness: 1, metalness: 0, emissiveIntensity: 1.6 } } } }
  const errors = validateManifest({ ...manifest, kits })
  assert.ok(errors.includes('kits.base.pbr.20.emissiveIntensity: needs emissive'), errors.join(' | '))
})

/**
 * A theme whose kerb clutter includes a real light turns the engine's procedural lamp posts
 * off. The flag is optional and defaults to on, so a manifest that never heard of it — the
 * space one — is still valid and still gets its streetlights.
 */
test('plots.lampPosts is an optional boolean', () => {
  assert.equal(manifest.plots.lampPosts, undefined)
  assert.deepEqual(validateManifest(manifest), [])
  assert.deepEqual(validateManifest({ ...manifest, plots: { ...manifest.plots, lampPosts: false } }), [])
  assert.deepEqual(validateManifest({ ...manifest, plots: { ...manifest.plots, lampPosts: true } }), [])
  const bad = validateManifest({ ...manifest, plots: { ...manifest.plots, lampPosts: 'no' } })
  assert.ok(bad.includes('plots.lampPosts: expected a boolean'), bad.join(' | '))
})

/**
 * How a theme lays out its kerb props. Optional: the village says nothing and keeps the yard it
 * always had; space names upstream's reserved yard, and nothing else is a yard.
 */
test('plots.yard is optional, and reserved is the only yard it names', async () => {
  const { manifest: medieval } = await import('../src/themes/medieval/manifest.js')
  assert.equal(manifest.plots.yard, 'reserved')
  assert.equal(medieval.plots.yard, undefined)
  assert.deepEqual(validateManifest({ ...manifest, plots: { ...manifest.plots, yard: undefined } }), [])
  const bad = validateManifest({ ...manifest, plots: { ...manifest.plots, yard: 'open' } })
  assert.ok(bad.includes('plots.yard: expected one of reserved'), bad.join(' | '))
})

/**
 * How hard a kit's accent cells glow after dark. Optional, because the number used to be a
 * literal in the building shader and the space theme is still argued on that exact value —
 * a manifest that says nothing has to keep computing the same product it always did.
 */
test('kits.accentGlow is an optional number', () => {
  assert.equal(manifest.kits.base.accentGlow, undefined)
  assert.deepEqual(validateManifest({ ...manifest, kits: { ...manifest.kits, base: { ...manifest.kits.base, accentGlow: 0.3 } } }), [])
  assert.deepEqual(validateManifest({ ...manifest, kits: { ...manifest.kits, base: { ...manifest.kits.base, accentGlow: 0 } } }), [])
  const bad = validateManifest({ ...manifest, kits: { ...manifest.kits, base: { ...manifest.kits.base, accentGlow: 'dim' } } })
  assert.ok(bad.includes('kits.base.accentGlow: expected a number'), bad.join(' | '))
})

/**
 * `checkKit` and `crew.js` both claim a character's parts by prefix (`<mesh>` or
 * `<mesh>_<Part>`), so a mesh name that extends another one's with an underscore is
 * ambiguous — the shorter character silently swallows the longer one's body.
 */
test('a character mesh that is a prefix-extension of another is rejected', () => {
  const chars = [
    { id: 'knight', mesh: 'body_knight' },
    { id: 'knight_archer', mesh: 'body_knight_archer' },
  ]
  const errors = validateManifest({ ...manifest, crew: { ...manifest.crew, characters: chars } })
  assert.ok(
    errors.includes(
      'crew.characters[1].mesh: "body_knight_archer" is a prefix-extension of "body_knight" (characters[0]) — meshes are matched by prefix'
    ),
    errors.join(' | ')
  )
  // The pair is caught whichever way round it is declared.
  const flipped = validateManifest({ ...manifest, crew: { ...manifest.crew, characters: [chars[1], chars[0]] } })
  assert.ok(
    flipped.includes(
      'crew.characters[0].mesh: "body_knight_archer" is a prefix-extension of "body_knight" (characters[1]) — meshes are matched by prefix'
    ),
    flipped.join(' | ')
  )
  // A shared prefix that is not an underscore extension cannot collide, and is allowed.
  const fine = [
    { id: 'a', mesh: 'body_knight' },
    { id: 'b', mesh: 'body_knightess' },
  ]
  assert.deepEqual(validateManifest({ ...manifest, crew: { ...manifest.crew, characters: fine } }), [])
})

/**
 * The building shader sizes its per-cell uniform arrays from the atlas grid, so a `pbr` key
 * outside it is an override no fragment can ever read — a typo with no runtime symptom.
 */
test('a pbr key that is not a cell of the atlas is rejected', () => {
  const base = manifest.kits.base
  const { cols, rows } = base.atlas
  const off = cols * rows
  const bad = validateManifest({
    ...manifest,
    kits: { ...manifest.kits, base: { ...base, pbr: { ...base.pbr, [off]: { roughness: 1, metalness: 0 }, trim: { roughness: 1 } } } },
  })
  assert.ok(bad.includes(`kits.base.pbr.${off}: not a cell of a ${cols}x${rows} atlas`), bad.join(' | '))
  assert.ok(bad.includes(`kits.base.pbr.trim: not a cell of a ${cols}x${rows} atlas`), bad.join(' | '))
  // The last real cell is in range and passes.
  assert.deepEqual(
    validateManifest({ ...manifest, kits: { ...manifest.kits, base: { ...base, pbr: { ...base.pbr, [off - 1]: { roughness: 1, metalness: 0 } } } } }),
    []
  )
})

test('fade.floor is optional and must be a number in [0, 1]', () => {
  assert.deepEqual(validateManifest({ ...manifest, fade: undefined }), [])
  assert.deepEqual(validateManifest({ ...manifest, fade: { floor: 0.4 } }), [])
  assert.ok(validateManifest({ ...manifest, fade: { floor: 2 } }).includes('fade.floor: expected a number in [0, 1]'))
  assert.ok(validateManifest({ ...manifest, fade: { floor: 'x' } }).includes('fade.floor: expected a number in [0, 1]'))
  assert.ok(validateManifest({ ...manifest, fade: 3 }).includes('fade: expected an object'))
})

/**
 * A kit may ask not to be loaded at boot. Optional, and every kit any theme has declared so
 * far says nothing and loads with the rest — so the first thing asserted is that silence is
 * still the default. A non-boolean is the dangerous case: `lazy: 'no'` is truthy, and the kit
 * it is written on never loads at all.
 */
test('kits.lazy is an optional boolean', () => {
  assert.equal(manifest.kits.base.lazy, undefined)
  assert.deepEqual(validateManifest(manifest), [])
  const withLazy = (lazy) => validateManifest({ ...manifest, kits: { ...manifest.kits, forest: { ...manifest.kits.forest, lazy } } })
  assert.deepEqual(withLazy(true), [])
  assert.deepEqual(withLazy(false), [])
  assert.ok(withLazy('no').includes('kits.forest.lazy: expected a boolean'), withLazy('no').join(' | '))
  assert.ok(withLazy(1).includes('kits.forest.lazy: expected a boolean'))
})

/**
 * The decay block: what a quiet repo grows over itself, and where the dressing comes from.
 *
 * Absent is the contract for every theme that had ghosts before it existed — the space colony
 * still has none — so that is asserted first. Everything after it is a field that fails
 * silently when it is malformed: a `kit` the theme does not ship throws at the first dressed
 * plot, an empty `scatter` is a ramp with nothing on it, a `perCell` under one rounds to no
 * dressing at all, a `swap` key the kerb never places is a rule that fires on nothing, and a
 * `ruinAt` of 0 puts rubble on a repo that is working.
 */
test('decay is optional and every field is checked by name', () => {
  assert.equal(manifest.decay, undefined, 'a theme without decay is a theme whose ghosts are unchanged')
  assert.deepEqual(validateManifest(manifest), [])

  const good = {
    kit: 'forest',
    scatter: ['rock_small'],
    scale: [1.2, 2],
    perCell: 8,
    swap: { lights: 'rock_small' },
    ruin: { label: 'Ruin', parts: [{ node: 'rock_small' }] },
    ruinAt: 0.7,
  }
  const withDecay = (decay) => validateManifest({ ...manifest, decay })
  assert.deepEqual(withDecay(good), [], 'a whole block validates')
  // Only `kit` and `scatter` are load-bearing; the rest have defaults in the engine.
  assert.deepEqual(withDecay({ kit: 'forest', scatter: ['rock_small'] }), [])

  assert.ok(withDecay('rubble').includes('decay: expected an object'))
  const badKit = 'decay.kit: expected the name of a kit this theme declares'
  assert.ok(withDecay({ ...good, kit: 'rubble' }).includes(badKit))
  assert.ok(withDecay({ ...good, kit: undefined }).includes(badKit))

  const badScatter = 'decay.scatter: expected a non-empty array of node names'
  for (const bad of [undefined, [], 'rock_small', [7]]) assert.ok(withDecay({ ...good, scatter: bad }).includes(badScatter), String(bad))

  for (const bad of [0, 2.5, '8']) assert.ok(withDecay({ ...good, perCell: bad }).includes('decay.perCell: expected a positive integer'))
  for (const bad of [1.2, [1.2], [1.2, 2, 3], [1.2, '2']])
    assert.ok(withDecay({ ...good, scale: bad }).includes('decay.scale: expected a pair of numbers'), String(bad))

  assert.ok(withDecay({ ...good, swap: ['lights'] }).includes('decay.swap: expected an object'))
  assert.ok(withDecay({ ...good, swap: { lights: 7 } }).includes('decay.swap.lights: expected a node name'))
  // The key is a kerb prop, so it has to be one the kerb actually places.
  assert.ok(withDecay({ ...good, swap: { barrel: 'rock_small' } }).includes('decay.swap.barrel: "barrel" is not in plots.clutter'))

  assert.ok(withDecay({ ...good, ruin: { parts: [] } }).includes('decay.ruin.parts: expected a non-empty array'))
  assert.ok(withDecay({ ...good, ruin: 'rubble' }).includes('decay.ruin: expected an object'))
  // A ruin is a recipe, so its parts are staged by the rule every recipe is staged by.
  assert.ok(
    withDecay({ ...good, ruin: { parts: [{ node: 'rock_small', stage: 1.5 }] } }).includes('decay.ruin.parts[0].stage: expected a number in [0, 1]')
  )

  const badAt = 'decay.ruinAt: expected a number in (0, 1]'
  for (const bad of [0, 1.2, -0.3, '0.7']) assert.ok(withDecay({ ...good, ruinAt: bad }).includes(badAt), String(bad))
  assert.deepEqual(withDecay({ ...good, ruinAt: 1 }), [], 'a ruin that only ever arrives at the very end is legal')
})

/**
 * `ruinAt` is optional in the sense that a theme may leave the whole pair out, and not in any
 * other: `ruined(fade, undefined)` is false at every fade, so a recipe with no threshold under
 * it is a ruin no house ever falls to. That reads in the manifest as a working block and shows
 * nothing on screen, which is the shape of failure the schema is for.
 */
test('a ruin without a ruinAt is a ruin nothing ever falls to', () => {
  const base = { kit: 'forest', scatter: ['rock_small'] }
  const missing = 'decay.ruinAt: required when decay.ruin is declared'
  assert.ok(validateManifest({ ...manifest, decay: { ...base, ruin: { parts: [{ node: 'rock_small' }] } } }).includes(missing))
  assert.deepEqual(validateManifest({ ...manifest, decay: { ...base, ruin: { parts: [{ node: 'rock_small' }] }, ruinAt: 0.7 } }), [])
  // The other way round is fine: a threshold with no recipe is a theme that dresses the ground
  // and leaves its houses standing, which `createRuin` answers null for and nothing reads.
  assert.deepEqual(validateManifest({ ...manifest, decay: { ...base, ruinAt: 0.7 } }), [])
})

test('a recipe stage must be a number in [0, 1]', () => {
  const bad = structuredClone(manifest)
  bad.buildings.kinds.habitat.parts[0].stage = 1.5
  assert.ok(validateManifest(bad).some((e) => e.includes('buildings.kinds.habitat.parts[0].stage')))
})

test('byCharacter must name known characters and known kinds', () => {
  const m = structuredClone(manifest)
  m.crew.characters = [{ id: 'a', mesh: 'body_a' }]
  m.buildings.byCharacter = { a: ['habitat', 'nope'], zed: ['habitat'], b: [] }
  const errors = validateManifest(m)
  assert.ok(errors.some((e) => e.includes('byCharacter.a[1]')))
  assert.ok(errors.some((e) => e.includes('byCharacter.zed')))
  assert.ok(errors.some((e) => e.includes('byCharacter.b')))
})

test('the ghost copy strings are optional but must be strings when present', () => {
  const copy = { ...manifest.copy, fadeHint: 7 }
  assert.ok(validateManifest({ ...manifest, copy }).includes('copy.fadeHint: expected a string'))
  const bare = { ...manifest.copy }
  delete bare.fadeHint
  delete bare.hideHint
  delete bare.pinHint
  assert.deepEqual(validateManifest({ ...manifest, copy: bare }), [])
})

/**
 * The sound table (`manifest.sounds`) is read with no fallback wherever the theme has the
 * `sound` feature, so the feature requires it; its shape is held wherever it is written.
 */
test('both themes validate with their features, sound table and all', () => {
  assert.deepEqual(validateManifest(spaceTheme.manifest, spaceTheme.features), [])
  assert.deepEqual(validateManifest(villageTheme.manifest, villageTheme.features), [])
})

test('the sound feature requires a sound table; without the feature it is optional', () => {
  const bare = { ...manifest }
  delete bare.sounds
  assert.ok(validateManifest(bare, { sound: true }).includes('sounds: required when the theme declares the sound feature'))
  assert.deepEqual(validateManifest(bare, { sound: false }), [])
  assert.deepEqual(validateManifest(bare), [])
})

test('a sound table is checked field by field when present', () => {
  const at = (sounds) => validateManifest({ ...manifest, sounds })
  assert.ok(at([]).includes('sounds: expected an object'))
  const ok = manifest.sounds
  assert.ok(at({ ...ok, select: [] }).includes('sounds.select: expected a non-empty array of names'))
  assert.ok(at({ ...ok, select: ['select-1', 7] }).includes('sounds.select: expected a non-empty array of names'))
  assert.ok(at({ ...ok, attention: undefined }).includes('sounds.attention: expected a name'))
  assert.ok(at({ ...ok, work: '' }).includes('sounds.work: expected a name'))
  assert.ok(at({ ...ok, arrival: 'ship-hum' }).includes('sounds.arrival: expected an object'))
  assert.ok(at({ ...ok, arrival: { ship: {} } }).includes('sounds.arrival.ship: expected {loop} or {event}'))
  assert.ok(at({ ...ok, arrival: { ship: { hum: 'ship-hum' } } }).includes('sounds.arrival.ship: expected {loop} or {event}'))
  assert.ok(at({ ...ok, arrival: { ship: { loop: 3 } } }).includes('sounds.arrival.ship.loop: expected a name'))
  // Both at once is a shape the colony reads: the loop stands there, the event rings on news.
  assert.deepEqual(at({ ...ok, arrival: { ship: { loop: 'ship-hum', event: 'keep-bell' } } }), [])
})
