'use strict';
// User-supplied real source stays local; no fixture image is committed.
const {chromium, devices}=require('playwright');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const dir=process.env.STAMP_TEST_ARTIFACTS;
if(!dir || !process.env.STAMP_ACTUAL40_SOURCE) throw Error('Set STAMP_TEST_ARTIFACTS and STAMP_ACTUAL40_SOURCE');
(async()=>{
 await fs.mkdir(dir,{recursive:true});
 const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const p=await b.newPage({...devices['iPhone 13'],acceptDownloads:true});
  const errors=[],external=[];
  await p.route('**/*',route=>{const u=route.request().url();if(!u.startsWith('http://127.0.0.1:4173/')&&!u.startsWith('data:')&&!u.startsWith('blob:')){external.push(u);return route.abort();}return route.continue();});
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:4173');
  await p.selectOption('#easy-layout','5x8');await p.selectOption('#easy-caption-mode','existing');
  await p.evaluate(()=>{window.real={};const create=StampCore.createTile;StampCore.createTile=(s,...args)=>{window.realSource=s;return create(s,...args);};const render=StampCore.renderStamp;StampCore.renderStamp=(s,t)=>{if(s.slot)real[s.slot]=s;return render(s,t);};});
  await p.setInputFiles('#easy-files',process.env.STAMP_ACTUAL40_SOURCE);
  const idle=()=>p.waitForFunction(()=>!document.body.classList.contains('busy'),{},{timeout:120000});
  await idle();await p.click('#easy-process');await idle();
  assert.equal(await p.locator('.stamp-card').count(),40);
  const report=await p.evaluate(()=>Object.values(real).sort((a,b)=>a.slot-b.slot).map(s=>({slot:s.slot,rect:s.sourceRect,boundary:s.boundaryReview,individual:s.individualReviewRequired,guide:s.guidePixelsRemoved,removed:StampCore.renderStamp(s).autoRemoved})));
  const pixels=await p.evaluate(()=>{
   const s=realSource,c=StampCore.canvas(s.width,s.height),ctx=c.getContext('2d');ctx.drawImage(s.image,0,0);
   const data=ctx.getImageData(0,0,c.width,c.height).data,bg=Array.from(data.slice(0,3));
   const ink=(x,y)=>bg.some((v,k)=>Math.abs(data[(y*c.width+x)*4+k]-v)>30);
   let crossings=0,warm=0,lost=0,strong=0,strongLost=0;
   for(const t of Object.values(real)) {
    const r=t.sourceRect;
    for(const x of [r.x,r.x+r.width])if(x>0&&x<c.width)for(let y=r.y;y<r.y+r.height;y++)crossings+=+ink(x,y);
    for(const y of [r.y,r.y+r.height])if(y>0&&y<c.height)for(let x=r.x;x<r.x+r.width;x++)crossings+=+ink(x,y);
    for(let i=0;i<t.mask.length;i++) {const rgb=t.original.data.subarray(i*4,i*4+3),hi=Math.max(...rgb),lo=Math.min(...rgb);if(hi>=250&&lo>=230&&hi-lo>=12){warm++;if(t.mask[i]!==255)lost++;}if(bg.some((v,k)=>Math.abs(rgb[k]-v)>30)){strong++;if(t.mask[i]!==255)strongLost++;}}
   }
   return {crossings,warm,lost,strong,strongLost,rowGrid:StampCore.activeRowGrid(s)};
  });
  if(process.env.STAMP_REVIEW_EXPORT==='1'){assert.equal(pixels.crossings,0);assert.equal(pixels.lost,0);assert.equal(pixels.strongLost,0);assert(pixels.warm>10000);assert(pixels.rowGrid);}
  const pngs=await p.locator('.stamp-canvas').evaluateAll(cs=>cs.map(c=>c.toDataURL().split(',')[1]));
  for(let i=0;i<40;i++)await fs.writeFile(`${dir}/${String(i+1).padStart(2,'0')}.png`,Buffer.from(pngs[i],'base64'));
  await p.selectOption('#production-mode','normal');await p.click('#bulk-inspect');await idle();
  const bulk=await p.locator('#bulk-results').innerText();
  await fs.writeFile(`${dir}/evidence.json`,JSON.stringify({report,pixels,bulk,errors,external},null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify(report,null,2));
  if(process.env.STAMP_REVIEW_EXPORT==='1') {
   await p.click('#process-button');await idle();
   const repeat=await p.locator('.stamp-canvas').evaluateAll(cs=>cs.map(c=>c.toDataURL().split(',')[1]));
   assert.deepEqual(repeat,pngs,'repeat processing preserves all 40 PNGs');
   await p.click('#bulk-inspect');await idle();
   assert.equal(await p.locator('.bulk-result[data-status="エラー"]').count(),0);
   await p.check('#bulk-visual');await p.click('#bulk-confirm');
   await p.selectOption('#production-mode','easy');await p.click('#easy-export');await idle();
   const download=p.waitForEvent('download');await p.click('#download-direct');await(await download).saveAs(`${dir}/line-stamps-fixed-40.zip`);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  }
 } finally {await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
