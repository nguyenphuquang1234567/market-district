# Detail pieces for Market District (the 2026-11-16 detail pass), modelled procedurally in Blender and exported as one
# GLB, assets/kit/props.glb. The game draws palms and laurels within the kit's near distance and its plain geometry
# farther off (src/builder.js swap()), and every other piece in place of the plain geometry at every distance (replace());
# the old code keeps every random draw and the solids it records, so the map plays the same.
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
        'glass': (0.55, 0.7, 0.75), 'plastic': (0.9, 0.9, 0.88), 'pot': (0.78, 0.8, 0.82), 'wood': (0.45, 0.4, 0.35), 'tank': (0.62, 0.64, 0.62), 'porcelain': (0.92, 0.93, 0.95), 'chile': (0.6, 0.06, 0.04), 'stem': (0.42, 0.4, 0.2), 'wall': (0.95, 0.72, 0.4), 'glaze_y': (0.95, 0.75, 0.3), 'glaze_b': (0.3, 0.42, 0.85), 'dark': (0.03, 0.03, 0.03), 'trim': (0.45, 0.62, 0.5), 'finial': (0.75, 0.62, 0.3), 'bark': (0.55, 0.45, 0.35), 'leaf': (0.35, 0.5, 0.2), 'fruit': (0.9, 0.45, 0.12), 'stalk': (0.85, 0.6, 0.2)}
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
    def __init__(self, name, recalc=True):
        self.name, self.bm, self.slots, self.recalc = name, bmesh.new(), [], recalc
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

    def face_toward(self, verts, slot, toward, uvs=None, cols=None):
        """A face wound so that its normal points along `toward` (for open surfaces, where recalculating cannot know)."""
        n = (verts[1].co - verts[0].co).cross(verts[2].co - verts[0].co)
        if n.dot(toward) < 0:
            verts = verts[::-1]; uvs = uvs[::-1] if uvs else uvs; cols = cols[::-1] if isinstance(cols, list) else cols
        return self.face(verts, slot, uvs, cols)

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
        if self.recalc: bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
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
    ph = [r.uniform(0, 6.283) for _ in range(6)]; freq = [r.choice((4, 5)), r.choice((6, 7)), 8]     # (up to 8 round: 16 segments)
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
    revolve(P, prof, 16, 'burlap', disp=disp, col=col, slots=lambda i: 'spice' if i >= SPICE0 else 'burlap')
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

# ---------------------------------------------------------------------------------------------------- the chapel's dome -
# The dome over the chapel's east end (quarter.js chapel()), three pieces with one origin: the drum's base centre, on the
# nave's roof. The old drum's octagon (flats facing the axes and diagonals; radius to the corners 3.4 at the foot, 3.3 at
# the top, 1.6 tall), the dome (radius 3.2 from 1.72 up, raised 1.12) and the lantern stack (5.25 ... 8.1) are kept.
CH_R0, CH_R1, CH_H = 3.4, 3.3, 1.6
def ch_R(z): return CH_R0 + (CH_R1 - CH_R0) * min(1.0, max(0.0, z / CH_H))      # radius to the corners at height z (the drum is battered)

@piece
def chapel_drum(name):
    """The drum: plastered, battered, a moulded base and cornice; in each face an arched window in a cantera surround, set
    back in its reveal with glass and a grille, a sill under it; pilasters at the angles. Slots: wall, stone, glass, iron."""
    P = Piece(name, recalc=False); W = (1.0, 1.0, 1.0, 1.0); cos8 = math.cos(math.pi / 8)
    def pt(k, t, z, d=0.0):                                  # on face k: t along it, z up, d out of it
        th = k * math.pi / 4; n = Vector((math.cos(th), math.sin(th), 0)); tt = Vector((-math.sin(th), math.cos(th), 0))
        return n * (ch_R(z) * cos8 + d) + tt * t + Vector((0, 0, z))
    hw = lambda z: ch_R(z) * math.sin(math.pi / 8)
    def quad(k, corners, slot, d=0.0, col=W):               # a quad on face k from (t, z) corners, facing out
        th = k * math.pi / 4
        P.face_toward([P.vert(pt(k, t, z, d)) for t, z in corners], slot, Vector((math.cos(th), math.sin(th), 0)), cols=col)
    zs, zt = 0.15, 1.5                                       # the wall runs from the base moulding to the cornice
    s0, sp, rr, hwin = 0.32, 1.0, 0.3, 0.3                   # the window: sill, springing, arch radius, half width
    arch = [(rr * math.cos(math.pi * i / 10), sp + rr * math.sin(math.pi * i / 10)) for i in range(11)]
    outline = [(-hwin, s0), (hwin, s0)] + arch + [(-hwin, s0)]      # the opening, anticlockwise seen from outside
    shade = lambda z: (*(0.82 + 0.18 * min(1.0, (z - zs) / 0.5),) * 3, 1.0)
    for k in range(8):
        th = k * math.pi / 4; n = Vector((math.cos(th), math.sin(th), 0))
        quad(k, [(-hw(zs), zs), (hw(zs), zs), (hw(s0), s0), (-hw(s0), s0)], 'wall', col=shade(zs))          # the wall round the opening
        quad(k, [(-hw(s0), s0), (-hwin, s0), (-hwin, sp), (-hw(sp), sp)], 'wall')
        quad(k, [(hwin, s0), (hw(s0), s0), (hw(sp), sp), (hwin, sp)], 'wall')
        for i in range(10):
            (t0, z0), (t1, z1) = arch[i + 1], arch[i]
            quad(k, [(t0, z0), (t1, z1), (t1, zt), (t0, zt)], 'wall')
        quad(k, [(-hw(sp), sp), (-hwin, sp), (-hwin, zt), (-hw(zt), zt)], 'wall')
        quad(k, [(hwin, sp), (hw(sp), sp), (hw(zt), zt), (hwin, zt)], 'wall')
        depth = 0.2
        for (t0, z0), (t1, z1) in zip(outline, outline[1:]):                                 # the reveal, facing into the opening
            mid = Vector(((t0 + t1) / 2, (z0 + z1) / 2)); inward = -n                      # (oriented below by the opening's centre)
            vs = [P.vert(pt(k, t0, z0)), P.vert(pt(k, t1, z1)), P.vert(pt(k, t1, z1, -depth)), P.vert(pt(k, t0, z0, -depth))]
            c = pt(k, 0, sp - 0.1, -depth / 2); P.face_toward(vs, 'wall', c - (vs[0].co + vs[1].co) / 2, cols=(0.85, 0.85, 0.85, 1.0))
        P.face_toward([P.vert(pt(k, t, z, -depth + 0.02)) for t, z in outline[:-1]], 'glass', n)                    # the glass
        for t in (-0.1, 0.1): tube(P, [pt(k, t, s0, -0.08), pt(k, t, sp + rr * math.sqrt(1 - (t / rr) ** 2), -0.08)], 0.011, 4, 'iron', W)   # the grille
        tube(P, [pt(k, -hwin, 0.72, -0.08), pt(k, hwin, 0.72, -0.08)], 0.011, 4, 'iron', W)
        inner = [(-hwin, s0)] + [(-hwin, sp)] + arch[::-1][1:] + [(hwin, s0)]                # the surround: up one jamb, over, down the other
        outer = [(-hwin - 0.1, s0 - 0.02)] + [(-hwin - 0.1, sp)] + [((rr + 0.1) * math.cos(math.pi * (10 - i) / 10), sp + (rr + 0.1) * math.sin(math.pi * (10 - i) / 10)) for i in range(1, 11)] + [(hwin + 0.1, s0 - 0.02)]
        for (a0, a1), (b0, b1) in zip(zip(inner, inner[1:]), zip(outer, outer[1:])):
            P.face_toward([P.vert(pt(k, *a0, 0.045)), P.vert(pt(k, *a1, 0.045)), P.vert(pt(k, *b1, 0.045)), P.vert(pt(k, *b0, 0.045))], 'stone', n)
            P.face_toward([P.vert(pt(k, *b0, 0.0)), P.vert(pt(k, *b1, 0.0)), P.vert(pt(k, *b1, 0.045)), P.vert(pt(k, *b0, 0.045))], 'stone',
                          pt(k, *b0, 0) - pt(k, 0, sp, 0))
            P.face_toward([P.vert(pt(k, *a0, 0.0)), P.vert(pt(k, *a1, 0.0)), P.vert(pt(k, *a1, 0.045)), P.vert(pt(k, *a0, 0.045))], 'stone',
                          pt(k, 0, sp, 0) - pt(k, *a0, 0))
        kz = sp + rr + 0.1                                                                   # keystone
        bm = cube((-0.06, -0.02, kz - 0.14), (0.06, 0.07, kz + 0.04)); P.merge(bm, 'stone', col=W, matrix=Matrix.Translation(pt(k, 0, 0, 0) * 0 + n * ch_R(kz) * cos8) @ Matrix.Rotation(th - math.pi / 2, 4, 'Z')); bm.free()
        bm = cube((-hwin - 0.14, -0.0, s0 - 0.07), (hwin + 0.14, 0.09, s0 - 0.01)); P.merge(bm, 'stone', col=W, matrix=Matrix.Translation(n * ch_R(s0) * cos8) @ Matrix.Rotation(th - math.pi / 2, 4, 'Z')); bm.free()   # sill
    for k in range(8):                                                                   # pilasters at the angles, battered with the drum
        ph = math.pi / 8 + k * math.pi / 4; rad = Vector((math.cos(ph), math.sin(ph), 0)); tg = Vector((-math.sin(ph), math.cos(ph), 0))
        corner = lambda z, a, b: rad * (ch_R(z) - 0.05 + a) + tg * b + Vector((0, 0, z))
        ring = [(0.0, -0.17), (0.07, -0.17), (0.07, 0.17), (0.0, 0.17)]
        lo = [P.vert(corner(zs, a, b)) for a, b in ring]; hi = [P.vert(corner(zt, a, b)) for a, b in ring]
        for i in range(3):
            j = i + 1; mid = (lo[i].co + lo[j].co) / 2 - rad * (ch_R(zs) - 0.3)
            P.face_toward([lo[i], lo[j], hi[j], hi[i]], 'stone', mid - Vector((0, 0, mid.z)), cols=W)
    for prof, slot in (([(0.0, 0.0), (0.08, 0.0), (0.08, 0.06), (0.05, 0.09), (0.05, 0.12), (0.0, zs)], 'stone'),          # the base moulding
                       ([(0.0, zt), (0.04, zt), (0.04, 1.53), (0.1, 1.56), (0.18, 1.6), (0.27, 1.64), (0.35, 1.68), (0.35, 1.74), (-0.6, 1.74)], 'stone')):   # the cornice
        rings = []
        for off, z in prof:
            R = ch_R(min(z, CH_H)) + off / cos8
            rings.append([P.vert((R * math.cos(math.pi / 8 + k * math.pi / 4), R * math.sin(math.pi / 8 + k * math.pi / 4), z)) for k in range(8)])
        for i in range(len(rings) - 1):
            for k in range(8):
                a, b, c, d = rings[i][k], rings[i][(k + 1) % 8], rings[i + 1][(k + 1) % 8], rings[i + 1][k]
                mid = (a.co + b.co + c.co + d.co) / 4; up = rings[i + 1][0].co.z - rings[i][0].co.z
                out = Vector((mid.x, mid.y, 0)).normalized()
                toward = out if abs(prof[i + 1][0] - prof[i][0]) < 1e-6 else (Vector((0, 0, -1)) if prof[i + 1][0] > prof[i][0] else Vector((0, 0, 1)))
                if up > 1e-6 and abs(prof[i + 1][0] - prof[i][0]) > 1e-6: toward = (out * up + Vector((0, 0, prof[i][0] - prof[i + 1][0]))).normalized()
                P.face_toward([a, b, c, d], slot, toward, cols=W)
    return P.build(smooth=30)

DOME_BANDS = [(0, 6, 'glaze_y'), (6, 12, 'glaze_b'), (12, 33, 'glaze_y'), (33, 39, 'glaze_b'), (39, 60, 'glaze_y'), (60, 66, 'glaze_b'),
              (66, 87, 'glaze_y'), (87, 90, 'glaze_b')]                                      # degrees from the crown down: the old cobalt rows
@piece
def chapel_dome(name):
    """The dome: talavera glaze in its old yellow with the old cobalt bands (u 24 tiles round, v 8 up, as before), eight
    cantera ribs over it from the drum to the lantern. Slots: glaze_y, glaze_b, stone."""
    P = Piece(name, recalc=False); W = (1.0, 1.0, 1.0, 1.0); segs = 64
    pos = lambda a, th, off=0.0: Vector(((3.2 + off) * math.sin(math.radians(th)) * math.cos(a), (3.2 + off) * math.sin(math.radians(th)) * math.sin(a), 1.72 + (3.2 + off) * 1.12 * math.cos(math.radians(th))))
    rows = []
    for t0, t1, slot in DOME_BANDS:
        n = max(1, round((t1 - t0) / 3))
        rows += [(t0 + (t1 - t0) * i / n, t0 + (t1 - t0) * (i + 1) / n, slot) for i in range(n)]
    for t0, t1, slot in rows:
        for j in range(segs):
            a0, a1 = 2 * math.pi * j / segs, 2 * math.pi * (j + 1) / segs
            vs = [P.vert(pos(a0, t1)), P.vert(pos(a1, t1)), P.vert(pos(a1, t0)), P.vert(pos(a0, t0))]
            uv = lambda a, th: (24 * a / (2 * math.pi), 8 * (90 - th) / 90)
            P.face_toward(vs, slot, (vs[0].co + vs[2].co) / 2 - Vector((0, 0, 1.72)), uvs=[uv(a0, t1), uv(a1, t1), uv(a1, t0), uv(a0, t0)], cols=W)
    for k in range(8):                                                                   # ribs, from the drum to the lantern
        a = math.pi / 8 + k * math.pi / 4; tg = Vector((-math.sin(a), math.cos(a), 0))
        line = [8 + 82 * i / 24 for i in range(25)]
        prof = [(-0.08, -0.01), (-0.08, 0.06), (0.08, 0.06), (0.08, -0.01)]
        rings = [[P.vert(pos(a, th, off) + tg * w) for w, off in prof] for th in line]
        for i in range(24):
            for q in range(3):
                vs = [rings[i][q], rings[i][q + 1], rings[i + 1][q + 1], rings[i + 1][q]]
                c = (vs[0].co + vs[2].co) / 2; toward = (c - Vector((0, 0, 1.72))).normalized() if q == 1 else tg * (-1 if q == 0 else 1)
                P.face_toward(vs, 'stone', toward, cols=(0.95, 0.95, 0.95, 1.0))
    return P.build(smooth=50)

@piece
def chapel_lantern(name):
    """The lantern on the crown: a moulded plinth, an open arcade of eight colonnettes round its dark inside, an
    entablature, a tiled onion cupola, a ball and an iron cross. Slots: stone, glaze_y, iron, dark."""
    P = Piece(name); W = (1.0, 1.0, 1.0, 1.0)
    revolve(P, [(0.0, 5.15), (0.66, 5.15), (0.66, 5.3), (0.6, 5.34), (0.6, 5.42), (0.0, 5.42)], 8, 'stone', matrix=Matrix.Rotation(math.pi / 8, 4, 'Z'))
    revolve(P, [(0.0, 5.42), (0.44, 5.42), (0.44, 6.18), (0.0, 6.18)], 8, 'dark', matrix=Matrix.Rotation(math.pi / 8, 4, 'Z'))
    for k in range(8):
        a = k * math.pi / 4; c = Vector((0.53 * math.cos(a), 0.53 * math.sin(a), 0))
        revolve(P, [(0.0, 5.42), (0.07, 5.42), (0.07, 5.47), (0.045, 5.5), (0.04, 6.08), (0.06, 6.12), (0.07, 6.18), (0.0, 6.18)], 10, 'stone', matrix=Matrix.Translation(c))
    revolve(P, [(0.0, 6.18), (0.6, 6.18), (0.62, 6.24), (0.66, 6.3), (0.66, 6.36), (0.0, 6.36)], 8, 'stone', matrix=Matrix.Rotation(math.pi / 8, 4, 'Z'))
    revolve(P, [(0.0, 6.36), (0.56, 6.36), (0.57, 6.46), (0.52, 6.62), (0.4, 6.8), (0.24, 6.95), (0.1, 7.05), (0.05, 7.08), (0.0, 7.1)], 24, 'glaze_y',
            uv=lambda a, i, co: (6 * a / (2 * math.pi), (co.z - 6.36) * 3))
    revolve(P, [(0.0, 7.08), (0.05, 7.1), (0.07, 7.16), (0.05, 7.22), (0.0, 7.24)], 12, 'stone')
    P.merge(cube((-0.03, -0.03, 7.22), (0.03, 0.03, 8.1)), 'iron', col=W)
    P.merge(cube((-0.03, -0.275, 7.77), (0.03, 0.275, 7.83)), 'iron', col=W)
    return P.build(smooth=40)

for n in ('chapel_drum', 'chapel_dome', 'chapel_lantern'): globals()[n](n)
PREVIEW_FOCUS['chapel_lantern'] = ((-0.8, -0.8, 5.0), (0.8, 0.8, 8.2))

# ---------------------------------------------------------------------------------------------------- the kiosk ---------
# The plazuela's kiosk (quarter.js plazuela()): origin at the platform's top centre. The old roof's octagon (corners at
# pi/8 + k pi/4 in line with the columns, 4.2 m to a corner at the eave 3.4 m up, apex 5.3) and columns (3.4 m) are kept.
K_EAVE, K_APEX, K_R = 3.4, 5.3, 4.2
@piece
def kiosk_roof(name):
    """Pressed tin with standing seams fading to the apex, rolled hip ribs, a fascia and a scalloped valance all round,
    a painted underside, and a little lantern for a finial. Slots: tin, trim, finial."""
    P = Piece(name, recalc=False); W = (1.0, 1.0, 1.0, 1.0)
    corner = lambda k, rad=K_R, z=K_EAVE: Vector((rad * math.cos(math.pi / 8 + k * math.pi / 4), rad * math.sin(math.pi / 8 + k * math.pi / 4), z))
    apex = Vector((0, 0, K_APEX))
    for k in range(8):
        a, b = corner(k), corner(k + 1); mid = (a + b) / 2
        n = (b - a).cross(apex - a).normalized()
        if n.dot(mid) < 0: n = -n
        cols, rows, seams = 24, 10, 8
        grid = []
        for i in range(rows + 1):
            h = i / rows; row = []
            for j in range(cols + 1):
                sx = j / cols; e = a.lerp(b, sx); p = e.lerp(apex, h * 0.985)
                f = abs((sx * seams) % 1 - 0.5); lift = 0.022 * max(0.0, 1 - f * 7) * (1 - h)   # a standing seam every eighth of the facet
                row.append(P.vert(p + n * lift))
            grid.append(row)
        for i in range(rows):
            for j in range(cols):
                P.face_toward([grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]], 'tin', n, cols=(1.0 - 0.12 * (i / rows) ** 2,) * 3 + (1.0,))
        under = [P.vert(a - Vector((0, 0, 0.04))), P.vert(b - Vector((0, 0, 0.04))), P.vert(apex - Vector((0, 0, 0.1)))]   # the painted underside
        P.face_toward(under, 'trim', -n, cols=(0.85, 0.85, 0.85, 1.0))
        top, bot = K_EAVE + 0.01, K_EAVE - 0.08                                                        # the fascia
        fa = [P.vert(corner(k, K_R + 0.01, top)), P.vert(corner(k + 1, K_R + 0.01, top)), P.vert(corner(k + 1, K_R + 0.01, bot)), P.vert(corner(k, K_R + 0.01, bot))]
        out = Vector((mid.x, mid.y, 0)).normalized(); P.face_toward(fa, 'trim', out, cols=W)
        sc = 6                                                                                         # the scalloped valance, both faces
        for side in (1, -1):
            for j in range(sc * 6):
                s0, s1 = j / (sc * 6), (j + 1) / (sc * 6)
                lo = lambda sx: K_EAVE - 0.08 - 0.14 - 0.07 * abs(math.sin(math.pi * sx * sc))
                p0, p1 = corner(k, K_R - 0.02 * side + 0.005, 0).lerp(corner(k + 1, K_R - 0.02 * side + 0.005, 0), s0), corner(k, K_R - 0.02 * side + 0.005, 0).lerp(corner(k + 1, K_R - 0.02 * side + 0.005, 0), s1)
                vs = [P.vert((p0.x, p0.y, bot)), P.vert((p1.x, p1.y, bot)), P.vert((p1.x, p1.y, lo(s1))), P.vert((p0.x, p0.y, lo(s0)))]
                P.face_toward(vs, 'trim', out * side, cols=W)
    for k in range(8):                                                                                 # hip ribs
        tube(P, [corner(k, K_R + 0.02, K_EAVE + 0.03).lerp(apex + Vector((0, 0, 0.03)), t / 10) for t in range(11)], 0.03, 6, 'trim', W)
    revolve(P, [(0.0, K_APEX - 0.05), (0.2, K_APEX - 0.05), (0.2, K_APEX + 0.02), (0.16, K_APEX + 0.05), (0.0, K_APEX + 0.05)], 8, 'finial', matrix=Matrix.Rotation(math.pi / 8, 4, 'Z'))
    for k in range(8):
        c = Vector((0.13 * math.cos(math.pi / 8 + k * math.pi / 4), 0.13 * math.sin(math.pi / 8 + k * math.pi / 4), 0))
        tube(P, [c + Vector((0, 0, K_APEX + 0.05)), c + Vector((0, 0, K_APEX + 0.2))], 0.012, 4, 'finial', W)
    revolve(P, [(0.0, K_APEX + 0.2), (0.18, K_APEX + 0.2), (0.12, K_APEX + 0.27), (0.04, K_APEX + 0.31), (0.03, K_APEX + 0.33), (0.045, K_APEX + 0.36), (0.0, K_APEX + 0.38)], 8, 'finial',
            matrix=Matrix.Rotation(math.pi / 8, 4, 'Z'))
    return P.build(smooth=35)

@piece
def kiosk_column(name):
    """A cast-iron column, 3.4 m: an octagonal plinth, a torus, a fluted shaft tapering 0.085 -> 0.07, a necking ring,
    a bell capital and an abacus. Slot: iron."""
    P = Piece(name)
    prof = [(0.0, 0.0), (0.12, 0.0), (0.12, 0.1), (0.1, 0.12), (0.1, 0.16), (0.11, 0.18), (0.11, 0.22), (0.09, 0.25)]
    prof += [(0.085 - 0.015 * (z - 0.25) / 2.85, z) for z in [0.25 + 2.85 * i / 12 for i in range(1, 13)]]
    prof += [(0.08, 3.12), (0.08, 3.15), (0.075, 3.16), (0.085, 3.22), (0.11, 3.28), (0.12, 3.3), (0.12, 3.36), (0.0, 3.4)]
    revolve(P, prof, 16, 'iron', disp=lambda a, i, r0, z0: ((0.006 * math.cos(8 * a) if 8 <= i <= 19 else 0.0), 0.0),
            col=lambda a, i, co: (*(0.88 + 0.12 * math.cos(8 * a) if 8 <= i <= 19 else 1.0,) * 3, 1.0))
    return P.build(smooth=40)

@piece
def kiosk_bracket(name):
    """A scrolled iron bracket between a column's head and the eave, along +X from the kiosk's centre: a bar under the
    eave, a curved strut up to it ending in a curl, and a ring in the angle. Slot: iron."""
    P = Piece(name); W = (1.0, 1.0, 1.0, 1.0)
    tube(P, [Vector((3.3, 0, 3.36)), Vector((3.95, 0, 3.36))], 0.014, 4, 'iron', W)
    strut = [Vector((3.3 + 0.62 * t ** 1.4, 0, 2.72 + 0.64 * math.sin(t * math.pi / 2))) for t in [i / 14 for i in range(15)]]
    curl = [Vector((3.3 + 0.07 * (1 - 0.5 * i / 10) * math.cos(-math.pi / 2 - i * 0.6), 0, 2.79 + 0.07 * (1 - 0.5 * i / 10) * math.sin(-math.pi / 2 - i * 0.6))) for i in range(11)]
    tube(P, curl[::-1] + strut[1:], 0.012, 4, 'iron', W)
    tube(P, [Vector((3.58 + 0.08 * math.cos(2 * math.pi * i / 16), 0, 3.2 + 0.08 * math.sin(2 * math.pi * i / 16))) for i in range(17)], 0.009, 4, 'iron', W)
    return P.build(smooth=50)

for n in ('kiosk_roof', 'kiosk_column', 'kiosk_bracket'): globals()[n](n)

# ---------------------------------------------------------------------------------------------------- palms -------------
# Canary date palms (dressing.js palm(), seven). The game stacks a base and metre segments along the old trunk's curve and
# taper (radius 0.2 times the old k(t)), sets the crown on the trunk's top and lays a frond on each old frond (its
# direction, elevation, length, colour and wind phase): the up, mid and low fronds for the old three tiers, the dry one
# for the old dry fronds. Bark mapped by its own coordinates (metres), leaflets and rachis by the palm_leaf atlas.
def scar_shade(a, z, R=0.2, w=0.16, h=0.1, ph=0.0):
    """The Canary palm's diamond lattice of old leaf bases: 0 in a scar's middle, 1 on the ridges between scars."""
    u, v = (a * R + ph) / w, z / h
    p, q = (u + v) / 2, (u - v) / 2
    return 2 * max(abs(p % 1 - 0.5), abs(q % 1 - 0.5))

def trunk_piece(P, z0, z1, rad, sides, rows, ph, flare=None, roots=0, r=None):
    """A length of trunk from z0 to z1, radius rad(z), the scar lattice in relief and in shade; flare(z) adds to the
    radius; uv in metres (u round, v up)."""
    grid = []
    for i in range(rows + 1):
        z = z0 + (z1 - z0) * i / rows; ring = []
        for j in range(sides + 1):
            a = 2 * math.pi * j / sides; d = scar_shade(a, z, ph=ph)
            rr = rad(z) * (1 + 0.06 * d * d) + (flare(z, a) if flare else 0.0)
            ring.append((P.vert((rr * math.cos(a), rr * math.sin(a), z)), (a * 0.2, z), (*(0.62 + 0.38 * (1 - d * d) if True else 1,) * 3, 1.0)))
        grid.append(ring)
    for i in range(rows):
        for j in range(sides):
            q = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]]
            mid = (q[0][0].co + q[2][0].co) / 2
            P.face_toward([e[0] for e in q], 'bark', Vector((mid.x, mid.y, 0)), uvs=[e[1] for e in q], cols=[e[2] for e in q])

@piece
def palm_base(name):
    """The palm's foot: the flared root plate and the first metre (radius 0.26 at the ground to 0.205), surface roots."""
    r = stream(name); P = Piece(name, recalc=False); ph = r.uniform(0, 1)
    rad = lambda z: 0.205 + 0.055 * (1 - min(1.0, z / 1.0)) ** 3
    roots = [r.uniform(0, 2 * math.pi) for _ in range(9)]
    def flare(z, a):                                             # roots spreading out over the last 25 cm
        if z > 0.25: return 0.0
        k = max(math.exp(-((math.atan2(math.sin(a - c), math.cos(a - c))) / 0.18) ** 2) for c in roots)
        return 0.09 * k * (1 - z / 0.25) ** 2
    trunk_piece(P, 0.0, 1.02, rad, 24, 16, ph, flare=flare)
    return P.build(smooth=60)

@piece
def palm_seg(name, ph):
    """A metre of trunk, radius 0.2 (the game scales it to the old taper), its top lip running 2 cm into the next."""
    P = Piece(name, recalc=False)
    trunk_piece(P, 0.0, 1.02, lambda z: 0.2, 24, 14, ph)
    return P.build(smooth=60)

@piece
def palm_crown(name):
    """The crown on the trunk's top: a swollen knob of leaf bases, cut stubs of old petioles round it."""
    r = stream(name); P = Piece(name, recalc=False)
    prof = [(0.2, -0.6), (0.26, -0.5), (0.31, -0.36), (0.335, -0.22), (0.33, -0.08), (0.29, 0.05), (0.21, 0.16), (0.11, 0.24), (0.0, 0.27)]
    revolve(P, prof, 28, 'bark', disp=lambda a, i, r0, z0: (0.02 * math.sin(7 * a + 3 * z0) if 0 < i < len(prof) - 1 else 0.0, 0.0),
            uv=lambda a, i, co: (a * 0.3, co.z), col=lambda a, i, co: (*(0.7 + 0.3 * (0.5 + 0.5 * math.sin(7 * a + 3 * co.z)),) * 3, 1.0))
    for k in range(26):                                          # cut petiole stubs, spiralling round the knob
        a = k * 2.39996; z = -0.52 + 0.5 * (k / 26); rad = 0.3 + 0.03 * math.sin(k)
        out = Vector((math.cos(a), math.sin(a), 0)); up = Vector((0, 0, 1)); tg = up.cross(out)
        root = out * (rad - 0.03) + up * z; tip = root + (out * 0.1 + up * 0.06) * r.uniform(0.8, 1.2)
        w, t = 0.05, 0.018
        quad = [root - tg * w - up * t, root + tg * w - up * t, root + tg * w + up * t, root - tg * w + up * t]
        cap = [tip - tg * w * 0.8 - up * t * 0.7, tip + tg * w * 0.8 - up * t * 0.7, tip + tg * w * 0.8 + up * t * 0.7, tip - tg * w * 0.8 + up * t * 0.7]
        vs = [P.vert(c) for c in quad + cap]
        for a0, a1 in ((0, 1), (1, 2), (2, 3), (3, 0)):
            f = [vs[a0], vs[a1], vs[a1 + 4], vs[a0 + 4]]; mid = (f[0].co + f[2].co) / 2
            P.face_toward(f, 'bark', mid - (root + tip) / 2, uvs=[(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)], cols=(0.8, 0.8, 0.8, 1.0))
        P.face_toward(vs[4:], 'bark', tip - root, uvs=[(0, 0), (0.1, 0), (0.1, 0.05), (0, 0.05)], cols=(1.0, 0.95, 0.8, 1.0))   # the cut face, paler
    return P.build(smooth=45)

FRONDS = {'palm_frond_up': (1.05, 1.5, False), 'palm_frond_mid': (0.5, 1.7, False), 'palm_frond_low': (-0.1, 1.3, False), 'palm_frond_dry': (-0.1, 1.9, True)}
@piece
def palm_frond(name):
    """A frond 3.2 m long along +X, rising at its tier's elevation and bending down: a spiny petiole, a tapering rachis,
    about 110 leaflets folded along their midribs in a V, longest in the middle; vertex alpha the old t^2 freedom.
    Slot: leaf (the palm_leaf atlas: four leaflet columns, the rachis strip)."""
    e0, bend, dry = FRONDS[name]
    r = stream(name); P = Piece(name, recalc=False); L, N = 3.2, 24
    spine, ang = [Vector((0, 0, 0))], []
    for i in range(N):
        a = e0 - bend * (i + 0.5) / N; ang.append(a); spine.append(spine[-1] + Vector((math.cos(a), 0, math.sin(a))) * L / N)
    def at(t):
        f = min(N - 1e-6, t * N); i = int(f); return spine[i].lerp(spine[i + 1], f - i), ang[i]
    rad = lambda t: 0.035 * (1 - t) + 0.008                       # the rachis
    rings, NR, RS = [], 16, 5                                     # (the rachis: 16 rings of 5 sides)
    for i in range(NR + 1):
        t = i / NR; c, a = at(min(t, 0.999)); U = Vector((-math.sin(a), 0, math.cos(a))); Y = Vector((0, 1, 0))
        rings.append([(P.vert(c + (U * math.cos(2 * math.pi * k / RS) + Y * math.sin(2 * math.pi * k / RS)) * rad(t)), (0.86 + 0.13 * k / RS, t * 3), (1.0, 1.0, 1.0, t * t)) for k in range(RS + 1)])
    for i in range(NR):
        for k in range(RS):
            q = [rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]]; c = (q[0][0].co + q[2][0].co) / 2
            P.face_toward([e[0] for e in q], 'leaf', c - at((i + 0.5) / NR)[0], uvs=[e[1] for e in q], cols=[e[2] for e in q])
    for k in range(10):                                            # spines on the petiole: leaflets turned to thorns
        t = 0.03 + 0.09 * k / 10; c, a = at(t); T = Vector((math.cos(a), 0, math.sin(a))); side = 1 if k % 2 else -1
        d = (Vector((0, side, 0)) * 0.8 + T * 0.6).normalized(); ln = 0.06 + 0.1 * k / 10
        vs = [P.vert(c - T * 0.01), P.vert(c + T * 0.01), P.vert(c + d * ln)]
        P.face_toward(vs, 'leaf', Vector((0, 0, 1)), uvs=[(0.87, 0.1), (0.9, 0.1), (0.88, 0.3)], cols=(1.0, 0.95, 0.75, t * t))
    for side in (-1, 1):                                           # the leaflets
        for i in range(55):                                        # (110 leaflets: the perf rule in the plan, from 140)
            t = 0.13 + 0.85 * (i + (0.5 if side > 0 else 0.0)) / 55
            c, a = at(t); T = Vector((math.cos(a), 0, math.sin(a))); U = Vector((-math.sin(a), 0, math.cos(a))); Y = Vector((0, side, 0))
            ln = (0.18 + 0.36 * math.sin(math.pi * min(1.0, (t - 0.08) / 0.92)) ** 0.7) * r.uniform(0.9, 1.08)
            if dry: d = (Y * 0.45 + T * 0.55 - U * 0.75).normalized(); ln *= 0.85
            else: d = (Y * 0.8 + T * 0.5 + U * (0.42 - 0.3 * t)).normalized()             # forward and up in a V, flattening towards the tip
            n = d.cross(T).normalized() * side
            if n.dot(U) < 0: n = -n
            sag = (U * -0.22 * ln) if not dry else (U * -0.1 * ln)
            pt = lambda f, w: c + d * ln * f + sag * f * f + n * 0.012 * (1 - abs(w)) * math.sin(math.pi * min(1.0, f * 1.4)) + (d.cross(n)).normalized() * w * 0.022 * math.sin(math.pi * min(1.0, f * 1.15) ** 0.8)
            col = r.randrange(3) if not dry else 3; u0, u1 = 0.2 * col + 0.02, 0.2 * col + 0.18; um = (u0 + u1) / 2
            B = P.vert(pt(0, 0)); M = [P.vert(pt(0.35, w)) for w in (-1, 0, 1)]; Q = [P.vert(pt(0.75, w)) for w in (-1, 0, 1)]; Tip = P.vert(pt(1.0, 0))
            sh = r.uniform(0.85, 1.12); cw = lambda f: (sh, sh, sh, min(1.0, t * t + 0.15 * f))
            uvB, uvM, uvQ, uvT = (um, 0.0), [(u0, 0.35), (um, 0.35), (u1, 0.35)], [(u0, 0.75), (um, 0.75), (u1, 0.75)], (um, 1.0)
            for vs, uv, f in (([B, M[1], M[0]], [uvB, uvM[1], uvM[0]], 0.2), ([B, M[2], M[1]], [uvB, uvM[2], uvM[1]], 0.2),
                              ([M[0], M[1], Q[1], Q[0]], [uvM[0], uvM[1], uvQ[1], uvQ[0]], 0.55), ([M[1], M[2], Q[2], Q[1]], [uvM[1], uvM[2], uvQ[2], uvQ[1]], 0.55),
                              ([Q[0], Q[1], Tip], [uvQ[0], uvQ[1], uvT], 0.9), ([Q[1], Q[2], Tip], [uvQ[1], uvQ[2], uvT], 0.9)):
                P.face_toward(vs, 'leaf', n, uvs=uv, cols=cw(f))
    return P.build(smooth=70)

@piece
def palm_dates(name):
    """A cluster of dates under the crown: an orange stalk arching out and down, strands off it, the fruit on them.
    Slots: fruit, stalk."""
    r = stream(name); P = Piece(name); W = (1.0, 1.0, 1.0, 1.0)
    stalk = [Vector((0.0, 0, 0)), Vector((0.2, 0, -0.06)), Vector((0.38, 0, -0.2)), Vector((0.5, 0, -0.42)), Vector((0.55, 0, -0.62))]
    tube(P, stalk, 0.018, 6, 'stalk', W)
    for k in range(26):
        t = 0.35 + 0.65 * k / 26; f = t * (len(stalk) - 1); i = min(len(stalk) - 2, int(f)); o = stalk[i].lerp(stalk[i + 1], f - i)
        a = r.uniform(0, 2 * math.pi); ln = r.uniform(0.18, 0.34)
        tip = o + Vector((0.08 * math.cos(a), 0.12 * math.sin(a), -ln))
        mid = o.lerp(tip, 0.5) + Vector((0.03 * math.cos(a), 0.05 * math.sin(a), 0.02))
        tube(P, [o, mid, tip], 0.004, 3, 'stalk', W)
        for j in range(4):                                         # dates: small octahedra, stretched
            c = mid.lerp(tip, 0.15 + 0.28 * j) + Vector((r.uniform(-0.015, 0.015), r.uniform(-0.015, 0.015), 0))
            s = r.uniform(0.85, 1.1); ex = [Vector((0.011, 0, 0)), Vector((0, 0.011, 0)), Vector((-0.011, 0, 0)), Vector((0, -0.011, 0))]
            ring = [P.vert(c + e * s) for e in ex]; top, bot = P.vert(c + Vector((0, 0, 0.018 * s))), P.vert(c - Vector((0, 0, 0.016 * s)))
            g = r.uniform(0.85, 1.1)
            for q in range(4):
                P.face_toward([ring[q], ring[(q + 1) % 4], top], 'fruit', (ring[q].co + ring[(q + 1) % 4].co) / 2 - c + Vector((0, 0, 0.01)), cols=(g, g, g, 1.0))
                P.face_toward([ring[(q + 1) % 4], ring[q], bot], 'fruit', (ring[q].co + ring[(q + 1) % 4].co) / 2 - c - Vector((0, 0, 0.01)), cols=(g, g, g, 1.0))
    return P.build(smooth=60)

palm_base('palm_base'); palm_seg('palm_seg_a', 0.0); palm_seg('palm_seg_b', 0.37); palm_crown('palm_crown')
for n in FRONDS: palm_frond(n)
palm_dates('palm_dates')

# ---------------------------------------------------------------------------------------------------- laurels -----------
# Indian laurel figs (laurel de la India), the clipped shade trees of Mexican plazas (quarter.js laurel(): four round the
# plazuela, two in the atrium), origin at the trunk's foot (the game scales by the old s). A fluted pale trunk with
# buttress lobes and fused aerial roots, flaring only above the stone planter (0.45 m); limbs from about 2.2 m splitting
# into branches and twigs; a clipped dome of individual leaves, each a blade folded on its midrib, in clusters over the
# shell of the old canopy's ellipsoid (centre 4.2 m up, radius 3.0, half-height 1.86), flatter underneath, darker inside
# and below, the outer leaves freer in the wind. Slots: bark (own texture coordinates, metres), leaf (the leaf atlas).
LAUREL_C, LAUREL_R, LAUREL_H = Vector((0, 0, 4.2)), 3.0, 1.86

def tube_taper(P, pts, radii, sides, slot, col=None, v0=0.0):
    """A bar along pts tapering through radii, faces turned outwards, bark coordinates in metres (u round, v along)."""
    rings, v = [], v0
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized(); u, w = frame(t)
        if i: v += (pts[i] - pts[i - 1]).length
        rings.append([(P.vert(p + (u * math.cos(2 * math.pi * k / sides) + w * math.sin(2 * math.pi * k / sides)) * radii[i]), (k / sides * 2 * math.pi * radii[i], v)) for k in range(sides + 1)])
    for i in range(len(rings) - 1):
        for k in range(sides):
            q = [rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]]; c = (q[0][0].co + q[2][0].co) / 2
            P.face_toward([e[0] for e in q], slot, c - (pts[i] + pts[i + 1]) / 2, uvs=[e[1] for e in q], cols=col)
    return v

@piece
def laurel(name):
    r = stream(name); P = Piece(name, recalc=False)
    bark = lambda sh: (sh, sh, sh, 0.0)
    lobes, ph = r.choice((6, 7, 8)), r.uniform(0, 6.283)
    def trunk_r(z, a):                                              # fluted, buttressed above the planter's top, narrowing up
        base = 0.27 + 0.12 * max(0.0, 1 - (z - 0.45) / 1.3) ** 2 if z > 0.45 else 0.39
        lobe = (0.07 * max(0.0, 1 - (z - 0.45) / 1.6) + 0.025) * max(0.0, math.cos(lobes * a + ph + 0.4 * z)) ** 2
        return base + lobe
    sides, rows = 28, 16
    grid = []
    for i in range(rows + 1):
        z = 2.35 * i / rows
        grid.append([(P.vert((trunk_r(z, 2 * math.pi * j / sides) * math.cos(2 * math.pi * j / sides), trunk_r(z, 2 * math.pi * j / sides) * math.sin(2 * math.pi * j / sides), z)),
                      (2 * math.pi * j / sides * 0.3, z)) for j in range(sides + 1)])
    for i in range(rows):
        for j in range(sides):
            q = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]]; c = (q[0][0].co + q[2][0].co) / 2
            sh = 0.8 + 0.2 * min(1.0, c.z / 1.5)
            P.face_toward([e[0] for e in q], 'bark', Vector((c.x, c.y, 0)), uvs=[e[1] for e in q], cols=bark(sh))
    for k in range(5):                                              # aerial roots fused down the trunk
        a = r.uniform(0, 2 * math.pi); pts = []
        for i in range(9):
            z = 2.2 - 1.75 * i / 8; rr = trunk_r(z, a) + 0.012
            pts.append(Vector((rr * math.cos(a + 0.1 * math.sin(z * 3)), rr * math.sin(a + 0.1 * math.sin(z * 3)), z)))
        tube_taper(P, pts, [0.025 + 0.012 * i / 8 for i in range(9)], 5, 'bark', bark(0.9))
    tips = []
    def grow(start, d, length, r0, r1, depth):
        pts, p = [start], start.copy()
        n = 6 if depth == 0 else 4
        for i in range(n):
            d = (d + Vector((r.uniform(-0.18, 0.18), r.uniform(-0.18, 0.18), r.uniform(-0.04, 0.12)))).normalized()
            p = p + d * length / n; pts.append(p.copy())
        tube_taper(P, pts, [r0 + (r1 - r0) * i / n for i in range(n + 1)], 8 if depth == 0 else (6 if depth == 1 else 4), 'bark', bark(0.85 + 0.05 * depth))
        if depth == 2: tips.append(p); return
        for c in range(3 if depth == 0 else 2):
            q = pts[n - 1 - c] if c < n else pts[-1]
            out = Vector((q.x, q.y, 0)).normalized() if Vector((q.x, q.y, 0)).length > 1e-3 else Vector((1, 0, 0))
            nd = (d * 0.5 + out * 0.6 + Vector((r.uniform(-0.4, 0.4), r.uniform(-0.4, 0.4), r.uniform(0.0, 0.5)))).normalized()
            grow(q, nd, length * r.uniform(0.55, 0.7), r1, r1 * 0.45, depth + 1)
    for k in range(6):                                              # the limbs, out of the trunk's head
        a = 2 * math.pi * k / 6 + r.uniform(-0.3, 0.3); z = r.uniform(1.95, 2.3)
        start = Vector((0.18 * math.cos(a), 0.18 * math.sin(a), z))
        grow(start, Vector((0.72 * math.cos(a), 0.72 * math.sin(a), 0.7)).normalized(), r.uniform(1.6, 2.0), 0.13, 0.065, 0)
    def shell(dirn, rho):                                           # a point on the clipped dome: the ellipsoid, its underside flattened
        p = LAUREL_C + Vector((dirn.x * LAUREL_R, dirn.y * LAUREL_R, dirn.z * LAUREL_H)) * rho
        if p.z < 2.75: p.z = 2.75 - (2.75 - p.z) * 0.35             # (clipped: the underside is nearly flat)
        return p
    nleaf = 0
    for c in range(960):                                            # clusters of leaves over the shell (960: the perf rule in the plan)
        u, v = r.uniform(-1, 1), r.uniform(0, 2 * math.pi); dirn = Vector((math.sqrt(1 - u * u) * math.cos(v), math.sqrt(1 - u * u) * math.sin(v), u))
        rho = r.uniform(0.93, 1.0); centre = shell(dirn, rho)        # (on the outer shell: what is seen from outside)
        nrm = Vector((dirn.x / LAUREL_R, dirn.y / LAUREL_R, dirn.z / LAUREL_H)).normalized()
        depth = (rho - 0.93) / 0.07; low = min(1.0, max(0.0, (centre.z - 2.6) / 2.6))
        cs = r.uniform(0.9, 1.1)
        for k in range(11):
            b = centre + Vector((r.uniform(-0.18, 0.18), r.uniform(-0.18, 0.18), r.uniform(-0.13, 0.13)))
            n = (nrm + Vector((r.uniform(-0.38, 0.38), r.uniform(-0.38, 0.38), r.uniform(-0.38, 0.38)))).normalized()   # (mostly facing out)
            tdir = n.cross(Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1)))).normalized()
            if tdir.length < 0.5: continue
            ln = r.uniform(0.14, 0.19); w = n.cross(tdir).normalized() * ln * 0.24
            B = b; T = b + tdir * ln; Mid = b + tdir * ln * 0.45 + n * 0.006
            vs = [P.vert(B), P.vert(Mid - w), P.vert(T), P.vert(Mid + w)]
            col = r.randrange(4); u0, u1 = 0.25 * col + 0.01, 0.25 * col + 0.24; um = (u0 + u1) / 2
            sh = (0.6 + 0.4 * depth) * (0.78 + 0.22 * low) * cs; a = 0.25 + 0.65 * depth      # (inner leaves, near the twigs, move least)
            P.face_toward([vs[0], vs[1], vs[2]], 'leaf', n, uvs=[(um, 0.0), (u0, 0.45), (um, 1.0)], cols=(sh, sh, sh, a))
            P.face_toward([vs[0], vs[2], vs[3]], 'leaf', n, uvs=[(um, 0.0), (um, 1.0), (u1, 0.45)], cols=(sh, sh, sh, a))
            nleaf += 1
    print('PROPS', name, 'leaves', nleaf)
    return P.build(smooth=60)

laurel('laurel_a'); laurel('laurel_b')

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
