"""Audit that 40 ZIP stickers match the correct cells of an original 5x8 sheet.

Optional local QA, not a substitute for cutout visual review.
Usage: python3 tests/audit_real40_mapping.py original-sheet.png candidate.zip
Requires: Pillow, opencv-python
"""
import csv
import io
import sys
import zipfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

if len(sys.argv) != 3:
    raise SystemExit("Usage: python3 tests/audit_real40_mapping.py original-sheet.png candidate.zip")
sheet = np.asarray(Image.open(sys.argv[1]).convert("RGB"))
h, w = sheet.shape[:2]
orb = cv2.ORB_create(nfeatures=800, fastThreshold=5)
descriptors = []
for index in range(40):
    col, row = index % 5, index // 5
    cell = sheet[round(row*h/8):round((row+1)*h/8),
                 round(col*w/5):round((col+1)*w/5)]
    descriptors.append(orb.detectAndCompute(cv2.cvtColor(cell, cv2.COLOR_RGB2GRAY), None)[1])

rows = []
matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
with zipfile.ZipFile(sys.argv[2]) as archive:
    if archive.testzip() is not None:
        raise SystemExit("Invalid ZIP CRC")
    for index in range(40):
        sticker = Image.open(io.BytesIO(archive.read(f"{index+1:02d}.png"))).convert("RGBA")
        white = Image.new("RGBA", sticker.size, "white")
        white.alpha_composite(sticker)
        rgb = np.asarray(white.convert("RGB"))
        desc = orb.detectAndCompute(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), None)[1]
        scores = []
        for reference in descriptors:
            if desc is None or reference is None:
                scores.append(0)
                continue
            pairs = matcher.knnMatch(desc, reference, k=2)
            scores.append(sum(1 for pair in pairs if len(pair) == 2
                              and pair[0].distance < .75 * pair[1].distance))
        ranked = sorted(range(40), key=lambda k: scores[k], reverse=True)
        rows.append((index+1, ranked[0]+1, scores[index], scores[ranked[0]],
                     ranked.index(index)+1, scores[ranked[1]], scores[index]-scores[ranked[1]]))
writer = csv.writer(sys.stdout)
writer.writerow(["sticker", "best_source_cell", "own_cell_matches", "best_matches", "own_cell_rank", "runner_up_matches", "match_gap"])
writer.writerows(rows)
incorrect = [row for row in rows if row[0] != row[1]]
weak = [row for row in rows if row[2] < 8 or row[5] < 5]
if weak:
    raise SystemExit(f"FAIL: {len(weak)} stickers have fewer than 8 matching features or less than 5-point margin over runner-up; mapping is inconclusive")
if incorrect:
    raise SystemExit(f"FAIL: {len(incorrect)} stickers do not best match their numbered source cell")
print("PASS: all 40 stickers best match their numbered source cells", file=sys.stderr)
