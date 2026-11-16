#!/usr/bin/env python3
"""Builds assets/audio/voices.wav and voices.json: real recorded human voices for dying soldiers (screams, short pain
cries, death cries, dying groans) and body-fall foley, cut from openly licensed packs on OpenGameArt (credits and
licences in ASSETS.md). Downloads the packs into a scratch folder, takes the chosen clips, trims their silence, evens
their loudness, makes them mono at 32 kHz and packs them back to back into one WAV, with a JSON index of where each
clip starts, how long it is, what kind it is and where it came from.

Needs ffmpeg and bsdtar on the PATH (macOS ships bsdtar as `tar`; `brew install ffmpeg`) and numpy.
Usage: python3 tools/build-voices.py [--cache DIR]
"""
import json, os, shutil, subprocess, sys, tempfile, wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'audio')
SR = 32000                                      # enough for a voice at game distances; the engine resamples to 48 kHz
FF = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
TAR = shutil.which('bsdtar') or shutil.which('tar')

PACKS = {   # name: (url, archive type, credit)
    'haeldb': ('https://opengameart.org/sites/default/files/yelling%20sounds.zip', 'zip',
               'HaelDB, "Male Grunt/Yelling sounds", CC0 (https://opengameart.org/content/male-gruntyelling-sounds)'),
    'baradari': ('https://opengameart.org/sites/default/files/michelbaradari-human.7z', '7z',
                 'Michel Baradari, "11 male human pain/death sounds", CC-BY 3.0 (https://opengameart.org/content/11-male-human-paindeath-sounds)'),
    'bard': ('https://opengameart.org/sites/default/files/death%20pain%20grunts.wav', 'wav',
             'thebardofblasphemy, "grunts of male death and pain", CC0 (https://opengameart.org/content/grunts-male-death-and-pain)'),
    'dklon': ('https://opengameart.org/sites/default/files/body_hits.wav', 'wav',
              'dklon, "Body Hitting Ground", CC-BY 3.0 (https://opengameart.org/content/body-hitting-ground)'),
}
# the two single-file packs hold several takes each: (start, end) seconds of each take used
CUTS = {
    'bard': {'take01': (0.40, 2.05), 'take03': (6.85, 7.50), 'take04': (8.27, 9.30), 'take06': (14.38, 16.25), 'take08': (20.26, 22.40),
             'take09': (23.80, 25.85), 'take10': (27.50, 28.62), 'take11': (29.78, 30.45), 'take12': (31.42, 32.65), 'take14': (35.88, 37.45),
             'take16': (40.31, 41.20), 'take18': (44.86, 46.12), 'take19': (47.29, 49.20)},
    'dklon': {'take01': (0.42, 0.86), 'take02': (2.16, 2.58), 'take03': (3.37, 4.38), 'take04': (4.66, 5.08)},
}
H = 'yelling sounds/'
CLIPS = [   # (kind, pack, file or take); four men's screams, short pain cries, death cries, dying groans, a body hitting the floor
    *[('scream', 'haeldb', H + f) for f in ['1yell1.wav', '1yell4.wav', '1yell5.wav', '1yell8.wav', '1yell10.wav', '1yell12.wav',
                                            '2yell1.wav', '2yell2.wav', '2yell4.wav', '2yell7.wav', '2yell10.wav', '2yell11.wav',
                                            '3yell2.wav', '3yell5.wav', '3yell9.wav', '3yell10.wav', '3yell11.wav', '3yell14.wav',
                                            'yell2.wav', 'yell4.wav', 'yell7.wav', 'yell8.wav', 'yell11.wav', 'yell12.wav']],
    *[('pain', 'baradari', 'player/' + f) for f in ['pain1.wav', 'pain2.wav', 'pain3.wav', 'pain4.wav', 'pain5.wav', 'pain6.wav', 'painh.wav', 'paino.wav']],
    *[('pain', 'haeldb', H + f) for f in ['3grunt2.wav', '3grunt3.wav', '3grunt5.wav', '3grunt6.wav']],
    *[('die', 'baradari', 'player/' + f) for f in ['die1.wav', 'die2.wav', 'deathh.wav']],
    *[('die', 'bard', t) for t in ['take03', 'take04', 'take10', 'take11', 'take12', 'take16', 'take18']],
    *[('groan', 'bard', t) for t in ['take01', 'take06', 'take08', 'take09', 'take14', 'take19']],
    *[('thud', 'dklon', t) for t in ['take01', 'take02', 'take03', 'take04']],
]
MAXLEN = {'scream': 1.5, 'pain': 0.9, 'die': 1.3, 'groan': 1.7, 'thud': 0.7}      # longer takes fade out by this point


def fetch(cache):
    got = {}
    for name, (url, kind, _) in PACKS.items():
        path = os.path.join(cache, name + '.' + kind)
        if not os.path.exists(path):                                       # (curl: it uses the system's certificates)
            subprocess.run(['curl', '-sSLf', '-A', 'asset-fetch/1.0', '-o', path, url], check=True)
        if kind in ('zip', '7z'):
            d = os.path.join(cache, name)
            if not os.path.isdir(d):
                os.makedirs(d); subprocess.run([TAR, '-xf', path, '-C', d], check=True)
            got[name] = d
        else: got[name] = path
    return got


def decode(path, start=None, end=None):
    """The file (or a span of it) as float samples at SR, both channels if it has two."""
    args = [FF, '-v', 'error']
    if start is not None: args += ['-ss', f'{start}', '-to', f'{end}']
    args += ['-i', path, '-ar', str(SR), '-f', 'f32le', '-']
    ch = int(subprocess.run([FF.replace('ffmpeg', 'ffprobe'), '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', path], capture_output=True, text=True, check=True).stdout.strip() or 1)
    x = np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, dtype=np.float32).astype(np.float64)
    return x.reshape(-1, ch).T


def to_mono(chs):
    if len(chs) == 1: return chs[0]
    a, b = chs[0], chs[1]
    c = np.dot(a, b) / (np.sqrt(np.dot(a, a) * np.dot(b, b)) + 1e-12)
    return (a + b) / 2 if c > 0.5 else (a if np.abs(a).max() >= np.abs(b).max() else b)     # (a channel pair that is not one signal would partly cancel)


def frames_db(x, ms=10):
    w = int(SR * ms / 1000); n = max(1, len(x) // w)
    return 20 * np.log10(np.sqrt((x[:n * w].reshape(n, w) ** 2).mean(1)) + 1e-12), w


def prepare(x, kind):
    """Trim to the sound itself, cap its length, fade the ends, take out rumble, even out the loudness."""
    db, w = frames_db(x); top = db.max(); on = np.where(db > top - 42)[0]
    a, b = max(0, on[0] * w - int(0.012 * SR)), min(len(x), (on[-1] + 1) * w + int(0.07 * SR))
    y = x[a:b].copy(); cap = int(MAXLEN[kind] * SR)
    if len(y) > cap:
        y = y[:cap]; f = int(0.18 * SR); y[-f:] *= np.linspace(1, 0, f) ** 2
    fi, fo = int(0.003 * SR), int(0.02 * SR); y[:fi] *= np.linspace(0, 1, fi); y[-fo:] *= np.linspace(1, 0, fo)
    if kind != 'thud':                                                     # high-pass 70 Hz (2nd order) against mic rumble and handling
        wc = 2 * np.pi * 70 / SR; k = np.tan(wc / 2); q = 0.707; n0 = 1 / (1 + k / q + k * k)
        b0, b1, b2, a1, a2 = n0, -2 * n0, n0, 2 * (k * k - 1) * n0, (1 - k / q + k * k) * n0
        out = np.zeros_like(y); x1 = x2 = y1 = y2 = 0.0
        for i, v in enumerate(y): o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2, x1, y2, y1 = x1, v, y1, o; out[i] = o
        y = out
        db, w = frames_db(y, 100); y *= 10 ** ((-14 - db.max()) / 20)        # the loudest tenth of a second at -14 dBFS
    pk = np.abs(y).max(); lim = 10 ** (-1 / 20)
    y *= (lim / pk) if (kind == 'thud' or pk > lim) else 1.0
    return y


def main():
    cache = sys.argv[sys.argv.index('--cache') + 1] if '--cache' in sys.argv else tempfile.mkdtemp(prefix='voices-')
    src = fetch(cache)
    gap = np.zeros(int(0.05 * SR)); parts, index, t = [], [], 0.0
    for kind, pack, item in CLIPS:
        if pack in CUTS:
            s, e = CUTS[pack][item]; chs = decode(src[pack], s, e); label = f"{os.path.basename(PACKS[pack][0]).replace('%20', ' ')} {s:.2f}-{e:.2f} s"
        else:
            chs = decode(os.path.join(src[pack], item)); label = item.split('/')[-1]
        if (np.abs(chs) > 0.999).sum() > 3: print(f'skipped (clipped): {pack} {item}'); continue
        y = prepare(to_mono(chs), kind)
        parts += [y, gap]; index.append({'kind': kind, 'start': round(t, 5), 'length': round(len(y) / SR, 5), 'from': f'{pack}: {label}'}); t += (len(y) + len(gap)) / SR
    data = np.concatenate(parts)
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, 'voices.wav'), 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR); f.writeframes((np.clip(data, -1, 1) * 32767).round().astype('<i2').tobytes())
    with open(os.path.join(OUT, 'voices.json'), 'w') as f:
        json.dump({'sampleRate': SR, 'credits': [c for _, _, c in PACKS.values()], 'clips': index}, f, indent=1)
    kinds = {}
    for c in index: kinds[c['kind']] = kinds.get(c['kind'], 0) + 1
    print(f'{len(index)} clips ({", ".join(f"{k} {v}" for k, v in kinds.items())}), {t:.1f} s, {os.path.getsize(os.path.join(OUT, "voices.wav")) / 1e6:.2f} MB -> assets/audio/voices.wav')


if __name__ == '__main__':
    main()
