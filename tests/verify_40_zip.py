"""Verify constructed 40-sticker ZIP against the browser's rendered expected PNGs."""
import base64
import io
import json
import sys
import zipfile
from PIL import Image, ImageChops

zip_path, expected_path = sys.argv[1:3]
with open(expected_path, encoding="utf-8") as f:
    expected = json.load(f)
names = [f"{i:02}.png" for i in range(1, 41)]
assert set(expected) == set(names), "expected.json must contain exactly 40 numbered PNGs"
with zipfile.ZipFile(zip_path) as z:
    assert z.testzip() is None, "ZIP CRC failed"
    assert set(z.namelist()) == set(names + ["main.png", "tab.png"]), "missing or extra ZIP entries"
    for name in names + ["main.png", "tab.png"]:
        payload = z.read(name)
        assert len(payload) < 1_000_000, f"{name}: over 1MB"
        with Image.open(io.BytesIO(payload)) as img:
            img.load()
            size = (370, 320) if name in names else (240, 240) if name == "main.png" else (96, 74)
            assert img.size == size, f"{name}: unexpected dimensions {img.size}"
            assert img.mode == "RGBA", f"{name}: not RGBA"
            assert all(img.getpixel(p)[3] == 0 for p in [(0, 0), (size[0]-1, 0), (0, size[1]-1), (size[0]-1, size[1]-1)]), f"{name}: opaque corner"
            if name in names:
                bbox = img.getchannel("A").getbbox()
                assert bbox is not None, f"{name}: empty"
                left, top, right, bottom = bbox
                margins = (left, top, size[0]-right, size[1]-bottom)
                assert min(margins) >= 20, f"{name}: insufficient margin {margins}"
                with Image.open(io.BytesIO(base64.b64decode(expected[name]))) as reference:
                    reference.load()
                    assert reference.size == img.size
                    assert all(channel.getbbox() is None for channel in ImageChops.difference(img, reference.convert("RGBA")).split()), f"{name}: pixel mismatch"
print("PASS: 40/40 pixel-exact PNGs, dimensions, RGBA, margins, ZIP CRC, main and tab")
