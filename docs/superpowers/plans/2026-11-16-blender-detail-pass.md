# Blender Detail Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every low-poly piece the 2026-11-15 audit found, except the soldier, gets a detailed near version modelled by a Blender script and drawn within the kit's near distance, with today's geometry kept as the far version, so the layout and gameplay stay byte-identical.

**Architecture:** A new Blender script `tools/blender/props.py` writes `assets/kit/props.glb`. `assets.js` loads it into the same `assets.kit` table as `kit.glb`. A new `Builder.swap(names, far, near)` draws the old code as `lod: 'far'` and the new piece as `lod: 'near'`, and draws the old code untagged when a piece is missing. Rods, cables and scanned props get their near versions in code.

**Tech Stack:** three.js r170 (Builder buckets, kit LOD in `render.js` cull), Blender 5.3 background Python (bmesh), glTF/GLB with texture coordinates and RGBA vertex colours, canvas-drawn textures, meshoptimizer.

**Spec:** `docs/superpowers/specs/2026-11-16-blender-detail-pass-design.md`

## Global Constraints

- Every replaced function makes exactly the random draws it makes today, in the same order. New pieces choose variant, rotation and detail by `hash()` from `src/facades.js` (position plus salt), never from `rnd`, `rs` or `R`. They may reuse values already drawn: a palm's lean, height and frond values, a cart's colour, a piñata's colours, a sack's spice.
- A near piece stays inside its old drawn extent, colliders, details and keep-outs (the envelopes in `tools/detail-check.js`).
- Per-instance triangle caps:
  - rubble 12k
  - cart 15k
  - laurel 60k
  - palm 65k
  - piñata 5k
  - ristra 3k
  - chapel drum, dome and lantern 25k
  - pole 8k
  - kiosk 30k
  - sack 2.5k
  - pebble 40–80
- Near distance is `R.kitNear` = 30 m to the 24 m cell box. The renderer is not changed.
- Perf (`tools/perf-probe.js`, same conditions as the baseline): main street ≤ 15.0 ms, and no view more than 1.0 ms slower than the Task 1 baseline.
- Self-test: the same 63/64. The one known failure is the empty-magazine reload sample.
- Fingerprint keys must stay identical: colliders, lowColliders, rails, details, dynamic, spawns, nav, anchors, emitters, lamps, protos, hulls.
- No downloads. Textures are the existing PBR sets plus canvas-drawn `leaf`, `palm_leaf` and `paper`.
- Commit on `feature/blender-detail-pass` after each task. Never push.
- Stop every dev server started for checks once that check is done.
- The light bake is redone once at the end. Run with `?nogi=1` while developing.

## Review Focus

- **Missing pieces.** If `props.glb` is missing or a piece name is wrong, the old geometry must still draw untagged, with no hole. Covered in Task 2: the `swap()` check with a missing name.
- **Vertex alpha for wind.** It must survive the export. If it doesn't, foliage stands rigid, or swings from the trunk. The `wind` flag in `dc.pieces()` (Task 2) asserts that alpha spans more than 0.5. It is set on every wind piece: the piñata (Task 8), the fronds (Task 11) and the laurels (Task 12).
- **Own UVs.** Leaf, frond and paper textures must not come out upside down. Task 2's builder check pins the v flip (v = 1 − glTF v). The close captures in Tasks 8, 11 and 12 show the leaf tips.
- **Bullet decals over near pieces.** The far geometry stays in the ray trees, so a round can mark an invisible far surface in front of the near heap. Covered in Task 5: three rounds into the near rubble from 3 m, captured.
- **The web build.** It must ship `assets/kit/props.glb`. Covered in Task 15: `tools/build-web.mjs` output listing.

---

### Task 1: Baselines and the layout fingerprint tool

**Files:**
- Create: `tools/layout-fingerprint.js`
- Create: `tools/compare-fingerprints.mjs`
- Modify: `tools/compare-shots.js` (VIEWS: add the item views below)

**Interfaces:**
- Produces:
  - `fingerprint(G, tag) -> Promise<summary>`, which posts `captures/fp_<tag>.json`. The keys are those of the 2026-11-16 AC-fix script, plus `hulls: { kind: hash(proto.hull) }` and `nearTris: { proto: tris }`.
  - `node tools/compare-fingerprints.mjs A.json B.json`. It prints `layout identical` and exits 0, or prints each differing layout key and exits 1. `drawn`, `drawnIndexTotal`, `rayMeshes`, `clothMeshes` and `nearTris` are reported but are not failures.
  - New capture views:
    - `rubble_near` [-3.0, 7.2, 330, -12]
    - `cart_near` [59.6, -19.4, 135, -6]
    - `pole_near` [-24.8, -17.6, 225, 25]
    - `pinata_near` [72.6, -33.6, 270, 8]
    - `chapel_dome` [70.5, 20, 90, 28]
    - `kiosk_near` [74.6, -30.2, 135, 10]
    - `palm_near` [-12.6, -9.2, 330, 30]
    - `laurel_near` [75.4, -38.6, 315, 14]
    - `sack_near` [-11.2, -12.4, 120, -20]

  The exact cameras are tuned in each item's task.
  - `film(G, tag, [x0, z0], [x1, z1], yaw, pitch, n = 12)` in `tools/compare-shots.js`. It captures n frames walking from the first point to the second (`captures/film_<tag>_<i>.jpg`), at the shots() settings, for judging the near/far switch.

- [ ] **Step 1:** Write `tools/layout-fingerprint.js` from the AC-fix script, which is in the session transcript. Add `hulls` and `nearTris`. Write the comparator.
- [ ] **Step 2:** Start `market` (preview_start). Load `/?nogi=1`. Run `fingerprint(G, 'base')`.
- [ ] **Step 3:** Run `node tools/compare-fingerprints.mjs captures/fp_base.json captures/fp_base.json`. Expected: `layout identical`.
- [ ] **Step 4:** Measure the perf baseline. Use `perf.median(G)` in the pane if `tabs_context` says the pane is displayed. Otherwise use the native shell `?q=high&bench=base`. Save `captures/bench_base.json` and note the main street and plazuela means.
- [ ] **Step 5:** Run `cmp.shots(G, 'base')` for all views, including the new ones. Record each view's exposure.
- [ ] **Step 6:** Commit the tools: `git add tools/layout-fingerprint.js tools/compare-fingerprints.mjs tools/compare-shots.js`.

### Task 2: Builder plumbing — lodDefault, swap, kit own UVs and wind

**Files:**
- Modify: `src/builder.js` (`constructor`, `_b`, `geom`, `kit`, plus the new `swap`)
- Modify: `src/assets.js` (kit loading)
- Create: `tools/detail-check.js`

**Interfaces:**
- Produces:
  - `B.lodDefault`. Its default is `null`. `_b(key, x, z, far, lod)` uses it when `lod === undefined` and `far` is false. `null` stays untagged.
  - `B.geom(key, g, m, o)` passes `o.far` and `o.lod`.
  - `B.kit` takes three per-slot options:
    - `uv: 'own'`: u = uv.x / tile + uo, v = (1 − uv.y) / tile + vo. This flips back the glTF v, so UVs authored in Blender with v up match `flipY` canvas and KTX2 textures.
    - `wind: phase`: k.x = [alpha × (windAmp ?? 1), phase, 0], with alpha = colour .w, or 1 without it.
    - `windAmp`.
  - `B.swap(names, far, near) -> far's return`. If any name in `names` (a string or an array) is missing from `assets.kit`, it returns `far()` with nothing tagged. Otherwise it runs `far()` with `lodDefault = 'far'`, restores the previous value (try/finally), then runs `near()`.
  - `assets.kit` merges the pieces of `kit.glb` and `props.glb`. A failed `props.glb` load logs a warning and leaves only the kit's pieces. A duplicate name throws.
  - `detail-check.js`:
    - `builder()` runs synthetic Builder checks and returns a list of problems.
    - `pieces()` checks every `PIECES[name] = { cap, box: [[x0,y0,z0],[x1,y1,z1]], wind?, ownUV? }` entry against `assets.kit`: present, triangles ≤ cap, every vertex inside the box with 1 cm slack, wind alpha spread > 0.5 when `wind`, uv present when `ownUV`.
    - `report()` returns `{ builder, pieces }`.

- [ ] **Step 1:** Write `builder()` checks. Each makes a fresh `Builder` and inspects `buckets` ids and `k.u` / `k.x` arrays:
  - `swap('nope', far, near)` → far's quad lands in an id without `|far`, and near is never called.
  - With a fake `assets.kit.__t` (one triangle, uv (0,0) (1,0) (0,1), colour alpha 0.2/0.6/1): `swap('__t', …)` → the far quad is in a `|far` bucket and the `kit('__t', I, { a: 'leaf' }, { lod: 'near', slot: { a: { uv: 'own', tile: 1, wind: 2 } } })` bucket ends `|near`, with u = [0, 1, 0], v = [1, 1, 0] and x = [0.2, 2, 0, 0.6, 2, 0, 1, 2, 0].
  - `geom(..., { lod: 'near' })` → the id ends `|near`.
- [ ] **Step 2:** Load `/?nogi=1` and run `dc.builder()`. Expected: problems are reported (`swap` is not a function).
- [ ] **Step 3:** Implement the Builder changes, and the kit loader as a `loadKit(url)` helper used for both GLBs.
- [ ] **Step 4:** Run `dc.builder()`. Expected: `[]`. Run `fingerprint(G, 't2')` and compare it with base. Expected: `layout identical`, and `drawnIndexTotal` unchanged, because `props.glb` does not exist yet.
- [ ] **Step 5:** Commit.

### Task 3: Foliage and paper materials, and the props.py scaffold with pebbles

**Files:**
- Modify: `src/mexico.js` (new `leafTexture()`, `palmLeafTexture()`, `paperTexture()`)
- Modify: `src/materials.js`
  - `leaf: windy(…leafTexture, alphaTest 0.5, DoubleSide, roughness 0.45…, 0.03, 0.45)`
  - `palm_leaf: windy(…, 0.14, 0.6)`
  - `paper: windy(…paperTexture, alphaTest 0.45, DoubleSide, roughness 0.9…, 0.05, 0.85)`
  - add all three to the noBVH list
  - surf: leaf and palm_leaf `wood`, paper `fabric`
  - export `FOLIAGE = ['frond', 'leaves', 'flowers', 'leaf', 'palm_leaf']`
- Modify: `src/world.js` (use FOLIAGE for noAO and the cloth exclusion; `LOD.paper = 60`)
- Modify: `src/gi.js` (occluders skip FOLIAGE and `paper`)
- Create: `tools/blender/props.py`
  - same axes and helper names as `kit.py`
  - `R(name)` = `random.Random(zlib.crc32(name))`, one stream per piece
  - `keep(ob, sm)`
  - per-face UV and RGBA colour layer helpers
  - export with `export_texcoords=True` and `export_vertex_color='ACTIVE'`
  - `--preview DIR` writes `DIR/<piece>.png`, each framed to the piece's bounds
- Create: `assets/kit/props.glb`
- Modify: `src/dressing.js` (the pebble loop)

**Interfaces:**
- Consumes: `B.swap`, `B.kit` own UV and wind (Task 2).
- Produces:
  - the materials `M.leaf`, `M.palm_leaf`, `M.paper`
  - the pieces `pebble_a`…`pebble_d` (slot `stone`)
  - the atlas layouts, in Blender UV, v up:
    - `leaf`: four leaf blades, each in a column u ∈ [i/4, (i+1)/4], base at v = 0, tip at v = 1.
    - `palm_leaf`: four leaflets in u ∈ [0, 0.8] (columns of 0.2, base v = 0); the rachis strip is u ∈ [0.85, 1].
    - `paper`: fringe rows across v ∈ [0, 0.75], streamer crêpe in [0.75, 1].

- [ ] **Step 1:** Add the pebble entries to `PIECES`: cap 80, box ±0.5 on all three axes. Run `dc.pieces()`. Expected: FAIL, `pebble_a missing`.
- [ ] **Step 2:** Write `props.py`. Each pebble is an icosphere (subdivisions 1) with noise displacement and 2–3 chips cut by a flat plane, scaled to fit the unit box.
- [ ] **Step 3:** Run the script.

  Command: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/props.py -- assets/kit/props.glb --preview captures/props`

  Expected: it prints `PROPS pieces (triangles): pebble_a …` with each count between 40 and 80, and writes the PNGs. Look at them.
- [ ] **Step 4:** In the pebble loop, read `key = rnd.pick(…)` and `m = mat4(…)` in the order they are drawn today.

  Then: `const PEB = ['pebble_a','pebble_b','pebble_c','pebble_d'], v = PEB[Math.floor(fhash(p.x, p.z, 17) * 4)]`

  Then: `B.swap(v, () => B.geom(key, peb, m, old opts), () => B.kit(v, m, { stone: key }, { lod: 'near', tile: 0.35, color: old color }))`
- [ ] **Step 5:** Add the materials and the FOLIAGE wiring.
- [ ] **Step 6:** Reload and run the checks:
  - `dc.pieces()` → no problems.
  - Fingerprint compared with base → layout identical.
  - A close capture of a pebble line, near.
  - The same spot from 70 m, far.
- [ ] **Step 7:** Commit, including `assets/kit/props.glb`.

### Task 4: Spice sacks

**Files:**
- Modify: `tools/blender/props.py`
- Modify: `assets/kit/props.glb`
- Modify: `src/dressing.js` (`sack()`)
- Modify: `tools/detail-check.js`

**Interfaces:**
- Produces: `sack_a` and `sack_b`, with slots `burlap` (world UV) and `spice`. The origin is the centre of the base on the ground. Height 0.5. Radius ≤ 0.275.

- [ ] **Step 1:** Add the sack entries to `PIECES`: cap 2500, box [-0.28, 0, -0.28]–[0.28, 0.52, 0.28]. Run the check. Expected: missing.
- [ ] **Step 2:** Model the sack:
  - a lathe of the old profile with cloth folds (radial noise × height)
  - the mouth rolled into a cuff
  - a weave-thickness lip
  - the spice as a heaped cone with granular vertex shade
- [ ] **Step 3:** Run Blender and check the triangle counts.
- [ ] **Step 4:** In `sack()`, draw `s`, `yaw` and `sy` in today's order. Then `B.swap(v, old lathe + disc, () => B.kit(v, mat4(V(x,y,z), yaw, V(s, s*sy, s)), { burlap: 'burlap', spice: 'matte' }, { lod: 'near', slot: { burlap: { tile: 0.6 }, spice: { color: col } } }))`. Pick v by `fhash(x, z, 23)`. `B.detail` stays outside the swap.
- [ ] **Step 5:** Run `dc.pieces()`, compare the fingerprint, and take the `sack_near` capture.
- [ ] **Step 6:** Commit.

### Task 5: Rubble heaps

**Files:**
- Modify: `tools/blender/props.py`
- Modify: `assets/kit/props.glb`
- Modify: `src/dressing.js` (`rubble()`)
- Modify: `tools/detail-check.js`

**Interfaces:**
- Produces: `rubble_a`, `rubble_b`, `rubble_c`. Slots: `concrete`, `brick`, `plaster`, `iron`, `gravel`. A unit heap: radius 1, height 1, base at y = 0. Placed by today's `mat4(V(x, -0.03, z), yaw, V(r, h, r*kz))`.

- [ ] **Step 1:** Add the rubble entries to `PIECES`: cap 12000, box [-1.25, 0, -1.25]–[1.25, 1.15, 1.25]. Run the check. Expected: missing.
- [ ] **Step 2:** Model three heaps from a per-piece stream:
  - concrete slab shards, boolean-broken, with aggregate as vertex shade
  - whole and half bricks with mortar lumps
  - plaster flakes with a paint face
  - 3–5 bent rebar tubes
  - a gravel-and-dust skirt mesh out to r 1.2 that sinks to y = 0 at its edge
  - pieces resting on each other: stacked by height field, no floating
- [ ] **Step 3:** Run Blender and look at the previews.
- [ ] **Step 4:** Integrate in `rubble()`:
  - Draw `yaw` and `kz` first, as today.
  - The far closure is the mound `B.geom` and the chunk loop, with every draw unchanged.
  - `B.detail`, `B.keepOut` and `anchors.push` stay outside the swap.
  - Near: `B.kit(v, m, { concrete: 'concrete', brick: 'w_brick', plaster: 'w_damaged', iron: 'iron', gravel: 'rubble' }, { lod: 'near', tile: 1.2, color: [0.9, 0.87, 0.82] })`, with v from `fhash(x, z, 31)`.
- [ ] **Step 5:** Run the checks:
  - pieces, fingerprint, `clip.scan(G)` max penetration ≤ base
  - the `rubble_near` capture, plus a 60 m capture of the same heap
  - the switch filmed from 25 to 50 m along the main street
  - Review Focus: three rounds fired at the heap from 3 m, with the decals captured
- [ ] **Step 6:** Commit.

### Task 6: Street carts

**Files:**
- Modify: `tools/blender/props.py`
- Modify: `assets/kit/props.glb`
- Modify: `src/quarter.js` (`cart()`)
- Modify: `tools/detail-check.js`

**Interfaces:**
- Produces: `cart`. Slots: `body`, `steel`, `tin`, `iron`, `rubber`, `wood`, `bottle`.
  - three.js frame: X along the length; Z toward the sign (Blender −y).
  - Wheels: two at x −0.55, z ±0.42 on an axle, and one at x 0.6 on a fork. Each has a 0.28 m radius, 28 spokes, a hub and a treaded tyre.
  - The body is today's box: x ±0.75, y 0.4–1.1, z ±0.4. The front panel is flat at z 0.405 over x ±0.62, y 0.45–1.1.
  - A stainless counter at y 1.12. Roof posts at (±0.7, ±0.38). A corrugated tin roof 1.8 × 1.05 at y 2.05.
  - A push bar at −x, inside x ≥ −0.92. A shelf with a gas bottle underneath.

- [ ] **Step 1:** Add the `cart` entry to `PIECES`: cap 15000, box [-0.92, 0, -0.53]–[0.92, 2.1, 0.53]. Add a custom check: no vertex with z > 0.41 where |x| < 0.62 and 0.45 < y < 1.1. Run the check. Expected: missing.
- [ ] **Step 2:** Model the cart and run Blender.
- [ ] **Step 3:** Integrate in `cart()`. `quarter.js` imports `hash as fhash` from `./facades.js`; this is the first task that needs it there.
  - `col` is drawn first, as today.
  - The far closure is the box, plate, tori, rods and roof.
  - `B.collide`, the `si` draw and the sign quad stay outside the swap, untagged.
  - Near: `B.kit('cart', mat4(V(x, 0, z), rot), { body: 'metal_white', steel: 'metal_plate', tin: 'corrugated', iron: 'iron', rubber: 'cable', wood: 'planks', bottle: 'metal_white' }, { lod: 'near', slot: { body: { color: col, tile: 1 }, tin: { color: [0.9, 0.9, 0.9], tile: 1.2 }, bottle: { color: [0.72, 0.74, 0.72] } } })`
- [ ] **Step 4:** Run the checks: pieces, fingerprint, and the `cart_near` capture, with the sign sitting on the panel.
- [ ] **Step 5:** Commit.

### Task 7: Utility poles

**Files:**
- Modify: `tools/blender/props.py`
- Modify: `assets/kit/props.glb`
- Modify: `src/dressing.js` (the pole loop)
- Modify: `src/quarter.js` (`poles()`)
- Modify: `tools/detail-check.js`

**Interfaces:**
- Produces: `pole_old` and `pole_quarter`. Slots: `wood`, `iron`, `tank`, `porcelain`. The origin is the foot of the pole. Both are placed with identity rotation.
  - `pole_old`:
    - 8.6 m tall
    - crossarm 1.7 m at y 8.0, turned +0.3 rad about up
    - box transformer 0.4 × 0.6 × 0.35, finned, centred (0.2, 6.6, 0), on a hanger bracket
  - `pole_quarter`:
    - 8.8 m tall
    - crossarm 1.8 m at y 8.2
    - cylindrical finned tank r 0.28, h 0.75, centred (0.35, 6.9, 0), with bushings
  - On both, the pole tapers to radius ≤ 0.13 at the foot and has step bolts, braces and pin insulators.

- [ ] **Step 1:** Add both poles to `PIECES`: cap 8000, boxes from today's extents plus 5 cm. Custom check: radius ≤ 0.14 for y < 6. Run the check. Expected: missing.
- [ ] **Step 2:** Model both poles and run Blender.
- [ ] **Step 3:** Integrate. Wrap only today's pole rod, crossarm box and transformer in each swap. Keep `B.collide` and the `cable()` calls outside. Slot map: `{ wood: 'planks', iron: 'iron', tank: 'metal_white', porcelain: 'glossy' }`. Wood colour [0.45, 0.4, 0.35]. Tank colour: old [1, 1, 1] / quarter [0.62, 0.64, 0.62]. Porcelain [0.9, 0.92, 0.95].
- [ ] **Step 4:** Run the checks: pieces, fingerprint, and the `pole_near` capture.
- [ ] **Step 5:** Commit.

### Task 8: Piñatas and ristras

**Files:**
- Modify: `tools/blender/props.py`
- Modify: `assets/kit/props.glb`
- Modify: `src/dressing.js` (`pinata`, `ristra`)
- Modify: `tools/detail-check.js`

**Interfaces:**
- Produces:
  - `pinata`. Slots:
    - `body`
    - the cones `c0`…`c6`, following today's `dirs` order, 0.4 long from 0.16 to 0.56
    - the streamers `sa0`…`sa6` and `sb0`…`sb6`

    Paper is fringe rows on own UVs. The origin is the body centre. Placed with no yaw and scale s.
  - `ristra_seg`: slots `chile` and `stem`. Three curved, wrinkled chiles spiralled round the axis. 0.096 m long, hanging from y = 0 down.

- [ ] **Step 1:** Add the entries to `PIECES`:
  - `pinata`: cap 5000, box [-0.64, -0.85, -0.64]–[0.64, 0.64, 0.64], ownUV, wind
  - `ristra_seg`: cap 300, box [-0.12, -0.16, -0.12]–[0.12, 0.01, 0.12]

  Run the check. Expected: missing.
- [ ] **Step 2:** Model both and run Blender.
- [ ] **Step 3:** Integrate `pinata`:
  - Draw `s` and `c0` as today.
  - The far closure is the icosahedron, the cones and the tassel quads, with their `R.range` draws.
  - The cord `rod` stays outside, untagged.
  - Near: `B.kit('pinata', mat4(p, 0, s), slots → 'paper', { lod: 'near', slot: { body: { uv: 'own', tile: 1, color: PINATA[c0], wind: φ }, c<k>: { … PINATA[(c0+k+1)%6] }, sa<k>: { … PINATA[(c0+k+3)%6] }, sb<k>: { … PINATA[(c0+k+4)%6] } } })`, with φ from `fhash(p.x, p.y, p.z, 41) * 6.28`.
- [ ] **Step 4:** Integrate `ristra`:
  - The cord stays outside.
  - The far closure is the chile loop. It pushes each chile's `g` into `gs`.
  - Near: segment j at `top + (0, -0.06 - j*0.096, 0)`, yaw `fhash(top.x, top.z, j, 43) * 6.28`, tint from `gs[3j]`. There are `ceil(n/3)` segments, so the last one may end below the old last chile by ≤ 0.064 m.
  - Slots `{ chile: 'glossy', stem: 'matte' }`. Stem colour [0.42, 0.4, 0.2].
- [ ] **Step 5:** Run the checks: pieces, fingerprint, and the `pinata_near` capture, plus a ristra close-up in the hall.
- [ ] **Step 6:** Commit.

### Task 9: Chapel drum, dome and lantern

**Files:**
- Modify: `tools/blender/props.py`
- Modify: `assets/kit/props.glb`
- Modify: `src/quarter.js` (the dome block of `chapel()`)
- Modify: `tools/detail-check.js`

**Interfaces:**
- Produces: `chapel_drum`, `chapel_dome` and `chapel_lantern`. The origin of all three is the drum base centre (cx, y0, cz) = (86.2, 10.4, 20). Octagon flats face the axes and the diagonals.
  - `chapel_drum`:
    - Slots: `wall`, `stone`, `glass`, `iron`.
    - Radius to the vertices: 3.4 at the foot, 3.3 at the top.
    - Height 1.6.
    - An arched window in each face (cantera surround, glass, grille), pilasters at the angles, and a moulded cornice to r 3.65 at y 1.58–1.74.
  - `chapel_dome`:
    - Slots: `glaze_y`, `glaze_b`, `stone`.
    - Own UVs: u = 24 repeats round, v = 8 up.
    - The old cobalt band rows. Eight stone ribs.
    - Centre y 1.72, radius 3.2, y-scale 1.12.
  - `chapel_lantern`:
    - Slots: `wall`, `stone`, `glaze_y`, `iron`.
    - Arched openings, colonnettes, a tiled cupola and an iron cross, within today's lantern stack (y 5.25–8.1, r ≤ 0.7).

- [ ] **Step 1:** Add the entries to `PIECES`, with boxes from the spec's extents and a total cap of 25000. Run the check. Expected: missing.
- [ ] **Step 2:** Model the three pieces and run Blender.
- [ ] **Step 3:** Integrate. The dome block has no random draws, so the whole block becomes the far closure. Near: the three `B.kit` calls.
  - Slot map: `{ wall: 'w_plaster', stone: 'cantera', glass: 'glass', iron: 'iron', glaze_y: 'talavera', glaze_b: 'talavera' }`.
  - Colours: wall [1.18, 0.84, 0.42], stone [1.0, 0.86, 0.82], glaze_y [1.08, 0.84, 0.34], glaze_b [0.5, 0.64, 1.05].
  - The glaze slots use `uv: 'own'`, tile 1.
- [ ] **Step 4:** Run the checks: pieces, fingerprint, and the `chapel_dome` capture, plus a view from the atrium at street level.
- [ ] **Step 5:** Commit.

### Task 10: Kiosk

**Files:**
- Modify: `tools/blender/props.py`
- Modify: `assets/kit/props.glb`
- Modify: `src/quarter.js` (`plazuela()`)
- Modify: `tools/detail-check.js`

**Interfaces:**
- Produces:
  - `kiosk_roof`
    - Slots: `tin`, `trim`, `finial`.
    - The origin is the platform top centre (cx, 0.82, cz).
    - An octagonal pressed-tin roof: corners at π/8 + kπ/4, radius 4.2 at the eave y 3.4, apex y 5.3.
    - Standing seams, hip ribs, a scalloped valance to y 3.1, and a finial lantern ≤ y 5.62.
  - `kiosk_column`: slot `iron`. A cast-iron column 3.4 m tall with base and capital, radius ≤ 0.12.
  - `kiosk_bracket`: slot `iron`. A scrolled bracket modelled along +X from the kiosk's centre, from (x 3.3, y 2.7) to (x 3.95, y 3.38). It is placed with `mat4(V(cx, top, cz), −a)` for the column at angle a.

- [ ] **Step 1:** Add the entries to `PIECES`. The total of roof + 8 columns + 8 brackets is capped at 30000. Run the check. Expected: missing.
- [ ] **Step 2:** Model the three pieces and run Blender.
- [ ] **Step 3:** Integrate:
  - Each green column `B.geom` becomes far, with a `kiosk_column` near at (px, top, pz).
  - The roof, underside and finial `B.geom` become far, with `kiosk_roof` and 8 × `kiosk_bracket` near.
  - The rails, the ring rods and every `B.rail` stay as they are.
  - Slot map: `{ tin: 'metal_green', trim: 'metal_green', finial: 'metal_green', iron: 'metal_green' }`.
  - Colours: tin [0.8, 0.95, 0.82], trim [0.8, 0.95, 0.82], finial [0.75, 0.62, 0.3], iron [0.55, 0.72, 0.6].
- [ ] **Step 4:** Run the checks: pieces, fingerprint, the `kiosk_near` capture, and the plazuela perf view compared with base.
- [ ] **Step 5:** Commit.

### Task 11: Palms

**Files:**
- Modify: `tools/blender/props.py`
- Modify: `assets/kit/props.glb`
- Modify: `src/dressing.js` (`palm()`)
- Modify: `tools/detail-check.js`

**Interfaces:**
- Produces:
  - `palm_base`
    - Slot: `bark`.
    - Own UVs in metres.
    - The flared root plate and the first metre. Radius 0.26 at y 0, 0.2 at y 1.
  - `palm_seg_a` and `palm_seg_b`
    - Slot: `bark`.
    - Own UVs.
    - 1 m from y 0 to 1, radius 0.2, with diamond leaf-base scars in a spiral. The top lip overlaps the next segment by 2 cm.
  - `palm_crown`
    - Slot: `bark`.
    - The swollen knob with cut leaf bases. The origin is the trunk top.
  - The fronds:
    - `palm_frond_up`, `palm_frond_mid`, `palm_frond_low` and `palm_frond_dry`, one each for tier 0, 1, 2 and dry.
    - Slot: `leaf`.
    - Own UVs. RGBA, with alpha = t².
    - The rachis runs along +X from the origin. Length 3.2 at scale 1.
    - Nominal elevations by tier only: 1.05, 0.5 and −0.1. The dry frond starts at tier 2's −0.1 and droops steeply in its own shape. Bends 1.5, 1.7, 1.3, and 1.9 for dry.
    - About 140 folded leaflets, 8 triangles each. A spiny petiole. ≤ 1300 triangles.
  - `palm_dates`
    - Slots: `fruit`, `stalk`.

- [ ] **Step 1:** Add the entries to `PIECES`:
  - frond: box [-0.1, -2.9, -0.7]–[3.5, 1.8, 0.7], wind, ownUV
  - a computed total for the tallest palm (13.5 m), cap 65000

  Run the check. Expected: missing.
- [ ] **Step 2:** Model the pieces and run Blender.
- [ ] **Step 3:** Integrate. The far closure is today's whole body: trunk, collider-free fronds and the crown ball, with every draw unchanged. While it runs, it records each frond's `{ az, tier, len, e0, bend, dry, col, ph }`. Then the near pass draws:
  - The trunk:
    - `palm_base` at the foot.
    - Then n = ceil(h) − 1 segments along today's curve P(t) = (x + cos(la)·lean·t², h·t, z + sin(la)·lean·t²).
    - Segment j runs from t = (j+1)/ceil(h) to (j+2)/ceil(h). It is oriented from UP to P(t1) − P(t0), scaled y by |P(t1) − P(t0)| and xz by 0.2·k(t_mid)/0.2, with k(y) = 0.8 + 0.5(1−y)^6 − 0.12y.
    - Its spin about its axis comes from `fhash(x, z, j, 51)`. The variant a/b comes from the same hash.
  - `palm_crown` at `top`.
  - For each recorded frond, `T(top)·Ry(−az)·Rz(e0 − e0nom[tier])·S(len/3.2)`, with the variant, tint `col` and `wind: ph`.
  - 2–4 date clusters, picked by hash.

  `B.collide` stays outside the swap.
- [ ] **Step 4:** Run the checks:
  - pieces
  - fingerprint
  - the `palm_near` capture
  - a skyline palm from 60 m (far)
  - the switch filmed from 20 to 45 m
  - the `arch_plaza` perf view compared with base: if it is over +0.5 ms here, cut the leaflets to 110 and re-measure.
- [ ] **Step 5:** Commit.

### Task 12: Laurels

**Files:**
- Modify: `tools/blender/props.py`
- Modify: `assets/kit/props.glb`
- Modify: `src/quarter.js` (`laurel()`)
- Modify: `tools/detail-check.js`

**Interfaces:**
- Produces: `laurel_a` and `laurel_b`.
  - Slots: `bark` (own UVs in metres) and `leaf` (own UVs, RGBA, alpha = wind freedom).
  - The origin is the trunk's foot on the ground.
  - Trunk: a fluted trunk with fused aerial roots, flaring only above y 0.45 (it starts inside the stone box), and ≤ 0.75 from the axis below y 0.5.
  - Branches: limbs from y ≈ 2.2 that split into branches and twigs reaching the crown shell.
  - Crown:
    - About 20k leaves. Each is a 4-vertex, 2-triangle blade folded on its midrib, 0.12–0.16 m long, UV'd to one of the four atlas columns.
    - Clustered on the twig tips in a clipped dome filling the ellipsoid: centre y 4.2, radius 3.0, half-height 1.86.
    - The shell is about 0.35 m thick, with leaves under the dome too.
    - Vertex shade darkens with depth into the crown.

- [ ] **Step 1:** Add the entries to `PIECES`: cap 60000, box [-3.4, 0, -3.4]–[3.4, 6.6, 3.4], wind, ownUV. Add the base-radius custom check. Run the check. Expected: missing.
- [ ] **Step 2:** Model both variants and run Blender.
- [ ] **Step 3:** Integrate. The far closure is today's whole body, with all its draws. `B.collide` stays outside.

  Near: `B.kit(v, mat4(V(x, 0, z), fhash(x, z, 61) * 6.28, s), { bark: 'bark', leaf: 'leaf' }, { lod: 'near', slot: { bark: { uv: 'own', tile: 1.5, color: [0.78, 0.74, 0.68] }, leaf: { uv: 'own', tile: 1, wind: fhash(x, z, 62) * 6.28 } } })`
- [ ] **Step 4:** Run the checks:
  - pieces
  - fingerprint
  - `clip.scan`
  - the `laurel_near` capture
  - the plazuela and atrium from 50 m
  - the switch filmed
  - the plazuela perf view compared with base: if it is over +1.0 ms, thin the leaves (e.g. 14k) and re-measure.
- [ ] **Step 5:** Commit.

### Task 13: Rods and cables

**Files:**
- Modify: `src/dressing.js` (`rod`, `cable` in `dressKit`)

**Interfaces:**
- Produces:
  - `rod(a, b, r, key, color)`. When r ≥ 0.01 and `!B.lodDefault`: a 12-sided cylinder `{ lod: 'near' }` plus today's 6-sided one `{ lod: 'far' }`. Otherwise it is exactly as today.
  - `cable(a, b, sag, r)`. When `!B.lodDefault`: a `TubeGeometry(curve, 20, r, 8)` near plus today's `(curve, 14, r, 4)` far. It returns the same `pts`.

- [ ] **Step 1:** Load and run `fingerprint(G, 'pre13')`. Note `drawn.iron` and `drawn.cable` per lod.
- [ ] **Step 2:** Implement both.
- [ ] **Step 3:** Run the checks:
  - fingerprint → layout identical
  - near triangles for `iron` and `cable` about 2× (rods) and 2.9× (cables)
  - a close capture of the kiosk railing and of the overhead cables
  - perf: main street compared with base
- [ ] **Step 4:** Commit.

### Task 14: Scanned props near versions

**Files:**
- Modify: `src/assets.js` (`bake()`)
- Modify: `src/builder.js` (`prop()`, `build()` prop meshes)
- Modify: `src/rigid.js` (`_props` uses `proto.near || proto.parts` for drawing)

**Interfaces:**
- Produces:
  - `proto.near`: a parts list cut to `NEAR_BUDGET` with error 0.04, for these kinds:

    | Kind | `NEAR_BUDGET` |
    |---|---|
    | pot | 1600 |
    | basket | 2600 |
    | basket_tall | 2600 |
    | plastic_crate | 3200 |
    | jerrycan | 2000 |
    | cardboard | 1600 |
    | wall_lamp | 3200 |
    | lpg | 3600 |

    `proto.parts`, `size`, `small` and `hull` are unchanged.
  - Static props of those kinds draw `near` into near chunks and `parts` into far chunks. A chunk key is `chunk * 4 + (near ? 2 : far ? 1 : 0)`, with the shadow parity kept as `chunk % 2`. The meshes carry `kitLod` and the `lodBox` of cell `chunk >> 1`.

- [ ] **Step 1:** Load and run `fingerprint(G, 'pre14')`.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the checks:
  - fingerprint: `protos` and `hulls` identical, and `nearTris` lists the eight kinds
  - the selftest loose-prop checks unchanged
  - close captures of a pot, a basket and a plastic crate
  - perf compared with base
- [ ] **Step 4:** Commit.

### Task 15: Light bake, full verification, docs

**Files:**
- Modify: `assets/gi.bin`
- Modify: `README.md`
- Modify: `ASSETS.md`
- Memory: `low-poly-audit.md` and a pointer to this pass

- [ ] **Step 1:** Load `/` without `nogi`, in the native shell if the pane is hidden. The bake re-runs and saves `gi.bin`. Check `G.gi === 'baked'`, then reload and check `'cached'`.
- [ ] **Step 2:** Run `fingerprint(G, 'final')` and compare it with base. Expected: layout identical.
- [ ] **Step 3:** Run `clip.scan(G)`. The max box and drawn penetration must be ≤ base. Then run `?selftest=1` → `captures/selftest.json`. Expected: 63/64, with the same failure.
- [ ] **Step 4:** Run perf with `?bench=final` against `bench_base`. Expected: main street ≤ 15.0 ms, every view ≤ base + 1.0 ms. Report the GPU-memory delta.
- [ ] **Step 5:** Take every capture with `cmp.shots(G, 'final', { exposure: base exposures })`, then make a before/after montage with `tools/compare-montage.py`. Send it to the user.
- [ ] **Step 6:** Run `node tools/build-web.mjs`. Check that the output has `assets/kit/props.glb`.
- [ ] **Step 7:** Update:
  - README: the perf table, the asset section with the props script, and how to rebuild.
  - ASSETS.md: props.py, with no downloaded sources.
  - memory
- [ ] **Step 8:** Commit, then stop the dev server.
