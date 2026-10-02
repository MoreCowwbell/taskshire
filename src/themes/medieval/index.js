import { manifest } from './manifest.js'
import { ceremony as castle } from './castle.js'
import { ceremony as fortress } from './fortress.js'
import { ceremony as boat } from './boat.js'
import { surfaces } from './surfaces.js'
import { props } from './props.js'
import { particles } from './particles.js'

/**
 * The medieval village.
 *
 * `faces` is deliberately absent: the registry fills a missing hook from the space theme, and
 * that one is harmless here — the expression atlas is only ever sampled by a face part, and
 * this theme has none.
 */

/**
 * The arrivals this theme can build, by the `kind` a setting names in its `ceremony` block.
 * `manifest.ceremonies` lists the same keys for the schema, which is what turns a typo in a
 * setting into a load-time error rather than a silent fall back to the default.
 */
const CEREMONIES = { castle, fortress, boat }

/** What a setting gets when it names no ceremony of its own. */
const DEFAULT_KIND = 'castle'

/**
 * Ceremony hook: the arrival the setting asked for.
 *
 * Every kind the manifest declares is built, so the lookup cannot miss: the schema holds
 * every setting's `ceremony.kind` against `manifest.ceremonies`, and the two lists are the
 * same three names. A setting that names nothing takes the castle.
 *
 * The setting goes through to the implementation as well as the kind, because the boat is
 * built against the sea it floats on — its bearing from the setting's `coast` or `shape`
 * (`coastAxis`), its level from `setting.water` — and the castle is built at the
 * `ceremony.size` it names. The fortress reads nothing.
 */
function ceremony(scene, position, manifest, setting) {
  const make = CEREMONIES[setting?.ceremony?.kind ?? DEFAULT_KIND] ?? CEREMONIES[DEFAULT_KIND]
  return make(scene, position, manifest, setting)
}

export default {
  id: 'medieval',
  name: 'Medieval village',
  /**
   * Engine systems (`src/core/features.js`), the village's so far:
   * - upstream's water: the level sea, lakes and lava of the shared worlds, and the valley's sea,
   *   turquoise over the shallows and blue offshore, behind the bank its `coast` shapes. A world
   *   with no water builds nothing, and the forest and the mountain have none. The ships on the
   *   valley, Shoreline and Archipelago ride its swell (`Boat.setSea`). The system builds on its
   *   own random stream; the draws the valley's old flat sea took from the page's are still spent
   *   where it was built (`Colony._buildTerrain`), so no villager moves.
   * - the world curve (`core/curve.js`): `main.js` patches three's shader chunks before anything
   *   compiles and hands the camera's focus and heading to the bend every frame, so the ground,
   *   the keep, the crew and everything standing on them fall away toward the horizon and the
   *   village reads as a small round world. How hard is the `worldCurve` setting (0.45 by
   *   default, a drop of 8 units 52 out on the far side); the rig's `groundPoint` picks on the
   *   same bent ground. It is a projection only: it builds nothing and draws on no random
   *   stream, so no villager moves.
   * - the colour grade, contact shading and the overlay, the engine's three post passes. The
   *   grade finishes the tone-mapped image with the world's own saturation and warmth (a world
   *   that names none gets 1 and 0, so only the `vignette` setting's 0.3 shows) and the
   *   `colorGrade` setting turns it off; contact shading darkens creases before bloom, at the
   *   `ambientOcclusion` setting's strength (0 on the lighter presets, which leaves it out). The
   *   overlay moves the badges and the name plates onto a layer of their own, drawn after
   *   tilt-shift, so they stay sharp where the scene behind them is blurred, as in space. Each
   *   pass is built on its own random stream and none places anything, so no villager moves.
   * - clouds, meadow grass and wildlife, each read from the world's own data and nothing
   *   without it: the sky dome compiles its cumulus program and a world with no `clouds`
   *   writes an amount of 0; grass grows only where the world names `grass`, off the plots and
   *   the arrival's apron; birds, butterflies and fish fly only as the world's `fauna` lists
   *   them. The twelve borrowed worlds bring the library's values (songbirds and butterflies
   *   on green worlds, gulls and fish on water worlds); the village's dressing has no `drones`,
   *   so space's cargo drones never come. Motes stay off: the village's particles have no mote
   *   recipe and draw their own fireflies. Grass and wildlife build on their own streams, so no
   *   villager moves.
   * - sound (`audio/ambience.js`): `main.js` builds the ambience, and the HUD keeps the Sound
   *   group, the mute button and its help line, and `M`. Nothing is heard, and no audio context
   *   exists, until the first click or key anywhere; then each world plays its own beds and
   *   events, and the village's four moments sound by the manifest's `sounds` table — a lute
   *   pluck, the hand bell, the hammer, the keep bell or the boat's creak. The ambience is built
   *   inside the sound stream (`isolated(featureRng('sound'))`) and draws nothing else, so no
   *   villager moves.
   */
  features: {
    water: true, curve: true, grade: true, occlusion: true, overlay: true,
    clouds: true, grass: true, fauna: true, sound: true,
  },
  manifest,
  hooks: { ceremony, surfaces, props, particles },
}
