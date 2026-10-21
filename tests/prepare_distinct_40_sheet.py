"""Generate 40 visually distinct regression cells from a 2x5 source.

IMPORTANT: These are synthetic variations of 10 source poses, not 40 independent
user artworks. This exercises per-slot browser state and ZIP export only.
Usage: python3 tests/prepare_distinct_40_sheet.py source-2x5.png output-5x8.png
"""
import sys
from PIL import Image, ImageDraw

if len(sys.argv) != 3:
    raise SystemExit("Usage: prepare_distinct_40_sheet.py source-2x5.png output-5x8.png")
source = Image.open(sys.argv[1]).convert("RGB")
output = Image.new("RGB", (1200, 1920), "white")
for index in range(40):
    pose = index % 10
    col, row = pose % 2, pose // 2
    tile = source.crop((round(col * source.width / 2), round(row * source.height / 5),
                        round((col + 1) * source.width / 2), round((row + 1) * source.height / 5)))
    tile.thumbnail((210, 210))
    x = (index % 5) * 240
    y = (index // 5) * 240
    output.paste(tile, (x + (240 - tile.width)//2, y + (240 - tile.height)//2))
    # Unique large marker at a fixed location so near-duplicate detection
    # cannot mistake the 10 repeated source poses for 40 independent cells.
    draw = ImageDraw.Draw(output)
    marker = ((index * 59 + 13) % 225, (index * 97 + 29) % 225,
              (index * 131 + 43) % 225)
    draw.rectangle((x+9, y+9, x+85, y+60), fill=marker)
    draw.text((x+18, y+17), f"{index+1:02d}", fill="white", stroke_width=1, stroke_fill="black")
output.save(sys.argv[2])
print("Synthetic distinct-40 fixture generated; NOT user original 40 artwork.")
