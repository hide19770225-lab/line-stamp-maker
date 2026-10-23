"""Independently decode app exports and compare their RGBA to gallery PNGs."""
from pathlib import Path
from PIL import Image
import zipfile, io, hashlib, json, sys
folder = Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/stamp-actual40')
archive = folder/'line-stamps-fixed-40.zip'
results=[]
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert set(z.namelist()) == {f'{i:02}.png' for i in range(1,41)} | {'main.png','tab.png'}
    for name in z.namelist():
        raw=z.read(name)
        im=Image.open(io.BytesIO(raw)); im.load()
        expected=(240,240) if name=='main.png' else (96,74) if name=='tab.png' else (370,320)
        assert im.size==expected and im.mode=='RGBA', name
        alpha=im.getchannel('A')
        assert alpha.getextrema()==(0,255),name
        bbox=alpha.getbbox();assert bbox and min(bbox[0],bbox[1],im.width-bbox[2],im.height-bbox[3])>=10,name
        assert len(raw)<1024*1024,name
        if name not in ('main.png','tab.png'):
            preview=Image.open(folder/name).convert('RGBA')
            assert im.tobytes()==preview.tobytes(),name
        results.append({'name':name,'size':list(im.size),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
report={'zipSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'decoded':len(results),'previewEquality':40,'files':results}
(folder/'zip-validation.json').write_text(json.dumps(report,indent=2))
print('PASS 42 real PNGs: CRC, dimensions, RGBA, transparency, margins, size; 40 gallery/export pixel equality')
