import * as THREE from 'three'
import { attachMatrixAt, decorateSkinned, frameFor } from './crew.js'
import { bonePlan, characterFor, clipFor, colourwayFor, crewCharacters, hash, strideRate, wornBy } from './cast.js'
import { MAX_EXPANSIONS, slideCounts } from './navigation.js'
import { bendPoint, withCurve } from '../core/curve.js'
import { reflectionUniforms } from '../world/reflections.js'
import { animateFace } from './face-animation.js'
import { Props as CheckProps, CHECK_LEN, CHECK_EVERY, pickProp } from './props.js'
import { featureRng, isolated } from '../core/rng.js'

/**
 * Every astronaut in the colony, drawn in seven draw calls.
 *
 * The body is one instanced, GPU-skinned mesh playing KayKit's hand-animated clips (see
 * `crew.js`) — every torso, arm and leg in the colony in a single draw, whether there are
 * six threads or three hundred. Everything the crew *wears* stays procedural and stays in
 * its own `InstancedMesh`: helmet, visor, screen-face, backpack, antenna and lamp, because
 * those carry the colony's own identity and its own shaders.
 *
 * Worn parts are pinned to bones the cheap way. The baked animation lives in an ordinary
 * array as well as in the texture the shader samples, so placing a helmet is one matrix
 * read out of that array — no skeleton is evaluated on the CPU, and the helmet can never
 * be a frame out of step with the head it sits on.
 *
 * Per-agent variation that would normally need a separate material rides along as instanced
 * attributes instead: suit colour and eye colour through `instanceColor`, the face's atlas
 * frame and the body's animation frame through custom `aFrame` attributes.
 *
 * Picking is done analytically rather than by raycasting the instanced meshes — projecting
 * N head positions to screen space is both cheaper and far more forgiving to click at the
 * size these characters render.
 */

/** Trim + eye colour per behaviour. Eyes are pushed past 1.0 so the bloom pass catches them. */
const AGENT_LOOK = {
  working: { trim: 0x4f9a63, eye: [0.35, 2.5, 1.15] },
  waiting: { trim: 0x4f7ec9, eye: [0.45, 1.5, 3.0] },
  blocked: { trim: 0xc94f4f, eye: [3.0, 0.5, 0.45] },
  celebrating: { trim: 0xc9a24f, eye: [2.9, 2.1, 0.6] },
  idle: { trim: 0x8b8b85, eye: [1.1, 1.5, 1.7] },
  resting: { trim: 0x75757a, eye: [0.95, 1.2, 1.6] },
  sleeping: { trim: 0x5a5a70, eye: [0.7, 0.8, 1.4] },
  spawning: { trim: 0xc96442, eye: [2.4, 1.4, 0.7] },
  leaving: { trim: 0x6f7f75, eye: [1.0, 1.0, 1.1] },
}

const WALK_SPEED = 2.1

/**
 * Who survives a display cap: the ones that want you, then the ones doing something
 * (upstream 668b4b0). A helper ranks after every thread, whatever its status — a subagent is
 * worth a slot only once its parent has one.
 */
const ROSTER_RANK = { blocked: 0, waiting: 1, working: 2, celebrating: 3, idle: 4, sleeping: 5 }
export const rosterRank = (entry) => (ROSTER_RANK[entry.status] ?? 6) + (entry.cue ? 10 : 0)

/** The helmet radius the check props (upstream's phone) are sized off. */
const CHECK_PROP_R = 0.48
const TURN_RATE = 7.5
/**
 * How many astronauts may walk out of the ship in one reconcile. The rest of a big arrival —
 * a reload, a first run, a hidden repo being shown again — are placed on their plots instead.
 */
const MAX_ENTRANCE = 6
/** Around the ramp, where an astronaut standing still blocks everyone still coming out. */
const DOORWAY_CLEAR = 5.5
/**
 * How many times an astronaut that has given up inside `DOORWAY_CLEAR` is turned round and
 * sent at its site again before it is allowed to keep the ground it reached.
 *
 * The retry exists for a *queue*: a handful arriving together shove each other around the
 * ramp for a few seconds, and one of them claiming the doorway as its site would leave the
 * rest a permanent wall. A queue clears in that time — each stuck window is eight seconds, so
 * two retries is about twenty-four seconds of patience from the first refused step. What is
 * left after that is not a crowd, it is geometry, and an astronaut re-routing at it forever is
 * the thing this number stops: without a bound the branch reset the clock and asked for a new
 * path on every window, so an astronaut that could never clear the door never settled at all
 * (found 2026-09-13, a helper wedged three units out from the keep in `forest-day-helpers`).
 */
const DOOR_RETRIES = 2
/** How far a roster site has to move before it counts as a different site. */
const SITE_MOVED = 0.05

/** How close counts as "reached this waypoint". A shade over one nav cell. */
const WAYPOINT_REACHED = 0.55
/**
 * How far apart astronauts hold each other, measured against the widest thing they wear:
 * the helmet is 0.95 across, so anything under that is a spacing at which they are visibly
 * inside one another. The old 0.72 was exactly that — separation *was* running and holding
 * them at 0.71, which is a quarter of a helmet of overlap. This leaves real air: a
 * crowd pressed in from every side settles a little tighter than the radius asks for.
 *
 * It does not shrink with `agent.size`, and neither do CONTACT or ARRIVE_RADIUS: helpers
 * stand on their parent's ring at the radius the ring already has, the distance is measured
 * against the widest thing a *villager* wears, and a half-height body standing at it simply
 * keeps more air than it needs. Scaling it per agent would pull helpers into the parent they
 * came out of and change where every adult stands on a mixed plot.
 */
const SEPARATION = 1.15
/** Touching distance: a shade over the helmet, which is the widest thing they wear. */
const CONTACT = 1
/**
 * How close an idler has to get to the spot it wandered at before it calls that arriving,
 * and how briskly it ambles there.
 *
 * Both exist to keep a drifting agent's speed *above* the threshold that puts it in a walk
 * clip for the whole leg. `_walk` eases off as it closes, so stopping at a generous radius
 * is what stops the last stretch being a crawl — and a crawl is movement the standing clip
 * cannot express, so it reads as an astronaut gliding across the deck.
 */
const DRIFT_ARRIVE = 0.9
const DRIFT_PACE = 0.55
/**
 * How close to its site counts as arrived. Deliberately derived from SEPARATION and larger
 * than it: if an astronaut had to get closer than its neighbours will let it, one standing
 * on a busy spot could never finish arriving, and would spend the rest of its life shoving
 * at the crowd it was trying to join.
 */
const ARRIVE_RADIUS = SEPARATION + 0.45
/** Paths computed per frame. Re-routing the whole crew takes a few frames, unnoticeably. */
const PATH_BUDGET = 6
/**
 * And how much *searching* those six may do between them.
 *
 * A short hop costs a hundred expansions and a route across the lattice costs twenty thousand,
 * so counting searches alone lets six long ones stack into a twenty-millisecond frame. One
 * allowance, shared: a long route crowds out the short ones for that frame instead.
 */
const FRAME_EXPANSIONS = MAX_EXPANSIONS

/**
 * The mannequin is authored 2.2 units tall. The colony wants a "little guy" silhouette at
 * the isometric rest distance, and the buildings are sized against one — so the whole rig
 * is scaled once, here, and every worn part below is measured in the *scaled* character's
 * own units so the helmet does not have to be re-tuned when this moves.
 *
 * A per-agent `agent.size` rides on top of it, for the helpers: the subagents of a live
 * thread are drawn at half height (2026-09-12), and because it multiplies into the root
 * matrix every worn part comes along without knowing about it.
 */
const CREW_SCALE = 0.56

/**
 * What a walking astronaut should do about the ground it is standing on, the moment it has
 * either arrived or given up on arriving.
 *
 * - `arrive` — it is where it meant to be. Stand there.
 * - `adopt` — it will never reach its site, so the ground it got to becomes its site. Right
 *   for a site something was built on top of between polls: an astronaut shouldering a wall
 *   forever is worse than one standing a little short of where it meant to be, and the next
 *   poll hands it a site that has been checked against the grid.
 * - `retry` — give up on giving up: reset the clock, ask for a new path, walk at it again.
 *   Only inside the doorway, and only `DOOR_RETRIES` times. Adopting there is what the retry
 *   exists to stop, because an astronaut that claims the ramp leaves the queue behind it a
 *   permanent wall; but a doorway that is still refusing after the retries are spent is not a
 *   queue, and looping at it forever is worse than standing in it.
 *
 * Pure, and called only when `arrived || stuck`, so `node --test` can hold the whole table.
 *
 * @param {boolean} arrived      within `ARRIVE_RADIUS` of its site
 * @param {boolean} stuck        blocked for eight seconds, or walking for forty-five
 * @param {boolean} inDoorway    held up in the doorway, as `doorwayQueued` judges it: within
 *   `DOORWAY_CLEAR` of the door and not proven routeless — no route is geometry, not a queue
 * @param {number}  doorRetries  doorway retries already spent on this leg
 * @returns {'arrive'|'adopt'|'retry'}
 */
export function giveUpAt(arrived, stuck, inDoorway, doorRetries, limit = DOOR_RETRIES) {
  if (!stuck) return 'arrive'
  if (inDoorway) return doorRetries < limit ? 'retry' : 'adopt'
  return arrived ? 'arrive' : 'adopt'
}

/**
 * Should a scan that hands an agent `site` leave it seated where it gave up?
 *
 * An agent that adopts its ground overwrites its site with where it stands, so without a
 * memory the next poll's site — the very one it abandoned — looks like a new journey and it
 * sets off at the same wall for another eight seconds, every poll for as long as the site
 * stays unreachable. `gaveUp` is that memory: the site it walked away from, and the grid
 * `layout` it failed against.
 *
 * It holds only while both are unchanged. A site that has moved is a new journey; a grid whose
 * blocked cells have changed — a building up, a ruin down — may have opened the way, and one
 * more try is cheap next to an agent parked for good on the wrong spot.
 *
 * @param {{x: number, z: number, layout: number} | null} gaveUp
 * @param {{x: number, z: number}} site  the site this scan hands the agent
 * @param {number} layout                the navigation grid's current `layout`
 * @returns {boolean}
 */
export function staysGivenUp(gaveUp, site, layout) {
  if (!gaveUp) return false
  return gaveUp.layout === layout && Math.hypot(site.x - gaveUp.x, site.z - gaveUp.z) <= SITE_MOVED
}

/**
 * How long an agent has to be *refused* before it gives up, and how long a walk may last
 * whatever happens.
 *
 * The eight seconds are the same eight seconds they always were; what changed is what they are
 * measured on. `agent.blocked && agent.stateAge > 8` asked "has this walk been going eight
 * seconds, and was the last step refused" — so a villager that walked happily for eight seconds
 * and then took one bad step at a corner gave up a route it was most of the way along. That is
 * the real-data valley case. The clock below only runs while the agent is actually getting
 * nowhere, and any frame of real progress puts it back to zero.
 */
const STUCK_BLOCKED_S = 8
const STUCK_WALK_S = 45

/**
 * Has this walk failed?
 *
 * Pure, so the table can be held in `node --test` rather than inferred from a colony.
 *
 * @param {number} blockedFor  seconds of refused steps since the last real progress
 * @param {number} stateAge    seconds since this walk began
 * @returns {boolean}
 */
export function isStuck(blockedFor, stateAge, blockedLimit = STUCK_BLOCKED_S, walkLimit = STUCK_WALK_S) {
  return blockedFor > blockedLimit || stateAge > walkLimit
}

/**
 * How far along its path an agent is, given where it actually stands.
 *
 * A waypoint used to be retired on distance alone, and distance alone is not enough: the corners
 * A* hands back sit on cell centres, `WAYPOINT_REACHED` is a shade over one cell, and an agent
 * cutting the inside of an L-shaped wall passes within that radius of the corner *before* it can
 * see round it. Retiring there points it at the next waypoint and straight into the wall, where
 * it presses until the give-up fires. So the next leg has to be walkable from where the agent is
 * standing now, which is precisely what the grid's line-of-sight test answers.
 *
 * The last waypoint is the site itself and is never retired here — arriving is `_step`'s job.
 *
 * @param {{x: number, z: number}[]} path
 * @param {number} pathAt  the waypoint being steered at
 * @param {number} x       where the agent actually is
 * @param {number} z
 * @param {{lineOfSight: (x0: number, z0: number, x1: number, z1: number) => boolean}} nav
 * @returns {number} the waypoint to steer at now
 */
export function retireWaypoints(path, pathAt, x, z, nav) {
  let at = pathAt
  while (at < path.length - 1) {
    const wp = path[at]
    const dx = wp.x - x
    const dz = wp.z - z
    if (dx * dx + dz * dz > WAYPOINT_REACHED * WAYPOINT_REACHED) break
    const next = path[at + 1]
    if (!nav.lineOfSight(x, z, next.x, next.z)) break
    at++
  }
  return at
}

/**
 * Is a stuck agent near the door held up by a queue, and so owed a doorway retry?
 *
 * A queue is other agents, and they are not on the navigation grid — so an agent whose site is
 * walled off from the ground the door stands on is up against geometry, and turning it round at
 * the door only delays the give-up it is certain to reach. One whose site is joined to the rest
 * of the colony may be waiting on a crowd.
 */
export const doorwayQueued = (nearDoor, routeless) => nearDoor && !routeless

/**
 * Should an agent that adopts its ground remember the site it gave up on?
 *
 * Not in the doorway. Remembering keeps it seated for as long as the grid holds still, and an
 * agent seated on the ramp for good is the wall `DOOR_RETRIES` exists to stop; forgetting lets
 * the next poll send it walking again, which is at least a chance of clearing the way.
 */
export const remembersGiveUp = (nearDoor) => !nearDoor

/**
 * The ring a working agent walks round its building on.
 *
 * Its distance from the anchor, as it always was — but for an agent that gave up short of its
 * site that distance is measured from ground it adopted, which may be across the map, and a
 * ring that size is a walk through other plots every few seconds for as long as it stays given
 * up. So the ring is held to the one its abandoned site was on, plus a unit of slack. An agent
 * that gave up a step short is inside the slack and walks the ring it always did.
 *
 * @param {{x: number, z: number}} site
 * @param {{x: number, z: number}} anchor
 * @param {{x: number, z: number} | null} gaveUp
 */
export function workRadius(site, anchor, gaveUp) {
  const radius = Math.max(1.6, Math.hypot(site.x - anchor.x, site.z - anchor.z))
  if (!gaveUp) return radius
  return Math.min(radius, Math.max(1.6, Math.hypot(gaveUp.x - anchor.x, gaveUp.z - anchor.z)) + 1)
}

export class Astronauts {
  /**
   * How close to its site counts as standing on it.
   *
   * Published on the class because the visual harness counts the crew that actually reached the
   * site the roster gave them (`onSite` in each shot's counters), and a second copy of the
   * number over there would drift away from this one without anything failing.
   */
  static ARRIVE_RADIUS = ARRIVE_RADIUS

  constructor(scene, settings, theme) {
    this.scene = scene
    this.settings = settings
    this.theme = theme
    /**
     * Upstream's space-only crew systems — the phone check (`phoneCheck`), walking faces and
     * the CRT screen-face (`faces`) and local visor reflections (`visor`), merged from d05ac2f —
     * run only where the theme declares them. Every one of them allocates or draws, so each does
     * it on its own stream: the global one is what the crew is seated from.
     */
    this.features = theme.features
    this.reflectionUniforms = this.features.visor ? isolated(featureRng('visor'), reflectionUniforms) : null
    /** Colony status → clip key, from the theme. Nothing here names a clip itself. */
    this.stateClips = theme.manifest.stateClips
    /** The bodies this crew comes in. A single-body crew is a one-entry list. */
    this.characters = crewCharacters(theme.manifest.crew)
    this.colourways = theme.manifest.crew.colourways || 1
    this.textured = Boolean(theme.manifest.crew.characters?.length)
    this.agents = []
    this.byId = new Map()
    this.capacity = 0
    /**
     * Which cues have had their parts built. A cue costs nothing until an agent carrying it
     * spawns, and nothing is built twice; a `maxAgents` rebuild drains this and builds them
     * again, so a helper standing on the map keeps its cap across a settings change.
     */
    this.cuesBuilt = new Set()
    /** Set by the colony: `(agent)` for each agent that walks out of the arrival as new. */
    this.onEntrance = null
    this.group = new THREE.Group()
    this.group.name = 'astronauts'
    scene.add(this.group)

    /** Expression atlas from the theme: the painter plus the frame names it draws. */
    this.faces = theme.hooks.faces(theme.manifest)
    this.faceTexture = this.faces.build(this._faceAtlasSize())
    this._buildMeshes(Math.max(64, settings.get('maxAgents')))

    // Reusable scratch — allocating inside the frame loop is what makes GC hitch.
    this._m = new THREE.Matrix4()
    this._m2 = new THREE.Matrix4()
    this._m3 = new THREE.Matrix4()
    this._m4 = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._e = new THREE.Euler()
    this._v = new THREE.Vector3()
    this._one = new THREE.Vector3(1, 1, 1)
    this._color = new THREE.Color()
    this._wp = new THREE.Vector3()
    this._sep = new THREE.Vector3()
    this._pickBadge = new THREE.Vector3()
    this._pickLifted = new THREE.Vector3()
    /** The agents in instance order, as last drawn — what the visor reflections anchor on. */
    this._drawnAgents = []
    /** Uniform bucket grid for the separation query, so it stays O(n) as the crew grows. */
    this._buckets = new Map()
    this.nav = null
  }

  // ── construction ────────────────────────────────────────────────────────────────────

  /** Upstream draws the CRT face at twice the texels; the village never samples the atlas. */
  _faceAtlasSize() {
    return this.features.faces ? Math.min(this.settings.textureSize * 2, 1024) : Math.min(this.settings.textureSize, 512)
  }

  _buildMeshes(capacity) {
    this.capacity = capacity
    const parts = (this.parts = {})

    /**
     * Worn geometry from the theme: what a helmet *is* lives there, and the engine only
     * knows it has a bone, an offset and a tint rule. Asked for here rather than in the
     * constructor because a `maxAgents` change disposes every part and rebuilds — so each
     * build gets geometry and materials it owns outright.
     */
    this.props = this.theme.hooks.props(this.theme.manifest, { reflections: this.reflectionUniforms })

    /** The one part drawn with the expression atlas, kept by role rather than by name. */
    this.faceMesh = null

    for (const spec of this.props.parts) {
      this._checkBone(spec)
      // The face's material samples the expression atlas, which is the engine's own; every
      // other part brings its material with it.
      // Only a face-screen crew has a face part, so whichever material it gets is the `faces`
      // stream's: switching the CRT off must not spend the global stream on the plain one.
      const material = spec.role === 'face' ? isolated(featureRng('faces'), () => this._faceMaterial()) : spec.material
      // A prop that names a node in the crew glb has no geometry of its own until the rig
      // lands, so it is built on an empty one and `setRig` swaps the real thing in.
      const geometry = spec.geometry || new THREE.BufferGeometry()
      const mesh = this._mesh(geometry, material, capacity, spec.castShadow)
      mesh.userData.spec = spec
      parts[spec.name] = mesh
      if (spec.role === 'face') {
        this.faceMesh = mesh
        this._attachFrameAttribute(mesh, capacity)
      }
    }

    /** The rig loop's walk order: parts grouped by bone, so a bone's matrix is fetched once. */
    this.partPlan = bonePlan(Object.entries(parts))

    for (const mesh of Object.values(parts)) {
      mesh.frustumCulled = false // one bounding volume for every agent everywhere is useless
      this.group.add(mesh)
    }
    // What a working astronaut pulls out now and then to check on things — upstream's
    // folding phone (559ad85), only where the theme has `phoneCheck`. See `_check`.
    this.checkProps = this.features.phoneCheck ? isolated(featureRng('phoneCheck'), () => new CheckProps(CHECK_PROP_R, capacity)) : null
    for (const mesh of this.checkProps?.meshes ?? []) this.group.add(mesh)
    this._applyShadowFlags()

    // Ground rings for hover + selection. Two ordinary meshes, moved around as needed.
    this.hoverRing = ring(0.42, 0.5, 0x9fd8ff, 0.5)
    this.selectRing = ring(0.5, 0.62, 0xffd28a, 0.9)
    this.hoverRing.visible = false
    this.selectRing.visible = false
    this.group.add(this.hoverRing, this.selectRing)

    // Cues are built on demand, so a rebuild starts with none of them and has to put back the
    // ones a live agent is already wearing. Drained rather than iterated, because `_ensureCue`
    // is what fills the set again — and at boot it is empty, so nothing here allocates.
    const again = [...this.cuesBuilt]
    this.cuesBuilt.clear()
    for (const cue of again) this._ensureCue(cue)
  }

  /**
   * A part hangs off a bone *role*, and only the roles `crew.attach` names have a matrix baked
   * out for them. Anything else would index the attachment table at `undefined` and silently
   * write NaN into every matrix downstream, so it is a throw with the role in it.
   */
  _checkBone(spec) {
    const roles = this.theme.manifest.crew.attach || {}
    if (spec.bone in roles) return
    throw new Error(
      `astronauts: prop "${spec.name}" hangs off bone role "${spec.bone}", which crew.attach does not name (${Object.keys(roles).join(', ')})`
    )
  }

  /**
   * Build the parts a cue names, the first time an agent carrying it turns up.
   *
   * Lazily, and that is the whole point of the `cues` hook being a factory rather than a list.
   * Every geometry, material and `Object3D` three constructs spends four draws of the seeded
   * random stream the screenshot harness pins, so a cue part built in `props()` at boot would
   * re-seat every villager in every shot for the sake of a cap nobody in them is wearing. A
   * factory costs nothing until a helper exists, and after that it costs once.
   *
   * A cue part is an ordinary worn part in every other respect — same fields, same bone check,
   * same node binding — except that `spec.cue` is stamped on it, which is what `wornBy` gates
   * on and what gives it its own instance counter in `_writeMatrices`.
   */
  _ensureCue(cue) {
    if (!cue || this.cuesBuilt.has(cue)) return
    const make = this.props.cues?.[cue]
    // A theme that declares no cue of this name simply has nothing extra to say about it:
    // its helpers are half-height villagers and that is all.
    if (!make) return

    for (const spec of make()) {
      // Two parts under one name would mean the second quietly replacing the first in `parts`,
      // and the first drawing forever with nobody to dispose it.
      if (spec.name in this.parts)
        throw new Error(`astronauts: cue "${cue}" builds a part named "${spec.name}", which the crew already wears`)
      this._checkBone(spec)
      const mesh = this._mesh(
        spec.geometry || new THREE.BufferGeometry(),
        spec.material,
        this.capacity,
        spec.castShadow
      )
      mesh.userData.spec = { ...spec, cue }
      mesh.frustumCulled = false
      this.parts[spec.name] = mesh
      this.group.add(mesh)
      // The rig usually landed long before the first helper did; if it has not, `setRig`'s own
      // loop over `this.parts` will reach this mesh when it does.
      if (this.rig) this._bindNode(mesh)
    }

    this.partPlan = bonePlan(Object.entries(this.parts))
    this._applyShadowFlags()
    this.cuesBuilt.add(cue)
  }

  /**
   * Hand over the baked crew rig and build the body mesh.
   *
   * Split out from the constructor because the rig is a fetch: the colony is built before
   * boot has finished loading, and until this lands the crew is helmets and backpacks with
   * nothing between them — which is fine, because no agent exists until the first roster
   * arrives, and that comes after.
   */
  setRig(rig) {
    if (!rig || this.rig === rig) return
    this.rig = rig
    this._disposeCrew()

    // One uniform block for the surface and the shadow pass, the same as the buildings do.
    this.crewUniforms = {
      uBones: { value: rig.boneTexture },
      uFrameMax: { value: rig.frameCount - 1 },
    }

    // One instanced mesh per character, all at full capacity: the party mix shifts every
    // poll and instance attributes are a few kilobytes each. A single-body crew is the one
    // mesh it always was, allocated in exactly the order it always was.
    this.crewMeshes = []
    this.crewFrameAttrs = []
    this.crewColourAttrs = []
    for (const c of this.characters) {
      const geo = rig.geometries.get(c.id).clone()
      const frames = new Float32Array(this.capacity)
      const frameAttr = new THREE.InstancedBufferAttribute(frames, 1)
      frameAttr.setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute('aFrame', frameAttr)
      let colourAttr = null
      if (this.textured) {
        colourAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1)
        colourAttr.setUsage(THREE.DynamicDrawUsage)
        geo.setAttribute('aColourway', colourAttr)
      }

      const material = decorateSkinned(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.68,
          metalness: 0.04,
          ...(this.textured ? { map: rig.texture } : {}),
        }),
        this.crewUniforms,
        { textured: this.textured }
      )

      const mesh = new THREE.InstancedMesh(geo, material, this.capacity)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.count = 0
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      const white = new THREE.Color(1, 1, 1)
      for (let i = 0; i < this.capacity; i++) mesh.setColorAt(i, white)
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)

      const depth = decorateSkinned(
        new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
        this.crewUniforms,
        { normals: false, textured: this.textured }
      )
      mesh.customDepthMaterial = depth
      mesh.userData.character = c.id

      this.crewMeshes.push(mesh)
      this.crewFrameAttrs.push(frameAttr)
      this.crewColourAttrs.push(colourAttr)
      this.group.add(mesh)
    }
    this.crew = this.crewMeshes[0]
    this.crewFrameAttr = this.crewFrameAttrs[0]
    this._applyShadowFlags()

    // Bones anything worn hangs off, keyed by the role a part asks for. Read back per frame
    // from the same baked table the shader samples, so a helmet is never a frame out of
    // step with the head under it.
    // Every role the rig baked, not a chosen three: a theme whose props reach for a fourth
    // one gets its matrix rather than `undefined`, and `_buildMeshes` has already refused any
    // role the manifest does not name.
    this.slots = Object.fromEntries(rig.attachSlot)

    // Props that name a node in the crew glb get their geometry now.
    for (const mesh of Object.values(this.parts)) this._bindNode(mesh)

    // Where the helmet sits above the ground at rest, in world units. The picker aims here
    // rather than at the feet, so a click lands on the part of an astronaut you are looking
    // at — and reading it off the rig means it follows CREW_SCALE without a second constant.
    const restHeadY = rig.attach[(this.slots.head + 0) * 16 + 13]
    this.headHeight = (restHeadY + this.props.headLift) * CREW_SCALE
  }

  /**
   * Give one part its geometry out of the crew glb, if it names a node there.
   *
   * A prop that names a node has no geometry of its own until the rig lands — the props hook
   * runs at construction, long before any kit is loaded — so it is built on an empty buffer
   * and the real thing is swapped in here. Its material takes the crew atlas as its map, so a
   * wrench is painted from the same sheet as the engineer holding it.
   *
   * Unless the part asks to stay `plain`. A plain prop keeps the white material the hook
   * built and is painted by its instance colour alone — which is the only way a single shared
   * geometry can come out a different colour per agent, and what the shield on a villager's
   * back is: the repo's accent, not a sheet the pack happened to paint it from. The helper's
   * cap is the same trick on the same node.
   *
   * Shared by `setRig`, which walks every part when the rig arrives, and `_ensureCue`, which
   * builds a part long after it has.
   */
  _bindNode(mesh) {
    const spec = mesh.userData.spec
    if (!spec.node) return
    const geo = this.rig.props.get(spec.node)
    if (!geo)
      throw new Error(`astronauts: prop "${spec.name}" names crew node "${spec.node}", which crew.glb has not got`)
    mesh.geometry.dispose()
    mesh.geometry = geo.clone()
    if (!spec.plain && !mesh.material.map && this.rig.texture) {
      mesh.material.map = this.rig.texture
      mesh.material.needsUpdate = true
    }
  }

  _disposeCheckProps() {
    for (const mesh of this.checkProps?.meshes ?? []) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
      for (const m of [].concat(mesh.material)) {
        m.map?.dispose()
        m.dispose()
      }
    }
    this.checkProps = null
  }

  _disposeCrew() {
    for (const mesh of this.crewMeshes || []) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.customDepthMaterial?.dispose()
    }
    this.crewMeshes = []
    this.crewFrameAttrs = []
    this.crewColourAttrs = []
    this.crew = null
    this.crewFrameAttr = null
  }

  _mesh(geo, mat, count, castShadow) {
    const mesh = new THREE.InstancedMesh(geo, mat, count)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    mesh.castShadow = castShadow
    mesh.receiveShadow = false
    // Force USE_INSTANCING_COLOR on every part so tinting is available without a recompile.
    const white = new THREE.Color(1, 1, 1)
    for (let i = 0; i < count; i++) mesh.setColorAt(i, white)
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    return mesh
  }

  /**
   * The face material. The atlas is a mask, so the shader ignores the sampled colour
   * entirely: the red channel becomes *alpha* and the instance's own colour becomes the
   * glow, which is how every astronaut gets a different eye colour from one shared texture.
   *
   * The dark panel behind the features is the *visor*, which is a rounded shape cut by an
   * SDF. This cap used to paint its own dark background as well, and because the cap is a
   * rectangle that second background showed as a rectangle sitting on the rounded one —
   * two panels, the corners of the upper one clipping out of the lower. Carrying alpha in
   * the mask instead means the only thing this draws is the features themselves, so the
   * visor's own silhouette is the only edge there is.
   *
   * `depthWrite` is off because this is transparent now: with it on, the cap would write
   * depth across its whole rectangle and punch a hole in anything drawn behind it later.
   */
  _faceMaterial() {
    if (this.features.faces) return this._crtFaceMaterial()
    const mat = new THREE.MeshBasicMaterial({
      map: this.faceTexture,
      toneMapped: true,
      transparent: true,
      depthWrite: false,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFrameScale = { value: new THREE.Vector2(1 / this.faces.cols, 1 / this.faces.rows) }
      shader.uniforms.uGlow = { value: 1.85 }
      // This hook replaces the prototype's, so it hands the world curve its uniforms itself,
      // as the CRT's does: a face part without `faces` bends with the helmet it sits on.
      withCurve(shader)
      this._faceUniforms = shader.uniforms

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           attribute vec2 aFrame;
           uniform vec2 uFrameScale;`
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
           vMapUv = uv * uFrameScale + aFrame;`
        )

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uGlow;`
        )
        .replace(
          '#include <map_fragment>',
          `float mask = texture2D( map, vMapUv ).r;
           // The mask is drawn from paths, so its edges are already antialiased — taking
           // alpha straight from it is what gives the features soft edges against the
           // helmet without a single extra sample.
           diffuseColor.rgb = vColor.rgb * uGlow;
           diffuseColor.a = mask;`
        )
        // vColor is the glow source above, so the usual instance-colour multiply must go.
        .replace('#include <color_fragment>', '')
    }
    return mat
  }

  /**
   * Upstream's opaque recessed CRT (38b6562): spatial detail fades below the pixel grid so a
   * camera move cannot turn the phosphor pattern into moire. Space only — the village has no
   * face part at all.
   */
  _crtFaceMaterial() {
    const mat = new THREE.MeshBasicMaterial({ map: this.faceTexture, toneMapped: true })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFrameScale = { value: new THREE.Vector2(1 / this.faces.cols, 1 / this.faces.rows) }
      shader.uniforms.uGlow = { value: 1.55 }
      withCurve(shader)
      this._faceUniforms = shader.uniforms
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aFrame;
          uniform vec2 uFrameScale;
          varying vec2 vScreenUv;
          varying vec2 vFrameOrigin;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vScreenUv = uv;
          vFrameOrigin = aFrame;`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uGlow;
          uniform vec2 uFrameScale;
          varying vec2 vScreenUv;
          varying vec2 vFrameOrigin;`)
        .replace('#include <map_fragment>', `
          // Static barrel distortion bends the lettering and raster together on the
          // inner tube; the outer window and its reflections stay undistorted.
          vec2 tube = ( vScreenUv - 0.5 ) * 2.0;
          vec2 crtUv = 0.5 + 0.5 * tube * ( 1.0 + 0.085 * dot( tube, tube ) );
          vec2 atlasUv = clamp( crtUv, 0.003, 0.997 ) * uFrameScale + vFrameOrigin;
          float mask = texture2D( map, atlasUv ).r;
          float scanY = crtUv.y * 44.0;
          float scanDetail = 1.0 - smoothstep( 0.28, 0.5, fwidth( scanY ) );
          // Keep the average brightness constant as unresolvable lines fade away.
          float raster = 0.77 - scanDetail * 0.23 * cos( scanY * 6.2831853 );
          vec2 phosphor = crtUv * vec2( 120.0, 88.0 );
          float dotDetail = 1.0 - smoothstep( 0.25, 0.5, max( fwidth( phosphor.x ), fwidth( phosphor.y ) ) );
          float grain = 1.0 - dotDetail * 0.045 * ( 1.0 + cos( phosphor.x * 6.2831853 ) * cos( phosphor.y * 6.2831853 ) );
          float edge = smoothstep( 0.25, 0.5, length( vScreenUv - 0.5 ) );
          vec3 screen = vec3( 0.014, 0.031, 0.079 ) * ( 1.0 - edge * 0.48 );
          // The dim phosphor bed shares the raster, while status colours still belong
          // to each agent and every existing atlas expression remains available.
          vec3 bed = screen * ( 0.74 - scanDetail * 0.26 * cos( scanY * 6.2831853 ) );
          diffuseColor.rgb = ( bed + vColor.rgb * mask * uGlow * raster ) * grain;
          diffuseColor.a = 1.0;
        `)
        .replace('#include <color_fragment>', '')
    }
    return mat
  }

  _attachFrameAttribute(mesh, capacity) {
    const data = new Float32Array(capacity * 2)
    const attr = new THREE.InstancedBufferAttribute(data, 2)
    attr.setUsage(THREE.DynamicDrawUsage)
    mesh.geometry.setAttribute('aFrame', attr)
    this.frameAttr = attr
  }

  _applyShadowFlags() {
    const on = this.settings.shadowSize > 0
    for (const mesh of Object.values(this.parts)) mesh.castShadow = on && mesh.userData.spec.castShadow
    // The body is the shadow that matters — it is the whole silhouette.
    for (const mesh of this.crewMeshes || []) mesh.castShadow = on
    this.checkProps?.setShadows(on)
  }

  /** The colony hands over the navigation grid once it has been built. */
  setNavigation(nav) {
    this.nav = nav
  }

  onSettingsChanged(changed) {
    if (changed.has('shadows')) this._applyShadowFlags()
    if (changed.has('textureQuality')) {
      this.faceTexture.dispose()
      this.faceTexture = this.faces.build(this._faceAtlasSize())
      if (this.faceMesh) {
        this.faceMesh.material.map = this.faceTexture
        this.faceMesh.material.needsUpdate = true
      }
    }
    if (changed.has('maxAgents')) {
      // The instanced buffers are sized at build time, so a bigger roster needs new ones.
      const wanted = Math.max(64, this.settings.get('maxAgents'))
      if (wanted !== this.capacity) {
        const rig = this.rig
        this._disposeCrew()
        for (const mesh of Object.values(this.parts)) {
          this.group.remove(mesh)
          mesh.geometry.dispose()
          mesh.material.dispose()
        }
        this.group.remove(this.hoverRing, this.selectRing)
        this._disposeCheckProps()
        // Dropped *before* the rebuild, not after. `_buildMeshes` rebuilds any cue a live
        // helper is wearing, and `_ensureCue` binds a node prop's geometry the moment the rig
        // is there — so leaving the rig in place here cloned that geometry once for the cue
        // and again in the `setRig` below, the first clone dropped on the floor unreferenced.
        this.rig = null
        this._buildMeshes(wanted)
        this.setRig(rig)
        for (const agent of this.agents) {
          agent.index = -1
          agent.colorDirty = true
        }
      }
      this.roster && this.setRoster(this.roster)
    }
  }

  // ── roster ──────────────────────────────────────────────────────────────────────────

  /**
   * Reconcile the live agents against the current thread list: spawn newcomers at the ship,
   * update the ones that are still here, and send anything that vanished home rather than
   * deleting it out from under the player.
   */
  setRoster(entries, world) {
    this.roster = entries
    this.world = world || this.world
    const cap = Math.min(this.capacity, this.settings.get('maxAgents'))
    // The cap is a display budget, and the roster is cut to it by *who matters* (upstream
    // 668b4b0): anyone blocked or waiting on you first, then whoever is working, then the
    // rest, and helpers after every thread. It no longer subtracts the agents still walking
    // home: that arithmetic fed on itself — a smaller cap sent a batch home, the batch ate the
    // budget, the next poll sent another — and `_writeMatrices` already stops at capacity.
    // Under the cap the roster is taken exactly as it came.
    const capped = entries.length > cap
    const wanted = capped ? [...entries].sort((a, b) => rosterRank(a) - rosterRank(b)).slice(0, cap) : entries
    const seen = new Set()

    // The ramp is one door and the ship is a solid obstacle around it, so an entrance is a
    // queue. A handful arriving together is the shot the colony is for; a hundred is a scrum
    // that shoves its own members into the ship's footprint, where they give up, sit down and
    // become the obstacle for everybody behind them. Past this many, the rest are simply
    // already outside — which is what a thread the colony has seen before is anyway.
    let entrances = MAX_ENTRANCE
    for (const entry of wanted) {
      seen.add(entry.id)
      const existing = this.byId.get(entry.id)
      if (existing) {
        this._updateAgent(existing, entry)
        continue
      }
      const walksOut = !entry.known && entrances > 0
      if (walksOut) entrances--
      this._spawnAgent(entry, walksOut)
    }

    // Off the scan: walk home. Merely over the budget: gone, no ceremony — walking a display
    // cap's worth of crew up the ramp reads as sixty threads being archived.
    const onScan = capped ? new Set(entries.map((e) => e.id)) : seen
    for (const agent of [...this.agents]) {
      if (seen.has(agent.id) || agent.state === 'leaving') continue
      if (onScan.has(agent.id)) this._drop(agent)
      else this._sendHome(agent)
    }
    return this.agents.length
  }

  _spawnAgent(entry, walksOut = true) {
    // Before anything else, and before the first `Math.random()` below: building a cue spends
    // seeded draws, and doing it halfway through composing an agent would shift every draw
    // after it. Ahead of the lot, it costs the same whether it builds anything or not.
    if (entry.cue) this._ensureCue(entry.cue)
    const door = this.world?.door?.() || new THREE.Vector3(0, 0, 0)
    const jitter = () => (Math.random() - 0.5) * 1.4
    // Straight onto its plot, a pace off the exact spot so a zone's crew does not appear in a
    // stack. The nav grid sorts out anything that lands on a building.
    const site = entry.site || door
    const start = walksOut
      ? new THREE.Vector3(door.x + jitter(), 0, door.z + jitter())
      : new THREE.Vector3(site.x + jitter(), 0, site.z + jitter())
    const tones = this.theme.manifest.palette.tones
    // Which villager this thread is, drawn off its id so it keeps the same body — and the
    // same colourway — across reloads.
    const character = characterFor(entry.id, this.characters)

    const agent = {
      id: entry.id,
      thread: entry.thread,
      status: entry.status,
      site: entry.site ? entry.site.clone() : new THREE.Vector3(),
      // The thing being worked on, and where round it this astronaut is standing to do it.
      anchor: entry.anchor ? entry.anchor.clone() : null,
      workSpot: new THREE.Vector3(),
      workAt: 0,
      pos: start,
      vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      targetYaw: 0,
      speed: WALK_SPEED * (0.86 + Math.random() * 0.28),
      phase: Math.random() * Math.PI * 2,
      bob: 0,
      // An astronaut already outside does not play the entrance; it is just there.
      state: walksOut ? 'spawning' : 'walking',
      stateAge: 0,
      // Every astronaut runs its own clocks so a crowd never blinks in unison.
      blinkAt: 1 + Math.random() * 4,
      faceFrame: this.faces.FACE.boot,
      faceTimer: 0,
      faceIndex: 0,
      suit: tones[(hash(entry.id) >>> 3) % tones.length],
      character: character.id,
      characterIndex: this.characters.indexOf(character),
      colourway: colourwayFor(entry.id, this.colourways) / this.colourways,
      workClip: clipFor(this.stateClips, 'working', character.id),
      crewIndex: -1,
      eye: new THREE.Color(1, 1, 1),
      trim: new THREE.Color(0xffffff),
      // The colour of the repo this thread belongs to, for anything tinted `accent`. White
      // when the roster does not carry one, which leaves such a part its own material colour.
      accent: new THREE.Color(entry.accent ?? 0xffffff),
      hop: 0,
      // Ground tracking. `groundAt` is the height last sampled and `groundY` the eased value
      // actually stood on; both start null so the first frame snaps instead of easing up.
      groundAt: null,
      groundY: null,
      groundX: 0,
      groundZ: 0,
      /** Distance actually covered per second, damped — what picks the animation clip. */
      groundSpeed: 0,
      /** Set by `_walk` on a refused step; latched per wander leg as `driftBlocked`. */
      blocked: false,
      driftBlocked: false,
      /**
       * Seconds of refused steps since the last frame that went anywhere, kept by `_walk`.
       *
       * This is what "stuck" is measured on. It is zeroed wherever `stateAge` is, because a new
       * journey is owed the whole eight seconds however the last one ended.
       */
      blockedFor: 0,
      /**
       * Doorway retries spent on this leg. Cleared whenever the astronaut sets off at a new
       * site or reaches one, so every journey gets the full budget and only a journey that
       * cannot leave the ramp ever spends it.
       */
      doorRetries: 0,
      /** The site it last gave up on and the grid layout it failed against; see `staysGivenUp`. */
      gaveUp: null,
      /** Its site is not joined to the threshold's ground: no way to it exists on this grid. */
      routeless: false,
      // Animation state: which baked clip, how far into it, and the row of the bone table
      // that lands on. Started at a random offset so a crowd never marches in step.
      clipKey: clipFor(this.stateClips, walksOut ? 'spawn' : 'idle', character.id),
      clipTime: Math.random() * 0.6,
      frame: 0,
      wander: new THREE.Vector3(),
      wanderAt: 0,
      // The phone check (`phoneCheck` only): when the next is due, when the current one began
      // (-1 for none), what it gets out and how far in it is. See `_check`.
      checkAt: 0,
      checkStart: -1,
      checkProp: null,
      checkT: -1,
      // Walking faces (`faces` only) — see `face-animation.js`.
      walkFaceTime: 0,
      walkFaceHold: 0,
      walkPersonality: (hash(entry.id) >>> 0) / 0x100000000,
      scale: walksOut ? 0 : 1, // pops up out of the ship, or was already standing there
      /**
       * How big this body is drawn, 1 being an adult villager. Separate from `scale` on
       * purpose: `scale` is the spawn and despawn pop, and five places read it as a
       * visibility cutoff (`< 0.2`, `< 0.3`, `< 0.4`, `< 0.5`, `<= 0.001`), so a half-size
       * helper riding on `scale` would be a villager nobody draws a badge, a ring or a
       * spark for. The roster names it — only a helper's entry carries one — and everything
       * measured on the body multiplies by it.
       */
      size: entry.size ?? 1,
      /**
       * What this agent *is*, for anything worn that belongs to a kind of agent rather than
       * to a body or a clip. Only a helper's entry carries one; null gates it out of every
       * cue part there is, which is every villager that is not a helper.
       */
      cue: entry.cue ?? null,
      alive: true,
      path: null,
      pathAt: 0,
      pathVersion: -1,
      pathGoal: new THREE.Vector3(NaN, 0, NaN),
      colorDirty: true,
      index: -1,
      walkAmp: 0,
      screen: new THREE.Vector3(), // filled by the picker each frame
    }
    this._applyStatus(agent, entry.status)
    this.agents.push(agent)
    this.byId.set(agent.id, agent)
    // News, for whoever wants it (the colony's arrival bell): only an agent that walks out
    // is new, never one already standing on its plot. Spends no draw.
    if (walksOut) this.onEntrance?.(agent)
    return agent
  }

  _updateAgent(agent, entry) {
    agent.thread = entry.thread
    /**
     * The zone moved, so this villager is somewhere else now.
     *
     * Compact, an automatic relocation and a layout restored from the colony file are the same
     * event: the buildings are simply on other ground between one frame and the next, and a
     * villager told to *walk* there crosses the whole map, runs out the give-up somewhere in
     * the middle and adopts the ground it reached — in another repo's yard, where the memory
     * then keeps it. `groundY` has to go with it: the height is eased toward the sample, and
     * easing across 150 units sinks the body into the terrain for a third of a second.
     *
     * An arrival walking out of the ship and a departure on its way home are left alone. One
     * is the shot the colony is for; the other does not care where its zone went.
     */
    if (entry.teleport && entry.site && agent.state !== 'spawning' && agent.state !== 'leaving') {
      agent.gaveUp = null
      agent.site.copy(entry.site)
      agent.pos.set(entry.site.x, agent.pos.y, entry.site.z)
      agent.groundY = null
      agent.path = null
      agent.pathAt = 0
      agent.pathVersion = -1
      agent.doorRetries = 0
      agent.blockedFor = 0
      agent.stateAge = 0
      agent.state = 'at-site'
    } else if (entry.site && !staysGivenUp(agent.gaveUp, entry.site, this.nav?.layout ?? 0)) {
      // Handed back the site it already gave up on, across a grid that has not changed: it
      // stays on the ground it adopted. Anything else forgets the give-up and is judged as
      // usual.
      agent.gaveUp = null
      const moved = Math.hypot(entry.site.x - agent.site.x, entry.site.z - agent.site.z) > SITE_MOVED
      agent.site.copy(entry.site)
      // A new site is a new journey, whatever state the agent is in: a leg that inherits a
      // spent doorway budget from the last one would give up at the door on its first refusal.
      if (moved) agent.doorRetries = 0
      // A site that has moved is a site to walk to. This matters most for an astronaut that
      // gave up on an unreachable one and adopted the ground it was standing on: the next
      // scan hands the real site back, and without this it would stand there for good,
      // parked in the middle of somebody else's zone.
      const away = Math.hypot(agent.site.x - agent.pos.x, agent.site.z - agent.pos.z)
      if (moved && agent.state === 'at-site' && away > ARRIVE_RADIUS) {
        agent.state = 'walking'
        agent.stateAge = 0
        agent.blockedFor = 0
        agent.pathVersion = -1
        agent.doorRetries = 0
      }
    }
    if (entry.anchor) (agent.anchor ||= new THREE.Vector3()).copy(entry.anchor)
    // A thread that moved to another plot — or a plot that was handed a different colour
    // because a repo left the map — repaints whatever it wears in the repo's accent. The
    // status is unchanged, so nothing else here would have marked it dirty.
    if (entry.accent !== undefined && !agent.accent.equals(this._color.setHex(entry.accent))) {
      agent.accent.set(entry.accent)
      agent.colorDirty = true
    }
    if (entry.status !== agent.status) {
      agent.status = entry.status
      this._applyStatus(agent, entry.status)
    }
  }

  /** Status change → new behaviour, new trim, new eye colour. */
  _applyStatus(agent, status) {
    const look = AGENT_LOOK[status] || AGENT_LOOK.idle
    agent.checkStart = -1
    agent.trim.set(look.trim)
    agent.eye.setRGB(look.eye[0], look.eye[1], look.eye[2])
    agent.loop = this.faces.FACE_LOOPS[status] || null
    agent.colorDirty = true

    if (status === 'leaving') {
      this._sendHome(agent)
      return
    }
    // A spawning agent keeps walking out of the ship; everyone else re-targets at once.
    if (agent.state !== 'spawning') agent.state = 'walking'
    agent.stateAge = 0
    agent.blockedFor = 0
    agent.pathVersion = -1
    agent.doorRetries = 0
  }

  /** Close enough to the ramp that standing still there is in somebody's way. */
  _nearDoor(pos) {
    const door = this.world?.door?.()
    if (!door) return false
    const dx = pos.x - door.x
    const dz = pos.z - door.z
    return dx * dx + dz * dz < DOORWAY_CLEAR * DOORWAY_CLEAR
  }

  /** Off the map this frame, with no walk: the update loop reaps anything marked gone. */
  _drop(agent) {
    agent.state = 'gone'
    agent.scale = 0
  }

  _sendHome(agent) {
    if (agent.state === 'leaving' || agent.state === 'gone') return
    agent.state = 'leaving'
    // The status goes too (upstream 9e09fc4). A sleeper's status is what sits it down: the clip
    // picker reads it whenever the body is not moving, so a napping villager sent home would
    // stand up, take a step, and sit straight back down — still with its eyes shut.
    agent.status = 'leaving'
    agent.clipKey = null
    agent.stateAge = 0
    agent.blockedFor = 0
    agent.doorRetries = 0
    agent.gaveUp = null
    agent.loop = null
    agent.faceFrame = this.faces.FACE.wink
    agent.pathVersion = -1
    const door = this.world?.door?.()
    if (door) agent.site.copy(door)
  }

  remove(id) {
    const agent = this.byId.get(id)
    if (agent) this._sendHome(agent)
  }

  // ── per-frame simulation ────────────────────────────────────────────────────────────

  update(dt, elapsed) {
    const reduced = this.settings.get('reducedMotion')
    const anim = reduced ? 0.35 : 1
    let write = 0

    this._rebuildBuckets()
    this._routeBudget = PATH_BUDGET
    this._expansionBudget = FRAME_EXPANSIONS

    for (let i = this.agents.length - 1; i >= 0; i--) {
      const agent = this.agents[i]
      agent.stateAge += dt
      this._step(agent, dt, elapsed, anim)
      this._animate(agent, dt, anim)
      if (this.features.faces) animateFace(agent, dt, anim)
      else this._face(agent, dt)

      if (agent.state === 'gone') {
        this.agents.splice(i, 1)
        this.byId.delete(agent.id)
        continue
      }
      write++
    }

    this._writeMatrices(elapsed, anim)
    return write
  }

  /**
   * Make sure the agent has a usable route, and hand back the point it should steer at.
   * Falls back to the goal itself when there is no path — an astronaut heading vaguely the
   * right way and sliding along walls beats one standing still because A* gave up.
   */
  _steerTarget(agent, out) {
    const nav = this.nav
    if (!nav) return out.copy(agent.site)

    const stale =
      agent.pathVersion !== nav.version ||
      agent.pathGoal.distanceToSquared(agent.site) > 0.25
    if (stale && this._routeBudget > 0 && this._expansionBudget > 0) {
      this._routeBudget--
      const cap = Math.min(MAX_EXPANSIONS, this._expansionBudget)
      agent.path = nav.findPath(agent.pos.x, agent.pos.z, agent.site.x, agent.site.z, cap)
      this._expansionBudget -= nav.lastExpansions
      // Whether a route exists is the grid's own reachability map, not a verdict on this
      // search: a path that came back null may simply have been cut short by its expansion cap,
      // and one that came back fine says nothing about a site the *next* rebuild walls in.
      agent.routeless = !nav.isReachable(agent.site.x, agent.site.z)
      agent.pathAt = 0
      // A search the frame's *budget* cut short is not an answer about this route at all, so
      // the goal stays stale and the next frame — with a full allowance — tries again. Latching
      // it would park whoever happened to ask last in a busy frame with no path until the grid
      // itself changed.
      if (!(nav.lastSearch === 'cut' && cap < MAX_EXPANSIONS)) {
        agent.pathVersion = nav.version
        agent.pathGoal.copy(agent.site)
      }
    }

    const path = agent.path
    if (!path || !path.length) return out.copy(agent.site)

    // Retire waypoints reached, but only where the leg after them is one the agent can walk.
    agent.pathAt = retireWaypoints(path, agent.pathAt, agent.pos.x, agent.pos.z, nav)
    if (agent.pathAt >= path.length) return out.copy(agent.site)
    const wp = path[agent.pathAt]
    return out.set(wp.x, 0, wp.z)
  }

  _step(agent, dt, elapsed, anim) {
    const fromX = agent.pos.x
    const fromZ = agent.pos.z
    agent.blocked = false
    // Distance is always measured to the real goal; steering follows the route to it.
    const steer = this._steerTarget(agent, this._wp)
    const toSite = this._v.set(steer.x - agent.pos.x, 0, steer.z - agent.pos.z)
    const dist = Math.hypot(agent.site.x - agent.pos.x, agent.site.z - agent.pos.z)

    switch (agent.state) {
      case 'spawning': {
        agent.scale = Math.min(1, agent.scale + dt * 2.6)
        if (agent.stateAge > 0.9) agent.state = 'walking'
        this._walk(agent, toSite, dist, dt, 0.55)
        break
      }

      case 'walking': {
        agent.scale = Math.min(1, agent.scale + dt * 3)
        this._walk(agent, toSite, dist, dt, 1)
        // Close enough — settle into whatever this thread is actually doing. Or close
        // enough to *give up*: a site that something was built on top of between polls can
        // never be reached, and an astronaut shouldering a wall forever is worse than one
        // standing a little short of where it meant to be. It adopts the spot it got to,
        // and the next poll hands it a site that has been checked against the grid.
        const stuck = isStuck(agent.blockedFor, agent.stateAge)
        const arrived = dist < ARRIVE_RADIUS
        if (arrived || stuck) {
          const nearDoor = this._nearDoor(agent.pos)
          const what = giveUpAt(arrived, stuck, doorwayQueued(nearDoor, agent.routeless), agent.doorRetries)
          if (what === 'retry') {
            agent.doorRetries++
            agent.stateAge = 0
            agent.blockedFor = 0
            agent.pathVersion = -1
            break
          }
          if (what === 'adopt') {
            // Remember what it walked away from, so the next poll handing the same site back
            // does not send it at the same wall again (`staysGivenUp`) — except in the doorway,
            // where staying for good is the wall the retries exist to stop.
            agent.gaveUp = remembersGiveUp(nearDoor)
              ? { x: agent.site.x, z: agent.site.z, layout: this.nav?.layout ?? 0 }
              : null
            agent.site.copy(agent.pos)
          }
          agent.doorRetries = 0
          agent.state = agent.status === 'leaving' ? 'leaving' : 'at-site'
          agent.stateAge = 0
          agent.blockedFor = 0
        }
        break
      }

      case 'at-site': {
        if (agent.status === 'idle') {
          // Idlers potter around their plot, and `_drift` owns their velocity outright.
          this._drift(agent, dt, elapsed)
        } else if (agent.status === 'working' && agent.anchor) {
          this._workRound(agent, dt, elapsed)
        } else {
          // Everybody else has arrived and stays: a thread that has gone quiet has sat down
          // on the floor, one that is working is at its building. Velocity is zeroed rather
          // than eased down, because nothing here moves the agent any more — a decaying
          // velocity is a number only the animation reads, and what it says is "still
          // walking" for a third of a second after the astronaut has visibly stopped.
          agent.vel.set(0, 0, 0)
          if (agent.status !== 'sleeping') this._faceToward(agent, agent.site, dt)
          this._settle(agent, dt)
        }
        this._sitePose(agent, dt, elapsed, anim)
        break
      }

      case 'leaving': {
        agent.scale = Math.max(0, agent.scale - (dist < 1.4 ? dt * 2.2 : 0))
        this._walk(agent, toSite, dist, dt, 1.15)
        // Reaching the ramp retires the agent; so does giving up on ever reaching it, so a
        // blocked path can never leave a ghost walking forever.
        if (agent.scale <= 0.001 || (dist < 0.9 && agent.stateAge > 1.5) || agent.stateAge > 22) {
          agent.state = 'gone'
        }
        break
      }
    }

    // How fast the astronaut *actually* travelled, not how fast it meant to. The two come
    // apart whenever something is in the way: velocity stays high while the collision code
    // refuses the step, and an agent driven off intent alone walks on the spot against a
    // wall.
    const moved = Math.hypot(agent.pos.x - fromX, agent.pos.z - fromZ) / Math.max(dt, 1e-4)
    // Asymmetric on purpose. Setting off is picked up on the very frame it happens, so an
    // astronaut is never sliding in a standing pose; stopping decays over a tenth of a
    // second, which both stops a half-blocked step flickering the clip and lets the walk
    // cycle finish its stride instead of freezing mid-step.
    agent.groundSpeed =
      moved > agent.groundSpeed ? moved : THREE.MathUtils.damp(agent.groundSpeed || 0, moved, 20, dt)
    // The hand-wound cycle behind everything that has to land on a footfall — boot dust comes
    // off `Math.sin(agent.phase)` over in the colony. Divided by the size for the same reason
    // the clip rate is: a half-height villager takes twice the steps over the same ground, so
    // its dust has to come twice as often or it puffs up between footfalls.
    agent.phase += dt * (2.2 + (agent.groundSpeed / agent.size) * 3.4) * anim
    agent.walkAmp = THREE.MathUtils.damp(agent.walkAmp || 0, Math.min(1, agent.groundSpeed / WALK_SPEED), 8, dt)

    agent.yaw = angleDamp(agent.yaw, agent.targetYaw, TURN_RATE, dt)

    // Stand on the ground rather than on y=0. A plot's deck is a raised slab and the terrain
    // between plots rolls by half a metre either way, so a crew pinned to zero is buried for
    // half the colony. Sampled only when the agent has actually moved — most of the crew is
    // parked at its site, and the sample is a hex lookup plus a noise evaluation.
    const ground = this.world?.groundAt
    if (ground) {
      if (agent.groundAt === null || Math.abs(agent.pos.x - agent.groundX) + Math.abs(agent.pos.z - agent.groundZ) > 0.2) {
        agent.groundX = agent.pos.x
        agent.groundZ = agent.pos.z
        agent.groundAt = ground(agent.pos.x, agent.pos.z)
      }
      // Eased, so walking up onto a deck is a step rather than a teleport. Snapped outright
      // on the first frame, or a spawning astronaut rises out of the floor.
      agent.groundY =
        agent.groundY === null ? agent.groundAt : THREE.MathUtils.damp(agent.groundY, agent.groundAt, 14, dt)
    }
    agent.pos.y = (agent.groundY || 0) + agent.hop
  }

  /**
   * `toTarget` points at the next waypoint; `goalDist` is how far the *final* goal still is.
   * Slowing down uses the goal so an astronaut cruises through intermediate corners and only
   * eases as it actually arrives.
   */
  _walk(agent, toTarget, goalDist, dt, factor) {
    const legDist = toTarget.length()
    if (legDist > 0.05) {
      const dir = toTarget.divideScalar(legDist)
      const want = agent.speed * factor * Math.min(1, goalDist / 1.8)
      agent.vel.x = THREE.MathUtils.damp(agent.vel.x, dir.x * want, 6, dt)
      agent.vel.z = THREE.MathUtils.damp(agent.vel.z, dir.z * want, 6, dt)
    }

    const push = this._separation(agent, this._sep)
    const dx = (agent.vel.x + push.x) * dt
    const dz = (agent.vel.z + push.z) * dt

    if (this.nav) {
      const fromX = agent.pos.x
      const fromZ = agent.pos.z
      // Blocked head-on, the agent slides; a route that has gone stale can never become a
      // walk through a wall.
      if (!this.nav.slide(agent.pos, dx, dz)) {
        agent.vel.multiplyScalar(0.4)
        // Wedged against something the path did not know about — ask for a new one.
        agent.pathVersion = -1
        agent.blocked = true
      }
      /**
       * The blocked clock, which is what the give-up is actually judged on.
       *
       * A refused step adds to it and a frame that went somewhere clears it, so a bump in a
       * crowd costs a few hundredths of a second and eight seconds of it means the astronaut
       * has been standing against something for eight seconds. "Went somewhere" is the same
       * measure `slide` refuses a step by — a meaningful fraction of the step asked for, not an
       * absolute distance, because an arriving villager legitimately asks for microns.
       */
      if (agent.blocked) agent.blockedFor += dt
      else if (slideCounts(dx, dz, agent.pos.x - fromX, agent.pos.z - fromZ)) agent.blockedFor = 0
    } else {
      agent.pos.x += dx
      agent.pos.z += dz
      agent.blockedFor = 0
    }

    if (Math.hypot(agent.vel.x, agent.vel.z) > 0.05) {
      agent.targetYaw = Math.atan2(agent.vel.x, agent.vel.z)
    }
  }

  /** Bucket every agent by a coarse cell, so separation only ever looks at real neighbours. */
  _rebuildBuckets() {
    const buckets = this._buckets
    buckets.clear()
    for (const agent of this.agents) {
      if (agent.state === 'gone' || agent.scale < 0.2) continue
      const key = ((agent.pos.x / 2) | 0) * 10007 + ((agent.pos.z / 2) | 0)
      let list = buckets.get(key)
      if (!list) buckets.set(key, (list = []))
      list.push(agent)
    }
  }

  /** A soft shove away from anyone standing too close. */
  /** Is anybody already standing here? Same bucket grid the separation query walks. */
  _crowded(x, z, ignore) {
    const bx = (x / 2) | 0
    const bz = (z / 2) | 0
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = this._buckets.get((bx + ox) * 10007 + (bz + oz))
        if (!list) continue
        for (const other of list) {
          if (other === ignore) continue
          const dx = x - other.pos.x
          const dz = z - other.pos.z
          if (dx * dx + dz * dz < SEPARATION * SEPARATION) return true
        }
      }
    }
    return false
  }

  _separation(agent, out) {
    out.set(0, 0, 0)
    const buckets = this._buckets
    const bx = (agent.pos.x / 2) | 0
    const bz = (agent.pos.z / 2) | 0
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = buckets.get((bx + ox) * 10007 + (bz + oz))
        if (!list) continue
        for (const other of list) {
          if (other === agent) continue
          const dx = agent.pos.x - other.pos.x
          const dz = agent.pos.z - other.pos.z
          const d2 = dx * dx + dz * dz
          if (d2 > SEPARATION * SEPARATION || d2 < 1e-6) continue
          const d = Math.sqrt(d2)
          // Two regimes, because one is not enough. The gentle term ramps up as they close
          // so a crowd settles instead of oscillating — but in a press, half a dozen gentle
          // pushes from every side cancel, and the equilibrium lands *inside* helmet width.
          // So there is a second, much firmer term that only exists at touching distance,
          // where being apart stops being cosmetic. Widening the gentle radius does not fix
          // that; it makes it worse, by adding more pushes to cancel.
          const strength = (1 - d / SEPARATION) * 1.2 + (d < CONTACT ? (1 - d / CONTACT) * 5 : 0)
          out.x += (dx / d) * strength
          out.z += (dz / d) * strength
        }
      }
    }
    return out
  }

  /** A slow wander inside the plot, re-targeted every few seconds. */
  _drift(agent, dt, elapsed) {
    if (elapsed > agent.wanderAt) {
      agent.wanderAt = elapsed + 3 + Math.random() * 5
      // Stay put rather than walk at a wall — or at somebody. A few candidates and the
      // first that is neither inside a building nor on top of a neighbour wins: separation
      // can push a crowd apart, but it cannot stop one forming if everybody keeps choosing
      // to walk into the same patch of ground.
      agent.wander.copy(agent.site)
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2
        const r = 0.8 + Math.random() * 2
        const wx = agent.site.x + Math.cos(a) * r
        const wz = agent.site.z + Math.sin(a) * r
        if (this.nav?.isBlocked(wx, wz)) continue
        if (this._crowded(wx, wz, agent)) continue
        agent.wander.set(wx, 0, wz)
        break
      }
      agent.driftBlocked = false
    }
    const to = this._v.set(agent.wander.x - agent.pos.x, 0, agent.wander.z - agent.pos.z)
    const d = to.length()
    if (d > DRIFT_ARRIVE && !agent.driftBlocked) {
      this._walk(agent, to, d, dt, DRIFT_PACE)
      // A drift leg is a straight line at a spot only ever checked for being *inside* a
      // wall, never for being reachable — so it can run into the side of a building.
      // Give the leg up at the first refused step rather than shuffling against the wall
      // until the next wander comes due, which is several seconds of walking on the spot.
      if (agent.blocked) agent.driftBlocked = true
      return
    }
    // Arrived — or the spot was never far enough away to be worth crossing. Stop dead
    // rather than easing down through the speeds no standing clip can carry, and hold
    // still until the next wander is due, only yielding to anyone standing inside us.
    agent.vel.set(0, 0, 0)
    this._settle(agent, dt)
  }

  /**
   * Push a seated agent out of anyone it has ended up inside, and do nothing else.
   *
   * Separation on its own converges: once no neighbour is within the radius the push is
   * zero and the agent is still. That is the whole difference between resolving a pile-up
   * and wandering. The push is applied to position only, never to velocity, so a nudged
   * sleeper does not read as walking and stays in its sitting clip.
   */
  _settle(agent, dt) {
    const push = this._separation(agent, this._sep)
    if (push.x === 0 && push.z === 0) return
    const dx = push.x * dt
    const dz = push.z * dt
    if (this.nav) this.nav.slide(agent.pos, dx, dz)
    else {
      agent.pos.x += dx
      agent.pos.z += dz
    }
  }

  /**
   * Working: walk round the building and hammer at it from a different side every so often.
   *
   * A thread that is running is *doing* something, and an astronaut welded to one spot for
   * an hour does not say that. Spots are picked on the ring the roster put it on, so it
   * never wanders off its own site, and it always turns to face the thing it is hitting.
   */
  _workRound(agent, dt, elapsed) {
    if (elapsed > agent.workAt) {
      agent.workAt = elapsed + 5 + Math.random() * 7
      const radius = workRadius(agent.site, agent.anchor, agent.gaveUp)
      // Somewhere else on the ring — at least a third of the way round, so a move is worth
      // making rather than a shuffle on the spot.
      const from = Math.atan2(agent.pos.z - agent.anchor.z, agent.pos.x - agent.anchor.x)
      agent.workSpot.copy(agent.site)
      // Same rule as a drift: a spot on the ring that is walled off, or that somebody else
      // is already working from, is not a spot.
      for (let i = 0; i < 4; i++) {
        const a = from + (Math.random() > 0.5 ? 1 : -1) * (1.1 + Math.random() * 1.6)
        const wx = agent.anchor.x + Math.cos(a) * radius
        const wz = agent.anchor.z + Math.sin(a) * radius
        if (this.nav?.isBlocked(wx, wz)) continue
        if (this._crowded(wx, wz, agent)) continue
        agent.workSpot.set(wx, 0, wz)
        break
      }
      agent.driftBlocked = false
    }

    // A check happens standing still, and moving off ends one. `phoneCheck` only: a theme
    // without the props never starts one, so `checkStart` stays -1 and nothing below moves.
    if (this.checkProps) {
      if (agent.groundSpeed > 0.12) agent.checkStart = -1
      else this._check(agent, elapsed)
    }

    const to = this._v.set(agent.workSpot.x - agent.pos.x, 0, agent.workSpot.z - agent.pos.z)
    const d = to.length()
    if (d > DRIFT_ARRIVE && !agent.driftBlocked && agent.checkStart < 0) {
      this._walk(agent, to, d, dt, DRIFT_PACE)
      if (agent.blocked) agent.driftBlocked = true
      return
    }
    // Arrived: stop dead, turn to the work, and swing.
    agent.vel.set(0, 0, 0)
    this._faceToward(agent, agent.anchor, dt)
    this._settle(agent, dt)
  }

  /**
   * Now and then a working astronaut stops swinging, gets something out — a phone, for now —
   * looks at it for a few seconds and puts it away again (upstream 559ad85). Its next move
   * round the building is pushed back so it is not walked off mid-check; a status change or a
   * walk cancels one outright.
   */
  _check(agent, elapsed) {
    if (agent.checkStart >= 0) {
      agent.checkT = elapsed - agent.checkStart
      if (agent.checkT < CHECK_LEN) return
      agent.checkStart = -1
      agent.checkT = -1
      agent.checkAt = elapsed + CHECK_EVERY[0] + featureRng('phoneCheck')() * (CHECK_EVERY[1] - CHECK_EVERY[0])
      return
    }
    // The first one is not straight away: the astronaut has only just arrived.
    if (agent.checkAt === 0) agent.checkAt = elapsed + 6 + featureRng('phoneCheck')() * (CHECK_EVERY[1] - CHECK_EVERY[0])
    if (elapsed < agent.checkAt) return
    // No clip baked for it, no check: the phone would be held in a hammering hand.
    if (!this.rig?.clips?.phone) return
    agent.checkStart = elapsed
    agent.checkProp = pickProp(featureRng('phoneCheck'))
    agent.workAt = Math.max(agent.workAt, elapsed + CHECK_LEN + 1.5)
  }

  _faceToward(agent, point, dt) {
    // Stand a little back from the build site and look at it.
    const dx = point.x - agent.pos.x
    const dz = point.z - agent.pos.z
    if (Math.abs(dx) + Math.abs(dz) > 0.01) agent.targetYaw = Math.atan2(dx, dz)
  }

  /**
   * What each status adds on top of its clip, once the agent has arrived.
   *
   * Vertical motion used to live here — a hop for celebrating, a slump for blocked. The
   * clips own all of that now, and a hand-written offset on top of an authored one only
   * ever fights it, so the only thing left is the slow turn a celebrating agent does on
   * the spot, which no single clip can express.
   */
  _sitePose(agent, dt, elapsed, anim) {
    agent.hop = 0
    if (agent.status === 'celebrating') agent.targetYaw += dt * 1.4 * anim
  }

  /** Pick this frame's face: a status loop, interrupted by the agent's own blink clock. */
  _face(agent, dt) {
    agent.faceTimer += dt
    agent.blinkAt -= dt

    if (agent.state === 'spawning' && agent.stateAge < 0.8) {
      agent.faceFrame = this.faces.FACE.boot
      return
    }
    if (agent.state === 'leaving') {
      agent.faceFrame = agent.stateAge % 2 < 1.4 ? this.faces.FACE.happy : this.faces.FACE.wink
      return
    }
    // Blink beats everything except sleeping — a sleeping agent's eyes are already shut.
    if (agent.blinkAt <= 0 && agent.status !== 'sleeping' && agent.status !== 'blocked') {
      agent.faceFrame = this.faces.FACE.blink
      if (agent.blinkAt < -0.12) agent.blinkAt = 2.4 + Math.random() * 5
      return
    }

    const loop = agent.loop
    if (!loop || !loop.length) {
      agent.faceFrame = this.faces.FACE.idle
      return
    }
    const rate = agent.status === 'working' ? 0.22 : 0.55
    if (agent.faceTimer > rate) {
      agent.faceTimer = 0
      agent.faceIndex = (agent.faceIndex + 1) % loop.length
    }
    agent.faceFrame = loop[agent.faceIndex]
  }

  // ── animation ───────────────────────────────────────────────────────────────────────

  /**
   * Choose the clip an agent should be playing and advance its clock.
   *
   * Locomotion wins over status: an idler pottering across its plot walks, it does not
   * hammer while sliding. Walk playback is driven by actual ground speed so short steps
   * cannot moonwalk — the same rule the old hand-written cycle followed, applied to a real
   * one instead.
   */
  _animate(agent, dt, anim) {
    const rig = this.rig
    if (!rig) return

    // Any real translation belongs in a walk clip. The threshold is low on purpose: what it
    // guards against is the reverse mistake, an agent standing in an idle pose while the
    // world slides past its feet, and the movement code is what keeps it from dawdling
    // just under the line.
    const speed = agent.groundSpeed || 0
    const clips = this.stateClips
    // Every state resolves through the character, because a mage casts where a knight
    // hammers. A single-body crew reading a plain `stateClips` entry gets exactly the
    // string the old direct lookup returned.
    const c = agent.character
    const walkKey = clipFor(clips, 'walk', c)
    const runKey = clipFor(clips, 'run', c)
    const idleKey = clipFor(clips, 'idle', c)
    // Resting and sleeping both get down first: a one-shot that hands over to its loop when
    // it finishes, so an agent that has just sat down or nodded off lowers itself rather
    // than snapping into the pose.
    const seated =
      agent.status === 'sleeping'
        ? { loop: clipFor(clips, 'sleeping', c), down: clipFor(clips, 'sittingDown', c) }
        : agent.status === 'resting'
          ? { loop: clipFor(clips, 'resting', c), down: clipFor(clips, 'restingDown', c) }
          : null
    let key
    if (agent.state === 'spawning') key = clipFor(clips, 'spawn', c)
    else if (speed > 0.12) key = speed > WALK_SPEED * 1.25 ? runKey : walkKey
    // Already on the floor — resting nodding off into a nap — goes straight to the new loop:
    // a get-down clip starts from standing, and playing it here pops the body up first.
    else if (seated) {
      const onFloor = agent.clipKey === clipFor(clips, 'resting', c) || agent.clipKey === clipFor(clips, 'sleeping', c)
      key = onFloor ? seated.loop : seated.down
    }
    // A check raises the arm, holds it and lowers it, on its own clock (`phoneCheck` only).
    else if (agent.status === 'working' && agent.checkStart >= 0) {
      const t = agent.checkT
      key = t < 0.5 ? 'phoneUp' : t > CHECK_LEN - 0.55 ? 'phoneDown' : 'phone'
    }
    else key = clipFor(clips, agent.status, c) || idleKey

    if (key !== agent.clipKey) {
      agent.clipKey = key
      agent.clipTime = 0
    }

    const clip = rig.clips[key] || rig.clips[idleKey]
    if (!clip) return

    // Stride rate follows the ground, everything else runs at its authored speed. A smaller
    // body covers less ground per stride, so `strideRate` divides the pace by the size and a
    // half-height helper keeping up with the adults takes twice the steps to do it.
    const rate = key === walkKey || key === runKey ? strideRate(speed, WALK_SPEED, agent.size) : 1
    agent.clipTime += dt * anim * rate

    if (seated && key === seated.down && agent.clipTime >= clip.duration) {
      agent.clipKey = seated.loop
      agent.clipTime = 0
      agent.frame = frameFor(rig.clips[seated.loop], 0)
      return
    }
    agent.frame = frameFor(clip, agent.clipTime)
  }

  /** How far through its current clip an agent is, 0..1, or -1 without one. */
  clipPhase(agent) {
    const clip = this.rig?.clips?.[agent.clipKey]
    if (!clip || !clip.duration) return -1
    return (agent.clipTime / clip.duration) % 1
  }

  /** Where in a clip the tool lands: the manifest's `strike`, or halfway. */
  clipStrike(agent) {
    return this.theme.manifest.crew.clips?.[agent.clipKey]?.strike ?? 0.5
  }

  // ── writing the instance buffers ────────────────────────────────────────────────────

  _writeMatrices(elapsed, anim) {
    const rig = this.rig
    const root = this._m
    const child = this._m2
    const bone = this._m3
    const worn = this._m4
    const q = this._q
    const e = this._e
    const v = this._v
    const one = this._one
    // A theme with no face part has no expression atlas, and nothing to write into it.
    const frames = this.frameAttr?.array
    // One instance counter per character: an unused slot in the middle of an instanced mesh
    // still draws, so each body packs its own agents down from zero.
    const crewMeshes = this.crewMeshes || []
    const crewCounts = new Array(crewMeshes.length).fill(0)

    let i = 0
    // Parts only some agents wear — a state-gated part, one belonging to a single character,
    // or one a cue puts on a helper — get their own instance counter, because an unused slot
    // in the middle of an instanced mesh still draws whatever matrix it was last given.
    const ownCount = {}
    for (const [name, mesh] of Object.entries(this.parts)) {
      const spec = mesh.userData.spec
      if (spec.when || spec.character || spec.cue) ownCount[name] = 0
    }
    let staticDirty = false
    const checkProps = this.checkProps
    checkProps?.begin()
    checkProps?.update(elapsed)
    for (const agent of this.agents) {
      // Never write past the end of the instance buffers. Going over is not a rendering
      // artefact you can squint past: WebGL refuses the whole `drawElementsInstanced` call, so
      // one agent too many takes *every* astronaut off screen at once.
      //
      // It can go over. `setRoster` caps how many agents it will spawn, but an agent that has
      // left the roster stays in this list while it walks back to the ship — and the slot it
      // vacated in the roster is immediately filled by a thread that was previously past the
      // cap. Archive one thread on a colony sitting at the cap and there is briefly one more
      // agent than there are slots, which is exactly when the colony would empty.
      if (i >= this.capacity) break
      if (agent.state === 'gone') continue
      const s = agent.scale
      if (s <= 0.001) continue

      // Root transform for the whole character. The rig is authored at 2.2 units tall, so
      // CREW_SCALE rides along here and everything downstream inherits it — including
      // `agent.size`, which is how a helper is drawn at half the height of its parent
      // without a single worn part, or the depth pass, being told about it.
      e.set(0, agent.yaw, 0)
      q.setFromEuler(e)
      v.set(agent.pos.x, agent.pos.y, agent.pos.z)
      root.compose(v, q, one.setScalar(s * CREW_SCALE * agent.size))
      one.setScalar(1)

      const cm = crewMeshes[agent.characterIndex]
      if (cm) {
        const ci = crewCounts[agent.characterIndex]++
        cm.setMatrixAt(ci, root)
        this.crewFrameAttrs[agent.characterIndex].array[ci] = agent.frame
        const colourAttr = this.crewColourAttrs[agent.characterIndex]
        if (colourAttr) colourAttr.array[ci] = agent.colourway
        if (agent.crewIndex !== ci || agent.colorDirty) cm.setColorAt(ci, this._color.setHex(agent.suit))
        agent.crewIndex = ci
      }

      // Suit and trim only change when the status does, or when an agent leaving the roster
      // shuffles everyone's slot along — so they are written on those frames, not all of them.
      const c = this._color
      const recolour = agent.index !== i || agent.colorDirty

      // Everything worn hangs off a bone at the frame the body is actually on, so a helmet
      // cannot drift off a head that is looking down or lying on the ground. Walked in bone
      // order — `partPlan` — so a bone's matrix is fetched once per agent.
      if (rig) {
        let lastBone = null
        for (const [name, mesh] of this.partPlan) {
          const spec = mesh.userData.spec
          if (!wornBy(spec, agent)) continue
          if (spec.bone !== lastBone) {
            attachMatrixAt(rig, agent.frame, this.slots[spec.bone], bone)
            worn.multiplyMatrices(root, bone)
            lastBone = spec.bone
          }
          const o = spec.offset
          // A part on its own counter sits at a different slot from the agent's, so its
          // tint has to be written there too — writing at `i` would paint someone else.
          const own = name in ownCount
          const at = own ? ownCount[name]++ : i
          setPart(child, worn, mesh, at, o.x, o.y, o.z, o.rx, o.ry, o.rz, spec.scale ?? 1)
          if (own && recolour) {
            const t = spec.tint
            if (t === 'suit') mesh.setColorAt(at, c.setHex(agent.suit))
            else if (t === 'trim') mesh.setColorAt(at, agent.trim)
            else if (t === 'eye') mesh.setColorAt(at, agent.eye)
            else if (t === 'accent') mesh.setColorAt(at, agent.accent)
          }
        }
        // And whatever a checking astronaut has got out, in its left hand.
        if (checkProps && agent.checkStart >= 0 && agent.clipKey?.startsWith('phone') && this.slots.handL !== undefined) {
          attachMatrixAt(rig, agent.frame, this.slots.handL, bone)
          worn.multiplyMatrices(root, bone)
          checkProps.write(agent.checkProp, worn, elapsed - agent.checkStart)
        }
      }

      if (recolour) {
        agent.colorDirty = false
        for (const [name, mesh] of Object.entries(this.parts)) {
          if (name in ownCount) continue // painted at its own index, above
          const t = mesh.userData.spec.tint
          if (t === 'suit') mesh.setColorAt(i, c.setHex(agent.suit))
          else if (t === 'trim') mesh.setColorAt(i, agent.trim)
          else if (t === 'eye') mesh.setColorAt(i, agent.eye)
          else if (t === 'accent') mesh.setColorAt(i, agent.accent)
        }
        staticDirty = true
      }

      // Antenna tip and chest lamp pulse; a blocked agent's lamp stutters like a fault light.
      const pulse =
        agent.status === 'blocked'
          ? (Math.sin(elapsed * 9) > 0.2 ? 1 : 0.05)
          : 0.55 + 0.45 * Math.sin(elapsed * 2.6 + agent.phase)
      for (const mesh of Object.values(this.parts)) {
        const t = mesh.userData.spec.tint
        if (t === 'pulseEye') mesh.setColorAt(i, c.copy(agent.eye).multiplyScalar(0.6 + pulse * 1.1))
        else if (t === 'pulseTrim') mesh.setColorAt(i, c.copy(agent.trim).multiplyScalar(0.7 + pulse * 1.6))
      }

      // Atlas frame for the face.
      const f = agent.faceFrame
      if (frames) {
        frames[i * 2] = (f % this.faces.cols) / this.faces.cols
        frames[i * 2 + 1] = 1 - (Math.floor(f / this.faces.cols) + 1) / this.faces.rows
      }

      agent.index = i
      this._drawnAgents[i] = agent
      i++
    }

    const n = i
    this._drawnAgents.length = n
    checkProps?.end()
    for (const [name, mesh] of Object.entries(this.parts)) {
      const spec = mesh.userData.spec
      mesh.count = name in ownCount ? ownCount[name] : n
      mesh.instanceMatrix.needsUpdate = true
      // The glowing parts pulse every frame; the rest only re-upload when something moved slot.
      const pulses = spec.tint === 'pulseEye' || spec.tint === 'pulseTrim'
      if (mesh.instanceColor && (staticDirty || pulses)) mesh.instanceColor.needsUpdate = true
    }
    crewMeshes.forEach((cm, k) => {
      cm.count = crewCounts[k]
      cm.instanceMatrix.needsUpdate = true
      this.crewFrameAttrs[k].needsUpdate = true
      if (this.crewColourAttrs[k]) this.crewColourAttrs[k].needsUpdate = true
      if (staticDirty && cm.instanceColor) cm.instanceColor.needsUpdate = true
    })
    if (this.frameAttr) this.frameAttr.needsUpdate = true
    this.visibleCount = n
  }

  // ── picking ─────────────────────────────────────────────────────────────────────────

  /**
   * Nearest agent to a screen point, in screen space. Cheaper than raycasting ten instanced
   * meshes and far kinder to click, since the hit radius grows with how big the astronaut
   * actually is on screen rather than with its silhouette.
   */
  pick(camera, ndcX, ndcY, aspect, maxDist = 0.075) {
    let best = null
    let bestScore = Infinity
    const v = this._v
    const b = this._pickBadge
    const lifted = this._pickLifted

    for (const agent of this.agents) {
      if (agent.scale < 0.3 || agent.state === 'gone') continue
      // The head height is measured on a full-grown body, so a smaller one wears it lower.
      bendPoint(v.set(agent.pos.x, agent.pos.y + (this.headHeight || 0.75) * agent.size, agent.pos.z)).project(camera)
      if (v.z > 1) continue // behind the camera
      agent.screen.copy(v)
      const dx = (v.x - ndcX) * aspect
      const dy = v.y - ndcY
      let d = Math.hypot(dx, dy)

      // The badge over an astronaut's head is what you actually aim at when one wants you —
      // it is bigger than the astronaut, it is the thing that caught your eye, and it sits
      // clear of the crowd. So the whole bubble picks the astronaut it belongs to, not just
      // a point at its middle.
      //
      // The geometry has to be recomputed the way `indicators.js` draws it rather than
      // guessed at. That shader anchors the quad just above the helmet and then lifts it by
      // half its own height *in view space*, where the height itself grows with distance so
      // the badge holds a constant pixel size. A fixed world-space offset cannot follow that:
      // it is right at one zoom and most of a metre low at another, which is why this used to
      // demand a click on the astronaut's head.
      const size = agent.badgeSize || 0
      if (size > 0) {
        // View space, exactly as the vertex shader has it.
        bendPoint(b.set(agent.pos.x, agent.badgeY, agent.pos.z)).applyMatrix4(camera.matrixWorldInverse)
        const scale = size * (2 + -b.z * 0.22)
        b.y += scale * 0.5
        // A second point one half-height higher gives the quad's on-screen radius without
        // re-deriving the projection: whatever the camera does to one, it does to both.
        lifted.copy(b)
        lifted.y += scale * 0.5
        b.applyMatrix4(camera.projectionMatrix)
        lifted.applyMatrix4(camera.projectionMatrix)
        if (b.z <= 1) {
          // The quad is square, and `bx` is already in the same units as `by`, so one
          // half-extent covers both axes.
          const half = Math.abs(lifted.y - b.y)
          const bx = (b.x - ndcX) * aspect
          const by = b.y - ndcY
          // Anywhere inside the bubble is a hit outright; outside it, the distance to its
          // edge, so a near-miss still competes with a nearer astronaut on the same pixel.
          const ox = Math.max(0, Math.abs(bx) - half)
          const oy = Math.max(0, Math.abs(by) - half)
          const bd = Math.hypot(ox, oy)
          if (bd < d) d = bd
        }
      }
      if (d > maxDist) continue
      // Break ties by depth so the nearer of two overlapping agents wins.
      const score = d + v.z * 0.05
      if (score < bestScore) {
        bestScore = score
        best = agent
      }
    }
    return best
  }

  /**
   * Both rings are sized to the body they are drawn under — a ring cut for an adult around a
   * half-height helper is a hula hoop, and reads as belonging to whoever is standing behind it.
   */
  setHover(agent) {
    this.hoverRing.visible = Boolean(agent)
    if (agent) {
      this.hoverRing.position.set(agent.pos.x, agent.pos.y + 0.03, agent.pos.z)
      this.hoverRing.scale.setScalar(agent.size)
    }
  }

  setSelected(agent) {
    this.selected = agent || null
    this.selectRing.visible = Boolean(agent)
  }

  updateRings(elapsed) {
    if (this.selected) {
      if (!this.byId.has(this.selected.id)) {
        this.setSelected(null)
      } else {
        const a = this.selected
        this.selectRing.position.set(a.pos.x, a.pos.y + 0.035, a.pos.z)
        this.selectRing.rotation.y = elapsed * 0.6
        const s = 1 + Math.sin(elapsed * 3) * 0.05
        this.selectRing.scale.setScalar(s * a.size)
      }
    }
    if (this.hoverRing.visible) this.hoverRing.rotation.y = -elapsed * 0.4
  }

  /** A quick wave — played when you open an agent's thread. */
  celebrate(id) {
    const agent = this.byId.get(id)
    if (!agent) return
    agent.faceFrame = this.faces.FACE.happy
    agent.blinkAt = 1.5
    agent.hop = 0.25
  }

  dispose() {
    for (const mesh of Object.values(this.parts)) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    this._disposeCrew()
    this._disposeCheckProps()
    // The bone texture is the rig's, not this instance's — the rig outlives any one colony.
    this.faceTexture.dispose()
    this.scene.remove(this.group)
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────

const _cq = new THREE.Quaternion()
const _ce = new THREE.Euler()
const _cv = new THREE.Vector3()
const _cs = new THREE.Vector3(1, 1, 1)

/**
 * Compose a child's local transform, concatenate onto the root, and store the instance.
 *
 * `scale` is how a prop authored for another pack's proportions is brought onto this rig — a
 * hexagon-pack hammer is a fifth the length of the tools the villagers' own pack ships. It
 * defaults to 1 and the scratch vector is put back afterwards, so a theme whose specs carry no
 * scale composes exactly the matrix it always has.
 */
function setPart(scratch, root, mesh, index, x, y, z, rx, ry, rz, scale = 1) {
  _ce.set(rx, ry, rz)
  _cq.setFromEuler(_ce)
  _cv.set(x, y, z)
  scratch.compose(_cv, _cq, _cs.setScalar(scale))
  _cs.setScalar(1)
  scratch.premultiply(root)
  mesh.setMatrixAt(index, scratch)
}

function angleDamp(current, target, lambda, dt) {
  let delta = target - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * (1 - Math.exp(-lambda * dt))
}

function ring(inner, outer, color, opacity) {
  const geo = new THREE.RingGeometry(inner, outer, 32)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 3
  return mesh
}

// The suit-tone hash lives in `cast.js` now, next to the character draw that shares it.
// Re-exported here because everything downstream has always imported it from the astronauts.
export { hash }
