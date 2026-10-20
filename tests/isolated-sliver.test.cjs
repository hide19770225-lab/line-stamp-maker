"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const R = require("../residue.js");
function scene(w = 370, h = 320) {
  const image = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const fill = (x, y, width, height, rgba = [230, 100, 155, 255]) => {
    for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++)
      image.data.set(rgba, (yy * w + xx) * 4);
  };
  const scan = () => R.analyse(image, Uint8ClampedArray.from(
    { length: w * h }, (_, i) => image.data[i * 4 + 3]), undefined, true);
  return { image, fill, scan };
}
test("coloured isolated slivers in any direction request review, never automatic deletion", () => {
  for (const [x, y, w, h] of [[20, 80, 2, 10], [345, 80, 2, 10], [150, 20, 10, 2], [150, 300, 10, 2]]) {
    const { image, fill, scan } = scene();
    fill(90, 90, 190, 170); fill(x, y, w, h);
    const before = image.data.slice(), result = scan(), c = result.candidates.find(c => c.x === x);
    assert(c.isolatedSliver); assert.equal(c.decision, "review"); assert(!c.protected);
    assert.deepEqual(image.data, before);
    assert.equal(R.automaticLines(image).length, 0);
    const removed = R.removeSelected(result.maskSnapshot, result, [c.id]);
    assert.equal(removed.removed, w * h);
    for (let i = 0; i < removed.mask.length; i++)
      assert.equal(removed.mask[i], result.labels[i] === c.id ? 0 : result.maskSnapshot[i]);
  }
});
test("a nearby glyph, a pair of motion strokes, and explicit text coverage protect thin details", () => {
  const { image, fill, scan } = scene();
  fill(100, 140, 170, 140);
  fill(70, 50, 22, 25); // separate text, far from the largest character
  fill(65, 53, 2, 10); // glyph/diacritic detail
  fill(25, 100, 2, 10); fill(30, 100, 2, 10); // motion pair
  fill(340, 60, 2, 10); // explicitly protected rendered text
  const result = scan();
  assert(result.candidates.find(c => c.x === 65).protected);
  assert(result.candidates.filter(c => c.x === 25 || c.x === 30).every(c => c.protected));
  const coverage = new Uint8Array(370 * 320); coverage[60 * 370 + 340] = 1;
  assert(!R.inspectFinal(image, coverage).candidates.some(c => c.x === 340));
});
test("compact hearts/stars and a nearby antenna glow are retained; tiny pixels alone prove nothing", () => {
  const { fill, scan } = scene();
  fill(90, 100, 190, 180); fill(40, 50, 8, 8); fill(140, 90, 2, 8);
  fill(20, 20, 1, 1, [255, 255, 255, 1]);
  const result = scan();
  assert(result.candidates.find(c => c.x === 40).protected);
  assert(result.candidates.find(c => c.x === 20).decision === "review");
  assert(!result.candidates.some(c => c.decision === "delete"));
});
