import { buildKeep } from './keep.js'

/**
 * The mountain's arrival: a blue keep with a cannon tower on a stone plinth at each flank.
 *
 * All the shape is in `keep.js`; this file is the style and nothing else. It is deliberately
 * the *same* mesh as the forest's keep in the pack's other paint, because what makes the two
 * arrivals different buildings is not the keep — it is what stands beside it. The forest gets
 * round `B` towers with conical caps, half the keep's height, and reads as a manor. This gets
 * squat cannon towers carried up on `building_tower_base` plinths until they stand nearly as
 * tall as the keep itself, and reads as a garrison holding a pass.
 */

/**
 * The style `keep.js` builds. See that module for what each field means and for the three
 * radii that follow from `keepScale`, `towerScale` and `towerOut`.
 *
 * **`keepScale` 1.4, against the forest's 1.6.** The mountain shot is taken at night with snow
 * falling and its ground is pale; a keep as large as the forest's fills too much of a frame
 * whose scenery is the point. Smaller here also leaves the towers room to be the tall thing,
 * which is the whole difference between the two buildings.
 *
 * **`towerScale` 1.3, `towerOut` 2.49.** The keep is 0.988 model units to the flank and at 1.4
 * that is 1.38; the cannon tower is 0.465 and at 1.3 that is 0.60; `TOWER_GAP` is the quarter
 * of a wall unit between them. 1.38 + 0.5 + 0.60 = 2.49. The plinth has the tower's own
 * footprint to a hundredth, so it needs no offset of its own — it stands on the same spot and
 * `keep.js` reads its height off the geometry to know how high to carry the tower.
 *
 * **`towerBack` −0.9,** the forest's number, and for the same reason on a shallower keep: a
 * cannon tower's back face lands at −1.590 against this keep's own −1.579, so the pieces still
 * finish level at the back to within a hundredth and the keep's whole front is open ground.
 *
 * **Blue on snow** is the pack's own cold palette, and the plinths are unpainted stone, so the
 * building holds its shape against a white ground where a green one would not.
 *
 * **`towerRear` −2.77, and every part of it is a measurement.** A garrison holding a pass has a
 * gun on the road it is holding *and* a gun behind it, and the fortress had two towers looking
 * the same way. The keep's back face is at `KEEP_HALF_Z * keepScale` = 1.128 × 1.4 = 1.579;
 * `TOWER_GAP` is the same quarter of a wall unit the flanks keep, 0.5; and the tower is turned a
 * half turn to point its cannon away from the keep, which puts the face it shows the stone at
 * `|min.z| * towerScale` = 0.531 × 1.3 = 0.690. 1.579 + 0.5 + 0.690 = 2.769. `towerRearFor`
 * re-derives it and `tests/keep.test.mjs` holds it against the glb, exactly as `towerOut` is
 * held. It carries no banner — cloth hangs on the piece's +z face, which here is the gap between
 * it and the keep — and the keep still overtops it: (1.500 + 2.040) × 1.3 = 4.602 against
 * 3.979 × 1.4 = 5.571, the same 17% it overtops the flanks by.
 *
 * **`towerRearBlock` 0.75** is the radius, in the *tower's* own model units about its own
 * origin, of the navigation disc the rear tower needs: `hypot(0.580, 0.465)` = 0.743, rounded
 * out. It exists because the rear tower is the one piece of either keep that the ceremony's
 * single clearance disc cannot reach and that a villager could plausibly walk into. See
 * `rearBlockFor` in `keep.js`.
 *
 * The forest's castle declares neither field and keeps its two towers.
 */
export const STYLE = {
  kind: 'fortress',
  keep: 'building_castle_blue',
  tower: 'building_tower_cannon_blue',
  plinth: 'building_tower_base_blue',
  banner: 'banner_blue_full',
  keepScale: 1.4,
  towerScale: 1.3,
  towerOut: 2.49,
  towerBack: -0.9,
  towerRear: -2.77,
  towerRearBlock: 0.75,
  banners: true,
}

/** Ceremony hook: the fortress the mountain's villagers walk in through. */
export function ceremony(scene, position) {
  return buildKeep(scene, position, STYLE)
}
