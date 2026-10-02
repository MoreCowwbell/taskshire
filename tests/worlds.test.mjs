/**
 * The world library and the resolver that dresses it (`src/worlds/`).
 *
 * A theme's `settings` are no longer written out: each is a library world wearing the theme's
 * dressing. These tests hold the result to the golden's `settings` hashes — first recorded from
 * the hand-written settings, and re-recorded when `lakes`, `farShade` and the scatter style
 * moved from the theme flag into the data — and hold the resolver to the two promises the
 * engine leans on: the same world and dressing always give the very same object, and a
 * setting's keys come out in the order they always had.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settingHash } from './fixtures/canonical.mjs'
import { manifest as space } from '../src/themes/space/manifest.js'
import { manifest as medieval } from '../src/themes/medieval/manifest.js'
import { BIOMES, WORLDS, WORLD_GROUPS, WORLD_IDS } from '../src/worlds/index.js'
import { dressingFor, resolveSetting, resolveSettings } from '../src/worlds/resolve.js'
import { validateDressing, validateManifest, validateSetting, validateWorld } from '../src/themes/schema.js'

const THEMES = { space, medieval }
/** The village's menu, as the owner signed it off on the screenshots (2026-10-01). */
const MEDIEVAL_MENU = ['forest', 'valley', 'mountain', 'beach', 'ocean', 'desert']
const golden = JSON.parse(readFileSync(new URL('./fixtures/worlds-golden.json', import.meta.url), 'utf8'))

test('the library holds every world once, each with a biome', () => {
  assert.equal(WORLD_IDS.length, 15)
  // Both themes list every world, so each theme's list is the library, as a set.
  for (const manifest of [space, medieval]) assert.deepEqual([...manifest.worlds].sort(), [...WORLD_IDS].sort())
  for (const id of WORLD_IDS) {
    assert.equal(WORLDS[id].id, id)
    assert.ok(BIOMES.includes(WORLDS[id].biome), `${id} biome ${WORLDS[id].biome}`)
  }
})

test('the picker groups hold every world exactly once, and both themes list them in order', () => {
  assert.deepEqual(
    WORLD_GROUPS.map((g) => [g.id, g.name]),
    [['green', 'Green'], ['water', 'Water'], ['cold', 'Cold & high'], ['exotic', 'Exotic'], ['sky', 'Sky']],
  )
  const flat = WORLD_GROUPS.flatMap((g) => g.worlds)
  assert.equal(flat.length, WORLD_IDS.length)
  assert.deepEqual([...flat].sort(), [...WORLD_IDS].sort())
  for (const manifest of Object.values(THEMES)) assert.deepEqual(manifest.worlds, flat)
  assert.equal(space.defaultWorld, 'moon')
  assert.equal(medieval.defaultWorld, 'forest')
})

test('a defaultWorld the theme does not list is refused', () => {
  const without = {
    ...medieval,
    worlds: medieval.worlds.filter((id) => id !== 'valley'),
    settings: medieval.settings.filter((s) => s.id !== 'valley'),
    menu: undefined,
  }
  assert.deepEqual(validateManifest({ ...without, defaultWorld: 'forest' }), [])
  assert.deepEqual(validateManifest({ ...without, defaultWorld: 'valley' }), ['defaultWorld: "valley" is not a world this theme lists'])
  assert.deepEqual(validateManifest({ ...medieval, defaultWorld: 'nowhere' }), ['defaultWorld: "nowhere" is not a world this theme lists'])
  assert.deepEqual(validateManifest({ ...medieval, defaultWorld: 7 }), ['defaultWorld: expected a world id'])
})

test('each theme shows its own menu', () => {
  assert.deepEqual(space.menu, ['moon', 'mars', 'terra', 'beach', 'ocean', 'jungle', 'desert', 'tundra', 'autumn', 'sakura', 'volcanic', 'sky'])
  assert.deepEqual(medieval.menu, MEDIEVAL_MENU)
  for (const m of [space, medieval]) assert.ok(m.menu.includes(m.defaultWorld))
  // Hidden worlds still resolve: every world stays built in both themes.
  for (const m of [space, medieval]) assert.equal(m.settings.length, 15)
})

test('a bad menu is refused', () => {
  assert.deepEqual(validateManifest({ ...medieval, menu: [] }), ['menu: expected a non-empty array of world ids'])
  assert.deepEqual(validateManifest({ ...medieval, menu: ['forest', 'nowhere'] }), ['menu[1]: "nowhere" is not a world this theme lists'])
  assert.deepEqual(validateManifest({ ...medieval, menu: ['forest', 'forest'] }), ['menu[1]: "forest" is listed twice'])
  assert.deepEqual(validateManifest({ ...medieval, menu: ['valley'] }), ['menu: defaultWorld "forest" is not on it'])
})

for (const [theme, manifest] of Object.entries(THEMES)) {
  test(`${theme}: every resolved setting carries exactly what the golden recorded`, () => {
    assert.deepEqual(
      manifest.settings.map((s) => s.id),
      manifest.worlds,
      "settings follow the theme's world list",
    )
    for (const setting of manifest.settings) {
      const want = golden.pairs[`${theme}/${setting.id}`]?.settings
      assert.ok(want, `${theme}/${setting.id} is not in the golden`)
      assert.equal(settingHash(setting), want, `${theme}/${setting.id}`)
    }
  })

  test(`${theme}: settings are the resolver's own objects, and resolving again returns them`, () => {
    const again = resolveSettings(manifest.worlds, manifest.dressing)
    manifest.settings.forEach((s, i) => assert.equal(again[i], s, s.id))
    for (const id of manifest.worlds) {
      const a = resolveSetting(WORLDS[id], manifest.dressing)
      const b = resolveSetting(WORLDS[id], manifest.dressing)
      assert.equal(a, b, id)
      // `Colony.setSetting` rebuilds the arrival whenever this identity changes.
      assert.equal(a.ceremony, b.ceremony, `${id} ceremony`)
    }
  })

  test(`${theme}: the library and the dressing validate`, () => {
    assert.deepEqual(validateManifest(manifest), [])
    assert.deepEqual(validateDressing(manifest.dressing, manifest), [])
    for (const id of WORLD_IDS) assert.deepEqual(validateWorld(WORLDS[id]), [], id)
  })

  test(`${theme}: every world in the library resolves to a valid setting`, () => {
    for (const id of WORLD_IDS) {
      const s = resolveSetting(WORLDS[id], manifest.dressing)
      assert.deepEqual(validateSetting(s, manifest, `${theme}/${id}`), [])
    }
  })
}

/**
 * The key order is what the hand-written settings had, which the dressed keys only reproduce
 * because each is placed after the key it followed there. Spelled out for the worlds where
 * that placement differs: the three village worlds put the arrival in three different places,
 * the desert tints after its ground and the beach plants after its shape. The scatter style,
 * which no hand-written setting had, follows the recipe it plants. The village's own worlds'
 * sound and atmosphere, which no hand-written setting had either, follow `dust`.
 */
test('dressed keys land where the hand-written settings had them', () => {
  const keys = (manifest, id) => Object.keys(manifest.settings.find((s) => s.id === id))
  const LOOK = ['ground', 'rock', 'horizon', 'sky', 'fog', 'sun', 'ambient', 'atmosphere', 'craters', 'roughness']
  const SCATTER = ['scatter', 'budget', 'spread', 'groves', 'retries', 'kitFallback', 'flora']
  const AIR = ['grade', 'grass', 'clouds', 'fauna']
  assert.deepEqual(keys(medieval, 'forest'), ['id', 'name', 'blurb', 'atlas', ...LOOK, ...SCATTER, 'rim', 'ceremony', 'hills', 'companion', 'dust', 'audio', ...AIR])
  assert.deepEqual(keys(medieval, 'valley'), ['id', 'name', 'blurb', 'atlas', ...LOOK, ...SCATTER, 'rim', 'coast', 'water', 'ceremony', 'ridge', 'hills', 'companion', 'dust', 'audio', ...AIR])
  assert.deepEqual(keys(medieval, 'mountain'), ['id', 'name', 'blurb', 'atlas', ...LOOK, ...SCATTER, 'rim', 'ridge', 'hills', 'ceremony', 'clearing', 'companion', 'dust', 'audio', 'grade', 'clouds', 'fauna'])
  assert.deepEqual(keys(space, 'desert').slice(0, 6), ['id', 'name', 'blurb', 'ground', 'buildingTint', 'rock'])
  assert.deepEqual(keys(space, 'beach').slice(12, 15 + 6), ['roughness', 'shape', ...SCATTER])
  // The crags come after the ridge's own numbers, and the drones last of the animals.
  assert.deepEqual(Object.keys(medieval.settings.find((s) => s.id === 'valley').ridge), ['axis', 'from', 'width', 'height', 'recipe', 'count'])
  for (const s of space.settings) assert.equal(Object.keys(s.fauna).at(-1), 'drones', s.id)
})

test('a setting shares nothing with the library or with the other theme', () => {
  const a = resolveSetting(WORLDS.terra, space.dressing)
  const b = resolveSetting(WORLDS.terra, medieval.dressing)
  assert.notEqual(a, b)
  assert.notEqual(a.ground, WORLDS.terra.ground)
  assert.notEqual(a.fauna, b.fauna)
  assert.notEqual(a.fauna.birds, WORLDS.terra.fauna.birds)
  assert.equal(WORLDS.terra.fauna.drones, undefined, 'the drones never reach the library')
  assert.equal(a.biome, undefined, 'nor does the biome reach the setting')
})

/**
 * `Colony.setSetting` rebuilds the arrival whenever the ceremony object changes, so two worlds
 * inheriting one block from the same dressing entry must be handed one object — still a copy,
 * and still never shared with another dressing. No listed world inherits the village's default
 * ceremony, so a dressing of the test's own stands in.
 */
test('worlds inheriting one dressing value get the identical copy of it', () => {
  const dressing = {
    worlds: { valley: { ceremony: { kind: 'boat', cell: { q: -3, r: 1 } } } },
    default: { scatter: 'meadow', ceremony: { kind: 'castle' }, drones: { count: 1 } },
  }
  const [forest, valley, mountain] = resolveSettings(['forest', 'valley', 'mountain'], dressing)
  assert.equal(forest.ceremony, mountain.ceremony, 'the default ceremony is one object')
  assert.deepEqual(forest.ceremony, { kind: 'castle' })
  assert.notEqual(forest.ceremony, dressing.default.ceremony, 'and a copy, not the dressing')
  assert.notEqual(valley.ceremony, forest.ceremony, "a world's own entry is its own")
  assert.equal(forest.fauna.drones, valley.fauna.drones, 'the drones likewise')
  const other = resolveSetting(WORLDS.forest, { ...dressing })
  assert.notEqual(other.ceremony, forest.ceremony, 'another dressing copies its own')
})

test('a world is dressed by its own entry, then its biome, then the default', () => {
  const dressing = {
    worlds: { terra: { scatter: 'mine' } },
    biomes: { green: { scatter: 'biome', buildingTint: 1 } },
    default: { scatter: 'default', buildingTint: 2, drones: { count: 1 } },
  }
  assert.deepEqual(dressingFor(WORLDS.terra, dressing), { scatter: 'mine', buildingTint: 1, drones: { count: 1 } })
  assert.deepEqual(dressingFor(WORLDS.sakura, dressing), { scatter: 'biome', buildingTint: 1, drones: { count: 1 } })
  assert.deepEqual(dressingFor(WORLDS.moon, dressing), { scatter: 'default', buildingTint: 2, drones: { count: 1 } })
  // A world with no animals of its own still flies the theme's drones. Every library world
  // names its fauna now (an empty one where nothing lives), so a forest without it stands in.
  const { fauna, ...bare } = WORLDS.forest
  assert.ok(fauna, 'the forest has wildlife of its own')
  assert.deepEqual(resolveSetting(bare, dressing).fauna, { drones: { count: 1 } })
  // One with animals keeps them, and the drones come last.
  assert.deepEqual(Object.keys(resolveSetting(WORLDS.forest, dressing).fauna), ['birds', 'butterflies', 'drones'])
})

test('a null in the dressing takes the key away, and only a rim may be null', () => {
  const dressing = {
    worlds: { forest: { atlas: null } },
    biomes: { sky: { rim: null } },
    default: { scatter: 'meadow', atlas: 'summer', rim: { recipe: 'valleyRim', inner: 52, outer: 80, count: 520 } },
  }
  const sky = resolveSetting(WORLDS.sky, dressing)
  assert.equal(Object.hasOwn(sky, 'rim'), false, 'the biome took the rim away')
  assert.equal(sky.atlas, 'summer')
  const forest = resolveSetting(WORLDS.forest, dressing)
  assert.equal(Object.hasOwn(forest, 'atlas'), false, "the world's own entry took the atlas away")
  assert.equal(forest.rim.recipe, 'valleyRim')
  // The village's own sky is dressed that way.
  assert.equal(Object.hasOwn(medieval.settings.find((s) => s.id === 'sky'), 'rim'), false)
  assert.deepEqual(validateDressing({ worlds: {}, biomes: { sky: { rim: null } }, default: {} }, medieval), [])
  assert.ok(validateDressing({ worlds: {}, biomes: { sky: { scatter: null } }, default: {} }, medieval).includes('dressing.biomes.sky.scatter: expected a string'))
})

test('a ridge takes its crags from the dressing by index, and stands bare without them', () => {
  const mountain = resolveSetting(WORLDS.mountain, medieval.dressing)
  assert.deepEqual(
    mountain.ridge.map((r) => [r.recipe, r.count]),
    [
      ['alpineWall', 6400],
      ['alpineWall', 3600],
    ],
  )
  // A dressing that names no crags leaves the walls bare.
  const bare = resolveSetting(WORLDS.mountain, { worlds: {}, biomes: {}, default: { scatter: 'rocks' } })
  assert.deepEqual(Object.keys(bare.ridge[0]), ['axis', 'from', 'width', 'height'])
  // And the colony's mountain carries rock on both.
  assert.deepEqual(
    resolveSetting(WORLDS.mountain, space.dressing).ridge.map((r) => [r.recipe, r.count]),
    [
      ['crags', 6400],
      ['crags', 3600],
    ],
  )
})

test('a world missing a key, or carrying a dressed one, fails validation', () => {
  const { fog, ...noFog } = WORLDS.moon
  assert.ok(validateWorld(noFog).includes('worlds.moon.fog: missing'))
  assert.ok(validateWorld({ ...WORLDS.moon, biome: 'swamp' }).some((e) => e.startsWith('worlds.moon.biome')))
  assert.ok(validateWorld({ ...WORLDS.moon, scatter: 'rocks' }).includes("worlds.moon.scatter: belongs to a theme's dressing, not to the world"))
  assert.ok(validateWorld({ ...WORLDS.moon, fauna: { drones: { count: 3 } } }).includes("worlds.moon.fauna.drones: belongs to a theme's dressing, not to the world"))
  const crags = { ...WORLDS.valley, ridge: { ...WORLDS.valley.ridge, recipe: 'valleyHills' } }
  assert.ok(validateWorld(crags).some((e) => e.startsWith('worlds.valley.ridge.recipe')))
  assert.ok(validateWorld({ ...WORLDS.valley, dressedAfter: { ceremony: 'nowhere' } }).some((e) => e.startsWith('worlds.valley.dressedAfter.ceremony')))
})

test("a world's lakes and farShade are optional, and checked when present", () => {
  assert.deepEqual(validateWorld({ ...WORLDS.jungle, lakes: false }), [])
  assert.ok(validateWorld({ ...WORLDS.jungle, lakes: 'yes' }).includes('worlds.jungle.lakes: expected a boolean'))
  assert.ok(validateWorld({ ...WORLDS.moon, lakes: true }).includes('worlds.moon.lakes: needs a water level to dig the lakes down to'))
  assert.deepEqual(validateWorld({ ...WORLDS.forest, farShade: { from: 0.7, to: 0.35, amount: 0.75 } }), [])
  assert.ok(validateWorld({ ...WORLDS.forest, farShade: { from: 0.7, to: 0.35 } }).includes('worlds.forest.farShade.amount: missing'))
  assert.ok(validateWorld({ ...WORLDS.forest, farShade: 0.5 }).includes('worlds.forest.farShade: expected an object'))
  for (const bad of [NaN, Infinity, -Infinity])
    assert.ok(
      validateWorld({ ...WORLDS.forest, farShade: { from: 0.7, to: 0.35, amount: bad } }).includes('worlds.forest.farShade.amount: expected a finite number'),
      `farShade.amount ${bad} was accepted`,
    )
  assert.ok(validateWorld({ ...WORLDS.forest, farShade: { from: NaN, to: 0.35, amount: 0.75 } }).includes('worlds.forest.farShade.from: expected a finite number'))
})

test('an island or a coast without a water fails validation', () => {
  for (const id of ['ocean', 'beach']) {
    const { water, ...dry } = WORLDS[id]
    assert.ok(water, `${id} has a sea`)
    assert.ok(validateWorld(dry).includes(`worlds.${id}.shape: '${dry.shape}' needs a water to fill its sea`), id)
    const setting = { ...resolveSetting(WORLDS[id], space.dressing) }
    delete setting.water
    assert.ok(validateSetting(setting, space, id).includes(`${id}.shape: '${dry.shape}' needs a water to fill its sea`), `${id} setting`)
  }
  assert.deepEqual(validateWorld({ ...WORLDS.moon, shape: 'dunes' }), [], 'a shape with no sea needs none')
})

test("a dressing's scatter style is optional, checked when present, and never the world's", () => {
  const d = structuredClone(space.dressing)
  assert.deepEqual(validateDressing({ ...d, default: { scatter: 'flora' } }, space), [])
  d.worlds.moon = { ...d.worlds.moon, spread: 'sqrt', retries: 1, kitFallback: 'whole', flora: { is: 'flora' } }
  assert.deepEqual(validateDressing(d, space), [])
  Object.assign(d.default, { budget: -1, spread: 0, groves: 'yes', retries: 0.5, kitFallback: 'some', flora: { is: 'flora', not: 'rocks' } })
  assert.deepEqual(validateDressing(d, space), [
    'dressing.default.budget: expected a finite number, not negative',
    "dressing.default.spread: expected 'sqrt' or a finite number above 0",
    'dressing.default.groves: expected a boolean',
    'dressing.default.retries: expected a finite number, at least 1',
    'dressing.default.kitFallback: expected one of whole, filter',
    'dressing.default.flora: expected {is: recipe} or {not: recipe}',
  ])
  assert.ok(validateSetting({ ...space.settings[0], spread: 'pow' }, space, 'moon').includes("moon.spread: expected 'sqrt' or a finite number above 0"))
  assert.ok(validateWorld({ ...WORLDS.moon, budget: 900 }).includes("worlds.moon.budget: belongs to a theme's dressing, not to the world"))
})

test('a dressing naming an unknown recipe, world or key fails validation', () => {
  const d = structuredClone(medieval.dressing)
  d.worlds.valley.scatter = 'nope'
  d.worlds.valley.rim.recipe = 'nope'
  d.worlds.mountain.ridges[1].recipe = 'nope'
  d.biomes.green = { scatter: 'nope' }
  d.worlds.atlantis = {}
  d.default.ridge = []
  const errors = validateDressing(d, medieval)
  for (const want of [
    'dressing.worlds.valley.scatter: no recipe named "nope"',
    'dressing.worlds.valley.rim.recipe: no recipe named "nope"',
    'dressing.worlds.mountain.ridges[1].recipe: no recipe named "nope"',
    'dressing.biomes.green.scatter: no recipe named "nope"',
    'dressing.worlds.atlantis: not a world in src/worlds',
    'dressing.default.ridge: not something a dressing sets',
  ])
    assert.ok(errors.includes(want), `${want}\n${errors.join('\n')}`)
  // And the manifest check reports it too, as it does an unknown world in the theme's list.
  assert.ok(validateManifest({ ...medieval, dressing: d }).includes('dressing.worlds.valley.scatter: no recipe named "nope"'))
  assert.ok(validateManifest({ ...medieval, worlds: ['forest', 'atlantis'] }).includes('worlds[1]: "atlantis" is not a world in src/worlds'))
  assert.throws(() => resolveSettings(['atlantis'], medieval.dressing), /no world "atlantis"/)
})

/**
 * The village's atmosphere, world by world. Its three own worlds carry the values their round
 * picked and the twelve it borrows carry space's, but every one of them has to read as the
 * village: no cargo drones (the dressing has none, so none resolve), songbirds or crows and
 * butterflies over a green world, gulls and fish over a water one, and a grade inside the
 * gentle band space's own worlds keep to (saturation 0.95–1.15, warmth −0.05–0.10). `green`
 * and `water` are the library world's `biome`, the picker's group.
 */
test('medieval: every world has the village wildlife and a gentle grade', () => {
  assert.equal(medieval.settings.length, 15)
  for (const s of medieval.settings) {
    const { biome } = WORLDS[s.id]
    assert.equal(s.fauna?.drones, undefined, `${s.id}: drones in the village`)
    if (biome === 'green') {
      assert.ok(['swallow', 'crow'].includes(s.fauna?.birds?.kind), `${s.id}: a green world flies ${s.fauna?.birds?.kind}`)
      assert.ok(s.fauna.birds.count > 0, `${s.id}: an empty flock`)
      assert.ok(s.fauna?.butterflies?.count > 0, `${s.id}: a green world without butterflies`)
    }
    if (biome === 'water') {
      assert.equal(s.fauna?.birds?.kind, 'gull', `${s.id}: a water world flies ${s.fauna?.birds?.kind}`)
      assert.ok(s.fauna.birds.count > 0, `${s.id}: an empty flock`)
      assert.ok(s.fauna?.fish?.count > 0, `${s.id}: a water world without fish`)
    }
    assert.ok(s.grade, `${s.id}: no grade`)
    const { saturation, warmth } = s.grade
    assert.ok(saturation >= 0.95 && saturation <= 1.15, `${s.id}: saturation ${saturation}`)
    assert.ok(warmth >= -0.05 && warmth <= 0.1, `${s.id}: warmth ${warmth}`)
  }
  // The rules reach worlds that exist: two green and two water worlds at least.
  const count = (b) => medieval.settings.filter((s) => WORLDS[s.id].biome === b).length
  assert.ok(count('green') >= 2 && count('water') >= 2)
})
