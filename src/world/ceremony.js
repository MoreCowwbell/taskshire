import * as THREE from 'three'

/**
 * The one thing every ceremony has in common: where its threshold stands in the world.
 *
 * A ceremony keeps its threshold as `doorLocal`, a fixed offset in the group's own frame, and
 * the engine wants it in world space — the crew is placed there, and `Colony._blockedCells`
 * reserves the cell under it. Turning one into the other used to be `applyMatrix4(matrixWorld)`
 * on each ceremony, and that answered wrongly at exactly the moments it mattered: three
 * composes `matrixWorld` during the render walk and at no other time, so on the frame a colony
 * is built, and again on the frame a setting is swapped, it is still the identity and `door()`
 * gives back the local offset — the middle of the map. The first batch of arrivals is placed
 * before any of that, so they walked out of the map centre.
 *
 * So the group's own transform is composed here instead. It *is* the world transform: all
 * three ceremonies — the lander, the keep, the dock — add their group straight to the scene,
 * so there is nothing above it to inherit from.
 *
 * Forcing the matrix first is the obvious repair and is worse than the disease.
 * `updateMatrixWorld` rewrites `matrix`, `matrixWorld` and every child's the same way, and
 * doing it a few frames early moves what the scene draws. This touches no scene state at all.
 */

/** Reused across every call: composed, read, and never handed out. */
const scratch = new THREE.Matrix4()

/** `doorLocal` put through `group`'s own transform, without waiting for the render walk. */
export function worldDoor(group, doorLocal, out = new THREE.Vector3()) {
  scratch.compose(group.position, group.quaternion, group.scale)
  return out.copy(doorLocal).applyMatrix4(scratch)
}
