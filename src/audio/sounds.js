import { GENERATORS } from './synth.js'

/**
 * Every sound the colony can make, by name.
 *
 * A name is the whole contract between the world and the audio: planets ask for beds by
 * name, the integrator tags sources by name, `play` takes a name. Behind each one sits a
 * synth from `synth.js`, and optionally a real file from the manifest that overrides it. So
 * a sample can be dropped in or pulled out without touching any code that asks for sounds,
 * and the registry refuses to load at all if a name has no synth — there is no such thing
 * here as a sound that might be silent.
 *
 * `kind` decides how the engine treats it:
 *   bed    — loops forever as a planet's ambience layer
 *   event  — plays once and cleans itself up
 *   loop   — loops while a positional source exists (a site, the ship, a drone, a shore)
 * `gain` is a final trim on top of the synth's own level, so the mix can be balanced in
 * one place without touching the recipes.
 */

const TABLE = {
  // Beds — a planet stacks two or three of these.
  'wind-soft': { kind: 'bed', gain: 1 },
  'wind-desert': { kind: 'bed', gain: 1 },
  'wind-arctic': { kind: 'bed', gain: 1 },
  'wind-high': { kind: 'bed', gain: 1 },
  'surf': { kind: 'bed', gain: 1 },
  'surf-gentle': { kind: 'bed', gain: 1 },
  'ocean-swell': { kind: 'bed', gain: 1 },
  'jungle-insects': { kind: 'bed', gain: 1 },
  'jungle-birds': { kind: 'bed', gain: 1 },
  'rainforest-rain': { kind: 'bed', gain: 1 },
  'crickets': { kind: 'bed', gain: 1 },
  'meadow-birds': { kind: 'bed', gain: 1 },
  'lava-rumble': { kind: 'bed', gain: 1 },
  'volcanic-hiss': { kind: 'bed', gain: 1 },
  'snow-wind': { kind: 'bed', gain: 1 },
  'autumn-rustle': { kind: 'bed', gain: 1 },
  'cherry-breeze': { kind: 'bed', gain: 1 },
  /** Airless worlds: the inside of a helmet rather than wind. Nearly inaudible on purpose. */
  'lunar-silence': { kind: 'bed', gain: 1 },
  /** Thin, high and dusty — a tenth of an atmosphere does not carry a low rumble. */
  'mars-wind': { kind: 'bed', gain: 1 },
  'stream': { kind: 'bed', gain: 1 },

  // One-shots — environment events, and the handful of sounds the colony itself makes.
  'gull': { kind: 'event', gain: 0.8 },
  'parrot': { kind: 'event', gain: 0.8 },
  'crow': { kind: 'event', gain: 0.8 },
  'songbird': { kind: 'event', gain: 0.8 },
  'owl': { kind: 'event', gain: 0.8 },
  'thunder-distant': { kind: 'event', gain: 0.9 },
  'wind-gust': { kind: 'event', gain: 0.7 },
  'wave-crash': { kind: 'event', gain: 0.8 },
  'fish-splash': { kind: 'event', gain: 0.6 },
  'geyser': { kind: 'event', gain: 0.8 },
  'ember-pop': { kind: 'event', gain: 0.6 },
  'ice-crack': { kind: 'event', gain: 0.7 },
  /** A distant howl. */
  'coyote': { kind: 'event', gain: 0.6 },
  /** Whatever bird the planet has: pass `kind` (gull | parrot | crow | songbird | owl). */
  'bird-call': { kind: 'event', gain: 0.8 },
  /** A soft servo click and a thud — something small just landed. */
  'drone-drop': { kind: 'event', gain: 0.7 },
  /**
   * "Yes?" — what an astronaut says when you click it. Six of them, picked at random, so a
   * crowd does not answer in one voice. Little robot phrases: two or three chirps.
   */
  'select-1': { kind: 'event', gain: 0.55 },
  'select-2': { kind: 'event', gain: 0.55 },
  'select-3': { kind: 'event', gain: 0.55 },
  'select-4': { kind: 'event', gain: 0.55 },
  'select-5': { kind: 'event', gain: 0.55 },
  'select-6': { kind: 'event', gain: 0.55 },
  /**
   * "Somebody needs you." The only sound that is allowed to interrupt, so it is the one
   * that must never grate: two soft marimba notes a fifth apart, and nothing else.
   */
  'chime-attention': { kind: 'event', gain: 0.6 },
  /**
   * A villager's "yes?": two notes plucked on a lute, a fifth or a fourth apart. Four figures,
   * for the same reason as the robots' six. A lute is softer than a synth blip, so they sit a
   * little higher than the robots' 0.55: about 2 dB under them, heard side by side.
   */
  'pluck-1': { kind: 'event', gain: 0.66 },
  'pluck-2': { kind: 'event', gain: 0.66 },
  'pluck-3': { kind: 'event', gain: 0.66 },
  'pluck-4': { kind: 'event', gain: 0.66 },
  /**
   * "Somebody needs you", in the village: a small bronze hand bell rung twice. It interrupts
   * as the chime does, so it keeps the chime's level and its rule — soft, and nothing bright.
   */
  'hand-bell': { kind: 'event', gain: 0.6 },
  /**
   * Someone new at the keep: the same bell an octave down, rung once and left to ring. Half a
   * decibel under the hand bell's trim, so the bell that needs you is always the louder one.
   */
  'keep-bell': { kind: 'event', gain: 0.566 },

  // Positional loops — attached to things in the world, heard from where they are.
  'work-hammer': { kind: 'loop', gain: 1 },
  'ship-hum': { kind: 'loop', gain: 1 },
  'drone-whine': { kind: 'loop', gain: 1 },
  'shore-lap': { kind: 'loop', gain: 1 },
  /** A moored boat: water at the hull and the odd slow groan of timber. Its level is in the synth. */
  'hull-creak': { kind: 'loop', gain: 1 },
}

/** name → { kind, gain, synth(ctx, dest, opts, noise) → Voice } */
export const SOUNDS = {}
for (const name of Object.keys(TABLE)) {
  const synth = GENERATORS[name]
  if (typeof synth !== 'function') throw new Error(`[audio] "${name}" is registered without a synth`)
  SOUNDS[name] = { kind: TABLE[name].kind, gain: TABLE[name].gain, synth }
}

export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS))

/** The bird kinds `bird-call` understands, for a planet preset to pick from. */
export const BIRD_KINDS = Object.freeze(['gull', 'parrot', 'crow', 'songbird', 'owl'])

export function isSound(name) {
  return Object.prototype.hasOwnProperty.call(SOUNDS, name)
}

/**
 * Which of `n` phrases answers a click, from one draw `r` in [0, 1): the one the draw lands
 * on, or the next one round when that is the phrase that answered last time, so nobody says
 * the same thing twice in a row. `last` is an index, or any value no index equals (−1) before
 * the first answer. For six phrases this is the colony's old pick less one — `1 + floor(r·6)`,
 * bumped to the next on a repeat — so the space theme says the same phrase for the same draw
 * it always did. Pure: the caller owns the draw.
 */
export function pickPhrase(r, last, n) {
  let i = Math.floor(r * n)
  if (i === last) i = (i + 1) % n
  return i
}
