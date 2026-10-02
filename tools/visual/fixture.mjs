/**
 * A fake roster for the screenshot harness: three repos, twelve threads, every status a
 * villager can wear. Timestamps are absolute because the harness pins the browser clock to
 * NOW, and `statusFor` decides "sleeping" from `Date.now() - lastActivityAt`.
 *
 * `state` is what liveness means now, and it decides two different things: a counted state
 * earns a building, and of those only `active` and `idle` earn a villager. So a closed
 * session (`inactive`) is a house nobody is home in — which is why the shots have twelve
 * buildings and seven crew rather than twelve of each.
 */
export const NOW = Date.UTC(2026, 8, 3, 12, 0, 0) // 2026-09-03T12:00:00Z

const DAY = 24 * 60 * 60 * 1000

function thread(i, project, extra) {
  return {
    id: `fx-${project}-${i}`,
    title: `Thread ${i} in ${project}`,
    preview: 'fixture',
    project,
    projectPath: `/fixture/${project}`,
    worktree: '',
    cwd: `/fixture/${project}`,
    gitBranch: 'main',
    model: 'claude-opus-5',
    effort: 'high',
    createdAt: NOW - (20 - i) * DAY,
    lastActivityAt: NOW - 60_000,
    lastFocusedAt: NOW - 120_000,
    state: 'inactive',
    unread: false,
    hasError: false,
    starred: false,
    prState: '',
    archived: false,
    sizeBytes: 40_000 * (i + 1),
    source: 'fixture',
    harness: 'claude-code',
    harnessName: 'Claude Code',
    canOpen: false,
    canArchive: false,
    // A Claude CLI thread reports both: the command to paste, and the id on its own that
    // decides whether the Copy resume command button is offered. Not a real UUID — nothing in the browser parses it, and a
    // greppable string is worth more in a failure message than sixteen random bytes.
    sessionId: `fx-session-${project}-${i}`,
    resume: `claude --resume fx-session-${project}-${i}`,
    ref: { fixture: true },
    ...extra,
  }
}

export const FIXTURE_THREADS = [
  // alpha: 6 threads — every pose a villager has, plus two empty houses
  thread(0, 'alpha', { state: 'active' }), // working
  thread(1, 'alpha', { state: 'idle', unread: true }), // waiting, with the `?`
  thread(2, 'alpha', { state: 'idle', hasError: true }), // blocked
  thread(3, 'alpha', { state: 'idle', prState: 'MERGED' }), // celebrating
  thread(4, 'alpha', { lastActivityAt: NOW - 5 * DAY }), // closed, and old with it
  thread(5, 'alpha', { sessionId: '', resume: '' }), // closed, and nothing to resume it with
  // beta: 4 threads
  thread(0, 'beta', { state: 'active' }),
  thread(1, 'beta', {}),
  thread(2, 'beta', { state: 'idle', unread: true }),
  thread(3, 'beta', { lastActivityAt: NOW - 9 * DAY }),
  // gamma: 2 threads
  thread(0, 'gamma', {}),
  thread(1, 'gamma', { state: 'active', sizeBytes: 2_000_000 }),
]

/**
 * The ghost shot's roster: the fixture plus two repos nobody has touched in a while.
 * `beta` has a nine-day *thread*, but also an open one, so its zone never fades; a zone
 * fades on its newest thread of any state. With the default 3 / 14 ramp, `delta` sits at
 * 0.545 — and it is `inactive`, which is the only reason it is a ghost rather than absent.
 *
 * `epsilon` is twelve days gone, which is 0.818, and one shot then covers both halves of the
 * ramp: `delta` is the middle of it — saplings coming up, crates standing open, its house
 * still standing — and `epsilon` is past `decay.ruinAt` and down to rubble. Two zones rather
 * than one because the threshold is the whole point of the ruin, and a baseline that only ever
 * sees one side of it cannot catch the day the swap stops firing.
 */
export const FIXTURE_GHOST_THREADS = [
  ...FIXTURE_THREADS,
  thread(0, 'delta', { createdAt: NOW - 30 * DAY, lastActivityAt: NOW - 9 * DAY, lastFocusedAt: NOW - 9 * DAY }),
  thread(0, 'epsilon', { createdAt: NOW - 30 * DAY, lastActivityAt: NOW - 12 * DAY, lastFocusedAt: NOW - 12 * DAY }),
]

/**
 * The helper shot's roster: the fixture, with two subagents running under beta's live thread.
 * `helperEntries` only puts a villager on the map for an `active` or `idle` session, and
 * `fx-beta-0` is one of the three that are working, so the two half-height helpers come out of
 * the keep and take their places on the ring around its building.
 *
 * Beta rather than gamma since 2026-09-13, and the reason is the camera rather than the
 * colony. All three were taken and read at the pixel. Gamma's own villager stands on open
 * ground, which is what won it the shot in the first place, but its building is the tallest
 * thing on the plot and it stands between the ring and the camera: both helpers came to rest
 * behind the roof and the cap they wear — the whole reason the shot exists now — could not be
 * seen at all. Alpha is worse: it is the busy repo, six threads and four of them crewed, and
 * its ring put both helpers behind a barrel in the same packed western pocket `fx-alpha-2`
 * gave up in. Beta leaves one of the two standing clear on open grass with its cap plain
 * against the hood, and the other tucked behind the plot's boulder. It is also one of the
 * three `active` threads, so the shot still holds what it always held: one full-height
 * working body and two half-height ones around the same building.
 *
 * Where a helper comes to rest is not a placement anyone chose. A helper is `working`, so
 * `_workRound` walks it to a new spot on its parent's ring every five to twelve seconds, and
 * the shot catches it wherever that left it. Beta is the plot that reads best on this deal,
 * not a guarantee; re-dealing the seeded stream can move either of them behind something
 * again, and the thing to check when it does is this comment rather than the cue.
 */
const subagent = (id, name, agentType, description) => ({
  id,
  name,
  agentType,
  description,
  model: 'claude-opus-5',
  startedAt: NOW - 60_000,
})

/** The thread the two subagents run under. Read by the smoke test as well as by the shot. */
export const HELPER_PARENT = 'fx-beta-0'
/** The repo that thread belongs to, so the smoke need not parse the id. */
export const HELPER_REPO = 'beta'

export const FIXTURE_HELPER_THREADS = FIXTURE_THREADS.map((t) =>
  t.id === HELPER_PARENT
    ? { ...t, subagents: [subagent('agent-fx-a', 'Explore', 'explore', 'reads the tree'), subagent('agent-fx-b', 'Coder', 'coder', 'writes the patch')] }
    : t
)

export const ROSTERS = { ghost: FIXTURE_GHOST_THREADS, helpers: FIXTURE_HELPER_THREADS }

/** What `/api/state` returns: no saved layout, no archives, no settings. */
export const FIXTURE_STATE = { archived: [], archivedAt: {}, hidden: [], pinned: [], opened: [], plots: {}, seen: {} }

/** Settings pinned for every shot. Balanced preset with every source of nondeterminism off. */
export const FIXTURE_SETTINGS = {
  preset: 'balanced',
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
  planet: 'moon',
  timeOfDay: 0.32,
  autoTime: false,
  dayLength: 240,
  exposure: 1.0,
  bloomStrength: 0.25,
  tiltShiftStrength: 0.4,
  tiltShiftAngle: 0,
  iblIntensity: 1.0,
  fov: 38,
  autoQuality: false,
  autoFrame: false,
  showFps: false,
  showLabels: true,
  reducedMotion: false,
  // The filter is pinned off for every shot that predates it, so those stay frozen; the
  // ghost shot turns it on through `set`.
  activeOnly: false,
  fadeDays: 3,
  hideDays: 14,
  // How a ghost is *drawn*, pinned off because that is the product default — the ghost shot
  // is the dressing and the lights going out, not a dithered zone.
  fadeGhosts: false,
  // Closed sessions are counted here and nowhere else by default: without it the shots would
  // hold four buildings between them and `delta` would leave the map instead of ghosting.
  countInactive: true,
  // Auto: every shot wears the sheet its own setting names, the way it always did.
  season: 'auto',
}

/**
 * The shots taken. `set` is applied through `settings.set` after the first settle. `world`
 * is the preset id; the harness writes it to whichever key the app uses (`setting` since the
 * theme layer, `planet` before it), so this file never changed across that refactor.
 *
 * `theme` is the theme the shot is taken in, defaulting to `space`. The harness groups the
 * list by it and boots a page per group, so shots of one theme stay together in this order.
 */
export const SHOTS = [
  { name: 'moon-day', set: {} },
  { name: 'moon-night', set: { timeOfDay: 0.85 } },
  { name: 'mars-day', world: 'mars', set: { timeOfDay: 0.32 } },
  { name: 'terra-day', world: 'terra', set: { timeOfDay: 0.32 } },
  // The two village worlds space can pick too. After terra, so every space shot above still
  // carries the world switches it always did.
  { name: 'space-forest-day', world: 'forest', set: { timeOfDay: 0.32 } },
  { name: 'space-valley-day', world: 'valley', set: { timeOfDay: 0.32 } },
  { name: 'forest-day', theme: 'medieval', world: 'forest', set: { timeOfDay: 0.32 } },
  { name: 'valley-day', theme: 'medieval', world: 'valley', set: { timeOfDay: 0.32 } },
  { name: 'mountain-night', theme: 'medieval', world: 'mountain', set: { timeOfDay: 0.85 } },
  // Four more village worlds (Shoreline, Archipelago, Frost, Aerie), because the water worlds,
  // the cold one and Aerie now have village looks of their own: seas and boats under the
  // curved horizon, Frost's cold grade, Aerie's cloud sea. Forest, valley and mountain show
  // none of that, so until these nothing did. Before the ghost, so the two shots that must end
  // the list still do; both re-record with these (see the helpers shot below).
  { name: 'village-beach-day', theme: 'medieval', world: 'beach', set: { timeOfDay: 0.32 } },
  { name: 'village-ocean-day', theme: 'medieval', world: 'ocean', set: { timeOfDay: 0.32 } },
  { name: 'village-tundra-day', theme: 'medieval', world: 'tundra', set: { timeOfDay: 0.32 } },
  { name: 'village-sky-day', theme: 'medieval', world: 'sky', set: { timeOfDay: 0.32 } },
  // Four worlds the village plants from Kenney's nature kit (cacti, pink, fall and jungle trees),
  // with Shoreline and Archipelago's palms above. Before the ghost for the same reason.
  { name: 'village-desert-day', theme: 'medieval', world: 'desert', set: { timeOfDay: 0.32 } },
  { name: 'village-sakura-day', theme: 'medieval', world: 'sakura', set: { timeOfDay: 0.32 } },
  { name: 'village-autumn-day', theme: 'medieval', world: 'autumn', set: { timeOfDay: 0.32 } },
  { name: 'village-jungle-day', theme: 'medieval', world: 'jungle', set: { timeOfDay: 0.32 } },
  // The ghost: the filter on, and a fourth repo that has gone quiet. Settles longer so the
  // new zone's buildings have risen all the way and the construction band is gone.
  { name: 'forest-day-ghost', theme: 'medieval', world: 'forest', set: { timeOfDay: 0.32, activeOnly: true }, roster: 'ghost', settle: 6 },
  /**
   * The helpers: two subagents under beta's working thread, drawn at half height, each
   * wearing a horned helm in beta's own colour.
   *
   * Last in the list, and it has to be. A medieval page carries its settings, its colony and
   * its seeded stream from one shot to the next, so a shot placed anywhere but the end re-seeds
   * every shot after it and rewrites baselines it has nothing to do with. Being last is also
   * why `activeOnly` is reset here: the ghost shot immediately before it leaves the filter on,
   * and this roster wants the whole colony back.
   *
   * Being last also means it carries the ghost shot's cost: the dressing's kit is fetched and
   * harvested the first time a zone fades, and every geometry that harvest builds spends four
   * draws of the shared seeded stream — so this shot re-records whenever the ghost's dressing
   * changes, even though there is no ghost in it. That is the price of the lazy flag, and it
   * is paid here and by nothing else; the seven shots on other pages do not move (2026-09-12).
   *
   * Settle 20 rather than the usual 3: a helper's id is never in `knownIds`, so both of them
   * arrive as an entrance, walk out of the keep door and cross to beta's plot before they are
   * standing where the shot wants them. A shot taken while one of them is still mid-stride is
   * a baseline that holds a gait rather than a size, so the window is margin, not a measurement.
   *
   * The cue is what made that margin matter (2026-09-13). It is built the first time a helper
   * spawns and building it spends seeded draws, so both helpers are dealt a different jitter
   * and a different walking speed from the ones they had. On the first such deal one of them
   * wedged three units out from the keep door and never left, because the give-up branch
   * inside `DOORWAY_CLEAR` had no bound and re-routed forever; `DOOR_RETRIES` is that bound
   * and the helper settles again. The cue touches nothing in navigation — the re-deal exposed
   * the defect rather than caused it.
   */
  { name: 'forest-day-helpers', theme: 'medieval', world: 'forest', set: { timeOfDay: 0.32, activeOnly: false }, roster: 'helpers', settle: 20 },
]

/**
 * The every-world shots, taken instead of `SHOTS` when the harness runs with
 * `SNAPSHOT_SHOTS=worlds`: one day shot of each world a theme lists, in the order its manifest
 * lists them (or of the worlds `SNAPSHOT_WORLDS` pins, in its order), named `<theme>-<world>-day`.
 *
 * They are for a change that is meant to leave every world as it was but touches the code all
 * of them are built from. `SHOTS` covers five space worlds and seven village ones; this covers
 * every one, at one frame each, and is compared against a baseline folder of its own
 * (`SNAPSHOT_BASELINE_DIR`) so it never touches the committed fifteen. The theme's own page takes
 * the shots in list order, so each one also carries the world switches before it — which is
 * the same for every run, and so is part of what a run compares.
 *
 * @param {string} theme  the theme id, as `SHOTS` names it
 * @param {Array<{ id: string }>} settings  that theme's `manifest.settings`
 */
export function worldShots(theme, settings) {
  return settings.map((setting) => ({ name: `${theme}-${setting.id}-day`, theme, world: setting.id, set: { timeOfDay: 0.32 } }))
}
