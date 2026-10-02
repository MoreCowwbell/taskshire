import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SETTINGS_GROUPS, THEME_ONLY_ROWS, ROWLESS_KEYS, panelContext, settingsLayout } from '../src/ui/hud-data.js'
import { SETTING_KEYS } from '../src/core/settings.js'
import { SHARED_FEATURES, THEME_FEATURES, FEATURE_NAMES } from '../src/core/features.js'
import { loadTheme } from '../src/themes/registry.js'

const loaders = {
  space: () => import('../src/themes/space/index.js'),
  medieval: () => import('../src/themes/medieval/index.js'),
}
const theme = (id) => loadTheme(loaders, id, { baseUrl: '/', validate: () => [] })

/** Every key a layout shows, Zone size's with Repos'. */
const keysOf = (layout) => layout.flatMap((g) => [...g.rows, ...(g.zoneSize || [])])
/** The layout with every gate passing: what the panel would be in a theme that had everything. */
const ungated = () =>
  settingsLayout({ features: Object.fromEntries(FEATURE_NAMES.map((n) => [n, true])), seasons: true, glazed: true })

test('the panel has the nine groups in order, World and Time open the first time', () => {
  assert.deepEqual(
    SETTINGS_GROUPS.map((g) => g.id),
    ['world', 'time', 'repos', 'threads', 'look', 'atmosphere', 'sound', 'view', 'quality']
  )
  assert.deepEqual(
    SETTINGS_GROUPS.filter((g) => g.open).map((g) => g.id),
    ['world', 'time']
  )
})

test('parity: the two themes show the same rows apart from the village’s theme-only ones', async () => {
  const space = new Set(keysOf(settingsLayout(panelContext(await theme('space')))))
  const village = new Set(keysOf(settingsLayout(panelContext(await theme('medieval')))))
  assert.deepEqual([...space].filter((k) => !village.has(k)), [])
  assert.deepEqual(
    [...village].filter((k) => !space.has(k)).sort(),
    [...THEME_ONLY_ROWS].sort()
  )
})

test('one row per key: every setting has exactly one row, apart from the bookkeeping flags', async () => {
  const want = SETTING_KEYS.filter((k) => !ROWLESS_KEYS.includes(k)).sort()
  const all = keysOf(ungated())
  assert.deepEqual([...all].sort(), want)
  for (const id of ['space', 'medieval']) {
    const shown = keysOf(settingsLayout(panelContext(await theme(id))))
    assert.equal(new Set(shown).size, shown.length, `${id}: a key shown twice`)
    const other = id === 'space' ? THEME_ONLY_ROWS : []
    assert.deepEqual(
      [...shown].sort(),
      want.filter((k) => !other.includes(k)),
      id
    )
  }
})

test('every feature gate names a shared feature, never a theme one', () => {
  const gates = SETTINGS_GROUPS.flatMap((g) => [...g.rows, ...(g.zoneSize || [])]).filter((r) => r.feature)
  assert.ok(gates.length > 0)
  for (const r of gates) {
    assert.ok(SHARED_FEATURES.includes(r.feature), `${r.key}: ${r.feature}`)
    assert.ok(!THEME_FEATURES.includes(r.feature), `${r.key}: ${r.feature}`)
  }
})

test('Atmosphere and Sound hold their rows in order; Look ends with Zone tint in the village', async () => {
  const village = settingsLayout(panelContext(await theme('medieval')))
  const rows = (id) => village.find((g) => g.id === id).rows
  assert.deepEqual(rows('atmosphere'), ['worldCurve', 'ambientOcclusion', 'colorGrade', 'saturation', 'vignette', 'clouds', 'fauna'])
  assert.deepEqual(rows('sound'), ['sound', 'masterVolume', 'ambienceVolume', 'effectsVolume'])
  assert.deepEqual(rows('look').slice(-2), ['showLabels', 'deckGlaze'])
})

test('panelContext reads seasons and the glaze from the theme', async () => {
  const pick = ({ seasons, glazed }) => ({ seasons, glazed })
  assert.deepEqual(pick(panelContext(await theme('space'))), { seasons: false, glazed: false })
  assert.deepEqual(pick(panelContext(await theme('medieval'))), { seasons: true, glazed: true })
})

test('a gate on an unknown name throws rather than hiding a row', () => {
  assert.throws(() => settingsLayout({ features: {}, seasons: true, glazed: true }), /unknown feature/)
})

test('a group left with no rows is dropped', () => {
  const none = settingsLayout({ features: Object.fromEntries(FEATURE_NAMES.map((n) => [n, false])), seasons: false, glazed: false })
  assert.ok(!none.some((g) => g.id === 'atmosphere' || g.id === 'sound'))
  assert.equal(none.length, 7)
})
