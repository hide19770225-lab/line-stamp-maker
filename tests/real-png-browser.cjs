/* Full real-image test: STAMP_REAL_FIXTURES is a local folder with the user's 09.png and 10.png. */
"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const fixtures = process.env.STAMP_REAL_FIXTURES;
if (!fixtures)
  throw Error("Set STAMP_REAL_FIXTURES to the local 09.png / 10.png folder.");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173",
  dir = process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-real-results";
(async () => {
  await fs.mkdir(dir, { recursive: true });
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const p = await b.newPage({
        ...devices["iPhone 13"],
        acceptDownloads: true,
      }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.stack));
    p.on("dialog", (d) => d.accept());
    await p.goto(base);
    await p.evaluate(() => {
      const render = StampCore.renderStamp;
      window.actualStamps = {};
      StampCore.renderStamp = (s, t) => {
        const r = render(s, t);
        if (s.slot) actualStamps[s.slot] = s;
        return r;
      };
    });
    await p.selectOption("#default-layout", "1x1");
    await p.setInputFiles("#file-input", [
      path.join(fixtures, "09.png"),
      path.join(fixtures, "10.png"),
    ]);
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    await p.click("#process-all");
    await p.waitForFunction(
      () =>
        document.querySelectorAll(".stamp-card").length === 2 &&
        !document.body.classList.contains("busy"),
    );
    const evidence = [];
    for (const [slot, name, x, y, len] of [
      [1, "09", 155, 25, 49],
      [2, "10", 177, 10, 16],
    ]) {
      await p
        .locator(".stamp-card")
        .nth(slot - 1)
        .click();
      await p.uncheck("#auto-cleanup-enabled"); // This suite verifies the manual fallback, not default automatic cleanup.
      if (!(await p.locator("#residue-panel").evaluate((e) => e.open)))
        await p.locator("#residue-panel summary").click();
      await p.waitForFunction(
        () => document.querySelectorAll("#residue-candidates input").length > 0,
      );
      assert.equal(
        await p.locator("#residue-candidates input:checked").count(),
        0,
      );
      const row = p
        .locator("#residue-candidates > div")
        .filter({ hasText: `${len}×1px` });
      assert.equal(await row.count(), 1);
      assert(await row.locator("input").isEnabled());
      assert.match(await row.innerText(), new RegExp(`左${x}／上${y}px`));
      if (slot === 2) {
        const hearts = p
          .locator("#residue-candidates > div")
          .filter({ hasText: "23×21px" });
        assert.equal(await hearts.count(), 2);
        for (const el of await hearts.locator("input").all())
          assert(await el.isDisabled());
      }
      const before = await p.evaluate(
        (n) => Array.from(actualStamps[n].mask),
        slot,
      );
      await row.locator("button").click();
      await p.selectOption("#residue-background", "black");
      await p
        .locator("#residue-viewport")
        .screenshot({ path: path.join(dir, `real-${name}-before-black.png`) });
      await row.locator("input").check();
      await p.click("#remove-residue");
      const after = await p.evaluate(
        (n) => Array.from(actualStamps[n].mask),
        slot,
      );
      for (let i = 0; i < before.length; i++)
        assert.equal(
          after[i],
          i >= y * 370 + x && i < y * 370 + x + len ? 0 : before[i],
          `${name}: only approved line alpha changes at ${i}`,
        );
      const edited = await p
        .locator("#edit-canvas")
        .evaluate((c) => c.toDataURL());
      await p.click("#undo-brush");
      assert.deepEqual(
        await p.evaluate((n) => Array.from(actualStamps[n].mask), slot),
        before,
      );
      await p.click("#redo-brush");
      assert.equal(
        await p.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
        edited,
      );
      await p.selectOption("#residue-background", "gray");
      await p.selectOption("#residue-zoom", "1");
      await p
        .locator("#residue-viewport")
        .screenshot({ path: path.join(dir, `real-${name}-after-gray.png`) });
      const wait = p.waitForEvent("download");
      await p.click("#download-single");
      await (await wait).saveAs(path.join(dir, `app-${name}.png`));
      await p.click("#close-dialog");
      await p.waitForFunction(
        ({ slot, edited }) =>
          document.querySelectorAll(".stamp-canvas")[slot - 1].toDataURL() ===
          edited,
        { slot, edited },
      );
      evidence.push({
        name,
        x,
        y,
        width: len,
        removed: len,
        allOtherNativeAlphaBytesIdentical: true,
      });
    }
    const hashes = await p.locator(".stamp-canvas").evaluateAll(async (cs) => {
      const hashes = [];
      for (const c of cs)
        hashes.push(
          Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                c.getContext("2d").getImageData(0, 0, 370, 320).data,
              ),
            ),
          )
            .map((x) => x.toString(16).padStart(2, "0"))
            .join(""),
        );
      return hashes;
    });
    const wait = p.waitForEvent("download");
    await p.click("#download-button");
    await (await wait).saveAs(path.join(dir, "app-real-test-2.zip"));
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    await fs.writeFile(
      path.join(dir, "real-app-evidence.json"),
      JSON.stringify({ evidence, hashes }, null, 2),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real uploaded PNGs, both lines selected/removed, both hearts protected, all other native alpha unchanged, undo/redo, single PNG + gallery + ZIP",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
