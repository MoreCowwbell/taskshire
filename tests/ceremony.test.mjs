import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { worldDoor } from '../src/world/ceremony.js'
import { Ship } from '../src/themes/space/ship.js'

/**
 * `worldDoor` is the whole of the door fix: a ceremony's threshold in world space, off the
 * group's own transform instead of the `matrixWorld` three only composes while drawing.
 *
 * Every case here is the answer against the render walk's own answer. The render walk is the
 * definition of right; the point of the module is arriving at it a few frames earlier and
 * without writing anything down.
 */

/** The matrix three would have written, on a copy, so the original is left as it was found. */
function rendered(group, doorLocal) {
  const twin = new THREE.Group()
  twin.position.copy(group.position)
  twin.quaternion.copy(group.quaternion)
  twin.scale.copy(group.scale)
  twin.updateMatrixWorld(true)
  return new THREE.Vector3().copy(doorLocal).applyMatrix4(twin.matrixWorld)
}

/** How far apart two points are — reported in full when a case fails. */
const apart = (a, b) => a.distanceTo(b)

test('worldDoor on a translated, turned group is the render walk’s own answer', () => {
  // The forest keep's cell and the `atan2` every ceremony turns by.
  const at = new THREE.Vector3(-22.8, 0, 13.16)
  const group = new THREE.Group()
  group.position.copy(at)
  group.rotation.y = Math.atan2(-at.x, -at.z)
  const doorLocal = new THREE.Vector3(0, 0, 6.5)

  const got = worldDoor(group, doorLocal)
  const want = rendered(group, doorLocal)
  assert.ok(apart(got, want) < 1e-9, `${got.toArray()} vs the drawn ${want.toArray()}`)

  // The threshold is DOOR_OUT from the cell and inward along its own bearing, which is what
  // the turn was for — and what an un-composed matrix would have lost.
  assert.ok(Math.abs(Math.hypot(got.x - at.x, got.z - at.z) - 6.5) < 1e-9)
  assert.ok(Math.hypot(got.x, got.z) < Math.hypot(at.x, at.z), 'toward the middle of the colony')
})

test('worldDoor touches no scene state', () => {
  const scene = new THREE.Scene()
  const group = new THREE.Group()
  group.position.set(-22.8, 0, 13.16)
  group.rotation.y = 0.7
  const child = new THREE.Object3D()
  child.position.set(0, 3, 0)
  group.add(child)
  scene.add(group)

  const identity = new THREE.Matrix4()
  worldDoor(group, new THREE.Vector3(0, 0, 6.5))

  assert.ok(group.matrix.equals(identity), 'the group’s own matrix is untouched')
  assert.ok(group.matrixWorld.equals(identity), 'and the world matrix three would compose')
  assert.ok(child.matrixWorld.equals(identity), 'and the children’s, which is what makes the fix cheap')
})

test('worldDoor carries a non-unit scale', () => {
  const group = new THREE.Group()
  group.position.set(4, -1.5, -9)
  group.rotation.set(0, 1.1, 0)
  group.scale.set(2.5, 2.5, 2.5)
  const doorLocal = new THREE.Vector3(-7.5, 0, 0)

  const got = worldDoor(group, doorLocal)
  const want = rendered(group, doorLocal)
  assert.ok(apart(got, want) < 1e-9, `${got.toArray()} vs the drawn ${want.toArray()}`)
  // Not the same point as the unscaled group would have given: the case is doing work.
  const unscaled = new THREE.Group()
  unscaled.position.copy(group.position)
  unscaled.quaternion.copy(group.quaternion)
  assert.ok(apart(got, worldDoor(unscaled, doorLocal)) > 1, 'the scale reached the answer')
})

test('the scratch matrix is never handed out: a second call leaves the first answer alone', () => {
  const a = new THREE.Group()
  a.position.set(10, 0, 0)
  const b = new THREE.Group()
  b.position.set(-10, 0, 0)
  const local = new THREE.Vector3(0, 0, 1)

  const first = worldDoor(a, local)
  worldDoor(b, local)
  // Two calls in a row, not two at once: what is being checked is that the vector the first
  // one returned is the caller's own, rather than the scratch the second went on to overwrite.
  assert.deepEqual(first.toArray(), [10, 0, 1], 'the first answer survived the second call')
})

/**
 * And the lander, which is the ceremony that reads its threshold earliest of the three: the
 * space harness spawns its first walk-outs before frame 1, and this is the number they are
 * placed at. Built headless — the hull is geometry and materials, no canvas anywhere.
 */
test('the lander’s door() is right before it has ever been drawn', () => {
  const scene = new THREE.Scene()
  const at = new THREE.Vector3(-18, 0, 11)
  const ship = new Ship(scene, at, {})

  const door = ship.door()
  assert.ok(door.distanceTo(at) > 1, 'out at the foot of the ramp, not on the lander’s own cell')
  assert.ok(Math.hypot(door.x, door.z) < Math.hypot(at.x, at.z), 'and inward, where the colony is')
  assert.ok(Math.hypot(door.x, door.z) > 1e-6, 'and emphatically not the map centre')

  const want = rendered(ship.group, ship.doorLocal)
  assert.ok(apart(door, want) < 1e-9, `${door.toArray()} vs the drawn ${want.toArray()}`)
  assert.ok(ship.group.matrixWorld.equals(new THREE.Matrix4()), 'and nothing was composed to get it')
})
