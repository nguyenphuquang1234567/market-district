# Architectural kit for Market District, modelled procedurally in Blender and exported as one GLB (assets/kit/kit.glb).
#   /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/kit.py -- \
#       assets/kit/kit.glb [--preview captures/kit_preview.png]
#
# Every piece is built from real geometry (profiles swept and mitred, bevels, boolean cuts), not texture. Conventions,
# in Blender's axes (the glTF export turns them into three.js axes, given in brackets):
#   x = along the wall (three X), z = up (three Y), -y = out of the wall towards the street (three +Z).
#   The wall face is the plane y = 0; a piece reaches a few centimetres into the wall (+y) so no seam shows.
# Material slots are named for what they stand in for; the game maps them to its own materials per building:
#   trim (stone or painted plaster mouldings), wall (the building's plaster), brick, tile, mortar, wood, iron.
# Swept mouldings are one metre long and are stretched along x to fit; their texture coordinates are projected in world
# space by the game, so stretching never shows. Pieces that must not be stretched (corners, tiles, doors) are not.
import bpy, bmesh, math, random, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith('--') else 'assets/kit/kit.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
rnd = random.Random(20261115)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

MATS = {}
def mat(name, rgb):
    m = bpy.data.materials.new(name); m.diffuse_color = (*rgb, 1.0); MATS[name] = m; return m
TRIM, WALL, BRICK = mat('trim', (0.86, 0.80, 0.70)), mat('wall', (0.92, 0.86, 0.74)), mat('brick', (0.62, 0.32, 0.22))
TILE, MORTAR, WOOD, IRON = mat('tile', (0.74, 0.36, 0.20)), mat('mortar', (0.84, 0.82, 0.77)), mat('wood', (0.42, 0.29, 0.19)), mat('iron', (0.08, 0.08, 0.08))

# ---------------------------------------------------------------------------------------------------- helpers --------
def to_obj(name, bm, *materials):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in materials: me.materials.append(m)
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob); return ob

def only(ob):
    for o in bpy.context.selected_objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob

def apply(ob):
    only(ob)
    for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)

def bevel(ob, width, segs=2, angle=32):
    m = ob.modifiers.new('bevel', 'BEVEL'); m.width = width; m.segments = segs; m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle); m.use_clamp_overlap = True; m.harden_normals = True
    apply(ob); return ob

def cut(ob, cutter, op='DIFFERENCE'):
    m = ob.modifiers.new('bool', 'BOOLEAN'); m.operation = op; m.object = cutter; m.solver = 'EXACT'
    try: m.material_mode = 'TRANSFER'                     # faces cut by the cutter take its material (exposed brick)
    except Exception: pass
    apply(ob); bpy.data.objects.remove(cutter, do_unlink=True); return ob

def smooth(ob, angle=34):
    only(ob); bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle), keep_sharp_edges=True); return ob

def join(name, obs):
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]; bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = name; ob.data.name = name; return ob

def box(name, x0, x1, y0, y1, z0, z1, material):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
    return to_obj(name, bm, material)

def poly(bm, verts):
    try: return bm.faces.new(verts)
    except ValueError: return None

def sweep(name, prof, length, material, caps=True):
    """A closed profile [(y, z)] swept straight along x over [-length/2, length/2]."""
    bm = bmesh.new(); n = len(prof)
    A = [bm.verts.new((-length / 2, y, z)) for y, z in prof]; B = [bm.verts.new((length / 2, y, z)) for y, z in prof]
    for i in range(n): j = (i + 1) % n; poly(bm, (A[i], A[j], B[j], B[i]))
    if caps: poly(bm, A[::-1]); poly(bm, B)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_obj(name, bm, material)

def mitre(name, prof, P, material):
    """The same profile turning an outside corner: along facade A (wall y = 0, out -y) up to the corner at x = 0, then
    along facade B (wall x = 0, out +x) away from it (+y). Each arm is P long; the two meet on the 45 degree mitre."""
    bm = bmesh.new(); n = len(prof)
    A = [bm.verts.new((-P, y, z)) for y, z in prof]
    M = [bm.verts.new((-y, y, z)) for y, z in prof]
    C = [bm.verts.new((-y, P, z)) for y, z in prof]
    for i in range(n):
        j = (i + 1) % n; poly(bm, (A[i], A[j], M[j], M[i])); poly(bm, (M[i], M[j], C[j], C[i]))
    poly(bm, A[::-1]); poly(bm, C)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_obj(name, bm, material)

def arc(cy, cz, r, a0, a1, n):
    return [(cy + r * math.cos(a0 + (a1 - a0) * k / n), cz + r * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]

def ogee(y0, z0, y1, z1, n=6):
    """Cyma recta from (y0, z0) to (y1, z1): vertical tangents at both ends, hollow below, round above."""
    return [(y0 + (y1 - y0) * (0.5 - 0.5 * math.cos(math.pi * k / n)), z0 + (z1 - z0) * k / n) for k in range(n + 1)]

def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

pieces = []
def keep(ob, *, sm=34):
    smooth(ob, sm); pieces.append(ob); return ob

# ---------------------------------------------------------------------------------------------------- pieces ---------
# Window sill (alfeizar): washed top, rounded nose, a drip groove underneath. Top at z = 0 (the opening's bottom); it
# runs 13 cm back into the reveal and stands 9 cm proud of the wall.
SILL = [(0.13, 0.0), (0.0, -0.002), (-0.074, -0.011), (-0.084, -0.016), (-0.089, -0.026), (-0.089, -0.056), (-0.085, -0.065),
        (-0.076, -0.071), (-0.064, -0.072), (-0.064, -0.063), (-0.055, -0.063), (-0.055, -0.072), (0.13, -0.072)]
keep(bevel(sweep('sill', SILL, 1.0, TRIM), 0.003, 1, 40))
keep(box('sill_lod1', -0.5, 0.5, -0.089, 0.13, -0.072, 0.0, TRIM), sm=10)

# Moulded surround (marco) bar: across = z from the opening's edge (0) outwards (0.15); depth = -y. A bead at the
# opening, a flat fascia, a cavetto down to the wall. Bars run along x; corner blocks (below) take the corners.
BAR = [(0.012, 0.0), (-0.026, 0.0), (-0.031, 0.003)] + arc(-0.033, 0.017, 0.013, math.pi * 1.5, math.pi * 0.5, 4)[1:] + \
      [(-0.035, 0.036), (-0.035, 0.108), (-0.031, 0.114)] + arc(-0.031, 0.126, 0.012, -math.pi / 2, 0.0, 2)[1:] + \
      [(-0.019, 0.137), (-0.017, 0.15), (0.012, 0.15)]
keep(sweep('frame_bar', BAR, 1.0, TRIM), sm=40)
# Corner block (with a sunk panel and a boss), standing a little prouder than the bars.
cb = box('frame_corner', -0.075, 0.075, -0.052, 0.012, 0.0, 0.15, TRIM); bevel(cb, 0.006, 1, 30)
panel = box('_p', -0.047, 0.047, -0.07, -0.043, 0.028, 0.122, TRIM); bevel(panel, 0.006, 1, 30); cut(cb, panel)
boss = bpy.data.objects.new('_boss', bpy.data.meshes.new('_boss')); bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=4, radius=0.024); bm.to_mesh(boss.data); bm.free(); scene.collection.objects.link(boss)
boss.data.materials.append(TRIM); boss.location = (0, -0.044, 0.075); boss.scale = (1, 0.45, 1); apply(boss)
only(boss); bpy.ops.object.transform_apply(location=True, scale=True)
keep(join('frame_corner', [cb, boss]), sm=40)

# Keystone (clave): a tapered stone over a door's head, proud of the surround, with a sunk edge line.
bm = bmesh.new(); hw0, hw1, h, d = 0.075, 0.115, 0.30, 0.075
vs = [bm.verts.new(p) for p in [(-hw0, 0.012, -0.05), (hw0, 0.012, -0.05), (hw1, 0.012, h - 0.05), (-hw1, 0.012, h - 0.05),
                                  (-hw0, -d, -0.05), (hw0, -d, -0.05), (hw1, -d, h - 0.05), (-hw1, -d, h - 0.05)]]
for f in [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]: poly(bm, [vs[i] for i in f])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); ks = to_obj('keystone', bm, TRIM); bevel(ks, 0.01, 2, 30)
groove = box('_g', -0.06, 0.06, -0.09, -0.068, 0.0, 0.2, TRIM); cut(ks, groove)
keep(ks, sm=40)

# Main cornice (cornisa) at the roofline: fillet, cavetto, corona with a drip, cyma recta, top fillet, a washed top.
# Bottom at z = 0, 0.36 tall, 0.25 proud.
COR = [(0.03, 0.0), (-0.025, 0.0), (-0.025, 0.018)] + arc(-0.105, 0.018, 0.08, 0.0, math.pi / 2, 6)[1:] + \
      [(-0.125, 0.098), (-0.125, 0.112), (-0.135, 0.112), (-0.135, 0.205), (-0.142, 0.21)] + ogee(-0.142, 0.21, -0.232, 0.302, 7)[1:] + \
      [(-0.252, 0.302), (-0.252, 0.34), (-0.24, 0.348), (0.03, 0.365)]
keep(bevel(sweep('cornice', COR, 1.0, TRIM), 0.003, 1, 45))
keep(bevel(mitre('cornice_corner', COR, 0.32, TRIM), 0.003, 1, 45))
# String course (imposta) between floors: an ovolo under a flat band and a small cavetto above. Centred on z = 0.
STR = [(0.03, -0.085), (-0.012, -0.085)] + arc(-0.012, -0.05, 0.035, -math.pi / 2, -math.pi, 4)[1:] + \
      [(-0.06, -0.05), (-0.06, 0.045), (-0.054, 0.052)] + arc(-0.054, 0.088, 0.036, -math.pi / 2, 0.0, 4)[1:] + [(0.03, 0.088)]
keep(bevel(sweep('string', STR, 1.0, TRIM), 0.002, 1, 45))
keep(bevel(mitre('string_corner', STR, 0.12, TRIM), 0.002, 1, 45))
# Parapet coping (remate): crowned, overhanging both faces with drips. Centred on the parapet (y = 0), bottom at z = 0.
COP = [(-0.17, 0.0), (-0.17, 0.05), (-0.16, 0.062), (0.0, 0.085), (0.16, 0.062), (0.17, 0.05), (0.17, 0.0), (0.155, 0.0), (0.155, 0.008),
       (0.145, 0.008), (0.145, 0.0), (-0.145, 0.0), (-0.145, 0.008), (-0.155, 0.008), (-0.155, 0.0)]
keep(bevel(sweep('coping', COP, 1.0, TRIM), 0.003, 1, 40))

# Corbel (mensula) under a balcony slab: a cyma reversa bracket 14 cm wide, top at z = 0 (the slab's underside).
CB = [(0.03, 0.0), (-0.36, 0.0), (-0.36, -0.035)] + [(-0.36 + 0.28 * (0.5 - 0.5 * math.cos(math.pi * k / 6)), -0.035 - 0.29 * k / 6) for k in range(1, 7)] + \
     [(-0.065, -0.345), (-0.055, -0.36), (0.03, -0.36)]
c = sweep('_c', CB, 1.0, TRIM); c.scale = (0.14, 1, 1); apply(c); only(c); bpy.ops.object.transform_apply(scale=True)
c.name = c.data.name = 'corbel'; keep(bevel(c, 0.006, 1, 30))

# Wooden rafter (viga) for a tile canopy: 8 x 11 cm, out from the wall along -y to y = -1 (stretched to fit), its end
# cut back underneath in a curve.
rf = box('rafter', -0.04, 0.04, -1.0, 0.04, -0.11, 0.0, WOOD)
cyl = bpy.data.objects.new('_cy', bpy.data.meshes.new('_cy')); bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.09, radius2=0.09, depth=0.2); bm.to_mesh(cyl.data); bm.free(); scene.collection.objects.link(cyl)
cyl.rotation_euler = (0, math.pi / 2, 0); cyl.location = (0, -1.0, -0.15); apply(cyl); only(cyl); bpy.ops.object.transform_apply(location=True, rotation=True)
cut(rf, cyl); keep(bevel(rf, 0.006, 2, 30), sm=40)

# Clay barrel tiles (teja arabe): canal tiles (hollow up) in columns 22 cm apart, cover tiles (round up) over the
# joints, three overlapping courses. The patch is 1.1 m along the eave (x), 0.9 m from the wall (y = 0) out to the eave
# (y = -0.9), lying flat (the game tilts it). Every tile is its own shell with a slight random lay and a colour (COLOR_0).
def tile(bm, col, cx, y_back, y_front, r_back, r_front, convex, t=0.011, segs=5, span=math.radians(136), lift=0.0, under=True):
    a0 = (math.pi - span) / 2; rings = []
    roll, yaw, dx, dy = rnd.uniform(-0.03, 0.03), rnd.uniform(-0.02, 0.02), rnd.uniform(-0.004, 0.004), rnd.uniform(-0.008, 0.008)
    for y, r in ((y_back, r_back), (y_front, r_front)):
        ring = []
        for surf in (0, 1):                                    # 0: the face seen from above, 1: the underside
            rr = r + (t if (convex == (surf == 0)) else 0.0) if convex else r + (t if surf == 1 else 0.0)
            zc = (-0.004 + lift) if convex else (r_back + lift)
            for k in range(segs + 1):
                a = a0 + (math.pi - 2 * a0) * k / segs
                x, z = rr * math.cos(a), (zc + rr * math.sin(a)) if convex else (zc - rr * math.sin(a))
                p = Matrix.Rotation(roll, 3, 'Y') @ Vector((x, 0, z - zc)) + Vector((0, 0, zc))
                p = Matrix.Rotation(yaw, 3, 'Z') @ Vector((p.x, y - (y_back + y_front) / 2, p.z)) + Vector((cx + dx, (y_back + y_front) / 2 + dy, 0))
                ring.append(bm.verts.new(p))
        rings.append(ring)
    n = segs + 1; faces = []
    for s in range(segs):                                       # (the back end always lies under the next course)
        faces.append(poly(bm, (rings[0][s], rings[0][s + 1], rings[1][s + 1], rings[1][s])))              # top
        if under: faces.append(poly(bm, (rings[0][n + s + 1], rings[0][n + s], rings[1][n + s], rings[1][n + s + 1])))  # underside
        faces.append(poly(bm, (rings[1][s], rings[1][s + 1], rings[1][n + s + 1], rings[1][n + s])))        # front end
    for e in (0, segs):
        faces.append(poly(bm, (rings[0][e], rings[1][e], rings[1][n + e], rings[0][n + e])))                # lips
    return [f for f in faces if f]

def tile_patch(name, lod):
    bm = bmesh.new(); colours = []
    if lod:                                                     # far: one corrugated sheet with a thick eave edge
        xs = [-0.55 + 0.0275 * k for k in range(41)]
        def zf(x):                                          # low in the canal columns, high over the joints
            u = (x + 0.55) % 0.22 / 0.22
            return 0.075 * (0.5 - 0.5 * math.cos(2 * math.pi * (u - 0.5)))
        back = [bm.verts.new((x, 0.05, zf(x) + 0.04)) for x in xs]; front = [bm.verts.new((x, -0.9, zf(x))) for x in xs]
        low = [bm.verts.new((x, -0.9, zf(x) - 0.02)) for x in xs]
        for k in range(len(xs) - 1):
            poly(bm, (back[k], front[k], front[k + 1], back[k + 1])); poly(bm, (front[k], low[k], low[k + 1], front[k + 1]))
        for f in bm.faces: colours.append((f, (1, 1, 1)))
    else:
        courses = [(-0.9, -0.47), (-0.54, -0.11), (-0.18, 0.25)]      # (front, back) of each course along y
        for ci, (yf, yb) in enumerate(courses):
            for k in range(5):
                cx = -0.44 + 0.22 * k
                for convex in (False, True):
                    x = cx if not convex else cx - 0.11
                    shade = rnd.uniform(0.80, 1.08); old = rnd.random() < 0.12
                    c = (shade, shade * rnd.uniform(0.93, 1.0), shade * rnd.uniform(0.86, 0.98))
                    if old: c = (c[0] * 0.78, c[1] * 0.8, c[2] * 0.82)
                    if ci == 0: c = (c[0] * 0.94, c[1] * 0.95, c[2] * 0.93)  # the eave course carries the most grime
                    # only the eave course shows its underside (from the street); the others lie on the course below
                    shell = tile(bm, None, x, yb, yf, 0.075 if not convex else 0.07, 0.086 if not convex else 0.08, convex, lift=0.009 * ci + (0.0 if not convex else 0.004), under=(ci == 0))
                    if ci == 0: bmesh.ops.recalc_face_normals(bm, faces=shell)
                    else:                                       # open shells: point every face up and out by hand
                        for f in shell:
                            f.normal_update()
                            if f.normal.z < -0.2 or (abs(f.normal.z) <= 0.2 and f.normal.y > 0.5): f.normal_flip()
                    for f in shell: colours.append((f, c))
        # mortar plugs closing the cover tiles' mouths at the eave (boquillas)
        for k in range(5):
            cx = -0.44 + 0.22 * k - 0.11
            ring = [bm.verts.new((cx + 0.074 * math.cos(a), -0.885, -0.004 + 0.074 * math.sin(a))) for a in [math.radians(22 + 136 * i / 6) for i in range(7)]]
            ctr = bm.verts.new((cx, -0.885, 0.0))
            for i in range(6):
                f = poly(bm, (ctr, ring[i], ring[i + 1]))
                if f: colours.append((f, (-1, -1, -1)))         # (flagged: mortar)
    col = bm.loops.layers.float_color.new('Col')
    for f, c in colours:
        if not f.is_valid: continue
        if c[0] < 0: f.material_index = 1; c = (1, 1, 1)
        for l in f.loops: l[col] = (*c, 1.0)
    ob = to_obj(name, bm, TILE, MORTAR)
    ob.data.color_attributes.active_color = ob.data.color_attributes['Col']
    return ob

keep(tile_patch('tile_patch', False), sm=50)
keep(tile_patch('tile_patch_lod1', True), sm=60)

# Panelled door leaf (two of them make a door): stiles and rails with raised fields, an iron pull. 0.55 x 2.32,
# hinge at x = 0, front face on y = 0, 4.5 cm thick (into +y).
def door_leaf(name, mirror):
    W, H, T = 0.55, 2.32, 0.045; parts = []
    for (x0, x1, z0, z1) in [(0, 0.11, 0, H), (W - 0.11, W, 0, H), (0.11, W - 0.11, H - 0.11, H), (0.11, W - 0.11, 0.95, 1.11), (0.11, W - 0.11, 0, 0.22)]:
        parts.append(bevel(box('_s', x0, x1, 0.0, T, z0, z1, WOOD), 0.004, 1, 30))
    for (z0, z1) in [(1.11, H - 0.11), (0.22, 0.95)]:
        parts.append(box('_pn', 0.11, W - 0.11, 0.012, 0.036, z0, z1, WOOD))
        parts.append(bevel(box('_rf', 0.15, W - 0.15, 0.0, 0.014, z0 + 0.04, z1 - 0.04, WOOD), 0.012, 1, 30))
    ring = bpy.data.objects.new('_r', bpy.data.meshes.new('_r')); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.022, radius2=0.018, depth=0.03); bm.to_mesh(ring.data); bm.free(); scene.collection.objects.link(ring)
    ring.data.materials.append(IRON); ring.rotation_euler = (math.pi / 2, 0, 0); ring.location = (W - 0.07, -0.015, 1.03); apply(ring); only(ring); bpy.ops.object.transform_apply(location=True, rotation=True)
    parts.append(ring)
    ob = join(name, parts)
    if mirror:
        for v in ob.data.vertices: v.co.x = -v.co.x
        ob.data.flip_normals()
        only(ob)
        try: bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception: pass
    return keep(ob, sm=40)
door_leaf('door_leaf_l', False); door_leaf('door_leaf_r', True)

# Worn building corner (esquina): a quarter metre of each facade's wall at an outside corner, one metre tall (stacked),
# its arris rounded by wear; the chipped variants have pieces of plaster knocked off to the brick underneath.
# Building inside at x < 0, y > 0: facade A is y = 0 (out -y), facade B is x = 0 (out +x).
def corner(name, chips):
    blk = box(name, -0.25, 0.0, 0.0, 0.25, 0.0, 1.0, WALL)
    only(blk); bm = bmesh.new(); bm.from_mesh(blk.data)
    edge = [e for e in bm.edges if abs(e.verts[0].co.x) < 1e-6 and abs(e.verts[1].co.x) < 1e-6 and abs(e.verts[0].co.y) < 1e-6 and abs(e.verts[1].co.y) < 1e-6]
    bmesh.ops.bevel(bm, geom=edge, offset=0.035, segments=4, affect='EDGES', profile=0.5)
    bm.to_mesh(blk.data); bm.free()
    for (z, size, depth) in chips:
        rock = bpy.data.objects.new('_k', bpy.data.meshes.new('_k')); bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        for v in bm.verts: v.co *= 1.0 + rnd.uniform(-0.22, 0.22)
        bm.to_mesh(rock.data); bm.free(); scene.collection.objects.link(rock); rock.data.materials.append(BRICK)
        rock.scale = (size * rnd.uniform(0.7, 1.0), size * rnd.uniform(0.7, 1.0), size * rnd.uniform(1.0, 1.6))
        rock.location = (depth * 0.25, -depth * 0.25, z); rock.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))
        apply(rock); only(rock); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        cut(blk, rock)
    # drop the faces nobody sees (the cut ends where modules stack, and the two faces inside the building)
    bm = bmesh.new(); bm.from_mesh(blk.data)
    dead = [f for f in bm.faces if (abs(f.normal.z) > 0.99 and (f.calc_center_median().z < 1e-4 or f.calc_center_median().z > 1 - 1e-4)) or
            (f.normal.x < -0.99 and abs(f.calc_center_median().x + 0.25) < 1e-4) or (f.normal.y > 0.99 and abs(f.calc_center_median().y - 0.25) < 1e-4)]
    bmesh.ops.delete(bm, geom=dead, context='FACES'); bm.to_mesh(blk.data); bm.free()
    if blk.data.materials.find('brick') < 0: blk.data.materials.append(BRICK)
    return keep(blk, sm=38)
corner('corner_a', [])
corner('corner_b', [(0.42, 0.095, 0.11), (0.78, 0.07, 0.09)])
corner('corner_c', [(0.24, 0.13, 0.13), (0.6, 0.09, 0.11), (0.86, 0.07, 0.08)])

# Plaza fountain (fuente): placed by its centre, ground at z = 0, the octagon's flats facing the axes. All one stone
# (trim); the game lays talavera into the sunk panels and over the inside of the basin, and draws the water.
def oct_prism(name, ap, z0, z1, material):
    """Octagonal prism, apothem ap (centre to a flat), flats facing +-x, +-y and the diagonals."""
    R = ap / math.cos(math.pi / 8); bm = bmesh.new()
    lo = [bm.verts.new((R * math.cos(math.pi / 8 + k * math.pi / 4), R * math.sin(math.pi / 8 + k * math.pi / 4), z0)) for k in range(8)]
    hi = [bm.verts.new((v.co.x, v.co.y, z1)) for v in lo]
    poly(bm, lo[::-1]); poly(bm, hi)
    for k in range(8): j = (k + 1) % 8; poly(bm, (lo[k], lo[j], hi[j], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_obj(name, bm, material)

def lathe(name, prof, segs, material):
    """A solid of revolution about z: prof is [(r, z)] from the axis round the outline back to the axis."""
    bm = bmesh.new(); vs = [bm.verts.new((r, 0.0, z)) for r, z in prof]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=segs, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_obj(name, bm, material)

FOUNTAIN = dict(plinth=2.32, body=2.18, inner=1.75, coping_out=2.25, coping_in=1.68, floor=0.18, rim0=0.52, rim1=0.64)
def fountain_basin():
    F = FOUNTAIN
    plinth = bevel(oct_prism('_pl', F['plinth'], 0.0, 0.10, TRIM), 0.018, 2, 30)               # a step round the foot
    body = oct_prism('_body', F['body'], 0.08, F['rim0'], TRIM)
    cut(body, oct_prism('_hollow', F['inner'], F['floor'], 1.0, TRIM))                          # the basin, its floor at 0.18
    side = 2 * F['body'] * math.tan(math.pi / 8)
    for k in range(8):                                                                          # a sunk panel in every face
        a = k * math.pi / 4
        p = box('_pn', -side / 2 + 0.17, side / 2 - 0.17, -0.03, 0.03, 0.17, 0.43, TRIM)
        p.rotation_euler = (0, 0, a + math.pi / 2); p.location = ((F['body'] + 0.005) * math.cos(a), (F['body'] + 0.005) * math.sin(a), 0)
        only(p); bpy.ops.object.transform_apply(location=True, rotation=True); cut(body, p)
    bevel(body, 0.008, 1, 30)                                                                   # worn arrises
    cop = oct_prism('_cop', F['coping_out'], F['rim0'], F['rim1'], TRIM)                       # the coping, overhanging both faces
    cut(cop, oct_prism('_ch', F['coping_in'], 0.3, 1.0, TRIM)); bevel(cop, 0.035, 3, 30)
    return keep(join('fountain_basin', [body, plinth, cop]), sm=30)
fountain_basin()

# The tazza in the middle: an octagonal pedestal, a turned baluster, a wide bowl with a rolled lip, a little stem and
# bowl above it and a finial with the spout. Profile (radius, height) from the axis at the pedestal's top.
TAZZA = [(0.0, 0.42), (0.32, 0.42), (0.32, 0.45), (0.28, 0.455)] + arc(0.28, 0.495, 0.04, -math.pi / 2, math.pi / 2, 6)[1:] + \
        [(0.22, 0.545), (0.195, 0.575), (0.17, 0.62), (0.155, 0.68), (0.16, 0.74), (0.195, 0.80), (0.222, 0.87), (0.218, 0.94),
         (0.19, 1.0), (0.15, 1.04), (0.125, 1.075), (0.12, 1.10), (0.165, 1.115), (0.172, 1.14), (0.15, 1.16), (0.13, 1.17)] + \
        [(0.2, 1.19), (0.32, 1.215), (0.46, 1.245), (0.6, 1.28), (0.72, 1.32), (0.81, 1.36), (0.855, 1.39)] + \
        [(0.88, 1.405), (0.887, 1.425), (0.877, 1.443), (0.856, 1.452), (0.835, 1.446), (0.8, 1.427)] + \
        [(0.66, 1.4), (0.48, 1.38), (0.3, 1.37), (0.16, 1.366), (0.12, 1.372)] + \
        [(0.11, 1.4), (0.13, 1.42), (0.115, 1.45), (0.085, 1.52), (0.075, 1.6), (0.085, 1.66), (0.11, 1.7), (0.105, 1.74), (0.08, 1.77),
         (0.07, 1.8), (0.09, 1.83)] + \
        [(0.16, 1.85), (0.25, 1.88), (0.33, 1.915), (0.385, 1.95), (0.405, 1.966), (0.407, 1.985), (0.392, 1.996), (0.37, 1.99)] + \
        [(0.3, 1.976), (0.18, 1.966), (0.08, 1.962), (0.06, 1.97), (0.055, 2.0), (0.07, 2.03), (0.095, 2.07), (0.1, 2.1), (0.09, 2.14),
         (0.06, 2.18), (0.035, 2.21), (0.03, 2.24), (0.02, 2.26), (0.0, 2.265)]
def fountain_tazza():
    ped = bevel(oct_prism('_ped', 0.46, FOUNTAIN['floor'] - 0.02, 0.42, TRIM), 0.02, 2, 30)
    band = oct_prism('_pb', 0.6, 0.26, 0.34, TRIM); cut(band, oct_prism('_pbi', 0.44, 0.0, 1.0, TRIM)); cut(ped, band)   # a sunk band round it
    t = lathe('_tz', TAZZA, 40, TRIM)
    return keep(join('fountain_tazza', [t, ped]), sm=34)
fountain_tazza()

# ---------------------------------------------------------------------------------------------------- facade archetypes ---
# Pieces for the facade archetypes (world.js / facades.js): arched surrounds, window hoods and pediments, quoins,
# pilasters, wrought iron, casement frames, balustrades and a niche. Same axes as the rest of the kit.
def sweep_path(name, prof, path, material, caps=True):
    """A closed profile [(a, b)] swept along a path in the wall plane, path [(x, z)]: a = offset to the right of the path
    (outwards, for an arch traced anticlockwise), b = how far the point stands out of the wall (-y). Joints are mitred."""
    bm = bmesh.new(); m = len(path); rings = []
    for i, (x, z) in enumerate(path):
        xa, za = path[i - 1] if i > 0 else (2 * x - path[1][0], 2 * z - path[1][1])
        xb, zb = path[i + 1] if i < m - 1 else (2 * x - path[i - 1][0], 2 * z - path[i - 1][1])
        tx, tz = xb - xa, zb - za; l = math.hypot(tx, tz); tx, tz = tx / l, tz / l
        nx, nz = tz, -tx
        s = 1.0
        if 0 < i < m - 1:                                         # keep the profile's width round a corner
            ux, uz = x - xa, z - za; lu = math.hypot(ux, uz); ux, uz = ux / lu, uz / lu
            s = 1.0 / max(0.3, uz * nx - ux * nz)                    # 1 / cos(half the turn): the incoming segment's normal against the mitre's
        rings.append([bm.verts.new((x + nx * a * s, -b, z + nz * a * s)) for a, b in prof])
    n = len(prof)
    for i in range(m - 1):
        A, Bv = rings[i], rings[i + 1]
        for k in range(n): j = (k + 1) % n; poly(bm, (A[k], A[j], Bv[j], Bv[k]))
    if caps: poly(bm, rings[0][::-1]); poly(bm, rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_obj(name, bm, material)

def tube(bm, pts, r, sides=4):
    """A thin bar along a polyline [(x, y, z)] (square for sides = 4), into an existing bmesh."""
    rings = []
    for i, p in enumerate(pts):
        a = Vector(pts[max(0, i - 1)]); b = Vector(pts[min(len(pts) - 1, i + 1)]); t = (b - a).normalized()
        u = t.cross(Vector((0, 1, 0))); u = u.normalized() if u.length > 1e-6 else Vector((1, 0, 0)); w = t.cross(u).normalized()
        rings.append([bm.verts.new(Vector(p) + (u * math.cos(2 * math.pi * k / sides + math.pi / 4) + w * math.sin(2 * math.pi * k / sides + math.pi / 4)) * r) for k in range(sides)])
    for i in range(len(rings) - 1):
        for k in range(sides): j = (k + 1) % sides; poly(bm, (rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]))
    poly(bm, rings[0][::-1]); poly(bm, rings[-1])

def scroll(cx, cz, r0, turns, start, sign=1, n=14, y=0.0):
    """A flat spiral in the wall plane (an iron C or S scroll's curl), centre (cx, cz), from radius r0 inwards."""
    return [(cx + sign * r0 * (1 - 0.55 * k / n) * math.cos(start + sign * turns * 2 * math.pi * k / n), y, cz + r0 * (1 - 0.55 * k / n) * math.sin(start + sign * turns * 2 * math.pi * k / n)) for k in range(n + 1)]

# Arched surround (archivolt) for an opening 1 m wide, its springing at z = 0: the window/door surround bar's own
# profile carried round a semicircle, so it runs on from the straight jambs. The game scales it by the opening's span.
ARCHI = [(z, -y) for y, z in BAR]
keep(sweep_path('archivolt', ARCHI, [(0.5 * math.cos(math.pi * k / 18), 0.5 * math.sin(math.pi * k / 18)) for k in range(19)], TRIM), sm=40)

# Window hood (cornisa de ventana): a small cornice on two scrolled consoles, 1 m wide (stretched to fit), bottom at
# z = 0 (just above the surround), its consoles hanging below the ends.
HOOD = [(y * 0.45, z * 0.45) for y, z in COR]
hood = sweep('_hood', HOOD, 1.0, TRIM)
cons = []
for sx in (-0.45, 0.45):
    c = sweep('_cn', CB, 1.0, TRIM); c.scale = (0.075, 0.3, 0.55); c.location = (sx, 0, 0); apply(c); only(c); bpy.ops.object.transform_apply(location=True, scale=True); cons.append(c)
keep(bevel(join('hood', [hood] + cons), 0.002, 1, 45), sm=40)

# Pediment (fronton): raking cornices meeting at the apex over a straight one, the tympanum flat between them. 1 m wide.
PED = [(z * 0.32, -y * 0.32) for y, z in COR]
rake = sweep_path('_rk', PED, [(0.55, 0.0), (0.0, 0.26), (-0.55, 0.0)], TRIM)
base = sweep('_pb2', [(y * 0.32, z * 0.32) for y, z in COR], 1.12, TRIM)
bm = bmesh.new(); vs = [bm.verts.new(p) for p in [(-0.5, -0.004, 0.05), (0.5, -0.004, 0.05), (0.0, -0.004, 0.25)]]; poly(bm, vs)
tymp = to_obj('_ty', bm, WALL)
keep(join('pediment', [rake, base, tymp]), sm=40)

# Quoins (sillares): rusticated corner stones standing 3 cm proud, long and short arms alternating up the corner. The
# corner convention of corner(): building inside at x < 0, y > 0; facade A is y = 0, facade B is x = 0. 0.34 m tall.
def quoin(name, la, lb):
    q = box(name, -la, 0.03, -0.03, 0.02, 0.0, 0.34, TRIM); cut(q, box('_qb', -0.02, 0.03, -0.03, lb, 0.0, 0.34, TRIM), 'UNION')
    return keep(bevel(q, 0.018, 2, 30), sm=40)
quoin('quoin_a', 0.44, 0.26); quoin('quoin_b', 0.26, 0.44)

# Pilaster: a shaft 0.36 wide and 4 cm proud with a sunk panel, one metre tall (stretched), and its base and capital.
sh = box('pilaster', -0.18, 0.18, -0.04, 0.01, 0.0, 1.0, TRIM); cut(sh, box('_pp', -0.11, 0.11, -0.06, -0.028, 0.05, 0.95, TRIM))
keep(bevel(sh, 0.004, 1, 40), sm=40)
pb = [box('_b1', -0.23, 0.23, -0.085, 0.01, 0.0, 0.12, TRIM), box('_b2', -0.21, 0.21, -0.07, 0.01, 0.12, 0.17, TRIM), box('_b3', -0.19, 0.19, -0.05, 0.01, 0.17, 0.2, TRIM)]
for o in pb: bevel(o, 0.012, 2, 30)
keep(join('pil_base', pb), sm=40)
pc = [box('_c1', -0.19, 0.19, -0.05, 0.01, 0.0, 0.04, TRIM), box('_c2', -0.21, 0.21, -0.075, 0.01, 0.04, 0.1, TRIM), box('_c3', -0.24, 0.24, -0.1, 0.01, 0.1, 0.16, TRIM)]
for o in pc: bevel(o, 0.012, 2, 30)
keep(join('pil_cap', pc), sm=40)

# Wrought iron balcony railing (barandal de herreria), 1 m wide and 1 m tall, in the plane y = 0: rails, square
# balusters, S scrolls along the foot, paired C scrolls under the top rail and a ring in the middle.
def rail_scroll():
    bm = bmesh.new(); r = 0.0075
    for z0, z1 in [(0.0, 0.03), (0.21, 0.23), (0.965, 1.0)]:
        tube(bm, [(-0.5, 0, (z0 + z1) / 2), (0.5, 0, (z0 + z1) / 2)], (z1 - z0) / 2 * 1.2)
    xs = [-0.4375 + 0.125 * k for k in range(8)]
    for x in xs: tube(bm, [(x, 0, 0.23), (x, 0, 0.965)], r)
    for x in [-0.5 + 0.125 * k for k in range(8)]:                                  # S scrolls in the foot band
        c = x + 0.0625
        tube(bm, scroll(c - 0.022, 0.12, 0.05, 0.75, -math.pi / 2, 1, 10)[::-1] + scroll(c + 0.022, 0.12, 0.05, 0.75, math.pi / 2, 1, 10)[1:], r * 0.8)
    for x in xs[::2]:                                                               # paired C scrolls under the top rail
        c = x + 0.0625
        tube(bm, scroll(c - 0.03, 0.9, 0.035, 0.8, 0.0, -1, 10), r * 0.8); tube(bm, scroll(c + 0.03, 0.9, 0.035, 0.8, math.pi, 1, 10), r * 0.8)
    tube(bm, [(0.075 * math.cos(2 * math.pi * k / 16), 0, 0.6 + 0.075 * math.sin(2 * math.pi * k / 16)) for k in range(17)], r)   # the ring
    return keep(to_obj('rail_scroll', bm, IRON), sm=50)
rail_scroll()

# Window grille (proteccion), 1 x 1 m in the plane y = 0: square bars, two flat bars across, S scrolls along the top.
def reja():
    bm = bmesh.new(); r = 0.008
    for x in [-0.375 + 0.125 * k for k in range(7)]: tube(bm, [(x, 0, 0.0), (x, 0, 1.0)], r)
    for z in (0.1, 0.8): tube(bm, [(-0.5, 0, z), (0.5, 0, z)], 0.012, 4)
    for x in [-0.375 + 0.125 * k for k in range(6)]:
        c = x + 0.0625
        tube(bm, scroll(c - 0.02, 0.9, 0.045, 0.7, -math.pi / 2, 1, 9)[::-1] + scroll(c + 0.02, 0.9, 0.045, 0.7, math.pi / 2, 1, 9)[1:], r * 0.75)
    for x in (-0.5, 0.5): tube(bm, [(x, 0, 0.0), (x, 0, 1.0)], 0.012)
    return keep(to_obj('reja', bm, IRON), sm=50)
reja()

# Casement window (ventana de madera), 1 x 1 m, its face in the plane y = 0 and 6 cm deep into +y: a frame, two
# leaves meeting in the middle, each glazed in three panes by glazing bars.
def casement():
    obs = [box('_f1', -0.5, -0.44, 0.0, 0.06, 0.0, 1.0, WOOD), box('_f2', 0.44, 0.5, 0.0, 0.06, 0.0, 1.0, WOOD),
           box('_f3', -0.5, 0.5, 0.0, 0.06, 0.0, 0.07, WOOD), box('_f4', -0.5, 0.5, 0.0, 0.06, 0.94, 1.0, WOOD),
           box('_f5', -0.03, 0.03, -0.01, 0.05, 0.07, 0.94, WOOD)]
    for z in (0.36, 0.65):
        obs += [box('_gb', -0.44, -0.03, 0.01, 0.04, z - 0.012, z + 0.012, WOOD), box('_gb', 0.03, 0.44, 0.01, 0.04, z - 0.012, z + 0.012, WOOD)]
    for x in (-0.235, 0.235): obs.append(box('_gv', x - 0.011, x + 0.011, 0.01, 0.04, 0.07, 0.94, WOOD))
    c = join('casement', obs); return keep(bevel(c, 0.004, 1, 40), sm=40)
casement()

# Balustrade (balaustrada), 1 m: a plinth, four turned balusters and a moulded rail. Centred on y = 0, 0.84 tall.
BAL = [(0.0, 0.14), (0.055, 0.14), (0.055, 0.17), (0.04, 0.2), (0.05, 0.27), (0.072, 0.36), (0.07, 0.43), (0.05, 0.5), (0.035, 0.56),
       (0.035, 0.62), (0.05, 0.66), (0.055, 0.7), (0.0, 0.7)]
def balustrade():
    obs = [box('_bp', -0.5, 0.5, -0.12, 0.12, 0.0, 0.14, TRIM), box('_br', -0.5, 0.5, -0.14, 0.14, 0.7, 0.84, TRIM)]
    for o in obs: bevel(o, 0.015, 2, 30)
    for x in (-0.375, -0.125, 0.125, 0.375):
        b = lathe('_bl', BAL, 10, TRIM); b.location = (x, 0, 0); apply(b); only(b); bpy.ops.object.transform_apply(location=True); obs.append(b)
    return keep(join('balustrade', obs), sm=34)
balustrade()

# Niche (nicho) with a saint: a moulded arched frame standing out of the wall, a blue painted back, a little shelf
# and a figure in a long robe. 0.5 wide, 0.9 tall, bottom at z = 0.
def niche():
    fr = sweep_path('_nf', [(a * 0.6, b * 0.8) for a, b in ARCHI], [(0.2, 0.0), (0.2, 0.55)] + [(0.2 * math.cos(math.pi * k / 12), 0.55 + 0.2 * math.sin(math.pi * k / 12)) for k in range(1, 12)] + [(-0.2, 0.55), (-0.2, 0.0)], TRIM)
    bm = bmesh.new(); pts = [(0.2, 0.0), (0.2, 0.55)] + [(0.2 * math.cos(math.pi * k / 12), 0.55 + 0.2 * math.sin(math.pi * k / 12)) for k in range(1, 12)] + [(-0.2, 0.55), (-0.2, 0.0)]
    poly(bm, [bm.verts.new((x, -0.002, z)) for x, z in pts]); back = to_obj('_nb', bm, TILE)
    shelf = bevel(box('_ns', -0.24, 0.24, -0.12, 0.01, -0.06, 0.0, TRIM), 0.01, 2, 30)
    fig = lathe('_nfg', [(0.0, 0.0), (0.075, 0.0), (0.07, 0.1), (0.055, 0.3), (0.05, 0.38), (0.045, 0.42), (0.03, 0.44), (0.032, 0.47), (0.03, 0.5), (0.0, 0.51)], 10, TRIM)
    fig.location = (0, -0.07, 0.0); apply(fig); only(fig); bpy.ops.object.transform_apply(location=True)
    return keep(join('niche', [fr, back, shelf, fig]), sm=40)
niche()

# ---------------------------------------------------------------------------------------------------- export ---------
for ob in pieces: ob.location = (0, 0, 0)
summary = ', '.join(f'{ob.name} {tri_count(ob)}' for ob in pieces)
print('KIT pieces (triangles):', summary)
for ob in bpy.data.objects: ob.select_set(ob in pieces)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_normals=True, export_texcoords=False, export_materials='EXPORT', export_vertex_color='ACTIVE', export_tangents=False)
print('KIT written', OUT)

if PREVIEW:                                                     # a contact sheet of every piece
    cols = 5
    for i, ob in enumerate(pieces):
        ob.location = ((i % cols) * 1.5, (i // cols) * 1.6, 0)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam)
    cam.location = (3.1, -5.2, 4.4); cam.rotation_euler = (math.radians(58), 0, math.radians(14)); scene.camera = cam
    cam.data.lens = 26
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35)); scene.collection.objects.link(sun)
    scene.render.engine = 'BLENDER_WORKBENCH'; scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True; scene.display.shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000; scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print('KIT preview', PREVIEW)
