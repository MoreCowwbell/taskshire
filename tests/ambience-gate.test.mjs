/**
 * Silence until the first gesture (`src/audio/ambience.js`), now that the village has sound.
 *
 * The browser's autoplay policy wants a click or a key before any audio, and the ambience waits
 * for one on its own: it hangs a `pointerdown` and a `keydown` listener on the document and
 * builds its `AudioContext` there, never before. So building the ambience, moving it from world
 * to world and asking it to play must make no context at all, and `play` must hand back `null`
 * until the gesture has come; and with `sound` off it stays `null` after the gesture too.
 *
 * Node has no document, no audio and no network, so the three are stood in for here: a document
 * that keeps its listeners so a test can fire them, a `fetch` that finds no sample manifest (the
 * normal case), and an `AudioContext` that counts how many were made, built on the recording
 * stand-in the synth tests use.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeAudio } from './fixtures/fake-audio.mjs'
import { Ambience } from '../src/audio/ambience.js'
import { manifest as village } from '../src/themes/medieval/manifest.js'
import { WORLD_IDS } from '../src/worlds/index.js'
import { resolveSettings } from '../src/worlds/resolve.js'

/** Every world the village can stand on, dressed the village's way. */
const SETTINGS = resolveSettings(WORLD_IDS, village.dressing)

/** Every context the stand-in has made, newest last. */
const made = []

/** An automatable value that accepts everything a real one does and remembers only `value`. */
const param = (value = 0) => ({
  value,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
  setTargetAtTime() {},
  cancelScheduledValues() {},
})

/**
 * A context the way a browser hands one out: suspended until `resume`, which settles a moment
 * later. The nodes are the recording stand-in's, plus the two it does not make (the compressor
 * and the panner) and a listener.
 */
class StandInContext {
  constructor() {
    const { ctx } = createFakeAudio()
    Object.assign(this, ctx)
    this.state = 'suspended'
    this.listener = { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(-1), upX: param(), upY: param(1), upZ: param() }
    made.push(this)
  }

  createDynamicsCompressor() {
    return Object.assign(this.createGain(), { threshold: param(), ratio: param(), knee: param(), attack: param(), release: param() })
  }

  createPanner() {
    return Object.assign(this.createGain(), { positionX: param(), positionY: param(), positionZ: param() })
  }

  resume() {
    return Promise.resolve().then(() => {
      this.state = 'running'
    })
  }

  suspend() {
    this.state = 'suspended'
    return Promise.resolve()
  }

  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
}

/** A document that keeps its listeners, so a test can be the user. */
function standInDocument() {
  const listeners = new Map()
  return {
    hidden: false,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    /** Fire `type` at every listener on it, as a click or a key would. */
    fire(type) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ type })
    },
    count: (type) => listeners.get(type)?.size ?? 0,
  }
}

/** The settings the ambience reads: `get` and `onChange`, and `set` for the test. */
function standInSettings(values) {
  const subs = new Set()
  return {
    get: (key) => values[key],
    set(key, value) {
      values[key] = value
      for (const fn of subs) fn(new Set([key]))
    },
    onChange(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
  }
}

const saved = {}
let doc

test.beforeEach(() => {
  for (const k of ['document', 'fetch', 'AudioContext', 'webkitAudioContext']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k)
  doc = standInDocument()
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'fetch', { value: async () => ({ ok: false, json: async () => null }), configurable: true, writable: true })
  Object.defineProperty(globalThis, 'AudioContext', { value: StandInContext, configurable: true, writable: true })
  delete globalThis.webkitAudioContext
  made.length = 0
})

test.afterEach(() => {
  for (const [k, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(globalThis, k, d)
    else delete globalThis[k]
  }
})

/** Let the stand-in's `resume` settle. */
const settle = () => new Promise((r) => setImmediate(r))

test('the village has fifteen worlds to stand on, each with sound', () => {
  assert.equal(SETTINGS.length, 15)
  for (const s of SETTINGS) assert.ok(s.audio?.beds?.length > 0, `${s.id}: no beds`)
})

test('building the ambience, every village world and a play make no context, and play is null', async () => {
  const amb = new Ambience(standInSettings({ sound: true }))
  try {
    assert.equal(doc.count('pointerdown'), 1, 'the ambience listens for the first click')
    for (const s of SETTINGS) {
      amb.setPlanet(s)
      amb.update(0.05, null, null)
      assert.equal(amb.play('hand-bell'), null, `${s.id}: play before the gesture`)
      assert.equal(amb.play('keep-bell', { x: 0, y: 0, z: 0 }), null, `${s.id}: a placed play before the gesture`)
    }
    await settle()
    assert.equal(made.length, 0, 'no AudioContext before the gesture')
    assert.equal(amb.ctx, null)
    assert.equal(amb.ready, false)
  } finally {
    amb.dispose()
  }
})

test('the first pointerdown makes exactly one context, and then the bell rings', async () => {
  const amb = new Ambience(standInSettings({ sound: true }))
  try {
    amb.setPlanet(SETTINGS.find((s) => s.id === 'forest'))
    doc.fire('pointerdown')
    await settle()
    assert.equal(made.length, 1, 'one AudioContext after the gesture')
    assert.equal(amb.ctx, made[0])
    assert.equal(amb.ctx.state, 'running')
    assert.equal(doc.count('pointerdown'), 0, 'the listener lets go once the context runs')
    assert.notEqual(amb.play('hand-bell'), null, 'play with sound on after the gesture')
    doc.fire('pointerdown')
    doc.fire('keydown')
    amb.setPlanet(SETTINGS.find((s) => s.id === 'valley'))
    await settle()
    assert.equal(made.length, 1, 'still one AudioContext after more clicks, a key and a world switch')
  } finally {
    amb.dispose()
  }
})

test('with sound off, play stays null after the gesture too', async () => {
  const amb = new Ambience(standInSettings({ sound: false }))
  try {
    amb.setPlanet(SETTINGS.find((s) => s.id === 'forest'))
    doc.fire('pointerdown')
    await settle()
    assert.ok(made.length <= 1)
    assert.equal(amb.play('hand-bell'), null, 'sound off from the start')
  } finally {
    amb.dispose()
  }
})

test('turning sound off after the gesture silences play', async () => {
  const settings = standInSettings({ sound: true })
  const amb = new Ambience(settings)
  try {
    amb.setPlanet(SETTINGS.find((s) => s.id === 'forest'))
    doc.fire('pointerdown')
    await settle()
    assert.notEqual(amb.play('hand-bell'), null)
    settings.set('sound', false)
    assert.equal(amb.play('hand-bell'), null, 'sound off (M) after the gesture')
  } finally {
    amb.dispose()
  }
})
