#!/usr/bin/env python3
"""Packs the civilians for the game.

The people are made with Ara 3D Gen (its MCP server's create_character, from the definitions in tools/civilians/people.json;
tools/civilians/README.md says how) and exported as GLB files into build/ara/. One of them, civ_ref.glb, carries the
animation clips. A raw export is 7-13 MB a person: fifteen-odd textures inside each file, the same teeth and skin in
every one, and the clips repeated. This tool turns the lot into what the game loads (assets/civilians/):

  cast.json        who is in the cast (name, voice, temperament, measurements), the clip index, and the shared bones
  anims.bin        every clip once, as each bone's turn in the world away from its rest pose (int16 quaternions).
                   Ara fits a clip to a body that way (measured: the same clip exported for two different bodies agrees
                   to within 0.1 degree per bone outside the legs), so the game refits them to each body as it plays
  <id>.bin         one person: draw groups (skin, face overlays, eyes, mouth, hair, each garment texture, flat-coloured
                   trim), each with its own compact vertices, skin weights and the face shapes that move it, plus the
                   rest skeleton. tools/civ-lods.mjs (run from here) adds the simplified far versions
  tex/<hash>.ktx2  every texture once, whoever wears it, block-compressed (Basis UASTC, as the district's own textures)
  tex/<id>_far.ktx2  one small atlas a person for the far versions, so a person at a distance is a single draw

Needs numpy, Pillow, the `basisu` encoder (Homebrew: basis_universal) and node (for the far versions).
Usage: python3 tools/build-civilians.py [--only id,id] [--force] [--no-tex]
"""
import hashlib, io, json, math, os, shutil, struct, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'build', 'ara')
OUT = os.path.join(ROOT, 'assets', 'civilians')
TEX = os.path.join(OUT, 'tex')
TMP = os.path.join(ROOT, 'build', 'civ-tex')
CAST = os.path.join(ROOT, 'tools', 'civilians', 'people.json')
BASISU = shutil.which('basisu') or '/opt/homebrew/bin/basisu'
FORCE = '--force' in sys.argv
NO_TEX = '--no-tex' in sys.argv
ONLY = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
KTX = {   # the same settings as tools/encode-ktx2.mjs (glTF textures are never flipped)
    'color': ['-uastc', '-uastc_level', '2', '-uastc_rdo_l', '1.25', '-srgb', '-mipmap'],
    'normal': ['-uastc', '-uastc_level', '2', '-normal_map', '-mipmap', '-mip_renorm'],
}
FAR = 1024                                      # the far atlas, pixels square
TAN = (0.93, 0.84, 0.77)                        # Ara's skins are studio-pale: everyone here has been out in the sun (the game tints the near skin the same)
# Ara names a clip in an export by its display name; the game knows it by Ara's clip ID (list_animations)
CLIP_IDS = {
    'Idle': 'idle', 'Crouch idle': 'crouch', 'Walk': 'walk', 'Slouch walk': 'walk_slouch', 'Model walk (catwalk)': 'model_walk', 'Run': 'run',
    'Walk backwards': 'walk_back', 'Strafe left': 'strafe_left', 'Strafe right': 'strafe_right', 'Hit reaction': 'hit', 'Stumble and recover': 'stumble_recover',
    'Side dodge left': 'dodge_left', 'Side dodge right': 'dodge_right', 'Fall': 'fall', 'Hit from front': 'hit_front', 'Hit from back': 'hit_back',
    'Hit from left': 'hit_left', 'Hit from right': 'hit_right', 'Knockdown': 'knockdown', 'Get up (from back)': 'get_up_face_up', 'Get up (from front)': 'get_up_face_down',
    'Death (fall forward)': 'death_forward', 'Death (fall backward)': 'death_backward', 'Shot in the leg': 'shot_leg', 'Shot in the arm': 'shot_arm',
    'Shot in the chest': 'shot_chest', 'Shot in the stomach': 'shot_stomach', 'Pick up (ground)': 'pick_up', 'Use / press': 'use_press', 'Handshake': 'handshake',
    'Talk with gestures': 'talk_gestures', 'Talk': 'talk', 'Phone call': 'phone_call', 'Texting': 'texting', 'Take a picture': 'take_picture', 'Lean on wall': 'lean_wall',
    'Look around': 'look_around', 'Wave': 'wave', 'Cheer': 'cheer', 'Laugh': 'laugh', 'Laugh hard': 'laugh_hard', 'Cry': 'cry', 'Clap': 'clap', 'Point': 'point',
    'Thumbs up': 'thumbs_up', 'Sit down (chair)': 'sit_down', 'Sit idle (chair)': 'sit_idle', 'Stand up (chair)': 'stand_up', 'Turn left 45°': 'turn_left_45',
    'Turn left 90°': 'turn_left_90', 'Turn right 45°': 'turn_right_45', 'Turn right 90°': 'turn_right_90', 'Block (unarmed)': 'block', 'Take cover': 'take_cover',
    'Cover idle': 'cover_idle', 'Crouch walk (aiming)': 'rifle_crouch_walk', 'Lie down': 'lie_down', 'Jump land': 'jump_land',
}
LOOPS = {'idle', 'crouch', 'walk', 'walk_slouch', 'model_walk', 'run', 'walk_back', 'strafe_left', 'strafe_right', 'talk_gestures', 'talk', 'phone_call', 'texting',
         'take_picture', 'lean_wall', 'look_around', 'wave', 'cheer', 'laugh', 'laugh_hard', 'cry', 'clap', 'sit_idle', 'cover_idle', 'rifle_crouch_walk'}
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class Glb:
    def __init__(self, path):
        buf = open(path, 'rb').read()
        n = struct.unpack_from('<I', buf, 12)[0]
        self.J = json.loads(buf[20:20 + n]); self.B = buf[20 + n + 8:]

    def acc(self, i):
        A = self.J['accessors'][i]; n = NC[A['type']]; dt = np.dtype(CT[A['componentType']])
        if 'bufferView' in A:
            v = self.J['bufferViews'][A['bufferView']]; off = v.get('byteOffset', 0) + A.get('byteOffset', 0); stride = v.get('byteStride', 0)
            if stride and stride != dt.itemsize * n:
                a = np.frombuffer(self.B, np.uint8, stride * A['count'], off).reshape(A['count'], stride)[:, :dt.itemsize * n].copy().view(dt).reshape(A['count'], n)
            else: a = np.frombuffer(self.B, dt, A['count'] * n, off).reshape(A['count'], n).copy()
        else: a = np.zeros((A['count'], n), dt)
        if 'sparse' in A:
            s = A['sparse']; iv = self.J['bufferViews'][s['indices']['bufferView']]; vv = self.J['bufferViews'][s['values']['bufferView']]
            idx = np.frombuffer(self.B, CT[s['indices']['componentType']], s['count'], iv.get('byteOffset', 0) + s['indices'].get('byteOffset', 0))
            a[idx] = np.frombuffer(self.B, dt, s['count'] * n, vv.get('byteOffset', 0) + s['values'].get('byteOffset', 0)).reshape(s['count'], n)
        return a

    def image(self, tex_index):
        im = self.J['images'][self.J['textures'][tex_index]['source']]; v = self.J['bufferViews'][im['bufferView']]
        return self.B[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]


# ---- quaternions (x, y, z, w), arrays of shape (..., 4) --------------------------------------------------------------------
def qmul(a, b):
    ax, ay, az, aw = np.moveaxis(a, -1, 0); bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], -1)
def qinv(q): return q * np.array([-1, -1, -1, 1.0])
def qrot(q, v):
    u = q[..., :3]; w = q[..., 3:4]; t = 2 * np.cross(u, v)
    return v + w * t + np.cross(u, t)


def skeleton(g):
    """Bones in the skin's own order (parents first), with their rest pose and their rest orientation in the world."""
    J = g.J; nodes = J['nodes']; joints = J['skins'][0]['joints']; parent_of = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent_of[c] = i
    order = {j: k for k, j in enumerate(joints)}
    bones = []
    for j in joints:
        n = nodes[j]; p = parent_of.get(j)
        bones.append({'name': n['name'], 'parent': order.get(p, -1), 't': np.array(n.get('translation', [0, 0, 0]), float), 'r': np.array(n.get('rotation', [0, 0, 0, 1]), float), 'node': j})
    for k, b in enumerate(bones): assert b['parent'] < k, 'bones are not parents-first'
    for b in bones:
        p = bones[b['parent']] if b['parent'] >= 0 else None
        b['wr'] = qmul(p['wr'], b['r']) if p else b['r']
        b['wp'] = p['wp'] + qrot(p['wr'], b['t']) if p else b['t']
    return bones


# ---- textures ---------------------------------------------------------------------------------------------------------------
def to_srgb(c): return [round(255 * (12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055)) for x in c]
_images = {}
def decode(data):
    h = hashlib.sha1(data).hexdigest()[:12]
    if h not in _images: _images[h] = Image.open(io.BytesIO(data)); _images[h].load()
    return h, _images[h]

class Pool:
    """Every texture once. `add` hands back the file a material will ask for; the encoding happens at the end, in parallel."""
    def __init__(self): self.jobs = {}
    def add(self, img, role, cap, key):
        name = hashlib.sha1((key + role + str(cap)).encode()).hexdigest()[:12] + '.ktx2'
        if name not in self.jobs: self.jobs[name] = (img, role, cap)
        return 'tex/' + name
    def encode(self):
        os.makedirs(TEX, exist_ok=True); os.makedirs(TMP, exist_ok=True)
        todo = [(n, j) for n, j in self.jobs.items() if FORCE or not os.path.exists(os.path.join(TEX, n))]
        def one(item):
            name, (img, role, cap) = item
            w, h = img.size; k = min(1, cap / max(w, h)); w, h = max(4, round(w * k / 4) * 4), max(4, round(h * k / 4) * 4)
            im = img if img.mode in ('RGB', 'RGBA') else img.convert('RGBA' if 'A' in img.getbands() or img.mode == 'P' else 'RGB')
            if im.size != (w, h): im = im.resize((w, h), Image.LANCZOS)
            if im.mode == 'RGBA' and im.getextrema()[3][0] == 255: im = im.convert('RGB')
            png = os.path.join(TMP, name[:-5] + '.png'); im.save(png)
            subprocess.run([BASISU, *KTX[role], '-ktx2', '-ktx2_zstandard_level', '15', '-quiet', '-output_file', os.path.join(TEX, name), png], check=True, stdout=subprocess.DEVNULL)
            return name
        if NO_TEX: print(f'textures: {len(todo)} to encode, skipped (--no-tex)'); return
        with ThreadPoolExecutor(4) as ex:
            for i, name in enumerate(ex.map(one, todo)): print(f'\r  textures {i + 1}/{len(todo)}', end='', flush=True)
        if todo: print()
        wanted = set(self.jobs)
        if not ONLY:
            for f in os.listdir(TEX):
                if f.endswith('.ktx2') and f not in wanted: os.remove(os.path.join(TEX, f))


def compose(cells, size):
    """Several textures side by side in one image; cells: [(image, x, y, w, h)]."""
    out = Image.new('RGBA', size, (0, 0, 0, 0))
    for img, x, y, w, h in cells: out.paste(img.convert('RGBA').resize((w, h), Image.LANCZOS), (x, y))
    return out


class Atlas:
    """Shelf packing with a gutter round each cell, filled with the cell's own edge so smaller mip levels do not bleed."""
    def __init__(self, size, pad=6):
        self.size = size; self.pad = pad; self.img = Image.new('RGBA', (size, size), (128, 128, 128, 255)); self.x = 0; self.y = 0; self.row = 0
    def place(self, img, w, h):
        pad = self.pad; W, H = w + 2 * pad, h + 2 * pad
        if self.x + W > self.size: self.x = 0; self.y += self.row; self.row = 0
        if self.y + H > self.size: raise RuntimeError('far atlas is full')
        im = img.convert('RGBA').resize((w, h), Image.LANCZOS)
        big = im.resize((W, H), Image.NEAREST) if w <= 2 else None
        if big is None:
            a = np.asarray(im); big = Image.fromarray(np.pad(a, ((pad, pad), (pad, pad), (0, 0)), mode='edge'))
        self.img.paste(big, (self.x, self.y))
        cell = (self.x + pad, self.y + pad, w, h)
        self.x += W; self.row = max(self.row, H)
        return cell


def pack_character(entry, pool):
    cid = entry['id']; g = Glb(os.path.join(SRC, cid + '.glb')); J = g.J
    mesh = J['meshes'][0]; prims = mesh['primitives']; P0 = prims[0]['attributes']
    pos = g.acc(P0['POSITION']).astype(np.float32); nrm = g.acc(P0['NORMAL']).astype(np.float32); uv = g.acc(P0['TEXCOORD_0']).astype(np.float32)
    jn = g.acc(P0['JOINTS_0']).astype(np.int64); wt = g.acc(P0['WEIGHTS_0']).astype(np.float64)
    for p in prims: assert p['attributes']['POSITION'] == P0['POSITION'], 'expected one shared vertex buffer'
    bones = skeleton(g)
    names = mesh.get('extras', {}).get('targetNames', [])
    deltas = [g.acc(t['POSITION']).astype(np.float32) for t in prims[0].get('targets', [])]
    moved = np.zeros(len(pos), bool)
    for d in deltas: moved |= np.abs(d).max(1) > 2e-5

    def mat(p):
        m = J['materials'][p['material']]; pbr = m.get('pbrMetallicRoughness', {})
        return {'name': m['name'], 'base': pbr.get('baseColorFactor', [1, 1, 1, 1]), 'tex': pbr.get('baseColorTexture', {}).get('index'), 'nrm': m.get('normalTexture', {}).get('index'),
                'rough': pbr.get('roughnessFactor', 1), 'metal': pbr.get('metallicFactor', 1), 'alpha': m.get('alphaMode', 'OPAQUE'), 'cut': m.get('alphaCutoff', 0.5), 'ds': bool(m.get('doubleSided'))}

    # ---- sort the primitives into draw groups ------------------------------------------------------------------------------
    groups = {}                                                              # key -> { kind, mat, parts: [(name, indices)] }
    def group(key, kind, material): return groups.setdefault(key, {'kind': kind, 'mat': material, 'parts': []})
    overlay_cells = {}; mouth_cells = {}; uv = uv.copy(); col = np.full((len(pos), 4), 255, np.uint8)
    for p in prims:
        m = mat(p); idx = g.acc(p['indices']).ravel().astype(np.int64); nm = m['name']
        if nm == 'Skin':                                                         # the part of the skin a face shape moves is its own group: only it carries the shapes
            tri = moved[idx].reshape(-1, 3).any(1).repeat(3)
            if tri.any(): group('face', 'face', m)['parts'].append(('Face', idx[tri]))
            if (~tri).any(): group('skin', 'skin', m)['parts'].append((nm, idx[~tri]))
        elif nm in ('Skin details', 'Eyebrows', 'Eyelashes'): overlay_cells[nm] = (m, idx)
        elif nm == 'Eyes': group('eyes', 'eyes', m)['parts'].append((nm, idx))
        elif nm in ('Teeth', 'Tongue'): mouth_cells[nm] = (m, idx)
        elif m['tex'] is not None:
            hair = nm.lower().startswith('hair') or m['alpha'] == 'MASK'
            key = ('hair' if hair else 'cloth', hashlib.sha1(g.image(m['tex'])).hexdigest()[:10], m['nrm'] is not None and hashlib.sha1(g.image(m['nrm'])).hexdigest()[:10], m['ds'], m['alpha'], round(m['rough'], 2), tuple(round(x, 3) for x in m['base']))
            group(key, 'hair' if hair else 'cloth', m)['parts'].append((nm, idx))
        else:
            kind = 'glass' if m['alpha'] == 'BLEND' or m['base'][3] < 0.98 else 'metal' if m['metal'] > 0.5 else 'flat'
            u = np.unique(idx); col[u, :3] = to_srgb(m['base'][:3]); col[u, 3] = round(255 * (m['base'][3] if kind == 'glass' else m['rough']))   # (alpha: a lens's opacity, otherwise the roughness)
            group(kind, kind, {**m, 'base': [1, 1, 1, 1]})['parts'].append((nm, idx))

    # eyebrows the colour of the person's hair (Ara's brow textures are one pale brown for everyone)
    hair_rgb = None
    for gr in groups.values():
        if gr['kind'] == 'hair' and gr['mat']['name'].lower().startswith('hair'):
            a = np.asarray(decode(g.image(gr['mat']['tex']))[1].convert('RGBA')).astype(np.float32).reshape(-1, 4); a = a[a[:, 3] > 128]
            if len(a): hair_rgb = a[:, :3].mean(0) * np.array(to_srgb(gr['mat']['base'][:3])) / 255
    if hair_rgb is None:
        hx = entry['ara']['params'].get('hairColor') or entry['ara']['params'].get('hairTint')
        if hx: hair_rgb = np.array([int(hx[i:i + 2], 16) for i in (1, 3, 5)], np.float32)
    textures = {}
    def tex(index, role, cap):
        data = g.image(index); h, img = decode(data)
        return pool.add(img, role, cap, h)
    # face overlays (lip and skin detail, eyebrows, eyelashes): three small textures side by side, one blended draw
    if overlay_cells:
        cells = []; key = ''
        for k, nm in enumerate(('Skin details', 'Eyebrows', 'Eyelashes')):
            if nm not in overlay_cells: continue
            m, idx = overlay_cells[nm]; h, img = decode(g.image(m['tex'])); key += h + str(m['base'])
            a = np.asarray(img.convert('RGBA').resize((512, 512), Image.LANCZOS)).astype(np.float32); a[..., 3] *= m['base'][3]; a[..., :3] *= np.array(to_srgb(m['base'][:3])) / 255
            if nm == 'Eyebrows' and hair_rgb is not None:
                lum = a[..., :3].mean(-1, keepdims=True); mean = float((lum[..., 0] * a[..., 3]).sum() / max(1.0, a[..., 3].sum())) or 1.0
                a[..., :3] = np.clip(hair_rgb * 0.62 + 6, 4, 150) * np.clip(lum / mean, 0.6, 1.5); a[..., 3] = np.clip(a[..., 3] * 1.25, 0, 255); key += 'brow' + str(hair_rgb.round())
            x, y = (k % 2) * 512, (k // 2) * 512; cells.append((Image.fromarray(a.clip(0, 255).astype(np.uint8)), x, y, 512, 512))
            u = np.unique(idx); uv[u] = (np.clip(uv[u], 0, 1) * 512 + [x, y]) / 1024
            group('overlay', 'overlay', {**m, 'base': [1, 1, 1, 1], 'rough': 0.8})['parts'].append((nm, idx))
        textures['overlay'] = pool.add(compose(cells, (1024, 1024)), 'color', 1024, 'overlay' + key)
    if mouth_cells:
        cells = []; key = ''
        for nm, (x, y, s) in (('Teeth', (0, 0, 512)), ('Tongue', (512, 0, 256))):
            if nm not in mouth_cells: continue
            m, idx = mouth_cells[nm]; h, img = decode(g.image(m['tex'])); key += h + str(m['base'])
            a = np.asarray(img.convert('RGB').resize((s, s), Image.LANCZOS)).astype(np.float32) * np.array(to_srgb(m['base'][:3])) / 255
            cells.append((Image.fromarray(a.clip(0, 255).astype(np.uint8)), x, y, s, s))
            u = np.unique(idx); uv[u] = (np.clip(uv[u], 0, 1) * s + [x, y]) / [1024, 512]
            group('mouth', 'mouth', {**m, 'base': [1, 1, 1, 1], 'rough': 0.35})['parts'].append((nm, idx))
        im = compose(cells, (1024, 512)).convert('RGB')
        textures['mouth'] = pool.add(im, 'color', 1024, 'mouth' + key)

    # ---- the far atlas: every textured or coloured part that still shows at a distance, in one image ------------------------
    atlas = Atlas(FAR); uv2 = np.zeros((len(pos), 2), np.float32); tri_area = {}
    def area(idx):
        a, b, c = pos[idx[0::3]], pos[idx[1::3]], pos[idx[2::3]]
        return float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum() / 2)
    def far_cell(m, idx, size, use_alpha, tone=None):
        u = np.unique(idx); h, img = decode(g.image(m['tex'])); im = img.convert('RGBA')
        a = np.asarray(im).astype(np.float32); a[..., :3] *= np.array(to_srgb(m['base'][:3])) / 255
        if tone: a[..., :3] *= np.array(to_srgb(tone)) / 255
        if not use_alpha: a[..., 3] = 255
        elif tone is None and m['alpha'] == 'MASK': a[..., 3] = np.clip(a[..., 3] * 2.6, 0, 255)      # (strands of hair must survive being shrunk to a few pixels)
        im = Image.fromarray(a.clip(0, 255).astype(np.uint8))
        lo = np.floor(uv[u].min(0) + 0.02); hi = np.ceil(uv[u].max(0) - 0.02); tiles = np.maximum(hi - lo, 1).astype(int)
        if tiles[0] * tiles[1] > 40:                                         # a fine repeat (a rib, a weave): its average colour
            c = tuple(int(x) for x in np.asarray(im.resize((1, 1), Image.BOX))[0, 0])
            x, y, w, hh = atlas.place(Image.new('RGBA', (2, 2), c), 2, 2); uv2[u] = [(x + 1) / FAR, (y + 1) / FAR]; return
        if tiles[0] * tiles[1] > 1:                                          # a few repeats: baked out, so a print keeps its pattern
            tw, th = max(8, size // tiles[0]), max(8, size // tiles[1]); small = im.resize((tw, th), Image.LANCZOS)
            big = Image.new('RGBA', (tw * tiles[0], th * tiles[1]))
            for i in range(tiles[0]):
                for j in range(tiles[1]): big.paste(small, (i * tw, j * th))
            im = big
        w, hh = (size, size) if tiles[0] == tiles[1] else (size, max(8, size * tiles[1] // tiles[0])) if tiles[0] > tiles[1] else (max(8, size * tiles[0] // tiles[1]), size)
        x, y, w, hh = atlas.place(im, w, hh)
        uv2[u] = (np.clip((uv[u] - lo) / tiles, 0, 1) * [w, hh] + [x, y]) / FAR

    order = sorted(groups.items(), key=lambda kv: {'skin': 0, 'face': 0, 'hair': 1, 'cloth': 2}.get(kv[1]['kind'], 3))
    cloth_area = sum(area(np.concatenate([i for _, i in gr['parts']])) for _, gr in order if gr['kind'] == 'cloth') or 1
    for key, gr in order:
        idx = np.concatenate([i for _, i in gr['parts']]); kind = gr['kind']; m = gr['mat']
        if kind == 'skin': far_cell(m, np.concatenate([idx] + [i for _, i in groups.get('face', {'parts': []})['parts']]), 440, False, TAN)
        elif kind == 'face': continue
        elif kind == 'hair': far_cell(m, idx, 300, True)
        elif kind == 'eyes': far_cell(m, idx, 48, False)
        elif kind == 'cloth':
            share = area(idx) / cloth_area; far_cell(m, idx, 256 if share > 0.3 else 192 if share > 0.12 else 128 if share > 0.04 else 64, m['alpha'] != 'OPAQUE')
        elif kind in ('flat', 'metal', 'glass'):
            for nm, pidx in gr['parts']:
                u = np.unique(pidx); c = tuple(int(x) for x in col[u[0], :3]) + (255,)
                x, y, w, hh = atlas.place(Image.new('RGBA', (2, 2), c), 2, 2); uv2[u] = [(x + 1) / FAR, (y + 1) / FAR]
    if 'Eyebrows' in overlay_cells:                                           # (cut out by alpha at a distance; lip detail and lashes are left out)
        m, idx = overlay_cells['Eyebrows']; u = np.unique(idx); h, img = decode(g.image(m['tex']))
        x, y, w, hh = atlas.place(img, 96, 96)
        uv2[u] = ((uv[u] * 1024 - [512, 0]) / 512 * [w, hh] + [x, y]) / FAR   # (their cell in the overlay image is the second: back to the texture's own coordinates first)
    textures['far'] = pool.add(atlas.img, 'color', FAR, 'far' + cid + hashlib.sha1(atlas.img.tobytes()).hexdigest()[:12])

    # ---- write the groups -------------------------------------------------------------------------------------------------
    blob = bytearray()
    def put(a):
        while len(blob) % 4: blob.append(0)
        off = len(blob); blob.extend(np.ascontiguousarray(a).tobytes()); return off
    w4 = wt.copy(); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9); wq = np.round(w4 * 255).astype(np.int64)
    wq[np.arange(len(wq)), wq.argmax(1)] += 255 - wq.sum(1)                   # (the four weights of a vertex add up to 255 exactly)
    out_groups = []
    for key, gr in groups.items():
        kind = gr['kind']; m = gr['mat']; idx = np.concatenate([i for _, i in gr['parts']])
        u, inv = np.unique(idx, return_inverse=True)
        G = {'kind': kind, 'name': gr['parts'][0][0], 'verts': int(len(u)), 'tris': int(len(idx) // 3), 'rough': round(m['rough'], 3), 'ds': m['ds'], 'alpha': m['alpha'],
             'base': [round(x, 4) for x in m['base']], 'parts': [], 'far': kind not in ('mouth',)}
        s = 0
        for nm, pidx in gr['parts']: G['parts'].append({'name': nm, 'start': s, 'count': int(len(pidx))}); s += len(pidx)
        if kind in ('skin', 'face'): G['map'] = tex(m['tex'], 'color', 2048)
        elif kind == 'eyes': G['map'] = tex(m['tex'], 'color', 512)
        elif kind == 'hair': G['map'] = tex(m['tex'], 'color', 1024); G['cut'] = m['cut']
        elif kind == 'cloth':
            G['map'] = tex(m['tex'], 'color', 1024)
            if m['nrm'] is not None: G['normalMap'] = tex(m['nrm'], 'normal', 1024)
        elif kind in ('overlay', 'mouth'): G['map'] = textures[kind]
        n8 = np.zeros((len(u), 4), np.int8); n8[:, :3] = np.round(nrm[u] * 127)
        G['pos'] = put(pos[u]); G['nrm'] = put(n8); G['uv'] = put(uv[u]); G['uv2'] = put(np.round(np.clip(uv2[u], 0, 1) * 65535).astype(np.uint16))
        G['joints'] = put(jn[u].astype(np.uint8)); G['weights'] = put(wq[u].astype(np.uint8)); G['index'] = put(inv.astype(np.uint16 if len(u) < 65536 else np.uint32)); G['index32'] = len(u) >= 65536
        if kind in ('flat', 'metal', 'glass'): G['col'] = put(col[u])
        if kind in ('face', 'overlay', 'mouth') and deltas:                     # the face shapes that move this group, each as the vertices it moves
            G['morph'] = []
            for d in deltas:
                dv = d[u]; hit = np.nonzero(np.abs(dv).max(1) > 2e-5)[0]
                if not len(hit): G['morph'].append(None); continue
                scale = float(np.abs(dv[hit]).max()) / 32767
                G['morph'].append({'n': int(len(hit)), 'scale': scale, 'idx': put(hit.astype(np.uint16)), 'd': put(np.round(dv[hit] / scale).astype(np.int16))})
        out_groups.append(G)

    by = {b['name']: b for b in bones}
    eyes = (by['LeftEye']['wp'] + by['RightEye']['wp']) / 2 if 'LeftEye' in by else by['Head']['wp'] + [0, 0.07, 0.08]
    header = {
        'id': cid, 'height': round(float(pos[:, 1].max()), 4), 'eye': [round(float(x), 4) for x in eyes], 'hipY': round(float(by['Hips']['wp'][1]), 4),
        'ankleY': round(float(by['LeftFoot']['wp'][1]), 4), 'toeY': round(float(by['LeftToeBase']['wp'][1]), 4),
        'bones': [{'name': b['name'], 'parent': b['parent'], 't': [round(float(x), 6) for x in b['t']], 'r': [round(float(x), 6) for x in b['r']]} for b in bones],
        'morphs': names, 'tan': list(TAN), 'groups': out_groups, 'farMap': textures['far'], 'tris': int(sum(G['tris'] for G in out_groups)),
    }
    hj = json.dumps(header, separators=(',', ':')).encode(); hj += b' ' * (-len(hj) % 4)
    with open(os.path.join(OUT, cid + '.bin'), 'wb') as f: f.write(b'CIV1' + struct.pack('<I', len(hj)) + hj + blob)
    return header


def pack_clips(path):
    """Every clip of the reference export as world-space turns from rest, the pelvis' travel, and what the clip does with the face and the phone."""
    g = Glb(path); J = g.J; bones = skeleton(g); idx = {b['node']: k for k, b in enumerate(bones)}; names = [b['name'] for b in bones]
    wr = np.array([b['wr'] for b in bones]); rest_r = np.array([b['r'] for b in bones]); hips = names.index('Hips'); hip_rest = bones[hips]['t']
    morphs = J['meshes'][0].get('extras', {}).get('targetNames', [])
    keep = [k for k, n in enumerate(names) if n not in ('Phone', 'WeaponR') and not n.endswith('_End') and not (n.endswith('4') and 'Hand' in n)]
    blob = bytearray(); clips = []
    def put(a):
        while len(blob) % 4: blob.append(0)
        off = len(blob); blob.extend(np.ascontiguousarray(a).tobytes()); return off
    for a in J['animations']:
        cid = CLIP_IDS.get(a['name'])
        if not cid: print('  (no ID for clip', a['name'] + ')'); continue
        times = g.acc(a['samplers'][0]['input']).ravel(); n = len(times); dur = float(times[-1])
        local = np.repeat(rest_r[None], n, 0)                                 # (keys, bones, 4)
        hip_t = np.repeat(hip_rest[None], n, 0); weights = None; phone = {}
        for c in a['channels']:
            s = a['samplers'][c['sampler']]; node = c['target']['node']; path_ = c['target']['path']; o = g.acc(s['output'])
            assert len(g.acc(s['input'])) == n, 'tracks of one clip differ in length'
            if path_ == 'weights': weights = o.reshape(n, -1)
            elif node in idx and path_ == 'rotation': local[:, idx[node]] = o
            elif node in idx and path_ == 'translation' and idx[node] == hips: hip_t = o.astype(float)
            elif node in idx and names[idx[node]] == 'Phone': phone[path_] = o.astype(float)
        world = np.zeros_like(local); wpos = np.zeros((n, len(bones), 3))
        for k, b in enumerate(bones):
            p = b['parent']
            world[:, k] = qmul(world[:, p], local[:, k]) if p >= 0 else local[:, k]
            wpos[:, k] = (wpos[:, p] + qrot(world[:, p], np.repeat(b['t'][None], n, 0))) if p >= 0 else (hip_t if k == hips else np.repeat(b['t'][None], n, 0))
        delta = qmul(world, qinv(wr)[None])                                   # each bone's turn in the world from its rest attitude
        delta /= np.linalg.norm(delta, axis=-1, keepdims=True)
        for k in range(1, n):                                                 # the same way round from key to key, so keys can be blended without a flip
            flip = (delta[k] * delta[k - 1]).sum(-1) < 0; delta[k][flip] *= -1
        clip = {'id': cid, 'name': a['name'], 'dur': round(dur, 4), 'keys': n, 'loop': cid in LOOPS, 'q': put(np.round(delta[:, keep] * 32767).astype(np.int16)), 'hips': put((hip_t - hip_rest).astype(np.float32))}
        # feet: when each is on the ground. Low is not enough (a swinging foot skims the ground too): a planted foot is low
        # and, in a clip that walks on the spot, going backwards under the body at the pace of the walk; in any other
        # clip, still. Runs of less than a tenth of a second are noise either way.
        moving = cid in ('walk', 'walk_slouch', 'model_walk', 'run', 'walk_back', 'strafe_left', 'strafe_right', 'rifle_crouch_walk')
        dtk = max(1e-6, dur / (n - 1)); feet = {}; pace = []
        def tidy(flags, loop):
            f = np.array(flags, bool); m = len(f)
            for want in (False, True):                                       # fill short gaps, then drop short runs
                k = 0
                while k < m:
                    if f[k] == want: k += 1; continue
                    e = k
                    while e < m and f[e] != want: e += 1
                    edge = (k == 0 or e == m) and not loop
                    if e - k < 4 and not edge: f[k:e] = want
                    k = e
            return f
        for side in ('Left', 'Right'):
            fk, tk = names.index(side + 'Foot'), names.index(side + 'ToeBase')
            ay = wpos[:, fk, 1] - bones[fk]['wp'][1]; ty = wpos[:, tk, 1] - bones[tk]['wp'][1]; low = (np.minimum(ay, ty) < 0.04) & (ty < 0.06)
            vel = np.zeros((n, 2)); vel[:-1] = (wpos[1:, tk][:, [0, 2]] - wpos[:-1, tk][:, [0, 2]]) / dtk; vel[-1] = vel[0] if cid in LOOPS else vel[-2]      # (the ball of the foot: the ankle rolls over it through a stance, the ball stays put)
            if moving:
                sp = np.linalg.norm(vel, axis=1); ref = vel[low][np.argsort(sp[low])[len(sp[low]) // 2:]].mean(0) if low.sum() > 3 else vel.mean(0)   # the faster half of the low frames: mid-stance
                rl = np.linalg.norm(ref) or 1.0; along = vel @ (ref / rl)
                down = tidy(low & (along > 0.55 * rl), True)
                if down.any(): pace.append(float(np.median(along[down & (along > 0.8 * rl)])) if (down & (along > 0.8 * rl)).any() else rl)
            else: down = tidy(low & (np.linalg.norm(vel, axis=1) < 0.35), cid in LOOPS)
            feet[side] = down
        clip['down'] = {'L': ''.join('1' if x else '0' for x in feet['Left']), 'R': ''.join('1' if x else '0' for x in feet['Right'])}
        if moving: clip['speed'] = round(float(np.mean(pace)), 3) if pace else 0     # how fast the ground goes by under a planted foot
        if weights is not None and weights.shape[1] == len(morphs) and float(np.abs(weights[:, 2:]).max()) > 0.04:              # the clip acts with the face (beyond blinking)
            clip['face'] = put(np.round(np.clip(weights, 0, 1) * 255).astype(np.uint8))
        if 'scale' in phone and float(phone['scale'].max()) > 100:                                                              # the phone is out: where it sits in the hand that holds it
            pk = names.index('Phone'); pr = phone.get('rotation', np.repeat(np.array([[0, 0, 0, 1.0]]), n, 0)); pt = phone.get('translation', np.zeros((n, 3)))
            hand = min(('LeftHand', 'RightHand'), key=lambda h: float(np.linalg.norm(wpos[:, names.index(h)] - pt, axis=1).mean())); hk = names.index(hand)
            hq = world[:, hk]; lp = qrot(qinv(hq), pt - wpos[:, hk]); lq = qmul(qinv(hq), pr)
            for k in range(1, n):
                if (lq[k] * lq[0]).sum() < 0: lq[k] *= -1
            q = lq.mean(0); q /= np.linalg.norm(q)
            clip['phone'] = {'hand': hand, 'p': [round(float(x), 5) for x in lp.mean(0)], 'q': [round(float(x), 5) for x in q], 'spread': round(float(np.linalg.norm(lp - lp.mean(0), axis=1).max()), 4)}
        clips.append(clip)
    with open(os.path.join(OUT, 'anims.bin'), 'wb') as f: f.write(blob)
    hand_r = names.index('RightHand')
    return {'bones': [names[k] for k in keep], 'hipY': round(float(bones[hips]['wp'][1]), 4), 'fps': 30, 'morphs': morphs, 'clips': clips,
            'restWorld': {names[k]: [round(float(x), 6) for x in wr[k]] for k in keep}}


def main():
    os.makedirs(OUT, exist_ok=True)
    cast = json.load(open(CAST)); pool = Pool(); people = []
    old = {}
    if ONLY and os.path.exists(os.path.join(OUT, 'cast.json')): old = {p['id']: p for p in json.load(open(os.path.join(OUT, 'cast.json')))['people']}
    for entry in cast['people']:
        cid = entry['id']
        if ONLY and cid not in ONLY:
            if cid in old: people.append(old[cid])
            continue
        if not os.path.exists(os.path.join(SRC, cid + '.glb')): print('missing export:', cid); continue
        h = pack_character(entry, pool)
        info = {k: v for k, v in entry.items() if k != 'ara'}
        info.update({'height': h['height'], 'tris': h['tris'], 'groups': len(h['groups']), 'female': entry['ara']['params'].get('gender', 0.5) < 0.5})
        people.append(info); print(f"{cid}: {h['height']:.2f} m, {h['tris']} tris in {len(h['groups'])} groups")
    anims = pack_clips(os.path.join(SRC, cast.get('clips', 'civ_ref') + '.glb'))
    print(f"clips: {len(anims['clips'])}, {os.path.getsize(os.path.join(OUT, 'anims.bin')) / 1e6:.1f} MB")
    pool.encode()
    json.dump({'version': 1, 'anims': anims, 'people': people}, open(os.path.join(OUT, 'cast.json'), 'w'), separators=(',', ':'))
    ids = [p['id'] for p in people if not ONLY or p['id'] in ONLY]
    subprocess.run(['node', os.path.join(ROOT, 'tools', 'civ-lods.mjs'), *ids], check=True)
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    print(f'assets/civilians: {total / 1e6:.1f} MB')


if __name__ == '__main__': main()
