/**
 * What `tools/build-assets.mjs` packs for the medieval village.
 *
 * Every `src` is relative to `ASSETS_SRC` — the directory the raw KayKit packs are unzipped
 * into, which lives outside the repo and is never committed. All three packs unzip into a
 * folder of their own name inside the archive, which is why each constant below is doubled.
 *
 * The village is two kits and a cast. `medieval.glb` is everything a *building recipe*, the
 * kerb clutter or the ceremony can name — the engine only ever looks recipes up in the kit
 * called `base` — and `forest.glb` is everything the ground scatter plants. A model needed by both (a felled tree
 * stands in a lumber yard *and* in the woods) is simply listed twice: they are separate
 * atlased documents and a geometry can only carry one material.
 *
 * Both kits embed the pack's four seasonal repaints as extra textures. Nothing in either
 * scene references them; `kit.js` pulls them off the parser by name and swaps a season by
 * replacing the shared atlas texture's image.
 */
const HEX = 'KayKit_Medieval_Hexagon_Pack_1.0_SOURCE/KayKit_Medieval_Hexagon_Pack_1.0_SOURCE'
const ADV = 'KayKit_Adventurers_2.0_SOURCE/KayKit_Adventurers_2.0_SOURCE'
const ANIM = 'KayKit_Character_Animations_1.1/KayKit_Character_Animations_1.1'

/** The blue faction's buildings — the roof swatch every one of them shares is the accent cell. */
const BUILDINGS = [
  'building_home_A', 'building_home_B', 'building_tavern', 'building_blacksmith', 'building_workshop',
  'building_lumbermill', 'building_windmill', 'building_watermill', 'building_market', 'building_well',
  'building_church', 'building_shrine', 'building_stables', 'building_mine', 'building_watchtower',
].map((n) => `${n}_blue`)

/** Unpainted structures: the town wall the castle is built from, fences, scaffolding. */
const NEUTRAL = ['wall_straight_gate', 'wall_corner_A_outside', 'wall_straight', 'fence_wood_straight', 'fence_stone_straight', 'building_scaffolding']

/**
 * What the *ceremony* is built from — the arrival every villager comes through.
 *
 * Listed apart from the buildings because no recipe may name any of it: these are the two
 * keeps with their towers and banners, and the dock, ship and rowing boat the valley's
 * arrival is made of. They are packed into the base kit all the same, because a ceremony is
 * assembled out of `part()` exactly like a building is.
 *
 * Three groups. The forest's `castle` is green on green with the round `B` towers; the
 * mountain's `fortress` is blue on snow with cannon towers on plinths; the valley's harbour
 * is a blue-trimmed pier and a neutral ship. `building_tower_A_blue` is no longer built by
 * anything and stays all the same — `tests/kit.test.mjs` and the old wall run reference it and
 * a node costs a few kilobytes.
 *
 * The dock stays blue under a neutral ship, which is where it started. `building_docks_red`
 * was packed alongside it once and the shot settled it: at the range the valley is seen from,
 * the pier reads as bare timber and its blue trim is two or three pixels of gunwale, so there
 * was never a clash to fix — and the pier keeps its blue because it is the *village's* colour,
 * which every building in the fixture wears.
 *
 * `ship_blue_full` went with the blue ship and `ship_red_full` has now gone the same way:
 * `units/neutral/ship` is the same hull in the pack's own mixed trim — wood and canvas, with
 * one pennant each in the faction blue (cell 24), the red ship's paint (25) and the torch's
 * flame (26), which is 36 triangles of masthead that glow after dark and are meant to.
 * `wall_corner_A_inside` is deliberately absent, as it always was — nothing turns a corner any
 * more, and the outside corner already in `NEUTRAL` is the only hand the old wall run ever
 * needed.
 */
const CEREMONY = [
  'building_castle_green', 'building_tower_B_green', 'banner_green_full',
  'building_castle_blue', 'building_tower_cannon_blue', 'building_tower_base_blue', 'banner_blue_full',
  'building_tower_A_blue',
  'building_docks_blue', 'ship', 'boat',
]

/** Yard dressing: what a recipe stands next to a building and what the kerb clutter draws from. */
const PROPS = [
  'barrel', 'crate_A_big', 'crate_A_small', 'crate_B_big', 'crate_B_small', 'crate_long_A', 'sack', 'haybale',
  'bucket_empty', 'bucket_water', 'wheelbarrow', 'trough', 'trough_long', 'pallet', 'resource_lumber',
  'resource_stone', 'weaponrack', 'flag_blue',
]

const TILES = ['hex_grass']

/**
 * Nature a *building recipe* stands next to a wall: the felled trunk in the lumber yard, the
 * pair of trees a home and a church keep, the boulder at the shrine. Each of these is planted
 * by the ground scatter as well, so it is listed in `NATURE` too — the two kits are separate
 * atlased documents and a geometry can only carry one material, so a shared model is packed
 * once into each rather than shared between them.
 */
const BASE_NATURE = ['tree_single_A_cut', 'tree_single_A', 'tree_single_B', 'rock_single_B']

/** What the ground scatter plants. */
const NATURE = [
  'tree_single_A', 'tree_single_B', 'tree_single_A_cut', 'trees_A_small', 'trees_A_medium', 'trees_A_large', 'trees_B_medium', 'trees_B_large',
  'hill_single_A', 'hill_single_B', 'hill_single_C', 'hills_A', 'hills_B', 'hills_C', 'hills_A_trees', 'hills_B_trees', 'hills_C_trees',
  'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E',
  'mountain_A', 'mountain_B', 'mountain_C', 'mountain_A_grass', 'mountain_B_grass', 'mountain_C_grass', 'mountain_A_grass_trees', 'haybale',
]

/**
 * What a ghost town grows over itself: the ruin a building is replaced by, the kerb crates
 * standing open and empty, and the saplings, stumps and stones that thicken across the yard
 * as a repo goes quiet (2026-09-12, `feature/ghost-decay`).
 *
 * Six of the ten are already packed into `medieval.glb` or `forest.glb`, and that is fine —
 * each kit is its own atlased document and a geometry carries one material, so a shared
 * model is packed once into each rather than shared between them, exactly as `BASE_NATURE`
 * already is.
 *
 * `building_stage_C` and `resource_lumber` are the ruin's own: the pack's last construction
 * stage is a bare timber frame on stone footings, which is also what a house leaves behind when
 * its walls go, and the log pile is the beams out of it. Both are already in `medieval.glb` —
 * the frame has never been built by anything and the logs stand in the lumber yard — and both
 * have to be packed *again* here, because each kit is its own atlased document and a geometry
 * carries one material. That is the same duplication `BASE_NATURE` carries and the same one six
 * of the names below already carry.
 */
const DECAY = [
  'building_destroyed', 'building_stage_C', 'resource_lumber',
  'crate_open', 'crate_long_empty', 'bucket_empty',
  'tree_single_A_cut', 'tree_single_B_cut', 'tree_single_A', 'tree_single_B', 'trees_A_small', 'rock_single_B',
]

/** The pack's four repaints of one 8x4 atlas. Named by file stem, which is how a manifest matches them. */
const ATLASES = {
  spring: `${HEX}/Assets/gltf/tiles/base/hexagons_medieval.png`,
  summer: `${HEX}/Assets/gltf/tiles/base/hexagons_medieval_Summer.png`,
  fall: `${HEX}/Assets/gltf/tiles/base/hexagons_medieval_Fall.png`,
  winter: `${HEX}/Assets/gltf/tiles/base/hexagons_medieval_Winter.png`,
}

export default {
  kits: [
    {
      src: `${HEX}/Assets/gltf`,
      subdirs: true,
      out: 'public/assets/medieval/medieval.glb',
      models: [...BUILDINGS, ...NEUTRAL, ...CEREMONY, ...PROPS, ...TILES, ...BASE_NATURE],
      atlases: ATLASES,
      /**
       * The pack has no light source in it, so the village's one is drawn rather than packed.
       * `build-kit.mjs` runs this after the merge and before the transforms, which is what
       * lets `weld` and `dedup` fold the torch in with everything else.
       */
      generated: [{ module: 'src/themes/medieval/torch.mjs', name: 'torch' }],
    },
    { src: `${HEX}/Assets/gltf`, subdirs: true, out: 'public/assets/medieval/forest.glb', models: NATURE, atlases: ATLASES },
    /**
     * The decay kit — a third kit rather than ten more models in `medieval.glb`, and lazy
     * rather than loaded at boot (2026-09-12, `feature/ghost-decay`).
     *
     * Every model here UVs into the same 8x4 `hexagons_medieval.png` grid the base kit is
     * painted from, so it declares no `atlases` of its own: its geometry is drawn with the
     * base kit's shared texture and merges into the plot's own clutter material, and a season
     * swap — one image assignment on that shared texture — carries the dressing with it for
     * free.
     *
     * Why not simply add the models to `medieval.glb`? Because a kit is loaded at boot and
     * every geometry, material and texture three builds spends four draws of `Math.random`
     * through `generateUUID`. Under the snapshot harness that is one seeded stream shared with
     * everything the world places, so ten more nodes in the base kit would re-seat every
     * villager in the three medieval shots that have no ghost in them at all — the failure
     * mode `docs/kits.md` §7 records for the particle hook. A kit that is registered but never
     * loaded spends nothing, and a village with no ghost in it never loads this one.
     */
    { src: `${HEX}/Assets/gltf`, subdirs: true, out: 'public/assets/medieval/decay.glb', models: DECAY },
  ],
  crew: {
    src: ANIM,
    rigDir: 'Animations/gltf/Rig_Medium',
    out: 'public/assets/medieval/crew.glb',
    cell: 256,
    /**
     * The cast. The Adventurers' alt colourway sheets are *not* beside the character glbs —
     * they live one level up under `Textures/` — so `texture` is a path relative to the glb's
     * own directory rather than a bare stem.
     *
     * The hooded rogue names `rogue_texture` on purpose: the packer keys atlas rows by the
     * texture's basename, so the hood and the bare head share one row and one set of
     * colourways — same sheet, two bodies.
     *
     * It is packed as `hooded` rather than `rogue_hooded` because the id becomes a *node name
     * prefix* (`body_<id>_<Part>`) and the engine claims a character's meshes by that prefix:
     * `body_rogue_` would swallow every `body_rogue_hooded_` mesh as well and the plain rogue
     * would render as both bodies at once. The manifest still calls the character
     * `rogue_hooded`; only the mesh prefix differs.
     */
    characters: [
      ['knight', 'Knight', 'knight_texture'],
      ['engineer', 'Engineer', 'engineer_texture'],
      ['ranger', 'Ranger', 'ranger_texture'],
      ['barbarian', 'Barbarian', 'barbarian_texture'],
      ['rogue', 'Rogue', 'rogue_texture'],
      ['hooded', 'Rogue_Hooded', 'rogue_texture'],
      ['mage', 'Mage', 'mage_texture'],
      ['druid', 'Druid', 'druid_texture'],
    ].map(([id, file, texture]) => ({
      id,
      src: `${ADV}/Characters/gltf/${file}.glb`,
      texture: `../../Textures/${texture}`,
      colourways: ['', '_alt_A', '_alt_B', '_alt_C'],
    })),
    /**
     * Hand tools, packed into the crew glb as static nodes: the props hook runs before the
     * kit is loaded, so a tool cannot be a kit part — it names a node here and the engine
     * hands it the geometry when the rig lands. Each Adventurers tool is painted from a
     * class sheet that is already a row of the atlas; the two hexagon tools bring the one
     * row of their own the cast has no use for otherwise.
     *
     * `shield_round` is not a tool: it is the badge every villager wears on its back, and the
     * props hook draws it `plain` — no atlas map at all — so its instance colour is the plot's
     * accent rather than a painted sheet. It is packed here all the same, because a prop is
     * only ever a static node in this glb, and it costs no atlas row of its own: KayKit paints
     * it from `knight_texture`, which is already row 0.
     *
     * `helmet` is not a tool either: it is the helm a helper wears, drawn `plain` and in the
     * accent like the shield. It comes from the hexagon pack and is painted from the same
     * `hexagons_medieval` sheet as the hammer and the shovel, so it adds no atlas row.
     */
    props: [
      { node: 'engineer_Wrench', src: `${ADV}/Assets/gltf/engineer_Wrench.gltf` },
      { node: 'axe_1handed', src: `${ADV}/Assets/gltf/axe_1handed.gltf` },
      { node: 'dagger', src: `${ADV}/Assets/gltf/dagger.gltf` },
      { node: 'staff', src: `${ADV}/Assets/gltf/staff.gltf` },
      { node: 'druid_staff', src: `${ADV}/Assets/gltf/druid_staff.gltf` },
      { node: 'hammer', src: `${HEX}/Assets/gltf/units/neutral/hammer.gltf` },
      { node: 'shovel', src: `${HEX}/Assets/gltf/units/neutral/shovel.gltf` },
      { node: 'shield_round', src: `${ADV}/Assets/gltf/shield_round.gltf` },
      { node: 'helmet', src: `${HEX}/Assets/gltf/units/neutral/helmet.gltf` },
    ],
    /**
     * The clips to keep, by source file. Names are KayKit's own — the runtime looks them up
     * by name, so this list and `crew.clips` in `manifest.js` have to agree.
     */
    clips: {
      'Rig_Medium_General.glb': ['Idle_A', 'Idle_B', 'Interact', 'Hit_A', 'Spawn_Ground'],
      'Rig_Medium_MovementBasic.glb': ['Walking_A', 'Running_A', 'Jump_Full_Short'],
      'Rig_Medium_Simulation.glb': [
        'Cheering', 'Waving', 'Sit_Floor_Down', 'Sit_Floor_Idle', 'Sit_Floor_StandUp',
        // A nap on the grass: the village sleeps lying down, not sitting.
        'Lie_Down', 'Lie_Idle', 'Lie_StandUp',
      ],
      'Rig_Medium_Tools.glb': ['Hammering', 'Working_A', 'Chopping', 'Digging', 'Sawing', 'Pickaxing', 'Lockpicking'],
      'Rig_Medium_CombatRanged.glb': ['Ranged_Magic_Spellcasting'],
    },
  },
}
