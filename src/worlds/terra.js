import { CLEARING } from './clearing.js'

/** Terra, the earthlike one: grass, birds and butterflies, and fireflies after dark. */
export const terra = {
  id: 'terra',
  name: 'Terra',
  blurb: 'An earthlike one. Grass, blue hour, fireflies.',
  ground: { low: 0x2f5a34, high: 0x6d9a4a, tint: 0x86ae5c },
  rock: 0x6b6f63,
  horizon: 0x6fa8d8,
  sky: { top: 0x1d4d8f, bottom: 0x9ec8e8 },
  fog: { color: 0x6b8fa8, near: 92, far: 230 },
  sun: { color: 0xfff0d4, intensity: 2.4, night: 0.13 },
  ambient: { sky: 0x88bfe8, ground: 0x3f5a30, intensity: 0.95 },
  atmosphere: 1,
  craters: 0,
  roughness: 0.75,
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  grass: { sway: 0.6 },
  companion: { name: 'Moon', color: 0xdcd8cc, size: 3.2, glow: 0xfff6e0 },
  dust: 0.25,
  weather: [
    { kind: 'pollen', rate: 0.25 },
    { kind: 'fireflies', rate: 0.6 },
  ],
  clouds: { amount: 0.45, color: 0xffffff, speed: 1 },
  fauna: {
    birds: { kind: 'swallow', count: 8, altitude: [7, 14], colors: [0x3a3a4a, 0x2a2a3a], size: 0.9 },
    butterflies: { count: 12, colors: [0xffd45a, 0xffffff, 0xff9a5a] },
  },
  audio: {
    beds: [
      { sound: 'wind-soft', gain: 0.45 },
      { sound: 'meadow-birds', gain: 0.5, night: 0 },
      { sound: 'crickets', gain: 0, night: 0.6 },
    ],
    events: [
      { sound: 'songbird', every: [7, 20], gain: 0.6, when: 'day', where: 'ring' },
      { sound: 'owl', every: [25, 70], gain: 0.5, when: 'night', where: 'ring' },
      { sound: 'wind-gust', every: [20, 60], gain: 0.35, where: 'ring' },
    ],
  },
  grade: { saturation: 1.12, warmth: 0.03 },
  biome: 'green',
}
