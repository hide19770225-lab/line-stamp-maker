const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  V = require("../caption-vision.js"),
  S = require("../suggestions.js"),
  refs = require("../caption-references.js");
test("references cover reviewed poses and have valid bounded descriptors", () => {
  assert.equal(refs.length, 10);
  assert.equal(new Set(refs.map((r) => r.emotion)).size, 10);
  for (const r of refs) {
    assert.match(r.features, /^[0-9a-f]{4096}$/);
    assert.ok(S.candidates(r.emotion).length >= 4);
  }
});
test("empty and unfamiliar blue block are not classified as reference poses; matcher is stable and read only", () => {
  const image = {
      width: 80,
      height: 80,
      data: new Uint8ClampedArray(80 * 80 * 4),
    },
    mask = new Uint8ClampedArray(80 * 80);
  assert.equal(V.match(image, mask).emotion, "unknown");
  for (let i = 0; i < mask.length; i++) {
    image.data.set([45, 70, 220, 255], i * 4);
    mask[i] = 255;
  }
  const copy = image.data.slice(),
    m = mask.slice();
  assert.equal(V.match(image, mask).emotion, "unknown");
  assert.deepEqual(V.match(image, mask), V.match(image, mask));
  assert.deepEqual(image.data, copy);
  assert.deepEqual(mask, m);
});
test("generic candidates avoid context-specific times, outings and sleep claims", () => {
  const rows = S.automatic(Array.from({ length: 40 }, () => ({ caption: "" })));
  assert.equal(new Set(rows.map((r) => r.caption)).size, 40);
  assert.ok(rows.every((r) => !/[朝昼晩寝]|いって|おかえり/.test(r.caption)));
});
test("ambiguous mixture of two close reference poses is rejected", () => {
  function reconstruct(ref) {
    const f = [...ref.features].map((x) => parseInt(x, 16) / 15),
      d = new Uint8ClampedArray(4096);
    for (let i = 0; i < 1024; i++) {
      const a = f[i * 4 + 3];
      for (let c = 0; c < 3; c++)
        d[i * 4 + c] = a
          ? Math.max(0, (f[i * 4 + c] - (1 - a)) / a) * 255
          : 255;
      d[i * 4 + 3] = a * 255;
    }
    return d;
  }
  const a = reconstruct(refs[0]),
    b = reconstruct(refs[2]),
    data = Uint8ClampedArray.from(a.map((v, i) => (v + b[i]) / 2)),
    mask = Uint8Array.from(data.filter((_, i) => i % 4 === 3));
  const result = V.match({ width: 32, height: 32, data }, mask);
  assert.equal(result.emotion, "unknown");
  assert.ok(result.gap < 0.012);
});
