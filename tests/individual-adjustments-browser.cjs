"use strict";
const { chromium, devices } = require("playwright"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), { execFileSync } = require("node:child_process");
const base = process.env.STAMP_TEST_URL || "http://127.0.0.1:4173";
const dir = process.env.STAMP_TEST_ARTIFACTS || "/tmp/stamp-adjustment-results";
(async () => {
  await fs.mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
  let normalControls;
  try {
    for (const count of [10, 40]) {
      const p = await browser.newPage({ ...devices["iPhone 13"], acceptDownloads: true });
      const errors = []; p.on("pageerror", e => errors.push(e.message)); p.on("dialog", d => d.accept());
      await p.goto(base);
      const idle = () => p.waitForFunction(() => !document.body.classList.contains("busy"), {}, { timeout: 120000 });
      await p.evaluate(() => {
        window.testStamps = {};
        const render = StampCore.renderStamp;
        StampCore.renderStamp = (s, t) => { if (s.slot) testStamps[s.slot] = s; return render(s, t); };
      });
      if (count === 40) await p.selectOption("#production-mode", "easy");
      const sheets = [];
      for (let start = 0; start < count; start += 10) {
        const data = await p.evaluate(start => {
          const c = StampCore.canvas(400, 1000), x = c.getContext("2d");
          x.fillStyle = "white"; x.fillRect(0, 0, 400, 1000);
          for (let i = 0; i < 10; i++) {
            x.fillStyle = `rgb(${50 + start + i},120,85)`;
            x.fillRect(i % 2 * 200 + 30, Math.floor(i / 2) * 200 + 30, 140, 140);
            // Asymmetric internal detail makes positioning/cropping changes observable.
            x.fillStyle = "#254136"; x.fillRect(i % 2 * 200 + 40, Math.floor(i / 2) * 200 + 40, 20, 30);
          }
          return c.toDataURL().split(",")[1];
        }, start);
        sheets.push({ name: `sheet-${start}.png`, mimeType: "image/png", buffer: Buffer.from(data, "base64") });
      }
      await p.setInputFiles(count === 40 ? "#easy-files" : "#file-input", sheets);
      await idle();
      assert(await p.locator(".workspace-grid").isVisible(), "source range adjustments remain visible in easy mode");
      await p.click(count === 40 ? "#easy-process" : "#process-all"); await idle();
      assert.equal(await p.locator(".stamp-card").count(), count);
      const snapshot = () => p.evaluate(() => Object.values(testStamps).sort((a,b)=>a.slot-b.slot).map(s => ({ slot:s.slot, crop:{...s.crop}, layout:{...s.layout}, style:JSON.parse(JSON.stringify(s.style)), png:StampCore.renderStamp(s).canvas.toDataURL() })));
      const baseline = await snapshot();
      for (const [j, slot] of (count === 40 ? [1,20,40] : [1,10]).entries()) {
        const before = await snapshot();
        await p.locator(`.stamp-card[data-slot="${slot}"]`).click();
        assert.equal(await p.locator("#edit-stamp-select option").count(), count);
        const controls = await p.locator(".image-controls input, .individual-crop input, #image-margin").evaluateAll(xs => xs.map(x => ({ id:x.id, min:x.min, max:x.max, step:x.step, options:x.tagName === 'SELECT' ? Array.from(x.options, o=>o.value) : null })));
        if (!normalControls) normalControls = controls; else assert.deepEqual(controls, normalControls);
        await p.locator("#image-scale").fill(String(65+j*5));
        await p.locator("#image-x").fill(String(20+j*20));
        await p.locator("#image-y").fill(String(70-j*20));
        await p.locator("#stamp-insets-left").fill(String(25+j));
        await p.locator("#stamp-insets-top").fill(String(20+j));
        await p.selectOption("#image-margin", "20");
        const edited = await p.locator("#edit-canvas").evaluate(c=>c.toDataURL());
        assert.notEqual(edited, before[slot-1].png);
        const after = await snapshot();
        for (let i=0;i<count;i++) if (i !== slot-1) assert.deepEqual(after[i], before[i], `${slot} must not affect ${i+1}`);
        if (slot === 40) await p.screenshot({ path:`${dir}/iphone-40-adjust.png` });
        await p.click("#save-stamp-adjustments");
        await p.waitForFunction(({slot,png}) => document.querySelector(`.stamp-card[data-slot="${slot}"] canvas`)?.toDataURL() === png, {slot,png:edited});
        await p.locator(`.stamp-card[data-slot="${slot}"]`).click();
        assert.equal(await p.inputValue("#image-scale"), String(65+j*5));
        assert.equal(await p.inputValue("#stamp-insets-left"), String(25+j));
        assert.equal(await p.inputValue("#image-margin"), "20");
        await p.click("#close-dialog");
      }
      const afterEdits = await snapshot();
      if(count === 40) {
        await p.click("#easy-process"); await idle();
        assert.deepEqual(await snapshot(), afterEdits, "processing again preserves individual settings");
        await p.check("#bulk-visual"); await p.click("#bulk-confirm");
      }
      const expected = await p.evaluate(() => Object.fromEntries(Object.values(testStamps).map(s=>[`${String(s.slot).padStart(2,'0')}.png`,StampCore.renderStamp(s).canvas.toDataURL().split(',')[1]])));
      await fs.writeFile(`${dir}/${count}-expected.json`, JSON.stringify(expected));
      const download = p.waitForEvent("download"); await p.click("#download-button");
      await (await download).saveAs(`${dir}/${count}.zip`); await idle();
      execFileSync("python", ["-c", "import zipfile,json,base64,sys; z=zipfile.ZipFile(sys.argv[1]); e=json.load(open(sys.argv[2])); assert z.testzip() is None; assert all(z.read(n)==base64.b64decode(b) for n,b in e.items()); assert len(z.namelist())==len(e)+2; print('ZIP exact PNG match:',len(e))", `${dir}/${count}.zip`, `${dir}/${count}-expected.json`], {stdio:'inherit'});
      if(count === 40) await p.click("#easy-details");
      const saved = p.waitForEvent("download"); await p.click("#save-project"); const json = `${dir}/${count}-project.json`; await (await saved).saveAs(json);
      const project = JSON.parse(await fs.readFile(json));
      for(let i=0;i<count;i++) {
        assert.deepEqual(project.slots[i].layout, afterEdits[i].layout);
        assert.deepEqual(project.slots[i].crop, afterEdits[i].crop);
        assert.deepEqual(project.slots[i].style, afterEdits[i].style);
      }
      // Reload JSON in a fresh page, reselect the same images, and render again.
      await p.reload(); await p.setInputFiles("#load-project", json); await idle();
      await p.setInputFiles("#file-input", sheets); await idle();
      await p.evaluate(() => {window.testStamps={};const render=StampCore.renderStamp;StampCore.renderStamp=(s,t)=>{if(s.slot)testStamps[s.slot]=s;return render(s,t);};});
      await p.click("#process-all"); await idle();
      assert.deepEqual(await snapshot(), afterEdits, "JSON restores per-image positions, ranges, margins and pixels");
      await p.locator('.stamp-card').first().click();
      await p.click('#next-stamp'); assert.equal(await p.inputValue('#edit-stamp-select'), '1');
      await p.click('#previous-stamp'); assert.equal(await p.inputValue('#edit-stamp-select'), '0');
      await p.selectOption('#edit-stamp-select', String(count-1));
      assert(await p.locator('#next-stamp').isDisabled()); await p.click('#close-dialog');
      assert(await p.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'no page horizontal overflow');
      assert.deepEqual(errors, []);
      console.log(`PASS ${count}: same controls, isolated changes, preview, ZIP, JSON round trip, navigation, iPhone viewport`);
      await p.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
