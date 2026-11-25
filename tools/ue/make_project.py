#!/usr/bin/env python3
"""Creates the Unreal Engine 5.9 port's project, ue/MarketDistrict, the way the editor's New Project dialog does from the
First Person C++ template (with its Shooter variant: weapons, team AI on StateTree, team scores, UI): the template copied,
"TP_FirstPerson" renamed to "MarketDistrict" in file names and contents, its shared content packs (Characters, Input,
LevelPrototyping, Weapons) unpacked under /Game, and redirects so the template's content finds the renamed classes. Adds
the editor's MCP server (driven from Claude Code) and Python scripting.

Usage: python3 -I tools/ue/make_project.py [--force]
Then build: Engine/Build/BatchFiles/Mac/Build.sh MarketDistrictEditor Mac Development -Project=<uproject> -WaitMutex
Content under the project is generated (this script, then tools/ue/*.py in the editor) and is not kept in git.
"""
import json, os, re, shutil, sys

ENGINE = '/Users/Shared/Epic Games/UE_5.9'
TEMPLATE = os.path.join(ENGINE, 'Templates', 'TP_FirstPerson')
PACKS = os.path.join(ENGINE, 'Templates', 'TemplateResources')
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
NAME, OLD = 'MarketDistrict', 'TP_FirstPerson'
DST = os.path.join(REPO, 'ue', NAME)

if os.path.exists(DST):
    if '--force' not in sys.argv: sys.exit(f'{DST} exists (--force to remake)')
    shutil.rmtree(DST)

SKIP_DIRS = {'Binaries', 'Build', 'Intermediate', 'Saved', 'Media'}
SKIP_FILES = {f'{OLD}.uproject', f'{OLD}.png', os.path.join('Config', 'TemplateDefs.ini'), os.path.join('Config', 'config.ini'), 'Manifest.json', 'contents.txt'}
TEXT = ('.cpp', '.h', '.ini', '.cs')
ren = lambda s: re.sub(OLD, NAME, s.replace(OLD.upper(), NAME.upper()).replace(OLD.lower(), NAME.lower()), flags=re.I)

for root, dirs, files in os.walk(TEMPLATE):
    rel = os.path.relpath(root, TEMPLATE)
    dirs[:] = [d for d in dirs if not (rel == '.' and d in SKIP_DIRS)]
    out_dir = os.path.join(DST, ren(rel) if rel.startswith('Source') else rel)
    os.makedirs(out_dir, exist_ok=True)
    for f in files:
        rf = os.path.normpath(os.path.join(rel, f))
        if rf in SKIP_FILES: continue
        src = os.path.join(root, f)
        name = ren(f) if f.endswith(TEXT) else f
        dst = os.path.join(out_dir, name)
        if f.endswith(TEXT):
            with open(src, encoding='utf-8-sig', errors='surrogateescape') as fh: text = fh.read()
            with open(dst, 'w', encoding='utf-8', errors='surrogateescape') as fh: fh.write(ren(text))
        else:
            shutil.copy2(src, dst)

# the template's shared packs, each mounted at /Game/<pack>
for detail, pack in (('High', 'Characters'), ('High', 'Input'), ('High', 'LevelPrototyping'), ('Standard', 'Weapons')):
    shutil.copytree(os.path.join(PACKS, detail, pack, 'Content'), os.path.join(DST, 'Content', pack), dirs_exist_ok=True)

with open(os.path.join(TEMPLATE, f'{OLD}.uproject')) as fh: proj = json.load(fh)
proj['EngineAssociation'] = '5.9'
proj['Description'] = 'Market District: the three.js tactical FPS slice, ported to Unreal Engine.'
for m in proj['Modules']: m['Name'] = NAME
have = {p['Name'] for p in proj['Plugins']}
for p in ('ModelContextProtocol', 'AllToolsets', 'PythonScriptPlugin', 'EditorScriptingUtilities'):
    if p not in have: proj['Plugins'].append({'Name': p, 'Enabled': True})
with open(os.path.join(DST, f'{NAME}.uproject'), 'w') as fh: json.dump(proj, fh, indent='\t')

# redirects: the template's content names the module's classes by their old names
classes = []
for root, _, files in os.walk(os.path.join(TEMPLATE, 'Source', OLD)):
    for f in files:
        if f.endswith('.h') and f.startswith(OLD): classes.append(f[:-2])
eng = os.path.join(DST, 'Config', 'DefaultEngine.ini')
with open(eng) as fh: text = fh.read()
red = ['', '[/Script/Engine.Engine]',
       f'+ActiveGameNameRedirects=(OldGameName="{OLD}",NewGameName="/Script/{NAME}")',
       f'+ActiveGameNameRedirects=(OldGameName="/Script/{OLD}",NewGameName="/Script/{NAME}")']
red += [f'+ActiveClassRedirects=(OldClassName="{c}",NewClassName="{ren(c)}")' for c in sorted(classes)]
with open(eng, 'w') as fh: fh.write(text.rstrip() + '\n' + '\n'.join(red) + '\n')

# the editor's MCP server on start (driven from Claude Code)
cfg = os.path.join(DST, 'Saved', 'Config', 'MacEditor'); os.makedirs(cfg, exist_ok=True)
with open(os.path.join(cfg, 'EditorPerProjectUserSettings.ini'), 'w') as fh:
    fh.write('[/Script/ModelContextProtocolEngine.ModelContextProtocolSettings]\nbAutoStartServer=True\nServerPortNumber=8000\nServerUrlPath=/mcp\n')
print(DST, 'classes redirected:', classes)
