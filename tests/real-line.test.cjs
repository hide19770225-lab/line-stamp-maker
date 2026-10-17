"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  R = require("../residue.js");
const fixtures = require("./fixtures/real-line-strips.json");
for (const f of fixtures)
  test(`real uploaded ${f.file}: exact translucent line, approval-only removal, compact decoration protection`, () => {
    const image = {
        width: 370,
        height: 320,
        data: new Uint8ClampedArray(370 * 320 * 4),
      },
      mask = new Uint8ClampedArray(370 * 320);
    function fill(x, y, w, h, rgba) {
      for (let py = y; py < y + h; py++)
        for (let px = x; px < x + w; px++) {
          const i = py * 370 + px;
          image.data.set(rgba, i * 4);
          mask[i] = rgba[3];
        }
    }
    fill(50, 100, 250, 190, [170, 210, 120, 255]);
    fill(80, 50, 8, 25, [80, 130, 40, 255]);
    fill(310, 130, 23, 21, [255, 145, 145, 255]); // detached compact heart proxy
    for (let i = 0; i < f.width; i++)
      fill(f.x + i, f.y, 1, 1, f.pixels.slice(i * 4, i * 4 + 4));
    const before = mask.slice(),
      scan = R.analyse(image, mask, undefined, true),
      line = scan.candidates.find((c) => c.x === f.x && c.y === f.y);
    assert(line);
    assert.equal(line.width, f.width);
    assert.equal(line.height, 1);
    assert.equal(line.alphaMin, f.rgbaRange[3][0]);
    assert.equal(line.alphaMax, f.rgbaRange[3][1]);
    assert.equal(line.protected, false);
    const heart = scan.candidates.find((c) => c.x === 310);
    assert(heart.protected);
    assert.throws(() => R.removeSelected(mask, scan, [heart.id]));
    assert.deepEqual(mask, before);
    const after = R.removeSelected(mask, scan, [line.id]);
    assert.equal(after.removed, f.width);
    for (let i = 0; i < mask.length; i++)
      assert.equal(after.mask[i], scan.labels[i] === line.id ? 0 : before[i]);
  });
