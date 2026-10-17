"""Independent decoded-PNG checks for the full real-image browser run."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode = True
from verify_zip import decode_png, verify
folder = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/stamp-real-results')
verify(folder / 'app-real-test-2.zip', 2)
evidence = json.loads((folder / 'real-app-evidence.json').read_text())

def components(width, height, pixels):
    seen = bytearray(width * height)
    for i in range(width * height):
        if seen[i] or not pixels[i * 4 + 3]:
            continue
        queue = [i]
        seen[i] = 1
        for j in queue:
            x, y = j % width, j // width
            for dy in [-1, 0, 1]:
                for dx in [-1, 0, 1]:
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < width and 0 <= ny < height):
                        continue
                    k = ny * width + nx
                    if not seen[k] and pixels[k * 4 + 3]:
                        seen[k] = 1
                        queue.append(k)
        xs, ys = [j % width for j in queue], [j // width for j in queue]
        yield min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1

with zipfile.ZipFile(folder / 'app-real-test-2.zip') as archive:
    for slot, original in [(1, '09'), (2, '10')]:
        width, height, data = decode_png(archive.read(f'{slot:02}.png'))
        assert hashlib.sha256(data).hexdigest() == evidence['hashes'][slot - 1], 'gallery and ZIP differ'
        assert decode_png((folder / f'app-{original}.png').read_bytes())[2] == data, 'single PNG and ZIP differ'
    for name in archive.namelist():
        width, height, data = decode_png(archive.read(name))
        thin = [(x, y, w, h) for x, y, w, h in components(width, height, data) if y < height / 3 and w >= 5 and h <= 2 and w / h >= 4]
        assert not thin, f'{name}: top isolated horizontal residue remains: {thin}'
print('PASS: real-image app PNG / gallery / ZIP RGBA equality; all four output PNGs have no isolated thin top line; dimensions, margins, transparency, CRCs pass')
