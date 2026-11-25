# The civilian cast

`people.json` lists the people of the district: for each, a name, a voice, a temperament (how brave, curious, sociable
and composed they are, and their walking pace), the kind of shoe they wear (for footfalls), and under `ara` exactly
what Ara 3D Gen was asked for. `clips` names the export that carries the animation library.

## Making the exports

The people are generated with the Ara 3D Gen MCP server (`create_character`), one call a person, with
`formats: ["glb"]` and `out_dir: build/ara` (ignored by git: a raw export is 7 to 30 MB):

```
create_character {
  character: { kind: "ara-character", version: 1, params: <ara.params> },
  height_cm: <ara.height_cm>, carry: <ara.carry>, detail: "medium",
  animations: [], formats: ["glb"], name: <id>, out_dir: "build/ara"
}
```

Every person uses the `game` rig (Mixamo bone names) with `faceBones` (jaw and both eyes), `faceShapes` (20 expression
shapes) and `speechShapes` (14 visemes), a T rest pose and no clips of their own.

The clips come from one more export, `civ_ref` (any body: the game refits them): the same call at `detail: "low"`,
`carry: "phone"` (the phone's place in the hand comes from the texting and phone-call clips), with `animations` set to

```
idle crouch walk walk_slouch model_walk run walk_back strafe_left strafe_right hit stumble_recover dodge_left
dodge_right fall hit_front hit_back hit_left hit_right knockdown get_up_face_up get_up_face_down death_forward
death_backward shot_leg shot_arm shot_chest shot_stomach pick_up use_press handshake talk_gestures talk phone_call
texting take_picture lean_wall look_around wave cheer laugh laugh_hard cry clap point thumbs_up sit_down sit_idle
stand_up turn_left_45 turn_left_90 turn_right_45 turn_right_90 block take_cover cover_idle rifle_crouch_walk lie_down
jump_land
```

## Packing

```
python3 tools/build-civilians.py            # everything (textures already encoded are kept)
python3 tools/build-civilians.py --only f03,m07
```

writes `assets/civilians/` (see the top of that script for what is in it). It needs numpy, Pillow, `basisu` and node.

## Looking at them

`tools/civ-probe.js`, loaded in the running game, stages people in front of a free camera and saves captures:
every expression of a face (`faces`), clips and poses (`stage` + `shot`), and the live simulation (`peace`, `run`,
`states`, `watch`).

## What Ara gives, and what is made here

From Ara: bodies, faces, hair, clothes, skin and garment textures, the skeleton with jaw and eye bones, the 34 face
shapes, and every clip listed above.

Not in Ara's library, so made in the game (`src/civ-anim.js`, `ARM_POSES`) as arm attitudes blended over Ara's
clips rather than motion capture: hands raised, hands over the head while crouched, a guard against a blast, a hand
pressed to a wound, palms out pleading. Foot planting, ground following, the look (spine, neck, head, eyes), breathing,
trembling and the expression blending (`src/civ-face.js`) are procedural as well.
