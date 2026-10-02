import { buildKeep } from './keep.js'

/**
 * The forest's arrival: a green keep with a round tower on each flank.
 *
 * All the shape is in `keep.js`; this file is the style and nothing else. What makes it the
 * *forest's* castle rather than the mountain's is the paint and the towers — green on green is
 * the pack's woodland faction, and the round `B` towers with their conical caps read as a
 * manor house that has been fortified rather than as a fort. The mountain's `fortress` is the
 * same shape with cannon towers on stone plinths, which is a different building at a glance
 * and not merely a recolour.
 */

/**
 * The style `keep.js` builds. See that module for what each field means and for the three
 * radii that follow from `keepScale`, `towerScale` and `towerOut`.
 *
 * **`keepScale` 1.6.** The keep used to stand a wall unit behind a gate that was the actual
 * arrival, and it was scenery; now it is the thing villagers walk out of, and at the pack's
 * own size it is barely taller than the tavern on the next plot. Half again as big is what
 * makes it read as the building the village belongs to from the map camera.
 *
 * **`towerScale` 1.3, `towerOut` 2.86.** The keep is 0.988 model units to the flank and at 1.6
 * that is 1.58; the `B` tower is 0.599 and at 1.3 that is 0.78; `TOWER_GAP` is the quarter of
 * a wall unit between them. 1.58 + 0.5 + 0.78 = 2.86. The towers are built smaller than the
 * keep on purpose — at the keep's own scale they crowd it and the group reads as three
 * buildings rather than one.
 *
 * **`towerBack` −0.9.** The towers stand on the keep's rear flanks, not beside its middle and
 * not in front of it: −0.9 lands a `B` tower's back face at −1.798 against the keep's own
 * −1.805, so the three pieces finish level at the back and the whole of the keep's front —
 * its face, its doorway and the ground villagers appear on — is left open. Anything forward of
 * this puts a tower between the camera and the arrivals.
 *
 * **Green.** The forest is summer green and so is the keep, which is the risk the spec named:
 * green stone on a green meadow under green trees. It survives the shot because the pack's
 * faction green is a dark blue-green on the *roofs* and the walls themselves are the same
 * grey stone every building in the kit is cut from — the colour is a trim, not a body. Blue is
 * the fallback if that ever stops being true; the mountain already wears it.
 */
export const STYLE = {
  kind: 'castle',
  keep: 'building_castle_green',
  tower: 'building_tower_B_green',
  banner: 'banner_green_full',
  keepScale: 1.6,
  towerScale: 1.3,
  towerOut: 2.86,
  towerBack: -0.9,
  banners: true,
}

/**
 * The same green keep and round `B` towers, a size down: for a world with little ground to give
 * it, a moon or a floating island, where the forest's keep would crowd the colony.
 *
 * **`keepScale` 1.1, `towerScale` 0.9.** Still larger than the pack's own keep, so it reads as
 * the building the village belongs to, and the towers kept a little under the keep's scale for
 * the reason `STYLE` gives.
 *
 * **`towerOut` 2.13.** The keep's 0.988 at 1.1 is 1.087; the `B` tower's 0.599 at 0.9 is 0.539;
 * with `TOWER_GAP`'s 0.5 between them, 1.087 + 0.5 + 0.539 = 2.126.
 *
 * **`towerBack` −0.62.** The keep's back face is −1.128 at 1.1, −1.241; the `B` tower reaches
 * 0.691 behind its own origin (the depth `STYLE`'s −0.9 already implies: 1.798 − 0.9 = 0.898 at
 * 1.3), 0.622 at 0.9. So the towers stand at −1.241 + 0.622 = −0.619, and the three backs finish
 * level as they do on the forest's keep.
 */
export const SMALL = {
  ...STYLE,
  keepScale: 1.1,
  towerScale: 0.9,
  towerOut: 2.13,
  towerBack: -0.62,
  banners: true,
}

/**
 * The castle's sizes, by the `ceremony.size` a setting names (`manifest.ceremonySizes.castle`).
 * `standard` is the forest's keep, unchanged. The fortress (`fortress.js`) is the one `grand`.
 */
export const STYLES = { standard: STYLE, small: SMALL }

/** Ceremony hook: the castle villagers walk in through, at the size the setting asks for. */
export function ceremony(scene, position, _manifest, setting) {
  return buildKeep(scene, position, STYLES[setting?.ceremony?.size ?? 'standard'] ?? STYLE)
}
