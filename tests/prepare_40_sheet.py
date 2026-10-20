"""Make a 5x8 regression sheet from real 2x5 artwork (10 poses repeated four times).
This is a constructed fixture, not the user's original 40-pose reproduction image.
Usage: python tests/prepare_40_sheet.py source-2x5.png output-5x8.png
"""
import sys
from PIL import Image
image = Image.open(sys.argv[1]).convert('RGB')
output = Image.new('RGB', (1200, 1920), 'white')
for index in range(40):
    pose = index % 10
    col, row = pose % 2, pose // 2
    tile = image.crop((round(col * image.width / 2), round(row * image.height / 5),
                       round((col + 1) * image.width / 2), round((row + 1) * image.height / 5)))
    tile.thumbnail((210, 210))
    output.paste(tile, ((index % 5) * 240 + (240 - tile.width) // 2,
                        (index // 5) * 240 + (240 - tile.height) // 2))
output.save(sys.argv[2])
