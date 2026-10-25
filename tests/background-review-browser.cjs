'use strict';
const {chromium,devices}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({...devices['iPhone 13']});
  await page.goto(process.env.STAMP_TEST_URL||'http://127.0.0.1:4173');
  await page.selectOption('#easy-layout','5x8');
  await page.selectOption('#easy-caption-mode','existing');
  const png=await page.evaluate(()=>{
   const c=StampCore.canvas(800,1280),ctx=c.getContext('2d');
   for(let y=0;y<c.height;y+=8)for(let x=0;x<c.width;x+=8){
    ctx.fillStyle=((x+y)/8)%2?'#ccc':'#fff';ctx.fillRect(x,y,8,8);
   }
   return c.toDataURL().split(',')[1];
  });
  await page.setInputFiles('#easy-files',{name:'synthetic-checker.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  const idle=()=>page.waitForFunction(()=>!document.body.classList.contains('busy'),{},{timeout:120000});
  await idle();await page.click('#easy-process');await idle();
  const cards=await page.locator('.stamp-card').count();
  if(cards!==40){
   const diagnostics=await page.evaluate(()=>({
    status:document.querySelector('#easy-status')?.textContent,
    errors:[...document.querySelectorAll('[role="alert"], .error, #status, #easy-result')].map(el=>el.textContent).filter(Boolean).slice(0,8),
    busy:document.body.classList.contains('busy'),
    heading:document.title
   }));
   console.error('PROCESS DIAGNOSTICS',JSON.stringify(diagnostics));
  }
  assert.equal(cards,40);
  await page.selectOption('#production-mode','normal');
  await page.click('#bulk-inspect');await idle();
  assert((await page.locator('#bulk-results').textContent()).includes('個別編集して確認済み'));
  assert(await page.locator('#bulk-visual').isDisabled());
  assert(await page.locator('#bulk-confirm').isDisabled());
  console.log('PASS synthetic painted checker: 40 previews; individual review required; bulk approval blocked.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
