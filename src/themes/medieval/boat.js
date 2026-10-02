import * as THREE from 'three'
import { worldDoor } from '../../world/ceremony.js'
import { coastAxis } from '../../world/setting.js'
import { atlasTexture, decorateCellEmissive, hasPart, loadKit, part } from '../../world/kit.js'
import { DOOR_HOLD, SCALE } from './wall.js'

/**
 * The boat: the valley's arrival, where the forest and the mountain have a keep.
 *
 * A pier runs out from the bank into the sea, and a ship lies made fast across the head of it.
 * When a villager arrives the ship slips its moorings and stands out to sea, holds off while
 * the traffic lasts, and comes back in broadside to its berth. Everything
 * else a ceremony owes the engine is the same as a keep's — `group`, `door`, `update`, `ping`,
 * `dispose`, `kind`, `clearance`, `apron` — and, like a keep, it is packed geometry built after
 * `loadKit()` resolves, so the group goes into the scene empty and `door()` answers from the
 * first frame regardless.
 *
 * **The two heights this thing lives between.** The colony sets `group.position.y` to the
 * terrain height at the ceremony cell, as it does for every arrival — but a pier and a ship
 * do not stand on the ground, they stand in the *water*. The pier stands on the flat plane at
 * `setting.water.level`; the ship and the rowing boat ride the swell, the sea's own `heightAt`
 * handed over through `setSea`. So all three are positioned in the group's own frame against a
 * world height less `group.position.y`, recomputed every frame because the colony moves the
 * group whenever the terrain is rebuilt. That single subtraction is why nothing here floats
 * when the setting changes or the ground is re-seeded.
 */

/**
 * The pier, the ship that ties up at it, and the rowing boat left bobbing beside it.
 *
 * **The ship is the pack's neutral hull:** wood and canvas, with one small pennant each in the
 * faction blue, the red ship's paint and the torch's flame. It used to be `ship_red_full`, and
 * red was chosen because a blue hull on blue water under a blue-trimmed pier was three blues
 * deep and the ship was the thing nobody could find in the frame. A hull that is *neither*
 * answers that better than a red one did — the sails are the brightest thing on the water and
 * the hull is the only timber out there — and it keeps the harbour out of the faction palette
 * entirely. The pier keeps its blue because it is the *village's* colour: every building in the
 * fixture wears the same trim, and a dock in the ship's colours would read as the ship's
 * property rather than as the town's.
 *
 * One consequence is deliberate and worth writing down: the masthead pennant samples cell 26,
 * the one cell in the village that burns (`manifest.js` `pbr`, `torch.mjs`), so it glows after
 * dark like a lamp at the top of the mast. Thirty-six triangles of the hull's 1580.
 */
const DOCK = 'building_docks_blue'
const SHIP = 'ship'
const DINGHY = 'boat'

/**
 * How much bigger than a house the harbour is built.
 *
 * The coast used to sit at `from: 60`, past any cell a zone could be dealt, and from there the
 * whole arrival was forty pixels of the default frame — a pier you had to be told was a pier.
 * Bringing the shore in to 40 fixes where it is; this fixes how big it reads. Villagers are
 * deliberately *not* scaled with it, which is the entire effect: a pier a villager could walk
 * four abreast on is a working harbour, and one cut to their size is a toy.
 *
 * Everything the dock is made of takes it — the pier, the ship and the rowing boat — and every
 * world distance below is measured against the shore the pieces are that size on, rather than
 * multiplied through from the old ones. The two do not agree: the parts grew by half and the
 * bank under them did not, so the pier reaches further down a slope of the same steepness.
 */
export const DOCK_SCALE = 1.5

/** The scale the harbour's own parts are built at. Villagers stay on `SCALE`. */
const DOCK_UNIT = SCALE * DOCK_SCALE

/**
 * How much bigger than the pier the ship is built — its own scale, not the harbour's.
 *
 * The pier and the rowing boat are furniture and stay where `DOCK_SCALE` put them. The ship is
 * the *ceremony*: it is the thing that moves when a villager arrives, and the valley's answer
 * to a keep four storeys high standing on a hill in the other two settings. At the harbour's
 * 1.5 it was 8.85 long — shorter than the pier it tied up to, and about as much of the frame
 * as a hay bale.
 *
 * At 4.4 it is 25.84 long and 11.49 in the beam, more than three times the length of the whole
 * pier, which is the relation a ship and a finger pier actually have when the ship is the thing
 * the harbour was built for. That is also what makes the T berth below possible: a hull this
 * size has no business lying *alongside* 7.8 units of planking, and every arrangement that
 * tried read as a ship parked next to a jetty rather than tied up at one.
 *
 * The masthead now stands 25.59 world units above the waterline, against the mountain keep's
 * 14.48 — so the claim this comment has always made, that the ship is the valley's answer to a
 * keep four storeys high on a hill, is for the first time literally true. `ROLL` is unchanged
 * at 0.035 rad and the lever simply got longer: the masthead swings 0.90 world units where it
 * used to swing 0.45.
 */
export const SHIP_SCALE = 4.4

/** The scale the ship alone is built at. */
const SHIP_UNIT = SCALE * SHIP_SCALE

/**
 * Half the pier's length in world units.
 *
 * The pack authors the dock two model units along its own x — deck from -1 to +1 — with its
 * three pilings in the **+x** half and nothing below the planks in the other. That is the
 * piece telling you which way round it goes: the legged half is the half that stands over
 * water, so the group is turned to put local +x seaward and the bare half comes down on the
 * bank.
 *
 * It carries no water of its own, which is the question a tile-authored piece always raises.
 * `inspect-kit` gives it cells 2, 5, 6, 24, 29, 30 and 31 — stone, two woods, the blue accent
 * and three swatches it shares with `crate_B_small` and `building_shrine_blue` — and no cell
 * anywhere in the kit is the sea. Nor is it a hex tile: `hex_grass` is 2 by 2.31 and this is
 * 2 by 0.5, a plank walkway. So there is nothing to drop and no `solo` to take, which is just
 * as well — the packer gives it one primitive, and a single-primitive node has no children to
 * leave behind.
 */
export const PIER_HALF = 1.0 * DOCK_UNIT

/**
 * How far seaward of the ceremony cell the dock's own origin sits, in world units.
 *
 * A keep stands on its cell and is centred on it. A pier cannot be: it starts on land and
 * *goes somewhere*, and where it has to get to is the water, which on a lattice of 7.6-unit
 * cells is never a whole number of cells away. So the cell is the shore station the pier is
 * anchored from and this is the reach out from it, tuned against two things: the pack puts
 * all three of the dock's pilings in the outer half of the deck and every one of them has to
 * come down past the waterline, and the pack means the landward two fifths to be on the bank.
 *
 * From the valley's cell `{ q: -3, r: 1 }` the waterline is **10.06** along the axis. Eleven
 * puts the 7.8-unit deck from 7.10 to 14.90, so 2.96 of it — thirty-eight per cent, the pack's
 * own proportion — lies on the bank, and the pilings land at 11.43, 13.18 and 14.78, the
 * nearest of them a comfortable 1.37 past the water's edge.
 *
 * It was 7.0 against a waterline 6.10 out. The coast has not moved — `coast.from` is still 40
 * — but the *bank* has: `SHORE_IN`/`SHORE_OUT` run the drop over thirty units instead of
 * eighteen and `depth` came down from 10 to 7, so the ground takes four more units to reach
 * the sea and the waterline sits at d 42.60 rather than 38.77. Every number below is that same
 * four units of shore worked through the harbour, which is why they are re-measured here
 * rather than nudged: two of them did not move at all, and the freeboard more than halved.
 */
export const PIER_OUT = 11.0

/**
 * How far the pier deck rides above the waterline, in world units.
 *
 * A pier is a flat deck and a shore is a slope, so the two can only agree at one point, and
 * this is the choice of where. The valley's bank drops about 0.31 world units for every unit
 * along `coast.axis` through the steep middle of the smoothstep, so the ground under the pier
 * runs from -3.72 at the foot to -6.04 at the head while the deck stays level.
 *
 * The point they agree at is the **foot**, and this is a consequence of `PIER_OUT` rather than
 * a free choice: 0.98 sets the deck at -3.72, which is the ground at d 39.64 to a thousandth,
 * so the planks come down on the bank exactly where they begin. Seaward of that the ground
 * falls away under them and the pilings are 0.98 of visible timber above the sea.
 *
 * **It more than halved, from 2.38, and that is the rule holding rather than breaking.** The
 * rule is *deck equals ground at the foot*; the foot stands about three units inland of the
 * waterline; and the whole batch is about making the ground three units inland of the
 * waterline a metre up instead of two and a half. A gentle beach carries a low jetty. Raising
 * the deck to keep the old number would put daylight under the landward two fifths of the
 * planks — the one arrangement this constant has always refused, in both directions.
 *
 * The pack's pilings reach 3.90 below the dock's origin, so at this freeboard they run 2.92
 * under the surface. That is past the bed at the head (-6.04 against a deck at -3.72) and well
 * into the bank at the foot, both of which are under an opaque sea or under the ground: what
 * the picture shows is a metre of timber between the planks and the water, along the whole
 * seaward half.
 */
export const FREEBOARD = 0.98

/**
 * Half the ship's beam in world units — how far the hull reaches to either side of the line
 * it sails along.
 *
 * The pack authors `ship` from -0.502 to +0.502 across and -1.000 to +1.259 along its own z,
 * bow at +z — the same hull `ship_red_full` was, to the millimetre. At `SHIP_UNIT` that is
 * 11.49 in the beam and 25.84 long.
 */
export const SHIP_BEAM = 0.502 * SHIP_UNIT

/**
 * Where the ship lies when it is berthed and when it is at anchor, as local x in world units.
 *
 * **Broadside across the head of the pier, which is a T.** The ship used to lie *alongside*,
 * parallel to the planks, and at 8.85 long against 7.8 of pier that was the only thing that
 * fitted. It never read as tied up: the pier ran out to sea and the ship ran out to sea beside
 * it, so from the map camera the two were a pair of parallel sticks with water between them
 * and nothing joining them. Turned across the end they make a T, which is the shape a docked
 * ship draws — the pier's line stops at the hull and the hull carries on across it.
 *
 * The number is the geometry, and it is derived rather than chosen: the pier head is at
 * `PIER_OUT + PIER_HALF` = 14.90, the hull's near side stands one world unit off it at 15.90,
 * and the ship's centre line is half a beam further at 21.64. One unit is deliberately small.
 * It is open water the whole way — the bed at the berth is well under the surface and the pack
 * authors the hull from its own origin *upward*, so the ship draws nothing and floats wherever
 * the plane is — and anything more reads as a ship that has missed its mooring rather than one
 * made fast to it.
 *
 * **It moved out by exactly the beam it gained.** Doubling the ship added 2.871 to the
 * half-beam and so 2.871 to this number, which leaves the hull's *near side* at 15.90 to the
 * centimetre — the one bit of water the berth was ever measured against, and the bit
 * `tests/boat.test.mjs` proves is open. What did move a long way is the hull's ends: they run
 * from z -12.92 to +12.92 now instead of -7.20 to +5.72, which is 6.46 units further out on
 * each arm over ground no berth was measured on. That is what the float-at-every-corner test
 * is for.
 *
 * **The berth is where the ship lives**, not where it visits. It used to lie on its mooring
 * at rest and put in when a villager came through, which meant every still of a quiet valley
 * — the default shot included — showed a ship eight units off its own pier, the one thing a
 * harbour is not. So rest is alongside and the *voyage* is the event: `ping()` sends the ship
 * out and it comes back in when the traffic stops. Nothing else changes; the run is the same
 * run, sailed the other way round.
 *
 * `ANCHOR` is where it goes, `SAIL_RUN` further out to sea. Twelve rather than the old eight,
 * because the run has to read as a passage and not a shuffle: at eight it was 62% of the old
 * hull's own length and would have been 31% of this one's, and a ship that moves less than a
 * third of its length has not gone anywhere. Twelve restores 46%. Both ends stay inside the
 * frame: the berth is at d 54.18 and the mooring at d 66.18, against a sea that runs to the
 * horizon past the waterline at 42.60, and the default shot renders the berth rather than the
 * mooring because a quiet valley leaves the ship tied up.
 */
export const BERTH = 21.64
export const SAIL_RUN = 12.0
export const ANCHOR = BERTH + SAIL_RUN

/**
 * How far along the pier's own line the ship's *origin* is pushed, in world units.
 *
 * The pack does not author the ship about its midships: it runs from -1.000 astern to +1.259
 * forward, so its origin sits 1.48 world units aft of the middle of the hull at this scale —
 * `-0.1295 * SHIP_UNIT`, which is the half-sum of those two bounds. Left alone, a ship laid
 * across the pier head would be 14.40 to one side of the planks and 11.44 to the other — a T
 * with a short arm, which reads as a ship that has drifted along its own mooring line. This
 * puts the *hull's* middle on the pier's centre line instead, so the two arms are 12.92 each
 * and the pier meets the ship amidships, where a gangway would be.
 */
export const SHIP_SET = -1.48

/**
 * Seconds the ship takes to cover the run between berth and anchor, either way.
 *
 * 7.5 world units a second, against the 6.67 it used to make — about an eighth faster, not the
 * same speed. The run grew by half and this grew by a third, which is the trade: leaving it at
 * 1.2 would have sailed a hull twice the size at 10 units a second, and a ship that crosses the
 * bay in a second and a fifth reads as a toy being pushed rather than as a ship getting under
 * way. Twelve and a half per cent is inside what the eye reads as the same ship.
 */
export const SAIL_TIME = 1.6

/**
 * The walkable clearance kept around the ceremony cell — the beach, not the pier.
 *
 * Unchanged at 6.5, and for a different reason than it was chosen for.
 *
 * It used to have to reach the water on its own: the grid blocks every cell under
 * `level + SHORE_BAND`, that band used to stop short of the flat bank the pier's foot stood
 * on, and 6.76 — `clearance + AGENT_RADIUS` — was the disc that took in the pier's landward
 * 3.66 and finished 0.66 past the waterline at 6.10.
 *
 * The gentle bank does that job now and does it better. The floor the grid blocks at is
 * crossed **2.47 units landward of the ceremony cell**, so every plank, piling and grain of
 * the beach in front of the dock is already ground no villager can path onto, and the disc has
 * nothing left to fence. What it still buys is margin on the dry bank *behind* the dock: 6.76
 * reaches back to d 25.78, which keeps the crowd off the top of the beach rather than letting
 * it gather on the lip. Growing it with the pier would only have pushed the threshold further
 * from the plots for nothing.
 */
export const CLEARANCE = 6.5

/**
 * The radius the ground scatter is cleared from — the keep's apron argument, on a shore.
 *
 * Thirteen covers the whole pier out to its head at 10.9, the berth beside it at 12, and the
 * run of bank the threshold stands on at 7.5. Most of the disc costs nothing: `createScatter`
 * already refuses to plant anything under `water.level + SHORE_BAND`, so the seaward half was
 * bare before this arrived. What the number buys is the landward half — no hay bale growing
 * through the pier's foot, and none standing on the threshold villagers appear at.
 *
 * It is the one number here that is *not* simply the old one grown: the dock has moved inland
 * from d 55 to d 32.5, so the landward half of the apron now falls on meadow the camera can
 * see rather than on sea. Thirteen was the smallest disc that held all three properties while
 * the ship lay alongside at 12.
 *
 * **Sixteen stands, though the berth has passed it.** It grew to sixteen to hold the T berth
 * at 14.77 with a unit to spare, and the berth is 18.77 now — but a radius is not a reach, and
 * the two properties this disc is for are both landward: nothing growing through the pier's
 * foot at 7.10, and nothing standing on the threshold at -7.5. Seaward it is free either way,
 * because `createScatter` plants nothing under `water.level + SHORE_BAND` and that floor is
 * crossed 2.47 units *landward* of the cell — the whole beach, the whole pier and the whole
 * berth are bare ground before the apron says a word. Twenty would have cleared four more
 * units of meadow the camera can see, to no end.
 */
export const APRON = 16

/**
 * How far landward of the ceremony cell villagers appear and vanish, in world units.
 *
 * Not on the planks, and not on the beach either. The navigation obstacle the colony puts at
 * the cell is a disc of `CLEARANCE + AGENT_RADIUS` — 6.76 — so a door any nearer would put
 * every arrival inside an obstacle it cannot path out of; they would come ashore and stand
 * there for good. Seven and a half clears it by 0.74 and lands on ground at +0.07, which is
 * the colony floor: villagers appear at the top of the bank above the dock and walk straight
 * off toward their plots, rather than climbing out of the surf.
 *
 * With the cell in at d 32.5 the threshold sits at d 25.04, world (-26.81, -7.88) — inside the
 * navigation square by a wide margin now, and among the plots rather than out past them.
 *
 * **It did not move with the pier, and the gentler bank is why it did not have to.** The band
 * reaches five units further inland than the cliff did, so the ground here fell from +0.10 to
 * +0.07 and nothing else changed: the threshold is still dry, still landward of the grid's wet
 * floor — crossed at d 30.07, five units seaward of it — and still 0.74 outside the obstacle.
 * The pier grew seaward; the door is landward; the two never met.
 *
 * **And that is where a pier differs from a keep.** `keep.js` carries a `DOOR_OUT` of 6.5 on
 * the same reasoning, but a keep is centred on its cell and 6.5 units out of a 7.6-unit cell
 * lands inside it whatever bearing it is turned to — the one cell the allocator already
 * reserves. A pier is not centred on anything: its cell is a shore station and the threshold
 * is a different cell entirely, `{ q: -2, r: 0 }`, which nothing reserved.
 * `Colony._blockedCells` reserves the cell under `door()` for every ceremony to close that,
 * which costs the keeps and the lander nothing and is the whole reason arrivals here do not
 * appear on a neighbour's deck.
 */
export const DOOR_OUT = 7.5

/**
 * How far the ship rolls (radians), and how far it bobs (world units) where there is no sea to
 * ride: a harbour whose world has no water system built bobs on a sine about the level instead.
 */
const ROLL = 0.035
const BOB = 0.08

/**
 * How high the rowing boat rides above the surface under its own origin, in world units: the
 * least of it, and the whole of it on the valley's sea. `dinghyLift` sizes it for each sea.
 *
 * It was 0.05 against the old flat sea, whose crest came 0.12 up under a boat that did not
 * follow it. On the valley's swell four hundredths is what shows on an ordinary frame, a
 * rowing boat just proud of the water under it, which is not enough to read as hovering.
 */
export const DINGHY_LIFT = 0.04

/**
 * The rowing boat's lift over a swell of `waveHeight` (the setting's `water.waveHeight`).
 *
 * Re-derived on 2026-09-30, when the boats began riding upstream's swell (`heightAt`) instead
 * of a sine over a flat sea. A boat placed on the surface at its origin meets the water level
 * there; what can still come through the floor is the surface *rising* between the origin and
 * the edge of the hull. The swell is four sines (`WAVES` in `water.js`), so its steepest
 * possible slope is `waveHeight` times the sum of each wave's amplitude times its wavenumber,
 * 1.1795, and the pack's `boat` at `DOCK_UNIT` is 0.585 by 1.170 either way of its origin, a
 * corner 1.31 out. So the surface can stand at most 1.545 × `waveHeight` over the origin
 * anywhere under the hull, and the floor is 0.12 above it. The lift is the difference, with
 * half a hundredth to spare: on the valley's 0.1 that is 0.0395, under `DINGHY_LIFT`; on
 * Shoreline's 0.14, 0.101; on Archipelago's 0.18, 0.163.
 *
 * That is the bound with every wave at its steepest, in step, along the hull's diagonal, which
 * no frame of the swell actually lines up, so an ordinary frame shows the boat riding a little
 * higher than it needs to; a floor with the sea coming through it would show on any frame.
 */
export const dinghyLift = (waveHeight = 0) => Math.max(DINGHY_LIFT, 1.545 * waveHeight - 0.12 + 0.005)

/**
 * Where the rowing boat is left, in the group's own frame.
 *
 * Landward of the pier head and beside the planks — whose far edge is at -0.98 — so it reads
 * as tied to them. It used to sit at 9.0, three quarters of the way out, which was the far
 * side of a pier the ship lay alongside. The ship crosses the head now and its hull comes in
 * to 15.90, so out there the dinghy would be under a bow.
 *
 * **12.4, which is the one number that had to move further than the pier did.** At 8.0 it was
 * 2.06 *inside* the new waterline — a rowing boat sitting on a sand bar — because the
 * waterline went out four units and the dinghy's whole clearance was under two. The pack gives
 * it 0.585 by 1.170 at `DOCK_UNIT`, and turned 0.6 on its mooring that reaches 1.14 landward
 * of its origin, so 12.4 puts its landward corner at 11.26 — 1.20 past the water's edge at
 * 10.06 — and 3.50 clear of the berthed hull. Three quarters of the way out along a deck that
 * runs 7.10 to 14.90, which is where it has always lain.
 */
export const DINGHY_AT = { x: 12.4, z: -2.4 }

/**
 * Smoothstep, so the run out and the run home both start and finish at rest.
 *
 * Deliberately not `damp`, which the old gate's doors used: a damped value approaches its
 * target and never arrives, and this one has to *arrive* — the ship must be exactly on its
 * mooring while the hold lasts and exactly back alongside afterwards, or a quiet valley
 * renders a hair different every time.
 */
const ease = (t) => t * t * (3 - 2 * t)

/**
 * Where the ship lies along the water axis for a given voyage clock — 0 alongside, 1 on the
 * mooring — in the group's own frame.
 *
 * The one place the two ends of the run are put together, so `_float` and
 * `tests/boat.test.mjs` cannot disagree about which of them is the rest pose. That is worth a
 * function of its own precisely because it has just been turned round.
 */
export const shipAt = (voyage, berth = BERTH) => berth + (berth + SAIL_RUN - berth) * ease(voyage)

export class Boat {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position  the ceremony cell's world position, y still 0
   * @param {object} [setting]  the setting this is standing in; its `water` is the sea level,
   *   and its `ceremony` may move the pier and the berth out (`pierOut`, `berth`)
   */
  constructor(scene, position, setting) {
    // Whichever way the sea lies from the dock: the valley's own axis, a coast's bearing, or
    // straight out from an island's middle — see `coastAxis`.
    const [ax, az] = coastAxis(setting, position) ?? [1, 0]
    this.group = new THREE.Group()
    // Turned so local +x runs seaward along that axis: a group rotated by θ about y sends
    // local (1, 0, 0) to (cos θ, 0, -sin θ), so θ = atan2(-az, ax) is the turn that lands it
    // on the axis. Local -x is therefore the road back into the village, which is the
    // direction the door and the pier's landward half both take.
    this.group.rotation.y = Math.atan2(-az, ax)
    this.group.position.copy(position)
    this.group.name = 'boat'
    scene.add(this.group)
    this.scene = scene
    this.disposed = false

    /** Which ceremony this is, so `Colony.setSetting` knows when it has to swap. */
    this.kind = 'boat'
    /** What the colony blocks the crew out of, and what it clears the scatter from. */
    this.clearance = CLEARANCE
    this.apron = APRON

    /**
     * Where the sea is. A setting with no `water` — a boat asked for on dry land — moors the
     * ship on the ground rather than throwing: the ceremony is what the village arrives
     * through, and it has to exist even when the setting it is in makes no sense.
     */
    this.waterLevel = setting?.water?.level ?? 0
    /** How high the rowing boat rides over this sea's swell. See `dinghyLift`. */
    this.dinghyLift = dinghyLift(setting?.water?.waveHeight)

    /**
     * How far out the pier stands and the ship berths, in the group's frame. `PIER_OUT` and
     * `BERTH` were measured on the valley's bank; a shore the constants were not tuned for —
     * Shoreline's long beach, the island's — names its own in the setting's `ceremony`, measured
     * the same way (see the notes there). The mooring and the rowing boat keep their places
     * relative to them: the one `SAIL_RUN` past the berth, the other where it lies beside the
     * pier. The valley names neither, so every number it builds with is the constant itself.
     */
    this.pierOut = setting?.ceremony?.pierOut ?? PIER_OUT
    this.berth = setting?.ceremony?.berth ?? BERTH

    /** Where villagers appear and vanish, in the group's own frame. See `DOOR_OUT`. */
    this.doorLocal = new THREE.Vector3(-DOOR_OUT, 0, 0)

    this.material = null
    this.dock = null
    this.ship = null
    this.dinghy = null

    /**
     * The voyage clock: 0 alongside, 1 out on the mooring, moving at one over `SAIL_TIME`.
     *
     * Zero is the berth rather than the mooring, which is the whole of the rest pose: a boat
     * nobody has pinged is a boat tied up at its own pier, and a valley left alone renders as
     * a harbour with a ship in it.
     *
     * Kept as a plain number rather than read back off the ship, so the passage is the same
     * whether or not the kit has loaded — `tests/boat.test.mjs` drives it with a fixed dt and
     * never touches geometry, and a village whose glb is still in flight keeps its clock.
     */
    this.voyage = 0

    /** Simulation time the ship stays out at anchor until. `ping()` pushes it out. */
    this.openUntil = -Infinity

    /**
     * Last frame's simulation clock. `ping()` is handed no time of its own and must not read
     * a wall clock — the visual harness fakes one — so it dates the hold from the frame that
     * has just been drawn, exactly as `keep.js` explains.
     */
    this.elapsed = 0

    /** The sea's surface, `(x, z, elapsed) => y`, once the colony hands one over. See `setSea`. */
    this.sea = null

    loadKit()
      .then(() => this._build())
      .catch((err) => console.warn('boat: kit not available', err))
  }

  /**
   * Lay the pier and launch the ship, once the kit is in.
   *
   * All three pieces are nodes of their own rather than baked into the group: the ship sails,
   * the rowing boat bobs, and the pier itself has to be moved in y whenever the terrain under
   * the cell changes. They share one material all the same, so the whole arrival is three
   * meshes on one atlas.
   *
   * A missing node is skipped rather than thrown on, as in a keep: a repack that loses
   * the rowing boat should cost the village its rowing boat, not its arrivals.
   */
  _build() {
    if (this.disposed) return
    this.material = decorateCellEmissive(
      new THREE.MeshStandardMaterial({ map: atlasTexture(), roughness: 0.75, metalness: 0 })
    )

    // The dock is laid out seaward of the cell rather than on it, so its pilings reach past
    // the waterline. See `PIER_OUT`.
    if (hasPart(DOCK)) {
      this.dock = this._mesh(DOCK)
      this.dock.position.x = this.pierOut
    }

    if (hasPart(SHIP)) {
      // At its own scale, not the harbour's: everything else here is furniture. See
      // `SHIP_SCALE`.
      this.ship = this._mesh(SHIP, SHIP_UNIT)
      // The pack authors the ship along its own z, bow at +z, and the group's own z runs
      // *across* the water axis — so the ship is left unturned and lies broadside to the
      // shore, which is the T berth. That also leaves `rotation.z` as the hull's own long
      // axis, which is what makes the swell a roll rather than a pitch.
      this.ship.position.z = SHIP_SET
      // The middle of the hull in the ship's own frame, which is where its creak comes from
      // (`soundAt`). Measured once: the geometry never changes after this.
      this.ship.geometry.computeBoundingBox()
      this.hullMid = this.ship.geometry.boundingBox.getCenter(new THREE.Vector3())
    }

    if (hasPart(DINGHY)) {
      this.dinghy = this._mesh(DINGHY)
      this.dinghy.position.x = DINGHY_AT.x + (this.pierOut - PIER_OUT)
      this.dinghy.position.z = DINGHY_AT.z
      this.dinghy.rotation.y = 0.6
    }

    this._float(0)
  }

  /**
   * One kit part at the harbour's scale, on the shared material, as a node that can move.
   *
   * `DOCK_UNIT` rather than `SCALE`: the pier and the rowing boat are built half again as big
   * as the village they serve and the villagers walking past them are not. See `DOCK_SCALE`.
   * The ship passes `SHIP_UNIT` instead, because it is the arrival rather than the furniture.
   */
  _mesh(node, unit = DOCK_UNIT) {
    const geo = part(node)
    geo.scale(unit, unit, unit)
    const mesh = new THREE.Mesh(geo, this.material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    return mesh
  }

  /**
   * Hand the harbour the sea's own surface, `(x, z, elapsed) => y` in world units — upstream's
   * `heightAt`, the same sum of waves the water's vertex shader draws — or `null` where the world
   * has no water system built. `Colony._buildTerrain` calls it after every sea it builds, since
   * a rebuilt sea is a new object. Only the boat takes one; a castle or a fortress has nothing
   * that floats.
   */
  setSea(heightAt) {
    this.sea = heightAt
    this._float(this.elapsed)
  }

  /**
   * Put everything that floats at the height of the sea, and the ship where its voyage says.
   *
   * The group hangs off the terrain, so a world height `y` is the local `y - group.position.y`
   * — recomputed here rather than cached, because `Colony._buildTerrain` moves the group every
   * time the ground is rebuilt. The pier stands on the level, since its planks do not bob. The
   * ship and the rowing boat ride the swell under their own origins (`setSea`): the sea's
   * height there, which is what makes the ship rise and fall with the very crest drawn under
   * it rather than on a rhythm of its own. With no sea handed in, both bob on a sine about the
   * level, as they did over the flat sea the valley had until 2026-09-30.
   */
  _float(elapsed) {
    const sea = this.waterLevel - this.group.position.y
    if (this.dock) this.dock.position.y = sea + FREEBOARD
    if (this.ship) {
      this.ship.position.x = shipAt(this.voyage, this.berth)
      this.ship.position.y = this.sea ? this._surface(this.ship.position, elapsed) : sea + Math.sin(elapsed * 0.9) * BOB
      this.ship.rotation.z = Math.sin(elapsed * 0.7) * ROLL
    }
    if (this.dinghy) {
      // Lifted clear of the crests — see `dinghyLift`. With no sea, half the ship's period and
      // a third of its throw: a rowing boat is lighter than a ship and rides a swell faster.
      this.dinghy.position.y = this.sea
        ? this._surface(this.dinghy.position, elapsed) + this.dinghyLift
        : sea + this.dinghyLift + Math.sin(elapsed * 1.8 + 1.1) * BOB * 0.35
      this.dinghy.rotation.z = Math.sin(elapsed * 1.4 + 0.4) * ROLL * 2
    }
  }

  /**
   * The sea's surface under a point in the group's own frame, as a local `y`.
   *
   * The group is only ever turned about `y` and stands in the scene itself, so its frame is put
   * back by hand — local `(x, z)` turned by `rotation.y` and moved by `position` — rather than
   * through `matrixWorld`, which is still the identity on the frame a colony is built or a
   * setting swapped (see `worldDoor`).
   */
  _surface(local, elapsed) {
    const g = this.group
    const cos = Math.cos(g.rotation.y)
    const sin = Math.sin(g.rotation.y)
    const x = g.position.x + local.x * cos + local.z * sin
    const z = g.position.z - local.x * sin + local.z * cos
    return this.sea(x, z, elapsed) - g.position.y
  }

  /** World position of the threshold — where villagers appear and vanish. */
  door(out = new THREE.Vector3()) {
    return worldDoor(this.group, this.doorLocal, out)
  }

  /**
   * Where the harbour's noise comes from, in world space: the middle of the hull once the kit
   * has landed, so the creak is the ship's and follows it out to its mooring and back; the
   * head of the pier before that. Composed from the group's own transform, as `door()` is.
   */
  soundAt(out = new THREE.Vector3()) {
    if (this.ship && this.hullMid) out.copy(this.hullMid).applyEuler(this.ship.rotation).add(this.ship.position)
    else out.set(this.pierOut, this.waterLevel - this.group.position.y + FREEBOARD, 0)
    return worldDoor(this.group, out, out)
  }

  update(dt, elapsed) {
    this.elapsed = elapsed

    /**
     * The passage, at a constant rate with the easing on top.
     *
     * A fixed rate is what makes `SAIL_TIME` mean what it says and what lets the clock land
     * exactly on 0 and 1: the ship is on its mooring 1.2 s after the ping and back alongside
     * 1.2 s after the hold runs out, to the bit, every run. Landing exactly on 0 is what
     * matters most now, because 0 is the pose a quiet valley is rendered in.
     */
    const target = elapsed < this.openUntil ? 1 : 0
    const step = dt / SAIL_TIME
    this.voyage = target > this.voyage ? Math.min(target, this.voyage + step) : Math.max(target, this.voyage - step)

    this._float(elapsed)
  }

  /**
   * Called when a villager comes through: the ship stands out to sea.
   *
   * The hold is dated from the moment the ship *arrives* on its mooring rather than from the
   * ping, so the 1.5 s it lies off is 1.5 s of lying off and not 0.3 s of it behind 1.2 s of
   * sailing. A second ping while it is already out at anchor does the same arithmetic from
   * that moment — `SAIL_TIME + DOOR_HOLD` ahead of the new ping — so it pushes the run home
   * back by 2.7 s rather than restarting the passage or being ignored.
   */
  ping() {
    this.openUntil = this.elapsed + SAIL_TIME + DOOR_HOLD
  }

  dispose() {
    this.disposed = true
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose()
    })
    // One material for the whole arrival, so it is disposed once rather than once per mesh.
    this.material?.dispose()
    this.scene.remove(this.group)
  }
}

/** Ceremony hook: the dock and the ship that calls at it. */
export function ceremony(scene, position, _manifest, setting) {
  return new Boat(scene, position, setting)
}
