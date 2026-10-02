import { CLEARING } from './clearing.js'

/** Blossom (upstream, 2026-09-24): cherry trees in bloom, petals in the air, ponds in the hollows. */
export const sakura = {
  id: 'sakura',
  name: 'Blossom',
  blurb: 'Cherry trees in full bloom, and petals on everything.',
  ground: { low: 0x5e9a56, high: 0xa2d26c, tint: 0xc8e48e },
  rock: 0xb4b4bc,
  horizon: 0xfad8e4,
  sky: { top: 0x5f8fda, bottom: 0xfce6ee },
  fog: { color: 0xeaccd8, near: 96, far: 238 },
  sun: { color: 0xfff2ea, intensity: 2.4, night: 0.14 },
  ambient: { sky: 0xd4c4ec, ground: 0x5c7c42, intensity: 1.0 },
  atmosphere: 1,
  craters: 2,
  roughness: 0.7,
  lakes: true,
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  grass: { root: 0x4a8a3c, tip: 0xb8e07a, sway: 0.55 },
  water: { level: -0.95, shallow: 0x92dcdc, deep: 0x3a7cb4, foam: 0xffffff, waveHeight: 0.04, sparkle: 0.8 },
  shore: { color: 0xbcae86, band: 0.5 },
  companion: { name: 'Moon', color: 0xf0e4e0, size: 3.4, glow: 0xffe4ec },
  dust: 0.1,
  weather: [{ kind: 'petals', rate: 1 }],
  clouds: { amount: 0.35, color: 0xffffff, speed: 0.8 },
  fauna: {
    birds: { kind: 'swallow', count: 8, altitude: [6, 13], colors: [0x3a3a4a, 0x2a2a3a], size: 0.9 },
    butterflies: { count: 22, colors: [0xffffff, 0xffc6dc, 0xfff0a0] },
    fish: { count: 2 },
  },
  audio: {
    beds: [
      { sound: 'cherry-breeze', gain: 0.5 },
      { sound: 'meadow-birds', gain: 0.45, night: 0 },
      { sound: 'crickets', gain: 0, night: 0.5 },
      { sound: 'stream', gain: 0.2 },
    ],
    events: [
      { sound: 'songbird', every: [6, 18], gain: 0.55, when: 'day', where: 'ring' },
      { sound: 'wind-gust', every: [18, 50], gain: 0.3, where: 'ring' },
    ],
    shore: true,
  },
  grade: { saturation: 1.15, warmth: 0.04 },
  biome: 'green',
}
