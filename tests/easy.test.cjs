"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  E = require("../easy.js");
const source = (i, start, count) => ({
  name: `sheet${i}`,
  fingerprint: `fp${i}`,
  image: {},
  assignments: Array.from({ length: 10 }, (_, j) =>
    j < count ? start + j : 0,
  ),
});
test("easy production covers all valid counts without mutating row-major assignments", () => {
  for (const n of [8, 16, 24, 32, 40]) {
    const sources = Array.from({ length: Math.ceil(n / 10) }, (_, i) =>
      source(i, i * 10 + 1, Math.min(10, n - i * 10)),
    );
    const before = JSON.stringify(sources),
      p = E.plan(sources, n);
    assert.deepEqual(p.errors, []);
    assert.equal(JSON.stringify(sources), before);
    assert.equal(p.warnings.length, n % 10 ? 1 : 0);
  }
});
test("missing images, duplicate images/numbers, pending source and more than four are blocked", () => {
  assert.deepEqual(
    E.plan([source(1, 1, 10)], 40).missing,
    Array.from({ length: 30 }, (_, i) => i + 11),
  );
  assert(
    E.plan([source(1, 1, 10), source(1, 11, 10)], 16).errors.some((s) =>
      s.includes("重複"),
    ),
  );
  assert(
    E.plan([source(1, 1, 10), source(2, 1, 10)], 16).errors.some((s) =>
      s.includes("番号"),
    ),
  );
  assert(
    E.plan([{ ...source(1, 1, 8), image: null }], 8).errors.some((s) =>
      s.includes("再選択"),
    ),
  );
  assert(
    E.plan(
      Array.from({ length: 5 }, (_, i) => source(i, i * 8 + 1, 8)),
      40,
    ).errors.some((s) => s.includes("4枚")),
  );
});
test("Japanese multiline captions preserve order and blank lines; limits validate before changes", () => {
  assert.deepEqual(E.captions("ありがとう\r\n\r\nおはよう"), [
    "ありがとう",
    "",
    "おはよう",
  ]);
  assert.throws(() => E.captions(Array(41).fill("はい").join("\n")));
  assert.throws(() => E.captions("あ".repeat(121)));
  assert.equal(E.captions(Array(40).fill("ありがとう").join("\n")).length, 40);
});
