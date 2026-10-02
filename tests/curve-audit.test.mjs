import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every shader in `src/` bends with the world, or is pinned to the camera.
 *
 * The world curve (`core/curve.js`) reaches a material one of two ways. A material three builds
 * from its own chunks bends through the patched `project_vertex`, but only with the uniforms the
 * prototype's `onBeforeCompile` hands it — so a material that installs its own hook has replaced
 * that one and must call `withCurve(shader)` itself, or compose the hook it replaced
 * (`prev?.(shader)`, the kit and fade decorators). A hook that goes further and swaps
 * `project_vertex` for a projection of its own (the badges, the name plates) has dropped the bend
 * with that chunk, so it must also apply `bcBend` itself. A shader written by hand that projects
 * with `projectionMatrix` never sees `project_vertex` at all, so it bends its own world position
 * with `bcBend` — and only behind `curveInstalled()`, because a theme without the curve has no
 * `bcBend` and the program would not compile. Miss any and the thing floats flat over ground
 * that curves away under it: at the default 0.45, 8.5 units at ring 7 on the far side and 20 at the
 * forest's rim (r82).
 *
 * This reads every file under `src/` — found from this file, so a copy of `src/` and `tests/`
 * elsewhere is scanned where it stands — and holds these rules. A hook that genuinely needs no
 * curve goes on `ALLOWED_HOOKS` with its reason; a hand-written shader that is flat by design
 * (it rides with the camera, or draws the whole screen) goes on `PINNED`, read and named.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/**
 * Hooks that may replace the prototype's without the curve: `{ file, hook, reason }`, where
 * `hook` is the assignment's target as written (`mat.onBeforeCompile`). None today: every hook in
 * `src/` calls `withCurve` or composes the one it replaced. An entry that matches no hook fails.
 */
const ALLOWED_HOOKS = []

/**
 * Hand-written vertex shaders that are flat by design: `{ file, marker, what, why }`, matched by
 * a string of the shader's source or of the object literal that holds it, in that file. Each was read, and
 * each entry must still match a shader. The contact shading's pair write clip space outright and
 * are listed so the scan can say every shader that writes `gl_Position` is accounted for.
 */
const PINNED = [
  {
    file: 'src/world/sky.js', marker: 'SKY_VERT', what: 'sky dome',
    why: '`Sky.update` puts the dome on the camera every frame (it reads as infinitely far); bending it would sink the horizon glow',
  },
  {
    file: 'src/world/sky.js', marker: 'gl_PointSize = aSize * vTw', what: 'stars',
    why: 'ride with the camera like the dome (`Sky.update`)',
  },
  {
    file: 'src/world/sky.js', marker: 'uniform vec3 uColor; uniform float uStrength', what: 'companion halo',
    why: 'the companion group is re-parked at the camera plus a fixed offset every frame (`Sky.update`)',
  },
  {
    file: 'src/core/engine.js', marker: 'GRADE_SHADER', what: 'colour grade',
    why: 'a post pass: `ShaderPass` draws it on a full-screen quad with its own orthographic camera',
  },
  {
    file: 'src/core/tiltshift.js', marker: 'COC_FROM_DEPTH', what: 'tilt-shift',
    why: 'a post pass on a full-screen quad; it reads the scene depth, which the curve has already bent',
  },
  {
    file: 'src/core/occlusion.js', marker: 'gl_Position = vec4(position.xy, 0.0, 1.0)', what: 'contact occlusion',
    why: 'a post pass that writes clip space directly (both its materials); it reads the bent scene depth',
  },
]

// ── the lexer ───────────────────────────────────────────────────────────────────────────

/**
 * JavaScript, told apart from what is not: `{ text, code }`, where `text` is the source with its
 * comments blanked (newlines kept, so offsets and line numbers hold) and `code[i]` is 1 where the
 * character is JavaScript — 0 in a comment, a string, a template's text or a regex literal. A
 * template's `${ … }` is JavaScript again. Enough of a lexer for the two rules: a hook is found
 * only in code, a body's braces are counted only in code, and `withCurve(` in a comment does not
 * count. Regex literals are told from division by the token before them, as a parser would.
 */
function lex(source) {
  const n = source.length
  const chars = source.split('')
  const code = new Uint8Array(n)
  let last = ''
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (chars[k] !== '\n') chars[k] = ' '
  }
  const regexMayStart = () =>
    last === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /^(return|typeof|case|in|of|new|delete|void|throw|yield|await)$/.test(last)

  const quoted = (i, q) => {
    let j = i + 1
    while (j < n && source[j] !== q && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1
    return j + 1
  }
  const regex = (i) => {
    let j = i + 1
    let inClass = false
    while (j < n && source[j] !== '\n') {
      const c = source[j]
      if (c === '\\') j += 2
      else if (c === '[') (inClass = true), j++
      else if (c === ']') (inClass = false), j++
      else if (c === '/' && !inClass) {
        j++
        break
      } else j++
    }
    while (j < n && /[a-z]/.test(source[j])) j++
    return j
  }
  const template = (i) => {
    while (i < n) {
      const c = source[i]
      if (c === '\\') i += 2
      else if (c === '`') return i + 1
      else if (c === '$' && source[i + 1] === '{') {
        code[i] = code[i + 1] = 1
        last = '{'
        i = javascript(i + 2, true)
        if (i < n) code[i] = 1
        i++
      } else i++
    }
    return i
  }
  // Code up to the end, or (nested, inside a template's `${`) up to the brace that closes it.
  function javascript(i, nested) {
    let depth = 0
    while (i < n) {
      const c = source[i]
      const d = source[i + 1]
      if (c === '/' && d === '/') {
        const e = source.indexOf('\n', i)
        const end = e < 0 ? n : e
        blank(i, end)
        i = end
      } else if (c === '/' && d === '*') {
        const e = source.indexOf('*/', i + 2)
        const end = e < 0 ? n : e + 2
        blank(i, end)
        i = end
      } else if (c === "'" || c === '"') {
        i = quoted(i, c)
        last = 'x'
      } else if (c === '`') {
        i = template(i + 1)
        last = 'x'
      } else if (c === '/' && regexMayStart()) {
        i = regex(i)
        last = 'x'
      } else if (/[\w$]/.test(c)) {
        let j = i
        while (j < n && /[\w$]/.test(source[j])) code[j++] = 1
        last = source.slice(i, j)
        i = j
      } else {
        code[i] = 1
        if (nested && c === '{') depth++
        else if (nested && c === '}') {
          if (depth === 0) return i
          depth--
        }
        if (!/\s/.test(c)) last = c
        i++
      }
    }
    return i
  }

  javascript(0, false)
  return { text: chars.join(''), code }
}

/** The same text with everything that is not JavaScript blanked: what a hook body is judged on. */
const codeOnly = ({ text, code }, a, b) => {
  let out = ''
  for (let i = a; i < b; i++) out += code[i] || text[i] === '\n' ? text[i] : ' '
  return out
}

/** Index just past the brace, bracket or paren matching the one at `open`, counting code only. */
function matching(lexed, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' }
  const o = lexed.text[open]
  const c = pairs[o]
  let depth = 0
  for (let i = open; i < lexed.text.length; i++) {
    if (!lexed.code[i]) continue
    if (lexed.text[i] === o) depth++
    else if (lexed.text[i] === c && --depth === 0) return i + 1
  }
  return lexed.text.length
}

const skipSpace = (text, i) => {
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}
const lineOf = (text, i) => text.slice(0, i).split('\n').length
/** A name, escaped for a regular expression: an identifier may hold `$`. */
const literal = (name) => name.replace(/\$/g, '\\$')

/**
 * The function a value starting at `i` is: `[from, to]` of its body — braces included, or the
 * expression of an arrow with none — or, for a bare name, the function that name is declared as in
 * the same file. Null when it cannot be read as one.
 */
function functionAt(lexed, i, seen = new Set()) {
  const { text } = lexed
  i = skipSpace(text, i)
  const name = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))?.[0]
  if (name && name !== 'function' && name !== 'async' && !/^\s*=>/.test(text.slice(i + name.length))) {
    if (seen.has(name)) return null
    seen.add(name)
    const decl = new RegExp(`(?:\\bfunction\\s+${literal(name)}\\s*(?=\\()|\\b(?:const|let|var)\\s+${literal(name)}\\s*=)`, 'g')
    for (let m; (m = decl.exec(text)); ) {
      if (!lexed.code[m.index]) continue
      const at = m[0].endsWith('=') ? m.index + m[0].length : m.index
      return functionAt(lexed, at, seen)
    }
    return null
  }
  // `function (…) {`, or an arrow: find the `=>` or the parameter list's close, then the body.
  let p = i
  if (text.startsWith('async', p)) p = skipSpace(text, p + 5)
  if (text.startsWith('function', p)) {
    const paren = text.indexOf('(', p)
    const brace = skipSpace(text, matching(lexed, paren))
    return text[brace] === '{' ? [brace, matching(lexed, brace)] : null
  }
  const arrow = text.indexOf('=>', p)
  if (arrow < 0) return null
  const body = skipSpace(text, arrow + 2)
  if (text[body] === '{') return [body, matching(lexed, body)]
  // An expression body runs to the end of its line or statement, at depth 0.
  let depth = 0
  for (let k = body; k < text.length; k++) {
    if (!lexed.code[k]) continue
    const c = text[k]
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) {
      if (depth === 0) return [body, k]
      depth--
    } else if (depth === 0 && (c === ';' || c === '\n' || c === ',')) return [body, k]
  }
  return [body, text.length]
}

/**
 * The expression a value starting at `i` is, read as far as the scan needs: a template literal,
 * a name, or a call of a name on one of those. `{ text, wrapper, end }`, where `text` is the
 * resolved shader source (a name is followed to its `const` in the same file) and `wrapper` names
 * the function a call passes it through (`unbent(SEA_VERT)`); null text when it cannot be read.
 */
function shaderValue(lexed, i) {
  const { text } = lexed
  i = skipSpace(text, i)
  if (text[i] === '`') {
    let depth = 0
    let k = i + 1
    for (; k < text.length; k++) {
      if (lexed.code[k] && text[k] === '{') depth++
      else if (lexed.code[k] && text[k] === '}') depth--
      else if (!lexed.code[k] && depth === 0 && text[k] === '`' && text[k - 1] !== '\\') break
    }
    return { text: text.slice(i, k + 1), wrapper: null, end: k + 1 }
  }
  const name = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))?.[0]
  if (!name) return { text: null, wrapper: null, end: i }
  const after = skipSpace(text, i + name.length)
  if (text[after] === '(') {
    const inner = shaderValue(lexed, after + 1)
    return { text: inner.text, wrapper: name, end: matching(lexed, after) }
  }
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${literal(name)}\\s*=`, 'g')
  for (let m; (m = decl.exec(text)); ) {
    if (!lexed.code[m.index]) continue
    const value = shaderValue(lexed, m.index + m[0].length)
    return { text: value.text, wrapper: value.wrapper, end: i + name.length, name }
  }
  return { text: null, wrapper: null, end: i + name.length, name }
}

/**
 * The object literal a key at `i` sits in, from the start of the line it opens on (so a
 * `const GRADE_SHADER = {` brings its name along) to its closing brace; '' outside one.
 */
function owner(lexed, i) {
  let depth = 0
  for (let k = i - 1; k >= 0; k--) {
    if (!lexed.code[k]) continue
    const c = lexed.text[k]
    if ('}])'.includes(c)) depth++
    else if ('{[('.includes(c)) {
      if (depth === 0) return c === '{' ? lexed.text.slice(lexed.text.lastIndexOf('\n', k) + 1, matching(lexed, k)) : ''
      depth--
    }
  }
  return ''
}

/** The text a `const`/`function` named `name` is declared with in the file, or ''. */
function declaration(lexed, name) {
  const decl = new RegExp(`(?:\\bfunction\\s+${literal(name)}\\s*\\(|\\b(?:const|let|var)\\s+${literal(name)}\\s*=)`, 'g')
  for (let m; (m = decl.exec(lexed.text)); ) {
    if (!lexed.code[m.index]) continue
    const end = lexed.text.indexOf('\n\n', m.index)
    return lexed.text.slice(m.index, end < 0 ? lexed.text.length : end)
  }
  return ''
}

/**
 * Whether a hook body (`span`) replaces three's `#include <project_vertex>` with a projection of
 * its own, and if so whether that projection bends: `{ at, bent }` for the first replacement
 * that drops the include, or null. A replacement that keeps the include (appends after it, as the
 * visor reflections do) still projects through the patched chunk and is not one. The replacement
 * is read as written — strings, templates and both arms of a ternary — and a bare name in it is
 * followed to its declaration in the same file, so a projection kept in a `const` is judged too.
 */
function projectsByHand(lexed, [from, to]) {
  const { text } = lexed
  const call = /\.replace\(\s*(['"`])#include <project_vertex>\1\s*,/g
  call.lastIndex = from
  for (let m; (m = call.exec(text)) && m.index < to; ) {
    if (!lexed.code[m.index]) continue
    const open = m.index + m[0].indexOf('(')
    const start = m.index + m[0].length
    const arg = text.slice(start, matching(lexed, open) - 1)
    if (arg.includes('#include <project_vertex>')) continue
    const names = [...codeOnly(lexed, start, start + arg.length).matchAll(/[A-Za-z_$][\w$]*/g)].map((n) => n[0])
    const named = names.map((name) => declaration(lexed, name)).join('\n')
    return { at: m.index, bent: /\bbcBend\s*\(/.test(`${arg}\n${named}`) }
  }
  return null
}

// ── the two rules ───────────────────────────────────────────────────────────────────────

/**
 * Scan a set of files (`{ 'src/…': text }`) and return what was found and what is wrong:
 * `{ hooks, shaders, problems }`. Each problem is a sentence naming `file:line`.
 */
function audit(files, { allowedHooks = ALLOWED_HOOKS, pinned = PINNED } = {}) {
  const hooks = []
  const shaders = []
  const problems = []
  const usedAllow = new Set()
  const usedPin = new Set()

  for (const [file, source] of Object.entries(files)) {
    if (!/onBeforeCompile|vertexShader|ShaderMaterial/.test(source)) continue
    const lexed = lex(source)
    const { text } = lexed

    // Rule 1: every assignment to `onBeforeCompile` bends or composes.
    const assign = /([\w$.[\]'"]*)\.onBeforeCompile\s*=(?!=)/g
    for (let m; (m = assign.exec(text)); ) {
      const dot = m.index + m[1].length
      if (!lexed.code[dot]) continue
      const hook = `${m[1]}.onBeforeCompile`
      const line = lineOf(text, m.index)
      const span = functionAt(lexed, m.index + m[0].length)
      const body = span ? codeOnly(lexed, span[0], span[1]) : ''
      const bends = /\bwithCurve\s*\(/.test(body) ? 'withCurve' : /\bprev\?\.\(/.test(body) ? 'prev' : null
      const projects = span ? projectsByHand(lexed, span) : null
      hooks.push({ file, line, hook, bends, projects: Boolean(projects) })
      const allowed = allowedHooks.findIndex((a) => a.file === file && a.hook === hook)
      // Rule 1b: `withCurve` hands the hook the uniforms, but a hook that swaps three's
      // `project_vertex` for its own projection has thrown the bend away with it, and has to
      // put it back with `bcBend` (the badges and the name plates both do).
      if (projects && !projects.bent && allowed < 0)
        problems.push(`${file}:${lineOf(text, projects.at)} ${hook} replaces #include <project_vertex> without bcBend — it projects flat over bent ground`)
      if (bends) continue
      if (allowed >= 0) {
        usedAllow.add(allowed)
        continue
      }
      problems.push(
        span
          ? `${file}:${line} ${hook} replaces the prototype's hook without calling withCurve( or composing prev?.( — it will not bend with the world`
          : `${file}:${line} ${hook} is assigned something the scan cannot read as a function`
      )
    }

    // Rule 2: every hand-written vertex shader that writes gl_Position bends behind
    // curveInstalled(), or is pinned.
    const key = /\bvertexShader\b/g
    for (let m; (m = key.exec(text)); ) {
      if (!lexed.code[m.index]) continue
      let b = m.index - 1
      while (b >= 0 && /\s/.test(text[b])) b--
      if (text[b] !== '{' && text[b] !== ',') continue // `shader.vertexShader`, not an object key
      const after = skipSpace(text, m.index + m[0].length)
      const line = lineOf(text, m.index)
      const value = text[after] === ':' ? shaderValue(lexed, after + 1) : shaderValue(lexed, m.index)
      const expr = text.slice(text[after] === ':' ? after + 1 : m.index, value.end).trim()
      const label = expr.startsWith('`') ? '(inline)' : expr
      if (value.text === null) {
        problems.push(`${file}:${line} vertexShader ${label} cannot be followed to its source in this file`)
        continue
      }
      if (!/gl_Position\s*=/.test(value.text)) continue
      const guard = value.text.includes('curveInstalled()') || (value.wrapper && declaration(lexed, value.wrapper).includes('curveInstalled()'))
      const bent = /\bbcBend\s*\(/.test(value.text) && Boolean(guard)
      const context = `${owner(lexed, m.index)}\n${value.text}`
      const pin = pinned.findIndex((p) => p.file === file && context.includes(p.marker))
      shaders.push({ file, line, shader: label, bent, pinned: pin >= 0 ? pinned[pin].what : null })
      if (bent) continue
      if (pin >= 0) {
        usedPin.add(pin)
        continue
      }
      problems.push(
        /\bbcBend\s*\(/.test(value.text)
          ? `${file}:${line} vertexShader ${label} calls bcBend without asking curveInstalled() — it will not compile where the curve is not installed`
          : `${file}:${line} vertexShader ${label} writes gl_Position without bcBend and is not on the pinned list — it will not bend with the world`
      )
    }

    // A ShaderMaterial with no vertex shader of its own gets three's default, which projects flat.
    const material = /\bnew\s+(?:THREE\.)?(?:Raw)?ShaderMaterial\s*\(/g
    for (let m; (m = material.exec(text)); ) {
      if (!lexed.code[m.index]) continue
      const open = m.index + m[0].length - 1
      const arg = codeOnly(lexed, open, matching(lexed, open))
      if (!/\bvertexShader\b|\.\.\.|^\(\s*[\w$.]+\s*\)$/.test(arg.trim()))
        problems.push(`${file}:${lineOf(text, m.index)} a ShaderMaterial with no vertexShader gets three's default, which never bends`)
    }
  }

  allowedHooks.forEach((a, k) => {
    if (!usedAllow.has(k)) problems.push(`ALLOWED_HOOKS lists ${a.file} ${a.hook}, which no longer needs it`)
  })
  pinned.forEach((p, k) => {
    if (!usedPin.has(k)) problems.push(`PINNED lists the ${p.what} in ${p.file} (${p.marker}), which the scan no longer finds`)
  })
  return { hooks, shaders, problems }
}

/** Every file under `src/`, keyed by its path from the repo root with forward slashes. */
function sources() {
  const root = join(SRC, '..')
  const out = {}
  for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out[relative(root, path).split('\\').join('/')] = readFileSync(path, 'utf8')
  }
  return out
}

// ── the tests ───────────────────────────────────────────────────────────────────────────

test('every shader in src/ bends with the world or is pinned to the camera', () => {
  const files = sources()
  const { hooks, shaders, problems } = audit(files)
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`)

  // The scan has to have seen what it is guarding, or an empty result proves nothing: a lexer
  // that lost its place in a file would find no hooks there and pass.
  assert.ok(Object.keys(files).length > 50, `only ${Object.keys(files).length} files under src/`)
  assert.ok(hooks.length >= 20, `only ${hooks.length} onBeforeCompile hooks found`)
  const hookIn = (file) => hooks.filter((h) => h.file === file)
  assert.equal(hookIn('src/agents/crew.js').length, 1, 'the villager material (decorateSkinned)')
  assert.equal(hookIn('src/agents/astronauts.js').length, 2, "the face materials (_faceMaterial and the CRT's)")
  assert.ok(hookIn('src/world/hexisland.js').every((h) => h.bends === 'withCurve'), 'hexisland assigns a named decorator')
  assert.ok(hooks.some((h) => h.bends === 'prev'), 'the kit and fade decorators compose prev')
  // The two hooks that write their own projection, found and judged by rule 1b.
  assert.deepEqual(
    hooks.filter((h) => h.projects).map((h) => h.file).sort(),
    ['src/agents/indicators.js', 'src/world/plots.js'],
    'the badges and the name plates replace project_vertex'
  )
  assert.ok(shaders.filter((s) => s.bent).length >= 3, 'the particles, the cloud sea and its puffs bend by hand')
  assert.ok(shaders.length >= 10, `only ${shaders.length} hand-written vertex shaders found`)
})

test('the scan bites: a bare onBeforeCompile fails it and names the file', () => {
  const bare = `
    const mat = new THREE.MeshStandardMaterial()
    // withCurve(shader) belongs in here, but a comment is not a call.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTint = { value: 1 }
      shader.vertexShader = shader.vertexShader.replace('#include <common>', \`#include <common>
        uniform float uTint; // { a brace in GLSL
      \`)
    }
  `
  const { hooks, problems } = audit({ 'src/fixture.js': bare }, { allowedHooks: [], pinned: [] })
  assert.equal(hooks.length, 1)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^src\/fixture\.js:4 mat\.onBeforeCompile .*withCurve/)

  // The same hook bending, composing, or allowed with a reason passes.
  const bending = bare.replace('shader.uniforms.uTint', 'withCurve(shader)\n      shader.uniforms.uTint')
  assert.deepEqual(audit({ 'src/fixture.js': bending }, { pinned: [] }).problems, [])
  const composing = bare.replace('shader.uniforms.uTint', 'prev?.(shader)\n      shader.uniforms.uTint')
  assert.deepEqual(audit({ 'src/fixture.js': composing }, { pinned: [] }).problems, [])
  const allowed = [{ file: 'src/fixture.js', hook: 'mat.onBeforeCompile', reason: 'fixture' }]
  assert.deepEqual(audit({ 'src/fixture.js': bare }, { allowedHooks: allowed, pinned: [] }).problems, [])

  // A hook assigned by name is judged on the function the name is declared as.
  const named = `
    const decorate = (shader) => { shader.uniforms.uTime = { value: 0 } }
    material.onBeforeCompile = decorate
    depth.onBeforeCompile = decorate
  `
  assert.equal(audit({ 'src/named.js': named }, { allowedHooks: [], pinned: [] }).problems.length, 2)
  assert.deepEqual(audit({ 'src/named.js': named.replace('{ shader', '{ withCurve(shader); shader') }, { pinned: [] }).problems, [])
})

test('the scan bites: a hook that projects by hand has to bend with bcBend', () => {
  // withCurve( is there, so rule 1 is satisfied; the projection it swaps in is flat.
  const flat = `
    mat.onBeforeCompile = (shader) => {
      withCurve(shader)
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        \`vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
         gl_Position = projectionMatrix * mvPosition;\`
      )
    }
  `
  const none = { allowedHooks: [], pinned: [] }
  const { hooks, problems } = audit({ 'src/plate.js': flat }, none)
  assert.equal(hooks[0].projects, true)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^src\/plate\.js:4 mat\.onBeforeCompile replaces #include <project_vertex> without bcBend/)

  // Bending the anchor passes, inline or through a guarded ternary as the name plates do.
  const bent = flat.replace('modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 )', 'viewMatrix * vec4( bcBend( ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz ), 1.0 )')
  assert.deepEqual(audit({ 'src/plate.js': bent }, none).problems, [])
  // A projection kept in a const is followed to it: flat fails, bent passes.
  const named = `
    const PROJECT = \`vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );\`
    mat.onBeforeCompile = (shader) => {
      withCurve(shader)
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', PROJECT)
    }
  `
  assert.equal(audit({ 'src/plate.js': named }, none).problems.length, 1)
  const namedBent = named.replace('modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 )', 'viewMatrix * vec4( bcBend( position ), 1.0 )')
  assert.deepEqual(audit({ 'src/plate.js': namedBent }, none).problems, [])
  // A hook that keeps the include and appends after it still projects through the patched chunk.
  const appending = flat.replace('\`vec4 mvPosition', '\`#include <project_vertex>\n         vec4 mvPosition')
  assert.equal(audit({ 'src/plate.js': appending }, none).hooks[0].projects, false)
  assert.deepEqual(audit({ 'src/plate.js': appending }, none).problems, [])
  // bcBend in a comment is not a bend.
  const commented = flat.replace('withCurve(shader)', 'withCurve(shader) // bcBend( later')
  assert.equal(audit({ 'src/plate.js': commented }, none).problems.length, 1)
})

test('the scan bites: a hand-projected shader has to bend behind curveInstalled() or be pinned', () => {
  const flat = `
    const VERT = /* glsl */ \`
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }\`
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG })
  `
  const none = { allowedHooks: [], pinned: [] }
  assert.match(audit({ 'src/flat.js': flat }, none).problems[0], /^src\/flat\.js:6 vertexShader VERT writes gl_Position without bcBend/)
  const pinned = [{ file: 'src/flat.js', marker: 'VERT', what: 'fixture', why: 'fixture' }]
  assert.deepEqual(audit({ 'src/flat.js': flat }, { allowedHooks: [], pinned }).problems, [])

  // bcBend alone is not enough: without curveInstalled() the program fails to compile in a theme
  // that never installs the curve.
  const bentBare = flat.replace('projectionMatrix * modelViewMatrix * vec4( position, 1.0 )', 'projectionMatrix * viewMatrix * vec4( bcBend( position ), 1.0 )')
  assert.match(audit({ 'src/bent.js': bentBare }, none).problems[0], /calls bcBend without asking curveInstalled\(\)/)
  // Guarded inline, or through a wrapper that asks, as the particles and the cloud sea do.
  const inline = bentBare.replace('bcBend( position )', "${curveInstalled() ? 'bcBend( position )' : 'position'}")
  assert.deepEqual(audit({ 'src/bent.js': inline }, none).problems, [])
  const wrapped = `const unbent = (glsl) => (curveInstalled() ? glsl : glsl.replace(/bcBend\\(/g, '('))\n${bentBare.replace('vertexShader: VERT', 'vertexShader: unbent(VERT)')}`
  assert.deepEqual(audit({ 'src/bent.js': wrapped }, none).problems, [])

  // A ShaderMaterial with no vertex shader of its own draws with three's flat default.
  assert.match(audit({ 'src/default.js': 'const m = new THREE.ShaderMaterial({ fragmentShader: FRAG })' }, none).problems[0], /no vertexShader/)
})
