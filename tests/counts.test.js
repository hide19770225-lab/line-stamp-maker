// Regression tests for every supported LINE sticker count.
// Run: node --test tests/counts.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../project.js");

for (const count of [8, 16, 24, 32, 40]) {
  test(`${count} stickers: assign unique numbers and preserve them on grid reset`, () => {
    const project = {target: count, sources: []};
    const source = {
      width: 1152, height: 1366, columns: 5, rows: 8,
      xs: P.lines(5), ys: P.lines(8),
      assignments: Array(40).fill(0),
      columnYs: null, rowXs: null,
    };
    project.sources.push(source);
    P.fillFree(project, source);
    assert.deepEqual(source.assignments.filter(Boolean),
      Array.from({length: count}, (_, i) => i + 1));
    assert.equal(new Set(source.assignments.filter(Boolean)).size, count);
    assert.equal(source.assignments.filter(Boolean).length + 2, count + 2);
    P.setGrid(project, source, 5, 8);
    assert.deepEqual(source.assignments.filter(Boolean),
      Array.from({length: count}, (_, i) => i + 1));
    assert.equal(source.rowXs, null);
    assert.equal(source.columnYs, null);
  });

  test(`${count} stickers: assigning one number exchanges rather than duplicates`, () => {
    const project = {target: count, sources: []};
    const source = {
      width: 1152, height: 1366, columns: count, rows: 1,
      xs: P.lines(count), ys: P.lines(1),
      assignments: Array.from({length: count}, (_, i) => i + 1),
    };
    project.sources.push(source);
    P.assignSlot(project, source, 0, count);
    assert.equal(source.assignments[0], count);
    assert.equal(source.assignments[count - 1], 1);
    assert.equal(new Set(source.assignments).size, count);
  });
}
