const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../suggestions.js");
test("automatic neutral captions fill 10/40 slots without duplicates or changing existing captions", () => {
  for (const count of [10, 40]) {
    const rows = Array.from({ length: count }, (_, i) => ({
      slot: i + 1,
      caption: i === 0 ? "ありがとう" : "",
    }));
    const output = S.automatic(rows);
    assert.equal(output[0].caption, "ありがとう");
    assert.equal(new Set(output.map((r) => r.caption)).size, count);
    assert.ok(output.every((r, i) => r.slot === i + 1 && r.caption.length > 0));
    assert.equal(rows[1].caption, "");
    assert.deepEqual(S.automatic(output), output);
  }
});
