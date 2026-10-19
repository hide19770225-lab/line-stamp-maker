const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  V = require("../caption-vision.js"),
  R = require("../residue.js");
function pose() {
  const width = 100,
    height = 100,
    data = new Uint8ClampedArray(40000),
    mask = new Uint8Array(10000);
  function fill(x, y, w, h) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        const n = j * width + i;
        data.set([120, 180, 80, 255], n * 4);
        mask[n] = 255;
      }
  }
  fill(40, 25, 40, 60);
  fill(15, 50, 25, 10);
  fill(50, 10, 10, 15);
  return { image: { width, height, data }, mask };
}
test("mirror matching reads actual pixels without changing original pose", () => {
  const { image, mask } = pose(),
    before = image.data.slice(),
    previous = globalThis.StampCaptionReferences;
  globalThis.StampCaptionReferences = [
    {
      emotion: "wave",
      label: "手を振る",
      features: V.descriptor(image, mask)
        .map((n) => n.toString(16))
        .join(""),
    },
    { emotion: "sleepy", label: "眠る", features: "0".repeat(4096) },
  ];
  try {
    const data = new Uint8ClampedArray(40000),
      alpha = new Uint8Array(10000);
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++) {
        const i = y * 100 + x,
          j = y * 100 + 99 - x;
        data.set(image.data.slice(j * 4, j * 4 + 4), i * 4);
        alpha[i] = mask[j];
      }
    const matched = V.match({ ...image, data }, alpha);
    assert.equal(matched.emotion, "wave");
    assert.equal(matched.mirrored, true);
    assert.deepEqual(image.data, before);
  } finally {
    if (previous) globalThis.StampCaptionReferences = previous;
    else delete globalThis.StampCaptionReferences;
  }
});
test("explicit personal correction replaces an exactly matching built-in label", () => {
  const { image, mask } = pose(),
    refs = globalThis.StampCaptionReferences,
    descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    storage = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
    },
  });
  globalThis.StampCaptionReferences = [
    {
      emotion: "wave",
      label: "手を振る",
      features: V.descriptor(image, mask)
        .map((n) => n.toString(16))
        .join(""),
    },
    { emotion: "cry", label: "泣く", features: "0".repeat(4096) },
  ];
  try {
    assert.equal(V.match(image, mask).emotion, "wave");
    V.remember(image, mask, "approve", "親指");
    assert.equal(V.match(image, mask).emotion, "approve");
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
    if (refs) globalThis.StampCaptionReferences = refs;
    else delete globalThis.StampCaptionReferences;
  }
});
test("separated small motion strokes are decoration candidates; top white scanline remains reviewable", () => {
  const width = 160,
    height = 140,
    data = new Uint8ClampedArray(width * height * 4);
  const fill = (x, y, w, h) => {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        data.set([240, 240, 240, 255], (j * width + i) * 4);
  };
  fill(65, 40, 50, 65);
  fill(20, 30, 1, 7);
  fill(24, 30, 1, 7);
  fill(50, 2, 49, 1);
  const before = data.slice(),
    s = R.inspectFinal({ width, height, data });
  assert.equal(s.decorations.filter((c) => c.groupedDecoration).length, 2);
  assert.equal(s.candidates.length, 1);
  assert.equal(s.candidates[0].width, 49);
  assert.deepEqual(data, before);
});
test("feature geometry ignores only scanlines accepted by the existing final-output rule, without editing pixels", () => {
  const width = 160,
    height = 140,
    data = new Uint8ClampedArray(width * height * 4),
    mask = new Uint8Array(width * height);
  for (let y = 50; y < 120; y++)
    for (let x = 40; x < 120; x++) {
      const i = y * width + x;
      data.set([100, 180, 80, 255], i * 4);
      mask[i] = 255;
    }
  for (let x = 72; x < 88; x++) {
    const i = 10 * width + x,
      v = 210 + (x % 5);
    data.set([v, v, v, 180], i * 4);
    mask[i] = 180;
  }
  const image = { width, height, data },
    before = data.slice(),
    alpha = mask.slice(),
    clean = mask.slice();
  for (let x = 72; x < 88; x++) clean[10 * width + x] = 0;
  assert.equal(R.automaticLines(image).length, 1);
  assert.deepEqual(V.descriptor(image, mask), V.descriptor(image, clean));
  assert.deepEqual(data, before);
  assert.deepEqual(mask, alpha);
});
