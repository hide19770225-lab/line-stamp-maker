"""Verify the 5x8 QA overview contains the actual exported PNG pixels."""
import io
import sys
import zipfile
from PIL import Image, ImageChops

if len(sys.argv) != 3:
    raise SystemExit("Usage: python3 tests/verify_export_review_sheet.py output.zip review.png")
with Image.open(sys.argv[2]) as image:
    overview = image.convert("RGB")
if overview.size != (2100, 3000):
    raise SystemExit(f"Wrong overview dimensions: {overview.size}")
with zipfile.ZipFile(sys.argv[1]) as archive:
    if archive.testzip() is not None:
        raise SystemExit("Corrupted export ZIP")
    for i in range(40):
        name = f"{i+1:02d}.png"
        with Image.open(io.BytesIO(archive.read(name))) as image:
            sticker = image.convert("RGBA")
        if sticker.size != (370, 320):
            raise SystemExit(f"Wrong sticker dimensions: {name}")
        white = Image.new("RGBA", sticker.size, "white")
        white.alpha_composite(sticker)
        x, y = (i % 5) * 420 + 25, (i // 5) * 375 + 30
        cropped = overview.crop((x, y, x+370, y+320))
        if ImageChops.difference(cropped, white.convert("RGB")).getbbox():
            raise SystemExit(f"Overview differs from ZIP pixels: {name}")
print("PASS: all 40 review cells match the exported PNGs pixel-for-pixel")
