"use strict";
const { chromium, devices } = require("playwright"),
  assert = require("node:assert/strict");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173";
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const p = await b.newPage({ ...devices["iPhone 13"] });
    await p.goto(base);
    const results = await p.evaluate(() => {
      const C = StampCore,
        T = StampTypography,
        results = [];
      for (const key of Object.keys(T.PRESETS))
        for (const angle of [-30, 0, 30]) {
          const c = C.canvas(300, 300),
            ctx = c.getContext("2d");
          ctx.fillStyle = "#518d6a";
          ctx.fillRect(0, 0, 300, 300);
          ctx.fillStyle = "white";
          ctx.fillRect(90, 100, 120, 120);
          const s = C.createTile(
            { image: c, xs: [0, 1], ys: [0, 1] },
            0,
            0,
            "none",
            0,
            "#fff",
          );
          s.caption = "いつもありがとうございます！また遊ぼうね";
          s.style = {
            ...T.presetStyle(key, s.caption),
            safeMargin: 20,
            angle,
            overrides: ["angle"],
          };
          const oldMask = s.mask.slice(),
            oldRGB = s.original.data.slice(),
            r = C.renderStamp(s),
            d = r.canvas.getContext("2d").getImageData(0, 0, 370, 320).data;
          let edge = 0;
          for (let y = 0; y < 320; y++)
            for (let x = 0; x < 370; x++)
              if (x < 20 || x >= 350 || y < 20 || y >= 300)
                edge += d[(y * 370 + x) * 4 + 3] > 0 ? 1 : 0;
          results.push({
            key,
            angle,
            edge,
            overlap: r.textOverlap,
            clipped: r.textClipped,
            white: Array.from(d).some(
              (v, i) =>
                i % 4 === 0 &&
                v === 255 &&
                d[i + 1] === 255 &&
                d[i + 2] === 255 &&
                d[i + 3] > 0,
            ),
            maskSame: s.mask.every((v, i) => v === oldMask[i]),
            rgbSame: s.original.data.every((v, i) => v === oldRGB[i]),
          });
        }
      return results;
    });
    assert.equal(results.length, 18);
    for (const r of results) {
      assert.equal(r.edge, 0, JSON.stringify(r));
      assert.equal(r.overlap, 0, JSON.stringify(r));
      assert.equal(r.clipped, false, JSON.stringify(r));
      assert(r.white && r.maskSame && r.rgbSame);
    }
    console.log(
      "PASS: 6 presets × 3 angles with long Japanese text; 20px transparent margin, zero overlap/clipping, white body and original RGB/mask preserved",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
