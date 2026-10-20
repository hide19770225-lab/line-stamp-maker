"use strict";
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.STAMP_TEST_URL || 'http://127.0.0.1:4174';
(async () => {
  const b = await chromium.launch({ executablePath:'/usr/bin/chromium', args:['--no-sandbox'] });
  try {
    const p = await b.newPage({ ...devices['iPhone 13'] });
    const errors=[]; p.on('pageerror', e=>errors.push(e.message)); p.on('dialog',d=>d.accept());
    await p.goto(base);
    await p.evaluate(()=>{
      const setGrid=StampProject.setGrid;
      StampProject.setGrid=(project,source,c,r)=>{
        setGrid(project,source,c,r); window.gridSource=source;
      };
    });
    const png=await p.evaluate(()=>{
      const c=StampCore.canvas(1000,1600),x=c.getContext('2d');
      x.fillStyle='white';x.fillRect(0,0,c.width,c.height);
      for(let r=0;r<8;r++)for(let col=0;col<5;col++){
        x.fillStyle='#317c65';x.fillRect(col*200+40,r*200+40,120,120);
      }
      return c.toDataURL().split(',')[1];
    });
    await p.setInputFiles('#file-input',{name:'5x8.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    const idle=()=>p.waitForFunction(()=>!document.body.classList.contains('busy'));
    await idle();
    await p.selectOption('#layout-preset','5x8');
    assert.match(await p.locator('#process-button').textContent(),/40個/);
    assert.equal(await p.locator('.crop-preview').count(),40);
    assert.deepEqual(await p.evaluate(()=>gridSource.xs),[0,.2,.4,.6,.8,1]);
    assert.deepEqual(await p.evaluate(()=>gridSource.ys),Array.from({length:9},(_,i)=>i/8));
    await p.click('#inspect-grid');await idle();
    assert.equal(await p.locator('.crop-error').count(),0);
    // Put the bottom of row 1 through artwork in column 1. Both neighbours
    // must be named, and all failures must be reported before any output.
    await p.locator('.crop-preview[data-cell="0"]').click();
    await p.locator('#cell-boundary-editor [data-edge="bottom"]').fill('20');
    await p.locator('#cell-boundary-editor [data-edge="bottom"]').dispatchEvent('change');
    await p.click('#process-button'); await idle();
    assert.equal(await p.locator('.crop-error').count(),2);
    const diagnostics=await p.locator('#split-diagnostics').textContent();
    assert.match(diagnostics,/コマ1（下辺）/);assert.match(diagnostics,/コマ6（上辺）/);
    assert.equal(await p.locator('.stamp-card').count(),0);
    await p.click('#auto-grid'); await idle();
    assert.equal(await p.locator('.crop-error').count(),0);
    // A local adjustment after automatic placement survives processing.
    await p.locator('.crop-preview[data-cell="0"]').click();
    await p.locator('#cell-boundary-editor [data-edge="bottom"]').fill('12.7');
    await p.locator('#cell-boundary-editor [data-edge="bottom"]').dispatchEvent('change');
    const before=await p.evaluate(()=>JSON.stringify([gridSource.xs,gridSource.ys,gridSource.columnYs]));
    await p.click('#process-button'); await idle();
    assert.equal(await p.locator('.stamp-card').count(),40);
    assert.equal(await p.evaluate(()=>JSON.stringify([gridSource.xs,gridSource.ys,gridSource.columnYs])),before);
    await p.selectOption('#layout-preset','2x5');
    assert.equal(await p.locator('.crop-preview').count(),10);
    assert.match(await p.locator('#process-button').textContent(),/10個/);
    assert.equal(await p.evaluate(()=>gridSource.columnYs),null);
    assert.deepEqual(errors,[]);
    await p.screenshot({path:'/tmp/grid-overview-iphone.png',fullPage:true});
    console.log('PASS: uniform 5x8, 40 button/previews, all crossing cells and named edges, automatic repair, per-cell adjustment retained, return to 10, zero page errors');
  } finally { await b.close(); }
})().catch(e=>{ console.error(e); process.exit(1); });
