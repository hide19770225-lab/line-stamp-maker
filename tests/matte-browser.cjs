"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173",
  dir = process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-matte-tests";
(async () => {
  await fs.mkdir(dir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const p = await browser.newPage({
        ...devices["iPhone 13"],
        acceptDownloads: true,
      }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.stack));
    p.on("dialog", (d) => d.accept());
    await p.goto(base);
    await p.evaluate(() => {
      const render = StampCore.renderStamp;
      window.testTiles = {};
      StampCore.renderStamp = (s, t) => {
        const r = render(s, t);
        if (s.slot && t?.id !== "matte-after") testTiles[s.slot] = s;
        return r;
      };
    });
    const image = await p.evaluate(() => {
      const c = StampCore.canvas(240, 600),
        ctx = c.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 240, 600);
      for (let i = 0; i < 10; i++) {
        const x = (i % 2) * 120,
          y = Math.floor(i / 2) * 120;
        ctx.fillStyle = "#1e5028";
        ctx.fillRect(x + 30, y + 30, 60, 70);
        ctx.fillStyle = "#d2d2d2";
        ctx.fillRect(x + 30, y + 30, 1, 1);
        ctx.fillStyle = "white";
        ctx.fillRect(x + 50, y + 50, 10, 10);
        ctx.fillStyle = "#999";
        ctx.fillRect(x + 20, y, 40, 1);
        ctx.fillStyle = "#222";
        ctx.fillRect(x + 4, y + 10, 3, 5);
        const data = ctx.getImageData(x + 20, y + 80, 1, 1);
        data.data.set([250, 250, 250, 90]);
        ctx.putImageData(data, x + 20, y + 80);
      }
      return c.toDataURL().split(",")[1];
    });
    await p.setInputFiles("#file-input", {
      name: "matte-boundary-10.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    await p.click("#process-button");
    await p.waitForFunction(
      () =>
        document.querySelectorAll(".stamp-card").length === 10 &&
        !document.body.classList.contains("busy"),
    );
    await p.click("#review-residues");
    assert.match(await p.locator("#dialog-title").innerText(), /01/);
    await p.locator("#matte-panel summary").click();
    const before = await p.evaluate(() => Array.from(testTiles[1].mask));
    assert.equal(before[80 * 120 + 20], 90);
    assert.equal(before[50 * 120 + 50], 255);
    const originalPreview = await p
      .locator("#edit-canvas")
      .evaluate((c) => c.toDataURL());
    await p.click("#preview-matte");
    await p.waitForFunction(
      () => !document.querySelector("#matte-pending").hidden,
    );
    assert.deepEqual(
      await p.evaluate(() => Array.from(testTiles[1].mask)),
      before,
      "preview must not apply",
    );
    assert.equal(
      await p.locator("#matte-before").evaluate((c) => c.toDataURL()),
      originalPreview,
    );
    assert.notEqual(
      await p.locator("#matte-after").evaluate((c) => c.toDataURL()),
      originalPreview,
    );
    await p.click("#cancel-matte");
    assert.deepEqual(
      await p.evaluate(() => Array.from(testTiles[1].mask)),
      before,
    );
    await p.click("#preview-matte");
    await p.click("#apply-matte");
    let applied = await p.evaluate(() => Array.from(testTiles[1].mask));
    assert(applied[30 * 120 + 30] > 0 && applied[30 * 120 + 30] < 255);
    for (let i = 0; i < before.length; i++)
      if (i !== 30 * 120 + 30) assert.equal(applied[i], before[i]);
    await p.click("#undo-brush");
    assert.deepEqual(
      await p.evaluate(() => Array.from(testTiles[1].mask)),
      before,
    );
    await p.click("#redo-brush");
    assert.deepEqual(
      await p.evaluate(() => Array.from(testTiles[1].mask)),
      applied,
    );
    for (let slot = 1; slot <= 10; slot++) {
      assert.match(
        await p.locator("#dialog-title").innerText(),
        new RegExp(String(slot).padStart(2, "0")),
      );
      if (!(await p.locator("#residue-panel").evaluate((e) => e.open)))
        await p.locator("#residue-panel summary").click();
      for (const text of ["40×1px", "3×5px"]) {
        const row = p
          .locator("#residue-candidates > div")
          .filter({ hasText: text });
        assert.match(await row.innerText(), /境界付近/);
        await row.locator("input").check();
      }
      await p.click("#remove-residue");
      const mask = await p.evaluate((n) => Array.from(testTiles[n].mask), slot);
      for (let x = 20; x < 60; x++) assert.equal(mask[x], 0);
      for (let y = 10; y < 15; y++)
        for (let x = 4; x < 7; x++) assert.equal(mask[y * 120 + x], 0);
      assert.equal(mask[50 * 120 + 50], 255, "internal white kept");
      assert.equal(mask[80 * 120 + 20], 90, "partial shadow kept");
      if (slot < 10) await p.click("#next-residue");
    }
    const lastEdit = await p
      .locator("#edit-canvas")
      .evaluate((c) => c.toDataURL());
    await p.click("#close-dialog");
    await p.waitForFunction(
      (expected) =>
        document.querySelectorAll(".stamp-canvas")[9]?.toDataURL() === expected,
      lastEdit,
    );
    await p.waitForFunction(
      () => !document.querySelector("#stamp-dialog").open,
    );
    const hashes = await p.locator(".stamp-canvas").evaluateAll(async (cs) => {
      const result = [];
      for (const c of cs)
        result.push(
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
      return result;
    });
    await fs.writeFile(
      path.join(dir, "matte-preview-hashes.json"),
      JSON.stringify(hashes),
    );
    const wait = p.waitForEvent("download");
    await p.click("#download-button");
    await (await wait).saveAs(path.join(dir, "matte-10.zip"));
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    assert.deepEqual(errors, []);
    console.log(
      "PASS: pre-apply comparison and cancel unchanged; alpha-only fringe approval/undo/redo; 10-slot sequential review; approved boundary line/index removed; interior white and alpha90 shadow preserved; real ZIP",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
