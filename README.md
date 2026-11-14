# Market District

A compact tactical FPS slice in three.js: one sunlit market-district map, one carbine, 4 v 4 team deathmatch against bots.
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
| Pause | `Esc` |
| Frame-stats overlay / write a session report | `F3` / `F4` |

The menu has sensitivity, FOV, ADS sensitivity, invert-Y, quality preset, difficulty, and toggles for motion blur, camera shake,
vignette, grain, chromatic fringe and view bob. Settings persist in `localStorage`.
Key bindings live in the same saved settings object (`binds`); there is no rebinding screen.

## What is in it

- **Rendering** — HDR pipeline with ACES tone mapping; a 4k HDRI sky; the sun is located in the HDRI, removed from it, and
  replaced by a directional light with cascaded soft shadows; screen-space ambient occlusion (GTAO); bloom on genuinely bright
  pixels only; 4× MSAA; restrained turn blur, vignette, grain.
- **Bounce lighting** — a baked irradiance volume (93 × 8 × 161 probes at 1 m spacing, first-order spherical harmonics,
  ray-traced against the real geometry with sky occlusion, sun bounce and two further bounces, light through cloth). Shade,
  alleys, the covered lane and shop interiors are lit by what they can actually see rather than by an unoccluded sky.
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
  and an empty reload ends with a thumb on the bolt release.
- **Bots** — rigged soldiers that shoulder the rifle with two-bone IK, navigate with A* on a 1 m grid, see only inside a field
  of view (which follows where the head is turned) with line of sight and a detection delay, react to gunfire and footsteps
  with an uncertain position, share sightings after a delay, use cover and peek, fire in bursts, reload, search after losing
  contact, and respawn out of sight.
- **How they move** — soldiers slow into turns and steer around nearby bodies before contact. Ground speed drives the
  walk/run blend, with planted feet on level ground and individual foot heights on kerbs and stairs. The legs follow
  the direction of travel on strafes and retreats while the upper body keeps aim. When the barrel approaches a wall,
  the soldier tucks the rifle closer to the chest.
- **Physics** — a rigid-body world (Rapier) built from the district's collision boxes. 160-odd pieces of loose clutter
  (chairs, crates, cans, bins, tyres, pots, baskets, gas bottles, hand trucks…) rest as dressed until disturbed, then can be
  shoved by walking into them and knocked about by bullets, with material-dependent mass, friction and bounce; light
  materials let a round through, dense ones stop it. Heavy cover (barriers, steel drums, sandbags) stays fixed so cover
  stays cover.
- **Ragdolls** — a kill hands the soldier to eleven jointed bodies built from the pose at that instant: hinged knees and
  elbows with anatomical limits, limited ball joints with a little muscle tone elsewhere, a shove from the round that
  killed. The rifle drops as its own body. Bodies react to further hits, and when the soldier respawns the body and rifle
  are left behind as a static mesh (the six most recent).
- **Audio** — every sound is modelled, not recorded: 46 sounds in 134 takes are computed at boot from physical ingredients
  (blast pulse, filtered turbulence, modal ringing, grain scatter) — rifle from behind the sights, the same rifle at middle
  and long range, supersonic cracks, ricochets, strikes on eight materials, boots on six surfaces, rifle handling, brass,
  eleven prop materials, body falls. The engine then places them: speed-of-sound delay, air absorption, muffling by walls
  (three rays, so partly hidden sources still come over and around), HRTF panning, six early reflections whose delays, levels
  and directions are traced from the walls actually around you, three reverberant spaces (street, narrow passage, room)
  crossfaded by the same rays, hearing that dips for a moment after each of your own shots, humming air-conditioning units
  where they hang, birds, awnings, cicadas and distant fighting.
- **HUD** — a blue circle identifies a visible ally and a red diamond identifies a visible enemy within 45 m. Aim at
  a soldier to see **Ally** or **Enemy**. The minimap, scoreboard and kill feed use the same colors. The HUD also shows
  the compass, clock, health, ammo, hit confirmation, damage direction and elimination banners.

## Left out on purpose

Throwables, a key-rebinding screen, heat shimmer, and a recorded gameplay clip. No reference video was supplied, so nothing
was matched against one.

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

- `G.selfTest()` — 35 scripted checks through the real systems: movement, kerbs, mantle, fire modes, firing on the run,
  reloads, hit zones, scoring, AI perception, damage, death and respawn, match endings, restart, a 90 s bot-only stretch,
  props shoved and shot, a ragdoll falling to rest and the body staying behind, bot stride length and acceleration, torso
  twist and back-pedalling, sound arrival delay, wall muffling, and echo delays that tighten from street to alley.
  Last run: 35/35 on High and on Low.
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
src/bots.js           soldier rig, IK, perception, decisions, fire
src/physics.js        box collision, rays, navigation grid + A*
src/rigid.js          rigid-body world: loose props, pushing, bullets, ragdolls, dropped rifles, corpses
src/fx.js             particles, decals, tracers, casings
src/sounds.js         modelled sound library (pure JS, computed at boot)
src/audio.js          audio engine: propagation, occlusion, reflections, reverbs, mix
src/hud.js            HUD and menus
src/selftest.js       scripted checks and capture set
tools/                asset downloader, static server, native window (tools/shell), audio-report.mjs
```

Assets and licences are listed in `ASSETS.md`.
