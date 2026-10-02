import test from 'node:test'
import assert from 'node:assert/strict'
import * as features from '../src/core/features.js'

const { FEATURE_NAMES, SHARED_FEATURES, THEME_FEATURES, resolveFeatures, configureFeatures, hasFeature } = features

/**
 * A feature is a system, shared or a theme's own. What the worlds do — their landform, their
 * tint, their yard — is world data and dressing, so there is no third list for it to ride on.
 */
test('the registry is the shared and the theme features, and nothing else', () => {
  assert.deepEqual([...FEATURE_NAMES], [...SHARED_FEATURES, ...THEME_FEATURES])
  assert.deepEqual(Object.keys(features).filter((k) => k.endsWith('_FEATURES')).sort(), ['SHARED_FEATURES', 'THEME_FEATURES'])
})

test('an undeclared theme has every feature off', () => {
  const f = resolveFeatures(undefined)
  assert.equal(Object.keys(f).length, FEATURE_NAMES.length)
  for (const name of FEATURE_NAMES) assert.equal(f[name], false, name)
  assert.ok(Object.isFrozen(f))
})

test('declared features are on, the rest off, and the result is frozen', () => {
  const f = resolveFeatures({ curve: true, sound: true })
  assert.equal(f.curve, true)
  assert.equal(f.sound, true)
  assert.equal(f.fauna, false)
  assert.ok(Object.isFrozen(f))
})

test('an unknown feature name is an error, not a silent no-op', () => {
  assert.throws(() => resolveFeatures({ fuana: true }), /unknown feature "fuana"/)
})

test('hasFeature reads the configured set and rejects a typo', () => {
  configureFeatures(resolveFeatures({ clouds: true }))
  assert.equal(hasFeature('clouds'), true)
  assert.equal(hasFeature('water'), false)
  assert.throws(() => hasFeature('cloud'), /unknown feature "cloud"/)
  configureFeatures(resolveFeatures())
})

test('the names are exactly the ones the spec lists', () => {
  assert.deepEqual([...FEATURE_NAMES].sort(), [
    'clouds', 'curve', 'faces', 'fauna', 'grade', 'grass', 'motes', 'occlusion', 'overlay',
    'phoneCheck', 'recentre', 'sound', 'visor', 'water',
  ])
})
