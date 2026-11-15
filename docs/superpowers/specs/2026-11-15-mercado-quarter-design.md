# Barrio del Mercado: map expansion and Mexican market-town restyle

Date: 2026-11-15 · Branch: `feature/mercado-map-upgrade`

## Intent

The user asked for two things: fix a white plastic chair that sinks into walls, and grow the Market District map while
moving its look towards the sun-baked Mexican market town of *Mercado Las Almas* (Call of Duty: Modern Warfare II).
Gameplay, bot AI, animation and existing features must keep working; navigation must cover old and new areas; frame
rate must not drop badly; everything is verified by tests, measurements and play from the player's view.

The map stays an original design. The style comes from real places, not from the game's level: the iron-and-glass
Mercado Hidalgo in Guanajuato (arched hall, brick and pink-stone portal, a canopy of papel picado inside), Oaxaca and
Guanajuato streets (saturated lime-washed walls with a darker painted base band, white or stone window surrounds,
wrought-iron lanterns, flat roofs with parapets, black water tanks and rebar on the roofs, river-stone paving), and
street markets (tarps, umbrellas, plastic chairs, hand-painted shop signs). No layout, signage, art or names are copied
from the game.

## Goals

1. **Chair clipping fixed at the root** (done first): loose props are never crushed into walls, never dressed into
   solid things, and rest against what is drawn, with self-test checks that failed before the fix.
2. **A new quarter east of the market lane** (x 46…111, z −80…80), joined to the old district through four passages
   in the east ring that continue the two cross streets (z ±20) and the two spawn streets (z ±60):
   - *Calle del Mercado* along the ring, river-stone streets, an inner street on the east side;
   - a **covered market hall** (≈30 × 26 m): brick-and-stone portal, steel columns and trusses, a raised clerestory
     nave with skylights, terracotta tile floor, rows of stalls, a papel picado canopy;
   - a **chapel** with a bell gable and a tiled dome, facing a walled **atrium** with trees;
   - a **plazuela** with a kiosk, umbrellas and food stalls; residential and shop blocks with walk-in-free facades.
3. **Restyle of the old district** without moving anything that tests or bots rely on: Mexican wall palette, painted
   base bands, painted window surrounds, hand-painted signs, papel picado across streets, tarps over the market lane,
   rebar and water tanks on roofs.
4. **Navigation**: one grid over both areas, A* sized for it, hotspots and spawn points in the new quarter, a test
   that bots walk from the old district into the hall and back.
5. **Performance**: measured before and after (GPU frame time per fixed view, draw calls, triangles, estimated GPU
   memory); detail culling, geometry budgets and texture memory reduced where the numbers call for it.

## Non-goals

- Interiors for every building (only the hall, plus the existing walk-in shops).
- New weapons, modes or bot behaviours; bots still do not throw.
- A recreation of the game's map (layout, landmarks, signs, names, art).

## Constraints

- The old district is generated from one seeded random stream. Everything new uses a second stream, and ring buildings
  that the passages replace are generated and then muted, so the old district's dressing, cover and props stay where
  the self-test and the bot tuning expect them.
- The GI bake grid, navigation grid, rigid-body ground and draw cells grow to cover x up to 111.
- All new textures are CC0 (Poly Haven) or drawn procedurally at boot; all geometry is procedural.

## Approaches considered

| Approach | Trade-off | Verdict |
| --- | --- | --- |
| Rebuild the whole district with a new seed and layout | Freshest look, but every test position, cover spot and bot tuning moves | Rejected: breaks "keep gameplay/AI working" |
| **Add a quarter beside the old district, restyle the old one in place** | Old layout and tests stay valid; ring passages need care to keep the random stream intact | **Chosen** |
| Expand by scaling the existing streets | Cheap, but no new architecture and longer sightlines | Rejected: does not deliver new geometry or the market hall |

## The chair fix (implemented)

Root causes, each reproduced before fixing: (1) the capsule that lets walkers shove clutter was kinematic, so a chair
between a soldier and a wall was crushed 26–33 cm into the wall; (2) drawn details near the ground (plinths, sills,
stall posts, sacks, rubble, shop fronts, a raised shop floor) had no physical counterpart; (3) dressing placed props
overlapping sandbags, pallets, counters and each other. Fix: a finite-mass pusher with a capped push force, rigid-only
detail solids generated from every drawn box the movement boxes do not cover, a placement pass that shoves props
clear (or drops them), CCD on props, a collider for raised shop floors, and centred tyre stacks.

## What is left to the builder

Exact building counts, dressing density and colours are tuned by eye against screenshots and the frame budget.
