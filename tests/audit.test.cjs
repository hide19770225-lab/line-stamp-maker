"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const A = require("../audit.js");
function image() {
  const im = {
    width: 370,
    height: 320,
    data: new Uint8ClampedArray(370 * 320 * 4),
  };
  for (let y = 80; y < 220; y++)
    for (let x = 90; x < 250; x++)
      im.data.set([255, 255, 255, 255], (y * 370 + x) * 4);
  im.data.set([200, 200, 200, 70], (250 * 370 + 180) * 4);
  return im;
}
test("bulk audit reads RGBA, preserves white body and partial shadow byte for byte; inspection never reviews", () => {
  const im = image(),
    before = im.data.slice(),
    r = A.inspect(im, 2000, 370, 320);
  assert.equal(r.status, "正常");
  assert.equal(r.partial, 1);
  assert(r.transparent > 0);
  assert.deepEqual(im.data, before);
  assert.equal(r.reviewed, undefined);
});
test("empty, opaque, wrong size, oversized PNG and alpha-1 outer margin fail", () => {
  let im = image();
  im.data.fill(0);
  assert.equal(A.inspect(im, 100, 370, 320).status, "エラー");
  im = image();
  for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255;
  assert(
    A.inspect(im, 100, 370, 320).errors.some((s) => s.includes("透明ピクセル")),
  );
  im = image();
  im.data[3] = 1;
  assert(A.inspect(im, 100, 370, 320).errors.some((s) => s.includes("余白")));
  assert.equal(A.inspect(image(), 1048577, 370, 320).status, "エラー");
  assert.equal(A.inspect(image(), 100, 240, 240).status, "エラー");
});
test("residue and overlap are review candidates, stale source and clipping are errors", () => {
  assert.equal(
    A.inspect(image(), 100, 370, 320, { residues: 1 }).status,
    "要確認",
  );
  assert.equal(
    A.inspect(image(), 100, 370, 320, { textOverlap: true }).status,
    "要確認",
  );
  for (const key of ["stale", "textClipped", "unsafe"])
    assert.equal(
      A.inspect(image(), 100, 370, 320, { [key]: true }).status,
      "エラー",
    );
});
