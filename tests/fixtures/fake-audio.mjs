/**
 * A recording stand-in for a Web Audio context, so a synth recipe can be built and checked in
 * Node without a browser.
 *
 * It keeps what a real context would throw on or quietly get wrong as `problems`: an exponential
 * ramp to zero, a non-finite value or time, a time constant ≤ 0, and a ramp placed straight
 * after `setTargetAtTime` (which replaces the curve instead of continuing from it). Every node
 * remembers where it is connected and when it starts and stops, and every param its automation,
 * so a test can ask what a gain is at a given moment (`valueAt`) and whether a stopped
 * oscillator reaches the output through a gain already at 0 (`silentAtStop`). It proves a recipe
 * is well formed, not that it sounds right.
 */

const RAMPS = new Set(['linear', 'exponential'])

function param(name, value, problems) {
  const finite = (x, what) => Number.isFinite(x) || problems.push(`${name}.${what}: non-finite ${x}`)
  const p = {
    value,
    events: [],
    connect() {},
    _add(e) {
      // After any events already at the same time, as a real timeline orders them.
      let i = p.events.length
      while (i > 0 && p.events[i - 1].time > e.time) i--
      p.events.splice(i, 0, e)
      if (RAMPS.has(e.type) && p.events[i - 1]?.type === 'target') {
        problems.push(`${name}: a ${e.type} ramp at ${e.time.toFixed(3)} s straight after setTargetAtTime replaces the curve`)
      }
      return p
    },
    setValueAtTime(v, t) {
      finite(v, 'setValueAtTime value')
      finite(t, 'setValueAtTime time')
      return p._add({ type: 'set', value: v, time: t })
    },
    linearRampToValueAtTime(v, t) {
      finite(v, 'linearRamp value')
      finite(t, 'linearRamp time')
      return p._add({ type: 'linear', value: v, time: t })
    },
    exponentialRampToValueAtTime(v, t) {
      finite(t, 'exponentialRamp time')
      if (!(v > 0) && !(v < 0)) problems.push(`${name}.exponentialRampToValueAtTime to ${v}`)
      return p._add({ type: 'exponential', value: v, time: t })
    },
    setTargetAtTime(v, t, tau) {
      finite(v, 'setTarget value')
      finite(t, 'setTarget time')
      if (!(tau > 0)) problems.push(`${name}.setTargetAtTime time constant ${tau}`)
      return p._add({ type: 'target', value: v, time: t, tau })
    },
    cancelScheduledValues(t) {
      p.events = p.events.filter((e) => e.time < t)
      return p
    },
  }
  return p
}

/**
 * What an automated param holds at time `t`, by the Web Audio rules: a ramp runs from the
 * previous event's time and value; `setTargetAtTime` approaches its target until the next
 * event; and a ramp straight after a `setTargetAtTime` starts where that curve would have
 * started, replacing it.
 */
export function valueAt(p, t) {
  const ev = p.events
  let v = p.value
  let from = 0
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]
    const next = ev[i + 1]
    if (e.type === 'target') {
      if (t < e.time) return v
      if (next && RAMPS.has(next.type)) {
        from = e.time
        continue
      }
      const until = next ? next.time : Infinity
      const reached = e.value + (v - e.value) * Math.exp(-(Math.min(t, until) - e.time) / e.tau)
      if (t < until) return reached
      v = reached
      from = until
      continue
    }
    if (e.time > t) {
      if (e.type === 'linear') return v + ((e.value - v) * (t - from)) / (e.time - from)
      if (e.type === 'exponential') return v * Math.pow(e.value / v, (t - from) / (e.time - from))
      return v
    }
    v = e.value
    from = e.time
  }
  return v
}

/**
 * Whether every way from `node` to the output passes through a gain that is exactly 0 at
 * `node`'s stop time. A stopped oscillator that fails this stops while still sounding: a tick.
 */
export function silentAtStop(node) {
  const t = node.stopAt
  const walk = (n, seen) => {
    if (n.kind === 'gain' && n !== node && valueAt(n.gain, t) === 0) return true
    if (seen.has(n)) return true
    seen.add(n)
    // The end of the line (the voice's destination, or a param) without passing a silent gain.
    if (!n.outputs || !n.outputs.length) return false
    return n.outputs.every((o) => walk(o, seen))
  }
  return walk(node, new Set())
}

/** A fresh context. `currentTime` is plain data: set it to move time. */
export function createFakeAudio(sampleRate = 48000) {
  const problems = []
  const nodes = []
  const node = (kind, extra = {}) => {
    const n = {
      kind,
      outputs: [],
      startAt: undefined,
      stopAt: undefined,
      connect(d) {
        n.outputs.push(d)
        return d
      },
      disconnect() {
        n.outputs.length = 0
      },
      start(when) {
        n.startAt = when
      },
      stop(when) {
        n.stopAt = when
      },
      ...extra,
    }
    nodes.push(n)
    return n
  }
  const ctx = {
    sampleRate,
    currentTime: 0,
    createGain: () => node('gain', { gain: param('gain', 1, problems) }),
    createBiquadFilter: () =>
      node('filter', { type: 'lowpass', frequency: param('frequency', 350, problems), Q: param('Q', 1, problems) }),
    createOscillator: () => node('oscillator', { type: 'sine', frequency: param('frequency', 440, problems) }),
    createBufferSource: () => node('buffer', { buffer: null, loop: false }),
    createBuffer: (channels, length, rate) => {
      const data = new Float32Array(length)
      return { duration: length / rate, length, sampleRate: rate, getChannelData: () => data }
    },
  }
  ctx.destination = node('destination')
  return { ctx, problems, nodes }
}
