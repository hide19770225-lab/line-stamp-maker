'use strict';
// Real supplied source, not a synthetic reconstruction. No external services.
const {chromium, devices} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const dir = process.env.STAMP_TEST_ARTIFACTS || '/tmp/stamp-actual40';
(async () => {
  await fs.mkdir(dir, {recursive:true});
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const page = await browser.newPage({...devices['iPhone 13'],acceptDownloads:true});
    const errors=[], external=[];
    const base=process.env.STAMP_TEST_URL || 'http://127.0.0.1:4173';
    page.on('pageerror', e=>errors.push(e.message));
    page.on('request', r=>{if(![base,'data:','blob:'].some(x=>r.url().startsWith(x))) external.push(r.url());});
    await page.goto(base);
    await page.selectOption('#easy-layout','5x8');
    await page.selectOption('#easy-caption-mode','existing');
    await page.evaluate(()=>{
      window.actual40={};
      const create=StampCore.createTile;
      StampCore.createTile=(...args)=>{
        const s=create(...args), [source,c,r,mode,tolerance,color]=args;
        window.actualSource=source;
        const baseline=StampCore.floodMask(s.original,mode,tolerance,color);
        // Independently annotated source guide zones; no predicted ROI is used.
        const gx=[18,249,478,691,910][c], gy=[0,170,335,505,668,837,997,1173][r];
        let changed=0, outside=0, remaining=0, dark=0, remainingPoints=[];
        for(let i=0;i<s.mask.length;i++) {
          const x=i%s.original.width+s.sourceRect.x;
          const y=Math.floor(i/s.original.width)+s.sourceRect.y;
          const guide=x>=gx && x<gx+45 && y>=gy && y<gy+35;
          if(s.mask[i]!==baseline[i]) {changed++; if(!guide) outside++;}
          const rgb=s.original.data.subarray(i*4,i*4+3);
          if(guide && Math.max(...rgb)<95 && Math.max(...rgb)-Math.min(...rgb)<35) {
            dark++; if(s.mask[i]) {remaining++;remainingPoints.push([x,y]);}
          }
        }
        actual40[r*5+c+1]={rect:s.sourceRect,changed,outside,remaining,dark,remainingPoints,removed:s.guidePixelsRemoved};
        return s;
      };
    });
    await page.setInputFiles('#easy-files',process.env.STAMP_ACTUAL40_SOURCE || path.join(__dirname,'fixtures/actual40/source.png'));
    const idle=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'),{},{timeout:120000});
    await idle();await page.click('#easy-process');await idle();
    assert.equal(await page.locator('.stamp-card').count(),40);
    const evidence=await page.evaluate(()=>({tiles:actual40,xs:actualSource.xs,columnYs:actualSource.columnYs}));
    assert.equal(Object.keys(evidence.tiles).length,40);
    for(const [i,t] of Object.entries(evidence.tiles)) {
      assert(t.dark>20 && t.changed>0 && t.removed===t.changed,`${i}: guide found and removed`);
      assert.equal(t.remaining,0,`${i}: no dark guide pixels remain`);
      assert.equal(t.outside,0,`${i}: all other native alpha unchanged`);
    }
    // Every actual full-resolution cut must pass through background, including
    // columns. Output-edge margins alone cannot detect a damaged source cut.
    const safe=await page.evaluate(()=>{
      const s=actualSource, c=StampCore.canvas(s.image.width,s.image.height),ctx=c.getContext('2d');
      ctx.drawImage(s.image,0,0);const {data,width,height}=ctx.getImageData(0,0,c.width,c.height);
      const ink=(x,y)=>[0,1,2].some(k=>Math.abs(data[(y*width+x)*4+k]-data[k])>30);
      for(const line of s.xs.slice(1,-1)) for(let y=0;y<height;y++) if(ink(Math.round(line*width),y)) return false;
      for(let col=0;col<5;col++) for(const line of s.columnYs[col].slice(1,-1))
        for(let x=Math.round(s.xs[col]*width);x<Math.round(s.xs[col+1]*width);x++) if(ink(x,Math.round(line*height)))return false;
      return true;
    });
    assert(safe,'no actual foreground intersects any split');
    // Check automatic column provenance survives project save/reload validation.
    await page.selectOption('#production-mode','normal');
    let download=page.waitForEvent('download');await page.click('#save-project');
    const settings=path.join(dir,'actual40-project.json');await (await download).saveAs(settings);
    const project=JSON.parse(await fs.readFile(settings,'utf8'));
    const P=require('../project.js');
    assert.deepEqual(P.readProject(project).sources[0].autoGridXs,evidence.xs);
    await page.click('#process-all');await idle();
    assert.deepEqual(await page.evaluate(()=>actualSource.columnYs),evidence.columnYs,'reprocessing keeps cuts');
    await page.click('#bulk-inspect');await idle();
    assert.equal(await page.locator('.bulk-result[data-status="エラー"]').count(),0);
    // Human review is performed on the generated contact sheet separately.
    await page.check('#bulk-visual');await page.click('#bulk-confirm');
    const pngs=await page.locator('.stamp-canvas').evaluateAll(cs=>cs.map(c=>c.toDataURL().split(',')[1]));
    for(let i=0;i<40;i++)await fs.writeFile(path.join(dir,`${String(i+1).padStart(2,'0')}.png`),Buffer.from(pngs[i],'base64'));
    await page.selectOption('#production-mode','easy');await page.click('#easy-export');await idle();
    download=page.waitForEvent('download');await page.click('#download-direct');
    await (await download).saveAs(path.join(dir,'line-stamps-fixed-40.zip'));
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(dir,'evidence.json'),JSON.stringify({...evidence,safeCuts:safe,externalRequests:external,errors},null,2));
    console.log('PASS real 40: all guides removed; all non-guide native alpha preserved; all 39 split segments foreground-free; repeat processing and project validation; 42-PNG app ZIP; no external requests.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
