"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  R = require("../residue.js");
const strips = require("./fixtures/auto-line-strips.json");
function image() {
  return {
    width: 370,
    height: 320,
    data: new Uint8ClampedArray(370 * 320 * 4),
  };
}
function fill(im, x, y, w, h, rgba) {
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++) im.data.set(rgba, (py * 370 + px) * 4);
}
for (const f of strips)
  test(`automatic detection of latest real ${f.file}: no approval call, exact line only`, () => {
    const im = image();
    fill(im, 55, 98, 260, 197, [140, 210, 100, 255]);
    fill(im, 120, 160, 80, 60, [255, 255, 240, 255]);
    fill(im, 35, 140, 15, 15, [255, 140, 130, 180]);
    for (let i = 0; i < f.width; i++)
      im.data.set(f.pixels.slice(i * 4, i * 4 + 4), (f.y * 370 + f.x + i) * 4);
    const original = im.data.slice(),
      lines = R.automaticLines(im);
    assert.equal(lines.length, 1);
    assert.deepEqual(
      [lines[0].x, lines[0].y, lines[0].width, lines[0].height],
      [f.x, f.y, f.width, 1],
    );
    assert.deepEqual(im.data, original, "detection must not mutate");
  });
test("opaque/colored motion strokes, near-body marks, shadows, tears and hearts are not automatic targets", () => {
  const variants = [
    { x: 155, y: 25, w: 49, h: 1, c: [225, 220, 215, 180] }, // uniform intentional pale motion stroke
    { x: 155, y: 25, w: 49, h: 1, c: [225, 220, 215, 255] },
    { x: 155, y: 25, w: 49, h: 1, c: [60, 40, 30, 180] },
    { x: 155, y: 25, w: 49, h: 1, c: [60, 160, 230, 180] },
    { x: 155, y: 94, w: 49, h: 1, c: [225, 220, 215, 180] },
    { x: 155, y: 25, w: 49, h: 2, c: [225, 220, 215, 180] },
    { x: 20, y: 25, w: 49, h: 1, c: [225, 220, 215, 180] },
    { x: 155, y: 280, w: 49, h: 1, c: [225, 220, 215, 180] },
  ];
  for (const v of variants) {
    const im = image();
    fill(im, 55, 98, 260, 170, [140, 210, 100, 255]);
    fill(im, v.x, v.y, v.w, v.h, v.c);
    assert.equal(R.automaticLines(im).length, 0, JSON.stringify(v));
  }
});
