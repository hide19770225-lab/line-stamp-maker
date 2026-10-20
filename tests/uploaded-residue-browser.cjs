/* Optional real-upload UI regression: STAMP_RESIDUE_FIXTURES contains 01.png–10.png. */
const {chromium,devices}=require('playwright'),fs=require('fs/promises'),assert=require('assert/strict');
const fixtures=process.env.STAMP_RESIDUE_FIXTURES, output=process.env.STAMP_TEST_ARTIFACTS || '/tmp/uploaded-residue-review';
if(!fixtures)throw Error('Set STAMP_RESIDUE_FIXTURES to the uploaded ten PNGs');
(async()=>{const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
await fs.mkdir(output,{recursive:true});
const p=await b.newPage({...devices['iPhone 13'],acceptDownloads:true}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
await p.goto(process.env.STAMP_TEST_URL || 'http://127.0.0.1:4173');await p.evaluate(()=>{const r=StampCore.renderStamp;window.actualStamps={};StampCore.renderStamp=(s,t)=>{const out=r(s,t);if(s.slot)actualStamps[s.slot]=s;return out;};});
await p.selectOption('#default-layout','1x1');await p.setInputFiles('#file-input',Array.from({length:10},(_,i)=>`${fixtures}/${String(i+1).padStart(2,'0')}.png`));
await p.waitForFunction(()=>!document.body.classList.contains('busy'));await p.click('#process-all');await p.waitForFunction(()=>document.querySelectorAll('.stamp-card').length===10&&!document.body.classList.contains('busy'));
const evidence=[];
for(const slot of [2,8]){await p.locator('.stamp-card').nth(slot-1).click();await p.uncheck('#auto-cleanup-enabled');if(!await p.locator('#residue-panel').evaluate(e=>e.open))await p.locator('#residue-panel summary').click();
const row=p.locator('#residue-candidates > div').filter({hasText:'周囲の文字・装飾から離れた細い断片'});await row.waitFor({state:'visible'});assert.equal(await row.count(),1);assert(await row.locator('input').isEnabled());assert.match(await row.innerText(),/要確認/);assert.equal(await p.locator('#residue-candidates input:checked').count(),0);
const before=await p.evaluate(n=>Array.from(actualStamps[n].mask),slot);await row.locator('button').click();await p.selectOption('#residue-background','black');await p.locator('#residue-viewport').screenshot({path:`${output}/app-${slot}-before.png`});
await row.locator('input').check();await p.click('#remove-residue');const after=await p.evaluate(n=>Array.from(actualStamps[n].mask),slot);let changed=0;for(let i=0;i<before.length;i++)if(before[i]!==after[i]){assert.equal(after[i],0);changed++;}assert.equal(changed,slot===2?15:14);
await p.click('#undo-brush');assert.deepEqual(await p.evaluate(n=>Array.from(actualStamps[n].mask),slot),before);await p.click('#redo-brush');assert.deepEqual(await p.evaluate(n=>Array.from(actualStamps[n].mask),slot),after);
await p.locator('#residue-viewport').screenshot({path:`${output}/app-${slot}-after.png`});await p.click('#close-dialog');evidence.push({slot,changed,undoRedo:true});}
let dl=p.waitForEvent('download');await p.click('#download-button');await(await dl).saveAs(`${output}/app-export.zip`);assert.deepEqual(errors,[]);
await fs.writeFile(`${output}/app-evidence.json`,JSON.stringify({evidence,errors},null,2));console.log('PASS: 10 imports, review reasons, 2 explicit deletions, 29 native alpha changes, undo/redo, ZIP, zero page errors');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
