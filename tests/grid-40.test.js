"use strict";
const assert = require("node:assert/strict");
const P = require("../project.js");
const C = require("../core.js");
const columns = 5, rows = 8;
const columnYs = Array.from({ length: columns }, (_, col) =>
  Array.from({ length: rows + 1 }, (_, row) =>
    row === 0 ? 0 : row === rows ? 1 : row / rows + (col - 2) * 0.001
  )
);
const source = {
  name: "40-grid.png", fingerprint: "a".repeat(64),
  width: 1152, height: 1366, image: { width: 1152, height: 1366 },
  columns, rows, xs: P.lines(columns), ys: P.lines(rows),
  columnYs, manualColumnYs: true,
  insets: P.blankInsets(), assignments: Array.from({ length: 40 }, (_, i) => i + 1),
  mode: "auto", tolerance: 24, color: "#ffffff",
};
const raw = {
  format: "stamp-atelier-project", version: 1, imageDataIncluded: false,
  target: 40, main: 1, tab: 1,
  slots: Array.from({ length: 40 }, P.blankSlot),
  sources: [{ ...source, image: undefined }],
};
const restored = P.readProject(raw).sources[0];
assert.equal(restored.manualColumnYs, true);
assert.deepEqual(restored.columnYs, columnYs);
assert.equal(C.tileRect({ ...source, insets: P.blankInsets() }, 0, 1).y,
  Math.round(columnYs[0][1] * source.height));
assert.notEqual(C.tileRect(source, 0, 1).y, C.tileRect(source, 4, 1).y);
assert.ok(C.tileRect(source, 4, 7).height > 0);
const legacy = structuredClone(raw);
delete legacy.sources[0].columnYs;
delete legacy.sources[0].manualColumnYs;
assert.equal(P.readProject(legacy).sources[0].manualColumnYs, false);
const broken = structuredClone(raw);
broken.sources[0].columnYs[0][2] = broken.sources[0].columnYs[0][1];
assert.throws(() => P.readProject(broken), /JSON/);
console.log("40-grid JSON persistence, legacy compatibility, invalid boundary rejection and tile coordinates: OK");


function edgeMask(width, height, rectangles) {
  const mask = new Uint8ClampedArray(width * height);
  for (const [x0, y0, x1, y1] of rectangles)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) mask[y * width + x] = 255;
  return mask;
}
// Neighbor guide digits can survive background removal as a small, isolated
// opaque shape clipped by a left/right divider. Warn, never delete pixels.
const rightDigit = edgeMask(100, 100, [[97, 7, 100, 15]]);
const rightCopy = rightDigit.slice();
const digitReview = C.tileBoundaryReview(rightDigit, 100, 100);
assert.equal(digitReview.needsReview, true);
assert.ok(digitReview.edges.includes("right・小さな独立部分"));
assert.deepEqual(rightDigit, rightCopy, "boundary inspection must not alter the image");
const leftDigit = C.tileBoundaryReview(edgeMask(100, 100, [[0, 10, 3, 18]]), 100, 100);
assert.ok(leftDigit.edges.includes("left・小さな独立部分"));
const clean = C.tileBoundaryReview(edgeMask(100, 100, [[25, 25, 75, 75]]), 100, 100);
assert.equal(clean.needsReview, false);
// A continuous body touching the edge should still require inspection, but
// must not be misclassified as a tiny disconnected guide digit.
const largeBody = C.tileBoundaryReview(edgeMask(100, 100, [[0, 10, 45, 90]]), 100, 100);
assert.ok(largeBody.edges.includes("left"));
assert.ok(!largeBody.edges.includes("left・小さな独立部分"));
console.log("edge island warnings, unchanged alpha masks and large-artwork distinction: OK");

function guideFixture(width, height, boxes) {
  const data = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8ClampedArray(width * height);
  for (const [x0, y0, x1, y1] of boxes)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const p = y * width + x;
        data[p * 4 + 3] = mask[p] = 255;
      }
  return [{ width, height, data }, mask];
}
assert.equal(C.guideNumberCandidate(...guideFixture(200, 200, [[10, 9, 13, 18], [16, 9, 19, 18]])), true);
assert.equal(C.guideNumberCandidate(...guideFixture(200, 200, [[10, 9, 32, 30]])), false);
assert.equal(C.guideNumberCandidate(...guideFixture(200, 200, [[60, 60, 70, 70]])), false);
console.log("isolated source guide number warning without large-artwork false positive: OK");

const [guideImage, guideAlpha] = guideFixture(200, 200, [[10, 9, 13, 18], [16, 9, 19, 18]]);
const guideOriginal = guideAlpha.slice();
assert.ok(C.removeIsolatedGuideNumber(guideImage, guideAlpha) > 0);
assert.equal(guideAlpha[12 * 200 + 11], 0);
assert.equal(guideAlpha[12 * 200 + 17], 0);
assert.ok(guideOriginal[12 * 200 + 11] > 0);
const [largeImage, largeAlpha] = guideFixture(200, 200, [[10, 9, 32, 30]]);
const largeCopy = largeAlpha.slice();
assert.equal(C.removeIsolatedGuideNumber(largeImage, largeAlpha), 0);
assert.deepEqual(largeAlpha, largeCopy);
console.log("safe isolated guide removal and large artwork preservation: OK");

// A dark digit-like detail connected to a colored drawing must survive.
const [connectedImage, connectedAlpha] = guideFixture(200, 200,
  [[10, 9, 13, 18], [16, 9, 19, 18], [12, 17, 14, 60], [13, 59, 70, 80]]);
connectedImage.data[(60 * 200 + 20) * 4] = 210;
const connectedCopy = connectedAlpha.slice();
assert.equal(C.removeIsolatedGuideNumber(connectedImage, connectedAlpha), 0);
assert.deepEqual(connectedAlpha, connectedCopy);
// Do not erase colored punctuation even when it falls in the old padded box.
const [nearImage, nearAlpha] = guideFixture(200, 200,
  [[10, 9, 13, 18], [16, 9, 19, 18], [14, 20, 16, 22]]);
for (let y = 20; y < 22; y++) for (let x = 14; x < 16; x++)
  nearImage.data[(y * 200 + x) * 4] = 210;
assert.equal(C.removeIsolatedGuideNumber(nearImage, nearAlpha), 54);
assert.equal(nearAlpha[20 * 200 + 14], 255);
const [singleImage, singleAlpha] = guideFixture(200, 200, [[10, 9, 13, 18]]);
assert.equal(C.removeIsolatedGuideNumber(singleImage, singleAlpha), 0);
// Reshaping a sheet must clear column geometry of the previous dimensions.
const reshape = { ...source, columnYs, manualColumnYs: true };
P.setGrid({ sources: [reshape], target: 40 }, reshape, 2, 5);
assert.equal(reshape.columnYs, null);
assert.equal(reshape.manualColumnYs, false);
console.log('connected artwork, neighboring colored punctuation, single marks and reshaped geometry preserved: OK');
