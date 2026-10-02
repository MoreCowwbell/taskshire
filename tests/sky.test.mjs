import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

// A localStorage the settings module can use under Node, exactly as `settings.test.mjs` does.
// It has to be in place *before* `src/core/settings.js` is imported, because `load()` runs in
// the constructor and a missing global would only ever hand back the defaults — which is what
// this file wants anyway, but relying on a thrown ReferenceError for it would be luck.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { Settings } = await import('../src/core/settings.js')
const { Sky } = await import('../src/world/sky.js')
const { manifest: space } = await import('../src/themes/space/manifest.js')

/** Any real setting will do — the throttle is the same on all three. */
const MOON = space.settings.find((s) => s.id === 'moon')

/** The cadence `_refreshEnvironment` holds to, in simulation seconds. `sky.js` writes it inline. */
const CADENCE = 0.22

/**
 * A sky with no renderer behind it, wearing a counting prefilter.
 *
 * `_buildEnvironment` returns before it touches `THREE.PMREMGenerator` when there is no
 * renderer, which is what makes a headless `Sky` possible at all. So the sky here is built with
 * an empty object for a renderer: `PMREMGenerator`'s constructor only stores it, and
 * `_buildEnvironment` then sets the throttle's fields exactly as it does in the browser — which
 * is the point, because the fix *is* one of those initial values (`_envAt` at minus infinity),
 * and a test that wrote it by hand would pass with the fix reverted. Only the generator is then
 * replaced, by a counter: `fromScene` is the only thing in the method that costs anything, so
 * counting calls to it *is* measuring the throttle.
 *
 * `setSetting` is the call the colony makes right after construction (`src/game/colony.js`),
 * and it is what gives `setTime` a palette to work from. It leaves `_envDirty` true, which is
 * the state a freshly built sky is genuinely in, so the setup below re-states rather than
 * fakes it.
 */
function makeSky() {
  store.clear()
  const settings = new Settings()
  const scene = new THREE.Scene()
  const sky = new Sky(scene, settings, {})
  sky.setSetting(MOON)
  assert.equal(sky._envAt, -Infinity, 'the constructor leaves the first refresh unthrottled')
  assert.equal(sky._envDirty, true, 'and the sky dirty')

  let calls = 0
  sky.pmrem = {
    fromScene: () => {
      calls++
      return { texture: {}, dispose() {} }
    },
    dispose() {},
  }
  return { sky, scene, settings, calls: () => calls }
}

/**
 * Without a renderer there is no prefilter, and a sky in that state has to be inert rather
 * than broken: the whole headless half of this file rests on it, and so does every first frame
 * in the browser before the generator exists.
 */
test('a sky with no renderer prefilters nothing at all', () => {
  store.clear()
  const sky = new Sky(new THREE.Scene(), new Settings(), null)
  assert.equal(sky.pmrem, undefined, 'no renderer, no generator')
  sky._refreshEnvironment(0)
  sky._refreshEnvironment(10, true)
  assert.equal(sky.scene.environment, null)
  sky.dispose()
})

/**
 * The first refresh is never throttled, whatever the clock says.
 *
 * `_envAt` opens at minus infinity precisely so that `elapsed - _envAt` cannot be small on the
 * first frame, and the frame loop's clock starts at or near zero — so a comparison against a
 * zero-initialised `_envAt` would have swallowed the very refresh the sky most needs.
 */
test('the first refresh lands on the first frame and clears the dirty flag', () => {
  const { sky, scene, calls } = makeSky()
  sky._refreshEnvironment(0)
  assert.equal(calls(), 1, 'the sky is prefiltered on frame one')
  assert.equal(sky._envDirty, false, 'and the flag it was raised by is cleared')
  assert.equal(sky._envAt, 0, 'the stamp is the simulation clock it was handed')
  assert.ok(scene.environment, 'the radiance map is on the scene')
  sky.dispose()
})

/**
 * The cadence itself, measured on the clock `update` hands down rather than on the wall.
 *
 * The boundary is the interesting half: the guard is `elapsed - _envAt < CADENCE`, so a frame
 * landing exactly on the cadence refreshes. That matters because the visual harness steps its
 * clock in fixed increments, and a strict `>` would make a refresh land or not land depending
 * on whether the step size happens to divide 0.22.
 */
test('a dirty sky refreshes no faster than the cadence, and exactly on it', () => {
  const { sky, calls } = makeSky()
  sky._refreshEnvironment(0)
  assert.equal(calls(), 1)

  sky._envDirty = true
  sky._refreshEnvironment(0.1)
  assert.equal(calls(), 1, 'a tenth of a second later is still too soon')
  sky._refreshEnvironment(CADENCE - 1e-9)
  assert.equal(calls(), 1, 'and a hair under the cadence is too soon')

  sky._refreshEnvironment(CADENCE)
  assert.equal(calls(), 2, 'the cadence itself is late enough')
  assert.equal(sky._envAt, CADENCE, 'and the clock moves on with it')
  assert.equal(sky._envDirty, false)
  sky.dispose()
})

/**
 * A sky that has not moved is never prefiltered, however long the colony runs. This is the
 * other half of the throttle and the expensive half: a manual time of day holds `_envDirty`
 * down for the whole session, and the prefilter costs a couple of milliseconds a go.
 */
test('a clean sky is never prefiltered, however far the clock runs', () => {
  const { sky, calls } = makeSky()
  sky._refreshEnvironment(0)
  assert.equal(calls(), 1)
  for (const elapsed of [0.5, 1, 12, 600, 86400]) sky._refreshEnvironment(elapsed)
  assert.equal(calls(), 1, 'nothing moved, so nothing was rebuilt')
  assert.equal(sky._envAt, 0, 'and the stamp is still the last real refresh')
  sky.dispose()
})

/**
 * A forced refresh ignores both gates — it is what a settings change goes through, and the
 * point of it is that turning IBL on has to show up in the frame you turned it on in rather
 * than up to 0.22 s later.
 */
test('force refreshes past both the dirty flag and the cadence', () => {
  const { sky, calls } = makeSky()
  sky._refreshEnvironment(0)
  assert.equal(calls(), 1)

  // Clean *and* inside the cadence: both gates shut, and force walks through anyway.
  assert.equal(sky._envDirty, false)
  sky._refreshEnvironment(0.001, true)
  assert.equal(calls(), 2, 'a forced refresh is not throttled')
  assert.equal(sky._envAt, 0.001, 'and it re-stamps the clock like any other')
  sky.dispose()
})

/**
 * The clock is the simulation's, not the page's — checked by taking the page's away.
 *
 * This is the whole of the change. The cadence used to be measured with `performance.now()`,
 * which made the first refresh land on whichever frame the page's clock happened to pass
 * 220 ms; the harness pins its clock at boot and reads it at about 110 ms, so a quick boot and
 * a slow one refreshed on different frames and the prefilter's first-time allocations re-seated
 * every seeded draw behind them. A `performance.now` that throws is the only way to prove the
 * reading is gone rather than merely unused today.
 */
test('the throttle never consults the page clock', () => {
  const real = globalThis.performance.now
  Object.defineProperty(globalThis.performance, 'now', {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error('the sky read performance.now()')
    },
  })
  try {
    const { sky, calls } = makeSky()
    sky._refreshEnvironment(0)
    sky._envDirty = true
    sky._refreshEnvironment(0.1)
    sky._refreshEnvironment(CADENCE)
    sky._refreshEnvironment(CADENCE + 0.001, true)
    assert.equal(calls(), 3, 'the same cadence, with no page clock to read')
    sky.dispose()
  } finally {
    // `now` is a prototype method; deleting the own property put on top restores the original
    // shape, where re-defining it would leave a shadow that happens to hold the same function.
    delete globalThis.performance.now
    assert.equal(globalThis.performance.now, real, 'the page clock is back')
  }
})

/**
 * And the frame loop drives it: `update` is the only caller in play, it hands down the
 * simulation clock, and it caches that clock so a settings change arriving between frames has
 * a sensible `elapsed` to force with.
 *
 * The camera is real because `update` rides the dome, the stars and the companion on it before
 * it ever reaches the environment.
 */
test('update drives the throttle on the clock it is handed, and a settings change forces', () => {
  const { sky, scene, settings, calls } = makeSky()
  const camera = new THREE.PerspectiveCamera(38, 1.6, 0.1, 1000)

  sky.update(1 / 60, 0.016, camera)
  assert.equal(calls(), 1, 'the first frame prefilters')
  assert.equal(sky._envNow, 0.016, 'and update caches the clock it was given')
  assert.equal(sky._envAt, 0.016)

  // A second frame one frame later, with the sky moved again: inside the cadence, so held.
  sky._envDirty = true
  sky.update(1 / 60, 0.032, camera)
  assert.equal(calls(), 1, 'the very next frame is inside the cadence')
  assert.equal(sky._envNow, 0.032, 'though the cached clock still moves')

  // The settings panel, between frames. It forces off the cached clock rather than off a page
  // clock, so the rebuild lands now and the next frame is stamped from here.
  settings.set('iblIntensity', 0.6)
  sky.onSettingsChanged(new Set(['ibl']))
  assert.equal(calls(), 2, 'a settings change is not made to wait for the cadence')
  assert.equal(sky._envAt, 0.032, 'stamped from the frame loop’s own clock')
  assert.equal(scene.environmentIntensity, 0.6, 'and the new intensity is on the scene')
  sky.dispose()
})

/**
 * With IBL off there is nothing to prefilter, forced or not, and whatever was on the scene is
 * taken back off it — otherwise turning the setting off would leave the last radiance map
 * lighting the colony for the rest of the session.
 */
test('with IBL off nothing is prefiltered and the scene is cleared', () => {
  const { sky, scene, settings, calls } = makeSky()
  sky._refreshEnvironment(0)
  assert.equal(calls(), 1)
  assert.ok(scene.environment)

  settings.set('ibl', false)
  sky._refreshEnvironment(10, true)
  assert.equal(calls(), 1, 'a forced refresh with IBL off prefilters nothing')
  assert.equal(scene.environment, null, 'and the map it was lit by is gone')
  sky.dispose()
})

/** The cloud layer is its own feature: the dome's shader carries it only where it exists. */
test('the sky builds its cloud shader only where the clouds feature exists', async (t) => {
  const { configureFeatures, resolveFeatures } = await import('../src/core/features.js')
  t.after(() => configureFeatures(resolveFeatures()))
  const build = () => {
    store.clear()
    const sky = new Sky(new THREE.Scene(), new Settings(), null)
    const frag = sky.dome.material.fragmentShader
    sky.dispose()
    return frag
  }
  configureFeatures(resolveFeatures({ clouds: true }))
  assert.match(build(), /uCloudAmount/)
  configureFeatures(resolveFeatures())
  assert.doesNotMatch(build(), /uCloudAmount/)
})
