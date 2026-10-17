"""Repair only the two checksum-identified uploaded PNGs, using StampResidue's approved-component deletion.

This fixture utility preserves every non-line RGBA byte and keeps the original 370x320 layout.
The application's normal fitting/lettering pipeline is tested separately by real-png-browser.cjs.
"""
import base64
import hashlib
import json
import struct
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path
sys.dont_write_bytecode = True
from verify_zip import decode_png

root = Path(__file__).resolve().parent.parent
fixtures = json.loads((root / 'tests/fixtures/real-line-strips.json').read_text())
source = Path(sys.argv[1])
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

def png(width, height, rgba):
    rows = b''.join(b'\0' + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))

results = []
for fixture in fixtures:
    raw = (source / fixture['file']).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == fixture['sha256'], 'Only the explicitly identified uploaded fixtures may be repaired by this utility'
    width, height, before = decode_png(raw)
    command = r'''
const fs=require('node:fs'),R=require('./residue.js'),input=JSON.parse(fs.readFileSync(0,'utf8'));
const image={width:input.width,height:input.height,data:new Uint8ClampedArray(input.data)},mask=Uint8ClampedArray.from({length:image.width*image.height},(_,i)=>image.data[i*4+3]);
const scan=R.analyse(image,mask,undefined,true),f=input.fixture;
const line=scan.candidates.find(c=>c.x===f.x&&c.y===f.y&&c.width===f.width&&c.height===1&&!c.protected);
if(!line)throw Error('Approved line component not found');
const result=R.removeSelected(mask,scan,[line.id]);
console.log(JSON.stringify({mask:Buffer.from(result.mask).toString('base64'),removed:result.removed,component:line,protected:scan.candidates.filter(c=>c.protected)}));
'''
    result = json.loads(subprocess.run(['node', '-e', command], cwd=root,
                        input=json.dumps({'width': width, 'height': height, 'data': list(before), 'fixture': fixture}),
                        text=True, capture_output=True, check=True).stdout)
    mask = base64.b64decode(result['mask'])
    after = bytearray(before)
    for i, alpha in enumerate(mask):
        after[i * 4 + 3] = alpha
        if alpha == 0 and before[i * 4 + 3] > 0:
            after[i * 4:i * 4 + 4] = bytes(4)
    approved = set(range(fixture['y'] * width + fixture['x'], fixture['y'] * width + fixture['x'] + fixture['width']))
    for i in range(width * height):
        if i in approved:
            assert before[i * 4 + 3] > 0 and after[i * 4 + 3] == 0
        else:
            assert before[i * 4:i * 4 + 4] == after[i * 4:i * 4 + 4]
    encoded = png(width, height, after)
    assert decode_png(encoded)[2] == after
    (output / fixture['file']).write_bytes(encoded)
    results.append({'file': fixture['file'], 'sourceSHA256': fixture['sha256'], 'component': result['component'],
                    'removedPixels': result['removed'], 'otherRGBAPixelsIdentical': True, 'protected': result['protected']})
with zipfile.ZipFile(output / 'line-defect-09-10-corrected.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for fixture in fixtures:
        archive.write(output / fixture['file'], fixture['file'])
with zipfile.ZipFile(output / 'line-defect-09-10-corrected.zip') as archive:
    assert archive.testzip() is None
    for fixture in fixtures:
        assert archive.read(fixture['file']) == (output / fixture['file']).read_bytes()
(output / 'real-repair-report.json').write_text(json.dumps(results, indent=2))
print('PASS: actual 09.png/10.png and ZIP repaired through StampResidue; all 65 line alpha pixels zero, every other RGBA byte identical, dimensions unchanged, ZIP byte equality and CRC valid')
