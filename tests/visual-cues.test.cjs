const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../suggestions.js");
function image(kind) {
  const width = 100,
    height = 100,
    data = new Uint8ClampedArray(40000),
    mask = new Uint8ClampedArray(10000);
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 100; x++) {
      const i = y * 100 + x;
      let rgb = [140, 200, 90];
      if (
        kind === "tears" &&
        ((x >= 30 && x < 35) || (x >= 65 && x < 70)) &&
        y >= 40 &&
        y < 60
      )
        rgb = [40, 170, 235];
      if (kind === "blue") rgb = [40, 170, 235];
      data.set([...rgb, 255], i * 4);
      mask[i] = 255;
    }
  return { original: { width, height, data }, mask };
}
test("visual cue reads bilateral blue narrow pixels, never assumes unknown expressions", () => {
  for (const kind of ["tears", "green", "blue"]) {
    const s = image(kind),
      before = s.original.data.slice(),
      mask = s.mask.slice();
    assert.equal(
      S.analyze(s.original, s.mask).emotion,
      kind === "tears" ? "cry" : "unknown",
    );
    assert.deepEqual(s.original.data, before);
    assert.deepEqual(s.mask, mask);
  }
});
test("transparent blue pixels are ignored", () => {
  const s = image("tears");
  s.mask.fill(0);
  assert.equal(S.analyze(s.original, s.mask).emotion, "unknown");
});
