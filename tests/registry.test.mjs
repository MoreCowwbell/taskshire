import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveThemeId, loadTheme, menuSettingFor, menuSettings, settingFor, withDefaults } from '../src/themes/registry.js'

const space = {
  id: 'space',
  name: 'Space colony',
  manifest: { settings: [{ id: 'moon' }, { id: 'mars' }] },
  hooks: { ceremony: () => 'space-ceremony' },
}
const loaders = {
  space: async () => ({ default: space }),
  broken: async () => {
    throw new Error('missing glb')
  },
  bare: async () => ({ default: { id: 'bare', name: 'Bare', manifest: { settings: [{ id: 'one' }] }, hooks: {} } }),
}

test('resolveThemeId falls back to space', () => {
  assert.equal(resolveThemeId('space', ['space', 'bare']), 'space')
  assert.equal(resolveThemeId('nope', ['space', 'bare']), 'space')
  assert.equal(resolveThemeId(undefined, ['space']), 'space')
})

test('loadTheme returns the theme with assetUrl', async () => {
  const t = await loadTheme(loaders, 'space', { baseUrl: '/', validate: () => [] })
  assert.equal(t.id, 'space')
  assert.equal(t.assetUrl('crew.glb'), '/assets/crew.glb')
})

test('loadTheme falls back to space and reports why', async () => {
  const t = await loadTheme(loaders, 'broken', { baseUrl: '/', validate: () => [] })
  assert.equal(t.id, 'space')
  assert.match(t.fallbackReason, /missing glb/)
})

test('loadTheme rejects an invalid manifest and falls back', async () => {
  const t = await loadTheme(loaders, 'bare', {
    baseUrl: '/',
    validate: (m) => (m.settings.length > 1 ? [] : ['settings: need two']),
  })
  assert.equal(t.id, 'space')
  assert.match(t.fallbackReason, /settings: need two/)
})

test('a manifest that fails many checks reports one line, and the rest to the console', async () => {
  const t = await loadTheme(loaders, 'bare', {
    baseUrl: '/',
    validate: () => ['crew: missing', 'kits: expected at least one kit', 'plots: missing'],
  })
  // Short enough for a toast: first failure, how many more, and where to read them.
  assert.equal(t.fallbackReason, 'bare: crew: missing (+2 more; run npm run validate-kit bare)')
  assert.equal(t.fallbackDetail, 'bare: crew: missing; kits: expected at least one kit; plots: missing')
})

test('a single failure is reported whole, with no count', async () => {
  const t = await loadTheme(loaders, 'bare', { baseUrl: '/', validate: () => ['crew: missing'] })
  assert.equal(t.fallbackReason, 'bare: crew: missing')
})

test('withDefaults fills missing hooks from space and guards throwing hooks', () => {
  const t = withDefaults(
    {
      id: 'x',
      name: 'x',
      manifest: {},
      hooks: {
        faces: () => {
          throw new Error('boom')
        },
      },
    },
    space
  )
  assert.equal(t.hooks.ceremony(), 'space-ceremony')
  assert.equal(t.hooks.faces('scene'), undefined) // no space default for faces in this fixture
})

/**
 * `engine._loop` has no try/catch, so a ceremony that throws on its thousandth frame used to
 * stop the renderer. The method dies, the session carries on, and the log says which one.
 */
test('a live hook method that throws is logged once and then a no-op', () => {
  let calls = 0
  const ceremony = {
    group: 'the group',
    update() {
      calls++
      throw new Error('boom')
    },
    ping: () => 'pinged',
  }
  const t = withDefaults({ id: 'x', name: 'x', manifest: {}, hooks: { ceremony: () => ceremony } }, space)
  const made = t.hooks.ceremony()

  const warn = console.warn
  const logged = []
  console.warn = (...args) => logged.push(args[0])
  try {
    assert.equal(made.update(0.016), undefined) // does not rethrow
    assert.equal(made.update(0.016), undefined)
  } finally {
    console.warn = warn
  }

  assert.equal(calls, 1, 'the second call never reaches the broken method')
  assert.equal(logged.length, 1)
  assert.match(logged[0], /x\.ceremony.*update\(\)/)
  // One dead method does not take the rest of the object with it.
  assert.equal(made.ping(), 'pinged')
  assert.equal(made.group, 'the group')
})

/** Build-time hooks are left alone: the construction guard is the whole boundary there. */
test('a surfaces hook result is not wrapped', () => {
  const deck = { paint: () => 'painted' }
  const t = withDefaults({ id: 'x', name: 'x', manifest: {}, hooks: { surfaces: () => deck } }, space)
  assert.equal(t.hooks.surfaces(), deck)
})

test('settingFor picks by id and falls back to the first', () => {
  assert.equal(settingFor(space, 'mars').id, 'mars')
  assert.equal(settingFor(space, 'venus').id, 'moon')
})

/**
 * Both real themes list every world in group order, so neither's first is its home: an id a
 * theme does not list opens on its `defaultWorld`, and a listed one on itself, in either theme.
 * Off the menu too: Forest is built in space and the moon in the village, and the colony draws
 * either when asked (`menuSettingFor` is what keeps a person's pick on the menu).
 */
test("settingFor falls back to the theme's defaultWorld, not its first", async () => {
  const { default: spaceTheme } = await import('../src/themes/space/index.js')
  const { default: village } = await import('../src/themes/medieval/index.js')
  const find = (t, id) => t.manifest.settings.find((s) => s.id === id)
  assert.equal(spaceTheme.manifest.settings[0].id, 'forest')
  assert.equal(settingFor(spaceTheme, 'venus'), find(spaceTheme, 'moon'))
  assert.equal(settingFor(spaceTheme, undefined), find(spaceTheme, 'moon'))
  assert.equal(settingFor(spaceTheme, 'forest'), find(spaceTheme, 'forest'))
  assert.equal(settingFor(village, 'moon'), find(village, 'moon'))
  assert.equal(menuSettingFor(spaceTheme, 'forest'), find(spaceTheme, 'moon'))
  assert.equal(menuSettingFor(village, 'moon'), find(village, 'forest'))
  assert.equal(settingFor(village, 'venus'), find(village, 'forest'))
  // A default the list does not hold falls through to the first.
  const odd = { manifest: { defaultWorld: 'nowhere', settings: [{ id: 'a' }, { id: 'b' }] } }
  assert.equal(settingFor(odd, 'venus').id, 'a')
})

test('a stored world off the menu opens on the default, and menuSettings follows the menu', () => {
  const theme = { manifest: { settings: [{ id: 'forest' }, { id: 'sakura' }, { id: 'valley' }], defaultWorld: 'forest', menu: ['valley', 'forest'] } }
  assert.equal(menuSettingFor(theme, 'sakura').id, 'forest')
  assert.equal(menuSettingFor(theme, 'valley').id, 'valley')
  // In the list's order (the picker's), not the menu's.
  assert.deepEqual(menuSettings(theme).map((s) => s.id), ['forest', 'valley'])
  // Still built: the colony draws a hidden world when it is asked for one.
  assert.equal(settingFor(theme, 'sakura').id, 'sakura')
  delete theme.manifest.menu
  assert.equal(menuSettingFor(theme, 'sakura').id, 'sakura')
})

/**
 * The whole ceremony contract, on the one theme that can be built without a kit: `group`,
 * `door`, `update`, `ping`, `dispose`, and the three the colony reads to place it — `kind`,
 * `clearance` and `apron`.
 *
 * The last two are the point of the check. The space colony has one arrival and keeps its
 * numbers where they have always been, in `plots`, and hands them on unchanged — so the four
 * frozen space shots stay byte-identical however the village moves its own around.
 */
test('space theme exposes a ceremony hook with the contract', async () => {
  const THREE = await import('three')
  const { default: space } = await import('../src/themes/space/index.js')
  assert.equal(typeof space.hooks.ceremony, 'function')

  const scene = new THREE.Scene()
  const made = space.hooks.ceremony(scene, new THREE.Vector3(-22.8, 0, 0), space.manifest)
  assert.ok(made.group.isObject3D)
  for (const method of ['door', 'update', 'ping', 'dispose']) assert.equal(typeof made[method], 'function', method)
  assert.equal(made.kind, 'ship')
  assert.equal(made.clearance, space.manifest.plots.ceremonyClearance)
  assert.equal(made.apron, space.manifest.plots.ceremonyApron)
  // The door is a fixed offset in the group's own frame, so it answers before a single frame
  // has been drawn — which is what lets the colony place arrivals from the very first one.
  assert.ok(made.door(new THREE.Vector3()).isVector3)
  made.dispose()
})

test('space theme exposes a surfaces hook with the contract', async () => {
  const { default: space } = await import('../src/themes/space/index.js')
  assert.equal(typeof space.hooks.surfaces, 'function')
  const surf = space.hooks.surfaces(space.manifest)
  assert.equal(typeof surf.deck, 'function')
  assert.equal(typeof surf.kerb, 'function')
  assert.equal(typeof surf.deckTextureScale, 'number')
  assert.ok(surf.kerbUv.top && surf.kerbUv.side)
  // The two optional fields, absent — which is what puts `_buildDeck` and `_buildBorder` on
  // their default branches and keeps the four frozen space baselines where they are.
  assert.equal(surf.deckGeometry, undefined, 'the space deck is the engine’s own prism')
  assert.equal(surf.kerbInset, undefined, 'and its kerb sits at the engine’s own 0.05')
})

/**
 * The two optional fields, held to their shapes wherever a theme declares them.
 *
 * Neither is schema-validated — the surfaces return shape never has been — so this is the
 * whole guard on them, and it runs over every theme rather than over a named one, because a
 * fourth theme that types `kerbInset: '0.38'` should fail here rather than in a renderer.
 */
test('every theme’s optional surfaces fields have the right shape', async () => {
  const { THEME_IDS } = await import('../src/themes/index.js')
  const loaders = {
    space: () => import('../src/themes/space/index.js'),
    medieval: () => import('../src/themes/medieval/index.js'),
  }
  for (const id of THEME_IDS) {
    const { default: theme } = await loaders[id]()
    const surf = theme.hooks.surfaces(theme.manifest)
    if (surf.deckGeometry !== undefined) {
      assert.equal(typeof surf.deckGeometry, 'function', `${id}: deckGeometry builds one cell`)
    }
    if (surf.kerbInset !== undefined) {
      const ok =
        typeof surf.kerbInset === 'function' || (Number.isFinite(surf.kerbInset) && surf.kerbInset >= 0)
      assert.ok(ok, `${id}: kerbInset is a function or a finite distance, got ${surf.kerbInset}`)
    }
  }
})

test('space theme exposes a faces hook with the contract', async () => {
  const { default: space } = await import('../src/themes/space/index.js')
  assert.equal(typeof space.hooks.faces, 'function')
  const f = space.hooks.faces(space.manifest)
  assert.equal(typeof f.build, 'function')
  // Every frame has a cell, and the atlas has no spare row: upstream's walking faces took it
  // from 4×4 to 4×7 for 27 frames, so one cell of the last row is blank.
  const frames = Object.keys(f.FACE).length
  assert.ok(frames <= f.cols * f.rows && frames > f.cols * (f.rows - 1))
  assert.equal(f.FACE.idle, 0)
  assert.ok(f.FACE_LOOPS.working.every((frame) => Number.isInteger(frame)))
})

test('space theme exposes a particles hook with the contract', async () => {
  const { default: space } = await import('../src/themes/space/index.js')
  assert.equal(typeof space.hooks.particles, 'function')
  // A disabled pool is enough to prove the shape: every recipe returns early without one.
  const fx = space.hooks.particles({ enabled: false, settings: { get: () => 'full' } }, space.manifest)
  for (const name of ['work', 'step', 'cheer', 'snooze', 'ambient']) assert.equal(typeof fx[name], 'function')
  assert.equal(fx.work(0, 0, 0, 0), undefined)
})

/**
 * The `cues` contract, over every theme: a helper wears something in both, and whatever it is
 * costs nothing until one exists.
 *
 * `parts.length` is the guard that matters. It is the "nothing new at boot" rule in test form:
 * every geometry, material and Object3D three builds spends four draws of the seeded stream
 * the screenshot harness pins, so a cue part that leaked into `parts` would re-seat every
 * villager in every baseline. The counts are what the two hooks have always returned.
 */
test('every theme dresses a helper, and builds it only when asked', async () => {
  const { THEME_IDS } = await import('../src/themes/index.js')
  const loaders = {
    space: () => import('../src/themes/space/index.js'),
    medieval: () => import('../src/themes/medieval/index.js'),
  }
  const PARTS = { space: 8, medieval: 9 }
  for (const id of THEME_IDS) {
    const { default: theme } = await loaders[id]()
    const made = theme.hooks.props(theme.manifest)
    assert.equal(made.parts.length, PARTS[id], `${id}: the cue must not add a part at boot`)
    assert.equal(typeof made.cues?.helper, 'function', `${id}: cues.helper is a factory`)

    const names = new Set(made.parts.map((p) => p.name))
    const roles = theme.manifest.crew.attach
    const specs = made.cues.helper()
    assert.ok(specs.length >= 1, `${id}: the helper cue builds at least one part`)
    for (const spec of specs) {
      assert.ok(spec.bone in roles, `${id}: cue part "${spec.name}" hangs off bone role "${spec.bone}"`)
      assert.ok(!names.has(spec.name), `${id}: cue part "${spec.name}" collides with a worn part`)
      if (spec.node) {
        assert.ok(theme.manifest.crew.propNodes.includes(spec.node), `${id}: "${spec.node}" is not packed`)
      }
    }
    // Called twice, it hands back two sets of its own objects.
    //
    // Twice is not hypothetical: a `maxAgents` change disposes every part and calls
    // `_buildMeshes` again, which rebuilds each cue a live helper is wearing — so a factory
    // that closed over one geometry and handed the same one back would have it disposed on the
    // first rebuild and drawn on the second. Comparing the spec objects is enough to catch it:
    // a factory that builds fresh specs is one that builds fresh geometry and materials too,
    // and a factory returning a cached list fails here rather than in a black frame.
    assert.notEqual(made.cues.helper()[0], specs[0])
  }
})

test('medieval is a theme the registry will try to load', () => {
  // The id survives resolution: the stub is rejected by its manifest, not by never being
  // looked up, which is what makes the fallback path the one the user actually hits.
  assert.equal(resolveThemeId('medieval', ['space', 'medieval']), 'medieval')
})

test('the picker has a real name for every theme without loading one', async () => {
  // `THEME_NAMES` is a static table beside the loaders, so the settings panel can label a
  // lazy theme without importing it. Titling from the directory name would say "Medieval".
  const { THEME_IDS, THEME_NAMES } = await import('../src/themes/index.js')
  assert.ok(THEME_IDS.includes('space'))
  assert.ok(THEME_IDS.includes('medieval'))
  assert.equal(THEME_NAMES.space, 'Space colony')
  assert.equal(THEME_NAMES.medieval, 'Medieval village')
  // The point is the table, not its length: a fourth theme must arrive with a name too.
  for (const id of THEME_IDS) assert.equal(typeof THEME_NAMES[id], 'string', `no name for "${id}"`)
})

test('a theme whose manifest fails validation falls back to space', async () => {
  const { validateManifest } = await import('../src/themes/schema.js')
  /**
   * A half-written theme: a setting preset naming a scatter recipe it has not got, and none
   * of the blocks the engine builds from. This is the shape every theme starts as, and the
   * one the fallback exists for — the real medieval manifest passes validation, so it can no
   * longer stand in for it.
   */
  const halfWritten = {
    id: 'medieval',
    name: 'Medieval village',
    manifest: { assetDir: 'assets/medieval', settings: [{ id: 'forest', name: 'Forest', scatter: 'trees' }], scatter: {} },
    hooks: {},
  }
  const loaders = {
    space: () => import('../src/themes/space/index.js'),
    medieval: async () => ({ default: halfWritten }),
  }
  const t = await loadTheme(loaders, 'medieval', { baseUrl: '/', validate: validateManifest })
  assert.equal(t.id, 'space')
  // The first failure, a count, and where to read the rest — whichever field fails first.
  assert.match(t.fallbackReason, /^medieval: .+ \(\+\d+ more; run npm run validate-kit medieval\)$/)
  assert.match(t.fallbackDetail, /scatter: no recipe named "trees"/)
  assert.match(t.fallbackDetail, /kits: expected/)
  // The colony still has everything it needs to draw, which is the whole point of falling
  // back — including space's own asset directory rather than the stub's `assets/medieval`.
  assert.equal(typeof t.hooks.ceremony, 'function')
  assert.equal(t.assetUrl('crew.glb'), '/assets/space/crew.glb')
})

/**
 * A hook that falls back is not a detail for the console alone: the theme is half itself and
 * the screen has to say so. The registry records every fallback on the theme it returns, and
 * `onWarning` carries the ones that happen later to whoever is listening.
 */
test('a healthy theme has no warnings', () => {
  const t = withDefaults({ id: 'x', name: 'x', manifest: {}, hooks: { ceremony: () => ({ update() {} }) } }, space)
  assert.deepEqual(t.warnings, [])
})

test('a hook that throws at construction is recorded and reported', () => {
  const t = withDefaults(
    {
      id: 'x',
      name: 'x',
      manifest: {},
      hooks: {
        ceremony: () => {
          throw new Error('boom')
        },
      },
    },
    space
  )
  const seen = []
  t.onWarning = (m) => seen.push(m)
  const error = console.error
  console.error = () => {}
  try {
    t.hooks.ceremony()
  } finally {
    console.error = error
  }
  assert.equal(t.warnings.length, 1)
  assert.match(t.warnings[0], /hook "ceremony" threw/)
  assert.deepEqual(seen, t.warnings)
})

test('a live hook method that throws is recorded once', () => {
  const t = withDefaults(
    {
      id: 'x',
      name: 'x',
      manifest: {},
      hooks: {
        ceremony: () => ({
          update() {
            throw new Error('boom')
          },
        }),
      },
    },
    space
  )
  const made = t.hooks.ceremony()
  const warn = console.warn
  console.warn = () => {}
  try {
    made.update()
    made.update()
  } finally {
    console.warn = warn
  }
  assert.equal(t.warnings.length, 1)
  assert.match(t.warnings[0], /ceremony\.update\(\) threw/)
})

test('a theme without a features block gets none of space\'s, never inherits them', async () => {
  const t = await loadTheme(loaders, 'bare', { baseUrl: '/', validate: () => [] })
  assert.equal(t.id, 'bare')
  for (const [name, on] of Object.entries(t.features)) assert.equal(on, false, name)
  assert.ok(Object.isFrozen(t.features))
})

test('the real themes: space declares every feature, the village water, the seven of its atmosphere and sound', async () => {
  const real = {
    space: () => import('../src/themes/space/index.js'),
    medieval: () => import('../src/themes/medieval/index.js'),
  }
  const space = await loadTheme(real, 'space', { baseUrl: '/', validate: () => [] })
  assert.equal(Object.keys(space.features).length, 14)
  for (const [name, on] of Object.entries(space.features)) assert.equal(on, true, name)
  const medieval = await loadTheme(real, 'medieval', { baseUrl: '/', validate: () => [] })
  assert.equal(medieval.id, 'medieval')
  assert.equal(Object.keys(medieval.features).length, 14)
  // Motes and space's crew features stay off in the village.
  const on = Object.entries(medieval.features).filter(([, v]) => v).map(([k]) => k).sort()
  assert.equal(on.join(' '), 'clouds curve fauna grade grass occlusion overlay sound water')
})

test('a theme with an unknown feature falls back to space and says why', async () => {
  const bad = { ...loaders, bare: async () => ({ default: { ...(await loaders.bare()).default, features: { fuana: true } } }) }
  const t = await loadTheme(bad, 'bare', { baseUrl: '/', validate: () => [] })
  assert.equal(t.id, 'space')
  assert.match(t.fallbackReason, /unknown feature "fuana"/)
})

test('the registry hands the validator the theme features, so a sound theme with no sound table falls back', async () => {
  const seen = []
  const quiet = { id: 'quiet', name: 'Quiet', features: { sound: true }, manifest: { settings: [{ id: 'one' }] }, hooks: {} }
  const t = await loadTheme({ ...loaders, quiet: async () => ({ default: quiet }) }, 'quiet', {
    baseUrl: '/',
    validate: (m, features) => {
      seen.push(features)
      return features?.sound && !m.sounds ? ['sounds: required when the theme declares the sound feature'] : []
    },
  })
  assert.deepEqual(seen, [{ sound: true }])
  assert.equal(t.id, 'space')
  assert.equal(t.fallbackReason, 'quiet: sounds: required when the theme declares the sound feature')
})
