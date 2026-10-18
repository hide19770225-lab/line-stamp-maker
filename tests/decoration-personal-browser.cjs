"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4673";
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const p = await b.newPage({ ...devices["iPhone 13"] }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base);
    await p.selectOption("#production-mode", "easy");
    const idle = () =>
      p.waitForFunction(() => !document.body.classList.contains("busy"), null, {
        timeout: 120000,
      });
    const data = await p.evaluate(() => {
      const c = StampCore.canvas(800, 1600),
        x = c.getContext("2d");
      x.fillStyle = "white";
      x.fillRect(0, 0, 800, 1600);
      for (let i = 0; i < 10; i++) {
        const ox = (i % 2) * 400,
          oy = Math.floor(i / 2) * 320;
        x.fillStyle = `rgb(${140 + i * 5},90,45)`;
        x.fillRect(ox + 140, oy + 80, 120 + i * 4, 170 - i * 5);
        for (let k = 0; k < 9; k++) {
          x.fillStyle = k % 2 ? "#ee9f20" : "#f34d89";
          x.fillRect(
            ox + 30 + (k % 3) * 17,
            oy + 80 + Math.floor(k / 3) * 22,
            3,
            3,
          );
        }
      }
      return c.toDataURL().split(",")[1];
    });
    await p.setInputFiles("#easy-files", {
      name: "synthetic-review.png",
      mimeType: "image/png",
      buffer: Buffer.from(data, "base64"),
    });
    await idle();
    assert.equal(await p.locator(".suggestion-card").count(), 10);
    const row = p.locator('.suggestion-card[data-slot="9"]');
    assert.match(
      await row.locator(".hint").textContent(),
      /近い見本がありません|区別できません/,
    );
    await row.locator("select").selectOption("sleepy");
    await row.locator('[data-action="remember-pose"]').click();
    assert.match(
      await row.locator(".hint").textContent(),
      /利用者が表情を指定/,
    );
    await p.check("#resuggest-existing");
    await p.click("#auto-captions");
    await idle();
    assert.equal(await row.locator("select").inputValue(), "sleepy");
    assert.match(await row.locator(".hint").textContent(), /画素見本照合/);
    await p.check("#suggestion-ack");
    await p.click("#approve-suggestions");
    await idle();
    await p.click("#bulk-inspect");
    await idle();
    const card = p.locator('.bulk-result[data-name="02.png"]');
    assert.doesNotMatch(await card.textContent(), /不要な残留/);
    const toggle = card.locator("button").filter({ hasText: "検出位置を表示" });
    assert.equal(await toggle.count(), 1);
    assert.match(await toggle.textContent(), /緑：装飾・詳細候補9/);
    const image = await card
      .locator("canvas")
      .first()
      .evaluate((c) => c.toDataURL());
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    assert(await card.locator(".audit-component-overlay").isVisible());
    assert.equal(
      await card
        .locator("canvas")
        .first()
        .evaluate((c) => c.toDataURL()),
      image,
    );
    const aligned = await card
      .locator(".audit-preview-stage")
      .evaluate((el) => {
        const a = el.children[0].getBoundingClientRect(),
          b = el.children[1].getBoundingClientRect();
        return (
          Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1
        );
      });
    assert(aligned);
    assert(await p.locator("#bulk-confirm").isDisabled()); // partial 10/40 never becomes a complete application set
    await p.reload();
    assert.equal(
      await p.evaluate(() => StampCaptionVision.learned().length),
      1,
    );
    await p.locator("#clear-pose-references").evaluate((el) => el.click());
    assert.equal(
      await p.evaluate(() => StampCaptionVision.learned().length),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: synthetic decorations protected, separate visible overlays preserve PNG pixels, explicit pose memory persists and clears, partial ZIP gate",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
