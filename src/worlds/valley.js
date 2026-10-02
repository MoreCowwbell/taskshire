/** Valley: an open meadow in autumn, a sea down one side and hills up the other. */
export const valley = {
  id: 'valley',
  name: 'Valley',
  blurb: 'Open meadow, long views, fall colours.',
  /**
   * Gold rather than the green a valley starts as: the fall atlas paints every leaf and
   * every hillside orange, and a green field under orange scatter reads as two seasons at
   * once. The low tone stays olive so the ground still has somewhere to go in shadow.
   */
  ground: { low: 0x7a6a30, high: 0xc2a850, tint: 0xd6b45e },
  rock: 0x7a746a,
  horizon: 0xa8c4d8,
  sky: { top: 0x2f6aa8, bottom: 0xc8dcea },
  fog: { color: 0x9db4c0, near: 110, far: 260 },
  sun: { color: 0xffe6c0, intensity: 2.4, night: 0.12 },
  ambient: { sky: 0x9ac4e8, ground: 0x5a5a30, intensity: 0.95 },
  atmosphere: 1,
  craters: 0,
  roughness: 0.55,
  /**
   * The bank the sea lies behind, off to screen-left, and the wall of crags opposite it. Both
   * are half-planes along an `axis`, not rings: `d = x·ax + z·az`, the ground dropping into
   * the sea where `d > from`. The sea itself — its `level` and its look — is `water`, below;
   * `coast` is only the shape of the land that runs down into it.
   *
   * **Where screen-left is.** The rest pose is `ISO_AZIMUTHS[0] = π/4` at distance 62, so
   * the camera stands at `(+36, +35, +36)` looking down the `(−1, 0, −1)` bearing and
   * screen-left is `(−0.71, 0, +0.71)`. On that pure bearing the sea is a corner sliver:
   * the frame's left edge is only 34 units out at the height of the colony. So both
   * features are rotated 35° from the screen axes *towards the far bearing*, into the deep
   * half of the frame where it is wide — the sea to `atan2(z, x)` of 170°, the wall to
   * 280°. The valley opens towards the camera: sea across the top-left, crags across the
   * top-right, meadow in the gap.
   *
   * **`from 40`, not 60.** At 60 the waterline sat at 59, past any cell a zone could be
   * dealt — which is what let `allocateCells` stay water-blind — and the dock was a speck
   * in the corner. The allocator knows about water now (`blockedCells` in `plots.js`,
   * computed per setting by `Colony._blockedCells`), so the coast can come inside the
   * lattice: the waterline lands at 42.60 on the dock's own line, the dip starts at 24, and
   * the cells it takes are two of ring two and five of the eighteen in ring three. Thirty of
   * the thirty-seven cells within ring three remain, which is more ground than the fixture
   * has ever used.
   *
   * The rule that decides which cells go is the deck skirt: a slab whose centre or any of
   * whose six corners stands below −0.4 has daylight under its rim. Measured with the water
   * term taken out, this valley's own ground runs −0.174 to +0.143 over rings 0–3 and
   * bottoms at −0.268 across the whole colony disc, so nothing inland is culled by noise.
   *
   * **`depth 7`, not 10, and a thirty-unit band.** `SHORE_IN`/`SHORE_OUT` in `setting.js`
   * run the drop from `from − 16` to `from + 14` instead of the 18 units it used to take,
   * and seven units of drop over thirty is a bank of about 0.31 per unit along the axis —
   * measured at the dock's own shore coordinate, and 0.22 to 0.33 anywhere across the
   * frame. Half of the 0.72 it was.
   *
   * That is what buys the beach, and the beach is the point. `water.level` and `depth` are set
   * by the shore rather than by the look of the sea: nothing is planted on ground under
   * `level + SHORE_BAND`, and the colony's flat floor runs −0.27 to +0.13, so `level` has
   * to be a clear four units under it. On the old cliff those four units of height were six
   * units of ground. On this bank they are 12.5 — the floor crosses at d 30.07 and the
   * water at 42.60 — which is a beach rather than a kerb.
   *
   * `depth` comes down with the band because the two are one shape: 10 over thirty units
   * would be the same cliff pushed further out. Seven leaves the seabed 2.3 under the
   * surface at the far end of the band and about 6.7 by the berth, which is more water than
   * anything floats in. It does raise the whole bed by three, so a little more of the far
   * corner where the mountain wall runs down into the sea now stands above the surface —
   * 6.6 per cent of the near field against 4.4 at depth 10, all of it out past d 54 where
   * the range already came down to the water.
   *
   * **`sand`.** The bare strip the scatter guard leaves is painted rather than modelled:
   * `createTerrain` mixes this colour into the vertex colour across the band the bank
   * passes through, full at the waterline and gone a unit above the guard's own floor. Two
   * and a half times as much bare ground as before is two and a half times as much *green*
   * without it, because the ramp between `ground.low` and `ground.high` paints the beach
   * the same colour as the meadow. `0xd8c48a` is the pack's own sand, one of the swatches
   * the crates and the thatch are painted from, so the beach belongs to the village.
   *
   * **`wobble`.** The shoreline is no longer a ruled line: `amp 9` at `scale 0.018` bends
   * it as a function of how far along the shore a point lies, which across the frame is
   * about two bays and the headlands between them — the waterline runs from 39.8 to 45.8
   * over the stretch the camera keeps. Everything downstream follows it for free, because
   * `blockedCells`, the navigation grid, the scatter guards and the harbour's own tests all
   * go through `terrainHeight`.
   *
   * **The harbour is pinned.** `boat.js` is a page of distances measured against the
   * waterline at the dock's shore coordinate, so the bend is multiplied by a mask that is 0
   * within 12 units of that coordinate and 1 past 28 (`WOBBLE_PIN`/`WOBBLE_FREE` in
   * `setting.js`). Twelve covers the ship's 12.92 of hull lying across the pier's line; the
   * sixteen units of ramp past it move the coast by at most 2.7, a slope of about a seventh
   * and gentler than the bays the noise draws on its own, so the mask's own edge is not a
   * visible kink.
   *
   * **`bed 2`: the sea is twice as deep, and only where it is already sea.** Every depth
   * above is the bank's; under the waterline the bed then falls twice as far below `level`
   * (see the end of `shapeValley`), so no dry point moves by a bit and nothing the beach, the
   * dock or the cells were measured against moves with it. It is there for the colour.
   * Upstream's sea reaches its full blue 3.2 under the surface, and this bank never got there:
   * at the rest view under the curve (0.45) the water on screen stood 1.48 deep at the median
   * and 2.03 at the ninetieth percentile, and none of it was 3.2, so the whole sea read as
   * shallows. Three factors were rendered side by side in the taste round (2026-09-29) and two,
   * the middle one, was taken. Measured again at the branch point of 2026-09-30, in the
   * village's frame: at ×1.5 4 % of the visible water is 3.2 deep or more, at ×2 42 % (median
   * 2.96), at ×2.5 68 %. Space's frame, which sees a little more water, measures 15 / 50 / 70.
   * The hills in the water (see `hills` below) are ground above the level and do not move.
   */
  coast: {
    axis: [-0.9848, 0.1736],
    from: 40,
    depth: 7,
    sand: 0xd8c48a,
    wobble: { amp: 9, scale: 0.018 },
    bed: 2,
  },
  /**
   * The sea itself, upstream's (`water.js`) since 2026-09-30, where it had been a flat plane of
   * our own in `0x3f9bd8`. The colours are Shoreline's, so the two coasts read as one sea:
   * turquoise over the sand, blue where the doubled bed falls away, white foam at the waterline.
   * The swell is `waveHeight` 0.1, a little under Shoreline's 0.14, as the taste round rendered
   * it.
   *
   * `level` is the shore's, not the sea's: four units under the colony's floor, which is the
   * beach (see "`depth 7`" above).
   */
  water: { level: -4.7, shallow: 0x52dcd4, deep: 0x1c6fba, foam: 0xffffff, waveHeight: 0.1, sparkle: 1 },
  /**
   * The hills opposite the sea — what used to be a wall of crags, and is now high ground
   * with a wood on it.
   *
   * **Nine units of climb, not eighteen.** A valley has a sea down one side and rising
   * country up the other; it does not have an alpine face. Half the height puts the top of
   * the rise inside the picture instead of above it, which is what lets the trees standing
   * on it read as a hillside rather than as a dark fringe along the top edge.
   *
   * **270° rather than 280°, and 58 rather than 50.** Turning it to due `-z` moves it a
   * touch further from the sea in screen terms while keeping it in the top right, where the
   * frame is deep; the sea is at 170° and the two are now a hundred degrees apart. Pushing
   * the foot from 50 to 58 puts it past the navigation square at 56 as well as past the
   * plots at 46, so nothing built or walked on takes any lift at all — and it is what makes
   * the hills read as *further off* than the water, which is the whole point of moving them.
   *
   * **Where the rise and the sea meet.** They are two half-planes, so their boundaries cross
   * somewhere by construction — the old wall's did too. Measured: the foot line `z = -58`
   * crosses the sea's reach at `x = -31.8`, which is 66 units from the middle of the colony,
   * out in the top left. In front of the village, where it matters, there is open dry ground
   * between them: 31.2 units at `x = 0`, 11.6 at `x = -20`. Past the crossing the rise's
   * climb has barely begun and the sea is seven units deep, so what the overlap actually
   * costs the picture is 45 pixels of land showing in open water, on top of the 155 the
   * `hills` multiplier costs and the 4 that were there before this batch. `tests/setting.test.mjs`
   * pins the near half.
   *
   * What stands on the rise, and how much of it, is each theme's own: the crag recipe and
   * its count are in the dressing's `ridges`, matched to this one by index.
   */
  ridge: { axis: [0.0, -1.0], from: 58, width: 28, height: 9 },
  /**
   * The meadow between the plots and the hills rolls — but gently, because this setting has
   * a sea in it and the sea is shallow.
   *
   * **1.1, not the 1.8 the design asked for, and the sea is why.** The far-field term is
   * amplitude, so it lifts the seabed exactly as it lifts the meadow — and this sea is only
   * `depth` 7 under a `level` of -4.7, which is not enough water to hide a hill under.
   * Measured over the open water the frame keeps (past `from + SHORE_OUT`, so the bank
   * itself is never counted), and again as the pixels that land actually paints:
   *
   *   no multiplier      8 of 3343 square units above the waterline (0.2%),   32 px
   *   1.1               50 of 3319 (1.5%),                                   202 px
   *   1.2              157 of 3297 (4.8%),                                   629 px
   *   1.4              489 of 3254 (15.0%)
   *   1.8             1023 of 3149 (32.5%)
   *
   * At 1.8 the first render showed it plainly: the sea came up as a river with a green far
   * bank. At 1.2 it is one pale patch in the water beside the ship's masts. 1.1 keeps the
   * land in the water inside the strip along the very top edge, where it was already.
   *
   * What the multiplier buys here was never much. Over the ground between the plots and the
   * rise the relief runs 1.20 units at 1.1 against 1.14 at none and 1.95 at 1.8, because
   * this setting's `roughness` is 0.55 and the two multiply — a valley whose long views are
   * the point does not want the mountain's ground anyway. The rolling the batch asked for
   * comes from the rise itself, which is 9 units of it.
   *
   * A deeper sea would carry more. The bed the valley has since 2026-09-30 (`coast.bed`) is
   * deeper only where the ground is already under the water, so it hides no hill and leaves
   * this table as it stands.
   */
  hills: 1.1,
  companion: { name: 'Moon', color: 0xdcd8cc, size: 3.2, glow: 0xfff6e0 },
  dust: 0.35,
  /** A meadow with a sea down one side: surf at the shore, wind in the grass, gulls by day. */
  audio: {
    beds: [
      { sound: 'surf-gentle', gain: 0.45, shore: true },
      { sound: 'wind-soft', gain: 0.4 },
      { sound: 'meadow-birds', gain: 0.4, night: 0 },
      { sound: 'crickets', gain: 0, night: 0.5 },
    ],
    events: [
      { sound: 'gull', every: [8, 24], gain: 0.45, when: 'day', where: 'ring' },
      { sound: 'wave-crash', every: [12, 30], gain: 0.4, where: 'water' },
      { sound: 'songbird', every: [10, 30], gain: 0.45, when: 'day', where: 'ring' },
      { sound: 'owl', every: [30, 80], gain: 0.4, when: 'night', where: 'ring' },
    ],
    shore: true,
  },
  /**
   * The atmosphere, from the same side-by-side round as the forest's (rest view, by day, under
   * the curve, 2026-09-29). The grade is the middle of three tried: with none the meadow and
   * the sea read flat; 1.12 / +0.08 turned the meadow olive and read as a filter.
   */
  grade: { saturation: 1.06, warmth: 0.05 },
  /**
   * Upstream's blade as it comes, rooted and tipped from `ground`, swaying a touch more than
   * the forest's. Bare ground read as a painted board; the taller blade (0.45–0.95) with a
   * gold tip (0xd6b45e) darkened into a coarse pile around the plots.
   */
  grass: { sway: 0.65 },
  /**
   * The lighter of two covers, as on the forest: none left the sky over the sea bare, and 0.55
   * was the heavier sheet for nothing the rest view could show. Colour and speed held.
   */
  clouds: { amount: 0.35, color: 0xffffff, speed: 1 },
  /**
   * The forest's swallows, and its butterflies without the orange, the lighter of two sets
   * (ten swallows and twenty butterflies began to be counted rather than noticed); and four
   * fish in the shallows, the same in both sets.
   */
  fauna: {
    birds: { kind: 'swallow', count: 6, altitude: [7, 14], colors: [0x3a3a4a, 0x2a2a3a], size: 0.9 },
    butterflies: { count: 10, colors: [0xffd45a, 0xffffff] },
    fish: { count: 4 },
  },
  biome: 'green',
  /**
   * The dressed `ceremony` comes after the sea here rather than after the rim, which is
   * where the valley's setting has always carried it (see `DRESSED_AFTER` in `resolve.js`).
   */
  dressedAfter: { ceremony: 'water' },
}
