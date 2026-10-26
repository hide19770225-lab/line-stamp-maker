// Run with: node tests/framed-grid.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
global.document = {
  createElement(tag) {
    assert.equal(tag, "canvas");
    return {
      width: 0, height: 0,
      getContext() {
        const target = this;
        return {
          drawImage(image) { target.image = image; },
          getImageData() { return {data: target.image.data, width: target.width, height: target.height}; },
        };
      },
    };
  },
};
const C = require(path.join(__dirname, "..", "core.js"));
const width = 1000, height = 1600;
function sheet(framed) {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  if (framed) {
    const drawVertical = x => {
      for (let y = 0; y < height; y++)
        for (let dx = 0; dx < 2; dx++) {
          const p = (y * width + x + dx) * 4;
          data[p] = data[p + 1] = data[p + 2] = 0;
        }
    };
    const drawHorizontal = y => {
      for (let x = 0; x < width; x++)
        for (let dy = 0; dy < 2; dy++) {
          const p = ((y + dy) * width + x) * 4;
          data[p] = data[p + 1] = data[p + 2] = 0;
        }
    };
    for (let col = 0; col <= 5; col++) drawVertical(Math.min(width - 2, col * 199));
    for (let row = 0; row <= 8; row++) drawHorizontal(Math.min(height - 2, row * 199));
  }
  return {width, height, data};
}
const image = sheet(true);
const grid = C.detectFramedGrid(image, 5, 8);
assert.ok(grid, "framed sheet must be detected");
assert.equal(grid.xs.length, 6);
assert.equal(grid.ys.length, 9);
const source = {
  image, framedGrid: grid, columns: 5, rows: 8,
  xs: Array.from({length: 6}, (_, i) => i / 5),
  ys: Array.from({length: 9}, (_, i) => i / 8),
  insets: {left: 0, right: 0, top: 0, bottom: 0},
};
const cells = [];
for (let row = 0; row < 8; row++)
  for (let col = 0; col < 5; col++) {
    const rect = C.tileRect(source, col, row);
    assert.ok(rect.width > 0 && rect.height > 0);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= width);
    assert.ok(rect.y + rect.height <= height);
    assert.ok(rect.x > grid.xs[col].end);
    assert.ok(rect.y > grid.ys[row].end);
    assert.ok(rect.x + rect.width < grid.xs[col + 1].start);
    assert.ok(rect.y + rect.height < grid.ys[row + 1].start);
    cells.push(rect);
  }
assert.equal(cells.length, 40);
assert.equal(C.detectFramedGrid(sheet(false), 5, 8), null,
  "unframed artwork must use the legacy cutter");
assert.equal(C.detectFramedGrid(image, 2, 5), null,
  "non-40 layout must use the legacy cutter");

// Regression: a realistic unframed 5x8 sheet may contain dark character outlines,
// Japanese-style caption strokes, and colored artwork in every cell. None of
// those strokes may trigger the printed-frame detector.
const unframedArt = sheet(false);
function darkPixel(x, y) {
  const p = (y * width + x) * 4;
  unframedArt.data[p] = unframedArt.data[p + 1] = unframedArt.data[p + 2] = 12;
}
for (let row = 0; row < 8; row++) for (let col = 0; col < 5; col++) {
  const cx = col * 200 + 100, cy = row * 200 + 110;
  // Closed head outline, two antennae, limbs, and short caption strokes.
  for (let deg = 0; deg < 360; deg++) {
    const angle = deg * Math.PI / 180;
    darkPixel(Math.round(cx + 47 * Math.cos(angle)), Math.round(cy + 38 * Math.sin(angle)));
  }
  for (let y = cy - 65; y < cy - 38; y++) {
    darkPixel(cx - 22, y); darkPixel(cx + 22, y);
  }
  for (let x = cx - 38; x <= cx + 38; x++) {
    if ((x - cx + 38) % 9 < 5) darkPixel(x, cy - 76);
  }
  for (let y = cy + 40; y <= cy + 58; y++) {
    darkPixel(cx - 24, y); darkPixel(cx + 24, y);
  }
}
assert.equal(C.detectFramedGrid(unframedArt, 5, 8), null,
  "unframed 40-sticker character sheet must never be mistaken for printed borders");
// Broken or partial frame guides must fail closed instead of clipping artwork.
const incomplete = sheet(true);
for (let y = 0; y < height; y++) {
  const p = (y * width + 398) * 4;
  incomplete.data[p] = incomplete.data[p + 1] = incomplete.data[p + 2] = 255;
  incomplete.data[p + 4] = incomplete.data[p + 5] = incomplete.data[p + 6] = 255;
}
assert.equal(C.detectFramedGrid(incomplete, 5, 8), null,
  "missing frame divider must fall back to the original cutter");

console.log("PASS: 5x8 frame detection, 40 inner crops, unframed fallback, alternate layout");
