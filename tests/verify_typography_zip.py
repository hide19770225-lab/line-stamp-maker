"""Verify actual composed PNGs in the typography integration-test ZIP."""
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode = True
from verify_zip import decode_png, verify

folder = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/stamp-test-artifacts')
archive_path = folder / 'typography-40.zip'
verify(archive_path, 40)
with zipfile.ZipFile(archive_path) as archive:
    for number in range(1, 41):
        width, height, pixels = decode_png(archive.read(f'{number:02}.png'))
        text_color = [88, 140, 114] if number == 2 else [25, 68, 170]
        col, row = (number - 1) % 5, (number - 1) // 5
        character_color = [70 + col * 15, 110 + row * 8, 180]
        text_pixels = character_pixels = outline_pixels = 0
        for i in range(0, len(pixels), 4):
            if not pixels[i + 3]:
                continue
            rgb = list(pixels[i:i + 3])
            text_pixels += rgb == text_color
            character_pixels += rgb == character_color
            outline_pixels += rgb == [255, 255, 255]
        assert text_pixels > 25, f'{number:02}.png is missing its designed caption'
        assert character_pixels > 500, f'{number:02}.png is missing its character'
        assert outline_pixels > 10, f'{number:02}.png is missing its white outline'
print('PASS: all 40 exported PNGs contain actual colored Japanese typography, white outlines, and original character pixels')
