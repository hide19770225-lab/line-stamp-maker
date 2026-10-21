"""Build a clean 5x8 test sheet from 40 already-reviewed PNGs in a ZIP.

This tests 40 *distinct real designs* through the app, NOT the raw original
sheet's difficult cutout boundaries. Requires Pillow.
Usage: python3 tests/build_reviewed_40_sheet.py reviewed-42-images.zip out.png
"""
import io
import sys
import zipfile
from pathlib import Path
from PIL import Image

if len(sys.argv) != 3:
    raise SystemExit("Usage: python3 tests/build_reviewed_40_sheet.py reviewed.zip output.png")
source, output = sys.argv[1:]
cell_w, cell_h = 420, 370
sheet = Image.new("RGB", (cell_w * 5, cell_h * 8), "white")
with zipfile.ZipFile(source) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit(f"Invalid ZIP CRC: {bad}")
    numbered = [name for name in archive.namelist() if len(name) == 6 and name[:2].isdigit() and name[2:].lower() == ".png"]
    unexpected = sorted(name for name in numbered if not (1 <= int(name[:2]) <= 40))
    if unexpected:
        raise SystemExit(f"Unexpected numbered stickers: {unexpected}")
    for i in range(40):
        name = f"{i+1:02d}.png"
        if name not in archive.namelist():
            raise SystemExit(f"Missing numbered sticker: {name}")
        with Image.open(io.BytesIO(archive.read(name))) as original:
            original.load()
            sticker = original.convert("RGBA")
        if sticker.size != (370, 320):
            raise SystemExit(f"Unexpected size for {name}: {sticker.size}")
        bg = Image.new("RGBA", sticker.size, "white")
        bg.alpha_composite(sticker)
        sheet.paste(bg.convert("RGB"), ((i % 5) * cell_w + 25, (i // 5) * cell_h + 25))
Path(output).parent.mkdir(parents=True, exist_ok=True)
sheet.save(output)
print(f"PASS: reviewed 40-design test sheet saved to {output}; raw-source cutout quality NOT certified")
