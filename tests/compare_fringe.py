from PIL import Image,ImageDraw
from pathlib import Path
import json,zipfile,sys
p=Path(sys.argv[1] if len(sys.argv)>1 else 'work/fringe'); stats=json.loads((p/'evidence.json').read_text())
for bg in ['white','black','checker']:
 out=Image.new('RGB',(1000,1200),'#555');d=ImageDraw.Draw(out)
 for n in range(1,11):
  x=((n-1)%2)*500;y=((n-1)//2)*240
  for j,state in enumerate(['before','after']):
   im=Image.open(p/f'{state}-{n:02}.png').convert('RGBA');im.thumbnail((240,210))
   tile=Image.new('RGBA',(250,214),bg if bg!='checker' else '#ddd')
   if bg=='checker':
    td=ImageDraw.Draw(tile)
    for yy in range(0,214,12):
     for xx in range(0,250,12):
      if (xx//12+yy//12)%2:td.rectangle((xx,yy,xx+11,yy+11),fill='#999')
   tile.alpha_composite(im,((250-im.width)//2,(214-im.height)//2));out.paste(tile.convert('RGB'),(x+j*250,y+24));d.text((x+j*250+4,y+5),f'{n:02} {state}',fill='white')
 out.save(p/f'comparison-{bg}.png')
# Full-resolution enlarged focus, same fit for both versions.
for n in [3,9]:
 ims=[Image.open(p/f'{s}-{n:02}.png').convert('RGBA') for s in ['before','after']]
 out=Image.new('RGB',(ims[0].width*4,ims[0].height*2+24),'black');d=ImageDraw.Draw(out)
 for j,im in enumerate(ims):out.paste(im.resize((im.width*2,im.height*2)),(j*im.width*2,24),im.resize((im.width*2,im.height*2)));d.text((j*im.width*2+4,5),['before','after'][j],fill='white')
 out.save(p/f'focus-{n:02}.png')
with zipfile.ZipFile(p/'app-10.zip') as z:
 assert z.testzip() is None
 for n in range(1,11):assert z.read(f'{n:02}.png')==(p/'final'/f'{n:02}.png').read_bytes()
print([(t['n'],t['unmatted'],t['whiteChanged'],t['darkChanged'],t['alphaRemoved']) for t in stats['after']['tiles']])
