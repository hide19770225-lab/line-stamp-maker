/* Synthetic evidence only: not the user's original 40-sticker sheet or real Safari. */
'use strict';
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const dir = process.env.STAMP_TEST_ARTIFACTS || '/tmp/stamp-grid40-results';
(async () => {
  await fs.mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const p = await browser.newPage({ ...devices['iPhone 13'], acceptDownloads: true });
    const errors = [], external = [];
    p.on('pageerror', e => errors.push(e.message));
    const base = process.env.STAMP_TEST_URL || 'http://127.0.0.1:4173';
    p.on('request', r => { if (![base, 'blob:', 'data:'].some(v => r.url().startsWith(v))) external.push(r.url()); });
    p.on('dialog', d => d.accept());
    await p.goto(base);
    const idle = () => p.waitForFunction(() => !document.body.classList.contains('busy'), {}, { timeout: 120000 });
    await p.selectOption('#easy-layout', '5x8');
    await p.selectOption('#easy-caption-mode', 'existing');
    const data = await p.evaluate(() => {
      window.testTiles = {};
      const create = StampCore.createTile;
      StampCore.createTile = (...args) => {
        window.testSource = args[0];
        const s = create(...args);
        testTiles[args[2] * 5 + args[1] + 1] = s;
        return s;
      };
      const c = StampCore.canvas(1000, 1600), ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < 40; i++) {
        const x = i % 5 * 200, y = Math.floor(i / 5) * 200;
        ctx.fillStyle = '#111'; ctx.font = '14px monospace'; ctx.textBaseline = 'top';
        ctx.fillText(String(i + 1).padStart(2, '0'), x + 10, y + 7);
        ctx.fillStyle = `rgb(${40 + i * 3},122,101)`; ctx.beginPath(); ctx.ellipse(x + 100, y + 110, 45, 42, 0, 0, Math.PI * 2); ctx.fill();
        // Printed Japanese caption must remain raster artwork, without added text.
        ctx.fillStyle = '#111'; ctx.font = '20px sans-serif'; ctx.fillText('ありがとう', x + 48, y + 45);
        ctx.fillStyle = '#fff'; ctx.fillRect(x + 80, y + 110, 40, 18);
      }
      return c.toDataURL().split(',')[1];
    });
    await fs.writeFile(`${dir}/synthetic-numbered-40.png`, Buffer.from(data, 'base64'));
    await p.setInputFiles('#easy-files', { name: 'synthetic-numbered-40.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
    await idle(); await p.click('#easy-process'); await idle();
    assert.equal(await p.locator('.stamp-card').count(), 40);
    const native = await p.evaluate(() => Object.values(testTiles).map((s, tileIndex) => {
      let removed = 0, remaining = 0, preserved = true;
      const gy = Math.floor(tileIndex / 5) * 200 - s.sourceRect.y;
      for (let i = 0; i < s.mask.length; i++) {
        const x = i % s.original.width, y = Math.floor(i / s.original.width);
        if (s.original.data[i * 4 + 3] && x >= 10 && x < 28 && y >= gy + 7 && y < gy + 25 && s.original.data[i * 4] < 230) {
          if (!s.mask[i]) removed++; else remaining++;
        }
        const guideZone = x >= 5 && x < 38 && y >= gy + 5 && y < gy + 32;
        if (!guideZone && s.original.data[i * 4] < 230 && !s.mask[i]) preserved = false;
      }
      const bodyPixel = s.original.data[(Math.round(gy + 90) * s.original.width + 100) * 4];
      return { removed, remaining, preserved, ownBody: bodyPixel === 40 + tileIndex * 3, rect: s.sourceRect, caption: s.caption };
    }));
    await fs.writeFile(`${dir}/native-debug.json`, JSON.stringify(native));
    assert(native.every(s => s.removed > 0 && s.remaining === 0), 'all 01..40 printed guide glyphs are removed');
    assert(native.every(s => s.preserved && s.ownBody && s.caption === ''), 'printed caption and drawing survive; no text overlay');
    await p.selectOption('#production-mode', 'normal');
    // Change just one column and reprocess without moving other columns.
    await p.getByRole('button', { name: '列ごとに横線を細かく調整（40個対応）', exact: true }).click();
    const boundary = p.getByLabel('1列目・1段目の下（%）', { exact: true });
    const before = await p.evaluate(() => testSource.columnYs.map(v => [...v]));
    const newPercent = Number(await boundary.inputValue()) + 0.5;
    await boundary.fill(String(newPercent)); await boundary.dispatchEvent('change');
    await p.click('#process-all'); await idle();
    const after = await p.evaluate(() => testSource.columnYs);
    assert.deepEqual(after.slice(1), before.slice(1));
    assert.equal(after[0][1], newPercent / 100);
    assert.equal(await p.evaluate(() => testTiles[6].sourceRect.y), Math.round(newPercent / 100 * 1600));
    const dragBefore = await p.evaluate(() => testSource.columnYs.map(v => [...v]));
    await p.locator('#split-canvas').scrollIntoViewIfNeeded();
    const box = await p.locator('#split-canvas').boundingBox();
    const dragX = box.x + box.width * 0.3, dragY = box.y + box.height * dragBefore[1][1];
    await p.mouse.move(dragX, dragY); await p.mouse.down();
    await p.mouse.move(dragX, dragY + 4, { steps: 3 }); await p.mouse.up();
    const dragAfter = await p.evaluate(() => testSource.columnYs);
    assert.notEqual(dragAfter[1][1], dragBefore[1][1]);
    assert.deepEqual(dragAfter.filter((_, i) => i !== 1), dragBefore.filter((_, i) => i !== 1));
    await p.click('#process-all'); await idle();
    await p.locator('.stamp-card').first().click();
    await p.check('#reviewed-checkbox');
    await p.click('#close-dialog');
    await p.waitForFunction(() => document.querySelectorAll('.stamp-card.reviewed').length === 1);
    await p.locator('.stamp-card').first().click();
    await p.uncheck('#reviewed-checkbox');
    await p.click('#close-dialog');
    await p.waitForFunction(() => document.querySelectorAll('.stamp-card.reviewed').length === 0);
    await p.click('#bulk-inspect'); await idle();
    assert.equal(await p.locator('.bulk-result').count(), 42);
    assert.equal(await p.locator('.bulk-result[data-status="エラー"]').count(), 0);
    assert(await p.locator('#bulk-confirm').isDisabled());
    await p.check('#bulk-visual'); await p.click('#bulk-confirm');
    assert.equal(await p.locator('.stamp-card.reviewed').count(), 40);
    await p.selectOption('#production-mode', 'easy');
    await p.click('#easy-export'); await idle();
    await p.evaluate(() => {
      window.shareCalls = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: ({ files }) => files.length === 1 && files[0].type === 'application/zip' });
      Object.defineProperty(navigator, 'share', { configurable: true, value: ({ files }) => { shareCalls.push({ name: files[0].name, size: files[0].size }); return Promise.reject(new Error('simulated share unavailable')); } });
    });
    await p.click('#download-link');
    await p.waitForFunction(() => document.querySelector('#status').textContent.includes('共有できませんでした'));
    assert.equal(await p.evaluate(() => shareCalls[0].name), 'line-stamps-40.zip');
    const download = p.waitForEvent('download'); await p.click('#download-direct');
    await (await download).saveAs(`${dir}/numbered-40.zip`);
    // Rejected/throwing capability checks fall back to a normal download.
    await p.evaluate(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => { throw Error('unsupported'); } }));
    const fallback = p.waitForEvent('download'); await p.click('#download-link');
    await (await fallback).saveAs(`${dir}/fallback-40.zip`);
    assert.equal(await p.locator('.stamp-card').count(), 40);
    await p.screenshot({ path: `${dir}/mobile-grid40.png`, fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    await fs.writeFile(`${dir}/evidence.json`, JSON.stringify({ fixture: 'synthetic only', native, shareMock: true }, null, 2));
    console.log('PASS synthetic numbered 5x8: all 40 guide pairs removed, raster captions preserved, independent column boundary applied, 42 previews, bulk approval, ZIP, rejected share and capability fallback. Real iPhone Safari not tested.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
