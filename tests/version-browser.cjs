"use strict";
const { chromium, devices }=require('playwright'), assert=require('node:assert/strict');
const base=process.env.STAMP_TEST_URL||'http://127.0.0.1:4173';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const p=await browser.newPage({...devices['iPhone 13']});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base);assert.equal(await p.locator('#version-button').textContent(),'Ver. 不明');
  await p.click('#version-button');await p.waitForFunction(()=>document.querySelector('#version-status').textContent.includes('不明'));
  for(const id of ['build-version','build-time','build-commit','build-environment'])assert.equal(await p.locator('#'+id).textContent(),'不明');
  await p.click('#close-version');
  const info={version:'1.2.3',commit:'b'.repeat(40),builtAt:'2026-10-19T18:00:00Z',environment:'test-preview',buildId:'test-build-a'};
  await p.route('**/build-info.js*',r=>r.fulfill({contentType:'application/javascript',body:'window.STAMP_BUILD_INFO='+JSON.stringify(info)+';'}));
  let latest={...info};
  await p.route('**/build-info.json*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(latest)}));
  await p.reload();assert.equal(await p.locator('#version-button').textContent(),'Ver. 1.2.3');
  await p.click('#version-button');await p.waitForFunction(()=>document.querySelector('#version-status').textContent.includes('現在配信中'));
  assert.equal(await p.locator('#build-time').textContent(),'2026/10/20 03:00:00 JST');
  assert.equal(await p.locator('#build-commit').textContent(),info.commit);
  assert.equal(await p.locator('#build-environment').textContent(),info.environment);
  latest={...info,commit:'c'.repeat(40),version:'1.2.4',buildId:'test-build-b'};
  await p.click('#check-version');await p.waitForFunction(()=>!document.querySelector('#version-update').hidden);
  assert.equal(await p.locator('#version-button').textContent(),'Ver. 1.2.3','checking a newer deployment must not relabel this old page');
  await p.click('#close-version'); await p.selectOption('#production-mode','easy');
  assert.equal(await p.locator('#version-button').textContent(),'Ver. 1.2.3');
  assert(await p.locator('#version-button').isVisible());
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.click('#version-button');
  await p.unroute('**/build-info.json*'); await p.route('**/build-info.json*',r=>r.abort());
  await p.click('#check-version');await p.waitForFunction(()=>document.querySelector('#version-status').textContent.includes('取得できません'));
  assert.equal(await p.locator('#build-commit').textContent(),info.commit);
  p.on('dialog',d=>d.dismiss());
  await p.click('#reload-version');assert(!p.url().includes('reload='),'cancel preserves unsaved work');
  assert.deepEqual(errors,[]);console.log('PASS unknown metadata, JST, same version in both modes, stale cache detection, offline, reload cancellation');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
