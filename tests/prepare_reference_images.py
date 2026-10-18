"""Prepare local real-image browser fixtures; source images are never committed.
Usage: python3 tests/prepare_reference_images.py input.zip /tmp/stamp-reference-input
Requires Pillow for resize/compositing. Input ZIP must contain the ten supplied 01..10 PNGs.
"""
import sys, zipfile
from io import BytesIO
from pathlib import Path
from PIL import Image
out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(sys.argv[1]) as archive:
    images=[Image.open(BytesIO(archive.read(f'{i:02}.png'))).convert('RGBA') for i in range(1,11)]
for n in range(4):
    sheet=Image.new('RGB',(800,1600),'white')
    for i,image in enumerate(images):
        image=image.resize((333,288))
        sheet.paste(image,(i%2*400+30,i//2*320+16),image)
    sheet.putpixel((0,0),(255-n,255,255))
    sheet.save(out/f'sheet-{n}.png')
