"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4672",
  input = process.env.STAMP_REFERENCE_INPUT || "/tmp/stamp-reference-input";
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const count of [10, 40]) {
      const p = await b.newPage({
          ...devices["iPhone 13"],
          acceptDownloads: true,
        }),
        errors = [],
        external = [];
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("request", (r) => {
        if (![base, "blob:", "data:"].some((s) => r.url().startsWith(s)))
          external.push(r.url());
      });
      p.on("dialog", (d) => d.accept());
      await p.goto(base);
      await p.evaluate(() => {
        window.actual = {};
        const render = StampCore.renderStamp;
        StampCore.renderStamp = (s, t) => {
          if (s.slot) actual[s.slot] = s;
          return render(s, t);
        };
      });
      if (count === 40) await p.selectOption("#production-mode", "easy");
      const idle = () =>
        p.waitForFunction(
          () => !document.body.classList.contains("busy"),
          null,
          { timeout: 120000 },
        );
      await p.setInputFiles(
        count === 40 ? "#easy-files" : "#file-input",
        Array.from({ length: count / 10 }, (_, i) => `${input}/sheet-${i}.png`),
      );
      await idle();
      const expected = [
        "wave",
        "bow",
        "approve",
        "worried",
        "joy",
        "cry",
        "surprised",
        "angry",
        "sleepy",
        "love",
      ];
      const rows = await p
        .locator(".suggestion-card select")
        .evaluateAll((els) => els.map((e) => e.value));
      assert.equal(rows.length, count);
      rows.forEach((r, i) =>
        assert.equal(r, expected[i % 10], `slot ${i + 1}`),
      );
      const reversed = await p.evaluate(() =>
        Object.values(actual)
          .reverse()
          .map((s) => StampSuggestions.analyze(s.original, s.mask).emotion),
      );
      assert.deepEqual(reversed, [...rows].reverse());
      const before = await p
        .locator('.suggestion-card input[data-kind="caption"]')
        .evaluateAll((els) => els.map((e) => e.value));
      assert.equal(new Set(before).size, count);
      assert.ok(
        (await p.locator(".stamp-caption").allTextContents()).every(
          (t) => t === "（セリフなし）",
        ),
      );
      const native = await p.evaluate(() =>
        Object.values(actual).map((s) => [
          Array.from(s.original.data).reduce(
            (a, v) => Math.imul(a ^ v, 16777619) >>> 0,
            0,
          ),
          Array.from(s.mask).reduce(
            (a, v) => Math.imul(a ^ v, 16777619) >>> 0,
            0,
          ),
        ]),
      );
      await p.check("#resuggest-existing");
      await p.click("#auto-captions");
      await idle();
      assert.deepEqual(
        await p
          .locator('.suggestion-card input[data-kind="caption"]')
          .evaluateAll((els) => els.map((e) => e.value)),
        before,
      );
      await p
        .locator('.suggestion-card input[data-kind="caption"]')
        .nth(0)
        .fill("やっほー！");
      await p.check("#suggestion-ack");
      await p.click("#approve-suggestions");
      await idle();
      const report = await p.evaluate(() =>
        Promise.all(
          Object.values(actual).map(async (s) => {
            const r = StampCore.renderStamp(s),
              d = r.canvas.getContext("2d").getImageData(0, 0, 370, 320).data;
            let edge = 0;
            for (let y = 0; y < 320; y++)
              for (let x = 0; x < 370; x++)
                if (x < 20 || x >= 350 || y < 20 || y >= 300)
                  edge += d[(y * 370 + x) * 4 + 3];
            return {
              slot: s.slot,
              caption: s.caption,
              clipped: r.textClipped,
              previewHash: Array.from(
                new Uint8Array(
                  await crypto.subtle.digest(
                    "SHA-256",
                    document
                      .querySelectorAll("#stamp-grid canvas")
                      [s.slot - 1].getContext("2d")
                      .getImageData(0, 0, 370, 320).data,
                  ),
                ),
                (v) => v.toString(16).padStart(2, "0"),
              ).join(""),
              hash: Array.from(
                new Uint8Array(await crypto.subtle.digest("SHA-256", d)),
                (v) => v.toString(16).padStart(2, "0"),
              ).join(""),
              overlap: r.textOverlap,
              edge,
            };
          }),
        ),
      );
      assert.ok(
        report.every(
          (r) =>
            r.caption &&
            r.clipped === false &&
            r.overlap === 0 &&
            r.edge === 0 &&
            r.previewHash === r.hash,
        ),
      );
      assert.deepEqual(
        await p.locator(".stamp-caption").allTextContents(),
        report.map((r) => r.caption),
      );
      assert.deepEqual(
        await p.evaluate(() =>
          Object.values(actual).map((s) => [
            Array.from(s.original.data).reduce(
              (a, v) => Math.imul(a ^ v, 16777619) >>> 0,
              0,
            ),
            Array.from(s.mask).reduce(
              (a, v) => Math.imul(a ^ v, 16777619) >>> 0,
              0,
            ),
          ]),
        ),
        native,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      // Negative controls and ambiguous inputs must abstain; input order never enters the matcher.
      const negative = await p.evaluate(() => {
        const w = 80,
          h = 80,
          d = new Uint8ClampedArray(w * h * 4),
          m = new Uint8ClampedArray(w * h);
        for (let i = 0; i < m.length; i++) {
          d.set([60, 70, 220, 255], i * 4);
          m[i] = 255;
        }
        return StampSuggestions.analyze({ width: w, height: h, data: d }, m);
      });
      assert.equal(negative.emotion, "unknown");
      await fs.mkdir("/tmp/reference-results", { recursive: true });
      await fs.writeFile(
        `/tmp/reference-results/report-${count}.json`,
        JSON.stringify(report),
      );
      await p.click("#bulk-inspect");
      await idle();
      assert.equal(
        await p.locator('.bulk-result[data-status="エラー"]').count(),
        count === 40 ? 0 : 30,
      );
      if (count === 40) {
        await p.check("#bulk-visual");
        await p.click("#bulk-confirm");
      } else {
        await p.selectOption("#production-mode", "easy");
        await p.click("#easy-export");
        assert.match(await p.locator("#easy-progress").textContent(), /全画像/);
        await p.selectOption("#production-mode", "normal");
      }
      const download = p.waitForEvent("download", { timeout: 120000 });
      await p.click(count === 40 ? "#easy-export" : "#download-button");
      await (
        await download
      ).saveAs(`/tmp/reference-results/suggestions-${count}.zip`);
      await idle();
      await fs.writeFile(
        `/tmp/reference-results/suggestions-${count}.json`,
        JSON.stringify(report),
      );
      console.log(
        `PASS ${count}: real supplied images resized/repositioned, 10 distinct poses, automatic inputs, stable repeat, no unnecessary duplicates, approval, Japanese layout, unchanged RGB/masks, no external requests`,
      );
      await p.close();
    }
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
