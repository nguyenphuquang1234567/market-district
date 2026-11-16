# Blender detail pass: the low-poly pieces, remodelled

Date: 2026-11-16 · Branch: `feature/blender-detail-pass`

## Intent

The user asked what in the game is still low poly. The audit (2026-11-15) ranked what is still coarse: the bots'
soldier model, the rubble mounds, the street carts, the laurels, the piñatas and ristras, the chapel dome's drum and
lantern, the palms, the utility poles, the kiosk roof, the shared rods and cables, the scanned props cut hard at load,
the spice sacks and the pebbles. The user then asked for every one of those except the soldier to be redesigned in
Blender, "as detailed as possible", put into the game, on a branch of its own.

Asked how detail should trade against frame rate, the user chose **A**: full detail within about 30 m of the camera,
the current simple versions beyond, so the frame time stays close to where it is. The game's own priority is the image
("effort went into the image first"), and boxy carts and flat card trees stand out next to scanned PBR walls and the
moulded architectural kit.

## Goals

Each item below gets a near version modelled in Blender (or, for rods and cables, built at a higher resolution in code),
drawn within the kit's near distance; the current geometry stays as the far version. Triangle caps are per instance.

1. **Rubble heaps** (`dressing.js` `rubble()`, 8 heaps): three heap variants of broken concrete slab pieces with exposed
   aggregate, whole and half bricks with mortar still on them, plaster flakes with paint on one face, a few bent rebar
   ends and a gravel-and-dust skirt they sit in. Cap 12k.
2. **Street carts** (`quarter.js` `cart()`, 4): a vendor's tricycle cart, painted sheet-metal body with rolled edges,
   rivets and a stainless counter, push bar, two spoked bicycle wheels (rim, 28 spokes, hub, axle, treaded tyre) and a
   front wheel with fork, a corrugated tin roof on four posts, a shelf with a gas bottle underneath. The body keeps the
   old box's size, and its front panel stays flat in the old front face's plane (0.405 m from the centre line), where the
   hand-painted sign quad is drawn. The body colour stays the one the old code picks. Cap 15k.
3. **Laurels** (`quarter.js` `laurel()`, 6, *laurel de la India*, the clipped plaza fig): a fluted trunk with fused aerial
   roots and buttresses, limbs and twigs as real branching geometry, and a dense clipped dome of individual leaves (each a
   small curved blade with its midrib fold, thousands of them, clustered on the twigs), filling the old canopy's
   ellipsoid (radius 3 s, centre 1.6 s above the 2.6 s trunk). Cap 60k.
4. **Palms** (`dressing.js` `palm()`, 7, Canary date palm, keeping the feather silhouette the map already has): a trunk
   built from stacked metre segments carrying the diamond pattern of old leaf bases, a swollen crown with cut leaf bases,
   about 32 fronds (rachis, spiny petiole, about 140 folded leaflets each) in three or four variants including dry
   hanging ones, and a few orange date clusters. Cap 65k.
5. **Piñatas and ristras** (`dressing.js` `pinata()`, `ristra()`): a seven-point piñata with a paper-mâché core and cones
   wrapped in rows of fringed tissue paper, crêpe streamers at the tips; a ristra of curved, wrinkled dried chiles with
   green-brown stems wound round a cord. Caps 5k and 3k.
6. **Chapel drum and lantern** (`quarter.js`, the dome over the chapel, 1): the octagonal drum gets eight arched windows
   in cantera surrounds with glass and grilles, pilasters at the angles and a moulded cornice; the dome keeps its
   talavera but at a smooth resolution with eight stone ribs; the lantern gets arched openings, colonnettes, a small
   tiled cupola and an iron cross. Cap 25k.
7. **Utility poles** (`dressing.js` and `quarter.js`, 12): a tapered round wooden pole with weather checks, step bolts
   and hardware, a braced crossarm with glass or porcelain pin insulators, and the transformer, keeping each district's
   outline so the near/far switch does not pop: a finned cylindrical tank with bushings and hanger brackets in the
   quarter, a finned rectangular tank of the old box's size on a hanger bracket in the old district. Cap 8k.
8. **Kiosk** (`quarter.js`, the plazuela, 1): an octagonal pressed-tin roof with standing seams, hip ribs, an eave with a
   scalloped valance, a finial lantern, scrolled iron brackets between the columns and the eave, and cast-iron columns
   with a base and capital. Cap 30k.
9. **Spice sacks** (`dressing.js` `sack()`): a burlap sack with its mouth rolled down into a cuff, slumped folds and a
   heaped cone of spice in it (the spice colour stays the call's). Cap 2.5k.
10. **Pebbles** (`dressing.js`, 320): four rounded, chipped stone variants of 40–80 triangles instead of boxes.
11. **Rods and cables** (`dressing.js` `rod()`, `cable()`; code, not Blender): a 12-sided rod (radius 1 cm and up; the
    thin cords of piñatas and ristras stay as they are) and an 8-sided cable near, the current 6- and 4-sided ones far.
12. **Scanned props** (`assets.js` budgets; code, not Blender): higher triangle budgets for the props whose outline
    suffers (pots, baskets, plastic crates, jerrycans, cardboard boxes, wall lamps, LPG tanks), with the simplification
    error held lower, so rims and handles are round again. A proto keeps its current low-budget geometry for its convex
    hull points and size, so loose props are dressed and simulated exactly as now; only what is drawn changes.

## Non-goals

- The soldier model.
- Better far versions: beyond the near distance the current geometry is drawn, as today.
- Any gameplay change: no new or moved colliders, cover, navigation, spawns, loose props, sounds or lamps.
- Downloaded assets: all geometry is modelled by script; textures are the game's existing PBR sets and canvas-drawn
  ones (as `mexico.js` and `materials.js` draw them now).

## Anti-goals (a failure even if everything renders)

- Layout drift: any change to the colliders, rails, details, keep-outs, the navigation grid (blocked, cover, edges,
  clearance, lanes), loose-prop positions, spawns, anchors, sound emitters or lamps. This is checked by fingerprint, as
  for the AC fix.
- Loose-prop physics drift: the convex hull points of every loose prop kind must stay identical.
- The heaviest view (main street) above 15.0 ms, or any view more than 1.0 ms slower, in `tools/perf-probe.js` run the
  way it was run for the AC fix (14.6 ms on the main street then).
- A near/far switch that pops harder than the kit's present one (judged on frames filmed across the switch distance),
  or a near piece that pokes outside its old footprint (clip checks and the self-test would catch the latter).
- Self-test regressions: 63 of 64 checks pass today, the one failure being the known empty-magazine reload sample.

## Constraints

- **Random streams**: every replaced function keeps making exactly the random draws it makes today, so everything
  generated after it lands where it does now. New pieces choose variant, rotation and details from a hash of their
  position, never from `rnd`, `rs` or `R` (the rule the kit already follows). They may reuse values the old code has
  already drawn (a palm's lean and height, a cart's colour, a piñata's colours, a sack's spice).
- **Envelopes**: a near piece stays inside the space the old one took (its collider, detail and keep-out boxes, its
  drawn extent), so loose props, which are dressed against those boxes, still sit clear of what is drawn.
- **Pipeline**: Blender 5.3 run in the background from a script in the repository, like `tools/blender/kit.py`; the
  output is a GLB under `assets/kit/`. The light bake (`assets/gi.bin`) is redone once the geometry is final.
- **Branch**: the AC unit and rooibos bush fix already in the working tree becomes this branch's first commit.

## Approaches

1. **Script-built pieces drawn near, today's geometry kept far** (chosen). A second script, `tools/blender/props.py`,
   models every piece and writes `assets/kit/props.glb`; the game draws them with the kit's near tag, and the old code
   still runs, its buckets tagged far. Reproducible from source, deterministic by construction (the old code's random
   draws and colliders are untouched), and it is exactly the near/far split the user chose. Costs some extra geometry
   memory, since both versions are built.
2. **An interactive Blender session** (sculpting, the Blender MCP) saved as `.blend` and exported. Could reach more
   organic detail in rubble and bark, but nothing in the repository would rebuild it, every tweak means redoing it by
   hand, and the project's kit is script-built for that reason.
3. **Replace the procedural geometry outright**, with modelled LODs for distance. A cleaner render path, but every
   function's random draws would have to be reproduced by hand to keep the layout, and every piece would need a second,
   modelled far version: more work and more risk for no gain under option A.

The user handed over the how; option 1 is the call.

## Design

### Pipeline

- `tools/blender/props.py`, same axes and helpers as `kit.py` (z up in Blender, y out of a wall where it matters),
  writes `assets/kit/props.glb` and, with `--preview`, a contact sheet. Unlike the kit it exports texture coordinates
  (for pieces mapped by their own UVs: leaves, leaflets, bark, chiles, paper) and RGBA vertex colours: RGB is a shade
  that multiplies the tint, A is how freely a vertex moves in the wind (0 at a trunk, 1 at a frond tip).
- Each piece has its origin where the game places it: rubble, carts, sacks, pebbles, poles and laurels at the centre of
  their footprint on the ground; a palm trunk segment at its base on the axis; a palm crown, a frond and a lantern at
  their own base; the kiosk and the chapel drum at their centre.
- `assets.js` loads `props.glb` beside `kit.glb` into the same `assets.kit` table (names must not collide).
- `Builder.kit()` gains `o.uv = 'own'` (use the piece's UVs scaled by `o.tile` instead of the world projection) and
  `o.wind = phase`, which fills the wind attribute from the vertex alpha for wind materials. `Builder.geom()` passes
  `o.lod` / `o.far` through to `_b()` like `quad()` does. A builder-wide `lodDefault` is used by `_b()` when no lod is
  given, so an old function is wrapped as far in one place: set `B.lodDefault = 'far'` before its geometry, restore it
  after, then add the new piece with `{ lod: 'near' }`. Colliders, details, keep-outs and rails do not go through
  `_b()` and are untouched.
- Long things that bend or vary in length are assembled from short pieces placed along the old function's own curve or
  extent: the palm trunk from metre segments following the old lean and taper, ristras by their length, rods and cables
  in code. Fixed things are single pieces placed by one matrix, scaled within limits (a rubble heap to the old mound's
  radius and height).

### Materials

Existing materials are reused through the kit's slot mapping: `concrete`, `w_brick`, `rubble`, `dirty`, `w_plaster`,
`cantera`, `talavera`, `iron`, `metal_white`, `metal_green`, `metal_plate`, `corrugated`, `planks`, `bark`, `burlap`,
`glass`, `dark`, `glossy`, `matte`. New ones, drawn in canvas the way the current leaf and frond textures are: `leaf`
(a single laurel leaf blade with veins, glossy, wind), `palm_leaf` (a leaflet with parallel veins and a paler midrib,
wind), and `paper` (fringed tissue, matte, tinted per slot so the piñata keeps its drawn colours). Like `leaves` and
`frond`, the three are left out of the ray trees, so rounds and thrown objects pass through foliage and paper as they do
now. Hard near pieces join the ray trees like everything else drawn; the far versions stay in them as today, and the
light bake traces both (they overlap, so the bake barely changes).

### Verification

- Fingerprints before and after (the AC fix's script): identical colliders, rails, details, dynamic props, spawns,
  anchors, emitters, lamps and navigation; protos identical except the raised budgets; hull points identical.
- `clip.scan(G)`: no prop sits deeper in drawn geometry than before.
- Self-test with `?selftest=1`: the same 63 of 64.
- `tools/perf-probe.js`: the eight views measured once the AC fix is committed and before any piece lands, and again at
  the end, under the same conditions, within the limits above; the GPU-memory estimate reported alongside.
- Captures before and after of every item from fixed views, plus the near/far switch filmed for the palms, laurels and
  rubble.

## Left to the builder

- Each piece's exact shape, variant count and triangle split within its cap; the drawn textures.
- Where a cap or a perf limit cannot both be met, lower the piece's detail first; report it.
- The README's sections and tables, updated at the end; ASSETS.md notes the new script.
