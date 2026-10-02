import { CLEARING } from './clearing.js'

/** Harvest (upstream, 2026-09-24): gold light, red leaves and a pond in a crater. */
export const autumn = {
  id: 'autumn',
  name: 'Harvest',
  blurb: 'Gold light, red leaves, and a pond with something in it.',
  ground: { low: 0x55702e, high: 0xa4a640, tint: 0xd0b44c },
  rock: 0xa89a88,
  horizon: 0xf4cc94,
  sky: { top: 0x3f7fc4, bottom: 0xf8dcbc },
  fog: { color: 0xdcbc9c, near: 88, far: 225 },
  sun: { color: 0xffe2b4, intensity: 2.3, night: 0.12 },
  ambient: { sky: 0xa8bcd8, ground: 0x6c4c28, intensity: 0.95 },
  atmosphere: 1,
  craters: 4,
  roughness: 0.85,
  lakes: true,
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  grass: { root: 0x6a5a26, tip: 0xd8b24a, height: [0.3, 0.6], sway: 0.65 },
  water: { level: -1.05, shallow: 0x74b4a4, deep: 0x2c5c6c, foam: 0xf4f8f0, waveHeight: 0.04, sparkle: 0.6 },
  shore: { color: 0x8c7448, band: 0.5 },
  companion: { name: 'Moon', color: 0xe8dcc4, size: 3.4, glow: 0xffe8c0 },
  dust: 0.2,
  weather: [{ kind: 'leaves', rate: 0.8 }],
  clouds: { amount: 0.4, color: 0xfff4e8, speed: 0.9 },
  fauna: {
    birds: { kind: 'crow', count: 6, altitude: [7, 15], colors: [0x1e1a1a, 0x2e2828], size: 1.1 },
    butterflies: { count: 6, colors: [0xffb84a, 0xffffff] },
    fish: { count: 2 },
  },
  audio: {
    beds: [
      { sound: 'autumn-rustle', gain: 0.5 },
      { sound: 'wind-soft', gain: 0.35 },
      { sound: 'crickets', gain: 0, night: 0.5 },
    ],
    events: [
      { sound: 'crow', every: [10, 30], gain: 0.45, when: 'day', where: 'ring' },
      { sound: 'songbird', every: [12, 35], gain: 0.4, when: 'day', where: 'ring' },
      { sound: 'owl', every: [25, 70], gain: 0.5, when: 'night', where: 'ring' },
      { sound: 'fish-splash', every: [30, 80], gain: 0.3, where: 'water' },
    ],
    shore: true,
  },
  grade: { saturation: 1.12, warmth: 0.1 },
  biome: 'green',
}
