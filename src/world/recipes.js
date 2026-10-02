/**
 * Building recipes as data.
 *
 * A recipe is `{ label, parts: [step, …] }`. Each step either adds a part, binds a variable,
 * branches on the RNG, or expands to several parts (ring, grid). Numeric fields may be plain
 * numbers, `'deck'`, or one of the random/variable forms below. The forms draw from `rand`
 * in the order they are listed here, which is the order the space colony's original
 * generator functions drew in — so a given seed still builds the same structure.
 *
 * A step may also carry `stage`: which fraction of the thread's progress a part waits for;
 * 0 (the default) is present from the start. It is a plain number, never a random form, and
 * it draws nothing from `rand` — a recipe that stages nothing expands exactly as it always
 * did. `ring` and `grid` carry it on their own object and hand it to every part they expand.
 *
 * Nothing in this file imports three: it is the same interpreter under Node, which is what
 * lets `tests/recipes.test.mjs` hold it against the ten generators it replaced.
 */

function num(v, rand, vars, env) {
  if (typeof v === 'number') return v
  if (v === undefined || v === null) return 0
  if (v === 'deck') return env.deck
  if (typeof v === 'object') {
    if ('rand' in v) return v.rand.base + rand() * v.rand.scale
    if ('jitter' in v) return (v.add || 0) + (rand() - 0.5) * v.jitter
    if ('var' in v) {
      const base = vars[v.var]
      if (base === undefined) throw new Error(`recipe: unknown variable "${v.var}"`)
      return v.mul !== undefined ? base * v.mul : base
    }
  }
  throw new Error(`recipe: bad numeric field ${JSON.stringify(v)}`)
}

function nodeName(n, rand, vars) {
  if (typeof n === 'string') return n
  if (Array.isArray(n)) return n[Math.floor(rand() * n.length)]
  if (n && typeof n === 'object' && 'var' in n) {
    const base = vars[n.var]
    if (base === undefined) throw new Error(`recipe: unknown variable "${n.var}"`)
    return `${base}${n.suffix || ''}`
  }
  throw new Error(`recipe: bad node ${JSON.stringify(n)}`)
}

/**
 * Evaluated in this order, always. In every space recipe at most one field per part is
 * random, so the order never mattered for parity; fixing it is what makes a *custom*
 * recipe deterministic.
 */
const FIELDS = ['x', 'y', 'z', 'ry', 's', 'spin', 'emissive']

function addPart(out, step, rand, vars, env, overrides = null) {
  const node = nodeName(step.node, rand, vars)
  const p = { node, x: 0, y: 0, z: 0, ry: 0, s: 1, solo: Boolean(step.solo), emissive: 0, spin: 0, stage: step.stage ?? 0 }
  for (const f of FIELDS) {
    if (overrides && f in overrides) p[f] = overrides[f]
    else if (f in step) p[f] = num(step[f], rand, vars, env)
  }
  out.push(p)
}

function run(steps, rand, vars, env, out) {
  for (const step of steps) {
    if ('let' in step) {
      if ('randInt' in step) vars[step.let] = step.randInt[0] + Math.floor(rand() * step.randInt[1])
      else vars[step.let] = step.value
      continue
    }
    if ('if' in step) {
      run(rand() > step.if ? step.then || [] : step.else || [], rand, vars, env, out)
      continue
    }
    if ('ring' in step) {
      const r = step.ring
      // The node is resolved before the count, and the count before the loop: that is the
      // order `c.ring(pick(rand, …), 2 + floor(rand() * 2), …)` evaluated its arguments in.
      const node = nodeName(r.node, rand, vars)
      const count = typeof r.count === 'number' ? r.count : num(r.count, rand, vars, env)
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rand() * 0.5
        const rad = r.radius * (0.85 + rand() * 0.3)
        // A ring's stage is authored on the ring itself, beside `count` and `radius`; `o` is
        // the per-part fields, and a stage written there is honoured rather than overwritten.
        addPart(out, { ...(r.o || {}), node, stage: r.stage ?? r.o?.stage }, rand, vars, env, { x: Math.cos(a) * rad, z: Math.sin(a) * rad, ry: a + Math.PI / 2 })
      }
      continue
    }
    if ('grid' in step) {
      const g = step.grid
      const cols = vars[g.cols]
      const rows = vars[g.rows]
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = (i - (cols - 1) / 2) * g.dx
          const z = (j - (rows - 1) / 2) * g.dz
          addPart(out, { node: g.node, ry: g.ry, stage: g.stage }, rand, vars, env, { x, z })
        }
      }
      continue
    }
    if ('node' in step) {
      addPart(out, step, rand, vars, env)
      continue
    }
    throw new Error(`recipe: unknown step ${JSON.stringify(step)}`)
  }
}

export function expandRecipe(recipe, rand, env = { deck: 1 }) {
  const out = []
  run(recipe.parts, rand, {}, env, out)
  return { label: recipe.label, parts: out }
}
