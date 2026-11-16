# Detail pieces for Market District (the 2026-11-16 detail pass), modelled procedurally in Blender and exported as one
# GLB, assets/kit/props.glb. The game draws them within the kit's near distance in place of the plain geometry it still
# builds for farther off (src/builder.js swap(); the old code keeps every random draw, so the map plays the same).
#   /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/props.py -- \
#       assets/kit/props.glb [--preview captures/props] [--only pebble_a,cart]
#
# Axes as in kit.py: Blender x = three.js X, Blender z = up (three Y), Blender -y = three +Z. Each piece is placed in the
# game by its origin (given with the piece) and stays inside the space the old geometry took (tools/detail-check.js
# holds every envelope and triangle cap). Material slots are named for what they stand in for; the game maps each slot to
# one of its own materials per placement. Unlike the kit, these pieces carry texture coordinates (used by the slots the
# game maps by the piece's own UVs: leaves, bark, paper; Blender's v-up convention, as the game's canvas textures are
# drawn) and an RGBA colour layer: RGB a shade multiplying the game's tint, A how freely the vertex moves in the wind
# (0 at a trunk, 1 at a leaf tip). Every piece draws from its own random stream, named after it, so reshaping one
# never changes another.
import bpy, bmesh, math, random, sys, os, zlib
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith('--') else 'assets/kit/props.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
ONLY = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# slot -> the colour it shows in the preview renders (the game's materials replace them)
SHOW = {'stone': (0.62, 0.6, 0.56), 'burlap': (0.62, 0.5, 0.34), 'spice': (0.8, 0.45, 0.15), 'concrete': (0.66, 0.65, 0.62),
        'brick': (0.62, 0.3, 0.2), 'plaster': (0.86, 0.82, 0.72), 'iron': (0.3, 0.16, 0.1), 'gravel': (0.55, 0.52, 0.47),
        'body': (0.9, 0.7, 0.2), 'steel': (0.75, 0.76, 0.78), 'tin': (0.6, 0.62, 0.6), 'rubber': (0.08, 0.08, 0.08), 'bottle': (0.7, 0.72, 0.7),
        'glass': (0.55, 0.7, 0.75), 'plastic': (0.9, 0.9, 0.88), 'pot': (0.78, 0.8, 0.82), 'wood': (0.45, 0.4, 0.35), 'tank': (0.62, 0.64, 0.62), 'porcelain': (0.92, 0.93, 0.95), 'chile': (0.6, 0.06, 0.04), 'stem': (0.42, 0.4, 0.2)}
MATS = {}
def mat(name):
    if name not in MATS:
        m = bpy.data.materials.new(name); m.diffuse_color = (*SHOW.get(name, (0.7, 0.7, 0.7)), 1.0); MATS[name] = m
    return MATS[name]

def stream(name):
    return random.Random(zlib.crc32(name.encode()))

def only(ob):
    for o in bpy.context.selected_objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob

class Piece:
    """A mesh under construction. Every face carries a material slot, texture coordinates and an RGBA colour per corner."""
    def __init__(self, name):
        self.name, self.bm, self.slots = name, bmesh.new(), []
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = self.bm.loops.layers.float_color.new('Col')

    def vert(self, co):
        return self.bm.verts.new(co)

    def face(self, verts, slot, uvs=None, cols=None):
        """verts: BMVerts; uvs: one (u, v) per corner; cols: one (r, g, b[, a]) for all corners, or one per corner."""
        try: f = self.bm.faces.new(verts)
        except ValueError: return None
        if slot not in self.slots: self.slots.append(slot)
        f.material_index = self.slots.index(slot)
        for i, l in enumerate(f.loops):
            if uvs: l[self.uv].uv = uvs[i]
            c = cols[i] if isinstance(cols, list) else (cols or (1.0, 1.0, 1.0, 1.0))
            l[self.col] = tuple(c) if len(c) == 4 else (*c, 1.0)
        return f

    def merge(self, bm, slot, col=None, uv=None, matrix=None):
        """Copy a finished bmesh in, placed by matrix. col: one rgba for all, or col(co, normal) -> rgba asked per corner;
        uv(co, normal) -> (u, v); both see the bmesh's own frame (before the matrix)."""
        vs = [self.vert(matrix @ v.co if matrix else v.co) for v in bm.verts]
        bm.verts.index_update()
        for f in bm.faces:
            f.normal_update()
            cs = [v.co for v in f.verts]
            self.face([vs[v.index] for v in f.verts], slot,
                      [uv(c, f.normal) for c in cs] if uv else None,
                      [col(c, f.normal) for c in cs] if callable(col) else col)

    def build(self, smooth=40):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        self.bm.to_mesh(me); self.bm.free()
        for s in self.slots: me.materials.append(mat(s))
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.active_color_index   # (the exporter takes the render colour: without it every colour is written as 1)
        ob = bpy.data.objects.new(self.name, me); scene.collection.objects.link(ob)
        only(ob); bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth), keep_sharp_edges=True)
        return ob

def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

pieces = []
PREVIEW_SCALE = {}                                                    # piece -> scale for its preview (a unit piece shown at its real size)
PREVIEW_FOCUS = {}                                                    # piece -> (lo, hi): frame only that part of it in the preview
def piece(fn):
    """Register a piece builder: fn(name) -> object. --only skips the others (for a quick look at one piece)."""
    def run(name, *a):
        if ONLY and name not in ONLY: return None
        ob = fn(name, *a); pieces.append(ob); return ob
    return run

def revolve(P, prof, segs, slot, disp=None, col=None, slots=None, uv=None, matrix=None):
    """A surface of revolution about z into piece P. prof: [(r, z)] from the bottom up (r = 0 ends close to the axis).
    disp(a, i, r, z) -> (dr, dz) bends each ring vertex (a = angle, i = profile index); col(a, i, co) -> rgba;
    slots(i) -> the slot of the band between profile points i and i + 1 (default: slot); uv(a, i, co) -> (u, v);
    matrix places the result (col and uv see it unplaced)."""
    rings = []
    for i, (r0, z0) in enumerate(prof):
        ring = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            dr, dz = disp(a, i, r0, z0) if disp else (0.0, 0.0)
            r = max(0.0, r0 + dr) if r0 > 0 else 0.0
            ring.append(Vector((r * math.cos(a), r * math.sin(a), z0 + dz)))
        rings.append(ring)
    M = matrix or Matrix.Identity(4)
    vs = [[P.vert(M @ c) for c in ring] if prof[i][0] > 0 else [P.vert(M @ (sum(ring, Vector()) / segs))] for i, ring in enumerate(rings)]
    local = {id(v): c for ring, cs in zip(vs, rings) for v, c in zip(ring, cs if len(ring) > 1 else [sum(cs, Vector()) / segs])}
    for i in range(len(prof) - 1):
        A, Bv, s = vs[i], vs[i + 1], slots(i) if slots else slot
        for j in range(segs):
            k = (j + 1) % segs
            a0, a1 = 2 * math.pi * j / segs, 2 * math.pi * (j + 1) / segs      # (a1 reaches 2 pi on the last: u does not wrap)
            quad = []
            for ring, idx, a, ii in ((A, j, a0, i), (A, k, a1, i), (Bv, k, a1, i + 1), (Bv, j, a0, i + 1)):
                v = ring[0] if len(ring) == 1 else ring[idx]
                if not any(v is q[0] for q in quad): quad.append((v, a, ii))     # (a point on the axis is used once)
            if len(quad) < 3: continue
            P.face([q[0] for q in quad], s, [uv(q[1], q[2], local[id(q[0])]) for q in quad] if uv else None,
                   [col(q[1], q[2], local[id(q[0])]) for q in quad] if col else None)
    return vs

def prism(pts, z0, z1, jitter=None):
    """A slab: the polygon pts [(x, y)] (anticlockwise) from z0 up to z1; jitter(i) -> dz lifts each top corner."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in pts]; hi = [bm.verts.new((x, y, z1 + (jitter(i) if jitter else 0))) for i, (x, y) in enumerate(pts)]
    bm.faces.new(lo[::-1]); bm.faces.new(hi)
    for i in range(len(pts)): j = (i + 1) % len(pts); bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    return bm

def blob(r, size, sub=1, rough=0.25):
    """A small stone: an icosahedron (20 faces) or, sub 2, an 80-face icosphere, roughened."""
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=size)
    for v in bm.verts: v.co *= 1 + rough * r.uniform(-1, 1)
    return bm

def tube(P, pts, rad, sides, slot, col=None):
    """A bar along the polyline pts (Vectors) into piece P, capped at both ends."""
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        u = t.cross(Vector((0, 0, 1))); u = u.normalized() if u.length > 1e-6 else Vector((1, 0, 0)); w = t.cross(u)
        rings.append([P.vert(p + (u * math.cos(2 * math.pi * k / sides) + w * math.sin(2 * math.pi * k / sides)) * rad) for k in range(sides)])
    for i in range(len(rings) - 1):
        for k in range(sides): P.face((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]), slot, cols=col)
    P.face(rings[0][::-1], slot, cols=col); P.face(rings[-1], slot, cols=col)

def cube(lo, hi):
    """A box from corner lo to corner hi, as a bmesh."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector(((lo[a] + hi[a]) / 2 + v.co[a] * (hi[a] - lo[a]) for a in range(3)))
    return bm

def rrect(hx, hy, rad, z, n=4, cx=0.0, cy=0.0):
    """A closed rounded rectangle path at height z (first point repeated at the end)."""
    pts = []
    for qx, qy, a0 in ((hx - rad, hy - rad, 0), (-hx + rad, hy - rad, 90), (-hx + rad, -hy + rad, 180), (hx - rad, -hy + rad, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n); pts.append(Vector((cx + qx + rad * math.cos(a), cy + qy + rad * math.sin(a), z)))
    return pts + [pts[0]]

def rivet(P, c, n, slot, rad=0.006, h=0.004, col=None):
    """A round rivet head (a low six-sided cone) on a surface at c facing n."""
    n = n.normalized(); u = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized(); w = n.cross(u)
    ring = [P.vert(c + (u * math.cos(k * math.pi / 3) + w * math.sin(k * math.pi / 3)) * rad) for k in range(6)]; tip = P.vert(c + n * h)
    for k in range(6): P.face((ring[k], ring[(k + 1) % 6], tip), slot, cols=col)

def torus(P, c, axis, R, rs, segs, sides, slot, col=None, bump=None):
    """A ring of radius R about the axis through c, its section a circle of radius rs (sides corners); bump(a) -> extra
    radius on the outside (a tyre's tread)."""
    axis = axis.normalized(); u = axis.cross(Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))).normalized(); w = axis.cross(u)
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs; d = u * math.cos(a) + w * math.sin(a); o = c + d * R
        rings.append([P.vert(o + (d * math.cos(2 * math.pi * k / sides) + axis * math.sin(2 * math.pi * k / sides)) * (rs + (bump(a) if bump and math.cos(2 * math.pi * k / sides) > 0.3 else 0))) for k in range(sides)])
    for i in range(segs):
        A, B = rings[i], rings[(i + 1) % segs]
        for k in range(sides): P.face((A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]), slot, cols=col)

def frame(d):
    """Two unit vectors square to d and to each other."""
    d = d.normalized(); u = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized(); return u, d.cross(u)

def band(P, o, d, rings, segs, slot, urep=1.0, col=None):
    """A ring band about the axis from o along d: rings [(t, radius, v, rgba)] (t along d); radius 0 closes to a point.
    u runs round urep times (the seam's vertices are doubled, so it does not wrap)."""
    d = d.normalized(); u, w = frame(d)
    vs = []
    for t, rad, v, c in rings:
        if rad <= 0: vs.append([(P.vert(o + d * t), j / segs * urep, v, c) for j in range(segs + 1)]); continue
        vs.append([(P.vert(o + d * t + (u * math.cos(2 * math.pi * j / segs) + w * math.sin(2 * math.pi * j / segs)) * rad), j / segs * urep, v, c) for j in range(segs + 1)])
    for i in range(len(rings) - 1):
        for j in range(segs):
            q = [vs[i][j], vs[i][j + 1], vs[i + 1][j + 1], vs[i + 1][j]]
            if rings[i + 1][1] <= 0: q = q[:3]
            elif rings[i][1] <= 0: q = [q[0], q[2], q[3]]
            P.face([e[0] for e in q], slot, uvs=[(e[1], e[2]) for e in q], cols=[e[3] for e in q])

def fit_box(bm, lo, hi):
    """Scale and move a bmesh, each axis on its own, so its bounds are exactly lo..hi."""
    mn = [min(v.co[a] for v in bm.verts) for a in range(3)]; mx = [max(v.co[a] for v in bm.verts) for a in range(3)]
    for v in bm.verts:
        v.co = Vector([lo[a] + (v.co[a] - mn[a]) / max(1e-9, mx[a] - mn[a]) * (hi[a] - lo[a]) for a in range(3)])

# ---------------------------------------------------------------------------------------------------- pebbles ----------
# Pebbles (dressing.js scatter): the game places the old unit box by a matrix that stretches it into a flat or long stone
# and tilts it; a pebble here fills that same unit box (centred on the origin), so it lies where the box did. A lumpy
# icosphere (80 triangles) with two or three facets knocked flat where it chipped. Slot: stone.
@piece
def pebble(name):
    r = stream(name); bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.5)  # (bmesh counts the bare icosahedron as 1: 2 is 80 faces)
    off = Vector((r.uniform(0, 50), r.uniform(0, 50), r.uniform(0, 50)))
    for v in bm.verts: v.co *= 1.0 + 0.17 * noise.noise(v.co * 2.4 + off)
    for _ in range(r.randint(2, 3)):                          # chips: everything beyond a plane pressed onto it
        n = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.5, 1.0))).normalized(); d = r.uniform(0.26, 0.38)
        for v in bm.verts:
            e = v.co.dot(n) - d
            if e > 0: v.co -= n * e
    fit_box(bm, (-0.5, -0.5, -0.5), (0.5, 0.5, 0.5))
    P = Piece(name)
    P.merge(bm, 'stone', col=lambda c, n: (*(0.86 + 0.18 * (0.5 + 0.5 * noise.noise(c * 5.0 + off)),) * 3, 1.0))
    bm.free()
    return P.build(smooth=48)

for k in 'abcd': pebble('pebble_' + k)

# ---------------------------------------------------------------------------------------------------- spice sacks ------
# A burlap sack of spice (dressing.js sack()), standing on the ground at the origin inside the old lathe's 0.275 m radius
# and 0.5 m height: the cloth slumps and creases more towards the neck, its mouth is rolled down into a cuff, and the
# spice is heaped in it. One closed profile turned about the axis: up the outside, over the cuff, down the inside, across
# the spice. Slots: burlap (world-projected weave), spice (tinted per sack by the game). Two variants.
SACKS = {
    'sack_a': [(0.0, 0.0), (0.12, 0.0), (0.2, 0.004), (0.235, 0.025), (0.258, 0.07), (0.27, 0.14), (0.272, 0.21), (0.268, 0.28),
               (0.258, 0.34), (0.248, 0.395), (0.252, 0.425), (0.266, 0.447), (0.271, 0.468), (0.264, 0.484), (0.25, 0.49),
               (0.236, 0.482), (0.228, 0.462), (0.224, 0.442), (0.205, 0.44), (0.16, 0.452), (0.1, 0.47), (0.04, 0.488), (0.0, 0.495)],
    'sack_b': [(0.0, 0.0), (0.14, 0.0), (0.218, 0.006), (0.25, 0.03), (0.268, 0.08), (0.275, 0.13), (0.272, 0.19), (0.262, 0.25),
               (0.25, 0.31), (0.24, 0.36), (0.244, 0.39), (0.258, 0.41), (0.264, 0.43), (0.258, 0.447), (0.244, 0.452),
               (0.23, 0.444), (0.222, 0.425), (0.218, 0.406), (0.2, 0.404), (0.155, 0.415), (0.1, 0.432), (0.04, 0.45), (0.0, 0.456)],
}
@piece
def sack(name):
    r = stream(name); prof = SACKS[name]; SPICE0 = 17                   # bands from profile point 17 on are spice
    ph = [r.uniform(0, 6.283) for _ in range(6)]; freq = [r.choice((5, 6, 7)), r.choice((9, 11)), r.choice((13, 15, 17))]
    off = Vector((r.uniform(0, 50), r.uniform(0, 50), r.uniform(0, 50)))
    def fold(a, z):                                                       # creases: a little near the base, more under the cuff
        k = 0.0035 + 0.011 * min(1.0, max(0.0, (z - 0.12) / 0.28)) ** 1.5
        return k * (math.sin(freq[0] * a + ph[0]) + 0.6 * math.sin(freq[1] * a + ph[1] + z * 9) + 0.35 * math.sin(freq[2] * a + ph[2] - z * 14))
    def disp(a, i, r0, z0):
        if i >= SPICE0 + 1:                                                # the heap: granular, a little uneven
            return 0.0, 0.007 * noise.noise(Vector((math.cos(a) * r0, math.sin(a) * r0, 0)) * 26 + off) + 0.004 * math.sin(2 * a + ph[3])
        dr = fold(a, z0) + 0.007 * math.sin(a + ph[4]) * (1 - z0 / 0.5)    # slumped a little to one side
        dz = 0.006 * math.sin(4 * a + ph[5]) * (1 if 10 <= i <= 15 else 0)  # the cuff does not lie level
        return min(dr, 0.279 - r0), dz
    def col(a, i, co):
        if i >= SPICE0 + 1 or (i == SPICE0 and co.z < 0.45 and math.hypot(co.x, co.y) < 0.215):
            g = 0.78 + 0.32 * (0.5 + 0.5 * noise.noise(co * 60 + off)); return (g, g, g, 1.0)
        s = 0.9 + 22 * fold(a, co.z)                                       # fold valleys darker, ridges lighter
        if co.z < 0.08: s *= 0.82 + 0.18 * co.z / 0.08                      # dirt at the foot
        if 10 <= i <= 15: s *= 1.06                                         # the cuff, rolled out, cleaner
        return (s, s * 0.98, s * 0.94, 1.0)
    P = Piece(name)
    revolve(P, prof, 36, 'burlap', disp=disp, col=col, slots=lambda i: 'spice' if i >= SPICE0 else 'burlap')
    return P.build(smooth=55)

for k in SACKS: sack(k)

# ---------------------------------------------------------------------------------------------------- street carts -----
# A street vendor's push cart (quarter.js cart(), four of them): origin on the ground under its middle, X along it, the
# side the game paints its sign on towards -y (three.js +Z). The body keeps the old box (x +-0.75, y +-0.4, z 0.4-1.1),
# its front flat at 0.405 m behind the sign, and the game tints it with each cart's colour: painted sheet metal with
# rounded corners, rolled edges and rivets, a service door at the back. A stainless counter with a rail, a pot and two
# plastic tubs on it; a corrugated tin roof on four posts; two bicycle wheels on an axle (28 spokes, hub, treaded tyre), a caster at
# the front, a push bar with rubber grips at the back, a gas bottle on a wire shelf under the body.
# Slots: body, steel, tin, iron, rubber, bottle, plastic, pot.
@piece
def cart(name):
    r = stream(name); P = Piece(name); W = (1.0, 1.0, 1.0, 1.0)
    bm = cube((-0.75, -0.4, 0.4), (0.75, 0.4, 1.1))                              # the body
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.5], offset=0.025, segments=3, profile=0.5, affect='EDGES')
    P.merge(bm, 'body', col=lambda c, n: (*(0.78 + 0.22 * min(1.0, (c.z - 0.4) / 0.3),) * 3, 1.0)); bm.free()
    for z in (1.1, 0.4): tube(P, rrect(0.75, 0.4, 0.025, z), 0.009, 6, 'body', W)                 # rolled edges
    for y, ny in ((-0.4, -1), (0.4, 1)):                                                         # rivets along the seams
        for z in (0.43, 1.07):
            for k in range(15): rivet(P, Vector((-0.7 + k * 0.1, y, z)), Vector((0, ny, 0)), 'body', col=W)
    for x, nx in ((-0.75, -1), (0.75, 1)):
        for z in (0.43, 1.07):
            for k in range(7): rivet(P, Vector((x, -0.3 + k * 0.1, z)), Vector((nx, 0, 0)), 'body', col=W)
    door = [Vector((-0.45, 0.403, 0.5)), Vector((0.25, 0.403, 0.5)), Vector((0.25, 0.403, 1.0)), Vector((-0.45, 0.403, 1.0)), Vector((-0.45, 0.403, 0.5))]
    tube(P, door, 0.005, 4, 'body', W)                                                            # the service door at the back
    P.merge(cube((0.12, 0.403, 0.72), (0.2, 0.42, 0.74)), 'steel', col=W)                          # its handle
    bm = cube((-0.78, -0.43, 1.105), (0.78, 0.43, 1.13))                                         # the stainless counter
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.01], offset=0.03, segments=2, profile=0.5, affect='EDGES')
    P.merge(bm, 'steel', col=W); bm.free()
    rail = [Vector((-0.74, -0.39, 1.17)), Vector((-0.74, 0.39, 1.17)), Vector((0.74, 0.39, 1.17)), Vector((0.74, -0.39, 1.17))]
    tube(P, rail, 0.007, 6, 'steel', W)
    for v in rail: tube(P, [Vector((v.x, v.y, 1.13)), v], 0.006, 6, 'steel', W)
    revolve(P, [(0.0, 0.0), (0.2, 0.0), (0.215, 0.01), (0.22, 0.04), (0.22, 0.27), (0.228, 0.28), (0.23, 0.29), (0.215, 0.292), (0.205, 0.3),
                (0.12, 0.33), (0.03, 0.34), (0.03, 0.36), (0.0, 0.36)], 28, 'pot', matrix=Matrix.Translation((-0.42, 0.02, 1.13)))   # an aluminium pot, its lid on
    for y in (-0.25, 0.29): tube(P, [Vector((-0.42 - 0.06, 0.02 + y * 0.92, 1.37)), Vector((-0.42 - 0.05, 0.02 + y, 1.37)), Vector((-0.42 + 0.05, 0.02 + y, 1.37)), Vector((-0.42 + 0.06, 0.02 + y * 0.92, 1.37))], 0.007, 6, 'pot', W)
    for x0, shade in ((0.0, 1.0), (0.3, 0.86)):                                                  # two plastic tubs
        bm = cube((x0, -0.2, 1.13), (x0 + 0.24, 0.12, 1.29))
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.05], offset=0.03, segments=2, profile=0.5, affect='EDGES')
        P.merge(bm, 'plastic', col=(shade, shade, shade, 1.0)); bm.free()
        tube(P, rrect(0.122, 0.162, 0.03, 1.29, cx=x0 + 0.12, cy=-0.04), 0.007, 4, 'plastic', (shade, shade, shade, 1.0))   # rolled rim
    for x, y in ((-0.7, -0.38), (0.7, -0.38), (-0.7, 0.38), (0.7, 0.38)):                        # roof posts and rafters
        tube(P, [Vector((x, y, 1.13)), Vector((x, y, 2.03))], 0.015, 8, 'iron', W)
    for y in (-0.38, 0.38): tube(P, [Vector((-0.72, y, 2.025)), Vector((0.72, y, 2.025))], 0.012, 6, 'iron', W)
    nx, ny = 96, 6                                                                                # the roof: corrugated tin, a little arched
    roof = [[P.vert((-0.9 + 1.8 * i / nx, -0.525 + 1.05 * j / ny, 2.045 + 0.022 * (1 - ((-0.525 + 1.05 * j / ny) / 0.525) ** 2) + 0.009 * math.sin(2 * math.pi * i / 4))) for j in range(ny + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(ny):
            P.face((roof[i][j], roof[i + 1][j], roof[i + 1][j + 1], roof[i][j + 1]), 'tin', cols=(r.uniform(0.92, 1.0),) * 3 + (1.0,))
    def wheel(c, R, spokes=True, side=1):
        ax = Vector((0, 1, 0))
        torus(P, c, ax, R - 0.022, 0.022, 48, 8, 'rubber', W, bump=lambda a: 0.003 if math.sin(a * 36) > 0 else 0.0)   # tyre and tread
        if spokes:
            torus(P, c, ax, R - 0.05, 0.011, 48, 4, 'iron', W)                                      # rim
            for k in range(28):                                                                    # spokes, crossed, from both flanges
                a = 2 * math.pi * k / 28; f = 1 if k % 2 else -1
                hub = c + Vector((0.035 * math.cos(a + 0.4 * f), 0.022 * f, 0.035 * math.sin(a + 0.4 * f)))
                tube(P, [hub, c + Vector(((R - 0.055) * math.cos(a), 0, (R - 0.055) * math.sin(a)))], 0.0015, 3, 'iron', W)
            for yy in (-0.022, 0.022): torus(P, c + Vector((0, yy, 0)), ax, 0.028, 0.008, 10, 4, 'steel', W)   # flanges
        tube(P, [c + Vector((0, -0.04, 0)), c + Vector((0, 0.04, 0))], 0.018 if spokes else 0.014, 8, 'steel', W)      # hub
    for y in (-0.42, 0.42): wheel(Vector((-0.55, y, 0.3)), 0.28)
    tube(P, [Vector((-0.55, -0.47, 0.3)), Vector((-0.55, 0.47, 0.3))], 0.011, 8, 'steel', W)        # axle
    for y in (-0.36, 0.36): tube(P, [Vector((-0.62, y, 0.405)), Vector((-0.55, y, 0.3)), Vector((-0.48, y, 0.405))], 0.008, 4, 'iron', W)
    wheel(Vector((0.6, 0.0, 0.11)), 0.11, spokes=False)                                            # the caster at the front
    for y in (-0.03, 0.03): tube(P, [Vector((0.6, y, 0.4)), Vector((0.6, y, 0.11))], 0.007, 4, 'iron', W)
    for y in (-0.36, 0.36):                                                                        # the push bar
        tube(P, [Vector((-0.74, y, 0.98)), Vector((-0.86, y, 1.02)), Vector((-0.895, y, 1.04))], 0.013, 8, 'steel', W)
    tube(P, [Vector((-0.895, -0.36, 1.04)), Vector((-0.895, 0.36, 1.04))], 0.013, 8, 'steel', W)
    for y0, y1 in ((-0.36, -0.22), (0.22, 0.36)): tube(P, [Vector((-0.895, y0, 1.04)), Vector((-0.895, y1, 1.04))], 0.017, 8, 'rubber', W)
    shelf = rrect(0.42, 0.3, 0.02, 0.16)                                                           # a wire shelf under the body...
    tube(P, shelf, 0.005, 4, 'iron', W)
    for k in range(7): x = -0.36 + k * 0.12; tube(P, [Vector((x, -0.3, 0.16)), Vector((x, 0.3, 0.16))], 0.003, 3, 'iron', W)
    for x, y in ((-0.4, -0.28), (0.4, -0.28), (-0.4, 0.28), (0.4, 0.28)): tube(P, [Vector((x, y, 0.16)), Vector((x, y, 0.4))], 0.005, 4, 'iron', W)
    revolve(P, [(0.0, 0.0), (0.09, 0.0), (0.105, 0.012), (0.11, 0.03), (0.11, 0.15), (0.1, 0.18), (0.075, 0.2), (0.04, 0.208), (0.04, 0.215),
                (0.02, 0.215), (0.02, 0.235), (0.0, 0.235)], 20, 'bottle', matrix=Matrix.Translation((0.12, 0.0, 0.165)))   # ...and its gas bottle
    return P.build(smooth=40)

cart('cart')

# ---------------------------------------------------------------------------------------------------- rubble heaps -----
# A heap of broken masonry (dressing.js rubble(), eight of them). Built for a nominal heap 1.5 m in radius and 0.62 m
# high, then scaled into a unit heap (radius 1, height 1, base on the ground at the origin) that the game stretches to
# each heap (r 1.1-1.8 m, h 0.5-0.75 m: every heap within 15 % of the nominal proportions), inside the old keep-out
# (1.25 r) and under 1.15 h. A dusty mound with a skirt of grit, and settled on it and on each other: slabs of broken
# concrete (the broken edges darker, the aggregate showing) with bent rebar out of them, whole and half bricks, bricks
# still mortared together, flakes of plaster painted on one face, and loose stones. Slots: concrete, brick, plaster,
# iron (rebar), gravel (the mound).
RUBBLE_R, RUBBLE_H = 1.5, 0.62
PAINT = [(0.95, 0.82, 0.55), (0.92, 0.9, 0.82), (0.72, 0.8, 0.62), (0.88, 0.6, 0.45), (0.96, 0.93, 0.86)]   # ochre, cream, sage, terracotta, white

# ---------------------------------------------------------------------------------------------------- utility poles ----
# Wooden utility poles carrying a transformer (dressing.js: five in the old district; quarter.js poles(): seven), origin
# at the foot, placed unturned. A tapered round pole, weathered with darker checks, and a cap; a crossarm on two braces
# carrying pin insulators; a transformer hung on the pole by straps, with porcelain bushings and leads up to the arm. In
# the old district the arm is turned 0.3 rad and the tank is a finned rectangular one where the old box was; in the
# quarter a finned round tank where the old cylinder was. Below 6 m nothing stands out of the pole's collider.
# Slots: wood (the piece's own texture coordinates, in metres), iron, tank, porcelain.
INSULATOR = [(0.0, 0.0), (0.016, 0.0), (0.02, 0.03), (0.055, 0.036), (0.06, 0.046), (0.034, 0.052), (0.03, 0.07), (0.05, 0.076),
             (0.052, 0.086), (0.034, 0.092), (0.028, 0.11), (0.018, 0.124), (0.0, 0.13)]
BUSHING = [(0.0, 0.0), (0.03, 0.0), (0.03, 0.02), (0.05, 0.03), (0.026, 0.045), (0.045, 0.06), (0.024, 0.075), (0.04, 0.09), (0.022, 0.1),
           (0.012, 0.12), (0.012, 0.14), (0.0, 0.14)]
@piece
def utility_pole(name, H, arm_z, arm_len, arm_yaw, tank):
    r = stream(name); P = Piece(name); W = (1.0, 1.0, 1.0, 1.0)
    sides, rows, rb, rt = 24, 14, 0.125, 0.092
    checks = [r.uniform(0, 2 * math.pi) for _ in range(6)]
    def shade(a, z):                                                     # weather checks: darker streaks up the pole, dirt at the foot
        d = min(min(abs(a - c), 2 * math.pi - abs(a - c)) for c in checks)
        return (0.62 if d < 0.09 else 1.0) * (0.75 + 0.25 * min(1.0, z / 0.6))
    rings = []
    for i in range(rows + 1):
        z = H * i / rows; rad = rb + (rt - rb) * i / rows
        rings.append([(P.vert((rad * math.cos(2 * math.pi * k / sides), rad * math.sin(2 * math.pi * k / sides), z)), 2 * math.pi * k / sides, z, rad) for k in range(sides + 1)])
    for i in range(rows):
        for k in range(sides):
            q = (rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k])
            P.face([c[0] for c in q], 'wood', uvs=[(c[1] * 0.11, c[2]) for c in q], cols=[(*(shade(c[1] % (2 * math.pi), c[2]),) * 3, 1.0) for c in q])
    top = P.vert((0, 0, H + 0.04))                                            # a weathered cap
    for k in range(sides): P.face((rings[-1][k][0], rings[-1][k + 1][0], top), 'wood', uvs=[(0, 0), (0.05, 0), (0.025, 0.05)], cols=(0.7, 0.7, 0.7, 1.0))
    Rz = Matrix.Rotation(arm_yaw, 4, 'Z')
    arm = cube((-arm_len / 2, -0.05, -0.05), (arm_len / 2, 0.05, 0.05))           # the crossarm, its grain along its length
    bmesh.ops.bevel(arm, geom=arm.edges[:], offset=0.008, segments=1, profile=0.5, affect='EDGES')
    P.merge(arm, 'wood', col=(0.85, 0.85, 0.85, 1.0), uv=lambda c, n: (c.x, c.z if abs(n.y) > 0.5 else c.y), matrix=Matrix.Translation((0, 0, arm_z)) @ Rz); arm.free()
    for sx in (-1, 1):                                                       # its two braces and through-bolts
        a0 = Rz @ Vector((sx * 0.5, 0.0, arm_z - 0.05)); b0 = Vector((math.cos(arm_yaw) * sx * 0.1, math.sin(arm_yaw) * sx * 0.1, arm_z - 0.62))
        tube(P, [a0, b0], 0.012, 4, 'iron', W)
    tube(P, [Rz @ Vector((0, -0.11, arm_z)), Rz @ Vector((0, 0.11, arm_z))], 0.009, 6, 'iron', W)
    pins = [Rz @ Vector((x, 0.0, arm_z + 0.05)) for x in (-0.7, -0.35, 0.35, 0.7)]
    for pin in pins:                                                         # pin insulators
        tube(P, [pin, pin + Vector((0, 0, 0.06))], 0.01, 6, 'iron', W)
        revolve(P, INSULATOR, 14, 'porcelain', matrix=Matrix.Translation(pin + Vector((0, 0, 0.04))))
    if tank == 'box':                                                        # the old district's: a finned rectangular tank, where the old box was
        x0, x1, y0, y1, z0, z1 = 0.14, 0.4, -0.13, 0.13, 6.32, 6.84
        bm = cube((x0, y0, z0), (x1, y1, z1)); P.merge(bm, 'tank', col=lambda c, n: (*(0.8 + 0.2 * (c.z - z0) / (z1 - z0),) * 3, 1.0)); bm.free()
        P.merge(cube((x0 - 0.01, y0 - 0.01, z1), (x1 + 0.01, y1 + 0.01, z1 + 0.03)), 'tank', col=W)
        for k in range(6):                                                   # radiator fins on both sides
            x = x0 + 0.03 + k * 0.04
            for sy in (-1, 1): P.merge(cube((x - 0.002, sy * 0.13, z0 + 0.06) if sy > 0 else (x - 0.002, -0.175, z0 + 0.06), (x + 0.002, 0.175, z1 - 0.06) if sy > 0 else (x + 0.002, -0.13, z1 - 0.06)), 'tank', col=(0.9, 0.9, 0.9, 1.0))
        bush = [Vector((0.27, -0.07, z1 + 0.03)), Vector((0.27, 0.07, z1 + 0.03))]
        straps = (6.45, 6.72); sx = x0
    else:                                                                    # the quarter's: a finned round tank, where the old cylinder was
        cx, z0, z1, rr = 0.4, 6.53, 7.21, 0.2
        revolve(P, [(0.0, 0.0), (rr, 0.0), (rr, z1 - z0 - 0.04), (rr + 0.012, z1 - z0 - 0.03), (rr + 0.012, z1 - z0 - 0.01), (rr * 0.8, z1 - z0 + 0.03), (0.0, z1 - z0 + 0.045)],
                28, 'tank', col=lambda a, i, c: (*(0.82 + 0.18 * min(1.0, c.z / 0.6),) * 3, 1.0), matrix=Matrix.Translation((cx, 0, z0)))
        for k in range(9):                                                   # radiator fins round the side away from the pole
            a = math.radians(-120 + k * 30); d = Vector((math.cos(a), math.sin(a), 0))
            bm = cube((-0.002, rr - 0.01, 0.08), (0.002, rr + 0.03, z1 - z0 - 0.1))
            P.merge(bm, 'tank', col=(0.9, 0.9, 0.9, 1.0), matrix=Matrix.Translation((cx, 0, z0)) @ Matrix.Rotation(a - math.pi / 2, 4, 'Z')); bm.free()
        bush = [Vector((cx - 0.05, -0.07, z1 + 0.04)), Vector((cx - 0.05, 0.07, z1 + 0.04))]
        straps = (6.7, 7.05); sx = cx - rr
    for b in bush: revolve(P, BUSHING, 12, 'porcelain', matrix=Matrix.Translation(b))
    for z in straps:                                                         # hanger straps round the pole, bracketed to the tank
        rad = rb + (rt - rb) * z / H + 0.006
        tube(P, [Vector((rad * math.cos(2 * math.pi * k / 16), rad * math.sin(2 * math.pi * k / 16), z)) for k in range(17)], 0.006, 4, 'iron', W)
        for sy in (-0.06, 0.06): tube(P, [Vector((rad * 0.8, sy, z)), Vector((sx + 0.01, sy, z))], 0.009, 4, 'iron', W)
    for b, pin in zip(bush, (pins[1], pins[2])):                             # leads from the bushings up to the arm
        top = b + Vector((0, 0, 0.14)); mid = (top + pin) / 2 + Vector((0.05, 0, -0.1))
        tube(P, [top, mid, pin + Vector((0, 0, 0.1))], 0.005, 4, 'iron', W)
    return P.build(smooth=45)

utility_pole('pole_old', 8.6, 8.0, 1.7, 0.3, 'box')
utility_pole('pole_quarter', 8.8, 8.2, 1.8, 0.0, 'round')
for k in ('pole_old', 'pole_quarter'): PREVIEW_FOCUS[k] = ((-0.9, -0.5, 6.1), (0.9, 0.5, 8.8))

# ---------------------------------------------------------------------------------------------------- pinatas ----------
# A seven-point star piñata (dressing.js pinata()): origin at the body's centre, placed unturned and scaled by the old s.
# A round body wrapped in rows of fringed tissue, seven cones (in the old directions, from 0.15 to 0.56 m) each wrapped in
# rows of fringe over a crêpe core, and two crêpe streamers hanging from every tip. The paper texture is cut by its own
# alpha (the fringe); each part is its own slot so the game tints it with the piñata's colours (body; c0-c6 the cones in
# the old order; sa0-sa6 and sb0-sb6 the streamers). Vertex alpha: the fringe's ends a little free, the streamers free.
PINATA_DIRS = [(0, 0, 1), (0, 0, -1), (1, 0, 0.1), (-1, 0, 0.1), (0, -1, 0.1), (0, 1, 0.1), (0.6, -0.6, -0.4)]   # three.js's, in Blender axes
FRINGE = lambda k: ((k % 6) + 1) * 0.125, lambda k: (k % 6) * 0.125              # a fringe row's top (where it hangs from) and bottom
@piece
def pinata(name):
    r = stream(name); P = Piece(name)
    CREPE = (0.8, 0.97)
    c = lambda a: (1.0, 1.0, 1.0, a)
    Rb = 0.19                                                             # the body: a crêpe-covered ball...
    lat = [math.pi * k / 10 for k in range(11)]
    band(P, Vector((0, 0, 0)), Vector((0, 0, -1)), [(-Rb * math.cos(t), Rb * math.sin(t), CREPE[0] + (CREPE[1] - CREPE[0]) * k / 10, c(0.0)) for k, t in enumerate(lat)], 20, 'body', 2)
    for k, th in enumerate([math.radians(a) for a in (24, 50, 76, 102, 128, 154)]):   # ...wrapped in rows of fringe, each over the next
        t0, r0 = Rb * math.cos(th), Rb * math.sin(th) + 0.007
        t1, r1 = Rb * math.cos(th + math.radians(30)), Rb * math.sin(th + math.radians(30)) + 0.022
        band(P, Vector((0, 0, 0)), Vector((0, 0, 1)), [(t0, r0, FRINGE[0](k), c(0.0)), (t1, r1, FRINGE[1](k), c(0.35))], 24, 'body', 3)
    for k, d in enumerate(PINATA_DIRS):
        d = Vector(d).normalized(); slot = 'c%d' % k
        cone = lambda t: 0.078 * (0.56 - t) / 0.41                        # the cone's radius 0.15 ... 0.56 out
        band(P, Vector((0, 0, 0)), d, [(0.15 + 0.41 * i / 5, cone(0.15 + 0.41 * i / 5), CREPE[0] + (CREPE[1] - CREPE[0]) * i / 5, c(0.0)) for i in range(6)], 12, slot, 1)
        for i, ta in enumerate((0.52, 0.44, 0.36, 0.28, 0.2)):             # fringe rows, from the tip back, each hanging towards the body
            tb = ta - 0.075
            band(P, Vector((0, 0, 0)), d, [(ta, cone(ta) + 0.006, FRINGE[0](i + k), c(0.0)), (tb, cone(tb) + 0.02, FRINGE[1](i + k), c(0.3))], 12, slot, 1)
        tip = d * 0.565
        for sl, off in (('sa%d' % k, -0.012), ('sb%d' % k, 0.012)):        # two crêpe streamers from the tip
            u, w = frame(Vector((0, 0, 1))); side = Vector((1, 0, 0)) if abs(d.x) < 0.7 else Vector((0, 1, 0))
            L, n, ph = r.uniform(0.22, 0.28), 6, r.uniform(0, 6.283)
            pts = [tip + side * off + Vector((0.02 * math.sin(ph + 3 * i / n), 0.02 * math.cos(ph + 2.5 * i / n), -L * i / n)) for i in range(n + 1)]
            vs = [(P.vert(p - side * 0.015), P.vert(p + side * 0.015), i / n) for i, p in enumerate(pts)]
            for i in range(n):
                a, b = vs[i], vs[i + 1]
                P.face((a[0], a[1], b[1], b[0]), sl, uvs=[(0.0, 0.76 + 0.22 * a[2]), (0.1, 0.76 + 0.22 * a[2]), (0.1, 0.76 + 0.22 * b[2]), (0.0, 0.76 + 0.22 * b[2])],
                       cols=[c(a[2]), c(a[2]), c(b[2]), c(b[2])])
    return P.build(smooth=60)

pinata('pinata')

# ---------------------------------------------------------------------------------------------------- ristras ----------
# A ristra of dried chiles (dressing.js ristra()) is hung as a stack of these: 0.096 m of cord's worth (three chiles,
# 0.032 m apart, the old spacing), from y = 0 down. Each chile curved and wrinkled, its green-brown stem and calyx tied to
# the cord, spiralling round it. Slots: chile (tinted by the game with the old chiles' red), stem.
@piece
def ristra_seg(name):
    r = stream(name); P = Piece(name)
    for i in range(3):
        a = i * 2.39996 + r.uniform(-0.2, 0.2); out = Vector((math.cos(a), math.sin(a), 0)); z0 = -0.032 * i
        L, curl, tilt = r.uniform(0.085, 0.11), r.uniform(-0.25, 0.25), r.uniform(0.35, 0.65)
        def spine(t):                                                     # out from the cord and down, the tip curling
            return out * (0.012 + 0.03 * math.sin(tilt) * t + 0.01 * t * t) + Vector((0, 0, z0 - 0.01 - L * t * math.cos(tilt * (1 - 0.3 * t)))) + out.cross(Vector((0, 0, 1))) * curl * 0.03 * t * t
        shade, ph = r.uniform(0.82, 1.12), r.uniform(0, 6.283)
        rings = 6
        cs = [spine(k / rings) for k in range(rings + 1)]
        prof = lambda t: 0.017 * min(1.0, t / 0.15) ** 0.5 * (1 - t) ** 0.7 + 0.002
        loops = []
        for k in range(rings + 1):
            t = k / rings; ax = (cs[min(k + 1, rings)] - cs[max(k - 1, 0)]).normalized(); u, w = frame(ax)
            if k == rings: loops.append([P.vert(cs[k])]); continue
            loops.append([P.vert(cs[k] + (u * math.cos(2 * math.pi * j / 6) + w * math.sin(2 * math.pi * j / 6)) * prof(t) * (1 + 0.16 * math.sin(3 * (2 * math.pi * j / 6) + ph + 9 * t))) for j in range(6)])
        col = lambda t: (shade * (0.85 + 0.15 * t), shade * (0.85 + 0.15 * t), shade * (0.85 + 0.15 * t), 1.0)
        for k in range(rings):
            A, B = loops[k], loops[k + 1]
            for j in range(6):
                if len(B) == 1: P.face((A[j], A[(j + 1) % 6], B[0]), 'chile', cols=col(k / rings))
                else: P.face((A[j], A[(j + 1) % 6], B[(j + 1) % 6], B[j]), 'chile', cols=col(k / rings))
        P.face(loops[0][::-1], 'stem', cols=(1.0, 1.0, 1.0, 1.0))                                      # the calyx over the shoulder
        tube(P, [Vector((0, 0, z0)) + out * 0.004, cs[0]], 0.0025, 3, 'stem', (0.9, 0.9, 0.9, 1.0))   # the stem, tied to the cord
    return P.build(smooth=60)

ristra_seg('ristra_seg')

class HeightField:
    """The heap's top surface on a grid, raised as each piece settles, so pieces rest on the mound and on each other."""
    def __init__(self, f, ext=1.95, cell=0.04):
        self.ext, self.cell, self.n = ext, cell, int(2 * ext / cell) + 1
        self.h = [[f(-ext + i * cell, -ext + j * cell) for j in range(self.n)] for i in range(self.n)]
    def _cells(self, x, y, rad):
        i0, i1 = max(0, int((x - rad + self.ext) / self.cell)), min(self.n - 1, int((x + rad + self.ext) / self.cell) + 1)
        j0, j1 = max(0, int((y - rad + self.ext) / self.cell)), min(self.n - 1, int((y + rad + self.ext) / self.cell) + 1)
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                if math.hypot(-self.ext + i * self.cell - x, -self.ext + j * self.cell - y) <= rad: yield i, j
    def top(self, x, y, rad):
        return max((self.h[i][j] for i, j in self._cells(x, y, rad)), default=0.0)
    def lay(self, x, y, rad, z):
        for i, j in self._cells(x, y, rad): self.h[i][j] = max(self.h[i][j], z)

@piece
def rubble(name, mix):
    r = stream(name); off = Vector((r.uniform(0, 50), r.uniform(0, 50), r.uniform(0, 50)))
    P = Piece(name); U = Matrix.Diagonal((1 / RUBBLE_R, 1 / RUBBLE_R, 1 / RUBBLE_H, 1.0))      # metres -> the unit heap
    cx, cy = r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25)
    lumps = [(r.uniform(-0.9, 0.9), r.uniform(-0.9, 0.9), r.uniform(0.05, 0.12), r.uniform(0.06, 0.2)) for _ in range(3)]
    def ground(x, y):                                                    # the mound, highest a little off centre, a skirt of grit to 1.85 m
        d = math.hypot(x - cx * max(0.0, 1 - math.hypot(x, y) / 1.6), y - cy * max(0.0, 1 - math.hypot(x, y) / 1.6))
        z = 0.48 * max(0.0, 1 - (d / 1.55) ** 2) ** 1.05 + 0.03 * max(0.0, 1 - math.hypot(x, y) / 1.85)    # (as full as the old dome)
        for lx, ly, lh, lr in lumps: z += lh * math.exp(-((x - lx) ** 2 + (y - ly) ** 2) / lr)   # (a few heaps within the heap)
        return max(0.0, z * (1 + 0.35 * noise.noise(Vector((x, y, 0)) * 1.4 + off)) + 0.015 * noise.noise(Vector((x, y, 0)) * 7 + off)) if math.hypot(x, y) < 1.84 else 0.0
    rings, segs = [0.0, 0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1.1, 1.25, 1.4, 1.55, 1.7, 1.85], 36
    grid = [[P.vert(U @ Vector((rr * math.cos(2 * math.pi * j / segs), rr * math.sin(2 * math.pi * j / segs), ground(rr * math.cos(2 * math.pi * j / segs), rr * math.sin(2 * math.pi * j / segs)) if rr < 1.84 else 0.0))) for j in range(segs if rr else 1)] for rr in rings]
    dust = lambda v: (*(0.82 + 0.2 * noise.noise(v.co * 9 + off),) * 3, 1.0)
    for i in range(len(rings) - 1):
        for j in range(segs):
            k = (j + 1) % segs
            vs = [grid[i][0]] if i == 0 else [grid[i][j], grid[i][k]]
            vs = vs + [grid[i + 1][k], grid[i + 1][j]]
            P.face(vs if i else [vs[0], vs[2], vs[1]], 'gravel', cols=[dust(v) for v in (vs if i else [vs[0], vs[2], vs[1]])])
    hf = HeightField(ground)

    def settle(x, y, rad, thick, bm, slot, col, sink=0.3, tilt=0.15, edge=0.0):
        """Rest the chunk bm (its base on z = 0) on the heap at (x, y): on the mound's slope, turned and tipped at random."""
        z = hf.top(x, y, rad) - sink * thick
        if z + thick > 0.66: return None                                  # (keeps the heap under 1.15 of its height)
        e = 0.03; n = Vector((ground(x - e, y) - ground(x + e, y), ground(x, y - e) - ground(x, y + e), 2 * e)).normalized()
        up = math.pi / 2 if r.random() < edge else 0.0                     # now and then a piece fetched up on its edge
        q = Vector((0, 0, 1)).rotation_difference(n) @ Matrix.Rotation(r.uniform(-tilt, tilt) + up, 4, 'X').to_quaternion() @ Matrix.Rotation(r.uniform(-tilt, tilt), 4, 'Y').to_quaternion()
        m = Matrix.Translation((x, y, max(0.0, z))) @ q.to_matrix().to_4x4() @ Matrix.Rotation(r.uniform(0, 6.283), 4, 'Z')
        pts = [m @ v.co for v in bm.verts]; lo = min(p.z for p in pts)
        if lo < 0: m = Matrix.Translation((0, 0, -lo)) @ m; pts = [p - Vector((0, 0, lo)) for p in pts]   # (no corner below the ground)
        if not inside(pts): bm.free(); return None                       # on its edge it would stand out of the old heap
        P.merge(bm, slot, col=col, matrix=U @ m); bm.free()
        hf.lay(x, y, rad * 0.75, max(p.z for p in pts) * 0.95)
        return m

    def inside(pts):                                                     # the old keep-out's radius and the heap's height, in metres
        return all(math.hypot(p.x, p.y) < 1.84 and -1e-4 < p.z < 0.70 for p in pts)

    def spot(spread=1.0):
        d = 1.62 * spread * math.sqrt(r.random()); a = r.uniform(0, 6.283); return d * math.cos(a), d * math.sin(a)

    for _ in range(mix['slab']):                                        # broken slab, a bar or two of its rebar sticking out
        x, y = spot(0.85); size, thick = r.uniform(0.12, 0.34), r.uniform(0.045, 0.09); n = r.randint(5, 8)
        angs = sorted(r.uniform(0, 6.283) for _ in range(n))
        pts = [(size * r.uniform(0.55, 1.0) * math.cos(a), size * r.uniform(0.55, 1.0) * math.sin(a)) for a in angs]
        bm = prism(pts, 0.0, thick, jitter=lambda i: r.uniform(-0.006, 0.006))
        shade = r.uniform(0.85, 1.05)
        m = settle(x, y, size * 0.8, thick, bm, 'concrete', lambda c, nn: ((shade * 1.05,) * 3 if nn.z > 0.7 else (shade * 0.72, shade * 0.71, shade * 0.68)) + (1.0,), tilt=0.2, edge=0.08)
        if m and r.random() < mix['rebar']:                             # (rust colour; the iron material is near black)
            p0 = Vector((*pts[r.randrange(n)], 0.0)) * 0.92; p0.z = thick * 0.5; d = Vector((p0.x, p0.y, 0)).normalized()
            path = [p0 - d * 0.06]
            for k in range(1, 7):
                bend = Vector((r.uniform(-0.05, 0.05), r.uniform(-0.05, 0.05), r.uniform(0.0, 0.06)))
                path.append(path[-1] + d * 0.06 + bend * (k / 6))
            if inside([m @ p for p in path]): tube(P, [U @ (m @ p) for p in path], 0.006 / RUBBLE_R, 6, 'iron', (0.55, 0.32, 0.2, 1.0))
    for _ in range(mix['brick']):                                       # loose bricks, whole and half, worn at the corners
        x, y = spot(); half = r.random() < 0.35; L = 0.105 if half else 0.215
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts: v.co = Vector((v.co.x * L, v.co.y * 0.1025, (v.co.z + 0.5) * 0.065)) + Vector((r.uniform(-0.004, 0.004) for _ in range(3)))
        shade = r.uniform(0.72, 1.1)
        settle(x, y, L * 0.55, 0.065, bm, 'brick', lambda c, nn: (shade, shade * r.uniform(0.95, 1.0), shade * 0.95, 1.0), sink=0.4, tilt=0.3, edge=0.12)
    for _ in range(mix['clump']):                                       # two or three bricks still mortared together
        x, y = spot(0.8); bm = bmesh.new(); k = r.randint(2, 3)
        for b in range(k):
            for z0, z1, w, slot_m in ((b * 0.077, b * 0.077 + 0.065, 0.215, 0), (b * 0.077 + 0.065, b * 0.077 + 0.077, 0.2, 1)):
                if slot_m and b == k - 1: continue
                cube = bmesh.ops.create_cube(bm, size=1.0)['verts']
                for v in cube: v.co = Vector((v.co.x * w + r.uniform(-0.01, 0.01) * slot_m, v.co.y * (0.1025 if not slot_m else 0.095), z0 + (v.co.z + 0.5) * (z1 - z0)))
        settle(x, y, 0.13, k * 0.077, bm, 'brick', lambda c, nn: ((0.95, 0.9, 0.86, 1.0) if (c.z % 0.077) > 0.0645 else (0.9, 0.86, 0.84, 1.0)), sink=0.25, tilt=0.25)
    for _ in range(mix['flake']):                                       # plaster flakes, painted on their top face
        x, y = spot(); size = r.uniform(0.05, 0.16); n = r.randint(5, 7)
        angs = sorted(r.uniform(0, 6.283) for _ in range(n)); paint = r.choice(PAINT)
        bm = prism([(size * r.uniform(0.5, 1.0) * math.cos(a), size * r.uniform(0.5, 1.0) * math.sin(a)) for a in angs], 0.0, 0.014)
        settle(x, y, size * 0.7, 0.014, bm, 'plaster', lambda c, nn: (*(paint if nn.z > 0.7 else (0.92, 0.9, 0.86)), 1.0), sink=0.2, tilt=0.2)
    for _ in range(mix['stone']):                                       # loose stones and lumps of mortar, out onto the skirt
        x, y = spot(1.12); size = r.uniform(0.009, 0.032); g = r.uniform(0.5, 0.82)
        settle(x, y, size, size * 1.6, blob(r, size), 'concrete', lambda c, nn: (g, g * 0.98, g * 0.95, 1.0), sink=0.45, tilt=1.0)
    ob = P.build(smooth=50); PREVIEW_SCALE[name] = (RUBBLE_R, RUBBLE_R, RUBBLE_H); return ob    # (stones smooth, slab and brick edges sharp)

rubble('rubble_a', {'slab': 17, 'brick': 155, 'clump': 8, 'flake': 32, 'stone': 270, 'rebar': 0.35})
rubble('rubble_b', {'slab': 10, 'brick': 210, 'clump': 13, 'flake': 36, 'stone': 240, 'rebar': 0.2})    # mostly brick
rubble('rubble_c', {'slab': 27, 'brick': 90, 'clump': 5, 'flake': 22, 'stone': 300, 'rebar': 0.5})      # a fallen slab, more rebar

# ---------------------------------------------------------------------------------------------------- export ---------
for ob in pieces: ob.location = (0, 0, 0)
print('PROPS pieces (triangles):', ', '.join(f'{ob.name} {tri_count(ob)}' for ob in pieces))
for ob in bpy.data.objects: ob.select_set(ob in pieces)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
if ONLY: print('PROPS --only: previews only, nothing exported')          # (a partial set must never replace the GLB)
else: bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_normals=True, export_texcoords=True, export_materials='EXPORT', export_vertex_color='ACTIVE',
                          export_tangents=False)
if not ONLY: print('PROPS written', OUT)

if PREVIEW:                                                     # one render per piece, framed to its bounds
    os.makedirs(PREVIEW, exist_ok=True)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 50
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35)); scene.collection.objects.link(sun)
    scene.render.engine = 'BLENDER_WORKBENCH'; scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True; scene.display.shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 900, 700
    for ob in pieces:
        for o in pieces: o.hide_render = o is not ob
        ob.scale = PREVIEW_SCALE.get(ob.name, (1, 1, 1)); bpy.context.view_layer.update()
        pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        if ob.name in PREVIEW_FOCUS:
            lo, hi = PREVIEW_FOCUS[ob.name]; pts = [Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        c = sum(pts, Vector()) / 8; rad = max((p - c).length for p in pts)
        d = Vector((0.75, -1.3, 0.7)).normalized()
        cam.location = c + d * rad / math.tan(cam.data.angle / 2) * 1.08
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.clip_start = rad * 0.01; cam.data.clip_end = rad * 50
        scene.render.filepath = os.path.join(PREVIEW, ob.name + '.png')
        bpy.ops.render.render(write_still=True)
    print('PROPS previews', PREVIEW)
