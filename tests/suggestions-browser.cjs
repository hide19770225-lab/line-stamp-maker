"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173",
  dir = process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-suggestion-results";
(async () => {
  await fs.mkdir(dir, { recursive: true });
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
      p.on("dialog", (d) => d.accept());
      p.on("request", (r) => {
        if (![base, "blob:", "data:"].some((s) => r.url().startsWith(s)))
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
        window.featureStamps = {};
        window.featureCalls = {};
        const render = StampCore.renderStamp;
        StampCore.renderStamp = (s, t) => {
          if (s.slot) {
            featureStamps[s.slot] = s;
            featureCalls[s.slot] = (featureCalls[s.slot] || 0) + 1;
          }
          return render(s, t);
        };
      });
      await p.selectOption("#production-mode", "easy");
      const files = [];
      for (let sheet = 0; sheet < count / 10; sheet++) {
        const data = await p.evaluate((sheet) => {
          const c = StampCore.canvas(800, 1600),
            x = c.getContext("2d");
          x.fillStyle = "white";
          x.fillRect(0, 0, 800, 1600);
          for (let i = 0; i < 10; i++) {
            const a = (i % 2) * 400,
              b = Math.floor(i / 2) * 320;
            x.fillStyle = `rgb(${60 + sheet * 20},145,95)`;
            x.fillRect(a + 90, b + 85, 220, 210);
            x.beginPath();
            x.ellipse(a + 180, b + 55, 20, 32, 0, 0, Math.PI * 2);
            x.fill();
            x.fillStyle = "white";
            x.fillRect(a + 150, b + 190, 90, 60);
            x.fillStyle = "#e95678";
            x.beginPath();
            x.arc(a + 340, b + 100, 12, 0, Math.PI * 2);
            x.fill();
          }
          return c.toDataURL().split(",")[1];
        }, sheet);
        files.push({
          name: `ten-${sheet}.png`,
          mimeType: "image/png",
          buffer: Buffer.from(data, "base64"),
        });
      }
      await p.setInputFiles("#easy-files", files);
      await idle();
      await p.click("#easy-process");
      await idle();
      assert.equal(await p.locator(".stamp-card").count(), count);
      const native = () =>
        p.evaluate(async () => {
          const result = {};
          for (const s of Object.values(featureStamps)) {
            const bytes = new Uint8Array(
              s.original.data.length + s.mask.length,
            );
            bytes.set(s.original.data);
            bytes.set(s.mask, s.original.data.length);
            result[s.slot] = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
              (v) => v.toString(16).padStart(2, "0"),
            ).join("");
          }
          return result;
        });
      const before = await native();
      await p.locator("#suggestion-panel").evaluate((el) => {
        el.open = true;
      });
      await p.waitForFunction(
        (n) => document.querySelectorAll(".suggestion-card").length === n,
        count,
      );
      assert.equal(await p.locator(".suggestion-card").count(), count);
      for (let i = 0; i < count; i++)
        assert.equal(
          await p.locator(".suggestion-card select").nth(i).inputValue(),
          "unknown",
        );
      await p.click("#suggest-all");
      assert(
        (await p.locator(".stamp-caption").allTextContents()).every(
          (s) => s === "（セリフなし）",
        ),
      );
      const emotions = [
        "smile",
        "cry",
        "angry",
        "surprised",
        "sleepy",
        "greeting",
        "support",
      ];
      for (let i = 0; i < count; i++)
        await p
          .locator(".suggestion-card select")
          .nth(i)
          .selectOption(emotions[i % emotions.length]);
      const captions = p.locator('.suggestion-card input[data-kind="caption"]');
      await captions.nth(0).fill("ありがとう");
      await captions.nth(1).fill("ありがとう");
      assert.match(
        await p.locator("#suggestion-summary").textContent(),
        /重複警告/,
      );
      await p.click("#approve-suggestions");
      await idle();
      assert(
        (await p.locator(".stamp-caption").allTextContents()).every(
          (s) => s === "（セリフなし）",
        ),
        "unapproved drafts must not alter images",
      );
      await captions
        .nth(0)
        .fill("いつもありがとうございますまたいっしょに遊びましょうね");
      if (count === 10) {
        await captions.nth(2).evaluate((input) => {
          input.value = "入力復元の確認";
        });
        await p.check("#suggestion-ack");
        await p.click("#approve-suggestions");
        await idle();
        assert.match(await p.locator("#status").textContent(), /復元・変更/);
        assert.equal(await p.locator("#suggestion-ack").isChecked(), false);
        assert(
          (await p.locator(".stamp-caption").allTextContents()).every(
            (text) => text === "（セリフなし）",
          ),
        );
      }
      const expected = await captions.evaluateAll((nodes) =>
        nodes.map((n) => n.value),
      );
      await p.check("#suggestion-ack");
      await p.click("#approve-suggestions");
      await idle();
      assert.deepEqual(
        await p.locator(".stamp-caption").allTextContents(),
        expected,
      );
      assert.equal(await p.locator(".stamp-card.reviewed").count(), 0);
      assert.deepEqual(await native(), before);
      const inspect = () =>
        p.evaluate(async () => {
          const reports = [];
          for (const s of Object.values(featureStamps).sort(
            (a, b) => a.slot - b.slot,
          )) {
            const r = StampCore.renderStamp(s),
              c = r.canvas,
              d = c.getContext("2d").getImageData(0, 0, 370, 320).data;
            let edge = 0;
            for (let y = 0; y < 320; y++)
              for (let x = 0; x < 370; x++)
                if (x < 20 || x >= 350 || y < 20 || y >= 300)
                  edge += d[(y * 370 + x) * 4 + 3] > 0 ? 1 : 0;
            const hash = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", d)),
              (v) => v.toString(16).padStart(2, "0"),
            ).join("");
            reports.push({
              slot: s.slot,
              caption: s.caption,
              hash,
              edge,
              overlap: r.textOverlap,
              clipped: r.textClipped,
              font: r.effectiveFontSize,
              lines: r.textPlan?.height,
              safe: s.style.safeMargin,
            });
          }
          return reports;
        });
      let reports = await inspect();
      for (const r of reports) {
        assert.equal(r.edge, 0);
        assert.equal(r.overlap, 0);
        assert.equal(r.clipped, false);
        assert.equal(r.safe, 20);
      }
      assert(
        reports[0].lines > reports[0].font * 1.25,
        "long Japanese text must wrap",
      );
      const bulk = async () => {
        await p.click("#bulk-inspect");
        await idle();
        assert.equal(
          await p.locator('.bulk-result[data-status="エラー"]').count(),
          0,
        );
        await p.check("#bulk-visual");
        await p.click("#bulk-confirm");
      };
      if (count === 40) await bulk();
      await p
        .locator('.suggestion-card input[data-kind="caption"]')
        .nth(8)
        .fill("個別の修正です");
      await p.evaluate(() => {
        window.featureCalls = {};
      });
      if (count === 10) {
        await p.evaluate(() => {
          const render = StampCore.renderStamp;
          window.restoreProposalRender = () => (StampCore.renderStamp = render);
          StampCore.renderStamp = (stamp, target) => {
            if (stamp.slot === 9)
              throw new Error("TEST proposal rendering failure");
            return render(stamp, target);
          };
        });
        await p.check("#suggestion-ack");
        await p.click("#approve-suggestions");
        await idle();
        assert.match(
          await p.locator("#status").textContent(),
          /TEST proposal rendering failure/,
        );
        await p.click("#download-button");
        await idle();
        assert.match(
          await p.locator("#status").textContent(),
          /画像生成が未完了/,
        );
        await p.evaluate(() => restoreProposalRender());
      }
      await p.check("#suggestion-ack");
      await p.click("#approve-suggestions");
      await idle();
      const calls = await p.evaluate(() => featureCalls);
      if (count === 40)
        assert.deepEqual(
          Object.keys(calls),
          ["9"],
          "only changed image is re-rendered, including validation and main/tab",
        );
      assert.deepEqual(await native(), before);
      assert.equal(
        await p.locator(".stamp-card.reviewed").count(),
        count === 40 ? 39 : 0,
      );
      reports = await inspect();
      await fs.writeFile(
        `${dir}/suggestions-${count}.json`,
        JSON.stringify(reports),
      );
      if (count === 40) await bulk();
      else {
        assert(await p.locator("#bulk-confirm").isDisabled());
        await p.click("#easy-export");
        assert.match(await p.locator("#easy-progress").textContent(), /全画像/);
      }
      const d = p.waitForEvent("download", { timeout: 120000 });
      await p.click(count === 40 ? "#easy-export" : "#download-button");
      await (await d).saveAs(`${dir}/suggestions-${count}.zip`);
      await idle();
      // JSON keeps optional 20px setting; normal mode remains available.
      await p.selectOption("#production-mode", "normal");
      const j = p.waitForEvent("download");
      await p.click("#save-project");
      await (await j).saveAs(`${dir}/suggestions-${count}-project.json`);
      const project = JSON.parse(
        await fs.readFile(`${dir}/suggestions-${count}-project.json`),
      );
      assert.equal(project.slots[8].style.safeMargin, 20);
      assert.equal(project.slots[8].caption, "個別の修正です");
      await p.locator(".stamp-card").nth(8).click();
      assert(await p.locator("#safe-layout").isChecked());
      // Native eraser mapping still works after automatic 20px placement; undo restores it.
      const maskBefore = await p.evaluate(() =>
        Array.from(featureStamps[9].mask),
      );
      await p.click('[data-brush="erase"]');
      await p.locator("#edit-canvas").scrollIntoViewIfNeeded();
      const point = await p.evaluate(() => {
        const s = featureStamps[9],
          a = StampCore.imagePlacement(s),
          b = document.querySelector("#edit-canvas").getBoundingClientRect();
        return {
          x: b.x + ((a.offsetX + 200 * a.ratio) / 370) * b.width,
          y: b.y + ((a.offsetY + 200 * a.ratio) / 320) * b.height,
        };
      });
      await p.touchscreen.tap(point.x, point.y);
      assert.notDeepEqual(
        await p.evaluate(() => Array.from(featureStamps[9].mask)),
        maskBefore,
      );
      await p.click("#undo-brush");
      assert.deepEqual(
        await p.evaluate(() => Array.from(featureStamps[9].mask)),
        maskBefore,
      );
      await p.click("#close-dialog");
      await p.setInputFiles(
        "#load-project",
        `${dir}/suggestions-${count}-project.json`,
      );
      await idle();
      await p.click("#process-all");
      await idle();
      const restoredReports = await inspect();
      assert.deepEqual(
        restoredReports.map((r) => r.hash),
        reports.map((r) => r.hash),
        "JSON restores exact captions, masks and 20px layout",
      );
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      await p.close();
      console.log(
        `PASS ${count}: manual emotions, draft/approval, duplicates, Japanese wrapping, 20px alpha margin, no overlaps, only changed slot rendered, native colors/mask preserved, JSON, touch eraser undo, ZIP`,
      );
    }
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
