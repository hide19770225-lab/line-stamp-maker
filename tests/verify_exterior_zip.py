"""Decode exact-geometry synthetic regression PNGs and the actual app ZIP independently."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode = True
from verify_zip import decode_png, verify

folder = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/stamp-test-artifacts')
verify(folder / 'exterior-test-10.zip', 10)
hashes = json.loads((folder / 'exterior-preview-hashes.json').read_text())
with zipfile.ZipFile(folder / 'exterior-test-10.zip') as archive:
    for number in range(1, 11):
        width, height, pixels = decode_png(archive.read(f'{number:02}.png'))
        assert hashlib.sha256(pixels).hexdigest() == hashes[number - 1], f'{number}: preview and ZIP differ'
        if number not in [9, 10]:
            continue
        y, length = (25, 49) if number == 9 else (10, 16)
        before_w, before_h, before = decode_png((folder / f'exterior-before-{number}.png').read_bytes())
        single_w, single_h, single = decode_png((folder / f'exterior-single-{number}.png').read_bytes())
        assert (before_w, before_h) == (single_w, single_h) == (370, 320)
        assert single == pixels, f'{number}: single PNG and ZIP differ'
        line_indices = set(range(y * width + 130, y * width + 130 + length))
        differences = 0
        for i in range(width * height):
            rgba = pixels[i * 4:i * 4 + 4]
            old = before[i * 4:i * 4 + 4]
            if i in line_indices:
                assert old == bytes([255, 255, 255, 255]), f'{number}: exact before line missing'
                assert rgba[3] == 0, f'{number}: residue remains at {i % width},{i // width}'
                differences += 1
            else:
                assert rgba == old, f'{number}: unrelated pixel changed at {i % width},{i // width}'
        assert differences == length
        for name, x, py, rgb in [('white body', 100, 180, [255, 255, 255]),
                                 ('white ornament', 320, 50, [255, 255, 255]),
                                 ('leaf', 300, 55, [64, 176, 108]),
                                 ('eye', 120, 150, [23, 46, 37])]:
            offset = (py * width + x) * 4
            assert pixels[offset:offset + 4] == bytes(rgb + [255]), f'{number}: {name} lost'
        print(f'PASS: synthetic {number:02}.png at y={y}: {length}x1 -> 0 residue; every other RGBA pixel identical; white body/ornament, leaf, eye preserved')
print('PASS: all 10 decoded ZIP PNGs equal gallery RGBA hashes; individual PNG downloads equal ZIP 09/10')
