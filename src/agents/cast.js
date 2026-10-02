/**
 * Who each thread is, as pure functions: which body it wears, which colourway, and which
 * clip a state resolves to for that body. No three in here — `node --test` runs it.
 *
 * The hash is the same FNV-1a `astronauts.js` has always used for suit tones, moved here
 * so the character draw shares it. A thread keeps its villager across reloads because the
 * only input is its id.
 */
export function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** `manifest.crew.characters`, or the one implicit body of a single-character crew. */
export function crewCharacters(crewSpec) {
  return crewSpec?.characters?.length ? crewSpec.characters : [{ id: 'crew', mesh: null }]
}

export function characterFor(id, characters) {
  return characters[hash(id) % characters.length]
}

/**
 * The building a thread's villager would live in, or null to let the recipe seed choose.
 *
 * `byCharacter` is `manifest.buildings.byCharacter`: character id → kind ids. The pick
 * shifts the hash by three bits, which neither the character draw (`hash % n`) nor the
 * colourway (`>>> 5`) uses, so a mage's kind is not welded to its colourway.
 */
export function kindForThread(id, byCharacter, characters) {
  if (!byCharacter) return null
  const list = byCharacter[characterFor(id, characters).id]
  if (!Array.isArray(list) || !list.length) return null
  return list[(hash(id) >>> 3) % list.length]
}

/** Column of the crew atlas, 0..colourways-1. Shifted so it does not correlate with the character. */
export function colourwayFor(id, colourways) {
  return colourways > 1 ? (hash(id) >>> 5) % colourways : 0
}

/**
 * A `stateClips` entry is a clip key, or `{ default, byCharacter }`.
 * Unknown states return undefined so the caller can fall back to idle as it always has.
 */
export function clipFor(stateClips, state, characterId) {
  const entry = stateClips?.[state]
  if (entry === undefined || entry === null) return undefined
  if (typeof entry === 'string') return entry
  return entry.byCharacter?.[characterId] ?? entry.default
}

/**
 * The order `_writeMatrices` walks the worn parts in: grouped by bone, bones in the order
 * they are first seen, declaration order kept inside a bone.
 *
 * The rig loop fetches a bone's matrix when the bone differs from the previous part's, so
 * the walk order is the fetch count. A flat list declared head, head, chest, head, head,
 * chest, hand, head costs six fetches; grouped it costs three. Every instance write is
 * indexed by its own mesh, so the order parts are written in changes nothing drawn.
 *
 * @param {[string, {userData: {spec: {bone: string}}}][]} entries  `Object.entries(parts)`
 * @returns {[string, object][]} a new array
 */
export function bonePlan(entries) {
  const order = new Map()
  for (const [, mesh] of entries) {
    const bone = mesh.userData.spec.bone
    if (!order.has(bone)) order.set(bone, order.size)
  }
  return entries
    .map((e, i) => [e, i])
    .sort(([a, i], [b, j]) => order.get(a[1].userData.spec.bone) - order.get(b[1].userData.spec.bone) || i - j)
    .map(([e]) => e)
}

/**
 * Does this agent wear this part, this frame?
 *
 * The three gates a worn part can carry, in one pure function so `node --test` can hold them:
 *
 * - `when: 'working'` — only while the body is playing its own work clip, which is what makes
 *   a tool appear in a fist the moment a thread starts running and vanish when it stops.
 * - `character` — one body only, which is how eight trades share one hand slot.
 * - `cue` — only an agent whose roster entry carried that cue, which is how a helper wears
 *   something no other villager does without `src/agents/` ever asking what a helper is.
 *
 * A spec with none of the three is worn by everybody, and a spec with no `cue` is worn by an
 * agent that has one: the gates only ever narrow. That is bit for bit the pair of `continue`s
 * this replaced, which is what keeps every existing screenshot baseline where it is.
 *
 * @param {{when?: string, character?: string, cue?: string}} spec
 * @param {{clipKey?: string, workClip?: string, character?: string, cue?: string|null}} agent
 */
export function wornBy(spec, agent) {
  if (spec.when === 'working' && agent.clipKey !== agent.workClip) return false
  if (spec.character && spec.character !== agent.character) return false
  if (spec.cue && spec.cue !== agent.cue) return false
  return true
}

/**
 * How fast to play a walk or run clip for a body moving at `speed`.
 *
 * A body drawn at `size` covers `size` of the ground per stride, so holding the same pace
 * needs `1/size` the steps: a half-size helper keeping up with the adults scurries rather
 * than skates. Dividing the walk speed by the size is the whole of it — the clamp is the one
 * the crew has always used, and at `size` 1 this is the expression it replaces bit for bit,
 * which is what keeps every existing screenshot baseline where it is (2026-09-12).
 *
 * The floor stops a dawdling agent freezing mid-pose and the ceiling stops a sprinting one
 * blurring; both are about the clip, not the body, so neither moves with the size.
 */
export function strideRate(speed, walkSpeed, size = 1) {
  return Math.min(2.1, Math.max(0.4, speed / (walkSpeed * size)))
}

/**
 * Did the clip's phase cross the strike point since the last frame?
 *
 * A loop wraps from near 1 back to near 0, so a wrap counts as a crossing only if the strike
 * sits after the wrap — from 0.9 to 0.05 the clip passed 1.0 and 0.0 but not a strike at 0.5,
 * which was crossed earlier in the same loop. `prev < 0` is the first frame of a clip, which
 * fires if the strike is already behind the phase; `phase < 0` is no clip at all.
 */
export function strikeCrossed(prev, phase, strike) {
  if (phase < 0) return false
  if (prev < 0) return phase >= strike
  if (phase >= prev) return prev < strike && phase >= strike
  // wrapped
  return phase >= strike || prev < strike
}
