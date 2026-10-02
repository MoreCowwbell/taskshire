import { CLEARING } from './clearing.js'

/**
 * Mars: rust, dust storms and a thin pink sky. No wildlife; its fauna is empty for the
 * same reason as the moon's.
 */
export const mars = {
  id: 'mars',
  name: 'Mars',
  blurb: 'Rust, dust, and a pink sky at noon.',
  ground: { low: 0x6b3320, high: 0xb56b40, tint: 0xd89464 },
  rock: 0x8a4a2c,
  horizon: 0x3a2118,
  sky: { top: 0x2b1a1e, bottom: 0xc4703c },
  fog: { color: 0x50301f, near: 82, far: 205 },
  sun: { color: 0xffd9b0, intensity: 2.2, night: 0.09 },
  ambient: { sky: 0xc07a52, ground: 0x4a2418, intensity: 0.75 },
  atmosphere: 0.55,
  craters: 12,
  roughness: 1.15,
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  companion: { name: 'Phobos', color: 0x9a8878, size: 1.5, glow: 0xb8a494 },
  dust: 1,
  weather: [{ kind: 'dust', rate: 1 }],
  clouds: { amount: 0.12, color: 0xd8a888, speed: 0.6 },
  fauna: {},
  audio: {
    beds: [{ sound: 'mars-wind', gain: 0.7 }],
    events: [{ sound: 'wind-gust', every: [14, 40], gain: 0.5, where: 'ring' }],
  },
  grade: { saturation: 1.05, warmth: 0.04 },
  biome: 'arid',
}
