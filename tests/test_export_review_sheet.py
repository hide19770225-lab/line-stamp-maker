"""Regression tests: pixel-exact review must reject a damaged or reordered cell."""
import io
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from PIL import Image

VERIFY = Path(__file__).with_name("verify_export_review_sheet.py")
RENDER = Path(__file__).with_name("render_export_review_sheet.py")

class ReviewOverviewIntegrity(unittest.TestCase):
    def test_detects_corrupt_cell_and_swapped_cells(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            archive = folder / "export.zip"
            overview = folder / "review.png"
            with zipfile.ZipFile(archive, "w") as z:
                for i in range(40):
                    color = (i*5 % 255, i*11 % 255, i*17 % 255, 255)
                    image = Image.new("RGBA", (370,320), color)
                    buffer = io.BytesIO()
                    image.save(buffer, format="PNG")
                    z.writestr(f"{i+1:02d}.png",buffer.getvalue())
            subprocess.run([sys.executable,str(RENDER),str(archive),str(overview)],check=True,capture_output=True,text=True)
            def verify(path):
                return subprocess.run([sys.executable,str(VERIFY),str(archive),str(path)],capture_output=True,text=True)
            self.assertEqual(verify(overview).returncode,0)
            with Image.open(overview) as image:
                original = image.convert("RGB")
            corrupted = original.copy()
            corrupted.putpixel((25,30),(255,0,255))
            bad = folder / "corrupted.png"
            corrupted.save(bad)
            result = verify(bad)
            self.assertNotEqual(result.returncode,0)
            self.assertIn("01.png",result.stderr + result.stdout)
            swapped = original.copy()
            box1=(25,30,395,350)
            box2=(445,30,815,350)
            first=original.crop(box1)
            second=original.crop(box2)
            swapped.paste(second,box1[:2])
            swapped.paste(first,box2[:2])
            wrong=folder / "swapped.png"
            swapped.save(wrong)
            result=verify(wrong)
            self.assertNotEqual(result.returncode,0)
            self.assertIn("01.png",result.stderr + result.stdout)

if __name__=="__main__":
    unittest.main()
