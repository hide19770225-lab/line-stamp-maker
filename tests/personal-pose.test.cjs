const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  V = require("../caption-vision.js");
test("explicit local labels enable pixel matching for a new character; unknown labels never saved", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
  });
  try {
    const width = 70,
      height = 60,
      data = new Uint8ClampedArray(width * height * 4),
      mask = new Uint8Array(width * height);
    for (let y = 15; y < 50; y++)
      for (let x = 15; x < 55; x++) {
        const i = y * width + x;
        data.set([185, 92, 45, 255], i * 4);
        mask[i] = 255;
      }
    const image = { width, height, data },
      before = data.slice();
    assert.equal(V.match(image, mask).emotion, "unknown");
    assert.throws(() => V.remember(image, mask, "unknown", "未分類"));
    V.remember(image, mask, "sleepy", "眠る（利用者指定）");
    assert.equal(V.match(image, mask).emotion, "sleepy");
    assert.equal(V.learned().length, 1);
    assert.deepEqual(data, before);
    V.remember(image, mask, "angry", "怒る（訂正）");
    assert.equal(V.match(image, mask).emotion, "angry");
    assert.equal(V.learned().length, 1);
    V.clearLearned();
    assert.equal(V.match(image, mask).emotion, "unknown");
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
});
