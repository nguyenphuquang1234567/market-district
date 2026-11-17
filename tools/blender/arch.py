# Architectural fittings for Market District (the 2026-11-17 architecture pass), modelled procedurally in Blender and
# exported as one GLB, assets/kit/arch.glb. These are the things a street floor is made of that the district drew as a
# flat textured quad or not at all: roll-up shutters slat by slat with their guides, housing, handles and padlocks;
# corrugated sheet gates on a tube frame; projecting wrought-iron window grilles; rusticated stone base courses; and the
# inside of a shop: a jack-arch ceiling (brick vaults sprung between steel joists), a tiled dado, a back-room door,
# shelves of goods, a strip light; and clay spouts through the parapets.
#   /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/arch.py -- \
#       assets/kit/arch.glb [--preview captures/arch] [--only cortina_slats,reja_calle]
#
# Axes as in kit.py: Blender x = along the wall (three X), z = up (three Y), -y = out of the wall (three +Z); the wall
# face is y = 0. Material slots are named for what they stand in for; src/archdetail.js maps each to one of the game's
# materials per placement. Texture coordinates are projected in world space by the game (Builder.kit), so a piece
# marked "stretch x" (or z) can be scaled along that axis to fit. Every piece carries a vertex colour: ambient
# occlusion measured on the piece itself (and against the wall or floor it stands on), times a shade per part where
# the parts are different things (each tile, each can on a shelf).
import bpy, bmesh, math, random, sys, os, zlib
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith('--') else 'assets/kit/arch.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
ONLY = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

SHOW = {'steel': (0.55, 0.58, 0.6), 'iron': (0.12, 0.12, 0.13), 'brass': (0.7, 0.55, 0.25), 'brick': (0.62, 0.34, 0.24), 'tile': (0.82, 0.8, 0.7),
        'accent': (0.3, 0.45, 0.4), 'grout': (0.6, 0.58, 0.54), 'cap': (0.35, 0.3, 0.25), 'wood': (0.42, 0.3, 0.2), 'goods': (0.8, 0.8, 0.8),
        'bulb': (1.0, 0.97, 0.85), 'clay': (0.7, 0.38, 0.24), 'trim': (0.8, 0.72, 0.62), 'rubber': (0.05, 0.05, 0.05)}
MATS = {}
def mat(name):
    if name not in MATS:
        m = bpy.data.materials.new(name); m.diffuse_color = (*SHOW.get(name, (0.7, 0.7, 0.7)), 1.0); MATS[name] = m
    return MATS[name]
def stream(name): return random.Random(zlib.crc32(name.encode()))

# ---------------------------------------------------------------------------------------------------- helpers --------
def only(ob):
    for o in bpy.context.selected_objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob

def apply(ob):
    only(ob)
    for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)

def obj(name, bm, slot, shade=(1.0, 1.0, 1.0)):
    """A finished bmesh as an object with one material slot. Every part has the colour layer 'Col' (the shade given,
    unless the bmesh already set its own), so joined parts keep theirs."""
    col = bm.loops.layers.float_color.get('Col')
    if col is None:
        col = bm.loops.layers.float_color.new('Col')
        for f in bm.faces:
            for l in f.loops: l[col] = (*shade, 1.0)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(mat(slot))
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob); return ob

def bevel(ob, width, segs=2, angle=30):
    m = ob.modifiers.new('bevel', 'BEVEL'); m.width = width; m.segments = segs; m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle); m.use_clamp_overlap = True; m.harden_normals = True
    apply(ob); return ob

def smooth(ob, angle=35):
    only(ob); bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle), keep_sharp_edges=True); return ob

def join(name, obs):
    obs = [o for o in obs if o is not None]
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = name; ob.data.name = name; return ob

def xf(ob, M):
    ob.data.transform(M); ob.data.update(); return ob
def at(ob, x=0.0, y=0.0, z=0.0): return xf(ob, Matrix.Translation((x, y, z)))
def rot(ob, axis, deg): return xf(ob, Matrix.Rotation(math.radians(deg), 4, axis))

def poly(bm, verts):
    try: return bm.faces.new(verts)
    except ValueError: return None

def outward(bm):
    """Orient an open skin (a swept strip, a ring) so its faces look away from its own middle; a closed solid is left to
    recalc_face_normals alone."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if all(len(e.link_faces) == 2 for e in bm.edges): return
    c = sum((v.co for v in bm.verts), Vector()) / max(1, len(bm.verts))
    if sum(f.normal.dot(f.calc_center_median() - c) * f.calc_area() for f in bm.faces) < 0:
        for f in bm.faces: f.normal_flip()

def box(x0, x1, y0, y1, z0, z1, slot, bev=0.0, shade=(1, 1, 1), segs=1):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
    ob = obj('_b', bm, slot, shade)
    if bev: bevel(ob, bev, segs, 30)
    return ob

def sweep_x(prof, x0, x1, slot, caps=True, shade=(1, 1, 1)):
    """A closed profile [(y, z)] swept along x."""
    bm = bmesh.new(); n = len(prof)
    A = [bm.verts.new((x0, y, z)) for y, z in prof]; B = [bm.verts.new((x1, y, z)) for y, z in prof]
    for i in range(n): j = (i + 1) % n; poly(bm, (A[i], A[j], B[j], B[i]))
    if caps: poly(bm, A[::-1]); poly(bm, B)
    outward(bm)
    return obj('_s', bm, slot, shade)

def sweep_z(prof, z0, z1, slot, shade=(1, 1, 1)):
    """A closed profile [(x, y)] extruded along z."""
    bm = bmesh.new(); n = len(prof)
    A = [bm.verts.new((x, y, z0)) for x, y in prof]; B = [bm.verts.new((x, y, z1)) for x, y in prof]
    for i in range(n): j = (i + 1) % n; poly(bm, (A[i], A[j], B[j], B[i]))
    poly(bm, A[::-1]); poly(bm, B)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return obj('_s', bm, slot, shade)

def lathe(prof, segs, slot, shade=None):
    """A surface of revolution about z. prof: [(r, z)] bottom to top (r = 0 closes on the axis). shade(z) -> rgb, per ring."""
    bm = bmesh.new(); col = bm.loops.layers.float_color.new('Col'); rings = []
    for r, z in prof:
        rings.append([bm.verts.new((0, 0, z))] if r < 1e-6 else [bm.verts.new((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), z)) for k in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for k in range(segs):
            j = (k + 1) % segs
            if len(a) == 1 and len(b) == 1: continue
            if len(a) == 1: poly(bm, (a[0], b[j], b[k]))
            elif len(b) == 1: poly(bm, (a[k], a[j], b[0]))
            else: poly(bm, (a[k], a[j], b[j], b[k]))
    outward(bm)
    for f in bm.faces:
        zc = sum(v.co.z for v in f.verts) / len(f.verts); c = shade(zc) if shade else (1, 1, 1)
        for l in f.loops: l[col] = (*c, 1.0)
    return obj('_l', bm, slot)

def tube(pts, r, sides, slot, caps=True, shade=(1, 1, 1)):
    """A round bar along a polyline (rings square to the path, carried along it without twisting)."""
    pts = [Vector(p) for p in pts]; bm = bmesh.new(); rings = []
    t0 = (pts[1] - pts[0]).normalized(); u = t0.orthogonal().normalized()
    for i, p in enumerate(pts):
        t = ((pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])).normalized()
        u = (u - t * u.dot(t)).normalized(); v = t.cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r) for k in range(sides)])
    for a, b in zip(rings, rings[1:]):
        for k in range(sides): j = (k + 1) % sides; poly(bm, (a[k], a[j], b[j], b[k]))
    if caps: poly(bm, rings[0][::-1]); poly(bm, rings[-1])
    outward(bm)
    return obj('_t', bm, slot, shade)

def fillet(pts, rad, n=4):
    """Round the corners of a polyline."""
    pts = [Vector(p) for p in pts]; out = [pts[0]]
    for a, b, c in zip(pts, pts[1:], pts[2:]):
        d0 = (a - b).normalized(); d1 = (c - b).normalized(); r = min(rad, (a - b).length * 0.45, (c - b).length * 0.45)
        p0 = b + d0 * r; p1 = b + d1 * r
        for k in range(n + 1): t = k / n; out.append((1 - t) ** 2 * p0 + 2 * t * (1 - t) * b + t * t * p1)
    out.append(pts[-1]); return out

def scroll(cx, cz, r0, turns, start, sign=1, n=16, y=0.0):
    """A spiral in the plane of the wall, wound inwards from radius r0."""
    return [Vector((cx + (r0 * (1 - 0.82 * k / n)) * math.cos(start + sign * turns * 2 * math.pi * k / n), y, cz + (r0 * (1 - 0.82 * k / n)) * math.sin(start + sign * turns * 2 * math.pi * k / n))) for k in range(n + 1)]

def tri_count(ob): return sum(len(p.vertices) - 2 for p in ob.data.polygons)

def bake_ao(ob, dist=0.1, strength=0.7, wall=None, floor=None, ceil=None, rays=12):
    """Ambient occlusion into the colour layer (multiplying what is there): crevices darker, and the stretch next to
    the wall (the plane y = wall), the floor (z = floor) or the ceiling (z = ceil) the piece is fixed to."""
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me); bm.normal_update(); bm.verts.ensure_lookup_table(); bm.verts.index_update()
    tree = BVHTree.FromBMesh(bm); col = bm.loops.layers.float_color['Col']
    dirs = [Vector((math.sqrt((k + 0.5) / rays) * math.cos(k * 2.39996), math.sqrt((k + 0.5) / rays) * math.sin(k * 2.39996), math.sqrt(1 - (k + 0.5) / rays))) for k in range(rays)]
    val = []
    for v in bm.verts:
        n = v.normal if v.normal.length > 0.5 else Vector((0, 0, 1)); q = Vector((0, 0, 1)).rotation_difference(n); o = v.co + n * 0.002; hit = 0
        for d in dirs:
            w = q @ d
            if wall is not None and o.y + w.y * dist > wall: hit += 1
            elif floor is not None and o.z + w.z * dist < floor: hit += 1
            elif ceil is not None and o.z + w.z * dist > ceil: hit += 1
            elif tree.ray_cast(o, w, dist)[0] is not None: hit += 1
        val.append(1 - strength * hit / rays)
    for f in bm.faces:
        for l in f.loops: c = l[col]; a = val[l.vert.index]; l[col] = (c[0] * a, c[1] * a, c[2] * a, 1.0)
    bm.to_mesh(me); bm.free(); return ob

pieces = []
def keep(ob, sm=35):
    me = ob.data
    me.color_attributes.active_color = me.color_attributes['Col']
    me.color_attributes.render_color_index = me.color_attributes.active_color_index      # (the exporter takes the render colour: without it every colour is written as 1)
    smooth(ob, sm); pieces.append(ob); return ob
def piece(fn):
    def run(name, *a):
        if ONLY and name not in ONLY: return None
        ob = fn(name, *a); ob.name = name; ob.data.name = name; return keep(ob)
    return run

# ---------------------------------------------------------------------------------------------------- shutters -------
# A roll-up shutter (cortina metálica): curved laths 75 mm apart, each hooked into the next. One strip is a metre
# wide (stretch x) and eight laths high (stack, never stretch z); it is a one-sided skin facing the street. The hook
# line between laths is shaded in, since no light gets into it.
LATH = [(0.0, 0.0045), (0.09, 0.0045), (0.15, -0.001), (0.3, -0.0095), (0.5, -0.0125), (0.7, -0.0095), (0.85, -0.001), (0.91, 0.0045)]
@piece
def cortina_slats(name, pitch=0.075, n=8):
    bm = bmesh.new(); col = bm.loops.layers.float_color.new('Col'); pts = []
    for k in range(n):
        for f, y in LATH: pts.append((y, (k + f) * pitch))
    pts.append((LATH[0][1], n * pitch))
    A = [bm.verts.new((-0.5, y, z)) for y, z in pts]; B = [bm.verts.new((0.5, y, z)) for y, z in pts]
    for i in range(len(pts) - 1):
        f = bm.faces.new((A[i], B[i], B[i + 1], A[i + 1]))
        for l in f.loops: s = 0.38 + 0.62 * min(1.0, max(0.0, (0.0045 - l.vert.co.y) / 0.012)); l[col] = (s, s, s, 1.0)
    return obj(name, bm, 'steel')

# The guide the curtain runs in: a steel channel, a metre tall (stretch z), open towards the middle of the opening
# (+x). It is the same front and back, so turned half round about z it is the other side's guide.
@piece
def cortina_guide(name):
    g = sweep_z([(0, -0.03), (0.052, -0.03), (0.052, -0.017), (0.007, -0.017), (0.007, 0.017), (0.052, 0.017), (0.052, 0.03), (0, 0.03)], 0.0, 1.0, 'iron')
    bevel(g, 0.0025, 1, 40)
    bolts = [rot(lathe([(0, 0), (0.0085, 0), (0.0085, 0.004), (0.006, 0.0065), (0, 0.0065)], 6, 'iron'), 'X', 90) for _ in range(2)]
    at(bolts[0], 0.026, -0.03, 0.2); at(bolts[1], 0.026, -0.03, 0.8)
    return bake_ao(join(name, [g] + bolts), 0.04, 0.6)

# The bottom bar: an angle iron with a rubber strip under it (a metre wide, stretch x).
@piece
def cortina_bar(name):
    a = bevel(sweep_x([(-0.0185, 0.012), (-0.0185, 0.075), (-0.0125, 0.075), (-0.0125, 0.018), (0.02, 0.018), (0.02, 0.012)], -0.5, 0.5, 'iron'), 0.0015, 1, 40)
    r = sweep_x([(-0.016, 0.0), (-0.016, 0.012), (0.012, 0.012), (0.012, 0.0)], -0.5, 0.5, 'rubber')
    return bake_ao(join(name, [a, r]), 0.04, 0.6, floor=0.0)

# A lifting handle: a bent rod welded to two pads on a lath.
@piece
def cortina_handle(name):
    path = fillet([(-0.07, -0.012, 0), (-0.07, -0.05, 0), (0.07, -0.05, 0), (0.07, -0.012, 0)], 0.018, 4)
    rod = tube(path, 0.0048, 7, 'iron')
    pads = [box(sx * 0.07 - 0.016, sx * 0.07 + 0.016, -0.0155, -0.011, -0.014, 0.014, 'iron', 0.0015) for sx in (-1, 1)]
    return bake_ao(join(name, [rod] + pads), 0.03, 0.6, wall=-0.011)

# A hasp and staple with a padlock through it, at the foot of the curtain (it locks to a ring set in the floor).
@piece
def cortina_lock(name):
    plate = box(-0.03, 0.03, -0.0165, -0.012, 0.0, 0.11, 'iron', 0.002)
    knuckle = rot(tube([(-0.03, 0, 0), (0.03, 0, 0)], 0.006, 8, 'iron'), 'X', 0); at(knuckle, 0, -0.019, 0.11)
    staple = tube(fillet([(-0.011, -0.014, 0.078), (-0.011, -0.04, 0.078), (0.011, -0.04, 0.078), (0.011, -0.014, 0.078)], 0.008, 3), 0.0032, 6, 'iron')
    ring = tube([Vector((0.02 * math.cos(a), -0.03, 0.012 + 0.02 * math.sin(a))) for a in [math.pi * k / 8 for k in range(9)]], 0.004, 6, 'iron')     # the floor ring
    body = box(-0.021, 0.021, -0.058, -0.036, 0.02, 0.058, 'brass', 0.004, (1, 1, 1), 2)
    shackle = tube(fillet([(-0.012, -0.047, 0.058), (-0.012, -0.047, 0.09), (0.012, -0.047, 0.09), (0.012, -0.047, 0.058)], 0.011, 4), 0.0034, 7, 'steel')
    return bake_ao(join(name, [plate, knuckle, staple, ring, body, shackle]), 0.03, 0.6, wall=-0.012)

# The housing the curtain rolls up into: bent sheet with a rounded shoulder and a drip lip (a metre wide, stretch x),
# and the plate that closes each end, riveted on.
BOX = [(0.03, 0.0), (-0.066, 0.0), (-0.072, -0.012), (-0.078, -0.012), (-0.078, 0.004), (-0.082, 0.012), (-0.082, 0.118), (-0.086, 0.122), (-0.086, 0.134), (-0.082, 0.138),
       (-0.082, 0.232), (-0.074, 0.262), (-0.052, 0.286), (-0.022, 0.298), (0.03, 0.3)]
@piece
def cortina_box(name):
    return bake_ao(bevel(sweep_x(BOX, -0.5, 0.5, 'steel', caps=False), 0.002, 1, 50), 0.05, 0.5)
@piece
def cortina_cap(name):
    p = sweep_x([(y + (0.004 if y > 0 else -0.004), z + (0.004 if z > 0.15 else -0.004)) for y, z in BOX if not (z < 0 or (abs(y + 0.086) < 1e-6))], -0.004, 0.004, 'iron')
    bevel(p, 0.0015, 1, 50)
    rivets = []
    for y, z in [(-0.06, 0.03), (-0.06, 0.25), (0.0, 0.03), (0.0, 0.27)]:
        for sx in (-1, 1): rivets.append(at(rot(lathe([(0, 0), (0.006, 0), (0.005, 0.003), (0, 0.004)], 5, 'iron'), 'Y', 90 * sx), sx * 0.004, y, z))
    return bake_ao(join(name, [p] + rivets), 0.03, 0.5)

# An open shop's curtain, rolled up under its lintel: the roll (laths showing round it), the last laths and the bottom
# bar hanging from it (a metre wide, stretch x). The roll's axis is the piece's origin.
@piece
def cortina_roll(name):
    bm = bmesh.new(); col = bm.loops.layers.float_color.new('Col'); R, n = 0.118, 30
    ring = []
    for k in range(n + 1):
        a = -0.5 * math.pi + 2 * math.pi * k / n; f = (k % 3) / 3.0; r = R + (0.006 if f < 0.34 else 0.0015); ring.append((-r * math.cos(a) * 1.0, r * math.sin(a), 0.42 if f > 0.6 else 1.0))
    A = [bm.verts.new((-0.5, y, z)) for y, z, s in ring]; B = [bm.verts.new((0.5, y, z)) for y, z, s in ring]
    for i in range(n):
        f = bm.faces.new((A[i], A[i + 1], B[i + 1], B[i]))
        for l in f.loops: s = ring[i][2]; l[col] = (s, s, s, 1.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    roll = obj('_r', bm, 'steel')
    tail = bmesh.new(); tc = tail.loops.layers.float_color.new('Col'); pts = []
    for k in range(3):
        for f, y in LATH: pts.append((y - R - 0.004, -0.02 - (3 - k - f) * 0.075 + 0.075 * 0))
    pts = sorted(pts, key=lambda p: p[1])
    TA = [tail.verts.new((-0.5, y, z)) for y, z in pts]; TB = [tail.verts.new((0.5, y, z)) for y, z in pts]
    for i in range(len(pts) - 1):
        f = tail.faces.new((TA[i], TB[i], TB[i + 1], TA[i + 1]))
        for l in f.loops: s = 0.4 + 0.6 * min(1.0, max(0.0, (0.0045 - (l.vert.co.y + R + 0.004)) / 0.012)); l[tc] = (s, s, s, 1.0)
    t = obj('_t', tail, 'steel')
    zb = min(p[1] for p in pts)
    bar = at(bevel(sweep_x([(-0.0185, 0.0), (-0.0185, 0.06), (-0.0125, 0.06), (-0.0125, 0.006), (0.02, 0.006), (0.02, 0.0)], -0.5, 0.5, 'iron'), 0.0015, 1, 40), 0, -R - 0.004, zb - 0.058)
    return join(name, [roll, t, bar])

# A sheet-metal gate (portón de lámina): corrugated sheet, the standard 76 mm wave 18 mm deep, half a metre wide (place
# several side by side) and a metre tall (stretch z). One-sided, facing the street.
@piece
def lamina_sheet(name):
    bm = bmesh.new(); col = bm.loops.layers.float_color.new('Col'); waves, per = 6.5, 8; n = int(waves * per)
    pts = [(-0.25 + 0.5 * k / n, -0.009 * math.cos(2 * math.pi * waves * k / n)) for k in range(n + 1)]
    A = [bm.verts.new((x, y, 0.0)) for x, y in pts]; B = [bm.verts.new((x, y, 1.0)) for x, y in pts]
    for i in range(n):
        f = bm.faces.new((A[i], A[i + 1], B[i + 1], B[i]))
        for l in f.loops: s = 0.5 + 0.5 * min(1.0, max(0.0, (0.009 - l.vert.co.y) / 0.014)); l[col] = (s, s, s, 1.0)
    return obj(name, bm, 'steel')

# Square steel tube, 40 mm, a metre long: along x (stretch x) and upright (stretch z). A gate's frame and rails.
@piece
def perfil_x(name): return bake_ao(bevel(box(-0.5, 0.5, -0.02, 0.02, -0.02, 0.02, 'iron'), 0.004, 2, 40), 0.03, 0.4)
@piece
def perfil_z(name): return bake_ao(bevel(box(-0.02, 0.02, -0.02, 0.02, 0.0, 1.0, 'iron'), 0.004, 2, 40), 0.03, 0.4)

# A barrel hinge welded to the frame, and a slide bolt with its keeps.
@piece
def bisagra(name):
    barrel = tube([(0, -0.03, -0.055), (0, -0.03, 0.055)], 0.011, 10, 'iron'); pin = tube([(0, -0.03, -0.065), (0, -0.03, 0.068)], 0.005, 6, 'iron')
    leaf = box(-0.004, 0.05, -0.027, -0.021, -0.045, 0.045, 'iron', 0.002)
    return bake_ao(join(name, [barrel, pin, leaf]), 0.03, 0.6, wall=-0.02)
@piece
def pasador(name):
    plate = box(-0.11, 0.11, -0.026, -0.021, -0.028, 0.028, 'iron', 0.002)
    rodp = tube([(-0.16, -0.036, 0), (0.1, -0.036, 0)], 0.007, 8, 'iron')
    knob = tube(fillet([(0.02, -0.036, 0), (0.02, -0.062, 0), (0.02, -0.062, -0.03)], 0.01, 3), 0.006, 7, 'iron')
    keeps = [box(x - 0.012, x + 0.012, -0.046, -0.024, -0.016, 0.016, 'iron', 0.003) for x in (-0.08, 0.06, -0.2)]
    return bake_ao(join(name, [plate, rodp, knob] + keeps), 0.03, 0.6, wall=-0.021)

# ---------------------------------------------------------------------------------------------------- window grille --
# A projecting street-floor grille (reja de cajón) for the district's 1.2 x 1.25 m window: a flat-bar frame standing
# 10 cm off the wall on four legs, round bars through two rails with a forged collar at each crossing, a band of
# C-scrolls along the bottom and spear points above the top rail. Origin: the opening's bottom centre, on the wall.
@piece
def reja_calle(name):
    W, H, D, obs = 1.32, 1.37, -0.1, []
    z0, z1 = -0.06, H - 0.06
    def flat(x0, x1, zc, h=0.032, t=0.008): return box(x0, x1, D - t / 2, D + t / 2, zc - h / 2, zc + h / 2, 'iron')
    obs += [flat(-W / 2, W / 2, z0), flat(-W / 2, W / 2, z1), flat(-W / 2 + 0.01, W / 2 - 0.01, z0 + 0.3, 0.026), flat(-W / 2 + 0.01, W / 2 - 0.01, z1 - 0.3, 0.026)]
    for sx in (-1, 1):
        obs.append(box(sx * W / 2 - 0.016, sx * W / 2 + 0.016, D - 0.004, D + 0.004, z0, z1, 'iron'))
        for zc in (z0 + 0.1, z1 - 0.1): obs.append(box(sx * W / 2 - 0.014, sx * W / 2 + 0.014, D, 0.03, zc - 0.004, zc + 0.004, 'iron'))      # legs into the wall
    nb = 9
    for i in range(nb):
        x = -W / 2 + 0.1 + (W - 0.2) * i / (nb - 1)
        obs.append(tube([(x, D, z0 + 0.3), (x, D, z1 + 0.075)], 0.0075, 6, 'iron', caps=False))
        obs.append(at(lathe([(0.0075, 0), (0.012, 0.01), (0.0, 0.09)], 5, 'iron'), x, D, z1 + 0.07))                                              # spear point
        obs.append(at(lathe([(0.0075, -0.012), (0.0125, -0.007), (0.0125, 0.007), (0.0075, 0.012)], 5, 'iron'), x, D, z1 - 0.3))                    # a collar where it passes the upper rail
    for i in range(0, nb - 1, 2):                                                                                                                 # the scroll band: an S in every other bay, a ring between
        xa = -W / 2 + 0.1 + (W - 0.2) * i / (nb - 1); xb = xa + (W - 0.2) / (nb - 1); xc = (xa + xb) / 2; zc = z0 + 0.15
        sgn = 1 if (i // 2) % 2 == 0 else -1
        up, dn = scroll(xc, zc + 0.06, 0.056, 0.9, -math.pi / 2, sgn, 8, D), scroll(xc, zc - 0.06, 0.056, 0.9, math.pi / 2, sgn, 8, D)
        obs.append(tube(up[::-1] + dn, 0.0045, 4, 'iron'))
        if i + 1 < nb - 1:
            xr = xc + (W - 0.2) / (nb - 1)
            obs.append(tube([Vector((xr + 0.058 * math.cos(a), D, zc + 0.058 * math.sin(a))) for a in [2 * math.pi * k / 10 for k in range(11)]], 0.0045, 4, 'iron', caps=False))
    return bake_ao(join(name, obs), 0.035, 0.5)

# A steel street door (puerta de lámina) for the district's 1.1 x 2.32 m doorway: a folded sheet leaf with two pressed
# panels, a louvred vent at the foot, a small barred light at head height, three hinges, a pull and a lock plate,
# rivets round the edge. Origin: the floor at the door's middle, on the plane the leaf hangs in.
@piece
def puerta_metal(name):
    obs = []; w, h = 0.535, 2.3
    obs.append(bevel(box(-w, w, -0.014, 0.0, 0.012, h, 'steel'), 0.003, 1, 30))
    for z0, z1 in ((0.52, 1.18), (1.26, 1.62)): obs.append(bevel(box(-w + 0.09, w - 0.09, -0.024, -0.012, z0, z1, 'steel'), 0.009, 2, 30))           # pressed panels
    obs.append(box(-w + 0.09, w - 0.09, -0.018, -0.012, 0.12, 0.44, 'steel', 0.003))                                                                    # the vent's frame
    for k in range(6):
        z = 0.15 + k * 0.046; obs.append(sweep_x([(-0.016, z), (-0.036, z + 0.004), (-0.036, z + 0.008), (-0.016, z + 0.036)], -w + 0.11, w - 0.11, 'steel'))   # louvres
    obs.append(box(-0.17, 0.17, -0.02, -0.012, 1.7, 2.06, 'steel', 0.003))                                                                              # the light: a frame, bars, dark glass behind
    obs.append(box(-0.14, 0.14, -0.0135, -0.012, 1.73, 2.03, 'rubber'))
    for k in range(5): obs.append(tube([(-0.112 + k * 0.056, -0.024, 1.725), (-0.112 + k * 0.056, -0.024, 2.035)], 0.005, 6, 'iron'))
    for hz in (0.26, 1.15, 2.04): obs.append(tube([(w - 0.004, -0.02, hz - 0.05), (w - 0.004, -0.02, hz + 0.05)], 0.0085, 8, 'iron'))                    # hinges
    obs.append(box(-w + 0.05, -w + 0.1, -0.019, -0.014, 0.96, 1.2, 'iron', 0.003))                                                                       # lock plate, cylinder, pull
    obs.append(rot(lathe([(0, 0), (0.014, 0), (0.014, 0.008), (0.011, 0.011), (0, 0.011)], 10, 'brass'), 'X', 90)); at(obs[-1], -w + 0.075, -0.019, 1.14)
    obs.append(tube(fillet([(-w + 0.075, -0.019, 1.09), (-w + 0.075, -0.06, 1.09), (-w + 0.075, -0.06, 0.99), (-w + 0.075, -0.019, 0.99)], 0.014, 4), 0.007, 8, 'iron'))
    for sx in (-1, 1):
        for k in range(9): obs.append(at(rot(lathe([(0, 0), (0.006, 0), (0.0045, 0.003), (0, 0.004)], 6, 'steel'), 'X', 90), sx * (w - 0.03), -0.014, 0.1 + k * 0.265))
    return bake_ao(join(name, obs), 0.04, 0.6, floor=0.0)

# ---------------------------------------------------------------------------------------------------- stone base -----
# A rusticated base course (almohadillado): three courses of rock-faced blocks, chamfered at the joints, in running
# bond. A metre long (stretch x a little), 0.9 m high; the joints lie a centimetre off the wall face.
@piece
def zocalo(name):
    r = stream(name); obs = []; H, n = 0.9, 3; ch = H / n; J, F = -0.01, -0.04
    for c in range(n):
        off = 0.25 if c % 2 else 0.0; x = -0.5 - off
        while x < 0.5 - 1e-6:
            L = 0.5; a, b = max(x, -0.5), min(x + L, 0.5); x += L
            if b - a < 0.02: continue
            bm = bmesh.new(); g = 0.006; ch2 = 0.016; zz0, zz1 = c * ch + g, (c + 1) * ch - g; xa, xb = a + (g if a > -0.5 + 1e-6 else 0), b - (g if b < 0.5 - 1e-6 else 0)
            nx, nz = max(2, round((xb - xa) / 0.09)), 3
            outer = [(xa, zz0), (xb, zz0), (xb, zz1), (xa, zz1)]
            base = [bm.verts.new((px, J, pz)) for px, pz in outer]
            grid = [[bm.verts.new((xa + ch2 + (xb - xa - 2 * ch2) * i / nx, F + (r.uniform(-0.007, 0.006) if 0 < i < nx and 0 < j < nz else r.uniform(-0.002, 0.002)), zz0 + ch2 + (zz1 - zz0 - 2 * ch2) * j / nz)) for i in range(nx + 1)] for j in range(nz + 1)]
            for j in range(nz):
                for i in range(nx): poly(bm, (grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            rim = [grid[0][i] for i in range(nx + 1)] + [grid[j][nx] for j in range(1, nz + 1)] + [grid[nz][i] for i in range(nx - 1, -1, -1)] + [grid[j][0] for j in range(nz - 1, 0, -1)]
            corners = [0, nx, nx + nz, 2 * nx + nz]
            for k in range(4):                                                                              # the chamfer, one fan per side
                a0, a1 = corners[k], corners[(k + 1) % 4] if k < 3 else len(rim)
                seg = rim[a0:a1 + 1] if k < 3 else rim[a0:] + [rim[0]]
                poly(bm, [base[k], base[(k + 1) % 4]] + seg[::-1])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
            for f in bm.faces:
                if f.normal.y > 0.3: f.normal_flip()
            s = r.uniform(0.86, 1.0)
            obs.append(obj('_k', bm, 'trim', (s, s * r.uniform(0.97, 1.0), s * r.uniform(0.94, 1.0))))
    back = bmesh.new(); bv = [back.verts.new(p) for p in [(-0.5, J + 0.001, 0), (0.5, J + 0.001, 0), (0.5, J + 0.001, H), (-0.5, J + 0.001, H)]]; back.faces.new(bv)     # the mortar bed behind the joints
    obs.append(obj('_m', back, 'trim', (0.55, 0.53, 0.5)))
    return bake_ao(join(name, obs), 0.05, 0.75, floor=0.0)

# ---------------------------------------------------------------------------------------------------- shop interior --
# A jack-arch ceiling (bóveda catalana entre viguetas): one bay, 0.8 m from joist to joist (y) and a metre along the
# joists (stretch x). z = 0 is the plaster ceiling it hangs under; the steel joist's bottom flange is at -0.14 and the
# brick vault springs from it, 9 cm of rise. The joist on the -y side belongs to the bay; `vigueta` is one more for
# the last bay's far side.
def joist(y):
    w, t = 0.04, 0.008
    return bevel(sweep_x([(y - w, -0.14), (y + w, -0.14), (y + w, -0.14 + t), (y + 0.004, -0.14 + t + 0.004), (y + 0.004, 0.0), (y - 0.004, 0.0), (y - 0.004, -0.14 + t + 0.004), (y - w, -0.14 + t)], -0.5, 0.5, 'iron'), 0.0015, 1, 40)
@piece
def boveda(name):
    bm = bmesh.new(); n = 12; pts = []
    for k in range(n + 1):
        t = k / n; y = -0.4 + 0.035 + (0.8 - 0.07) * t; pts.append((y, -0.132 + 0.092 * math.sin(math.pi * t) ** 0.9))
    A = [bm.verts.new((-0.5, y, z)) for y, z in pts]; B = [bm.verts.new((0.5, y, z)) for y, z in pts]
    for i in range(n): bm.faces.new((A[i], A[i + 1], B[i + 1], B[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        if f.normal.z > 0: f.normal_flip()
    vault = obj('_v', bm, 'brick')
    return bake_ao(join(name, [vault, joist(-0.4)]), 0.16, 0.7)
@piece
def vigueta(name): return bake_ao(joist(0.0), 0.1, 0.5)

# A tiled dado (lambrín de azulejo): a panel a metre wide (stretch x a little) of 12.5 cm glazed tiles, nine courses,
# each tile pillowed with its own slight shade, one course picked out as a band, and a bullnose capping. Every tile
# stands 7 mm off the wall; the grout lies between them.
@piece
def dado(name):
    r = stream(name); obs = []; T = 0.125; g = 0.0022
    for slot, rows in (('tile', [0, 1, 2, 3, 4, 5, 7, 8]), ('accent', [6])):
        bm = bmesh.new(); col = bm.loops.layers.float_color.new('Col')
        for j in rows:
            for i in range(8):
                x0, x1, z0, z1 = -0.5 + i * T + g, -0.5 + (i + 1) * T - g, j * T + g, (j + 1) * T - g; b = 0.0045
                s = r.uniform(0.86, 1.0) * (0.9 if r.random() < 0.06 else 1.0); c = (s, s * r.uniform(0.96, 1.0), s * r.uniform(0.93, 1.0), 1.0)
                lo = [bm.verts.new(p) for p in [(x0, -0.0018, z0), (x1, -0.0018, z0), (x1, -0.0018, z1), (x0, -0.0018, z1)]]
                hi = [bm.verts.new(p) for p in [(x0 + b, -0.0072, z0 + b), (x1 - b, -0.0072, z0 + b), (x1 - b, -0.0072, z1 - b), (x0 + b, -0.0072, z1 - b)]]
                faces = [bm.faces.new(hi)] + [bm.faces.new((lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k])) for k in range(4)]
                for f in faces:
                    for l in f.loops: l[col] = c
        obs.append(obj('_t', bm, slot))                                                 # (wound by hand: every face of a tile looks out of it)
    back = bmesh.new(); back.faces.new([back.verts.new(p) for p in [(-0.5, -0.0016, 0), (0.5, -0.0016, 0), (0.5, -0.0016, 9 * T), (-0.5, -0.0016, 9 * T)]])
    obs.append(obj('_g', back, 'grout'))
    capz = 9 * T
    cap = sweep_x([(0.0, capz), (-0.009, capz), (-0.0125, capz + 0.004), (-0.0145, capz + 0.012), (-0.0145, capz + 0.026), (-0.012, capz + 0.034), (-0.006, capz + 0.04), (0.0, capz + 0.041)], -0.5, 0.5, 'cap', caps=False)
    obs.append(cap)
    return bake_ao(join(name, obs), 0.012, 0.6)

# The door to the back room: an architrave, a six-panel leaf, three hinges, a lever handle on a plate, a stone sill.
# Origin: the floor at the door's middle, on the wall. 0.86 x 2.06 m clear.
@piece
def puerta_fondo(name):
    obs = []; w, h, aw = 0.43, 2.06, 0.085
    ARCH = [(0.0, 0.0), (-0.012, 0.0), (-0.02, 0.006), (-0.032, 0.012), (-0.036, 0.03), (-0.03, 0.045), (-0.03, 0.07), (-0.022, 0.08), (-0.012, 0.085), (0.0, 0.085)]
    top = sweep_x([(y, h + z) for y, z in ARCH], -w - aw, w + aw, 'wood'); obs.append(top)
    for sx in (-1, 1):
        j = sweep_z([(sx * (w + z), y) for y, z in ARCH], 0.0, h + 0.002, 'wood'); obs.append(j)
    obs.append(box(-w + 0.004, w - 0.004, -0.008, 0.0, 0.006, h - 0.004, 'wood', 0.0, (0.8, 0.8, 0.8)))                    # the leaf's slab: the sunk fields
    rails = [(0.006, 0.16), (0.70, 0.82), (1.42, 1.54), (1.94, h - 0.004)]
    for x0, x1 in ((-w + 0.004, -w + 0.078), (w - 0.078, w - 0.004), (-0.032, 0.032)): obs.append(box(x0, x1, -0.022, -0.008, 0.006, h - 0.004, 'wood', 0.002))
    for z0, z1 in rails: obs.append(box(-w + 0.078, w - 0.078, -0.0215, -0.008, z0, z1, 'wood', 0.002))
    for (pz0, pz1) in ((0.16, 0.70), (0.82, 1.42), (1.54, 1.94)):
        for x0, x1 in ((-w + 0.078, -0.032), (0.032, w - 0.078)):
            obs.append(bevel(box(x0 + 0.022, x1 - 0.022, -0.018, -0.008, pz0 + 0.022, pz1 - 0.022, 'wood'), 0.008, 2, 30))   # a raised panel in each field
    for hz in (0.22, 1.05, 1.86): obs.append(tube([(w - 0.002, -0.019, hz - 0.045), (w - 0.002, -0.019, hz + 0.045)], 0.007, 8, 'iron'))
    obs.append(box(-w + 0.045, -w + 0.085, -0.02, -0.016, 0.94, 1.12, 'brass', 0.003))
    obs.append(tube(fillet([(-w + 0.065, -0.018, 1.05), (-w + 0.065, -0.05, 1.05), (-w + 0.17, -0.05, 1.05)], 0.012, 4), 0.0075, 8, 'brass'))
    obs.append(box(-w - 0.01, w + 0.01, -0.03, 0.0, 0.0, 0.012, 'trim', 0.003))
    return bake_ao(join(name, obs), 0.05, 0.65, wall=0.0, floor=0.0)

# A wall shelf of goods: a plank on two forged brackets, a metre long, and what a small shop keeps on it. Two
# assortments. Origin: the plank's top, at the wall. The goods carry their own colours (a label band on each can).
def lin(c): return tuple(x ** 2.2 for x in c)                 # (colours below are written as the eye reads them; the game's vertex colours are linear)
CAN = [lin(c) for c in [(0.78, 0.2, 0.15), (0.86, 0.68, 0.18), (0.2, 0.4, 0.26), (0.9, 0.88, 0.8), (0.72, 0.38, 0.14), (0.48, 0.14, 0.12), (0.82, 0.78, 0.58), (0.16, 0.24, 0.42)]]
def goods(r, kind, x):
    METAL = lin((0.66, 0.67, 0.68))
    if kind == 'can':
        rad, h, c = r.uniform(0.032, 0.046), r.uniform(0.095, 0.125), r.choice(CAN)
        o = lathe([(0, 0), (rad, 0), (rad + 0.0015, 0.004), (rad, 0.008), (rad, h - 0.008), (rad + 0.0015, h - 0.004), (rad, h), (rad - 0.004, h - 0.002), (0, h - 0.002)], 8, 'goods', lambda z: METAL if z < 0.01 or z > h - 0.01 else c)
        return at(o, x, -0.11 + r.uniform(-0.04, 0.03), 0.0), rad
    if kind == 'jar':
        rad, h = r.uniform(0.04, 0.052), r.uniform(0.13, 0.17); c = lin(r.choice([(0.55, 0.3, 0.1), (0.75, 0.6, 0.2), (0.4, 0.12, 0.08), (0.3, 0.36, 0.14)]))
        o = lathe([(0, 0), (rad * 0.92, 0), (rad, 0.01), (rad, h * 0.72), (rad * 0.86, h * 0.82), (rad * 0.8, h * 0.86), (rad * 0.84, h * 0.87), (rad * 0.84, h - 0.004), (rad * 0.78, h), (0, h)], 8, 'goods', lambda z: lin((0.7, 0.16, 0.12)) if z > h * 0.86 else c)
        return at(o, x, -0.11 + r.uniform(-0.04, 0.03), 0.0), rad
    if kind == 'bottle':
        rad, h = r.uniform(0.03, 0.038), r.uniform(0.22, 0.29); c = lin(r.choice([(0.14, 0.3, 0.14), (0.36, 0.2, 0.08), (0.6, 0.62, 0.56), (0.74, 0.5, 0.14)]))
        o = lathe([(0, 0), (rad * 0.9, 0), (rad, 0.012), (rad, h * 0.55), (rad * 0.72, h * 0.7), (rad * 0.36, h * 0.82), (rad * 0.34, h * 0.95), (rad * 0.42, h * 0.955), (rad * 0.42, h), (0, h)], 8, 'goods',
                  lambda z: lin((0.88, 0.85, 0.74)) if h * 0.2 < z < h * 0.5 else (lin((0.75, 0.6, 0.2)) if z > h * 0.95 else c))
        return at(o, x, -0.11 + r.uniform(-0.04, 0.04), 0.0), rad
    sx, sy, sz = r.uniform(0.05, 0.085), r.uniform(0.035, 0.06), r.uniform(0.1, 0.19); c = r.choice(CAN); s = r.uniform(0.85, 1.0)
    o = box(-sx, sx, -sy, sy, 0, sz, 'goods', 0.003, (c[0] * s, c[1] * s, c[2] * s))
    return at(rot(o, 'Z', r.uniform(-12, 12)), x, -0.11 + r.uniform(-0.03, 0.03), 0.0), sx
@piece
def repisa(name, mix):
    r = stream(name); obs = [bevel(box(-0.5, 0.5, -0.24, 0.0, -0.028, 0.0, 'wood'), 0.003, 1, 30)]
    for sx in (-0.34, 0.34):
        obs.append(box(sx - 0.016, sx + 0.016, -0.006, 0.0, -0.26, -0.028, 'iron', 0.0015)); obs.append(box(sx - 0.016, sx + 0.016, -0.2, 0.0, -0.034, -0.028, 'iron', 0.0015))
        obs.append(tube(fillet([(sx, -0.004, -0.24), (sx, -0.075, -0.17), (sx, -0.14, -0.1), (sx, -0.185, -0.036)], 0.03, 3), 0.005, 6, 'iron'))
    x = -0.46
    while x < 0.44:
        o, hw = goods(r, r.choice(mix), 0.0); x += hw; at(o, x, 0, 0); obs.append(o); x += hw + r.uniform(0.004, 0.03)
        if r.random() < 0.18: x += r.uniform(0.04, 0.1)
    return bake_ao(join(name, obs), 0.06, 0.6, wall=0.0)

# A fluorescent strip light hung from the joists on two rods: a folded steel body, two tubes in their holders.
# Origin: where the rods meet the ceiling, at the fitting's middle. 1.22 m long.
@piece
def lampara_tubo(name):
    obs = [bevel(sweep_x([(-0.07, -0.26), (0.07, -0.26), (0.045, -0.215), (-0.045, -0.215)], -0.61, 0.61, 'steel'), 0.002, 1, 30)]
    for sy in (-0.032, 0.032):
        obs.append(tube([(-0.585, sy, -0.279), (0.585, sy, -0.279)], 0.013, 10, 'bulb'))
        for sx in (-1, 1): obs.append(box(sx * 0.6 - 0.012, sx * 0.6 + 0.012, sy - 0.017, sy + 0.017, -0.298, -0.26, 'steel', 0.002))
    for sx in (-0.42, 0.42): obs.append(tube([(sx, 0, -0.215), (sx, 0, 0.0)], 0.0035, 6, 'iron'))
    return bake_ao(join(name, obs), 0.04, 0.5)

# ---------------------------------------------------------------------------------------------------- market hall ---
# A cast-iron column of the market hall, in three parts so it fits any height: the pedestal and base mouldings (0.9 m,
# from the floor), a fluted shaft (a metre, stretch z) and the capital (its top is the origin: a necking, a flared
# bell, a square abacus the beams sit on). The pedestal keeps inside the 0.34 m the plain column's base took.
def ring(prof, segs, slot, shade=None, phase=0.0):
    ob = lathe(prof, segs, slot, shade)
    return rot(ob, 'Z', phase) if phase else ob
@piece
def col_base(name):
    plinth = bevel(box(-0.168, 0.168, -0.168, 0.168, 0.0, 0.1, 'iron'), 0.008, 2, 30)
    ped = ring([(0.158, 0.1), (0.158, 0.13), (0.142, 0.15), (0.142, 0.56), (0.158, 0.58), (0.158, 0.62), (0.13, 0.66)], 8, 'iron', None, 22.5)
    mould = ring([(0.13, 0.66), (0.138, 0.675), (0.138, 0.695), (0.118, 0.715), (0.118, 0.73), (0.128, 0.745), (0.128, 0.765), (0.098, 0.8), (0.092, 0.86), (0.086, 0.9)], 20, 'iron')
    panels = []
    for k in range(8):                                                                    # a sunk panel on each face of the pedestal
        a = math.radians(45 * k); pn = bevel(box(-0.04, 0.04, -0.004, 0.004, 0.2, 0.5, 'iron'), 0.003, 1, 30)
        xf(pn, Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0, -0.134, 0))); panels.append(pn)
    return bake_ao(join(name, [plinth, ped, mould] + panels), 0.06, 0.65, floor=0.0)
@piece
def col_shaft(name):
    bm = bmesh.new(); n = 40; rings = []
    for z in (0.0, 1.0): rings.append([bm.verts.new(((0.086 if k % 2 else 0.078) * math.cos(2 * math.pi * k / n), (0.086 if k % 2 else 0.078) * math.sin(2 * math.pi * k / n), z)) for k in range(n)])
    col = bm.loops.layers.float_color.new('Col')
    for k in range(n):
        f = bm.faces.new((rings[0][k], rings[0][(k + 1) % n], rings[1][(k + 1) % n], rings[1][k]))
        for l in f.loops: s = 1.0 if (math.hypot(l.vert.co.x, l.vert.co.y) > 0.082) else 0.62; l[col] = (s, s, s, 1.0)
    outward(bm)
    return obj(name, bm, 'iron')
@piece
def col_cap(name):
    neck = ring([(0.086, -0.5), (0.098, -0.49), (0.098, -0.47), (0.086, -0.455), (0.086, -0.33), (0.1, -0.3), (0.108, -0.24), (0.13, -0.16), (0.165, -0.1), (0.172, -0.075), (0.15, -0.06)], 20, 'iron')
    leaves = []
    for k in range(8):                                                                    # eight cast leaves up the bell
        a = math.radians(45 * k + 22.5)
        lf = bevel(sweep_x([(-0.094, -0.3), (-0.112, -0.26), (-0.14, -0.17), (-0.178, -0.105), (-0.186, -0.115), (-0.15, -0.19), (-0.118, -0.27), (-0.1, -0.31)], -0.026, 0.026, 'iron'), 0.004, 1, 30)
        xf(lf, Matrix.Rotation(a, 4, 'Z')); leaves.append(lf)
    abacus = bevel(box(-0.17, 0.17, -0.17, 0.17, -0.06, 0.0, 'iron'), 0.008, 2, 30)
    return bake_ao(join(name, [neck, abacus] + leaves), 0.06, 0.65, ceil=0.0)

# A cast bracket from a column to the beam it carries: a quarter arch between two flanges with a pierced ring in the
# spandrel. Origin: the corner where the column's axis meets the beam's underside; it reaches 0.75 m out along +x and
# 0.75 m down, and stands 4 cm thick in the plane of the wall (y).
@piece
def col_bracket(name):
    obs = []; R, t = 0.75, 0.02
    arc = [Vector((0.09 + (R - 0.09) * (1 - math.cos(a)), 0, -R + (R - 0.02) * math.sin(a))) for a in [0.5 * math.pi * k / 12 for k in range(13)]]
    obs.append(tube(arc, 0.021, 8, 'iron'))                                                                # the arch's rib
    obs.append(box(0.085, R, -t, t, -0.026, -0.002, 'iron', 0.004))                                        # the flange under the beam
    obs.append(box(0.07, 0.095, -t, t, -R, -0.002, 'iron', 0.004))                                         # the flange down the column
    c = Vector((0.34, 0, -0.33))
    obs.append(tube([c + Vector((0.115 * math.cos(a), 0, 0.115 * math.sin(a))) for a in [2 * math.pi * k / 16 for k in range(17)]], 0.016, 6, 'iron'))   # the ring
    for a in (0.25, 0.75, 1.25, 1.75): obs.append(tube([c + Vector((0.115 * math.cos(a * math.pi), 0, 0.115 * math.sin(a * math.pi))), c + Vector((0.2 * math.cos(a * math.pi), 0, 0.2 * math.sin(a * math.pi)))], 0.012, 5, 'iron'))
    obs.append(tube([c + Vector((0.035 * math.cos(a), 0, 0.035 * math.sin(a))) for a in [2 * math.pi * k / 8 for k in range(9)]], 0.012, 5, 'iron'))
    for a in (0, 0.5, 1.0, 1.5): obs.append(tube([c + Vector((0.035 * math.cos(a * math.pi), 0, 0.035 * math.sin(a * math.pi))), c + Vector((0.115 * math.cos(a * math.pi), 0, 0.115 * math.sin(a * math.pi)))], 0.01, 5, 'iron'))
    return bake_ao(join(name, obs), 0.05, 0.6)

# A gusset plate where the members of a roof truss meet: 8 mm plate, riveted. It lies in the plane y = 0, 0.34 x 0.26 m
# about its origin; rivet heads on both faces.
@piece
def cartela(name):
    pl = bevel(sweep_z([(-0.17, -0.004), (0.17, -0.004), (0.17, 0.004), (-0.17, 0.004)], -0.13, 0.13, 'iron'), 0.002, 1, 40)
    rv = []
    for x in (-0.12, -0.04, 0.04, 0.12):
        for z in (-0.08, 0.0, 0.08):
            if abs(x) < 0.05 and z == 0.0: continue
            for sy in (-1, 1): rv.append(at(rot(lathe([(0, 0), (0.008, 0), (0.0065, 0.004), (0, 0.0055)], 6, 'iron'), 'X', 90 * sy), x, -0.004 * sy, z))
    return bake_ao(join(name, [pl] + rv), 0.03, 0.5)

# ---------------------------------------------------------------------------------------------------- canopy ---------
# Under a cantilevered concrete canopy (marquesina): a tapered rib from the wall to the edge, and a bulkhead light.
# The rib's origin is the wall face at the slab's underside; it runs out 1.3 m (-y), 34 cm deep at the wall.
@piece
def marq_rib(name):
    return bake_ao(bevel(sweep_x([(0.02, 0.0), (-1.3, 0.0), (-1.3, -0.07), (-0.9, -0.12), (-0.25, -0.3), (0.02, -0.34)], -0.06, 0.06, 'trim'), 0.012, 2, 30), 0.1, 0.6, wall=0.0, ceil=0.0)
@piece
def plafon(name):
    base = lathe([(0.0, 0.0), (0.105, 0.0), (0.105, -0.022), (0.092, -0.03), (0.092, -0.022), (0.0, -0.022)], 16, 'iron')
    glass = lathe([(0.09, -0.024), (0.086, -0.05), (0.066, -0.08), (0.03, -0.097), (0.0, -0.1)], 14, 'bulb')
    cage = [tube([Vector((0.097 * math.cos(a), 0.097 * math.sin(a), -0.028)), Vector((0.075 * math.cos(a), 0.075 * math.sin(a), -0.085)), Vector((0.0, 0.0, -0.112))], 0.004, 5, 'iron') for a in [math.pi * k / 3 for k in range(6)]]
    return bake_ao(join(name, [base, glass] + cage), 0.03, 0.5, ceil=0.0)

# ---------------------------------------------------------------------------------------------------- awning ---------
# A shop awning's frame: steel tube, 38 mm, a metre long (stretch x) with a pressed cap at each end; the roller the
# cloth winds onto, in its two end brackets (a metre wide, stretch x; origin on the wall at the roller's axis height);
# and the wall bracket an arm pins to: a bolted plate with a clevis.
@piece
def tubo_x(name):
    t = tube([(-0.5, 0, 0), (0.5, 0, 0)], 0.019, 10, 'steel')
    caps = [at(rot(lathe([(0, 0), (0.0215, 0), (0.0215, 0.012), (0.017, 0.016), (0, 0.016)], 10, 'steel'), 'Y', 90 * sx), sx * 0.492, 0, 0) for sx in (-1, 1)]
    return bake_ao(join(name, [t] + caps), 0.03, 0.4)
@piece
def toldo_cassette(name):
    roll = tube([(-0.5, -0.07, 0), (0.5, -0.07, 0)], 0.042, 12, 'steel')
    hood = sweep_x([(0.0, 0.07), (-0.1, 0.07), (-0.13, 0.05), (-0.135, 0.01), (-0.128, 0.01), (-0.124, 0.046), (-0.098, 0.063), (0.0, 0.063)], -0.5, 0.5, 'steel')
    return bake_ao(join(name, [roll, hood]), 0.05, 0.6, wall=0.0)
@piece
def toldo_soporte(name):
    plate = bevel(box(-0.04, 0.04, -0.008, 0.0, -0.065, 0.065, 'iron'), 0.002, 1, 30)
    lugs = [bevel(box(sx * 0.022 - 0.004, sx * 0.022 + 0.004, -0.06, -0.008, -0.022, 0.022, 'iron'), 0.003, 1, 30) for sx in (-1, 1)]
    pin = tube([(-0.034, -0.04, 0), (0.034, -0.04, 0)], 0.006, 7, 'iron')
    bolts = [at(rot(lathe([(0, 0), (0.008, 0), (0.008, 0.004), (0.0055, 0.0065), (0, 0.0065)], 6, 'iron'), 'X', 90), sx * 0.026, -0.008, sz * 0.048) for sx in (-1, 1) for sz in (-1, 1)]
    return bake_ao(join(name, [plate, pin] + lugs + bolts), 0.03, 0.6, wall=0.0)

# ---------------------------------------------------------------------------------------------------- roof spout -----
# A clay spout through the parapet (gárgola de barro): a half-round channel on a stone bracket, throwing the roof's
# water clear of the wall. Origin: the wall face at roof level; it runs out 0.48 m and falls a little.
@piece
def gargola(name):
    bm = bmesh.new(); n, R, t = 8, 0.062, 0.012; rings = []
    for d in (0.06, -0.18, -0.48):
        z = (d - 0.06) * 0.1 if d < 0 else 0.0; flare = 1.0 if d > -0.4 else 1.08
        inner = [(R * flare * math.cos(math.pi + math.pi * k / n), d, z + 0.05 + R * flare * math.sin(math.pi + math.pi * k / n) + (d * 0.1 if d < 0 else 0)) for k in range(n + 1)]
        outer = [((R + t) * flare * math.cos(math.pi + math.pi * k / n), d, z + 0.05 + (R + t) * flare * math.sin(math.pi + math.pi * k / n) + (d * 0.1 if d < 0 else 0)) for k in range(n + 1)]
        rings.append([bm.verts.new(p) for p in inner + outer[::-1]])
    m = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for k in range(m): j = (k + 1) % m; poly(bm, (a[k], a[j], b[j], b[k]))
    poly(bm, rings[0][::-1]); poly(bm, rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    spout = obj('_s', bm, 'clay')
    bracket = bevel(sweep_x([(0.02, -0.14), (-0.04, -0.14), (-0.07, -0.1), (-0.16, -0.045), (-0.16, -0.02), (0.02, -0.02)], -0.05, 0.05, 'trim'), 0.006, 2, 30)
    return bake_ao(join(name, [spout, bracket]), 0.06, 0.6, wall=0.0)

# ---------------------------------------------------------------------------------------------------- build ----------
cortina_slats('cortina_slats'); cortina_guide('cortina_guide'); cortina_bar('cortina_bar'); cortina_handle('cortina_handle'); cortina_lock('cortina_lock')
cortina_box('cortina_box'); cortina_cap('cortina_cap'); cortina_roll('cortina_roll'); lamina_sheet('lamina_sheet'); perfil_x('perfil_x'); perfil_z('perfil_z')
bisagra('bisagra'); pasador('pasador'); reja_calle('reja_calle'); zocalo('zocalo'); boveda('boveda'); vigueta('vigueta'); dado('dado'); puerta_fondo('puerta_fondo')
puerta_metal('puerta_metal'); repisa('repisa_a', ['can', 'can', 'can', 'jar', 'box', 'box']); repisa('repisa_b', ['bottle', 'bottle', 'jar', 'can', 'box']); lampara_tubo('lampara_tubo'); gargola('gargola')
col_base('col_base'); col_shaft('col_shaft'); col_cap('col_cap'); col_bracket('col_bracket'); cartela('cartela'); marq_rib('marq_rib'); plafon('plafon'); tubo_x('tubo_x'); toldo_cassette('toldo_cassette'); toldo_soporte('toldo_soporte')

for ob in pieces: ob.location = (0, 0, 0)
print('ARCH pieces (triangles):', ', '.join(f'{ob.name} {tri_count(ob)}' for ob in pieces))
for ob in bpy.data.objects: ob.select_set(ob in pieces)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
if ONLY: print('ARCH --only: previews only, nothing exported')                 # (a partial set must never replace the GLB)
else:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_normals=True, export_texcoords=False, export_materials='EXPORT', export_vertex_color='ACTIVE', export_tangents=False)
    print('ARCH written', OUT)

if PREVIEW:                                                     # one render per piece, framed to its bounds
    os.makedirs(PREVIEW, exist_ok=True)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 50
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35)); scene.collection.objects.link(sun)
    scene.render.engine = 'BLENDER_WORKBENCH'; scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True; scene.display.shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 800, 620
    for ob in pieces:
        for o in pieces: o.hide_render = o is not ob
        bpy.context.view_layer.update()
        pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        c = sum(pts, Vector()) / 8; rad = max((p - c).length for p in pts)
        d = Vector((0.7, -1.3, 0.55)).normalized()
        if ob.name in ('boveda', 'vigueta', 'lampara_tubo', 'plafon', 'marq_rib'): d = Vector((0.7, -1.2, -0.8)).normalized()       # (seen from below, as in a room)
        cam.location = c + d * rad / math.tan(cam.data.angle / 2) * 1.08
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.clip_start = rad * 0.01; cam.data.clip_end = rad * 50
        scene.render.filepath = os.path.join(PREVIEW, ob.name + '.png')
        bpy.ops.render.render(write_still=True)
    print('ARCH previews', PREVIEW)
