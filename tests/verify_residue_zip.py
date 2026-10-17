"""Independently decode real regression-test ZIP PNGs; no imaging dependencies."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode = True
from verify_zip import decode_png, verify

folder = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/stamp-test-artifacts')
hashes = json.loads((folder / 'residue-preview-hashes-40.json').read_text())
verify(folder / 'residue-fixed-40.zip', 40)
with zipfile.ZipFile(folder / 'residue-fixed-40.zip') as archive:
    for number in range(1, 41):
        width, height, pixels = decode_png(archive.read(f'{number:02}.png'))
        assert hashlib.sha256(pixels).hexdigest() == hashes[number - 1], f'{number}: gallery and exported PNG differ'
        # White body and detached ornament must survive. The removed white line was above y=75.
        whites = [(i // 4 % width, i // 4 // width) for i in range(0, len(pixels), 4)
                  if pixels[i + 3] and all(c > 240 for c in pixels[i:i + 3])]
        assert len(whites) > 500, f'{number}: white body/ornament lost'
        assert any(x > 285 for x, y in whites), f'{number}: detached white ornament lost'
        assert not any(y < 75 for x, y in whites), f'{number}: top white residue remains'
        assert sum(pixels[i + 3] > 0 and pixels[i + 1] > 140 and pixels[i] < 100 for i in range(0, len(pixels), 4)) > 100, f'{number}: leaf lost'
print('PASS: all 40 ZIP PNGs exactly match gallery RGBA hashes, no top white residues, white body/ornament and green leaf present')
for count in [8, 16, 24, 32, 40]:
    verify(folder / f'residue-count-{count}.zip', count)
    with zipfile.ZipFile(folder / f'residue-count-{count}.zip') as archive:
        for number in range(1, count + 1):
            width, height, pixels = decode_png(archive.read(f'{number:02}.png'))
            whites = [(i // 4 % width, i // 4 // width) for i in range(0, len(pixels), 4)
                      if pixels[i + 3] and all(c > 240 for c in pixels[i:i + 3])]
            assert len(whites) > 500 and any(x > 285 for x, y in whites), f'{count}/{number}: white body or ornament lost'
            assert sum(pixels[i + 3] > 0 and pixels[i + 1] > 140 and pixels[i] < 100 for i in range(0, len(pixels), 4)) > 100, f'{count}/{number}: leaf lost'
            assert not any(pixels[i + 3] and all(c > 240 for c in pixels[i:i + 3])
                           for i in range(0, width * 75 * 4, 4)), f'{count}/{number}: top residue remains'
for number, expected in [(9, 51), (10, 16)]:
    for state, target in [('before', expected), ('after', 0)]:
        width, height, pixels = decode_png((folder / f'residue-{state}-{number}.png').read_bytes())
        count = sum(pixels[(y * width + x) * 4 + 3] > 0
                    and all(c > 240 for c in pixels[(y * width + x) * 4:(y * width + x) * 4 + 3])
                    for y in range(10, 35) for x in range(10, 360))
        assert count == target, (number, state, count, target)
print('PASS: decoded before/after PNGs independently confirm synthetic 51/16 → 0 white pixels')
