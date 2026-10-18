/* Usage: node scripts/build-caption-references.cjs /path/to/reviewed-cleaned-pngs
 * Input 01..10 MUST be the reviewed user-supplied poses described below.
 * Never relabel unrelated images by filename. No source PNGs are added to git.
 */
const fs = require("node:fs"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const V = require("../caption-vision.js");
const dir = process.argv[2];
if (!dir) throw new Error("Specify reviewed PNG directory (01.png..10.png)");
const pixels = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      `
import sys,json
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,sys.argv[2])
from verify_zip import decode_png
rows=[]
for i in range(1,11):
 w,h,rgba=decode_png((Path(sys.argv[1])/('%02d.png'%i)).read_bytes())
 rows.append({'width':w,'height':h,'data':list(rgba)})
print(json.dumps(rows))
`,
      dir,
      path.resolve(__dirname, "../tests"),
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  ),
);
const labels = [
  ["wave", "手を振る"],
  ["bow", "お辞儀"],
  ["approve", "親指を立てる"],
  ["worried", "困る"],
  ["joy", "喜ぶ"],
  ["cry", "泣く"],
  ["surprised", "驚く"],
  ["angry", "怒る"],
  ["sleepy", "眠る"],
  ["love", "ハートを抱える"],
];
const refs = pixels.map((image, i) => ({
  id: `provided-character-${i + 1}`,
  emotion: labels[i][0],
  label: labels[i][1],
  features: V.descriptor(
    image,
    Uint8Array.from(image.data.filter((_, i) => i % 4 === 3)),
  )
    .map((v) => v.toString(16))
    .join(""),
}));
fs.writeFileSync(
  path.resolve(__dirname, "../caption-references.js"),
  `/* Derived 32x32 pixel descriptors from the user's ten supplied stamps.\nManual visual labels, not a pretrained expression model. No full-resolution images. */\n(function(root){const references=${JSON.stringify(refs)};root.StampCaptionReferences=references;if(typeof module!=='undefined'&&module.exports)module.exports=references;})(typeof window!=='undefined'?window:globalThis);\n`,
);
console.log("Wrote ten reviewed pose descriptors");
