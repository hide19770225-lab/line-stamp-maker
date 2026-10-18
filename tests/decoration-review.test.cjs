const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  R = require("../residue.js"),
  A = require("../audit.js");
function fixture() {
  const width = 160,
    height = 140,
    data = new Uint8ClampedArray(width * height * 4);
  function fill(x, y, w, h, color) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) data.set(color, (j * width + i) * 4);
  }
  fill(65, 40, 45, 65, [230, 190, 140, 255]);
  for (let k = 0; k < 9; k++) {
    const x = 15 + (k % 3) * 10,
      y = 25 + Math.floor(k / 3) * 18;
    fill(
      x,
      y,
      3,
      2,
      k % 3 === 0
        ? [245, 95, 135, 255]
        : k % 3 === 1
          ? [245, 180, 35, 255]
          : [50, 155, 230, 160],
    );
    fill(x + 1, y + 2, 1, 1, [245, 95, 135, 180]);
  }
  fill(50, 2, 49, 1, [255, 255, 255, 180]);
  return { width, height, data };
}
test("nine small colored detached decorations are protected instead of reported as nine defects", () => {
  const image = fixture(),
    before = image.data.slice(),
    mask = Uint8ClampedArray.from(
      { length: image.width * image.height },
      (_, i) => image.data[i * 4 + 3],
    );
  const scan = R.analyse(image, mask, undefined, true),
    final = R.inspectFinal(image);
  assert.equal(final.decorations.length, 9);
  assert.equal(final.candidates.length, 1);
  assert.equal(final.candidates[0].width, 49);
  assert.deepEqual(image.data, before);
  for (const c of final.decorations)
    assert.throws(() => R.removeSelected(mask, scan, [c.id]));
  const deleted = R.removeSelected(mask, scan, [final.candidates[0].id]);
  for (let i = 0; i < mask.length; i++)
    if (scan.labels[i] !== final.candidates[0].id)
      assert.equal(deleted.mask[i], mask[i]);
});
test("decoration counts are informational; uncertain residue warnings are not confirmed errors", () => {
  const im = fixture();
  const a = A.inspect(im, 2000, 160, 140, { margin: 0, decorations: 9 });
  assert.equal(a.status, "正常");
  assert.equal(a.decorations, 9);
  const b = A.inspect(im, 2000, 160, 140, {
    margin: 0,
    residues: 1,
    decorations: 9,
  });
  assert.equal(b.status, "要確認");
  assert.equal(b.errors.length, 0);
  assert.match(b.warnings.join(""), /異常は未確定/);
});
