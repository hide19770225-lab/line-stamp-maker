"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");
function fixture(width, height, color = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color, i * 4);
  return { data, width, height };
}
function pixel(image, x, y, color) {
  image.data.set(color, (y * image.width + x) * 4);
}
test("edge flood preserves white enclosed by a dark outline", () => {
  const img = fixture(9, 9);
  for (let i = 2; i <= 6; i++) {
    pixel(img, i, 2, [20, 20, 20, 255]);
    pixel(img, i, 6, [20, 20, 20, 255]);
    pixel(img, 2, i, [20, 20, 20, 255]);
    pixel(img, 6, i, [20, 20, 20, 255]);
  }
  const mask = C.floodMask(img, "white", 24);
  assert.equal(mask[0], 0);
  assert.equal(mask[4 * 9 + 4], 255);
  assert.equal(mask[2 * 9 + 2], 255);
});
test("transparent input and no-removal mode preserve original alpha", () => {
  const img = fixture(3, 3, [10, 50, 20, 120]);
  pixel(img, 0, 0, [0, 0, 0, 0]);
  const mask = C.floodMask(img, "none");
  assert.equal(mask[0], 0);
  assert.equal(mask[4], 120);
});
test("custom background and tolerance work without erasing dissimilar foreground", () => {
  const img = fixture(5, 5, [0, 240, 10, 255]);
  pixel(img, 2, 2, [250, 250, 250, 255]);
  const mask = C.floodMask(img, "custom", 20, "#00ff00");
  assert.equal(mask[0], 0);
  assert.equal(mask[12], 255);
  assert.equal(C.floodMask(img, "custom", 0, "#00ff00")[0], 255);
});
test("alpha bounds detect empty images and partial alpha", () => {
  const img = fixture(5, 4, [0, 0, 0, 0]);
  assert.equal(C.alphaBounds(img.data, 5, 4), null);
  pixel(img, 2, 1, [255, 0, 0, 2]);
  pixel(img, 3, 2, [0, 0, 0, 255]);
  assert.deepEqual(C.alphaBounds(img.data, 5, 4), {
    x: 2,
    y: 1,
    width: 2,
    height: 2,
  });
});
test("ZIP uses correct local headers, CRC32, central directory and end record", async () => {
  const bytes = new TextEncoder().encode("123456789");
  assert.equal(C.crc32(bytes), 0xcbf43926);
  const zip = await C.makeZip([
    { name: "01.png", blob: new Blob([bytes]) },
    { name: "main.png", blob: new Blob(["abc"]) },
  ]);
  const buffer = await zip.arrayBuffer(),
    v = new DataView(buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(14, true), 0xcbf43926);
  assert.equal(v.getUint16(8, true), 0);
  const end = buffer.byteLength - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), 2);
  assert.equal(v.getUint32(v.getUint32(end + 16, true), true), 0x02014b50);
});

test("per-side insets exclude neighboring grid strokes without overlapping cells", () => {
  const source = {
    image: { width: 800, height: 1600 },
    xs: [0, 0.5, 1],
    ys: [0, 0.2, 0.4, 0.6, 0.8, 1],
    insets: { left: 2, right: 3, top: 4, bottom: 5 },
  };
  assert.deepEqual(C.tileRect(source, 0, 0), {
    x: 8,
    y: 13,
    width: 380,
    height: 291,
  });
  const next = C.tileRect(source, 1, 0);
  assert.equal(next.x, 408);
  assert(C.tileRect(source, 0, 0).x + 380 < next.x);
});
test("image placement fills available space, preserves aspect and keeps all positions inside 10px margins", () => {
  const original = fixture(100, 100),
    mask = new Uint8ClampedArray(10000);
  for (let y = 30; y < 70; y++)
    for (let x = 10; x < 90; x++) mask[y * 100 + x] = 255;
  const stamp = { original, mask, layout: { scale: 100, x: 50, y: 50 } };
  const full = C.imagePlacement(stamp);
  assert.equal(full.ratio, 350 / 80);
  assert.equal(full.bounds.width / full.bounds.height, 2);
  for (const scale of [20, 70, 100])
    for (const x of [0, 50, 100])
      for (const y of [0, 50, 100]) {
        stamp.layout = { scale, x, y };
        const p = C.imagePlacement(stamp),
          b = p.bounds;
        assert(b.x * p.ratio + p.offsetX >= 10 - 1e-8);
        assert(b.y * p.ratio + p.offsetY >= 10 - 1e-8);
        assert((b.x + b.width) * p.ratio + p.offsetX <= 360 + 1e-8);
        assert((b.y + b.height) * p.ratio + p.offsetY <= 310 + 1e-8);
      }
});
test("individual crop hides a stray line without destroying the source mask", () => {
  const original = fixture(100, 100),
    mask = new Uint8ClampedArray(10000);
  mask[10 * 100 + 1] = 255;
  mask[50 * 100 + 50] = 255;
  const stamp = {
    original,
    mask,
    crop: { left: 5, right: 0, top: 0, bottom: 0 },
  };
  assert.deepEqual(C.imagePlacement(stamp).bounds, {
    x: 50,
    y: 50,
    width: 1,
    height: 1,
  });
  stamp.crop.left = 0;
  assert.equal(C.imagePlacement(stamp).bounds.x, 1);
  assert.equal(mask[1001], 255);
});
test("eraser and restore map correctly through a scaled, translated layer", () => {
  const original = fixture(20, 20),
    mask = new Uint8ClampedArray(400);
  for (let y = 5; y < 15; y++)
    for (let x = 5; x < 15; x++) mask[y * 20 + x] = 255;
  const stamp = { original, mask, layout: { scale: 50, x: 0, y: 100 } };
  stamp.activePlacement = C.imagePlacement(stamp);
  const p = stamp.activePlacement,
    x = 10 * p.ratio + p.offsetX,
    y = 10 * p.ratio + p.offsetY;
  C.applyBrush(stamp, x, y, 10, "erase");
  assert.equal(mask[10 * 20 + 10], 0);
  assert.equal(mask[5 * 20 + 5], 255);
  assert.equal(original.data[(10 * 20 + 10) * 4 + 3], 255);
  C.applyBrush(stamp, x, y, 10, "restore");
  assert.equal(mask[10 * 20 + 10], 255);
});
