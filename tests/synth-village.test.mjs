import test from 'node:test'
import assert from 'node:assert/strict'
import { GENERATORS, createNoiseBuffers } from '../src/audio/synth.js'
import { SOUNDS } from '../src/audio/sounds.js'
import { createFakeAudio, silentAtStop, valueAt } from './fixtures/fake-audio.mjs'

/**
 * The village's sounds, built against a recording stand-in for Web Audio: each is well formed
 * (no exponential ramp to 0, nothing non-finite, no time constant ≤ 0), the one-shots end, the
 * hull's loop keeps creaking, and nothing an oscillator feeds is still sounding when it stops.
 */

const ONE_SHOTS = ['pluck-1', 'pluck-2', 'pluck-3', 'pluck-4', 'hand-bell', 'keep-bell']

function build(name) {
  const fake = createFakeAudio()
  const noise = createNoiseBuffers(fake.ctx)
  const dest = fake.ctx.createGain()
  const voice = GENERATORS[name](fake.ctx, dest, {}, noise)
  return { ...fake, voice }
}

const oscillators = (nodes) => nodes.filter((n) => n.kind === 'oscillator')

function assertStopsInSilence(nodes) {
  const stopped = oscillators(nodes).filter((o) => o.stopAt !== undefined)
  assert.ok(stopped.length > 0, 'no oscillator was stopped')
  for (const o of stopped) {
    assert.ok(silentAtStop(o), `a ${o.frequency.value} Hz ${o.type} stops at ${o.stopAt.toFixed(3)} s while its gain is above 0`)
  }
}

test('the village sounds are registered with their kinds and trims', () => {
  const want = {
    'pluck-1': ['event', 0.66],
    'pluck-2': ['event', 0.66],
    'pluck-3': ['event', 0.66],
    'pluck-4': ['event', 0.66],
    'hand-bell': ['event', 0.6],
    'keep-bell': ['event', 0.566],
    'hull-creak': ['loop', 1],
  }
  for (const [name, [kind, gain]] of Object.entries(want)) {
    assert.equal(SOUNDS[name]?.kind, kind, name)
    assert.equal(SOUNDS[name].gain, gain, name)
  }
})

for (const name of ONE_SHOTS) {
  test(`${name} builds, is well formed and ends within 3 s`, () => {
    const { voice, problems, nodes } = build(name)
    assert.deepEqual(problems, [])
    assert.ok(voice.until > 0.5 && voice.until <= 3, `until ${voice.until}`)
    for (const o of oscillators(nodes)) assert.ok(o.stopAt <= voice.until, `an oscillator outlives the voice: ${o.stopAt}`)
  })

  test(`${name} stops every oscillator after its gain has reached 0`, () => {
    assertStopsInSilence(build(name).nodes)
  })
}

test('every partial of both bells is at 0 at or before its stop', () => {
  for (const [name, partials] of [['hand-bell', 10], ['keep-bell', 5]]) {
    const { nodes } = build(name)
    const sines = oscillators(nodes)
    assert.equal(sines.length, partials, name)
    for (const o of sines) {
      const g = o.outputs[0]
      assert.equal(g.kind, 'gain', `${name}: a partial feeds its own gain`)
      assert.equal(valueAt(g.gain, o.stopAt), 0, `${name}: the ${o.frequency.value} Hz partial`)
      // Still sounding just before the closing ramp: the fix closes the decay, it does not cut it.
      assert.ok(valueAt(g.gain, o.stopAt - 0.06) > 0, `${name}: the ${o.frequency.value} Hz partial is silent too early`)
    }
  }
})

test('the stop-tick check fails a partial whose ramp to 0 lands after its stop', () => {
  const { ctx } = createFakeAudio()
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, 0)
  g.gain.linearRampToValueAtTime(1, 0.004)
  g.gain.setTargetAtTime(0, 0.004, 0.45)
  g.gain.setValueAtTime(Math.exp(-4), 1.804)
  g.gain.linearRampToValueAtTime(0, 1.804 + 0.06)
  const o = ctx.createOscillator()
  o.connect(g)
  g.connect(ctx.destination)
  o.stop(1.804 + 0.05)
  assert.equal(silentAtStop(o), false)
  g.gain.cancelScheduledValues(1.804)
  g.gain.setValueAtTime(Math.exp(-4), 1.804)
  g.gain.linearRampToValueAtTime(0, 1.804 + 0.04)
  assert.equal(silentAtStop(o), true)
})

test('a ramp straight after setTargetAtTime is reported, since it replaces the decay', () => {
  const { ctx, problems } = createFakeAudio()
  const g = ctx.createGain()
  g.gain.setTargetAtTime(0, 0.004, 0.45)
  g.gain.linearRampToValueAtTime(0, 1.844)
  assert.equal(problems.length, 1)
})

test('hull-creak runs 20 s of updates at 50 ms and lets at least two creaks go', () => {
  const { voice, problems, nodes, ctx } = build('hull-creak')
  assert.equal(voice.until, Infinity)
  for (let t = 0.05; t < 20; t += 0.05) {
    ctx.currentTime = t
    voice.update(0.05, t)
  }
  assert.deepEqual(problems, [])
  const creaks = oscillators(nodes)
  assert.ok(creaks.length >= 2, `${creaks.length} creaks in 20 s`)
  assertStopsInSilence(nodes)
})
