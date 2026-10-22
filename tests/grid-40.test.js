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
