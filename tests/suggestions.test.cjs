"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  S = require("../suggestions.js"),
  P = require("../project.js");
test("unknown illustrations are never assigned an emotion or phrase automatically", () => {
  assert.equal(S.choose("unknown"), null);
  assert.equal(S.choose("not-a-category"), null);
  assert.deepEqual(S.candidates("unknown"), []);
  for (const key of ["smile", "cry", "angry", "surprised", "sleepy"])
    assert(
      S.candidates(key).every(
        (text) => text.length > 0 && Array.from(text).length <= 12,
      ),
    );
});
test("local suggestions prefer unused short phrases, and exhausted sets report normalized duplicates without edits", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    slot: i + 1,
    caption: S.choose("smile", [], i),
  }));
  const before = JSON.stringify(rows);
  assert(S.duplicates(rows).length > 0);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(
    S.duplicates([
      { slot: 1, caption: "ＯＫ" },
      { slot: 2, caption: "OK" },
    ]).length,
    1,
  );
  assert.notEqual(S.choose("smile", [S.choose("smile")]), S.choose("smile"));
});
test("optional safe margin persists in existing version-1 JSON; legacy remains unchanged and invalid values reject", () => {
  const p = {
    format: "stamp-atelier-project",
    version: 1,
    imageDataIncluded: false,
    target: 40,
    main: 1,
    tab: 1,
    slots: Array.from({ length: 40 }, P.blankSlot),
    sources: [],
  };
  assert.equal(P.readProject(p).slots[0].style.safeMargin, undefined);
  p.slots[0].style.safeMargin = 20;
  assert.equal(P.readProject(p).slots[0].style.safeMargin, 20);
  p.slots[0].style.safeMargin = 10;
  assert.equal(P.readProject(p).slots[0].style.safeMargin, 10);
  for (const value of [0, 19, 21, "20", null]) {
    p.slots[0].style.safeMargin = value;
    assert.throws(() => P.readProject(p));
  }
});
