/* Pixel evidence, not semantic acceptance. A stopped baseline tile is saved
   ONLY as an explicitly labelled diagnostic reconstruction. */
'use strict';
const {chromium,devices}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const baseRef=process.env.STAMP_BASE_REF||'a7fbe457986099289816cb1c7a7b34f0ee2e95f2';
const input=process.env.STAMP_CUTOUT_INPUT||'tests/fixtures/BBE9DC5F-F70D-490D-B5E3-40E2D682218B.png';
const dir=process.env.STAMP_TEST_ARTIFACTS||'work/cutout-comparison';
const base=process.env.STAMP_TEST_URL||'http://127.0.0.1:4173';
const sha=b=>createHash('sha256').update(b).digest('hex');
const writePng=(file,url)=>fs.writeFileSync(path.join(dir,file),Buffer.from(url.split(',')[1],'base64'));
(async()=>{
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(dir,'final'),{recursive:true});
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});
 try{
  const p=await b.newPage({...devices['iPhone 13'],acceptDownloads:true});
  await p.goto('about:blank');await p.addScriptTag({content:execFileSync('git',['show',`${baseRef}:core.js`],{encoding:'utf8'})});
  await p.evaluate(()=>window.Before=StampCore);await p.addScriptTag({path:'core.js'});
  const result=await p.evaluate(async base64=>{
   const im=new Image();im.src='data:image/png;base64,'+base64;await im.decode();const results={};
   for(const [name,C] of [['before',Before],['after',StampCore]]){
    const columnYs=C.suggestColumnRowLines(im,[0,.5,1],5);if(!columnYs)throw Error(`${name}: no safe grid; no equal-grid fallback allowed`);
    const source={image:im,xs:[0,.5,1],ys:[0,.2,.4,.6,.8,1],columnYs,columns:2,rows:5,mode:'auto'};
    results[name]={columnYs,tiles:[]};
    for(let n=0;n<10;n++){
     const col=n%2,row=Math.floor(n/2),rect=C.tileRect(source,col,row);let error=null,tile;
     try{tile=C.createTile(source,col,row,'auto',24,'#ffffff')}catch(e){
      if(name==='after')throw e;
      error=e.message;const c=C.canvas(rect.width,rect.height);c.getContext('2d').drawImage(im,-rect.x,-rect.y);
      const original=c.getContext('2d').getImageData(0,0,c.width,c.height);
      tile={original,mask:C.floodMask(original,'auto',24),boundaryReview:null};
     }
     const c=C.canvas(tile.original.width,tile.original.height),ctx=c.getContext('2d'),out=ctx.createImageData(c.width,c.height);
     out.data.set(tile.original.data);const bg=C.backgroundColor(tile.original.data,c.width,c.height);let strong=0,strongChanged=0,chromatic=0,chromaticChanged=0;
     for(let i=0;i<tile.mask.length;i++){
      const k=i*4,d=tile.original.data,hi=Math.max(d[k],d[k+1],d[k+2]),lo=Math.min(d[k],d[k+1],d[k+2]);
      if(Math.max(...bg.map((v,j)=>Math.abs(v-d[k+j])))>56){strong++;if(tile.mask[i]!==d[k+3])strongChanged++;}
      if(hi-lo>24&&Math.max(...bg.map((v,j)=>Math.abs(v-d[k+j])))>24){chromatic++;if(tile.mask[i]!==d[k+3])chromaticChanged++;}
      out.data[k+3]=tile.mask[i];
     }
     for(const [i,r,g,b] of tile.matte||[]) out.data.set([r,g,b],i*4);
     ctx.putImageData(out,0,0);
     const oldMask=Before.floodMask(tile.original,'auto',24);
     let whiteChanged=0,darkChanged=0,alphaRemoved=0;
     for(let i=0;i<tile.mask.length;i++) {
      const d=tile.original.data,k=i*4;
      if(oldMask[i] && Math.min(d[k],d[k+1],d[k+2])>=231 && tile.mask[i]!==oldMask[i]) whiteChanged++;
      if(oldMask[i] && Math.max(d[k],d[k+1],d[k+2])<=75 && tile.mask[i]!==oldMask[i]) darkChanged++;
      if(oldMask[i] && !tile.mask[i]) alphaRemoved++;
     }
     if(name==='after'){if(whiteChanged||darkChanged||alphaRemoved) throw Error('protected pixels changed');}

     const original=C.canvas(c.width,c.height);original.getContext('2d').putImageData(tile.original,0,0);
     const sourceEdgeInk={};
     const isInk=(x,y)=>{
      const k=(y*tile.original.width+x)*4,d=tile.original.data;
      return Math.min(d[k],d[k+1],d[k+2])<205||Math.max(d[k],d[k+1],d[k+2])-Math.min(d[k],d[k+1],d[k+2])>35;
     };
     const w=tile.original.width,h=tile.original.height;
     sourceEdgeInk.top=Array.from({length:w},(_,x)=>isInk(x,0)).filter(Boolean).length;
     sourceEdgeInk.bottom=Array.from({length:w},(_,x)=>isInk(x,h-1)).filter(Boolean).length;
     sourceEdgeInk.left=Array.from({length:h},(_,y)=>isInk(0,y)).filter(Boolean).length;
     sourceEdgeInk.right=Array.from({length:h},(_,y)=>isInk(w-1,y)).filter(Boolean).length;
     results[name].tiles.push({n:n+1,rect,error,diagnosticOnly:!!error,review:tile.boundaryReview,sourceEdgeInk,
      whiteChanged,darkChanged,alphaRemoved,unmatted:(tile.matte||[]).length,strong,strongChanged,chromatic,chromaticChanged,png:c.toDataURL(),original:original.toDataURL()});
    }
   }
   return results;
  },fs.readFileSync(input).toString('base64'));
  for(const [state,r] of Object.entries(result))for(const t of r.tiles){
   const number=String(t.n).padStart(2,'0');writePng(`${state}-${number}.png`,t.png);
   if(state==='after'){writePng(`source-${number}.png`,t.original);assert.equal(t.chromaticChanged,0,`chromatic foreground ${number}`);}
   delete t.png;delete t.original;
  }
  await p.goto(base);const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  await p.evaluate(()=>{window.testTiles=[];const create=StampCore.createTile;StampCore.createTile=(...a)=>{const s=create(...a);testTiles.push(s);return s}});
  await p.selectOption('#default-layout','2x5');await p.setInputFiles('#file-input',input);
  await p.waitForFunction(()=>document.querySelectorAll('.source-card').length===1&&!document.body.classList.contains('busy'));
  await p.click('#process-all');await p.waitForFunction(()=>!document.body.classList.contains('busy'));
  assert.equal(await p.locator('.stamp-card').count(),10,await p.locator('#status').innerText());
  const outputs=await p.evaluate(()=>testTiles.map(s=>{const rendered=StampCore.renderStamp(s);return {rect:s.sourceRect,review:s.boundaryReview,autoRemoved:rendered.autoRemoved,png:rendered.canvas.toDataURL()}}));
  for(let i=0;i<10;i++){writePng(`final/${String(i+1).padStart(2,'0')}.png`,outputs[i].png);delete outputs[i].png;assert.deepEqual(outputs[i].rect,result.after.tiles[i].rect);}
  const download=p.waitForEvent('download');await p.click('#download-button');await(await download).saveAs(path.join(dir,'app-10.zip'));
  assert.deepEqual(errors,[]);
  result.provenance={baseline:baseRef,input,inputSha256:sha(fs.readFileSync(input)),mode:'auto',tolerance:24,layout:'2x5',insets:0,semanticAcceptance:'NOT PASSED: manual review required'};
  result.app={errors,tiles:outputs};
  const reviewItems=result.after.tiles.filter(t=>t.review?.needsReview);
  const reviewReport=[
   '# Real-image cutout review (not semantic acceptance)',
   '',
   'This is an automated triage report. A green CI run does not mean every outline or caption is visually correct.',
   '',
   '| Sticker | Review | Flagged boundaries | Source edge ink (T/B/L/R) |',
   '|---|---|---|---|',
   ...result.after.tiles.map(t=>`| ${String(t.n).padStart(2,'0')} | ${t.review?.needsReview?'REVIEW REQUIRED':'No boundary warning'} | ${(t.review?.edges||[]).join(', ')||'-'} | ${Object.values(t.sourceEdgeInk||{}).join('/')} |`),
   '',
   `**${reviewItems.length}/10 images require boundary review.**`,
   '',
   'Inspect source-NN.png, before-NN.png, after-NN.png, and final/NN.png at full resolution.',
   'The pixel-protection assertions do not establish correct crop placement or absence of white fringe.',
   'Manual approval and real iPhone Safari operation remain outstanding.',
   ''
  ].join('\n');
  fs.writeFileSync(path.join(dir,'review-report.md'),reviewReport);
  console.log(`BOUNDARY REVIEW: ${reviewItems.length}/10 require manual inspection; see review-report.md`);
  fs.writeFileSync(process.env.GITHUB_STEP_SUMMARY||path.join(dir,'ci-summary.md'),reviewReport,{flag:'a'});
  fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify(result,null,2));
  console.log('PASS mechanical checks: 10 source tiles; white/dark alpha unchanged; no new transparent pixels; chromatic alpha unchanged; 10 app outputs and ZIP. This does not certify visual quality.');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
