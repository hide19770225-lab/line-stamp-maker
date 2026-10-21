"use strict";
// WebKit is Safari's browser engine, but Linux WebKit is NOT physical iPhone Safari.
const { webkit, devices } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ ...devices["iPhone 13"], acceptDownloads: true });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("http://127.0.0.1:4176/", {waitUntil:"domcontentloaded"});
    assert.equal(await page.locator("#production-mode").count(),1);
    assert.equal(await page.locator("#layout-preset").count(),1);
    await page.selectOption("#production-mode","easy");
    assert.equal(await page.locator("#easy-files").count(),1);
    // This selector is hidden until an image is imported.
    assert.equal(await page.locator('#layout-preset option[value="5x8"]').count(),1);
    assert.equal(await page.locator("#layout-preset").isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log("PASS: WebKit iPhone emulation loads app and confirms 5x8 option exists (hidden until import); physical Safari NOT tested");
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exit(1);});
