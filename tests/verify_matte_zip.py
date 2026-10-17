"""Independently verify the approved boundary/index cleanup and matte UI test ZIP."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode = True
from verify_zip import decode_png, verify
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


folder = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/stamp-matte-tests')
verify(folder / 'matte-10.zip', 10)
hashes = json.loads((folder / 'matte-preview-hashes.json').read_text())
with zipfile.ZipFile(folder / 'matte-10.zip') as archive:
    for number in range(1, 11):
        width, height, pixels = decode_png(archive.read(f'{number:02}.png'))
        assert hashlib.sha256(pixels).hexdigest() == hashes[number - 1], f'{number}: ZIP/preview mismatch'
        foreground = list(components(width, height, pixels))
        assert len(foreground) == 2, f'{number}: expected character + preserved partial-alpha shadow, got {foreground}'
        assert not any(y < height / 3 and w >= 5 and h <= 2 for x,y,w,h in foreground), f'{number}: top line remains'
        assert sum(pixels[i+3] > 0 and pixels[i:i+3] == bytes([255,255,255]) for i in range(0,len(pixels),4)) > 200, f'{number}: white interior lost'
        assert sum(pixels[i+3] > 0 and pixels[i:i+3] == bytes([30,80,40]) for i in range(0,len(pixels),4)) > 1000, f'{number}: character color lost'
print('PASS: all 10 approved line/index cleanups, no extra component, preserved shadow + white interior + character color; gallery/ZIP pixel equality, main/tab sizes, margins, CRC')
