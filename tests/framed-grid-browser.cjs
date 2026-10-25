'use strict';
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');
const fs = require('node:fs/promises');
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
    // Every cell must retain artwork close to all four inner edges.
    // This guards against regressions that silently crop off legs, tails,
    // antennae or captions even when the ZIP structure is valid.
    const coverage = await page.evaluate(() => {
      const c=StampCore.canvas(1000,1600),ctx=c.getContext('2d');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,1000,1600);
      for(let row=0;row<8;row++)for(let col=0;col<5;col++){
        const x=col*200,y=row*200;
        ctx.fillStyle='#e35a62';
        ctx.fillRect(x+8,y+8,14,14);
        ctx.fillRect(x+178,y+8,14,14);
        ctx.fillRect(x+8,y+178,14,14);
        ctx.fillRect(x+178,y+178,14,14);
      }
      ctx.fillStyle='#111';
      for(let x=0;x<=1000;x+=200)ctx.fillRect(Math.min(x,998),0,2,1600);
      for(let y=0;y<=1600;y+=200)ctx.fillRect(0,Math.min(y,1598),1000,2);
      const grid=StampCore.detectFramedGrid(c,5,8);
      if(!grid)return {found:false};
      let retained=0;
      for(let row=0;row<8;row++)for(let col=0;col<5;col++){
        const rect=StampCore.tileRect({image:c,framedGrid:grid,columns:5,rows:8},col,row);
        const d=ctx.getImageData(rect.x,rect.y,rect.width,rect.height).data;
        let colored=0;
        for(let i=0;i<d.length;i+=4)
          if(d[i]>190&&d[i+1]<150&&d[i+2]<160)colored++;
        if(colored>=4*14*14)retained++;
      }
      return {found:true,retained};
    });
    assert.equal(coverage.found,true);
    assert.equal(coverage.retained,40,'all four near-edge artwork markers must survive in all 40 tiles');
    // Reproduce the actual Koro sheet's non-uniform frame spacing.
    // Equal-size 5x8 slicing loses lower body parts and right-hand captions.
    const irregular = await page.evaluate(() => {
      const xs=[1,204,388,576,768,958], ys=[1,185,361,538,715,894,1071,1273,1480];
      const c=StampCore.canvas(961,1536),ctx=c.getContext('2d');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,961,1536);
      ctx.fillStyle='#222';
      for(const x of xs)ctx.fillRect(x,0,2,1536);
      for(const y of ys)ctx.fillRect(0,y,961,2);
      const grid=StampCore.detectFramedGrid(c,5,8);
      if(!grid)return {detected:false};
      let valid=0;
      for(let row=0;row<8;row++)for(let col=0;col<5;col++){
        const rect=StampCore.tileRect({image:c,framedGrid:grid,columns:5,rows:8},col,row);
        if(rect.x>xs[col]+1 && rect.y>ys[row]+1 &&
           rect.x+rect.width<xs[col+1] && rect.y+rect.height<ys[row+1])valid++;
      }
      return {detected:true,valid};
    });
    assert.equal(irregular.detected,true,'detect Koro non-uniform frame grid');
    assert.equal(irregular.valid,40,'all 40 crops must follow detected lines, not equal divisions');
    const png = await page.evaluate(() => {
      const c = StampCore.canvas(1000, 1600), ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,1000,1600);
      for(let row=0;row<8;row++) for(let col=0;col<5;col++){
        const x=col*200, y=row*200;
        ctx.fillStyle='#539e8c'; ctx.beginPath(); ctx.arc(x+100,y+85,42,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#111'; ctx.font='18px sans-serif'; ctx.fillText('ありがとう',x+45,y+155);
      }
      ctx.fillStyle='#111';
      for(let x=0;x<=1000;x+=200)ctx.fillRect(Math.min(x,998),0,2,1600);
      for(let y=0;y<=1600;y+=200)ctx.fillRect(0,Math.min(y,1598),1000,2);
      return c.toDataURL().split(',')[1];
    });
    await page.selectOption('#easy-layout','5x8');
    await page.selectOption('#easy-caption-mode','existing');
    await page.setInputFiles('#easy-files',{name:'synthetic-framed.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    const idle=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'),{},{timeout:120000});
    await idle(); await page.click('#easy-process'); await idle();
    assert.equal(await page.locator('.stamp-card').count(),40,'framed sheet must produce 40 preview cards');
    assert((await page.locator('#status').textContent()).includes('枠線') ||
      await page.evaluate(()=>document.body.textContent.includes('枠線検出')),
      'frame detection should be visible to user');
    await page.selectOption('#production-mode','normal');
    await page.click('#bulk-inspect'); await idle();
    assert.equal(await page.locator('.bulk-result').count(),42,'40 stickers plus main and tab must be inspected');
    assert.equal(await page.locator('.bulk-result[data-status="エラー"]').count(),0);
    await page.check('#bulk-visual'); await page.click('#bulk-confirm');
    await page.selectOption('#production-mode','easy');
    await page.click('#easy-export'); await idle();
    assert(await page.locator('#download-direct').isVisible(),'42-image ZIP must be downloadable');
    const downloadEvent = page.waitForEvent('download');
    await page.click('#download-direct');
    const download = await downloadEvent;
    const output = process.env.FRAMED_GRID_ZIP || '/tmp/framed-grid-browser-42.zip';
    await fs.mkdir(require('node:path').dirname(output), { recursive: true });
    await download.saveAs(output);
    const stat = await fs.stat(output);
    assert(stat.size > 1000,'exported ZIP must contain image data');
    console.log('PASS browser: framed 40-sheet processed, 42 assets inspected, ZIP saved:', output, stat.size);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
