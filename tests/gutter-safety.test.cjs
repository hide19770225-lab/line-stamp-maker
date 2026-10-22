'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

// The canvas adapter supplies exact RGBA pixels; no drawing/interpolation is
// exercised here. Browser export coverage remains in grid-40-browser.cjs.
function withPixels(image, run) {
  const previous = global.document;
  global.document = { createElement() {
    return { getContext() { return {
      drawImage() {}, getImageData() { return image; },
    }; } };
  } };
  try { return run(); } finally { global.document = previous; }
}
function sheet(width = 100, transparent = false) {
  const height = 300, data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++)
    data.set(transparent ? [41, 92, 133, 0] : [255, 255, 255, 255], p * 4);
  const image = { width, height, data };
  image.box = (x0, y0, x1, y1, color) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++)
      data.set(color, (y * width + x) * 4);
  };
  image.box(10, 60, width - 10, 145, [120, 60, 30, 255]);
  image.box(10, 155, width - 10, 240, [120, 60, 30, 255]);
  return image;
}
test('opaque and transparent sheets find the same actual blank corridor', () => {
  for (const transparent of [false, true]) {
    const image = sheet(100, transparent);
    // Different invisible corner RGB must not veto transparent input.
    if (transparent) image.data.set([255, 0, 255, 0], 0);
    withPixels(image, () => {
      assert.deepEqual(C.suggestColumnRowLines(image, [0, 1], 2), [[0, 0.5, 1]]);
      assert.deepEqual(C.suggestGridLines(image, 1, 2), { xs: [0, 1], ys: [0, 0.5, 1] });
    });
  }
});
test('a pale antenna crossing the proposed gutter is not blank background', () => {
  const image = sheet();
  image.box(25, 135, 26, 165, [210, 210, 210, 255]);
  const before = image.data.slice();
  withPixels(image, () => assert.equal(C.suggestColumnRowLines(image, [0, 1], 2), null));
  assert.deepEqual(image.data, before);
});
test('white and partially transparent artwork on a transparent sheet blocks a cut', () => {
  for (const alpha of [1, 255]) {
    const image = sheet(100, true);
    image.box(25, 135, 26, 165, [255, 255, 255, alpha]);
    withPixels(image, () => assert.equal(C.suggestColumnRowLines(image, [0, 1], 2), null));
  }
});
test('large sheets cannot hide a one-pixel bridge between sampled columns', () => {
  const image = sheet(1200);
  image.box(25, 135, 26, 165, [10, 10, 10, 255]);
  withPixels(image, () => {
    assert.equal(C.suggestColumnRowLines(image, [0, 1], 2), null);
    assert.equal(C.suggestGridLines(image, 1, 2), null);
  });
});
test('mixed transparent and opaque corner backgrounds require manual review', () => {
  const image = sheet();
  image.data[3] = 0;
  withPixels(image, () => {
    assert.equal(C.suggestColumnRowLines(image, [0, 1], 2), null);
    assert.equal(C.suggestGridLines(image, 1, 2), null);
  });
});
