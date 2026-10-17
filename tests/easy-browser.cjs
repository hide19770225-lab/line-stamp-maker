"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173",
  dir = process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-easy-results";
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
        }),
        errors = [],
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
        window.easyStamps = {};
        const render = StampCore.renderStamp;
        StampCore.renderStamp = (s, t) => {
          if (s.slot) easyStamps[s.slot] = s;
          return render(s, t);
        };
      });
      assert.equal(await p.locator("#easy-panel").isVisible(), false);
      await p.selectOption("#default-layout", "5x8");
      await p.selectOption("#production-mode", "easy");
      await p.selectOption("#easy-target", String(n));
      await p.click("#easy-process");
      await idle();
      assert.match(await p.locator("#easy-progress").textContent(), /不足/);
      const sheets = [];
      for (let sheet = 0; sheet < Math.ceil(n / 10); sheet++) {
        const data = await p.evaluate((sheet) => {
          const c = StampCore.canvas(600, 1500),
            x = c.getContext("2d");
          x.fillStyle = "white";
          x.fillRect(0, 0, 600, 1500);
          for (let j = 0; j < 10; j++) {
            let col = j % 2,
              row = Math.floor(j / 2),
              i = sheet * 10 + j;
            x.fillStyle = `rgb(${50 + i * 3},${90 + i * 2},80)`;
            x.fillRect(col * 300 + 60, row * 300 + 45, 180, 210);
            x.fillStyle = "white";
            x.fillRect(col * 300 + 110, row * 300 + 180, 80, 50);
          }
          return c.toDataURL().split(",")[1];
        }, sheet);
        sheets.push({
          name: `sheet-${sheet + 1}.png`,
          mimeType: "image/png",
          buffer: Buffer.from(data, "base64"),
        });
      }
      // Duplicate import warns and keeps the first source intact.
      await p.setInputFiles("#easy-files", [sheets[0], sheets[0]]);
      await idle();
      assert.match(await p.locator("#easy-warnings").textContent(), /重複/);
      assert.equal(await p.locator(".source-card").count(), 1);
      if (sheets.length > 1) {
        await p.setInputFiles("#easy-files", sheets.slice(1));
        await idle();
      }
      const captions = Array.from(
        { length: 40 },
        (_, i) => `ありがとう${String(i + 1).padStart(2, "0")}`,
      );
      await p.fill("#easy-captions", captions.join("\n"));
      await p.locator("#easy-panel details summary").click();
      await p.check("#easy-style-enabled");
      await p.selectOption("#easy-font", "rounded");
      await p.fill("#easy-size", "24");
      await p.fill("#easy-color", "#833b75");
      await p.click("#easy-process");
      await idle();
      assert.equal(await p.locator(".stamp-card").count(), n);
      assert.equal(await p.locator(".bulk-result").count(), n + 2);
      assert.equal(await p.locator(".stamp-card.reviewed").count(), 0);
      assert.equal(
        await p.locator('.bulk-result[data-status="エラー"]').count(),
        0,
      );
      assert.deepEqual(
        await p.locator(".stamp-caption").allTextContents(),
        captions.slice(0, n),
      );
      const settings = await p.evaluate(() =>
        Object.values(easyStamps)
          .sort((a, b) => a.slot - b.slot)
          .map((s) => ({
            slot: s.slot,
            style: StampTypography.resolve(s.caption, s.style),
          })),
      );
      const sourceColors = await p.evaluate(() =>
        Object.values(easyStamps)
          .sort((a, b) => a.slot - b.slot)
          .map((s) =>
            Array.from(
              s.original.data.slice(
                (80 * s.original.width + 80) * 4,
                (80 * s.original.width + 80) * 4 + 4,
              ),
            ),
          ),
      );
      assert.deepEqual(
        sourceColors,
        Array.from({ length: n }, (_, i) => [50 + i * 3, 90 + i * 2, 80, 255]),
        "read order must bind actual source cells to stable numbered captions",
      );
      assert.deepEqual(
        settings.map((s) => s.slot),
        Array.from({ length: n }, (_, i) => i + 1),
      );
      assert(
        settings.every(
          (s) =>
            s.style.font === "rounded" &&
            s.style.size === 24 &&
            s.style.color === "#833b75",
        ),
      );
      await p.click("#easy-export");
      assert.match(await p.locator("#easy-progress").textContent(), /目視確認/);
      assert(await p.locator("#bulk-confirm").isDisabled());
      await p.check("#bulk-visual");
      await p.click("#bulk-confirm");
      assert.equal(await p.locator(".stamp-card.reviewed").count(), n);
      const evidence = async (stem) => {
        const hashes = await p.evaluate(async () => {
          const result = {};
          const entries = Object.values(easyStamps)
            .sort((a, b) => a.slot - b.slot)
            .map((s) => [
              `${String(s.slot).padStart(2, "0")}.png`,
              StampCore.renderStamp(s).canvas,
            ]);
          entries.push(
            ["main.png", document.querySelector("#main-preview")],
            ["tab.png", document.querySelector("#tab-preview")],
          );
          for (const [name, c] of entries) {
            const rgba = c
              .getContext("2d")
              .getImageData(0, 0, c.width, c.height).data;
            result[name] = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", rgba)),
              (v) => v.toString(16).padStart(2, "0"),
            ).join("");
          }
          return result;
        });
        await fs.writeFile(`${dir}/${stem}.json`, JSON.stringify(hashes));
      };
      await evidence(`easy-${n}`);
      const d = p.waitForEvent("download");
      await p.click("#easy-export");
      const download = await d;
      assert.equal(download.suggestedFilename(), `line-stamps-${n}.zip`);
      await download.saveAs(`${dir}/easy-${n}.zip`);
      await idle();
      if (n === 40) {
        // User edit invalidates only that sticker; automatic retry preserves per-stamp edits.
        await p.locator(".stamp-card").nth(8).click();
        await p.locator("#caption-text").fill("個別修正");
        await p.locator("#font-size").fill("22");
        const edited = await p
          .locator("#edit-canvas")
          .evaluate((c) => c.toDataURL());
        await p.click("#close-dialog");
        assert.equal(await p.locator(".stamp-card.reviewed").count(), 39);
        await p.click("#easy-export");
        assert.match(
          await p.locator("#easy-progress").textContent(),
          /目視確認/,
        );
        await p.click("#easy-process");
        await idle();
        assert.equal(
          await p.evaluate(() =>
            StampCore.renderStamp(easyStamps[9]).canvas.toDataURL(),
          ),
          edited,
        );
        assert.equal(
          await p
            .locator(".stamp-card")
            .nth(8)
            .locator(".stamp-caption")
            .textContent(),
          "個別修正",
        );
        await p.check("#bulk-visual");
        await p.click("#bulk-confirm");
        await evidence("easy-40-edited");
        const d2 = p.waitForEvent("download");
        await p.click("#easy-export");
        await (await d2).saveAs(`${dir}/easy-40-edited.zip`);
        await idle();
        // No fifth source, normal mode remains intact, settings JSON retains individual caption.
        await p.setInputFiles("#easy-files", sheets[0]);
        await idle();
        assert.match(await p.locator("#easy-warnings").textContent(), /4枚/);
        assert.equal(await p.locator(".source-card").count(), 4);
        await p.selectOption("#production-mode", "normal");
        assert.equal(await p.locator("#easy-panel").isVisible(), false);
        assert(await p.locator(".project-panel").isVisible());
        const j = p.waitForEvent("download");
        await p.click("#save-project");
        await (await j).saveAs(`${dir}/easy-project.json`);
        const project = JSON.parse(
          await fs.readFile(`${dir}/easy-project.json`),
        );
        assert.equal(project.slots[8].caption, "個別修正");
        assert.equal(project.slots[8].style.size, 22);
        assert.equal(project.sources.length, 4);
        await p.selectOption("#production-mode", "easy");
        assert.match(await p.inputValue("#easy-captions"), /個別修正/);
        await p.fill("#easy-captions", Array(41).fill("多すぎ").join("\n"));
        await p.click("#easy-process");
        await idle();
        assert.match(await p.locator("#easy-progress").textContent(), /40行/);
        assert.equal(
          await p
            .locator(".stamp-card")
            .nth(8)
            .locator(".stamp-caption")
            .textContent(),
          "個別修正",
        );
      }
      if (n === 40) {
        await p.fill("#easy-captions", "読み込む前の下書き");
        await p.check("#easy-style-enabled");
        await p.selectOption("#production-mode", "normal");
        await p.setInputFiles("#load-project", `${dir}/easy-project.json`);
        await idle();
        await p.selectOption("#production-mode", "easy");
        assert.match(await p.inputValue("#easy-captions"), /個別修正/);
        assert.equal(await p.locator("#easy-style-enabled").isChecked(), false);
        await p.click("#easy-process");
        await idle();
        assert.equal(
          await p
            .locator(".stamp-card")
            .nth(8)
            .locator(".stamp-caption")
            .textContent(),
          "個別修正",
        );
        assert.equal(await p.locator(".stamp-card.reviewed").count(), 0);
      }
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.deepEqual(
        errors.filter((e) => !/不足|40行/.test(e)),
        [],
      );
      assert.deepEqual(external, []);
      await p.close();
      console.log(
        `PASS easy ${n}: ordered sheets/captions, batch styling, explicit review, ${n + 2}-image ZIP; 40 also edit/retry/JSON/normal mode/error safety`,
      );
    }
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
