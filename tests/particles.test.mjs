import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { particles } from '../src/themes/medieval/particles.js'

const SOURCE = 'src/themes/medieval/particles.js'

/**
 * The village weather is thrown from the hook's own seeded stream, and these tests exist to
 * keep it that way. The snapshot harness swaps `Math.random` for one shared mulberry32 and
 * hands the same stream to `generateUUID`, so a hook that drew from it would move its snow,
 * embers and fireflies every time an earlier shot on the page allocated a mesh — a baseline
 * churn with no change behind it. What is asserted below is the property that stops that: the
 * throws depend on the hook's own draws and on nothing outside the module.
 */

/**
 * The smallest pool the recipes actually touch: the two emitters, the enabled flag, the
 * settings lookup and the weather's shared timer. Every spawn is written down verbatim, so
 * two hooks can be compared throw for throw rather than pixel for pixel.
 */
function stubPool() {
  const records = []
  const emitter = (name) => ({ spawn: (...args) => records.push([name, ...args]) })
  return {
    records,
    pool: {
      enabled: true,
      settings: { get: () => 'full' },
      ambientTimer: 0,
      dust: emitter('dust'),
      glow: emitter('glow'),
    },
  }
}

/** One pass over every recipe that draws: chips, boot dust, confetti, an ember, both weathers. */
function exercise(fx) {
  fx.work(1, 2, 3)
  fx.step(1, 2, 3, { r: 0.5, g: 0.5, b: 0.5 })
  fx.cheer(4, 5, 6)
  fx.torch(7, 8, 9)
  const camera = { position: { x: 0, y: 0, z: 0 } }
  const lamps = [
    { x: 1, y: 2, z: 3 },
    { x: 4, y: 5, z: 6 },
  ]
  for (let i = 0; i < 6; i++) fx.ambient(0.5, camera, { id: 'mountain', dust: 1 }, lamps, 0.9)
  for (let i = 0; i < 6; i++) fx.ambient(0.5, camera, { id: 'valley', dust: 1 }, lamps, 0.9)
}

/** The gate: a `Math.random` back in this file is the bug, whatever it is spelled around. */
test('the medieval particle hook never calls Math.random', async () => {
  const src = await readFile(SOURCE, 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(!code.includes('Math.random'), 'no Math.random outside the comments')
})

/** Same calls, same throws — the stream is the hook's, so two hooks are the same weather. */
test('two hooks given the same calls push identical records', () => {
  const a = stubPool()
  const b = stubPool()
  exercise(particles(a.pool))
  exercise(particles(b.pool))
  assert.ok(a.records.length > 30, `the pass throws something (${a.records.length} spawns)`)
  assert.deepEqual(a.records, b.records)
})

/** And the shared stream cannot reach them: nailing `Math.random` down changes nothing. */
test('stubbing Math.random leaves the weather where it was', () => {
  const free = stubPool()
  exercise(particles(free.pool))

  const real = Math.random
  const pinned = stubPool()
  try {
    Math.random = () => 0.42
    exercise(particles(pinned.pool))
  } finally {
    Math.random = real
  }
  assert.deepEqual(pinned.records, free.records)
})
