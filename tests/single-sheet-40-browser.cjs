"use strict";
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4174";
const image = process.env.STAMP_TEST_IMAGE;
const dir = process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-single40";
if (!image) throw new Error("Set STAMP_TEST_IMAGE to a 5-column, 8-row sheet PNG");
(async () => {
  await fs.mkdir(dir, {recursive:true});
  const browser = await chromium.launch({args:["--no-sandbox"]});
  try {
    const p = await browser.newPage({...devices["iPhone 13"],acceptDownloads:true});
    const errors=[]; p.on("pageerror", e=>errors.push(e.message)); p.on("dialog",d=>d.accept());
    await p.goto(base);
    const idle=()=>p.waitForFunction(()=>!document.body.classList.contains("busy"),{}, {timeout:120000});
    await p.evaluate(()=>{
      window.testStamps={};
      const render=StampCore.renderStamp;
      StampCore.renderStamp=(s,t)=>{if(s.slot)testStamps[s.slot]=s;return render(s,t);};
      const setGrid=StampProject.setGrid;
      StampProject.setGrid=(project,source,c,r)=>{
        window.beforeGrid={columns:source.columns,rows:source.rows,columnYs:source.columnYs};
        setGrid(project,source,c,r);
        window.afterGrid={columns:source.columns,rows:source.rows,columnYs:source.columnYs,manual:source.manualColumnYs};
      };
    });
    await p.selectOption("#production-mode","easy");
    await p.setInputFiles("#easy-files",image); await idle();
    // Easy import initially processes 2x5. Force valid previous column gutters
    // if this particular artwork has no reliable 2x5 gutters, matching the bug.
    await p.evaluate(()=>{
      const original=StampProject.setGrid;
      StampProject.setGrid=(project,source,c,r)=>{
        source.columnYs=Array.from({length:source.columns},()=>source.ys.slice());
        return original(project,source,c,r);
      };
    });
    await p.selectOption("#layout-preset","5x8"); await idle();
    const transition=await p.evaluate(()=>({before:beforeGrid,after:afterGrid}));
    assert.equal(transition.before.columnYs.length,2);
    assert.equal(transition.after.columnYs,null);
    assert.equal(transition.after.manual,false);
    assert.equal(await p.locator("#cell-assignments select").count(),40);
    await p.click("#easy-process"); await idle();
    assert.equal(await p.locator(".stamp-card").count(),40);
    const visited=[];
    for(let slot=1;slot<=40;slot++) {
      await p.locator(`.stamp-card[data-slot="${slot}"]`).click();
      assert.equal(await p.locator("#edit-stamp-select option").count(),40);
      assert.equal(await p.inputValue("#edit-stamp-select"),String(slot-1));
      assert(await p.locator("#image-scale").isVisible());
      assert(await p.locator("#stamp-insets-left").isVisible());
      visited.push(slot);
      // Exercise the existing per-image boundary acknowledgement UI.
      await p.check("#reviewed-checkbox");
      if(slot===40) await p.screenshot({path:path.join(dir,"iphone40-editor.png")});
      await p.click("#close-dialog");
    }
    await p.click("#bulk-inspect"); await idle();
    console.log(await p.locator("#bulk-summary").textContent());
    const failures=await p.locator('.bulk-result[data-status="エラー"]').allTextContents();
    assert.deepEqual(failures,[]);
    await p.check("#bulk-visual"); await p.click("#bulk-confirm");
    const expected=await p.evaluate(()=>Object.fromEntries(Object.values(testStamps).map(s=>[`${String(s.slot).padStart(2,'0')}.png`,StampCore.renderStamp(s).canvas.toDataURL().split(',')[1]])));
    if (process.env.STAMP_REQUIRE_DISTINCT_OUTPUT === "1") {
      const images = Object.values(expected);
      assert.equal(images.length, 40, "expected 40 rendered outputs");
      const distinct = new Set(images);
      assert.equal(distinct.size, 40, "different source cells must not produce identical stamp PNGs");
      console.log("PASS: all 40 rendered PNGs are pixel-distinct");
    }
    await fs.writeFile(path.join(dir,"expected.json"),JSON.stringify(expected));
    const download=p.waitForEvent("download"); await p.click("#download-button");
    await (await download).saveAs(path.join(dir,"40.zip")); await idle();
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(dir,"result.json"),JSON.stringify({image,engine:"Chromium, iPhone 13 emulation (not physical Safari)",transition,visited,errors,visualReview:"NOT PERFORMED: browser test acknowledges bulk visual confirmation to exercise ZIP download; it does not certify illustration quality",distinctArtwork:"NOT VERIFIED by this browser test: run check_distinct_40_sheet.py on the actual 5x8 source first"},null,2));
    console.log("PASS: single 5x8 sheet, 2-column stale state reset, all 40 editors, ZIP downloaded, zero page errors");
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
