import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { featureRng, resetFeatureRngs, isolated, mulberry } from '../src/core/rng.js'

test('a feature stream is seeded by its name: stable, and distinct per feature', () => {
  resetFeatureRngs()
  const a = [featureRng('fauna')(), featureRng('fauna')()]
  resetFeatureRngs()
  const b = [featureRng('fauna')(), featureRng('fauna')()]
  assert.deepEqual(a, b)
  resetFeatureRngs()
  assert.notEqual(featureRng('fauna')(), featureRng('water')())
})

test('a feature stream is the same in every process: its first draws are pinned', () => {
  resetFeatureRngs()
  assert.equal(featureRng('fauna')(), 0.7135011090431362)
  assert.equal(featureRng('water')(), 0.9764113747514784)
})

test('three objects built inside isolated() spend no global draws', () => {
  const real = Math.random
  let draws = 0
  Math.random = () => (draws++, 0.5)
  try {
    isolated(mulberry(1), () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))
    assert.equal(draws, 0)
    new THREE.BoxGeometry()
    assert.equal(draws, 4) // the control: generateUUID spends four
  } finally {
    Math.random = real
  }
})

test('isolated() restores Math.random even when fn throws, and nests', () => {
  const real = Math.random
  assert.throws(() => isolated(mulberry(1), () => { throw new Error('boom') }), /boom/)
  assert.equal(Math.random, real)
  const outer = mulberry(1)
  isolated(outer, () => {
    isolated(mulberry(2), () => {})
    assert.equal(Math.random, outer, 'the outer stream is back once the inner call returns')
  })
  assert.equal(Math.random, real)
})

test('isolated() returns what fn returns', () => {
  assert.equal(isolated(mulberry(1), () => 42), 42)
})
