import * as THREE from 'three'

/**
 * What a villager holds, and the one thing it always wears.
 *
 * The Adventurers already ship with their helmets, capes and boots painted into the body, so
 * unlike the space mannequin there is no suit to build here — but there is a tool. Each of the
 * eight bodies plies one trade while its thread is running, and this hook is the table that
 * says which tool goes with which trade. On top of that every villager carries a round shield
 * on its back in the colour of the repo it belongs to, which is what says at a glance which
 * plot a wanderer came from.
 *
 * Every geometry comes out of `crew.glb`: a part names a static node (`node`) the packer
 * parked there and the engine swaps the real geometry in when the rig lands, because the props
 * hook runs at construction, long before any kit is loaded. The material is deliberately plain
 * white — `setRig` gives a node prop the crew atlas as its map, so a wrench is painted from the
 * same sheet as the engineer holding it. A part that asks for `plain: true` is the exception:
 * it keeps the white and takes its whole colour from its instance tint instead.
 *
 * `headLift` is added to the head bone's rest height to place the name badge above a villager;
 * zero is right for a body whose head is already the top of it.
 *
 * `cues` is the one thing here that is *not* built at boot: a helper wears a coloured helm on
 * its crown, and the engine asks for it the first time a subagent puts one on the map.
 */

/** A part's local offset from its bone. Kept as plain data so the engine can just read it. */
const at = (x, y, z, rx = 0, ry = 0, rz = 0) => ({ x, y, z, rx, ry, rz })

/**
 * The Medieval Hexagon pack authors its tools for a meeple a fraction the size of an
 * Adventurer, so the two borrowed from it are scaled up to fill a villager's fist. The
 * Adventurers' own tools are authored on this rig and need no scaling at all.
 *
 * The numbers are read off the packed geometry: an Adventurers one-hander reaches about 1.0
 * rig units above the grip (the axe 0.97, the wrench 1.00), while the hexagon hammer reaches
 * 0.16 and the shovel 0.28. Five and four put each of them in that range — the hammer a
 * little short of the axe, because its head is a mallet's and a full-length one dwarfs the
 * villager swinging it.
 */
const HEX_HAMMER = 5.0
const HEX_SHOVEL = 4.0

/**
 * The shield slung across a villager's back, in the chest bone's own frame.
 *
 * The chest bone stands at the origin's height with no rotation of its own in the rest pose
 * (0, 0.9726, 0, axis-aligned), so these read as plain up and back: the villager faces +Z and
 * wears the shield on -Z. `shield_round` is a disc in its own XY plane with the boss bulging
 * to +Z, so half a turn about Y points the boss outward instead of into the spine.
 *
 * The numbers are read off the packed bodies. At 0.8 the disc is 0.71 across and stands
 * 0.15 proud of its mount plane; the eight torsos' backs sit between z −0.23 and −0.41 in
 * the shoulder band, and the capes at −0.35, so a mount plane at −0.42 lies flush against
 * the deepest of them and a shade behind the shallowest — near enough that none of them
 * floats. Raised 0.05 above the bone, the disc spans y 0.67 to 1.38: the shoulder blades,
 * stopping at the neck rather than rising behind the head.
 *
 * The engineer and the druid wear a backpack that reaches −0.63 and the ranger a quiver at
 * −0.51, so on those three the shield hangs *in* their kit rather than on their back. That
 * is the price of one offset for eight bodies, and at the distance a village is watched from
 * it reads as a shield strapped over a pack.
 */
const BADGE = { y: 0.05, z: -0.42, scale: 0.8 }

/**
 * The helm a helper wears on its crown, in the head bone's own frame.
 *
 * `helmet` is the hexagon pack's unit helm, packed into `crew.glb` beside the hammer and the
 * shovel. It is authored upright and facing +Z like the villager, horns out to the sides, so
 * it needs no rotation at all. The head bone is axis-aligned at rest like the chest, so `y`
 * reads as plain height above it and `z` as plain forward.
 *
 * Like the hexagon tools it is made for a meeple a fraction of an Adventurer's size: the dome
 * is 0.21 across, closed underneath at its own origin, rising 0.108 above it with the rim
 * band hanging 0.025 below, a spike to 0.115 and the horns to 0.17. Five times that is 1.07
 * across — as wide as the heads it sits on, which is what makes it read as worn rather than
 * perched — with its underside 0.9 above the bone, the rim band down to 0.775 and the dome's
 * top at 1.44.
 *
 * The numbers are read off the packed bodies (2026-09-15). The head bone stands at 1.2414
 * model units, and what matters is the crown *inside the helm's footprint*, within half a
 * unit of the axis: knight 1.302 (the ridge of its own helmet), barbarian 1.156 (the bear
 * hat), engineer 1.032, ranger 1.032, druid 0.991 at the crown, rogue 0.937, hooded rogue
 * 0.930 — a spread of 0.37 that one offset has to cover. A helm, unlike the flat cap it
 * replaced, has room inside for that: every one of those crowns rises through the helm's
 * underside and stops inside the dome — the two rogues a few hundredths past the underside,
 * so the rim band rests on their hair, and the knight's ridge still 0.14 under the dome's
 * top — so nothing pokes through and nothing floats. At 4 the helm had to sit high enough to
 * clear the knight that it looked balanced on the rogues rather than worn; at 5 it comes down
 * onto every head at once (judged off close-ups of all eight bodies, 2026-09-15).
 *
 * Two bodies wear it *with* something rather than over it. The druid's antlers rise either
 * side of the helm, which reads as horns beside horns. The mage's cone stands inside the dome,
 * but the hat's bent tip trails back to 1.41 and shows past the helm's back, so from the side
 * a mage wears the helm on top of its hat, where the flat cap only ever showed as a disc past the brim's edge.
 */
const HELM = { y: 0.9, z: 0, scale: 5 }

/**
 * character → the crew-glb node it holds while working.
 *
 * `axe_1handed`, `dagger`, `staff` and `druid_staff` are the Adventurers' own; `hammer` and
 * `shovel` come from the hexagon pack, which is what the sawing knight, the digging barbarian
 * and the pickaxing hooded rogue swing — the pack has no saw or pick, and at the distance a
 * village is watched from a mallet reads as either.
 */
const TOOLS = [
  ['engineer', 'engineer_Wrench', 1],
  ['ranger', 'axe_1handed', 1],
  ['barbarian', 'shovel', HEX_SHOVEL],
  ['knight', 'hammer', HEX_HAMMER],
  ['rogue', 'dagger', 1],
  ['rogue_hooded', 'hammer', HEX_HAMMER],
  ['mage', 'staff', 1],
  ['druid', 'druid_staff', 1],
]

export function props() {
  /**
   * The badge every villager wears, whatever it is doing: a round shield across its back,
   * painted the colour of the repo its thread belongs to.
   *
   * `plain` is what makes that possible. Every other node prop takes the crew atlas as its
   * map when the rig lands, and a mapped material multiplies the instance colour by whatever
   * the sheet painted there — so a shield tinted `accent` would come out the plot's colour
   * times KayKit's steel and wood, which is to say muddy and different on every pixel. With
   * no map it is flat white, and `tint: 'accent'` makes it flat repo colour, which is the
   * one thing that reads from across the map.
   *
   * Worn always, so no `when` and no `character`: it shares the agent's own instance slot
   * rather than needing a counter of its own.
   */
  const parts = [
    {
      name: 'badge',
      node: 'shield_round',
      geometry: null,
      material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.05 }),
      role: 'worn',
      bone: 'chest',
      offset: at(0, BADGE.y, BADGE.z, 0, Math.PI, 0),
      scale: BADGE.scale,
      castShadow: true,
      tint: 'accent',
      plain: true,
      when: null,
    },
  ]

  // KayKit authors every tool to sit at the `handslot.r` bone's origin with no offset of its
  // own, which is the whole reason the medieval rig attaches the hand role there rather than
  // to `hand.r` — so the offset here is zero and the pose comes entirely from the clip.
  const tools = TOOLS.map(([character, node, scale]) => ({
    name: `tool_${character}`,
    node,
    geometry: null,
    material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.05 }),
    role: 'worn',
    bone: 'hand',
    offset: at(0, 0, 0),
    scale,
    castShadow: true,
    tint: null,
    when: 'working',
    character,
  }))
  parts.push(...tools)
  return { headLift: 0, parts, cues: { helper: helperHelm } }
}

/**
 * What a helper wears that no other villager does: a horned helm on the crown, in the colour
 * of the repo its parent's thread belongs to.
 *
 * A factory rather than an entry in `parts`, and that is the point: it is called the first
 * time a helper spawns and never at boot, so a village with no subagents in it is composed
 * from exactly the draws it always was. Everything it builds it owns outright, because the
 * engine disposes it with the rest of the parts.
 *
 * The helm rather than a tool, because a working villager already holds one and a helper is
 * always working — a second mallet says nothing the parent does not say too. Nothing in
 * either theme wears anything on its head, so a head piece is the one silhouette change that
 * is new, and it sits at the top of the body where a crowd cannot hide it.
 *
 * `plain` with `tint: 'accent'` for the same reason the badge is: no atlas map, so the
 * instance colour is the whole colour and a helper's helm is its plot's, flat and legible.
 * The helm keeps its shape without the sheet — dome, rim band, spike and horns are all
 * modelled rather than painted — so there is nothing the texture would add that the repo
 * colour is not worth more than.
 */
function helperHelm() {
  return [
    {
      name: 'helm',
      node: 'helmet',
      geometry: null,
      material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.05 }),
      role: 'worn',
      bone: 'head',
      offset: at(0, HELM.y, HELM.z),
      scale: HELM.scale,
      castShadow: true,
      tint: 'accent',
      plain: true,
      when: null,
    },
  ]
}
