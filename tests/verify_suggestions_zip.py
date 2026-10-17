"""Decode proposed-caption exports independently; verify 20px stamp margins and exact RGBA."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode=True
from verify_zip import decode_png, verify
folder=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/stamp-suggestion-results')
for n in [10,40]:
    path=folder/f'suggestions-{n}.zip'
    verify(path,n)
    expected=json.loads((folder/f'suggestions-{n}.json').read_text())
    with zipfile.ZipFile(path) as archive:
        for r in expected:
            width,height,rgba=decode_png(archive.read(f'{r["slot"]:02}.png'))
            assert hashlib.sha256(rgba).hexdigest()==r['hash']
            assert r['caption'] and not r['clipped'] and r['overlap']==r['edge']==0
            for y in range(height):
                for x in range(width):
                    if x<20 or x>=width-20 or y<20 or y>=height-20:
                        assert rgba[(y*width+x)*4+3]==0
print('PASS: 10 and 40 proposal exports: exact preview RGBA, Japanese text, 20px stamp margins, main/tab dimensions, PNG/ZIP CRCs and sizes')
