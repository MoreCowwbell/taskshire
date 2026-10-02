import { CLEARING } from './clearing.js'

/**
 * Cinder (upstream, 2026-09-24): ash and embers, and lava for water in every hollow. Its
 * fauna is empty: nothing lives here, and a theme that flies drones fills it.
 */
export const volcanic = {
  id: 'volcanic',
  name: 'Cinder',
  blurb: 'Ash, embers, and lava pooling in every hollow.',
  ground: { low: 0x2a2422, high: 0x5c4c46, tint: 0x7e5e4c },
  rock: 0x3c3432,
  horizon: 0x5a2c20,
  sky: { top: 0x2c1c22, bottom: 0x9a4e30 },
  fog: { color: 0x4c3028, near: 58, far: 175 },
  sun: { color: 0xffc890, intensity: 1.9, night: 0.22 },
  ambient: { sky: 0x8a5a48, ground: 0x3c2218, intensity: 0.95 },
  atmosphere: 0.7,
  craters: 14,
  roughness: 1.4,
  lakes: true,
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  water: {
    level: -1.4,
    shallow: 0xff8a20,
    deep: 0x8c1c06,
    foam: 0xffd878,
    waveHeight: 0.05,
    waveScale: 0.5,
    speed: 0.3,
    sparkle: 0,
    opacity: 1,
    glow: 1.8,
  },
  shore: { color: 0x1c1614, band: 0.6 },
  companion: { name: 'Ember', color: 0xc85a3a, size: 2.4, glow: 0xff7a50 },
  dust: 0.5,
  weather: [
    { kind: 'embers', rate: 1 },
    { kind: 'ash', rate: 0.7 },
  ],
  clouds: { amount: 0.35, color: 0x5a3c34, speed: 0.9 },
  fauna: {},
  audio: {
    beds: [
      { sound: 'lava-rumble', gain: 0.6 },
      { sound: 'volcanic-hiss', gain: 0.35 },
      { sound: 'wind-high', gain: 0.25 },
    ],
    events: [
      { sound: 'ember-pop', every: [3, 10], gain: 0.4, where: 'water' },
      { sound: 'geyser', every: [25, 70], gain: 0.55, where: 'ring' },
      { sound: 'thunder-distant', every: [40, 120], gain: 0.45, where: 'ring' },
    ],
    shore: false,
  },
  grade: { saturation: 1.05, warmth: 0.1 },
  biome: 'volcanic',
}
