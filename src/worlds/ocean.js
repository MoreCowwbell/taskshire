import { CLEARING } from './clearing.js'

/**
 * Archipelago (upstream, 2026-09-24): one island in open water, with more on the horizon.
 * `shape: 'island'` is built around the colony's own cells (`setIslandFootprint`).
 */
export const ocean = {
  id: 'ocean',
  name: 'Archipelago',
  blurb: 'One island, a few more on the horizon, and water everywhere else.',
  ground: { low: 0x3f8a44, high: 0x7fbf55, tint: 0xa8d868 },
  rock: 0xb0a898,
  horizon: 0xc0e4f4,
  sky: { top: 0x2470c8, bottom: 0xd4ecfa },
  fog: { color: 0xaed4ea, near: 150, far: 330 },
  sun: { color: 0xfff6e4, intensity: 2.5, night: 0.13 },
  ambient: { sky: 0x98cff0, ground: 0x4c7a4a, intensity: 1.0 },
  atmosphere: 1,
  craters: 0,
  roughness: 0.7,
  shape: 'island',
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  grass: { sway: 0.8 },
  water: { level: -1.7, shallow: 0x3fd4cc, deep: 0x0e4c98, foam: 0xffffff, waveHeight: 0.18, sparkle: 1 },
  shore: { color: 0xf3e6ba, band: 1.0 },
  companion: { name: 'Moon', color: 0xdcd8cc, size: 3.2, glow: 0xfff6e0 },
  dust: 0,
  weather: [{ kind: 'spray', rate: 0.35 }],
  clouds: { amount: 0.6, color: 0xffffff, speed: 1.1 },
  fauna: {
    birds: { kind: 'gull', count: 12, altitude: [5, 16], colors: [0xffffff, 0xf0f0f0], size: 1.1 },
    fish: { count: 9 },
  },
  audio: {
    beds: [
      { sound: 'ocean-swell', gain: 0.55, shore: true },
      { sound: 'surf-gentle', gain: 0.4, shore: true },
      { sound: 'wind-soft', gain: 0.4 },
    ],
    events: [
      { sound: 'gull', every: [5, 15], gain: 0.55, when: 'day', where: 'ring' },
      { sound: 'wave-crash', every: [7, 18], gain: 0.5, where: 'water' },
      { sound: 'fish-splash', every: [10, 30], gain: 0.35, where: 'water' },
    ],
    shore: true,
  },
  grade: { saturation: 1.15, warmth: 0.02 },
  biome: 'water',
}
