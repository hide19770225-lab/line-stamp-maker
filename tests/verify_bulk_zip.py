"""Independently decode the 42-image export and compare it with read-only audit input."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode = True
from verify_zip import decode_png, verify
folder = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/stamp-bulk-results')
for stem, count in [(f'bulk-{n}', n) for n in [8, 16, 24, 32, 40]] + [('bulk-40-edited', 40)]:
    verify(folder / f'{stem}.zip', count)
    hashes = json.loads((folder / f'{stem}.json').read_text())
    with zipfile.ZipFile(folder / f'{stem}.zip') as archive:
        for name in archive.namelist():
            _, _, rgba = decode_png(archive.read(name))
            assert hashlib.sha256(rgba).hexdigest() == hashes[name], f'{stem}/{name}: preview/export pixels differ'
print('PASS: all 8/16/24/32/40 exports and edited 40 export match exact preview RGBA; all stamps, main and tab independently decoded')
