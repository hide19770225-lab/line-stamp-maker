"""Independently decode ZIP produced immediately after import, with no manual deletion."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode=True
from verify_zip import decode_png,verify
folder=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/stamp-automatic-results')
verify(folder/'automatic-no-touch-10.zip',10)
evidence=json.loads((folder/'automatic-evidence.json').read_text())
with zipfile.ZipFile(folder/'automatic-no-touch-10.zip') as archive:
    for item in evidence:
        w,h,pixels=decode_png(archive.read(f"{item['n']:02}.png"))
        assert hashlib.sha256(pixels).hexdigest()==item['hash']
        if item['n'] not in [9,10]:assert item['changed']==[];continue
        n=item['n'];x,length=(155,49) if n==9 else (175,18)
        _,_,before=decode_png((folder/f'auto-before-{n}.png').read_bytes())
        assert decode_png((folder/f'auto-after-{n}.png').read_bytes())[2]==pixels
        for i in range(w*h):
            if 25*w+x<=i<25*w+x+length:assert before[i*4+3]>0 and pixels[i*4:i*4+4]==bytes(4)
            else:assert before[i*4:i*4+4]==pixels[i*4:i*4+4],(n,i)
        if n==9:assert decode_png((folder/'automatic-single-09.png').read_bytes())[2]==pixels
print('PASS: no-touch export ZIP / gallery / single PNG equal; only latest 49/18 line pixels change; all other character, leaf, belly, shadow and decoration pixels preserved')
