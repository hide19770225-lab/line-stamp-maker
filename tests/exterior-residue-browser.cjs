/* Exact reported output geometry, synthetic data only: user ZIP is unavailable. */
"use strict";
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173";
const dir = process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-test-artifacts";
(async () => {
  await fs.mkdir(dir, { recursive: true });
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
    let approve = true;
    p.on("pageerror", (e) => errors.push(e.stack));
    p.on("dialog", (d) => (approve ? d.accept() : d.dismiss()));
    p.on("request", (r) => {
      if (![base, "data:", "blob:"].some((x) => r.url().startsWith(x)))
        external.push(r.url());
    });
    await p.goto(base);
    await p.evaluate(() => {
      window.fixtureStamps = {};
      const render = StampCore.renderStamp;
      StampCore.renderStamp = (s, t) => {
        const r = render(s, t);
        if (s.slot) fixtureStamps[s.slot] = s;
        return r;
      };
    });
    await p.selectOption("#default-layout", "5x2");
    const source = await p.evaluate(() => {
      const c = StampCore.canvas(1850, 640),
        ctx = c.getContext("2d");
      for (let i = 0; i < 10; i++) {
        ctx.save();
        ctx.translate((i % 5) * 370, Math.floor(i / 5) * 320);
        ctx.fillStyle = "#467ca9";
        ctx.fillRect(10, 100, 350, 210);
        ctx.fillRect(10, 10, 5, 100);
        ctx.fillStyle = "white";
        ctx.fillRect(100, 180, 100, 60);
        ctx.fillRect(320, 50, 8, 8);
        if (i === 8) ctx.fillRect(130, 25, 49, 1);
        if (i === 9) ctx.fillRect(130, 10, 16, 1);
        ctx.fillStyle = "#40b06c";
        ctx.fillRect(300, 55, 8, 20);
        ctx.fillStyle = "#172e25";
        ctx.fillRect(120, 150, 5, 5);
        ctx.fillRect(155, 150, 5, 5);
        ctx.fillRect(133, 165, 18, 2);
        ctx.restore();
      }
      return c.toDataURL().split(",")[1];
    });
    await p.setInputFiles("#file-input", {
      name: "synthetic-exact-5x2.png",
      mimeType: "image/png",
      buffer: Buffer.from(source, "base64"),
    });
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    await p.click("#process-button");
    await p.waitForFunction(
      () =>
        document.querySelectorAll(".stamp-card").length === 10 &&
        !document.body.classList.contains("busy"),
      {},
      { timeout: 120000 },
    );
    const evidence = [];
    for (const [slot, y, len] of [
      [9, 25, 49],
      [10, 10, 16],
    ]) {
      await p
        .locator(".stamp-card")
        .nth(slot - 1)
        .click();
      await p.click("#reset-layout");
      if (!(await p.locator("#residue-panel").evaluate((e) => e.open)))
        await p.locator("#residue-panel summary").click();
      await p.waitForFunction(
        () =>
          document.querySelectorAll("#residue-candidates input").length >= 3,
      );
      assert.equal(
        await p.locator("#residue-candidates input:checked").count(),
        0,
      );
      const before = await p
        .locator("#edit-canvas")
        .evaluate((c) => c.toDataURL());
      const nativeBefore = await p.evaluate(
        (n) => Array.from(fixtureStamps[n].mask),
        slot,
      );
      const beforeScan = await p.evaluate(
        ({ y, len }) => {
          const c = document.querySelector("#edit-canvas"),
            image = c.getContext("2d").getImageData(0, 0, 370, 320),
            scan = StampResidue.inspectFinal(image);
          const line = scan.candidates.find(
            (x) =>
              x.x === 130 && x.y === y && x.width === len && x.height === 1,
          );
          return {
            line: line || null,
            alpha: Array.from(
              image.data.slice((y * 370 + 130) * 4, (y * 370 + 130 + len) * 4),
            ),
          };
        },
        { y, len },
      );
      assert(beforeScan.line, `exact ${slot}.png line geometry not reproduced`);
      assert.match(
        await p.locator("#residue-output-status").innerText(),
        new RegExp(`上${y}px／${len}×1px`),
      );
      await fs.writeFile(
        path.join(dir, `exterior-before-${slot}.png`),
        Buffer.from(before.split(",")[1], "base64"),
      );
      const row = p
        .locator("#residue-candidates > div")
        .filter({ hasText: `${len}×1px` });
      await row.locator("button").click();
      for (const bg of ["gray", "black"]) {
        await p.selectOption("#residue-background", bg);
        await p
          .locator("#residue-viewport")
          .screenshot({ path: path.join(dir, `exterior-${slot}-${bg}.png`) });
      }
      assert.equal(
        await p.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
        before,
        "preview inspection cannot alter pixels",
      );
      await row.locator("input").check();
      approve = false;
      await p.click("#remove-residue");
      approve = true;
      assert.equal(
        await p.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
        before,
        "cancelling deletion must preserve all pixels",
      );
      await p.click("#remove-residue");
      const after = await p
        .locator("#edit-canvas")
        .evaluate((c) => c.toDataURL());
      assert.notEqual(after, before);
      const nativeAfter = await p.evaluate(
        (n) => Array.from(fixtureStamps[n].mask),
        slot,
      );
      for (let i = 0; i < nativeBefore.length; i++)
        assert.equal(
          nativeAfter[i],
          i >= y * 370 + 130 && i < y * 370 + 130 + len ? 0 : nativeBefore[i],
          `slot ${slot}, native pixel ${i}`,
        );
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
      const wait = p.waitForEvent("download");
      await p.click("#download-single");
      const download = await wait;
      assert.equal(
        download.suggestedFilename(),
        String(slot).padStart(2, "0") + ".png",
      );
      await download.saveAs(path.join(dir, `exterior-single-${slot}.png`));
      const result = await p.evaluate(
        ({ slot, y, len }) => {
          const c = document.querySelector("#edit-canvas"),
            image = c.getContext("2d").getImageData(0, 0, 370, 320);
          let residual = 0;
          for (let x = 130; x < 130 + len; x++)
            residual += image.data[(y * 370 + x) * 4 + 3] > 0;
          const m = fixtureStamps[slot].mask;
          return {
            residual,
            body: m[180 * 370 + 100],
            whiteDecoration: m[50 * 370 + 320],
            leaf: m[55 * 370 + 300],
            eye: m[150 * 370 + 120],
          };
        },
        { slot, y, len },
      );
      assert.deepEqual(result, {
        residual: 0,
        body: 255,
        whiteDecoration: 255,
        leaf: 255,
        eye: 255,
      });
      evidence.push({ slot, y, width: len, height: 1, before: len, after: 0 });
      await p.click("#close-dialog");
      // Native dialog.close queues its close event; the gallery is repainted there.
      await p.waitForFunction(
        ({ slot, expected }) =>
          document.querySelectorAll(".stamp-canvas")[slot - 1]?.toDataURL() ===
          expected,
        { slot, expected: after },
      );
      assert.equal(
        await p
          .locator(".stamp-canvas")
          .nth(slot - 1)
          .evaluate((c) => c.toDataURL()),
        after,
        "editor and gallery match",
      );
    }
    // Real typography layer, all six presets: auditing must never suggest glyphs, stroke or shadow components.
    const typeChecks = await p.evaluate(() => {
      const C = StampCore,
        T = StampTypography,
        R = StampResidue,
        checks = [];
      for (const preset of Object.keys(T.PRESETS)) {
        const s = fixtureStamps[1],
          caption = s.caption,
          style = s.style;
        s.caption = "ありがとう！";
        s.style = {
          ...T.presetStyle(preset, s.caption),
          shadow: 6,
          angle: 15,
          overrides: ["shadow", "angle"],
        };
        const rendered = C.renderStamp(s),
          text = C.canvas(370, 320);
        T.paintPlan(text.getContext("2d"), rendered.textPlan);
        const rgba = text.getContext("2d").getImageData(0, 0, 370, 320).data,
          coverage = Uint8ClampedArray.from(
            { length: 370 * 320 },
            (_, i) => rgba[i * 4 + 3],
          );
        const image = rendered.canvas
            .getContext("2d")
            .getImageData(0, 0, 370, 320),
          before = rendered.canvas.toDataURL(),
          scan = R.analyse(
            image,
            Uint8ClampedArray.from(
              { length: 370 * 320 },
              (_, i) => image.data[i * 4 + 3],
            ),
            undefined,
            true,
          ),
          audit = R.inspectFinal(image, coverage);
        const ids = new Set(audit.candidates.map((x) => x.id));
        let protectedPixels = 0;
        for (let i = 0; i < coverage.length; i++)
          if (coverage[i]) {
            protectedPixels++;
            if (ids.has(scan.labels[i]))
              throw Error("text was offered for removal");
          }
        checks.push({
          preset,
          protectedPixels,
          overlap: rendered.textOverlap,
          clipped: rendered.textClipped,
          unchanged: before === rendered.canvas.toDataURL(),
        });
        s.caption = caption;
        s.style = style;
        text.width =
          text.height =
          rendered.canvas.width =
          rendered.canvas.height =
            1;
      }
      return checks;
    });
    assert.equal(typeChecks.length, 6);
    assert(
      typeChecks.every(
        (x) =>
          x.protectedPixels > 100 && !x.overlap && !x.clipped && x.unchanged,
      ),
    );
    const hashes = await p
      .locator(".stamp-canvas")
      .evaluateAll(async (canvases) => {
        const result = [];
        for (const c of canvases) {
          const rgba = c.getContext("2d").getImageData(0, 0, 370, 320).data;
          result.push(
            Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", rgba)),
            )
              .map((x) => x.toString(16).padStart(2, "0"))
              .join(""),
          );
        }
        return result;
      });
    await fs.writeFile(
      path.join(dir, "exterior-preview-hashes.json"),
      JSON.stringify(hashes),
    );
    const wait = p.waitForEvent("download", { timeout: 120000 });
    await p.click("#download-button");
    await (await wait).saveAs(path.join(dir, "exterior-test-10.zip"));
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    await fs.writeFile(
      path.join(dir, "exterior-evidence.json"),
      JSON.stringify(
        {
          synthetic: true,
          userZipAvailable: false,
          lines: evidence,
          typography: typeChecks,
        },
        null,
        2,
      ),
    );
    // A reviewable 4x comparison, built from PNG files actually saved above.
    const report = await browser.newPage({
      viewport: { width: 1000, height: 1000 },
      deviceScaleFactor: 1,
    });
    await report.setContent(
      "<style>body{font:16px sans-serif;margin:12px}main{display:grid;grid-template-columns:460px 460px;gap:12px}figure{margin:0}figcaption{padding:6px}canvas{display:block}img{width:460px;image-rendering:pixelated}</style><main></main>",
    );
    for (const number of [9, 10])
      for (const state of ["before", "single"]) {
        const bytes = await fs.readFile(
          path.join(dir, `exterior-${state}-${number}.png`),
        );
        await report.evaluate(
          async ({ number, state, src }) => {
            const image = new Image();
            image.src = src;
            await image.decode();
            const figure = document.createElement("figure"),
              caption = document.createElement("figcaption"),
              canvas = document.createElement("canvas");
            caption.textContent = `Synthetic ${number} ${state === "before" ? "before" : "after approval"}: top edge 4x`;
            canvas.width = 460;
            canvas.height = 200;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = number === 9 ? "#777" : "#000";
            ctx.fillRect(0, 0, 460, 200);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(image, 100, 0, 115, 50, 0, 0, 460, 200);
            figure.append(caption, canvas);
            document.querySelector("main").append(figure);
          },
          {
            number,
            state,
            src: "data:image/png;base64," + bytes.toString("base64"),
          },
        );
      }
    for (const number of [9, 10]) {
      const bytes = await fs.readFile(
        path.join(dir, `exterior-single-${number}.png`),
      );
      await report.evaluate(
        async ({ number, src }) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const figure = document.createElement("figure"),
            caption = document.createElement("figcaption");
          caption.textContent = `Synthetic final PNG ${number}: white body / ornament / leaf / face`;
          image.style.background = "#333";
          figure.append(caption, image);
          document.querySelector("main").append(figure);
        },
        { number, src: "data:image/png;base64," + bytes.toString("base64") },
      );
    }
    await report.screenshot({
      path: path.join(dir, "exterior-png-comparison.png"),
      fullPage: true,
    });
    await report.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      "PASS: exact 49×1px at y25 and 16×1px at y10 reproduced inside body bounding boxes; approval/cancel/undo/redo; all other native alpha bytes unchanged; single PNG / gallery / test ZIP; six real Japanese text layers protected; zero external requests",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
