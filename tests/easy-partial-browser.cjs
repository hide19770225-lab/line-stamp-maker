"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173",
  dir = process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-partial-results";
const captions = [
  "ありがとう",
  "おはよう",
  "こんにちは",
  "こんばんは",
  "おやすみ",
  "了解です",
  "おつかれさま",
  "よろしくね",
  "ごめんね",
  "だいすき",
];
(async () => {
  await fs.mkdir(dir, { recursive: true });
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const previous of [true, false]) {
      const p = await b.newPage({
        ...devices["iPhone 13"],
        acceptDownloads: true,
      });
      const errors = [],
        external = [];
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("dialog", (d) => d.accept());
      p.on("request", (r) => {
        if (![base, "data:", "blob:"].some((s) => r.url().startsWith(s)))
          external.push(r.url());
      });
      await p.goto(base);
      const idle = () =>
        p.waitForFunction(
          () => !document.body.classList.contains("busy"),
          {},
          { timeout: 120000 },
        );
      await p.evaluate(() => {
        window.partialStamps = {};
        const render = StampCore.renderStamp;
        StampCore.renderStamp = (s, t) => {
          if (s.slot) partialStamps[s.slot] = s;
          return render(s, t);
        };
      });
      const bytes = await p.evaluate(() => {
        const c = StampCore.canvas(600, 1500),
          x = c.getContext("2d");
        x.fillStyle = "white";
        x.fillRect(0, 0, 600, 1500);
        for (let i = 0; i < 10; i++) {
          const col = i % 2,
            row = Math.floor(i / 2);
          x.fillStyle = "#579f65";
          x.fillRect(col * 300 + 70, row * 300 + 50, 160, 200);
          x.fillStyle = "white";
          x.fillRect(col * 300 + 110, row * 300 + 180, 80, 40);
        }
        return c.toDataURL().split(",")[1];
      });
      const file = {
        name: "ten-stickers.png",
        mimeType: "image/png",
        buffer: Buffer.from(bytes, "base64"),
      };
      if (previous) {
        await p.setInputFiles("#file-input", file);
        await idle();
        await p.click("#process-button");
        await idle();
        assert.equal(
          await p.locator(".stamp-caption").first().textContent(),
          "（セリフなし）",
        );
      }
      await p.selectOption("#production-mode", "easy");
      if (!previous) {
        await p.setInputFiles("#easy-files", file);
        await idle();
      }
      assert.equal(await p.inputValue("#easy-target"), "40");
      const verify = async (expected, stem) => {
        assert.deepEqual(
          await p.locator(".stamp-caption").allTextContents(),
          expected,
        );
        const reports = await p.evaluate(async () => {
          const reports = [];
          for (const s of Object.values(partialStamps).sort(
            (a, b) => a.slot - b.slot,
          )) {
            const r = StampCore.renderStamp(s),
              none = StampCore.renderStamp({ ...s, caption: "" });
            const image = r.canvas
                .getContext("2d")
                .getImageData(0, 0, 370, 320).data,
              plain = none.canvas
                .getContext("2d")
                .getImageData(0, 0, 370, 320).data;
            let changed = 0;
            for (let i = 0; i < image.length; i++)
              if (image[i] !== plain[i]) changed++;
            const c = document.querySelectorAll(".stamp-canvas")[s.slot - 1],
              gallery = c.getContext("2d").getImageData(0, 0, 370, 320).data;
            const audit = document.querySelector(
                `.bulk-result[data-name="${String(s.slot).padStart(2, "0")}.png"] canvas`,
              ),
              inspection = audit
                .getContext("2d")
                .getImageData(0, 0, 370, 320).data;
            const textCanvas = StampCore.canvas(370, 320);
            StampTypography.paintPlan(textCanvas.getContext("2d"), r.textPlan);
            const ink = textCanvas
              .getContext("2d")
              .getImageData(0, 0, 370, 320).data;
            let glyphPixels = 0,
              glyphMismatch = 0;
            for (let i = 0; i < ink.length; i += 4)
              if (ink[i + 3] === 255) {
                glyphPixels++;
                if (
                  image[i] !== ink[i] ||
                  image[i + 1] !== ink[i + 1] ||
                  image[i + 2] !== ink[i + 2]
                )
                  glyphMismatch++;
              }
            const hash = async (data) =>
              Array.from(
                new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
                (v) => v.toString(16).padStart(2, "0"),
              ).join("");
            reports.push({
              slot: s.slot,
              caption: s.caption,
              paintedText: r.textPlan.text,
              glyphPixels,
              glyphMismatch,
              changed,
              hash: await hash(image),
              gallery: await hash(gallery),
              audit: await hash(inspection),
            });
          }
          return reports;
        });
        assert.equal(reports.length, 10);
        reports.forEach((r, i) => {
          assert.equal(r.slot, i + 1);
          assert.equal(r.caption, expected[i]);
          assert.equal(r.paintedText, expected[i]);
          assert(r.glyphPixels > 100, `no actual glyph pixels in ${r.slot}`);
          assert.equal(
            r.glyphMismatch,
            0,
            `Japanese paint pixels differ in ${r.slot}`,
          );
          assert(r.changed > 100, `Japanese glyphs missing in ${r.slot}`);
          assert.equal(r.hash, r.gallery);
          assert.equal(r.hash, r.audit);
        });
        await fs.writeFile(`${dir}/${stem}.json`, JSON.stringify(reports));
        return reports;
      };
      await p.fill("#easy-captions", captions.join("\n"));
      await p.click("#easy-process");
      await idle();
      const first = await verify(captions, `initial-${previous}`);
      assert.equal(await p.locator(".stamp-card.reviewed").count(), 0);
      assert(await p.locator("#bulk-confirm").isDisabled());
      assert.match(await p.locator("#bulk-summary").textContent(), /10\/40/);
      let downloads = 0;
      p.on("download", () => downloads++);
      await p.click("#easy-export");
      await idle();
      assert.equal(downloads, 0);
      assert.match(await p.locator("#easy-progress").textContent(), /全画像/);
      const revised = captions.map((s, i) => `修正版${i + 1}：${s}`);
      await p.fill("#easy-captions", revised.join("\n"));
      await p.click("#easy-process");
      await idle();
      const after = await verify(revised, `revised-${previous}`);
      after.forEach((r, i) => assert.notEqual(r.hash, first[i].hash));
      // The existing explicit test-ZIP remains available; application ZIP from easy mode stays blocked.
      const d = p.waitForEvent("download");
      await p.click("#download-button");
      const download = await d;
      assert.equal(download.suggestedFilename(), "line-stamps-test-10.zip");
      await download.saveAs(`${dir}/partial-${previous}.zip`);
      await idle();
      await p.locator(".stamp-card").nth(8).click();
      const single = p.waitForEvent("download");
      await p.click("#download-single");
      await (await single).saveAs(`${dir}/09-${previous}.png`);
      await idle();
      await p.click("#close-dialog");
      await p.selectOption("#production-mode", "normal");
      assert(await p.locator(".project-panel").isVisible());
      assert.deepEqual(
        await p.locator(".stamp-caption").allTextContents(),
        revised,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      await p.close();
      console.log(
        `PASS partial 10/40 (${previous ? "existing blank results" : "fresh source"}): all Japanese captions painted, gallery/audit pixels match, updates replace old output, application ZIP remains blocked`,
      );
    }
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
