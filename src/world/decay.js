/**
 * What a quiet repo grows over itself, as arithmetic (2026-09-12, `feature/ghost-decay`).
 *
 * A ghost zone is not drawn thin any more — that is a setting now, and it ships off — so what
 * says "nobody has been here for a fortnight" has to be the *ground*: crates standing open,
 * saplings and stumps coming up through the deck, and past a threshold the house itself gone
 * to a ruin. All of it is read off one number, the zone's `fade`, which runs 0 for a working
 * repo toward 1 as it is left alone.
 *
 * No three here, deliberately, exactly like `src/game/fate.js`. Every decision about *where*
 * a sapling stands and *when* it appears is arithmetic over plain objects, so the whole of it
 * is testable under Node and the module that does own three — `world/plots.js` — is left with
 * nothing but the geometry. The caller supplies its own random stream, which is what keeps
 * this off `Math.random`: under the snapshot harness that is one seeded mulberry32 shared with
 * `generateUUID`, and a dressing drawing from it would move the villagers in every later shot.
 *
 * The one rule every reader shares: a prop is on screen once `fade` has passed its own
 * `at`, so a zone thickens as it ages rather than arriving dressed. `revealAt` is that ramp
 * and the shader's `uDecay > vReveal.x` is the same test on the GPU.
 */

/**
 * How far out of a cell the dressing may reach, as a fraction of the tile's circumradius.
 *
 * The kerb clutter's outer band runs to 0.85 of a tile and the accent bar itself sits on the
 * apothem, 0.866 — so anything past this is standing on, or hanging over, the kerb. Inside it
 * is deck, which is what the overgrowth is meant to be breaking up.
 */
const KERB = 0.84
/**
 * Ground kept clear around every one of a cell's seven building slots.
 *
 * Measured against the buildings rather than against the slot: the catalogue's footprints run
 * to about 1.5 units from the slot centre, and a sapling any closer grows through a wall. The
 * test is applied to all seven slots of every cell whether or not a thread is housed in one,
 * so the layout depends on the plot and never on the roster — a zone whose last session closes
 * must not have its scrub jump to a new arrangement.
 */
const SLOT_CLEAR = 1.9
/** What one decay prop is taken to cover, added to a clutter prop's own nav radius. */
const PROP_R = 0.45
/** The closest two decay props may stand, centre to centre. Thicket, not hedge. */
const GAP = 0.9
/**
 * Placement attempts per prop before it is given up on.
 *
 * Rejection sampling with a hard ceiling rather than a search: a crowded cell simply carries
 * fewer props, which reads as a yard with less room in it, and the cost stays bounded at
 * `TRIES × perCell × cells` whatever the plot looks like. A skipped prop keeps its `at`
 * spent — the ramp is a property of the cell, not of what happened to fit.
 */
const TRIES = 6

/**
 * The fade the `k`-th of `n` things appears at: an even ramp over the whole of the fade, so
 * the first is out the moment a zone starts to go and the last only just before it leaves.
 */
export const revealAt = (k, n) => k / n

/** Whether a building at this fade is a ruin rather than a house. */
export const ruined = (fade, ruinAt) => fade >= ruinAt

/**
 * Which kerb props a ghost exchanges for their emptied twins, and when.
 *
 * `names` is every prop the clutter placed, **in draw order** — the order the merged geometry
 * was built in — so an entry's `index` addresses the geometry directly. Only the names the
 * theme's `swap` table knows are returned, and their thresholds are spread over the ordinal
 * among *those*: with three crates on a plot the first stands open at any fade at all and the
 * last at two thirds of the way out. Spreading over the swappable ones rather than over every
 * prop is what stops a yard of barrels and one crate holding that crate shut until the end.
 *
 * @param {string[]} names  every placed prop's node name, in draw order
 * @param {Record<string, string>} swap  node name → the name that replaces it
 * @returns {{index: number, name: string, replacement: string, at: number}[]}
 */
export function swapPlan(names, swap = {}) {
  const count = names.reduce((n, name) => n + (Object.hasOwn(swap, name) ? 1 : 0), 0)
  const out = []
  let j = 0
  names.forEach((name, index) => {
    if (!Object.hasOwn(swap, name)) return
    out.push({ index, name, replacement: swap[name], at: revealAt(j++, count) })
  })
  return out
}

/** Squared-distance test, so nothing here takes a square root it does not need. */
const near = (x, z, px, pz, r) => (x - px) * (x - px) + (z - pz) * (z - pz) < r * r

/** Whether a candidate point is clear of the buildings, the kerb clutter and its own kind. */
function clears(x, z, slots, clutterSpots, placed) {
  for (const s of slots) if (near(x, z, s.x, s.z, SLOT_CLEAR)) return false
  // A clutter prop carries the radius the navigation grid blocks for it, which is already
  // measured off its own bounding box — a stack of crates covers three times a bucket.
  for (const c of clutterSpots) if (near(x, z, c.x, c.z, c.r + PROP_R)) return false
  for (const p of placed) if (near(x, z, p.x, p.z, GAP)) return false
  return true
}

/**
 * Where the scrub grows on one plot, and at what fade each piece of it shows up.
 *
 * Cells are filled **round-robin** — one prop each, then a second each — so a zone thickens
 * evenly instead of one tile going to seed while its neighbour stays bare, and `at` comes out
 * non-decreasing over the returned list by construction.
 *
 * Every position is rejection-sampled inside the kerb against three things: the seven building
 * slots of every cell, every kerb prop already standing, and the props this plan has already
 * placed. Points are drawn with `sqrt(rand())` on the radius, which is what spreads them
 * evenly over the *area* of a cell — a uniform radius piles two thirds of them into the middle
 * third, and the middle of a cell is the one slot that always has a house on it.
 *
 * @param {{centers: {x: number, z: number}[], tile: number, slots: {x: number, z: number}[],
 *   clutterSpots: {x: number, z: number, r: number}[], rand: () => number, perCell: number,
 *   names: string[], scale: [number, number]}} opts  plot-local cell centres, the tile's
 *   circumradius, the plot's building slots, the kerb props already placed, a private random
 *   stream, how many props a fully faded cell carries, the node names to cycle, and the size range
 * @returns {{name: string, x: number, z: number, ry: number, s: number, at: number}[]}
 */
export function planDecay({ centers, tile, slots = [], clutterSpots = [], rand, perCell = 6, names, scale = [1, 1] }) {
  const out = []
  if (!centers?.length || !names?.length || !(perCell > 0)) return out
  const total = centers.length * perCell
  const reach = KERB * tile
  const [lo, hi] = scale

  for (let k = 0; k < total; k++) {
    const cell = centers[k % centers.length]
    // Cycled rather than drawn: what reads as abandonment is the count going up, not the mix
    // changing, and a cycle puts the whole species list on every zone at the same rate.
    const name = names[k % names.length]
    const at = revealAt(k, total)
    for (let t = 0; t < TRIES; t++) {
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(rand()) * reach
      const x = cell.x + Math.cos(a) * r
      const z = cell.z + Math.sin(a) * r
      if (!clears(x, z, slots, clutterSpots, out)) continue
      out.push({ name, x, z, ry: rand() * Math.PI * 2, s: lo + rand() * (hi - lo), at })
      break
    }
  }
  return out
}

/**
 * How many of a plan's props are on screen at a given fade. The fragment stage decides this
 * per pixel; this is the same rule in JS, for anything that wants to count rather than draw.
 */
export const visibleAt = (spots, fade) => spots.reduce((n, s) => n + (s.at < fade ? 1 : 0), 0)
