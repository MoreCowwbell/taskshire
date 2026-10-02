import { CLEARING } from './clearing.js'

/**
 * Luna, the airless one: no weather, no wildlife and no sea. Its fauna is empty rather than
 * absent so a theme that flies drones has somewhere to put them.
 */
export const moon = {
  id: 'moon',
  name: 'Luna',
  blurb: 'Airless, high contrast, very long shadows.',
  ground: { low: 0x4a4a52, high: 0x8f8d90, tint: 0xb9b4ae },
  rock: 0x6d6a70,
  horizon: 0x14141c,
  sky: { top: 0x05060c, bottom: 0x101018 },
  fog: { color: 0x07080e, near: 100, far: 235 },
  sun: { color: 0xfff4e2, intensity: 2.6, night: 0.05 },
  ambient: { sky: 0x3a4258, ground: 0x4a423a, intensity: 0.7 },
  // No atmosphere: shadows stay black and the stars never wash out.
  atmosphere: 0,
  craters: 26,
  roughness: 0.9,
  clearing: CLEARING,
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  companion: { name: 'Earth', color: 0x4a7fc9, size: 5.4, glow: 0x6ea8ff },
  dust: 0,
  fauna: {},
  audio: {
    beds: [{ sound: 'lunar-silence', gain: 0.5 }],
    events: [],
  },
  grade: { saturation: 0.95, warmth: 0 },
  biome: 'airless',
}
