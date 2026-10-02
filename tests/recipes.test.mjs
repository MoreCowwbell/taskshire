import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry } from '../src/core/rng.js'
import { expandRecipe } from '../src/world/recipes.js'
import { manifest } from '../src/themes/space/manifest.js'
import { LEGACY_KINDS, Recorder, DECK } from './fixtures/space-kinds-legacy.mjs'

test('every space recipe matches its legacy generator for 300 seeds', () => {
  const kinds = Object.keys(LEGACY_KINDS)
  assert.deepEqual(Object.keys(manifest.buildings.kinds), kinds)
  for (const kind of kinds) {
    for (let seed = 1; seed <= 300; seed++) {
      const rec = new Recorder()
      const label = LEGACY_KINDS[kind](rec, mulberry(seed), 0xc96442)
      const got = expandRecipe(manifest.buildings.kinds[kind], mulberry(seed), { deck: DECK })
      assert.equal(got.label, label, `${kind} label`)
      assert.deepEqual(got.parts, rec.parts, `${kind} seed ${seed}`)
    }
  }
})

test('numeric forms', () => {
  const r = expandRecipe({ label: 't', parts: [{ node: 'a', ry: { rand: { base: 0.17, scale: 0.09 } } }, { node: 'b', x: { jitter: 0.5, add: 1 } }] }, mulberry(7), { deck: 1 })
  const rand = mulberry(7)
  assert.equal(r.parts[0].ry, 0.17 + rand() * 0.09)
  assert.equal(r.parts[1].x, 1 + (rand() - 0.5) * 0.5)
})

test('the deck comes from the environment, not the recipe', () => {
  const r = expandRecipe({ label: 't', parts: [{ node: 'roof', y: 'deck' }] }, mulberry(1), { deck: 1.0 })
  assert.equal(r.parts[0].y, 1.0)
})

test('an unknown variable names itself', () => {
  assert.throws(
    () => expandRecipe({ label: 't', parts: [{ node: { var: 'tower' } }] }, mulberry(1), { deck: 1 }),
    /unknown variable "tower"/
  )
})

test('stage rides through on a part, inside a branch, and on a ring', () => {
  const r = expandRecipe(
    {
      label: 't',
      parts: [
        { node: 'body' },
        { node: 'barrel', stage: 0.55 },
        { if: -1, then: [{ node: 'tree', stage: 0.6 }] },
        { ring: { node: 'post', count: 2, radius: 1, stage: 0.7 } },
      ],
    },
    mulberry(3),
    { deck: 1 }
  )
  assert.deepEqual(r.parts.map((p) => p.stage), [0, 0.55, 0.6, 0.7, 0.7])
})
