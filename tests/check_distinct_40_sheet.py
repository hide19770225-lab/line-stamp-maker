"""Check that a real 5x8 source sheet contains 40 non-duplicate visual cells.

This is a preflight for a *distinct* 40-sticker browser run, not proof of correct
grid segmentation or of complete cutouts. Requires Pillow.
Usage: python3 tests/check_distinct_40_sheet.py path/to/real-40.png
"""
import json
import sys
from PIL import Image, ImageChops, ImageOps, ImageStat

if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 tests/check_distinct_40_sheet.py real-40.png")

source = Image.open(sys.argv[1]).convert("RGB")
w, h = source.size
if w < 500 or h < 800:
    raise SystemExit(f"Source too small for a 5x8 sheet: {w}x{h}")

signatures = []
for i in range(40):
    col, row = i % 5, i // 5
    cell = source.crop((round(col * w / 5), round(row * h / 8),
                        round((col + 1) * w / 5), round((row + 1) * h / 8)))
    # A coarse RGB signature catches exact and near-exact repeated poses
    # while tolerating small differences in borders/antialiasing.
    thumb = ImageOps.fit(cell, (32, 32), method=Image.Resampling.LANCZOS)
    signatures.append(thumb)

duplicates = []
for i in range(40):
    for j in range(i):
        diff = ImageChops.difference(signatures[i], signatures[j])
        rms = sum(ImageStat.Stat(diff).mean) / 3
        if rms < 3:
            duplicates.append({"first": j + 1, "second": i + 1, "mean_rgb_difference": round(rms, 2)})

result = {"source": sys.argv[1], "width": w, "height": h,
          "cells": 40, "near_duplicate_pairs": duplicates,
          "warning": "Unique cells do not establish clean segmentation or visual quality."}
print(json.dumps(result, ensure_ascii=False, indent=2))
if duplicates:
    raise SystemExit(f"FAIL: {len(duplicates)} near-duplicate cell pairs; this is not a distinct-40 fixture")
print("PASS: 40 grid cells without near-identical duplicates")
