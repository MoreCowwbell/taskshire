/**
 * Deterministic screenshots of the colony, for diffing a refactor against itself.
 *
 * Determinism comes from seven pins:
 *   - Playwright's fake clock, paused with `pauseAt`: Date, performance.now and
 *     requestAnimationFrame move only when `runFor` says so. `install` on its own is not
 *     enough — see the note at the call.
 *   - The clock is then advanced one 16 ms frame at a time, and the page is asked how many
 *     frames it actually drew. One frame of drift is a visibly different picture.
 *   - `Math.random` replaced by a seeded mulberry32.
 *   - Settings pinned through localStorage (balanced preset, adaptive quality OFF).
 *   - The camera reset and snapped to its rest pose, no easing.
 *   - One roster and no repeat polls, so nothing resolving in real time touches the world.
 *   - No wake-up render. The engine draws a frame on `pageshow` / `focus` / `visibilitychange`,
 *     and the browser fires those in real time while the kits are still loading; a render
 *     allocates lazily and spends seeded draws, so whether it landed before or after the
 *     roster moved the crew. Swallowed in the init script (2026-09-12).
 *
 * With those in place two runs are bit-identical: no tolerance, no fuzzy compare. When they
 * are not, the page has a wall clock in its frame loop somewhere. The one found on 2026-09-12
 * — about one run in three disagreed, on `main` too — was the sky's prefilter throttle reading
 * `performance.now()`: the paused clock reads about 110 ms at frame 1 and a slow boot pushes
 * it past the 220 ms window, so the prefilter's first-time allocations landed on frame 1 or
 * frame 8. Fixed in `src/world/sky.js` by throttling on the simulation clock. The tools for the
 * next one are below: every `.state.json` carries the seeded-draw count at the roster, before
 * frame 1 and at the shot, and a per-frame log of it, so the first frame that differs between
 * a good run and a bad one names the actor; `Error().stack` inside the `Math.random` shim then
 * names the call site.
 *
 * `/api/*` is intercepted in the browser: the real scanner never runs, so this works on any
 * OS and needs no Claude Code sessions.
 *
 * Each shot writes three files to `tools/visual/out`: the PNG, the counters, and a
 * `.state.json` of what the colony actually was at that frame — camera, elapsed, and every
 * agent's position, gait and state. Only the first two are compared; the third is there
 * because "40 000 pixels differ" is not a diagnosis and a state diff is.
 *
 * The settle frames are drawn at 128×80 and only the shots at the full 1280×800. A run steps
 * ~1600 frames per theme to reach nine of them, and on SwiftShader a frame costs what its
 * fragments cost. Every render still happens — the same post passes, the same shadow maps,
 * the same IBL bake, in the same order on the same frames — which is what makes this safe
 * where skipping the draw was not: three allocates GPU resources lazily inside `render`, each
 * allocation spends four draws of the seeded stream the crew is seated from, and a frame that
 * does not draw defers them. Only the fragment count changes. The aspect is 1.6 either way,
 * so the projection matrix does not move. The nine baselines are the proof.
 *
 * Shots are grouped by the theme they are taken in and each group gets a page of its own,
 * booted from scratch with that theme in `localStorage` — a theme is read once, at module
 * load, so it cannot be switched inside a page without re-running the boot the pins depend
 * on. The space group runs exactly the sequence this file has always run, and its four shots
 * are the gate on that being true.
 *
 *   node tools/visual/snapshot.mjs --check    diff against tools/visual/baseline, exit 1 on any difference
 *   node tools/visual/snapshot.mjs --update   rewrite the baseline
 *   node tools/visual/snapshot.mjs --only <theme>   only the shots that theme owns
 *   SNAPSHOT_FEATURES_OFF=clouds,fauna node tools/visual/snapshot.mjs --check --only space
 *                                                   the same shots with those features off
 *   SNAPSHOT_SHOTS=worlds SNAPSHOT_BASELINE_DIR=<dir> node tools/visual/snapshot.mjs --check
 *                                                   one day shot of every world each theme
 *                                                   lists, against a baseline folder of its own
 *   SNAPSHOT_SHOTS=worlds SNAPSHOT_WORLDS=moon,mars SNAPSHOT_BASELINE_DIR=<dir> \
 *     node tools/visual/snapshot.mjs --check --only space
 *                                                   only those worlds, in that order
 *
 * `SNAPSHOT_BASELINE_DIR` reads and writes the baseline there instead of `tools/visual/baseline`,
 * resolved against the working directory. `SNAPSHOT_SHOTS=worlds` swaps the fixture's `SHOTS`
 * for `worldShots` — see the note there. Both are opt-in: with neither set, the run is the one
 * described above, shot for shot.
 *
 * `SNAPSHOT_WORLDS=id,id,…` pins the `worlds` set to those worlds, shot in that order in every
 * theme the run takes, instead of every world the theme's manifest lists in list order. Each
 * shot carries the world switches before it, so reordering a manifest moves pixels that did not
 * really change; pinning the old list and order is how a before/after compares like with like.
 * An id a theme does not list stops the run with exit 2, naming it — use `--only` when the
 * themes list different worlds. It means nothing without `SNAPSHOT_SHOTS=worlds`, and is refused
 * there too.
 *
 * In `worlds` mode a `console.error` on the page fails the run (exit 1), printed with the shot
 * it came during, as a `pageerror` does in every mode: a world that has only just become
 * pickable in a theme is more likely to log a fallback than to throw. The default run keeps
 * its old rule.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { diffPng } from './diff.mjs'
import { FIXTURE_THREADS, FIXTURE_STATE, FIXTURE_SETTINGS, ROSTERS, SHOTS, NOW, worldShots } from './fixture.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
/** The committed baseline. A `SNAPSHOT_BASELINE_DIR` stands in for it, and the frozen rule is its own. */
const DEFAULT_BASELINE = join(HERE, 'baseline')
const BASELINE = process.env.SNAPSHOT_BASELINE_DIR ? resolve(process.env.SNAPSHOT_BASELINE_DIR) : DEFAULT_BASELINE
const OUT = join(HERE, 'out')
const SEED = 20260903
const VIEWPORT = { width: 1280, height: 800 }
/**
 * The drawing buffer settle frames are drawn into: same 1.6 aspect as VIEWPORT, a hundredth of
 * the pixels. Every frame is still rendered through the same path — post passes, shadow maps,
 * the IBL bake — so nothing three allocates lazily moves to a different frame and the seeded
 * stream the crew is seated from is untouched. Only the fragment work shrinks. The real
 * viewport is put back for each shot.
 */
const SETTLE_VIEWPORT = { width: 128, height: 80 }
/** Simulated seconds to run after the roster lands, so the crew has walked to its sites. */
const SETTLE_S = 14

/**
 * Count frames, and drive the clock by frames rather than by milliseconds.
 *
 * Simulated seconds are not the unit that matters — `elapsed` is a running sum of per-frame
 * deltas, and a run that draws one frame fewer lands the whole colony 16 ms out of step:
 * crew mid-stride, badges mid-bob, a different picture. Advancing the clock in whole 16 ms
 * ticks makes that exact, and `runFrames` fails loudly if the page ever disagrees about how
 * many frames it drew, so a later task cannot quietly reintroduce the drift.
 */
const FRAME_MS = 16
const framesFor = (seconds) => Math.round((seconds * 1000) / FRAME_MS)

const mode = process.argv.includes('--update') ? 'update' : 'check'
/** `--only <theme>`: take (and update) only the shots that theme owns. */
const onlyAt = process.argv.indexOf('--only')
const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : null
if (onlyAt >= 0 && (!only || only.startsWith('--'))) {
  console.error('usage: snapshot.mjs [--check|--update] [--only <theme>]')
  process.exit(2)
}
/**
 * The shots that must not move.
 *
 * The whole medieval branch is argued on the space colony rendering pixel for pixel what it
 * rendered before it, so `--update` refuses to touch these however it was invoked. Rewriting
 * them is a deliberate act with an environment variable on it, not something a run aimed at
 * another theme can do by forgetting a flag. The rule guards the committed folder: a
 * `SNAPSHOT_BASELINE_DIR` is somebody's own comparison, and writing it is the point of it.
 */
const FROZEN = new Set(['moon-day', 'moon-night', 'mars-day', 'terra-day'])

/**
 * `SNAPSHOT_FEATURES_OFF=clouds,fauna`: take the shots with those engine features switched off
 * in the theme's own declaration (`src/core/features.js`), by rewriting its `features` block as
 * the browser loads it. This is how a feature is shown to spend none of the stream the crew is
 * seated from: with it off, every `.state.json` keeps its agents and its draw log. The pictures
 * differ, so this never updates a baseline, and a name the block does not switch on is an error
 * rather than a run that quietly proves nothing.
 */
const FEATURES_OFF = (process.env.SNAPSHOT_FEATURES_OFF || '').split(',').map((s) => s.trim()).filter(Boolean)
if (FEATURES_OFF.length && mode === 'update') {
  console.error('SNAPSHOT_FEATURES_OFF takes shots to compare, never baselines: use --check')
  process.exit(2)
}
const FEATURES_BLOCK = /features:\s*\{[^}]*\}/
function featuresOff(source) {
  const block = source.match(FEATURES_BLOCK)?.[0]
  if (!block) return null
  let off = block
  for (const name of FEATURES_OFF) {
    const on = new RegExp(`\\b${name}:\\s*true\\b`)
    if (!on.test(off)) return null
    off = off.replace(on, `${name}: false`)
  }
  return source.replace(block, off)
}

mkdirSync(OUT, { recursive: true })
mkdirSync(BASELINE, { recursive: true })
/**
 * Whether the run writes the committed folder, however it was spelled. Compared as real paths:
 * on a case-insensitive disk `tools/Visual/baseline`, or a link to it, is the same folder, and
 * a string compare would let it past the frozen rule.
 */
const IN_DEFAULT_BASELINE = realpathSync.native(BASELINE).toLowerCase() === realpathSync.native(DEFAULT_BASELINE).toLowerCase()

/**
 * `SNAPSHOT_SHOTS=worlds`: every world instead of the fixture's nine. The themes are the ones
 * `SHOTS` takes, in its order, and each one's worlds are read off its manifest, so a world
 * added to a theme is shot without touching this file.
 */
const SHOT_SET = process.env.SNAPSHOT_SHOTS || ''
if (SHOT_SET && SHOT_SET !== 'worlds') {
  console.error(`SNAPSHOT_SHOTS: unknown shot set "${SHOT_SET}" (the one there is: worlds)`)
  process.exit(2)
}
/** `SNAPSHOT_WORLDS`: the world ids the `worlds` set is pinned to, in order, or null for all. */
const PINNED_WORLDS = process.env.SNAPSHOT_WORLDS ? process.env.SNAPSHOT_WORLDS.split(',').map((s) => s.trim()).filter(Boolean) : null
if (PINNED_WORLDS && SHOT_SET !== 'worlds') {
  console.error('SNAPSHOT_WORLDS pins the worlds shot set: set SNAPSHOT_SHOTS=worlds with it')
  process.exit(2)
}
async function everyWorld() {
  const shots = []
  for (const theme of new Set(SHOTS.map((shot) => shot.theme || 'space'))) {
    if (only && theme !== only) continue
    const { manifest } = await import(pathToFileURL(join(ROOT, 'src', 'themes', theme, 'manifest.js')).href)
    let settings = manifest.settings
    if (PINNED_WORLDS) {
      const listed = new Map(settings.map((setting) => [setting.id, setting]))
      const missing = PINNED_WORLDS.filter((id) => !listed.has(id))
      if (missing.length) {
        console.error(`SNAPSHOT_WORLDS: theme "${theme}" does not list ${missing.map((id) => `"${id}"`).join(', ')}`)
        process.exit(2)
      }
      settings = PINNED_WORLDS.map((id) => listed.get(id))
    }
    shots.push(...worldShots(theme, settings))
  }
  return shots
}

/** The shots to take, grouped by theme, each group in the order `fixture.mjs` declares it. */
const groups = new Map()
for (const shot of SHOT_SET === 'worlds' ? await everyWorld() : SHOTS) {
  const theme = shot.theme || 'space'
  if (only && theme !== only) continue
  if (!groups.has(theme)) groups.set(theme, [])
  groups.get(theme).push(shot)
}
if (!groups.size) {
  console.error(`no shots for theme "${only}"`)
  process.exit(2)
}

// `localhost` rather than a literal address: Vite binds the loopback name, which resolves to
// ::1 first on Windows, and a hard-coded 127.0.0.1 is then refused.
const server = await createServer({
  root: ROOT,
  // Hot reload is off, and so is the watcher behind it. A run takes minutes, and any save
  // anywhere in the tree — an editor, another person, a sync client — sends the page a
  // full reload, which throws away the pins the harness injected and fails the run with
  // "the page drew NaN". The harness wants the sources as they were when it started.
  server: { host: 'localhost', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**'] } },
  logLevel: 'error',
})
await server.listen()
const port = server.httpServer.address().port
const url = `http://localhost:${port}/`

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
/**
 * Boot one page on one theme, settle it, and hand back the page and the three helpers the
 * shot loop drives it with.
 *
 * Every line of this used to run once at module scope. It is a function now because a second
 * theme is a second boot — and it is *only* a function: the same calls, in the same order,
 * the same number of times, against a page created the same way. That is what keeps the space
 * shots byte-identical across the refactor.
 */
async function boot(theme) {
  const page = await context.newPage()

  // Pins that must land before src/main.js runs.
  await page.addInitScript(
    ([seed, settings]) => {
      // mulberry32 — the same generator src/core/rng.js provides. Note that this
      // stream is shared with `THREE.MathUtils.generateUUID`, which spends four draws on every
      // geometry, material and texture the asset loaders create; that is fine, because the
      // loaders always create the same objects, so the crew always starts from the same offset.
      let a = seed >>> 0
      // How many draws have been spent, readable from Node: `.state.json` records it at the
      // roster, before the first frame and at the shot, which is what turns "the crew moved"
      // into "something allocated between the roster and frame one".
      let draws = 0
      window.__draws = () => draws
      Math.random = () => {
        draws++
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      localStorage.setItem('botcrossing.settings.v1', JSON.stringify(settings))
      localStorage.setItem('botcrossing.seen-help', '1')
      /**
       * No wake-up render. `Engine.start` draws one frame on `pageshow`, `focus` and
       * `visibilitychange` so a tab coming back is not a black flash, and the browser fires
       * `pageshow` in *real* time once the module graph has evaluated — while `boot()`'s three
       * fetches are still in flight. That frame is the first render, and three's first render
       * allocates its render targets lazily, each spending four draws of the seeded stream the
       * crew is seated from. Whether it lands before or after the roster depended on how fast
       * the kits came off the disk, which is what made one run in three disagree with the rest
       * (2026-09-12). Swallowed in the capture phase, registered before `main.js` subscribes,
       * so the only frames drawn are the ones `runFrames` asks for.
       */
      for (const type of ['pageshow', 'focus', 'visibilitychange']) {
        // Only the page-level event: an element's own `focus` captures through the window too,
        // and that is the HUD's business, not the engine's.
        const stop = (ev) => {
          if (ev.target === window || ev.target === document) ev.stopImmediatePropagation()
        }
        window.addEventListener(type, stop, true)
      }
    },
    // `theme` is the settings key `main.js` reads at module load. Writing `space` explicitly
    // is what the default already is, so the space group's storage is unchanged.
    [SEED, { ...FIXTURE_SETTINGS, theme }]
  )
  // `install` alone is not a pin: it fixes the origin but the fake clock still runs forward
  // with real time, so `Date.now()`, `performance.now()` and `requestAnimationFrame` all pick
  // up however long the harness spent talking to the browser. `pauseAt` is what actually stops
  // it — after this the clock only moves when `runFor` says so, and a frame is a frame whether
  // the machine is busy or idle. Install one second early so the pause lands exactly on NOW.
  await page.clock.install({ time: NOW - 1000 })
  await page.clock.pauseAt(NOW)

  // Playwright tries routes newest-first, so the catch-all goes in before the specific ones.
  await page.route('**/api/**', (route) => route.fulfill({ json: { ok: false, error: 'fixture' } }))
  await page.route('**/api/state', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ json: { ok: true } }) : route.fulfill({ json: FIXTURE_STATE })
  )
  await page.route('**/api/threads', (route) =>
    route.fulfill({ json: { threads: FIXTURE_THREADS, scannedAt: NOW } })
  )

  page.on('pageerror', (err) => {
    console.error('page error:', err.message)
    process.exitCode = 1
  })
  /**
   * `worlds` mode only: a logged error is a failure too, named by the shot it came during.
   *
   * Except the one the harness causes itself. Refusing the repeat poll (below) aborts each
   * `/api/threads` fetch after the roster, and the browser logs every aborted load as
   * "Failed to load resource: net::ERR_FAILED" — the pin working, not the page failing.
   */
  if (SHOT_SET === 'worlds') {
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const { url: source, lineNumber } = msg.location()
      if (/\/api\/threads$/.test(source) && msg.text().includes('net::ERR_FAILED')) return
      console.error(`${current}: console.error: ${msg.text()}${source ? ` (${source}:${lineNumber})` : ''}`)
      process.exitCode = 1
    })
  }

  if (FEATURES_OFF.length) {
    const file = join(ROOT, 'src', 'themes', theme, 'index.js')
    if (!featuresOff(readFileSync(file, 'utf8'))) {
      console.error(`SNAPSHOT_FEATURES_OFF: ${theme}'s features block does not switch on all of ${FEATURES_OFF.join(', ')}`)
      process.exit(2)
    }
    await page.route(`**/src/themes/${theme}/index.js*`, async (route) => {
      const response = await route.fetch()
      const body = featuresOff(await response.text())
      if (!body) return route.abort()
      return route.fulfill({ response, body })
    })
    console.log(`${theme}: features off: ${FEATURES_OFF.join(', ')}`)
  }

  await page.goto(url)
  /**
   * Boot: assets load, first poll, roster applied. None of that needs a timer — it is three
   * fetches and a `Promise.all` — so the clock stays exactly where `pauseAt` left it and the
   * roster always lands at `engine.elapsed === 0`. That matters: badge bob, the selection
   * ring and the building shader all read `elapsed` directly, so a boot that burned a
   * different number of simulated milliseconds would draw a different frame every run.
   *
   * `waitForFunction` cannot be used here — its polling runs on the page's own (faked)
   * timers — so poll from Node, sleeping in Node's real time.
   */
  const deadline = Date.now() + 120_000
  while (!(await page.evaluate(() => Boolean(window.botCrossing && window.botCrossing.threads.length)))) {
    if (Date.now() > deadline) throw new Error('boot did not complete in 120 s')
    await new Promise((r) => setTimeout(r, 50))
  }
  /**
   * One roster, then no more. `main.js` re-polls every 15 s, and a shot run covers 28 s of
   * simulated time, so a second roster always lands — but its fetch resolves in *real* time,
   * at whatever point between two `runFor` chunks the network happens to finish. `setThreads`
   * then re-seats the crew at a different simulated instant every run, and the crew is still
   * wandering around its sites, so `settled` and the frame move with it.
   *
   * Refusing the repeat poll is the pin: `poll()` catches the failure, puts a toast on the
   * HUD — which is not in the shot — and leaves the colony to the frame loop alone. Playwright
   * matches routes newest-first, so this handler supersedes the one installed above.
   */
  await page.route('**/api/threads', (route) => route.abort())

  /** Seeded draws spent so far, at the moments that decide where the crew is seated. */
  const draws = { roster: await page.evaluate(() => window.__draws()) }

  await page.evaluate((step) => {
    window.__frames = 0
    // Seeded draws spent as of each frame's start. A run that disagrees with its baseline
    // compares the two logs and the first frame that differs is when the real-time actor
    // struck; the counters at the shot only say that it did.
    window.__drawLog = []
    window.botCrossing.engine.add({
      update() {
        window.__frames++
        window.__drawLog.push(window.__draws())
      },
    })
    /**
     * One frame is exactly one frame's worth of simulation.
     *
     * Counting frames is not quite enough on its own. The fake clock schedules
     * `requestAnimationFrame` every 16 ms, but the delta the engine actually uses comes from
     * `performance.now()`, and that does not always land exactly on the tick: over the ~1200
     * frames of a run the measured `engine.elapsed` drifted by up to 8 ms between runs. Eight
     * milliseconds is half a frame of walk cycle, which is tens of thousands of pixels. So the
     * delta is pinned rather than measured — the one thing a screenshot harness wants from a
     * clock that a real one cannot give it.
     */
    window.botCrossing.engine.timer.getDelta = () => step
  }, FRAME_MS / 1000)

  async function runFrames(count) {
    const before = await page.evaluate(() => window.__frames)
    for (let i = 0; i < count; i++) await page.clock.runFor(FRAME_MS)
    const drawn = (await page.evaluate(() => window.__frames)) - before
    if (drawn !== count) throw new Error(`asked for ${count} frames, the page drew ${drawn}`)
  }

  /** Resize the drawing buffer, small for settling and back to full for a shot. */
  async function useViewport(size) {
    await page.setViewportSize(size)
    // The engine's own resize listener may be deferred; size the buffer now so the very next
    // frame (or the shot) draws at this size.
    await page.evaluate(() => window.botCrossing.engine.resize())
  }

  await useViewport(SETTLE_VIEWPORT)
  draws.beforeFirstFrame = await page.evaluate(() => window.__draws())
  await runFrames(framesFor(2))
  draws.afterFirstFrames = await page.evaluate(() => window.__draws())
  console.log(`${theme}: draws at roster ${draws.roster}, before frame 1 ${draws.beforeFirstFrame}, after 2 s ${draws.afterFirstFrames}`)

  /** The settings key that holds the world preset: `setting` since the theme layer, `planet` before it. */
  const worldKey = await page.evaluate(() => ('setting' in window.botCrossing.settings.values ? 'setting' : 'planet'))

  /** Snap the camera to its rest pose with no easing left to do. */
  async function pinCamera() {
    await page.evaluate(() => {
      const { rig } = window.botCrossing
      rig.resetView()
      rig.target.copy(rig.desiredTarget)
      rig.distance = rig.desiredDistance
      rig.azimuth = rig.desiredAzimuth
      rig.polar = rig.desiredPolar
      rig._sync()
    })
  }

  const settle = (seconds) => runFrames(framesFor(seconds))

  /**
   * One frame, read straight out of the drawing buffer, plus the counters that describe it.
   *
   * Neither Playwright screenshot path can be used here. `locator.screenshot()` waits for the
   * element to be "stable", which compares two bounding boxes one `requestAnimationFrame`
   * apart — and rAF only fires while the fake clock is being moved, so it waits forever.
   * `page.screenshot()` skips that check but still waits on the compositor for a fresh frame,
   * which a page with frozen rAF only sometimes produces; it times out at random.
   *
   * `engine.renderFrame()` followed by `canvas.toDataURL()` in the *same* task is the path the
   * app's own screenshot button already uses, and it needs neither the compositor nor
   * `preserveDrawingBuffer`. It also ties the image and the counters to the same draw: the
   * numbers come from `renderer.info` for exactly the frame that was captured.
   */
  async function shootAndCount(path) {
    await useViewport(VIEWPORT)
    const { png, counters, debug } = await page.evaluate(() => {
      const { engine, colony, hud } = window.botCrossing
      /**
       * No HUD insets in the shot. A theme with `recentre` centres the orbit target in the space
       * the HUD's panels leave (upstream 6344799), measured by a ResizeObserver — which last ran at
       * the 128×80 settle size, where the HUD is in its phone layout with the sheet peeking up
       * from the bottom. That offset survives the resize back to full size and pushed the
       * colony to the top of the frame. The shot is the canvas alone, with no panels in it, so
       * it is framed on the whole canvas: zero insets, through the same action the HUD reports
       * layout with, in the same task as the draw so an observer cannot land in between. The
       * village ignores the action, as it ignores the HUD's own reports.
       */
      hud.actions.viewportChanged({ width: hud.el.clientWidth, height: hud.el.clientHeight, right: 0, bottom: 0 })
      engine.renderFrame()
      const dataUrl = engine.canvas.toDataURL('image/png')
      const info = engine.renderer.info.render
      const agents = colony.astronauts.agents
      /**
       * Where the roster actually sent each villager.
       *
       * `agent.site` is not that: an astronaut that gives up overwrites it with the ground it
       * settled for, which is how a figure standing against a wall counted as `settled` and
       * kept every baseline green while most of the colony never reached its building
       * (2026-09-15). The entries the colony handed over still hold the real thing.
       */
      const sites = new Map((colony.astronauts.roster || []).map((e) => [e.id, e.site]))
      const arrive = colony.astronauts.constructor.ARRIVE_RADIUS
      let settled = 0
      let onSite = 0
      let penetrations = 0
      for (const a of agents) {
        if (a.state === 'at-site') settled++
        const site = sites.get(a.id)
        // Measured on the villager's *own* site rather than on where it is standing: a working
        // one walks a ring around its building (`_workRound`) and is legitimately three units
        // off its spot at any given instant. What has to be true is that the spot is still the
        // one it was given — an astronaut that gave up overwrote it with the ground it reached.
        if (a.state === 'at-site' && !a.gaveUp && site && Math.hypot(a.site.x - site.x, a.site.z - site.z) < arrive) onSite++
        if (a.state !== 'spawning' && a.state !== 'leaving' && a.scale > 0.5 && colony.nav.isBlocked(a.pos.x, a.pos.z)) penetrations++
      }
      const round = (n) => Math.round(n * 1e6) / 1e6
      return {
        png: dataUrl.split(',')[1],
        debug: {
          frames: window.__frames,
          draws: window.__draws(),
          drawLog: window.__drawLog.slice(),
          elapsed: round(engine.elapsed),
          viewport: engine.viewport,
          camera: engine.camera.matrixWorld.elements.map(round),
          // `size` last, and never compared — a state diff that says a helper is standing at
          // full height is worth having, and appending to the tuple costs the baselines nothing.
          agents: agents.map((a) => [a.id, round(a.pos.x), round(a.pos.z), round(a.yaw), round(a.phase), round(a.speed), a.state, round(a.scale), round(a.stateAge ?? 0), round(a.size)]),
        },
        counters: {
          drawCalls: info.calls,
          triangles: info.triangles,
          agents: agents.length,
          visible: colony.astronauts.visibleCount,
          settled,
          // Of those, the ones standing where they were actually sent. `settled` counts a
          // villager that gave up; this one is the guard that it did not have to.
          onSite,
          penetrations,
          buildings: colony.buildings.size,
          plots: colony.plotOrder.length,
          particles: colony.particles.liveCount,
        },
      }
    })
    await useViewport(SETTLE_VIEWPORT)
    writeFileSync(path, Buffer.from(png, 'base64'))
    writeFileSync(path.replace(/\.png$/, '.state.json'), JSON.stringify({ ...debug, drawsAtBoot: draws }, null, 1))
    return counters
  }

  await pinCamera()
  await settle(SETTLE_S)

  return { page, worldKey, pinCamera, settle, shootAndCount }
}

let failures = 0
/** What the page is doing, for naming a console error in `worlds` mode: a theme's boot, then each shot. */
let current = ''

for (const [theme, shots] of groups) {
  current = `${theme} boot`
  const { page, worldKey, pinCamera, settle, shootAndCount } = await boot(theme)

  for (const shot of shots) {
    current = shot.name
    await page.evaluate(
      ([set, worldKey, world]) => {
        const { settings } = window.botCrossing
        if (world) settings.set(worldKey, world)
        for (const [k, v] of Object.entries(set)) settings.set(k, v)
      },
      [shot.set, worldKey, shot.world || null]
    )
    if (shot.roster) {
      /**
       * A different roster for this one shot. The abort route from boot stays installed
       * underneath; this handler is newer so it wins, the page's own `poll()` is called and
       * awaited from here so the roster lands at a known simulated instant (the clock is
       * paused), and then the handler is removed so the abort rule is back for the rest.
       */
      const roster = ROSTERS[shot.roster]
      const handler = (route) => route.fulfill({ json: { threads: roster, scannedAt: NOW } })
      await page.route('**/api/threads', handler)
      await page.evaluate(() => window.botCrossing.poll())
      await page.unroute('**/api/threads', handler)
    }
    await pinCamera()
    await settle(shot.settle ?? 3)

    const png = join(OUT, `${shot.name}.png`)
    const c = await shootAndCount(png)
    writeFileSync(join(OUT, `${shot.name}.json`), JSON.stringify(c, null, 2))

    if (mode === 'update') {
      if (IN_DEFAULT_BASELINE && FROZEN.has(shot.name) && process.env.ALLOW_SPACE_BASELINE !== '1') {
        console.error(`refusing to update ${shot.name}: the space baseline is frozen (set ALLOW_SPACE_BASELINE=1 to override)`)
        continue
      }
      writeFileSync(join(BASELINE, `${shot.name}.png`), readFileSync(png))
      writeFileSync(join(BASELINE, `${shot.name}.json`), JSON.stringify(c, null, 2))
      console.log(`updated ${shot.name}`, c)
      continue
    }

    const basePng = join(BASELINE, `${shot.name}.png`)
    const baseJson = join(BASELINE, `${shot.name}.json`)
    if (!existsSync(basePng) || !existsSync(baseJson)) {
      console.error(`${shot.name}: no baseline — run npm run test:visual:update`)
      failures++
      continue
    }
    const r = await diffPng(browser, basePng, png, join(OUT, `${shot.name}.diff.png`))
    const baseCounters = JSON.parse(readFileSync(baseJson, 'utf8'))
    const counterDiff = Object.keys(baseCounters).filter((k) => baseCounters[k] !== c[k])
    if (r.differing || counterDiff.length) {
      failures++
      console.error(`${shot.name}: ${r.differing} px differ; counters changed: ${counterDiff.join(', ') || 'none'}`)
      for (const k of counterDiff) console.error(`  ${k}: ${baseCounters[k]} -> ${c[k]}`)
    } else {
      console.log(`${shot.name}: identical`, c)
    }
  }

  await page.close()
}

await browser.close()
await server.close()
if (failures) {
  console.error(`${failures} shot(s) differ — see tools/visual/out/*.diff.png`)
  process.exit(1)
}
process.exit(process.exitCode || 0)
