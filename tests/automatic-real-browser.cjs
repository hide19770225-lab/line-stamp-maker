/* Real latest 10 PNG inputs: automatic export must require no candidate selection. */
"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const input = process.env.STAMP_AUTO_INPUT;
if (!input) throw Error("Set STAMP_AUTO_INPUT to latest ZIP PNG folder.");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173",
  dir = process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-automatic-results";
(async () => {
  await fs.mkdir(dir, { recursive: true });
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const p = await b.newPage({
        ...devices["iPhone 13"],
        acceptDownloads: true,
      }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.stack));
    p.on("dialog", (d) => d.accept());
    await p.goto(base);
    await p.evaluate(() => {
      const render = StampCore.renderStamp;
      window.realStamps = {};
      window.autoReports = {};
      StampCore.renderStamp = (s, t) => {
        const r = render(s, t);
        if (s.slot) {
          realStamps[s.slot] = s;
          autoReports[s.slot] = r.autoRemoved;
        }
        return r;
      };
    });
    const filePaths = Array.from({ length: 10 }, (_, i) =>
      path.join(input, String(i + 1).padStart(2, "0") + ".png"),
    );
    if (process.argv.includes("--grid")) {
      // Reconstructed transparent sheet; not the user's original white-background image.
      await p.selectOption("#default-layout", "2x5");
      const tiles = await Promise.all(
        filePaths.map(async (file) =>
          (await fs.readFile(file)).toString("base64"),
        ),
      );
      const grid = await p.evaluate(async (tiles) => {
        const c = StampCore.canvas(740, 1600),
          ctx = c.getContext("2d");
        for (let i = 0; i < tiles.length; i++) {
          const im = new Image();
          im.src = "data:image/png;base64," + tiles[i];
          await im.decode();
          ctx.drawImage(im, (i % 2) * 370, Math.floor(i / 2) * 320);
        }
        return c.toDataURL().split(",")[1];
      }, tiles);
      await p.setInputFiles("#file-input", {
        name: "reconstructed-real-2x5.png",
        mimeType: "image/png",
        buffer: Buffer.from(grid, "base64"),
      });
    } else {
      await p.selectOption("#default-layout", "1x1");
      await p.setInputFiles("#file-input", filePaths);
    }
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    await p.click("#process-all");
    await p.waitForFunction(
      () =>
        document.querySelectorAll(".stamp-card").length === 10 &&
        !document.body.classList.contains("busy"),
      {},
      { timeout: 120000 },
    );
    const reports = await p.evaluate(() => autoReports);
    for (let n = 1; n <= 8; n++) assert.deepEqual(reports[n], []);
    assert.deepEqual(
      [
        reports[9][0].x,
        reports[9][0].y,
        reports[9][0].width,
        reports[9][0].height,
      ],
      [155, 25, 49, 1],
    );
    assert.deepEqual(
      [
        reports[10][0].x,
        reports[10][0].y,
        reports[10][0].width,
        reports[10][0].height,
      ],
      [175, 25, 18, 1],
    );
    // Export immediately, without opening an editor or selecting any deletion candidate.
    const wait = p.waitForEvent("download");
    await p.click("#download-button");
    await (await wait).saveAs(path.join(dir, "automatic-no-touch-10.zip"));
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    const comparison = await p.evaluate(async () => {
      const result = [];
      for (let n = 1; n <= 10; n++) {
        const s = realStamps[n],
          before = StampCore.renderUncleaned(s).canvas,
          after = StampCore.renderStamp(s).canvas,
          a = before.getContext("2d").getImageData(0, 0, 370, 320).data,
          d = after.getContext("2d").getImageData(0, 0, 370, 320).data;
        const changed = [];
        for (let i = 0; i < 370 * 320; i++) {
          if (a.slice(i * 4, i * 4 + 4).some((v, k) => v !== d[i * 4 + k]))
            changed.push(i);
        }
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", d)),
        )
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("");
        result.push({
          n,
          changed,
          hash,
          before: before.toDataURL(),
          after: after.toDataURL(),
        });
      }
      return result;
    });
    for (const c of comparison) {
      const y = 25,
        x = c.n === 9 ? 155 : 175,
        len = c.n === 9 ? 49 : c.n === 10 ? 18 : 0;
      assert.deepEqual(
        c.changed,
        Array.from({ length: len }, (_, i) => y * 370 + x + i),
        `only line pixels may change in ${c.n}`,
      );
      if (c.n >= 9)
        for (const state of ["before", "after"])
          await fs.writeFile(
            path.join(dir, `auto-${state}-${c.n}.png`),
            Buffer.from(c[state].split(",")[1], "base64"),
          );
      delete c.before;
      delete c.after;
    }
    await fs.writeFile(
      path.join(dir, "automatic-evidence.json"),
      JSON.stringify(comparison, null, 2),
    );
    await p.locator(".stamp-card").nth(8).click();
    assert(await p.isChecked("#auto-cleanup-enabled"));
    assert.match(
      await p.locator("#auto-cleanup-status").innerText(),
      /1本自動除去/,
    );
    await p.locator("#auto-cleanup-comparison summary").click();
    const cleaned = await p
      .locator("#edit-canvas")
      .evaluate((c) => c.toDataURL());
    assert.equal(
      await p.locator("#auto-cleanup-after").evaluate((c) => c.toDataURL()),
      cleaned,
    );
    const original = await p
      .locator("#auto-cleanup-before")
      .evaluate((c) => c.toDataURL());
    assert.notEqual(original, cleaned);
    await p.uncheck("#auto-cleanup-enabled");
    assert.equal(
      await p.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
      original,
      "OFF restores same layout/color/text before cleanup",
    );
    await p.click("#close-dialog");
    const save = p.waitForEvent("download");
    await p.click("#save-project");
    const jf = path.join(dir, "automatic-project.json");
    await (await save).saveAs(jf);
    const project = JSON.parse(await fs.readFile(jf, "utf8"));
    assert.equal(project.slots[8].cleanupEnabled, false);
    assert.equal(project.slots[9].cleanupEnabled, true);
    await p.locator(".stamp-card").nth(8).click();
    await p.check("#auto-cleanup-enabled");
    assert.equal(
      await p.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
      cleaned,
    );
    const png = p.waitForEvent("download");
    await p.click("#download-single");
    await (await png).saveAs(path.join(dir, "automatic-single-09.png"));
    const typography = await p.evaluate(() => {
      const original = realStamps[9],
        results = [];
      for (const preset of Object.keys(StampTypography.PRESETS)) {
        const stamp = {
          ...original,
          cleanupEnabled: true,
          caption: "ありがとう！",
          style: StampTypography.presetStyle(preset, "ありがとう！"),
        };
        const before = StampCore.renderUncleaned(stamp),
          after = StampCore.renderStamp(stamp),
          a = before.canvas.getContext("2d").getImageData(0, 0, 370, 320).data,
          d = after.canvas.getContext("2d").getImageData(0, 0, 370, 320).data;
        let changed = 0;
        for (let i = 0; i < 370 * 320; i++)
          if (a.slice(i * 4, i * 4 + 4).some((v, k) => v !== d[i * 4 + k])) {
            if (i < 25 * 370 + 155 || i >= 25 * 370 + 204)
              throw Error("Japanese typography/art pixel changed outside line");
            changed++;
          }
        results.push({
          preset,
          removed: after.autoRemoved.length,
          changed,
          overlap: after.textOverlap,
          clipped: after.textClipped,
        });
      }
      return results;
    });
    assert.equal(typography.length, 6);
    assert(
      typography.every(
        (r) => r.removed === 1 && r.changed === 49 && !r.overlap && !r.clipped,
      ),
    );
    await fs.writeFile(
      path.join(dir, "automatic-typography.json"),
      JSON.stringify(typography, null, 2),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: latest real 09=49px / 10=18px removed in untouched export; all other RGBA pixels and 01–08 unchanged; automatic preview/OFF/ON reversible; JSON flag; single PNG and real ZIP",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
