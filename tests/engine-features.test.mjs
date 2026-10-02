import test from 'node:test'
import assert from 'node:assert/strict'
import { wantsPost } from '../src/core/engine.js'
import { resolveFeatures } from '../src/core/features.js'

const s = (v) => ({ get: (k) => v[k] })
const base = { bloom: false, antialias: false, tiltShift: false, colorGrade: true, ambientOcclusion: 0.25 }

test('without grade or occlusion, only bloom, SMAA and tilt-shift ask for post (a theme with neither)', () => {
  assert.equal(wantsPost(s(base), resolveFeatures()), false)
  assert.equal(wantsPost(s({ ...base, bloom: true }), resolveFeatures()), true)
  assert.equal(wantsPost(s({ ...base, antialias: true }), resolveFeatures()), true)
  assert.equal(wantsPost(s({ ...base, tiltShift: true }), resolveFeatures()), true)
})
test('grade asks for post only where the grade feature exists', () => {
  assert.equal(wantsPost(s({ ...base, ambientOcclusion: 0 }), resolveFeatures({ grade: true })), true)
  assert.equal(wantsPost(s({ ...base, ambientOcclusion: 0, colorGrade: false }), resolveFeatures({ grade: true })), false)
})
test('occlusion asks for post only where the occlusion feature exists', () => {
  assert.equal(wantsPost(s({ ...base, colorGrade: false }), resolveFeatures({ occlusion: true })), true)
  assert.equal(wantsPost(s({ ...base, colorGrade: false, ambientOcclusion: 0 }), resolveFeatures({ occlusion: true })), false)
})
