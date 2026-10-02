/**
 * Where the astronauts are allowed to walk.
 *
 * The colony is a scattering of convex obstacles on flat ground, which is the case a grid
 * handles well and cheaply: buildings and the ship are rasterised into a blocked bitmap
 * whenever the roster changes, and agents route across it with A*.
 *
 * There are three independent guarantees here, and all of them matter:
 *
 * 1. **Routing** — A* finds a way around a building rather than through it, including
 *    threading the gaps between a ring of them. Paths are string-pulled afterwards so an
 *    astronaut walks a straight line where it can rather than a visible staircase.
 * 2. **Reachability** — `setSeed` floods the open cells from the arrival's threshold, so the
 *    colony can ask whether a spot is joined to the rest of the world *before* it sends anybody
 *    to it. The gaps between overlapping buildings are open ground nobody can get to, and a
 *    standing spot in one is a villager pressed against a wall for the life of the thread.
 * 3. **Collision** — `slide()` is applied to every step regardless of whether the agent is
 *    following a path. Routing can fail (a site that got walled in between polls, a path
 *    budget that has not caught up yet); walking through a wall must not be what happens
 *    when it does.
 *
 * Search scratch is reused across calls and invalidated by a generation stamp rather than
 * being cleared, so a path costs no allocation and no 50k-element memset.
 */

/** Cell size, in metres. Small enough to resolve the gaps between neighbouring buildings. */
export const NAV_CELL = 0.5
/**
 * Walkable ground outside the outermost deck a zone can be dealt.
 *
 * The crew's own standing spots never need it — a work spot is at most about 7.4 from its tile
 * centre, inside the tile's own 7.6 — but a villager rounding the last deck does.
 */
export const NAV_MARGIN = 3.6
/**
 * Half-width of the navigable square: the lattice's own reach plus that margin, rounded up to
 * a whole cell. `√3 · 7.6 · 11 + 7.6 + 3.6`, which is 156, well inside the ±170 the ground
 * plane covers.
 *
 * A constant rather than an import, because this module deliberately depends on nothing — that
 * is what lets its tables be held in `node --test`. `tests/navigation.test.mjs` holds it to the
 * arithmetic in `plots.js`, which is the join that cannot rot.
 */
export const DEFAULT_HALF = 156
/**
 * Give up rather than stall the frame if a search goes pathological.
 *
 * Sized for the longest route the map can ask for: the ship to a ring-eleven deck is about
 * three hundred cells, measured at 14,110–19,486 expansions and 2.3–3.0 ms across a colony's
 * worth of blocking scatter. The old 6,000 was sized for a square a quarter this wide and cut
 * every one of those short.
 */
export const MAX_EXPANSIONS = 24000

const SQRT2 = Math.SQRT2

/**
 * A fill covering less of the open ground than this is a pocket, not the colony — the threshold
 * itself has been ringed in. A real colony's threshold reaches nearly all of it (the fixtures
 * measure above 0.9); a walled-in door measured 112 cells of 49972, which is 0.002.
 */
const SEED_MIN_SHARE = 0.25

/**
 * A slide that covers less than this fraction of the step asked for is a refusal.
 *
 * An axis-only slide moves `cos θ` of the step, θ the angle between the step and the free
 * axis. 0.3 refuses approaches within ~17.5° of the wall's normal and accepts everything
 * shallower — which is the difference between sliding along a wall and walking at one.
 */
export const SLIDE_MIN_FRACTION = 0.3

/**
 * Did the move `(gotX, gotZ)` count as progress on the step `(dx, dz)`?
 *
 * Relative rather than absolute on purpose: `_walk` scales its step by `min(1, goalDist / 1.8)`,
 * so an arriving villager legitimately asks for sub-millimetre steps and an absolute floor
 * would refuse every arrival.
 *
 * @param {number} dx step asked for, on x
 * @param {number} dz step asked for, on z
 * @param {number} gotX movement the slide would actually make, on x
 * @param {number} gotZ movement the slide would actually make, on z
 * @param {number} [fraction] the floor, as a fraction of the step asked for
 * @returns {boolean}
 */
export function slideCounts(dx, dz, gotX, gotZ, fraction = SLIDE_MIN_FRACTION) {
  const asked = Math.hypot(dx, dz)
  if (asked === 0) return true
  return Math.hypot(gotX, gotZ) >= fraction * asked
}

/** Two equal-length byte arrays, compared cell by cell. */
function sameBytes(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export class Navigation {
  /**
   * @param {{half?: number}} [opts] half-width of the square, in metres. The default covers
   *   every tile the allocator can hand out; the tests that were written on the old ±56 square
   *   pass that size explicitly.
   */
  constructor({ half = DEFAULT_HALF } = {}) {
    this.cell = NAV_CELL
    this.half = half
    this.size = Math.ceil((half * 2) / NAV_CELL)
    const n = this.size * this.size

    this.blocked = new Uint8Array(n)
    /**
     * The ground's own veto, which no building can change: the sea, and everything outside the
     * lattice a zone can be placed on. Rasterised once per setting by `setGround` and copied
     * into `blocked` at the head of every rebuild.
     */
    this.ground = new Uint8Array(n)
    /** What `ground` was rasterised for. A rebuild never re-evaluates it; a new key does. */
    this.groundKey = null
    /**
     * Which open cells the colony can actually be walked to, from the arrival's threshold.
     *
     * An open cell is not the same thing as a cell somebody can get to: two buildings whose
     * blocked discs overlap leave pockets of one to six free cells between them, and `nearestFree`
     * hands those back as happily as any other ground. A villager sent to one walks at the wall
     * between it and the world for eight seconds and then gives up. This is the answer to the
     * question that actually matters — filled by `setSeed`, read by `isReachable`.
     */
    this.reachable = new Uint8Array(n)
    /** The cell the fill started from, and the `layout` it was filled against. -1 for "never filled". */
    this.reachSeed = -1
    this.reachLayout = -1
    this._queue = new Int32Array(n)
    this.gScore = new Float32Array(n)
    this.parent = new Int32Array(n)
    this.stamp = new Int32Array(n) // which search last touched this node
    this.closed = new Uint8Array(n)

    this.heap = new Int32Array(n)
    this.heapKey = new Float32Array(n)
    this.heapSize = 0

    this.generation = 0
    /** Bumped on every rebuild; agents use it to notice their path is stale. */
    this.version = 0
    /**
     * Bumped only when a rebuild leaves a different set of cells blocked.
     *
     * `version` cannot answer "has the ground changed?" because the colony rebuilds on every
     * poll whether or not anything moved. An agent that gave up on an unreachable site asks
     * this instead: while `layout` holds still, the site it abandoned is exactly as
     * unreachable as it was, and walking at it again would only end in the same give-up.
     */
    this.layout = 0
    this._previous = new Uint8Array(n)
    /**
     * Why the last `findPath` came back the way it did: `'found'`, `'unreachable'` (the goal is
     * walled off from the start — the reachability map says so, or the search ran out of ground)
     * or `'cut'` (it hit its expansion cap first, which says nothing about whether a route
     * exists). A null path is both of the last two, and only the first of them is geometry.
     */
    this.lastSearch = 'found'
    /** What the last `findPath` spent, so a caller can budget a frame's worth of searching. */
    this.lastExpansions = 0
  }

  // ── grid <-> world ──────────────────────────────────────────────────────────────────

  toCell(v) {
    return Math.floor((v + this.half) / this.cell)
  }

  toWorld(i) {
    return i * this.cell - this.half + this.cell * 0.5
  }

  inBounds(ix, iz) {
    return ix >= 0 && iz >= 0 && ix < this.size && iz < this.size
  }

  /** True where an astronaut may not stand. Outside the grid counts as blocked. */
  isBlocked(x, z) {
    const ix = this.toCell(x)
    const iz = this.toCell(z)
    if (!this.inBounds(ix, iz)) return true
    return this.blocked[iz * this.size + ix] === 1
  }

  // ── building the map ────────────────────────────────────────────────────────────────

  /**
   * Rasterise the obstacle list. Each is a circle `{ x, z, r }`, already inflated by the
   * caller for the astronaut's own width — doing it here would hide the one number that
   * decides whether the gaps between buildings stay walkable.
   *
   * `isBlocked` is the *ground* itself saying no, which circles cannot express: a coastal
   * setting's shoreline runs through the middle of this square, and without it the crew paths
   * happily across the sea. It is tested once per cell, at the cell's own centre, after the
   * circles are in — so an obstacle already covering a cell costs no predicate call to
   * reconsider, and the two kinds of blocking compose rather than override. Null for every
   * dry setting, which is what keeps this loop off the space theme's path entirely.
   *
   * @param {{x: number, z: number, r: number}[]} obstacles
   * @param {((x: number, z: number) => boolean) | null} [isBlocked] true where the ground
   *   itself is unwalkable — the beach and the slope under a sea.
   */
  /**
   * Rasterise the ground's veto, once per `key`.
   *
   * `key` is what the predicate is a function of — the setting's id, because the terrain
   * sampler behind it is itself memoised on that id. While the key holds, the mask holds, and
   * the per-poll rebuild costs a copy rather than a quarter of a million terrain samples.
   *
   * @param {((x: number, z: number) => boolean) | null} predicate true where nobody may stand
   * @param {string} key what the predicate is a function of
   * @returns {boolean} whether it rasterised anything
   */
  setGround(predicate, key) {
    if (key === this.groundKey) return false
    this.groundKey = key
    this.ground.fill(0)
    if (!predicate) return true
    const size = this.size
    for (let iz = 0; iz < size; iz++) {
      const wz = this.toWorld(iz)
      const row = iz * size
      for (let ix = 0; ix < size; ix++) {
        if (predicate(this.toWorld(ix), wz)) this.ground[row + ix] = 1
      }
    }
    return true
  }

  rebuild(obstacles, isBlocked = null) {
    this._previous.set(this.blocked)
    // The ground's veto is the floor every rebuild starts from, at the cost of a copy.
    this.blocked.set(this.ground)
    const { size, cell } = this

    for (const o of obstacles) {
      const r = o.r
      if (!(r > 0)) continue
      const minX = Math.max(0, this.toCell(o.x - r))
      const maxX = Math.min(size - 1, this.toCell(o.x + r))
      const minZ = Math.max(0, this.toCell(o.z - r))
      const maxZ = Math.min(size - 1, this.toCell(o.z + r))
      // Test against the cell's centre, so a cell is blocked when its middle is inside the
      // obstacle rather than when it merely touches it — that is what keeps thin corridors.
      const r2 = r * r
      for (let iz = minZ; iz <= maxZ; iz++) {
        const wz = this.toWorld(iz)
        const dz = wz - o.z
        const row = iz * size
        for (let ix = minX; ix <= maxX; ix++) {
          const dx = this.toWorld(ix) - o.x
          if (dx * dx + dz * dz <= r2) this.blocked[row + ix] = 1
        }
      }
    }

    if (isBlocked) {
      for (let iz = 0; iz < size; iz++) {
        const wz = this.toWorld(iz)
        const row = iz * size
        for (let ix = 0; ix < size; ix++) {
          if (this.blocked[row + ix] === 1) continue
          if (isBlocked(this.toWorld(ix), wz)) this.blocked[row + ix] = 1
        }
      }
    }

    this.version++
    if (!sameBytes(this.blocked, this._previous)) this.layout++
    void cell
  }

  /**
   * The nearest walkable cell to a point, searched in expanding rings. Used both for a goal
   * that has been built over and for an agent that a new building landed on top of.
   */
  nearestFree(x, z, maxRings = 24) {
    return this._nearestCell(x, z, maxRings, this.blocked, 0)
  }

  /**
   * The ring scan both `nearestFree` and `nearestReachable` are: the nearest cell to `(x, z)`
   * whose entry in `map` is `want`. Taking the array rather than a predicate keeps the inner
   * loop a typed-array read and costs no closure per call — this runs once per agent per poll.
   */
  _nearestCell(x, z, maxRings, map, want) {
    const cx = this.toCell(x)
    const cz = this.toCell(z)
    if (this.inBounds(cx, cz) && map[cz * this.size + cx] === want) return { ix: cx, iz: cz }

    for (let ring = 1; ring <= maxRings; ring++) {
      let best = null
      let bestD = Infinity
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          // Only the shell of the ring; the inside was covered by earlier iterations.
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue
          const ix = cx + dx
          const iz = cz + dz
          if (!this.inBounds(ix, iz)) continue
          if (map[iz * this.size + ix] !== want) continue
          const d = dx * dx + dz * dz
          if (d < bestD) {
            bestD = d
            best = { ix, iz }
          }
        }
      }
      if (best) return best
    }
    return null
  }

  // ── reachable ground ────────────────────────────────────────────────────────────────

  /**
   * Fill `reachable` from a world point — the arrival's threshold, which is where every
   * villager comes from and therefore the definition of "the walkable world" for this colony.
   *
   * A blocked seed falls back to the nearest free cell, because the threshold of a castle sits
   * a hair inside the clearance disc the gatehouse blocks out.
   *
   * The fill costs one pass over the grid, so it is skipped unless it would say something
   * different: the same seed cell against the same `layout` is the same answer. `version` is no
   * use here — the colony rebuilds the grid on every poll whether or not a cell moved.
   */
  setSeed(x, z) {
    const free = this.nearestFree(x, z)
    // Nowhere to stand within reach of the door. Fall back to the grid as it was before the map
    // existed rather than serving a fill built for different ground — an answer that is merely
    // old is worse than no answer, because nothing downstream can tell that it is old.
    if (!free) {
      this.reachSeed = -1
      return
    }
    const idx = free.iz * this.size + free.ix
    if (idx === this.reachSeed && this.layout === this.reachLayout) return
    this.reachSeed = idx
    this.reachLayout = this.layout
    const filled = this._fill(idx)
    // A threshold that is itself ringed in fills a pocket and calls it the world: every site off
    // it reads unreachable, which switches off doorway retries for the whole crew and quietly
    // reverts the ring walk. Too small to be the colony means the seed is wrong, not the ground,
    // so say so by falling back to the unseeded behaviour.
    if (filled < this._freeCells() * SEED_MIN_SHARE) this.reachSeed = -1
  }

  /** How much open ground there is, for judging whether a fill covers the colony or a pocket. */
  _freeCells() {
    let free = 0
    for (let i = 0; i < this.blocked.length; i++) if (this.blocked[i] === 0) free++
    return free
  }

  /**
   * Can a villager walk to this point from the threshold?
   *
   * Before the first `setSeed` — a `Navigation` nobody has handed a door to — every open cell
   * counts, which is exactly what the grid meant before the map existed.
   */
  isReachable(x, z) {
    if (this.reachSeed < 0) return !this.isBlocked(x, z)
    const ix = this.toCell(x)
    const iz = this.toCell(z)
    if (!this.inBounds(ix, iz)) return false
    return this.reachable[iz * this.size + ix] === 1
  }

  /** `nearestFree`, restricted to ground that is actually joined to the rest of the colony. */
  nearestReachable(x, z, maxRings = 24) {
    if (this.reachSeed < 0) return this.nearestFree(x, z, maxRings)
    return this._nearestCell(x, z, maxRings, this.reachable, 1)
  }

  /**
   * One 8-connected flood fill over the open cells, moving exactly as `_search` is allowed to:
   * a diagonal only where both of its orthogonals are clear. The two have to agree, or the map
   * would promise ground A* then refuses to route to.
   */
  _fill(startIdx) {
    const size = this.size
    const { reachable, blocked } = this
    reachable.fill(0)
    const queue = this._queue
    let head = 0
    let tail = 0
    queue[tail++] = startIdx
    reachable[startIdx] = 1

    while (head < tail) {
      const current = queue[head++]
      const cx = current % size
      const cz = (current - cx) / size
      for (let k = 0; k < 8; k++) {
        const nx = cx + NEIGHBOURS[k * 2]
        const nz = cz + NEIGHBOURS[k * 2 + 1]
        if (!this.inBounds(nx, nz)) continue
        const nIdx = nz * size + nx
        if (blocked[nIdx] === 1 || reachable[nIdx] === 1) continue
        if (k >= 4 && (blocked[cz * size + nx] === 1 || blocked[nz * size + cx] === 1)) continue
        reachable[nIdx] = 1
        queue[tail++] = nIdx
      }
    }
    return tail
  }

  // ── line of sight ───────────────────────────────────────────────────────────────────

  /** Sampled along the segment at half-cell steps — dense enough that nothing slips through. */
  lineOfSight(x0, z0, x1, z1) {
    const dx = x1 - x0
    const dz = z1 - z0
    const dist = Math.hypot(dx, dz)
    const steps = Math.ceil(dist / (this.cell * 0.5))
    if (steps === 0) return !this.isBlocked(x0, z0)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      if (this.isBlocked(x0 + dx * t, z0 + dz * t)) return false
    }
    return true
  }

  // ── A* ──────────────────────────────────────────────────────────────────────────────

  /**
   * A* from one cell index to another over the blocked grid, leaving the route in `parent`.
   * `'found'`, `'cut'` when it spends `maxExpansions` first, or `'unreachable'` when it runs out
   * of ground to expand.
   */
  _search(startIdx, goalIdx, maxExpansions) {
    const size = this.size
    const gx = goalIdx % size
    const gz = (goalIdx - gx) / size
    const gen = ++this.generation
    const { gScore, parent, stamp, closed } = this
    this.heapSize = 0

    gScore[startIdx] = 0
    parent[startIdx] = -1
    stamp[startIdx] = gen
    closed[startIdx] = 0
    this._push(startIdx, this._heuristic(startIdx % size, (startIdx - (startIdx % size)) / size, gx, gz))

    let expansions = 0
    let found = false
    let cut = false

    while (this.heapSize > 0) {
      const current = this._pop()
      if (closed[current] === 1) continue
      closed[current] = 1
      if (current === goalIdx) {
        found = true
        break
      }
      if (++expansions > maxExpansions) {
        cut = true
        break
      }

      const cx = current % size
      const cz = (current - cx) / size
      const g = gScore[current]

      for (let k = 0; k < 8; k++) {
        const nx = cx + NEIGHBOURS[k * 2]
        const nz = cz + NEIGHBOURS[k * 2 + 1]
        if (!this.inBounds(nx, nz)) continue
        const nIdx = nz * size + nx
        if (this.blocked[nIdx] === 1) continue
        if (stamp[nIdx] === gen && closed[nIdx] === 1) continue

        // No corner cutting: a diagonal is only legal when both of its orthogonal
        // neighbours are clear, or agents will clip the corners of buildings.
        const diagonal = k >= 4
        if (diagonal) {
          if (this.blocked[cz * size + nx] === 1 || this.blocked[nz * size + cx] === 1) continue
        }

        const tentative = g + (diagonal ? SQRT2 : 1)
        if (stamp[nIdx] === gen && tentative >= gScore[nIdx]) continue

        stamp[nIdx] = gen
        closed[nIdx] = 0
        gScore[nIdx] = tentative
        parent[nIdx] = current
        this._push(nIdx, tentative + this._heuristic(nx, nz, gx, gz))
      }
    }

    this.lastExpansions = expansions
    return found ? 'found' : cut ? 'cut' : 'unreachable'
  }

  /**
   * A route from one world point to another, as world-space waypoints, or `null` if there
   * is no way through. The returned path excludes the start and ends exactly on the goal.
   */
  findPath(sx, sz, tx, tz, maxExpansions = MAX_EXPANSIONS) {
    const start = this.nearestFree(sx, sz)
    const goal = this.nearestFree(tx, tz)
    if (!start || !goal) {
      this.lastSearch = 'unreachable'
      this.lastExpansions = 0
      return null
    }

    const size = this.size
    const startIdx = start.iz * size + start.ix
    const goalIdx = goal.iz * size + goal.ix

    /**
     * The map answers "is there a way through?" outright, and for free.
     *
     * A search cut short proves nothing, and on an open map a walled-off goal is exactly the
     * search that gets cut: it floods the whole outside before it spends the cap. So the one
     * geometric fact — these two cells are not joined — is read off the flood fill instead.
     * One of them inside the threshold's component and the other outside it is that fact.
     * Both outside says only that neither is joined to the door, which is not the same claim,
     * and those fall through to the search as they always did.
     */
    if (this.reachSeed >= 0 && this.reachable[startIdx] !== this.reachable[goalIdx]) {
      this.lastSearch = 'unreachable'
      this.lastExpansions = 0
      return null
    }

    // A goal that has been built over — a stand position a new building landed on, or a
    // point simply inside a wall — resolves to the nearest walkable spot. Routing to the
    // requested point instead would end every such path with a leg through the obstacle.
    const reachableX = this.isBlocked(tx, tz) ? this.toWorld(goal.ix) : tx
    const reachableZ = this.isBlocked(tx, tz) ? this.toWorld(goal.iz) : tz

    // Straight shot: by far the common case in an open colony, and it skips the search.
    if (this.lineOfSight(sx, sz, reachableX, reachableZ)) {
      this.lastSearch = 'found'
      this.lastExpansions = 0
      return [{ x: reachableX, z: reachableZ }]
    }

    const outcome = this._search(startIdx, goalIdx, maxExpansions)
    this.lastSearch = outcome
    if (outcome !== 'found') return null

    // Walk the parents back, then smooth.
    const cells = []
    let node = goalIdx
    while (node !== -1) {
      cells.push(node)
      node = this.parent[node]
    }
    cells.reverse()
    return this._smooth(cells, sx, sz, reachableX, reachableZ)
  }

  /** Octile distance — admissible for 8-connected movement, and never overestimates. */
  _heuristic(ax, az, bx, bz) {
    const dx = Math.abs(ax - bx)
    const dz = Math.abs(az - bz)
    return dx + dz + (SQRT2 - 2) * Math.min(dx, dz)
  }

  /**
   * String-pulling: keep the furthest waypoint still visible from the last kept one. Turns
   * a staircase of grid cells into the handful of corners an astronaut actually needs.
   */
  _smooth(cells, sx, sz, tx, tz) {
    const size = this.size
    const pts = cells.map((idx) => {
      const ix = idx % size
      const iz = (idx - ix) / size
      return { x: this.toWorld(ix), z: this.toWorld(iz) }
    })
    // The true endpoints, not their cell centres.
    pts[pts.length - 1] = { x: tx, z: tz }

    const out = []
    let fromX = sx
    let fromZ = sz
    let i = 0
    while (i < pts.length) {
      // Keep the furthest waypoint still visible from here; `i` itself is the floor, and it
      // is always reachable because consecutive cells in an A* result are adjacent.
      let furthest = i
      for (let j = pts.length - 1; j > i; j--) {
        if (this.lineOfSight(fromX, fromZ, pts[j].x, pts[j].z)) {
          furthest = j
          break
        }
      }
      const p = pts[furthest]
      out.push(p)
      fromX = p.x
      fromZ = p.z
      if (furthest === pts.length - 1) break
      i = furthest + 1
    }
    return out.length ? out : [{ x: tx, z: tz }]
  }

  // ── movement ────────────────────────────────────────────────────────────────────────

  /**
   * Apply a step with collision. Blocked head-on, the move is retried on each axis alone so
   * the agent slides along the obstacle instead of stopping dead against it.
   *
   * This runs on every step whether or not a path is being followed, which is what makes
   * "never walks through a building" a property of the movement rather than a property of
   * the pathfinder having succeeded.
   *
   * An axis-only slide that covers less than `SLIDE_MIN_FRACTION` of the step is a wall, not
   * a slide: a villager shouldering a wall head-on used to creep a micron sideways and report
   * success, which kept `agent.blocked` clear and left it walking on the spot until the
   * 45-second fallback. Such a step is refused outright — no micron move — so the caller's
   * own eight-second escape fires instead.
   */
  slide(pos, dx, dz) {
    // An agent a building was dropped on top of has no legal move at all; walk it out.
    if (this.isBlocked(pos.x, pos.z)) {
      const free = this.nearestFree(pos.x, pos.z)
      if (free) {
        const fx = this.toWorld(free.ix)
        const fz = this.toWorld(free.iz)
        const len = Math.hypot(fx - pos.x, fz - pos.z) || 1
        const step = Math.min(len, Math.hypot(dx, dz) + 0.04)
        pos.x += ((fx - pos.x) / len) * step
        pos.z += ((fz - pos.z) / len) * step
      }
      return false
    }

    const nx = pos.x + dx
    const nz = pos.z + dz
    if (!this.isBlocked(nx, nz)) {
      pos.x = nx
      pos.z = nz
      return true
    }
    if (dx !== 0 && !this.isBlocked(nx, pos.z) && slideCounts(dx, dz, dx, 0)) {
      pos.x = nx
      return true
    }
    if (dz !== 0 && !this.isBlocked(pos.x, nz) && slideCounts(dx, dz, 0, dz)) {
      pos.z = nz
      return true
    }
    return false
  }

  // ── heap ────────────────────────────────────────────────────────────────────────────

  _push(node, key) {
    let i = this.heapSize++
    this.heap[i] = node
    this.heapKey[i] = key
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.heapKey[p] <= this.heapKey[i]) break
      this._swap(i, p)
      i = p
    }
  }

  _pop() {
    const top = this.heap[0]
    const last = --this.heapSize
    this.heap[0] = this.heap[last]
    this.heapKey[0] = this.heapKey[last]
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      const r = l + 1
      let small = i
      if (l < this.heapSize && this.heapKey[l] < this.heapKey[small]) small = l
      if (r < this.heapSize && this.heapKey[r] < this.heapKey[small]) small = r
      if (small === i) break
      this._swap(i, small)
      i = small
    }
    return top
  }

  _swap(a, b) {
    const n = this.heap[a]
    this.heap[a] = this.heap[b]
    this.heap[b] = n
    const k = this.heapKey[a]
    this.heapKey[a] = this.heapKey[b]
    this.heapKey[b] = k
  }
}

// Orthogonals first, then diagonals — the loop relies on index >= 4 meaning diagonal.
const NEIGHBOURS = new Int8Array([1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1])
