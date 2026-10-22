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
