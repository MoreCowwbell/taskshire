/**
 * The UI-facing slices of the engine the HUD needs, kept apart so the HUD never reaches into
 * it — and so the parts of the HUD that are pure decisions can be tested under Node, which
 * cannot import `hud.js` at all (it reads `navigator.platform` at module scope).
 */
export { PRESETS } from '../core/settings.js'

/**
 * Does this repo's name match what is in the repo list's filter box?
 *
 * Case-insensitive substring, query trimmed, and an empty query matches everything. A
 * substring rather than a pattern: a repo called `bot-crossing` must be findable by typing
 * `-cross`, and nobody types a regex into a sidebar.
 */
export function matchesRepoFilter(name, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
  if (!q) return true
  return String(name ?? '')
    .toLowerCase()
    .includes(q)
}

/**
 * The rows of the repo list's Archive section: every archived thread, whatever repo it is in,
 * most recently archived first.
 *
 * `threads` are the scan with the page's own archive list already laid over (`asShown`), so a
 * click shows up here before the next poll. `archivedAt` is the page's own stamp; a thread the
 * server archived with no stamp here sorts last and carries `at: null` rather than a made-up
 * time, and falls back on how recently it moved to settle its place among the others.
 */
export function archiveRows(threads, archivedAt = {}) {
  return threads
    .filter((t) => t.state === 'archived')
    .map((t) => ({
      id: t.id,
      title: t.title || 'Untitled thread',
      project: t.project || 'unknown',
      at: Number(archivedAt?.[t.id]) || null,
      lastActivityAt: t.lastActivityAt || 0,
    }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || b.lastActivityAt - a.lastActivityAt)
}

/**
 * What the Resume button says, given the preference and the thread.
 *
 * Both surfaces — the villager card and the sidebar action row — read this, so the two can
 * never drift into describing the same click differently. `icon` names one of the HUD's icons
 * rather than carrying markup, because the two call sites reach for `ICON` themselves.
 */
export function resumeLabel(choice, thread) {
  if (choice === 'copy') {
    return { text: 'Resume', icon: 'copy', title: 'Copy the command that resumes this thread' }
  }
  if (choice === 'app') {
    return thread.canOpen
      ? { text: 'Open', icon: 'open', title: 'Open this thread in the harness it came from' }
      : { text: 'Resume', icon: 'copy', title: 'No app record for this thread — copies the command instead' }
  }
  return { text: 'Resume', icon: 'open', title: 'Raise the editor window that has this repo open' }
}

/**
 * A thread with nowhere to go — no app record and no command, which today means a Cursor
 * thread. Never under the editor choice: a window can be raised on a folder whatever harness
 * the thread came from.
 */
export const resumeDisabled = (choice, thread) => choice !== 'ide' && !thread.canOpen && !thread.resume

/**
 * The Settings panel, in order: nine groups, each `{ id, title, open, rows }`. `open` is how the
 * group starts in a browser that has never folded or opened it; after that the browser's own
 * choice wins. `rows` are setting keys, in the order the panel shows them. A row that exists
 * only where the theme can use it names its gate: `feature`, a shared feature
 * (`src/core/features.js`), or `only`, `'seasons'` (a kit with seasonal sheets) or `'glazed'`
 * (decks that take the zone tint). Repos also folds its Zone size rows inside itself.
 *
 * The HUD builds the panel from this list and nothing else, so what a theme shows can be
 * checked here, under Node, rather than read off the page.
 */
export const SETTINGS_GROUPS = Object.freeze([
  { id: 'world', title: 'World', open: true, rows: ['theme', 'setting', { key: 'season', only: 'seasons' }] },
  { id: 'time', title: 'Time', open: true, rows: ['clockTime', 'timeOfDay', 'autoTime', 'dayLength'] },
  {
    id: 'repos',
    title: 'Repos',
    open: false,
    rows: ['activeOnly', 'fadeGhosts', 'fadeDays', 'hideDays'],
    zoneSize: ['threadsPerTile', 'countActive', 'countIdle', 'countInactive', 'countArchived'],
  },
  { id: 'threads', title: 'Threads', open: false, rows: ['resumeOpens'] },
  {
    id: 'look',
    title: 'Look',
    open: false,
    rows: [
      'exposure',
      'bloom',
      'bloomStrength',
      'ibl',
      'iblIntensity',
      'tiltShift',
      'tiltShiftStrength',
      'tiltShiftAngle',
      'fov',
      'showLabels',
      { key: 'deckGlaze', only: 'glazed' },
    ],
  },
  {
    id: 'atmosphere',
    title: 'Atmosphere',
    open: false,
    rows: [
      { key: 'worldCurve', feature: 'curve' },
      { key: 'ambientOcclusion', feature: 'occlusion' },
      { key: 'colorGrade', feature: 'grade' },
      { key: 'saturation', feature: 'grade' },
      { key: 'vignette', feature: 'grade' },
      { key: 'clouds', feature: 'clouds' },
      { key: 'fauna', feature: 'fauna' },
    ],
  },
  {
    id: 'sound',
    title: 'Sound',
    open: false,
    rows: [
      { key: 'sound', feature: 'sound' },
      { key: 'masterVolume', feature: 'sound' },
      { key: 'ambienceVolume', feature: 'sound' },
      { key: 'effectsVolume', feature: 'sound' },
    ],
  },
  { id: 'view', title: 'View', open: false, rows: ['followSelected', 'autoFrame', 'reducedMotion', 'showFps'] },
  {
    id: 'quality',
    title: 'Quality',
    open: false,
    rows: [
      'preset',
      'renderScale',
      'autoQuality',
      'antialias',
      'shadows',
      'textureQuality',
      'groundDetail',
      'particles',
      'scatterDensity',
      'stars',
      'maxAgents',
    ],
  },
])

/** Rows one theme has and the other does not: the village's seasons and its zone tint. */
export const THEME_ONLY_ROWS = Object.freeze(['season', 'deckGlaze'])
/** Settings with no row by design: one-time bookkeeping, never a choice. */
export const ROWLESS_KEYS = Object.freeze(['worldsShared', 'followDefaultOn'])

/**
 * What the panel's gates read, from the theme alone: its features, whether a kit ships seasonal
 * sheets, and whether its decks take the glaze (the same `surfaces()` call `main.js` makes).
 */
export function panelContext(theme) {
  return {
    features: theme.features,
    seasons: Object.values(theme.manifest.kits || {}).some((k) => k.atlases),
    glazed: theme.hooks.surfaces(theme.manifest).deckTint === 'glaze',
  }
}

/**
 * `SETTINGS_GROUPS` as this theme shows it: every row key whose gate fails dropped, and a group
 * left with nothing dropped too. An unknown feature or `only` name throws rather than hiding a
 * row.
 */
export function settingsLayout(ctx) {
  const passes = (row) => {
    if (typeof row === 'string') return true
    if (row.feature) {
      if (!(row.feature in ctx.features)) throw new Error(`unknown feature "${row.feature}"`)
      return Boolean(ctx.features[row.feature])
    }
    if (!(row.only in ctx)) throw new Error(`unknown row gate "${row.only}"`)
    return Boolean(ctx[row.only])
  }
  const keys = (rows) => rows.filter(passes).map((row) => (typeof row === 'string' ? row : row.key))
  return SETTINGS_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    open: g.open,
    rows: keys(g.rows),
    ...(g.zoneSize ? { zoneSize: keys(g.zoneSize) } : {}),
  })).filter((g) => g.rows.length || g.zoneSize?.length)
}
