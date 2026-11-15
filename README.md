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
  pixels only; 4× MSAA; restrained turn blur, vignette, grain.
- **Bounce lighting** — a baked irradiance volume (93 × 8 × 161 probes at 1 m spacing, first-order spherical harmonics,
  ray-traced against the real geometry with sky occlusion, sun bounce and two further bounces, light through cloth). Shade,
  alleys, the covered lane and shop interiors are lit by what they can actually see rather than by an unoccluded sky.
  The physically correct result leaves alleys at a tenth of the open-sky light and rooms at a fiftieth, so the shader
  range-compresses it (`uGiLift` in `src/render.js`: exponent and floor): shade stays shade, but nowhere is too dark to read.
- **Exposure and sky** — exposure is metered from the rendered frame (log-average luminance) and adapts quickly into light,
  slowly into dark; the HDRI clouds drift with a flow map, and soft cloud shadows slide across the district.
- **World** — a ~90 × 160 m district generated from a fixed seed: main street with a long sightline, a narrow alley with laundry
  lines, a covered market lane with stalls and translucent shade cloths, a plaza with a fountain, palms and a monumental arch,
  walk-in shops, an exterior stair to a low rooftop. Buildings have real window and door depth, shutters, bars, balconies,
  parapets, pipes, cables and rooftop clutter. Surfaces are scanned PBR texture sets with world-space weathering on top;
  props are scanned models simplified at load.
- **Weapon** — a procedurally modelled M4-pattern carbine with a tube red dot (the reticle is collimated in the shader, so it
  stays on the bore line as the view moves) and a weapon light with tape switch; finish with micro-normal grain, edge wear
  driven by surface curvature, and light dust on upward faces. Gloved hands are modelled as smooth distance-field surfaces
  with knuckle guards, cuff straps and stitched seams; the support-hand grip is solved so each finger joint rests on the
  handguard. ADS, semi/auto, recoil pattern, inspect, wall lowering, muzzle flash and light, casings, tracers, per-surface
  impacts and decals, light penetration and ricochets. Reloads bring the rifle up, the hand strips and seats the magazine,
  and the bolt closes as the support hand returns after an empty reload.
- **Bots** — rigged soldiers with separate low-ready and shouldered rifle poses, a support hand that follows the weapon,
  and a visible magazine extraction and insertion. They navigate with A* on a 1 m grid, see only inside a field
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
  The collision boxes only cover house blocks, kerbs, steps and cover, so a thrown object also feels ahead along its
  path and beneath itself through the triangles that are actually drawn (the same trees the bullets use, plus the
  cloth a bullet passes through): it comes back off a balcony front, can land on a balcony and lie there, slides down
  an awning and drops off its edge, and gets between railing bars only as often as a 6 cm ball would (about half the
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
- **Physics** — a rigid-body world (Rapier) built from the district's collision boxes. 160-odd pieces of loose clutter
  (chairs, crates, cans, bins, tyres, pots, baskets, gas bottles, hand trucks…) rest as dressed until disturbed, then can be
  shoved by walking into them and knocked about by bullets, with material-dependent mass, friction and bounce; light
  materials let a round through, dense ones stop it. Heavy cover (barriers, steel drums, sandbags) stays fixed so cover
  stays cover.
- **Ragdolls** — a kill hands the soldier to eleven jointed bodies built from the pose at that instant: hinged knees and
  elbows with anatomical limits, limited ball joints with a little muscle tone elsewhere, a shove from the round that
  killed. The rifle drops as its own body. Bodies react to further hits, and when the soldier respawns the body and rifle
  are left behind as a static mesh (the six most recent).
- **Audio** — every sound is modelled, not recorded: 59 sounds in 172 takes are computed at boot from physical ingredients
  (blast pulse, filtered turbulence, modal ringing, grain scatter) — rifle from behind the sights, the same rifle at middle
  and long range, supersonic cracks, ricochets, strikes on eight materials, boots on six surfaces, rifle handling, brass,
  eleven prop materials, body falls, pin and lever, grenade and canister knocks, bursts at three ranges, falling debris,
  the canister's pop and hiss. The engine then places them: speed-of-sound delay, air absorption, muffling by walls
  (three rays, so partly hidden sources still come over and around), HRTF panning, six early reflections whose delays, levels
  and directions are traced from the walls actually around you, three reverberant spaces (street, narrow passage, room)
  crossfaded by the same rays, hearing that dips for a moment after each of your own shots, humming air-conditioning units
  where they hang, birds, awnings, cicadas and distant fighting.
- **HUD** — a blue circle identifies a visible ally and a red diamond identifies a visible enemy within 45 m. Aim at
  a soldier to see **Ally** or **Enemy**. The minimap, scoreboard and kill feed use the same colors. The HUD also shows
  the compass, clock, health, ammo, hit confirmation, damage direction and elimination banners.

## Left out on purpose

A key-rebinding screen, heat shimmer, and a recorded gameplay clip. No reference video was supplied, so nothing
was matched against one. Bots do not throw grenades or smoke.

## Quality presets

`low` · `medium` · `high` (default) · `ultra`, from the menu or `?q=ultra` in the URL. They change internal resolution,
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

Profiling switches: `?demo=1` auto-plays the match (for pacing runs), `?live=1` writes `captures/live.json` every 3 s,
`?tune={"maxPR":1.25}` overrides any preset field.

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
  dropped at death, and restart. (One check fails and did before the throwables were added: the empty-magazine reload
  is sampled 0.13 s before the reload finishes.)
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

## Layout

```
index.html            page, HUD and menu markup/styles, import map
src/main.js           boot, settings, match rules, frame loop, test hooks
src/render.js         renderer, sky analysis, sun + cascades, clouds, exposure meter, post stack, presets
src/gi.js             irradiance-volume bake, cache and upload
src/materials.js      PBR library, weathering / ground-blend / cloth shader patches
src/builder.js        static geometry + prop + collider accumulator
src/world.js          ground, buildings, arch, sidewalks, nav grid, spawns
src/dressing.js       cover, stalls, cloth, palms, cables, rooftop clutter, litter
src/weapon.js         carbine, optic, hands, view-model animation
src/sdf.js            distance-field modelling + marching cubes (gloves)
src/player.js         input, movement, camera, health, hitscan
src/bots.js           soldier movement, perception, decisions, fire
src/soldier-gait.js   directional gait keyframes and blend
src/bot-rifle.js      low-ready, aim and hand placement on the bot rifle
src/physics.js        box collision, rays, navigation grid + A* with wall clearance and lanes
src/rigid.js          rigid-body world: loose props, pushing, bullets, ragdolls, dropped rifles, corpses
src/fx.js             particles, decals, tracers, casings, blast sparks and debris
src/throwables.js     grenade and smoke canister: models, hands, throw, fuzes, burst, damage, fragments
src/smoke.js          lit smoke / dust / fire volumes, the smoke-screen simulation, sight through smoke
src/sounds.js         modelled sound library (pure JS, computed at boot)
src/audio.js          audio engine: propagation, occlusion, reflections, reverbs, mix
src/hud.js            HUD and menus
src/selftest.js       scripted checks and capture set
tools/                asset downloader, static server, native window (tools/shell), audio-report.mjs, locomotion-probe.js
```

Assets and licences are listed in `ASSETS.md`.
