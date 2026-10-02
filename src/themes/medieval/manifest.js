/**
 * The medieval village, as data.
 *
 * Everything the engine builds the theme out of: the settings it can be seen in, the ground
 * scatter, the two kits and how their shared 8x4 atlas is divided, the cast and its clips, the
 * building recipes, the plot measurements and the words the HUD uses.
 *
 * This is every world of the library, three of them dressed as the village's own in three of the
 * pack's four seasons, the whole cast of eight and five kinds of building. The full catalogue
 * widens it later; the shape does not change.
 */
import { resolveSettings } from '../../worlds/resolve.js'
import { WORLD_GROUPS } from '../../worlds/index.js'
import { FLAME } from './torch.mjs'

/** The worlds this theme lists, in picker order: every world, group by group. */
const WORLDS = WORLD_GROUPS.flatMap((g) => g.worlds)

/** The Kenney nature kit, as a scatter entry names it (`kits.nature`). */
const N = 'nature'

/**
 * The forest's dressing, which is also the theme's default: the summer atlas, the forest
 * scatter and its rim, and the green keep.
 */
const FOREST = {
  /** Which of the pack's four repaints the kits wear here. */
  atlas: 'summer',
  scatter: 'forest',
  /**
   * The wood the village was cleared out of. Same band as the mountain's, and for the
   * same reason: 52 is past the plots and past the navigation grid, 82 is the top of the
   * frame, and everything outside that is not in the picture.
   *
   * `count` is high for the reason the mountain's note records: the camera keeps about a
   * fifth of the annulus, so the count that fills the visible band is several times the
   * count that would look right on a map. At 520 the far arc was a row of separate clumps
   * with daylight between them and the ground reading through; at 1100 it closes into an
   * unbroken tree line from edge to edge, which is the clearing this setting wants.
   *
   * There is a band of reddish-brown along the foot of the wood. That is the pack's own
   * paint — every tree in this kit sits on a small patch of bare earth, visible under the
   * lone trees in the plain `forest` scatter too — and at rim density those patches line
   * up into a strip of undergrowth. Sinking the wooded hill tiles to bury their sides was
   * tried and moved about 1,700 pixels, so the strip is the trunks, not the tiles, and
   * the tiles keep the plan's `sink`.
   *
   * The band and the count held under the world curve. At the rest view with the curve at its
   * default 0.45, the ground's horizon on the far bearing falls at 67 units out (screen row 154
   * of 800), inside this band, so the ring still stands on the horizon it has to cover; what
   * the curve changed is how much of each piece shows, which is `forestRim`'s sizes.
   */
  rim: { recipe: 'forestRim', inner: 52, outer: 82, count: 1100 },
  /**
   * The arrival: a green keep with round towers, on the theme's own default cell.
   *
   * Named rather than left to the default because the mountain now names a *different*
   * keep and the two have to be told apart — `castle` and `fortress` are two styles of one
   * shape (`keep.js`), not one building in two paints. No `cell`: the forest keeps
   * `plots.ceremonyCell`, `{ q: -2, r: 1 }`, which is where the castle has always stood.
   */
  ceremony: { kind: 'castle' },
}

/**
 * How the village plants: the scatter style the generator falls back to (`SCATTER_STYLE` in
 * `src/world/setting.js`), spelled out. Exactly one candidate per prop, flung √ out from the
 * centre, no groves, a recipe used whole or not at all under one material, and only a recipe
 * named `flora` planted as flora — which none of the village's is.
 */
const STYLE = { budget: 900, spread: 'sqrt', groves: false, retries: 1, kitFallback: 'whole', flora: { is: 'flora' } }

/**
 * What the village plants on a world and where its villagers arrive. Its own three worlds each
 * have an entry; the forest's, in the village's style, is also the default, which every other
 * world takes until it is dressed.
 */
const DRESSING = {
  worlds: {
    forest: FOREST,
    valley: {
      atlas: 'fall',
      scatter: 'meadow',
      /**
       * The same band the other two rims use (theirs run to 82), for the same reason: past
       * the plots and the navigation grid, out to the top of the frame. Two of its arcs are
       * cut for it — the wet one by the shore guard, the far one by the crags standing on the
       * wall — so the count is authored against the meadow arc that is left.
       *
       * **520 still, with the coast in at 40.** Bringing the shore inside the lattice takes
       * the planted rim from 292 instances to 202, and the instinct is to raise the count to
       * make that back. It would be wrong: the shore guard is a *rejection*, not a reshaping
       * of the draw, so the density on the arc that survives is `count` over the whole annulus
       * either way. Raising it would leave the meadow denser than the one already approved,
       * not restore it. The arc is shorter because there is a sea where it used to be, and
       * reading the shot is what settles it — the hay between the water and the crags comes up
       * as thick as it ever did.
       */
      rim: { recipe: 'valleyRim', inner: 52, outer: 80, count: 520 },
      /**
       * The arrival: a dock on that shore instead of the castle the other two settings have.
       *
       * **The cell is the dock's shore station, not the pier.** A castle stands on its cell; a
       * pier starts on land and has to *reach* the water, which on a lattice of 7.6-unit cells
       * is never a whole number of cells away. So the cell is a point on the bank, `boat.js`
       * reaches `PIER_OUT` seaward of it, and what the cell owes the picture is that it be in
       * shot, on dry ground, and near enough the sea for a 7.8-unit pier to cross it.
       *
       * **`{ q: -3, r: 1 }`** — world (-34.20, -6.58), d 32.54, ground -0.52, with the
       * waterline 6.10 further along the axis. It was chosen by measuring the whole line of
       * cells on the water axis in the default frame (camera at rest: azimuth π/4, polar 56°,
       * distance 62, fov 38):
       *
       *   `{-5,2}` d 55.0 → (223, 106) px   `{-3,2}` d 34.8 → (212, 238)
       *   `{-4,2}` d 44.9 → (218, 164)      `{-3,1}` d 32.5 → (376, 182)
       *   `{-4,1}` d 42.6 → (364, 120)      `{-3,0}` d 30.3 → (513, 135)
       *
       * The sea is always in the *top* of the frame because the far bearing runs up the screen,
       * and no water axis puts a dock cell lower — 135°, 150°, 160° and 170° were all tried.
       * This is the one with margin on every side: in shot, on the same bank the old cell stood
       * on, and with the waterline near enough that a pier crosses it. The old `{-5,2}` at
       * (223, 106) was a speck in the corner, which is the whole reason the coast moved.
       *
       * Position alone still leaves the harbour small, which is why `boat.js` carries a
       * `DOCK_SCALE` of 1.5 on top of this, and the ship a `SHIP_SCALE` of 2.2 on top of that.
       *
       * **The berth is a T.** The ship does not lie alongside the planks: it comes in broadside
       * and makes fast across the pier's head, its near side a unit off the end at 11.90 and
       * its centre line at 14.77 along the axis, with 6.46 of hull reaching either way across
       * the pier's line. That is 12.92 of ship against 7.80 of pier, all of it over ground
       * about 9.8 below a sea at -4.7. The cell has to carry that as well as the pier now,
       * which it does: the berth is 17.6 out at its furthest and the sea runs to the horizon
       * past 38.77.
       *
       * **The door.** `boat.js` puts the threshold 7.5 landward — it has to clear the 6.76
       * obstacle the colony blocks at the cell — which is world (-26.81, -7.88) on ground at
       * +0.10, the colony floor. That is among the plots rather than out past them now, which
       * is exactly where the castle's own arrivals appear in the other two settings.
       */
      ceremony: { kind: 'boat', cell: { q: -3, r: 1 } },
      /**
       * The wood on the hills opposite the sea.
       *
       * **`count` 3300, three times the design's 1100, and measured.** The crags stand in a
       * strip 52 units deep along the axis and the frame keeps about seventeen of them, in the
       * top right corner — the foot line crosses the picture from (628, 17) to (1138, 115) and
       * the top of the climb is off the top edge everywhere. Projected at the harness's own
       * density of 0.6: 1100 puts **10** pieces in the picture, against the **25** the crag
       * wall it replaces had. Ten is a bare slope with a few trees on it, which is what the
       * first render showed. 3300 puts about thirty there, so the rise carries a wood.
       */
      ridges: [{ recipe: 'valleyHills', count: 3300 }],
    },
    mountain: {
      atlas: 'winter',
      scatter: 'alpine',
      /**
       * The near arcs, at the band the camera actually keeps: the top of the frame is ground
       * about sixty units out, the plots stop at forty-six and the navigation grid at
       * fifty-six, so 52 to 82 is the ring that is in the picture and nobody walks through.
       *
       * The ring is unchanged by the range now standing behind it. It is what fills the sides
       * of the frame, where a half-plane wall does not reach — the two ridges below enter
       * across the top and close the top right, and past 320° of bearing there is no picture
       * left to fill. Crags, not wedding cakes: see the `alpineRim` note for why the pieces
       * are small.
       *
       * `count` is high because most of the annulus is not in the shot — about a fifth of
       * 12,600 square units is. 420 and 560 read as scattered peaks with daylight between
       * them; 1100 closes the arc.
       *
       * **1300 under the world curve.** At the rest view with the curve at 0.45 the ground's
       * horizon on the far bearing is 88 units out and above the top of the frame (row −52),
       * so the two ridges still carry the top edge at the centre. The corners are what the
       * curve opened: 40° to the left the horizon comes down to row 53, 139 units out, and
       * over the bare ground the sky reaches down to rows 24–84 across the left fifth of the
       * frame. The ring's back edge stands just under that wedge, so more of it, with
       * `alpineRim`'s peaks ×1.2, is what reaches up into it. The taste round of 2026-09-29
       * rendered this beside today's 1100 and took it: the bowl of peaks closed at the corners.
       */
      rim: { recipe: 'alpineRim', inner: 52, outer: 82, count: 1300 },
      /**
       * The crags on the two walls of the range, by index.
       *
       * **6400 and 3600, four times the design's 1600 and 900, and measured rather than
       * guessed.** The crags stand in a strip running `from` to `from + width + 24` — 58 units
       * along the axis — and the rest frame keeps about eight of them: the ground on the far
       * bearing crosses the top edge of the picture at roughly 64 units out, five units past
       * where the climb begins. Projected through the rest camera at full density:
       *
       *   design's 1600 + 900   2303 planted,   27 in frame, 1863 above the top edge
       *   doubled               4582 planted,   49 in frame
       *   tripled               6886 planted,   72 in frame
       *   6400 + 3600           9139 planted,   91 in frame
       *
       * Twenty-seven is not a range. Worse, it is a *loss*: `hills` and these two climbs lift
       * the ring behind them as well, and the rim's own contribution to the top band falls from
       * 178 crags to 133 — so at the design's counts the skyline came out thinner than the one
       * the setting already shipped (160 against 178). At 6400 and 3600 the band carries 224,
       * which is denser than before and reads as a range standing behind the bowl of peaks
       * rather than as a wrinkle in it.
       *
       * The waste is only waste in *this* frame. The camera moves in the product, and a strip
       * that stops at the top edge of the rest pose is a range that ends in mid-air the moment
       * anybody tilts up — which is why the fix is the count and not a shorter strip.
       *
       * The far wall is the wider band (34 against 30) and carries the whole top of the frame,
       * so it keeps the larger share at the same ratio the design set.
       */
      ridges: [
        { recipe: 'alpineWall', count: 6400 },
        { recipe: 'alpineWall', count: 3600 },
      ],
      /**
       * The arrival: a blue keep with cannon towers on stone plinths, on the theme's own
       * default cell. The forest's `castle` is the same shape in the pack's green with round
       * towers half as tall; see `fortress.js` for why the two are different buildings rather
       * than one recoloured. No `cell`: the mountain keeps `plots.ceremonyCell`,
       * `{ q: -2, r: 1 }`, which is where the castle has always stood.
       */
      ceremony: { kind: 'fortress' },
    },
    /**
     * Shoreline's arrival: the valley's ship, on a coast the valley's numbers were not measured
     * for. The sea is `COAST_DIR` from everywhere (`coastAxis`), across the far side of the view.
     *
     * **`{ q: -2, r: -2 }`**, world (-22.80, -39.49), d 45.60, ring 4 — ground -0.04 to +0.08
     * over its seven samples, dealable, with the waterline 25.55 along the axis. Measured on the
     * cleared ground (the far field ramped in from 55 units, 2026-09-29) along the whole run of
     * cells beside the `COAST_DIR` line, the ground sampled along the axis and the screen points
     * taken through the rest camera at 1280×800:
     *
     *   `{-2,-3}` d 57.4, waterline 18.20 → (871, 74) px   `{-4,-1}` 10.45, refused (min -0.81)
     *   `{-2,-2}` d 45.6, waterline 25.55 → (779, 110)     `{-3,-2}` 12.75, refused (min -0.43)
     *   `{-2,-1}` d 34.8, waterline 35.20 → (672, 150)     `{-4, 0}` 20.60, dealable
     *                                                      `{-3,-1}` 22.90, dealable
     *
     * No dealable cell has the valley's 9–12 units of beach: the two that do stand where the sand
     * has begun to fall to the sea, and the floor refuses them — a corner of each is under the
     * deck's skirt, while none of their 19 points rises past +0.08, well clear of burial. The
     * clearing freed two cells nearer the water than this one: `{-4, 0}` and `{-3,-1}`, the second
     * all but on the line (0.9 off it, against this cell's 11.8). The dock stays here all the same,
     * because the coast, not the dock, sets where the ship sits in the picture: from `{-3,-1}` the
     * pier head would land at (631, 27) and the ship's waterline at (632, 10), no lower in the frame
     * than from here, where they land at (751, 28) and (746, 11). The masts and the hull stand
     * above the frame, and the harbour is seen whole only once the camera tilts up. That is the
     * cost of a sea on the far bearing, and the owner kept this framing rather than moving the
     * coast.
     *
     * **The pier and the berth, set for the long beach.** At the valley's 11 the pier would stop
     * fourteen units short of the water. The rule is the valley's: the deck, `FREEBOARD` over the
     * sea, meets the sand at the foot. The ground crosses the deck's height at 21.20 along the axis
     * and the valley's 3.90 half-pier puts the origin at 25.10; 25.4 moves the foot 0.30 onto the
     * beach (0.06 of daylight under the planks' end) so the nearest piling stands at 25.83, past
     * the waterline, and the head at 29.30 over ground at -2.6. The berth is the valley's T worked
     * through: a unit off the head plus the half-beam, 36.04. The near side of the hull lies over
     * ground at -2.9, open water, and the bed only falls from there — this beach shelves over
     * thirty units, not the valley's bank.
     *
     * **The door** is `DOOR_OUT` landward of the cell, on the colony floor at +0.04.
     */
    beach: { ceremony: { kind: 'boat', cell: { q: -2, r: -2 }, pierOut: 25.4, berth: 36.04 } },
    /**
     * Archipelago's arrival: the ship at a dock on the island's far shore, the pier running
     * straight out from the middle (`coastAxis` on an island).
     *
     * **`{ q: -1, r: -1 }`**, world (-11.40, -19.75), d 22.80, ring 2, 15° off the far bearing —
     * ground +0.01 to +0.09, dealable. The ring-2 and ring-3 cells on that side, measured on the
     * cleared ground (the far field ramped in from 55 units, 2026-09-29) with the island fresh
     * (the dock cell alone) and grown (the dock and every dealable cell of rings 0–11, less the
     * harbour wedge, `HARBOUR_HALF_ANGLE`, in front of whichever cell is the dock), the ground
     * sampled along the axis and the screen points taken through the rest camera at 1280×800:
     *
     *   `{-1,-1}` ring 2, waterline 24.80 fresh and grown → (725, 222) px, pier head (785, 114)
     *   `{-2,-1}` ring 3, waterline 24.50 / 24.50 → (672, 150), pier head (685, 64)
     *   `{-1,-2}` ring 3, waterline 24.65 / 24.65 → (841, 168), pier head (926, 85)
     *   `{-2, 0}` ring 2, waterline 28.40 / 28.40 → (545, 200), pier head (482, 86)
     *   `{-3, 0}` ring 3, waterline 29.05 / 29.05 → (513, 135), pier head (463, 44)
     *
     * Ring 2 rather than ring 3 because the island may be nothing but the dock — a colony with
     * no repo on show — and from a ring-3 dock the walk in to the middle then runs into the sea
     * 18.3 units from the door. From here it stays on the dock's own beach. It is above the
     * plots, its shore does not move as the island grows (with `HARBOUR_HALF_ANGLE`'s wedge
     * kept clear), and the whole harbour is in shot: the pier head at (785, 114) and the ship's
     * waterline at (796, 89). Only the masts leave the top of the frame. Its door lands in its
     * own cell, so it reserves nothing more.
     *
     * The island starts `PLOT_CELL + 5` past the nearest cell, the sea is full depth 26 further
     * out, and the waterline wobbles ±6 — so from a cell at the shore the water is 24.80 out,
     * not 10. **`pierOut` 25.9**: the ground meets the deck (-0.72) at 21.90, so the foot at
     * 22.00 comes down on the sand, the nearest piling stands at 26.33 in the water and the head
     * at 29.80 over ground at -4.1. **`berth` 36.54**, the T again: the hull's near side is at
     * 30.80 over ground at -4.6. The same numbers hold fresh and grown.
     *
     * **The door**, `DOOR_OUT` landward, is on the colony floor at +0.02.
     */
    ocean: { ceremony: { kind: 'boat', cell: { q: -1, r: -1 }, pierOut: 25.9, berth: 36.54 } },
    // The two green worlds that wear a season of their own; the rest of the family is the
    // forest's summer.
    sakura: { atlas: 'spring', scatter: 'blossom', kitFallback: 'filter' },
    autumn: { atlas: 'fall', scatter: 'harvest', kitFallback: 'filter' },
    // The other two plant-defined worlds: Dune's cacti and Canopy's jungle trees (2026-10-01).
    // `'filter'` on all four, and on `biomes.water`, because they plant from two kits: under
    // `'whole'` every kind shares the first kind's material, atlas and all.
    desert: { scatter: 'dunes', kitFallback: 'filter' },
    jungle: { scatter: 'canopy', kitFallback: 'filter' },
  },
  /**
   * Every other world, by the family it belongs to (`biome` in `src/worlds/`). A key a biome
   * leaves out is the forest's. Forest, valley and mountain name every key their biome does, so
   * nothing here reaches them.
   */
  /*
   * Rim counts, as read off unpinned every-world shots at the rest camera (2026-09-29):
   * - water 1000, the valley's 520 nearly doubled. Shoreline's sea takes the far arc, so the rim
   *   is the strip of country in front of it along the top of the frame; at 520 its hill tiles
   *   stood apart and read as slabs laid on the grass (the `meadow` note's failure), at 1000 they
   *   touch and read as rolling ground running down to the water. Archipelago's rim is all sea
   *   and plants nothing either way.
   * - cold 1100, the mountain's, for the mountain's reason: it closes the arc across the top.
   * - arid 700: a boulder field with sand showing between the peaks, which is the desert; more
   *   closes it into a wall that reads as the mountain in another colour.
   * - volcanic 900: the world is lit dark and the rim shows only as a silhouette along the top
   *   edge; at this count that silhouette is unbroken.
   * - airless 600: a crater's lip of dark stone, broken, over grey dust.
   */
  biomes: {
    green: { scatter: 'meadow' },
    water: { scatter: 'shore', kitFallback: 'filter', rim: { recipe: 'valleyRim', inner: 52, outer: 80, count: 1000 } },
    cold: { atlas: 'winter', scatter: 'alpine', rim: { recipe: 'alpineRim', inner: 52, outer: 82, count: 1100 }, ceremony: { kind: 'fortress' } },
    arid: { scatter: 'drylands', rim: { recipe: 'peaksRim', inner: 52, outer: 82, count: 700 } },
    jungle: { budget: 1800 },
    volcanic: { atlas: 'fall', scatter: 'stone', rim: { recipe: 'peaksRim', inner: 52, outer: 82, count: 900 }, ceremony: { kind: 'fortress' } },
    airless: { atlas: 'winter', scatter: 'stone', rim: { recipe: 'peaksRim', inner: 52, outer: 82, count: 600 }, ceremony: { kind: 'castle', size: 'small' } },
    /**
     * A floating island has no ground past its plots, so a rim would be a ring of trees standing
     * in the air: `null` takes the forest's away. Half the budget, for half the ground.
     */
    sky: { scatter: 'meadow', budget: 450, rim: null, ceremony: { kind: 'castle', size: 'small' } },
  },
  default: { ...FOREST, ...STYLE },
}

export const manifest = {
  assetDir: 'assets/medieval',

  /**
   * The worlds, in the order the picker shows them, from the library in `src/worlds/`;
   * `settings` is those worlds wearing this theme's `dressing`, resolved once here, so every
   * consumer still reads a setting.
   */
  worlds: WORLDS,
  /** What a stored world this theme does not list opens on: the forest, the village's home. */
  defaultWorld: 'forest',
  /**
   * The worlds the settings picker shows: the owner's list (2026-10-01), signed off on the
   * planted screenshots. Every world in `worlds` is still built and dressed, so moving one onto
   * or off this menu is a one-line edit here.
   */
  menu: ['forest', 'valley', 'mountain', 'beach', 'ocean', 'desert'],
  dressing: DRESSING,
  settings: resolveSettings(WORLDS, DRESSING),

  /**
   * The arrivals this theme can build — what a setting may name in `ceremony.kind`, and what
   * the schema holds that name against.
   *
   * The village has three, because where the villagers come from is the setting's own choice:
   * a green keep in the woods, a blue one with cannon towers on the mountain, and a boat
   * pulling into a dock on the valley's coast. Declaring a kind here is what makes it
   * *nameable*; `src/themes/medieval/index.js` is where each one is actually built, and all
   * three of these are. Adding a fourth means adding it in both places — a name here with no
   * builder there would quietly fall back to the castle, which is why the two lists are kept
   * side by side.
   *
   * `castle` and `fortress` are one shape in two styles (`keep.js`, and a style object each in
   * `castle.js` and `fortress.js`) rather than two modules of geometry. They are two *kinds*
   * all the same, because a kind is what `Colony.setSetting` compares to decide whether moving
   * between settings has to tear the arrival down and build another one.
   *
   * Every arrival carries its own `clearance` and `apron` rather than the theme stating one
   * pair in `plots`, which is why that pair is absent below: a castle's walls and a dock's
   * pier do not cover the same ground, and there is nothing useful the theme could say for
   * both. The space colony, which has one fixed ceremony, keeps its numbers in its manifest.
   */
  ceremonies: ['castle', 'fortress', 'boat'],

  /**
   * The sizes each keep comes in, as a setting's `ceremony.size` names them, the first the one
   * it gets when it names none. The castle is `standard` (the forest's) or `small`; the fortress
   * is the one `grand` keep, the largest building by its parts. The boat takes no size.
   */
  ceremonySizes: { castle: ['standard', 'small'], fortress: ['grand'] },

  /**
   * What grows outside the village. `size` is a multiplier on the model's own size, and the
   * hexagon pack authors small: a single tree is 1.2 units tall, a hill 0.3, a rock 0.07 to
   * 0.2. So the numbers here are large where the space theme's are small, and the flattest
   * pieces — the rocks, the haybale — larger still.
   *
   * Sizes are set against the villagers, who stand 1.4 world units: a single tree near the
   * plots is about a villager and a half, a tree cluster half again, and an alpine peak on the
   * rim tall enough to read as a mountain rather than a boulder. `createScatter` multiplies all
   * of it by up to 2.9 in the far field, which is what gives the horizon its scale.
   *
   * `sink` is scaled by `size` too, so a piece with a large `size` needs a small `sink` or it
   * buries itself: 0.04 on a rock at size 4 drops it 0.16 units, about a third of its height.
   */
  scatter: {
    forest: [
      { part: 'trees_A_large', weight: 3, size: [2.4, 3.4], sink: 0.02, upright: true },
      { part: 'trees_B_large', weight: 2, size: [1.9, 2.7], sink: 0.02, upright: true },
      { part: 'trees_A_medium', weight: 3, size: [1.7, 2.45], sink: 0.02, upright: true },
      { part: 'tree_single_A', weight: 4, size: [1.5, 2.2], sink: 0.02, upright: true },
      { part: 'tree_single_B', weight: 3, size: [1.5, 2.15], sink: 0.02, upright: true },
      { part: 'rock_single_C', weight: 1, size: [2.2, 4.4], sink: 0.04, tint: true },
      { part: 'rock_single_E', weight: 1, size: [2.0, 4.0], sink: 0.04, tint: true },
    ],
    /**
     * Open country: stubble and standing hay in place of the woods, with the trees thinned to
     * ones and twos. None of the pack's three hill pieces made it: they are flat-topped tiles
     * meant to be laid edge to edge (`hill_single_A` is 1.1 across and only 0.3 tall), and
     * standing alone on open ground at any size that reads from the colony they are slabs laid
     * on the field rather than rises in it. The rolling comes from the terrain instead, which
     * this setting keeps gentle at roughness 0.55 — which is what "long views" wanted anyway.
     */
    meadow: [
      { part: 'tree_single_A', weight: 4, size: [1.5, 2.2], sink: 0.02, upright: true },
      { part: 'tree_single_B', weight: 3, size: [1.5, 2.15], sink: 0.02, upright: true },
      { part: 'trees_A_small', weight: 2, size: [1.6, 2.4], sink: 0.02, upright: true },
      // The bale is 0.4 across and 0.18 tall as authored — a round bale wants five times that.
      { part: 'haybale', weight: 3, size: [4.0, 5.5], sink: 0.03, upright: true },
      { part: 'rock_single_B', weight: 2, size: [2.5, 4.5], sink: 0.04, tint: true },
    ],
    /**
     * Above the treeline: snowy crags, loose stone underfoot and a few stunted firs.
     *
     * The peaks are still here but they are *small* now, and the reason is the one that kept
     * the hills out of the meadow. `mountain_A` and its siblings are terraced hexagonal
     * cones — three or four flat-topped hex steps stacked narrowing — which is a mountain
     * when it is one tile of a hex map seen from above, and a stack of slabs when it stands
     * alone on open ground. At the 3.5–7.5 the first cut asked for, and again by up to 2.9
     * in the far field, the terraces were the only thing left to see: a rim of pale hexagonal
     * wedding cakes, no more mountainous than the plot decks below them. Halved, the steps
     * fall below the size the eye separates them at and the same piece reads as a snow-capped
     * crag. `mountain_B_grass` is gone outright — it is the squattest of the four and the one
     * whose top step is widest.
     *
     * The height of the place comes from stone instead. `rock_single_*` are irregular lumps
     * with no flat top and no repeated step, so they take any size without turning into
     * architecture, and weighted above the peaks they read as the boulder field a mountain
     * village actually sits in.
     */
    alpine: [
      { part: 'mountain_A', weight: 3, size: [1.8, 2.8], sink: 0.1, upright: true },
      { part: 'mountain_A_grass', weight: 2, size: [1.6, 2.4], sink: 0.12, upright: true },
      { part: 'rock_single_A', weight: 5, size: [3.0, 6.0], sink: 0.02, tint: true },
      { part: 'rock_single_D', weight: 4, size: [2.6, 5.2], sink: 0.03, tint: true },
      { part: 'rock_single_E', weight: 4, size: [2.4, 4.8], sink: 0.03, tint: true },
      { part: 'tree_single_A_cut', weight: 2, size: [1.5, 2.5], sink: 0.02, upright: true },
      { part: 'tree_single_B', weight: 2, size: [1.2, 1.8], sink: 0.02, upright: true },
    ],
    /**
     * The mountain's rim: the bowl of peaks the frame is actually filled with.
     *
     * A rim recipe is planted by `createScatter`'s second population, in the annulus a
     * setting's `rim` names, and it differs from a scatter recipe in one way that matters
     * here: the far-field ×2.9 does not apply. Sizes are literal, so they are written for a
     * piece standing about seventy units from the camera rather than for one on the horizon.
     *
     * Hence numbers under 3 where `alpine`'s rocks go to 6. This is the constraint the
     * `alpine` note above records: `mountain_*` are terraced hex cones, and above roughly
     * 2.8 the steps separate and the ring reads as a row of pale wedding cakes. Kept small
     * and packed shoulder to shoulder they read as crags, and the whole ring as a bowl. The
     * two `rock_single_*` are the irregular lumps that fill the gaps between them, tinted to
     * the setting's own stone so they belong to this mountain rather than to the pack.
     *
     * **Every size ×1.2, for the world curve.** At the rest view with the curve at 0.45 the
     * ground leaves a wedge of sky in the top-left corner, down to row 84 of 800 at its
     * deepest, 40° to the left of the far bearing where the horizon is 139 units out at row 53.
     * At the sizes the flat world was tuned at, the tallest peak (`mountain_B` at the top of
     * its range, 4.6 units) on the ring's back edge reached into that wedge from about a tenth
     * of the way across the frame; at ×1.2 (5.5 units) it reaches in from 112 pixels of 1280
     * and stands 9–14 rows taller everywhere on it, and the recipe's weighted mean height goes
     * from 2.2 to 2.6 units. With the mountain's rim count at 1300 this is the pair the taste
     * round of 2026-09-29 took over today's. Weights and sinks are the flat world's.
     */
    alpineRim: [
      { part: 'mountain_A', weight: 3, size: [2.28, 3.24], sink: 0.1, upright: true },
      { part: 'mountain_B', weight: 2, size: [2.16, 3.12], sink: 0.1, upright: true },
      { part: 'mountain_C', weight: 3, size: [2.28, 3.36], sink: 0.1, upright: true },
      { part: 'mountain_A_grass', weight: 1, size: [2.04, 2.88], sink: 0.12, upright: true },
      { part: 'mountain_C_grass', weight: 1, size: [2.04, 3], sink: 0.12, upright: true },
      { part: 'hill_single_A', weight: 2, size: [2.64, 3.6], sink: 0.08, upright: true },
      { part: 'hill_single_B', weight: 2, size: [2.64, 3.6], sink: 0.08, upright: true },
      { part: 'hill_single_C', weight: 1, size: [2.64, 3.6], sink: 0.08, upright: true },
      { part: 'rock_single_C', weight: 3, size: [2.88, 4.8], sink: 0.04, tint: true },
      { part: 'rock_single_E', weight: 2, size: [2.64, 4.56], sink: 0.04, tint: true },
    ],
    /**
     * The crags on the mountain's own range — what stands on the ground the two ridges raise.
     *
     * The terrain does the mass and this does the silhouette, which is the division of labour
     * the valley's old crag wall proved: a climb that size with nothing standing on it reads as
     * a wrinkle in the ground rather than as mountains. So the peaks are at the sizes that wall
     * already found — larger than `alpineRim`'s, because these stand on ground the terrain has
     * raised and are further from the camera, and at that distance the terraces the `alpine`
     * note warns about no longer separate.
     *
     * The stone is the difference from that wall. This is a snowfield rather than an autumn
     * hillside, and `rock_single_*` are the irregular lumps that fill between peaks without
     * turning into architecture — the same argument the `alpine` recipe makes for weighting
     * them above the cones. Three of them here against that recipe's three, at a shade under
     * two thirds of the peaks' weight, which reads as a rockfall on the slope rather than as a
     * second row of summits.
     *
     * Everything is tinted to the setting's own `rock`. The pieces carry the pack's paint in
     * whatever season the setting wears and this one wears `winter`, so untinted they come up
     * the same near-white as the ground they stand on and the range loses its edge against the
     * sky.
     */
    alpineWall: [
      { part: 'mountain_A', weight: 4, size: [2.6, 3.8], sink: 0.1, upright: true, tint: true },
      { part: 'mountain_B', weight: 3, size: [2.5, 3.6], sink: 0.1, upright: true, tint: true },
      { part: 'mountain_C', weight: 4, size: [2.6, 3.9], sink: 0.1, upright: true, tint: true },
      { part: 'rock_single_A', weight: 3, size: [2.4, 4.0], sink: 0.03, tint: true },
      { part: 'rock_single_D', weight: 2, size: [2.2, 3.8], sink: 0.03, tint: true },
      { part: 'rock_single_E', weight: 2, size: [2.2, 3.6], sink: 0.04, tint: true },
    ],
    /**
     * The forest's rim: the wood that closes the clearing.
     *
     * Where `alpineRim` had to fight the terraces, this one has the opposite problem. The
     * tree clusters are the pack's tallest pieces and they are what the setting is for, so
     * they are weighted up and sized up to the top of what the `forest` recipe already
     * plants near the plots; the far-field ×2.9 does not reach the rim, so a cluster written
     * at 3.4 here is smaller on screen than the same part at 3.4 on the horizon.
     *
     * `hills_A_trees` and `hills_B_trees` are the wooded hill tiles. The `meadow` note
     * records that a bare hill tile standing alone reads as a slab laid on the field; these
     * carry their own trees and stand shoulder to shoulder with the clusters, so the flat top
     * never shows. `tree_single_A` fills the gaps at the front of the band, where a full
     * cluster would read as one solid mass.
     *
     * **Every size ×1.35, for the world curve.** At the rest view with the curve at 0.45 the
     * ground's horizon on the far bearing is 67 units out, at screen row 154, and 40° either
     * side 79 and 83 out, at rows 167 and 164. The back of the band stands behind it and
     * shows only its tops, and over the bare ground the sky comes down to rows 144–168 across
     * the frame. At the sizes the flat world was tuned at, a piece of the recipe's weighted
     * mean height (3.1 units) topped out 22–24 rows over the far horizon anywhere across the
     * band, and 14–29 rows 40° either side: a fringe with daylight between the crowns. At
     * ×1.35 the mean is 4.2 units and the same tops stand 31–35 and 26–39 rows up, the tallest
     * cluster (`trees_B_large` at the top of its range) 5.9 units against 4.4. The taste round
     * of 2026-09-29 rendered it beside today's sizes and beside a band pulled in to 52–74 at
     * 900 with the trees ×1.25, and took this one, the tree line that stood unbroken from edge
     * to edge. Weights and sinks are the flat world's.
     */
    forestRim: [
      { part: 'trees_A_large', weight: 4, size: [3.51, 4.59], sink: 0.02, upright: true },
      { part: 'trees_B_large', weight: 3, size: [3.105, 4.185], sink: 0.02, upright: true },
      { part: 'hills_A_trees', weight: 2, size: [3.24, 4.32], sink: 0.08, upright: true },
      { part: 'hills_B_trees', weight: 2, size: [3.24, 4.32], sink: 0.08, upright: true },
      { part: 'tree_single_A', weight: 1, size: [2.43, 3.24], sink: 0.02, upright: true },
    ],
    /**
     * The valley's rim: rolling ground and standing hay between the plots and the shore.
     *
     * The `meadow` note above records that the pack's hill tiles read as slabs laid on the
     * field when one stands alone on open ground. A rim is the case that note did not cover:
     * packed at rim density they overlap and lean on each other, so what shows is the
     * silhouette of the group rather than any one flat top, and `hills_A/B/C` are the only
     * pieces in the pack that give this setting relief without turning it into a wood.
     *
     * The bale carries the same ×10 the `meadow` recipe found it needs, and the two tree
     * entries are deliberately light: this is open country with a sea behind it, and a solid
     * tree line would read as the forest setting with the colours changed.
     */
    valleyRim: [
      { part: 'hills_A', weight: 2, size: [2.6, 3.4], sink: 0.08, upright: true },
      { part: 'hills_B', weight: 2, size: [2.6, 3.4], sink: 0.08, upright: true },
      { part: 'hills_C', weight: 1, size: [2.6, 3.4], sink: 0.08, upright: true },
      { part: 'haybale', weight: 2, size: [4.0, 5.5], sink: 0.03, upright: true },
      { part: 'tree_single_B', weight: 1, size: [1.6, 2.2], sink: 0.02, upright: true },
      { part: 'trees_A_small', weight: 1, size: [1.8, 2.5], sink: 0.02, upright: true },
    ],
    /**
     * The wooded rise opposite the valley's sea — what the crag wall `valleyCrags` used to be,
     * and the opposite piece of country.
     *
     * The wall it replaces was alpine: peaks and bare stone, tinted back to grey because
     * untinted they came up as autumn hillside. That was the right answer for a wall of crags
     * and it is the wrong one here. This is high ground at the back of a farmed valley, so it
     * wants to come up *as* autumn hillside — the tint is off on every piece but the boulders,
     * and the `fall` sheet the setting wears is what paints them.
     *
     * **Weighted towards the trees.** The spec asks for trees at the top of the slope and rock
     * lower down, and the recipe's weights are enough to say it without a height band per
     * entry: the wooded hill tiles and the single trees carry thirteen of the twenty-two, the
     * bare tiles five and the stone four. The rise is 9 units over 28, so its own foot is the
     * widest part of it — a boulder drawn anywhere is most likely to land low on the slope,
     * and a wood four times as likely as stone is a wood on the shoulder with rocks under it.
     *
     * The bare `hills_A/B/C` are here for the same reason `valleyRim` uses them: the `meadow`
     * note records that one alone on open ground reads as a slab, and packed at this density
     * they overlap and lean on each other so the group's silhouette is what shows. The
     * `_trees` variants carry their own canopy and never show a flat top at all.
     */
    valleyHills: [
      { part: 'hills_A_trees', weight: 3, size: [2.6, 3.4], sink: 0.08, upright: true },
      { part: 'hills_B_trees', weight: 3, size: [2.6, 3.4], sink: 0.08, upright: true },
      { part: 'hills_C_trees', weight: 2, size: [2.6, 3.4], sink: 0.08, upright: true },
      { part: 'hills_A', weight: 2, size: [2.6, 3.4], sink: 0.08, upright: true },
      { part: 'hills_B', weight: 2, size: [2.6, 3.4], sink: 0.08, upright: true },
      { part: 'hills_C', weight: 1, size: [2.6, 3.4], sink: 0.08, upright: true },
      { part: 'tree_single_A', weight: 3, size: [1.8, 2.6], sink: 0.02, upright: true },
      { part: 'tree_single_B', weight: 2, size: [1.7, 2.4], sink: 0.02, upright: true },
      { part: 'rock_single_B', weight: 2, size: [2.2, 3.6], sink: 0.04, tint: true },
      { part: 'rock_single_C', weight: 1, size: [2.2, 3.4], sink: 0.04, tint: true },
      { part: 'rock_single_E', weight: 1, size: [2.0, 3.2], sink: 0.04, tint: true },
    ],
    // The four recipes below dress the worlds the village did not have before (shared worlds,
    // 2026-09-29). The pack as built carries no pines, scrub, reeds or driftwood, so each is made
    // of pieces the recipes above already plant, at the sizes they already found — what changes
    // per world is the mix and the stone's colour. Every rock is tinted: it takes the world's own
    // `rock`, which is how Cinder's come out dark and Dune's sandy from one recipe.
    /**
     * Sand and shingle with the wood kept inland: rocks on the shore band, trees on dry land.
     *
     * `zone: 'shore'` is upstream's water's own band (`createScatter`'s `standing`): a rock so
     * marked stands only on ground between just above the waterline and the world's `shore.band`
     * over it, which is the beach. The trees keep to `land`, past it. The trees are `meadow`'s.
     *
     * The palms are Kenney's (`nature`, 2026-10-01): the hexagon pack has no palm, and without one
     * Shoreline and Archipelago read as the forest by the sea. They take about three fifths of
     * the weight. Half of them stand on the beach band with the rocks and half walk inland among
     * the trees, because Shoreline's beach is behind the horizon at the rest camera (decision 9)
     * and a palm only on the sand would never be seen there. Sized against the villagers, a palm
     * stands 2.5 to 4.5 units before the far field grows it — a head taller than `meadow`'s lone
     * trees, which is what a palm is. Planted under `kitFallback: 'filter'` (`biomes.water`): one
     * material per kit, since the nature kit is vertex-coloured and the hexagon pack atlased.
     */
    shore: [
      { part: 'tree_palm', kit: N, weight: 4, size: [2.3, 3.0], sink: 0.02, upright: true, zone: 'shore' },
      { part: 'tree_palmBend', kit: N, weight: 4, size: [2.5, 3.2], sink: 0.02, upright: true, zone: 'shore' },
      { part: 'tree_palmTall', kit: N, weight: 3, size: [2.6, 3.3], sink: 0.02, upright: true, zone: 'shore' },
      { part: 'tree_palmDetailedTall', kit: N, weight: 4, size: [2.5, 3.2], sink: 0.02, upright: true },
      { part: 'tree_palmDetailedShort', kit: N, weight: 3, size: [2.5, 3.2], sink: 0.02, upright: true },
      { part: 'tree_palmShort', kit: N, weight: 3, size: [2.6, 3.3], sink: 0.02, upright: true },
      { part: 'tree_single_A', weight: 4, size: [1.5, 2.2], sink: 0.02, upright: true },
      { part: 'tree_single_B', weight: 3, size: [1.5, 2.15], sink: 0.02, upright: true },
      { part: 'trees_A_small', weight: 2, size: [1.6, 2.4], sink: 0.02, upright: true },
      { part: 'rock_single_B', weight: 3, size: [2.5, 4.5], sink: 0.04, tint: true, zone: 'shore' },
      { part: 'rock_single_C', weight: 2, size: [2.2, 4.4], sink: 0.04, tint: true, zone: 'shore' },
    ],
    /**
     * Rock and dead stumps, no leaf — Dune and Rust. The `alpine` recipe's boulders at its
     * sizes, with its cut stump for the one sign that anything ever grew here.
     */
    drylands: [
      { part: 'rock_single_A', weight: 5, size: [3.0, 6.0], sink: 0.02, tint: true },
      { part: 'rock_single_D', weight: 4, size: [2.6, 5.2], sink: 0.03, tint: true },
      { part: 'rock_single_E', weight: 3, size: [2.4, 4.8], sink: 0.03, tint: true },
      { part: 'tree_single_A_cut', weight: 2, size: [1.5, 2.5], sink: 0.02, upright: true },
    ],
    /**
     * Dune: `drylands` with Kenney's cacti stood in it (`nature`, 2026-10-01). A recipe of its
     * own rather than a change to `drylands`, because Rust takes that one through the `arid`
     * biome and has nothing growing on it. The cacti carry about three fifths of the weight and
     * stand one and a half villagers to nearly three tall (1.9–3.75 units) before the far field:
     * at one to two they read as green specks from the rest camera.
     */
    dunes: [
      { part: 'cactus_tall', kit: N, weight: 12, size: [3.4, 5.0], sink: 0.02, upright: true },
      { part: 'cactus_short', kit: N, weight: 9, size: [3.6, 5.4], sink: 0.02, upright: true },
      { part: 'rock_single_A', weight: 5, size: [3.0, 6.0], sink: 0.02, tint: true },
      { part: 'rock_single_D', weight: 4, size: [2.6, 5.2], sink: 0.03, tint: true },
      { part: 'rock_single_E', weight: 3, size: [2.4, 4.8], sink: 0.03, tint: true },
      { part: 'tree_single_A_cut', weight: 2, size: [1.5, 2.5], sink: 0.02, upright: true },
    ],
    /**
     * Blossom: Kenney's five pink broadleaves (recoloured by `tools/build-nature.mjs`) with a
     * few of `meadow`'s trees, rocks and bales among them. The hexagon pack's spring repaint has
     * no pink in it, so without these the world was the forest in a lighter shade. Each tree is
     * sized per its authored height to stand 3 to 4 units, 1.2–1.5 times the forest's large
     * clusters, which is what lets it read as an orchard from the rest camera.
     */
    blossom: [
      { part: 'tree_default_sakura', kit: N, weight: 4, size: [1.8, 2.5], sink: 0.02, upright: true },
      { part: 'tree_detailed_sakura', kit: N, weight: 4, size: [2.3, 3.1], sink: 0.02, upright: true },
      { part: 'tree_oak_sakura', kit: N, weight: 3, size: [2.5, 3.3], sink: 0.02, upright: true },
      { part: 'tree_fat_sakura', kit: N, weight: 3, size: [2.6, 3.5], sink: 0.02, upright: true },
      { part: 'tree_small_sakura', kit: N, weight: 3, size: [2.4, 3.2], sink: 0.02, upright: true },
      { part: 'tree_single_A', weight: 3, size: [1.5, 2.2], sink: 0.02, upright: true },
      { part: 'tree_single_B', weight: 2, size: [1.5, 2.15], sink: 0.02, upright: true },
      { part: 'haybale', weight: 3, size: [4.0, 5.5], sink: 0.03, upright: true },
      { part: 'rock_single_B', weight: 2, size: [2.5, 4.5], sink: 0.04, tint: true },
    ],
    /**
     * Harvest: Kenney's fall trees over stubble — cut stumps, rocks and bales. The pack's fall
     * repaint browns its own trees, but they keep the forest's two shapes; the seven Kenney
     * shapes are what make it a different wood. Sized as `blossom`'s, per authored height.
     */
    harvest: [
      { part: 'tree_default_fall', kit: N, weight: 3, size: [1.8, 2.5], sink: 0.02, upright: true },
      { part: 'tree_detailed_fall', kit: N, weight: 3, size: [2.3, 3.1], sink: 0.02, upright: true },
      { part: 'tree_oak_fall', kit: N, weight: 3, size: [2.5, 3.3], sink: 0.02, upright: true },
      { part: 'tree_fat_fall', kit: N, weight: 2, size: [2.6, 3.5], sink: 0.02, upright: true },
      { part: 'tree_thin_fall', kit: N, weight: 2, size: [2.0, 2.8], sink: 0.02, upright: true },
      { part: 'tree_small_fall', kit: N, weight: 2, size: [2.4, 3.2], sink: 0.02, upright: true },
      { part: 'tree_tall_fall', kit: N, weight: 2, size: [1.8, 2.5], sink: 0.02, upright: true },
      { part: 'tree_single_A_cut', weight: 3, size: [1.5, 2.5], sink: 0.02, upright: true },
      { part: 'rock_single_B', weight: 2, size: [2.5, 4.5], sink: 0.04, tint: true },
      { part: 'haybale', weight: 2, size: [4.0, 5.5], sink: 0.03, upright: true },
    ],
    /**
     * Canopy: Kenney's jungle trees and big-leaf plants, with the forest's clusters thinned in
     * among them. The leaves stand 0.8–1.4 units, knee to shoulder on a villager, which is the
     * undergrowth the pack cannot plant; the trees are sized as `blossom`'s. The leaves are the
     * two `plant_flat*`: the kit's bushes and leaf grass are baked in Kenney's own teal, which
     * `build-nature` leaves alone and which reads as ice on the village's grass. Jungle keeps its
     * biome's doubled budget.
     */
    canopy: [
      { part: 'tree_fat_jungle', kit: N, weight: 3, size: [2.6, 3.5], sink: 0.02, upright: true },
      { part: 'tree_detailed_jungle', kit: N, weight: 3, size: [2.3, 3.1], sink: 0.02, upright: true },
      { part: 'tree_oak_jungle', kit: N, weight: 2, size: [2.5, 3.3], sink: 0.02, upright: true },
      { part: 'tree_plateau_jungle', kit: N, weight: 2, size: [2.4, 3.3], sink: 0.02, upright: true },
      { part: 'tree_blocks_jungle', kit: N, weight: 1, size: [2.5, 3.4], sink: 0.02, upright: true },
      { part: 'tree_tall_jungle', kit: N, weight: 2, size: [1.8, 2.5], sink: 0.02, upright: true },
      { part: 'plant_flatTall', kit: N, weight: 4, size: [2.8, 5.0], sink: 0.03, upright: true },
      { part: 'plant_flatShort', kit: N, weight: 4, size: [3.4, 6.0], sink: 0.03, upright: true },
      { part: 'trees_A_medium', weight: 2, size: [1.7, 2.45], sink: 0.02, upright: true },
      { part: 'trees_B_large', weight: 2, size: [1.9, 2.7], sink: 0.02, upright: true },
    ],
    /** Rock only — Cinder and Luna, where nothing has ever grown. */
    stone: [
      { part: 'rock_single_A', weight: 5, size: [3.0, 6.0], sink: 0.02, tint: true },
      { part: 'rock_single_B', weight: 3, size: [2.5, 4.5], sink: 0.04, tint: true },
      { part: 'rock_single_C', weight: 3, size: [2.2, 4.4], sink: 0.04, tint: true },
      { part: 'rock_single_D', weight: 4, size: [2.6, 5.2], sink: 0.03, tint: true },
      { part: 'rock_single_E', weight: 4, size: [2.4, 4.8], sink: 0.03, tint: true },
    ],
    /**
     * A ring of bare peaks in the world's own stone — `alpineWall`'s pieces at `alpineRim`'s
     * sizes, for the same reason that recipe gives: a rim is not grown by the far-field ×2.9,
     * and above about 2.8 the terraces separate. Tinted, unlike `alpineRim`'s peaks, because
     * these stand on sand, rust, ash and dust rather than on snow, and the pack's own paint on a
     * peak is a snowcap.
     */
    peaksRim: [
      { part: 'mountain_A', weight: 3, size: [1.9, 2.7], sink: 0.1, upright: true, tint: true },
      { part: 'mountain_B', weight: 2, size: [1.8, 2.6], sink: 0.1, upright: true, tint: true },
      { part: 'mountain_C', weight: 3, size: [1.9, 2.8], sink: 0.1, upright: true, tint: true },
      { part: 'rock_single_C', weight: 3, size: [2.4, 4.0], sink: 0.04, tint: true },
      { part: 'rock_single_E', weight: 2, size: [2.2, 3.8], sink: 0.04, tint: true },
    ],
  },

  /**
   * The three kits. `base` is everything a building recipe or the kerb clutter can name;
   * `forest` is everything the scatter plants; `decay` is what a ghost town grows over itself.
   * The first two are packed from the same source pack and both carry the same four seasonal
   * repaints of one atlas, so a setting can put a season on the whole village with one texture
   * upload.
   */
  kits: {
    base: {
      file: 'medieval.glb',
      atlas: { cols: 8, rows: 4 },
      atlases: { spring: 'hexagons_medieval', summer: 'hexagons_medieval_Summer', fall: 'hexagons_medieval_Fall', winter: 'hexagons_medieval_Winter' },
      /** The swatches worth naming. Verified against the built glb with `inspect-kit`. */
      cells: { STONE_LIGHT: 1, STONE: 2, STONE_DARK: 3, IRON: 4, WOOD: 5, WOOD_DARK: 6, HAY: 13, PLASTER: 14, GRASS: 16, FLAME: FLAME.cell, ROOF: 24 },
      pbr: {
        1: { roughness: 0.9, metalness: 0 },
        2: { roughness: 0.9, metalness: 0 },
        3: { roughness: 0.9, metalness: 0 },
        5: { roughness: 0.8, metalness: 0 },
        6: { roughness: 0.8, metalness: 0 },
        24: { roughness: 0.7, metalness: 0 },
        /**
         * The one cell in the village that burns, read from the same constant the torch's own
         * geometry is painted with (`torch.mjs`). Nothing else in either kit samples cell 26,
         * so this lights the torch flame and not one pixel more — which is the whole reason
         * the flame is painted from it rather than from a beige the buildings already use.
         *
         * `emissiveIntensity` is over 1 on purpose: the term is added straight to the
         * fragment's radiance, so anything at or below 1 is merely un-shadowed rather than
         * lit, and a flame has to read as brighter than the wall behind it at noon as well.
         */
        [FLAME.cell]: { roughness: 1, metalness: 0, emissive: FLAME.emissive, emissiveIntensity: FLAME.intensity },
      },
      /** Every blue building shares one roof swatch, which is what carries the repo's colour. */
      accentCells: ['ROOF'],
      /**
       * A quarter of the engine's default, because the accent cell here is a *roof* and the
       * light in this village is fire.
       *
       * The term is added straight to the fragment's radiance, so at the space theme's 1.15
       * a whole roof glows at full accent saturation the moment the sun goes down — three
       * repo colours' worth of flat neon lozenges floating over a dark valley, brighter than
       * the torches that are supposed to be lighting them. At 0.3 the roofs keep enough of
       * their colour to tell one zone from another after dark and read as tile catching the
       * firelight from the kerb below.
       */
      accentGlow: 0.3,
    },
    forest: {
      file: 'forest.glb',
      atlas: { cols: 8, rows: 4 },
      atlases: { spring: 'hexagons_medieval', summer: 'hexagons_medieval_Summer', fall: 'hexagons_medieval_Fall', winter: 'hexagons_medieval_Winter' },
      cells: {},
      pbr: {},
      accentCells: [],
    },
    /**
     * Kenney's Nature Kit, borrowed from the space theme's folder rather than packed twice
     * (1.2 MB). It carries the plants the hexagon pack has no shape for — palms, cacti, pink
     * and fall broadleaves, jungle trees — and only the six worlds that need them plant from it
     * (`dressing.worlds`, and `biomes.water` for the palms). Both the loader (`assetUrl`) and
     * `validate-kit` join this onto the theme's `assetDir`, so the `../` resolves in each.
     * Vertex-coloured, so no atlas swatches.
     */
    nature: { file: '../space/nature.glb', vertexColors: true, atlas: { cols: 8, rows: 4 }, cells: {}, pbr: {}, accentCells: [] },
    /**
     * The decay kit: the ruin, the emptied kerb props and the scrub a quiet repo grows.
     *
     * `lazy` is the whole point of it. A kit without the flag is fetched and harvested by
     * `loadKit()` at boot, and every geometry, material and texture three builds there spends
     * four draws of the seeded `Math.random` stream through `generateUUID` — which is the same
     * stream that seats the villagers under the snapshot harness. A village with no ghost in it
     * must therefore allocate nothing from this kit at all, so `loadKit()` skips it and
     * `loadLazyKit('decay')` fetches it the first time a zone actually starts to fade.
     *
     * It declares no `atlases` because it needs none: every model in it UVs into the same 8x4
     * grid the base kit is painted from, so its geometry is drawn with the base kit's shared
     * texture and follows the season swap without owning a sheet of its own.
     */
    decay: { file: 'decay.glb', lazy: true, atlas: { cols: 8, rows: 4 }, cells: {}, pbr: {}, accentCells: [] },
  },

  /**
   * The cast: eight bodies on one skeleton, one atlas. `mesh` is the prefix the packer gave a
   * body's skinned meshes, and `colourways` is how many columns of that atlas the body comes
   * in — four alt sheets per class, picked per thread by id hash, so a repo's villagers are a
   * crowd rather than eight identical twins. `rogue` and `rogue_hooded` are painted from one
   * sheet and therefore share their four colourways.
   *
   * `propNodes` are the static (unskinned) nodes the packer parked in the glb for the props
   * hook to hang off a bone — the seven hand tools, and the round shield every villager wears
   * on its back. They are named here so `validate-kit` can check they survived the pack — the
   * hook itself is code and cannot be read by the validator.
   */
  crew: {
    file: 'crew.glb',
    characters: [
      ['knight', 'body_knight'],
      ['engineer', 'body_engineer'],
      ['ranger', 'body_ranger'],
      ['barbarian', 'body_barbarian'],
      ['rogue', 'body_rogue'],
      // Packed as `hooded`: a character claims its meshes by name prefix, and `body_rogue_`
      // would otherwise claim the hooded rogue's meshes too.
      ['rogue_hooded', 'body_hooded'],
      ['mage', 'body_mage'],
      ['druid', 'body_druid'],
    ].map(([id, mesh]) => ({ id, mesh })),
    colourways: 4,
    propNodes: ['engineer_Wrench', 'axe_1handed', 'dagger', 'staff', 'druid_staff', 'hammer', 'shovel', 'shield_round', 'helmet'],
    clips: {
      idle: { name: 'Idle_A', loop: true },
      idleAlt: { name: 'Idle_B', loop: true },
      walk: { name: 'Walking_A', loop: true },
      run: { name: 'Running_A', loop: true },
      work: { name: 'Working_A', loop: true, strike: 0.5 },
      hammer: { name: 'Hammering', loop: true, strike: 0.34 },
      /**
       * One trade each: what a villager does with the tool in its hand.
       *
       * `strike` is where in the clip the tool lands, as a fraction — the frame the right
       * hand slot is lowest, measured off `crew.glb`. `Colony._emit` throws the wood chips
       * as the phase crosses it. `work` lifts its hand only a few centimetres over the whole
       * clip, so its minimum is noise and it is pinned to the halfway default instead.
       */
      chop: { name: 'Chopping', loop: true, strike: 0.35 },
      dig: { name: 'Digging', loop: true, strike: 0.31 },
      saw: { name: 'Sawing', loop: true, strike: 0.5 },
      pickaxe: { name: 'Pickaxing', loop: true, strike: 0.82 },
      lockpick: { name: 'Lockpicking', loop: true, strike: 0.43 },
      cast: { name: 'Ranged_Magic_Spellcasting', loop: true, strike: 0.5 },
      cheer: { name: 'Cheering', loop: true },
      jump: { name: 'Jump_Full_Short', loop: false },
      wave: { name: 'Waving', loop: true },
      sitDown: { name: 'Sit_Floor_Down', loop: false },
      sit: { name: 'Sit_Floor_Idle', loop: true },
      standUp: { name: 'Sit_Floor_StandUp', loop: false },
      /**
       * A nap. A villager waiting on you stretches out on the grass rather than sitting
       * cross-legged in the mud: `lieDown` is the one-shot `_animate` hands over from, and
       * `lie` is the loop it hands over to. `lieUp` is packed for the day something plays a
       * stand-up — nothing in the engine looks a stand-up clip up by key today, exactly as
       * `standUp` above has always been unused.
       */
      lieDown: { name: 'Lie_Down', loop: false },
      lie: { name: 'Lie_Idle', loop: true },
      lieUp: { name: 'Lie_StandUp', loop: false },
      hit: { name: 'Hit_A', loop: true },
      spawn: { name: 'Spawn_Ground', loop: false },
      interact: { name: 'Interact', loop: true },
    },
    /** The Adventurers rig carries a tool socket; KayKit authors every tool to sit at it. */
    attach: { head: 'head', chest: 'chest', hand: 'handslot.r' },
    dropMeshes: [],
    /**
     * How far above a villager's feet its name badge floats. Measured against the tallest of
     * the eight bodies — the Druid, whose horned head reaches 2.7545 model units — so no badge
     * is ever worn as a hat: 2.7545 × CREW_SCALE (0.56) puts the crown at 1.54 world units,
     * and the badge sits a little over an eighth of a unit clear of it.
     */
    headClearance: 1.67,
  },

  buildings: {
    scale: 2.6,
    /** No medieval recipe stacks a second storey on a deck, so there is no deck height. */
    deck: 0,
    /**
     * A village is built, not delivered. With this on, a part whose `stage` runs ahead of its
     * thread's own progress is not drawn, so a plot goes bare lot → building → dressed yard as
     * the transcript grows. The space theme omits the flag and every space building stays
     * whole from its first frame.
     */
    staged: true,
    /**
     * Which buildings suit which villager — the kinds a plot may be given once its thread's
     * body is drawn. Read each list as "somewhere this one would live or work": the smith
     * gets a forge, the mage a shrine, the ranger a lumbermill. `home` is in every list so a
     * village still reads as a village and not as a row of trade halls, and every one of the
     * fourteen kinds appears somewhere so no recipe falls out of the map.
     */
    byCharacter: {
      engineer: ['home', 'blacksmith', 'workshop', 'windmill'],
      ranger: ['home', 'lumbermill', 'stables'],
      barbarian: ['home', 'mine', 'lumbermill', 'watchtower'],
      knight: ['home', 'watchtower', 'stables', 'church'],
      rogue: ['home', 'tavern', 'market'],
      rogue_hooded: ['home', 'mine', 'tavern'],
      mage: ['home', 'shrine', 'church', 'watermill'],
      druid: ['home', 'shrine', 'well', 'watermill'],
    },
    /**
     * The fourteen kinds, in the order the pack authors them: a village reads as a village
     * because the same fourteen silhouettes keep turning up, not because every plot is unique.
     *
     * **Stages.** Every step's `stage` is a fraction of `transcriptProgress(thread)` — the
     * same log-scale number the HUD card's bar draws, so the card and the plot always agree.
     * The scale runs 0.05 at an empty transcript to 1 at 3 MB, passing 0.46 at 40 kB, 0.68 at
     * 240 kB and 0.94 at 2 MB. The ladder the recipes below use:
     *
     * - `0.2` the building body — the first thing a thread earns: under about 5 kB a plot is
     *   an empty lot with scaffolding on it, and past that a building on bare ground rather
     *   than a barrel with no house behind it.
     * - `0.35` / `0.5` the windmill's cap and its sails, `0.5` the watermill's wheel: the
     *   moving parts go on after the shell, the way a mill is actually finished.
     * - `0.55` yard dressing — barrels, crates, sacks, bales, buckets, troughs, the weapon
     *   rack, the barrow, resource piles and rocks.
     * - `0.6` planting: trees, and the church's fence.
     * - `0.7` torches. A village lights up only once it is a village.
     * - `0.9` the watchtower's pennant, the last thing anyone puts up.
     *
     * Dressing offsets are in *pack* units — the interpreter runs before `buildings.scale`
     * multiplies the merged geometry — and every one of them was measured against the
     * building's own bounds rather than guessed, so nothing stands inside a wall. The pack
     * authors small (a barrel is 0.2 across, a market hall 1.8), which is why an offset that
     * clears a home by a comfortable margin has to be half again as far for the market.
     */
    kinds: {
      home: {
        label: 'Home',
        parts: [
          { node: ['building_home_A_blue', 'building_home_B_blue'], stage: 0.2 },
          { if: 0.5, then: [{ node: ['barrel', 'crate_A_small'], x: 0.75, z: 0.55, ry: { rand: { base: 0, scale: 6.28 } }, stage: 0.55 }] },
          { if: 0.3, then: [{ node: 'tree_single_A', x: -0.95, z: -0.4, s: 0.8, stage: 0.6 }] },
        ],
      },
      tavern: {
        label: 'Tavern',
        parts: [
          { node: 'building_tavern_blue', stage: 0.2 },
          { node: 'barrel', x: 0.85, z: 0.4, ry: { rand: { base: 0, scale: 6.28 } }, stage: 0.55 },
          { node: 'barrel', x: 0.95, z: 0.6, ry: { rand: { base: 0, scale: 6.28 } }, stage: 0.55 },
          { if: 0.5, then: [{ node: 'haybale', x: -0.92, z: 0.6, ry: { rand: { base: 0, scale: 6.28 } }, stage: 0.55 }] },
          /**
           * A torch either side of the door. The tavern's front wall is at z 0.630 and its
           * sides at x -0.595 / 0.577, so z 0.95 stands both of them on the deck a third of a
           * module clear of the wall — the same margin the barrels beside them keep — and
           * x ±0.55 puts them inside the building's own width rather than out at its corners.
           *
           * Neither reaches the recipe's footprint: the second barrel already takes that to
           * |x| 1.051, so lighting the tavern does not widen the disc `colony.js` blocks
           * around it and the villagers walk exactly where they walked before.
           *
           * These two draw nothing from `rand` — every field is a plain number — so the
           * barrels and the haybale keep the draws, and the placements, they always had.
           */
          { node: 'torch', x: -0.55, z: 0.95, stage: 0.7 },
          { node: 'torch', x: 0.55, z: 0.95, stage: 0.7 },
        ],
      },
      blacksmith: {
        label: 'Blacksmith',
        parts: [
          { node: 'building_blacksmith_blue', stage: 0.2 },
          { node: 'crate_long_A', x: 0.98, z: 0.5, ry: 0.3, stage: 0.55 },
          { if: 0.5, then: [{ node: 'weaponrack', x: -0.88, z: 0.45, stage: 0.55 }] },
        ],
      },
      workshop: {
        label: 'Workshop',
        parts: [
          { node: 'building_workshop_blue', stage: 0.2 },
          { node: 'crate_A_big', x: 1.06, z: 0.55, ry: { rand: { base: 0, scale: 6.28 } }, stage: 0.55 },
          // Parked nose to the wall rather than side-on. A barrow is twice as long as it is
          // wide, and side-on it is the piece that decides the whole recipe's footprint.
          { if: 0.6, then: [{ node: 'wheelbarrow', x: -1.08, z: 0.5, ry: { jitter: 0.3, add: 0 }, stage: 0.55 }] },
        ],
      },
      lumbermill: {
        label: 'Lumber mill',
        parts: [
          { node: 'building_lumbermill_blue', stage: 0.2 },
          // A log pile is 0.69 long and 0.33 deep. Stacked square to the mill it would have to
          // stand a third of a plot clear of the wall; turned to lie along it, it tucks in.
          { node: 'resource_lumber', x: 0.93, z: 0.35, ry: 1.57, stage: 0.55 },
          { if: 0.6, then: [{ node: 'tree_single_A_cut', x: -0.9, z: 0.5, s: 0.9, stage: 0.6 }] },
        ],
      },
      windmill: {
        label: 'Windmill',
        /**
         * The one building in the pack that comes apart: the cap is a child of the tower and
         * the sails a child of the cap, so the whole thing arrives assembled unless each is
         * taken `solo` and put back on by hand. Doing that is what lets the sails turn — the
         * engine spins a *part*, about Z through its own hub, and sails welded to the tower
         * would take the mill round with them. The two offsets below are the pack's own node
         * translations summed into the tower's frame: the cap sits 0.6854 up, and the sails
         * 0.2717 above that and 0.3321 forward, on the cap's face.
         */
        parts: [
          { node: 'building_windmill_blue', solo: true, stage: 0.2 },
          { node: 'building_windmill_top_blue', solo: true, y: 0.6854, stage: 0.35 },
          // Slow, and jittered so two mills in the same village never fall into step.
          { node: 'building_windmill_top_fan_blue', y: 0.9571, z: 0.3321, spin: { rand: { base: 0.25, scale: 0.1 } }, stage: 0.5 },
          { node: 'sack', x: 0.75, z: 0.5, ry: { rand: { base: 0, scale: 6.28 } }, stage: 0.55 },
        ],
      },
      watermill: {
        label: 'Watermill',
        /**
         * The same trick, one storey shorter: the wheel is a child of the mill, taken off so
         * it can turn. `(0, 0.245, -0.055)` is its node translation in the pack — the hub sits
         * a little above the sill and set back into the wall, which is where a wheel hangs.
         */
        parts: [
          { node: 'building_watermill_blue', solo: true, stage: 0.2 },
          { node: 'building_watermill_wheel_blue', x: 0, y: 0.245, z: -0.055, spin: { rand: { base: 0.2, scale: 0.08 } }, stage: 0.5 },
          { node: 'bucket_water', x: -0.72, z: 0.6, stage: 0.55 },
        ],
      },
      market: {
        label: 'Market',
        parts: [
          { node: 'building_market_blue', stage: 0.2 },
          { node: 'crate_B_small', x: 1.08, z: 0.5, ry: { rand: { base: 0, scale: 6.28 } }, stage: 0.55 },
          { node: 'sack', x: -1.09, z: 0.55, stage: 0.55 },
        ],
      },
      well: {
        label: 'Well',
        parts: [
          { node: 'building_well_blue', stage: 0.2 },
          { node: 'bucket_empty', x: 0.52, z: 0.35, stage: 0.55 },
          { node: 'trough', x: -0.58, z: 0.4, ry: 1.2, stage: 0.55 },
        ],
      },
      church: {
        label: 'Church',
        parts: [
          { node: 'building_church_blue', stage: 0.2 },
          /**
           * The pack authors this fence a whole module to the *left* of its own origin, ready
           * to be laid along a hex edge, so its offset here is a module bigger than it looks.
           * Turned a quarter and pushed forward it becomes a rail across the churchyard — and
           * that is the placement that keeps the recipe navigable: `footprint` is the largest
           * |x| or |z| of the *merged* building, and `colony.js` blocks a nav disc of
           * `footprint * 0.8` around it, so a rail left standing off to one side at x 1.85
           * fences the villagers out of their own plot rather than out of the graveyard.
           */
          { node: 'fence_wood_straight', z: 1.75, ry: -1.57, stage: 0.6 },
          { if: 0.5, then: [{ node: 'tree_single_B', x: -0.88, z: 0.4, s: 0.8, stage: 0.6 }] },
        ],
      },
      shrine: {
        label: 'Shrine',
        parts: [
          { node: 'building_shrine_blue', stage: 0.2 },
          { node: 'rock_single_B', x: 0.78, z: 0.5, s: 0.6, stage: 0.55 },
          { node: 'tree_single_A', x: -0.9, z: 0.45, s: 0.8, stage: 0.6 },
        ],
      },
      stables: {
        label: 'Stables',
        parts: [
          { node: 'building_stables_blue', stage: 0.2 },
          // Square to the wall, not spun: the stables is the widest model in the pack and a
          // bale free to land end-on would push the recipe's footprint past its own plot.
          { node: 'haybale', x: 1.13, z: 0.45, ry: 1.57, stage: 0.55 },
          { node: 'trough_long', x: -1.05, z: 0.5, ry: 1.57, stage: 0.55 },
        ],
      },
      mine: {
        label: 'Mine',
        parts: [
          // At full size the mine is twice a home's footprint and towers over its row, so it
          // is cut to 0.7 and the yard pulled in to keep the same gap to its smaller walls.
          { node: 'building_mine_blue', s: 0.7, stage: 0.2 },
          { node: 'resource_stone', x: 0.84, z: 0.35, ry: 1.57, stage: 0.55 },
          { if: 0.5, then: [{ node: 'wheelbarrow', x: -0.81, z: 0.4, ry: { jitter: 0.3, add: 0 }, stage: 0.55 }] },
        ],
      },
      watchtower: {
        label: 'Watchtower',
        parts: [
          { node: 'building_watchtower_blue', stage: 0.2 },
          { node: 'crate_A_small', x: 0.72, z: 0.5, ry: { rand: { base: 0, scale: 6.28 } }, stage: 0.55 },
          // The tower caps out at 1.110; the pennant is planted on the cap, not floating over it.
          { node: 'flag_blue', x: 0, y: 1.11, z: 0, stage: 0.9 },
          /**
           * One torch at the tower door. The tower is a 1.044 square — every wall at 0.522 —
           * so z 0.72 leaves the stake 0.16 clear of the front wall, and x 0.5 sets it beside
           * the doorway rather than in the middle of it.
           *
           * z is 0.72 and not the 0.8 the plan sketched for one reason: the crate at x 0.72
           * already sets this recipe's footprint at 0.790, and 0.8 would have been the first
           * part to pass it. `footprint` is the radius `colony.js` blocks the crew out of, so
           * a torch eight hundredths further out would have moved every villager on the plot
           * to light one wall.
           */
          { node: 'torch', x: 0.5, z: 0.72, stage: 0.7 },
        ],
      },
    },
  },

  /**
   * Colony status → crew clip key. Locomotion (walk/run) and spawning win over status.
   *
   * `working` is the one state that reads differently per body: a villager plies its own
   * trade, and the tool in its hand is the one the clip swings. The `default` is there for a
   * body that has no trade of its own — every one of the eight names a clip today.
   */
  stateClips: {
    working: {
      default: 'work',
      byCharacter: {
        engineer: 'hammer',
        ranger: 'chop',
        barbarian: 'dig',
        knight: 'saw',
        rogue: 'lockpick',
        rogue_hooded: 'pickaxe',
        mage: 'cast',
        druid: 'cast',
      },
    },
    waiting: 'wave',
    blocked: 'hit',
    celebrating: 'cheer',
    sleeping: 'lie',
    sittingDown: 'lieDown',
    resting: 'sit',
    restingDown: 'sitDown',
    idle: 'idle',
    walk: 'walk',
    run: 'run',
    spawn: 'spawn',
  },

  /** Every measurement a plot is laid out against, and the props scattered along its kerb. */
  plots: {
    deckTop: 0.45,
    deckSkirt: 0.4,
    /**
     * How far the ground may climb across one lattice cell before a plot is refused it.
     *
     * The coast rule in `Colony._blockedCells` asks whether a slab would float; this asks
     * whether it would lie flat. A deck is a prism at a *fixed* height — its top face is
     * `deckTop` above y=0 wherever the cell is — so ground that moves under it shows as
     * daylight beneath the low rim or as turf coming up through the high one. That never
     * mattered while every setting's colony disc was near flat, and it matters now: `hills`
     * drives the far field of the mountain and the valley, and the ramp starts forty units
     * out, which is inside the lattice.
     *
     * **1.2, measured (2026-09-11) as the spread over a cell's seven samples, rings 0–12 at
     * the 7.6-unit cell.** It is chosen to be above every spread the colony disc itself reaches
     * and below the first real slope past it: rings 0–3 top out at 0.20 on the forest and 0.43
     * on the mountain, and ring 4 reaches 0.87 and 2.17. The valley's own spreads run to 4.98
     * from ring 2 out, but those are its bank and the coast rule has already refused them.
     *
     * **What each rule actually takes, by ring, on the settings as authored.** Setting `maxTilt`
     * also turns the skirt test on for the two dry settings, which is the larger half of what
     * follows — see `Colony._blockedCells`:
     *
     *              skirt, rings 0..5        tilt adds, rings 0..5      total
     *   forest     0 0 0 0 10 16  (247)     0 0 0 0  0  2   (80)        327
     *   valley     0 0 2 5  8 12  (180)     0 0 0 0  0  5  (157)        337
     *   mountain   0 0 0 1 13 20  (209)     0 0 0 0  2 10  (215)        424
     *
     * (Measured before the burial rule in `Colony._blockedCells` and the forest's `hills`
     * came down to 0.25, both 2026-09-27 — see the forest's note for its counts since.)
     *
     * So the tilt rule proper reaches inside ring 5 on one setting only — two cells of the
     * mountain's ring 4, where the ground has begun to climb towards the range. Everything it
     * takes on the forest and the valley is at ring 5 and beyond, out past the navigation
     * square, and nothing on any setting is taken inside ring 3. Thirty-six of the thirty-seven
     * cells within ring three stay dealable on the mountain and thirty on the valley, which is
     * more ground than any colony the fixture has ever needed.
     *
     * Lower was tried and rejected. The prism's own depth is 0.85 (`deckTop + deckSkirt`) and a
     * threshold there is the strictest defensible one, but it starts refusing ring-four cells
     * for tilts four hundred pixels from the camera that nothing can see. 1.2 is the spread a
     * deck can straddle without the slope showing.
     *
     * **It is not the whole guard, and it was never meant to be.** A cell that is evenly *low*
     * has no spread at all and still floats: the mountain's `3,1` sits at -1.30 with 0.90 of
     * daylight under one rim and a spread of 1.15, which passes this rule by five hundredths.
     * The skirt test is what catches it, and it is why `maxTilt` switches that on for dry
     * settings too rather than running alone.
     */
    maxTilt: 1.2,
    /**
     * Twelve repo colours: the kerb a zone is ringed in, and the dye its roofs are repainted
     * with. They have to stay apart from each other *and* from three very different decks —
     * the deck is the pack's grass swatch in whichever atlas the setting carries, so it is
     * summer green in the forest, autumn gold in the valley and winter white on the mountain.
     *
     * The first cut ran two hues twice: `0x3f6fb0`/`0x4f6fa8` were 5 CIELAB units apart (the
     * same blue, twice) and `0xa8452f`/`0xa83f3f` were 11, so two zones side by side were not
     * tellable. This set is twelve distinct hues in a muted dye register, no pair closer than
     * 24 and none within 34 of any deck. The greens are darker than any ground so a zone
     * still reads against the forest, and the golds are deeper than the valley's.
     */
    palette: [
      0xa8452f, 0xd07a24, 0x8a6a1c, 0x5f7a1f, 0x2f8f4a, 0x1f7f7a,
      0x2f7fb8, 0x3a4f9a, 0x7a3f9a, 0xb03f8a, 0xa02f4a, 0x8a8f9a,
    ],
    /**
     * The lattice cell the ceremony owns by default. Nothing else may be placed there.
     *
     * The forest and the mountain both leave it here, out on ring two, where the keep stands
     * on the cell itself with its front face and its threshold turned in toward the middle of
     * the village. A setting may override it — `settings[i].ceremony.cell` — which is how the
     * valley puts its dock down on the shore.
     *
     * How much ground the arrival blocks the crew out of, and how much scatter it clears, are
     * not here: every ceremony carries its own `clearance` and `apron`. Both keeps' are
     * derived in `src/themes/medieval/keep.js` from the style's own scales — the keep's depth
     * for the one, the outer tower's far edge for the other.
     */
    ceremonyCell: { q: -2, r: 1 },
    clutter: ['barrel', 'crate_A_small', 'crate_B_small', 'sack', 'haybale', 'bucket_water', 'torch'],
    clutterScale: 2.2,
    /**
     * The hand-authored torch — `src/themes/medieval/torch.mjs`, packed into `medieval.glb`
     * by the `generated` hook — is what lights the village after dark.
     *
     * 2.4 rather than the 2.2 everything else stands at: the torch is authored 0.56 pack
     * units tall against a barrel's 0.21, and 2.4 puts its flame at 1.34 world units, which
     * is a villager's eye level (they stand 1.4). It is thin with it — 0.09 pack units
     * across, so 0.22 world — and the kerb's nav radius is `spread * 0.86` under a floor of
     * 0.45, so a torch costs a walker no more room than a bucket does.
     */
    clutterLamp: 'torch',
    clutterLampScale: 2.4,
    /**
     * The engine's own procedural lamp posts, off here.
     *
     * `Plot._buildPosts` stands a grey pole with a glowing bead on one corner of every cell —
     * a streetlight, which is exactly right for a space colony and reads as a bare stick with
     * a bauble on it in a village. With a real torch on the kerb the village has its night
     * lighting already, so the posts are switched off rather than left to compete with it.
     * The flag defaults to on, so the space theme, which omits it, is untouched.
     */
    lampPosts: false,
  },

  /** Colours the theme owns outside the kit atlas: the default accent and the CSS tokens. */
  palette: {
    accent: 0xa8452f,
    /**
     * One tone. The body colour multiplies the crew atlas, and a villager is painted by that
     * sheet — so anything but white would tint the whole knight rather than a suit panel.
     */
    tones: [0xffffff],
    css: { '--accent': '#a8452f' },
  },

  /**
   * The theme's words. Every string here is one the HUD or a hint would otherwise hardcode.
   *
   * Two of them used to name the gate. They are ceremony-neutral now, because the arrival is
   * the setting's own choice: villagers come out of a castle in the woods and off a boat in
   * the valley, and a tooltip that says "through the gate" is wrong in two settings out of
   * three. `archiveHint` is the archive button's title (`hud.js`) and `intro` is the paragraph
   * under the help sheet's heading; nothing else reads either. `soundHint` and `effectsHint`
   * are the Sound group's two hints, and name the village's own sounds: no drones, no chime.
   */
  copy: {
    inhabitant: 'villager',
    inhabitants: 'villagers',
    shipped: 'Celebrating',
    empty: 'Nobody in the village',
    archiveHint: 'Archive — this villager leaves town (A)',
    nextHint: 'Next villager waiting on you (N)',
    intro:
      'Every coding-agent thread on this machine is a villager. They arrive in town, claim a plot for their repo, and build. Click one to open its thread; click a zone — its green or its name — for the repo itself, and start a new conversation there. Navigation works like Google Earth — drag the ground itself, right-drag to tilt, scroll to zoom in on whatever is under the cursor.',
    welcome: 'Drag to move · click a villager · H hides everything',
    fadeHint: 'Quiet — the villagers have gone home',
    hideHint: 'Hide this repo from the map, even when a thread wakes it',
    pinHint: 'Pin — this repo never fades',
    soundHint:
      'Each world’s own air, things calling out on their own clocks, and work you can hear where it is happening. Louder as you lean in.',
    effectsHint: 'Hammering, splashes, a lute when you call on a villager, a bell when somebody arrives or needs you.',
  },

  /** The ghost: a fully faded zone keeps a quarter of its pixels. */
  fade: { floor: 0.25 },

  /**
   * What the village's own four moments sound like, by registered name (`src/audio/sounds.js`),
   * read exactly as the space colony's table is. Wood, gut string and bronze; nothing here is a
   * machine, and the village's dressing has no drones to whine.
   *
   * - `select` — a villager's "yes?", one of four lute figures, never twice in a row;
   * - `attention` — somebody needs you: the hand bell, rung twice;
   * - `work` — the hammer at a villager working at its site, the same loop as the colony's;
   * - `arrival` — by the ceremony's `kind`. A keep rings its bell once when someone new walks
   *   out of it (an `event`, at most once every couple of seconds); the boat creaks at its
   *   mooring for as long as it is there (a `loop`).
   */
  sounds: {
    select: ['pluck-1', 'pluck-2', 'pluck-3', 'pluck-4'],
    attention: 'hand-bell',
    work: 'work-hammer',
    arrival: { castle: { event: 'keep-bell' }, fortress: { event: 'keep-bell' }, boat: { loop: 'hull-creak' } },
  },

  /**
   * What a quiet repo grows over itself as it goes, and where the dressing comes from
   * (2026-09-12, `feature/ghost-decay`).
   *
   * The block is optional and it is read against one number, the zone's `fade` — 0 for a
   * working repo, rising towards 1 as it is left alone. A theme that declares no `decay` gets
   * no dressing at all and its ghosts are exactly what they always were, which is what the
   * space colony and any third-party theme keep.
   *
   * - `kit` — which kit the node names below are looked up in. It is the lazy one, so nothing
   *   here costs a draw until a zone is actually fading.
   * - `scatter` — what grows across the deck: saplings and stumps that thicken with the fade,
   *   with a stone or two among them. Listed rather than weighted, because what reads as
   *   abandonment is the *count* going up, not the mix changing.
   * - `perCell` — how many of them a fully faded lattice cell may carry. The dressing ramps to
   *   it rather than arriving whole.
   * - `scale` — the size range an instance is drawn at, as a pair.
   * - `swap` — kerb props a ghost exchanges for their emptied twins: the crates stand open and
   *   the bucket is dry. **Every key must be a name in `plots.clutter`**, because the swap is
   *   applied while the kerb clutter is rebuilt and a key that is not placed there swaps
   *   nothing; the schema says so rather than leaving it to be noticed on screen.
   * - `ruin` — a recipe in the same vocabulary a building is written in, which is what a
   *   building is replaced by once it is far enough gone.
   * - `ruinAt` — how far gone that is. Past this fade the building is the ruin; below it the
   *   building stands and only the ground around it changes.
   */
  decay: {
    kit: 'decay',
    scatter: ['tree_single_A_cut', 'tree_single_B_cut', 'tree_single_A', 'tree_single_B', 'trees_A_small', 'rock_single_B'],
    scale: [1.2, 2.0],
    perCell: 8,
    swap: { crate_A_small: 'crate_open', crate_B_small: 'crate_open', bucket_water: 'bucket_empty' },
    /**
     * A house that fell down, rather than the one heap it used to be (2026-09-16, the medieval
     * art pass). Offsets are pack units, like every recipe's, and every field is a literal — so
     * this spends no draws, every ghost falls down the same way, and the footprint the
     * navigation grid reads is one number rather than a worst case.
     *
     * `building_destroyed` stays: its swatches are stone, dark stone and *plaster*, so it is a
     * collapsed house and not a boulder, and what made it read as one was its proportions — 1.94
     * times a house's width, no taller, and nothing standing up in it anywhere. At 0.85 it comes
     * in to 1.65 times the width and 0.90 of the height, which leaves room beside it.
     *
     * The frame is what it never had: a vertical edge. Turned 1.2 rad and stood at the front
     * corner so the two pieces do not read as one lump. Then two beams out of it and a spill of
     * three stones down one side rather than a ring around it — a ring reads as a cairn.
     *
     * Footprint 0.930 pack units — the beam at x -0.66, turned 2.3 rad, whose furthest vertex
     * lands at -0.930 — and height 0.833, against a `home` recipe's 0.851 and 0.930. Measured on
     * the geometry rather than on each part's rotated bounding box, which overstates a rounded
     * stack of logs by three hundredths and would have named the stone at x -0.78 instead.
     * `building_dirt` was considered as a scorch mark
     * under the heap and rejected: `footprintOf` takes the largest ground extent whatever its
     * height, so a wide flat slab would have the grid fence off ground a villager can walk
     * across without noticing it is there.
     */
    ruin: {
      parts: [
        { node: 'building_destroyed', x: -0.12, z: -0.08, s: 0.85 },
        { node: 'building_stage_C', x: 0.42, z: 0.26, ry: 1.2, s: 0.6 },
        { node: 'resource_lumber', x: 0.1, z: 0.62, ry: 0.5, s: 0.9 },
        { node: 'resource_lumber', x: -0.66, z: 0.34, ry: 2.3, s: 0.8 },
        { node: 'rock_single_B', x: 0.62, z: -0.42, s: 1.1 },
        { node: 'rock_single_B', x: -0.3, z: 0.7, ry: 0.9, s: 0.9 },
        { node: 'rock_single_B', x: -0.78, z: -0.34, ry: 2.1, s: 1.0 },
      ],
    },
    ruinAt: 0.7,
  },
}
