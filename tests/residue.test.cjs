"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../residue.js"),
  C = require("../core.js");
function image(w = 120, h = 120) {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}
function fill(im, x, y, w, h, color = [255, 255, 255, 255]) {
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++)
      im.data.set(color, (py * im.width + px) * 4);
}
function alpha(im) {
  return Uint8ClampedArray.from(
    { length: im.width * im.height },
    (_, i) => im.data[i * 4 + 3],
  );
}
function fixture() {
  const im = image();
  fill(im, 30, 30, 50, 65);
  fill(im, 15, 2, 49, 1);
  fill(im, 95, 50, 2, 6, [50, 150, 80, 255]);
  fill(im, 95, 70, 3, 4);
  return im;
}
test("analysis never removes white characters, isolated white ornaments or green leaves", () => {
  const im = fixture(),
    mask = alpha(im),
    before = mask.slice(),
    scan = R.analyse(im, mask, undefined, true);
  assert.deepEqual(mask, before);
  assert.equal(scan.components.length, 4);
  assert(scan.candidates.some((c) => c.width === 49 && c.height === 1));
  assert(!scan.candidates.some((c) => c.id === scan.mainId));
  assert.equal(mask[50 * 120 + 95], 255);
  assert.equal(mask[70 * 120 + 95], 255);
});
test("only explicitly selected component pixels are removed; all other mask bytes stay identical", () => {
  const im = fixture(),
    mask = alpha(im),
    scan = R.analyse(im, mask, undefined, true),
    line = scan.candidates.find((c) => c.width === 49);
  const result = R.removeSelected(mask, scan, [line.id]);
  assert.equal(result.removed, 49);
  assert.equal(mask[2 * 120 + 15], 255);
  for (let i = 0; i < mask.length; i++)
    assert.equal(result.mask[i], scan.labels[i] === line.id ? 0 : mask[i]);
  assert.equal(result.mask[60 * 120 + 40], 255);
  assert.equal(result.mask[50 * 120 + 95], 255);
  assert.equal(result.mask[70 * 120 + 95], 255);
  assert.throws(() => R.removeSelected(mask, scan, [scan.mainId]));
});
test("eight-connected contours, diagonal hands and ornaments are a single protected component", () => {
  const im = image(40, 40);
  fill(im, 10, 10, 15, 15);
  for (let i = 0; i < 8; i++) fill(im, 25 + i, 25 + i, 1, 1);
  const scan = R.analyse(im, alpha(im), undefined, true);
  assert.equal(scan.components.length, 1);
  assert.equal(scan.candidates.length, 0);
});
test("isolated eyes inside the main outline are not outside-residue candidates", () => {
  const im = image();
  fill(im, 25, 25, 60, 1);
  fill(im, 25, 85, 60, 1);
  fill(im, 25, 25, 1, 60);
  fill(im, 85, 25, 1, 61);
  fill(im, 50, 50, 2, 2);
  const scan = R.analyse(im, alpha(im));
  assert.equal(scan.candidates.length, 0);
});
test("alpha-1 specks are detected but remain untouched until selected", () => {
  const im = fixture();
  fill(im, 100, 5, 1, 1, [255, 255, 255, 1]);
  const mask = alpha(im),
    scan = R.analyse(im, mask, undefined, true);
  const dot = scan.candidates.find((c) => c.x === 100 && c.y === 5);
  assert(dot);
  assert.equal(mask[5 * 120 + 100], 1);
  const result = R.removeSelected(mask, scan, [dot.id]);
  assert.equal(result.mask[5 * 120 + 100], 0);
});
test("stale scans are rejected atomically and crop-excluded pixels are not offered for deletion", () => {
  const im = fixture(),
    mask = alpha(im),
    scan = R.analyse(im, mask, undefined, true),
    ids = scan.candidates.map((c) => c.id);
  mask[0] = 1;
  const before = mask.slice();
  assert.throws(() => R.removeSelected(mask, scan, ids));
  assert.deepEqual(mask, before);
  const cropped = R.analyse(im, alpha(im), {
    x: 0,
    y: 10,
    width: 120,
    height: 110,
  });
  assert(!cropped.candidates.some((c) => c.y === 2));
});
test("automatic background processing preserves existing transparent images and all their white details", () => {
  const im = fixture(),
    expected = alpha(im);
  assert.deepEqual(C.floodMask(im, "auto", 24), expected);
  const white = image(30, 30);
  fill(white, 5, 5, 20, 20);
  fill(white, 1, 1, 2, 2);
  assert.deepEqual(C.floodMask(white, "auto", 24), alpha(white));
});
test("empty images and explicit background modes keep their documented behavior", () => {
  const im = image();
  assert.equal(R.analyse(im, alpha(im)).candidates.length, 0);
  fill(im, 0, 0, 120, 120);
  assert(C.floodMask(im, "auto", 24).every((a) => a === 0));
  assert.deepEqual(C.floodMask(im, "none", 24), alpha(im));
});
