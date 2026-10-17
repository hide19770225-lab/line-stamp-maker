"""Independent PNG/ZIP decoding for the exact 10-caption / 40-slot regression."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode = True
from verify_zip import decode_png, verify
folder=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/stamp-partial-results')
for scenario in ['true','false']:
    path=folder/f'partial-{scenario}.zip'
    verify(path,10)
    reports=json.loads((folder/f'revised-{scenario}.json').read_text())
    with zipfile.ZipFile(path) as archive:
        for r in reports:
            assert r['caption']==r['paintedText']
            assert r['glyphPixels']>100 and r['glyphMismatch']==0
            _,_,rgba=decode_png(archive.read(f'{r["slot"]:02}.png'))
            assert hashlib.sha256(rgba).hexdigest()==r['hash']==r['gallery']==r['audit']
        assert decode_png((folder/f'09-{scenario}.png').read_bytes())==decode_png(archive.read('09.png'))
print('PASS: both 10/40 scenarios: all ten Japanese captions match painted PNGs, gallery and audit; single PNG matches ZIP; dimensions/alpha/margins/size/CRCs pass')
