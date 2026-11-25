"""Builds the district in the Unreal port from the game's own export (tools/ue-export.js -> build/ue-export): textures from
the game's scanned sets and models (assets/tex, assets/models) and its procedural PNGs, one material instance per game
material on two masters made here (opaque, and masked two-sided for foliage and cut-outs), every material's geometry as
a Nanite static mesh with complex collision, and the level: the meshes, a sun where the game's sun is, sky atmosphere,
real-time sky light, height fog, a post-process volume, the lamps as point lights, and both teams' spawn points.

Run in the editor (MCP execute_python or the Python console), in steps short enough for one call each:
    import sys; sys.path.insert(0, '<repo>/tools/ue'); import import_map as M
    M.textures(); M.masters(); M.materials(); M.meshes(0, 40); M.meshes(40, 80) ...; M.level()
"""
import json, os
import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
EXP = os.path.join(REPO, 'build', 'ue-export')
ROOT = '/Game/Market'
SLOT_FILE = {'diff': 'diff.jpg', 'nor': 'nor.jpg', 'arm': 'arm.jpg'}

lib, mel = unreal.EditorAssetLibrary, unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()


def spec():
    with open(os.path.join(EXP, 'ue_materials.json')) as f: return json.load(f)


def gameplay():
    with open(os.path.join(EXP, 'ue_gameplay.json')) as f: return json.load(f)


def _tex_source(ref):
    """(file on disk, asset name, kind) for a texture reference of the export."""
    if not ref: return None
    if 'set' in ref:
        slot = ref['slot']
        f = os.path.join(REPO, 'assets', 'tex', ref['set'], SLOT_FILE.get(slot, slot + '.jpg'))
        return f, f"T_{ref['set']}_{slot}", slot
    if 'file' in ref:
        f = os.path.join(REPO, ref['file'])
        return f, 'T_' + os.path.splitext(os.path.basename(f))[0], 'diff'
    if 'png' in ref:
        f = os.path.join(EXP, ref['png'])
        return f, 'T_' + os.path.splitext(ref['png'])[0].replace('ue_tex_', ''), 'diff'


def _import(files, dest, **opts):
    tasks = []
    for f, name in files:
        t = unreal.AssetImportTask()
        t.filename, t.destination_path, t.destination_name = f, dest, name
        t.automated, t.replace_existing, t.save = True, True, False
        for k, v in opts.items(): t.set_editor_property(k, v)
        tasks.append(t)
    tools.import_asset_tasks(tasks)
    return [t.get_editor_property('imported_object_paths') for t in tasks]


def textures(start=0, count=400):
    """Every texture the materials use, imported once: colour maps sRGB, normal maps as normal maps, ARM as masks."""
    want = {}
    for m in spec()['materials']:
        for k, ref in m['maps'].items():
            s = _tex_source(ref)
            if s and os.path.exists(s[0]): want[s[1]] = (s[0], 'normal' if k == 'normalMap' else 'arm' if k in ('roughnessMap', 'metalnessMap', 'aoMap') else 'color')
    names = sorted(want)[start:start + count]
    todo = [(want[n][0], n) for n in names if not lib.does_asset_exist(f'{ROOT}/Textures/{n}')]
    if todo: _import(todo, f'{ROOT}/Textures')
    for n in names:
        t = unreal.load_asset(f'{ROOT}/Textures/{n}')
        if not t: continue
        kind = want[n][1]
        if kind == 'normal':
            t.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_NORMALMAP); t.set_editor_property('srgb', False)
        elif kind == 'arm':
            t.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_MASKS); t.set_editor_property('srgb', False)
    lib.save_directory(f'{ROOT}/Textures', only_if_is_dirty=True)
    return {'total': len(want), 'imported': len(todo)}


def _expr(m, cls, x, y):
    return mel.create_material_expression(m, cls, x, y)


def _tparam(m, name, x, y, default, sampler=None):
    e = _expr(m, unreal.MaterialExpressionTextureSampleParameter2D, x, y)
    e.set_editor_property('parameter_name', name)
    e.set_editor_property('texture', unreal.load_asset(default))
    if sampler: e.set_editor_property('sampler_type', sampler)
    return e


def _sparam(m, name, x, y, v):
    e = _expr(m, unreal.MaterialExpressionScalarParameter, x, y); e.set_editor_property('parameter_name', name); e.set_editor_property('default_value', v); return e


def _vparam(m, name, x, y, v):
    e = _expr(m, unreal.MaterialExpressionVectorParameter, x, y); e.set_editor_property('parameter_name', name); e.set_editor_property('default_value', unreal.LinearColor(*v)); return e


def masters():
    """M_Market (opaque) and M_Market_Masked (two-sided, cut by the base colour's alpha): base colour x tint x vertex colour
    (the game's per-building paint), normal, ARM (AO, roughness, metalness as three.js reads it), UV tiling and offset,
    and roughness/metalness/AO values used where a material has no ARM map (HasARM 0)."""
    out = []
    for name, masked in (('M_Market', False), ('M_Market_Masked', True)):
        path = f'{ROOT}/Materials/{name}'
        if lib.does_asset_exist(path): lib.delete_asset(path)
        m = tools.create_asset(name, f'{ROOT}/Materials', unreal.Material, unreal.MaterialFactoryNew())
        if masked:
            m.set_editor_property('blend_mode', unreal.BlendMode.BLEND_MASKED); m.set_editor_property('two_sided', True)
            m.set_editor_property('opacity_mask_clip_value', 0.5)
        uv = _expr(m, unreal.MaterialExpressionTextureCoordinate, -1400, 0)
        tile = _vparam(m, 'UVTiling', -1400, 150, (1, 1, 0, 0))
        mask_rg = _expr(m, unreal.MaterialExpressionComponentMask, -1200, 150); mask_rg.set_editor_property('r', True); mask_rg.set_editor_property('g', True)
        mel.connect_material_expressions(tile, '', mask_rg, '')
        mul = _expr(m, unreal.MaterialExpressionMultiply, -1050, 50); mel.connect_material_expressions(uv, '', mul, 'A'); mel.connect_material_expressions(mask_rg, '', mul, 'B')
        off = _vparam(m, 'UVOffset', -1400, 300, (0, 0, 0, 0))
        off_rg = _expr(m, unreal.MaterialExpressionComponentMask, -1200, 300); off_rg.set_editor_property('r', True); off_rg.set_editor_property('g', True)
        mel.connect_material_expressions(off, '', off_rg, '')
        uvs = _expr(m, unreal.MaterialExpressionAdd, -900, 100); mel.connect_material_expressions(mul, '', uvs, 'A'); mel.connect_material_expressions(off_rg, '', uvs, 'B')
        base = _tparam(m, 'BaseColor', -700, -300, '/Engine/EngineResources/WhiteSquareTexture')
        nrm = _tparam(m, 'Normal', -700, 50, '/Engine/EngineMaterials/DefaultNormal', unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
        arm = _tparam(m, 'ARM', -700, 400, '/Engine/EngineResources/WhiteSquareTexture', unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
        for t in (base, nrm, arm): mel.connect_material_expressions(uvs, '', t, 'UVs')
        tint = _vparam(m, 'Tint', -700, -500, (1, 1, 1, 1))
        vc = _expr(m, unreal.MaterialExpressionVertexColor, -700, -650)
        usevc = _sparam(m, 'UseVertexColor', -500, -700, 1.0)
        vcl = _expr(m, unreal.MaterialExpressionLinearInterpolate, -350, -650)
        one = _expr(m, unreal.MaterialExpressionConstant3Vector, -500, -800); one.set_editor_property('constant', unreal.LinearColor(1, 1, 1, 1))
        mel.connect_material_expressions(one, '', vcl, 'A'); mel.connect_material_expressions(vc, '', vcl, 'B'); mel.connect_material_expressions(usevc, '', vcl, 'Alpha')
        bc1 = _expr(m, unreal.MaterialExpressionMultiply, -350, -400); mel.connect_material_expressions(base, 'RGB', bc1, 'A'); mel.connect_material_expressions(tint, '', bc1, 'B')
        bc2 = _expr(m, unreal.MaterialExpressionMultiply, -200, -450); mel.connect_material_expressions(bc1, '', bc2, 'A'); mel.connect_material_expressions(vcl, '', bc2, 'B')
        mel.connect_material_property(bc2, '', unreal.MaterialProperty.MP_BASE_COLOR)
        nstr = _sparam(m, 'NormalStrength', -500, 150, 1.0)
        flat = _expr(m, unreal.MaterialExpressionConstant3Vector, -500, 250); flat.set_editor_property('constant', unreal.LinearColor(0, 0, 1, 1))
        nl = _expr(m, unreal.MaterialExpressionLinearInterpolate, -300, 100); mel.connect_material_expressions(flat, '', nl, 'A'); mel.connect_material_expressions(nrm, 'RGB', nl, 'B'); mel.connect_material_expressions(nstr, '', nl, 'Alpha')
        mel.connect_material_property(nl, '', unreal.MaterialProperty.MP_NORMAL)
        has = _sparam(m, 'HasARM', -500, 500, 0.0)
        for chan, prop, pname, dv, y in (('R', unreal.MaterialProperty.MP_AMBIENT_OCCLUSION, 'AO', 1.0, 400), ('G', unreal.MaterialProperty.MP_ROUGHNESS, 'Roughness', 0.8, 550), ('B', unreal.MaterialProperty.MP_METALLIC, 'Metallic', 0.0, 700)):
            v = _sparam(m, pname, -500, y + 200, dv)
            sc = _expr(m, unreal.MaterialExpressionMultiply, -350, y + 100); mel.connect_material_expressions(arm, chan, sc, 'A'); mel.connect_material_expressions(v, '', sc, 'B')
            l = _expr(m, unreal.MaterialExpressionLinearInterpolate, -200, y); mel.connect_material_expressions(v, '', l, 'A'); mel.connect_material_expressions(sc if chan != 'R' else arm, '' if chan != 'R' else chan, l, 'B'); mel.connect_material_expressions(has, '', l, 'Alpha')
            mel.connect_material_property(l, '', prop)
        emis = _vparam(m, 'Emissive', -200, 850, (0, 0, 0, 0))
        mel.connect_material_property(emis, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
        if masked:
            amap = _tparam(m, 'AlphaMap', -700, 1000, '/Engine/EngineResources/WhiteSquareTexture')
            mel.connect_material_expressions(uvs, '', amap, 'UVs')
            useamap = _sparam(m, 'UseAlphaMap', -500, 1150, 0.0)
            al = _expr(m, unreal.MaterialExpressionLinearInterpolate, -300, 1000); mel.connect_material_expressions(base, 'A', al, 'A'); mel.connect_material_expressions(amap, 'G', al, 'B'); mel.connect_material_expressions(useamap, '', al, 'Alpha')
            mel.connect_material_property(al, '', unreal.MaterialProperty.MP_OPACITY_MASK)
        mel.recompile_material(m)
        lib.save_loaded_asset(m)
        out.append(path)
    return out


def _tex_asset(ref):
    s = _tex_source(ref)
    return unreal.load_asset(f'{ROOT}/Textures/{s[1]}') if s else None


def materials():
    """One instance per game material: its maps, tint, roughness/metalness, tiling, alpha cut, emissive."""
    done = []
    for m in spec()['materials']:
        path = f"{ROOT}/Materials/Instances/MI_{m['name']}"
        masked = (m.get('alphaTest') or 0) > 0 or bool(m['maps'].get('alphaMap'))
        parent = unreal.load_asset(f"{ROOT}/Materials/{'M_Market_Masked' if masked else 'M_Market'}")
        mi = unreal.load_asset(path) or tools.create_asset(f"MI_{m['name']}", f'{ROOT}/Materials/Instances', unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mi.set_editor_property('parent', parent)
        mp = m['maps']
        if mp.get('map'): mel.set_material_instance_texture_parameter_value(mi, 'BaseColor', _tex_asset(mp['map']))
        if mp.get('normalMap'): mel.set_material_instance_texture_parameter_value(mi, 'Normal', _tex_asset(mp['normalMap']))
        arm = mp.get('roughnessMap') or mp.get('aoMap') or mp.get('metalnessMap')
        if arm:
            mel.set_material_instance_texture_parameter_value(mi, 'ARM', _tex_asset(arm)); mel.set_material_instance_scalar_parameter_value(mi, 'HasARM', 1.0)
        if mp.get('alphaMap'):
            mel.set_material_instance_texture_parameter_value(mi, 'AlphaMap', _tex_asset(mp['alphaMap'])); mel.set_material_instance_scalar_parameter_value(mi, 'UseAlphaMap', 1.0)
        c = m.get('color') or [1, 1, 1]
        mel.set_material_instance_vector_parameter_value(mi, 'Tint', unreal.LinearColor(c[0], c[1], c[2], 1))
        mel.set_material_instance_scalar_parameter_value(mi, 'UseVertexColor', 1.0 if m.get('vertexColors') else 0.0)
        mel.set_material_instance_scalar_parameter_value(mi, 'Roughness', float(m.get('roughness') if m.get('roughness') is not None else 0.8))
        mel.set_material_instance_scalar_parameter_value(mi, 'Metallic', float(m.get('metalness') or 0.0))
        ns = m.get('normalScale') or [1, 1]
        mel.set_material_instance_scalar_parameter_value(mi, 'NormalStrength', float(min(1.0, abs(ns[0]))))
        rep = (mp.get('map') or {}).get('repeat') or [1, 1]; off = (mp.get('map') or {}).get('offset') or [0, 0]
        mel.set_material_instance_vector_parameter_value(mi, 'UVTiling', unreal.LinearColor(rep[0], rep[1], 0, 0))
        mel.set_material_instance_vector_parameter_value(mi, 'UVOffset', unreal.LinearColor(off[0], off[1], 0, 0))
        e = m.get('emissive') or [0, 0, 0]; k = m.get('emissiveIntensity') or 0
        if k and any(e): mel.set_material_instance_vector_parameter_value(mi, 'Emissive', unreal.LinearColor(e[0] * k, e[1] * k, e[2] * k, 0))
        lib.save_loaded_asset(mi)
        done.append(m['name'])
    return len(done)


def meshes(start=0, count=40):
    """The geometry, one static mesh per game material: Nanite (opaque ones), collision from the mesh itself."""
    mats = spec()['materials'][start:start + count]
    out = []
    for m in mats:
        name = f"SM_{m['name']}"
        path = f'{ROOT}/Meshes/{name}'
        if not lib.does_asset_exist(path):
            _import([(os.path.join(EXP, m['file']), name)], f'{ROOT}/Meshes')
        sm = unreal.load_asset(path)
        if not sm:
            found = [a for a in unreal.AssetRegistryHelpers.get_asset_registry().get_assets_by_path(f'{ROOT}/Meshes', recursive=True) if str(a.asset_name).startswith(name) and str(a.asset_class_path.asset_name) == 'StaticMesh']
            sm = unreal.load_asset(str(found[0].package_name)) if found else None
        if not sm: out.append((m['name'], 'import failed')); continue
        mi = unreal.load_asset(f"{ROOT}/Materials/Instances/MI_{m['name']}")
        for i in range(len(sm.static_materials)): sm.set_material(i, mi)
        masked = (m.get('alphaTest') or 0) > 0 or bool(m['maps'].get('alphaMap'))
        ns = sm.get_editor_property('nanite_settings'); ns.enabled = not m.get('transparent'); sm.set_editor_property('nanite_settings', ns)
        body = sm.get_editor_property('body_setup')
        if body: body.set_editor_property('collision_trace_flag', unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)
        lib.save_loaded_asset(sm)
        out.append((m['name'], sm.get_path_name(), 'masked' if masked else 'opaque'))
    return out


def level(name='Lvl_Market'):
    """The district's level: every mesh at the origin (the export is in world space), the sun from the game's own
    direction, sky, fog, post, lamps and spawns."""
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    path = f'{ROOT}/Maps/{name}'
    if not lib.does_asset_exist(path): les.new_level(path)
    else: les.load_level(path)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for a in eas.get_all_level_actors(): eas.destroy_actor(a)
    spawn = lambda cls, loc=(0, 0, 0), rot=(0, 0, 0): eas.spawn_actor_from_class(cls, unreal.Vector(*loc), unreal.Rotator(*rot))
    for m in spec()['materials']:
        sm = unreal.load_asset(f"{ROOT}/Meshes/SM_{m['name']}")
        if not sm: continue
        a = eas.spawn_actor_from_object(sm, unreal.Vector(0, 0, 0)); a.set_actor_label(m['name']); a.set_folder_path('District')
    g = gameplay()
    # three.js (x, y up, z) -> Unreal (x = -z? ...): measured from an imported mesh, see to_ue
    sx, sy, sz = g['sunDir']
    d = to_ue_dir((sx, sy, sz))
    sun = spawn(unreal.DirectionalLight)
    sun.set_actor_rotation(unreal.MathLibrary.make_rot_from_x(unreal.Vector(-d[0], -d[1], -d[2])), False)
    lc = sun.get_component_by_class(unreal.DirectionalLightComponent)
    lc.set_editor_property('intensity', 10.0); lc.set_editor_property('atmosphere_sun_light', True)
    lc.set_editor_property('light_color', unreal.Color(255, 240, 214, 255))
    spawn(unreal.SkyAtmosphere)
    sky = spawn(unreal.SkyLight); sky.get_component_by_class(unreal.SkyLightComponent).set_editor_property('real_time_capture', True)
    sky.get_component_by_class(unreal.SkyLightComponent).set_editor_property('mobility', unreal.ComponentMobility.MOVABLE)
    fog = spawn(unreal.ExponentialHeightFog); fog.get_component_by_class(unreal.ExponentialHeightFogComponent).set_editor_property('fog_density', 0.004)
    pp = spawn(unreal.PostProcessVolume); pp.set_editor_property('unbound', True)
    for l in g['lamps']:
        p = spawn(unreal.PointLight, to_ue(l['x'], l['y'], l['z']))
        c = p.get_component_by_class(unreal.PointLightComponent)
        c.set_editor_property('intensity', 2500.0); c.set_editor_property('attenuation_radius', 700.0)
        c.set_editor_property('light_color', unreal.Color(int(255 * l['c'][0]), int(255 * l['c'][1]), int(255 * l['c'][2]), 255))
        p.set_folder_path('Lamps')
    for team, pts in enumerate(g['spawns']):
        for s in pts:
            ps = spawn(unreal.PlayerStart, to_ue(s['x'], s['y'] + 1.0, s['z']), (0, to_ue_yaw(s['yaw']), 0))
            ps.set_editor_property('player_start_tag', f'Team{team}'); ps.set_folder_path(f'Spawns/Team{team}')
    unreal.EditorLoadingAndSavingUtils.save_current_level()
    return path


# The glTF importer's axes: glTF (x, y up, z) -> Unreal (x forward, y right, z up), metres -> centimetres.
# Unreal's Interchange glTF import maps glTF +Z to Unreal +X... measured with probe(): see AXES.
AXES = None


def probe():
    """Measures how the importer placed the export: the bounds of one mesh in Unreal against its bounds in the game."""
    sm = unreal.load_asset(f"{ROOT}/Meshes/SM_{spec()['materials'][0]['name']}")
    b = sm.get_bounding_box()
    return {'min': [b.min.x, b.min.y, b.min.z], 'max': [b.max.x, b.max.y, b.max.z]}


def to_ue(x, y, z):
    a = AXES or {'x': ('z', 100), 'y': ('x', 100), 'z': ('y', 100)}
    src = {'x': x, 'y': y, 'z': z}
    return tuple(src[a[k][0]] * a[k][1] for k in ('x', 'y', 'z'))


def to_ue_dir(v):
    p = to_ue(*v); n = sum(c * c for c in p) ** 0.5
    return tuple(c / n for c in p)


def to_ue_yaw(yaw):
    import math
    # the game's yaw turns about +y with 0 facing -z (three.js forward): the facing vector, mapped
    f = to_ue(-math.sin(yaw), 0, -math.cos(yaw))
    return math.degrees(math.atan2(f[1], f[0]))
