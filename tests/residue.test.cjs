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

test("reported 49×1 at y25 and 16×1 at y10 are candidates even inside the main bounding box", () => {
  for (const [length, y] of [
    [49, 25],
    [16, 10],
  ]) {
    const im = image(370, 320);
    fill(im, 10, 100, 350, 210, [70, 124, 169, 255]);
    fill(im, 10, 10, 5, 100, [70, 124, 169, 255]);
    fill(im, 130, y, length, 1, [255, 255, 255, 1]);
    fill(im, 300, 60, 6, 8); // detached legitimate ornament must not be auto-deleted
    const mask = alpha(im),
      before = mask.slice(),
      scan = R.analyse(im, mask, undefined, true);
    const line = scan.candidates.find((c) => c.x === 130 && c.y === y);
    assert(line, `${length}×1 top line was missed`);
    assert.equal(line.width, length);
    assert.equal(line.height, 1);
    assert(line.exterior);
    assert(!line.nearMain);
    const main = scan.components.find((c) => c.id === scan.mainId);
    const oldOutsideRule =
      line.x + line.width <= main.x ||
      line.x >= main.x + main.width ||
      line.y + line.height <= main.y ||
      line.y >= main.y + main.height;
    assert.equal(
      oldOutsideRule,
      false,
      "this was excluded by the previous detector",
    );
    assert.deepEqual(mask, before, "detection alone never deletes anything");
    assert.deepEqual(
      R.analyse(im, mask).candidates,
      scan.candidates,
      "summary and detailed scan use the same rules",
    );
    const removed = R.removeSelected(mask, scan, [line.id]);
    assert.equal(removed.removed, length);
    for (let i = 0; i < mask.length; i++)
      assert.equal(removed.mask[i], scan.labels[i] === line.id ? 0 : before[i]);
  }
});

test("enclosed facial details and near-outline detached marks inside the bounding box remain protected", () => {
  const im = image(100, 100);
  // Closed frame (face), with a tall connected stalk creating exterior space within its box.
  fill(im, 10, 40, 70, 2);
  fill(im, 10, 80, 70, 2);
  fill(im, 10, 40, 2, 40);
  fill(im, 78, 40, 2, 42);
  fill(im, 10, 10, 2, 31);
  fill(im, 30, 60, 12, 1); // mouth: thin but enclosed
  fill(im, 45, 37, 8, 1); // near-outline expression: exterior, within 3px
  fill(im, 45, 20, 16, 1); // distant line: exterior inside the bounding box
  const scan = R.analyse(im, alpha(im), undefined, true);
  assert(!scan.candidates.some((c) => c.y === 60));
  assert(!scan.candidates.some((c) => c.y === 37));
  assert(scan.candidates.some((c) => c.y === 20));
});

test("a diagonal closed contour protects interior decorations from exterior flood", () => {
  const im = image(60, 60);
  for (let i = 0; i <= 20; i++) {
    fill(im, 30 + i, 10 + i, 1, 1);
    fill(im, 50 - i, 30 + i, 1, 1);
    fill(im, 30 - i, 50 - i, 1, 1);
    fill(im, 10 + i, 30 - i, 1, 1);
  }
  fill(im, 24, 30, 12, 1);
  assert.equal(R.analyse(im, alpha(im)).candidates.length, 0);
});

test("final RGBA audit excludes any component covered by rendered text/outline/shadow without changing pixels", () => {
  const im = image(370, 320);
  fill(im, 10, 100, 350, 210, [70, 124, 169, 255]);
  fill(im, 10, 10, 5, 100);
  fill(im, 130, 25, 49, 1);
  fill(im, 200, 60, 20, 1);
  const protectedAlpha = new Uint8ClampedArray(370 * 320);
  protectedAlpha[60 * 370 + 200] = 1;
  const before = im.data.slice(),
    audit = R.inspectFinal(im, protectedAlpha);
  assert(audit.candidates.some((c) => c.y === 25 && c.width === 49));
  assert(!audit.candidates.some((c) => c.y === 60));
  assert.deepEqual(im.data, before);
  assert.throws(() => R.inspectFinal(im, new Uint8Array(1)));
});
