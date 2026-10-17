const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const mode of ["normal", "easy"]) {
      const p = await b.newPage({ ...devices["iPhone 13"] });
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(process.env.STAMP_TEST_URL || "http://127.0.0.1:4670");
      await p.selectOption("#production-mode", mode);
      const data = await p.evaluate(() => {
        window.rendered = {};
        const orig = StampCore.renderStamp;
        StampCore.renderStamp = (s, t) => {
          if (s.slot) rendered[s.slot] = s;
          return orig(s, t);
        };
        const c = StampCore.canvas(800, 1600),
          x = c.getContext("2d");
        x.fillStyle = "white";
        x.fillRect(0, 0, 800, 1600);
        for (let i = 0; i < 10; i++) {
          x.fillStyle = "#8cb959";
          x.fillRect(
            (i % 2) * 400 + 100,
            Math.floor(i / 2) * 320 + 60,
            200,
            220,
          );
        }
        return c.toDataURL().split(",")[1];
      });
      const idle = () =>
        p.waitForFunction(
          () => !document.body.classList.contains("busy"),
          null,
          { timeout: 120000 },
        );
      await p.setInputFiles(mode === "easy" ? "#easy-files" : "#file-input", {
        name: "ten.png",
        mimeType: "image/png",
        buffer: Buffer.from(data, "base64"),
      });
      await idle();
      await p.waitForSelector("#auto-captions");
      if (mode === "normal")
        await p.locator("#bulk-captions").evaluate((el) => {
          for (
            let parent = el.parentElement;
            parent;
            parent = parent.parentElement
          )
            if (parent.tagName === "DETAILS") parent.open = true;
        });
      await p.fill(
        mode === "easy" ? "#easy-captions" : "#bulk-captions",
        "既存のセリフ",
      );
      await p.click("#auto-captions");
      await idle();
      assert.equal(await p.locator(".stamp-card").count(), 10);
      let captions = await p.locator(".stamp-caption").allTextContents();
      assert.equal(new Set(captions).size, 10);
      assert.ok(captions.every((s) => s && s !== "（セリフなし）"));
      assert.equal(captions[0], "既存のセリフ");
      assert.match(
        await p.locator("#auto-caption-status").textContent(),
        /表情未解析/,
      );
      const result = await p.evaluate(() =>
        Object.values(rendered).map((s) => ({
          slot: s.slot,
          caption: s.caption,
          clipped: StampCore.renderStamp(s).clipped,
        })),
      );
      assert.deepEqual(
        result.map((s) => s.caption),
        captions,
      );
      const pixels = await p.evaluate(() =>
        Object.values(rendered).map((s) => {
          const withText = StampCore.renderStamp(s).canvas,
            blank = StampCore.renderStamp({ ...s, caption: "" }).canvas;
          const d = withText.getContext("2d").getImageData(0, 0, 370, 320).data;
          let edge = 0;
          for (let y = 0; y < 320; y++)
            for (let x = 0; x < 370; x++)
              if (x < 10 || x >= 360 || y < 10 || y >= 310)
                edge += d[(y * 370 + x) * 4 + 3];
          return {
            different: withText.toDataURL() !== blank.toDataURL(),
            edge,
          };
        }),
      );
      assert.ok(pixels.every((r) => r.different && r.edge === 0));
      const hashes = await p
        .locator("#stamp-grid canvas")
        .evaluateAll((cs) => cs.map((c) => c.toDataURL()));
      await p.click("#auto-captions");
      await idle();
      assert.deepEqual(
        await p
          .locator("#stamp-grid canvas")
          .evaluateAll((cs) => cs.map((c) => c.toDataURL())),
        hashes,
      );
      assert.deepEqual(errors, []);
      await p.close();
      console.log(
        `${mode}: 10 automatic Japanese captions, shared entry, stable rerun PASS`,
      );
    }
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
