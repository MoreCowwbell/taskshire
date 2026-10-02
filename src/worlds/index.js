/**
 * The world library: every world either theme can be seen in, one file each, as data.
 * Nothing here imports three, so the validator reads it under Node as well as the app does.
 *
 * A world is the land and the look of a place: its landform (`craters`, `roughness`, `hills`, `clearing`,
 * `shape`, `lakes`, a sea, a ridge's geometry, a floating island), its colours, fog, sun and
 * ambient light with how hard its far field darkens (`farShade`), and its weather, clouds, wild
 * animals, sounds and grade. What a *theme* plants on it
 * is not here: the scatter recipe, a rim, the crags on a ridge, the kit atlas, a building tint,
 * the arrival and the drones are the theme's dressing (`manifest.dressing`), and
 * `resolve.js` puts the two together into the setting object the engine reads. A setting is a
 * bag of colours and a few switches; terrain, scatter, sky and lighting all read from it, so
 * adding a world is a data change rather than a code change.
 *
 * The first twelve are the space colony's. The eight after Terra, and every field past `dust`
 * on the first three, are upstream's (merged 2026-09-24 from d05ac2f, where they lived in
 * `src/world/planet.js`): water, shape, shore, weather, clouds, fauna, audio, grade, grass
 * and a floating island. So are the two options his generator used to imply for all twelve and
 * now reads off the world: his gentler `farShade`, and `lakes` on the five whose water sits in
 * their hollows. The last three are the village's own, and darken at the default. Every world names a `biome`,
 * which is how a theme dresses a world it has no entry for.
 */
import { autumn } from './autumn.js'
import { beach } from './beach.js'
import { desert } from './desert.js'
import { forest } from './forest.js'
import { jungle } from './jungle.js'
import { mars } from './mars.js'
import { moon } from './moon.js'
import { mountain } from './mountain.js'
import { ocean } from './ocean.js'
import { sakura } from './sakura.js'
import { sky } from './sky.js'
import { terra } from './terra.js'
import { tundra } from './tundra.js'
import { valley } from './valley.js'
import { volcanic } from './volcanic.js'

/**
 * Every world, by id: the space colony's first twelve, then the village's three. This is the
 * library's order, not the picker's; the picker shows `WORLD_GROUPS`.
 */
export const WORLDS = {
  moon,
  mars,
  terra,
  beach,
  ocean,
  jungle,
  desert,
  tundra,
  autumn,
  sakura,
  volcanic,
  sky,
  forest,
  valley,
  mountain,
}

export const WORLD_IDS = Object.freeze(Object.keys(WORLDS))

/**
 * The worlds by family, each in exactly one, in the order the picker shows them — the picker
 * itself draws one flat grid, so the groups set its order and nothing else. Both themes list
 * every world, in this order: a theme's `worlds` is these flattened, less any it hides.
 */
export const WORLD_GROUPS = Object.freeze([
  { id: 'green', name: 'Green', worlds: ['forest', 'valley', 'terra', 'sakura', 'autumn'] },
  { id: 'water', name: 'Water', worlds: ['beach', 'ocean'] },
  { id: 'cold', name: 'Cold & high', worlds: ['mountain', 'tundra'] },
  { id: 'exotic', name: 'Exotic', worlds: ['desert', 'jungle', 'volcanic', 'mars', 'moon'] },
  { id: 'sky', name: 'Sky', worlds: ['sky'] },
].map((g) => Object.freeze({ ...g, worlds: Object.freeze(g.worlds) })))

/** The families a dressing can speak to at once, in `dressing.biomes`. */
export const BIOMES = Object.freeze(['green', 'water', 'cold', 'arid', 'jungle', 'volcanic', 'airless', 'sky'])
