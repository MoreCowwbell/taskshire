import { CLEARING } from './clearing.js'

/** Mountain: high, cold and white, in a bowl of peaks with a range behind it. */
export const mountain = {
  id: 'mountain',
  name: 'Mountain',
  blurb: 'High, cold and white. Snow after dark.',
  ground: { low: 0x8a8f96, high: 0xe4e8ec, tint: 0xf4f6f8 },
  rock: 0x6f7378,
  horizon: 0xb8c8d8,
  sky: { top: 0x1e3f6e, bottom: 0xa8bfd6 },
  fog: { color: 0xb4c2cf, near: 80, far: 210 },
  sun: { color: 0xfff6ea, intensity: 2.6, night: 0.1 },
  ambient: { sky: 0xa8c4e8, ground: 0x6a6f78, intensity: 0.9 },
  atmosphere: 0.9,
  craters: 0,
  roughness: 1.1,
  /**
   * The range. Two half-planes, each climbing `height` over the `width` past `from`, and
   * where they overlap the ground is the sum of both climbs.
   *
   * **Where they are.** Measured at the rest camera (azimuth π/4, polar 56°, distance 62,
   * fov 38): the far bearing — the ground at the top-centre of the picture — is 225° and
   * 74 units out, and the top row of the frame reaches 100. So the first wall is *on* the
   * far bearing and enters straight across the top of the frame, and the second is on the
   * bearing the valley's wall used to hold, 280°, which is the top right. Anything past
   * 320° is out of the picture altogether, which is why there is no third.
   *
   * **`from` 58 and 62, past everything.** The colony ends at 46 and the navigation grid
   * at 56, so neither wall lifts a metre of ground anything is built or walked on. The
   * second is four units further out so the two feet do not arrive together in the corner
   * they share; the corner is high enough as it is, both climbs adding there.
   *
   * **26 and 18 of height, and why the numbers barely show.** A crest 18 units up at 80
   * units out projects *above* the top edge of the frame. What the picture keeps of a
   * range is its lower slope and the crag models standing on it, never the summit line —
   * which is why `count` matters more than `height` here, and why the first wall is the
   * taller of the two: it is the one whose foot is furthest from the camera.
   *
   * The crags themselves, recipe and count, are each theme's own: they are in the dressing's
   * `ridges`, matched to these two by index.
   */
  ridge: [
    { axis: [-0.7071, -0.7071], from: 58, width: 34, height: 26 },
    { axis: [0.1736, -0.9848], from: 62, width: 30, height: 18 },
  ],
  /**
   * The ground between the plots and the range rolls rather than lying flat: 1.6 on the
   * far-field term, which the `clearing` holds off until fifty-five units out and brings fully
   * in at ninety-five, so the colony floor is untouched and the approach to the wall is broken
   * ground. It is the highest of the three settings because it is the one standing in a
   * mountain range; `plots.maxTilt` is what keeps a slab off what it makes.
   */
  hills: 1.6,
  clearing: CLEARING,
  companion: { name: 'Moon', color: 0xdcd8cc, size: 3.2, glow: 0xfff6e0 },
  /**
   * `dust` is the ambient-weather rate, and the particles hook reads it as a gate as well
   * as a multiplier — `0` would switch the snow off entirely, which is not what a snowy
   * mountain wants. Held low so the fall reads as weather rather than as a blizzard.
   */
  dust: 0.5,
  /** High, cold and open: wind and not much else, a crow now and then by day. */
  audio: {
    beds: [
      { sound: 'wind-high', gain: 0.5 },
      { sound: 'wind-arctic', gain: 0.25, night: 0.45 },
    ],
    events: [
      { sound: 'wind-gust', every: [10, 28], gain: 0.55, where: 'ring' },
      { sound: 'crow', every: [25, 70], gain: 0.3, when: 'day', where: 'ring' },
    ],
  },
  /**
   * The atmosphere, from the same side-by-side round as the forest's (rest view, by day, under
   * the curve, 2026-09-29). No grass: this is a snowfield.
   *
   * The grade is the middle of three tried, cool where the other two are warm: with none the
   * snow read neutral grey; 0.95 / −0.05 pushed it blue and read as a filter.
   */
  grade: { saturation: 0.98, warmth: -0.03 },
  /**
   * The lighter of two covers, grey-white rather than white against the pale sky: none left
   * the sky over the peaks bare, and 0.55 was the heavier sheet for nothing the rest view
   * could show. Colour and speed were held through the round.
   */
  clouds: { amount: 0.35, color: 0xe4ecf2, speed: 0.7 },
  /**
   * Frost's crows, four where Frost flies five: the snowfield's one flock. The heavier set tried
   * on the forest and the valley left them as they are here.
   */
  fauna: {
    birds: { kind: 'crow', count: 4, altitude: [8, 16], colors: [0x1e1e24, 0x2c2a30], size: 1.1 },
  },
  biome: 'cold',
  /**
   * The dressed `ceremony` comes after `hills` here rather than after the rim, which is
   * where the mountain's setting has always carried it (see `DRESSED_AFTER` in `resolve.js`).
   */
  dressedAfter: { ceremony: 'hills' },
}
