/**
 * The one decision in `_step` that can be read without a rig: what a walking astronaut does
 * with the ground it is standing on once it has arrived, or given up on arriving.
 *
 * `giveUpAt` is exported from `astronauts.js` rather than lifted into `cast.js` because it is
 * steering, not casting — and the module imports cleanly under `node --test`, three and all,
 * so it can be held here beside the numbers it is written against.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Astronauts, doorwayQueued, giveUpAt, isStuck, remembersGiveUp, retireWaypoints, staysGivenUp, workRadius } from '../src/agents/astronauts.js'
import { Navigation } from '../src/agents/navigation.js'

test('an astronaut that simply arrived stands where it arrived', () => {
  assert.equal(giveUpAt(true, false, false, 0), 'arrive')
  // Even on the ramp: arriving is not giving up, so the doorway rule never enters into it.
  assert.equal(giveUpAt(true, false, true, 0), 'arrive')
  assert.equal(giveUpAt(true, false, true, 99), 'arrive')
})

test('out in the open, giving up means keeping the ground it reached', () => {
  assert.equal(giveUpAt(false, true, false, 0), 'adopt')
  // A site it reached anyway is not adopted — it is simply where it meant to be.
  assert.equal(giveUpAt(true, true, false, 0), 'arrive')
  // Retries spent at some earlier doorway do not change what happens away from one.
  assert.equal(giveUpAt(false, true, false, 5), 'adopt')
})

test('in the doorway it is turned round, twice, and then allowed to stay', () => {
  // The queue is the whole reason: an astronaut that claims the ramp walls in everyone
  // still coming out, and a queue clears inside two stuck windows.
  assert.equal(giveUpAt(false, true, true, 0), 'retry')
  assert.equal(giveUpAt(false, true, true, 1), 'retry')
  // Spent. What is still refusing the step is geometry, not a crowd.
  assert.equal(giveUpAt(false, true, true, 2), 'adopt')
  assert.equal(giveUpAt(false, true, true, 3), 'adopt')
})

test('the doorway budget is a parameter, and zero of it is the plain rule', () => {
  assert.equal(giveUpAt(false, true, true, 0, 0), 'adopt', 'no patience at all adopts at once')
  assert.equal(giveUpAt(false, true, true, 9, 10), 'retry', 'a long budget keeps turning it round')
})

/**
 * The bound is the fix. Before it the doorway branch reset the clock and asked for a new path
 * on every stuck window, with nothing to stop it: an astronaut that could never clear the door
 * looped for the life of the colony and never counted as settled.
 */
test('the doorway retry always terminates', () => {
  let spent = 0
  let what = giveUpAt(false, true, true, spent)
  while (what === 'retry') {
    spent++
    assert.ok(spent < 100, 'the doorway retry must not loop forever')
    what = giveUpAt(false, true, true, spent)
  }
  assert.equal(what, 'adopt')
  assert.equal(spent, 2)
})

test('staysGivenUp holds only for the same site across the same grid layout', () => {
  const gaveUp = { x: 4, z: -2, layout: 3 }
  assert.equal(staysGivenUp(null, { x: 4, z: -2 }, 3), false, 'nothing given up')
  assert.equal(staysGivenUp(gaveUp, { x: 4, z: -2 }, 3), true, 'the same site, the same ground')
  assert.equal(staysGivenUp(gaveUp, { x: 4.04, z: -2 }, 3), true, 'within the roster jitter')
  assert.equal(staysGivenUp(gaveUp, { x: 4.2, z: -2 }, 3), false, 'the site moved')
  assert.equal(staysGivenUp(gaveUp, { x: 4, z: -2 }, 4), false, 'the ground changed')
})

/** Just enough of an agent for `_updateAgent`: a seated villager that gave up on (4, -2). */
function seated(layout) {
  return {
    thread: null,
    site: new THREE.Vector3(1, 0, 1),
    pos: new THREE.Vector3(1, 0, 1),
    state: 'at-site',
    stateAge: 5,
    status: 'working',
    pathVersion: 7,
    doorRetries: 0,
    accent: new THREE.Color(0xffffff),
    gaveUp: { x: 4, z: -2, layout },
  }
}

test('a poll handing back the abandoned site leaves the villager seated', () => {
  const crew = { nav: { layout: 3 } }
  const agent = seated(3)
  Astronauts.prototype._updateAgent.call(crew, agent, { thread: 't', site: { x: 4, z: -2 }, status: 'working' })
  assert.equal(agent.state, 'at-site')
  assert.deepEqual([agent.site.x, agent.site.z], [1, 1], 'still the ground it adopted')
  assert.ok(agent.gaveUp, 'and it still remembers why')
  // Every poll after, the same.
  Astronauts.prototype._updateAgent.call(crew, agent, { thread: 't', site: { x: 4, z: -2 }, status: 'working' })
  assert.equal(agent.state, 'at-site')
})

test('a changed grid or a moved site sends it walking and forgets the give-up', () => {
  const rebuilt = seated(3)
  Astronauts.prototype._updateAgent.call({ nav: { layout: 4 } }, rebuilt, { thread: 't', site: { x: 4, z: -2 }, status: 'working' })
  assert.equal(rebuilt.state, 'walking', 'the way may have opened')
  assert.deepEqual([rebuilt.site.x, rebuilt.site.z], [4, -2])
  assert.equal(rebuilt.gaveUp, null)

  const moved = seated(3)
  Astronauts.prototype._updateAgent.call({ nav: { layout: 3 } }, moved, { thread: 't', site: { x: -6, z: 5 }, status: 'working' })
  assert.equal(moved.state, 'walking', 'a new site is a new journey')
  assert.equal(moved.gaveUp, null)
})

test('the doorway owes a retry only to an agent that may be queuing', () => {
  assert.equal(doorwayQueued(true, false), true, 'near the door with a route: maybe a crowd')
  assert.equal(doorwayQueued(true, true), false, 'near the door with no route: geometry')
  assert.equal(doorwayQueued(false, false), false, 'out on open ground there is no queue')
  // And what that means for the decision: a routeless agent at the door adopts at once.
  assert.equal(giveUpAt(false, true, doorwayQueued(true, true), 0), 'adopt')
  assert.equal(giveUpAt(false, true, doorwayQueued(true, false), 0), 'retry')
})

test('a give-up in the doorway is not remembered, so it cannot hold the ramp for good', () => {
  assert.equal(remembersGiveUp(false), true)
  assert.equal(remembersGiveUp(true), false)
})

test('a status change while given up walks it to the ground it adopted and keeps the memory', () => {
  const crew = {
    nav: { layout: 3 },
    faces: { FACE_LOOPS: {} },
    _applyStatus: Astronauts.prototype._applyStatus,
    _sendHome: Astronauts.prototype._sendHome,
  }
  const agent = { ...seated(3), trim: new THREE.Color(), eye: new THREE.Color() }
  Astronauts.prototype._updateAgent.call(crew, agent, { thread: 't', site: { x: 4, z: -2 }, status: 'idle' })
  assert.equal(agent.status, 'idle')
  assert.deepEqual([agent.site.x, agent.site.z], [1, 1], 'its target is still where it stands')
  assert.ok(agent.gaveUp, 'and the next poll will still leave it there')
})

test('a sleeper sent home walks home awake instead of sitting back down on the way', () => {
  const crew = { faces: { FACE: { wink: 7 } }, world: { door: () => new THREE.Vector3(2, 0, 3) } }
  for (const status of ['sleeping', 'resting']) {
    const agent = { state: 'at-site', status, clipKey: status, site: new THREE.Vector3() }
    Astronauts.prototype._sendHome.call(crew, agent)
    assert.equal(agent.state, 'leaving')
    assert.equal(agent.status, 'leaving', `a ${status} status would sit it down whenever it pauses`)
    assert.equal(agent.clipKey, null, 'and the seated clip does not linger into the walk')
    assert.deepEqual([agent.site.x, agent.site.z], [2, 3], 'it heads for the door')
  }
})

/**
 * Giving up honestly.
 *
 * The old rule was `agent.blocked && agent.stateAge > 8`: one refused step after eight seconds
 * of perfectly good walking threw away a route the villager was most of the way along. The
 * clock is the fix — it only runs while the astronaut is getting nowhere.
 */
test('a walk is stuck when it has been refused for eight seconds, not merely refused', () => {
  assert.equal(isStuck(0, 3), false, 'walking along nicely')
  assert.equal(isStuck(0.4, 30), false, 'a bump half a minute in is a bump')
  assert.equal(isStuck(8.1, 8.2), true, 'eight seconds of refusals is a wall')
  assert.equal(isStuck(8, 8), false, 'and the limit itself is not past it')
  // The long stop is unchanged: a walk that has taken three quarters of a minute is over
  // however well it is going.
  assert.equal(isStuck(0, 45.1), true)
  assert.equal(isStuck(0, 44.9), false)
  assert.equal(isStuck(2, 3, 1, 45), true, 'the limits are the caller’s')
})

/** Just enough of an agent for `_walk`, and a crew with a grid and nobody to bump into. */
function walker(nav, x, z) {
  const crew = { nav, _sep: new THREE.Vector3(), _separation: (agent, out) => out.set(0, 0, 0) }
  const agent = {
    pos: new THREE.Vector3(x, 0, z),
    vel: new THREE.Vector3(),
    speed: 2,
    blocked: false,
    blockedFor: 0,
    targetYaw: 0,
    pathVersion: 3,
  }
  const step = (dx, dz, dt = 0.1) => {
    agent.blocked = false
    Astronauts.prototype._walk.call(crew, agent, new THREE.Vector3(dx, 0, dz), Math.hypot(dx, dz), dt, 1)
  }
  return { agent, step }
}

test('the blocked clock runs only while the astronaut is getting nowhere', () => {
  const nav = new Navigation()
  nav.rebuild([], (x, z) => z > 5)

  // Square into the wall, for a hundred frames. `slide` refuses every one of them.
  const { agent, step } = walker(nav, 0, 4.9)
  for (let i = 0; i < 100; i++) step(0, 1)
  assert.equal(agent.blocked, true)
  assert.ok(agent.blockedFor > 8, `stood against it for ${agent.blockedFor.toFixed(1)} s`)
  assert.equal(isStuck(agent.blockedFor, 12), true, 'and that is what gives up')

  // Then it is turned along the wall, and one frame of real walking clears the whole clock.
  step(1, 0)
  assert.equal(agent.blocked, false)
  assert.equal(agent.blockedFor, 0)
  assert.ok(agent.pos.x > 0, 'because it actually went somewhere')
})

test('a walk interrupted by bumps never gives up while it is still making ground', () => {
  const nav = new Navigation()
  nav.rebuild([], (x, z) => z > 5)
  const { agent, step } = walker(nav, 0, 4.9)

  // A minute of it: shoved into the wall for four frames, then walking along it for six, over
  // and over. Sixty refused frames, and the astronaut is plainly not stuck — which is exactly
  // what the old rule could not say, since it only ever asked about the one frame it was on.
  let refused = 0
  let worst = 0
  for (let t = 0; t < 600; t++) {
    if (t % 10 < 4) {
      agent.pos.set(0, 0, 4.9)
      step(0, 1)
    } else {
      step(1, 0)
    }
    if (agent.blocked) refused++
    worst = Math.max(worst, agent.blockedFor)
    assert.equal(isStuck(agent.blockedFor, 12), false, `gave up at frame ${t}`)
  }
  assert.ok(refused > 50, `it really was being refused: ${refused} frames`)
  assert.ok(worst <= 0.1 + 1e-9, `and the clock never built past one frame: ${worst.toFixed(2)} s`)
})

/**
 * Waypoint retirement, on the corner it was getting wrong.
 *
 * A* hands back cell centres, `WAYPOINT_REACHED` is a shade over a cell, so an astronaut
 * cutting the inside of a corner comes within the radius of it before it can see round it.
 * Retiring there aims it at the next waypoint and straight into the wall.
 */
test('a waypoint is retired only once the next leg is one the astronaut can walk', () => {
  const nav = new Navigation()
  // A wall running north from the bottom of the square, ending at z = 0.
  nav.rebuild([], (x, z) => x > 4 && x < 4.6 && z < 0)
  const path = [{ x: 4.3, z: 0.5 }, { x: 8, z: -3 }]

  // Short of the corner: within reach of the waypoint, with the wall still across the next leg.
  assert.equal(retireWaypoints(path, 0, 3.95, 0.2, nav), 0, 'held at the corner')
  assert.equal(nav.lineOfSight(3.95, 0.2, 8, -3), false, 'because that way is a wall')

  // Round it: the same waypoint, the same radius, and now the leg after it is clear.
  assert.equal(retireWaypoints(path, 0, 4.8, 0.3, nav), 1, 'past the corner it moves on')

  // Out of reach of the waypoint entirely, nothing is retired whatever the sight lines say.
  assert.equal(retireWaypoints(path, 0, 0, 0, nav), 0)
  // And the last waypoint is the site itself: arriving is `_step`'s business, not this one's.
  assert.equal(retireWaypoints(path, 1, 8, -3, nav), 1)
})

test('the work ring of a given-up agent is held to the ring it was sent to', () => {
  const anchor = { x: 0, z: 0 }
  assert.equal(workRadius({ x: 3, z: 0 }, anchor, null), 3, 'no give-up: its own distance')
  assert.equal(workRadius({ x: 0.5, z: 0 }, anchor, null), 1.6, 'never inside the building')
  assert.equal(workRadius({ x: 3.5, z: 0 }, anchor, { x: 3, z: 0 }), 3.5, 'a step short is inside the slack')
  assert.equal(workRadius({ x: 30, z: 0 }, anchor, { x: 3, z: 0 }), 4, 'across the map is pulled in')
})

/**
 * A zone that moved does not make its crew walk.
 *
 * Compact — and now an automatic relocation — puts a zone's buildings somewhere else between
 * one frame and the next. The villager used to be handed the new site as an ordinary journey,
 * set off across the map, run out the eight-second give-up somewhere in the middle and sit
 * down in another repo's yard, where `staysGivenUp` then kept it. A zone that teleports takes
 * its people with it.
 */
test('a moved zone puts its crew down at the new spot', () => {
  const agent = {
    ...seated(3),
    pos: new THREE.Vector3(-40, 0, 12),
    groundY: 3.1,
    path: [{ x: 1, z: 1 }],
    pathAt: 2,
    blockedFor: 4,
    doorRetries: 1,
  }
  Astronauts.prototype._updateAgent.call({ nav: { layout: 3 } }, agent, {
    thread: 't',
    status: 'working',
    site: { x: 80, z: -50 },
    teleport: true,
  })

  assert.deepEqual([agent.site.x, agent.site.z], [80, -50])
  assert.deepEqual([agent.pos.x, agent.pos.z], [80, -50], 'standing there, not walking there')
  assert.equal(agent.state, 'at-site')
  assert.equal(agent.gaveUp, null, 'and whatever it gave up on is forgotten')
  assert.equal(agent.groundY, null, 'the ground under it is resampled rather than eased across the map')
  assert.equal(agent.path, null)
  assert.equal(agent.pathAt, 0)
  assert.equal(agent.pathVersion, -1)
  assert.equal(agent.doorRetries, 0)
  assert.equal(agent.blockedFor, 0)
})

test('a teleport beats the give-up memory, which an ordinary poll would not', () => {
  // Same site, same layout: without `teleport` this villager stays exactly where it sat.
  const stays = seated(3)
  Astronauts.prototype._updateAgent.call({ nav: { layout: 3 } }, stays, { thread: 't', site: { x: 4, z: -2 }, status: 'working' })
  assert.deepEqual([stays.site.x, stays.site.z], [1, 1])

  const goes = seated(3)
  Astronauts.prototype._updateAgent.call({ nav: { layout: 3 } }, goes, { thread: 't', site: { x: 4, z: -2 }, status: 'working', teleport: true })
  assert.deepEqual([goes.site.x, goes.site.z], [4, -2], 'the zone moved; the memory does not apply')
  assert.equal(goes.gaveUp, null)
})

test('an arriving or departing villager keeps its journey', () => {
  for (const state of ['spawning', 'leaving']) {
    const agent = { ...seated(3), state, pos: new THREE.Vector3(0, 0, 0) }
    Astronauts.prototype._updateAgent.call({ nav: { layout: 3 } }, agent, {
      thread: 't',
      status: 'working',
      site: { x: 30, z: 30 },
      teleport: true,
    })
    assert.equal(agent.state, state, `${state} is not interrupted`)
    assert.deepEqual([agent.pos.x, agent.pos.z], [0, 0], 'and it was not moved')
  }
})

/**
 * The crew's space-only systems each follow their own feature, and build on their own stream.
 * A whole crew is built here under Node: the face atlas paints on a 2D canvas, so a context
 * that answers every call with nothing stands in for one, and settings read an empty store.
 */
test('the crew builds visor reflections and phone props only for their features, off the global stream', async (t) => {
  const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 40 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}), set: () => true })
  const had = { document: 'document' in globalThis, localStorage: 'localStorage' in globalThis }
  if (!had.document) globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
  if (!had.localStorage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  t.after(() => {
    if (!had.document) delete globalThis.document
    if (!had.localStorage) delete globalThis.localStorage
  })
  const { loadTheme } = await import('../src/themes/registry.js')
  const { resolveFeatures } = await import('../src/core/features.js')
  const { Settings } = await import('../src/core/settings.js')
  const space = await loadTheme({ space: () => import('../src/themes/space/index.js') }, 'space', { baseUrl: '/', validate: () => [] })

  const build = (features) => {
    const real = Math.random
    let draws = 0
    Math.random = function () {
      draws++
      return real.apply(this, arguments)
    }
    try {
      const crew = new Astronauts(new THREE.Scene(), new Settings(), { ...space, features: resolveFeatures(features) })
      return { crew, draws }
    } finally {
      Math.random = real
    }
  }
  const none = build({})
  assert.equal(none.crew.reflectionUniforms, null)
  assert.equal(none.crew.checkProps, null)
  const visor = build({ visor: true })
  assert.ok(visor.crew.reflectionUniforms)
  assert.equal(visor.crew.checkProps, null)
  const phone = build({ phoneCheck: true })
  assert.equal(phone.crew.reflectionUniforms, null)
  assert.ok(phone.crew.checkProps)
  assert.equal(visor.draws, none.draws, 'the visor spends none of the global stream')
  assert.equal(phone.draws, none.draws, 'nor do the phone props')
  // The face screen swaps one material for another, so off and on both have to stay off the
  // global stream for the crew to be seated the same either way.
  assert.equal(build({ faces: true }).draws, none.draws, 'nor does the CRT face')
  const all = build(Object.fromEntries(Object.keys(resolveFeatures()).map((k) => [k, true])))
  assert.ok(all.crew.reflectionUniforms && all.crew.checkProps)
  assert.equal(all.crew._faceAtlasSize(), Math.min(new Settings().textureSize * 2, 1024))
})
