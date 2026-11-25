#!/usr/bin/env python3
"""Builds assets/audio/civ-voices.wav and civ-voices.json: the civilians' voices. Real recordings of several women and men
(talk, greetings, startled questions, shouts to run, laughter, gasps, screams, pleading, whimpers, cries of pain, sighs,
and the cries of someone shot dead), cut from CC0 packs on OpenGameArt (credits in ASSETS.md). Nothing here is synthesized.

Downloads the packs into a cache folder (build/civ-voices by default: each pack in a folder of its own, treated as data
and never run), takes the chosen clips, trims their silence, evens their loudness by kind, makes them mono at 32 kHz
and packs them back to back into one WAV. The JSON index says where each clip starts, how long it is, what kind it is,
whose voice it is (the cast's voices f1..f4, m1..m3: tools/civilians/people.json), and carries a timeline made from
the recording itself for the speaker's face to follow: how loud (the jaw) and which mouth shape, fifty times a second.

Needs ffmpeg and bsdtar on the PATH (macOS ships bsdtar as `tar`; `brew install ffmpeg`), numpy and scipy.
Usage: python3 -I tools/build-civ-voices.py [--cache DIR] [--list]        (--list: what is in the packs, and how long)
"""
import base64, json, os, shutil, subprocess, sys, wave
import numpy as np
from scipy.linalg import solve_toeplitz
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'audio')
SR = 32000                                      # enough for a voice at game distances; the engine resamples to 48 kHz
STEP = 0.02                                     # the face's timeline: one loudness and one mouth shape every 20 ms
FF = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
TAR = shutil.which('bsdtar') or shutil.which('tar')
OGA = 'https://opengameart.org/sites/default/files/'
AURA = 'Nocturnal_Vanguard (AuraVoice), voice clips, CC0 (https://opengameart.org/users/nocturnalvanguard)'

PACKS = {   # name: (url, archive type, credit)
    **{'aura_' + n: (OGA + f, 'ogg', AURA) for n, f in {
        'hurt': 'female_hurt_grunts_groans_1.ogg', 'scream': 'female_scream_1.ogg', 'help': 'please_help_somebody.ogg', 'nonono': 'female_distressed_no_no_no.ogg',
        'scared': 'oh_you_scared_me.ogg', 'yell': 'female_exasperated_yell.ogg', 'hello': 'h-hello.ogg', 'run': 'come_on_lets_run.ogg', 'alright': 'oh_alright.ogg',
        'hear': 'did_you_hear_that.ogg', 'crazy': 'are_you_crazy.ogg', 'silly': 'silly_me.ogg', 'letsgo': 'lets_go_i_cant_stand_another_minute_here.ogg',
        'coming': 'im_coming_with_you.ogg', 'cant': 'what_no_no_that_cant_happen.ogg', 'order': 'what_would_you_like_to_order_sir.ogg', 'cheers': 'cheers_1.ogg',
        'giggle': 'group_giggling.ogg'}.items()},
    'wuxia': (OGA + 'screams_0.ogg', 'ogg', 'WuxiaScrub, "Female high-pitched scream SFX", CC0 (https://opengameart.org/content/female-high-pitched-scream-sfx)'),
    'bright': (OGA + 'Free%20Voice%20Clips%20Pack%20-%20Bright%20Female_0.zip', 'zip', 'cicifyre, "Voice Clip Packs for Visual Novels and RPGs" (Bright Female), CC0 (https://opengameart.org/content/voice-clip-packs-for-visual-novels-and-rpgs)'),
    'mature': (OGA + 'Free%20Voice%20Clips%20Pack%20-%20Mature%20Female.zip', 'zip', 'cicifyre, "Voice Clip Packs for Visual Novels and RPGs" (Mature Female), CC0 (https://opengameart.org/content/voice-clip-packs-for-visual-novels-and-rpgs)'),
    'starter': (OGA + 'RPG%20Voice%20Starter%20Pack.zip', 'zip', 'cicifyre, "Female RPG Voice Starter Pack", CC0 (https://opengameart.org/content/female-rpg-voice-starter-pack)'),
    'wolfwoot': (OGA + 'RPG%20Male%20Adventurer.zip', 'zip', 'wolfwoot, "Voice Clip Pack - Male Adventurer RPG", CC0 (https://opengameart.org/content/voice-clip-pack-male-adventurer-rpg)'),
    'mieki': (OGA + 'enemy_dead_20150802.zip', 'zip', 'mieki256, "Male dead voice", CC0 (https://opengameart.org/content/male-dead-voice)'),
    'badre': (OGA + 'death%20sound%20effect.zip', 'zip', 'Badre-Eddine, "Hurt / Death sound effect for character", CC0 (https://opengameart.org/content/hurt-death-sound-effect-for-character)'),
    'qubodup': (OGA + 'slightscreams.7z', '7z', 'qubodup, "15 vocal male strain/hurt/pain/jump sounds", CC0 (https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds)'),
    'supergeek': (OGA + 'ogalaughter_2.ogg', 'ogg', 'Supergeek, "Do you remember laughter?", CC0 (https://opengameart.org/content/do-you-remember-laughter)'),
    'haeldb': (OGA + 'yelling%20sounds.zip', 'zip', 'HaelDB, "Male Grunt/Yelling sounds", CC0 (https://opengameart.org/content/male-gruntyelling-sounds)'),
}
AUDIO = ('.wav', '.ogg', '.mp3', '.flac', '.aif', '.aiff')

# ---- the clips ---------------------------------------------------------------------------------------------------------------
# (kind, who, pack, file, cut): file None = the pack's single file; cut None = all of it, (a, b) = those seconds of it,
# or ('parts', gap, least, first, count) = the stretches of sound in it (split where it is quiet for `gap` seconds, none
# shorter than `least`), `count` of them from the `first` (negative: from the end).
# Kinds: chat, greet, ask (startled questions), run (shouted to get others moving), laugh, gasp, scream, pain, plead,
# whimper, sigh, die (the cry of someone shot dead). Who: the cast's voices (people.json): f1..f4 women, m1..m3 men.
B, M, ST, W = 'files/Free Voice Clips Pack - Bright Female/', 'files/Free Voice Clips Pack - Mature Female/', 'files/RPG Voice Starter Pack/', 'files/RPG Male Adventurer/'
CLIPS = [
    # f1: AuraVoice
    *[('pain', 'f1', 'aura_hurt', None, c) for c in [(0.35, 1.12), (2.10, 2.69), (3.72, 4.11), (7.34, 8.08), (11.70, 12.55)]],
    *[('die', 'f1', 'aura_hurt', None, c) for c in [(4.92, 6.09), (9.39, 10.28)]],
    ('scream', 'f1', 'aura_scream', None, None), ('scream', 'f1', 'aura_yell', None, None), ('die', 'f1', 'aura_scream', None, (0.0, 1.1)),
    *[('plead', 'f1', 'aura_help', None, c) for c in [(0.40, 2.91), (3.39, 4.94), (6.48, 8.84), (9.22, 11.09)]],
    *[('whimper', 'f1', 'aura_nonono', None, c) for c in [(0.24, 0.70), (1.38, 1.94), (2.70, 3.20)]], *[('plead', 'f1', 'aura_nonono', None, c) for c in [(3.77, 4.44), (5.11, 5.90)]],
    ('gasp', 'f1', 'aura_scared', None, (0.33, 0.52)), ('greet', 'f1', 'aura_scared', None, (1.70, 3.31)), ('gasp', 'f1', 'aura_scared', None, (3.82, 4.33)), ('gasp', 'f1', 'aura_scared', None, (4.87, 5.29)),
    ('ask', 'f1', 'aura_hear', None, None), ('ask', 'f1', 'aura_crazy', None, None), ('ask', 'f1', 'aura_hello', None, (0.44, 2.01)), ('ask', 'f1', 'aura_cant', None, None),
    ('run', 'f1', 'aura_run', None, None), ('run', 'f1', 'aura_letsgo', None, None),
    ('chat', 'f1', 'aura_silly', None, None), ('chat', 'f1', 'aura_order', None, None), ('chat', 'f1', 'aura_cheers', None, None), ('chat', 'f1', 'aura_alright', None, None), ('chat', 'f1', 'aura_coming', None, None),
    ('laugh', 'f1', 'aura_giggle', None, (0.0, 2.6)), ('laugh', 'f1', 'aura_giggle', None, (2.6, 5.4)),
    # f2: cicifyre, Bright Female (three takes of every line)
    *[('greet', 'f2', 'bright', f'{B}{t}-{n}.wav', None) for t in ('01', '02', '03') for n in ('hello', 'hey', 'good morning', 'how are you')],
    *[('chat', 'f2', 'bright', f'{B}{t}-{n}.wav', None) for t in ('01', '02') for n in ('actually', "i'm good thank you", 'okay', 'thank you', 'see ya later', "i'm a little under the weather today", "i don't wanna talk right now")],
    *[('ask', 'f2', 'bright', f'{B}{t}-{n}.wav', None) for t in ('01', '02', '03') for n in ('what', 'why')],
    *[('laugh', 'f2', 'bright', f'{B}{t}-laughter.wav', None) for t in ('01', '02', '03')], *[('gasp', 'f2', 'bright', f'{B}{t}-anime gasp.wav', None) for t in ('01', '02', '03')],
    *[('pain', 'f2', 'starter', f'{ST}Type 2/damaged{i}.wav', None) for i in (1, 2, 3)],
    # f3: cicifyre, Mature Female
    *[('greet', 'f3', 'mature', f'{M}greetings/{n}.wav', None) for n in ('hello', 'good_morning', 'good_afternoon', 'see_you_later')],
    *[('chat', 'f3', 'mature', f'{M}small_talk/{n}.wav', None) for n in ('how_are_things_going', 'how_are_you_feeling_today', 'call_me', 'do_you_have_my_number')],
    *[('chat', 'f3', 'mature', f'{M}short_replies/{n}.wav', None) for n in ('alright', 'no_problem', 'okay_happy', 'okay_normal', 'thanks_happy', 'youre_welcome')],
    *[('ask', 'f3', 'mature', f'{M}question_words/{n}.wav', None) for n in ('what1', 'what3', 'why2', 'where2', 'who1')],
    *[('laugh', 'f3', 'mature', f'{M}noises/{n}.wav', None) for n in ('laugh', 'small_single_laugh')], *[('gasp', 'f3', 'mature', f'{M}noises/{n}.wav', None) for n in ('gasp1', 'anime_ah', 'anime_haa', 'anime_wah')],
    *[('sigh', 'f3', 'mature', f'{M}noises/{n}.wav', None) for n in ('sigh1', 'sigh2')], ('whimper', 'f3', 'mature', f'{M}noises/anime_uh.wav', None),
    *[('pain', 'f3', 'starter', f'{ST}Type 3/damaged{i}.wav', None) for i in (1, 2, 3)],
    # f4: the starter pack's first voice, and WuxiaScrub's screams
    *[('pain', 'f4', 'starter', f'{ST}Type 1/damaged{i}.wav', None) for i in (1, 2, 3)], *[('gasp', 'f4', 'starter', f'{ST}Type 1/jump{i}.wav', None) for i in (1, 2)], *[('sigh', 'f4', 'starter', f'{ST}Type 1/healed{i}.wav', None) for i in (1, 2)],
    *[('scream', 'f4', 'wuxia', None, c) for c in [(0.05, 1.2), (1.75, 2.9), (3.35, 4.5)]], *[('die', 'f4', 'wuxia', None, c) for c in [(5.25, 6.3), (1.75, 2.6)]],
    # m1: wolfwoot, Male Adventurer
    *[('pain', 'm1', 'wolfwoot', f'{W}hurt{i}.wav', None) for i in range(10)], ('die', 'm1', 'wolfwoot', f'{W}death0.wav', None), ('die', 'm1', 'wolfwoot', f'{W}death1.wav', None),
    ('greet', 'm1', 'wolfwoot', f'{W}greet0.wav', None), *[('plead', 'm1', 'wolfwoot', f'{W}no{i}.wav', None) for i in (0, 1)], *[('chat', 'm1', 'wolfwoot', f'{W}yes{i}.wav', None) for i in (0, 1)],
    ('sigh', 'm1', 'wolfwoot', f'{W}gameover0.wav', None), *[('gasp', 'm1', 'wolfwoot', f'{W}jump{i}.wav', None) for i in (0, 1)],
    # m2: mieki256, the cries of men cut down
    *[('die', 'm2', 'mieki', f'files/enemy_dead/enemy_dead_{i:02d}.wav', None) for i in (0, 1, 3, 5, 9, 11, 23, 26, 29, 32, 33, 34, 46, 47, 48, 49, 50)],
    *[('pain', 'm2', 'mieki', f'files/enemy_dead/enemy_dead_{i:02d}.wav', None) for i in (7, 10, 20, 21, 37, 38, 40, 51, 52)],
    # m3: Badre-Eddine's hurt and dying, qubodup's cries of strain
    *[('die', 'm3', 'badre', f'files/{i}.mp3', None) for i in (1, 2, 7, 8, 15)], *[('pain', 'm3', 'badre', f'files/{i}.mp3', None) for i in (4, 5, 12, 13, 14, 16, 17)],
    *[('pain', 'm3', 'qubodup', f'files/slightscream-{i:02d}.flac', None) for i in (3, 4, 5, 10, 13, 14, 15)], *[('gasp', 'm3', 'qubodup', f'files/slightscream-{i:02d}.flac', None) for i in (2, 8, 11, 12)],
    # every man: a laugh (Supergeek's), and the screams of four men (HaelDB's, as the soldiers have)
    *[('laugh', w, 'supergeek', None, c) for w, c in [('m1', (0.69, 1.53)), ('m1', (5.31, 6.94)), ('m2', (2.81, 4.18)), ('m2', (13.01, 14.47)), ('m3', (15.41, 16.96)), ('m3', (18.45, 19.50))]],
    *[('scream', w, 'haeldb', f'files/yelling sounds/{f}', None) for w, f in [('m1', '1yell1.wav'), ('m1', '1yell5.wav'), ('m1', '1yell10.wav'), ('m2', '2yell2.wav'), ('m2', '2yell7.wav'), ('m2', '2yell11.wav'),
                                                                               ('m3', '3yell5.wav'), ('m3', '3yell10.wav'), ('m3', 'yell4.wav'), ('m3', 'yell11.wav')]],
]
# how loud each kind is made (dB below full scale, by its loudest half second) and where a longer take is faded out
LEVEL = {'chat': -24, 'greet': -23, 'ask': -21, 'run': -18, 'laugh': -22, 'gasp': -20, 'scream': -13, 'pain': -15, 'plead': -18, 'whimper': -22, 'sigh': -26, 'die': -13}
MAXLEN = {'chat': 3.2, 'greet': 2.2, 'ask': 2.4, 'run': 3.0, 'laugh': 2.8, 'gasp': 0.9, 'scream': 2.0, 'pain': 1.2, 'plead': 2.7, 'whimper': 1.0, 'sigh': 1.3, 'die': 2.2}


def fetch(cache):
    """Each pack into a folder of its own under `cache`; returns {pack: folder}."""
    got = {}
    for name, (url, kind, _) in PACKS.items():
        d = os.path.join(cache, name); os.makedirs(d, exist_ok=True)
        path = os.path.join(d, 'pack.' + kind)
        if not os.path.exists(path):                                       # (curl: it uses the system's certificates)
            subprocess.run(['curl', '-sSLf', '-A', 'asset-fetch/1.0', '-o', path, url], check=True)
        if kind in ('zip', '7z') and not os.path.exists(os.path.join(d, 'files')):
            os.makedirs(os.path.join(d, 'files'))
            subprocess.run([TAR, '-xf', path, '-C', os.path.join(d, 'files')], check=True)
        got[name] = d
    return got


def files_of(d):
    if not os.path.isdir(os.path.join(d, 'files')):
        return [f for f in sorted(os.listdir(d)) if f.lower().endswith(AUDIO)]
    out = []
    for base, _, names in os.walk(os.path.join(d, 'files')):
        for n in sorted(names):
            if n.lower().endswith(AUDIO) and not n.startswith('._'): out.append(os.path.relpath(os.path.join(base, n), d))
    return sorted(out)


def decode(path):
    """Any audio file -> mono float32 at SR (ffmpeg does the reading)."""
    raw = subprocess.run([FF, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], check=True, stdout=subprocess.PIPE).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def loud_parts(x, floor=0.02, gap=0.28, least=0.12):
    """The stretches of `x` where somebody is making a sound: [(start s, end s)], split wherever it is quiet for `gap`."""
    n = int(SR * 0.01); m = len(x) // n
    if m == 0: return []
    e = np.sqrt((x[:m * n].reshape(m, n) ** 2).mean(1)); on = e > max(floor * e.max(), 1e-4)
    out, a, quiet = [], None, 0
    for i, v in enumerate(on):
        if v:
            if a is None: a = i
            quiet = 0
        elif a is not None:
            quiet += 1
            if quiet * 0.01 >= gap:
                if (i - quiet - a) * 0.01 >= least: out.append((a * 0.01, (i - quiet + 1) * 0.01))
                a = None
    if a is not None and (m - a) * 0.01 >= least: out.append((a * 0.01, m * 0.01))
    return out


def listing(packs):
    for name, d in packs.items():
        print(f'## {name}: {PACKS[name][2]}')
        for f in files_of(d):
            x = decode(os.path.join(d, f)); parts = loud_parts(x)
            takes = ' '.join(f'{a:.2f}-{b:.2f}' for a, b in parts[:14]) if 1 < len(parts) else ''
            print(f'   {f}  {len(x) / SR:.2f}s  peak {np.abs(x).max() if len(x) else 0:.2f}  {len(parts)} part(s) {takes}')


def trim(x, floor=0.03):
    n = int(SR * 0.005); m = len(x) // n
    if m < 4: return x
    e = np.sqrt((x[:m * n].reshape(m, n) ** 2).mean(1)); on = np.nonzero(e > floor * e.max())[0]
    return x[max(0, (on[0] - 2) * n):min(len(x), (on[-1] + 6) * n)]


def shape(x, kind):
    """Trimmed, capped to the kind's length, faded at both ends, and brought to the kind's loudness."""
    x = trim(x - x.mean()); x = x[:int(MAXLEN[kind] * SR)].copy()
    a, b = int(0.004 * SR), int((0.12 if len(x) >= MAXLEN[kind] * SR - 2 else 0.03) * SR)
    x[:a] *= np.linspace(0, 1, a); x[-b:] *= np.linspace(1, 0, b) ** 1.5
    span = min(int(0.5 * SR), len(x)); sq = np.cumsum(np.concatenate([[0], x.astype(np.float64) ** 2]))
    rms = np.sqrt(((sq[span:] - sq[:-span]) / span).max())                                 # the loudest half second
    x = x * (10 ** (LEVEL[kind] / 20) / max(rms, 1e-6))
    pk = np.abs(x).max()
    if pk > 0.97: x = np.tanh(x / pk * 1.6) / np.tanh(1.6) * 0.97                          # (a scream brought up to level: its peaks rounded off, not clipped)
    return x.astype(np.float32)


VOWELS = {10: (800, 1350), 11: (560, 2050), 12: (330, 2500), 13: (520, 950), 14: (350, 880)}      # aa, E, I, O, U: first and second formant, Hz


def formants(frame):
    """The first two resonances of the mouth for one stretch of voiced sound (linear prediction at 8 kHz)."""
    y = resample_poly(frame.astype(np.float64), 1, 4); y = np.append(y[0], y[1:] - 0.95 * y[:-1]) * np.hamming(len(y))
    r = np.correlate(y, y, 'full')[len(y) - 1:len(y) + 10]
    if r[0] <= 1e-12: return None
    r[0] *= 1.0001
    try: a = solve_toeplitz(r[:10], -r[1:11])
    except Exception: return None
    f = sorted(np.angle(z) * 8000 / (2 * np.pi) for z in np.roots(np.concatenate([[1], a])) if z.imag > 0.01 and abs(z) > 0.8)
    f = [v for v in f if 200 < v < 3400]
    return (f[0], f[1]) if len(f) >= 2 else None


def timeline(x):
    """What the speaker's face follows: every STEP, how loud (0..255: how far the jaw opens) and which mouth shape
    (0 none, 1..14 = PP FF TH DD kk CH SS nn RR aa E I O U), read off the recording: hiss and breath are told from
    voice by where their energy lies, the vowels from one another by the mouth's first two resonances, and a closed
    mouth is put before a sound that starts from silence."""
    hop, win = int(STEP * SR), 1024; n = max(1, int(np.ceil(len(x) / hop)))
    pad = np.concatenate([np.zeros(win // 2, np.float32), x, np.zeros(win + hop, np.float32)])
    rms = np.array([np.sqrt((pad[i * hop:i * hop + win] ** 2).mean()) for i in range(n)]); ref = max(np.percentile(rms, 95), 1e-5)
    env = np.clip((20 * np.log10(np.maximum(rms, 1e-7) / ref) + 26) / 26, 0, 1); env = np.convolve(np.pad(env, 1, 'edge'), [0.25, 0.5, 0.25], 'valid')
    vis = np.zeros(n, np.uint8); freq = np.fft.rfftfreq(win, 1 / SR); hw = np.hanning(win)
    for i in range(n):
        if env[i] < 0.1: continue
        fr = pad[i * hop:i * hop + win]; sp = np.abs(np.fft.rfft(fr * hw)) ** 2; tot = sp.sum() + 1e-12
        high = sp[freq > 3500].sum() / tot; cen = (sp * freq).sum() / tot
        if high > 0.45:                                                                  # hiss: SS, CH, FF
            vis[i] = 7 if cen > 5200 else 6 if cen > 4200 else 2
            continue
        f = formants(fr)
        if f is None: vis[i] = 10 if env[i] > 0.5 else 8
        elif env[i] < 0.3 and f[0] < 420: vis[i] = 8                                     # a hum: nn
        else: vis[i] = min(VOWELS, key=lambda k: ((f[0] - VOWELS[k][0]) / 300) ** 2 + ((f[1] - VOWELS[k][1]) / 900) ** 2)
    for i in range(2, n):                                                                # lips together before a sound out of silence
        if env[i] >= 0.3 and env[i - 1] < 0.12 and env[i - 2] < 0.12 and vis[i] >= 8: vis[i - 1] = 1
    out = vis.copy()
    for i in range(1, n - 1):                                                            # (one stray frame between two alike is theirs)
        if vis[i - 1] == vis[i + 1] != vis[i] and vis[i] != 1: out[i] = vis[i - 1]
    return (env * 255).astype(np.uint8), out


def build(packs):
    cache, clips, audio, t, miss = {}, [], [], 0.0, []

    def load(pack, f):
        key = (pack, f)
        if key not in cache:
            d = packs[pack]; path = os.path.join(d, f) if f else os.path.join(d, [n for n in os.listdir(d) if n.startswith('pack.')][0])
            cache[key] = decode(path) if os.path.exists(path) else None
        return cache[key]
    for kind, who, pack, f, cut in CLIPS:
        x = load(pack, f)
        if x is None: miss.append(f'{pack}: {f}'); continue
        if cut and cut[0] == 'parts':
            parts = loud_parts(x, gap=cut[1], least=cut[2]); first = cut[3] if cut[3] >= 0 else max(0, len(parts) + cut[3])
            takes = [x[int(a * SR):int(b * SR)] for a, b in parts[first:first + cut[4]]]
        else: takes = [x[int(cut[0] * SR):int(cut[1] * SR)] if cut else x]
        for y in takes:
            if len(y) < 0.1 * SR: continue
            y = shape(y, kind); env, vis = timeline(y)
            clips.append({'kind': kind, 'sex': who[0], 'who': who, 'start': round(t, 4), 'length': round(len(y) / SR, 4), 'step': STEP,
                          'env': base64.b64encode(env.tobytes()).decode(), 'vis': base64.b64encode(vis.tobytes()).decode(), 'src': pack + (': ' + os.path.basename(f) if f else '')})
            audio.append(y); audio.append(np.zeros(int(0.05 * SR), np.float32)); t += len(y) / SR + 0.05
    if miss: sys.exit('missing from the packs:\n  ' + '\n  '.join(miss))
    pcm = (np.clip(np.concatenate(audio), -1, 1) * 32767).astype('<i2')
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, 'civ-voices.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    used = sorted({c['src'].split(':')[0] for c in clips})
    with open(os.path.join(OUT, 'civ-voices.json'), 'w') as fh:
        json.dump({'rate': SR, 'step': STEP, 'visemes': 'PP FF TH DD kk CH SS nn RR aa E I O U', 'credits': sorted({PACKS[p][2] for p in used}), 'clips': clips}, fh, separators=(',', ':'))
    by = {}
    for c in clips: by.setdefault((c['kind'], c['who']), []).append(c['length'])
    print(f'{len(clips)} clips, {t:.1f} s, {len(pcm) * 2 / 1e6:.1f} MB')
    for kind in LEVEL: print(f'  {kind:8s}', '  '.join(f'{who} {len(v)}' for (k, who), v in sorted(by.items()) if k == kind))


if __name__ == '__main__':
    args = sys.argv[1:]
    cache = args[args.index('--cache') + 1] if '--cache' in args else os.path.join(ROOT, 'build', 'civ-voices')
    os.makedirs(cache, exist_ok=True)
    packs = fetch(cache)
    if '--list' in args: listing(packs); sys.exit(0)
    build(packs)
