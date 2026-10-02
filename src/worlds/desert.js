import { CLEARING } from './clearing.js'

/** Dune (upstream, 2026-09-24): sand seas under a long sky. `shape: 'dunes'` ripples the ground. */
export const desert = {
  id: 'desert',
  name: 'Dune',
  blurb: 'Sand seas, heat haze, and a sky that goes on forever.',
  ground: { low: 0xc2884a, high: 0xefc07a, tint: 0xfbe0a8 },
  rock: 0xb0703f,
  horizon: 0xf6d6a8,
  sky: { top: 0x3a86d8, bottom: 0xf8dfb8 },
  fog: { color: 0xecc99c, near: 95, far: 250 },
  sun: { color: 0xfff2d8, intensity: 2.7, night: 0.1 },
  ambient: { sky: 0xb0d0f2, ground: 0x9a6a38, intensity: 0.95 },
  atmosphere: 0.9,
  craters: 0,
  roughness: 1.25,
  shape: 'dunes',
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  companion: { name: 'Moon', color: 0xe8e0d0, size: 3.0, glow: 0xfff0d8 },
  dust: 0.5,
  weather: [{ kind: 'sand', rate: 0.6 }],
  clouds: { amount: 0.14, color: 0xffffff, speed: 1.2 },
  fauna: {
    birds: { kind: 'crow', count: 5, altitude: [12, 22], colors: [0x2a2420, 0x3a302a], size: 1.2 },
  },
  audio: {
    beds: [
      { sound: 'wind-desert', gain: 0.6 },
      { sound: 'crickets', gain: 0, night: 0.45 },
    ],
    events: [
      { sound: 'wind-gust', every: [10, 30], gain: 0.55, where: 'ring' },
      { sound: 'coyote', every: [40, 120], gain: 0.4, when: 'night', where: 'ring' },
      { sound: 'crow', every: [15, 45], gain: 0.4, when: 'day', where: 'ring' },
    ],
  },
  grade: { saturation: 1.08, warmth: 0.08 },
  biome: 'arid',
}
