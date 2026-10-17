"""Real latest ZIP regression and deliverable: no coordinate is supplied to the detector.
Only its chosen rectangles are cleared. Expected locations are independent assertions.
"""
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
input_zip, output = Path(sys.argv[1]), Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
fixtures = {f['file']: f for f in json.loads((root / 'tests/fixtures/auto-line-strips.json').read_text())}

def chunk(kind, data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)

def png(w,h,data):
    rows=b''.join(b'\0'+bytes(data[y*w*4:(y+1)*w*4]) for y in range(h))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b'')
report=[]
with zipfile.ZipFile(input_zip) as archive:
    assert archive.namelist()==[f'{i:02}.png' for i in range(1,11)]+['main.png','tab.png']
    for name in archive.namelist():
        raw=archive.read(name)
        if name in fixtures:
            assert hashlib.sha256(raw).hexdigest()==fixtures[name]['sha256'], 'latest fixture checksum mismatch'
        w,h,before=decode_png(raw)
        code="const fs=require('node:fs'),R=require('./residue.js'),im=JSON.parse(fs.readFileSync(0,'utf8'));im.data=new Uint8ClampedArray(im.data);console.log(JSON.stringify(R.automaticLines(im)));"
        lines=json.loads(subprocess.run(['node','-e',code],cwd=root,input=json.dumps({'width':w,'height':h,'data':list(before)}),capture_output=True,text=True,check=True).stdout)
        f=fixtures.get(name)
        expected=[(f['x'],f['y'],f['width'],1)] if f else []
        assert [(c['x'],c['y'],c['width'],c['height']) for c in lines]==expected,(name,lines)
        changed=set()
        after=bytearray(before)
        for line in lines:
            for x in range(line['x'],line['x']+line['width']):
                i=line['y']*w+x;changed.add(i);after[i*4:i*4+4]=bytes(4)
        for i in range(w*h):
            if i in changed:
                assert after[i*4+3]==0 and before[i*4+3]>0
            else:
                assert before[i*4:i*4+4]==after[i*4:i*4+4],(name,i)
        encoded=png(w,h,after) if changed else raw
        assert decode_png(encoded)[2]==after
        (output/name).write_bytes(encoded)
        report.append({'file':name,'automaticallyRemovedPixels':len(changed),'rectangles':expected,'everyOtherRGBAPixelIdentical':True,'fileBytesUnchanged':encoded==raw})
with zipfile.ZipFile(output/'line-stamps-test-10-auto-cleaned.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for item in report:archive.write(output/item['file'],item['file'])
with zipfile.ZipFile(output/'line-stamps-test-10-auto-cleaned.zip') as archive:
    assert archive.testzip() is None
    for item in report:assert archive.read(item['file'])==(output/item['file']).read_bytes()
(output/'automatic-zip-report.json').write_text(json.dumps(report,indent=2))
print('PASS: real latest ZIP automatically cleans 09=49px and 10=18px; all other RGBA unchanged; 01–08/main/tab byte-identical; all ZIP files re-decoded and CRC verified')
