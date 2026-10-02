/**
 * Aerie (upstream, 2026-09-24): a floating island over a sea of cloud. `shape: 'sky'` cuts the
 * ground to the island and `skyIsland` paints its underside.
 */
export const sky = {
  id: 'sky',
  name: 'Aerie',
  blurb: 'A floating island. Roots and vines over the edge, clouds all the way down.',
  ground: { low: 0x4f9450, high: 0x93cc64, tint: 0xbfe08a },
  rock: 0x8c8478,
  horizon: 0xd8ecf8,
  sky: { top: 0x3a86dc, bottom: 0xdcecf8 },
  fog: { color: 0xc8e0f2, near: 120, far: 300 },
  sun: { color: 0xfff4e0, intensity: 2.5, night: 0.14 },
  ambient: { sky: 0xa8d4f4, ground: 0x6a8a58, intensity: 1.05 },
  atmosphere: 1,
  craters: 0,
  roughness: 0.7,
  shape: 'sky',
  farShade: { from: 0.8, to: 0.36, amount: 0.55 },
  grass: { sway: 0.85 },
  skyIsland: { rock: 0x6e6256, soil: 0x7a5a3c, vine: 0x4f8f3a, cloud: 0xffffff, cloudLevel: -60, depth: 74 },
  companion: { name: 'Moon', color: 0xe8e4dc, size: 3.0, glow: 0xfff6e0 },
  dust: 0.15,
  weather: [
    { kind: 'pollen', rate: 0.3 },
    { kind: 'fireflies', rate: 0.6 },
  ],
  clouds: { amount: 0.7, color: 0xffffff, speed: 1.3 },
  fauna: {
    birds: { kind: 'swallow', count: 14, altitude: [4, 12], colors: [0x3a3a4a, 0x2a2a3a], size: 0.9 },
    butterflies: { count: 10, colors: [0xffd45a, 0xffffff, 0x9ad0ff] },
  },
  audio: {
    beds: [
      { sound: 'wind-high', gain: 0.45 },
      { sound: 'wind-soft', gain: 0.4 },
      { sound: 'meadow-birds', gain: 0.4, night: 0 },
      { sound: 'crickets', gain: 0, night: 0.4 },
    ],
    events: [
      { sound: 'wind-gust', every: [8, 24], gain: 0.55, where: 'ring' },
      { sound: 'songbird', every: [9, 25], gain: 0.5, when: 'day', where: 'ring' },
    ],
  },
  grade: { saturation: 1.15, warmth: 0.02 },
  biome: 'sky',
}
