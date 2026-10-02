import { CLEARING } from './clearing.js'

/**
 * Shoreline (upstream, 2026-09-24): green ground running down to a sandy coast, with the sea
 * along one side — `shape: 'coast'` and upstream's level-and-colours `water`.
 */
export const beach = {
  id: 'beach',
  name: 'Shoreline',
  blurb: 'Green ground, white sand, and the sea along one side.',
  ground: { low: 0x4d9a48, high: 0x8fcc5c, tint: 0xb9e072 },
  rock: 0xb4ac9c,
  horizon: 0xc4e9f2,
  sky: { top: 0x2f88dc, bottom: 0xd2ecf6 },
  fog: { color: 0xb4dcec, near: 150, far: 330 },
  sun: { color: 0xfff4e0, intensity: 2.5, night: 0.13 },
  ambient: { sky: 0x9fd4f0, ground: 0x6a8a48, intensity: 1.0 },
  atmosphere: 1,
  craters: 0,
  roughness: 0.6,
  shape: 'coast',
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  grass: { sway: 0.7 },
  water: { level: -1.6, shallow: 0x52dcd4, deep: 0x1c6fba, foam: 0xffffff, waveHeight: 0.14, sparkle: 1 },
  shore: { color: 0xf3e4b4, band: 1.0 },
  companion: { name: 'Moon', color: 0xdcd8cc, size: 3.2, glow: 0xfff6e0 },
  dust: 0,
  weather: [{ kind: 'spray', rate: 0.25 }],
  clouds: { amount: 0.55, color: 0xffffff, speed: 1 },
  fauna: {
    birds: { kind: 'gull', count: 10, altitude: [5, 14], colors: [0xffffff, 0xf2f2f2], size: 1.1 },
    butterflies: { count: 8, colors: [0xffd45a, 0xffffff] },
    fish: { count: 6 },
  },
  audio: {
    beds: [
      { sound: 'surf', gain: 0.6, shore: true },
      { sound: 'wind-soft', gain: 0.35 },
      { sound: 'crickets', gain: 0, night: 0.3 },
    ],
    events: [
      { sound: 'gull', every: [6, 18], gain: 0.55, when: 'day', where: 'ring' },
      { sound: 'wave-crash', every: [9, 22], gain: 0.5, where: 'water' },
      { sound: 'fish-splash', every: [15, 40], gain: 0.3, where: 'water' },
    ],
    shore: true,
  },
  grade: { saturation: 1.15, warmth: 0.04 },
  biome: 'water',
}
