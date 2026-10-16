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
