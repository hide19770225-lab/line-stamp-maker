"""Decode easy-production ZIP files independently and compare exact preview RGBA."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode = True
from verify_zip import decode_png, verify
folder = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/stamp-easy-results')
for stem, count in [(f'easy-{n}',n) for n in [8,16,24,32,40]] + [('easy-40-edited',40)]:
    verify(folder / f'{stem}.zip',count)
    hashes=json.loads((folder / f'{stem}.json').read_text())
    with zipfile.ZipFile(folder / f'{stem}.zip') as archive:
        for name in archive.namelist():
            _,_,rgba=decode_png(archive.read(name))
            assert hashlib.sha256(rgba).hexdigest()==hashes[name],f'{stem}/{name}: preview differs'
print('PASS: all easy-production PNGs match preview pixels, including main/tab and edited 40-sticker export')
