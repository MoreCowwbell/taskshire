/**
 * What `tools/build-assets.mjs` packs for the space theme.
 *
 * Every `src` is relative to `ASSETS_SRC` — the directory the raw KayKit packs are unzipped
 * into, which lives outside the repo and is never committed. Packs that unzip into a folder
 * of their own name inside the archive say so here (`a/a`) rather than the packer guessing.
 *
 * The whole theme is built or none of it is: if any `src` below is missing, `build-assets`
 * skips this theme and the checked-in glbs stay in use.
 */

/**
 * Which of the Forest Nature Pack's 105 models to keep.
 *
 * The pack ships every model in several sizes and colour variants; the colony wants a
 * handful of silhouettes and gets its variety from per-instance scale and rotation instead,
 * so packing the lot would be five times the file for no more to look at.
 */
const FOREST = [
  // Canopies: round, flat-top and fir, each in a common size, plus a rarer large one.
  'Tree_1_A', 'Tree_3_A', 'Tree_4_A', 'Tree_1_C', 'Tree_3_C', 'Tree_4_C',
  'Bush_1_E', 'Bush_3_B',
  'Grass_2_D',
  // Boulders. Painted neutral grey, which is what lets them be tinted per planet.
  'Rock_1_D', 'Rock_2_C', 'Rock_3_E', 'Rock_1_J', 'Rock_2_G', 'Rock_3_L', 'Rock_3_Q',
].map((n) => `${n}_Color1`)

export default {
  kits: [
    {
      src: 'KayKit_Space_Base_Bits_1.0_FREE/Assets/gltf',
      out: 'public/assets/space/spacebase.glb',
      models: null, // the whole pack
    },
    {
      src: 'KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf',
      out: 'public/assets/space/forest.glb',
      models: FOREST,
    },
  ],
  /**
   * Kenney's Nature Kit (CC0), for the worlds the Forest pack cannot dress — palms, cacti,
   * pines, autumn and jungle canopies. Packed by `tools/build-nature.mjs`, which keeps its own
   * list of models and recolours; see there.
   */
  nature: {
    src: 'kenney_nature-kit/Models/GLTF format',
    out: 'public/assets/space/nature.glb',
  },
  crew: {
    src: 'KayKit_Character_Animations_1.1/KayKit_Character_Animations_1.1',
    mannequin: 'Mannequin Character/characters/Mannequin_Medium.glb',
    rigDir: 'Animations/gltf/Rig_Medium',
    out: 'public/assets/space/crew.glb',
    /**
     * The clips to keep, by source file. Names are KayKit's own — the runtime looks them up
     * by name, so this list and `crew.clips` in `manifest.js` have to agree.
     */
    clips: {
      'Rig_Medium_General.glb': ['Idle_A', 'Idle_B', 'Interact', 'Hit_A', 'Spawn_Ground'],
      'Rig_Medium_MovementBasic.glb': ['Walking_A', 'Running_A', 'Jump_Full_Short'],
      'Rig_Medium_Simulation.glb': ['Cheering', 'Waving', 'Sit_Floor_Down', 'Sit_Floor_Idle', 'Sit_Floor_StandUp'],
      'Rig_Medium_Tools.glb': ['Hammering', 'Working_A'],
    },
  },
}
