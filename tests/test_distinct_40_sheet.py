"""Regression tests for real 40-artwork preflight: unique vs repeated cells."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw

CHECK = Path(__file__).with_name("check_distinct_40_sheet.py")

class DistinctSheetTests(unittest.TestCase):
    def make_sheet(self, path, repeated):
        sheet = Image.new("RGB", (1000, 1600), "white")
        draw = ImageDraw.Draw(sheet)
        for index in range(40):
            # Unique, spatially varied patterns; repeated fixture cycles 10 poses.
            value = index % 10 if repeated else index
            x = (index % 5) * 200
            y = (index // 5) * 200
            draw.rectangle((x+20, y+20, x+180, y+180),
                           fill=(value*37 % 230, value*61 % 230, value*89 % 230))
            draw.ellipse((x+40+value%10, y+50, x+75+value%10, y+90), fill="black")
        sheet.save(path)

    def test_distinct_40_passes(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/"distinct.png"
            self.make_sheet(p, repeated=False)
            r = subprocess.run([sys.executable, str(CHECK), str(p)],capture_output=True,text=True)
            self.assertEqual(r.returncode,0,r.stdout+r.stderr)
            self.assertIn("PASS",r.stdout)

    def test_repeated_10_fails(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/"repeated.png"
            self.make_sheet(p, repeated=True)
            r = subprocess.run([sys.executable, str(CHECK), str(p)],capture_output=True,text=True)
            self.assertNotEqual(r.returncode,0,r.stdout+r.stderr)
            self.assertIn("near-duplicate",r.stdout+r.stderr)

if __name__ == "__main__":
    unittest.main()
