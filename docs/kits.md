# The kit contract

A **theme** gets its models from one or more **kits**. A kit is a single `.glb` whose meshes
are named nodes and whose materials are one gradient atlas. Nothing in the engine knows where
a kit came from: KayKit's packs satisfy the contract, and so does anything you export out of
Blender that follows the rules below.

This document is the contract, the Blender settings that produce a conforming file, and a
worked example that adds a building to the space colony.

Most of what follows is checked by `npm run validate-kit <theme>` — if it passes, the app can
load your kit, and if it fails, it names the field and the node. The rules a tool cannot check
say so where they appear.

---

## 1. What a kit is

The theme manifest (`src/themes/<id>/manifest.js`) describes each kit under `kits`:

```js
kits: {
  base: {
    file: 'spacebase.glb',              // relative to public/<assetDir>
    atlas: { cols: 8, rows: 4 },        // the swatch grid in the one texture
    cells: { WHITE: 1, GREY: 2, TRIM: 11, SOLAR_A: 28 },
    pbr: { 11: { roughness: 0.42, metalness: 0.08 } },
    accentCells: ['TRIM'],              // repainted per repo, and lit at night
    // Optional, and all three come from the medieval kit rather than this one:
    atlases: { summer: 'hexagons_medieval_Summer', winter: 'hexagons_medieval_Winter' },
    // pbr: { 20: { emissive: 0xffb347, emissiveIntensity: 1.6 } },
    // accentGlow: 0.3,
  },
}
```

- `file` — the built glb under `public/<assetDir>/`. The space theme's `assetDir` is
  `assets/space`, so `spacebase.glb` resolves to `public/assets/space/spacebase.glb`. A theme
  can borrow another's kit by path rather than packing it twice: the medieval village plants
  palms, cacti and pink, fall and jungle trees from `../space/nature.glb`, Kenney's Nature Kit.
- `atlas` — the texture is a `cols × rows` grid of flat swatches. A **cell index** is
  `row * cols + col`, counted from 0, left to right and top to bottom (`v = 0` is the top
  row). On the space atlas cell 11 is the fourth swatch of the second row.
- `cells` — names for the cell indices the theme refers to, so `accentCells` and
  `kit.cellIndex(kit, 'TRIM')` read as swatch names rather than magic numbers. A misspelt
  name throws at configure time, and the validator checks that some mesh in the kit actually
  paints each cell named here — an unused name can only mislead the next recipe.
- `pbr` — roughness, metalness and self-emission per cell index, so one flat texture can
  have a glass swatch, a painted-metal swatch and a swatch that glows. Unlisted cells take
  Kay's own 0.6 / 0 and no glow.
- `accentCells` — the swatches the building shader repaints into a repo's colour and lights
  after dark. Named, not indexed, so they read as `['TRIM']` rather than `[11]`.
- `atlases` — optional. The named repaints of this kit's grid that the packer embedded in
  the glb, `season → glTF image name`. A kit that declares none never swaps.
- `accentGlow` — optional, default 1.15. How hard the accent cells come up after dark, and a
  knob because the term means a different thing in each fiction: a habitat's window strips
  are electric light and want the full value, where a thatched roof is lit by the torch on
  the kerb below it and wants a fraction. The medieval kit sets 0.3. Omitting it leaves the
  shader computing the product it always did, which is why the space kit does not name it.
- `lazy` — optional, default false. A lazy kit is registered at boot but not fetched until
  something asks for it (`loadLazyKit(name)` in `src/world/kit.js`); the medieval `decay` kit
  is one, loaded the first time a zone ghosts. The point is the snapshot harness: every
  geometry, material and texture a kit loads spends four seeded random draws, and a draw
  spent at boot re-seats every villager in every shot after it (§7). Art that only a rare
  state needs goes in a lazy kit so pages that never reach that state never pay for it. A
  lazy kit with no `atlases` is drawn with the base kit's texture, so its models must UV into
  the same grid — which every model of one KayKit pack does.

Two things follow from "one atlas": every model in a kit merges into one geometry and one
draw call, and a per-instance tint works on any mesh painted a neutral swatch.

### Seasons: one grid, several sheets

The Medieval Hexagon pack ships its atlas four times over — same grid, same UVs, different
paint. A theme names them under `kits.<k>.atlases`, and a *setting* wears one with
`settings[i].atlas: 'winter'`.

`setKitAtlas(name)` is the whole runtime mechanism, and it is one assignment per kit. Every
material in a theme shares the single `THREE.Texture` that `atlasTexture()` hands out, so a
season is that texture carrying another **image**: assign `kit.atlas.image`, set
`needsUpdate`, and buildings, scatter, clutter and the ceremony are re-skinned in one upload
with no material walk and no second texture. `colony.js` calls it when the assets land and
on every setting change.

The extra sheets reach the glb as glTF *images* with a name and no `textures` entry —
nothing in the scene samples them — so `kit.js` pulls them off the loader's parser by image
name. That is why `atlases` values are image names, the source file's stem. An unknown
season falls back to the kit's first atlas rather than throwing, which is the wrong season
on screen rather than a message, so the schema and `validate-kit` hold both ends of the
lookup against the built glb.

### Cells that glow

`pbr[cell].emissive` is a colour the swatch emits on its own — a torch flame, a forge mouth
— and `emissiveIntensity` scales it (default 1). They are uploaded as a per-cell uniform
array and added in the fragment stage, so a kit pays nothing per lit object.

`emissive` is what switches the term on. An `emissiveIntensity` with no `emissive` beside it
is inert — the shader never carries the term and the cell the theme thinks glows does not —
so the schema rejects it by name.

The building shader adds the chunk only when `hasEmissive(kit)`, which is why the space
shaders compile unchanged. Anything drawing kit parts *outside* that shader — the kerb
clutter, a ceremony built from parts — gets the same glow from
`decorateCellEmissive(material, kit)`, which for a kit with no emissive cell hands the same
object straight back with no `onBeforeCompile` and no cache key.

### The two kit names the engine hardcodes

A theme may ship as many kits as it likes, but two names are a contract rather than a
convention, and `validateManifest` requires both:

| Kit | Who reads it |
| --- | --- |
| `base` | `world/buildings.js` — every building recipe and every kerb clutter prop |
| `forest` | `world/setting.js` — every scatter recipe, whatever it plants |

The names are the space theme's history showing through: the medieval village's `forest` is
trees, hills, boulders and hay. Renaming them is a change to those two engine modules, not to a
manifest, so until someone makes that change a theme without both kits renders no buildings
and no scenery. `npm run validate-kit <theme>` says so by name.

## 2. Model kit rules

Buildings and scatter. Five rules, all of them load-bearing:

1. **One texture per kit — a grid atlas of flat swatches.** Not a photographic texture, not
   one image per model. A model that brings its own texture cannot merge with the rest, and
   the kit stops being one draw call.
2. **Every mesh is a named node**, and the name is what recipes reference. The packer keeps
   the source file's object name, so in Blender the object name *is* the node name. Names
   are case-sensitive; `basemodule_A` and `basemodule_a` are different nodes.
3. **Origin convention: base at `y = 0`, footprint centred on the origin, `+Z` is the
   front.** A recipe places a part by its origin and rotates it about `y`, so a model whose
   origin sits at its centre of mass floats or sinks, and one whose front faces `-X` turns
   its back on the plot. This is the one rule no tool can check for you.
4. **Anything that takes a per-instance tint is painted neutral grey.** The tint multiplies
   through the swatch, so a grey boulder becomes lunar dust or Martian rust; a boulder
   already painted brown can only become a darker brown.
5. **A node a recipe takes `solo` must be a single glTF primitive.** `solo` means "this
   node's own mesh, without its children" — the turbine tower without its rotor. three's
   loader builds a `Mesh` for a node of one primitive and a `Group` of meshes for a node of
   several, and only a `Mesh` can be taken solo. In Blender that means the object must have
   one material: a second material splits it into a second primitive on export. `hasSolo(name)`
   is how a recipe asks before taking a part `solo`, the way `hasPart(name)` asks whether the
   node is there at all.

`npm run validate-kit <theme>` checks 1, 2 and 5 — that every node a recipe, the scatter
table or the kerb clutter list names exists in the kit it is looked up in, that every cell
named in `cells` is sampled by some mesh, and that no `solo` part names a multi-primitive
node. 3 and 4 are yours.

A sixth rule applies only to a kit with seasons: **every sheet in `atlases` is a repaint of
the same grid.** A season swaps one image under the UVs the models were packed with, so a
winter sheet that moves a swatch one cell along repaints the village wrong, and no tool can
check that either.

## 3. Crew kit rules

One glb holds the body — or the whole cast, on one skeleton — and every clip the theme
plays. The manifest's `crew` block is what the engine needs to bake it:

```js
crew: {
  file: 'crew.glb',
  clips: {
    idle: { name: 'Idle_A', loop: true },
    work: { name: 'Hammering', loop: true, strike: 0.34 },
    spawn: { name: 'Spawn_Ground', loop: false },
  },
  attach: { head: 'head', chest: 'chest', hand: 'hand.r' },
  dropMeshes: ['Mannequin_Medium_Head'],
  headClearance: 1.42,
}
```

- **One skeleton, bones matched by name.** The packer retargets every animation channel onto
  the body's own bones by name, because merging glTF documents brings each animation file's
  private copy of the rig with it. Bone names are matched loosely — dots, spaces and
  underscores are stripped and the comparison is lower-case, so `hand.r`, `hand_R` and
  `handr` are the same bone. That looseness is deliberate: three's loader sanitises a dot out
  of a node name on the way in, so a stricter match would reject a rig the engine loads
  happily.
- **Three attachment roles: `head`, `chest`, `hand`.** The engine asks for a *role*, never
  for a bone path — a helmet wants "the head" — so a differently rigged character only has
  to name its own bones here. Only these three bones get a world transform baked out for
  worn parts to read; anything else has to be skinned into the body.
- **Clips are listed by name.** `crew.clips` maps the key the engine plays to the clip's name
  in the glb plus whether it loops (`loop: false` holds on the last frame, which is what a
  sit-down or a spawn wants). `stateClips` then maps a colony status to one of those *keys*.
  The validator walks the whole chain: `stateClips.working` → `crew.clips.work` →
  a clip named `Hammering` in the file.
- **A work clip may name its `strike`.** `strike` is an optional fraction in [0, 1] saying
  where in the clip the tool lands — the frame the hand is at the bottom of its swing. The
  engine sparks off it: while an agent is at its site, working, and playing its *work* clip,
  `Colony._emit` throws the theme's `work` effect the moment the clip's phase crosses the
  strike, once per loop. A clip without one strikes halfway through, which is the honest
  answer for a clip whose hand barely moves. Measure it rather than guessing — walk the hand
  bone (`hand.r`, or whatever `attach.hand` names) over the clip's channels and take the frame
  it is lowest — and note that only the clip a state actually maps to as *work* is ever read,
  so a `strike` on an idle or a walk is dead weight. Space's `Hammering` strikes at 0.34;
  the medieval trades range from 0.31 (`Digging`) to 0.82 (`Pickaxing`).
- **`dropMeshes`** names meshes to leave out of the body — the space crew drops the
  mannequin's head because the theme's props hook puts a helmet there.
- **`headClearance`** is where a status badge's bottom edge sits above the feet, in **world**
  units — it is multiplied by the agent's `size` (1 for a thread's villager, `HELPER_SIZE` for
  a helper) and added to the ground position, so a body measured in rig units has to be
  multiplied by the crew scale first.

### Multi-character crews

A crew may be a cast rather than a body. The medieval village ships eight Adventurers on one
skeleton and one atlas, and a thread keeps its villager across reloads because the only
input is the thread's id.

```js
crew: {
  file: 'crew.glb',
  characters: [{ id: 'knight', mesh: 'body_knight' }, { id: 'rogue_hooded', mesh: 'body_hooded' }],
  colourways: 4,
  propNodes: ['hammer', 'dagger'],
  attach: { head: 'head', chest: 'chest', hand: 'handslot.r' },
  headClearance: 1.67,
}
```

- **`characters`** — `{id, mesh}` per body, `mesh` being the *node-name prefix* the packer
  gave that body's skinned meshes (it renames them `body_<id>_<Part>`, and a character
  claims the nodes named exactly `mesh` or starting `mesh_`). Absent, the crew is one
  implicit body with id `crew` and every skinned mesh merged into it. **No character id may
  be a prefix of another**: `body_rogue_` would claim the hooded rogue's meshes too and the
  plain rogue would render as both bodies at once, which is why the manifest's
  `rogue_hooded` is packed under `body_hooded`.
- **`colourways`** — how many columns of the atlas a body comes in. A thread's column is
  `(hash(id) >>> 5) % colourways`, shifted so it does not correlate with the character it
  picked, and it reaches the shader as a per-instance U offset.
- **`propNodes`** — the static (unskinned) nodes the packer parked in the glb for the props
  hook to hang off a bone. The hook is three code the validator cannot read, so the theme
  lists the names and the validator holds them against the file.
- **`stateClips` takes an object form.** A state is a clip key as before, or
  `{ default, byCharacter }` when one body works the job differently — the engineer hammers,
  the ranger chops, the mage casts. `cast.clipFor` resolves it per character; the validator
  walks every arm down to a clip in the glb.
- **`headClearance` is measured against the tallest body**, or the one that outgrows it
  wears its badge as a hat. The medieval value comes from the Druid, whose horned head
  reaches 2.7545 model units: × 0.56 (the crew scale) is 1.54 world units, plus about 0.13
  clear of the crown, giving 1.67.

**The atlas.** Every Adventurer ships as its own glb with its own rig and its own 1024²
sheet, and the engine wants one skeleton and one material. So the packer keeps the first
character's rig, re-binds every other skin to it by bone name, shrinks each sheet to a
`cell` square (256 by default) and lays them out: **one row per distinct texture, one column
per colourway**, rows allocated in declaration order so a rebuild is byte-identical. The
medieval sheet is 1024 × 2048 — four colourways across, eight rows down, seven of them
character sheets (the two rogues share one) and the eighth the hexagon atlas the two
borrowed hand tools are painted from. Every mesh is remapped into its **column 0** cell and
a colourway is that body one column to the right, the shader adding `aColourway` to
`vMapUv.x`; a character with fewer alt sheets than the widest repeats its own list rather
than leaving a black cell for the hash to land on. Re-binding is by name only: same bones in
a different order is remapped silently, and a character whose inverse bind matrices differ
from the kept rig's is refused rather than mangled.

**Props.** A hand tool cannot be a kit part — the props hook runs when `Astronauts` is
constructed, long before `loadKit()` resolves, so `part()` has nothing to give it. Instead a
prop names a **static node in the crew glb** and the engine swaps the geometry in when the
rig lands. A part is `{ node, character, when, scale, bone, offset, plain, tint }`:
`character` limits it to one body, `when: 'working'` draws it only while that body plays its
work clip, and `scale` fills a fist with a tool authored for another rig — the hexagon pack's
meeple hammer needs 5.0 to reach where an Adventurers one-hander reaches on its own. They
hang off `handslot.r`, because KayKit authors every Adventurers tool to sit at that bone's
origin with zero offset and the pose then comes entirely from the clip. Space keeps `hand.r`;
the mannequin rig has no tool socket.

- **`plain: true`** keeps a node prop's own material. By default `setRig` hands every node
  prop the crew atlas as its `map`, which is what paints a wrench from the same sheet as the
  engineer holding it; a plain part is skipped and stays the white the hook built. That
  matters because a mapped material *multiplies* the instance colour by the sheet, so a part
  meant to come out one flat colour per agent has to have no sheet under it at all. Only a
  node prop reads it — a part with geometry of its own was never given a map.
- **`tint: 'accent'`** paints a part in the colour of the repo the thread belongs to. The
  colony puts `accent: plot.accent` on every roster entry, `Astronauts` keeps it as
  `agent.accent` and repaints when the entry's accent changes, and the recolour pass writes it into
  the part's `instanceColor` alongside the existing `suit`, `trim` and `eye` rules. Paired
  with `plain` it is what makes the village's round shield readable as a repo colour from
  right across the map. An agent whose entry carries no accent is white, which leaves such a
  part its material colour.
- **`cues`** is the second thing the props hook may return, beside `headLift` and `parts`:
  `cues: { helper: () => [partSpec, …] }`. A cue is a kind of agent rather than a kind of body
  — the roster puts `cue: 'helper'` on a subagent's entry and nothing else carries one — and a
  cue's parts are worn only by an agent whose entry named that cue, on an instance counter of
  their own. The value is a **factory**, not a list, and that is the whole point: every
  geometry, material and `Object3D` three constructs spends four draws of the seeded stream the
  screenshot harness pins, so a cue part built in `props()` would re-seat every villager in
  every shot for the sake of something nobody in them is wearing. The engine calls the factory
  the first time an agent carrying that cue spawns, stamps `cue` on each spec, and builds them
  exactly as it builds `parts` — same fields, same bone roles, same `node`/`plain`/`tint`
  rules. A theme that declares no `cues` simply has nothing extra to say; its helpers are
  half-height villagers and that is all. The village dresses a helper in the hexagon pack's horned
  `helmet`, the colony in a beacon on the helmet opposite the antenna, both `plain` +
  `tint: 'accent'` so the head piece is the repo's own colour.

## 4. Tooling

### `npm run assets [theme] [-- --force]`

Packs the raw art packs into the glbs the app loads. Raw packs are **not** committed and the
built glbs **are**, so on a fresh clone this is a deliberate no-op.

```
$ npm run assets space
build-assets: space: keeping the checked-in assets — no source pack under D:\data\taskshire\assets-src for:
  KayKit_Space_Base_Bits_1.0_FREE/Assets/gltf
  KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf
```

It is all-or-nothing per theme: a theme is rebuilt only when *every* source it names is
present, because half of a matched set is worse than none of it. "Every source" reaches
inside each pack, down to every file a builder opens by name — the models a kit lists, its
seasonal atlas images, the crew's mannequin and rig directory, and for a cast every
character glb, every colourway sheet and every prop — so a pack that is present but missing
one file is caught before anything is written rather than halfway through. A pack that is
absent prints as one line; a pack that is present but incomplete is listed file by file,
because that is the case somebody has to go and fix. `-- --force` turns that skip into a
failure, which is what you want in a script:

```
$ npm run assets space -- --force
build-assets: space: missing 2 source pack(s) under D:\data\taskshire\assets-src:
  KayKit_Space_Base_Bits_1.0_FREE/Assets/gltf
  KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf
See README, "Where the art comes from". Set ASSETS_SRC in .env (see .env.example).
$ echo $?
1
```

With no theme argument every theme under `src/themes/` is built. The extra `--` is npm's:
without it, npm eats the flag.

Each theme declares its inputs in `src/themes/<id>/assets.config.mjs`. Every `src` is
relative to `ASSETS_SRC`; `build-assets.mjs` resolves it and hands the whole entry to a
builder as one JSON argument.

**Kits** (`build-kit.mjs` reads each entry of `kits`):

```js
{
  src: 'KayKit_Medieval_Hexagon_Pack_1.0_SOURCE/…/Assets/gltf',
  subdirs: true,                       // search recursively; a pack that files by category
  out: 'public/assets/medieval/medieval.glb',
  models: ['building_home_A_blue', …], // or null for "the whole directory"
  atlases: { summer: '…/hexagons_medieval_Summer.png', … },
  generated: [{ module: 'src/themes/medieval/torch.mjs', name: 'torch' }],
}
```

`models` names files without the `.gltf`, and a name with no matching file is a hard error.
`atlases` values are paths relative to `ASSETS_SRC`; each image is embedded after the merge
transforms (`prune` would drop an unreferenced texture) and named by its file stem, which is
the name `kits.<k>.atlases` matches in the manifest. `generated` is covered in §6.

**Crew** (`build-crew.mjs`). `src`, `rigDir`, `out` and `clips` are common to both forms; a
single-body crew then names `mannequin`, and a cast replaces it with `characters` and adds
`props` and `cell`:

```js
crew: {
  src: 'KayKit_Character_Animations_1.1/…',
  rigDir: 'Animations/gltf/Rig_Medium',
  out: 'public/assets/medieval/crew.glb',
  clips: { 'Rig_Medium_General.glb': ['Idle_A', 'Interact', …] },
  mannequin: 'Mannequin Character/characters/Mannequin_Medium.glb',   // one body
  cell: 256,                                                          // …or a cast
  characters: [{ id: 'knight', src: '…/Characters/gltf/Knight.glb',
                 texture: '../../Textures/knight_texture',
                 colourways: ['', '_alt_A', '_alt_B', '_alt_C'] }],
  props: [{ node: 'hammer', src: '…/units/neutral/hammer.gltf' }],
}
```

`src` on a character or a prop is relative to `ASSETS_SRC`, not to the crew's own pack — they
usually come from another pack altogether. **`texture` is a path relative to the character's
glb**, without the extension, because the Adventurers keep their alt sheets a level up under
`Textures/` rather than beside the models; a colourway suffix and `.png` are appended, so
`['', '_alt_A']` opens `knight_texture.png` and `knight_texture_alt_A.png`. Rows are keyed
by the texture's name, so two characters on one sheet share a row and its colourways, and a
tool painted from a class sheet costs no row at all.

### `npm run validate-kit <theme>`

Holds the manifest against the built glbs. Exit 0 and one summary line on success:

```
$ npm run validate-kit space
space: kit ok — 2 kits, 10 recipes, 15 clips
```

Exit 1 and one line per failure otherwise. The manifest's own shape is checked first, by the
same `validateManifest` the app runs at theme load, so a missing field is reported in the
words the boot path would use:

```
$ npm run validate-kit medieval      # while its manifest was still a stub
✗ manifest: settings[0].rock: missing
✗ manifest: settings[0].scatter: no recipe named "trees"
✗ manifest: kits: expected at least one kit
✗ manifest: crew: missing
✗ manifest: palette: expected {accent, tones, css}
```

Only a manifest that passes that is held against the glbs. Then it checks: the theme declares
both `base` and `forest`, every node name a recipe can produce exists in the base kit
(including both arms of an `if` and every entry of a node list), no `solo` part names a node
of several primitives, every scatter part exists in the forest kit, every kerb clutter node
exists, every named atlas cell is painted by something, the rig has the three attachment
bones, and every clip in `crew.clips` — and through it every `stateClips` entry — is in the
crew glb.

Four checks arrived with the cast and the seasons, each for a failure that otherwise reaches
the screen rather than the terminal: every image in `kits.<k>.atlases` is in the glb and
every `settings[i].atlas` is a season some kit declares (a typo in either falls back to
another season silently); each `crew.characters[i].mesh` matches a skinned node or prefix
(`crew.js` throws at bake time, which is a blank screen and no message); and every
`crew.propNodes` name is a static node in the crew glb (a hand tool that never appears).
`stateClips` is walked in both forms — a plain key, and every arm of
`{ default, byCharacter }`.

### `npm run inspect-kit <glb> [cols rows]`

What is actually in a file. The first thing to run when the validator says a node is missing,
and the quickest way to find out what a part is called. `cols`/`rows` default to `8 4`.

```
$ npm run inspect-kit public/assets/space/spacebase.glb
public/assets/space/spacebase.glb: 73 nodes, 0 bones, 0 clips, atlas 1024x1024
  basemodule_A                 cells 1,2,3,11
  basemodule_B                 cells 1,2,3,11
  ...
  windturbine_tall_fan         cells 1,2,11
```

Each line is a named node and the atlas cells its triangles sample, found by bucketing each
triangle's mean UV — so `basemodule_A` paints cells 1, 2, 3 and 11, and cell 11 is the trim
band the accent repaints. On a crew kit it prints the skeleton and the clips instead:

```
$ npm run inspect-kit public/assets/space/crew.glb
public/assets/space/crew.glb: 6 nodes, 21 bones, 15 clips, atlas 512x512
  ...
bones: root hips upperleg.l lowerleg.l foot.l toes.l spine chest upperarm.r lowerarm.r wrist.r hand.r head upperarm.l lowerarm.l wrist.l hand.l upperleg.r lowerleg.r foot.r toes.r
clips: Hit_A Idle_A Idle_B Interact Spawn_Ground Jump_Full_Short Running_A Walking_A Cheering Sit_Floor_Down Sit_Floor_Idle Sit_Floor_StandUp Waving Hammering Working_A
```

Two more lines follow the node list. **`textures (N)`** names every glTF image in the file,
in the order the file lists them: this is where you check that a season's sheet was embedded
and under which name, since `kits.<k>.atlases` matches these strings exactly (an unnamed
image prints as `<unnamed>`, which is itself the answer to why a season will not resolve).
**`statics (N)`** counts every mesh node with no skin and names them when there are twelve
or fewer — in a kit glb that is all of them, and in a crew glb it is the hand tools, whose
names are what `crew.propNodes` and a props hook's `node` have to say.

### `ASSETS_SRC` and `.env`

Raw packs live **outside the repo**, under the directory `ASSETS_SRC` names, one folder per
pack with the zips kept alongside. They are never committed — they are large, and several are
paid tiers.

```dotenv
# .env  (git-ignored; copy from .env.example)
# Windows: ASSETS_SRC=D:\data\taskshire\assets-src
# macOS:   ASSETS_SRC=~/data/taskshire/assets-src
ASSETS_SRC=./assets-src
```

`tools/read-env.mjs` reads the file with no dependency, and anything already in the
environment wins over it. Every `src` in an `assets.config.mjs` is relative to this
directory. If you have no packs, do nothing: the checked-in glbs are what the app loads.

The reader takes `KEY=value` lines, and only those. What it does with a value:

| In the file | Reads as |
| --- | --- |
| `A=./packs` | `./packs` |
| `A=./packs # where the zips went` | `./packs` — an unquoted value ends at the first ` #` |
| `A="./packs # kept"` | `./packs # kept` — quotes end the value, so a `#` inside them is a character |
| `A=~/data/taskshire` | `<home>/data/taskshire` — a leading `~` expands |
| `A=~someone/x` | unchanged — another user's home is not ours to guess |

Lines may end `\n` or `\r\n`, may start `export `, and a whole-line `#` comment is skipped.

## 5. Blender export settings

File → Export → **glTF 2.0**. The settings that matter:

| Setting | Value | Why |
| --- | --- | --- |
| **Format** | `glTF Separate (.gltf + .bin + textures)` | The packer reads a *directory of single-model `.gltf` files* and merges them — see below |
| **Include → Limit to** | `Selected Objects` | One object per file. The **object** name becomes the node name recipes reference; the **file** name is what a `models` list in `assets.config.mjs` matches. Keep them the same |
| **Include → Data → Custom Properties** | off | Nothing reads them, and they bloat the file |
| **Transform → +Y Up** | on | glTF is Y-up; Blender is Z-up. Off, and every model lies on its face |
| **Data → Mesh → Apply Modifiers** | on | Otherwise a mirrored or subdivided model exports as its unmodified cage |
| **Data → Mesh → UVs** | on | The atlas lookup *is* the UVs; without them nothing has a material |
| **Data → Mesh → Normals** | on | Recomputed normals from flat-shaded kit geometry are wrong at every bevel |
| **Data → Mesh → Tangents** | off | Not used; the shader derives what it needs |
| **Data → Material → Materials** | `Export`, images `Automatic` | One image, referenced by every model — do not let Blender bake a copy per object |
| **Compression (Draco)** | **off** | `@gltf-transform` reads the mesh directly; Draco would have to be decoded before merging and re-encoded after |

For an animated (crew) kit, additionally:

| Setting | Value |
| --- | --- |
| **Animation → Mode** | `NLA Tracks` (Blender 4.x) / `Group by NLA Track` (3.x) — one clip per track, named by the track. `Actions` works too if each clip is one action |
| **Animation → Sampling Rate** | `1` — sample every frame; the engine re-bakes at 30 fps anyway |
| **Animation → Always Sample Animations** | on — this is the bake |
| **Animation → Armature → Export Deformation Bones Only** | off, unless every attachment bone is also a deform bone |
| **Shape Keys** | off — the skinning path is bone matrices only |

The clip's name in the export is the name `crew.clips` has to use. Sampling matters: without
it, constraint-driven and IK bones export as empty channels, and the retargeter drops what it
cannot match — `build-crew.mjs` prints `retargeted N channels, dropped M with no matching
bone`, and a non-zero `M` is the first thing to look at when a clip renders as the bind pose.

### Why "glTF Separate", and one file per model

`tools/build-kit.mjs` takes a **directory** of `.gltf` files and merges them into one glb
with one material and one texture, keeping each model as a named scene node. That is exactly
the layout Blender's *batch export by object* produces, and exactly the layout the KayKit
packs ship in. So:

- **model kits**: one `.gltf` per model, all in one directory, all pointing at the same
  `atlas.png` beside them. `.glb` files in that directory are ignored.
- **crew kits**: a single `.glb` for the body and a directory of `.glb` clip files —
  `build-crew.mjs` reads those, unlike `build-kit.mjs`.

Export the whole kit to one directory, run `npm run assets`, and let the packer make the glb.
Do not hand-merge in Blender: one merged object loses the node names every recipe depends on.

## 6. Worked example: one custom building on the space kit

The goal is a new building kind called `watchpost` — a base module with a solar roof, a lamp,
and a crate half the time. It uses nodes that are already in `spacebase.glb`, so it needs no
new art and you can follow it end to end right now.

### Find the parts

```
$ npm run inspect-kit public/assets/space/spacebase.glb
```

which lists, among the 73 nodes:

```
  basemodule_D                 cells 1,2,11
  containers_A                 cells 2,18
  lights                       cells 1,2,11
  roofmodule_solarpanels       cells 2,28,29
```

### Add the recipe

In `src/themes/space/manifest.js`, inside `buildings.kinds`:

```js
watchpost: {
  label: 'Watchpost',
  parts: [
    { node: 'basemodule_D' },
    { node: 'roofmodule_solarpanels', y: 'deck' },
    { node: 'lights', x: 1.15, z: 0.85, s: 0.85, ry: { rand: { base: 0, scale: 6.28 } } },
    { if: 0.5, then: [{ node: 'containers_A', x: -1.15, z: 0.9 }] },
  ],
},
```

The step vocabulary is `src/world/recipes.js`, which is a pure interpreter — no three, so the
validator and the unit tests run it under Node:

| Step | Does |
| --- | --- |
| `{ node, x, y, z, ry, s, spin, emissive, solo }` | one part. `node` may be a string, an array (one is drawn at random) or `{ var, suffix }` |
| `{ let, value }` / `{ let, randInt: [base, span] }` | bind a variable a later step reads with `{ var: 'name' }` |
| `{ if: p, then: [...], else: [...] }` | takes `then` when `rand() > p` |
| `{ ring: { node, count, radius, o } }` | `count` copies spaced around a circle, each turned to face along it |
| `{ grid: { node, cols, rows, dx, dz, ry } }` | a `cols × rows` field, both from bound variables |

Numeric fields are a number, the string `'deck'` (the top face of a base module, from
`buildings.deck`), `{ rand: { base, scale } }`, `{ jitter, add }`, or `{ var, mul }`. Fields
are evaluated in the order `x, y, z, ry, s, spin, emissive` — always, so a recipe with two
random fields still draws the same structure from the same seed.

### Validate

```
$ npm run validate-kit space
space: kit ok — 2 kits, 11 recipes, 15 clips
```

Eleven recipes rather than ten: the new kind is in, and every node it names is in the kit.
Get a name wrong and you get the line instead, with the kind that owns it:

```
$ npm run validate-kit space
✗ buildings.kinds.watchpost: no node "myshed" in the base kit
```

### See it

`npm run dev`. A kind is picked per thread from the seeded RNG over `buildings.kinds`, so a
new kind changes which building some existing plots get — that is a legitimate change, and
`npm run test:visual` will report it as differing pixels — it writes a rendered PNG, its
counters and a `.diff.png` per shot into `tools/visual/out/` (git-ignored), and names the
shots that differ. Look at those, and if it is the change you meant,
`npm run test:visual:update` rewrites the baseline. Commit the manifest and the new baseline
together.

> The `watchpost` recipe is **not** in the manifest. It was added, validated (the eleven-recipe
> line above is real output), and removed again, because leaving it in would move pixels for
> no reason. Paste it in to follow along.

### If the building needs a *new* model

The same recipe, plus three steps in front of it:

1. **Export the model** into the pack's `gltf` directory next to the others —
   `<ASSETS_SRC>/KayKit_Space_Base_Bits_1.0_FREE/Assets/gltf/myshed.gltf`, on the same
   `atlas.png`, with the settings in §5, and the Blender object named `myshed`.
2. **Add it to the pack's model list** in `src/themes/space/assets.config.mjs`. The base kit
   is `models: null`, meaning "the whole directory", so a new file there is picked up with no
   edit at all. The forest kit has an explicit list, and a model added to that pack has to be
   named in it. A name in a list with no matching file is a hard error:
   `no such model: myshed`.
3. **Rebuild and validate**:
   ```bash
   npm run assets space -- --force   # --force so a missing pack fails instead of skipping
   npm run validate-kit space
   npm run inspect-kit public/assets/space/spacebase.glb   # myshed should be listed
   ```
   `--force` matters here: without it, a machine that does not have the raw pack unzipped
   quietly keeps the old glb, and the validator then fails with `no node "myshed"` for a
   reason that has nothing to do with your model.

Then `npm run test:visual`, eyeball the diff, `npm run test:visual:update`, and commit the
manifest, the rebuilt `spacebase.glb` and the new baseline in one commit.

### If the part is not in any pack: a generated part

The Medieval Hexagon pack has no torch, and a village at night wants one. Rather than open
Blender for three boxes, a kit may name a **generator**: a module the packer imports and
calls while it is assembling the document.

```js
// src/themes/medieval/assets.config.mjs
generated: [{ module: 'src/themes/medieval/torch.mjs', name: 'torch' }],
```

`module` is a path from the repo root and its default export is `generate(doc, scene, name)`
— the gltf-transform `Document` being packed, its default scene, and the node name to
create. `src/themes/medieval/torch.mjs` builds a post, a bracket and a flame and adds them
as one named node. Three things make that a first-class kit part rather than a special case:

1. **It runs before the transforms**, after every `.gltf` has been merged and before `weld`,
   `dedup`, `prune` and `unpartition` — so a generated node is welded and deduplicated like
   a packed model and shares the kit's one buffer.
2. **It writes UVs at cell centres.** A generated box has no unwrap of its own, so each face
   takes `((col + 0.5) / cols, (row + 0.5) / rows)` for the swatch it should be painted
   from. Every triangle then lands squarely in one cell, which is what `inspect-kit` reports
   and what the accent and emissive terms key off; a UV on a cell boundary is the one way to
   get a part that flickers between two materials.
3. **It reuses the kit's own material** — no new texture, no second draw call. The flame is
   the cell named `FLAME` in the manifest, and because that cell carries an `emissive` entry
   under `pbr` it lights itself after dark with no light source and no extra geometry.

From there it is an ordinary node: recipes name `torch`, and both tools see it.

## 7. Adding a whole theme

Out of scope here, but the shape is in `src/themes/`: a directory with `index.js`,
`manifest.js`, `assets.config.mjs` and whichever of the five hooks (`ceremony`, `surfaces`,
`faces`, `particles`, `props`) it wants to override — any it omits falls back to the space
implementation. Add the id, its display name and its loader to the table at the top of
`src/themes/index.js`, and it appears in the settings panel's theme picker.

`src/themes/medieval/` is the worked example. It is a complete second theme built entirely
out of manifest data and hooks — two kits from one pack, four seasonal repaints of one
atlas, a cast of eight on one skeleton, a castle ceremony, a grass deck and a stone kerb,
its own particles, and a generated torch — and it names no engine module of its own. It
overrides four of the five hooks and lets `faces` fall through, because the expression atlas
is only ever sampled by a face part and this theme has none. Read it next to
`src/themes/space/` when writing a third: what differs between them is the whole surface a
theme has to fill in, and a theme that fails `validateManifest` at boot falls back to the
space colony with a notice rather than a blank canvas.

Some manifest fields are easy to miss because the space theme's values read like engine
constants:

- **`plots.clutterLamp`** — which entry of `plots.clutter` is the tall one, scaled by
  `clutterLampScale` rather than `clutterScale`. Space names its floodlight, `'lights'`.

  Every prop the kerb clutter places is recorded on `Plot.clutterSpots` as
  `{ name, x, z, r, top }`: the kit node name, the plot-local position, the radius to block,
  and the prop's height above the deck. `Colony._rebuildNavigation` walks that list once and
  does two things with it: blocks a disc per prop so nobody walks through a barrel, and
  collects the entries named by `plots.clutterLamp` as the lamp positions the
  `particles.ambient` hook is handed. So a theme that changes `plots.clutter` changes the
  yard's obstacles and its lights together, and a `clutterLamp` node that the clutter list
  never places simply yields no lamps.

  The node is handed to `configureBuildings` as well, and there it does the same job one
  level up: a *recipe* that places it — the medieval tavern's pair either side of the door,
  the watchtower's one — has those placements written to `mesh.userData.lamps` as
  `{ x, y, z, stage }` in the building's own frame, `y` the part's bounding-box top so the
  entry sits at the flame. The same navigation rebuild rotates them by the building's yaw,
  adds its position and appends them to the lamp list, so a torch on a wall gutters exactly
  like a torch on a kerb. Two gates keep the wrong ones out: a ghost's building is skipped
  with its plot, and a torch whose `stage` runs ahead of the thread's progress is not
  standing there yet, so it throws nothing. Space's `habitat` places its `'lights'` node and
  therefore builds a lamp list too — its `particles.ambient` takes three parameters and never
  reads one, which is why none of this moves a space pixel.

- **`buildings.staged`** — optional, default false: whether a plot is *built* rather than
  delivered whole. With it on, `Colony._syncBuilding` writes each building's
  `transcriptProgress(thread)` into its `uStage` uniform, and any part whose recipe step
  carries a higher `stage` is discarded in both the surface and the shadow pass. So a young
  thread is a building on bare ground and an old one a dressed yard, and the plot agrees with
  the progress bar on the thread's own HUD card because it is reading the very same number.
  Leave it out and every building is whole from its first frame, whatever stages its recipes
  happen to declare — which is why the space colony renders exactly as it always did.

- **`stage` on a recipe step** — optional, default 0: which fraction of the thread's progress
  that part waits for. A plain number in [0, 1]; never one of the random forms, and it draws
  nothing from `rand`, so adding stages to a recipe cannot move anything the seed placed.
  It may sit on any part step, including one inside an `if` branch, and on a `ring` or `grid`
  step's own object, where it applies to every part that step expands to.

  The scale is `transcriptProgress`, a log of the transcript's size: 0.05 for an empty
  thread, 0.46 at 40 kB, 0.68 at 240 kB, 0.94 at 2 MB, 1 at 3 MB and up. Pick stages against
  that, not against a notion of percent-complete — a thread that has said very little sits
  near 0.46 however old it is, so a body staged much above 0.5 is a lot that stays empty.
  The medieval theme's ladder is in the comment above `buildings.kinds` in its manifest.

- **`buildings.byCharacter`** — optional: character id → the kind ids a plot may be given
  when that thread's villager is the one who lives there. `Colony._syncBuilding` asks
  `kindForThread(thread.id, byCharacter, characters)` (in `agents/cast.js`) for the kind and
  hands it to `createBuilding`, so the mage's plot is a shrine or a watermill and the smith's
  a forge. The pick inside a list is `(hash(id) >>> 3) % list.length` — a shift the character
  draw (`hash % n`) and the colourway (`>>> 5`) do not use, so a villager's house is not
  welded to the colour of its coat.

  Every key must be an id declared in `crew.characters` and every entry a key of
  `buildings.kinds`; both are checked at load. A character the map omits, or a theme with no
  map at all, falls back to the recipe seed's own draw exactly as before — which is what the
  space theme does. Note that a forced kind skips the seed's kind draw, so *every* later draw
  in that recipe shifts: adding or editing a list moves the theme's baselines. Put `home` in
  every list unless you want a village of nothing but trade halls.

- **`plots.lampPosts`** — optional, default true: whether `Plot._buildPosts` stands the
  engine's own procedural lamp post on a corner of every cell. It reads as a streetlight,
  which is right for a colony and reads as a stick with a bauble on it in a village, so the
  medieval theme sets `false` and lights its kerbs with the torch in `clutterLamp` instead.
  The default is on, so a theme that never mentions it keeps the posts it always had.
- **`settings[i].rim`** — optional, `{ recipe, inner, outer, count }`: a second scatter
  population in the ring of ground the camera actually shows. The default view never reaches
  the horizon — the plots stop at 46 units, the navigation grid at 56, and the top of the
  frame is ground around 60 out along the far bearing and further to the sides, which is why
  the medieval rims run to 80–82 — so a setting's landscape has to be built in that band or
  it is not in the picture. `createScatter` plants `count × density` instances of
  the named recipe in the annulus `[inner, outer]`, honouring `keepClear`, and appends its
  own `InstancedMesh` per recipe entry with `userData.rim` set.

  Two things separate a **rim recipe** from a scatter recipe, and both are why the rim gets
  recipes of its own rather than reusing `settings[i].scatter`:

  1. **Sizes are literal.** The main population multiplies far-field props by up to 2.9,
     which is what gives the horizon its scale; the rim skips that entirely, because the rim
     is *close*. Author a rim entry for a piece seventy units from the camera, which usually
     means numbers well under the scatter recipe's.
  2. **Counts are read against the visible band, not the map.** Most of the annulus is
     off-frame — the near arc falls below the bottom edge — so the count that fills the
     picture is several times the count that would look even on paper. Tune it against the
     PNG and expect a figure that looks too large in the manifest.

  The rim loop runs *after* the main population is finished and its meshes are sealed, so it
  draws no `rand` the main scatter used to draw: adding a `rim` to one setting cannot move
  another setting's pixels, and a setting that declares none executes none of the code. The
  recipe name is checked against the theme's own `scatter` at load, like `settings[i].scatter`.
  The medieval theme's `alpineRim` is the worked example.
- **`settings[i].water`** — optional, `{ axis, from, level, color, depth }`: the sea down one
  side of a setting. `axis` is a unit vector in the ground plane and `d = x·ax + z·az` is the
  signed distance along it, so the wet half is the half-plane `d > from` — one straight coast
  across the picture, not a ring around the colony. Three things happen, and only when the
  field is present:

  1. **The ground goes under.** The terrain sampler subtracts
     `smoothstep(d, from − 10, from + 8) × depth` after the craters, from `shapeValley`,
     the last layer of `groundHeight`, which both `createTerrain`'s loop and `terrainHeight`
     call — one function because the two have to stay in step or scatter floats above the
     surface it sampled. The shore is that slope, and its colour is whatever the setting's own
     height ramp paints across the band.
  2. **A plane is built.** `createWater(setting)` returns one `PlaneGeometry(340, 340)` at
     `y = level` in `color`, `receiveShadow`, named `water`; the colony adds it beside the
     terrain and disposes it on every rebuild. It covers the dry half too, where it is under
     the ground. It returns `null` without the field, so a dry setting allocates nothing.
  3. **Nothing is planted in the water, or in the surf.** All three scatter populations skip
     an instance whose *ground* is under `level + SHORE_BAND` (4 units, `setting.js`), tested
     on the height rather than on a distance — so it culls whatever shape the coast turns out
     to be — and *after* `keepClear`, so the draws already made are unchanged. The strip
     between the last thing planted and the waterline is the bare shore.

  That guard is a contract on `level`: it has to sit at least `SHORE_BAND` **below** the flat
  ground the colony stands on, or the village's own meadow is culled as surf. The valley's
  ground runs −0.27 to +0.13 and its `level` is −4.7 for exactly that reason; `depth` is then
  what decides whether four units of height is a visible strip of beach or two pixels of it.

  The whole block is a branch, never a multiply by zero: a setting without `water` produces
  exactly the floats it produced before the field existed, which is what keeps the space
  theme's four baselines byte-identical.
- **`settings[i].ridge`** — optional, one `{ axis, from, width, height, recipe, count }` **or a
  non-empty array of them**: the mountain wall opposite the sea, on the same half-plane
  arithmetic as `water` and applied after it. A list is a range made of several walls — the
  mountain carries two, one across the top of the frame and one closing the top right — and
  they *add*, so the corner two half-planes share carries both climbs. Each entry plants its own
  crag population from its own recipe and count, in manifest order, and each is validated
  separately (`settings[i].ridge[1].axis`). The terrain climbs `smoothstep(d, from, from + width) × height ×
  (0.55 + 0.45 × fbm)` — noise on the *amplitude*, so the massif has spurs and saddles while
  `from` stays exactly where it says — and `recipe`/`count` plant a third scatter population
  on it: uniform along the axis over `[from, from + width + 24]`, the full width of the
  ground across it, sizes literal as on the rim, `userData.ridge` on every mesh. It runs last,
  after the rim's meshes are sealed, so it consumes no `rand` that either population before it drew.
  The recipe name is checked against the theme's own `scatter` at load, like the rim's.

  The terrain carries the mass and the recipe carries the silhouette. `from` wants to be the
  first ground past the plots (the valley's is 50, the colony ring ends at 46) so the wall
  fills the side of the frame without lifting anything that is built or walked on.

  **Both axes are chosen against the camera, not the map.** The rest pose looks down the
  `(−1, 0, −1)` bearing, which puts screen-left at `(−0.71, 0, +0.71)` — but the frame is
  only ~34 units wide at the colony and ~70 at the top, so a coast on that bearing, held past
  the plots, is a corner sliver. The valley rotates both 35° towards the far bearing, into
  the deep half of the frame where it is wide. Derive it from `CameraRig._sync`, then look at
  the PNG.

  **Count against the frame, not the map.** The strip is 58-odd units deep along the axis and
  the rest camera keeps about eight of them, because the climb lifts its own ground off the top
  edge within a few units of `from`. Measured on the mountain: 2500 planted puts 27 crags in the
  picture, 10000 puts 91. Project the placements through the rest pose before choosing a number.
- **`settings[i].hills`** — optional number, default 1: a multiplier on the far-field terrain
  term, the one that ramps in between 40 and 86 units out. The flat colony floor does not take
  it, so a setting can have real relief past its plots with its plots still level. Applied as a
  branch rather than as a multiply by one, so a setting that omits it has the floats it always
  had. **A setting with `water` must watch its sea**: the term is amplitude, so it lifts the
  seabed as well as the meadow, and a shallow sea comes up through its own surface. The valley
  is held to 1.1 for exactly that reason — see its note in the medieval manifest.
- **`plots.maxTilt`** — optional number, a finite value of 0 or more, default `Infinity` (spell
  that by omitting the field): how far the ground may climb across one lattice cell — the spread
  over its centre and six corners — before `blockedCells` refuses a plot that cell. A deck is a
  prism at a fixed height, so ground that moves under it shows as daylight beneath one rim and
  turf through the other. It is a theme number, not a setting one: the slab is the same slab in
  every world. A theme that says nothing keeps the water-only allocator every theme had before,
  and samples no terrain at all.

  **Setting it also turns the skirt test on for the theme's dry settings.** A cell that is evenly
  low has no spread and still floats, so `Colony._blockedCells` asks both questions: the tilt,
  and whether any of the seven samples is below `-deckSkirt`. The medieval theme sets 1.2, and
  what that costs is mostly the skirt half — of its three settings the tilt rule proper reaches
  inside ring 5 on the mountain alone (two cells of ring 4), while the skirt takes ten of the
  forest's ring 4 and thirteen of the mountain's. Nothing on any setting is refused inside ring
  3. Measure per ring before choosing a number; a colony that needs ring 4 will feel it.
- **`fade`** — optional, `{ floor: 0.25 }`: the share of a zone's pixels a fully faded
  (about-to-leave) repo still draws. The fade is a Bayer dither in every plot and building
  material (`src/world/fade.js`), so a theme tunes only its depth. Since 2026-09-12 the
  dither and the colour drain sit behind the *Fade ghost towns* setting, off by default;
  lights-out is unconditional.
- **`decay`** — optional. What a theme grows over a ghost zone as it ages, so a quiet repo
  reads as abandoned without the dither. `kit` names the (usually lazy) kit the parts come
  from; `scatter` the models sprouting on the deck, `perCell` how many per cell and `scale`
  their size range, revealed one by one as `fade` climbs; `swap` maps a kerb clutter name to
  its ruined twin (a crate to an open crate), swapped in the same order; `ruin` is a building
  recipe every house on the zone is replaced by once `fade` reaches `ruinAt`. Everything is
  placed from private seeded streams on the first frame a zone ghosts and never touches
  `Math.random`; a theme that says nothing gets no dressing (the space theme). The rules
  are pure in `src/world/decay.js`; the validator checks every name against the kit.
- **`copy.fadeHint` / `copy.hideHint` / `copy.pinHint`** — optional strings for the quiet
  row's tooltip and the two repo-panel buttons. The engine has plain fallbacks.
- **`copy.soundHint` / `copy.effectsHint`** — optional strings for the Sound group's
  *Ambient sound* and *Effects* rows (a theme with the `sound` feature), naming what this
  theme sounds like: the colony's effects are drones and a chime, the village's a lute and
  its bells. A row without one has no hint.
- **`sounds`** — what the colony's own four moments sound like, by name in the sound
  registry (`src/audio/sounds.js`). Required of a theme with the `sound` feature, because
  every call site reads it with no fallback; the schema checks its shape wherever it is
  written, and `tests/theme-sounds.test.mjs` that each name is registered and of the kind
  its use needs.
  - `select` — the phrases an inhabitant answers a click with (events), one of them, never
    the same twice in a row; `pickPhrase` keeps the space colony's old pick for its six.
  - `attention` — the one sound allowed to interrupt: a thread that has just put its hand
    up (an event).
  - `work` — the loop at an inhabitant working at its site.
  - `arrival` — keyed by the ceremony's `kind`, each `{ loop }` or `{ event }`. A `loop`
    stands at the arrival for as long as it is there, from its `soundAt(out)` if it has
    one (the boat's creak) or a little over its cell (the lander's hum); an `event` plays
    once at the door when someone new walks out (the keep's bell), at most once every
    `BELL_GAP` seconds of colony time. A kind with no entry is silent; the test holds the
    keys to the kinds the theme's worlds build, and a theme with one fixed arrival names
    its own (the space colony's `ship`).

  ```js
  sounds: {
    select: ['pluck-1', 'pluck-2', 'pluck-3', 'pluck-4'],
    attention: 'hand-bell',
    work: 'work-hammer',
    arrival: { castle: { event: 'keep-bell' }, fortress: { event: 'keep-bell' }, boat: { loop: 'hull-creak' } },
  }
  ```
- **`kits.<k>.atlases`** — the season keys are also the settings panel's Season row: *Auto*
  plus one button per key of the first kit that declares any, capitalised. A theme whose
  kits declare none never shows the row, which is why the space panel has no season. Name
  the keys as you want them read on screen.
- **`crew.attach`** — the roles a props hook may hang geometry off. A prop that asks for a
  role this does not name throws at boot with the role in the message, because the bone
  matrix behind it would otherwise be `undefined` and every matrix downstream `NaN`.

### The ceremony hook

`ceremony(scene, position, manifest, setting)` builds the one fixed piece of narrative
furniture a theme has — the space colony's lander, the village's keep — and returns an
object the engine then holds for the life of that arrival:

| member | read by | what it is |
| --- | --- | --- |
| `group` | `Colony._buildTerrain` | the `THREE.Group` in the scene; the colony sets its `y` to the terrain height each rebuild |
| `door(out)` | every spawn and every archive | world position where inhabitants appear and vanish |
| `update(dt, elapsed, night)` | the frame loop | `elapsed` is the simulation clock; never read a wall clock, the visual harness fakes one |
| `ping()` | `main.js`, on traffic | someone is using it — open the doors, brighten the lights |
| `dispose()` | teardown, and a ceremony swap | |
| `kind` | `Colony.setSetting`; `Colony.soundWorld` and `Colony._announceArrival` | which arrival this is, and which entry of `sounds.arrival` it sounds by |
| `clearance` | `Colony._rebuildNavigation` | radius of the one navigation obstacle put at the ceremony, before `AGENT_RADIUS` is added |
| `apron` | `Colony._buildScatter` | radius the ground scatter is cleared from |
| `blocks` | `Colony._rebuildNavigation` | optional: extra world-space `{x, z, r}` discs beyond `clearance`, before `AGENT_RADIUS` is added. The mountain fortress's rear tower is the only one today; a ceremony that omits it blocks exactly what it always did |
| `soundAt(out)` | `Colony.soundWorld` | optional: world position the arrival's `loop` comes from, written into `out` and returned. The boat's is the middle of its hull, so the creak follows the ship out to its mooring; a ceremony that omits it sounds a little over its cell. Like `door()`, it may not read `matrixWorld` |

**`door()` has to answer before the first frame, so it may not read `matrixWorld`** (written
down 2026-09-12, `feature/medieval-follow-ups`, after every ceremony got this wrong). Three
composes `matrixWorld` during the render walk and at no other time; the crew reads `door()`
when the first roster lands, which is earlier than that, and again on the frame a setting is
swapped. A ceremony that transforms its local offset through `group.matrixWorld` therefore
hands back the raw local offset — the middle of the map — on exactly the frames that decide
where a batch of arrivals starts walking from. Call `worldDoor(group, doorLocal, out)` from
`src/world/ceremony.js` instead: it composes the group's own `position`, `quaternion` and
`scale` into a scratch matrix and writes nothing to the scene. That is legitimate because
every ceremony adds its group straight to the scene, so the local transform *is* the world
transform; a ceremony that nests its group under something else would have to say so.

**Which arrival a setting gets is the setting's own choice.** A setting may carry

```js
ceremony: { kind: 'boat', cell: { q: -3, r: 1 } }   // both optional — the valley's own
```

- `kind` is passed to the hook, which picks the implementation. The names a theme can build
  are listed in `manifest.ceremonies`, and the schema holds every setting's `kind` against
  that list — so a typo is a load-time error rather than a village with no way in. A theme
  that declares no `ceremonies` has one fixed arrival and never sees the field.
- `cell` overrides `plots.ceremonyCell` for that setting. `Colony._makeCeremony` installs it
  through `setCeremonyCell` in `world/plots.js` *before* building the arrival, because two
  things read that one value: `ceremonyPosition`, which is where the arrival stands, and
  `allocateCells`, which refuses to hand that cell to a repo.
- `clearance` and `apron` come off the object rather than out of `plots`, because a castle's
  walls and a dock's pier do not cover the same ground. `plots.ceremonyClearance` and
  `plots.ceremonyApron` are therefore required only of a theme with **one** arrival; the
  space ship reads them from the manifest it is handed and passes them on unchanged.

`Colony.setSetting` swaps the arrival when the new setting names a different `kind`, or puts
the same one on a different `cell` — disposing the old one, moving the cell, constructing the
new one, all before `_buildTerrain` re-scatters the ground and rebuilds the navigation grid,
so both are measured from the arrival that is actually standing there. A moved cell also
invalidates the plot layout; nothing special is done about that, because `allocateCells`
drops any cell it is asked to reserve on the very next poll and re-seeds a zone whose root it
takes, so the lattice repairs itself within one scan.

The medieval village is the worked example, and it has three.
`src/themes/medieval/index.js` dispatches on the kind; `keep.js` owns the shape both land
arrivals share — a keep on the cell with a free-standing tower on each flank — and the radii
that follow from it, while `castle.js` (forest) and `fortress.js` (mountain) are a *style*
object each and nothing more: which keep, which tower, which banner, how big, how far out.
`wall.js` holds what belongs to the *pack* rather than to any one building — how wide a wall
piece is, where a door leaf pivots, how far it swings, how the pack's one-handed corner is
mirrored — and `boat.js` is the valley's dock and the ship that calls at it.

**Two kinds of one shape is still two kinds.** `castle` and `fortress` share every line of
their geometry code, but each is its own name in `ceremonies` because a `kind` is what
`Colony.setSetting` compares to decide whether crossing from one setting to another has to
tear the arrival down and build another. A style is not visible to the engine; a kind is.

**A ceremony that floats.** The boat is worth reading for the one thing it does that the
castle does not: it is placed against the *water* rather than against the ground. The colony
sets every arrival's `group.position.y` to the terrain height at its cell, which is right for
a castle and wrong for a pier — so `boat.js` puts its dock, its ship and its rowing boat at a
local y of `setting.water.level - group.position.y`, recomputed every frame because
`_buildTerrain` moves the group whenever the ground is rebuilt. Anything a theme wants to put
on a sea does the same; there is no hook for it and none is needed.

Two other things a shore arrival has to think about, both recorded in full in the source:

- **The cell is not the thing.** A castle is centred on its cell. A pier starts on land and
  has to reach water, which on a lattice of 7.6-unit cells is never a whole number of cells
  away — so the boat's cell is a station on the bank and the dock is laid `PIER_OUT` seaward
  of it. The valley's cell was chosen by three tests, in this order: it is in frame from the
  default camera, it is on dry ground, and a 7.8-unit pier from it crosses the waterline with
  every one of the pack's three pilings past it.
- **The door is not on it either.** `Colony._rebuildNavigation` blocks a disc of
  `clearance + AGENT_RADIUS` at the cell, and on a coast that disc has to reach the water or
  villagers walk into the sea beside the pier — the navigation grid has no idea where the sea
  is. So `door()` is that radius plus a stride landward, on the flat top of the bank. The
  keep's `DOOR_OUT` note is the same argument with a keep's front wall in place of a pier.

### Hook fields the space theme never uses

- **`surfaces().deckTint`** — `'accent'` (the default), `'none'`, `'ground'`, or `'glaze'`. The first
  paints a plot's deck in a darkened repo colour, the second leaves the deck texture alone,
  and the third paints it with the *setting's* `ground.tint` lifted 35% toward white, so one
  drawn green can read as summer meadow in a wood, stubble in a valley and frozen turf on a
  mountain. A `'ground'` deck is repainted live on every setting change rather than only at
  build, which is what `setPlotSeason` in `world/plots.js` is for. The tint **multiplies** the
  texture, so a deck texture for this mode has to be authored pale: a mid-green grass sheet
  under a snow tint comes out grey-green, and no tint value fixes it. The village went the
  other way in the end — its deck is a kit tile and takes its season from the atlas, so it
  asks for `'none'` — but the mode is what a *drawn* deck in a theme with seasons wants.
  `'glaze'` is what the village asks for now: the deck keeps its own colour and the repo's
  accent is mixed into it in the shader, before lighting — a multiply cannot tint saturated
  grass, only darken it. Its strength is the user's *Zone tint* slider (`deckGlaze`), which
  the HUD shows only for a glazed theme.
- **`surfaces().deckGeometry(cell)`** — build one deck cell yourself instead of taking the
  engine's hex prism. The engine calls it once per lattice cell while it builds a plot and
  hands it `{ tile, top, skirt, x, z, textureScale }`: the cell's circumradius, how far the
  slab stands above y=0 and below it, the cell's **plot-local centre**, and
  `deckTextureScale`. Build the cell centred on the XZ origin with its **top face at y 0**,
  its bottom at `−(top + skirt)` and its corners on **±X** — the lattice is flat-top — and
  hand back a `BufferGeometry`. The engine translates it into place by that top face, merges
  the plot's cells into one mesh, tints it, fades it with the zone and disposes it with the
  plot; nothing else changes. `x` and `z` are given so a second UV set can be projected in
  plot space and run continuously across the whole zone rather than repeating per tile.
  Returning **null** means "use the prism", and so does leaving the field off — which is the
  answer a theme whose kit has not finished loading must give, because `deck()` and this are
  both called lazily at plot build and a missing part is not an error.
- **`surfaces().kerbInset`** — how far the kerb bar's outer face stands in from the tile's
  edge, as a number or as a function of the tile radius. The default is 0.05, the engine's
  own literal, so a theme that says nothing keeps the kerb exactly where it has always been.
  A modelled deck tile usually needs more: the village's is `hex_grass`, whose top face stops
  short of the full radius and falls away in a 0.05 chamfer, and a bar laid across that bevel
  leans outward and loses its cobbles to the slope. It may be a function because `surfaces()`
  runs at boot, before `configurePlots` has told the theme what a tile is, and an inset
  measured as a proportion of the tile has nothing to work from until the engine asks. The
  engine resolves it once per plot.
- **`particles.ambient(dt, camera, setting, lamps, night)`** — the per-frame weather hook.
  The last two arguments are for a theme whose weather keeps hours: `lamps` are the world
  positions `{x, y, z}` of every flame in the village, so an ember can sit over each,
  refreshed with the navigation grid, and `night` runs 0 to 1 with the light. Two sources
  feed that list, both keyed on `plots.clutterLamp` — see above: the kerb clutter spots off
  `Plot.clutterSpots`, where `y` is the deck top plus the prop's own height, and the torches
  a recipe stood on a building, rotated out of `mesh.userData.lamps`. A plot fading out drops
  both off the list. A hook declaring only three parameters —
  space's does — is called the same way and simply never sees them.

  **A weather hook that wants randomness should seed its own stream** (2026-09-12,
  `feature/medieval-follow-ups`). Under the snapshot harness `Math.random` is one mulberry32
  stream shared with three's `generateUUID`, which spends four draws per geometry, material and
  texture — so a hook drawing from it moves the weather in every later shot on the page
  whenever an earlier one gains a mesh, and a page of baselines rewrites itself over a change
  that touched none of them. The medieval hook takes a private `mulberry(0x5eed)` for all 42
  of its draws. It is not a cure for everything: the crew is seated from the shared stream
  upstream of the hook, so a private stream pins the weather and not the villagers.
