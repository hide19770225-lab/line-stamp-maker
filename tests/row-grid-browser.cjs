'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const p=await b.newPage();await p.goto(process.env.STAMP_TEST_URL||'http://127.0.0.1:4173');
  const result=await p.evaluate(()=>{
   const c=StampCore.canvas(500,800),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,500,800);
   ctx.fillStyle='#345';for(let r=0;r<8;r++)for(let col=0;col<5;col++)ctx.fillRect(col*100+10+(r%2?11:-11),r*100+20,80,60);
   const vertical=StampCore.suggestGridLines(c,5,1),grid=StampCore.suggestRowGrid(c,5,8);
   const s={image:c,columns:5,rows:8,xs:[0,.2,.4,.6,.8,1],ys:Array.from({length:9},(_,i)=>i/8)};
   s.autoRowGrid={...grid,key:JSON.stringify([s.xs,s.ys,false])};
   const rect=StampCore.tileRect(s,2,1),active=!!StampCore.activeRowGrid(s);
   s.xs[2]=.41;const stale=!!StampCore.activeRowGrid(s);
   // Nearest 2-pixel gutter wins over a wider corridor after a detached prop.
   const n=StampCore.canvas(200,100),nc=n.getContext('2d');nc.fillStyle='white';nc.fillRect(0,0,200,100);nc.fillStyle='#345';
   nc.fillRect(0,20,99,60);nc.fillRect(101,20,9,60);nc.fillRect(120,20,80,60);
   const nearest=StampCore.suggestGridLines(n,2,1,true).xs[1];
   // Destroy the row separator; never return a guessed eight-row grid.
   ctx.fillRect(20,70,10,60);const ambiguous=StampCore.suggestRowGrid(c,5,8);
   return {vertical,grid,rect,active,stale,nearest,ambiguous};
  });
  assert.equal(result.vertical,null);assert.equal(result.grid.xs.length,8);assert.equal(result.grid.ys.length,9);
  assert(result.active);assert(!result.stale);assert.equal(result.nearest,.5);assert.equal(result.ambiguous,null);
  assert(result.rect.x>200);console.log('PASS staggered row grid, exact row count, stale manual grid rejection, nearest narrow gutter');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
