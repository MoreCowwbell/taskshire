/**
 * The space colony, as data. Nothing in here imports three: this file is read by the
 * validator under Node as well as by the app.
 */

import { resolveSettings } from '../../worlds/resolve.js'
import { WORLD_GROUPS } from '../../worlds/index.js'

/** Every world's drone flight — upstream's `fauna.drones`, shared so one number tunes them all. */
const DRONES = { count: 3 }
/** The Kenney nature kit, as a scatter entry names it. */
const N = 'nature'

/** The worlds this theme lists, in picker order: every world, group by group. */
const WORLDS = WORLD_GROUPS.flatMap((g) => g.worlds)

/**
 * What this theme plants on a world, and what it flies over it. Each world names its own scatter
 * recipe (below, under `scatter`), and the default carries what every world shares: the style
 * the recipes are planted in, and the drones.
 *
 * The default's `scatter` is for a world that names none, in its own entry or its biome's: today
 * the forest and the valley. The mountain takes `tundra` from `cold`.
 */
const DRESSING = {
  worlds: {
    moon: { scatter: 'rocks' },
    mars: { scatter: 'rocks' },
    terra: { scatter: 'flora' },
    beach: { scatter: 'beach' },
    ocean: { scatter: 'ocean' },
    jungle: { scatter: 'jungle' },
    desert: {
      scatter: 'desert',
      // Clay on the hull. The neutral structural swatches lean toward this, so the same kit
      // reads as adobe here without a second set of models — see `buildingTint` in buildings.js.
      buildingTint: 0xc9a176,
    },
    tundra: { scatter: 'tundra' },
    autumn: { scatter: 'autumn' },
    sakura: { scatter: 'sakura' },
    volcanic: { scatter: 'volcanic' },
    sky: { scatter: 'flora' },
    /*
     * The village's three worlds, which the colony can land on now (shared worlds, 2026-09-29).
     * They have the village's ground and its landforms — the mountain's two ridges, the valley's
     * sea and its hills opposite — so they take the colony's own planting and a rim of the kits'
     * pieces in the village's arrangement. Counts are the village's: the rim of each and the
     * ridges' crags, tuned there against the same rest frame. Sizes are the nature kit's, about
     * three times the forest pack's, and a rim is not grown by the far-field ×2.9, so they are
     * final. The lander keeps `plots.ceremonyCell` on all three.
     */
    forest: { rim: { recipe: 'forestRim', inner: 52, outer: 82, count: 1100 } },
    valley: { rim: { recipe: 'valleyRim', inner: 52, outer: 80, count: 520 }, ridges: [{ recipe: 'valleyHills', count: 3300 }] },
    mountain: {
      rim: { recipe: 'crags', inner: 52, outer: 82, count: 1100 },
      ridges: [
        { recipe: 'crags', count: 6400 },
        { recipe: 'crags', count: 3600 },
      ],
    },
  },
  /**
   * Snow pines on the cold worlds. Frost names `tundra` itself, so this reaches only the
   * mountain, and until peaks are drawn its rim and its two ridges plant rock.
   */
  biomes: { cold: { scatter: 'tundra' } },
  default: {
    scatter: 'flora',
    // Upstream's way of planting (`SCATTER_STYLE` in `src/world/setting.js`): a denser budget
    // leaning toward the colony, flora in groves, up to six throws per prop on a wet world, each
    // kit's parts used as they arrive under a material of its own, and every recipe but the
    // rocks planted as flora.
    budget: 2400,
    spread: 0.58,
    groves: true,
    retries: 6,
    kitFallback: 'filter',
    flora: { not: 'rocks' },
    drones: DRONES,
  },
}

export const manifest = {
  assetDir: 'assets/space',
  /**
   * The worlds, in the order the picker shows them (`WORLD_GROUPS`). Each is a world from the
   * library in `src/worlds/`; `settings` is those worlds wearing this theme's `dressing`,
   * resolved once here, so every consumer still reads a setting.
   *
   * The generator that reads them is `src/world/setting.js`, the same one every theme's worlds
   * run on — see its note on upstream's worlds for the one field, `water`, whose shape differs
   * from the medieval valley's.
   */
  worlds: WORLDS,
  /**
   * What a stored world this theme does not list opens on, and what the one-time settings
   * migration sends a world the old list could not show to. Home: the Moon has always been the
   * colony's first world, and no longer is in group order.
   */
  defaultWorld: 'moon',
  /**
   * The worlds the settings picker shows: upstream's twelve, on purpose. The fork is public, so
   * the colony offers the worlds it shipped with; our Forest, Valley and Mountain stay built
   * (`worlds`, `settings`) but unlisted here. A later upstream merge must not re-add them.
   */
  menu: ['moon', 'mars', 'terra', 'beach', 'ocean', 'jungle', 'desert', 'tundra', 'autumn', 'sakura', 'volcanic', 'sky'],
  dressing: DRESSING,
  settings: resolveSettings(WORLDS, DRESSING),
  /**
   * What grows on a world, and how it is planted.
   *
   * `weight` is how often a shape comes up relative to its siblings, `size` the range of
   * its base scale, and `sink` how far into the ground it settles as a fraction of that
   * scale. A boulder half-buried reads as bedrock; a tree buried by the same amount reads
   * as a mistake, so the two want very different numbers.
   *
   * All of it comes from KayKit's Forest Nature Pack, which is why the same list can dress
   * a meadow and a crater field: its boulders are painted neutral grey, so a per-instance
   * tint takes them to lunar dust or Martian rust without touching the atlas.
   */
  scatter: {
    flora: [
      { part: 'Tree_1_A_Color1', weight: 3, size: [0.35, 0.6], sink: 0.02, upright: true },
      { part: 'Tree_3_A_Color1', weight: 3, size: [0.35, 0.6], sink: 0.02, upright: true },
      { part: 'Tree_4_A_Color1', weight: 2, size: [0.3, 0.55], sink: 0.02, upright: true },
      { part: 'Tree_1_C_Color1', weight: 1, size: [0.25, 0.4], sink: 0.02, upright: true },
      { part: 'Tree_3_C_Color1', weight: 1, size: [0.22, 0.38], sink: 0.02, upright: true },
      { part: 'Tree_4_C_Color1', weight: 1, size: [0.2, 0.35], sink: 0.02, upright: true },
      { part: 'Bush_1_E_Color1', weight: 3, size: [0.5, 1.1], sink: 0.06, upright: true },
      { part: 'Bush_3_B_Color1', weight: 3, size: [0.5, 1.1], sink: 0.06, upright: true },
      { part: 'Grass_2_D_Color1', weight: 4, size: [0.6, 1.3], sink: 0.05, upright: true },
      { part: 'Rock_1_D_Color1', weight: 2, size: [0.4, 0.9], sink: 0.3, tint: true },
    ],
    rocks: [
      { part: 'Rock_1_D_Color1', weight: 4, size: [0.5, 1.2], sink: 0.3, tint: true },
      { part: 'Rock_2_C_Color1', weight: 4, size: [0.5, 1.2], sink: 0.3, tint: true },
      { part: 'Rock_3_E_Color1', weight: 3, size: [0.6, 1.4], sink: 0.15, tint: true },
      { part: 'Rock_1_J_Color1', weight: 1, size: [0.3, 0.7], sink: 0.25, tint: true },
      { part: 'Rock_2_G_Color1', weight: 1, size: [0.3, 0.7], sink: 0.25, tint: true },
      { part: 'Rock_3_L_Color1', weight: 2, size: [0.4, 0.9], sink: 0.12, tint: true },
      { part: 'Rock_3_Q_Color1', weight: 1, size: [0.25, 0.55], sink: 0.1, tint: true },
    ],
    // Upstream's worlds (2026-09-24). `kit` says which pack a part comes from — the Forest
    // pack by default, or Kenney's Nature Kit (`N`), which is authored about a third the size
    // and so wants about three times the scale. `zone` keeps a part to the ground it belongs
    // on: `shore` within the sand band, `water` standing in the shallows, anything else on
    // dry land clear of the water.
    desert: [
      { part: 'cactus_tall', kit: N, weight: 4, size: [1.4, 2.4], sink: 0.03, upright: true },
      { part: 'cactus_short', kit: N, weight: 3, size: [1.2, 2.0], sink: 0.03, upright: true },
      { part: 'plant_flatShort', kit: N, weight: 3, size: [1.6, 2.6], sink: 0.04, upright: true },
      { part: 'plant_flatTall', kit: N, weight: 2, size: [1.6, 2.6], sink: 0.04, upright: true },
      { part: 'rock_tallA', kit: N, weight: 2, size: [1.4, 3.0], sink: 0.1, tint: true },
      { part: 'rock_tallC', kit: N, weight: 2, size: [1.4, 2.6], sink: 0.1, tint: true },
      { part: 'stone_tallB', kit: N, weight: 1, size: [1.6, 3.2], sink: 0.12, tint: true },
      { part: 'stone_largeB', kit: N, weight: 2, size: [1.6, 3.2], sink: 0.2, tint: true },
      { part: 'statue_columnDamaged', kit: N, weight: 0.4, size: [1.8, 2.6], sink: 0.1, upright: true, tint: true },
      { part: 'statue_obelisk', kit: N, weight: 0.2, size: [2.0, 3.0], sink: 0.1, upright: true, tint: true },
      { part: 'Rock_1_D_Color1', weight: 3, size: [0.5, 1.3], sink: 0.3, tint: true },
      { part: 'Rock_3_E_Color1', weight: 2, size: [0.6, 1.4], sink: 0.15, tint: true },
    ],
    jungle: [
      { part: 'tree_fat_jungle', kit: N, weight: 3, size: [1.6, 2.6], sink: 0.03, upright: true },
      { part: 'tree_detailed_jungle', kit: N, weight: 3, size: [1.5, 2.5], sink: 0.03, upright: true },
      { part: 'tree_oak_jungle', kit: N, weight: 2, size: [1.5, 2.4], sink: 0.03, upright: true },
      { part: 'tree_plateau_jungle', kit: N, weight: 2, size: [1.5, 2.4], sink: 0.03, upright: true },
      { part: 'tree_tall_jungle', kit: N, weight: 2, size: [1.6, 2.6], sink: 0.03, upright: true },
      { part: 'tree_palmDetailedTall', kit: N, weight: 1, size: [1.4, 2.2], sink: 0.03, upright: true },
      { part: 'plant_bushLarge', kit: N, weight: 4, size: [1.6, 3.0], sink: 0.05, upright: true },
      { part: 'plant_bushDetailed', kit: N, weight: 3, size: [1.4, 2.4], sink: 0.05, upright: true },
      { part: 'grass_leafsLarge', kit: N, weight: 4, size: [1.6, 2.8], sink: 0.05, upright: true },
      { part: 'flower_redA', kit: N, weight: 1, size: [1.4, 2.0], sink: 0.05, upright: true },
      { part: 'flower_purpleA', kit: N, weight: 1, size: [1.4, 2.0], sink: 0.05, upright: true },
      { part: 'lily_large', kit: N, weight: 2, size: [1.6, 2.6], sink: 0, upright: true, zone: 'water' },
      { part: 'lily_small', kit: N, weight: 2, size: [1.6, 2.6], sink: 0, upright: true, zone: 'water' },
      { part: 'Rock_2_C_Color1', weight: 1, size: [0.5, 1.1], sink: 0.3, tint: true },
    ],
    beach: [
      { part: 'tree_palm', kit: N, weight: 3, size: [1.5, 2.3], sink: 0.03, upright: true, zone: 'shore' },
      { part: 'tree_palmBend', kit: N, weight: 3, size: [1.5, 2.3], sink: 0.03, upright: true, zone: 'shore' },
      { part: 'tree_palmDetailedTall', kit: N, weight: 2, size: [1.6, 2.4], sink: 0.03, upright: true, zone: 'shore' },
      { part: 'tree_palmShort', kit: N, weight: 2, size: [1.3, 2.0], sink: 0.03, upright: true, zone: 'shore' },
      { part: 'Tree_1_A_Color1', weight: 2, size: [0.35, 0.55], sink: 0.02, upright: true },
      { part: 'Tree_3_A_Color1', weight: 2, size: [0.35, 0.55], sink: 0.02, upright: true },
      { part: 'Bush_1_E_Color1', weight: 3, size: [0.5, 1.0], sink: 0.06, upright: true },
      { part: 'Grass_2_D_Color1', weight: 4, size: [0.6, 1.2], sink: 0.05, upright: true },
      { part: 'flower_yellowA', kit: N, weight: 2, size: [1.4, 2.0], sink: 0.05, upright: true },
      { part: 'rock_smallC', kit: N, weight: 2, size: [1.6, 3.0], sink: 0.2, tint: true, zone: 'shore' },
      { part: 'Rock_1_D_Color1', weight: 2, size: [0.4, 0.9], sink: 0.3, tint: true },
      { part: 'canoe', kit: N, weight: 0.3, size: [1.8, 2.2], sink: 0.05, upright: true, zone: 'shore' },
    ],
    ocean: [
      { part: 'tree_palm', kit: N, weight: 3, size: [1.5, 2.3], sink: 0.03, upright: true, zone: 'shore' },
      { part: 'tree_palmBend', kit: N, weight: 3, size: [1.5, 2.3], sink: 0.03, upright: true, zone: 'shore' },
      { part: 'tree_palmTall', kit: N, weight: 2, size: [1.6, 2.4], sink: 0.03, upright: true, zone: 'shore' },
      { part: 'tree_palmDetailedShort', kit: N, weight: 2, size: [1.3, 2.0], sink: 0.03, upright: true, zone: 'shore' },
      { part: 'tree_palmShort', kit: N, weight: 2, size: [1.3, 1.9], sink: 0.03, upright: true },
      { part: 'Tree_1_A_Color1', weight: 1, size: [0.6, 0.9], sink: 0.02, upright: true },
      { part: 'Bush_3_B_Color1', weight: 3, size: [0.5, 1.0], sink: 0.06, upright: true },
      { part: 'Grass_2_D_Color1', weight: 4, size: [0.6, 1.2], sink: 0.05, upright: true },
      { part: 'flower_yellowC', kit: N, weight: 2, size: [1.4, 2.0], sink: 0.05, upright: true },
      { part: 'rock_smallC', kit: N, weight: 2, size: [1.6, 3.0], sink: 0.2, tint: true, zone: 'shore' },
      { part: 'Rock_3_E_Color1', weight: 2, size: [0.5, 1.1], sink: 0.15, tint: true },
    ],
    tundra: [
      { part: 'tree_pineTallA_snow', kit: N, weight: 3, size: [1.5, 2.4], sink: 0.03, upright: true },
      { part: 'tree_pineTallB_snow', kit: N, weight: 2, size: [1.4, 2.2], sink: 0.03, upright: true },
      { part: 'tree_pineSmallA_snow', kit: N, weight: 3, size: [1.4, 2.2], sink: 0.03, upright: true },
      { part: 'tree_pineRoundA_snow', kit: N, weight: 2, size: [1.4, 2.2], sink: 0.03, upright: true },
      { part: 'tree_pineDefaultA_snow', kit: N, weight: 2, size: [1.5, 2.3], sink: 0.03, upright: true },
      { part: 'tree_pineSmallB', kit: N, weight: 1, size: [1.4, 2.0], sink: 0.03, upright: true },
      { part: 'log_stack', kit: N, weight: 0.5, size: [1.6, 2.2], sink: 0.05, upright: true },
      { part: 'stone_largeB', kit: N, weight: 2, size: [1.6, 3.0], sink: 0.25, tint: true },
      { part: 'Rock_1_D_Color1', weight: 3, size: [0.5, 1.2], sink: 0.35, tint: true },
      { part: 'Rock_2_C_Color1', weight: 2, size: [0.5, 1.2], sink: 0.35, tint: true },
    ],
    volcanic: [
      { part: 'tree_thin_dead', kit: N, weight: 2, size: [1.4, 2.2], sink: 0.03, upright: true },
      { part: 'tree_tall_dead', kit: N, weight: 1, size: [1.4, 2.2], sink: 0.03, upright: true },
      { part: 'tree_simple_dead', kit: N, weight: 1, size: [1.4, 2.0], sink: 0.03, upright: true },
      { part: 'rock_tallA', kit: N, weight: 3, size: [1.6, 3.4], sink: 0.1, tint: true },
      { part: 'stone_tallD', kit: N, weight: 2, size: [1.6, 3.0], sink: 0.12, tint: true },
      { part: 'Rock_1_D_Color1', weight: 4, size: [0.5, 1.3], sink: 0.3, tint: true },
      { part: 'Rock_2_C_Color1', weight: 4, size: [0.5, 1.3], sink: 0.3, tint: true },
      { part: 'Rock_3_E_Color1', weight: 3, size: [0.6, 1.5], sink: 0.15, tint: true },
      { part: 'Rock_3_L_Color1', weight: 2, size: [0.4, 0.9], sink: 0.12, tint: true },
    ],
    autumn: [
      { part: 'tree_default_fall', kit: N, weight: 3, size: [1.4, 2.2], sink: 0.03, upright: true },
      { part: 'tree_detailed_fall', kit: N, weight: 3, size: [1.5, 2.4], sink: 0.03, upright: true },
      { part: 'tree_oak_fall', kit: N, weight: 2, size: [1.5, 2.4], sink: 0.03, upright: true },
      { part: 'tree_fat_fall', kit: N, weight: 2, size: [1.5, 2.4], sink: 0.03, upright: true },
      { part: 'tree_thin_fall', kit: N, weight: 1, size: [1.4, 2.2], sink: 0.03, upright: true },
      { part: 'tree_tall_fall', kit: N, weight: 1, size: [1.4, 2.2], sink: 0.03, upright: true },
      { part: 'mushroom_redGroup', kit: N, weight: 2, size: [1.6, 2.6], sink: 0.02, upright: true },
      { part: 'mushroom_tanGroup', kit: N, weight: 2, size: [1.6, 2.6], sink: 0.02, upright: true },
      { part: 'log_large', kit: N, weight: 1, size: [1.4, 2.0], sink: 0.05, upright: true },
      { part: 'stump_square', kit: N, weight: 1, size: [1.4, 2.0], sink: 0.05, upright: true },
      { part: 'Grass_2_D_Color1', weight: 3, size: [0.6, 1.2], sink: 0.05, upright: true },
      { part: 'Rock_1_D_Color1', weight: 2, size: [0.4, 0.9], sink: 0.3, tint: true },
    ],
    sakura: [
      { part: 'tree_default_sakura', kit: N, weight: 3, size: [1.4, 2.2], sink: 0.03, upright: true },
      { part: 'tree_detailed_sakura', kit: N, weight: 3, size: [1.5, 2.4], sink: 0.03, upright: true },
      { part: 'tree_oak_sakura', kit: N, weight: 2, size: [1.5, 2.4], sink: 0.03, upright: true },
      { part: 'tree_fat_sakura', kit: N, weight: 2, size: [1.5, 2.4], sink: 0.03, upright: true },
      { part: 'tree_small_sakura', kit: N, weight: 2, size: [1.4, 2.0], sink: 0.03, upright: true },
      { part: 'Bush_1_E_Color1', weight: 2, size: [0.5, 1.0], sink: 0.06, upright: true },
      { part: 'Grass_2_D_Color1', weight: 4, size: [0.6, 1.2], sink: 0.05, upright: true },
      { part: 'flower_purpleC', kit: N, weight: 2, size: [1.4, 2.0], sink: 0.05, upright: true },
      { part: 'flower_yellowA', kit: N, weight: 1, size: [1.4, 2.0], sink: 0.05, upright: true },
      { part: 'lily_small', kit: N, weight: 2, size: [1.6, 2.6], sink: 0, upright: true, zone: 'water' },
      { part: 'Rock_2_C_Color1', weight: 1, size: [0.4, 0.9], sink: 0.3, tint: true },
    ],
    // The rims and ridges of the village's three worlds (see the dressing above).
    /** The wood round the forest's clearing: tall pines with a few of the pack's broadleaves. */
    forestRim: [
      { part: 'tree_pineTallA', kit: N, weight: 3, size: [3.6, 5.6], sink: 0.03, upright: true },
      { part: 'tree_pineTallB', kit: N, weight: 2, size: [3.4, 5.2], sink: 0.03, upright: true },
      { part: 'tree_pineDefaultA', kit: N, weight: 2, size: [3.4, 5.2], sink: 0.03, upright: true },
      { part: 'tree_pineRoundC', kit: N, weight: 1, size: [3.0, 4.6], sink: 0.03, upright: true },
      { part: 'Tree_4_A_Color1', weight: 3, size: [0.8, 1.4], sink: 0.02, upright: true },
      { part: 'Tree_1_A_Color1', weight: 2, size: [0.9, 1.5], sink: 0.02, upright: true },
    ],
    /** The valley's open country: long grass, flowers and bushes, a tree here and there. */
    valleyRim: [
      { part: 'grass_large', kit: N, weight: 4, size: [2.0, 3.2], sink: 0.03, upright: true },
      { part: 'grass_leafs', kit: N, weight: 3, size: [2.0, 3.0], sink: 0.03, upright: true },
      { part: 'flower_yellowA', kit: N, weight: 2, size: [2.0, 3.0], sink: 0.03, upright: true },
      { part: 'plant_bush', kit: N, weight: 2, size: [2.2, 3.4], sink: 0.04, upright: true },
      { part: 'Tree_1_C_Color1', weight: 1, size: [0.6, 1.0], sink: 0.02, upright: true },
    ],
    /** The wooded rise opposite the valley's sea. */
    valleyHills: [
      { part: 'Tree_3_A_Color1', weight: 3, size: [0.8, 1.3], sink: 0.02, upright: true },
      { part: 'Tree_4_A_Color1', weight: 3, size: [0.8, 1.3], sink: 0.02, upright: true },
      { part: 'tree_pineRoundA', kit: N, weight: 2, size: [3.0, 4.6], sink: 0.03, upright: true },
      { part: 'tree_pineSmallA', kit: N, weight: 2, size: [2.8, 4.2], sink: 0.03, upright: true },
      { part: 'Bush_3_B_Color1', weight: 2, size: [1.2, 2.2], sink: 0.06, upright: true },
    ],
    /** Tall rock, in the world's own stone: the mountain's rim and both its ridges. */
    crags: [
      { part: 'rock_tallA', kit: N, weight: 3, size: [3.0, 5.4], sink: 0.2, tint: true },
      { part: 'rock_tallC', kit: N, weight: 3, size: [3.0, 5.4], sink: 0.2, tint: true },
      { part: 'rock_tallF', kit: N, weight: 2, size: [2.8, 5.0], sink: 0.2, tint: true },
      { part: 'rock_largeA', kit: N, weight: 2, size: [3.0, 5.0], sink: 0.25, tint: true },
      { part: 'Rock_3_E_Color1', weight: 2, size: [1.4, 2.6], sink: 0.15, tint: true },
    ],
  },

  /**
   * The model kits. Each is one packed glb whose models all UV into a single gradient
   * atlas, so a *cell index* is a stable name for a material: `cells` names the swatches
   * worth referring to, `pbr` gives them a surface response, and `accentCells` lists the
   * ones a repo's colour repaints and that light up after dark.
   */
  kits: {
    /** Space Base Bits: every building, and the colony's hard surfaces. */
    base: {
      file: 'spacebase.glb',
      atlas: { cols: 8, rows: 4 },
      cells: { WHITE: 1, GREY: 2, SLATE: 3, BLACK: 4, ROCK: 7, TRIM: 11, RED: 12, SOLAR_A: 28, SOLAR_B: 29 },
      /**
       * Roughness / metalness per cell. Unlisted cells take Kay's own 0.6 / 0.
       *
       * Metalness is kept deliberately low almost everywhere. These are *painted* surfaces,
       * and a fully metallic one has no diffuse term at all — with only a soft sky to
       * reflect, the grey structural swatch is the largest surface in the pack and turns
       * black the moment it is treated as bare metal.
       */
      pbr: {
        1: { roughness: 0.55, metalness: 0.0 }, // painted hull panel
        2: { roughness: 0.46, metalness: 0.22 }, // structural frame — painted metal, not bare
        3: { roughness: 0.5, metalness: 0.3 },
        4: { roughness: 0.6, metalness: 0.18 },
        7: { roughness: 0.95, metalness: 0.0 }, // regolith and terrain chunks — never shiny
        11: { roughness: 0.42, metalness: 0.08 }, // painted trim, semi-gloss
        12: { roughness: 0.55, metalness: 0.04 },
        28: { roughness: 0.16, metalness: 0.7 }, // photovoltaic glass, and dark on purpose
        29: { roughness: 0.16, metalness: 0.7 },
      },
      /** The swatches the accent repaints and that light up after dark. */
      accentCells: ['TRIM'],
    },
    /** Forest Nature Pack: trees, bushes, grass, and the boulders on every world. */
    forest: {
      file: 'forest.glb',
      atlas: { cols: 8, rows: 4 },
      cells: {},
      pbr: {},
      accentCells: [],
    },
    /**
     * Kenney's Nature Kit (upstream, 2026-09-24): palms, cacti, pines, autumn canopies and
     * jungle understorey for the worlds the Forest pack cannot dress. Vertex-coloured rather
     * than atlased — see `tools/build-nature.mjs` — so its scatter material uses
     * `vertexColors` and it has no swatch to name. The atlas grid is the schema's default
     * and describes nothing here.
     */
    nature: {
      file: 'nature.glb',
      vertexColors: true,
      atlas: { cols: 8, rows: 4 },
      cells: {},
      pbr: {},
      accentCells: [],
    },
  },

  /**
   * The crew: one packed glb holding the body and every clip, plus the small amount the
   * engine has to know about it to bake an animation table out of it.
   */
  crew: {
    file: 'crew.glb',
    /**
     * Clip keys the engine plays → the clip's name in the glb. `loop: false` means a
     * one-shot that holds on its last frame, which is what a sit-down or a spawn wants.
     *
     * `strike` is where in a work clip the tool lands, as a fraction of the clip — the frame
     * the right hand is lowest, measured off `crew.glb`. `Colony._emit` throws the work
     * effect as the clip's phase crosses it, once per loop. Optional; the default is 0.5.
     */
    clips: {
      idle: { name: 'Idle_A', loop: true },
      idleAlt: { name: 'Idle_B', loop: true },
      walk: { name: 'Walking_A', loop: true },
      run: { name: 'Running_A', loop: true },
      work: { name: 'Hammering', loop: true, strike: 0.34, tweak: 'work' },
      workAlt: { name: 'Working_A', loop: true, strike: 0.5 },
      cheer: { name: 'Cheering', loop: true },
      jump: { name: 'Jump_Full_Short', loop: false },
      wave: { name: 'Waving', loop: true },
      sitDown: { name: 'Sit_Floor_Down', loop: false },
      sit: { name: 'Sit_Floor_Idle', loop: true },
      standUp: { name: 'Sit_Floor_StandUp', loop: false },
      hit: { name: 'Hit_A', loop: true },
      spawn: { name: 'Spawn_Ground', loop: false },
      interact: { name: 'Interact', loop: true },
      // Upstream's phone check (559ad85): the idle, with the left arm brought up to hold
      // something in front of the visor. Raised over a short one-shot, held on a loop,
      // lowered over another. `frames` cuts the source clip, `tweak` names a table below.
      phoneUp: { name: 'Idle_A', loop: false, tweak: 'phoneUp', frames: [0, 15] },
      phone: { name: 'Idle_A', loop: true, tweak: 'phone' },
      phoneDown: { name: 'Idle_A', loop: false, tweak: 'phoneDown', frames: [0, 15] },
    },
    /**
     * Adjustments made to KayKit's clips before they are baked, per clip, per bone (upstream
     * 259f434): `scale` multiplies how far the bone strays from its reference keyframe (`ref:
     * 'far'` is the one farthest from the first — for a swing, the struck pose), `offset`
     * turns it by a fixed Euler on top of the clip, and `ramp` fades that offset in over so
     * many seconds, or out with a negative ramp. `work` moves the hammer swing from the wrist
     * up to the shoulder; the phone rows were found by a small search for a hand in front of
     * the visor. A clip names its row with `tweak`.
     */
    tweaks: {
      work: {
        'hand.r': { scale: 0.45, ref: 'far' },
        'upperarm.r': { scale: 1.6 },
        'lowerarm.r': { scale: 1.35 },
      },
      phone: {
        'upperarm.l': { offset: [3.09, 0.53, -0.96] },
        'lowerarm.l': { offset: [-0.54, 0.89, 0.92] },
      },
      phoneUp: {
        'upperarm.l': { offset: [3.09, 0.53, -0.96], ramp: 0.45 },
        'lowerarm.l': { offset: [-0.54, 0.89, 0.92], ramp: 0.45 },
      },
      phoneDown: {
        'upperarm.l': { offset: [3.09, 0.53, -0.96], ramp: -0.45 },
        'lowerarm.l': { offset: [-0.54, 0.89, 0.92], ramp: -0.45 },
      },
    },
    /**
     * Bones worn parts hang off, by role. The role is what the engine asks for — a helmet
     * wants "the head", not a bone path — so a theme rigged differently only has to name
     * its own bones here. Matched loosely: `hand.r` and `handr` both work, because three's
     * loader sanitises a dot out of a node name on the way in.
     */
    attach: { head: 'head', chest: 'chest', hand: 'hand.r', handL: 'hand.l' },
    /** Meshes left out of the body — the mannequin's head is replaced by the helmet. */
    dropMeshes: ['Mannequin_Medium_Head'],
    /**
     * Where a badge's bottom edge sits above the feet, in **world** units — the engine adds
     * it straight to the agent's ground position, so a rig measurement is multiplied by the
     * crew scale first. This one is a shade above the helmet's crown.
     */
    headClearance: 1.42,
  },

  /**
   * The building catalogue, as recipes. Each kind is a label and a list of steps that
   * `src/world/recipes.js` walks with the thread's seeded RNG; the steps draw in the order
   * the ten hand-written generators drew in, which is why a session keeps the same colony
   * across this change. The silhouettes stay deliberately varied — dome, mast, slab,
   * derrick — so a plot full of them reads as a town rather than a row of the same shed.
   */
  buildings: {
    /**
     * Every structure is authored on the pack's 2-unit module grid and scaled once, here.
     *
     * The number is set against the crew, not the plot: an astronaut is about 1.1 units
     * tall, and a habitat you can see over is not a habitat. At 1.45 a base module clears
     * the crew's heads and a mast is three of them, while the widest footprint still leaves
     * a walkable gap at the plot's 4.4-unit slot spacing.
     */
    scale: 1.45,
    /** The top face of a base module — where roof modules and masts stack. */
    deck: 1.0,
    kinds: {
      habitat: {
        label: 'Habitat',
        parts: [
          { node: ['basemodule_A', 'basemodule_B', 'basemodule_C', 'basemodule_D'] },
          { node: ['roofmodule_base', 'roofmodule_cargo_A', 'roofmodule_cargo_B'], y: 'deck' },
          { if: 0.45, then: [{ node: 'lights', x: 1.15, z: 0.85, s: 0.85, ry: { rand: { base: 0, scale: 6.28 } } }] },
          { if: 0.6, then: [{ node: 'containers_A', x: -1.15, z: 0.9, ry: { rand: { base: 0, scale: 6.28 } } }] },
        ],
      },
      solar: {
        label: 'Solar array',
        parts: [
          { let: 'cols', randInt: [2, 2] },
          { let: 'rows', randInt: [2, 2] },
          // A whole field tilted the same way is what makes an array read as an array.
          { grid: { node: 'solarpanel', cols: 'cols', rows: 'rows', dx: 1.05, dz: 0.62, ry: { jitter: 0.06 } } },
          { node: 'lights', x: { var: 'cols', mul: 0.6 }, z: { var: 'rows', mul: -0.4 }, s: 0.8 },
          { node: 'containers_B', x: { var: 'cols', mul: -0.6 }, z: { var: 'rows', mul: 0.35 }, ry: 0.4 },
        ],
      },
      antenna: {
        label: 'Relay mast',
        parts: [
          // The tall turbine mast — the only silhouette in the pack that breaks the skyline.
          // The tower is taken *solo* so the rotor can be put back on as a part that turns.
          { if: 0.3, then: [{ let: 'tower', value: 'windturbine_tall' }, { let: 'hub', value: 2.05 }], else: [{ let: 'tower', value: 'windturbine_low' }, { let: 'hub', value: 0.89 }] },
          { node: { var: 'tower' }, solo: true },
          // Slow: a turbine that whips round reads as a desk fan. A little over half a
          // minute a turn, jittered so a row of them never falls into step.
          { node: { var: 'tower', suffix: '_fan' }, y: { var: 'hub' }, spin: { rand: { base: 0.17, scale: 0.09 } } },
          { node: 'containers_C', x: 0.9, z: 0.75, ry: { rand: { base: 0, scale: 6.28 } } },
          { if: 0.5, then: [{ node: 'lights', x: -0.95, z: -0.7, s: 0.8 }] },
        ],
      },
      silo: {
        label: 'Storage',
        parts: [
          { node: ['cargodepot_A', 'cargodepot_B', 'cargodepot_C'] },
          { if: 0.5, then: [{ node: ['cargo_A_stacked', 'cargo_B_stacked'], x: 1.35, z: 0.4, ry: { rand: { base: 0, scale: 6.28 } } }] },
        ],
      },
      greenhouse: {
        label: 'Greenhouse',
        parts: [
          // The geodesic-topped module — the pack's own biodome.
          { node: 'basemodule_E' },
          // The count is drawn before the ring loop, as `c.ring(…, 2 + floor(rand() * 2), …)` did.
          { let: 'n', randInt: [2, 2] },
          { ring: { node: 'containers_D', count: { var: 'n' }, radius: 1.45 } },
        ],
      },
      reactor: {
        label: 'Reactor',
        parts: [
          { node: 'drill_structure' },
          { ring: { node: 'cargo_A', count: 3, radius: 1.35 } },
          { if: 0.5, then: [{ node: 'lights', x: -1.2, z: 1.0, s: 0.9 }] },
        ],
      },
      tower: {
        label: 'Tower',
        parts: [
          { node: 'structure_tall' },
          { node: 'lights', y: 2.0, s: 0.7 },
          { if: 0.5, then: [{ node: 'containers_A', x: 1.15, z: 0.95, ry: { rand: { base: 0, scale: 6.28 } } }] },
        ],
      },
      workshop: {
        label: 'Workshop',
        parts: [
          { node: 'basemodule_garage' },
          { node: 'roofmodule_solarpanels', y: 'deck' },
          // Something parked outside: an empty forecourt reads as unfinished.
          { if: 0.3, then: [{ node: ['spacetruck', 'spacetruck_large'], x: 1.55, z: 0.3, ry: { jitter: 0.5, add: Math.PI / 2 } }] },
          { if: 0.5, then: [{ node: 'spacetruck_trailer', x: 1.55, z: 1.35, ry: Math.PI / 2 }] },
        ],
      },
      pad: {
        label: 'Landing pad',
        parts: [
          { if: 0.35, then: [{ node: 'landingpad_large' }], else: [{ node: 'landingpad_small' }] },
          { if: 0.4, then: [{ node: ['lander_A', 'lander_B'], y: 0.5, ry: { rand: { base: 0, scale: 6.28 } } }], else: [{ node: 'lander_base', y: 0.5, ry: { rand: { base: 0, scale: 6.28 } } }] },
        ],
      },
      lab: {
        label: 'Lab',
        parts: [
          { node: ['basemodule_C', 'basemodule_A'] },
          { node: 'roofmodule_cargo_C', y: 'deck' },
          { ring: { node: ['containers_B', 'containers_C'], count: 2, radius: 1.4 } },
        ],
      },
    },
  },

  /** Colony status → crew clip key. Locomotion (walk/run) and spawning win over status. */
  stateClips: {
    working: 'work',
    waiting: 'wave',
    blocked: 'hit',
    celebrating: 'cheer',
    sleeping: 'sit',
    sittingDown: 'sitDown',
    resting: 'sit',
    restingDown: 'sitDown',
    idle: 'idle',
    walk: 'walk',
    run: 'run',
    spawn: 'spawn',
  },

  /** Every measurement a plot is laid out against, and the props scattered along its kerb. */
  plots: {
    /** Top face of a plot's tile slab; everything on a plot is measured from here. */
    deckTop: 0.45,
    /** How far the slab's underside reaches below y=0. */
    deckSkirt: 0.4,
    /** A stable colour per repo, probed forward on collision. */
    palette: [
      0xc96442, 0x4f9a63, 0x4f7ec9, 0xb8942a, 0x8b5cc9, 0xc94f8b,
      0x3fa8a0, 0xc97f4f, 0x6f8f4f, 0x5c7fc9, 0xc95c5c, 0x7f6fc9,
    ],
    /** The lattice cell the ceremony (the ship) owns. Nothing else may be placed there. */
    ceremonyCell: { q: -2, r: 1 },
    /** Navigation radius blocked around the ceremony, and the scatter apron kept clear. */
    ceremonyClearance: 3.4,
    ceremonyApron: 7.5,
    /**
     * Kit props scattered along the kerb, and their scale. The floodlight is already a head
     * taller than a crate, so it gets a scale of its own: `clutterLamp` names it and
     * `clutterLampScale` is what it is scaled by.
     */
    clutter: ['containers_A', 'containers_B', 'containers_C', 'containers_D', 'cargo_A', 'cargo_B', 'cargo_A_packed', 'cargo_B_packed', 'lights'],
    clutterScale: 1.35,
    clutterLamp: 'lights',
    clutterLampScale: 1.1,
    /**
     * Upstream's yard: each kerb prop reserves its whole footprint and a walking gap, and one
     * that has no room is left out. His buildings are fitted inside `BUILDING_RADIUS` to match.
     */
    yard: 'reserved',
  },

  /** Colours the theme owns outside the kit atlas: the default accent, suit tones, CSS tokens. */
  palette: {
    /** Default building accent before a plot assigns one. */
    accent: 0xc96442,
    /** Suit tones, picked per thread by id hash. */
    tones: [0xf3f1ec, 0xe8e4dc, 0xf7f4ee, 0xdfe4e8, 0xf1e9df],
    /** Applied to `:root` at boot. Same values `styles.css` ships, so the space theme is a no-op. */
    css: { '--accent': '#c96442' },
  },

  /** The theme's words. Every string here is one the HUD or a hint would otherwise hardcode. */
  copy: {
    inhabitant: 'astronaut',
    inhabitants: 'crew',
    shipped: 'Shipped',
    empty: 'No crew on the surface',
    archiveHint: 'Archive — this astronaut walks back to the ship (A)',
    nextHint: 'Next astronaut waiting on you (N)',
    intro:
      'Every coding-agent thread on this machine is an astronaut. They walk out of the ship, claim a plot for their repo, and build. Click one to open its thread; click a zone — its deck or its name — for the repo itself, and start a new conversation there. Navigation works like Google Earth — drag the ground itself, right-drag to tilt, scroll to zoom in on whatever is under the cursor.',
    welcome: 'Drag to move · click an astronaut · H hides everything',
    fadeHint: 'Quiet — the crew has gone back to the ship',
    hideHint: 'Hide this repo from the map, even when a thread wakes it',
    pinHint: 'Pin — this repo never fades',
    soundHint:
      'A bed for each world, things calling out on their own clocks, and work you can hear where it is happening. Louder as you lean in.',
    effectsHint: 'Hammering, drones, splashes, the chime when somebody needs you.',
  },

  /** The ghost: a fully faded zone keeps a quarter of its pixels. */
  fade: { floor: 0.25 },

  /**
   * What the colony's own four moments sound like, by registered name (`src/audio/sounds.js`).
   * These are the names the colony always played, written down rather than spelled at the call
   * sites — the same names, in the same order, so the click picks the same phrase for the same
   * draw.
   *
   * - `select` — an astronaut answering a click, one of these, never twice in a row (events);
   * - `attention` — a thread that has just put its hand up (an event);
   * - `work` — the loop at an astronaut working at its site;
   * - `arrival` — by the ceremony's `kind`: a `loop` stands at the arrival for as long as it
   *   does, an `event` plays once when a new thread walks out. The lander hums.
   */
  sounds: {
    select: ['select-1', 'select-2', 'select-3', 'select-4', 'select-5', 'select-6'],
    attention: 'chime-attention',
    work: 'work-hammer',
    arrival: { ship: { loop: 'ship-hum' } },
  },
}
