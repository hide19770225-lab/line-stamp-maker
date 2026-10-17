"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173";
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const p = await b.newPage({ ...devices["iPhone 13"] });
    const pageErrors = [];
    p.on("pageerror", (error) => pageErrors.push(error.message));
    p.on("dialog", (d) => d.accept());
    // Exercise the Safari-compatible Image fallback as well as touch sizing.
    await p.addInitScript(() => {
      window.createImageBitmap = undefined;
    });
    // Simulate cached HTML lacking the newly introduced diagnostics markup.
    await p.route("**/app.js*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          'document.getElementById("easy-state")?.remove(); document.getElementById("easy-failure")?.remove();\n' +
          (await response.text()),
      });
    });
    await p.goto(base);
    assert.deepEqual(pageErrors, [], "cached HTML must not crash startup");
    const idle = () =>
      p.waitForFunction(
        () => !document.body.classList.contains("busy"),
        {},
        { timeout: 120000 },
      );
    await p.selectOption("#production-mode", "easy");
    const bytes = await p.evaluate(() => {
      const c = StampCore.canvas(600, 1500),
        x = c.getContext("2d");
      x.fillStyle = "white";
      x.fillRect(0, 0, 600, 1500);
      for (let i = 0; i < 10; i++) {
        x.fillStyle = "#518f67";
        x.fillRect((i % 2) * 300 + 70, Math.floor(i / 2) * 300 + 50, 160, 200);
      }
      return c.toDataURL().split(",")[1];
    });
    await p.setInputFiles("#easy-files", {
      name: "iPhone-ten.png",
      mimeType: "image/png",
      buffer: Buffer.from(bytes, "base64"),
    });
    await idle();
    await p.click("#easy-review");
    assert.match(
      await p.locator("#easy-progress").textContent(),
      /読み込み済み/,
      "loaded source is not a missing upload",
    );
    const captions = Array.from({ length: 10 }, (_, i) => `ありがとう${i + 1}`);
    await p.fill("#easy-captions", captions.join("\n"));
    await p.evaluate(() => {
      const create = StampCore.createTile;
      window.restoreCreate = () => (StampCore.createTile = create);
      let calls = 0;
      StampCore.createTile = (...args) => {
        if (++calls === 3) throw new Error("TEST Canvas memory failure");
        return create(...args);
      };
    });
    await p.click("#easy-process");
    await idle();
    assert.match(
      await p.locator("#easy-failure").textContent(),
      /iPhone-ten.png/,
    );
    assert.match(await p.locator("#easy-failure").textContent(), /03|3/);
    assert.match(
      await p.locator("#easy-failure").textContent(),
      /TEST Canvas memory failure/,
    );
    await p.click("#easy-review");
    assert.match(
      await p.locator("#easy-progress").textContent(),
      /TEST Canvas memory failure/,
      "step 3 must preserve the exact failure",
    );
    await p.evaluate(() => restoreCreate());
    await p.click("#easy-process");
    await idle();
    assert.equal(await p.locator(".stamp-card").count(), 10);
    assert.deepEqual(
      await p.locator(".stamp-caption").allTextContents(),
      captions,
    );
    assert(await p.locator("#easy-failure").isHidden());
    assert.match(await p.locator("#easy-state").textContent(), /加工済み10/);
    assert(await p.locator("#bulk-confirm").isDisabled());
    // A recovered field value without an input event must also be submitted.
    const changed = captions.map((s, i) => `再入力${i + 1}`);
    await p.evaluate((text) => {
      document.querySelector("#easy-captions").value = text;
    }, changed.join("\n"));
    await p.click("#easy-process");
    await idle();
    assert.deepEqual(
      await p.locator(".stamp-caption").allTextContents(),
      changed,
    );
    await p.click("#easy-export");
    assert.match(await p.locator("#easy-progress").textContent(), /全画像/);
    // Failure during final PNG inspection must be distinguished from source processing.
    await p.evaluate(() => {
      const png = StampCore.pngBlob;
      window.restorePNG = () => (StampCore.pngBlob = png);
      StampCore.pngBlob = async () => {
        throw new Error("TEST PNG encoding failure");
      };
    });
    await p.click("#easy-process");
    await idle();
    assert.match(await p.locator("#easy-failure").textContent(), /一括検査/);
    assert.match(
      await p.locator("#easy-failure").textContent(),
      /TEST PNG encoding failure/,
    );
    await p.click("#easy-review");
    assert.match(
      await p.locator("#easy-progress").textContent(),
      /TEST PNG encoding failure/,
    );
    await p.evaluate(() => restorePNG());
    await p.click("#easy-process");
    await idle();
    assert.equal(await p.locator(".stamp-card").count(), 10);
    assert.deepEqual(
      await p.locator(".stamp-caption").allTextContents(),
      changed,
    );
    assert(await p.locator("#easy-failure").isHidden());
    await p.click("#easy-review");
    assert(await p.locator("#bulk-review-heading").isVisible());
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    // A cached pre-partial-production module must be reported explicitly, not as missing images.
    await p.evaluate(() => {
      StampEasy.version = "old-build";
    });
    await p.click("#easy-process");
    await idle();
    assert.match(
      await p.locator("#easy-failure").textContent(),
      /表示ファイルの版が一致しません/,
    );
    assert.match(await p.locator("#easy-state").textContent(), /easy-state-1/);
    await p.click("#easy-review");
    assert.match(
      await p.locator("#easy-progress").textContent(),
      /表示ファイルの版が一致しません/,
    );
    assert.deepEqual(
      await p.locator(".stamp-caption").allTextContents(),
      changed,
    );
    await p.evaluate(() => {
      StampEasy.version = "easy-state-1";
    });
    await p.click("#easy-process");
    await idle();
    assert(await p.locator("#easy-failure").isHidden());
    assert.deepEqual(pageErrors, []);
    console.log(
      "PASS: loaded/failed/ready states, exact source+slot and audit error retention, retry, 10 Japanese captions including field restore without input event, partial ZIP gating",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
