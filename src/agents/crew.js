import * as THREE from 'three'
import { withCurve } from '../core/curve.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { crewCharacters } from './cast.js'

/**
 * Real skeletal animation for the whole crew, in one draw call.
 *
 * The body is KayKit's Mannequin_Medium and the motion is KayKit's Character Animations
 * (both CC0) — hand-authored walk cycles, hammering, sitting, cheering. What they are not
 * is instanceable: three skins a `SkinnedMesh` from a `Skeleton` object, one skeleton per
 * character, which for three hundred threads means three hundred draw calls and three
 * hundred skeletons stepped on the CPU every frame.
 *
 * So the animation is **baked once, at load, into a bone-matrix texture**. Every clip is
 * sampled at a fixed rate and each frame's twenty-one skinning matrices are written into a
 * float texture. At draw time one `InstancedMesh` carries the whole crew, and each instance
 * reads its own row of that texture from a single per-instance float — the frame it is on.
 * Skinning happens in the vertex shader against a texture fetch rather than against a
 * uniform block that would have to be re-uploaded per character.
 *
 * The cost is a texture of about a megabyte and a second of work at boot. What it buys is
 * that the crew costs the same whether there are six of them or six hundred.
 *
 * Because the matrices also sit in an ordinary array on the CPU, anything that has to ride
 * *on* a bone — the helmet, the visor, the backpack — can be placed by reading one matrix
 * out of it, with no skeleton to evaluate. See `boneMatrixAt()`.
 */

/** Sampling rate for the bake. Fast enough that the shader's lerp has nothing to hide. */
const BAKE_FPS = 30

/** Floats per bone in the texture: a full mat4, four RGBA texels. */
const TEXELS_PER_BONE = 4

/**
 * Which file the crew comes out of, which clips are worth baking and which bones things
 * hang off are all theme data. `configureCrew` installs `manifest.crew` before `loadCrew`
 * runs; nothing in here knows what an astronaut is.
 */
let SPEC = null
let CREW_URL = ''

/**
 * Attachment roles in slot order, and the bones behind them.
 *
 * A worn part asks for a *role* — a helmet wants "the head" — so `attachSlot` is keyed by
 * role and a theme rigged differently only has to rename its bones in the manifest. Their
 * *world* transforms are baked into a small side-table on the CPU as well, because a helmet
 * does not want the skinning matrix: it wants to know where the head actually is. Three
 * bones over the whole animation set is a hundred and forty kilobytes; the alternative is
 * evaluating a skeleton per astronaut per frame.
 */
let ROLES = []
let ATTACH = []

let loading = null
let rig = null

/**
 * Install a theme's crew spec. Must run before `loadCrew()`.
 *
 * @param {object} spec  `manifest.crew`
 * @param {string} url   where its glb is served from
 */
export function configureCrew(spec, url) {
  SPEC = spec
  CREW_URL = url
  ROLES = Object.keys(spec.attach)
  ATTACH = ROLES.map((r) => spec.attach[r])
  loading = null
  rig = null
}

/** Load and bake the rig. Idempotent — the first caller owns the work. */
export function loadCrew() {
  if (!loading) loading = bake().then((r) => (rig = r))
  return loading
}

/** The baked rig, or null if `loadCrew()` has not resolved yet. */
export function crewRig() {
  return rig
}

/**
 * Apply a tweak table to a clip: a new clip, the source untouched (upstream 259f434).
 *
 * Per bone: `scale` multiplies how far the bone strays from its reference keyframe — the
 * first, or with `ref: 'far'` the one farthest from it — `offset` turns it by a fixed Euler
 * on top, and `ramp` fades that offset in over so many seconds (out, when negative). Only a
 * clip whose manifest entry names a `tweak` comes through here, so a theme without one bakes
 * exactly the clips it always baked.
 */
function tweakClip(clip, table, key) {
  const plainName = (n) => n.replace(/[.\s_]/g, '').toLowerCase()
  const id = new THREE.Quaternion()
  const q = new THREE.Quaternion()
  const q0 = new THREE.Quaternion()
  const inv0 = new THREE.Quaternion()
  const d = new THREE.Quaternion()
  const d2 = new THREE.Quaternion()
  const off = new THREE.Quaternion()
  const off2 = new THREE.Quaternion()
  const tracks = clip.tracks.map((track) => {
    if (!track.name.endsWith('.quaternion')) return track
    const bone = track.name.slice(0, -'.quaternion'.length)
    const entry = Object.entries(table).find(([name]) => plainName(name) === plainName(bone))
    if (!entry) return track
    const t = entry[1]
    const values = Float32Array.from(track.values)
    const times = track.times
    let refAt = 0
    if (t.ref === 'far') {
      q0.fromArray(values, 0)
      let best = -1
      for (let i = 4; i < values.length; i += 4) {
        q.fromArray(values, i)
        const ang = q0.angleTo(q)
        if (ang > best) {
          best = ang
          refAt = i
        }
      }
    }
    q0.fromArray(values, refAt)
    inv0.copy(q0).invert()
    if (t.offset) off.setFromEuler(new THREE.Euler(t.offset[0], t.offset[1], t.offset[2]))
    for (let i = 0, k = 0; i < values.length; i += 4, k++) {
      q.fromArray(values, i)
      if (t.scale !== undefined) {
        d.copy(inv0).multiply(q)
        d2.slerpQuaternions(id, d, t.scale)
        q.copy(q0).multiply(d2)
      }
      if (t.offset) {
        let f = 1
        if (t.ramp) {
          const time = times[k]
          f = t.ramp > 0 ? Math.min(1, time / t.ramp) : Math.max(0, 1 - time / -t.ramp)
          f = f * f * (3 - 2 * f)
        }
        off2.slerpQuaternions(id, off, f)
        q.multiply(off2)
      }
      q.toArray(values, i)
    }
    return new THREE.QuaternionKeyframeTrack(track.name, Float32Array.from(times), values)
  })
  return new THREE.AnimationClip(`${clip.name}:${key}`, clip.duration, tracks)
}

async function bake(dropMeshes = SPEC.dropMeshes) {
  const gltf = await new GLTFLoader().loadAsync(CREW_URL)
  const root = gltf.scene
  root.updateMatrixWorld(true)

  const skinned = []
  const statics = []
  root.traverse((o) => {
    if (o.isSkinnedMesh) skinned.push(o)
    else if (o.isMesh) statics.push(o)
  })
  if (!skinned.length) throw new Error('crew: crew.glb has no skinned mesh')

  const skeleton = skinned[0].skeleton
  const bones = skeleton.bones
  const boneIndex = new Map(bones.map((b, i) => [b.name, i]))

  // A textured crew (several characters, each painted from its row of the packer's atlas)
  // keeps its UVs and that atlas; the space mannequin drops both and is painted from the
  // suit palette instead.
  const textured = Boolean(SPEC.characters?.length)
  const characters = crewCharacters(SPEC)
  const geometries = new Map()
  for (const c of characters) {
    // A single-body crew merges every skinned mesh; a character merges the meshes whose
    // name starts with its `mesh` prefix (the packer names them `<mesh>_<Part>`).
    const mine = c.mesh ? skinned.filter((m) => m.name === c.mesh || m.name.startsWith(`${c.mesh}_`)) : skinned
    if (!mine.length) throw new Error(`crew: no skinned mesh named "${c.mesh}" for character "${c.id}"`)
    geometries.set(c.id, mergeBody(mine, dropMeshes, textured))
  }

  const texture = textured ? findCrewTexture(skinned) : null
  const props = new Map()
  for (const mesh of statics) props.set(mesh.name, bakeStatic(mesh))

  const bake = bakeClips(root, skeleton, skinned[0], gltf.animations)

  return { geometry: geometries.values().next().value, geometries, texture, props, bones, boneIndex, ...bake }
}

/** The atlas the packer embedded: the first skinned mesh's map, filtered like a kit atlas. */
function findCrewTexture(skinned) {
  const t = skinned.find((m) => m.material?.map)?.material.map ?? null
  if (!t) throw new Error('crew: characters declared but crew.glb carries no texture')
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 4
  return t
}

/** A static (unskinned) node baked into its own local frame, with position, normal and uv. */
function bakeStatic(mesh) {
  const geo = new THREE.BufferGeometry()
  const src = mesh.geometry
  const count = src.attributes.position.count
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['uv', 2],
  ]) {
    const a = src.getAttribute(name)
    const data = new Float32Array(count * size)
    if (a) for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) data[i * size + k] = a.getComponent(i, k)
    geo.setAttribute(name, new THREE.BufferAttribute(data, size))
  }
  if (src.index) geo.setIndex(Array.from(src.index.array))
  // Into the node's own frame, not the scene's: the packer parks props under a `props`
  // group at the origin, so this is the node transform alone.
  geo.applyMatrix4(mesh.matrix)
  geo.computeBoundingBox()
  return geo
}

/**
 * Merge one body's parts into one geometry — the mannequin's six, or one villager's.
 *
 * They already share a skin, so the joint indices line up and no remapping is needed. An
 * untextured crew drops its UVs on the way through: the pack's texture is a name badge and
 * a smiley, and the colony paints its crew from its own suit palette instead.
 */
function mergeBody(skinned, dropMeshes, textured = false) {
  const drop = new Set(dropMeshes)
  const parts = []

  for (const mesh of skinned) {
    if (drop.has(mesh.name)) continue
    const geo = new THREE.BufferGeometry()
    const src = mesh.geometry
    const count = src.attributes.position.count

    const attrs = [
      ['position', 3],
      ['normal', 3],
      ['skinIndex', 4],
      ['skinWeight', 4],
    ]
    // Only a textured crew carries UVs through the merge — the space mannequin's texture is
    // a name badge and a smiley, and the colony paints its crew from its own suit palette.
    if (textured) attrs.push(['uv', 2])
    for (const [name, size] of attrs) {
      const a = src.getAttribute(name)
      if (!a) throw new Error(`crew: ${mesh.name} has no ${name}`)
      const data = new Float32Array(count * size)
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < size; k++) data[i * size + k] = a.getComponent(i, k)
      }
      geo.setAttribute(name, new THREE.BufferAttribute(data, size))
    }
    if (src.index) geo.setIndex(Array.from(src.index.array))
    parts.push(geo)
  }

  const merged = parts.length === 1 ? parts[0] : BufferGeometryUtils.mergeGeometries(parts, false)
  if (merged !== parts[0]) parts.forEach((g) => g.dispose())
  merged.computeBoundingBox()
  return merged
}

/**
 * Step every clip and record the skinning matrices.
 *
 * What is stored is the matrix the shader can use directly — three's bind matrices folded
 * in — so the vertex stage is a plain weighted sum with nothing left to reconstruct.
 */
function bakeClips(root, skeleton, mesh, animations) {
  const boneCount = skeleton.bones.length
  const byName = new Map(animations.map((a) => [a.name, a]))

  // The clip each key actually bakes: the source, cut down and tweaked as its spec says.
  const clipFor = new Map()

  // Lay the clips out end to end in one table and remember where each one starts.
  const clips = {}
  let frameCount = 0
  for (const [key, spec] of Object.entries(SPEC.clips)) {
    let clip = byName.get(spec.name)
    if (!clip) {
      console.warn(`crew: crew.glb has no clip "${spec.name}" — run \`npm run assets\``)
      continue
    }
    if (spec.frames) clip = THREE.AnimationUtils.subclip(clip, `${spec.name}:${key}`, spec.frames[0], spec.frames[1], BAKE_FPS)
    if (spec.tweak && SPEC.tweaks?.[spec.tweak]) clip = tweakClip(clip, SPEC.tweaks[spec.tweak], spec.tweak)
    clipFor.set(key, clip)
    // A looping clip needs its wrap-around frame; a one-shot ends where it ends.
    const frames = Math.max(2, Math.round(clip.duration * BAKE_FPS) + 1)
    clips[key] = { start: frameCount, frames, duration: clip.duration, loop: spec.loop, name: spec.name }
    frameCount += frames
  }

  const stride = boneCount * TEXELS_PER_BONE * 4
  const data = new Float32Array(frameCount * stride)

  // Side-table of world transforms for the attachment bones — what the helmet and backpack
  // read. The skinning matrices in `data` cannot answer "where is the head": they map bind
  // space to posed space, which is only the same thing when the bind matrices are identity.
  // Three's loader sanitises node names on the way in — a dot is a path separator in an
  // animation track, so `hand.r` arrives as `handr`. Matching loosely costs nothing and the
  // alternative is a table of silent zeros and a prop pinned to the world origin.
  const plain = (n) => n.replace(/[.\s_]/g, '').toLowerCase()
  const attachBones = ATTACH.map((name) => skeleton.bones.findIndex((b) => plain(b.name) === plain(name)))
  const lost = ATTACH.filter((_, i) => attachBones[i] < 0)
  if (lost.length) throw new Error(`crew: no bone for attachment ${lost.join(', ')}`)
  const attach = new Float32Array(frameCount * ATTACH.length * 16)

  const mixer = new THREE.AnimationMixer(root)
  const scratch = new THREE.Matrix4()
  // `world * bindMatrixInverse * bone * bindMatrix` is the whole of three's skinning
  // pipeline for a vertex, so baking it means the shader has only the weighted sum left.
  // The mesh's own world matrix belongs in there because the merged geometry is left in
  // its authored frame rather than being pre-transformed.
  const bind = mesh.bindMatrix
  const pre = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse)

  for (const [key, spec] of Object.entries(clips)) {
    const clip = clipFor.get(key)
    const action = mixer.clipAction(clip)
    action.play()

    for (let f = 0; f < spec.frames; f++) {
      const raw = spec.frames > 1 ? (f / (spec.frames - 1)) * spec.duration : 0
      // The last frame of a loop is the clip's own end, which equals its start again — that
      // is exactly the wrap frame the shader interpolates into. A one-shot must stop just
      // short of it: sampled at precisely its duration the mixer's default loop mode wraps,
      // so the frame a sit-down or a spawn *holds* would be the pose it started from, and
      // the astronaut snaps back to standing on the last frame of sitting down.
      const t = spec.loop ? raw : Math.min(raw, Math.max(0, spec.duration - 1e-3))
      mixer.setTime(t)
      root.updateMatrixWorld(true)
      skeleton.update()

      const offset = (spec.start + f) * stride
      for (let b = 0; b < boneCount; b++) {
        scratch.fromArray(skeleton.boneMatrices, b * 16)
        scratch.premultiply(pre).multiply(bind)
        scratch.toArray(data, offset + b * 16)
      }

      const attachOffset = (spec.start + f) * ATTACH.length * 16
      attachBones.forEach((b, slot) => {
        if (b < 0) return
        skeleton.bones[b].matrixWorld.toArray(attach, attachOffset + slot * 16)
      })
    }

    action.stop()
  }

  const texture = new THREE.DataTexture(
    data,
    boneCount * TEXELS_PER_BONE,
    frameCount,
    THREE.RGBAFormat,
    THREE.FloatType
  )
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  mixer.stopAllAction()
  mixer.uncacheRoot(root)

  return {
    boneTexture: texture,
    attach,
    attachSlot: new Map(ROLES.map((role, i) => [role, i])),
    boneCount,
    frameCount,
    clips,
    fps: BAKE_FPS,
  }
}

/**
 * Where an attachment bone is, in character space, on a given frame.
 *
 * This is how anything worn rather than skinned gets placed: the helmet reads `head`, the
 * backpack reads `chest`. A straight array slice — no skeleton is evaluated and nothing is
 * allocated. The frame is rounded rather than interpolated; at 30 fps the worst case is
 * half a frame of lag on a helmet whose own body is drawn from the same table, and matrix
 * interpolation here would cost more than it is worth.
 */
export function attachMatrixAt(rig, frame, slot, out) {
  const f = Math.min(rig.frameCount - 1, Math.max(0, Math.round(frame)))
  return out.fromArray(rig.attach, (f * ATTACH.length + slot) * 16)
}

/**
 * Where in the frame table an agent is, given a clip and how long it has been playing.
 * Looping clips wrap; one-shots hold their last frame.
 */
export function frameFor(clip, time) {
  if (!clip) return 0
  const last = clip.frames - 1
  const f = time * BAKE_FPS
  return clip.start + (clip.loop ? f % last : Math.min(f, last))
}

/**
 * Adds GPU skinning to any three material.
 *
 * Slotted in around `<beginnormal_vertex>` and `<begin_vertex>`, which are upstream of
 * three's own instancing — so the skinned vertex still goes through `instanceMatrix` and
 * the crew stays one instanced draw. Three's `USE_SKINNING` path is deliberately not used:
 * it binds to a `Skeleton` object, which is the thing being replaced.
 *
 * `normals` must be false for the shadow pass. Three's depth shader only includes
 * `<beginnormal_vertex>` behind `USE_DISPLACEMENTMAP`, so a depth material decorated as if
 * it had normals would skin against an uninitialised matrix and the crew would cast the
 * shadow of a folded-up bind pose.
 */
export function decorateSkinned(material, uniforms, { normals = true, textured = false } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    // The world curve's uniforms (a theme with `curve` bends the crew with the ground; see
    // `core/curve.js`). Unused anywhere the curve is not installed.
    withCurve(shader)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec4 skinIndex;
         attribute vec4 skinWeight;
         attribute float aFrame;
         uniform highp sampler2D uBones;
         uniform float uFrameMax;

         mat4 boneAt( int bone, int row ) {
           int x = bone * ${TEXELS_PER_BONE};
           return mat4(
             texelFetch( uBones, ivec2( x + 0, row ), 0 ),
             texelFetch( uBones, ivec2( x + 1, row ), 0 ),
             texelFetch( uBones, ivec2( x + 2, row ), 0 ),
             texelFetch( uBones, ivec2( x + 3, row ), 0 )
           );
         }

         // The two rows either side of a fractional frame, mixed. A component-wise mix of
         // two skinning matrices is not a true interpolation, but a thirtieth of a second
         // apart the error is far below a pixel and it costs one instruction. Both rows are
         // clamped: a one-shot clip holds on its last frame, and its "next" row would
         // otherwise be the first frame of whatever clip was baked after it.
         mat4 botSkinMatrix() {
           float f = clamp( aFrame, 0.0, uFrameMax );
           int a = int( floor( f ) );
           int b = min( a + 1, int( uFrameMax ) );
           float t = f - float( a );
           mat4 m = mat4( 0.0 );
           for ( int i = 0; i < 4; i ++ ) {
             float w = skinWeight[ i ];
             if ( w <= 0.0 ) continue;
             int bone = int( skinIndex[ i ] );
             m += w * ( boneAt( bone, a ) * ( 1.0 - t ) + boneAt( bone, b ) * t );
           }
           return m;
         }

         mat4 botSkin;`
      )

    if (textured) {
      // Which column of the crew atlas this instance wears. The packer remaps every
      // character into column 0, so a colourway is the same body a column to the right.
      shader.vertexShader = shader.vertexShader
        .replace(
          'attribute float aFrame;',
          `attribute float aFrame;
         attribute float aColourway;`
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
         vMapUv.x += aColourway;`
        )
    }

    if (normals) {
      // Three runs the normal stage first, so the matrix is built there and the position
      // stage reuses it — one set of texture fetches per vertex rather than two.
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
           botSkin = botSkinMatrix();
           objectNormal = mat3( botSkin ) * objectNormal;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           transformed = ( botSkin * vec4( transformed, 1.0 ) ).xyz;`
        )
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         botSkin = botSkinMatrix();
         transformed = ( botSkin * vec4( transformed, 1.0 ) ).xyz;`
      )
    }
  }
  return material
}
