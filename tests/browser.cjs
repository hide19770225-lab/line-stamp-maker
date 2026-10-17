/* Optional integration checks: requires Playwright and an installed Chromium.
   Start python3 -m http.server 4173, then see README for the test command. */
"use strict";
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173";
const artifacts =
  process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-test-artifacts";
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      acceptDownloads: true,
    });
    const page = await context.newPage(),
      errors = [],
      external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (
        !r.url().startsWith(base) &&
        !r.url().startsWith("blob:") &&
        !r.url().startsWith("data:")
      )
        external.push(r.url());
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(base);
    assert.equal(await page.title(), "STAMP atelier — LINEスタンプ制作ツール");
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "initial mobile layout must not scroll horizontally",
    );
    await page.screenshot({
      path: path.join(artifacts, "mobile-home.png"),
      fullPage: true,
    });
    // A real PNG upload with 10 distinct, white-filled, outlined subjects.
    const fixture = await page.evaluate(() => {
      const c = StampCore.canvas(800, 1600),
        ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      for (let r = 0; r < 5; r++)
        for (let col = 0; col < 2; col++) {
          const x = col * 400 + 200,
            y = r * 320 + 160;
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = "#244d36";
          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.ellipse(x, y, 95, 105, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = [
            "#ea8787",
            "#86afcc",
            "#e7c369",
            "#9cab79",
            "#b29bc4",
          ][r];
          ctx.fillRect(x - 40, y + 38, 80, 22);
          ctx.fillStyle = "#244d36";
          ctx.beginPath();
          ctx.arc(x - 30, y - 20, 7, 0, Math.PI * 2);
          ctx.arc(x + 30, y - 20, 7, 0, Math.PI * 2);
          ctx.fill();
        }
      // Simulate unwanted separator lines touching both sides of each cell.
      ctx.fillStyle = "#ff00ff";
      for (const x of [0, 396, 400, 796]) ctx.fillRect(x, 0, 4, 1600);
      return c.toDataURL("image/png").split(",")[1];
    });
    const fixtureBuffer = Buffer.from(fixture, "base64");
    await page.setInputFiles("#file-input", {
      name: "10-characters.png",
      mimeType: "image/png",
      buffer: fixtureBuffer,
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".source-card").length === 1 &&
        !document.body.classList.contains("busy"),
    );
    // Numeric line adjustment is available even when touching intersections is difficult.
    const middle = page.locator("#grid-controls input").nth(1);
    await middle.fill("52");
    await middle.dispatchEvent("change");
    assert.equal(await middle.inputValue(), "52.0");
    await page.click("#reset-grid");
    for (const side of ["left", "right"])
      await page.locator(`#source-insets-${side}`).fill("2");
    await page.click("#process-button");
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".stamp-card").length === 10 &&
        !document.body.classList.contains("busy"),
    );
    const separatorCount = await page.$eval(".stamp-canvas", (c) => {
      const data = c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (
          data[i] > 240 &&
          data[i + 1] < 10 &&
          data[i + 2] > 240 &&
          data[i + 3]
        )
          count++;
      return count;
    });
    assert.equal(
      separatorCount,
      0,
      "source insets remove adjacent magenta separators before transparency",
    );
    const alphas = await page.evaluate(() => {
      const c = document.querySelector(".stamp-canvas"),
        ctx = c.getContext("2d");
      return [
        ctx.getImageData(0, 0, 1, 1).data[3],
        ctx.getImageData(185, 135, 1, 1).data[3],
      ];
    });
    assert.deepEqual(
      alphas,
      [0, 255],
      "background removed, enclosed white body preserved",
    );
    const canvasBounds = (selector) =>
      page.$eval(selector, (c) =>
        StampCore.alphaBounds(
          c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
          c.width,
          c.height,
        ),
      );
    const initialBounds = await canvasBounds(".stamp-canvas");
    assert(
      initialBounds.height >= 260,
      "character fills more than the old 250px art area",
    );
    const untouched = await page
      .locator(".stamp-canvas")
      .nth(1)
      .evaluate((c) => c.toDataURL());
    await page.locator(".stamp-card").first().click();
    await page.click("#image-larger");
    assert.equal(await page.inputValue("#image-scale"), "95");
    await page.click("#image-smaller");
    assert.equal(await page.inputValue("#image-scale"), "90");
    await page.locator("#image-scale").fill("100");
    const largest = await canvasBounds("#edit-canvas");
    assert.equal(largest.height, 300);
    for (const value of ["0", "100"]) {
      await page.locator("#image-scale").fill("70");
      await page.locator("#image-x").fill(value);
      await page.locator("#image-y").fill(value);
      const b = await canvasBounds("#edit-canvas");
      assert(
        b.x >= 10 && b.y >= 10 && b.x + b.width <= 360 && b.y + b.height <= 310,
      );
      assert(
        Math.abs(b.width / b.height - largest.width / largest.height) < 0.03,
        "aspect ratio is preserved",
      );
    }
    await page.locator(".individual-crop summary").click();
    const uncut = await page
      .locator("#edit-canvas")
      .evaluate((c) => c.toDataURL());
    await page.locator("#stamp-insets-left").fill("40");
    assert.notEqual(
      await page.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
      uncut,
    );
    await page.click("#reset-stamp-crop");
    assert.equal(
      await page.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
      uncut,
    );
    await page.click("#reset-layout");
    assert.equal(await page.inputValue("#image-scale"), "100");
    await page.locator("#image-scale").fill("70");
    await page.locator("#image-x").fill("65");
    await page.locator("#image-y").fill("45");
    await page.locator("#comparison-panel summary").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#after-canvas").toDataURL() ===
        document.querySelector("#edit-canvas").toDataURL(),
    );
    const originalComparison = await page
      .locator("#before-canvas")
      .evaluate((c) => c.toDataURL());
    await page.fill("#caption-text", "比較テスト");
    assert.equal(
      await page.locator("#before-canvas").evaluate((c) => c.toDataURL()),
      originalComparison,
    );
    assert.equal(
      await page.locator("#after-canvas").evaluate((c) => c.toDataURL()),
      await page.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
    );
    await page.fill("#caption-text", "");
    await page.locator("#comparison-panel summary").click();

    await page.click('[data-brush="erase"]');
    const before = await page.evaluate(
      () =>
        document
          .querySelector("#edit-canvas")
          .getContext("2d")
          .getImageData(185, 135, 1, 1).data[3],
    );
    assert.equal(before, 255);
    await page.locator("#edit-canvas").scrollIntoViewIfNeeded();
    let box = await page.locator("#edit-canvas").boundingBox();
    await page.touchscreen.tap(
      box.x + box.width / 2,
      box.y + (box.height * 135) / 320,
    );
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector("#edit-canvas")
            .getContext("2d")
            .getImageData(185, 135, 1, 1).data[3],
      ),
      0,
    );
    await page.click('[data-brush="restore"]');
    await page.locator("#edit-canvas").scrollIntoViewIfNeeded();
    box = await page.locator("#edit-canvas").boundingBox();
    await page.mouse.click(
      box.x + box.width / 2,
      box.y + (box.height * 135) / 320,
    );
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector("#edit-canvas")
            .getContext("2d")
            .getImageData(185, 135, 1, 1).data[3],
      ),
      255,
    );
    await page.click("#undo-brush");
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector("#edit-canvas")
            .getContext("2d")
            .getImageData(185, 135, 1, 1).data[3],
      ),
      0,
    );
    await page.click("#redo-brush");
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector("#edit-canvas")
            .getContext("2d")
            .getImageData(185, 135, 1, 1).data[3],
      ),
      255,
    );
    await page.click("#reset-mask");
    await page.fill("#caption-text", "ありがとう！");
    await page.selectOption("#font-family", "rounded");
    await page.selectOption("#edit-background", "dark");
    await page.screenshot({
      path: path.join(artifacts, "mobile-editor.png"),
      fullPage: true,
    });
    await page.click("#close-dialog");
    await page.waitForFunction(
      () => !document.querySelector("#stamp-dialog").open,
    );
    assert.equal(
      await page
        .locator(".stamp-canvas")
        .nth(1)
        .evaluate((c) => c.toDataURL()),
      untouched,
      "individual edits do not alter other stamps",
    );
    let downloadPromise = page.waitForEvent("download");
    await page.click("#download-button");
    const ten = await downloadPromise;
    assert.equal(ten.suggestedFilename(), "line-stamps-test-10.zip");
    await ten.saveAs(path.join(artifacts, "test-10.zip"));
    await page.waitForFunction(() => !document.body.classList.contains("busy"));
    // Setting changes invalidate processed output and block stale ZIPs.
    await page.locator("#tolerance").fill("25");
    await page.locator("#tolerance").dispatchEvent("input");
    await page.click("#download-button");
    await page.waitForFunction(() => !document.body.classList.contains("busy"));
    assert.match(await page.locator("#status").innerText(), /設定が変更/);
    await page.locator("#tolerance").fill("24");
    await page.locator("#tolerance").dispatchEvent("input");
    for (let i = 2; i <= 4; i++) {
      await page.click("#sample-button");
      await page.click("#process-button");
      await page.waitForFunction(
        (n) =>
          document.querySelectorAll(".stamp-card").length === n &&
          !document.body.classList.contains("busy"),
        i * 10,
      );
    }
    await page.click("#sample-button");
    assert.equal(await page.locator(".source-card").count(), 5);
    await page.locator(".bulk-text summary").click();
    await page.fill(
      "#bulk-captions",
      Array.from(
        { length: 40 },
        (_, i) => `セリフ${String(i + 1).padStart(2, "0")}`,
      ).join("\n"),
    );
    await page.click("#apply-captions");
    await page.click("#download-button");
    await page.waitForFunction(() => !document.body.classList.contains("busy"));
    assert.match(await page.locator("#status").innerText(), /40個の透過/);
    await page.locator(".stamp-card").first().click();
    // Oversized text must be detected and not silently exported with clipping.
    await page.fill("#caption-text", "とても長いセリフ".repeat(12));
    await page.click("#close-dialog");
    await page.waitForFunction(() =>
      document
        .querySelector("#validation-list")
        .textContent.includes("文字が枠からはみ出します"),
    );
    assert.match(
      await page.locator("#validation-list").innerText(),
      /文字が枠からはみ出します/,
    );
    await page.locator(".stamp-card").first().click();
    await page.fill("#caption-text", "ありがとう");
    await page.click("#apply-style-all");
    await page.click("#close-dialog");
    await page.locator(".stamp-card").nth(39).click();
    await page.locator("#image-scale").fill("65");
    await page.locator("#image-x").fill("90");
    await page.locator(".individual-crop summary").evaluate((el) => {
      el.parentElement.open = true;
    });
    await page.locator("#stamp-insets-top").fill("2");
    await page.click("#close-dialog");
    await page.locator(".stamp-card").nth(39).click();
    assert.equal(await page.inputValue("#image-scale"), "65");
    assert.equal(await page.inputValue("#stamp-insets-top"), "2");
    await page.click("#close-dialog");
    await page.locator(".stamp-card").first().click();
    for (let i = 0; i < 40; i++) {
      await page.check("#reviewed-checkbox");
      await page.click("#save-edit");
    }
    await page.waitForFunction(
      () => document.querySelectorAll(".stamp-card.reviewed").length === 40,
    );
    assert.equal(await page.locator(".stamp-card.reviewed").count(), 40);
    await page.selectOption("#main-select", "3");
    await page.selectOption("#tab-select", "8");
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "processed mobile layout must not scroll horizontally",
    );
    downloadPromise = page.waitForEvent("download");
    await page.click("#download-button");
    const forty = await downloadPromise;
    assert.equal(forty.suggestedFilename(), "line-stamps-40.zip");
    await forty.saveAs(path.join(artifacts, "full-40.zip"));
    await page.waitForFunction(() => !document.body.classList.contains("busy"));
    assert.match(
      await page.locator("#validation-list").innerText(),
      /実ファイル検査OK：42画像/,
    );
    assert.equal(
      await page.locator("#download-link").getAttribute("download"),
      "line-stamps-40.zip",
    );
    assert.deepEqual(errors, [], "no browser errors");
    assert.deepEqual(external, [], "no external requests");
    console.log(
      "PASS: mobile layout, real PNG upload, grid adjustment, 10/40 processing, white preservation, individual scale/position/crop/compare, erase/restore/undo/redo, Japanese captions, clipping detection, review gating, stale-setting checks, 12/42-file ZIP downloads, zero external requests",
    );
    // Smallest supported layout and a desktop overview.
    await page.setViewportSize({ width: 320, height: 740 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "320px layout",
    );
    const desktop = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await desktop.goto(base);
    await desktop.screenshot({
      path: path.join(artifacts, "desktop-home.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
