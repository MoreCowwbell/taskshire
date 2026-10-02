import * as THREE from 'three'
import { hasPart, hasSolo, part } from '../../world/kit.js'

/**
 * The town wall, as the handful of facts every medieval ceremony is built out of.
 *
 * The village's arrival used to be a bare arch with two wings (`gate.js`), and the castle that
 * replaced it is the same wall run made longer with towers on its corners. Rather than have
 * the castle carry a second copy of the hinge arithmetic, the parts of that wall which are
 * *the pack's*, not the building's — how wide a piece is, where a door leaf pivots, how far it
 * swings, how a one-handed corner is mirrored — live here, and the buildings above compose
 * them.
 */

/**
 * Model units to world units. Kept equal to `buildings.scale` in the manifest: the wall and
 * the houses come out of the same pack at the same authored size, and a village whose castle
 * is scaled differently from its cottages looks like two villages.
 */
export const SCALE = 2.6

/** Half the width of a wall segment, in model units — every other piece is placed off it. */
export const WALL_HALF = 1.0

/**
 * One wall unit: how far along a run the next piece sits, in model units.
 *
 * Every wall piece in the pack is two units wide and joins on the face at ±1 from its own
 * origin, so a piece butted against its neighbour sits exactly two units along. A corner's
 * other arm then runs off at the hexagon's own 120°, which is why wings splay rather than
 * turning square.
 */
export const WALL_STEP = 2 * WALL_HALF

/** The segment with the arch in it, and the top of that arch — where a pennant is planted. */
export const ARCH = 'wall_straight_gate'
export const ARCH_TOP = 1.364

/**
 * The two leaves of the arch, and the jamb each one is hung on.
 *
 * The pack keeps them as child nodes of `wall_straight_gate` — a leaf's node sits on its own
 * jamb at x = ±0.45 and its geometry runs from there in to the middle of the arch, which is
 * exactly a hinge. `kit.js` bakes a part into its own node's frame, so the geometry arrives
 * centred on the hinge and only the jamb offset has to be put back.
 */
export const DOOR_LEFT = `${ARCH}_door_left`
export const DOOR_RIGHT = `${ARCH}_door_right`
export const DOOR_HINGE = 0.45

/** How far a leaf swings, in radians: 70°, wide enough to read as open from the map camera. */
export const DOOR_OPEN = 1.22

/** Seconds the doors are held open after the last villager through. */
export const DOOR_HOLD = 1.5

/**
 * Whether the arch can be hung with working doors.
 *
 * Three things a repack can take away, and any one of them keeps the whole piece with its
 * doors baked shut rather than an empty archway or a throw: either leaf missing, or an arch
 * that is no longer a single mesh and so cannot be taken `solo` — and `solo` is what leaves a
 * node's children behind, which is the only way to bake the arch without baking the leaves
 * into it.
 */
export function hasHingedArch() {
  return hasPart(DOOR_LEFT) && hasPart(DOOR_RIGHT) && hasSolo(ARCH)
}

/**
 * Bake one kit geometry into a group's own frame as a mesh that never moves.
 *
 * Everything a wall or a keep is made of that does not turn goes through here, on one shared
 * material, so a castle is a handful of meshes rather than a scene graph.
 *
 * **Size and position are scaled apart**, which is what `size` is for. A wall run is one piece
 * next to another at one scale and takes the default; a keep is built larger than the towers
 * beside it and both are placed on the same lattice of model units, so the offsets stay in
 * `SCALE` while the geometry grows. Passing `size` for the offsets as well would move a piece
 * as far as it was made big, which is not the same building.
 *
 * @param {THREE.Group} group
 * @param {THREE.Material} material
 * @param {THREE.BufferGeometry} geo  already mirrored or turned, if it needed to be
 * @param {{x?: number, y?: number, z?: number}} at  in model units, always at `SCALE`
 * @param {number} [size]  model units to world units for the geometry itself
 * @returns {THREE.Mesh}
 */
export function placePart(group, material, geo, { x = 0, y = 0, z = 0 } = {}, size = SCALE) {
  geo.scale(size, size, size)
  geo.translate(x * SCALE, y * SCALE, z * SCALE)
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

/**
 * Hang the arch's two leaves as nodes of their own, so they can swing.
 *
 * Each is placed on its jamb and left unbaked: a baked piece has nowhere to turn about.
 *
 * @param {THREE.Group} group
 * @param {THREE.Material} material
 * @param {number} z  where the arch stands along the group's z, in model units
 * @returns {{left: THREE.Mesh, right: THREE.Mesh}}
 */
export function hangDoors(group, material, z = 0) {
  const hang = (name, x) => {
    const geo = part(name)
    geo.scale(SCALE, SCALE, SCALE)
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(x * SCALE, 0, z * SCALE)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }
  return { left: hang(DOOR_LEFT, DOOR_HINGE), right: hang(DOOR_RIGHT, -DOOR_HINGE) }
}

/**
 * Put the leaves at a swing of 0 (shut) to 1 (wide).
 *
 * Both turn the same way — the left leaf hangs on +x and the right on -x, so opposite signs
 * push both out over the road rather than folding one into the other.
 *
 * @param {{left: THREE.Mesh, right: THREE.Mesh} | null} doors
 * @param {number} swing
 */
export function swingDoors(doors, swing) {
  if (!doors) return
  doors.left.rotation.y = -swing * DOOR_OPEN
  doors.right.rotation.y = swing * DOOR_OPEN
}

/**
 * Mirror a geometry through the xy plane.
 *
 * `scale(1, 1, -1)` flips the positions and — because `applyMatrix4` runs the normals through
 * the inverse transpose — the normals with them, but it leaves every triangle wound the wrong
 * way round, which turns the piece inside out under back-face culling. Reversing the index in
 * threes is the other half of the mirror.
 *
 * The pack ships only one hand of the corner piece: it joins a wall on its -x face and turns
 * away toward -z. Turned a half turn it caps the *other* end of a run — but it sends its wing
 * the other way as well, so a wall built from two of them would have one wing in front and one
 * behind. Mirroring the second one is what makes both wings splay the same way.
 */
export function mirrorZ(geo) {
  geo.scale(1, 1, -1)
  const index = geo.getIndex()
  if (!index) throw new Error('wall: a kit part with no index cannot be mirrored')
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i)
    index.setX(i, index.getX(i + 2))
    index.setX(i + 2, a)
  }
  index.needsUpdate = true
  return geo
}
