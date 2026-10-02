import { CLEARING } from './clearing.js'

/** Frost (upstream, 2026-09-24): snow over the ground and ice on the crater lakes. */
export const tundra = {
  id: 'tundra',
  name: 'Frost',
  blurb: 'Snow, frozen lakes, and pines holding their breath.',
  ground: { low: 0xc4d4e0, high: 0xf4f8fc, tint: 0xe4eef6 },
  rock: 0x6c7684,
  horizon: 0xdbe8f2,
  sky: { top: 0x3f70ac, bottom: 0xdceaf4 },
  fog: { color: 0xd4e2ec, near: 95, far: 245 },
  sun: { color: 0xfff8f0, intensity: 2.2, night: 0.14 },
  ambient: { sky: 0xa8c4e0, ground: 0x8fa0b0, intensity: 0.95 },
  atmosphere: 0.85,
  craters: 6,
  roughness: 0.9,
  lakes: true,
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  water: { level: -1.1, shallow: 0xc4ecf6, deep: 0x5aa6d2, foam: 0xffffff, waveHeight: 0.015, speed: 0.25, sparkle: 0.8, opacity: 0.96 },
  shore: { color: 0xe8f0f4, band: 0.4 },
  companion: { name: 'Moon', color: 0xdcd8cc, size: 3.2, glow: 0xfff6e0 },
  dust: 0,
  weather: [{ kind: 'snow', rate: 1 }],
  clouds: { amount: 0.5, color: 0xe4ecf2, speed: 0.7 },
  fauna: {
    birds: { kind: 'crow', count: 5, altitude: [8, 16], colors: [0x1e1e24, 0x2c2a30], size: 1.1 },
  },
  audio: {
    beds: [
      { sound: 'snow-wind', gain: 0.55 },
      { sound: 'wind-arctic', gain: 0.35, night: 0.5 },
    ],
    events: [
      // A frozen lake groans now and then, from far off; it does not crunch underfoot.
      { sound: 'ice-crack', every: [50, 140], gain: 0.35, where: 'water' },
      { sound: 'crow', every: [15, 45], gain: 0.35, when: 'day', where: 'ring' },
      { sound: 'owl', every: [30, 90], gain: 0.4, when: 'night', where: 'ring' },
      { sound: 'wind-gust', every: [12, 35], gain: 0.5, where: 'ring' },
    ],
  },
  grade: { saturation: 0.95, warmth: -0.05 },
  biome: 'cold',
}
