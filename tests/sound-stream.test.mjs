import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Sound runs off audio callbacks and timers, where `isolated` cannot reach, so it must never
 * name `Math.random`: every draw it makes is the sound stream's (`featureRng('sound')`).
 */
for (const file of ['src/audio/ambience.js', 'src/audio/synth.js']) {
  test(`${file} draws from the sound stream, never Math.random`, () => {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    assert.doesNotMatch(code, /Math\.random/)
    assert.match(code, /featureRng\('sound'\)/)
  })
}
