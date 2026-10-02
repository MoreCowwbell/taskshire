import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry, Matrix4, Object3D, Vector3 } from 'three'
import {
  coastAxis,
  createScatter,
  scatterReach,
  sandWeight,
  shoreReach,
  terrainHeight,
  SAND_FALL,
  SAND_RISE,
  SHORE_BAND,
  SHORE_IN,
  SHORE_OUT,
} from '../src/world/setting.js'
import { manifest } from '../src/themes/medieval/manifest.js'
import { CLEARING } from '../src/worlds/clearing.js'

/**
 * Kits are not loaded under node, so `createScatter` uses its primitive fallback shapes for
 * every recipe; placement is what is under test, and placement does not depend on the kit.
 *
 * Every case gets an `id` of its own because the module's terrain sampler is memoised per
 * setting id — two settings sharing an id would share one height field.
 */
const base = manifest.settings.find((s) => s.id === 'forest')

test('a setting without rim adds no rim meshes', () => {
  const plain = { ...base, id: 't-plain', rim: undefined }
  const a = createScatter(plain, manifest.scatter, 0.6, [])
  const withRim = { ...base, id: 't-rim', rim: { recipe: 'alpine', inner: 52, outer: 80, count: 100 } }
  const b = createScatter(withRim, manifest.scatter, 0.6, [])
  assert.ok(b.children.length > a.children.length)
  assert.equal(a.children.filter((m) => m.userData.rim).length, 0)
})

test('rim instances land in the annulus and outside keepClear', () => {
  const s = { ...base, id: 't-ring', rim: { recipe: 'alpine', inner: 52, outer: 80, count: 300 } }
  const clear = [{ x: 60, z: 0, r: 12 }]
  const g = createScatter(s, manifest.scatter, 1, clear)
  const rim = g.children.filter((m) => m.userData.rim)
  assert.ok(rim.length > 0)
  let n = 0
  const m4 = new Matrix4()
  for (const mesh of rim) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4)
      const x = m4.elements[12]
      const z = m4.elements[14]
      const d = Math.hypot(x, z)
      assert.ok(d >= 52 - 1e-6 && d <= 80 + 1e-6, `d=${d}`)
      assert.ok(Math.hypot(x - 60, z) >= 12, 'inside keepClear')
      n++
    }
  }
  assert.ok(n >= 250 && n <= 300, `planted ${n}`)
})

/** The bank down to the sea off screen-left, the sea, and the wall opposite — the valley's own two axes. */
const COAST = { axis: [-0.9848, 0.1736], from: 60, depth: 10 }
const SEA = { level: -4.7, shallow: 0x52dcd4, deep: 0x1c6fba, foam: 0xffffff }
const RIDGE = { axis: [0.1736, -0.9848], from: 50, width: 30, height: 18, recipe: 'alpine', count: 300 }
/** A point `d` units along an axis. */
const along = (axis, d) => [axis[0] * d, axis[1] * d]

test('the ground dips under the water past the coast', () => {
  const wet = { ...base, id: 't-wet', coast: COAST, water: SEA }
  const dry = { ...base, id: 't-dry2' }
  // Inland, and across the map on the dry side, the coast changes nothing.
  assert.equal(terrainHeight(...along(COAST.axis, 30), wet), terrainHeight(...along(COAST.axis, 30), dry))
  assert.equal(terrainHeight(...along(COAST.axis, -90), wet), terrainHeight(...along(COAST.axis, -90), dry))
  // Past the far end of the ramp the full depth is gone.
  const out = along(COAST.axis, 110)
  assert.ok(terrainHeight(...out, wet) <= terrainHeight(...out, dry) - COAST.depth + 1e-9)
  assert.ok(terrainHeight(...out, wet) < SEA.level)
})

test('the ground rises past the ridge, and only on its own side', () => {
  const walled = { ...base, id: 't-wall', ridge: RIDGE }
  const flat = { ...base, id: 't-flat' }
  assert.equal(terrainHeight(...along(RIDGE.axis, 30), walled), terrainHeight(...along(RIDGE.axis, 30), flat))
  assert.equal(terrainHeight(...along(RIDGE.axis, -90), walled), terrainHeight(...along(RIDGE.axis, -90), flat))
  const up = along(RIDGE.axis, RIDGE.from + RIDGE.width)
  // The climb is noise-broken, so the guarantee is the band it lands in, not one number.
  const lift = terrainHeight(...up, walled) - terrainHeight(...up, flat)
  assert.ok(lift > RIDGE.height * 0.5 && lift <= RIDGE.height + 1e-9, `lift=${lift}`)
})

/**
 * A list of ridges is a list of half-planes, and they add.
 *
 * The mountain carries two — one entering across the top of the frame, one closing the top
 * right — and the corner they overlap in has to be the sum of both climbs rather than the
 * deeper of the two, or the range has a notch cut in it exactly where two ranges meet.
 */
test('a list of ridges climbs on each axis, and adds where two overlap', () => {
  const a = { ...RIDGE, axis: [-0.7071, -0.7071], from: 58, width: 34, height: 26 }
  const b = { ...RIDGE, axis: [0.1736, -0.9848], from: 62, width: 30, height: 18 }
  const flat = { ...base, id: 't-list-flat' }
  const one = { ...base, id: 't-list-one', ridge: a }
  const both = { ...base, id: 't-list-two', ridge: [a, b] }

  // A one-element list is the same ground as the bare object — the list is a spelling, not a
  // second code path.
  const spelled = { ...base, id: 't-list-spelled', ridge: [a] }
  for (const [x, z] of [[-70, -70], [0, -90], [40, 20]]) {
    assert.equal(terrainHeight(x, z, spelled), terrainHeight(x, z, one))
  }

  // On b's axis and off a's, only b lifts; the reverse on a's.
  const onB = [b.axis[0] * (b.from + b.width), b.axis[1] * (b.from + b.width)]
  assert.ok(onB[0] * a.axis[0] + onB[1] * a.axis[1] <= a.from, 'the probe is off the first wall')
  assert.ok(terrainHeight(...onB, both) > terrainHeight(...onB, one) + 8, 'the second wall carries it alone')

  // And in the quadrant both half-planes cover, the lift is the sum of the two rather than the
  // deeper of them — stated as the sum of the two single-wall lifts, so it is the *adding* that
  // is pinned and not a number the shared noise term happens to land on.
  const onlyB = { ...base, id: 't-list-b', ridge: b }
  const corner = [-10, -135]
  assert.ok(corner[0] * a.axis[0] + corner[1] * a.axis[1] >= a.from + a.width, 'past the first climb')
  assert.ok(corner[0] * b.axis[0] + corner[1] * b.axis[1] >= b.from + b.width, 'and past the second')
  const ground = terrainHeight(...corner, flat)
  const lift = terrainHeight(...corner, both) - ground
  const apart = terrainHeight(...corner, one) - ground + (terrainHeight(...corner, onlyB) - ground)
  assert.ok(Math.abs(lift - apart) < 1e-9, `the two climbs add (${lift.toFixed(3)} against ${apart.toFixed(3)})`)
  assert.ok(lift > terrainHeight(...corner, one) - ground, 'and the pair is higher than either alone')
})

/**
 * `hills` drives the far field and leaves the colony floor alone — that is the whole contract,
 * and the second half of it is what keeps the plots on flat ground.
 *
 * Absent is 1 **to the float**, not to a tolerance: it is the branch in `groundHeight` that keeps
 * six baselines byte-identical, and a `* 1` that had crept into the middle of the expression
 * would round somewhere and say nothing about it.
 */
test('hills multiplies the far field, leaves the colony floor, and defaults to exactly 1', () => {
  // The forest names a `hills` of its own, so "absent" has to be taken off it by hand.
  const { hills: _forestHills, ...bare } = base
  const plain = { ...bare, id: 't-hills-none' }
  const one = { ...bare, id: 't-hills-one', hills: 1 }
  const tall = { ...bare, id: 't-hills-tall', hills: 2 }

  // Inside the colony the term is not there to multiply, so all three agree to the float.
  for (const [x, z] of [[0, 0], [12, -8], [30, 14], [-20, 20]]) {
    assert.ok(Math.hypot(x, z) < 40, 'the probe is on the colony floor')
    assert.equal(terrainHeight(x, z, one), terrainHeight(x, z, plain))
    assert.equal(terrainHeight(x, z, tall), terrainHeight(x, z, plain))
  }

  // Out past the ramp it is doubled, exactly — the term is the whole height out there, the
  // `gentle` half having faded to nothing.
  let far = 0
  for (const [x, z] of [[90, 0], [0, -95], [70, 70], [-100, 40]]) {
    assert.equal(terrainHeight(x, z, one), terrainHeight(x, z, plain), 'hills: 1 is still the float it was')
    assert.ok(Math.abs(terrainHeight(x, z, tall) - terrainHeight(x, z, plain) * 2) < 1e-9, `at ${x},${z}`)
    if (Math.abs(terrainHeight(x, z, plain)) > 0.5) far++
  }
  assert.ok(far >= 3, 'the far field has something to multiply')
})

/**
 * `clearing` holds the far-field hills off until `from` and lifts the colony floor to `floor`,
 * and does nothing else. Checked on the twelve short worlds that carry it, on copies with no
 * craters so only the bare ground and the sea are compared, over rings of points out to 150:
 *
 * - past the ramp the ground is the same world's without a clearing, to the float, so the
 *   change is local;
 * - inside `from` the ground is the same as with a ramp that runs on to 400 units: the far
 *   field is off there whatever the ramp's end, without writing the noise out again here;
 * - inside the colony radius the ground stands at `floor` or above;
 * - between 40 units, where the plain world's hills begin, and `from`, the ground with the lift
 *   switched off (`floor: -Infinity`) is not the plain world's somewhere: only the ramp can make
 *   that difference, and the two checks above would still pass without it;
 * - and between the two it does move, or the clearing is a no-op.
 *
 * Forest, Valley and Aerie carry none, so their ground is what it always was.
 */
test('a clearing moves the far field out and holds the colony floor, and nothing else', () => {
  const SHORT = ['moon', 'mars', 'terra', 'beach', 'ocean', 'jungle', 'desert', 'tundra', 'autumn', 'sakura', 'volcanic', 'mountain']
  for (const s of manifest.settings) {
    if (SHORT.includes(s.id)) assert.deepEqual(s.clearing, CLEARING, `${s.id} carries the clearing`)
    else assert.equal(s.clearing, undefined, `${s.id} carries a clearing`)
  }
  assert.deepEqual(
    manifest.settings.filter((s) => !SHORT.includes(s.id)).map((s) => s.id).sort(),
    ['forest', 'sky', 'valley'],
  )

  const points = []
  for (let r = 0; r <= 150; r += 2.5) {
    const n = r === 0 ? 1 : 36
    for (let i = 0; i < n; i++) points.push([Math.cos((i / n) * Math.PI * 2 + r) * r, Math.sin((i / n) * Math.PI * 2 + r) * r])
  }
  const { from, to, floor } = CLEARING
  for (const id of SHORT) {
    const s = manifest.settings.find((w) => w.id === id)
    const { clearing: _clearing, ...bare } = s
    const cleared = { ...s, id: `t-clear-${id}`, craters: 0 }
    const plain = { ...bare, id: `t-clear-none-${id}`, craters: 0 }
    const long = { ...s, id: `t-clear-long-${id}`, craters: 0, clearing: { from, to: 400, floor } }
    const unlifted = { ...s, id: `t-clear-unlifted-${id}`, craters: 0, clearing: { from, to, floor: -Infinity } }
    let moved = 0
    let ramped = 0
    for (const [x, z] of points) {
      const d = Math.hypot(x, z)
      const y = terrainHeight(x, z, cleared)
      if (d >= to) assert.ok(Object.is(y, terrainHeight(x, z, plain)), `${id} at ${x.toFixed(1)},${z.toFixed(1)}: changed past the ramp`)
      if (d < from) assert.ok(Math.abs(y - terrainHeight(x, z, long)) < 1e-9, `${id} at ${x.toFixed(1)},${z.toFixed(1)}: far field inside the clearing`)
      if (d <= 46) assert.ok(y >= floor, `${id} at ${x.toFixed(1)},${z.toFixed(1)}: ${y.toFixed(3)} below the floor`)
      if (d > 46 && d < to && y !== terrainHeight(x, z, plain)) moved++
      if (d > 40 && d < from && terrainHeight(x, z, unlifted) !== terrainHeight(x, z, plain)) ramped++
    }
    assert.ok(moved > 0, `${id}: the clearing moved nothing`)
    assert.ok(ramped > 0, `${id}: the ramp held nothing off inside \`from\``)
  }
})

/**
 * Both fields are branches, not multiplies by zero: a setting that carries them has exactly
 * the floats of one that does not, everywhere neither reaches. That is what keeps the four
 * space baselines byte-identical, and a `* 0` that rounded would break it invisibly.
 */
test('ground neither field reaches is unchanged to the float', () => {
  const plain = { ...base, id: 't-none' }
  const dressed = { ...base, id: 't-none2', coast: COAST, water: SEA, ridge: RIDGE }
  // The open quadrant, away from both axes, plus the middle of the map.
  for (const [x, z] of [[0, 0], [30, -14], [20, 40], [60, 60], [120, 120], [-8, 30]]) {
    assert.ok(x * COAST.axis[0] + z * COAST.axis[1] <= COAST.from - SHORE_IN, 'point is dry')
    assert.ok(x * RIDGE.axis[0] + z * RIDGE.axis[1] <= RIDGE.from, 'point is off the wall')
    assert.equal(terrainHeight(x, z, dressed), terrainHeight(x, z, plain))
  }
})

test('nothing is planted in the water or on the shore band', () => {
  const wet = {
    ...base,
    id: 't-shore',
    rim: { recipe: 'alpine', inner: 52, outer: 80, count: 300 },
    coast: COAST, water: SEA,
    ridge: RIDGE,
  }
  const g = createScatter(wet, manifest.scatter, 1, [])
  const m4 = new Matrix4()
  let planted = 0
  for (const mesh of g.children) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4)
      const x = m4.elements[12]
      const z = m4.elements[14]
      // The matrix carries the *sunk* position, so compare the ground it was placed on.
      const y = terrainHeight(x, z, wet)
      assert.ok(y >= SEA.level + SHORE_BAND, `planted at y=${y} on ground ${x},${z}`)
      planted++
    }
  }
  assert.ok(planted > 0)
})

/**
 * The beach is a *height* band, and the height it covers is the whole point of it.
 *
 * It was `SHORE_BAND + 1` until 2026-09-12 — five units of bank, which at the top of the
 * default frame is a strip rather than a beach. Seven reaches three units past the line the
 * scatter guard draws, so the sand is still going where the first hay bale stands and has
 * faded out before the meadow proper. Pinned because the number is a look, not an internal:
 * anything that quietly walks it back takes the beach with it.
 */
test('the sand band is full at the waterline and gone seven units above it', () => {
  const level = -4.7

  assert.equal(sandWeight(level, level), 1, 'full at the line')
  assert.ok(sandWeight(level + SHORE_BAND, level) > 0.3, `${sandWeight(level + SHORE_BAND, level)} at the scatter floor`)
  assert.equal(sandWeight(level + SAND_RISE, level), 0, 'gone at the top of the band')
  assert.equal(SAND_RISE, SHORE_BAND + 3)

  // And it runs under the line too, for the bed the swell's trough and the sea's own quads
  // expose just seaward of it — a hard green edge there would draw the wobble as a straight one.
  assert.ok(sandWeight(level - 1, level) > 0, 'still painting a unit under the line')
  assert.equal(sandWeight(level - SAND_FALL, level), 0, 'gone at the foot')

  // Monotone both ways out from the line: no band inside the band.
  for (let d = 0; d < SAND_RISE; d += 0.25) {
    assert.ok(sandWeight(level + d, level) >= sandWeight(level + d + 0.25, level), `not monotone at +${d}`)
  }
})

/**
 * The valley's own coast, held where the harbour was measured against it.
 *
 * `boat.js` is a page of world distances — the pier's reach, the berth, the mooring, the
 * threshold — every one of them chosen off this shore. Nothing else would catch the coast
 * being re-cut under them, and the symptom would be a pier standing on the beach with its
 * legs in the air rather than an error.
 */
test("the valley's waterline is where the dock was built for it", () => {
  const valley = manifest.settings.find((s) => s.id === 'valley')

  // On the dock's own line across the shore, not on the axis through the origin: the coast
  // bends now, and the one thing every distance in `boat.js` is measured against is the
  // waterline in front of the harbour.
  const waterline = waterlineAt(valley, dockShore(valley))
  assert.ok(waterline > 42 && waterline < 43.5, `the waterline is at ${waterline.toFixed(2)}`)

  // The dock's cell is a *shore station*, and on a bank this gentle it is on the beach rather
  // than above it: the band reaches in to `from - SHORE_IN`, which is 8.5 units landward of
  // the cell, so the ground under it is 0.66 below the nav floor. That costs nothing — the
  // ceremony blocks a disc there anyway, and `blockedCells` refuses the cell to a plot — but
  // it is the reason the pier reaches 11 units out instead of 7, so it is pinned.
  const { q, r } = valley.ceremony.cell
  const cell = { x: 7.6 * 1.5 * q, z: 7.6 * Math.sqrt(3) * (r + q / 2) }
  const ground = terrainHeight(cell.x, cell.z, valley)
  assert.ok(ground > valley.water.level, `the dock cell stands at ${ground.toFixed(2)}, out of the water`)
  assert.ok(ground < valley.water.level + SHORE_BAND, 'and on the beach, which is what the pier is measured from')
})

/** How far along the shore a point lies: the perpendicular of `coast.axis`. */
const acrossShore = (x, z, axis) => -x * axis[1] + z * axis[0]

/** The dock's own coordinate along the shore. */
function dockShore(setting) {
  const { q, r } = setting.ceremony.cell
  return acrossShore(7.6 * 1.5 * q, 7.6 * Math.sqrt(3) * (r + q / 2), setting.coast.axis)
}

/**
 * Bisect for where the ground crosses a height, along the water axis at a fixed distance `p`
 * across the shore. The default is the waterline itself.
 */
function waterlineAt(setting, p, target = setting.water.level) {
  const [ax, az] = setting.coast.axis
  const at = (d) => terrainHeight(ax * d - az * p, az * d + ax * p, setting)
  let lo = 0
  let hi = 140
  let m = 0
  for (let i = 0; i < 60; i++) {
    m = (lo + hi) / 2
    if (at(m) > target) lo = m
    else hi = m
  }
  return m
}

/**
 * The harbour's pin. `coast.wobble` bends the coast, and every world distance in `boat.js` was
 * measured against the waterline in front of the dock — so the bend is masked to nothing
 * there, and the shoreline at the dock's shore coordinate is the one `from` alone would give.
 *
 * The comparison is against a *copy of the setting with the wobble taken out* rather than
 * against a remembered number, so it is the mask that is under test and not the noise.
 */
test('the wobble is pinned in front of the harbour and free beyond it', () => {
  const valley = manifest.settings.find((s) => s.id === 'valley')
  const straight = { ...valley, id: 't-straight', coast: { ...valley.coast, wobble: undefined } }
  const dockP = dockShore(valley)

  // Ten-thousandths: the mask is exactly zero at the dock's coordinate, so this is the
  // bisection's own resolution and nothing else.
  const pinned = waterlineAt(valley, dockP)
  assert.ok(Math.abs(pinned - waterlineAt(straight, dockP)) < 1e-3, `pinned at ${pinned.toFixed(3)}`)

  // And past the mask the coast actually moves — a wobble that is masked everywhere is a
  // straight coast with extra arithmetic — but never by more than the amplitude it declares.
  let moved = 0
  for (let p = dockP - 120; p <= dockP + 120; p += 4) {
    const d = Math.abs(waterlineAt(valley, p) - waterlineAt(straight, p))
    // Past the far edge of the map the crossing runs off the ground the field is defined on;
    // only the stretch the camera can see is asserted.
    if (Math.abs(p - dockP) > 90) continue
    assert.ok(d <= valley.coast.wobble.amp + 1e-6, `the coast moved ${d.toFixed(2)} at p=${p.toFixed(0)}`)
    if (d > 1) moved++
  }
  assert.ok(moved > 10, `the coast bends somewhere (${moved} sampled stretches moved)`)
})

/**
 * The bank, which is the whole batch: seven units of drop over thirty instead of ten over
 * eighteen. The number that matters is the slope through the *middle* of the smoothstep, where
 * it is steepest — that is what decides how wide the bare beach between the last hay bale and
 * the water comes out, because the guard that leaves it is a height and not a distance.
 *
 * Measured over the six units *landward* of the waterline, which is the bank the beach is made
 * of. Seaward of the line the bed has fallen twice as fast since `coast.bed` (2026-09-30), by
 * design and under the water only; the slope above the line is the same to the float.
 */
test('the shore band is gentle enough to be a beach', () => {
  const valley = manifest.settings.find((s) => s.id === 'valley')
  const [ax, az] = valley.coast.axis
  const at = (d, p) => terrainHeight(ax * d - az * p, az * d + ax * p, valley)

  assert.equal(SHORE_IN + SHORE_OUT, 30)
  for (const p of [dockShore(valley), -60, -20, 0, 20, 60]) {
    const wl = waterlineAt(valley, p)
    const slope = (at(wl - 6, p) - at(wl, p)) / 6
    assert.ok(slope < 0.4, `the bank falls ${slope.toFixed(3)} per unit at p=${p.toFixed(0)}`)
    // And the bare band that slope buys is a beach rather than a kerb: the ground between the
    // scatter guard's floor and the water, in world units along the axis.
    const bare = wl - waterlineAt(valley, p, valley.water.level + SHORE_BAND)
    assert.ok(bare > 9, `the beach is ${bare.toFixed(2)} wide at p=${p.toFixed(0)}`)
  }
})

/**
 * The valley's rise and the valley's sea are two half-planes, so their boundaries cross
 * somewhere on the ground square whatever the numbers are. What has to hold is *where*: in
 * front of the village there must be open dry ground between the foot of the rise and the
 * reach of the sea, or the hills come down into the water in the middle of the picture.
 *
 * The test is against `shoreReach` rather than against `coast.from`, so it follows the wobble:
 * a bay that bulges inland is the case a constant would miss, and it is the case that matters.
 */
test("the valley's rise keeps clear of its sea in front of the village", () => {
  const valley = manifest.settings.find((s) => s.id === 'valley')
  const [wax, waz] = valley.coast.axis
  const [rax, raz] = valley.ridge.axis
  // A point on the foot of the rise, `t` units across it, and how far inland of the sea's own
  // smoothstep it lies. Positive is dry ground between the two.
  const gapAt = (t) => {
    const x = valley.ridge.from * rax - t * raz
    const z = valley.ridge.from * raz + t * rax
    return shoreReach(x, z, valley) - (x * wax + z * waz)
  }

  // The stretch the village sits behind: the foot is clear of the water for the whole of it.
  for (let t = -30; t <= 60; t += 2) assert.ok(gapAt(t) > 0, `the rise meets the sea at t=${t} (gap ${gapAt(t).toFixed(2)})`)
  assert.ok(gapAt(0) > 25, `only ${gapAt(0).toFixed(2)} units of ground on the middle line`)

  // They do cross, and it is far out in the corner rather than in the middle of the frame.
  let cross = null
  for (let t = -30; t > -160 && cross === null; t -= 0.25) if (gapAt(t) < 0) cross = t
  assert.ok(cross !== null, 'two half-planes must meet somewhere')
  assert.ok(Math.hypot(cross, valley.ridge.from) > 60, `they meet ${Math.hypot(cross, valley.ridge.from).toFixed(1)} from the middle`)
})

test('a setting without ridge adds no ridge meshes, and one with it plants its strip', () => {
  const plain = { ...base, id: 't-noridge' }
  assert.equal(createScatter(plain, manifest.scatter, 0.6, []).children.filter((m) => m.userData.ridge).length, 0)

  const walled = { ...base, id: 't-ridge', ridge: RIDGE }
  const g = createScatter(walled, manifest.scatter, 1, [])
  const meshes = g.children.filter((m) => m.userData.ridge)
  assert.ok(meshes.length > 0)
  const m4 = new Matrix4()
  let n = 0
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4)
      const d = m4.elements[12] * RIDGE.axis[0] + m4.elements[14] * RIDGE.axis[1]
      assert.ok(d >= RIDGE.from - 1e-6 && d <= RIDGE.from + RIDGE.width + 24 + 1e-6, `d=${d}`)
      n++
    }
  }
  assert.ok(n >= 250 && n <= 300, `planted ${n}`)
})

/**
 * A prop is a body, not a point.
 *
 * `keepClear` was tested against the candidate's centre, and sizes are scale multipliers on
 * the kit's geometry with up to 2.9 again in the far field — so a tree cluster whose centre sat
 * a metre outside a tile's 8.6 circle reached three metres over the deck. The exclusion is
 * measured against the instance's own reach now, which is what "must not overhang tiles" means.
 *
 * Measured off the planted matrices rather than off the module's arithmetic: the reach is
 * recomputed here from the geometry's box and the instance's own scale.
 */
function bodies(group) {
  const m4 = new Matrix4()
  const corner = new Vector3()
  const out = []
  for (const mesh of group.children) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const b = mesh.geometry.boundingBox
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4)
      // The eight corners of the kit's own box, put through this instance's matrix and
      // measured in the ground plane from the point it stands on. No arithmetic from
      // `setting.js` is repeated: this is where the body actually is.
      let body = 0
      for (const cx of [b.min.x, b.max.x]) {
        for (const cy of [b.min.y, b.max.y]) {
          for (const cz of [b.min.z, b.max.z]) {
            corner.set(cx, cy, cz).applyMatrix4(m4)
            body = Math.max(body, Math.hypot(corner.x - m4.elements[12], corner.z - m4.elements[14]))
          }
        }
      }
      out.push({ x: m4.elements[12], z: m4.elements[14], body })
    }
  }
  return out
}

test('a prop whose body would overhang a tile is culled, and the ground is still populated', () => {
  const s = { ...base, id: 't-reach' }
  const circle = { x: 40, z: 0, r: 8.6 }
  const g = createScatter(s, manifest.scatter, 1, [circle])
  const planted = bodies(g)
  assert.ok(planted.length > 100, `planted ${planted.length}`)

  let near = 0
  for (const p of planted) {
    const d = Math.hypot(p.x - circle.x, p.z - circle.z)
    assert.ok(d >= circle.r + p.body - 1e-6, `body over the tile: d=${d.toFixed(2)} body=${p.body.toFixed(2)}`)
    if (d < 25) near++
  }
  assert.ok(near > 0, 'the collar is a collar, not a clearing')
})

/**
 * And `scatterReach` is an upper bound on that body, whatever the draw does with it.
 *
 * The cull can only be as honest as this number, so it is held to the geometry rather than to
 * itself: a box is put through every rotation `createScatter` can give a prop that is not
 * `upright` — tilt and lean drawn *independently* in ±0.25, which is what makes the worst
 * departure from vertical ~0.354 rad rather than 0.25 — at a sweep of spins, and its furthest
 * corner in the ground plane has to fall inside the reach. A tall, narrow piece is the case
 * that catches a tilt term that is too small, and one authored below its own origin is the
 * case that catches a height measured only upward.
 */
test('the reach is an upper bound on the body under every tilt the draw can deal', () => {
  const dummy = new Object3D()
  const boxes = [
    { name: 'tall and narrow', geo: new BoxGeometry(0.4, 6, 0.4) },
    { name: 'wide and flat', geo: new BoxGeometry(5, 0.5, 3) },
    // Authored below the origin: `translate` moves the geometry, so the box's own y runs from
    // −6 to 0 and nothing about it is measurable from `max.y`.
    { name: 'hanging below its origin', geo: new BoxGeometry(0.4, 6, 0.4).translate(0, -3, 0) },
  ]

  for (const { name, geo } of boxes) {
    geo.computeBoundingBox()
    const b = geo.boundingBox
    for (const kind of [{ geo, upright: false }, { geo, upright: true }]) {
      for (const [sx, sy, sz] of [
        [1, 1, 1],
        [2.4, 1.7, 0.8],
      ]) {
        const reach = scatterReach(kind, sx, sy, sz)
        const tilts = kind.upright ? [0] : [-0.25, -0.13, 0, 0.13, 0.25]
        for (const tilt of tilts) {
          for (const lean of tilts) {
            for (let k = 0; k < 24; k++) {
              dummy.position.set(0, 0, 0)
              dummy.rotation.set(tilt, (k / 24) * Math.PI * 2, lean)
              dummy.scale.set(sx, sy, sz)
              dummy.updateMatrix()
              const corner = new Vector3()
              let body = 0
              for (const cx of [b.min.x, b.max.x]) {
                for (const cy of [b.min.y, b.max.y]) {
                  for (const cz of [b.min.z, b.max.z]) {
                    corner.set(cx, cy, cz).applyMatrix4(dummy.matrix)
                    body = Math.max(body, Math.hypot(corner.x, corner.z))
                  }
                }
              }
              assert.ok(
                body <= reach + 1e-9,
                `${name}${kind.upright ? ' upright' : ''} at tilt ${tilt} lean ${lean}: body ${body.toFixed(3)} > reach ${reach.toFixed(3)}`
              )
            }
          }
        }
      }
    }
    geo.dispose()
  }
})

/**
 * And the ground no longer reshuffles when a zone moves.
 *
 * A culled candidate used to consume two draws where a planted one consumed eight, so the
 * seeded stream depended on which tiles were in `keepClear` — and the scatter is rebuilt every
 * time a zone's footprint changes. Every draw happens before every cull now, so a keep-clear
 * circle removes props and moves nothing.
 */
test('the planted pattern no longer depends on which tiles were kept clear', () => {
  const s = { ...base, id: 't-stream' }
  const open = createScatter(s, manifest.scatter, 1, [])
  const holed = createScatter(s, manifest.scatter, 1, [{ x: 40, z: 0, r: 20 }])
  const m4 = new Matrix4()
  const at = (mesh) => {
    const out = new Set()
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4)
      out.add(`${m4.elements[12].toFixed(4)},${m4.elements[14].toFixed(4)}`)
    }
    return out
  }

  let checked = 0
  open.children.forEach((mesh, k) => {
    // A kind that filled its instance buffer had its tail cut by capacity rather than by the
    // seed, so it cannot be compared position for position.
    if (mesh.count >= mesh.instanceMatrix.count) return
    const before = at(mesh)
    for (const spot of at(holed.children[k])) {
      assert.ok(before.has(spot), `kind ${k} moved a prop to ${spot}`)
      checked++
    }
  })
  assert.ok(checked > 50, `compared ${checked} instances`)
  assert.ok(
    open.children.reduce((n, m) => n + m.count, 0) > holed.children.reduce((n, m) => n + m.count, 0),
    'the circle did cull something'
  )
})

// ── upstream's worlds (merged 2026-09-24) ─────────────────────────────────────────────

/**
 * `lakes` is a landform option, declared on the world rather than inferred by the generator.
 * Upstream folded the far field of every world with water that was not an island or a coast,
 * and that rule would have folded the valley's. So exactly the five worlds that declare it are
 * folded, and on every world with water, flipping the option — and nothing else — is what moves
 * its far field, while the colony floor, which the far-field term never reaches, stays put.
 */
test('lakes folds the far field of exactly the worlds that declare it', async () => {
  const { manifest: space } = await import('../src/themes/space/manifest.js')
  // Each world once: space's twelve and the village's own three, the pairs this was written for
  // (both themes list every world now, and the land under a world is the same in either).
  const OWN = ['forest', 'valley', 'mountain']
  const all = [...space.settings.filter((s) => !OWN.includes(s.id)), ...manifest.settings.filter((s) => OWN.includes(s.id))]
  assert.deepEqual(
    all.filter((s) => s.lakes === true).map((s) => s.id).sort(),
    ['autumn', 'jungle', 'sakura', 'tundra', 'volcanic'],
  )
  for (const s of all) if (!s.water) assert.equal(s.lakes, undefined, `${s.id} has no water to keep its hills above`)

  const ring = (r) => Array.from({ length: 48 }, (_, i) => [Math.cos((i / 48) * Math.PI * 2) * r, Math.sin((i / 48) * Math.PI * 2) * r])
  const wet = all.filter((s) => s.water)
  assert.ok(wet.some((s) => s.id === 'valley'), 'the valley is among the worlds with water')
  for (const s of wet) {
    const flipped = { ...s, id: `${s.id}-lakes-flipped`, lakes: !s.lakes }
    const moved = ring(80).filter(([x, z]) => terrainHeight(x, z, flipped) !== terrainHeight(x, z, s)).length
    assert.ok(moved > 12, `${s.id}: flipping lakes moved ${moved} of 48 far-field samples`)
    for (const [x, z] of ring(12)) assert.equal(terrainHeight(x, z, flipped), terrainHeight(x, z, s), `${s.id}: lakes reached the colony floor`)
  }
})

/**
 * One sea. Every `water` is upstream's level-and-colours sea, the valley's behind its `coast`
 * among them, and `shorelinePoints` and `underWater` read it wherever it is: the beach's, and
 * the valley's, whose flat sea of our own (`createWater`) is gone. Keyed on the world's data,
 * never on the theme.
 */
test("every sea has a shoreline and water under it, the valley's behind its coast included", async () => {
  const { shorelinePoints, underWater } = await import('../src/world/setting.js')
  const { manifest: space } = await import('../src/themes/space/manifest.js')
  for (const s of [space.settings.find((w) => w.id === 'beach'), manifest.settings.find((w) => w.id === 'valley')]) {
    const shore = shorelinePoints(s)
    assert.ok(shore.length > 0, `${s.id} has a shoreline`)
    // A shoreline point is a wet cell with a dry neighbour, so the water is over it.
    assert.ok(shore.every((p) => underWater(p.x, p.z, s)), s.id)
  }
  const valley = manifest.settings.find((s) => s.id === 'valley')
  assert.ok(valley.coast?.axis && valley.water.axis === undefined, 'the half-plane is the coast, not the water')
  // The sea lies along the coast's axis: out past the bank it is water, back inland it is not.
  assert.ok(underWater(...along(valley.coast.axis, 90), valley))
  assert.ok(!underWater(...along(valley.coast.axis, 0), valley))
})

/**
 * The valley's bed is deepened by `coast.bed` under the water and nowhere else, which is the
 * whole promise of the change: every dry point, and so every cell, the beach, the sand, the dock
 * and the door, reads the float it read before, to the bit. Under the water the depth below the
 * level is exactly `bed` times what it was. The comparison is against a copy of the valley with
 * the `bed` taken out, so it is the branch that is under test and not a remembered number.
 */
test("the valley's bed deepens under the water only, and dry ground keeps its floats", () => {
  const valley = manifest.settings.find((s) => s.id === 'valley')
  const flat = { ...valley, id: 't-no-bed', coast: { ...valley.coast, bed: undefined } }
  const level = valley.water.level
  assert.equal(valley.coast.bed, 2)
  let dry = 0
  let wet = 0
  for (let x = -120; x <= 120; x += 1.5) {
    for (let z = -120; z <= 120; z += 1.5) {
      const was = terrainHeight(x, z, flat)
      const now = terrainHeight(x, z, valley)
      if (was >= level) {
        assert.ok(Object.is(now, was), `dry ground moved at (${x}, ${z}): ${was} -> ${now}`)
        dry++
      } else {
        assert.equal(now, level - (level - was) * valley.coast.bed, `the bed at (${x}, ${z})`)
        assert.ok(now < was, `the bed is deeper at (${x}, ${z})`)
        wet++
      }
    }
  }
  assert.ok(dry > 1000 && wet > 1000, `${dry} dry and ${wet} wet points sampled`)
  // The one point where the order matters: the rise runs down into the sea here, and the ridge's
  // climb brings ground the bank took back above the water. Scaled before the climb, it sank.
  assert.ok(terrainHeight(-60, -59, flat) >= level)
  assert.ok(Object.is(terrainHeight(-60, -59, valley), terrainHeight(-60, -59, flat)))
})

test('upstream\'s scatter style keeps a prop body clear of the plots, and spends the same draws whatever is culled', async () => {
  const { manifest: space } = await import('../src/themes/space/manifest.js')
  const terra = space.settings.find((s) => s.id === 'terra')
  const clear = [{ x: 0, z: 0, r: 20 }]
  const g = createScatter(terra, space.scatter, 0.5, clear)
  const m = new Matrix4()
  const p = new Vector3()
  let seen = 0
  for (const mesh of g.children) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m)
      p.setFromMatrixPosition(m)
      assert.ok(Math.hypot(p.x, p.z) >= 20, `instance at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`)
      seen++
    }
  }
  assert.ok(seen > 0)
})

test('coastAxis points at the sea for every form of water, and nowhere without one', () => {
  const valley = manifest.settings.find((s) => s.id === 'valley')
  assert.equal(coastAxis(valley, { x: 5, z: 5 }), valley.coast.axis, "the valley's own coast axis, the same array")
  const beach = manifest.settings.find((s) => s.id === 'beach')
  assert.deepEqual(coastAxis(beach, { x: 10, z: -3 }), [-Math.SQRT1_2, -Math.SQRT1_2], 'a coast faces the far side of the view')
  const ocean = manifest.settings.find((s) => s.id === 'ocean')
  const [x, z] = coastAxis(ocean, { x: -3, z: -4 })
  assert.ok(Math.abs(x + 0.6) < 1e-12 && Math.abs(z + 0.8) < 1e-12, 'an island faces straight out through the point')
  assert.equal(coastAxis(ocean, { x: 0, z: 0 }), null, 'and has no one direction at its middle')
  assert.equal(coastAxis(manifest.settings.find((s) => s.id === 'forest'), { x: 1, z: 0 }), null, 'a world with no sea has none')
  assert.equal(coastAxis(manifest.settings.find((s) => s.id === 'sakura'), { x: 1, z: 0 }), null, 'nor does one whose water is lakes')
})
