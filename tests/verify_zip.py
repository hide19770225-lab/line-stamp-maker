"""Validate downloaded ZIPs and decode RGBA PNGs using only the Python standard library."""
import struct
import sys
import zipfile
import zlib
from pathlib import Path


def decode_png(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, compressed = 8, bytearray()
    while pos < len(data):
        size = struct.unpack('>I', data[pos:pos + 4])[0]
        kind, chunk = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + size]
        assert (zlib.crc32(kind + chunk) & 0xffffffff) == struct.unpack('>I', data[pos + 8 + size:pos + 12 + size])[0]
        if kind == b'IHDR':
            width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
            assert (depth, color, interlace) == (8, 6, 0), 'Expected 8-bit RGBA, non-interlaced PNG'
        if kind == b'IDAT':
            compressed.extend(chunk)
        pos += 12 + size
    raw, stride = zlib.decompress(compressed), width * 4
    pixels, previous = bytearray(), bytearray(stride)
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        row = bytearray(raw[offset + 1:offset + 1 + stride])
        offset += stride + 1
        for x in range(stride):
            left, up, upper_left = (row[x - 4] if x >= 4 else 0), previous[x], (previous[x - 4] if x >= 4 else 0)
            if filter_type == 0:
                prediction = 0
            elif filter_type == 1:
                prediction = left
            elif filter_type == 2:
                prediction = up
            elif filter_type == 3:
                prediction = (left + up) // 2
            elif filter_type == 4:
                p = left + up - upper_left
                distances = [abs(p - left), abs(p - up), abs(p - upper_left)]
                prediction = [left, up, upper_left][distances.index(min(distances))]
            else:
                raise AssertionError('Unknown PNG filter')
            row[x] = (row[x] + prediction) % 256
        pixels.extend(row)
        previous = row
    assert offset == len(raw)
    return width, height, pixels


def verify(path, count):
    with zipfile.ZipFile(path) as archive:
        expected = [f'{i:02}.png' for i in range(1, count + 1)] + ['main.png', 'tab.png']
        assert archive.namelist() == expected
        assert archive.testzip() is None, 'ZIP CRC check'
        for name in expected:
            png = archive.read(name)
            assert len(png) <= 1024 * 1024
            width, height, pixels = decode_png(png)
            target = (240, 240) if name == 'main.png' else (96, 74) if name == 'tab.png' else (370, 320)
            assert (width, height) == target, name
            assert width % 2 == height % 2 == 0
            assert any(pixels[3::4]), f'{name} must not be empty'
            for y in range(height):
                for x in range(width):
                    if x < 10 or y < 10 or x >= width - 10 or y >= height - 10:
                        assert pixels[(y * width + x) * 4 + 3] == 0, f'{name} needs 10px transparent margins'
    assert path.stat().st_size <= 20 * 1024 * 1024
    print(f'PASS: {path.name}: {count + 2} PNGs, correct filenames/dimensions, alpha/margins, nonempty, PNG and ZIP CRCs, size limits')


if __name__ == '__main__':
    directory = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/stamp-test-artifacts')
    verify(directory / 'test-10.zip', 10)
    verify(directory / 'full-40.zip', 40)
