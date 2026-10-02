import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createSkyIsland } from '../src/world/skyisland.js'
import { installWorldCurve } from '../src/core/curve.js'
import { WORLDS } from '../src/worlds/index.js'

/** The hand-written vertex shaders the floating island builds: the cloud sea and the puffs. */
const handWritten = () => {
  const island = createSkyIsland({ planet: WORLDS.sky, heightAt: () => 0 })
  const out = []
  island.group.traverse((o) => {
    if (o.material instanceof THREE.ShaderMaterial) out.push(o.material.vertexShader)
  })
  return out
}

/**
 * Only a theme with `curve` installs `bcBend`, and the village, which has none, now lists the
 * sky world. A shader that called it there would not compile, so the island's two hand-written
 * shaders project unbent until the curve is installed, and bent after.
 */
test("the floating island's own shaders call bcBend only once the curve is installed", () => {
  const flat = handWritten()
  assert.equal(flat.length, 2, 'the cloud sea and the puffs')
  for (const glsl of flat) assert.ok(!glsl.includes('bcBend'), 'no curve, no bend')

  installWorldCurve()
  const bent = handWritten()
  assert.equal(bent.length, 2)
  for (const glsl of bent) assert.ok(glsl.includes('bcBend('), 'the curve bends them')
  // Nothing else differs: the unbent shader is the bent one with the call taken out.
  bent.forEach((glsl, i) => assert.equal(glsl.replace(/bcBend\(/g, '('), flat[i]))
})
