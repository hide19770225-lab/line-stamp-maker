"use strict";
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173";
const artifacts =
  process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-test-artifacts";
const color = (i) => [
  40 + ((i * 37) % 160),
  70 + ((i * 23) % 150),
  60 + ((i * 53) % 140),
];
const captions = (n) =>
  Array.from(
    { length: n },
    (_, i) => `セリフ${String(i + 1).padStart(2, "0")}`,
  ).join("\n");
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const errors = [],
    external = [],
    expected = {};
  try {
    async function page() {
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        acceptDownloads: true,
      });
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(e.stack));
      p.on("request", (r) => {
        if (
          !r.url().startsWith(base) &&
          !r.url().startsWith("data:") &&
          !r.url().startsWith("blob:")
        )
          external.push(r.url());
      });
      p.on("dialog", (d) => d.accept());
      await p.goto(base);
      return p;
    }
    async function idle(p) {
      await p.waitForFunction(() => !document.body.classList.contains("busy"));
    }
    async function sheet(p, columns, rows, start = 0) {
      const data = await p.evaluate(
        ({ columns, rows, start }) => {
          const c = StampCore.canvas(columns * 120, rows * 120),
            ctx = c.getContext("2d");
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, c.width, c.height);
          for (let y = 0; y < rows; y++)
            for (let x = 0; x < columns; x++) {
              const i = start + y * columns + x;
              ctx.fillStyle = `rgb(${40 + ((i * 37) % 160)},${70 + ((i * 23) % 150)},${60 + ((i * 53) % 140)})`;
              ctx.fillRect(x * 120 + 25, y * 120 + 25, 70, 70);
            }
          return c.toDataURL().split(",")[1];
        },
        { columns, rows, start },
      );
      return {
        name: `sheet-${columns}x${rows}-${start}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(data, "base64"),
      };
    }
    async function register(p, n) {
      await p.locator(".bulk-text summary").click();
      await p.fill("#bulk-captions", captions(n));
      await p.click("#apply-captions");
    }
    async function review(p, n) {
      await p.locator(".stamp-card").first().click();
      for (let i = 0; i < n; i++) {
        await p.check("#reviewed-checkbox");
        await p.click("#save-edit");
      }
      await p.waitForFunction(
        (n) => document.querySelectorAll(".stamp-card.reviewed").length === n,
        n,
      );
    }
    async function download(p, name) {
      const event = p.waitForEvent("download");
      await p.click("#download-button");
      const d = await event;
      await d.saveAs(path.join(artifacts, name));
      await idle(p);
      return d.suggestedFilename();
    }
    async function colors(p, indices) {
      const actual = await p
        .locator(".stamp-canvas")
        .evaluateAll((cs) =>
          cs.map((c) =>
            Array.from(
              c.getContext("2d").getImageData(185, 160, 1, 1).data,
            ).slice(0, 3),
          ),
        );
      assert.deepEqual(
        actual,
        indices.map(color),
        "row-major pixel order is tied to stable output numbers",
      );
    }
    let savedFile, fixture8, afterEdit;
    for (const n of [8, 16, 24, 32, 40]) {
      const p = await page();
      await p.selectOption("#target-count", String(n));
      await register(p, n);
      await p.selectOption("#default-layout", "5x8");
      const image = await sheet(p, 5, 8);
      await p.setInputFiles("#file-input", image);
      await idle(p);
      await p.click("#process-button");
      await idle(p);
      assert.equal(await p.locator(".stamp-card").count(), n);
      await colors(
        p,
        Array.from({ length: n }, (_, i) => i),
      );
      const text = await p.locator(".stamp-caption").allTextContents();
      assert.deepEqual(text, captions(n).split("\n"));
      await review(p, n);
      assert.equal(await download(p, `count-${n}.zip`), `line-stamps-${n}.zip`);
      expected[`count-${n}.zip`] = Array.from({ length: n }, (_, i) =>
        color(i),
      );
      if (n === 8) {
        fixture8 = image;
        await p.locator(".stamp-card").nth(1).click();
        await p.locator("#image-scale").fill("65");
        await p.locator("#image-x").fill("75");
        await p.locator("#image-y").fill("25");
        await p.selectOption("#font-family", "serif");
        await p.locator("#font-size").fill("26");
        await p.locator(".individual-crop summary").click();
        await p.locator("#stamp-insets-left").fill("2");
        await p.click('[data-brush="erase"]');
        await p.locator("#edit-canvas").scrollIntoViewIfNeeded();
        const b = await p.locator("#edit-canvas").boundingBox();
        await p.touchscreen.tap(
          b.x + (b.width * 223) / 370,
          b.y + (b.height * 134) / 320,
        );
        afterEdit = await p
          .locator("#edit-canvas")
          .evaluate((c) => c.toDataURL());
        await p.click("#close-dialog");
        await p.waitForFunction(
          () => !document.querySelector("#stamp-dialog").open,
        );
        const event = p.waitForEvent("download");
        await p.click("#save-project");
        const d = await event;
        savedFile = path.join(artifacts, "project-8.json");
        await d.saveAs(savedFile);
        const json = JSON.parse(await fs.readFile(savedFile, "utf8"));
        assert.equal(json.imageDataIncluded, false);
        assert(!("image" in json.sources[0]));
        assert(
          json.slots[1].mask.runs.length > 0,
          "eraser corrections saved as alpha differences",
        );
        assert.equal(json.slots[1].layout.scale, 65);
        assert.equal(json.slots[1].caption, "セリフ02");
      }
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await p.context().close();
      console.log(
        `PASS: ${n}-sticker production ZIP, row-major image/caption order, pre-registration, mobile layout`,
      );
    }
    // Reopen an image-free project in a new page, verify image identity and exact edited output.
    const restored = await page();
    await restored.setInputFiles("#load-project", savedFile);
    await idle(restored);
    assert.equal(await restored.inputValue("#target-count"), "8");
    assert.equal(
      await restored.locator(".source-card .project-file").count(),
      1,
    );
    const wrong = await sheet(restored, 5, 8, 1);
    await restored.setInputFiles("#file-input", wrong);
    await idle(restored);
    assert.match(await restored.locator("#status").innerText(), /一致しません/);
    assert.equal(await restored.locator(".stamp-card").count(), 0);
    await restored.setInputFiles("#file-input", fixture8);
    await idle(restored);
    await restored.click("#process-all");
    await idle(restored);
    assert.equal(await restored.locator(".stamp-card").count(), 8);
    await restored.locator(".stamp-card").nth(1).click();
    assert.equal(await restored.inputValue("#caption-text"), "セリフ02");
    assert.equal(await restored.inputValue("#image-scale"), "65");
    assert.equal(await restored.inputValue("#font-family"), "serif");
    assert.equal(
      await restored.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
      afterEdit,
      "JSON restores identical pixel output including eraser mask",
    );
    await restored.click("#close-dialog");
    await restored.setInputFiles("#load-project", {
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"format":"wrong","target":40}'),
    });
    await idle(restored);
    assert.equal(await restored.inputValue("#target-count"), "8");
    assert.equal(await restored.locator(".stamp-card").count(), 8);
    await restored.context().close();
    console.log(
      "PASS: image-free JSON round trip, exact brush/layout/font/caption restoration, wrong-image and invalid-JSON rejection",
    );
    // Two files uploaded at once, with different per-source grids, plus a 12-cell sheet.
    const mixed = await page();
    await mixed.selectOption("#target-count", "24");
    await register(mixed, 24);
    await mixed.selectOption("#default-layout", "4x2");
    const a = await sheet(mixed, 4, 2, 0),
      b = await sheet(mixed, 2, 4, 8);
    await mixed.setInputFiles("#file-input", [a, b]);
    await idle(mixed);
    await mixed.selectOption("#source-select", "1");
    await mixed.selectOption("#layout-preset", "2x4");
    await mixed.selectOption("#default-layout", "4x3");
    await mixed.setInputFiles("#file-input", await sheet(mixed, 4, 3, 16));
    await idle(mixed);
    await mixed.selectOption("#source-select", "0");
    await mixed.locator(".cell-details summary").click();
    await mixed.locator('[data-cell="1"]').selectOption("0");
    await mixed.selectOption("#source-select", "2");
    await mixed.locator('[data-cell="8"]').selectOption("2");
    await mixed.click("#process-button");
    await idle(mixed);
    assert.equal(
      await mixed.locator(".stamp-caption").first().textContent(),
      "セリフ02",
    );
    await mixed.click("#process-all");
    await idle(mixed);
    assert.equal(await mixed.locator(".stamp-card").count(), 24);
    const order = Array.from({ length: 24 }, (_, i) => i);
    order[1] = 24;
    await colors(mixed, order);
    assert.deepEqual(
      await mixed.locator(".stamp-caption").allTextContents(),
      captions(24).split("\n"),
    );
    // Swapping two cell numbers keeps captions fixed and requires the affected image to be reprocessed.
    await mixed.selectOption("#source-select", "0");
    await mixed.locator('[data-cell="0"]').selectOption("3");
    await mixed.click("#download-button");
    await idle(mixed);
    assert.match(await mixed.locator("#status").innerText(), /設定が変更/);
    await mixed.click("#process-all");
    await idle(mixed);
    [order[0], order[2]] = [order[2], order[0]];
    await colors(mixed, order);
    assert.deepEqual(
      await mixed.locator(".stamp-caption").allTextContents(),
      captions(24).split("\n"),
    );
    await review(mixed, 24);
    await download(mixed, "mixed-24.zip");
    expected["mixed-24.zip"] = order.map(color);
    await mixed.screenshot({
      path: path.join(artifacts, "flexible-grids-mobile.png"),
      fullPage: true,
    });
    // Excluding an entire processed source must not leave an impossible stale-source requirement.
    await mixed.selectOption("#source-select", "0");
    for (let cell = 0; cell < 8; cell++)
      await mixed.locator(`[data-cell="${cell}"]`).selectOption("0");
    assert.doesNotMatch(
      await mixed.locator("#validation-list").innerText(),
      /元画像1を分割し直/,
    );
    await mixed.selectOption("#main-select", "2");
    await mixed.selectOption("#tab-select", "2");
    assert.equal(
      await download(mixed, "partial-gaps.zip"),
      "line-stamps-test-17.zip",
    );
    await mixed.context().close();
    console.log(
      "PASS: mixed per-image grids, batch upload, excluded/reassigned/swapped cells, out-of-order processing, stable filenames/captions",
    );
    // Remaining preset and a custom 3x3 layout.
    for (const [columns, rows, custom] of [
      [5, 2, false],
      [3, 3, true],
    ]) {
      const p = await page();
      await p.selectOption("#target-count", "8");
      const image = await sheet(p, columns, rows);
      if (!custom) await p.selectOption("#default-layout", "5x2");
      await p.setInputFiles("#file-input", image);
      await idle(p);
      if (custom) {
        await p.locator("#grid-columns").fill("3");
        await p.locator("#grid-rows").fill("3");
        await p.click("#apply-layout");
      }
      await p.click("#process-button");
      await idle(p);
      await colors(
        p,
        Array.from({ length: 8 }, (_, i) => i),
      );
      assert.equal(await p.locator(".stamp-card").count(), 8);
      await p.context().close();
    }
    const early = await page();
    await early.selectOption("#target-count", "16");
    await register(early, 16);
    const earlyEvent = early.waitForEvent("download");
    await early.click("#save-project");
    const earlyDownload = await earlyEvent;
    const earlyFile = path.join(artifacts, "captions-before-images.json");
    await earlyDownload.saveAs(earlyFile);
    assert.equal(
      JSON.parse(await fs.readFile(earlyFile, "utf8")).sources.length,
      0,
    );
    const earlyReload = await page();
    await earlyReload.setInputFiles("#load-project", earlyFile);
    await idle(earlyReload);
    await earlyReload.locator(".caption-details summary").click();
    assert.equal(await earlyReload.inputValue('[data-slot="16"]'), "セリフ16");
    await early.context().close();
    await earlyReload.context().close();
    console.log(
      "PASS: captions saved/reloaded before any images, and partial ZIP preserves gaps without renumbering",
    );
    await fs.writeFile(
      path.join(artifacts, "expected-colors.json"),
      JSON.stringify(expected),
    );
    assert.deepEqual(errors, [], "no uncaught browser errors");
    assert.deepEqual(external, [], "no external image or API requests");
    console.log(
      "PASS: 5x2 preset and custom 3x3 grid; zero external requests and uncaught errors",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
