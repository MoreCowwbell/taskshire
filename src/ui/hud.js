import { PRESETS, matchesRepoFilter, panelContext, resumeDisabled, resumeLabel, settingsLayout } from './hud-data.js'
import { resumeChoice } from '../core/settings.js'
import { THEME_IDS, THEME_NAMES, menuSettings } from '../themes/index.js'
import { TIMES, systemTimeOfDay } from '../world/sky.js'
import { STATUS_LABEL, isAsking } from '../game/colony.js'

/**
 * The whole HUD, in plain DOM.
 *
 * Deliberately not a framework: this sits on top of a render loop that must not miss a
 * frame, so the UI only ever touches the DOM when something it shows has actually changed —
 * every setter compares against the last value it wrote and returns early otherwise.
 *
 * The one hard rule is that all of this is optional. Pressing H hides every panel, and the
 * game stays fully readable because status lives above the astronauts' heads in the scene,
 * not in here.
 */

/**
 * The page only ever runs on the machine the server is on — it answers nothing else — so the
 * browser's OS is the server's OS, and the name of the thing that shows a folder can be read
 * here rather than asked for.
 */
const IS_MAC = /Mac/.test(navigator.platform)
const IS_WIN = /Win/.test(navigator.platform)
const FILE_MANAGER = IS_MAC ? 'Finder' : IS_WIN ? 'Explorer' : 'Files'

const ICON = {
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M6.6 6.6C4.06 8.2 2 11 2 11s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M2 2l20 20"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/></svg>`,
  next: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 8.5h3.2l1.5-2h8.6l1.5 2H21v11H3z"/><circle cx="12" cy="14" r="3.4"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6v.4"/><path d="M12 17h.01"/></svg>`,
  open: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18v3H3z"/><path d="M5 9v10h14V9"/><path d="M10 13h4"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.7a8 8 0 0 1-8.5 8 9.3 9.3 0 0 1-2.7-.4L4.5 21l1.4-4.1a7.9 7.9 0 0 1-2.4-5.7A8 8 0 0 1 12 3.6a8 8 0 0 1 8.5 8.1z"/><path d="M12 8.6v5.4M9.3 11.3h5.4"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.4A1.4 1.4 0 0 1 4.4 6h4.2l2 2.5h7A1.4 1.4 0 0 1 19 9.9v7.7a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 17.6z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`,
  locate: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.6"/><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6"/></svg>`,
  orbit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10.2" ry="4.6" transform="rotate(-24 12 12)"/><circle cx="21" cy="8.2" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z"/><path d="M12 15v6"/></svg>`,
  sound: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a8 8 0 0 1 0 11"/></svg>`,
  soundOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>`,
}

const STAT_DEFS = [
  { key: 'working', label: 'building', cls: 'working' },
  { key: 'waiting', label: 'need you', cls: 'waiting' },
  { key: 'blocked', label: 'blocked', cls: 'blocked' },
  { key: 'celebrating', label: 'shipped', cls: 'done' },
  { key: 'agents', label: 'crew', cls: 'idle' },
]

/** Prefix for each settings group's disclosure state — `.world`, `.look`, `.quality`… */
const FOLD_KEY = 'botcrossing.settings-fold'

/**
 * The counted-state chips in the repo list: the state, the setting it writes, and the word
 * both this chip and the Zone size switch wear. One list, so the two can never disagree.
 */
const COUNT_CHIPS = [
  ['active', 'countActive', 'Active'],
  ['idle', 'countIdle', 'Idle'],
  ['inactive', 'countInactive', 'Inactive'],
  ['archived', 'countArchived', 'Archived'],
]

export class Hud {
  constructor(root, settings, actions, theme) {
    this.theme = theme
    this.settings = settings
    this.actions = actions
    this.visible = true
    this._last = {}

    this.el = document.createElement('div')
    this.el.className = 'hud'
    this.el.innerHTML = TEMPLATE
    root.appendChild(this.el)

    this.$ = (sel) => this.el.querySelector(sel)
    // The sound button and its help line belong to the ambience, which only a theme with the
    // `sound` feature runs. Anywhere else they come out of the DOM before anything reads it, so
    // the rail and the help sheet are exactly what they were before the sound existed. Any
    // other element marked with a feature follows the same rule.
    for (const el of this.el.querySelectorAll('[data-feature]')) if (!this._hasFeature(el.dataset.feature)) el.remove()

    // The template ships the space theme's wording, so these three writes are a no-op for it
    // and the whole of the difference for a theme whose inhabitants are not astronauts.
    const copy = theme.manifest.copy
    this.statDefs = STAT_DEFS.map((d) =>
      d.key === 'agents'
        ? { ...d, label: copy.inhabitants }
        : d.key === 'celebrating'
          ? { ...d, label: copy.shipped.toLowerCase() }
          : d
    )
    this.$('#btn-next').title = copy.nextHint
    this.$('#btn-archive').title = copy.archiveHint
    this.$('#btn-hide-repo').title = copy.hideHint ?? 'Hide this repo from the map'
    this.$('#btn-pin-repo').title = copy.pinHint ?? 'Pin — this repo never fades'
    this.$('.help .sub').textContent = copy.intro

    this._buildStats()
    this._buildSettings()
    this._buildRepoView()
    this._buildAvatar()
    this._wire()
    this.syncSettings()
    // Read layout when panels resize/change, never in the animation loop.
    this._layoutObserver = new ResizeObserver(() => this._syncLayout())
    this._layoutObserver.observe(this.el)
    this._layoutObserver.observe(this.$('.side'))
    this._syncLayout()
  }

  // ── construction ────────────────────────────────────────────────────────────────────

  _buildStats() {
    const wrap = this.$('.stats')
    this.statEls = {}
    for (const def of this.statDefs) {
      const b = document.createElement('button')
      b.className = `stat ${def.cls}`
      b.type = 'button'
      b.dataset.key = def.key
      b.title = `Jump to the next ${def.label} ${this.theme.manifest.copy.inhabitant}`
      b.innerHTML = `<i class="pip"></i><span class="n">0</span><span class="lbl">${def.label}</span>`
      b.type = 'button'
      b.addEventListener('click', () => this.actions.focusStatus?.(def.key))
      wrap.appendChild(b)
      this.statEls[def.key] = b
    }
  }

  /** A world's picker button: its colour dot and name, pressed while it is the world shown. */
  _settingButton(setting) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'setting-btn'
    b.dataset.id = setting.id
    b.title = setting.blurb || ''
    const c1 = hex(setting.ground.high)
    const c2 = hex(setting.ground.low)
    b.innerHTML = `<i class="orb" style="background:radial-gradient(circle at 33% 30%, ${c1}, ${c2})"></i><span>${setting.name}</span>`
    b.addEventListener('click', () => this.settings.set('setting', setting.id))
    this.controls.push({
      el: b,
      sync: () => b.setAttribute('aria-pressed', String(this.settings.get('setting') === setting.id)),
    })
    return b
  }

  _buildSettings() {
    const body = this.$('.settings .body')
    const s = this.settings
    const copy = this.theme.manifest.copy
    this.controls = []
    const pct = (v) => `${Math.round(v * 100)}%`

    // One function per row, keyed by the setting it writes. Which rows a theme shows, in which
    // group and in what order, is `SETTINGS_GROUPS` in `hud-data.js`: the wording lives here and
    // the arrangement there.
    const builders = {
      // World. The theme comes first because everything under it belongs to whichever one is
      // picked — the settings, the crew, the buildings — so switching goes back through boot
      // rather than rebuilding the colony in place: `main.js` flushes the choice and reloads.
      // Then the place inside that theme and the season it is seen in: one button per thing the
      // theme ships, in rows that wear their label above the buttons because the buttons want
      // the whole width.
      theme: () =>
        this._select(
          'Theme',
          'theme',
          THEME_IDS.map((id) => [id, THEME_NAMES[id]]),
          'Switching reloads the page.'
        ),
      // One picker, three to a row, holding the worlds the theme's menu lists, in `WORLD_GROUPS`
      // order (`menuSettings` filters by the menu but keeps the settings' own order).
      setting: () => {
        const settingRow = this._row('Setting', undefined, 'setting')
        settingRow.classList.add('stack')
        const settingLabel = settingRow.querySelector('.label')
        settingLabel.id = 'settings-setting-label'
        const listed = menuSettings(this.theme)
        const picker = document.createElement('div')
        picker.className = 'settings-picker thirds'
        picker.setAttribute('role', 'group')
        picker.setAttribute('aria-labelledby', settingLabel.id)
        for (const setting of listed) picker.appendChild(this._settingButton(setting))
        settingRow.appendChild(picker)
        settingRow.hidden = listed.length < 2
        return settingRow
      },
      // Season. One button per sheet the theme's kit ships, plus Auto (the setting's own).
      season: () => {
        const kitWithSeasons = Object.values(this.theme.manifest.kits || {}).find((k) => k.atlases)
        const seasonRow = this._row('Season', undefined, 'season')
        seasonRow.classList.add('stack')
        const seasonLabel = seasonRow.querySelector('.label')
        seasonLabel.id = 'settings-season-label'
        const seasons = document.createElement('div')
        seasons.className = 'settings-picker'
        seasons.setAttribute('role', 'group')
        seasons.setAttribute('aria-labelledby', seasonLabel.id)
        const names = ['auto', ...Object.keys(kitWithSeasons.atlases)]
        for (const name of names) {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'setting-btn'
          b.innerHTML = `<span>${name === 'auto' ? 'Auto' : name[0].toUpperCase() + name.slice(1)}</span>`
          b.addEventListener('click', () => this.settings.set('season', name))
          seasons.appendChild(b)
          this.controls.push({ el: b, sync: () => b.setAttribute('aria-pressed', String(this.settings.get('season') === name)) })
        }
        seasonRow.appendChild(seasons)
        return seasonRow
      },

      // Time. Where the clock stands, and whether it runs on its own.
      clockTime: () =>
        chips(
          // `Live` is a time of day like the others from where you are standing, so it belongs
          // in the same row rather than in a toggle further down.
          [...TIMES.map((t) => ({ id: t.id, label: t.label })), { id: 'live', label: 'Live' }],
          () => (this.settings.get('clockTime') ? 'live' : nearestTime(this.settings.get('timeOfDay'))),
          (id) => {
            this.settings.set('autoTime', false)
            this.settings.set('clockTime', id === 'live')
            if (id === 'live') this.settings.set('timeOfDay', systemTimeOfDay())
            else this.settings.set('timeOfDay', TIMES.find((t) => t.id === id).value)
          },
          this.controls,
          'clockTime'
        ),
      timeOfDay: () =>
        this._slider('Time of day', 'timeOfDay', 0, 1, 0.005, clockLabel, undefined, () => {
          // Reaching for the slider is a request for a particular light, so stop following the
          // clock — otherwise the next frame would drag the thumb straight back.
          this.settings.set('clockTime', false)
        }),
      autoTime: () =>
        this._toggle(
          'Cycle day/night',
          'autoTime',
          'Runs the clock forward on its own. Ignored while the sky is following this machine’s clock.'
        ),
      dayLength: () => this._slider('Cycle length', 'dayLength', 30, 900, 30, (v) => `${Math.round(v / 60)}m`),

      // Repos. Quiet zones ghost and then leave; these say when. Which repos are hidden, and
      // which have aged out, is a property of the list itself — so those two live in the repo
      // list in the sidebar, next to the repos they are talking about, not in here.
      activeOnly: () =>
        this._toggle('Active repos only', 'activeOnly', 'Quiet repos fade, then leave the map. They come back when a thread wakes.'),
      fadeGhosts: () =>
        this._toggle(
          'Fade ghost towns',
          'fadeGhosts',
          'Thin a quiet repo toward transparent as it ages. Off, a ghost keeps its colours and reads as abandoned by what grows over it.'
        ),
      fadeDays: () => this._slider('Fade after', 'fadeDays', 1, 30, 1, (v) => `${v} day${v === 1 ? '' : 's'}`),
      hideDays: () => this._slider('Hide after', 'hideDays', 2, 90, 1, (v) => `${v} days`),
      threadsPerTile: () =>
        this._slider(
          'Buildings per tile',
          'threadsPerTile',
          1,
          14,
          1,
          (v) => String(v),
          'How many buildings fit on one tile before the zone claims another.'
        ),
      // The four switches below are the same four settings as the View section's chips at the
      // top of the repo list, so they wear the same words: the state, and nothing else.
      countActive: () => this._toggle('Active', 'countActive', 'Open and working right now.'),
      countIdle: () => this._toggle('Idle', 'countIdle', 'Open, and waiting on you.'),
      countInactive: () => this._toggle('Inactive', 'countInactive', 'Closed. The transcript is still on disk, so it can be resumed.'),
      countArchived: () => this._toggle('Archived', 'countArchived', 'You archived it. Unarchive puts it back.'),

      // Threads. What the Resume button does — the villager card and the sidebar action row both
      // follow it. Not a Repos setting (that group is about how much ground a repo is given) and
      // not a View one (that is the camera and two switches about the page); item 17's
      // terminal-tab choice lands in this same row when the extension ships.
      resumeOpens: () =>
        this._select(
          'Resume opens',
          'resumeOpens',
          [
            ['ide', 'VS Code window'],
            ['app', 'Desktop app'],
            ['copy', 'Copy command'],
          ],
          'Where Resume and New conversation take you. Resume falls back to a VS Code window, then to the clipboard.',
          resumeChoice
        ),

      // Look. The picture itself, each effect with its strength directly under its switch, so
      // the slider that does nothing while the switch is off is never read on its own.
      exposure: () => this._slider('Exposure', 'exposure', 0.4, 2, 0.05, (v) => v.toFixed(2)),
      bloom: () => this._toggle('HDR + bloom', 'bloom', 'Glowing eyes, lamps and windows. The first thing to drop.'),
      bloomStrength: () => this._slider('Bloom', 'bloomStrength', 0, 1.6, 0.02, (v) => v.toFixed(2)),
      ibl: () =>
        this._toggle(
          'Environment light',
          'ibl',
          'Image-based lighting taken from this setting’s own sky. Metals get something to reflect.'
        ),
      iblIntensity: () => this._slider('Environment', 'iblIntensity', 0, 2, 0.05, (v) => v.toFixed(2)),
      tiltShift: () => this._toggle('Tilt-shift', 'tiltShift', 'A shallow depth of field, which is what makes the colony read as a model.'),
      tiltShiftStrength: () =>
        this._slider(
          'Tilt-shift blur',
          'tiltShiftStrength',
          0,
          1,
          0.05,
          pct,
          'Aperture: how shallow the focus is, and how far out of it things go.'
        ),
      tiltShiftAngle: () =>
        this._slider(
          'Tilt-shift angle',
          'tiltShiftAngle',
          -90,
          90,
          1,
          (v) => `${v}°`,
          'Swings the plane of focus, the way tilting a real lens does.'
        ),
      fov: () => this._slider('Field of view', 'fov', 20, 60, 1, (v) => `${v}°`),
      showLabels: () => this._toggle('Project labels', 'showLabels'),
      // Only for a theme whose decks take the glaze; the space deck carries its repo colour
      // another way and the slider would move nothing.
      deckGlaze: () =>
        this._slider('Zone tint', 'deckGlaze', 0, 0.5, 0.01, pct, 'How strongly each zone’s ground takes its repo’s colour.'),

      // Atmosphere. The engine's own look — the bend, occlusion, the grade, clouds and wildlife.
      // Each row is there only where the theme has its feature (`src/core/features.js`):
      // anywhere else it would move nothing.
      worldCurve: () =>
        this._slider(
          'World curve',
          'worldCurve',
          0,
          1,
          0.05,
          pct,
          'How far the ground bends away toward the horizon. The point under the cursor never moves.'
        ),
      ambientOcclusion: () =>
        this._slider(
          'Contact shading',
          'ambientOcclusion',
          0,
          1,
          0.05,
          (v) => (v === 0 ? 'Off' : pct(v)),
          'Soft shading in creases and where surfaces meet. Try 20–35% for a subtle effect; 0 turns it off.'
        ),
      colorGrade: () =>
        this._toggle('Colour grade', 'colorGrade', 'Saturation, warmth, lifted shadows and a soft vignette on the finished frame.'),
      saturation: () => this._slider('Saturation', 'saturation', 0.6, 1.5, 0.05, (v) => v.toFixed(2)),
      vignette: () => this._slider('Vignette', 'vignette', 0, 1, 0.05, pct),
      clouds: () => this._toggle('Clouds', 'clouds', 'Cumulus drifting over worlds that have weather.'),
      fauna: () =>
        this._select('Wildlife', 'fauna', [
          ['off', 'Off'],
          ['low', 'Some'],
          ['full', 'Full'],
        ]),

      // Sound, for a theme with the `sound` feature. The two hints that name what you will hear
      // are the theme's own words (`manifest.copy`): the colony's effects are drones and a
      // chime, the village's a lute and its bells.
      sound: () => this._toggle('Ambient sound', 'sound', copy.soundHint),
      masterVolume: () => this._slider('Master', 'masterVolume', 0, 1, 0.05, pct),
      ambienceVolume: () => this._slider('Ambience', 'ambienceVolume', 0, 1, 0.05, pct, 'Beds and the sounds of the world.'),
      effectsVolume: () => this._slider('Effects', 'effectsVolume', 0, 1, 0.05, pct, copy.effectsHint),

      // View. What the camera does when you let go of it, and two switches about the page.
      followSelected: () =>
        this._toggle(
          `Follow selected ${copy.inhabitant}`,
          'followSelected',
          `Tracks the selected ${copy.inhabitant} until you deselect. Drag to pan, right-drag to orbit, and scroll to zoom.`
        ),
      autoFrame: () => this._toggle('Return to isometric', 'autoFrame', 'Eases the angle back when you stop dragging.'),
      reducedMotion: () => this._toggle('Reduced motion', 'reducedMotion', 'Calms the bobbing and the camera easing.'),
      showFps: () => this._toggle('Show FPS', 'showFps'),

      // Quality. What a frame costs: the preset at the top of it moves every knob below, and
      // those are only worth opening to disagree with one — which the dot beside the row you
      // moved then says you did.
      preset: () =>
        chips(
          Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, title: p.hint })),
          () => s.get('preset'),
          (id) => s.applyPreset(id),
          this.controls,
          'preset'
        ),
      renderScale: () =>
        this._slider('Render scale', 'renderScale', 0.35, 2, 0.05, pct, '100% is your display’s own resolution, retina included.'),
      autoQuality: () => this._toggle('Adaptive quality', 'autoQuality', 'Quietly drops render scale if frames get expensive.'),
      antialias: () => this._toggle('Anti-aliasing', 'antialias', 'SMAA pass. Cheap, but not free.'),
      shadows: () =>
        this._select('Shadows', 'shadows', [
          ['off', 'Off'],
          ['low', 'Low'],
          ['high', 'High'],
          ['ultra', 'Ultra'],
        ]),
      textureQuality: () =>
        this._select('Textures', 'textureQuality', [
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
          ['ultra', 'Ultra'],
        ]),
      groundDetail: () =>
        this._select('Ground detail', 'groundDetail', [
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
        ]),
      particles: () =>
        this._select('Particles', 'particles', [
          ['off', 'Off'],
          ['low', 'Low'],
          ['full', 'Full'],
        ]),
      scatterDensity: () => this._slider('Scatter', 'scatterDensity', 0, 1, 0.05, pct),
      stars: () => this._toggle('Stars', 'stars'),
      maxAgents: () => this._slider('Max crew', 'maxAgents', 10, 200, 10, (v) => String(v)),
    }
    // A key the layout names with no row here is a bug to see at boot, not a row to lose.
    const build = (key) => {
      if (!builders[key]) throw new Error(`no settings row for "${key}"`)
      return builders[key]()
    }

    for (const g of settingsLayout(panelContext(this.theme))) {
      const el = foldGroup(g.title, g.id, g.open)
      el.append(...g.rows.map(build))
      if (g.zoneSize) el.appendChild(this._zoneSize(g.zoneSize.map(build)))
      body.appendChild(el)
    }
  }

  /**
   * How much ground a repo is given, and which of its threads are counted when working that
   * out, folded inside Repos. Collapsed, because the defaults are right for almost everybody:
   * the map shows the work that is open now, and history stays in the side panel.
   */
  _zoneSize(rows) {
    const zoneSize = document.createElement('details')
    zoneSize.className = 'hidden-list zone-size'
    const zoneSummary = document.createElement('summary')
    zoneSummary.textContent = 'Zone size'
    zoneSize.appendChild(zoneSummary)
    // The sentence that used to hang under "Count active" alone is the sub-heading over the
    // counted states, where it describes the list rather than the first switch in it.
    const counted = rows.findIndex((row) => COUNT_CHIPS.some(([, key]) => key === row.dataset.key))
    if (counted >= 0) {
      rows.splice(counted, 0, this._subhead('Which threads get a building', 'one thread = one agent session = one building'))
    }
    zoneSize.append(
      ...rows,
      this._action(
        'Layout',
        'Compact',
        () => this.actions.compactZones?.(),
        'Pack every zone toward the middle. Zones move once; the holes left by repos that left the map close up.'
      )
    )
    return zoneSize
  }

  /**
   * The View section at the top of the repo list: Compact, the four counted-state chips and
   * the name filter. The chips write the same settings as the Zone size switches and register
   * in `this.controls`, so `syncSettings()` keeps both surfaces honest without either knowing
   * the other exists.
   *
   * Called after `_buildSettings()`, which resets `this.controls` — a chip registered before
   * that call would be dropped on the floor and never sync again.
   */
  _buildRepoView() {
    this._repoFilter = ''
    this._groupOpenBeforeFilter = {}
    this._stateTotals = null

    const box = this.$('.repo-search')
    box.addEventListener('input', () => {
      this._repoFilter = box.value.trim()
      // The number on an armed button counts the rows that were listed a keystroke ago.
      this._disarmClear()
      this._applyRepoFilter()
    })
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      // Escape in a search box empties the search box. It must never also reach the window
      // handler, which reads Escape as "put the selected thread down".
      e.stopPropagation()
      if (box.value) this._clearRepoFilter()
      else box.blur()
    })

    // Which group, if either, has its Clear all button armed. One at a time: arming the
    // other one is also how you change your mind about this one.
    this._armedClear = null
    this._armedNames = []
    this._clearTimer = 0
    for (const btn of this.el.querySelectorAll('.repo-group .clear')) {
      btn.addEventListener('click', (e) => {
        // Inside a <summary>, so it has to say it is a button and not a disclosure triangle.
        e.preventDefault()
        e.stopPropagation()
        this._clickClear(btn.dataset.clear)
      })
    }

    const wrap = this.$('.repo-view .chips')
    this.stateChips = []
    for (const [state, key, label] of COUNT_CHIPS) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'chip'
      b.dataset.key = key
      b.textContent = label
      b.addEventListener('click', () => this.settings.set(key, !this.settings.get(key)))
      wrap.appendChild(b)
      this.stateChips.push({ state, key, label, el: b })
      this.controls.push({
        el: b,
        sync: () => b.setAttribute('aria-pressed', String(Boolean(this.settings.get(key)))),
      })
    }
  }

  /**
   * What each chip is for, and how much of it there is — in the title rather than on the face,
   * because four numbers printed across a 320px panel stop reading as a filter. A state with
   * nothing in it goes quiet but stays clickable: the setting still decides the next poll.
   */
  _syncChipTitles() {
    for (const { state, key, label, el } of this.stateChips) {
      const tail = this.settings.get(key) ? 'counted' : 'not counted'
      if (!this._stateTotals) {
        el.removeAttribute('data-empty')
        el.title = `${label} — ${tail}`
        continue
      }
      const n = this._stateTotals[state] ?? 0
      el.dataset.empty = String(n === 0)
      el.title = n === 0 ? `${label} · no threads — ${tail}` : `${label} · ${n} thread${n === 1 ? '' : 's'} — ${tail}`
    }
  }

  /**
   * Hide the rows the filter box excludes.
   *
   * Applied to the rows already in the DOM rather than by re-rendering: a poll lands every
   * fifteen seconds and rewrites this list, and a filter that re-ran through `setLegend` would
   * flash the excluded rows back every time. Hidden and Gone are filtered too — "where did it
   * go" and "put it back" are the same question, and that is why those groups are in this list.
   */
  _applyRepoFilter() {
    const q = this._repoFilter
    const rows = [...this.el.querySelectorAll('.projects > .repo')]
    let shown = 0
    for (const row of rows) {
      const hit = matchesRepoFilter(row.dataset.name, q)
      row.hidden = !hit
      if (hit) shown++
    }

    for (const id of ['hidden', 'archive', 'gone']) {
      const group = this.$(`.repo-group[data-group="${id}"]`)
      const groupRows = [...group.querySelectorAll('.repo-row')]
      let hits = 0
      for (const row of groupRows) {
        // An archived thread is found by its repo or by its own title.
        const hit = matchesRepoFilter(row.dataset.name, q) || matchesRepoFilter(row.dataset.title, q)
        row.hidden = !hit
        if (hit) hits++
      }
      group.querySelector('summary .count').textContent = String(q ? hits : groupRows.length)
      group.hidden = groupRows.length === 0 || (Boolean(q) && hits === 0)
      if (q) {
        // Remembered on the first search only, so clearing the box puts the history back the
        // way it was rather than leaving it standing open behind you.
        if (this._groupOpenBeforeFilter[id] === undefined) this._groupOpenBeforeFilter[id] = group.open
        group.open = hits > 0
      } else if (this._groupOpenBeforeFilter[id] !== undefined) {
        group.open = this._groupOpenBeforeFilter[id]
        this._groupOpenBeforeFilter[id] = undefined
      }
    }

    const empty = this.$('.repo-empty')
    empty.hidden = !q || shown > 0
    if (!empty.hidden) empty.textContent = `No repo matches “${q}”.`
    // The head keeps stating a fact about the world, and adds what the filter is doing to the
    // view of it.
    this.$('.sec-head .n').textContent = q ? `${shown} of ${rows.length} on the map` : `${rows.length} on the map`
  }

  /** Empty the box and show everything again. */
  _clearRepoFilter() {
    const box = this.$('.repo-search')
    if (!box.value && !this._repoFilter) return
    box.value = ''
    this._repoFilter = ''
    // Emptying the box from code — Escape — puts every row back without firing `input`, so
    // the disarm the input handler does has to happen here too. The armed button would
    // otherwise still be counting the filtered rows.
    this._disarmClear()
    this._applyRepoFilter()
  }

  /** The theme's feature, by a name that must exist: a typo throws rather than hiding a row. */
  _hasFeature(name) {
    if (!(name in this.theme.features)) throw new Error(`unknown feature "${name}"`)
    return this.theme.features[name]
  }

  /**
   * One settings row. `key` is the setting the row's control writes, named on the row itself
   * the way `data-group` names a thread group: a row is otherwise identifiable only by the
   * label printed in it.
   */
  _row(label, hint, key) {
    const row = document.createElement('div')
    row.className = 'row'
    if (key) row.dataset.key = key
    const l = document.createElement('div')
    l.className = 'label'
    l.innerHTML = `<span>${label}</span>${hint ? `<span class="hint">${hint}</span>` : ''}`
    row.appendChild(l)
    return row
  }

  /**
   * A heading inside a settings group: what the rows under it are choosing between, and the
   * one sentence each of them would otherwise have to repeat. Not a `.row` — it has nothing
   * to toggle — so it stays out of `this.controls` too.
   */
  _subhead(text, note) {
    const el = document.createElement('div')
    el.className = 'subhead'
    el.innerHTML = `<span>${escapeHtml(text)}</span>${note ? `<span class="hint">${escapeHtml(note)}</span>` : ''}`
    return el
  }

  /** A row whose control is a one-shot button rather than a setting: press it, something happens. */
  _action(label, text, onClick, hint) {
    const row = this._row(label, hint)
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn row-btn'
    b.textContent = text
    b.addEventListener('click', onClick)
    row.appendChild(b)
    return row
  }

  _toggle(label, key, hint) {
    const row = this._row(label, hint, key)
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'toggle'
    b.setAttribute('role', 'switch')
    b.setAttribute('aria-label', label)
    b.addEventListener('click', () => this.settings.set(key, !this.settings.get(key)))
    row.appendChild(b)
    this.controls.push({
      el: row,
      sync: () => {
        b.setAttribute('aria-checked', String(Boolean(this.settings.get(key))))
        row.classList.toggle('overridden', this.settings.isOverridden(key))
      },
    })
    return row
  }

  /**
   * A pull-down over one setting.
   *
   * `read` is how the stored value is turned into one of the options offered here, for a key
   * whose reader is more forgiving than this list is: `resumeOpens` accepts anything and
   * answers `'ide'`, and without the same reader in front of the sync a stored `'terminal'`
   * from a newer build would blank the control while the button underneath it went on raising
   * a window. The panel has to show what the behaviour actually is.
   */
  _select(label, key, options, hint, read = (v) => v) {
    const row = this._row(label, hint, key)
    const sel = document.createElement('select')
    sel.className = 'select'
    for (const [value, text] of options) {
      const o = document.createElement('option')
      o.value = value
      o.textContent = text
      sel.appendChild(o)
    }
    sel.addEventListener('change', () => this.settings.set(key, sel.value))
    row.appendChild(sel)
    this.controls.push({
      el: row,
      sync: () => {
        sel.value = String(read(this.settings.get(key)))
        row.classList.toggle('overridden', this.settings.isOverridden(key))
      },
    })
    return row
  }

  _slider(label, key, min, max, step, format, hint, onInput) {
    const row = this._row(label, hint, key)
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px'
    const input = document.createElement('input')
    input.type = 'range'
    input.setAttribute('aria-label', label)
    input.className = 'slider'
    input.min = min
    input.max = max
    input.step = step
    const out = document.createElement('span')
    out.className = 'value'
    input.addEventListener('input', () => {
      onInput?.()
      this.settings.set(key, Number(input.value))
    })
    wrap.append(input, out)
    row.appendChild(wrap)
    this.controls.push({
      el: row,
      sync: () => {
        const v = Number(this.settings.get(key))
        // Never fight the thumb the user is dragging.
        if (document.activeElement !== input) input.value = String(v)
        out.textContent = format(v)
        row.classList.toggle('overridden', this.settings.isOverridden(key))
      },
    })
    return row
  }

  /** The little face on the agent card, drawn from the same atlas the astronauts use. */
  _buildAvatar() {
    const canvas = this.$('.thread-pop .avatar canvas')
    canvas.width = 108
    canvas.height = 108
    this.avatarCtx = canvas.getContext('2d')
    this.avatarTmp = document.createElement('canvas')
    this.avatarTmp.width = 108
    this.avatarTmp.height = 108
    this.avatarTmpCtx = this.avatarTmp.getContext('2d')
    this._avatarState = { frame: -1, color: '' }
  }

  _wire() {
    const on = (sel, ev, fn) => this.$(sel).addEventListener(ev, fn)

    on('#btn-settings', 'click', () => this.toggleSettings())
    on('#btn-compact', 'click', () => this.actions.compactZones?.())
    // On a phone the sidebar is a sheet: a tap on its brand row (not on its buttons) pulls
    // it up or lets it drop, and a drag on the row does the same by direction.
    const brandbar = this.$('.side .brandbar')
    const grab = this.$('.side .grab')
    let dragY = null
    const startDrag = (e) => {
      if (!this.isPhone() || e.target.closest('.btn')) return
      dragY = e.clientY
    }
    const endDrag = (e) => {
      if (dragY === null) return
      const dy = e.clientY - dragY
      dragY = null
      if (Math.abs(dy) > 24) this.toggleSheet(dy < 0)
      else if (!e.target.closest('.btn')) this.toggleSheet()
    }
    for (const el of [brandbar, grab]) {
      el.addEventListener('pointerdown', startDrag)
      el.addEventListener('pointerup', endDrag)
    }
    on('#btn-close-settings', 'click', () => this.toggleSettings(false))
    on('#btn-hide', 'click', () => this.toggleUi())
    on('#btn-help', 'click', () => this.toggleHelp())
    on('#btn-shot', 'click', () => this.actions.screenshot?.())
    on('#btn-home', 'click', () => this.actions.resetView?.())
    on('#btn-next', 'click', () => this.actions.focusStatus?.('waiting'))
    on('#btn-orbit', 'click', () => this.setOrbit(this.actions.toggleOrbit?.()))
    on('#btn-setting', 'click', () => this.actions.cycleSetting?.())
    on('#btn-time', 'click', () => this.actions.cycleTime?.())
    this.$('#btn-sound')?.addEventListener('click', () => this.settings.set('sound', !this.settings.get('sound')))
    on('#btn-open', 'click', () => this.actions.openThread?.())
    on('#btn-viewed', 'click', () => this.actions.markViewed?.())
    on('#btn-archive', 'click', () => this.actions.archiveThread?.())
    on('#btn-deselect', 'click', () => this.actions.select?.(null))
    on('#btn-follow', 'click', () => this.settings.set('followSelected', !this.settings.get('followSelected')))
    on('#btn-new-session', 'click', () => this.actions.newConversation?.())
    on('#btn-reveal', 'click', () => this.actions.revealProject?.())
    on('#btn-copy-path', 'click', () => this.actions.copyProjectPath?.())
    on('#btn-hide-repo', 'click', () => this.actions.hideProject?.(this.project?.name, !this.project?.hidden))
    on('#btn-pin-repo', 'click', () => this.actions.pinProject?.(this.project?.name, !this.project?.pinned))
    on('#btn-locate', 'click', () => this.actions.focusProject?.(this.project?.name))
    on('#btn-close-project', 'click', () => this.actions.closeProject?.())
    on('.help', 'click', (e) => {
      if (e.target === this.$('.help')) this.toggleHelp(false)
    })
    this.$('.help .sheet').addEventListener('click', (e) => e.stopPropagation())
    on('#btn-help-close', 'click', () => this.toggleHelp(false))

    this.settings.onChange(() => this.syncSettings())
  }

  // ── state in ────────────────────────────────────────────────────────────────────────

  syncSettings() {
    const follow = Boolean(this.settings.get('followSelected'))
    const who = this.theme.manifest.copy.inhabitant
    this.$('#btn-follow').setAttribute('aria-pressed', String(follow))
    this.$('#btn-follow').title = follow ? `Stop following the selected ${who}` : `Follow the selected ${who}`
    for (const c of this.controls) c.sync()
    this._syncOpenButton()
    // The chips' titles carry "counted" / "not counted", so they move with the settings too.
    this._syncChipTitles()
    this.$('.fps').classList.toggle('on', Boolean(this.settings.get('showFps')))
    // Only a theme with `sound` has a sound button; anywhere else it was taken out at build.
    const btn = this.$('#btn-sound')
    if (btn) {
      const sound = Boolean(this.settings.get('sound'))
      btn.innerHTML = sound ? ICON.sound : ICON.soundOff
      btn.setAttribute('aria-pressed', String(sound))
      btn.title = sound ? 'Mute (M)' : 'Unmute (M)'
    }
  }

  setStats(stats) {
    for (const def of this.statDefs) {
      const n = stats[def.key] ?? 0
      const el = this.statEls[def.key]
      if (this._last['stat:' + def.key] === n) continue
      this._last['stat:' + def.key] = n
      el.querySelector('.n').textContent = String(n)
      el.dataset.empty = String(n === 0)
    }
  }

  /**
   * Every repo, in the sidebar. This was a strip of chips along the bottom of the screen;
   * it is a list now because the sidebar is where all the chrome lives, and because a list
   * can carry a count and an alarm without running out of room at eleven repos.
   */
  setLegend(projects, activeName = null, stateTotals = null) {
    // Applied before the early return below: the chips are not part of the rows this setter
    // rewrites, so a poll that changes nothing about the list can still change the counts.
    if (stateTotals) {
      this._stateTotals = stateTotals
      this._syncChipTitles()
    }
    const signature =
      projects
        .map((p) => `${p.name}:${p.count}:${p.accent}:${p.urgent ? 1 : 0}:${p.fade > 0 ? quietDays(p.age) : ''}:${p.pinned ? 1 : 0}`)
        .join('|') + `~${activeName}`
    if (this._last.legend === signature) return
    this._last.legend = signature

    const wrap = this.$('.projects')
    // Only the repo rows are this setter's: the Hidden and Gone groups are the same two
    // elements for the life of the page, and live after the rows in the same scroller.
    for (const old of wrap.querySelectorAll(':scope > .repo')) old.remove()
    const anchor = wrap.querySelector('.repo-group')
    for (const p of projects) {
      // A div rather than a button, because the row now carries a button of its own and a
      // button inside a button is markup no browser agrees about — same as the thread rows.
      const b = document.createElement('div')
      b.setAttribute('role', 'button')
      b.tabIndex = 0
      const quiet = p.fade > 0
      b.className = quiet ? 'repo quiet' : 'repo'
      b.dataset.name = p.name
      b.title = quiet
        ? this.theme.manifest.copy.fadeHint ?? 'Quiet'
        : `${p.count} thread${p.count === 1 ? '' : 's'} in ${p.name}`
      b.setAttribute('aria-pressed', String(p.name === activeName))
      const tail = quiet ? quietLabel(p.age) : String(p.count)
      b.innerHTML =
        `<i class="swatch" style="background:${hex(p.accent)};color:${hex(p.accent)}"></i>` +
        `<span class="n">${escapeHtml(p.name)}</span>` +
        (p.pinned ? `<i class="pin">${ICON.pin}</i>` : '') +
        (p.urgent ? '<i class="alarm"></i>' : '') +
        `<span class="count">${tail}</span>` +
        `<button type="button" class="mini eye" title="Hide ${escapeHtml(p.name)} from the map">${ICON.eye}</button>`
      b.addEventListener('click', (e) => {
        if (e.target.closest?.('.eye')) {
          e.stopPropagation()
          this.actions.hideProject?.(p.name, true)
          return
        }
        this.actions.pickProject?.(p.name)
      })
      // The row is a div, so Enter and Space are this code's job — and they must not also
      // reach the window handler, which reads Enter as "open the selected thread".
      b.addEventListener('keydown', (e) => {
        if (e.target !== b) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        b.click()
      })
      wrap.insertBefore(b, anchor)
    }
    // Rows arrive already filtered: whatever is in the box outlives the poll that rebuilt them.
    this._applyRepoFilter()
  }

  /**
   * The repos you hid, under the list they were hidden from — a group rather than a page in
   * settings, because "where did it go" and "put it back" want to be the same place.
   * `rows` is `[{ name, accent }]`; an accent of null means the map has forgotten the plot.
   */
  setHidden(rows) {
    const signature = rows.map((r) => `${r.name}:${r.accent ?? ''}`).join('|')
    if (this._last.hidden === signature) return
    this._last.hidden = signature
    this._fillGroup('hidden', rows, (r) => {
      const row = this._repoGroupRow(r.name, r.accent)
      row.appendChild(
        this._groupButton(ICON.eyeOff, `Show ${r.name} on the map again`, () => this.actions.hideProject?.(r.name, false))
      )
      return row
    })
  }

  /** Repos that aged out of the map. The eye keeps one out for good; + wakes it with a thread. */
  setGone(rows) {
    const signature = rows.map((r) => `${r.name}:${quietDays(r.age)}:${r.hasFolder ? 1 : 0}`).join('|')
    if (this._last.gone === signature) return
    this._last.gone = signature
    this._fillGroup('gone', rows, (r) => {
      const row = this._repoGroupRow(r.name, null)
      const age = document.createElement('span')
      age.className = 'count'
      age.textContent = quietLabel(r.age)
      row.appendChild(age)
      row.appendChild(this._groupButton(ICON.eye, `Hide ${r.name} for good`, () => this.actions.hideProject?.(r.name, true)))
      const plus = this._groupButton(
        ICON.plus,
        r.hasFolder ? `New conversation in ${r.name}` : 'No folder on disk for that project',
        () => this.actions.newConversation?.(r.name)
      )
      plus.disabled = !r.hasFolder
      row.appendChild(plus)
      return row
    })
  }

  /**
   * Every archived thread, across every repo. `rows` is `archiveRows()` with each repo's accent
   * added — null when the map has no plot for it. Clicking a row opens its card (and its repo,
   * when the repo is on the map); the button puts it back.
   */
  setArchive(rows) {
    const signature = rows.map((r) => `${r.id}:${r.title}:${r.project}:${r.accent ?? ''}:${r.at ? ago(r.at) : ''}`).join('|')
    if (this._last.archive === signature) return
    this._last.archive = signature
    this._fillGroup('archive', rows, (r) => {
      const row = document.createElement('div')
      row.className = 'repo-row archive-row'
      row.dataset.name = r.project
      row.dataset.title = r.title
      row.setAttribute('role', 'button')
      row.tabIndex = 0
      row.title = `${r.title} — ${r.project}`
      const swatch = document.createElement('i')
      swatch.className = 'swatch'
      if (r.accent == null) swatch.classList.add('none')
      else swatch.style.cssText = `background:${hex(r.accent)};color:${hex(r.accent)}`
      const label = document.createElement('span')
      label.className = 'n'
      label.innerHTML = `<span class="t">${escapeHtml(r.title)}</span><span class="sub">${escapeHtml(r.project)}</span>`
      row.append(swatch, label)
      if (r.at) {
        const age = document.createElement('span')
        age.className = 'count'
        age.textContent = ago(r.at)
        age.title = 'Archived'
        row.appendChild(age)
      }
      const undo = this._groupButton(ICON.archive, 'Unarchive', (e) => {
        e.stopPropagation()
        this.actions.unarchiveThread?.(r.id)
      })
      undo.classList.add('undo')
      row.appendChild(undo)
      row.addEventListener('click', () => this.actions.select?.(r.id))
      // The row is a div, so Enter and Space are this code's job — and they must not also
      // reach the window handler, which reads Enter as "open the selected thread".
      row.addEventListener('keydown', (e) => {
        if (e.target !== row) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        row.click()
      })
      return row
    })
  }

  /** Hidden, Archive and Gone are the same shape: a count, some rows, and nothing when empty. */
  _fillGroup(id, rows, build) {
    if (this._armedClear === id) this._disarmClear()
    const el = this.$(`.repo-group[data-group="${id}"]`)
    el.hidden = rows.length === 0
    el.querySelector('summary .count').textContent = String(rows.length)
    const body = el.querySelector('.rows')
    body.innerHTML = ''
    for (const r of rows) body.appendChild(build(r))
    this._applyRepoFilter()
  }

  /**
   * Clear all, in two clicks.
   *
   * The first click arms the button and prints the number it is about to take; the second
   * does it, and four seconds of nothing calls it off. Not a `confirm()`: a modal dialog
   * freezes the page — and with it the colony behind the sidebar — for a question the button
   * can ask in its own label. Two clicks rather than one because this is the only button in
   * the panel whose undo is "wait for a thread to open in that folder again", and because it
   * sits in a summary, where a click that was meant for the disclosure triangle lands.
   */
  _clickClear(id) {
    if (this._armedClear === id) {
      // The names the first click counted, not whatever is listed now: the label is a promise
      // about a specific set of rows, and everything that can change that set between the two
      // clicks disarms the button — but the stash is what makes the promise unbreakable.
      const armed = this._armedNames
      this._disarmClear()
      return this.actions.forgetProjects?.(armed)
    }
    const names = this._listedIn(id)
    if (!names.length) return this._disarmClear()
    this._armClear(id, names)
  }

  /**
   * One group's rows, as the person can actually see them. A row the filter box is holding
   * back is not part of "all": typing three letters and pressing Clear has to take the three
   * repos on screen and nothing else.
   */
  _listedIn(id) {
    return [...this.el.querySelectorAll(`.repo-group[data-group="${id}"] .repo-row`)]
      .filter((row) => !row.hidden)
      .map((row) => row.dataset.name)
  }

  _armClear(id, names) {
    this._disarmClear()
    this._armedClear = id
    this._armedNames = names
    const btn = this.$(`.repo-group[data-group="${id}"] .clear`)
    btn.dataset.armed = 'true'
    btn.textContent = `Clear ${names.length}?`
    this._clearTimer = setTimeout(() => this._disarmClear(), 4000)
  }

  _disarmClear() {
    clearTimeout(this._clearTimer)
    const id = this._armedClear
    this._armedClear = null
    this._armedNames = []
    if (!id) return
    const btn = this.el.querySelector(`.repo-group[data-group="${id}"] .clear`)
    if (!btn) return
    delete btn.dataset.armed
    btn.textContent = 'Clear all'
  }

  /** A row in one of those groups: the repo's own colour if the map still remembers it. */
  _repoGroupRow(name, accent) {
    const row = document.createElement('div')
    row.className = 'repo-row'
    row.dataset.name = name
    const swatch = document.createElement('i')
    swatch.className = 'swatch'
    if (accent == null) swatch.classList.add('none')
    else swatch.style.cssText = `background:${hex(accent)};color:${hex(accent)}`
    const label = document.createElement('span')
    label.className = 'n'
    label.textContent = name
    label.title = name
    row.append(swatch, label)
    return row
  }

  _groupButton(icon, title, onClick) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'mini'
    b.title = title
    b.innerHTML = icon
    b.addEventListener('click', onClick)
    return b
  }

  /**
   * The project sidebar: what a zone is, and the things you can do to the *repo* rather
   * than to one thread in it. Opened by clicking a zone, its name plate, its legend chip,
   * or any astronaut standing on it.
   */
  setProject(project) {
    const panel = this.$('.side')
    if (!project) {
      this.project = null
      if (this._last.project === null) return
      this._last.project = null
      panel.classList.remove('drilled')
      panel.classList.remove('open')
      this._syncLayout()
      return
    }

    this.project = project
    const counts = project.counts || { active: 0, idle: 0, inactive: 0, archived: 0 }
    // On a phone, opening a repo pulls the sheet up so its threads are in view — unless an
    // astronaut was just picked, whose card wants the room above the sheet's peek.
    if (this.isPhone() && !this.selected && !panel.classList.contains('open')) {
      panel.classList.add('open')
      this._syncLayout()
    }
    // The minute is part of the signature because `ago()` is: without it a repo where
    // nothing is happening keeps whatever "4m ago" it was first drawn with, for as long as
    // you leave the panel open.
    const signature =
      `${project.name}~${project.path}~${project.accent}~${project.selectedId}~${Math.floor(Date.now() / 60000)}~` +
      `${project.hidden ? 1 : 0}${project.pinned ? 1 : 0}~` +
      `${counts.active}/${counts.idle}/${counts.inactive}/${counts.archived}~` +
      project.threads
        .map(
          (t) =>
            `${t.id}:${t.state}:${t.status}:${t.title}:${t.lastActivityAt}:${t.asking ? 1 : 0}:${t.sessionId}:${t.resume}`
        )
        .join('|')
    panel.classList.add('drilled')
    if (this._last.project === signature) return
    this._last.project = signature

    const swatch = this.$('.side .who .swatch')
    swatch.style.background = hex(project.accent)
    swatch.style.color = hex(project.accent) // the halo is `currentColor`
    this.$('.side .name').textContent = project.name
    const path = this.$('.side .path')
    path.textContent = project.path ? shortPath(project.path) : 'folder unknown'
    path.title = project.path || ''
    // Nothing to open a new thread in, and nothing to reveal, without a folder on disk.
    this.$('#btn-new-session').disabled = !project.path
    this.$('#btn-reveal').disabled = !project.path
    this.$('#btn-copy-path').disabled = !project.path
    this.$('#btn-hide-repo').setAttribute('aria-pressed', String(Boolean(project.hidden)))
    this.$('#btn-pin-repo').setAttribute('aria-pressed', String(Boolean(project.pinned)))
    this.$('.side .who').classList.toggle('pinned', Boolean(project.pinned))

    // The head is a census rather than a total: a repo's worth is how much of it is open,
    // and the two hundred dead transcripts behind it are not news.
    const census = []
    if (counts.active) census.push(`${counts.active} active`)
    if (counts.idle) census.push(`${counts.idle} idle`)
    if (counts.inactive) census.push(`${counts.inactive} inactive`)
    this.$('.side .threads-head').innerHTML = `<span>${census.length ? census.join(' · ') : 'No threads'}</span>`

    const list = this.$('.side .threads')
    // A poll rewrites these rows every time a live thread's timestamp moves. Losing your
    // place in a forty-thread repo every fifteen seconds would make the list unusable —
    // and so would the history groups snapping shut under the pointer, hence both of these.
    const scroll = list.scrollTop
    const wasOpen = {}
    for (const d of list.querySelectorAll('details.thread-group')) wasOpen[d.dataset.group] = d.open
    list.innerHTML = ''

    const open = project.threads.filter((t) => t.state !== 'inactive' && t.state !== 'archived')
    const inactive = project.threads.filter((t) => t.state === 'inactive')
    const archived = project.threads.filter((t) => t.state === 'archived')

    const heading = document.createElement('div')
    heading.className = 'thread-group'
    heading.textContent = 'Active / Idle'
    list.appendChild(heading)
    if (open.length) {
      for (const t of open) {
        list.appendChild(this._threadRow(t, project, list, 'open'))
        if (t.id === project.selectedId) list.appendChild(this._threadActs(t))
      }
    } else {
      const empty = document.createElement('div')
      empty.className = 'thread-empty'
      empty.textContent = 'Nothing open'
      list.appendChild(empty)
    }

    if (inactive.length) list.appendChild(this._threadGroup('inactive', 'Inactive', inactive, project, wasOpen, list))
    if (archived.length) list.appendChild(this._threadGroup('archived', 'Archived', archived, project, wasOpen, list))

    list.scrollTop = scroll
    if (!project.selectedId) this._scrolledTo = null
  }

  /**
   * One row. Not a `<button>` any more: the history rows carry their own buttons, and a
   * button inside a button is markup no browser agrees about.
   */
  _threadRow(t, project, list, group) {
    const row = document.createElement('div')
    row.className = `thread ${statusClass(t.status)} state-${t.state || 'idle'}`
    row.dataset.id = t.id
    row.setAttribute('role', 'button')
    row.tabIndex = 0
    row.setAttribute('aria-pressed', String(t.id === project.selectedId))
    row.title = group === 'open' ? STATUS_LABEL[t.status] || t.status : capitalise(t.state)

    let minis = ''
    if (group === 'inactive') {
      // Three cases, not two: a Cursor row has neither a deep link nor a resume command, and
      // promising to copy a command that does not exist is worse than saying so.
      const resumeTitle = t.canOpen ? 'Open' : t.resume ? `Copy “${t.resume}”` : 'Nothing to resume with'
      const canResume = Boolean(t.canOpen || t.resume)
      minis =
        `<button type="button" class="mini" data-act="resume" title="${escapeHtml(resumeTitle)}"${canResume ? '' : ' disabled'}>${t.canOpen ? ICON.open : ICON.copy}</button>` +
        `<button type="button" class="mini" data-act="archive" title="Archive">${ICON.archive}</button>`
    } else if (group === 'archived') {
      minis = `<button type="button" class="mini undo" data-act="unarchive" title="Unarchive">${ICON.archive}</button>`
    }

    // How many helpers this thread has out — the same crowd standing on its plot, counted.
    const helpers = group === 'open' ? t.subagents?.length || 0 : 0
    const chip = helpers
      ? `<span class="helpers" title="${helpers} helper${helpers === 1 ? '' : 's'} running">+${helpers}</span>`
      : ''

    row.innerHTML =
      '<i class="pip"></i>' +
      `<span class="t">${escapeHtml(t.title || 'Untitled thread')}${t.state === 'idle' ? '<span class="q">?</span>' : ''}${chip}</span>` +
      `<span class="when">${ago(t.lastActivityAt)}</span>` +
      (minis ? `<span class="mini-set">${minis}</span>` : '') +
      (t.worktree ? `<span class="wt">⑂ ${escapeHtml(t.worktree)}</span>` : '')

    row.addEventListener('click', (e) => {
      const mini = e.target.closest?.('.mini')
      if (mini) {
        e.stopPropagation()
        if (mini.dataset.act === 'resume') this.actions.resumeThread?.(t.id)
        else if (mini.dataset.act === 'archive') this.actions.archiveThreadById?.(t.id)
        else if (mini.dataset.act === 'unarchive') this.actions.unarchiveThread?.(t.id)
        return
      }
      // Only an open thread has somebody to fly to; the rest just open their card.
      if (group === 'open') this.actions.focusThread?.(t.id)
      else this.actions.select?.(t.id)
    })
    // The row is a div, so Enter and Space are this code's job — and they must not also
    // reach the window handler, which reads Enter as "open the selected thread".
    row.addEventListener('keydown', (e) => {
      // A key pressed on one of the row's own buttons is that button's to handle.
      if (e.target !== row) return
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      e.stopPropagation()
      row.click()
    })

    // A long repo can hide the astronaut you just clicked in the world. Scrolled by hand
    // rather than with `scrollIntoView`, which walks up the ancestors and will happily
    // scroll the *page* — and a page that can scroll at all is one keystroke away from
    // the whole HUD sitting sideways with nothing to put it back.
    if (t.id === project.selectedId && this._scrolledTo !== t.id) {
      this._scrolledTo = t.id
      requestAnimationFrame(() => {
        const top = row.offsetTop
        const bottom = top + row.offsetHeight
        if (top < list.scrollTop) list.scrollTop = top
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
      })
    }
    return row
  }

  /**
   * The action row under the selected thread: the same things the villager card offers, in
   * words, next to the row you clicked rather than in a box docked somewhere else. One
   * selected thread, one action row — there is no second piece of state saying which row is
   * open, and deselecting (the card's ✕, or Escape) is what closes it.
   *
   * A column whose only child is the button row, so the recap line can be added underneath
   * without moving anything: the row above it stays `.thread`'s immediate sibling, which is
   * what the scroll-into-view in `_threadRow` measures against.
   */
  _threadActs(t) {
    const wrap = document.createElement('div')
    wrap.className = 'thread-acts'
    wrap.dataset.id = t.id
    const acts = document.createElement('div')
    acts.className = 'acts'

    const add = (act, icon, label, title, disabled = false) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'act'
      b.dataset.act = act
      b.innerHTML = `${icon} ${escapeHtml(label)}`
      b.title = title
      b.disabled = disabled
      acts.appendChild(b)
      return b
    }

    // The same words the card's button wears, from the same helper, so the two surfaces can
    // never describe one click differently: the Resume opens preference decides where it goes,
    // and only a thread with nowhere to go at all is disabled.
    const choice = resumeChoice(this.settings.get('resumeOpens'))
    const resume = resumeLabel(choice, t)
    add('resume', ICON[resume.icon], resume.text, resume.title, resumeDisabled(choice, t))
    // Governed by whether there is an id and by nothing else — never by a Resume preference.
    // Offered whenever there is a command to copy — a Codex thread reports one and no bare id.
    const command = t.resume || t.sessionId
    if (command) add('copy-resume', ICON.copy, 'Copy resume command', `Copy “${command}”`)
    // Only offered when there is something to dismiss, exactly as on the card.
    if (t.asking) add('viewed', ICON.eye, 'Viewed', 'Stop this thread asking for you until it moves on again')
    const archived = t.state === 'archived'
    add(
      'archive',
      ICON.archive,
      archived ? 'Unarchive' : 'Archive',
      archived ? 'Put this thread back on the map' : this.theme.manifest.copy.archiveHint
    ).classList.toggle('undo', archived)

    acts.addEventListener('click', (e) => {
      const b = e.target.closest?.('.act')
      if (!b || b.disabled) return
      // No `stopPropagation` here: `.thread-acts` is the row's *sibling*, not a child, and no
      // ancestor of it listens for a click — so there is nothing above this to stop.
      if (b.dataset.act === 'resume') this.actions.resumeThread?.(t.id)
      else if (b.dataset.act === 'copy-resume') this.actions.copyResumeCommand?.(t.id)
      else if (b.dataset.act === 'viewed') this.actions.markViewed?.(t.id)
      else if (b.dataset.act === 'archive') {
        if (archived) this.actions.unarchiveThread?.(t.id)
        else this.actions.archiveThreadById?.(t.id)
      }
    })

    wrap.appendChild(acts)
    // The recap sits under the buttons as the column's second child — a sibling of `.acts`,
    // not a child of it — and is filled from whatever this HUD is already holding, because a
    // poll rebuilds these rows and must not drop the two lines on the floor.
    const recap = document.createElement('div')
    recap.className = 'recap'
    recap.hidden = true
    recap.innerHTML =
      '<div class="line first" hidden><span class="k">Asked</span><span class="v"></span></div>' +
      '<div class="line last" hidden><span class="k">Last</span><span class="v"></span></div>'
    wrap.appendChild(recap)
    this._fillRecap(recap, this._recapFor(t.id))
    return wrap
  }

  /** Inactive and Archived: collapsed by default, because history is not what you came for. */
  _threadGroup(id, label, rows, project, wasOpen, list) {
    const el = document.createElement('details')
    el.className = 'thread-group'
    el.dataset.group = id
    // A selected thread inside a collapsed group is an action row nobody can see, and a row
    // the browser is not laying out — which is also a scroll-into-view that lands at the top.
    el.open = Boolean(wasOpen[id]) || rows.some((t) => t.id === project.selectedId)
    const summary = document.createElement('summary')
    summary.innerHTML = `<span>${label}</span><span class="count">${rows.length}</span>`
    if (id === 'inactive') {
      const all = document.createElement('button')
      all.type = 'button'
      all.className = 'mini wide'
      all.textContent = 'Archive all'
      all.title = `Archive every inactive thread in ${project.name}`
      // Inside a summary, so it has to say it is a button and not a disclosure triangle.
      all.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.actions.archiveAllInactive?.(project.name)
      })
      summary.appendChild(all)
    }
    el.appendChild(summary)
    const body = document.createElement('div')
    body.className = 'rows'
    for (const t of rows) {
      body.appendChild(this._threadRow(t, project, list, id))
      if (t.id === project.selectedId) body.appendChild(this._threadActs(t))
    }
    el.appendChild(body)
    return el
  }

  /**
   * The selected thread, shown inside the zone sidebar rather than in a panel of its own —
   * one thread and its repo are the same context, and splitting them across the screen made
   * you look in two places to act on one astronaut.
   *
   * `helper` is a subagent standing on the plot rather than a thread of its own. It gets the
   * same card with a different story on it: who it is, what it was asked to do, and whose
   * thread it is helping. Nothing on it acts — there is no subagent to open or archive.
   */
  setSelection(agent, thread, helper = null) {
    const card = this.$('.thread-pop')
    // Only ever one accent button in the panel: whichever action is the immediate one.
    this.$('#btn-new-session').classList.toggle('primary', !thread)
    if (!thread) {
      card.classList.remove('on')
      card.classList.remove('docked')
      card.classList.remove('helper')
      this.selected = null
      return
    }
    // A closed or archived thread has nobody on the map to park the card beside, so it
    // docks against the sidebar instead and drops the face it does not have.
    const docked = !agent
    this.selected = { agent, thread, helper }
    card.classList.toggle('docked', docked)
    card.classList.toggle('helper', Boolean(helper))
    card.classList.add('on')
    // `placeCard` positions with an inline transform, which outranks the docked rule. Wipe
    // it, and forget the last spot so the next astronaut-anchored card is placed afresh.
    if (docked) {
      card.style.transform = ''
      this._cardX = this._cardY = undefined
    }
    // On a phone the card docks above the sheet's peek, so the sheet drops to make room.
    if (this.isPhone()) this.toggleSheet(false)

    this.$('.thread-pop .title').textContent = (helper ? helper.name : thread.title) || 'Untitled thread'
    const tint = agent ? hex(agent.trim.getHex()) : STATE_COLOR[thread.state] || STATE_COLOR.inactive
    const status = agent ? STATUS_LABEL[agent.status] || agent.status : capitalise(thread.state)
    const meta = this.$('.thread-pop .meta')
    const desc = this.$('.thread-pop .desc')
    const bits = []
    if (helper) {
      bits.push(`<span class="tag"><i class="swatch" style="background:${tint}"></i>Helper</span>`)
      if (helper.agentType) bits.push(`<span class="tag">${escapeHtml(helper.agentType)}</span>`)
      if (helper.model) bits.push(`<span class="tag">${escapeHtml(shortModel(helper.model))}</span>`)
      bits.push(`<span>helping ${escapeHtml(thread.title || 'Untitled thread')}</span>`)
    } else {
      bits.push(`<span class="tag"><i class="swatch" style="background:${tint}"></i>${escapeHtml(status)}</span>`)
      // The repo is the panel's own heading now, so the card says what the *thread* is —
      // starting with whose it is, since that decides what Open can do.
      if (thread.harnessName) bits.push(`<span class="tag">${escapeHtml(thread.harnessName)}</span>`)
      if (thread.worktree) bits.push(`<span class="tag">⑂ ${escapeHtml(thread.worktree)}</span>`)
      if (thread.gitBranch) bits.push(`<span class="tag">${escapeHtml(thread.gitBranch)}</span>`)
      if (thread.model) bits.push(`<span class="tag">${escapeHtml(shortModel(thread.model))}</span>`)
      bits.push(`<span>${ago(thread.lastActivityAt)}</span>`)
    }
    meta.innerHTML = bits.join('')
    // What the subagent was actually asked to do — the one thing its name usually does not say.
    const blurb = helper ? String(helper.description || '').slice(0, 240) : ''
    desc.textContent = blurb
    desc.hidden = !blurb

    // A helper has no thread of its own to open, archive or measure, so the card is all it
    // gets: the actions come off rather than greying out, which would read as "not yet".
    const openBtn = this.$('#btn-open')
    const archiveBtn = this.$('#btn-archive')
    openBtn.hidden = Boolean(helper)
    archiveBtn.hidden = Boolean(helper)
    if (helper) {
      this._cardSize = { w: card.offsetWidth, h: card.offsetHeight }
      return
    }

    const pct = Math.round((this.actions.progressFor?.(thread.id) ?? 0) * 100)
    this.$('.thread-pop .progress > i').style.width = `${pct}%`
    this.$('.thread-pop .progress > i').style.background = tint
    // A new selection starts with no recap: the read is in flight, and the last thread's two
    // lines under this thread's title would be a lie for as long as it takes.
    this._fillRecap(this.$('.thread-pop .recap'), this._recapFor(thread.id))
    // Measured once per selection rather than per frame: placing the card beside its
    // astronaut needs its size sixty times a second, and asking the layout for it that
    // often is how a HUD starts costing frames. `setRecap` measures again when the two
    // lines land, because they change the card's height.
    this._cardSize = { w: card.offsetWidth, h: card.offsetHeight }

    this._syncOpenButton()

    const isArchived = thread.state === 'archived'
    archiveBtn.innerHTML = `${ICON.archive} ${isArchived ? 'Unarchive' : 'Archive'}`
    archiveBtn.classList.toggle('undo', isArchived)
    archiveBtn.title = isArchived ? 'Put this thread back on the map (A)' : this.theme.manifest.copy.archiveHint
    // Only offered when there is something to dismiss. A third button on every card would
    // crowd the two that are always worth having, and "Viewed" on a thread that is not asking
    // for anything is a control with no effect.
    this.$('#btn-viewed').hidden = !isAsking(thread)
  }

  /**
   * The recap for the selected thread, once the server has read it.
   *
   * Ignored when the selection has moved on: the fetch is per selection, and a slow read must
   * not land on the next thread's card. Held on `this._recap` so a poll that rebuilds the
   * sidebar rows can put the same two lines back under the action row without asking again.
   */
  setRecap(id, recap) {
    this._recap = { id, first: recap?.first || '', last: recap?.last || '' }
    if (this.selected?.thread?.id === id) {
      this._fillRecap(this.$('.thread-pop .recap'), this._recap)
      // The card is measured once per selection, because placing it beside its villager needs
      // its size every frame — and the recap arrives after that measurement and changes its
      // height. Without this the card sits a few pixels wrong until the next selection.
      const card = this.$('.thread-pop')
      this._cardSize = { w: card.offsetWidth, h: card.offsetHeight }
    }
    this._fillRecap(this.$('.side .thread-acts .recap'), this._recapFor(id))
  }

  /** The recap this HUD is holding for a thread, or nothing. */
  _recapFor(id) {
    return this._recap && this._recap.id === id ? this._recap : null
  }

  /** One recap block, wherever it is. Hidden when there is nothing to say — a Cursor thread. */
  _fillRecap(el, recap) {
    if (!el) return
    const first = recap?.first || ''
    const last = recap?.last || ''
    el.hidden = !first && !last
    for (const [key, text] of [
      ['first', first],
      ['last', last],
    ]) {
      const line = el.querySelector(`.line.${key}`)
      if (!line) continue
      line.hidden = !text
      const v = line.querySelector('.v')
      v.textContent = text
      v.title = text
    }
  }

  /**
   * The card's Open/Resume button. Its word comes from the preference rather than from the
   * thread, because the preference is what decides where the click goes — and it is re-run on
   * every settings change, so a card left up while the pull-down moves does not keep promising
   * the old thing.
   */
  _syncOpenButton() {
    const thread = this.selected?.thread
    const btn = this.$('#btn-open')
    if (!thread || this.selected.helper) return
    const choice = resumeChoice(this.settings.get('resumeOpens'))
    const { text, icon, title } = resumeLabel(choice, thread)
    btn.innerHTML = `${ICON[icon]} ${text}`
    btn.title = `${title} (Enter)`
    btn.disabled = resumeDisabled(choice, thread)
  }

  /**
   * Put the thread card beside its own astronaut, in screen space, every frame.
   *
   * `screen` is where the astronaut is right now, in CSS pixels, or null when it is behind
   * the camera. The card prefers the astronaut's right, flips to its left rather than slide
   * under the sidebar, and never leaves the window — so it stays reachable at any zoom
   * without ever covering the thing it is describing.
   */
  placeCard(screen) {
    const el = this.$('.thread-pop')
    // A docked card is placed by CSS against the sidebar and has nothing to follow.
    if (el.classList.contains('docked')) return
    if (!screen || !this.selected) {
      if (this._cardOn) {
        this._cardOn = false
        el.classList.remove('on')
      }
      return
    }
    // On a phone the card is docked above the sheet by the stylesheet; nothing to place.
    if (this.isPhone()) {
      if (!this._cardOn) {
        this._cardOn = true
        el.classList.add('on')
      }
      return
    }
    const size = this._cardSize || { w: 280, h: 150 }
    const margin = 12
    const gap = 26
    const rightWall = window.innerWidth - margin - (this._sideWidth || 0)

    let flip = false
    let left = screen.x + gap
    if (left + size.w > rightWall) {
      left = screen.x - gap - size.w
      flip = true
      // Nowhere to go on either side — sit over the middle rather than off the edge.
      if (left < margin) left = Math.min(Math.max(margin, screen.x - size.w / 2), rightWall - size.w)
    }
    const top = Math.min(Math.max(margin, screen.y - size.h / 2), window.innerHeight - margin - size.h)

    if (!this._cardOn) {
      this._cardOn = true
      el.classList.add('on')
    }
    // Whole pixels, and only when it actually moved: a transform written every frame with a
    // fractional delta is a repaint the compositor cannot skip.
    const x = Math.round(left)
    const y = Math.round(top)
    if (x !== this._cardX || y !== this._cardY) {
      this._cardX = x
      this._cardY = y
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
    // The nib points back at the astronaut, so it changes sides with the card.
    if (flip !== this._cardFlip) {
      this._cardFlip = flip
      el.classList.toggle('flip', flip)
    }
    // And it tracks the astronaut vertically when the card has been pushed off-centre.
    const nib = Math.min(Math.max(14, screen.y - y), size.h - 14)
    if (nib !== this._cardNib) {
      this._cardNib = nib
      el.style.setProperty('--nib-y', `${Math.round(nib)}px`)
    }
  }

  /** Share one measured safe area between camera framing, cards, and the legend. */
  _syncLayout() {
    const width = this.el.clientWidth
    const height = this.el.clientHeight
    const side = this.$('.side')
    let right = 0
    let bottom = 0
    if (this.visible) {
      if (this.isPhone()) {
        // Use the sheet's destination, not an intermediate animation transform.
        const peek = parseFloat(getComputedStyle(this.el).getPropertyValue('--peek')) || 0
        const top = side.offsetTop + (side.classList.contains('open') ? 0 : side.offsetHeight - peek)
        bottom = Math.max(0, height - top)
      } else {
        // On a desktop the sidebar steps aside for Settings by its own width (a transform, which
        // offsetLeft ignores), so while it is shifted that much more of the right edge is covered.
        const stepped = side.classList.contains('shifted') && !window.matchMedia('(max-width: 820px)').matches
        right = Math.max(0, width - side.offsetLeft + (stepped ? side.offsetWidth : 0))
      }
    }
    this._sideWidth = right
    this.el.style.setProperty('--side', `${right}px`)
    this.actions.viewportChanged?.({ width, height, right, bottom })
  }

  /** Redraw the card's face so it blinks in step with the astronaut it belongs to. */
  updateAvatar(faceAtlasCanvas, faces) {
    if (!this.selected?.agent || !faceAtlasCanvas || !faces) return
    const agent = this.selected.agent
    const frame = agent.faceFrame ?? faces.FACE.idle
    const color = agent.eye
    const css = cssFromGlow(color)
    if (this._avatarState.frame === frame && this._avatarState.color === css) return
    this._avatarState = { frame, color: css }

    const size = 108
    const cell = faceAtlasCanvas.width / faces.cols
    const sx = (frame % faces.cols) * cell
    const sy = Math.floor(frame / faces.cols) * (faceAtlasCanvas.height / faces.rows)

    // The atlas is an opaque white-on-black mask, so the tint is a `multiply`, not a
    // `source-in`: black stays black and the white features take the eye colour. Keying on
    // alpha instead would flood the whole cell, because every pixel in it is opaque.
    const t = this.avatarTmpCtx
    t.globalCompositeOperation = 'source-over'
    t.clearRect(0, 0, size, size)
    t.drawImage(faceAtlasCanvas, sx, sy, cell, cell, 0, 0, size, size)
    t.globalCompositeOperation = 'multiply'
    t.fillStyle = css
    t.fillRect(0, 0, size, size)
    t.globalCompositeOperation = 'source-over'

    const c = this.avatarCtx
    c.fillStyle = '#06070c'
    c.fillRect(0, 0, size, size)
    c.drawImage(this.avatarTmp, 0, 0)
    // Scanlines, so the card's face reads as the same little screen as the one in the world.
    c.globalAlpha = 0.2
    c.fillStyle = '#000'
    for (let y = 0; y < size; y += 3) c.fillRect(0, y, size, 1)
    c.globalAlpha = 1
  }

  setFps(perf, viewport, extra) {
    if (!this.settings.get('showFps')) return
    const el = this.$('.fps')
    const fps = Math.round(perf.fps)
    if (this._last.fps === fps && this._last.calls === perf.drawCalls) return
    this._last.fps = fps
    this._last.calls = perf.drawCalls
    el.innerHTML =
      `<b>${fps}</b> fps · ${perf.frameMs.toFixed(1)} ms<br>` +
      `${perf.drawCalls} draws · ${(perf.triangles / 1000).toFixed(0)}k tris<br>` +
      // The setting is a share of the display, so the readout is too — otherwise a retina
      // machine sitting exactly on the 100% slider reads back "200%".
      `${viewport.bw}×${viewport.bh} (${Math.round((viewport.scale / (window.devicePixelRatio || 1)) * 100)}%)` +
      (extra ? `<br>${extra}` : '')
  }

  hint(text, ms = 3200) {
    const el = this.$('.hint-pill')
    el.textContent = text
    el.classList.add('on')
    clearTimeout(this._hintTimer)
    this._hintTimer = setTimeout(() => el.classList.remove('on'), ms)
  }

  toast(message, kind = '', title = '') {
    const el = document.createElement('div')
    el.className = `toast panel ${kind}`
    el.textContent = message
    if (title) el.title = title
    this.$('.toasts').appendChild(el)
    setTimeout(() => {
      el.classList.add('leaving')
      setTimeout(() => el.remove(), 260)
    }, 3600)
  }

  // ── visibility ──────────────────────────────────────────────────────────────────────

  /** Reflect orbit mode on the rail button. */
  setOrbit(on) {
    this.$('#btn-orbit').setAttribute('aria-pressed', String(Boolean(on)))
  }

  /** Whether the layout is the phone one: the sheet, the docked card, the top rail. */
  isPhone() {
    return window.matchMedia('(max-width: 600px)').matches
  }

  /** Pull the sidebar sheet up over the colony, or let it drop to its peek. Phone only. */
  toggleSheet(force) {
    const side = this.$('.side')
    const open = force ?? !side.classList.contains('open')
    side.classList.toggle('open', open)
    this._syncLayout()
    return open
  }

  toggleSettings(force) {
    const panel = this.$('.settings')
    const open = force ?? panel.classList.contains('closed')
    panel.classList.toggle('closed', !open)
    this.$('#btn-settings').setAttribute('aria-pressed', String(open))
    // On a desktop the two share the right edge and the sidebar steps aside, so both stay in
    // view (this fork's behaviour; upstream now covers the sidebar). On a phone there is no
    // room beside it: settings takes the sidebar's place, including for keyboard users.
    const side = this.$('.side')
    const phone = this.isPhone()
    side.classList.toggle('shifted', open && !phone)
    side.classList.toggle('covered', open && phone)
    side.inert = open && phone
    panel.inert = !open
    if (open) this.$('#btn-close-settings').focus({ preventScroll: true })
    else if (panel.contains(document.activeElement)) this.$('#btn-settings').focus({ preventScroll: true })
    this._syncLayout()
  }

  toggleHelp(force) {
    const el = this.$('.help')
    const open = force ?? !el.classList.contains('open')
    el.classList.toggle('open', open)
  }

  /**
   * Dismiss everything. This is the mode the game is really meant to be left in — the
   * colony carries its own state above the astronauts' heads, so the panels are for
   * setting things up, not for playing.
   */
  toggleUi(force) {
    this.visible = force ?? !this.visible
    this.el.classList.toggle('hidden', !this.visible)
    this.$('#btn-hide').innerHTML = this.visible ? ICON.eye : ICON.eyeOff
    this.actions.uiVisibility?.(this.visible)
    this._syncLayout()
    if (!this.visible) this.toggleHelp(false)
    return this.visible
  }

  removeBoot() {
    const boot = document.querySelector('.boot')
    if (!boot) return
    boot.classList.add('gone')
    setTimeout(() => boot.remove(), 550)
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────

/**
 * A settings group: a section that folds, remembered per browser the way the repo list's View
 * section is — panel furniture, not a setting. `open` is how it starts in a browser that has
 * never folded or opened it; after that the browser's own choice wins.
 */
function foldGroup(title, id, open) {
  const el = document.createElement('details')
  el.className = 'group hidden-list fold'
  el.dataset.fold = id
  const summary = document.createElement('summary')
  summary.textContent = title
  el.appendChild(summary)
  const key = `${FOLD_KEY}.${id}`
  el.open = open
  try {
    const saved = localStorage.getItem(key)
    if (saved !== null) el.open = saved === '1'
  } catch {
    /* private mode — it starts as the layout says */
  }
  // Setting `open` above queues a `toggle` of its own, which lands after this listener is on.
  // Only a change from the state it was built in is a choice worth remembering; storing the
  // build's own state would pin today's first-time default into the browser for good.
  let shown = el.open
  el.addEventListener('toggle', () => {
    if (el.open === shown) return
    shown = el.open
    try {
      localStorage.setItem(key, el.open ? '1' : '0')
    } catch {
      /* nothing to remember it with */
    }
  })
  return el
}

/** A row of chips over one choice. `key`, when given, names the setting they write, as a row's does. */
function chips(items, current, onPick, registry, key) {
  const wrap = document.createElement('div')
  wrap.className = 'chips'
  if (key) wrap.dataset.key = key
  const buttons = []
  for (const item of items) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'chip'
    b.textContent = item.label
    if (item.title) b.title = item.title
    b.addEventListener('click', () => onPick(item.id))
    wrap.appendChild(b)
    buttons.push([item.id, b])
  }
  registry.push({
    el: wrap,
    sync: () => {
      const now = current()
      for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === now))
    },
  })
  return wrap
}

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6)
/**
 * Whole days quiet, as the row prints them — the signature has to round the same way. A repo
 * whose threads carry no timestamp arrives with an infinite age: say "?" rather than print it.
 */
const quietDays = (age) => (Number.isFinite(age) ? Math.floor(age / 86400000) : '?')
/** The row's wording: a repo with no timestamp at all is simply quiet, not "?d quiet". */
const quietLabel = (age) => (Number.isFinite(age) ? `${quietDays(age)}d quiet` : 'quiet')
/**
 * Eye colours are authored above 1.0 so the bloom pass catches them in the scene. For the
 * card they are normalised by the brightest channel — which keeps the hue the astronaut
 * actually has rather than clipping a 3.0-red down to the same white as a 3.0-blue.
 */
function cssFromGlow(color) {
  const peak = Math.max(color.r, color.g, color.b, 1)
  const enc = (v) => Math.round(Math.pow(Math.min(1, v / peak), 1 / 2.2) * 255)
  return `rgb(${enc(color.r)},${enc(color.g)},${enc(color.b)})`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/** The dot colours, for the one place that needs them in JS rather than in CSS. */
const STATE_COLOR = { active: '#7fd39a', idle: '#f0b35c', inactive: '#7c7b86', archived: '#55545e' }

const capitalise = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : '')

/** Status → the colour family the top-bar counters already use for it. */
function statusClass(status) {
  if (status === 'working') return 'working'
  if (status === 'waiting') return 'waiting'
  if (status === 'blocked') return 'blocked'
  if (status === 'celebrating') return 'done'
  return 'idle'
}

/**
 * A path that fits, trimmed from the *left* so the repo end survives — the deep end is the
 * part that identifies it. CSS can only ellipsise the tail, and `direction: rtl` mangles a
 * leading `~`, so the trim is done here and the whole path lives in the title attribute.
 */
function shortPath(dir, max = 30) {
  const home = dir.replace(/^\/Users\/[^/]+/, '~')
  if (home.length <= max) return home
  const parts = home.split('/')
  let out = parts.pop() || ''
  while (parts.length) {
    const next = parts.pop()
    if (out.length + next.length + 3 > max) break
    out = `${next}/${out}`
  }
  return `…/${out}`
}

function shortModel(model) {
  return String(model).replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

function clockLabel(t) {
  const total = t * 24 * 60
  const h = Math.floor(total / 60) % 24
  const m = Math.floor(total % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function nearestTime(value) {
  let best = TIMES[0]
  let bestD = Infinity
  for (const t of TIMES) {
    // Wrap-aware, so 0.99 is nearest to dawn rather than to noon.
    const d = Math.min(Math.abs(t.value - value), 1 - Math.abs(t.value - value))
    if (d < bestD) {
      bestD = d
      best = t
    }
  }
  return bestD < 0.03 ? best.id : null
}

function ago(ts) {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const TEMPLATE = `
<aside class="side panel">
  <div class="grab"></div>
  <header class="brandbar">
    <div class="brand"><i class="dot"></i>Taskshire</div>
    <button class="btn icon ghost" id="btn-shot" title="Screenshot (P)">${ICON.camera}</button>
    <button class="btn icon ghost" id="btn-help" title="Help (?)">${ICON.help}</button>
    <button class="btn icon ghost" id="btn-hide" title="Hide all UI (H)">${ICON.eye}</button>
    <button class="btn icon ghost" id="btn-settings" title="Settings (S)" aria-pressed="false">${ICON.settings}</button>
  </header>

  <div class="stats"></div>

  <div class="side-body">
    <div class="projects-pane">
      <div class="sec-head"><span class="lbl">Repos</span><span class="n"></span></div>
      <!-- How the list is being looked at, above the list rather than inside it: a filter you
           scrolled past is a filter you forget you set, and setLegend takes the first
           .repo-group inside .projects as its insertion anchor. (No backticks in here — this
           whole block is a template literal.) Never folds (owner, 2026-10-01): which states
           are counted is always worth seeing. -->
      <div class="repo-group repo-view" data-group="view">
        <div class="repo-view-head"><span>View</span>
          <button type="button" class="mini wide" id="btn-compact" title="Pack every zone toward the middle">Compact</button>
        </div>
        <div class="chips"></div>
        <input type="search" class="repo-search" placeholder="Filter repos"
               aria-label="Filter repos by name" autocomplete="off" spellcheck="false">
      </div>
      <!-- The groups are markup rather than elements the setters create, which is what keeps
           them open across a re-render: only their rows are ever rewritten. -->
      <div class="projects">
        <div class="repo-empty" hidden></div>
        <details class="repo-group" data-group="hidden" hidden>
          <summary><span>Hidden</span>
            <button type="button" class="mini wide clear" data-clear="hidden"
                    title="Clear this list — the hide is lifted and the repos stop showing anywhere. Any that still have threads come straight back on the map.">Clear all</button>
            <span class="count">0</span>
          </summary>
          <div class="rows"></div>
        </details>
        <details class="repo-group" data-group="archive" hidden>
          <summary><span>Archive</span><span class="count">0</span></summary>
          <div class="rows"></div>
        </details>
        <details class="repo-group" data-group="gone" hidden>
          <summary><span>Gone</span>
            <button type="button" class="mini wide clear" data-clear="gone"
                    title="Clear this list — the repos stop showing anywhere. Each comes back on its own if a thread opens in it again.">Clear all</button>
            <span class="count">0</span>
          </summary>
          <div class="rows"></div>
        </details>
      </div>
    </div>

    <div class="project-detail">
      <button class="btn ghost back" id="btn-close-project" title="Back to every repo (Esc)">${ICON.back} All repos</button>
      <div class="who">
        <i class="swatch"></i>
        <div class="text">
          <div class="name"></div>
          <div class="path"></div>
        </div>
        <button class="btn icon ghost" id="btn-locate" title="Fly to this zone">${ICON.locate}</button>
      </div>
      <div class="project-actions">
        <button class="btn primary" id="btn-new-session" title="Start a new thread in this folder (C)">${ICON.plus} New conversation</button>
        <div class="pair">
          <button class="btn" id="btn-reveal" title="Show this folder in ${FILE_MANAGER}">${ICON.folder} ${FILE_MANAGER}</button>
          <button class="btn" id="btn-copy-path" title="Copy the folder path">${ICON.copy} Copy path</button>
        </div>
        <div class="pair">
          <button class="btn" id="btn-pin-repo" aria-pressed="false">${ICON.pin} Pin</button>
          <button class="btn" id="btn-hide-repo" aria-pressed="false">${ICON.eyeOff} Hide</button>
        </div>
      </div>
      <div class="threads-head"></div>
      <div class="threads"></div>
    </div>
  </div>
</aside>

<div class="rail panel">
  <button class="btn icon" id="btn-home" title="Reset the view (0)">${ICON.home}</button>
  <button class="btn icon" id="btn-next" title="Next astronaut waiting on you (N)">${ICON.next}</button>
  <div class="sep"></div>
  <button class="btn icon" id="btn-orbit" title="Orbit mode — sweep around the colony (O)" aria-pressed="false">${ICON.orbit}</button>
  <button class="btn icon" id="btn-setting" title="Change setting (Tab)">${ICON.globe}</button>
  <button class="btn icon" id="btn-time" title="Change the time of day (L)">${ICON.sun}</button>
  <div class="sep" data-feature="sound"></div>
  <button class="btn icon" data-feature="sound" id="btn-sound" title="Mute (M)" aria-pressed="true">${ICON.sound}</button>
</div>

<div class="settings panel closed" inert>
  <header>Settings <button class="btn icon ghost" id="btn-close-settings" title="Close">${ICON.close}</button></header>
  <div class="body"></div>
</div>

<div class="thread-pop panel">
  <i class="nib"></i>
  <div class="top">
    <div class="avatar"><canvas></canvas></div>
    <div class="info">
      <div class="title"></div>
      <div class="meta"></div>
      <div class="desc" hidden></div>
    </div>
    <button class="btn icon ghost" id="btn-follow" title="Follow the selected astronaut" aria-label="Follow the selected one" aria-pressed="false">${ICON.locate}</button>
    <button class="btn icon ghost" id="btn-deselect" title="Deselect (Esc)">${ICON.close}</button>
  </div>
  <div class="recap" hidden>
    <div class="line first" hidden><span class="k">Asked</span><span class="v"></span></div>
    <div class="line last" hidden><span class="k">Last</span><span class="v"></span></div>
  </div>
  <div class="progress"><i></i></div>
  <div class="pair">
    <button class="btn primary" id="btn-open" title="Open this thread in the harness it came from (Enter)">${ICON.open} Open</button>
    <button class="btn" id="btn-viewed" title="Stop this thread asking for you until it moves on again (V)">${ICON.eye} Viewed</button>
    <button class="btn" id="btn-archive" title="Archive — this astronaut walks back to the ship (A)">${ICON.archive} Archive</button>
  </div>
</div>

<div class="toasts"></div>
<div class="fps panel"></div>
<div class="hint-pill panel"></div>

<div class="help">
  <div class="sheet panel">
    <h2>Taskshire</h2>
    <p class="sub">Every coding-agent thread on this machine is an astronaut. They walk out of the ship, claim a plot for their repo, and build. Click one to open its thread; click a zone — its deck or its name — for the repo itself, and start a new conversation there. Navigation works like Google Earth — drag the ground itself, right-drag to tilt, scroll to zoom in on whatever is under the cursor.</p>
    <div class="cols">
      <div>
        <div class="k"><span>Drag the ground</span><kbd>drag</kbd></div>
        <div class="k"><span>Tilt &amp; rotate</span><kbd>right-drag</kbd></div>
        <div class="k"><span>&nbsp;</span><kbd>⌃ or ⇧ + drag</kbd></div>
        <div class="k"><span>Zoom to cursor</span><kbd>scroll</kbd></div>
        <div class="k"><span>Move / zoom</span><kbd>arrows</kbd> <kbd>+ −</kbd></div>
        <div class="k"><span>Reset view</span><kbd>0</kbd></div>
        <div class="k"><span>Hide all UI</span><kbd>H</kbd> <kbd>${IS_MAC ? '⌘' : 'Ctrl'}\\</kbd></div>
        <div class="k"><span>Settings</span><kbd>S</kbd></div>
        <div class="k"><span>Screenshot</span><kbd>P</kbd></div>
      </div>
      <div>
        <div class="k"><span>Next needing you</span><kbd>N</kbd></div>
        <div class="k"><span>Open thread</span><kbd>Enter</kbd></div>
        <div class="k"><span>Mark viewed</span><kbd>V</kbd></div>
        <div class="k"><span>Archive</span><kbd>A</kbd></div>
        <div class="k"><span>New conversation</span><kbd>C</kbd></div>
        <div class="k"><span>Orbit mode</span><kbd>O</kbd></div>
        <div class="k"><span>Change setting</span><kbd>Tab</kbd></div>
        <div class="k"><span>Time of day</span><kbd>L</kbd></div>
        <div class="k" data-feature="sound"><span>Mute</span><kbd>M</kbd></div>
        <div class="k"><span>Deselect</span><kbd>Esc</kbd></div>
        <div class="k"><span>This sheet</span><kbd>?</kbd></div>
      </div>
    </div>
    <p class="sub" style="margin-top:14px">Inactive threads: Resume copies the <code>claude --resume</code> command.</p>
    <div style="margin-top:16px">
      <div class="legend-row"><i class="badge" style="background:#1a2b46;color:#8fb4ee">?</i> waiting on your reply — click to open the thread</div>
      <div class="legend-row"><i class="badge" style="background:#3d1c1c;color:#e88b8b">!</i> the session hit an error</div>
      <div class="legend-row"><i class="badge" style="background:#16301f;color:#7fd39a">⚒</i> running right now, building</div>
      <div class="legend-row"><i class="badge" style="background:#332b12;color:#e6c67f">✓</i> its pull request landed</div>
      <div class="legend-row"><i class="badge" style="background:#1d1f2e;color:#a9a8c0">z</i> nothing for three days</div>
    </div>
    <div style="margin-top:18px;display:flex;justify-content:flex-end">
      <button class="btn primary" id="btn-help-close">Got it</button>
    </div>
  </div>
</div>
`
