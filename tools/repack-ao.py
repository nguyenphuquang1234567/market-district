#!/usr/bin/env python3
"""Rebuilds the ambient-occlusion channel (red) of a texture set's ARM map from its normal map, for sets whose
downloaded ARM carries no occlusion (cobblestone_floor_13's red channel is all but black, which multiplied every bit
of indirect light on the quarter's streets by about a tenth: shaded cobbles came out nearly black).
   python3 tools/repack-ao.py cobblestone_floor_13        (then: node tools/encode-ktx2.mjs)
The occlusion is a cavity estimate: how far the surface tilts away from the tile's plane (the joints between rounded
stones), softened a little so it reads as shade rather than outline. Roughness (green) and metalness (blue) are kept."""
import sys
from PIL import Image, ImageFilter
import numpy as np

tex = sys.argv[1]
arm_path, nor_path = f'assets/tex/{tex}/arm.jpg', f'assets/tex/{tex}/nor.jpg'
arm = Image.open(arm_path).convert('RGB')
a = np.asarray(arm, dtype=np.float32) / 255
if a[..., 0].mean() > 0.3 and '--force' not in sys.argv:
    sys.exit(f'{tex}: its ARM already has occlusion (mean {a[..., 0].mean():.2f}); --force to rebuild it anyway')
n = np.asarray(Image.open(nor_path).convert('RGB').resize(arm.size, Image.LANCZOS), dtype=np.float32) / 255
nz = n[..., 2] * 2 - 1                                            # OpenGL normal map: z in blue
t = np.clip((nz - 0.70) / (0.97 - 0.70), 0, 1); cav = t * t * (3 - 2 * t)
cav = np.asarray(Image.fromarray((cav * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=arm.size[0] / 512)), dtype=np.float32) / 255
a[..., 0] = 0.55 + 0.45 * cav
Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)).save(arm_path, quality=95)
print(f'{tex}: occlusion rebuilt from the normal map, mean {a[..., 0].mean():.2f}, 10th percentile {np.percentile(a[..., 0], 10):.2f}')
