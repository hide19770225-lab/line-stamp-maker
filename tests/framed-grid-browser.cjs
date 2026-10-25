'use strict';
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage({ ...devices['iPhone 13'] });
    await page.goto(process.env.STAMP_TEST_URL || 'http://127.0.0.1:4173');
    const result = await page.evaluate(() => {
      const c = StampCore.canvas(1000, 1600), ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1000, 1600);
      ctx.fillStyle = '#111';
      for (let x = 0; x <= 1000; x += 200) ctx.fillRect(Math.min(x,998), 0, 2, 1600);
      for (let y = 0; y <= 1600; y += 200) ctx.fillRect(0, Math.min(y,1598), 1000, 2);
      const grid = StampCore.detectFramedGrid(c, 5, 8);
      if (!grid) return { detected: false };
      const source = { image: c, framedGrid: grid, columns: 5, rows: 8 };
      const rects = [];
      for (let row = 0; row < 8; row++) for (let col = 0; col < 5; col++)
        rects.push({col, row, rect: StampCore.tileRect(source, col, row)});
      const blank = StampCore.canvas(1000,1600);
      blank.getContext('2d').fillStyle='#fff';
      blank.getContext('2d').fillRect(0,0,1000,1600);
      return { detected: true, grid, rects, unframed: StampCore.detectFramedGrid(blank, 5, 8) };
    });
    assert.equal(result.detected, true);
    assert.equal(result.grid.xs.length, 6);
    assert.equal(result.grid.ys.length, 9);
    assert.equal(result.rects.length, 40);
    assert.equal(result.unframed, null);
    for (const {col,row,rect} of result.rects) {
      assert(rect.width > 0 && rect.height > 0);
      assert(rect.x > result.grid.xs[col].end);
      assert(rect.y > result.grid.ys[row].end);
      assert(rect.x + rect.width < result.grid.xs[col+1].start);
      assert(rect.y + rect.height < result.grid.ys[row+1].start);
    }
    console.log('PASS browser: 40 framed inner crops and unframed fallback');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
