"""Render all 40 exported PNGs into one numbered QA overview (not an approval)."""
import io
import sys
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw

if len(sys.argv) != 3:
    raise SystemExit("Usage: python3 tests/render_export_review_sheet.py exported-40.zip output.png")
source, target = sys.argv[1:]
cell_w, cell_h = 420, 375
canvas = Image.new("RGB", (cell_w * 5, cell_h * 8), "#dddddd")
draw = ImageDraw.Draw(canvas)
with zipfile.ZipFile(source) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit(f"Invalid ZIP CRC: {bad}")
    for index in range(40):
        name = f"{index + 1:02d}.png"
        if name not in archive.namelist():
            raise SystemExit(f"Missing output: {name}")
        with Image.open(io.BytesIO(archive.read(name))) as im:
            im.load()
            if im.size != (370, 320):
                raise SystemExit(f"Invalid dimensions: {name} {im.size}")
            sticker = im.convert("RGBA")
        x, y = (index % 5) * cell_w, (index // 5) * cell_h
        draw.rectangle((x + 8, y + 8, x + 412, y + 365), fill="white")
        white = Image.new("RGBA", sticker.size, "white")
        white.alpha_composite(sticker)
        canvas.paste(white.convert("RGB"), (x + 25, y + 30))
        draw.text((x + 16, y + 12), name, fill="#222222")
Path(target).parent.mkdir(parents=True, exist_ok=True)
canvas.save(target)
print(f"REVIEW REQUIRED: numbered overview saved to {target}; not a visual approval")
