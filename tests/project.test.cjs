"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../project.js");
function project(target = 40) {
  return {
    format: "stamp-atelier-project",
    version: 1,
    imageDataIncluded: false,
    target,
    main: 1,
    tab: 1,
    slots: Array.from({ length: 40 }, P.blankSlot),
    sources: [],
  };
}
function source(p, columns, rows) {
  const s = {
    name: "sheet.png",
    fingerprint: "a".repeat(64),
    width: 800,
    height: 1600,
    columns,
    rows,
    xs: P.lines(columns),
    ys: P.lines(rows),
    assignments: Array(columns * rows).fill(0),
    insets: P.blankInsets(),
    mode: "auto",
    tolerance: 24,
    color: "#ffffff",
  };
  p.sources.push(s);
  P.fillFree(p, s);
  return s;
}
test("all supported counts allocate only selected number of slots from a 40-cell sheet", () => {
  for (const n of P.COUNTS) {
    const p = project(n),
      s = source(p, 5, 8);
    assert.deepEqual(
      s.assignments.filter(Boolean),
      Array.from({ length: n }, (_, i) => i + 1),
    );
    assert.equal(s.assignments.filter((v) => !v).length, 40 - n);
  }
});
test("mixed grids assign row-major numbers across sources without duplicates", () => {
  const p = project(24),
    a = source(p, 4, 2),
    b = source(p, 2, 4),
    c = source(p, 4, 3);
  assert.deepEqual(a.assignments, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(b.assignments, [9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(c.assignments, [17, 18, 19, 20, 21, 22, 23, 24, 0, 0, 0, 0]);
});
test("reshaping, exclusion, reallocation and cross-source swaps do not move captions", () => {
  const p = project(),
    a = source(p, 2, 5),
    b = source(p, 5, 2);
  p.slots[0].caption = "ありがとう";
  p.slots[1].caption = "おはよう";
  P.setGrid(p, a, 5, 2);
  assert.deepEqual(a.assignments, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  P.assignSlot(p, a, 1, 0);
  assert.deepEqual(a.assignments.slice(0, 4), [1, 0, 3, 4]);
  P.assignSlot(p, b, 0, 2);
  assert.equal(b.assignments[0], 2);
  assert.equal(p.slots[1].caption, "おはよう");
  P.assignSlot(p, b, 1, 1);
  assert.equal(a.assignments[0], 12);
  assert.equal(b.assignments[1], 1);
  assert.equal(p.slots[0].caption, "ありがとう");
  const slots = p.sources.flatMap((s) => s.assignments).filter(Boolean);
  assert.equal(new Set(slots).size, slots.length);
});
test("custom grids preserve excluded cells, validate bounds, and fill only new cells", () => {
  const p = project(),
    s = source(p, 2, 5);
  P.assignSlot(p, s, 1, 0);
  P.setGrid(p, s, 3, 4);
  assert.equal(s.assignments[1], 0);
  assert.equal(s.assignments[10], 2);
  assert.equal(s.assignments[11], 11);
  assert.throws(() => P.setGrid(p, s, 0, 4));
  assert.throws(() => P.setGrid(p, s, 40, 40));
  assert.throws(() => P.setGrid(p, s, 2.5, 4));
});
test("mask difference encoding restores exact alpha and does not contain RGB image data", () => {
  const auto = new Uint8ClampedArray([0, 255, 255, 100, 255, 255, 0]),
    mask = new Uint8ClampedArray([0, 0, 0, 100, 125, 125, 0]);
  const runs = P.encodeMask(mask, auto);
  assert.deepEqual(runs, [1, 2, 0, 4, 2, 125]);
  const restored = auto.slice();
  P.applyMask(restored, runs);
  assert.deepEqual(restored, mask);
});
test("JSON round trip preserves captions, individual settings, cell assignments and mask differences", () => {
  const p = project(16);
  source(p, 4, 3);
  p.slots[0].caption = "こんにちは🌸";
  p.slots[0].layout.scale = 65;
  p.slots[0].crop.left = 2;
  p.slots[0].style.font = "serif";
  p.slots[0].mask = {
    key: "geometry-key",
    width: 10,
    height: 10,
    runs: [2, 5, 0],
  };
  const restored = P.readProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(restored.slots, p.slots);
  assert.deepEqual(restored.sources, p.sources);
  assert(!("image" in restored.sources[0]));
});
test("invalid JSON is rejected before application state can change", () => {
  const p = project(8);
  source(p, 4, 2);
  for (const mutate of [
    (v) => (v.target = 10),
    (v) => (v.sources[0].assignments[1] = 1),
    (v) => (v.sources[0].xs[1] = 0),
    (v) => (v.slots[0].style.size = 999),
    (v) => (v.slots[0].caption = "長".repeat(121)),
    (v) => (v.sources[0].fingerprint = "different"),
    (v) =>
      (v.slots[0].mask = { key: "x", width: 5, height: 5, runs: [0, 26, 0] }),
    (v) =>
      (v.slots[0].mask = {
        key: "x",
        width: 5,
        height: 5,
        runs: [3, 2, 0, 2, 1, 255],
      }),
  ]) {
    const copy = structuredClone(p);
    mutate(copy);
    assert.throws(() => P.readProject(copy));
  }
  assert.equal(p.target, 8);
  assert.equal(p.sources[0].assignments[1], 2);
});

test("automatic cleanup defaults on for old JSON, preserves per-slot OFF and rejects invalid flags", () => {
  const p = project();
  delete p.slots[0].cleanupEnabled;
  p.slots[1].cleanupEnabled = false;
  const restored = P.readProject(p);
  assert.equal(restored.slots[0].cleanupEnabled, true);
  assert.equal(restored.slots[1].cleanupEnabled, false);
  p.slots[0].cleanupEnabled = "yes";
  assert.throws(() => P.readProject(p));
});

test("changing 2x5 to 5x8 discards automatic and manual column gutters", () => {
  for (const manual of [false, true]) {
    const p = project(), s = source(p, 2, 5);
    s.columnYs = [P.lines(5), P.lines(5)];
    s.manualColumnYs = manual;
    s.gutterUncertain = true;
    s.cropReport = ["old coordinates"]; s.cropMethod = "old";
    p.slots[0].caption = "ありがとう";
    P.setGrid(p, s, 5, 8);
    assert.equal(s.columnYs, null);
    assert.equal(s.manualColumnYs, false);
    assert.equal(s.gutterUncertain, false);
    assert.deepEqual(s.cropReport, []);
    assert.deepEqual(s.xs, P.lines(5)); assert.deepEqual(s.ys, P.lines(8));
    assert.deepEqual(s.assignments, Array.from({length:40}, (_,i)=>i+1));
    assert.equal(p.slots[0].caption, "ありがとう");
    P.setGrid(p, s, 2, 5);
    assert.deepEqual(s.assignments, Array.from({length:10}, (_,i)=>i+1));
  }
});
