import * as THREE from 'three'
import { worldDoor } from '../../world/ceremony.js'
import { atlasTexture, decorateCellEmissive, hasPart, loadKit, part } from '../../world/kit.js'
import { SCALE, WALL_STEP, placePart } from './wall.js'

/**
 * The keep: where villagers walk in when a thread appears and back out when one is archived.
 * It is the village's one fixed piece of narrative furniture, the role the lander plays in the
 * space colony, and the forest and the mountain each get one.
 *
 * It used to be a town gate that had grown a castle around it — an arch with two swinging
 * leaves, a wall run either side, a corner tower on each end, and the keep set back behind the
 * lot as scenery. The thing villagers actually walked out of was the arch, and the keep was
 * the part nobody looked at. This turns that inside out: the keep *is* the arrival, built half
 * again as large, with a tower standing free on each flank and nothing in front of it. There
 * is no wall, no arch and no gate, so there are no doors to hang and no pennant to fly from
 * one. What the pennant *did* has outlived it: the two banners the towers carry stir on the
 * same beat and pick up while villagers are coming through — see `bannerLift`.
 *
 * **One shape, two buildings.** `castle.js` (forest) and `fortress.js` (mountain) are a style
 * object each and nothing else. A style says which keep, which tower, which banner, how big
 * each is built and where the towers stand; everything that follows from those — the three
 * radii the colony reads, where the banners hang, how high a tower sits on its plinth — is
 * worked out here, most of it off the pack's own measurements rather than off a literal.
 *
 * Like the gate before it this is *packed* geometry, and the kit is still loading when the
 * colony constructs its ceremony. So the group goes into the scene empty and is filled when
 * `loadKit()` resolves. Nothing downstream minds: the engine reads `group` (to sit it on the
 * terrain) and `door()` (to place arrivals), and `door()` is a fixed offset that needs no
 * geometry at all — so villagers are placed correctly from the very first frame.
 */

/**
 * Half the keep's own width and depth, in model units, as `building_castle_*.gltf` authors it.
 *
 * Both colours of the keep are the same mesh in two paints, so one pair of numbers covers
 * both styles: x runs to ±0.988, z to ±1.128, y to 3.979. They are literals here rather than
 * a bounds read because `clearance` and `apron` have to answer before the kit has loaded —
 * the colony asks for them in the ceremony's constructor — and `tests/keep.test.mjs` holds
 * both against the built glb, which is what stops them drifting if the pack is ever replaced.
 */
export const KEEP_HALF_X = 0.988
export const KEEP_HALF_Z = 1.128

/**
 * The daylight a tower keeps between itself and the keep's flank, in model units.
 *
 * A quarter of a wall unit. Less and the two silhouettes merge into one lump from the map
 * camera; more and the towers stop reading as part of the same building. It is the one free
 * number in `towerOut` — the rest of that offset is the keep's own half-width and the tower's,
 * each at its own scale.
 */
export const TOWER_GAP = WALL_STEP / 4

/**
 * How far in front of the cell's centre villagers appear and vanish, in world units.
 *
 * The castle's old 7 was measured against a gate arch standing a unit forward of the cell.
 * There is no arch now and the keep sits *on* the cell, so the threshold comes in — but not as
 * far as the keep's own face, because the navigation grid blocks a disc of
 * `clearance + AGENT_RADIUS` around the cell and an arrival inside that disc can never path
 * out of it. The deeper of the two keeps is the forest's at 1.6, whose disc is 5.45, so the
 * binding constraint is 5.75 — the boat's rule of clearing the disc by at least 0.3.
 *
 * Six and a half clears it by 1.05 and stands 1.81 world units in front of the forest keep's
 * own face and 2.39 in front of the mountain's, which is a villager's length of open ground:
 * they step out from under the wall rather than off it. And it is the largest round number
 * still inside the cell's own incircle (6.58 on a 7.6-unit lattice), so the threshold falls in
 * the cell the allocator has already reserved for the ceremony whatever bearing the arrival
 * stands on — which the old 7 did not guarantee.
 */
export const DOOR_OUT = 6.5

/**
 * Where a banner hangs on its tower, in the *tower's* own model units — so both scale with
 * `towerScale` and a banner sits in the same place on a big tower as on a small one.
 *
 * `BANNER_Y` is the gatehouse's number, unchanged: a little over a third of the way up the
 * shaft. Two of the gatehouse's three are gone, and both for measured reasons.
 *
 * **`BANNER_IN` is gone.** The gate shifted its banners 0.35 inboard to clear the corner
 * piece's turned-back arm, which ran forward across the outer third of the tower. There is no
 * corner and no arm now, and the shift is worse than useless on a free-standing tower: the
 * shaft's front facet in the banner's own band of height runs out at about ±0.34, so a banner
 * hung 0.35 off the centre line hangs off the *edge* of the tower with nothing behind it. Both
 * banners now hang on their tower's centre line, facing the road, which is where a banner on a
 * tower goes.
 *
 * **`BANNER_Z` is gone too.** It was 0.6 against a `building_tower_A` whose bounding box
 * reaches 0.580 — "0.02 proud of the stone" written as an absolute, and right only because
 * that tower and that number happened to suit each other. Neither of these towers is square
 * and every one of them carries a cap, a door and (on the cannon tower) a gun carriage further
 * out than any wall: the shaft under the banner stops at 0.368 where the boxes reach 0.580 and
 * 0.691. So the margin is the constant now and the face it is measured from is the stone
 * actually behind the cloth — see `faceUnder`.
 */
export const BANNER_Y = 0.62
export const BANNER_OUT = 0.02

/**
 * The banner the pack ships, in model units: half a unit tall and 0.168 across.
 *
 * `BANNER_BAND` is the half-width of the strip of tower `faceUnder` measures — the banner's own
 * 0.084 rounded out, so the face it finds is the stone the cloth covers and not a vertex from
 * a buttress beside it. `tests/keep.test.mjs` holds both against the glb.
 */
export const BANNER_TALL = 0.5
export const BANNER_BAND = 0.1

/**
 * How the cloth moves, and how hard — the town gate's pennant numbers, on a banner instead.
 *
 * The gate had one animation worth the name: a pennant over the arch that stirred all the time
 * and snapped about while anyone was using the door. The arch went and the pennant with it,
 * and the keep that replaced it stood perfectly still. These are that pennant's four numbers
 * moved onto the banners the towers already fly.
 *
 * `BANNER_SWAY` is the peak lift of the cloth's bottom edge away from the stone, in radians.
 * It is a sixth of the pennant's throw, because a pennant on a pole has clear air all round it
 * and a banner hung flat on a tower has a wall a couple of centimetres behind it: at 0.1 the
 * hem of the forest's banner swings about 0.2 world units out, a hand's width, and never
 * anywhere near the parapet above it. `BANNER_BEAT` is the pennant's own rate.
 * `TRAFFIC_DECAY` and `TRAFFIC_MAX` are its arithmetic unchanged — each villager through the
 * door adds one, the count bleeds away at 1.5 a second, and it never banks more than two and a
 * half, so a busy morning does not leave the cloth streaming long after the last arrival.
 */
export const BANNER_SWAY = 0.1
export const BANNER_BEAT = 2.2
export const TRAFFIC_DECAY = 1.5
export const TRAFFIC_MAX = 2.5

/**
 * How far a banner is lifted off its tower this frame, in radians. Never negative.
 *
 * The sine is folded into `0.5 * (1 + sin)` rather than taken raw, and that is the whole
 * difference between a banner and a pennant. A raw sine would push the cloth *into* the stone
 * for half of every beat, which on a flag hanging two centimetres off a wall is a banner with
 * a tower through it. Folded, the beat runs from flat against the stone to `BANNER_SWAY` out
 * and back, and the trough is exactly zero — so a keep nobody is using renders its banners in
 * the pack's own rest pose to the bit, the same property the boat's voyage clock is arranged
 * for.
 *
 * `i * 1.7` is the phase between the two towers: a little over half a beat, so the pair never
 * flap in step and the building does not read as one hinged object.
 *
 * @param {number} traffic  villagers through the door lately, decaying — see `TRAFFIC_DECAY`
 * @param {number} elapsed  the simulation clock, in seconds
 * @param {number} i        which banner, in the order they were built
 */
export function bannerLift(traffic, elapsed, i) {
  return BANNER_SWAY * (1 + Math.min(1, traffic)) * 0.5 * (1 + Math.sin(elapsed * BANNER_BEAT + i * 1.7))
}

/**
 * How far toward the road a tower's own stone reaches *behind the banner*, in the tower's own
 * model units — which is not the same as how far the tower reaches.
 *
 * A tower is a hexagonal prism with a door, a parapet, a cap and, on the cannon tower, a gun
 * carriage jutting out over the rail. Its bounding box is the furthest any of that reaches;
 * the wall a banner actually hangs on is a good deal nearer, and hanging off the box is what
 * put a blue rectangle in mid-air beside the mountain's towers. So this walks the geometry
 * instead and takes the furthest vertex inside the strip of shaft the cloth covers.
 *
 * Falls back to the box for a tower with no geometry in that strip at all, which no tower in
 * this pack is: a banner proud of a bounding box is wrong, but a banner nowhere is worse.
 *
 * @param {THREE.BufferGeometry} geo  the tower, in its own model units
 * @param {number} y0
 * @param {number} y1  the band of shaft the banner hangs down
 */
export function faceUnder(geo, y0, y1) {
  const pos = geo.getAttribute('position')
  let z = -Infinity
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i)
    if (py < y0 || py > y1) continue
    if (Math.abs(pos.getX(i)) > BANNER_BAND) continue
    z = Math.max(z, pos.getZ(i))
  }
  if (Number.isFinite(z)) return z
  geo.computeBoundingBox()
  return geo.boundingBox.max.z
}

/**
 * Where a tower stands from the cell's centre, in model units, given the tower's own half-width.
 *
 * Not called at build time — every style carries the literal it produces — but exported so
 * `tests/keep.test.mjs` can re-derive each style's `towerOut` from the glb the towers are
 * actually packed in. That is the whole check on those two numbers: they are a measurement of
 * the pack, and the only way they can go wrong is the pack changing under them.
 *
 * @param {{keepScale: number, towerScale: number}} style
 * @param {number} towerHalfX  the tower's own half-width in model units
 */
export function towerOutFor(style, towerHalfX) {
  return KEEP_HALF_X * style.keepScale + TOWER_GAP + towerHalfX * style.towerScale
}

/**
 * How far behind the cell's centre a *rear* tower stands, in model units, given the extent the
 * turned tower shows the keep.
 *
 * The same three terms `towerOut` is made of, on the other axis: the keep's own half-depth at
 * its own scale, the quarter of a wall unit every tower keeps, and the tower's own reach at its
 * own scale. `towerNearZ` is the tower's `-min.z` rather than its `max.z`, because a rear tower
 * is turned a half turn to point its cannon away from the keep and it is therefore its stern
 * that faces the stone.
 *
 * Not called at build time — the style carries the literal it produces — but exported so
 * `tests/keep.test.mjs` can re-derive it from the glb the towers are actually packed in. That is
 * the whole check on the number: it is a measurement of the pack, and the only way it can go
 * wrong is the pack changing under it.
 *
 * @param {{keepScale: number, towerScale: number}} style
 * @param {number} towerNearZ  the tower's own reach toward the keep, in model units
 */
export function towerRearFor(style, towerNearZ) {
  return KEEP_HALF_Z * style.keepScale + TOWER_GAP + towerNearZ * style.towerScale
}

/**
 * The navigation discs a keep needs *beyond* `clearance` — which is the rear tower, or nothing.
 *
 * `clearance` is the keep's own half-depth and holds the keep. It deliberately does not hold the
 * flank towers and does not need to: every plot is in front of the keep, so no villager's route
 * ever passes a flank. A tower *behind* the keep is the case that claim does not cover — the
 * ceremony cell is three cells from the middle of the map, cells beyond it are dealt to repos
 * like any other, and a villager walking to one would cut straight through the stone. And
 * growing `clearance` to reach it is not available: a disc that held ground 9.16 units behind
 * the cell would swallow the threshold 6.5 in front of it, and an arrival inside an obstacle can
 * never path out of it.
 *
 * So one disc, about the tower's own origin, with `towerRearBlock` as its radius in the tower's
 * own model units — a style literal, measured, like `towerOut` and `towerBack`. About the origin
 * rather than about the piece's centre because that costs a fifth of a unit and saves a
 * measurement, and a navigation obstacle is the right place to err generous.
 *
 * A style that declares `towerRear` and forgets `towerRearBlock` gets `rearBlockFallback`
 * instead of a radius of `NaN`, and the difference is not cosmetic: `Navigation` squares the
 * radius and compares, every comparison against `NaN` is false, and the rear tower would quietly
 * become a piece of stone villagers walk through. A missing measurement has to fail *closed*.
 *
 * World space, composed from the yaw rather than from `matrixWorld`: the colony asks for
 * navigation before the render walk has composed anything, which is the same trap `door()`
 * documents. A point on the group's own z axis lands at
 * `(position.x + z * sin yaw, position.z + z * cos yaw)`.
 *
 * @param {object} style
 * @param {THREE.Vector3} position  the ceremony cell's world position
 * @param {number} yaw  the group's own rotation about y
 * @returns {{x: number, z: number, r: number}[]}
 */
export function rearBlockFor(style, position, yaw) {
  if (style.towerRear === undefined) return []
  const z = style.towerRear * SCALE
  return [
    {
      x: position.x + z * Math.sin(yaw),
      z: position.z + z * Math.cos(yaw),
      r: (style.towerRearBlock ?? rearBlockFallback(style)) * style.towerScale * SCALE,
    },
  ]
}

/**
 * The rear tower's disc for a style that never measured one, in the tower's own model units.
 *
 * Both of the tower's own extents are already in the style, folded into the two offsets — the
 * face it shows the keep comes back out of `towerRear` the way `apronFor` recovers a tower's
 * half-width out of `towerOut`, and both inversions are the same three terms every offset here
 * is made of. What the style does *not* carry anywhere is the tower's *far* face: `towerRear` is
 * measured off the near one, which is the only one the gap between the pieces depends on.
 *
 * So this circumscribes a square of the widest reach it can see rather than the piece's real box,
 * which is the generous way to be wrong about the face it cannot measure. On the pack's cannon
 * tower it comes to 0.751 against the 0.743 the box actually needs and the 0.75 `fortress.js`
 * writes down — so a style that forgets the literal is fenced off no worse than one that has it,
 * and the literal stays the better number because it is a measurement rather than a bound.
 */
function rearBlockFallback(style) {
  const nearZ = (Math.abs(style.towerRear) - KEEP_HALF_Z * style.keepScale - TOWER_GAP) / style.towerScale
  const halfX = (style.towerOut - KEEP_HALF_X * style.keepScale - TOWER_GAP) / style.towerScale
  return Math.SQRT2 * Math.max(nearZ, halfX)
}

/**
 * The walkable clearance kept around the keep's centre — the keep's depth, not the building's
 * span.
 *
 * `Colony._rebuildNavigation` reads this in exactly one place: it pushes a single navigation
 * obstacle at the ceremony's position with radius `clearance + AGENT_RADIUS`, and that disc is
 * all the arrival blocks. It is the keep's own half-depth at its own scale plus half a unit of
 * slack, which is what covers the thing villagers can actually walk into — the keep stands on
 * the cell and the road runs at its front face.
 *
 * It deliberately does not hold the towers, which stand a good deal further out in x. It does
 * not need to: every plot is in front of the keep, so no villager's route ever passes a flank.
 * That was true of the old castle's wall run as well, and for the same reason.
 */
export function clearanceFor(style) {
  return KEEP_HALF_Z * style.keepScale * SCALE + 0.5
}

/**
 * The radius the ground scatter is cleared from — the building's real footprint, plus room.
 *
 * The far edge of the outer tower and then one whole wall unit past it. A tree growing through
 * a tower is the one thing the apron exists to prevent, and the extra unit is what keeps the
 * wood from closing on the keep's flanks: the forest's rim scatter is dense enough that an
 * apron cut to the silhouette leaves trunks touching stone.
 *
 * The outer tower's far edge is recovered from `towerOut` rather than measured again —
 * `towerOut` is the keep's half-width plus the gap plus the tower's, so the tower's own
 * half-width is `towerOut` less the first two, and the far edge is `towerOut` plus that.
 */
export function apronFor(style) {
  const towerHalf = style.towerOut - KEEP_HALF_X * style.keepScale - TOWER_GAP
  return (style.towerOut + towerHalf + WALL_STEP) * SCALE
}

/** A geometry's bounds in its own model units, before it is scaled and placed. */
function modelBox(geo) {
  geo.computeBoundingBox()
  return geo.boundingBox
}

export class Keep {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position  the ceremony cell's world position, y still 0
   * @param {object} style  see the module comment; `kind` is what the colony compares on
   */
  constructor(scene, position, style) {
    this.style = style
    this.group = new THREE.Group()
    // Turned so the keep's front face looks back toward the middle of the colony, the same way
    // the lander's ramp does: local +z is inward, local -z the road out of town.
    this.group.rotation.y = Math.atan2(-position.x, -position.z)
    this.group.position.copy(position)
    this.group.name = style.kind
    scene.add(this.group)
    this.scene = scene
    this.disposed = false

    /** Which ceremony this is, so `Colony.setSetting` knows when it has to swap. */
    this.kind = style.kind
    /** What the colony blocks the crew out of, and what it clears the scatter from. */
    this.clearance = clearanceFor(style)
    this.apron = apronFor(style)
    /**
     * And anything the one clearance disc cannot hold — the rear tower, for a style that has
     * one. Computed here rather than in `_build` for the reason `clearance` is: the colony asks
     * for navigation before the kit has landed. See `rearBlockFor`.
     */
    this.blocks = rearBlockFor(style, position, this.group.rotation.y)

    /** Where villagers appear and vanish, in the group's own frame. See `DOOR_OUT`. */
    this.doorLocal = new THREE.Vector3(0, 0, DOOR_OUT)

    this.material = null

    /** The two banners — the only part of a keep that is not baked, and the only part that moves. */
    this.banners = []
    /** Villagers through the door lately, decaying. See `TRAFFIC_DECAY`. */
    this.traffic = 0

    loadKit()
      .then(() => this._build())
      .catch((err) => console.warn(`${style.kind}: kit not available`, err))
  }

  /**
   * Assemble the keep once the kit is in.
   *
   * Every piece but the two banners is baked into the group's frame on one shared material, so
   * the whole building is a handful of meshes and one draw call's worth of state. The banners
   * are the exception because they are the one thing that moves, and a baked piece has nowhere
   * to turn about — the same reason the gate left its pennant and its door leaves unbaked.
   *
   * The two measurements that decide where the banners hang are taken here rather than written
   * down: the stone directly under the banner, and — where a style stands its towers on a
   * plinth — how high that plinth carries them. Both come off the geometry the kit actually
   * handed back, which means a style can name any tower in the pack and the banner still lands
   * flat on it.
   *
   * A missing node is skipped rather than thrown on: the keep is what the ceremony is *for*,
   * and a repack that drops a banner should cost the village its banner, not its arrivals.
   */
  _build() {
    if (this.disposed) return
    this.material = decorateCellEmissive(
      new THREE.MeshStandardMaterial({ map: atlasTexture(), roughness: 0.75, metalness: 0 })
    )
    const s = this.style
    const towerUnit = SCALE * s.towerScale
    const sides = [-1, 1]

    /**
     * The plinth first, if the style stands its towers on one, because how high it carries
     * them is what the tower and its banner are then placed against. Its own height is in the
     * tower's model units, so it is multiplied by `towerScale` to become an offset in the
     * shared frame `placePart` translates in.
     */
    let lift = 0
    if (s.plinth && hasPart(s.plinth)) {
      for (const side of sides) {
        const geo = part(s.plinth)
        if (!lift) lift = modelBox(geo).max.y
        placePart(this.group, this.material, geo, { x: side * s.towerOut, z: s.towerBack }, towerUnit)
      }
      // The rear tower's own plinth, turned with the tower so the two agree at both ends: both
      // pieces run -0.531…0.580 in z, and turning one and not the other would leave a lip of
      // 0.064 at each end of the base.
      if (s.towerRear !== undefined) {
        const geo = part(s.plinth)
        geo.rotateY(Math.PI)
        placePart(this.group, this.material, geo, { z: s.towerRear }, towerUnit).name = 'rear-plinth'
      }
    }

    // The keep, on the cell, at its own scale. Nothing is placed in front of it.
    if (hasPart(s.keep)) {
      placePart(this.group, this.material, part(s.keep), {}, SCALE * s.keepScale)
    }

    // A tower each side, standing free of the keep's flanks by `TOWER_GAP`.
    let face = 0
    if (hasPart(s.tower)) {
      for (const side of sides) {
        const geo = part(s.tower)
        if (!face) face = faceUnder(geo, BANNER_Y, BANNER_Y + BANNER_TALL)
        placePart(
          this.group,
          this.material,
          geo,
          { x: side * s.towerOut, y: lift * s.towerScale, z: s.towerBack },
          towerUnit
        )
      }
      // A third tower directly behind the keep, turned a half turn so its cannon points out over
      // the mountain rather than into the keep's own back wall. No banner: a banner hangs on the
      // piece's +z face, which here is the two feet of air between it and the keep.
      if (s.towerRear !== undefined) {
        const geo = part(s.tower)
        geo.rotateY(Math.PI)
        placePart(this.group, this.material, geo, { y: lift * s.towerScale, z: s.towerRear }, towerUnit).name =
          'rear-tower'
      }
    }

    /**
     * A banner on each tower's front face, a hair proud of the stone. See `BANNER_OUT`.
     *
     * Hung rather than baked, so it can swing. The pack authors a banner standing *up* from
     * its own origin — the origin is the hem and `BANNER_TALL` up is the rod — and a cloth
     * that turned about its hem would sweep the wall rather than lift off it. So the geometry
     * is dropped its own height, which puts the mesh's origin on the rod, and the same height
     * goes back into `position.y`. The rest pose that comes out is the one `placePart` baked,
     * offset for offset.
     */
    if (s.banners && face && hasPart(s.banner)) {
      for (const side of sides) {
        const geo = part(s.banner)
        geo.scale(towerUnit, towerUnit, towerUnit)
        geo.translate(0, -BANNER_TALL * towerUnit, 0)
        const mesh = new THREE.Mesh(geo, this.material)
        mesh.position.set(
          side * s.towerOut * SCALE,
          (lift + BANNER_Y + BANNER_TALL) * s.towerScale * SCALE,
          (s.towerBack + (face + BANNER_OUT) * s.towerScale) * SCALE
        )
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.name = 'banner'
        this.group.add(mesh)
        this.banners.push(mesh)
      }
    }
  }

  /** World position of the threshold — where villagers appear and vanish. */
  door(out = new THREE.Vector3()) {
    return worldDoor(this.group, this.doorLocal, out)
  }

  /**
   * The two banners stir, and stir harder while the village is using the door.
   *
   * This is the whole of a keep's animation budget — the gate's other trick was opening its
   * leaves and there is no door here to open — and it runs off the simulation clock alone, so
   * a paused colony holds its pose and a re-render of the same instant draws the same frame.
   *
   * The lift is *subtracted*, and which way round that goes is the one thing here worth
   * checking rather than reasoning about. Local +z is inward, toward the road and the colony,
   * and it is the +z face of the stone that `faceUnder` measured the banner onto; a vertex on
   * the cloth's hem at `(0, −h, 0)` turned by `rotation.x = −θ` swings to +z, out over the
   * road. The other sign would push it through the tower. `tests/keep.test.mjs` pins it.
   */
  update(dt, elapsed) {
    this.traffic = Math.max(0, this.traffic - dt * TRAFFIC_DECAY)
    for (let i = 0; i < this.banners.length; i++) {
      this.banners[i].rotation.x = -bannerLift(this.traffic, elapsed, i)
    }
  }

  /**
   * Called when a villager walks through, so the banners pick up. The gate's own arithmetic:
   * one per arrival, capped at `TRAFFIC_MAX`, decaying in `update`. Safe before the kit lands —
   * there is nothing to move yet and the count is waiting when the banners arrive.
   */
  ping() {
    this.traffic = Math.min(TRAFFIC_MAX, this.traffic + 1)
  }

  dispose() {
    this.disposed = true
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose()
    })
    // One material for the whole building, so it is disposed once rather than once per mesh.
    this.material?.dispose()
    this.scene.remove(this.group)
  }
}

/**
 * Build the keep a style describes. The ceremony hook of both `castle.js` and `fortress.js`.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position
 * @param {object} style
 * @returns {Keep}
 */
export function buildKeep(scene, position, style) {
  return new Keep(scene, position, style)
}
