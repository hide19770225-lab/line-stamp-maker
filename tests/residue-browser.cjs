/* Synthetic regressions: no user ZIP or images are bundled with this test. */
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
    args: ["--no-sandbox"],
  });
  try {
    const p = await browser.newPage({
        ...devices["iPhone 13"],
        acceptDownloads: true,
      }),
      errors = [],
      external = [];
    p.on("pageerror", (e) => errors.push(e.stack));
    p.on("dialog", (d) => d.accept());
    p.on("request", (r) => {
      if (
        ![base, "data:", "blob:"].some((prefix) => r.url().startsWith(prefix))
      )
        external.push(r.url());
    });
    await p.goto(base);
    const evidence = await p.evaluate(async () => {
      const C = StampCore,
        results = [];
      // Source pixels outside a crop must never be sampled back in during enlargement.
      for (const len of [18, 5]) {
        const c = C.canvas(120, 120),
          ctx = c.getContext("2d");
        ctx.fillStyle = "#467ca9";
        ctx.fillRect(20, 40, 80, 61);
        ctx.fillRect(20, 1, 5, 45);
        ctx.fillStyle = "white";
        ctx.fillRect(40, 0, len, 1);
        const s = C.createTile(
          { image: c, xs: [0, 1], ys: [0, 1] },
          0,
          0,
          "none",
          0,
          "#fff",
        );
        s.crop.top = 100 / 120;
        const fixed = C.renderStamp(s),
          p = fixed.imagePlacement,
          old = C.canvas(370, 320),
          oc = old.getContext("2d"),
          cr = p.crop;
        oc.save();
        oc.beginPath();
        oc.rect(10, 10, 350, 300);
        oc.clip();
        // Exact former drawImage path, with no physical isolation of the source crop.
        oc.drawImage(
          c,
          cr.x,
          cr.y,
          cr.width,
          cr.height,
          p.offsetX + cr.x * p.ratio,
          p.offsetY + cr.y * p.ratio,
          cr.width * p.ratio,
          cr.height * p.ratio,
        );
        oc.restore();
        const scan = (canvas) => {
          const d = canvas.getContext("2d").getImageData(0, 0, 370, 320).data;
          let count = 0;
          for (let y = 10; y < 35; y++)
            for (let x = 10; x < 360; x++) {
              const i = (y * 370 + x) * 4;
              if (d[i + 3] && d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240)
                count++;
            }
          return count;
        };
        const typography = window.StampTypography;
        delete window.StampTypography;
        const fallback = C.renderStamp(s).canvas.toDataURL();
        window.StampTypography = typography;
        if (fallback !== fixed.canvas.toDataURL())
          throw Error("fallback crop differs");
        results.push({
          nativeLength: len,
          beforePixels: scan(old),
          afterPixels: scan(fixed.canvas),
          before: old.toDataURL(),
          after: fixed.canvas.toDataURL(),
        });
      }
      // Adjacent grid pixels must also be physically isolated before downsampling a tile.
      const sheet = C.canvas(1800, 1200),
        ctx = sheet.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(899, 0, 1, 1200);
      ctx.fillStyle = "#467ca9";
      ctx.fillRect(1000, 300, 500, 700);
      const tile = C.createTile(
        { image: sheet, xs: [0, 0.5, 1], ys: [0, 1] },
        1,
        0,
        "none",
        0,
        "#fff",
      );
      let contamination = 0;
      for (let i = 0; i < tile.mask.length; i++)
        if (tile.mask[i] && tile.original.data[i * 4] > 240) contamination++;
      return { crop: results, splitContamination: contamination };
    });
    assert.deepEqual(
      evidence.crop.map((r) => [r.beforePixels, r.afterPixels]),
      [
        [51, 0],
        [16, 0],
      ],
    );
    assert.equal(evidence.splitContamination, 0);
    for (let i = 0; i < 2; i++)
      for (const state of ["before", "after"]) {
        await fs.writeFile(
          path.join(artifacts, `residue-${state}-${i + 9}.png`),
          Buffer.from(evidence.crop[i][state].split(",")[1], "base64"),
        );
        delete evidence.crop[i][state];
      }
    await fs.writeFile(
      path.join(artifacts, "residue-evidence.json"),
      JSON.stringify(evidence, null, 2),
    );
    // Keep native stamp references only inside the test harness, without an application debug API.
    await p.evaluate(() => {
      const render = StampCore.renderStamp;
      window.testStamps = {};
      StampCore.renderStamp = (stamp, target) => {
        if (stamp.slot) window.testStamps[stamp.slot] = stamp;
        return render(stamp, target);
      };
    });
    await p.selectOption("#default-layout", "5x8");
    const fixture = await p.evaluate(() => {
      const c = StampCore.canvas(600, 960),
        ctx = c.getContext("2d");
      for (let i = 0; i < 40; i++) {
        ctx.save();
        ctx.translate((i % 5) * 120, Math.floor(i / 5) * 120);
        ctx.fillStyle = "#467ca9";
        ctx.fillRect(25, 35, 70, 65);
        ctx.fillRect(25, 20, 5, 20);
        ctx.fillStyle = "white";
        ctx.fillRect(40, 55, 30, 20);
        ctx.fillRect(105, 65, 3, 6);
        if (i === 8 || i === 9) ctx.fillRect(40, 3, i === 8 ? 18 : 5, 1);
        ctx.fillStyle = "#40b06c";
        ctx.fillRect(103, 45, 5, 12);
        ctx.restore();
      }
      return c.toDataURL().split(",")[1];
    });
    await p.setInputFiles("#file-input", {
      name: "synthetic-residue-40.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture, "base64"),
    });
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    await p.click("#process-button");
    await p.waitForFunction(
      () =>
        document.querySelectorAll(".stamp-card").length === 40 &&
        !document.body.classList.contains("busy"),
    );
    const originalMasks = await p.evaluate(() =>
      [9, 10].map((n) => Array.from(testStamps[n].mask)),
    );
    await p.locator(".stamp-card").nth(8).click();
    await p.locator("#residue-panel summary").click();
    await p.waitForFunction(
      () => document.querySelectorAll("#residue-candidates input").length >= 3,
    );
    assert.equal(
      await p.locator("#residue-candidates input:checked").count(),
      0,
      "no decoration is preselected",
    );
    const before = await p
      .locator("#edit-canvas")
      .evaluate((c) => c.toDataURL());
    assert.equal(
      await p.locator("#residue-preview").evaluate((c) => c.toDataURL()),
      before,
      "magnified preview uses exact completed canvas",
    );
    for (const bg of ["gray", "black"]) {
      await p.selectOption("#residue-background", bg);
      await p.selectOption("#residue-zoom", "8");
      await p
        .locator("#residue-candidates > div")
        .filter({ hasText: "18×1px" })
        .locator("button")
        .click();
      await p.locator("#residue-viewport").screenshot({
        path: path.join(artifacts, `residue-${bg}-inspection.png`),
      });
      assert.equal(
        await p.locator("#residue-preview").evaluate((c) => c.toDataURL()),
        before,
        "inspection background/overlay never changes output pixels",
      );
    }
    for (const zoom of ["1", "2", "4", "8"]) {
      await p.selectOption("#residue-zoom", zoom);
      const dimensions = await p.evaluate(() => ({
        stage: document.querySelector("#residue-stage").clientWidth,
        view: document.querySelector("#residue-viewport").clientWidth,
        page: document.documentElement.scrollWidth,
        screen: innerWidth,
      }));
      assert(
        Math.abs(
          dimensions.stage - Math.min(370, dimensions.view) * Number(zoom),
        ) <= 1,
      );
      assert.equal(dimensions.screen, 390);
      assert(dimensions.view <= 390);
      assert(dimensions.page <= dimensions.screen);
    }
    await p
      .locator("#residue-candidates > div")
      .filter({ hasText: "18×1px" })
      .locator("input")
      .check();
    await p.click("#remove-residue");
    const after = await p
      .locator("#edit-canvas")
      .evaluate((c) => c.toDataURL());
    assert.notEqual(after, before);
    await p.click("#undo-brush");
    assert.equal(
      await p.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
      before,
    );
    await p.click("#redo-brush");
    assert.equal(
      await p.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
      after,
    );
    await p.click("#close-dialog");
    await p.locator(".stamp-card").nth(9).click();
    // Real touch erasing on the canonical edit canvas, followed by undo/redo.
    const before10 = await p
      .locator("#edit-canvas")
      .evaluate((c) => c.toDataURL());
    await p.click('[data-brush="erase"]');
    await p.locator("#brush-size").fill("8");
    await p.locator("#edit-canvas").scrollIntoViewIfNeeded();
    const box = await p.locator("#edit-canvas").boundingBox(),
      ip = await p.evaluate(() => StampCore.imagePlacement(testStamps[10]));
    const point = (n) => ({
      x: box.x + ((ip.offsetX + n * ip.ratio) * box.width) / 370,
      y: box.y + ((ip.offsetY + 3 * ip.ratio) * box.height) / 320,
    });
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(39)],
    });
    for (let x = 40; x <= 46; x++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(x)],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const after10 = await p
      .locator("#edit-canvas")
      .evaluate((c) => c.toDataURL());
    assert.notEqual(after10, before10);
    await p.click("#undo-brush");
    assert.equal(
      await p.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
      before10,
    );
    await p.click("#redo-brush");
    assert.equal(
      await p.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
      after10,
    );
    const finalMasks = await p.evaluate(() =>
      [9, 10].map((n) => Array.from(testStamps[n].mask)),
    );
    for (let k = 0; k < 2; k++)
      for (let i = 0; i < finalMasks[k].length; i++) {
        const erased = i >= 400 && i < 400 + (k === 0 ? 18 : 5);
        assert.equal(
          finalMasks[k][i],
          erased ? 0 : originalMasks[k][i],
          `only selected line changes, slot${k + 9}, pixel${i}`,
        );
      }
    await p.click("#close-dialog");
    const projectWait = p.waitForEvent("download");
    await p.click("#save-project");
    const projectFile = path.join(artifacts, "residue-project.json");
    await (await projectWait).saveAs(projectFile);
    const project = JSON.parse(await fs.readFile(projectFile, "utf8"));
    assert.deepEqual(project.slots[8].mask.runs, [400, 18, 0]);
    assert.deepEqual(project.slots[9].mask.runs, [400, 5, 0]);
    assert(
      project.slots
        .filter((_, i) => i !== 8 && i !== 9)
        .every((slot) => !slot.mask.runs.length),
    );
    await p.locator(".stamp-card").first().click();
    for (let i = 0; i < 40; i++) {
      await p.check("#reviewed-checkbox");
      await p.click("#save-edit");
    }
    await p.waitForFunction(
      () => document.querySelectorAll(".stamp-card.reviewed").length === 40,
    );
    assert.equal(
      await p
        .locator(".stamp-canvas")
        .nth(8)
        .evaluate((c) => c.toDataURL()),
      after,
      "editor matches gallery 09",
    );
    assert.equal(
      await p
        .locator(".stamp-canvas")
        .nth(9)
        .evaluate((c) => c.toDataURL()),
      after10,
      "editor matches gallery 10",
    );
    const hashes = await p
      .locator(".stamp-canvas")
      .evaluateAll(async (canvases) => {
        const result = [];
        for (const c of canvases) {
          const d = c
            .getContext("2d")
            .getImageData(0, 0, c.width, c.height).data;
          result.push(
            Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", d)))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
          );
        }
        return result;
      });
    assert.equal(hashes.length, 40);
    await fs.writeFile(
      path.join(artifacts, "residue-preview-hashes-40.json"),
      JSON.stringify(hashes),
    );
    const wait = p.waitForEvent("download", { timeout: 120000 });
    await p.click("#download-button");
    await (await wait).saveAs(path.join(artifacts, "residue-fixed-40.zip"));
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    // All saleable counts use precisely the same detector, alpha mutation and PNG renderer.
    const sets = await p.evaluate(async () => {
      const C = StampCore,
        R = StampResidue,
        results = [];
      for (const count of [8, 16, 24, 32, 40]) {
        const files = [],
          extras = [];
        for (let slot = 1; slot <= count; slot++) {
          const c = C.canvas(120, 120),
            ctx = c.getContext("2d");
          ctx.fillStyle = "#467ca9";
          ctx.fillRect(25, 35, 70, 65);
          ctx.fillStyle = "white";
          ctx.fillRect(40, 55, 30, 20);
          ctx.fillRect(40, 3, 18, 1);
          ctx.fillRect(105, 65, 3, 6);
          ctx.fillStyle = "#40b06c";
          ctx.fillRect(103, 45, 5, 12);
          const s = C.createTile(
              { image: c, xs: [0, 1], ys: [0, 1] },
              0,
              0,
              "auto",
              0,
              "#fff",
            ),
            scan = R.analyse(s.original, s.mask, C.stampCrop(s), true),
            line = scan.candidates.find((x) => x.y === 3);
          s.mask = R.removeSelected(s.mask, scan, [line.id]).mask;
          if (
            s.mask[55 * 120 + 40] !== 255 ||
            s.mask[65 * 120 + 105] !== 255 ||
            s.mask[45 * 120 + 103] !== 255
          )
            throw Error("protected white/leaf lost");
          const canvas = C.renderStamp(s).canvas;
          files.push({
            name: String(slot).padStart(2, "0") + ".png",
            blob: await C.pngBlob(canvas),
          });
          if (slot === 1) {
            for (const [name, w, h] of [
              ["main.png", 240, 240],
              ["tab.png", 96, 74],
            ]) {
              const extra = C.specialImage(s, w, h);
              extras.push({ name, blob: await C.pngBlob(extra) });
            }
          }
        }
        const blob = await C.makeZip([...files, ...extras]),
          bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        results.push({ count, zip: btoa(binary) });
      }
      return results;
    });
    for (const set of sets)
      await fs.writeFile(
        path.join(artifacts, `residue-count-${set.count}.zip`),
        Buffer.from(set.zip, "base64"),
      );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      "PASS: synthetic 51/16px sampling artifacts → 0; grid isolation; explicit native line deletion preserves every other alpha byte; touch eraser undo/redo; 1–8× gray/black inspection; preview hashes + actual 42-image ZIP; all five set counts; no external requests",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
