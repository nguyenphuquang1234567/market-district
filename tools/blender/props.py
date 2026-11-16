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
SHOW = {'stone': (0.62, 0.6, 0.56)}
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

    def merge(self, bm, slot, col=None, uv=None):
        """Copy a finished bmesh in. col(co, normal) -> rgba and uv(co, normal) -> (u, v) are asked per corner."""
        vs = [self.vert(v.co) for v in bm.verts]
        bm.verts.index_update()
        for f in bm.faces:
            f.normal_update()
            cs = [v.co for v in f.verts]
            self.face([vs[v.index] for v in f.verts], slot,
                      [uv(c, f.normal) for c in cs] if uv else None,
                      [col(c, f.normal) for c in cs] if col else None)

    def build(self, smooth=40):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        self.bm.to_mesh(me); self.bm.free()
        for s in self.slots: me.materials.append(mat(s))
        me.color_attributes.active_color = me.color_attributes['Col']
        ob = bpy.data.objects.new(self.name, me); scene.collection.objects.link(ob)
        only(ob); bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth), keep_sharp_edges=True)
        return ob

def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

pieces = []
def piece(fn):
    """Register a piece builder: fn(name) -> object. --only skips the others (for a quick look at one piece)."""
    def run(name, *a):
        if ONLY and name not in ONLY: return None
        ob = fn(name, *a); pieces.append(ob); return ob
    return run

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

# ---------------------------------------------------------------------------------------------------- export ---------
for ob in pieces: ob.location = (0, 0, 0)
print('PROPS pieces (triangles):', ', '.join(f'{ob.name} {tri_count(ob)}' for ob in pieces))
for ob in bpy.data.objects: ob.select_set(ob in pieces)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_normals=True, export_texcoords=True, export_materials='EXPORT', export_vertex_color='ACTIVE',
                          export_tangents=False)
print('PROPS written', OUT)

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
        pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        c = sum(pts, Vector()) / 8; rad = max((p - c).length for p in pts)
        d = Vector((0.75, -1.3, 0.7)).normalized()
        cam.location = c + d * rad / math.tan(cam.data.angle / 2) * 1.08
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.clip_start = rad * 0.01; cam.data.clip_end = rad * 50
        scene.render.filepath = os.path.join(PREVIEW, ob.name + '.png')
        bpy.ops.render.render(write_still=True)
    print('PROPS previews', PREVIEW)
