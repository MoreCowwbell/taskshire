/**
 * Every knob that costs frames, in one place.
 *
 * Settings are a flat object so they serialise straight to localStorage, and everything
 * that reads them subscribes rather than polling — a change fires `onChange` with the set
 * of keys that moved, so the renderer can rebuild only what actually needs rebuilding.
 */

const STORE_KEY = 'botcrossing.settings.v1'

/**
 * What a fresh install opens on. Fixed rather than guessed from the device: `autoQuality`
 * scales the render buffer *under* whichever preset is chosen, so a slow machine is caught
 * by the governor within a second or two — which it does by measuring actual frame times
 * rather than by inferring speed from core counts.
 *
 * Only ever used when nothing is stored. An explicit choice always wins.
 */
export const DEFAULT_PRESET = 'balanced'

export const PRESETS = {
  potato: {
    label: 'Potato',
    hint: 'battery first — flat light, no extras',
    values: {
      renderScale: 0.5,
      shadows: 'off',
      bloom: false,
      antialias: false,
      particles: 'off',
      textureQuality: 'low',
      scatterDensity: 0.15,
      groundDetail: 'low',
      maxAgents: 40,
      stars: false,
      ibl: false,
      tiltShift: false,
      colorGrade: false,
      ambientOcclusion: 0,
      clouds: false,
      fauna: 'low',
    },
  },
  low: {
    label: 'Low',
    hint: 'for when you are on the go',
    values: {
      renderScale: 0.7,
      shadows: 'off',
      bloom: true,
      antialias: false,
      particles: 'low',
      textureQuality: 'low',
      scatterDensity: 0.35,
      groundDetail: 'low',
      maxAgents: 60,
      stars: true,
      ibl: false,
      tiltShift: false,
      colorGrade: true,
      ambientOcclusion: 0,
      clouds: true,
      fauna: 'low',
    },
  },
  balanced: {
    label: 'Balanced',
    hint: 'the default — looks good, runs cool',
    values: {
      renderScale: 1,
      shadows: 'low',
      bloom: true,
      antialias: false,
      particles: 'low',
      textureQuality: 'medium',
      scatterDensity: 0.6,
      groundDetail: 'medium',
      maxAgents: 90,
      stars: true,
      ibl: true,
      tiltShift: true,
      colorGrade: true,
      ambientOcclusion: 0.25,
      clouds: true,
      fauna: 'full',
    },
  },
  high: {
    label: 'High',
    hint: 'sharp shadows and a full sky',
    values: {
      renderScale: 1,
      shadows: 'high',
      bloom: true,
      antialias: true,
      particles: 'full',
      textureQuality: 'high',
      scatterDensity: 0.85,
      groundDetail: 'high',
      maxAgents: 140,
      stars: true,
      ibl: true,
      tiltShift: true,
      colorGrade: true,
      ambientOcclusion: 0.25,
      clouds: true,
      fauna: 'full',
    },
  },
  ultra: {
    label: 'Ultra',
    hint: 'everything on, plugged in',
    values: {
      renderScale: 1.5,
      shadows: 'ultra',
      bloom: true,
      antialias: true,
      particles: 'full',
      textureQuality: 'ultra',
      scatterDensity: 1,
      groundDetail: 'high',
      maxAgents: 200,
      stars: true,
      ibl: true,
      tiltShift: true,
      colorGrade: true,
      ambientOcclusion: 0.25,
      clouds: true,
      fauna: 'full',
    },
  },
}

export const SHADOW_SIZES = { off: 0, low: 1024, high: 2048, ultra: 4096 }
const TEXTURE_SIZES = { low: 256, medium: 512, high: 1024, ultra: 1024 }
const PARTICLE_BUDGET = { off: 0, low: 900, full: 3000 }

/**
 * The largest `maxAgents` any preset asks for. Anything sized once at boot — the badge buffers,
 * which are never rebuilt — allocates against this rather than against whatever preset happened
 * to be active, so raising quality later cannot outrun a buffer.
 */
export const MAX_AGENT_CAP = Math.max(...Object.values(PRESETS).map((p) => p.values.maxAgents || 0))

const DEFAULTS = {
  preset: 'balanced',
  ...PRESETS.balanced.values,

  // World. A fresh install opens on the village; saved settings keep whatever theme they chose.
  theme: 'medieval',

  // Repos. Outside every preset, so touching them never flips the preset to custom.
  activeOnly: true, // quiet repos fade, then leave the map
  fadeDays: 3, // a zone starts to ghost when its newest thread is this old
  hideDays: 14, // and leaves the map at this age
  fadeGhosts: false, // draw a ghost thin and grey, rather than leaving it its colours
  // Zone size. Which thread states count toward a repo's footprint, and how densely they
  // pack — the defaults show the burden of work *now*, all four ticked is the full history.
  threadsPerTile: 7, // a cell has seven building slots; above that they share. Labelled
  // "Buildings per tile" in Settings — the key keeps its name because it is persisted here,
  // in data/colony.json, and in ROSTER_KEYS, and a rename buys nothing but a migration.
  countActive: true,
  countIdle: true,
  countInactive: false,
  countArchived: false,
  // Threads. What the Resume button does, on the villager card and on the sidebar action row.
  // Outside every preset, like the Repos keys, so reaching for it never flips the quality
  // preset to custom — and in no scope, because it changes nothing about the world, the
  // renderer or which threads are on the map.
  resumeOpens: 'ide', // 'ide' → the VS Code window, 'app' → the desktop app, 'copy' → clipboard
  setting: 'forest', // the default theme's default world, so the picker opens with it pressed
  /**
   * Set once the stored world has been read against the lists every theme shares. Absent from
   * anything saved before both themes listed every world; `migrate` runs then, and only then.
   */
  worldsShared: true,
  season: 'auto', // an atlas name to force a season, or follow the setting
  timeOfDay: 0.32, // 0..1 — 0 is midnight, 0.5 is noon
  autoTime: false,
  /** Sky follows this machine's own clock. Wins over `autoTime`; both off is manual. */
  clockTime: false,
  dayLength: 240, // seconds for a full cycle when autoTime is on

  // Look
  exposure: 1.0,
  bloomStrength: 0.25,
  tiltShiftStrength: 0.2, // 0..1 — share of the effect's full blur radius (2% of frame height)
  tiltShiftAngle: 0, // degrees — 0 keeps the sharp band horizontal
  iblIntensity: 1.0,
  deckGlaze: 0.2, // 0..0.5 — how far a zone's grass leans toward its repo colour (village only)
  fov: 38,
  /**
   * How far the world bends away toward the horizon — Animal Crossing's little-round-world
   * look. 0 is flat. The bend is keyed off wherever the camera is looking, so the ground
   * under the cursor never moves; only the far side of the colony dips.
   */
  worldCurve: 0.45,
  /** The colour grade on top of tone mapping: saturation, a warm cast, and a soft vignette. */
  saturation: 1.0,
  vignette: 0.3,

  // Sound. On by default but silent until the first click — browsers insist — and every
  // layer has its own fader, because the one thing an always-open window must never do is
  // make a noise you cannot turn down.
  sound: true,
  masterVolume: 0.6,
  ambienceVolume: 0.8,
  effectsVolume: 0.8,

  // Behaviour
  autoQuality: true, // drop render scale when frames get expensive
  autoFrame: false, // ease the camera back to isometric when you stop dragging; opt-in
  // On by default: picking a bot is nearly always the start of watching it, and having to find
  // the toggle first meant the one you clicked had usually walked off before you got there.
  followSelected: true, // track the selected bot while retaining manual camera controls
  /** Set once when the follow default flipped on, so the migration never runs twice. */
  followDefaultOn: false,
  showFps: false,
  showLabels: true,
  reducedMotion: false,
}

/** Every setting's key, so the panel's layout can be checked against the real list. */
export const SETTING_KEYS = Object.freeze(Object.keys(DEFAULTS))

/** Keys whose change forces a full rebuild of the world (terrain, scatter, sky). */
const WORLD_KEYS = new Set(['setting', 'groundDetail', 'scatterDensity', 'stars'])
/** Keys that only need the renderer reconfigured. */
const RENDER_KEYS = new Set([
  'autoQuality',
  'renderScale',
  'shadows',
  'bloom',
  'antialias',
  'exposure',
  'bloomStrength',
  'tiltShift',
  'tiltShiftStrength',
  'tiltShiftAngle',
  'colorGrade',
  'saturation',
  'vignette',
  'ambientOcclusion',
])
/**
 * Keys that change which threads are on the map, or how many tiles they need. Neither the
 * world nor the renderer cares — the next roster is simply laid out again, which is what
 * `main.js` does when it sees this scope.
 */
const ROSTER_KEYS = new Set(['threadsPerTile', 'countActive', 'countIdle', 'countInactive', 'countArchived'])
/** Keys outside the roster scope whose change also lays the roster out again at once. */
const RELAYOUT_KEYS = ['setting', 'maxAgents', 'activeOnly', 'fadeDays', 'hideDays']

/**
 * Whether a settings change should lay the roster out again now, rather than wait for the next
 * poll. Never before the first scan has landed (`scanned`): until then the roster is empty, and
 * a browser adopting its colony file's settings at boot would lay out no threads at all. That
 * pass reconciles `seen` against an empty scan, forgets every row older than the Repos window
 * — threads still on disk among them — and saves it, so the first real scan meets nobody and
 * every open thread walks out of the ship at once. That scan lays the roster out anyway,
 * against whatever the settings say by then.
 */
export function relaysRoster(changed, scope, { scanned }) {
  if (!scanned) return false
  return Boolean(scope.roster) || RELAYOUT_KEYS.some((k) => changed.has(k))
}

export class Settings {
  constructor() {
    const raw = load()
    const stored = migrate(raw)
    this.values = { ...DEFAULTS, ...stored }
    // An existing Low/Potato install should not inherit Balanced's new effect by accident.
    if (!Object.hasOwn(stored, 'ambientOcclusion')) {
      this.values.ambientOcclusion = PRESETS[this.values.preset]?.values.ambientOcclusion ?? DEFAULTS.ambientOcclusion
    }
    // Following the selected bot used to be opt-in, so every existing colony has `false` stored
    // against it and a changed default would never reach one. Turned on once, and remembered as
    // done — otherwise this would fight anybody who turns it back off, every single boot.
    if (!Object.hasOwn(stored, 'followDefaultOn')) {
      this.values.followSelected = true
      this.values.followDefaultOn = true
    }
    this.listeners = new Set()
    this._saveTimer = 0
    // The one-time world migration is written back now, not with the next change: until then the
    // store still reads as unmigrated, and a reload that beats the debounced save of a pick
    // made straight after it would migrate it again and undo the pick.
    if (!Object.hasOwn(raw, 'worldsShared') && hasStoredSettings()) this.flush()
  }

  get(key) {
    return this.values[key]
  }

  /** True when `key` currently differs from what the active preset specifies. */
  isOverridden(key) {
    const preset = PRESETS[this.values.preset]
    return Boolean(preset && key in preset.values && preset.values[key] !== this.values[key])
  }

  set(key, value) {
    if (this.values[key] === value) return
    this.values[key] = value
    // Touching any quality knob directly means you are no longer on a named preset.
    const preset = PRESETS[this.values.preset]
    if (preset && key in preset.values) this.values.preset = 'custom'
    this._emit([key])
  }

  applyPreset(name) {
    const preset = PRESETS[name]
    if (!preset) return
    const changed = []
    for (const [k, v] of Object.entries(preset.values)) {
      if (this.values[k] !== v) {
        this.values[k] = v
        changed.push(k)
      }
    }
    this.values.preset = name
    this._emit(changed.length ? changed : ['preset'])
  }

  onChange(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  _emit(keys) {
    const changed = new Set(keys)
    const scope = {
      world: keys.some((k) => WORLD_KEYS.has(k)),
      render: keys.some((k) => RENDER_KEYS.has(k)),
      roster: keys.some((k) => ROSTER_KEYS.has(k)),
    }
    for (const fn of this.listeners) fn(changed, scope, this.values)
    this._scheduleSave()
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(this.values))
      } catch {
        /* private mode, quota — the game just forgets between sessions */
      }
    }, 400)
  }

  /** Write now rather than on the 400 ms debounce. Used right before a page reload. */
  flush() {
    clearTimeout(this._saveTimer)
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.values))
    } catch {
      /* same as the debounced path */
    }
  }

  /**
   * Adopt a whole saved set at once — the colony file's copy, when this browser has none of
   * its own. One emit rather than one per key, so the renderer is reconfigured once instead
   * of thirty times on the way in.
   */
  applyAll(values) {
    // `migrate` first: a colony file written before settings were renamed still names them the
    // old way. Then the colony file may predate the occlusion setting too (a fresh browser).
    const incoming = { ...migrate(values) }
    if (PRESETS[incoming.preset] && !Object.hasOwn(incoming, 'ambientOcclusion')) {
      incoming.ambientOcclusion = PRESETS[incoming.preset].values.ambientOcclusion
    }
    const changed = []
    for (const [key, value] of Object.entries(incoming)) {
      if (!(key in this.values) || this.values[key] === value) continue
      this.values[key] = value
      changed.push(key)
    }
    if (changed.length) this._emit(changed)
    return changed.length
  }

  // Convenience readers used all over the render code.
  get shadowSize() {
    return SHADOW_SIZES[this.values.shadows] || 0
  }
  get textureSize() {
    return TEXTURE_SIZES[this.values.textureQuality] || 512
  }
  get particleBudget() {
    return PARTICLE_BUDGET[this.values.particles] ?? 0
  }
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/**
 * The worlds each theme listed before both listed every one, and what each opened on for a
 * stored world it did not list. Literals, frozen at that point on purpose: they describe what
 * old saved settings could have been showing, which no later change to the lists may alter.
 */
const LEGACY_WORLDS = {
  space: ['moon', 'mars', 'terra', 'beach', 'ocean', 'jungle', 'desert', 'tundra', 'autumn', 'sakura', 'volcanic', 'sky'],
  medieval: ['forest', 'valley', 'mountain'],
}
const LEGACY_DEFAULT = { space: 'moon', medieval: 'forest' }

/**
 * Settings saved by an older build, brought up to this one. Both ways in need this, not just
 * localStorage: `applyAll` adopts a colony file whole on a browser that has no settings of its
 * own, and a colony file can be as old as any browser's.
 *
 * - `planet` became `setting` when worlds moved into themes. Dropping the key rather than
 *   migrating it would quietly reset that colony to the default world on every machine but the
 *   one it was saved from.
 * - Once, when both themes began listing every world (`worldsShared` absent): a stored world
 *   the theme did not list then could only ever have been showing that theme's first world, so
 *   it becomes that world rather than one it now lists and never showed. A space install that
 *   stored the fresh-install `forest` stays on the Moon; a village install storing a space id
 *   stays on the forest. A missing theme is the village (the default) and a missing world the
 *   default `forest`, as the constructor would read them; a theme this build does not have is
 *   space, as the loader would open it.
 */
function migrate(values) {
  if (!values || typeof values !== 'object') return values
  let out = values
  if ('planet' in out) {
    out = { ...out }
    if (!('setting' in out)) out.setting = out.planet
    delete out.planet
  }
  if (!('worldsShared' in out)) {
    out = { ...out, worldsShared: true }
    const stored = out.theme ?? DEFAULTS.theme
    // A theme this build does not have loads as space (`loadTheme`), so it was showing space.
    const theme = Object.hasOwn(LEGACY_WORLDS, stored) ? stored : 'space'
    const setting = out.setting ?? 'forest'
    if (!LEGACY_WORLDS[theme].includes(setting)) out.setting = LEGACY_DEFAULT[theme]
  }
  return out
}

export function hasStoredSettings() {
  try {
    return Boolean(localStorage.getItem(STORE_KEY))
  } catch {
    return false
  }
}

/**
 * The three answers Resume knows. `'terminal'` — focus the exact terminal tab — arrives with
 * the in-repo VS Code extension and is deliberately absent here rather than accepted early.
 */
export const RESUME_OPENS = ['ide', 'app', 'copy']

/**
 * Any value this build does not know reads as the default, which is the safest of the three: a
 * colony file written by a newer build, or edited by hand, leaves Resume working rather than
 * inert.
 */
export const resumeChoice = (value) => (RESUME_OPENS.includes(value) ? value : 'ide')
