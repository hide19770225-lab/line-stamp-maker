"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../core.js");
const T = require("../typography.js"),
  P = require("../project.js");
test("Japanese emotional captions suggest all six local presets", () => {
  for (const [text, key] of [
    ["やったー！", "energetic"],
    ["またあそぼう", "pop"],
    ["だいすき♡", "cute"],
    ["ありがとう！", "gentle"],
    ["絶対ダメ", "emphasis"],
    ["了解", "simple"],
  ])
    assert.equal(T.suggest(text), key);
});
test("automatic suggestions change with caption while explicit customizations remain", () => {
  const style = T.presetStyle("auto", "ありがとう");
  assert.equal(T.resolve("やった！", style).color, T.PRESETS.energetic.color);
  style.color = "#123456";
  style.angle = 12;
  style.overrides = ["color", "angle"];
  const resolved = T.resolve("おやすみ", style);
  assert.equal(resolved.color, "#123456");
  assert.equal(resolved.angle, 12);
  assert.equal(resolved.font, T.PRESETS.gentle.font);
});
test("old JSON styles retain manual positioning, colors and shadow-free rendering", () => {
  const old = {
    font: "serif",
    size: 28,
    x: 35,
    y: 75,
    color: "#123456",
    outline: false,
  };
  const style = T.resolve("ありがとう", old);
  assert.equal(style.autoPlace, false);
  assert.equal(style.shadow, 0);
  assert.equal(style.angle, 0);
  assert.equal(style.color, old.color);
  assert.equal(style.font, "serif");
});
test("new typography and overrides survive project JSON validation", () => {
  const raw = {
    format: "stamp-atelier-project",
    version: 1,
    imageDataIncluded: false,
    target: 40,
    main: 1,
    tab: 1,
    sources: [],
    slots: Array.from({ length: 40 }, P.blankSlot),
  };
  raw.slots[0].style = {
    ...T.presetStyle("cute", "好き"),
    color: "#113355",
    overrides: ["color"],
    angle: 12,
    shadow: 6,
    outlineWidth: 8,
  };
  const restored = P.readProject(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(restored.slots, raw.slots);
  for (const bad of [
    (s) => (s.angle = 31),
    (s) => (s.shadow = 99),
    (s) => (s.outlineWidth = -1),
    (s) => (s.preset = "remote-api"),
    (s) => (s.autoPlace = "true"),
    (s) => (s.overrides = ["unknown"]),
    (s) => (s.overrides = ["color", "color"]),
  ]) {
    const copy = structuredClone(raw);
    bad(copy.slots[0].style);
    assert.throws(() => P.readProject(copy));
  }
});
