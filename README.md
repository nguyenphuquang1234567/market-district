# Market District

A compact tactical FPS slice in three.js: one sunlit market-district map, one carbine, a fragmentation grenade and a smoke
canister, 4 v 4 team deathmatch against bots.
It is a deliberately lean take on `Tactical FPS Master Prompt.md` — effort went into the image first.

## Run

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:5173 and press **Deploy**. Everything is served from this folder; no requests leave the machine.
Assets are already in `assets/`. To re-download them from scratch (needs network once): `npm run assets`.

Needs a WebGL2 browser with a real GPU. Tested on an Apple M4 Pro in Chromium and in WebKit.

The bounce lighting is baked in the browser and cached in `assets/gi.bin` (included). If the file is missing or the map
has changed, the bake runs again at boot with a progress bar; `?bake=1` forces it.

### Playing with a locked mouse

Play in a normal browser tab for mouse capture. **Esc** pauses and frees the cursor. **Resume** requests capture again.
If an embedded preview blocks capture, the cursor stays hidden over the playfield during unlocked aiming.
The game also has a native macOS window that grants capture (requires the Xcode command line tools).

```bash
npm run shell
```

```bash
open "build/Market District.app" --args "http://localhost:5173/"
```

### Playing on a phone

A phone or tablet gets on-screen controls by itself (a touch-first screen, or the first finger on any screen; `?touch=1`
forces them on, `?touch=0` off), and a phone starts on the `phone` quality preset. There is no mouse to capture, so
**Deploy** starts play at once. On Android it also asks for the full screen and turns it sideways (the menu's
*Full screen* box turns that off). An iPhone allows a page neither: add the game to the home screen and open it from there
to lose Safari's bars (`manifest.json` and the Apple meta tags ask for full screen and landscape).

To try it from a phone on the same Wi-Fi, run `npm start` on the computer and open `http://<the computer's LAN address>:5173`
(the server listens on every interface).

| | |
| --- | --- |
| Move / sprint | left thumb anywhere on the left 42 % of the screen: the stick appears under it (12 % dead zone, analogue pace). Pushed to the rim, mostly forward, it sprints |
| Look | drag anywhere else on the screen (0.005 rad per CSS pixel at sensitivity 1; the Sensitivity slider and aiming scale it as they do the mouse) |
| Fire | hold **Fire**; drag it to keep aiming while it fires |
| Aim / crouch | **Aim** and **Crouch** toggle (sprinting stands up) |
| Jump, mantle | **Jump** |
| Reload / fire mode | **Reload** (it also puts a grenade away) / **Auto**·**Semi** |
| Grenade / smoke | **Frag** / **Smoke** (each with its count) takes one out; then **Throw** (the Fire button) throws it overhand when let go, and **Lob** (the Aim button), held and let go, lobs it underhand |
| Pause | **II** |

The HUD moves out of the thumbs' way: minimap and health top left, score and compass top centre, kill feed top right,
ammo bottom centre between the thumbs (top left under the health in portrait). The menus scroll and list the touch
controls instead of the keys. Landscape is the intended way to hold it; portrait works, and the start screen suggests
turning the phone.

The `phone` preset (`src/render.js`) leaves the desktop presets as they were. It is drawn as sharp as High is on a
laptop and saves on what a small screen does not show, and on memory:

- up to two render pixels per CSS pixel (High draws 1.25 on a laptop; a phone's CSS pixel is two to three device pixels
  and is held closer, so two looks about as sharp), with 2x MSAA. The first version drew one per CSS pixel and was
  plainly blurry on a phone. The adaptive resolution aims at 30 fps here and never goes below 0.75 of that;
- no AO, bloom, sunlit dust or wet-ground reflections, and no motion blur by default (a thumb's flick turns fast enough
  to smear every turn; the menu can turn it back on);
- two shadow cascades of 2048 px to 60 m, the outer one drawn every other frame and without the small detail, as High
  draws its outer ones;
- small things and the modelled kit pieces culled at 0.6 of High's distances (the kit swaps to its flat stand-ins at
  18 m instead of 30 m);
- every compressed texture without its top level (2048 → 1024, 1024 → 512): about 110 MB of video memory instead of 440;
- the sky drawn full size as on desktop, but its reflection map made from a half-size copy (1536 × 2048 instead of
  3072 × 4096);
- after boot, the copies the page keeps that only drawing needed are let go: the district cells' normals, colours and
  uvs (rounds and sight checks read only positions), the texture data and the sky's pixels once they are on the GPU.
  About 460 MB together.

Draw calls and triangles per frame, shadow passes included, in Chromium's phone emulation on the M4 Pro (740 × 360 CSS,
the perf probe's views, mean of four frames):

| View | High | Phone |
| --- | --- | --- |
| Main street | 426 calls, 5.4 M triangles | 301 calls, 2.9 M triangles |
| Plazuela | 303 calls, 2.9 M triangles | 245 calls, 2.1 M triangles |
| Market lane | 354 calls, 4.1 M triangles | 279 calls, 2.7 M triangles |

On the M4 Pro the step from one to two pixels per CSS pixel took the main street view from 6.1–6.4 ms to 7.3 ms a frame
(`G.bench`, in a hidden pane). A phone's GPU pays mostly for pixels, so the step costs more there; that has not been
measured on a phone yet. The other large costs on a phone are the district's vertex buffers (about 520 MB on the GPU,
as on desktop) and the download, which is unchanged: the 2048 textures are fetched and their top level dropped there.

## Controls

| | |
| --- | --- |
| Move / sprint / crouch | `WASD` / `Shift` / `C` (you can fire while sprinting: the rifle comes up in about a tenth of a second, at a cost in pace and accuracy) |
| Jump, mantle low cover | `Space` |
| Fire / aim | left / right mouse |
| Reload / fire mode / inspect | `R` / `B` / `F` |
| Fragmentation grenade / smoke canister | `G` / `Q` takes one in the hands (the rifle hangs on its sling). The same key again, or `R`, puts it away |
| Throw / lob | with one in the hands: hold left mouse to pull the pin and bring the arm back, release to throw overhand (about 20 m flat, 35 m lofted); right mouse does the same underhand for a short lob (about 9 m) |
| Pause | `Esc` |
| Frame-stats overlay / write a session report | `F3` / `F4` |

The menu has sensitivity, FOV, ADS sensitivity, invert-Y, quality preset, difficulty, and toggles for motion blur, camera shake,
vignette, grain, chromatic fringe and view bob. Settings persist in `localStorage`.
Key bindings live in the same saved settings object (`binds`, including `frag` and `smoke`); there is no rebinding screen.

## What is in it

- **Rendering** — HDR pipeline with ACES tone mapping; a 4k HDRI sky; the sun is located in the HDRI, removed from it, and
  replaced by a directional light with cascaded soft shadows; screen-space ambient occlusion (GTAO); bloom on genuinely bright
  pixels only; 4× MSAA; restrained turn blur, vignette, grain. Textures are KTX2 (Basis UASTC, see `tools/encode-ktx2.mjs`),
  transcoded off the main thread to the GPU's own block format (ASTC 4×4 on Apple GPUs, BC7 elsewhere) with their mip chains,
  so they take a quarter of the video memory of decoded JPEGs; every shader is compiled and every texture uploaded at boot.
- **Bounce lighting** — a baked irradiance volume (158 × 8 × 161 probes at 1 m spacing over both districts, first-order spherical harmonics,
  ray-traced against the real geometry: 96 rays a probe, the ray set turned by a different angle at each probe so neighbours
  do not share the same gaps, sky occlusion, sun bounce and three further bounces, light through cloth, and the lit bulbs as
  point lights: one over every stall in the market hall and one on its flex in every walk-in shop). Shade, alleys, the
  covered lane and shop interiors are lit by what they can actually see rather than by an unoccluded sky; rooms and the hall
  get warm pools of light round their bulbs, falling off into darker corners. The hall's corrugated roof is painted and
  rusted sheet (not bare metal), so its underside picks up the light bounced off the floor. The bake takes about 30 s and is
  cached in `assets/gi.bin`.
  The physically correct result leaves alleys at a tenth of the open-sky light and rooms at a fiftieth, so the shader
  range-compresses it (`uGiLift` in `src/render.js`: exponent and floor): shade stays shade, but nowhere is too dark to read.
- **Exposure and sky** — exposure is metered from the rendered frame (log-average luminance) and adapts quickly into light,
  slowly into dark; the HDRI clouds drift with a flow map, and soft cloud shadows slide across the district.
- **World** — a ~90 × 160 m district generated from a fixed seed: main street with a long sightline, a narrow alley with laundry
  lines, a covered market lane with stalls and translucent shade cloths, a plaza with a fountain, palms and a monumental arch,
  walk-in shops, an exterior stair to a low rooftop. Buildings have real window and door depth, shutters, bars, balconies,
  parapets, pipes, cables and rooftop clutter. Every balcony is solid: its slab is a floor to stand on and a roof that
  stops sight and fire from the street, a plaster parapet is cover, and an iron railing stops a soldier (who can still
  jump it) but not sight, bullets or sound. Surfaces are scanned PBR texture sets with world-space weathering on top;
  props are scanned models simplified at load.
- **Architectural kit** — mouldings and details modelled in Blender from a script (`tools/blender/kit.py`, swept profiles,
  bevels and boolean cuts; `assets/kit/kit.glb`) and fitted to every house in both districts by `world.js`: moulded
  window sills with a drip groove, window and door surrounds in pink cantera or painted plaster with corner blocks and a
  keystone over doors, panelled double doors with raised fields and an iron pull, moulded string courses between floors,
  a cornice at the roofline with mitred outside corners, crowned parapet copings, stone corbels under balconies, tiled
  eaves (tejaroz) of clay barrel tiles on wooden rafters on some houses and small tile hoods over some windows (every tile
  its own shell, shaded tile by tile, the eave tiles' mouths closed with lime mortar), and worn street corners: a quarter
  metre of each wall at every outside corner is a rounded arris, chipped in places down to the brick, stacked a metre at
  a time. Each piece's texture is projected in world space, exactly as the walls are, so plaster runs on across a corner
  and stone across a frame. The kit decides by position, never from the random streams: the layout, cover, dressing and
  routes are unchanged. Near the camera (30 m from a 24 m cell, scaled by the quality preset) the detailed pieces are
  drawn over the flat stand-ins that were there before (painted frames, box sills, plain doors); further off only the
  stand-ins and a corrugated low-detail version of the tiles are drawn, and the detail stays out of the farthest shadow
  cascade. The plaza fountain is two kit pieces as well: an octagonal cantera basin on a step, with sunk panels and a
  rounded coping, and a turned tazza with two bowls and a finial. The game lays talavera into the panels and over the
  inside of the basin, and draws the water: standing in the basin and both bowls with two layers of ripples drifting
  across each other, spilling over each lip as a sheet that breaks into strands, and foaming where it lands. It can be
  heard from across the plaza, and a soldier can wade in the basin (soldiers' routes keep round it).
- **Facade archetypes** — every building is one of five kinds of Mexican street architecture, chosen from the streets it
  faces (each street has its own mix) by a random stream of the building's own (`src/facades.js`):
  - *casona* — a colonial house: tall openings in cantera surrounds under moulded hoods, pediments or round arches with
    keystones, an iron balcony with scrolled railings to each first-floor door (some with stone balustrades), French
    window rails above, quoins up the corners, an order of pilasters to each storey between the bays, a rusticated
    stone base, string courses, a heavy cornice and sometimes a balustraded roof between piers with ball finials;
  - *vecindad* — a tenement: small windows with scrolled grilles set where the rooms needed them, a bathroom slit beside
    some, bricked-up openings, a single off-centre balcony, newer plaster in patches, plaster fallen off to the brick;
  - *comercial* — a 1950s block: bands of wide steel windows between projecting floor slabs, concrete fins, a glass-block
    stair window, a cantilevered canopy over the shops, a stepped parapet or a sign frame on the roof;
  - *obra negra* — a plastered shop floor under storeys left in brick between bare concrete columns and beams, raw openings
    (boarded, open, walled up or glazed), cast lintels, rebar out of the column stubs;
  - *barrio* — a small house in strong colours: wooden casements and shutters, painted surrounds, a tile hood over the
    door and a window, a niche with a saint, a curved crest on the parapet or a tiled eave.
  The new kit pieces (archivolt, hood, pediment, quoins, pilaster with base and capital, scrolled balcony railing,
  window grille, casement, balustrade, niche) are modelled in `tools/blender/kit.py` like the rest. A pilaster is an
  order of its storey, about 1:7 (0.38 m wide to 2.5–2.9 m): an Attic base (plinth, torus, scotia, torus), a shaft of
  three or four stones with eased arrises, V bed joints and a sunk panel in a quirk-and-ovolo moulding (a *pilastra
  cajeada*), and a capital of astragal, neck, annulets, echinus and abacus. It stands on the base course or on the
  string course, which breaks forward over the pilaster below, and under the main cornice carries a short block of
  architrave and frieze. (As first drawn it was one 36 cm strip from pavement to roof, 1:22, with a panel a centimetre
  deep: a stripe.) All the carved stone of a stone-trimmed house (surrounds, sills, hoods, string courses, cornices,
  quoins, balusters, pilasters) is dressed stone now, the `sillar` material: a fine-grained surface with the clouding
  and inclusions of cut cantera added in the shader in world space, tinted to the mean colour of the cantera wall
  texture so the palette does not move. That wall texture is rough blocks in wide mortar joints, and on a moulding
  its joints ran across every member; it stays where it is walling. Each shaft stone and quoin takes a shade of its own. Every window's glass
  shows a room behind it (interior mapping in the `room` material): plaster in one of a few colours with a darker dado, a
  doorway, a wardrobe or a picture on the far wall, a tiled or boarded floor, a ceiling lamp lit in some rooms, and sheer
  curtains or drapes just inside the glass; the room moves with the viewpoint, and the sky's reflection takes over at
  grazing angles. Rain stains run down from the sills. The street floor's openings, the shops, the street props, the
  collision and the soldiers' routes are the district's own and stayed exactly where they were: the old floors above
  the shops are still generated for their random draws and thrown away, and the new ones draw from the building's stream.
- **Detail pass** — what was still coarse, modelled in Blender from a second script (`tools/blender/props.py`,
  `assets/kit/props.glb`): rubble heaps of broken slab with bent rebar, whole and half bricks, mortared brick, painted
  plaster flakes and grit; vendors' carts (a riveted sheet-metal body under the painted sign, a stainless counter and
  rail with a pot and tubs, a corrugated roof on posts, spoked bicycle wheels, a caster, a push bar, a gas bottle);
  utility poles (a weathered pole, a braced crossarm with pin insulators, a finned transformer on straps with porcelain
  bushings and leads); piñatas wrapped in rows of fringed tissue with crêpe streamers, and ristras of wrinkled chiles;
  the chapel's drum (arched windows in cantera surrounds with glass and grilles, pilasters, a cornice), ribbed talavera
  dome and arcaded lantern; the kiosk's pressed-tin roof with a scalloped valance, cast-iron columns and scrolled
  brackets; Canary date palms (trunks of leaf-scar segments along the old curve, a crown of cut leaf bases, fronds of
  folded leaflets laid one for one on the old fronds, dates); Indian laurels (a buttressed trunk, branching limbs and a
  clipped dome of single leaves); spice sacks with their mouths rolled down; pebbles. The pieces carry texture
  coordinates and vertex colours (a shade, and how freely each vertex moves in the wind), with three new canvas-drawn
  textures (laurel leaves, palm leaflets, tissue paper). The old code still runs for every piece, with all its random
  draws, colliders and detail solids, so the layout, cover, dressing and routes are unchanged (`tools/layout-fingerprint.js`
  checks it). Palms and laurels are drawn near the camera, as the kit is, and the old geometry beyond (`Builder.swap`,
  both versions in the cell of the tree's foot, so a whole tree switches at once); every other piece (rubble, carts, the
  dome, the kiosk, pebbles, sacks, ristras, piñatas, poles) is drawn detailed out to its material's own cull distance,
  the old geometry generated only for its random draws and the solids it records (`Builder.replace`), because a near/far
  pair of each would add two meshes, and their draw calls, to every cell. Rods are 10-sided and cables 6-sided now, and
  five scanned props (pots, tall baskets, plastic crates, jerrycans, cardboard boxes) are drawn from a finer cut (their
  hull and physics from the old one). Rounds, HUD markers and thrown things meet the version of a piece that is on
  screen (`R.kitShown`). `?detail=0` draws the map exactly as before the pass, for A/B timings; it takes the light bake
  as it is and never re-bakes or saves one.
- **Facade colour** — painted the way Mexican market streets actually are (`src/facades.js`). In 59 photographs of
  streets in seven towns (Guanajuato, Dolores Hidalgo, Puebla, Mexico City, Oaxaca, Querétaro, San Cristóbal de las
  Casas; Wikimedia Commons), half of what is wall is below 0.18 HSV saturation and one pixel in twenty above 0.6: the
  walls are natural limewash and plaster colours, and a strong colour is a house here and there, red-orange and ochre
  far more often than blue or pink. So the palette is nine plaster tones, coolest to warmest (limestone, off-white,
  cream, straw, beige, sand, clay, ochre, weathered terracotta), and two accents, an earthy red (a fired brick, its hue held
  toward orange) and a pale sage: no blue, pink or turquoise walls (even faded, in sun or shade they read as sea blue,
  pink or mint). Nothing is picked per house at random: each kind of street has its own mix of tones,
  accents and how often a house takes one (the plaza civic and light, the main street and the quarter's streets warmer,
  the market street the liveliest, the lanes and alleys pale); along a street the warmth drifts slowly (a smooth noise
  field about 36 m across), so a few houses share a family of tones and the next few move on; each kind of building
  leans its own way within that (casonas to limestone, ochre and terracotta with cantera and only the earthy red as an
  accent, 1950s blocks to the pale tones, barrio houses to the warm ones and more accents); a house is
  never the same tone as its neighbour, value steps along a row stay gentle: the dark colours (terracotta, the earthy red) go only
  on a small two-storey house with smooth paint, between mid-toned neighbours (a whole block of three or four floors in a
  dark colour, or a dark colour flaking off grey plaster, stood out of its street instead of into it), and the pale
  sage only on a small house, never next to another accent, and no two houses have quite the same
  paint (a few percent of lightness and the faintest hue shift). The colour roles follow the heritage rules of
  Zapopan (art. 60 and its *Gama de color* annex) and Zacatlán (its illustrated guide): two matte colours to a facade,
  A on the wall and B on the base band (*guardapolvo*), the frames and what is picked out, B either the wall's own colour
  a good step darker or a deep earth or grey that goes with it (oxide, umber, slate, moss, wine, charcoal);
  frames white, cantera on the casonas, or B; balconies and sills in the frame colour; ironwork black; doors and shutters
  stained wood or painted, a cool colour on a warm wall and a warm one on a cool wall. Every facade also carries its
  age, read by the wall shader per building (vertex attribute `aAge`): paint bleached by the sun, more of it higher up
  and in patches; road dust over the lowest metre, thinning out unevenly; rising damp in some stretches, darker below a
  wandering line with the salts dried pale along it; a street floor repainted (often a shop front, up to its doors or to
  the floor line) in new paint a shade richer than the faded coat above; newer paint in repair patches; on some
  tenements, unfinished houses and barrio houses the paint flaking off the grey plaster. How much of each a house shows
  depends on its kind and a little luck, and some houses were painted recently. The colours come from a random stream
  of their own, so repainting the district never moves a balcony. The final grade no longer adds saturation and warms
  the sunlit tones only slightly (the sun is already warm); measured at the same exposure across 20 views, the share of
  very strong colour went from 16 % to 6 % (the photographs: 5 %) with the picture as bright as before. Sources: Zapopan,
  *Gama de color* (portal.zapopan.gob.mx/ordenamiento/planos/colores_empleables.pdf); Zacatlán, *Guía ilustrada de
  preservación de imagen urbana* (zacatlan.gob.mx/boletines/wp-content/uploads/2026/01/Guia_Ilustrada-Imagen_Urbana.pdf);
  street photographs from Wikimedia Commons (searches for streets of the seven towns above).
- **The market quarter** — a second district (x 46…111, about 65 × 160 m; west on the in-game compass, behind the
  covered market lane) reached through four passages cut in the ring of houses behind the lane, which carry on the two
  spawn streets and the two cross streets. Cobbled streets: *Calle del Mercado* along the ring, *Calle Sur* and *Calle
  Norte*, an outer street and a new outer ring of houses. An iron market hall (28 × 24 m) in the manner of the
  early-1900s mercados: a raised nave with an open clerestory and skylights, lean-to aisles on slim green columns, a
  brick and stone portal facing Calle del Mercado and five more ways in through low brick walls that leave it open
  above waist height, a terracotta floor, islands of stalls with their goods, painted signs and bulbs on flex, and a
  canopy of papel picado. A *plazuela* with a raised kiosk (two flights of steps lead up, and the player can run and
  jump over the railing from the platform. The open ironwork lets bullets, sight and sound through),
  a laurel in a planter, café tables and umbrellas, and a
  parish chapel with a pink-stone doorway, a bell gable (espadaña) with three bells, a tiled dome and a walled atrium. The architecture is a Mexican colonial-market vernacular rather than
  any particular place: lime plaster in ochre, terracotta, pink, cobalt and lime green over a darker base band, cantera
  door and window surrounds, rebar left standing on flat roofs, roller shutters, talavera tile panels, hand-painted
  shop signs (all generic), papel picado strung across the streets, striped tarps, bougainvillea, ristras and piñatas.
  The old district gets the same palette, bands, surrounds and papel picado (its layout, cover and routes are unchanged).
  The design notes are in `docs/superpowers/specs/2026-11-15-mercado-quarter-design.md`.
- **Weapon** — a procedurally modelled M4-pattern carbine with a tube red dot (the reticle is collimated in the shader, so it
  stays on the bore line as the view moves) and a weapon light with tape switch; finish with micro-normal grain, edge wear
  driven by surface curvature, and light dust on upward faces. Gloved hands are modelled as smooth distance-field surfaces
  with knuckle guards, cuff straps and stitched seams; the support-hand grip is solved so each finger joint rests on the
  handguard. ADS, semi/auto, recoil pattern, inspect, wall lowering, muzzle flash and light, casings, tracers, per-surface
  impacts and decals, light penetration and ricochets. The muzzle flash (`src/muzzleflash.js`) is drawn by a shader
  from a seed, so no two shots are the same picture: a white-hot core at the crown, a tongue of burning gas down the
  bore, pinched at the muzzle and bulging a hand's length out, and a short jet through each of the birdcage flash
  hider's five slots, up and to the sides (the bottom is closed). One bright frame and a larger, much fainter second;
  one shot in eight is dim and one in eight is the big secondary flash; some throw a few grains of burning powder, and
  the gas goes out as a quick grey jet. It is three cards on the muzzle (one across the bore for the view from behind
  or in front, two along it for the view from the side) and a core sprite, each faded as it turns edge-on or would
  blur over the target; smaller from the hip than a bot's, smaller again through the optic. The bots' rifles draw
  from a pool of the same flashes, and the one nearest the eye carries a light, as the player's does. Reloads bring the rifle up, the hand strips and seats the magazine,
  and the bolt closes as the support hand returns after an empty reload.
- **Blood** — a round into a body (`src/blood.js`) throws a ragged burst and a cloud of red mist at the wound, back
  towards the shooter and more of it out of the far side, a cone of fine spatter flung fast out of both wounds, and
  drops along the round's flight that fall under gravity; then the wound pumps, a jet with each beat of the heart for a
  second or two, weaker each time, following the bone it is in as the man runs on or falls. What they reach is
  stained: rays from the exit wound against the drawn geometry find the wall or ground behind, and after the time the
  drops take to get there a spray drawn out along the surface, a splat, or a patch with runs down a wall is laid on
  it, with smaller drops on the ground under the flight; a headshot throws more, a hit on a limb less, a grenade's
  fragments in every direction, and a body already down still bleeds when shot. A stain goes only where the surface
  carries all of it (eight points round it are looked for within a few centimetres of its plane), so none hangs over
  a kerb, past a corner or across a window's reveal. The wounded leave a trail of drops for some seconds; the
  fallen bleed out into a pool that spreads from the wound over eight to thirteen seconds, as large as the ground
  there allows. Hit yourself, you get it on the lens: soft splats towards the side the round came from, off the middle
  of the screen, gone in three or four seconds. Stains are wet (a low roughness, so the sky shows in them), instanced
  like the bullet marks, a ring of each kind, about six hundred at most; all of it is decoration with its own random
  stream, so nothing about how a match plays moves. *Blood* in the options, or `?blood=0`, turns it off: a hit then
  puffs cloth dust, as it used to.
- **Bots** — rigged soldiers with separate low-ready and shouldered rifle poses, a support hand that follows the weapon,
  and a visible magazine extraction and insertion. They navigate with A* on a 1 m grid that covers both districts and
  the passages between them (and pick objectives in the market quarter as well as the old streets), see only inside a field
  of view (which follows where the head is turned) with line of sight and a detection delay, react to gunfire and footsteps
  with an uncertain position, share sightings after a delay, use cover and peek, fire in bursts, reload, search after losing
  contact, and respawn out of sight.
- **How they move** — within what a person carrying a rifle and kit can do. Soldiers either walk (about 1.6 m/s) or run
  (a 3.5 m/s jog up to a 5 m/s run) and change between the two in a step or two; each has their own pace. They move up
  briskly while the fighting is far off, run towards a reported contact and close the last stretch at a walk. Starting
  takes about 3 m/s², planned braking 2.8 m/s², and a bend is taken no faster than 3.8 m/s² of sideways load allows:
  a street corner is slowed for and walked as an arc, a change of direction in the open is one long curve. Within a
  step of a wall or a gap they drop to a walk. Going back the way they came, they halt and turn on the spot.
  Routes keep a shoulder's width off walls, favour the edge of a street over its middle, never squeeze through a gap
  narrower than a body, and differ a little from one soldier to the next. Out of contact the hips follow the feet
  while the chest turns into the coming bend and the head goes first: along the route, down a side street as it opens,
  and to either side. At some waypoints they stop and look left and right; most they walk through. They step round
  each other early and walk round a post instead of into it.
- **How they carry themselves** — the clips were made for swinging arms, so the trunk is steadied for someone holding
  a rifle in both hands: the pelvis keeps part of its bounce (5 cm at a walk, 7 cm at a run), the chest is held near its
  average attitude instead of rocking with every stride, the head stays level on the way it is looking, and a rifle at
  the low ready rides the stride more gently than the chest. The body banks into a bend only at a run. Walking steps
  lengthen and quicken together; running keeps its cadence and lengthens the stride; the first step from a standstill
  starts at toe-off. The part of the sole carrying the weight (heel, then ball of the foot, then toe) stays where it
  landed, except that the toe is let creep the last centimetres before it lifts so the knee can bend for the swing
  instead of trailing straight and whipping forward. With the rifle up they side-step and back away on separate gaits,
  no faster than 1.9 and 1.75 m/s; running for cover they turn and run.
- **Changing what the legs are doing** — nothing about a leg is switched from one frame to the next. Starting,
  stopping, turning on the spot, going from walking forward to side-stepping or backing away, and changing between
  walk and run are each eased over a fraction of a second, and a gait once chosen is kept for most of a second so a
  soldier near the walk/run boundary does not flicker between the two. Standing, a boot stays where the last step
  left it while the body sways, turns or crouches above it; a boot left well out of place by a halt in mid-stride is
  moved with one small settling step, the other planted. When the shoulders have turned as far as is comfortable the
  feet step round after them, and keep stepping until the turn is finished. Crouching and standing up ease in and out
  (a soldier does not bob up for a moment between two reasons to stay low). A planted boot's heel is raised over its
  toe and set down again at a limited rate, a boot the body has outrun is drawn after it, and a boot pressed against a
  wall is moved off it by no more than its own length: none of these is ever applied in a single frame.
- **Kerbs and steps** — a soldier walks up a kerb or a stair (up to 24 cm) and round anything taller. A planted boot
  keeps the footing it landed on; a swinging boot takes the ground where the stride will set it down, so it starts to
  rise at toe-off when the next step is up and holds its height until clear of the edge when the next step is down. The
  body rises on its legs as the trailing boot comes up, and the pelvis gives a little if a boot's place is out of reach,
  so no knee locks straight and snaps free. When the barrel approaches a wall, the soldier tucks the rifle closer to
  the chest.
- **Throwables** — you carry two K-22 fragmentation grenades and two V-8 smoke canisters (both fictional), restocked
  each life and counted on the HUD beside the ammunition. Each spent throwable also refills after 15 seconds of active
  play. Each is a modelled object (pressed steel ball or rolled can,
  fuze, safety lever, pin and ring, stencilled paint with chips and dust) held in a gloved right hand shaped to it while
  the left index finger hooks the ring. Holding the mouse button draws the pin straight out, the left hand lets it
  fall, and the arm goes back; releasing throws. The lever springs off as the hand opens and the fuze starts only
  then, so there is no cooking: 4 s for the grenade, about 1.6 s for the canister. Pin and lever fall and ring on the
  ground. Dying with the pin out drops the grenade live at your feet.
  In flight each is a rigid body with continuous collision (a ball or a can with the fuze standing proud, so it kicks
  off line, wobbles and stops on its side): it comes back off walls, cover, clutter and soldiers, skips along the road,
  is braked by rolling and comes to rest, with a knock at every contact that depends on what it struck.
  The collision boxes cover house blocks, kerbs, steps, cover and balcony floors and parapets (so it comes back off a
  balcony front and can land on a balcony and lie there); a thrown object also feels ahead along its path and beneath
  itself through the triangles that are actually drawn (the same trees the bullets use, plus the cloth a bullet passes
  through), so it slides down an awning and drops off its edge, and gets between railing bars only as often as a 6 cm ball would (about half the
  time). What it is lying on counts as its floor for the scorch mark, the dust and the smoke.
- **The grenade** — a two-frame flash that lights walls and smoke, a fireball that is soot within a tenth of a second,
  sparks, a dust skirt scoured off the ground, a dark column that climbs and drifts with the wind, earth and chips
  lobbed up to rain back, a scorch on the road (and on a wall it burst against), and some fifty fragments traced as
  rays that chip and mark whatever they reach and knock loose things about. Exposure dips for the flash on its own.
  The sound arrives late by distance: a crack and slam with debris falling close by, the street's slap further off, a
  dull thud blocks away; close and in the open it deafens for seconds and leaves a ringing. Fictional damage: 175 at
  the seat, falling to nothing at 11.5 m, scaled by how much of a soldier (head, chest, shins) the burst can see, so
  it kills inside about 4 m in the open, wounds at 8 m and does nothing behind a wall. It hurts whoever threw it
  just the same, and your own side at 40 %. Kills score for the thrower and show a grenade in the kill feed. The
  dead are thrown down as ragdolls; chairs, crates and cans within 8 m are flung by mass; a second grenade lying
  beside it goes off too.
- **The smoke canister** — the fuze pops, the starter mix spits sparks and the jet shoves the can about, then it burns
  for 17 s with a hiss that follows it and is muffled by walls. The smoke is some fifty billows simulated on the CPU
  (jet, buoyancy, a wandering turbulence, wind along the cloud drift, kept out of walls and under ceilings, spreading
  to fill the street) and drawn as lit volumes: sun from its true direction with each billow's lumps picked out, the
  cloud's own shadow through itself, the buildings' shadows on it (sampled by rays), the baked bounce light where it
  drifts into shade, a glow at thin edges against the sun, the blast light of a grenade, fog with distance, and a soft
  shadow on the road. It fades into whatever it touches (using the previous frame's depth) and ambient occlusion is
  held off it. The screen is solid after about five seconds, hangs for half a minute and thins from its edges.
- **What soldiers do about them** — smoke stands in the way of sight like a wall: a soldier with smoke between him and
  his target loses it, fires into the cloud where it was for a couple of seconds, then works round one side instead
  of walking in. Team markers and the aim label on the HUD are hidden by it too. A grenade that lands where a
  soldier is looking, or close enough to hear it strike, is noticed after a reaction time (and missed by some, more
  often on Easy): he runs to cover that would hide a crouching man if he can reach it in time, otherwise straight
  away from it, gets down, and afterwards goes looking for where it came from. Bursts are heard across the district,
  leave soldiers nearby dazed (slower to pick out a target, wilder shooting) and keep heads down. Bots do not throw.
- **Physics** — a rigid-body world (Rapier) built from the district's collision boxes. About 330 pieces of loose clutter
  (chairs, crates, cans, bins, tyres, pots, baskets, gas bottles, hand trucks…) rest as dressed until disturbed, then can be
  shoved by walking into them and knocked about by bullets, with material-dependent mass, friction and bounce; light
  materials let a round through, dense ones stop it. Heavy cover (barriers, steel drums, sandbags) stays fixed so cover
  stays cover. Every prop is placed only where its hull clears the walls and the small solid details (sills, steps, door
  stubs), and soldiers push clutter with a light dynamic body whose acceleration is capped, so a chair walked into a
  wall stops at the wall instead of being driven through it (props also use continuous collision).
- **Ragdolls** — a kill hands the soldier to eleven jointed bodies built from the pose at that instant: hinged knees and
  elbows with anatomical limits, limited ball joints with a little muscle tone elsewhere, a shove from the round that
  killed. The rifle drops as its own body. Bodies react to further hits, and when the soldier respawns the body and rifle
  are left behind as a static mesh (the six most recent).
- **Audio** — almost every sound is modelled, not recorded: 109 sounds in 348 takes are computed at boot (about half a second) from
  physical ingredients (blast pulse, filtered turbulence, modal ringing, grain scatter) — the rifle from behind the sights
  (Saltline's rifle, ported from that earlier game step for step and checked to come out sample-identical: crack, a thump
  gliding down from 160 Hz, the report's body and bark, the bolt carrier back and home, with its own outdoor and indoor
  tails, played at most once each 0.28 s through a burst), other soldiers' rifles (the same round without the action
  within 20 m, then the reports at middle and long range), supersonic cracks, ricochets, strikes on eight materials, boots on six surfaces, rifle
  handling, brass, eleven prop materials, body falls, pin and lever, grenade and canister knocks, bursts at three ranges,
  falling debris, the canister's pop and hiss. The reload (`src/reload-foley.js`) is built part by part from one rifle
  whose modes are drawn once: the forged lower round its magazine well, the upper with the barrel ringing in its
  extension, the handguard, the carrier group, the magazine catch and the bolt catch, the buffer's weights and the
  receiver extension, a polymer magazine and the brass in it, the sling's loop, a cordura pouch, each a bank of modes
  driven by contact pulses as long as the contact would last (about 150 µs for the carrier on the barrel extension, most
  of a millisecond for a magazine seating), by the micro-impacts and grit of one surface sliding over another, and by a
  gloved palm; the buffer spring twangs as a loop of dispersive allpasses, and sleeves and pouch rustle by the arm's
  speed. Eleven sounds in four or five stereo takes each: the rifle lifted, the release pressed, the magazine stripped
  (an empty one's spring jumping instead of its rounds shifting), stowed, a full one drawn from the pouch, seated with the
  catch snapping into the notch, tapped and tugged, or after an empty one the bolt catch slapped and the carrier slamming
  home with the round stripped and the bolt locking, and the rifle settled back; each placed so its click lands on the
  frame of the motion it belongs to. Other soldiers' reloads play the same takes in one channel from where they stand. A soldier going down has his own set: the round going into him (cloth and
  body, the plate in his vest, the helmet); his last sound, which is a real recording — 52 clips of men screaming, crying out,
  dying and groaning from openly licensed packs (`assets/audio/voices.wav`, credits in `ASSETS.md`; a modelled voice stands in
  if the file is missing): mostly a scream or a death cry, otherwise a short cry of pain or a groan, and from a head shot a cry
  cut off as it starts, or nothing. The voice carries further than other sounds and is not dipped by your own shot, so it is
  heard over the rounds still going out after the kill. Then clothes and kit as he crumples, and one knock per ragdoll
  contact — the trunk with a recorded body thud under it, helmet, knee pad, arm — and the dropped rifle's clatter, each in
  six kinds by what it lands on (concrete, tile, dirt, boards, sheet metal, cloth) and as loud and sharp as the contact was
  hard. Killed yourself, you hear it from inside, timed to the falling camera. The engine then places them: speed-of-sound delay, air absorption, muffling by walls
  (three rays, so partly hidden sources still come over and around), HRTF panning, six early reflections whose delays, levels
  and directions are traced from the walls actually around you, three reverberant spaces (street, narrow passage, room)
  crossfaded by the same rays, hearing that dips for a moment after each of your own shots, humming air-conditioning units
  where they hang, birds, awnings, cicadas and distant fighting.
- **HUD** — a blue ring marks a visible ally and a red diamond a visible enemy within 45 m; aim at one to see his call
  sign. DIN Condensed for numbers (one width for every figure, so counts never shuffle), Avenir Next Condensed for
  words; white by default, amber for what asks for action (kit in hand, low ammunition, headshots), red for harm. No
  boxes: soft shade and dark halos keep it legible in the sun and in the market hall. Top: minimap, compass and
  bearing, the race to 30 either side of the clock, kill feed (yours on amber). Bottom left: health, with the chunk
  just lost draining in red. Bottom right: selector, magazine and reserve, a mark per round that refills as a magazine
  seats, frag and smoke with their keys. Under the sights: hit marker, damage arc, and a reload / throw prompt. Sizes
  follow screen height; past 21:9 the corners stay inside 21:9. The look is all in `index.html`; `hud.js` only sets
  text, classes and a few CSS variables.

- **Air** — the sun's light scattered by dust on its way to the eye, with the buildings' shadows cut out of it
  (`src/atmos.js`): shafts under the market hall's skylights, between the shade cloths of the covered lane and down
  the alleys, and a haze that deepens along a street and brightens towards the sun. A post pass at half size walks each
  view ray (12 steps on High) through the sun's shadow cascades; dust is thickest near the ground and thicker again in
  enclosed places, which the baked light volume knows as places that see little sky. The result is blurred along depth
  edges only and added to the frame: it adds light and never takes any away, so no place gets darker. Motes drift and
  glint in sunlit air indoors and under cover (never against the open sky, where they read as specks).
- **Street life** — what a used street carries that its architecture does not (`src/streetlife.js`). On the ground:
  oil, tar patches and crack sealing on the asphalt, tyre marks, a worn crossing before each junction, yellow kerbs at
  the corners, drain grates in the gutter, fallen leaves and bougainvillea petals under the trees and vines that drop
  them (read from the drawn foliage), litter along the walls, vegetable scraps round the stalls, chewing gum, plaster
  crumbs, a chalk hopscotch in each square. On the walls: pasted posters in ones to fours, painted wall
  advertisements rubbed back to the plaster, spray tags in the alleys, leak streaks, enamel notices and house
  numbers, electricity meters on their conduit. On the roofs: water tanks on brick stands, aerials, dishes. And wet
  ground: some hundred patches, most only damp (darker, with a sheen), a few holding water that mirrors the street.
  The mirror is real: each water pixel marches its reflected ray through the previous frame's picture and depth (a
  half-size copy kept by the renderer), so facades, awnings, papel picado and soldiers show in it, and the sky map
  stands in where the frame has no answer. All of it is one layer added after the district is built, in a group of
  its own: where a wall is flat and bare, or the ground level and clear, is found by rays against the drawn
  triangles, and every choice is a hash of the position. Nothing is drawn from the map's random streams, nothing
  collides, and nothing enters the light bake's signature, so layout, cover, routes and the bake are exactly as
  before (`tools/layout-fingerprint.js`: identical; the bake still loads as cached). Every word on a poster or a wall
  is generic Spanish. The 1,800-odd decals are one draw call from one 2048² canvas-drawn atlas; they fade out by 80 m.
  `?life=0` leaves the layer out.
- **One draw call per material** — the district used to be drawn as one mesh per material per 24 m cell: 2,000-3,000
  draw calls a frame across the view and the shadow cascades. Now all of a material's cells share one vertex and index
  buffer, each cell a range of it, and the cells that pass culling are drawn together with `WEBGL_multi_draw`
  (`src/batch.js`): 2,594 cell meshes in 105 draws. The cell meshes stay, out of the scene, as the district's data:
  what bullets and thrown things hit, what the light bake reads, and where distance, kit near/far and zone culling
  write each cell's visibility, which a batch reads as it is drawn, for the view and for each shadow cascade. three.js
  only multi-draws what claims to be a `BatchedMesh`, whose shader looks up a transform per vertex in a texture; the
  district is already in world space, so those shader chunks are replaced by an identity. (Found on the way: three.js
  tests a shadow caster's layers against the view camera, not the cascade's, so keeping small things out of the far
  cascade had never taken effect. A batch tests the cascade's camera itself, and only what is culled nearer than 80 m
  stays out, so awnings and roofing still cast at range.) `?batch=0` draws cell by cell as before.

- **The street floor and the shops, modelled** — what the district drew as a flat textured quad, or left out, is real
  geometry near the camera now, modelled in Blender from a third script (`tools/blender/arch.py`, `assets/kit/arch.glb`,
  48 pieces with bevelled edges, weighted normals and occlusion baked into vertex colours) and fitted by
  `src/archdetail.js`:
  - *roll-up shutters* (cortinas): curved laths 75 mm apart in steel guide channels under a bent-sheet housing with
    riveted end plates, a bottom bar on its rubber, two lifting handles, and one or two hasps padlocked to rings in
    the pavement; the ones the district drew in corrugated sheet are *sheet gates* instead: two leaves of real
    corrugation on a tube frame, three barrel hinges a side, a slide bolt and a padlock;
  - *steel street doors*: a folded leaf with pressed panels, a louvred vent, a barred light, hinges, a pull and lock;
    and in every doorway a stone threshold, its nose rounded and its middle worn hollow (slab and nose are two
    pieces: the slab stretches to the doorway's depth, the nose keeps its shape, and neither stands proud of the
    wall, so nothing pushed against the wall ends up inside it);
  - *window grilles* on every street-floor window: a projecting flat-bar frame on four legs, round bars through
    two rails with forged collars, spear points, and a band of S-scrolls and rings;
  - *base courses* on the casonas: three courses of rock-faced, chamfered blocks in running bond;
  - *shops*: the curtain rolled up under the lintel in its guides; inside, a jack-arch ceiling (brick vaults sprung
    between steel joists, as commercial buildings of 1900-1950 were roofed), a tiled dado of pillowed 12.5 cm tiles
    with a band and a bullnose capping (five colourways), a six-panel door to a back room, shelves of cans, jars,
    bottles and boxes on forged brackets wherever the wall is clear, and a strip light under the joists;
  - *awnings*: the roller in its hood, a front bar, arms and stays in steel tube, bolted wall brackets with clevis pins;
    *hanging signs*: an angle-iron rim round the painted board, hung on links from a forged arm with a scroll and a wall plate;
  - *the market hall*: cast-iron columns (an octagonal panelled pedestal, base mouldings, a fluted shaft, a leafed
    capital under a square abacus) with a pierced cast bracket to each beam they carry, riveted gusset plates
    where the truss members meet (the roof stays a flat textured sheet: modelled corrugation overhead cost 1.3 ms
    a frame from inside the hall, for something seen from eight metres below);
  - *the monumental arch*: a moulded cornice on a row of dentils, an archivolt of three fasciae round each opening
    with a scrolled keystone, impost and base mouldings to the piers, sunk panels, medallions and an inscription
    tablet, always drawn (it is the plaza's landmark from every street);
  - *electricity meters* on the street walls: a board, a cast socket with the meter's glass dome over its dial plate
    and five small dials, a sealing ring and lead tag, threaded hubs the conduit runs into, and a switch box with a
    hinged lid and hasp (the conduit itself now carries its texture at real scale);
  - *the 1950s blocks' canopies*: tapered concrete ribs from wall to edge and a caged bulkhead light between each pair;
  - *parapets*: a clay spout on a stone bracket every few metres of every street front.
  How it stays out of the game's way: `world.js` leaves a note where each belongs and tags its own flat version
  `far2`, so beyond the pass's switch distance the map is drawn exactly as before and the light bake's signature does
  not move (it still loads as cached). The pass's pairs are sorted into 8 m cells and switch by distance from their own cell
  (`R.kitNear2`: 30 m; it was 11 m while the pass was being timed, see the timings), not per 24 m cell as the kit
  does: laths, bars and corrugation are slivers a pixel wide from further off, and under multisampling every sliver
  is shaded once per triangle, which is where the pass's GPU cost was (a first version, switching per 24 m cell at
  30 m, cost 0.4–1.4 ms a frame). Nothing fine here casts a
  shadow; the hall's columns, the arch's mouldings and the spouts do. The rest of the cost was on the main thread,
  and only showed in WebKit (see the timings under Quality presets): thousands of small cells meant thousands of
  multi-draw ranges, which WebKit's Metal backend issues one by one, so a batch now walks its cells as they lie
  in the index buffer (row by row across the map) and sends neighbours as one range (2,028 ranges on the main
  street became 777); the renderer's visibility pass keeps flat records instead of reading each mesh's
  properties, judges half of the fine cells a frame, and judges zone culling (some 7,000 `atan2` a frame) again
  only when the camera has moved far enough to change the answer. A second `Builder`, with no colliders, loose props or random stream, places the
  pieces; its meshes are batched like the district's and join the ray meshes, so a round sparks on the lath it hits.
  `tools/layout-fingerprint.js` reports the layout identical; the district's own drawn index total moved by 252
  triangles (the arch's old box mouldings, which the modelled ones replace), within what the bake's signature
  allows. `?arch=0` draws the map without the pass. Reference for the forms: iron mercados and commercial
  streets of central Mexico (wrought and cast iron of the Porfirian period, steel-joist and brick-vault floors of
  1900-1950, cortinas metálicas and rejas de cajón as built today); for the method, the mid-poly, bevelled,
  weighted-normal modular kits that current environment art is built from.

## Left out on purpose

A key-rebinding screen, heat shimmer, and a recorded gameplay clip. No reference video was supplied, so nothing
was matched against one. Bots do not throw grenades or smoke.

## Quality presets

`low` · `medium` · `high` (default) · `ultra`, from the menu or `?q=ultra` in the URL; a phone starts on `phone`
(see *Playing on a phone*). They change internal resolution,
shadow resolution and cascade count, AO samples, MSAA and bloom. HUD and menus always render at native resolution.
If the display's frame rate cannot be held, the internal resolution steps down (and back up when there is headroom); the
step a machine settles on is remembered per preset.

All numbers below are from an Apple M4 Pro (macOS 15) on its built-in display, in a 1512 × 846 pt window.

**On screen** — real `requestAnimationFrame` intervals in the native WebKit window, last 10 s of play (`F4` / `G.report()`).
The first three rows predate physics, ragdolls and the audio rebuild; the last three are the current build:

| Preset | Rendered at | Mean | p95 | p99 | Worst | Frames over 20 ms |
| --- | --- | --- | --- | --- | --- | --- |
| High, played by hand | 1890×1057 | 16.67 ms (60.0 fps) | 17 ms | 18 ms | 18 ms | 0 of 601 |
| High, firefight while turning and firing | 1890×1057 | 16.92 ms (59.1 fps) | 19 ms | 21 ms | 36 ms | 9 of 592 |
| Ultra, auto-played firefight | 1841×1030 (settled one step below its 2116×1184) | 16.74 ms (59.7 fps) | 18 ms | 20 ms | 28 ms | 5 of 598 |
| High now, auto-played firefight | 1890×1057 | 16.72 ms (59.8 fps) | 18 ms | 19 ms | 20 ms | 0 of 598 |
| High now, played by hand: turning, firing, reloading | 1890×1057 | 16.81 ms (59.5 fps) | 18 ms | 21 ms | 45 ms | 7 of 595 |
| High now, played by hand with bodies and knocked-over props in view | 1890×1057 | 16.67 ms (60.0 fps) | 17 ms | 18 ms | 23 ms | 1 of 601 |

Ultra at its full 2116×1184 ran at about 58 fps (mean 17.3 ms, p95 20 ms), which is why it steps down once on this machine.

**GPU cost per frame** — each frame timed to GPU completion in embedded Chromium (`G.bench()`), two fixed views
(long main-street sightline / plaza), 140 frames each:

| Preset | Rendered at | Street view | Plaza view |
| --- | --- | --- | --- |
| Low | 1058×592 | 10.7 ms | 8.6 ms |
| Medium | 1360×761 | 13.3 ms | 12.1 ms |
| High | 1890×1057 | 16.6 ms | 13.8 ms |
| Ultra | 2116×1184 | 19.1 ms | 16.7 ms |
| High, with physics, ragdolls and the new audio | 1890×1057 | 13.8 ms | 12.3 ms |

The last row is the current build (loose props are instanced now, which costs fewer draw calls than the merged scenery they
replaced); the other presets have not been re-measured. In a 20 s auto-played firefight run in real time off screen, the
physics step averaged 0.18 ms a frame and the whole frame 12.4 ms.

About 1,300–2,200 draw calls and 1.8–3.3 M triangles per frame across the main and shadow passes. Low is limited by draw
calls rather than pixels, so it is not much faster than Medium.

**With the market quarter** — `tools/perf-probe.js`, `median()`: each view timed to GPU completion over 110 frames, the
median of three passes after a warm-up pass, bots parked, High at 1890×1057, embedded Chromium on the same machine. The
baseline is `main` checked out in a separate worktree and measured the same way in the same session:

| View | `main` | This build | Change | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- |
| Main street, long sightline | 14.37 ms | 13.80 ms | −4.0 % | 1998 → 1789 | 3.03 M → 2.47 M |
| Arch and plaza | 12.30 ms | 13.56 ms | +10.2 % | 1659 → 1690 | 2.58 M → 2.67 M |
| Covered market lane | 13.79 ms | 13.07 ms | −5.2 % | 1838 → 1457 | 2.84 M → 2.41 M |
| Laundry alley | 13.28 ms | 12.62 ms | −5.0 % | 1774 → 1496 | 2.68 M → 2.02 M |
| Market lane through the north passage | — | 11.09 ms | | 1293 | 2.21 M |
| Market hall, from Calle del Mercado | — | 12.15 ms | | 1482 | 2.18 M |
| Inside the market hall | — | 11.55 ms | | 1318 | 2.00 M |
| Plazuela and kiosk | — | 9.88 ms | | 779 | 1.18 M |

The heaviest view of the map got lighter (14.4 → 13.8 ms); the plaza is the one view that costs more. What holds the
cost: small details are dropped by distance per material (`userData.lod`, scaled per preset), loose clutter beyond 70 m
is not drawn, the farthest shadow cascade draws only large casters (which took effect only with the batches: see below), each cascade's depth range is fitted to what is in
it, and the ring of houses between the districts is used for zone culling (the far side is drawn only through a passage
that is in view). Estimated GPU memory (`perf.gpuMemory(G)`; WebGL does not report real use) rose from 1961 to 2196 MB
(+12 %): scene textures 1000 → 1172 MB, model textures 592 → 608 MB, geometry 86 → 132 MB, irradiance volume 2.7 → 4.7 MB;
render targets and shadow maps are unchanged. (Textures were still uncompressed then; see the next table.)

At boot every shader is compiled for the target the scene is really drawn into (linear half-float, tone mapped later),
both with the first-person rifle shown and hidden, and every texture is uploaded. Before that, the first death froze one
frame for 0.35–0.46 s (hiding the rifle hides its muzzle light, and the new light count recompiled every lit material)
and the first look into the market quarter for 0.14 s (twenty-odd textures uploaded at once); both now stay under 26 ms.
Played live in a small embedded window (842×873 px, 120 Hz display) for 67 s, including a death, a respawn and the first
walk into the quarter: mean 8.33 ms (display-capped 120 fps), p95 9.4 ms, p99 10.2 ms, worst 10.4 ms, nothing over 20 ms.

(The exposure meter's asynchronous read can leave a pixel-pack buffer bound, which makes a plain `readPixels` fail without
waiting for the GPU; `G.bench()` and the probe unbind it first.)

**With the architectural kit, KTX2 textures and the new bake** — the same probe, run by `?bench=` in the native window
(WebKit) twice for each build, alternating; the baseline is the build before these three changes, kept in a copy:

| View | Before | After | Change | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- |
| Main street, long sightline | 12.62 ms | 13.49 ms | +6.9 % | 1788 → 2029 | 2.47 M → 3.37 M |
| Arch and plaza | 12.05 ms | 13.38 ms | +11.0 % | 1690 → 1888 | 2.67 M → 3.37 M |
| Covered market lane | 12.03 ms | 13.31 ms | +10.7 % | 1457 → 1628 | 2.41 M → 2.88 M |
| Laundry alley | 11.38 ms | 12.91 ms | +13.5 % | 1496 → 1696 | 2.02 M → 2.81 M |
| Market lane through the north passage | 10.30 ms | 10.96 ms | +6.5 % | 939 → 1036 | 1.81 M → 2.12 M |
| Market hall, from Calle del Mercado | 11.06 ms | 11.91 ms | +7.6 % | 1386 → 1500 | 2.11 M → 2.55 M |
| Inside the market hall | 10.55 ms | 11.10 ms | +5.2 % | 1121 → 1211 | 1.79 M → 2.13 M |
| Plazuela and kiosk | 9.32 ms | 9.79 ms | +4.9 % | 774 → 879 | 1.17 M → 1.54 M |

The kit costs about 0.5–1.5 ms a frame on this machine (+8 % on average); the heaviest view stays at 13.5 ms. Estimated
GPU memory fell from 2196 to 1072 MB (−51 %): scene textures 1172 → 444 MB and model textures 608 → 164 MB as ASTC 4×4,
geometry 132 → 180 MB with the kit. Loading to the menu took 6.9 s instead of 8.8 s (mean of the two runs each; WebKit,
warm cache): transcoding in workers replaces decoding and mipmapping JPEGs on the main thread. The download grows from
190 MB of JPEG/PNG to 296 MB of KTX2 (UASTC keeps normal maps and roughness at full quality; ETC1S would be about a
quarter of that size at visibly lower quality). Played live in the native window (`?live=1&demo=1`, an auto-played match at 1890×1057 on a
60 Hz display) the new build held the display rate: mean 16.67 ms, p99 19 ms, worst 24 ms, no frame over 33 ms, at full
resolution (the build before: mean 16.73 ms, p99 19 ms, worst 70 ms, 8 frames over 33 ms).

What the dark places look like now, measured on the before/after captures (`tools/compare-shots.js`, same views, same
clock, exposure metered as in play; share of the frame darker than 40/255): inside a walk-in shop 13.0 % → 4.6 %, inside the
market hall 43.5 % → 33.4 %, the laundry alley 15.5 % → 14.3 %, the covered lane 15.4 % → 14.1 %; nothing clips anywhere
(at most 0.02 % of a frame at 255). The market quarter's cobbled streets in shade had a further fault of their own: the cobblestone
texture's empty occlusion channel cut their indirect light to a tenth. With it rebuilt, a shaded stretch of cobbles reads
at a median of 59–68 (of 255) instead of 11–12, against 44 for the old district's shaded asphalt.

**With the detail pass** (`tools/blender/props.py`) — the same probe in the native window, run alternately with
`?detail=0` (which draws the map exactly as before the pass, in the same build: the layout fingerprints match) after a
discarded warm-up run, three rounds each, medians. The machine was heat-throttled by then (both sides read about 1 ms
slower than the baseline taken first), which is why only the paired difference is given:

| View | Before → after (paired medians) | Change |
| --- | --- | --- |
| Main street, long sightline | 15.26 → 15.04 ms | −0.22 ms |
| Arch and plaza | 13.72 → 14.51 ms | +0.79 ms |
| Covered market lane | 13.75 → 14.59 ms | +0.84 ms |
| Laundry alley | 12.95 → 13.09 ms | +0.14 ms |
| Market lane through the north passage | 10.85 → 11.21 ms | +0.36 ms |
| Market hall, from Calle del Mercado | 11.99 → 13.22 ms | +1.23 ms |
| Inside the market hall | 11.44 → 12.19 ms | +0.75 ms |
| Plazuela and kiosk | 11.59 → 11.69 ms | +0.10 ms |

Single runs spread by up to 0.5–1 ms, so differences under that are noise. The hall from Calle del Mercado was the one
view over a millisecond; the finer cut of wall lamps and gas tanks, the largest single cost in that view, was dropped
after this run and not timed again. Draw calls stayed within a few dozen of the old map's in every view: a near/far
pair for every piece had added up to 440 (the far halves sit in their own meshes in every distant cell), which is why
only palms and laurels keep one and their modelled leaves leave the shadows to the old leaf cards. Estimated GPU memory
1222 → 1282 MB (geometry 309 → 368 MB).

**With the air, the street life and one draw per material** — `?bench=` in the native window (WebKit), this build and
`main` (checked out in a separate worktree) run alternately, four runs each, medians. Each frame is timed to GPU
completion, which makes the CPU and the GPU take turns, so these numbers overstate a frame in play:

| View | `main` | This build | Change | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- |
| Main street, long sightline | 14.82 ms | 13.75 ms | −1.08 ms (−7 %) | 2164 → 345 | 5.35 M → 5.00 M |
| Arch and plaza | 14.25 ms | 12.91 ms | −1.34 ms (−9 %) | 2163 → 346 | 5.80 M → 5.25 M |
| Covered market lane | 14.61 ms | 12.55 ms | −2.05 ms (−14 %) | 1764 → 345 | 4.82 M → 4.60 M |
| Laundry alley | 13.48 ms | 11.25 ms | −2.23 ms (−17 %) | 1868 → 335 | 4.30 M → 4.09 M |
| Market lane through the north passage | 11.19 ms | 11.33 ms | +0.14 ms (+1 %) | 1498 → 321 | 3.74 M → 3.47 M |
| Market hall, from Calle del Mercado | 13.04 ms | 12.04 ms | −0.99 ms (−8 %) | 1761 → 311 | 4.71 M → 4.37 M |
| Inside the market hall | 12.29 ms | 11.92 ms | −0.37 ms (−3 %) | 1587 → 305 | 4.37 M → 4.03 M |
| Plazuela and kiosk | 11.98 ms | 11.86 ms | −0.12 ms (−1 %) | 976 → 284 | 3.52 M → 3.21 M |

Runs of one build spread widely that day (`main` by up to 1.5 ms between runs, this build by up to 3.7 ms: its first
run was 2–3 ms slower than its other three in every view), so the two views within 0.2 ms are level, not slower or
faster. What the batching changed is where the time goes. In embedded Chromium (1280 × 960), with the haze and street
life on in both, the main thread's time to submit a frame fell from 4.95 to 2.4 ms on the main street, 4.51 to 1.9 ms
at the arch and 3.54 to 1.9 ms in the hall, while the time to GPU completion barely moved (6.65 → 6.33, 5.83 → 5.61,
4.97 → 4.91 ms): the frame is limited by the GPU, about 3–5 M triangles and the pixels, not by draw calls, which an
earlier reading of the WebKit numbers had suggested (there the main thread waits on the GPU, so its time tracks the
GPU's). The new parts cost, to GPU completion on the main street in Chromium: the haze about 0.4 ms (before its
lookups were cut from six a step to two), the street life 0.3 ms, the kept frame 0.1 ms.

What it costs elsewhere: loading to the menu takes about a second longer (9.6 s against 8.6 s; building the district
4.7 s against 4.0 s, for the rays, the atlas and the batches' buffers); estimated GPU memory 1283 → 1362 MB (+6 %:
geometry 369 → 411 MB, textures 630 → 667 MB). Small things (culled nearer than 80 m) no longer cast into the far
shadow cascade, which was the intent all along. Reflections in water are a frame late and know only what was on
screen: a ray that leaves the picture falls back to the sky map. Low has neither haze nor reflections. The batching
leans on how three.js r170 draws a `BatchedMesh` and needs rechecking on an upgrade. The scripted checks
(`?selftest=1`) pass as on `main` (64 checks, the one known failure). On-screen pacing in play was not measured for
this build.

**With the architecture pass** (`tools/blender/arch.py`, `src/archdetail.js`) — `?bench=` in the native window
(WebKit), this build and `main` (in a separate worktree) run alternately after a discarded warm-up, three runs each,
medians:

| View | `main` | This build | Change | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- |
| Main street, long sightline | 12.81 ms | 12.79 ms | −0.02 ms (0 %) | 366 → 386 | 5.49 M → 5.57 M |
| Arch and plaza | 11.90 ms | 11.93 ms | +0.03 ms (0 %) | 364 → 392 | 5.55 M → 5.49 M |
| Covered market lane | 11.97 ms | 11.95 ms | −0.02 ms (0 %) | 366 → 390 | 4.88 M → 4.91 M |
| Laundry alley | 10.81 ms | 11.09 ms | +0.28 ms (+3 %) | 352 → 370 | 4.29 M → 4.45 M |
| Market lane through the north passage | 10.31 ms | 10.24 ms | −0.07 ms (−1 %) | 333 → 368 | 3.22 M → 3.24 M |
| Market hall, from Calle del Mercado | 11.14 ms | 10.95 ms | −0.19 ms (−2 %) | 331 → 345 | 4.71 M → 4.57 M |
| Inside the market hall | 10.91 ms | 11.13 ms | +0.22 ms (+2 %) | 322 → 336 | 4.08 M → 4.12 M |
| Plazuela and kiosk | 11.06 ms | 10.70 ms | −0.36 ms (−3 %) | 302 → 313 | 3.74 M → 3.45 M |

Level with `main`: the differences (−0.36 to +0.28 ms, −0.02 ms on average) are inside what runs of one build
spread by here (`main` up to 0.4 ms, this build up to 0.7 ms), and the 95th-percentile frame is the same millisecond
in every view but two (the alley 11 → 12 ms, the plazuela 12 → 11 ms). An earlier set, taken before the electricity
meters went in, read −0.66 to +0.50 ms. It did not start level: the first version cost 0.4–1.4 ms a frame and the
hall 1.7 ms. Finding where that went took an interleaved probe (`?ab=<tag>`, `tools/perf-probe.js`: the cases are
switched inside one page, a few dozen frames each, round after round, and the medians compared, which takes run-to-run
drift out): the modelled pieces themselves were about 0.45 ms on the main street, the hall's corrugated roof 1.3 ms
from inside, and the renderer's own visibility pass about a millisecond in WebKit alone (it runs in a fraction of
that in Chromium), most of it zone culling's arctangents. The roof went back to a flat sheet; the other two were
fixed as described under *The street floor and the shops, modelled*.

What it costs elsewhere: loading to the menu takes 0.8 s longer (10.2 s against 9.3 s; building the district 5.4 s
against 4.6 s, for placing some thousands of pieces and their ray trees); estimated GPU memory 1362 → 1480 MB (+9 %,
all of it geometry: 411 → 528 MB, as each 8 m cell keeps its own vertices). In these runs the fine pieces appeared 11 m
from their cell, which is a visible switch if one watches a shutter while walking up to it (laths and a flat texture
of laths are not the same picture). `R.kitNear2` has been 30 m since, which takes the switch out of sight; drawn from
30 m per 24 m cell, before the range merging and the lighter visibility pass, the same pieces had cost the 0.4–1.4 ms
above. Nothing fine casts a shadow. The
scripted checks (`?selftest=1`) pass as on `main` (64 checks, the one known failure); the layout fingerprint is
identical and the light bake loads as cached. On-screen pacing in play was not measured for this build.

The casonas' pilaster orders and the dressed stone came after those runs: 79,000 more triangles in the district's own
meshes and a fresh light bake (about three minutes in the browser; `?stalegi=1` holds the old one while geometry is
being worked on). One run afterwards, with the switch at 30 m too and not paired against `main`, read within half a millisecond of
this build's earlier runs in every view (−0.34 to +0.48 ms, inside the spread between runs, which a single run cannot
resolve further); estimated GPU memory 1480 → 1485 MB.
The scripted checks and the layout fingerprint are unchanged.

Profiling switches: `?demo=1` auto-plays the match (for pacing runs), `?live=1` writes `captures/live.json` every 3 s,
`?tune={"maxPR":1.25}` overrides any preset field. `?prof=<tag>` times three views whole and again with one part held or
off at a time (cascades not redrawn, no AO, no bloom, no haze, no multisampling, a quarter of the pixels) and saves
`captures/prof_<tag>.json`; `?ab=<tag>` runs the interleaved probe and saves `captures/ab_<tag>.json`; `?batch=0`,
`?life=0` and `?arch=0` switch the batching, the street-life layer and the architecture pass off for A/B runs.

## Tests and captures

In the browser console, with the dev server running:

- `G.selfTest()` — scripted checks through the real systems: movement, kerbs, mantle, fire modes, firing on the run,
  reloads, hit zones, scoring, AI perception, damage, death and respawn, match endings, restart, a 90 s bot-only stretch,
  props shoved and shot, a ragdoll falling to rest and the body staying behind, bot acceleration and stride length,
  planted-sole drift walking, running and strafing, a street corner taken at a run (sideways load, braking, wall
  contact), a kerb stepped up and down without the legs being thrown about, head and shoulders steady at a walk, the
  bot magazine reload, sound arrival delay, wall muffling, and echoes. For the throwables: issue and HUD count, the
  throw by hand with the rifle slung, arc, bounces and the fuze, a hard throw coming back off a wall, a balcony that
  turns a grenade back and holds one dropped onto it, burst damage at
  3 m and 8 m and behind buildings with the score and kill feed, the ragdoll, clutter thrown by the blast, a soldier
  running from a grenade at his feet, an underhand smoke lob that blinds an enemy and then clears, a primed grenade
  dropped at death, and restart. For the map: every hotspot in the market quarter routed from five places in the old
  district and every spawn to every enemy spawn (225 routes), a soldier walking from the market lane through a passage
  into the market hall and back, clutter left by 90 s of fighting not inside any wall, no loose prop starting inside
  anything solid, a chair shoved into walls at four places staying out of them, a soldier dropped onto a balcony with
  a railing and onto one with a parapet standing on it and being stopped at its front and side, and the balcony floor
  and parapet stopping sight while the open railing does not. (One check fails and did before the
  throwables were added, on `main` as well: the empty-magazine reload is sampled 0.13 s before the reload finishes.)
  `?selftest=1` in the URL runs it by itself once loaded and saves the results to `captures/selftest.json`.
  `?nogi=1` skips the indirect light (no bake) for a quick look while the geometry changes; `?stalegi=1` uses the last
  bake even if the map has changed since (nothing is baked or saved).
- `tools/hud-probe.js` — the HUD in each state, staged in a real match and saved with the HUD drawn over the frame:
  a fight in the sun, low ammunition, a reload, a hit, damage, low health, the kill feed after a headshot, a frag in
  the hand, death and the dark market hall (`hp.run(G, 'tag')` -> `captures/hud_<tag>_<view>.jpg`; `{ w, h, scale,
  views }` for other sizes). `G.capture` saves the WebGL canvas alone; `tools/hud-shot.js` lays `#hud` out again at
  the capture size inside an SVG `foreignObject` with the page's own style sheet and draws it on top.
- `src/clipcheck.js` (also `tools/clip-probe.js`) — how far each loose prop sits inside the collision boxes and behind
  the drawn surfaces: `clip.scan(G)` for all of them, `clip.prop(G, item)` for one, `clip.shove(G, { z })` walks a
  soldier's pusher into a chair against a wall.
- `tools/perf-probe.js` — the view timings, draw calls and GPU-memory estimate in the table above (see the top of the file).
- `tools/compare-shots.js` — before/after captures from fixed camera positions (both districts, the alleys, under the
  shade cloths, inside a shop and the hall, close-ups of eaves, a street corner and a doorway) at a fixed clock, so cloud
  shadows match; `python3 tools/compare-montage.py <dirA> <tagA> <dirB> <tagB> <out>` lays two sets side by side and
  prints the difference per view. `?bench=<tag>` in the URL runs the timings, the memory estimate, the load-time phases
  (`G.bootTimes()`) and the captures by itself and saves them to `captures/` (for the native window, where there is no
  console). `?tex=jpg` loads the original JPEGs instead of the KTX2 textures, for comparisons on the dev server.
- `node tools/encode-ktx2.mjs` — re-encodes changed textures to KTX2 (needs `basisu`, Homebrew `basis_universal`).
- `python3 tools/repack-ao.py <texture set>` — rebuilds an ARM map's occlusion channel from its normal map when the
  downloaded one is empty (done for `cobblestone_floor_13`, whose shaded cobbles had come out nearly black).
- `Blender --background --factory-startup --python tools/blender/kit.py -- assets/kit/kit.glb [--preview file.png]` —
  rebuilds the architectural kit (and a contact sheet of its pieces).
- `Blender --background --factory-startup --python tools/blender/arch.py -- assets/kit/arch.glb [--preview dir] [--only a,b]` —
  rebuilds the architecture pass's pieces (about ten seconds; `--only` renders those pieces and exports nothing).
- `Blender --background --factory-startup --python tools/blender/props.py -- assets/kit/props.glb [--preview dir] [--only a,b]` —
  rebuilds the detail pass's pieces (and a render of each into `dir`; `--only` renders those pieces and exports nothing).
  In the page, `(await import('/tools/detail-check.js')).report()` checks every piece against its triangle cap and the
  space the old geometry took, and the Builder's near/far plumbing; `impacts(G, eye, at)` fires rounds at a spot and
  counts impacts that land off what is drawn; `swapCells(G)` checks that each palm and laurel keeps both its versions
  in one cell. `(await import('/tools/layout-fingerprint.js')).fingerprint(G, tag)` saves
  hashes of everything that decides how the map plays; `node tools/compare-fingerprints.mjs A.json B.json` compares two.
- `tools/locomotion-probe.js` — measures how the soldiers move over minutes of play (see the top of the file):
  `probe.patrol(G, 150)` reports acceleration, turn rates, sole drift, wall clearance, stops and wall contacts;
  `probe.posture(G)` how far pelvis, shoulders, head and rifle swing over a stride; `probe.steps(G)` how hard the legs
  are thrown about crossing a kerb; `probe.map`, `probe.sheet` and `probe.film` save a route plot, a contact sheet
  and film frames to `captures/`. For jerks in the legs it looks at frame-to-frame changes in knee bend rate, ankle
  acceleration, boot attitude and pelvis acceleration: `probe.battery(G)` puts one soldier through 22 scripted moves
  (walk, run, arcs, about-face, turning on the spot, side-step, back-pedal, crouch in each, kerbs) and lists every
  jolt with what the foot placement was doing at the time; `probe.matchJolts(G, 120)` counts them per soldier-minute in
  a real match, by kind of movement; `probe.autopsy(G, 60)` returns the frames either side of the worst ones. For legs
  that look broken it reads every leg joint against the rig's bind pose: the knee bending off its hinge or backwards,
  the boot turned, tipped or rolled on the ankle further than an ankle goes, the thigh wrung round in the hip.
  `probe.shapeBattery(G)` gives the peaks over the same 22 moves, `probe.matchShapes(G, 120)` counts the frames past
  the limits in a real match and `probe.clipShape(G)` says what the authored clips themselves reach.
- `await G.proofThrow()` — writes seventeen frames of the two throwables to `captures/throw_frag_*.jpg` and
  `captures/throw_smoke_*.jpg`: in the hand, pin out, release, in flight, the burst or the pop, and what is left.
- `await G.proof()` — writes fourteen fixed-bookmark screenshots at 1920×1080 to `captures/`; `await G.proof(1754, 864)` does
  the same at 2192×1080 (`*_uw.jpg`).
- `G.bench()` — the GPU frame-time benchmark above. `G.report()` — the on-screen pacing, audio-level and input snapshot.
- `node tools/audio-report.mjs` — renders the sound library outside the browser, writes WAV files to `captures/audio/` for
  listening, and prints length, level, spectral centroid, band balance, attack and decay for each sound.
- `tools/death-probe.js` (load it in the page) — plays a scripted kill (`kill`: shot from any distance at head, body or limb;
  `overheard`: behind a wall; `selfKill`: the player) with the real ragdoll, records every audio call, and renders what the
  player hears through a second copy of the audio engine on an `OfflineAudioContext` to a WAV in `captures/` (HRTF, delays,
  occlusion, reflections, reverbs, ducking and the master chain all included). `G.audio.stats().played` counts every sound
  started, so `G.report()` shows which ones a live session actually used.
- `node tools/reload-probe.mjs` — renders the modelled reload outside the browser: a reload with rounds left and an
  empty one laid out at the moments `weapon.js` plays them, and every take back to back, as WAVs with spectrograms in
  `captures/audio/`; prints the bake time and, per sound, its level, band balance and where its click falls.
- `python3 tools/build-voices.py` — downloads the recorded voice and body-fall packs listed in `ASSETS.md` and rebuilds
  `assets/audio/voices.wav` and `voices.json` (needs ffmpeg, bsdtar and numpy).

Sound was tuned from those measurements and has not been listened to by a person. Played live on screen, the mix peaked at
−2.1 dBFS with an RMS of −14.5 to −16.6 dB and no clipped samples; echo delays read 34–72 ms in the main street and 16–42 ms
in the alley. Audio-thread load could not be measured (neither browser used exposes it).

The current build was played live through the native window with real mouse and keyboard events: deploy, walk, turn, fire,
fire while sprinting, reload, walking into a chair and knocking it over, pause and resume, with fallen soldiers and their
rifles left on the street by the fighting (`captures/live_ragdolls_and_props.jpg`). Creating a ragdoll costs 0.3–1.4 ms and
leaving a body behind 1.5–3 ms, so neither shows up as a hitch. No kill was scored by hand (aiming through scripted cursor
moves is too coarse); kills, ragdolls and bullet-struck props are covered by the scripted checks and seen on screen from the
bots' fighting. Never exercised by live input: holding right mouse to aim (covered by the scripted checks) and aiming with
the pointer locked.

The market-quarter build was played live in the embedded browser window instead (the native window could not be driven
that time): one full match against the bots (lost 20–30) and parts of two more, the last on the production build in
`dist/`. Keys and mouse moves were sent as events through the game's own input handlers, clicks and the cursor were real.
A white chair was pushed along the house wall and then square into it: it stopped at the wall (0 cm into the wall box,
3 mm into the paving, as at rest); another was bowled over into the street. Then on through the south passage, the
covered lane, Calle Sur, the plazuela, the market hall, the chapel atrium and back through the north passage, dying and
respawning in both districts. Screenshots are in `captures/playtest/`. That window refuses pointer lock, so the view
follows the cursor and a turn is limited to one sweep across the window (pause and resume to go further); no kill was
scored by hand.

## Layout

```
index.html            page, HUD and menu markup/styles, import map
src/main.js           boot, settings, match rules, frame loop, test hooks
src/render.js         renderer, sky analysis, sun + cascades, clouds, exposure meter, post stack, presets
src/gi.js             irradiance-volume bake, cache and upload
src/atmos.js          sunlit haze and light shafts (post pass), dust motes, the frame kept for reflections
src/batch.js          one multi-draw per material: the district's cells drawn together, culled per cell
src/streetlife.js     ground and wall decals, wet ground with reflections, meters, roof tanks and aerials
src/archdetail.js     the architecture pass: shutters, gates, grilles, doors, base courses, shop interiors, hall ironwork, awning frames
src/materials.js      PBR library, weathering / ground-blend / cloth shader patches
src/builder.js        static geometry + prop + collider accumulator
src/world.js          ground, buildings, facade bands and surrounds, arch, sidewalks, nav grid, spawns, culling zones
src/quarter.js        the market quarter: streets, passages, market hall, plazuela and kiosk, chapel, spawns, hotspots
src/mexico.js         procedural sign atlas, papel picado, talavera, tarps, leaves and bougainvillea textures
src/dressing.js       cover, stalls, cloth, papel picado, plants, cables, rooftop clutter, litter
src/clipcheck.js      prop-inside-wall measurement (self-test and tools/clip-probe.js)
src/weapon.js         carbine, optic, hands, view-model animation
src/sdf.js            distance-field modelling + marching cubes (gloves)
src/player.js         input, movement, camera, health, hitscan
src/bots.js           soldier movement, perception, decisions, fire
src/soldier-gait.js   directional gait keyframes and blend
src/bot-rifle.js      low-ready, aim and hand placement on the bot rifle
src/physics.js        box collision, rays, navigation grid + A* with wall clearance and lanes
src/rigid.js          rigid-body world: loose props, pushing, bullets, ragdolls, dropped rifles, corpses
src/fx.js             particles, decals, tracers, casings, blast sparks and debris
src/blood.js          blood: mist and drops at a wound, stains on walls and ground, trails, pools, the lens
src/muzzleflash.js    the muzzle flash: a seeded flame shader on three cards, and the pool the bots' rifles share
src/throwables.js     grenade and smoke canister: models, hands, throw, fuzes, burst, damage, fragments
src/smoke.js          lit smoke / dust / fire volumes, the smoke-screen simulation, sight through smoke
src/sounds.js         modelled sound library (pure JS, computed at boot)
src/saltline-rifle.js the rifle and its tails, ported from Saltline
src/reload-foley.js   the reload, modelled part by part, and when each of its sounds plays
src/audio.js          audio engine: propagation, occlusion, reflections, reverbs, mix
src/hud.js            HUD and menus
src/selftest.js       scripted checks and capture set
tools/                asset downloader, static server, native window (tools/shell), audio-report.mjs, reload-probe.mjs, death-probe.js, build-voices.py,
                      locomotion-probe.js, perf-probe.js, clip-probe.js, compare-shots.js, compare-montage.py, encode-ktx2.mjs, hud-probe.js, hud-shot.js,
                      blender/kit.py (the architectural kit), blender/props.py (the detail pass), blender/arch.py (the architecture pass), detail-check.js,
                      layout-fingerprint.js, compare-fingerprints.mjs
assets/kit/kit.glb    the architectural kit, modelled by tools/blender/kit.py
assets/kit/props.glb  the detail pass's pieces, modelled by tools/blender/props.py
assets/kit/arch.glb   the architecture pass's pieces, modelled by tools/blender/arch.py
assets/audio/         recorded voices of dying soldiers and body thuds, built by tools/build-voices.py
```

Assets and licences are listed in `ASSETS.md`.
