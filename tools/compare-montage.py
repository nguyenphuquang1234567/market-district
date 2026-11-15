#!/usr/bin/env python3
"""Side-by-side montages of two capture sets (see tools/compare-shots.js), with a per-view difference measure.
   python3 tools/compare-montage.py <dirA> <tagA> <dirB> <tagB> <outDir> [view ...]
Writes <outDir>/<tagA>_vs_<tagB>_<view>.jpg (two frames side by side at half size, labelled) and prints, per view,
the mean absolute difference (0-255) and PSNR between the two frames."""
import sys, os, math
from PIL import Image, ImageDraw
import numpy as np

a_dir, a_tag, b_dir, b_tag, out_dir = sys.argv[1:6]
views = sys.argv[6:]
os.makedirs(out_dir, exist_ok=True)
if not views:
    views = sorted(f[len(f'cmp_{a_tag}_'):-4] for f in os.listdir(a_dir) if f.startswith(f'cmp_{a_tag}_') and f.endswith('.jpg'))
for v in views:
    pa, pb = os.path.join(a_dir, f'cmp_{a_tag}_{v}.jpg'), os.path.join(b_dir, f'cmp_{b_tag}_{v}.jpg')
    if not (os.path.exists(pa) and os.path.exists(pb)):
        print(f'{v}: missing'); continue
    A, B = Image.open(pa).convert('RGB'), Image.open(pb).convert('RGB')
    xa, xb = np.asarray(A, dtype=np.float32), np.asarray(B, dtype=np.float32)
    mad = float(np.abs(xa - xb).mean()); mse = float(((xa - xb) ** 2).mean())
    psnr = 99.0 if mse == 0 else 10 * math.log10(255 ** 2 / mse)
    w, h = A.width // 2, A.height // 2
    M = Image.new('RGB', (w * 2 + 8, h + 34), (20, 20, 20))
    M.paste(A.resize((w, h), Image.LANCZOS), (0, 34)); M.paste(B.resize((w, h), Image.LANCZOS), (w + 8, 34))
    d = ImageDraw.Draw(M)
    d.text((10, 10), f'{a_tag}  -  {v}', fill=(235, 235, 235)); d.text((w + 18, 10), f'{b_tag}  -  {v}', fill=(235, 235, 235))
    M.save(os.path.join(out_dir, f'{a_tag}_vs_{b_tag}_{v}.jpg'), quality=88)
    print(f'{v}: mean abs diff {mad:.2f}, PSNR {psnr:.1f} dB')
