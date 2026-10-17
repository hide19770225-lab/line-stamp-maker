"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173";
const dir = process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-bulk-results";
(async () => {
  await fs.mkdir(dir, { recursive: true });
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const n of [8, 16, 24, 32, 40]) {
      const p = await b.newPage({
        ...devices["iPhone 13"],
        acceptDownloads: true,
      });
      const errors = [],
        external = [];
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("request", (r) => {
        if (![base, "blob:", "data:"].some((s) => r.url().startsWith(s)))
          external.push(r.url());
      });
      p.on("dialog", (d) => d.accept());
      await p.goto(base);
      const idle = () =>
        p.waitForFunction(() => !document.body.classList.contains("busy"));
      await p.evaluate(() => {
        window.fixtures = {};
        const render = StampCore.renderStamp;
        StampCore.renderStamp = (s, t) => {
          if (s.slot) fixtures[s.slot] = s;
          return render(s, t);
        };
      });
      await p.selectOption("#target-count", String(n));
      await p.selectOption("#default-layout", "5x8");
      const data = await p.evaluate(() => {
        const c = StampCore.canvas(600, 960),
          x = c.getContext("2d");
        x.fillStyle = "white";
        x.fillRect(0, 0, 600, 960);
        for (let i = 0; i < 40; i++) {
          x.fillStyle = "#6a9e51";
          x.fillRect((i % 5) * 120 + 30, Math.floor(i / 5) * 120 + 30, 60, 60);
          x.fillStyle = "white";
          x.fillRect((i % 5) * 120 + 45, Math.floor(i / 5) * 120 + 60, 30, 20);
        }
        return c.toDataURL().split(",")[1];
      });
      await p.setInputFiles("#file-input", {
        name: "40.png",
        mimeType: "image/png",
        buffer: Buffer.from(data, "base64"),
      });
      await idle();
      await p.click("#process-all");
      await idle();
      const snapshot = () =>
        p.evaluate(() =>
          Object.values(fixtures)
            .sort((a, b) => a.slot - b.slot)
            .map((s) => ({
              png: StampCore.renderStamp(s).canvas.toDataURL(),
              caption: s.caption,
              slot: s.slot,
              style: JSON.stringify(s.style),
              layout: JSON.stringify(s.layout),
            })),
        );
      const before = await snapshot();
      const evidence = async (name) => {
        const hashes = await p.evaluate(async () => {
          const outputs = Object.values(fixtures)
            .sort((a, b) => a.slot - b.slot)
            .map((s) => [
              `${String(s.slot).padStart(2, "0")}.png`,
              StampCore.renderStamp(s).canvas,
            ]);
          outputs.push(
            ["main.png", document.querySelector("#main-preview")],
            ["tab.png", document.querySelector("#tab-preview")],
          );
          const result = {};
          for (const [name, c] of outputs) {
            const rgba = c
              .getContext("2d")
              .getImageData(0, 0, c.width, c.height).data;
            const hash = await crypto.subtle.digest("SHA-256", rgba);
            result[name] = Array.from(new Uint8Array(hash), (v) =>
              v.toString(16).padStart(2, "0"),
            ).join("");
          }
          return result;
        });
        await fs.writeFile(`${dir}/${name}.json`, JSON.stringify(hashes));
      };
      await p.click("#bulk-inspect");
      await idle();
      await p.waitForFunction(
        () => !document.querySelector("#bulk-visual").disabled,
      );
      assert.equal(await p.locator(".bulk-result").count(), n + 2);
      assert.equal(
        await p.locator(".stamp-card.reviewed").count(),
        0,
        "automatic pass is not visual confirmation",
      );
      assert(await p.locator("#bulk-confirm").isDisabled());
      assert.equal(
        await p.locator('.bulk-result[data-status="エラー"]').count(),
        0,
      );
      await p.selectOption("#preview-background", "dark");
      assert.equal(
        await p.locator("#bulk-results").getAttribute("class"),
        "bulk-results dark",
      );
      if (n === 40) {
        await p.locator("#bulk-review-heading").scrollIntoViewIfNeeded();
        await p.screenshot({ path: `${dir}/mobile-bulk-viewport.png` });
      }
      await p.check("#bulk-visual");
      await p.click("#bulk-confirm");
      assert.equal(await p.locator(".stamp-card.reviewed").count(), n);
      assert.deepEqual(
        await snapshot(),
        before,
        "bulk review must preserve all rendered pixels, captions, numbering and settings",
      );
      await evidence(`bulk-${n}`);
      const d = p.waitForEvent("download");
      await p.click("#download-button");
      await (await d).saveAs(`${dir}/bulk-${n}.zip`);
      await idle();
      if (n === 40) {
        await p.click("#bulk-inspect");
        await idle();
        await p.locator('.bulk-result[data-name="09.png"] button').click();
        await p.locator("#image-scale").fill("80");
        assert.equal(await p.locator("#reviewed-checkbox").isChecked(), false);
        await p.click("#close-dialog");
        // dialog.close() queues a close event; wait for its gallery refresh.
        await p.waitForFunction(
          () =>
            !document.querySelector("#stamp-dialog").open &&
            document.querySelectorAll(".stamp-card.reviewed").length === 39,
        );
        assert.equal(await p.locator(".stamp-card.reviewed").count(), 39);
        assert(await p.locator("#bulk-confirm").isDisabled());
        await p.click("#download-button");
        await idle();
        assert.match(await p.locator("#status").textContent(), /あと1個/);
        await p.click("#bulk-inspect");
        await idle();
        await p.check("#bulk-visual");
        await p.click("#bulk-confirm");
        assert.equal(await p.locator(".stamp-card.reviewed").count(), 40);
        await evidence("bulk-40-edited");
        const d2 = p.waitForEvent("download");
        await p.click("#download-button");
        await (await d2).saveAs(`${dir}/bulk-40-edited.zip`);
        await idle();
        // Caption edits invalidate only the affected individual confirmation.
        await p.locator(".caption-details summary").click();
        await p.locator("#caption-list input").nth(9).fill("ありがとう");
        await p.locator("#caption-list input").nth(9).dispatchEvent("change");
        assert.equal(await p.locator(".stamp-card.reviewed").count(), 39);
        // Empty render must not be silently accepted by bulk confirmation.
        await p.evaluate(() => fixtures[10].mask.fill(0));
        // Clear caption via actual UI so there is no residual text-only output.
        await p.locator("#caption-list input").nth(9).fill("");
        await p.locator("#caption-list input").nth(9).dispatchEvent("change");
        await p.click("#bulk-inspect");
        await idle();
        assert.match(
          await p.locator('.bulk-result[data-name="10.png"]').textContent(),
          /エラー.*画像が空/s,
        );
        assert(await p.locator("#bulk-visual").isDisabled());
        assert(await p.locator("#bulk-confirm").isDisabled());
        // An opaque isolated line is uncertain, so show it without deleting or auto-reviewing.
        await p.evaluate(() => {
          const s = fixtures[10];
          s.mask.set(s.autoMask);
          s.layout.scale = 50;
          for (let x = 45; x < 65; x++) s.mask[5 * s.original.width + x] = 255;
        });
        await p.selectOption("#main-select", "2");
        assert(await p.locator("#bulk-confirm").isDisabled());
        const warningBefore = await snapshot();
        await p.click("#bulk-inspect");
        await idle();
        assert.equal(
          await p
            .locator('.bulk-result[data-name="10.png"]')
            .getAttribute("data-status"),
          "要確認",
        );
        assert.equal(await p.locator(".stamp-card.reviewed").count(), 39);
        await p.check("#bulk-visual");
        await p.click("#bulk-confirm");
        assert.equal(await p.locator(".stamp-card.reviewed").count(), 40);
        assert.deepEqual(
          await snapshot(),
          warningBefore,
          "review candidates must remain byte-for-byte intact",
        );
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await p.screenshot({ path: `${dir}/mobile-bulk.png`, fullPage: true });
      }
      if (n === 8) {
        await p.selectOption("#target-count", "16");
        await p.click("#bulk-inspect");
        await idle();
        assert(await p.locator("#bulk-visual").isDisabled());
        assert(await p.locator("#bulk-confirm").isDisabled());
        assert.match(await p.locator("#bulk-summary").textContent(), /未加工/);
        assert.equal(
          await p
            .locator('.bulk-result[data-name="16.png"]')
            .getAttribute("data-status"),
          "エラー",
        );
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      await p.close();
      console.log(
        `PASS bulk ${n}+2: read-only audit, explicit visual confirmation, ZIP; 40 includes individual edit/recheck, invalidation and empty error blocking`,
      );
    }
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
