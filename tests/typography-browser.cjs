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
        !r.url().startsWith(base) &&
        !r.url().startsWith("data:") &&
        !r.url().startsWith("blob:")
      )
        external.push(r.url());
    });
    await p.goto(base);
    await p.evaluate(() => {
      const render = StampCore.renderStamp;
      window.renderedCaptions = {};
      StampCore.renderStamp = (stamp, target) => {
        const r = render(stamp, target);
        if (stamp.slot)
          window.renderedCaptions[stamp.slot] = {
            plan: r.textPlan,
            overlap: r.textOverlap,
            clipped: r.textClipped,
            scaled: r.textAutoScaled,
          };
        if (target?.id === "edit-canvas") window.editPlan = r.textPlan;
        return r;
      };
    });
    const coreChecks = await p.evaluate(() => {
      const C = StampCore,
        T = StampTypography,
        results = [];
      // Fully opaque subjects leave no initial gap: actual alpha pixels must never overlap text/shadow.
      for (const key of Object.keys(T.PRESETS))
        for (const angle of [-30, 0, 30]) {
          const source = C.canvas(300, 300);
          source.getContext("2d").fillStyle = "#528bba";
          source.getContext("2d").fillRect(0, 0, 300, 300);
          const stamp = C.createTile(
            { image: source, xs: [0, 1], ys: [0, 1] },
            0,
            0,
            "none",
            0,
            "#ffffff",
          );
          stamp.caption = "ありがとう！";
          stamp.style = {
            ...T.presetStyle(key, stamp.caption),
            angle,
            shadow: 6,
            overrides: ["angle", "shadow"],
          };
          const original = Array.from(stamp.original.data.slice(0, 12));
          const r = C.renderStamp(stamp),
            a = C.canvas(370, 320),
            ctx = a.getContext("2d"),
            native = C.canvas(stamp.original.width, stamp.original.height);
          native.getContext("2d").putImageData(stamp.original, 0, 0);
          const ip = r.imagePlacement,
            cr = ip.crop;
          ctx.save();
          ctx.beginPath();
          ctx.rect(10, 10, 350, 300);
          ctx.clip();
          ctx.drawImage(
            native,
            cr.x,
            cr.y,
            cr.width,
            cr.height,
            ip.offsetX + cr.x * ip.ratio,
            ip.offsetY + cr.y * ip.ratio,
            cr.width * ip.ratio,
            cr.height * ip.ratio,
          );
          ctx.restore();
          const t = C.canvas(370, 320);
          T.paintPlan(t.getContext("2d"), r.textPlan);
          const art = ctx.getImageData(0, 0, 370, 320).data,
            text = t.getContext("2d").getImageData(0, 0, 370, 320).data;
          let overlap = 0,
            ink = 0;
          for (let i = 3; i < art.length; i += 4) {
            if (text[i]) ink++;
            if (art[i] && text[i]) overlap++;
          }
          results.push({
            key,
            angle,
            overlap,
            ink,
            clipped: r.textClipped,
            scaled: r.textAutoScaled,
            sourceUnchanged:
              JSON.stringify(original) ===
              JSON.stringify(Array.from(stamp.original.data.slice(0, 12))),
          });
          [source, r.canvas, a, native, t].forEach((c) => {
            c.width = c.height = 1;
          });
        }
      return results;
    });
    assert.equal(coreChecks.length, 18);
    for (const result of coreChecks) {
      assert.equal(result.overlap, 0, JSON.stringify(result));
      assert(!result.clipped, JSON.stringify(result));
      assert(result.ink > 100);
      assert(result.scaled);
      assert(result.sourceUnchanged);
    }
    const edge = await p.evaluate(() => {
      const c = StampCore.canvas(200, 200);
      c.getContext("2d").fillRect(0, 0, 200, 200);
      const stamp = StampCore.createTile(
        { image: c, xs: [0, 1], ys: [0, 1] },
        0,
        0,
        "none",
        0,
        "#fff",
      );
      stamp.caption = "あ\n".repeat(59);
      stamp.style = StampTypography.presetStyle("emphasis", stamp.caption);
      return StampCore.renderStamp(stamp).textClipped;
    });
    assert(
      edge,
      "pathological multiline text must be diagnosed rather than silently clipped",
    );
    const brushMapping = await p.evaluate(() => {
      const C = StampCore,
        T = StampTypography,
        c = C.canvas(300, 300);
      c.getContext("2d").fillStyle = "#528bba";
      c.getContext("2d").fillRect(0, 0, 300, 300);
      const stamp = C.createTile(
        { image: c, xs: [0, 1], ys: [0, 1] },
        0,
        0,
        "none",
        0,
        "#fff",
      );
      stamp.caption = "やった！";
      stamp.style = T.presetStyle("energetic", stamp.caption);
      const rendered = C.renderStamp(stamp),
        before = rendered.canvas.toDataURL(),
        ip = rendered.imagePlacement;
      const x = ip.offsetX + 150 * ip.ratio,
        y = ip.offsetY + 150 * ip.ratio;
      C.applyBrush(stamp, x, y, 8, "erase");
      const erased = stamp.mask[150 * 300 + 150] === 0;
      C.applyBrush(stamp, x, y, 8, "restore");
      const restored = stamp.mask[150 * 300 + 150] === 255;
      const final = C.renderStamp(stamp);
      return {
        erased,
        restored,
        identical: before === final.canvas.toDataURL(),
        overlap: final.textOverlap,
      };
    });
    assert.deepEqual(brushMapping, {
      erased: true,
      restored: true,
      identical: true,
      overlap: 0,
    });
    if (process.argv.includes("--core-only")) {
      assert.deepEqual(errors, []);
      console.log(
        "PASS: six presets × three angles, pathological multiline guard, and brush erase/restore after automatic character shrinking",
      );
      return;
    }
    await p.selectOption("#default-layout", "5x8");
    await p.locator(".bulk-text summary").click();
    const phrases = [
      "やったー！",
      "またあそぼう",
      "だいすき♡",
      "ありがとう",
      "絶対ダメ",
      "了解",
    ];
    await p.fill(
      "#bulk-captions",
      Array.from({ length: 40 }, (_, i) => phrases[i % 6]).join("\n"),
    );
    await p.click("#apply-captions");
    await p.click("#apply-design-all");
    const fixture = await p.evaluate(() => {
      const c = StampCore.canvas(500, 800),
        ctx = c.getContext("2d");
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 5; x++) {
          ctx.fillStyle = `rgb(${70 + x * 15},${110 + y * 8},180)`;
          ctx.fillRect(x * 100, y * 100, 100, 100);
        }
      return c.toDataURL().split(",")[1];
    });
    const file = {
      name: "opaque-40.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture, "base64"),
    };
    await p.setInputFiles("#file-input", file);
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    await p.selectOption("#background-mode", "none");
    await p.click("#process-button");
    await p.waitForFunction(
      () =>
        document.querySelectorAll(".stamp-card").length === 40 &&
        !document.body.classList.contains("busy"),
    );
    const generated = await p.evaluate(() =>
      Object.values(window.renderedCaptions),
    );
    assert.equal(generated.length, 40);
    assert(generated.every((r) => r.overlap === 0 && !r.clipped && r.scaled));
    await p.locator(".stamp-card").first().click();
    assert.match(await p.locator("#preset-suggestion").innerText(), /元気/);
    assert.match(await p.locator("#text-placement-status").innerText(), /縮小/);
    await p.selectOption("#text-preset", "cute");
    await p.locator("#text-color").fill("#1944aa");
    await p.locator("#text-outline-width").fill("8");
    await p.locator("#text-shadow").fill("6");
    await p.locator("#text-angle").fill("12");
    await p.locator("#font-size").fill("38");
    await p.selectOption("#font-family", "serif");
    assert.equal(await p.inputValue("#text-angle"), "12");
    assert.equal(await p.inputValue("#text-shadow"), "6");
    const before = await p
      .locator("#edit-canvas")
      .evaluate((c) => c.toDataURL());
    await p.locator("#text-shadow").fill("0");
    assert.notEqual(
      await p.locator("#edit-canvas").evaluate((c) => c.toDataURL()),
      before,
    );
    await p.locator("#text-shadow").fill("6");
    await p.click('[data-brush="text"]');
    await p.locator("#edit-canvas").scrollIntoViewIfNeeded();
    const box = await p.locator("#edit-canvas").boundingBox(),
      plan = await p.evaluate(() => window.editPlan);
    const x = box.x + (box.width * plan.centerX) / 370,
      y = box.y + (box.height * plan.centerY) / 320;
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 4; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (40 * i) / 4, y: y - (8 * i) / 4 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const moved = await p.evaluate(() => window.editPlan);
    assert(
      Math.abs(moved.centerX - plan.centerX) > 5 ||
        Math.abs(moved.centerY - plan.centerY) > 5,
      "touch drag moves caption",
    );
    assert.equal(moved.overlapPixels, 0);
    await p.screenshot({ path: path.join(artifacts, "typography-mobile.png") });
    await p.click("#apply-style-all");
    await p.click("#close-dialog");
    await p.locator(".stamp-card").nth(1).click();
    await p.selectOption("#text-preset", "gentle");
    await p.click("#close-dialog");
    let download = p.waitForEvent("download");
    await p.click("#save-project");
    const jsonDownload = await download;
    const jsonFile = path.join(artifacts, "typography-project.json");
    await jsonDownload.saveAs(jsonFile);
    const json = JSON.parse(await fs.readFile(jsonFile, "utf8"));
    assert.equal(json.slots[0].style.preset, "cute");
    assert.equal(json.slots[0].style.color, "#1944aa");
    assert.equal(json.slots[0].style.angle, 12);
    assert.equal(json.slots[1].style.preset, "gentle");
    assert.equal(json.slots[39].style.preset, "cute");
    assert(
      json.slots.every((slot) => !slot.mask.runs.length),
      "text drag does not alter eraser mask",
    );
    await p.locator(".stamp-card").first().click();
    for (let i = 0; i < 40; i++) {
      await p.check("#reviewed-checkbox");
      await p.click("#save-edit");
    }
    await p.waitForFunction(
      () => document.querySelectorAll(".stamp-card.reviewed").length === 40,
    );
    assert(
      (await p.evaluate(() => Object.values(window.renderedCaptions))).every(
        (r) => !r.overlap && !r.clipped,
      ),
    );
    download = p.waitForEvent("download", { timeout: 120000 });
    await p.click("#download-button");
    const zip = await download;
    assert.equal(zip.suggestedFilename(), "line-stamps-40.zip");
    await zip.saveAs(path.join(artifacts, "typography-40.zip"));
    await p.waitForFunction(() => !document.body.classList.contains("busy"));
    assert.match(await p.locator("#validation-list").innerText(), /42画像/);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      "PASS: all six Japanese presets at -30/0/30 degrees, actual alpha masks show zero overlap including outlines/shadows, auto shrinking, touch caption drag, color/outline/shadow/angle/font controls, 40-way apply + individual edits, JSON persistence, 42-image composed ZIP, no external requests",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
