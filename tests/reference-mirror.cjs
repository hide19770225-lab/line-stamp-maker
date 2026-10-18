/* Real supplied-image regression. Input: STAMP_REFERENCE_INPUT/01.png..10.png.
 * Source PNGs stay outside the repository. Uses the existing independent PNG decoder.
 */
const { execFileSync } = require("node:child_process"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  V = require("../caption-vision.js");
const dir = process.env.STAMP_REFERENCE_INPUT || "/tmp/stamp-reference-input";
const rows = JSON.parse(
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
 w,h,data=decode_png((Path(sys.argv[1])/('%02d.png'%i)).read_bytes())
 rows.append({'width':w,'height':h,'data':list(data)})
print(json.dumps(rows))
`,
      dir,
      __dirname,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  ),
);
const expected = [
  "wave",
  "bow",
  "approve",
  "worried",
  "joy",
  "cry",
  "surprised",
  "angry",
  "sleepy",
  "love",
];
for (let k = 0; k < rows.length; k++) {
  const im = rows[k],
    data = new Uint8ClampedArray(im.data.length),
    mask = new Uint8Array(im.width * im.height);
  for (let y = 0; y < im.height; y++)
    for (let x = 0; x < im.width; x++) {
      const a = y * im.width + x,
        b = y * im.width + im.width - 1 - x;
      data.set(im.data.slice(b * 4, b * 4 + 4), a * 4);
      mask[a] = im.data[b * 4 + 3];
    }
  const before = data.slice(),
    alphaBefore = mask.slice();
  const result = V.match({ ...im, data }, mask);
  assert.deepEqual(data, before);
  assert.deepEqual(mask, alphaBefore);
  assert.equal(result.emotion, expected[k], `${k + 1} mirrored classification`);
  assert.equal(result.mirrored, true);
}
console.log(
  "PASS: all ten supplied poses mirrored pixel-by-pixel retain their reference labels; no file/slot label inputs",
);
