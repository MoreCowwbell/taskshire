export const DECK = 1.0
const pick = (rand, list) => list[Math.floor(rand() * list.length)]

/** Records what the real Composer would have been asked to add. */
export class Recorder {
  constructor() {
    this.parts = []
  }
  add(name, o = {}) {
    this.parts.push({
      node: name,
      x: o.x || 0, y: o.y || 0, z: o.z || 0,
      ry: o.ry || 0, s: o.s ?? 1, solo: Boolean(o.solo), emissive: o.emissive || 0, spin: o.spin || 0,
      // No space recipe stages anything; the interpreter's default rides along so the
      // `deepEqual` below still compares whole part objects rather than a subset.
      stage: o.stage || 0,
    })
    return this
  }
  ring(name, count, radius, rand, o = {}) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.5
      const r = radius * (0.85 + rand() * 0.3)
      this.add(name, { ...o, x: Math.cos(a) * r, z: Math.sin(a) * r, ry: a + Math.PI / 2 })
    }
    return this
  }
}

/**
 * The ten generators from `src/world/buildings.js`, unchanged since 72afc69 (the initial
 * commit) and copied here verbatim the moment before Task 6 deleted them from the source.
 * This file is the only remaining record of the draw order every colony was built with;
 * `tests/recipes.test.mjs` holds the interpreter to it.
 */
export const LEGACY_KINDS = {
  habitat(c, rand) {
    c.add(pick(rand, ['basemodule_A', 'basemodule_B', 'basemodule_C', 'basemodule_D']))
    c.add(pick(rand, ['roofmodule_base', 'roofmodule_cargo_A', 'roofmodule_cargo_B']), { y: DECK })
    if (rand() > 0.45) c.add('lights', { x: 1.15, z: 0.85, s: 0.85, ry: rand() * 6.28 })
    if (rand() > 0.6) c.add('containers_A', { x: -1.15, z: 0.9, ry: rand() * 6.28 })
    return 'Habitat'
  },

  solar(c, rand) {
    const cols = 2 + Math.floor(rand() * 2)
    const rows = 2 + Math.floor(rand() * 2)
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        c.add('solarpanel', {
          x: (i - (cols - 1) / 2) * 1.05,
          z: (j - (rows - 1) / 2) * 0.62,
          ry: 0.06 * (rand() - 0.5),
        })
      }
    }
    c.add('lights', { x: cols * 0.6, z: -rows * 0.4, s: 0.8 })
    c.add('containers_B', { x: -cols * 0.6, z: rows * 0.35, ry: 0.4 })
    return 'Solar array'
  },

  antenna(c, rand) {
    const tall = rand() > 0.3
    const [tower, hub] = tall ? ['windturbine_tall', 2.05] : ['windturbine_low', 0.89]
    c.add(tower, { solo: true })
    c.add(`${tower}_fan`, { y: hub, spin: 0.17 + rand() * 0.09 })
    c.add('containers_C', { x: 0.9, z: 0.75, ry: rand() * 6.28 })
    if (rand() > 0.5) c.add('lights', { x: -0.95, z: -0.7, s: 0.8 })
    return 'Relay mast'
  },

  silo(c, rand) {
    c.add(pick(rand, ['cargodepot_A', 'cargodepot_B', 'cargodepot_C']))
    if (rand() > 0.5) c.add(pick(rand, ['cargo_A_stacked', 'cargo_B_stacked']), { x: 1.35, z: 0.4, ry: rand() * 6.28 })
    return 'Storage'
  },

  greenhouse(c, rand) {
    c.add('basemodule_E')
    c.ring('containers_D', 2 + Math.floor(rand() * 2), 1.45, rand)
    return 'Greenhouse'
  },

  reactor(c, rand) {
    c.add('drill_structure')
    c.ring('cargo_A', 3, 1.35, rand)
    if (rand() > 0.5) c.add('lights', { x: -1.2, z: 1.0, s: 0.9 })
    return 'Reactor'
  },

  tower(c, rand) {
    c.add('structure_tall')
    c.add('lights', { y: 2.0, s: 0.7 })
    if (rand() > 0.5) c.add('containers_A', { x: 1.15, z: 0.95, ry: rand() * 6.28 })
    return 'Tower'
  },

  workshop(c, rand) {
    c.add('basemodule_garage')
    c.add('roofmodule_solarpanels', { y: DECK })
    if (rand() > 0.3) {
      c.add(pick(rand, ['spacetruck', 'spacetruck_large']), { x: 1.55, z: 0.3, ry: Math.PI / 2 + (rand() - 0.5) * 0.5 })
    }
    if (rand() > 0.5) c.add('spacetruck_trailer', { x: 1.55, z: 1.35, ry: Math.PI / 2 })
    return 'Workshop'
  },

  pad(c, rand) {
    c.add(rand() > 0.35 ? 'landingpad_large' : 'landingpad_small')
    if (rand() > 0.4) c.add(pick(rand, ['lander_A', 'lander_B']), { y: 0.5, ry: rand() * 6.28 })
    else c.add('lander_base', { y: 0.5, ry: rand() * 6.28 })
    return 'Landing pad'
  },

  lab(c, rand) {
    c.add(pick(rand, ['basemodule_C', 'basemodule_A']))
    c.add('roofmodule_cargo_C', { y: DECK })
    c.ring(pick(rand, ['containers_B', 'containers_C']), 2, 1.4, rand)
    return 'Lab'
  },
}
