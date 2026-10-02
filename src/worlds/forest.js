/** Forest: deep woods and close fog, in summer. The village's first world. */
export const forest = {
  id: 'forest',
  name: 'Forest',
  blurb: 'Deep woods, close fog, summer.',
  ground: { low: 0x2f5a2a, high: 0x5f8f3a, tint: 0x7fae52 },
  rock: 0x6b6f63,
  horizon: 0x7fb0c8,
  sky: { top: 0x2a5b96, bottom: 0xa9d2ea },
  /**
   * Far enough back that the wall and the plot kerbs keep their colour. The first cut of
   * this setting sat at 60/170, which put the fog's own green over everything past the
   * middle plot and washed the village out.
   *
   * Kept through the atmosphere round of 2026-09-29: under the curve this green was rendered
   * beside the horizon's own blue and a mix of the two, and at the rest view the three could
   * not be told apart, so the fog stayed as it was.
   */
  fog: { color: 0x78a08a, near: 90, far: 220 },
  sun: { color: 0xfff0d4, intensity: 2.3, night: 0.12 },
  ambient: { sky: 0x88bfe8, ground: 0x3f5a30, intensity: 0.95 },
  atmosphere: 1,
  craters: 0,
  roughness: 0.7,
  /**
   * The ground under the wood, kept low enough to build on.
   *
   * **A quarter, because a village with every repo on show needs the room.** The far-field
   * term reaches the plots from ring four out, and at the default of 1 it stands whole cells
   * of ring five and six above `plots.deckTop` — evenly, so the slope rule passed them and
   * the deck was laid under the hill (2026-09-27). `Colony._blockedCells` now refuses that
   * ground, and at 1 that leaves 49 dealable cells over rings 0–11, against the 61 a
   * 31-repo colony at seven threads a tile asked for. Measured with the new rule:
   *
   *   hills 1       49 cells   (rings 0–5: 1 6 12 18  9  2)
   *   hills 0.4    119         (1 6 12 18 23 11)
   *   hills 0.25   206         (1 6 12 18 24 24)
   *
   * 0.25 is the first that keeps ring five whole. Nothing is lost in the picture: the relief
   * it flattens sits under the rim's tree line and the fog, and the wood is what closes the
   * clearing, not the hill under it.
   */
  hills: 0.25,
  companion: { name: 'Moon', color: 0xdcd8cc, size: 3.2, glow: 0xfff6e0 },
  dust: 0.2,
  /** Deep woods, summer: wind under the canopy, leaves overhead, birds by day, owls by night. */
  audio: {
    beds: [
      { sound: 'wind-soft', gain: 0.3 },
      { sound: 'autumn-rustle', gain: 0.25 },
      { sound: 'meadow-birds', gain: 0.5, night: 0 },
      { sound: 'crickets', gain: 0, night: 0.55 },
    ],
    events: [
      { sound: 'songbird', every: [7, 20], gain: 0.55, when: 'day', where: 'ring' },
      { sound: 'crow', every: [20, 60], gain: 0.35, when: 'day', where: 'ring' },
      { sound: 'owl', every: [25, 70], gain: 0.5, when: 'night', where: 'ring' },
    ],
  },
  /**
   * The atmosphere. Each value below won a side-by-side round at the rest view, by day, under
   * the curve (2026-09-29), against candidates rendered with everything else held; the valley
   * and the mountain were judged in the same round.
   *
   * The grade is the middle of three tried. With none the wood read flat and grey beside its
   * space twin; 1.12 / +0.04 pushed the greens past the village's own palette and read as a
   * filter. It sits under the `vignette` setting's 0.3; a lighter 0.15 was tried with it and
   * gained the frame nothing.
   */
  grade: { saturation: 1.05, warmth: 0.02 },
  /**
   * Upstream's blade as it comes, rooted and tipped from `ground`, at the default sway. Bare
   * ground read as a painted board once it bent away; the taller blade (0.45–0.95) darkened
   * into a coarse pile around the plots.
   */
  grass: { sway: 0.6 },
  /**
   * The lighter of two covers. None left the sky over the tree line bare; 0.55 was the heavier
   * sheet for nothing the rest view's band of sky could show. Colour and speed were held
   * through the round; only the amount was compared.
   */
  clouds: { amount: 0.35, color: 0xffffff, speed: 0.9 },
  /**
   * Terra's swallows and butterflies in a smaller number: the lighter of two sets. Ten
   * swallows and twenty butterflies began to be counted rather than noticed.
   */
  fauna: {
    birds: { kind: 'swallow', count: 6, altitude: [7, 14], colors: [0x3a3a4a, 0x2a2a3a], size: 0.9 },
    butterflies: { count: 10, colors: [0xffd45a, 0xffffff, 0xff9a5a] },
  },
  biome: 'green',
}
