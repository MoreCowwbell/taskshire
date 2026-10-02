import { CLEARING } from './clearing.js'

/** Canopy (upstream, 2026-09-24): wet, green and loud, with lakes in the crater hollows. */
export const jungle = {
  id: 'jungle',
  name: 'Canopy',
  blurb: 'Humid, loud, and green all the way down. Lakes in the hollows.',
  ground: { low: 0x1f4f2b, high: 0x4f8f3c, tint: 0x83b64c },
  rock: 0x5c6552,
  horizon: 0xa8d8c8,
  sky: { top: 0x2a70b4, bottom: 0xc4e6da },
  fog: { color: 0x8fbfa8, near: 62, far: 195 },
  sun: { color: 0xfff6dc, intensity: 2.3, night: 0.12 },
  ambient: { sky: 0x7fbfa0, ground: 0x2a4a22, intensity: 1.0 },
  atmosphere: 1,
  craters: 9,
  roughness: 1.0,
  lakes: true,
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  grass: { root: 0x1f5a2e, tip: 0x6fbf4c, height: [0.45, 0.95], sway: 0.45 },
  water: { level: -1.0, shallow: 0x46c8b0, deep: 0x175a62, foam: 0xe8fff4, waveHeight: 0.05, sparkle: 0.5 },
  shore: { color: 0x7a6a44, band: 0.5 },
  companion: { name: 'Moon', color: 0xdcd8cc, size: 3.2, glow: 0xfff6e0 },
  dust: 0.35,
  weather: [
    { kind: 'pollen', rate: 0.5 },
    { kind: 'fireflies', rate: 1 },
  ],
  clouds: { amount: 0.55, color: 0xffffff, speed: 0.8 },
  fauna: {
    birds: { kind: 'parrot', count: 9, altitude: [6, 13], colors: [0xe83a3a, 0x3ac0e8, 0xf5c542, 0x3ae86a], size: 1.0 },
    butterflies: { count: 26, colors: [0x4ad0ff, 0xffd84a, 0xff6ab0, 0xffffff] },
    fish: { count: 5 },
  },
  audio: {
    beds: [
      { sound: 'jungle-insects', gain: 0.55, night: 0.75 },
      { sound: 'jungle-birds', gain: 0.5, night: 0.05 },
      { sound: 'rainforest-rain', gain: 0.2 },
    ],
    events: [
      { sound: 'parrot', every: [6, 18], gain: 0.55, when: 'day', where: 'ring' },
      { sound: 'thunder-distant', every: [50, 160], gain: 0.5, where: 'ring' },
      { sound: 'fish-splash', every: [20, 50], gain: 0.3, where: 'water' },
    ],
    shore: true,
  },
  grade: { saturation: 1.15, warmth: 0.0 },
  biome: 'jungle',
}
