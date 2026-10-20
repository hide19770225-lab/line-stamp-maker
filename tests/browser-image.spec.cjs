const fs=require("node:fs");
// Browser integration: load a real raster sheet and run the image processing path.
// The synthetic sheet has white gutters and ten separate colored subjects.
// Run: npx playwright test tests/browser-image.spec.cjs
const {test,expect}=require("@playwright/test");
test.setTimeout(240000);
for(const count of [8,16,24,32,40]) test(`${count} stickers: import PNG sheets and generate processed previews`,async ({page})=>{
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:8765/");
  await page.locator("#production-mode").selectOption("easy");
  await page.locator("#easy-target").selectOption(String(count));
  const data=await page.evaluate(()=>{
    const c=document.createElement("canvas");c.width=600;c.height=1000;
    const ctx=c.getContext("2d");ctx.fillStyle="#ffffff";ctx.fillRect(0,0,600,1000);
    for(let row=0;row<5;row++)for(let col=0;col<2;col++){
      const x=col*300+150,y=row*200+100;
      ctx.fillStyle=`hsl(${(row*2+col)*33},65%,48%)`;
      ctx.beginPath();ctx.arc(x,y,48,0,Math.PI*2);ctx.fill();
    }
    return c.toDataURL("image/png").split(",")[1];
  });
  const sheets=Array.from({length:Math.ceil(count/10)},(_,i)=>({
    name:`test-sheet-${i+1}.png`,mimeType:"image/png",buffer:Buffer.from(data,"base64")
  }));
  // Distinct source images are required; regenerate a unique raster for each sheet.
  for(let i=0;i<sheets.length;i++){
    const encoded=await page.evaluate((index)=>{
      const c=document.createElement("canvas");c.width=600;c.height=1000;
      const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,600,1000);
      for(let row=0;row<5;row++)for(let col=0;col<2;col++){
        ctx.fillStyle=`hsl(${(index*37+row*2+col)*33%360},65%,48%)`;
        ctx.beginPath();ctx.arc(col*300+150,row*200+100,48,0,Math.PI*2);ctx.fill();
      }
      return c.toDataURL("image/png").split(",")[1];
    },i);
    sheets[i].buffer=Buffer.from(encoded,"base64");
  }
  await page.locator("#easy-files").setInputFiles(sheets);
  await expect(page.locator("#easy-state")).toContainText(`読込済み${sheets.length}枚`,{timeout:90000});
  await page.locator("#easy-process").click();
  await expect(page.locator("#easy-state")).toContainText(`加工済み${count}個`,{timeout:150000});
  await expect(page.locator("#easy-failure")).toBeHidden();
  // Inspect the actual rendered canvases, not just the status counter.
  await expect(page.locator("#stamp-grid canvas")).toHaveCount(count);
  const images=await page.locator("#stamp-grid canvas").evaluateAll(canvases=>
    canvases.map(c=>{
      const ctx=c.getContext("2d");
      const {data}=ctx.getImageData(0,0,c.width,c.height);
      let opaque=0,transparent=0,nearWhiteOpaque=0;
      for(let i=3;i<data.length;i+=4){
        if(data[i]===0) transparent++;
        if(data[i]>0){
          opaque++;
          const j=i-3;
          if(data[i]>240&&data[j]>245&&data[j+1]>245&&data[j+2]>245)nearWhiteOpaque++;
        }
      }
      const cornerAlpha=[0, c.width-1, (c.height-1)*c.width, c.width*c.height-1].map(p=>data[p*4+3]);
      return {width:c.width,height:c.height,opaque,transparent,nearWhiteOpaque,cornerAlpha};
    })
  );
  for(const img of images){
    expect(img.width).toBe(370);
    expect(img.height).toBe(320);
    expect(img.opaque).toBeGreaterThan(0);
    expect(img.transparent).toBeGreaterThan(0);
    expect(img.cornerAlpha).toEqual([0,0,0,0]);
    // Synthetic sheets have white backgrounds, but no white artwork.
    // Catch incomplete background removal leaving visible white patches.
    expect(img.nearWhiteOpaque/img.opaque).toBeLessThan(0.05);
  }

  {
    // The automated inspection is not user approval: explicitly confirm the
    // synthetic artwork in this controlled test before exporting.
    await expect(page.locator("#bulk-visual")).toBeEnabled();
    await page.locator("#bulk-visual").check();
    await expect(page.locator("#bulk-confirm")).toBeEnabled();
    await page.locator("#bulk-confirm").click();
    const downloadPromise=page.waitForEvent("download");
    await page.locator("#easy-export").click();
    const download=await downloadPromise;
    await expect(page.locator("#download-link")).toBeVisible({timeout:60000});
    const bytes=fs.readFileSync(await download.path());
    const names=[];
    const pngs=new Map();
    for(let i=0;i+30<bytes.length;i++){
      if(bytes[i]===0x50&&bytes[i+1]===0x4b&&bytes[i+2]===3&&bytes[i+3]===4){
        const method=bytes.readUInt16LE(i+8);
        const n=bytes.readUInt16LE(i+26);
        const extra=bytes.readUInt16LE(i+28);
        const size=bytes.readUInt32LE(i+18);
        const name=bytes.subarray(i+30,i+30+n).toString("utf8");
        const payload=bytes.subarray(i+30+n+extra,i+30+n+extra+size);
        names.push(name);
        // This app creates ZIP entries without compressing PNGs.
        expect(method).toBe(0);
        expect(payload.length).toBe(size);
        expect(payload.subarray(0,8).toString("hex")).toBe("89504e470d0a1a0a");
        expect(payload.subarray(12,16).toString("ascii")).toBe("IHDR");
        const width=payload.readUInt32BE(16),height=payload.readUInt32BE(20);
        const colorType=payload[25];
        expect(colorType===4||colorType===6).toBeTruthy();
        expect(size).toBeLessThan(1024*1024);
        pngs.set(name,{width,height});
        i+=29+n+extra+size;
      }
    }
    expect(pngs.size).toBe(count+2);
    for(let n=1;n<=count;n++){
      expect(pngs.get(String(n).padStart(2,"0")+".png")).toEqual({width:370,height:320});
    }
    expect(pngs.get("main.png")).toEqual({width:240,height:240});
    expect(pngs.get("tab.png")).toEqual({width:96,height:74});
    const file={name:download.suggestedFilename(),names};
    expect(file.name).toBe(`line-stamps-${count}.zip`);
    expect(file.names).toHaveLength(count+2);
    for(let i=1;i<=count;i++)expect(file.names).toContain(String(i).padStart(2,"0")+".png");
    expect(file.names).toContain("main.png");
    expect(file.names).toContain("tab.png");
  }
  expect(errors).toEqual([]);
});

test("white facial detail survives while outer white background is removed",async ({page})=>{
  await page.goto("http://127.0.0.1:8765/");
  await page.locator("#production-mode").selectOption("easy");
  await page.locator("#easy-target").selectOption("8");
  const encoded=await page.evaluate(()=>{
    const c=document.createElement("canvas");c.width=600;c.height=1000;
    const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,600,1000);
    for(let row=0;row<5;row++)for(let col=0;col<2;col++){
      const cx=col*300+150,cy=row*200+100;
      x.fillStyle="#cc5252";x.beginPath();x.arc(cx,cy,65,0,Math.PI*2);x.fill();
      // White eye details are enclosed by colored artwork, not background.
      x.fillStyle="#fff";x.beginPath();x.arc(cx-19,cy-12,12,0,Math.PI*2);x.fill();
      x.beginPath();x.arc(cx+19,cy-12,12,0,Math.PI*2);x.fill();
      x.fillStyle="#222";x.beginPath();x.arc(cx-19,cy-12,4,0,Math.PI*2);x.fill();
      x.beginPath();x.arc(cx+19,cy-12,4,0,Math.PI*2);x.fill();
    }
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#easy-files").setInputFiles([{name:"white-eye-sheet.png",mimeType:"image/png",buffer:Buffer.from(encoded,"base64")}]);
  await expect(page.locator("#easy-state")).toContainText("読込済み1枚",{timeout:90000});
  await page.locator("#easy-process").click();
  await expect(page.locator("#easy-state")).toContainText("加工済み8個",{timeout:150000});
  const metrics=await page.locator("#stamp-grid canvas").evaluateAll(canvases=>canvases.map(c=>{
    const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
    let white=0,red=0;
    for(let i=0;i<d.length;i+=4){
      if(d[i+3]>240&&d[i]>245&&d[i+1]>245&&d[i+2]>245)white++;
      if(d[i+3]>240&&d[i]>130&&d[i+1]<160&&d[i+2]<160)red++;
    }
    return {white,red,cornerAlpha:d[3]};
  }));
  expect(metrics).toHaveLength(8);
  for(const m of metrics){
    expect(m.red).toBeGreaterThan(100);
    expect(m.white).toBeGreaterThan(10);
    expect(m.cornerAlpha).toBe(0);
  }
});

test("thin diagonal appendages remain attached after background removal",async ({page})=>{
  await page.goto("http://127.0.0.1:8765/");
  await page.locator("#production-mode").selectOption("easy");
  await page.locator("#easy-target").selectOption("8");
  const encoded=await page.evaluate(()=>{
    const c=document.createElement("canvas");c.width=600;c.height=1000;
    const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,600,1000);
    for(let row=0;row<5;row++)for(let col=0;col<2;col++){
      const cx=col*300+150,cy=row*200+100;
      x.strokeStyle="#a42e7d";x.lineWidth=9;x.lineCap="round";
      x.beginPath();x.moveTo(cx-25,cy-22);x.lineTo(cx-65,cy-66);x.stroke();
      x.beginPath();x.moveTo(cx+25,cy-22);x.lineTo(cx+65,cy-66);x.stroke();
      x.fillStyle="#a42e7d";x.beginPath();x.arc(cx,cy,45,0,Math.PI*2);x.fill();
      x.fillStyle="#ffb32c";x.beginPath();x.arc(cx-65,cy-66,9,0,Math.PI*2);x.fill();
      x.beginPath();x.arc(cx+65,cy-66,9,0,Math.PI*2);x.fill();
    }
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#easy-files").setInputFiles([{name:"thin-appendage-sheet.png",mimeType:"image/png",buffer:Buffer.from(encoded,"base64")}]);
  await expect(page.locator("#easy-state")).toContainText("読込済み1枚",{timeout:90000});
  await page.locator("#easy-process").click();
  await expect(page.locator("#easy-state")).toContainText("加工済み8個",{timeout:150000});
  const results=await page.locator("#stamp-grid canvas").evaluateAll(canvases=>canvases.map(c=>{
    const {data,width,height}=c.getContext("2d").getImageData(0,0,c.width,c.height);
    const mask=new Uint8Array(width*height);let magenta=0,gold=0;
    for(let p=0;p<mask.length;p++){
      const i=p*4;
      if(data[i+3]<180)continue;
      const r=data[i],g=data[i+1],b=data[i+2];
      if(r>90&&r<210&&g<125&&b>70){mask[p]=1;magenta++;}
      if(r>175&&g>90&&g<225&&b<110){mask[p]=1;gold++;}
    }
    // A single 8-connected component must contain the body, both
    // antennae, and their tips; disconnected fragments indicate clipping.
    const seen=new Uint8Array(mask.length);
    let largest=0,components=0;
    for(let p=0;p<mask.length;p++){
      if(!mask[p]||seen[p])continue;
      components++;let size=0,queue=[p];seen[p]=1;
      for(let q=0;q<queue.length;q++){
        const at=queue[q],x=at%width,y=Math.floor(at/width);size++;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy;
          if(nx<0||ny<0||nx>=width||ny>=height)continue;
          const next=ny*width+nx;
          if(mask[next]&&!seen[next]){seen[next]=1;queue.push(next);}
        }
      }
      largest=Math.max(largest,size);
    }
    return {magenta,gold,components,largest};
  }));
  expect(results).toHaveLength(8);
  for(const m of results){
    expect(m.magenta).toBeGreaterThan(100);
    expect(m.gold).toBeGreaterThan(20);
    expect(m.components).toBe(1);
    expect(m.largest).toBeGreaterThan(300);
  }
});

test("diagonal arm retains attached white paw against white background",async ({page})=>{
  await page.goto("http://127.0.0.1:8765/");
  await page.locator("#production-mode").selectOption("easy");
  await page.locator("#easy-target").selectOption("8");
  const encoded=await page.evaluate(()=>{
    const c=document.createElement("canvas");c.width=600;c.height=1000;
    const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,600,1000);
    for(let row=0;row<5;row++)for(let col=0;col<2;col++){
      const cx=col*300+150,cy=row*200+100;
      x.strokeStyle="#394da8";x.lineWidth=18;x.lineCap="round";
      x.beginPath();x.moveTo(cx+22,cy+10);x.lineTo(cx+64,cy-36);x.stroke();
      x.fillStyle="#394da8";x.beginPath();x.arc(cx,cy,47,0,Math.PI*2);x.fill();
      // White paw has a dark contour, connected to the diagonal arm.
      x.fillStyle="#fff";x.strokeStyle="#394da8";x.lineWidth=7;
      x.beginPath();x.arc(cx+67,cy-42,17,0,Math.PI*2);x.fill();x.stroke();
      // Enclosed white eye should also survive.
      x.beginPath();x.arc(cx-12,cy-12,9,0,Math.PI*2);x.fill();
    }
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#easy-files").setInputFiles([{name:"diagonal-white-paw.png",mimeType:"image/png",buffer:Buffer.from(encoded,"base64")}]);
  await expect(page.locator("#easy-state")).toContainText("読込済み1枚",{timeout:90000});
  await page.locator("#easy-process").click();
  await expect(page.locator("#easy-state")).toContainText("加工済み8個",{timeout:150000});
  const metrics=await page.locator("#stamp-grid canvas").evaluateAll(canvases=>canvases.map(c=>{
    const {data:d,width:w,height:h}=c.getContext("2d").getImageData(0,0,c.width,c.height);
    let blue=0,white=0,whiteAdjacentBlue=0,blueX=0,blueY=0,whiteLeft=0,whiteRight=0,edgeWhite=0;
    const isBlue=p=>{const i=p*4;return d[i+3]>170&&d[i]<130&&d[i+1]<160&&d[i+2]>90;};
    for(let p=0;p<w*h;p++){
      const i=p*4;if(d[i+3]<230)continue;
      if(isBlue(p)){blue++;blueX+=p%w;blueY+=Math.floor(p/w);}
      if(d[i]>245&&d[i+1]>245&&d[i+2]>245){
        white++;
        const x=p%w,y=Math.floor(p/w);
        for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
          const xx=x+dx,yy=y+dy;
          if(xx>=0&&xx<w&&yy>=0&&yy<h&&isBlue(yy*w+xx)){whiteAdjacentBlue++;dy=4;break;}
        }
      }
    }
    const centerX=blueX/blue;
    for(let p=0;p<w*h;p++){
      const i=p*4,x=p%w,y=Math.floor(p/w);
      if(d[i+3]>230&&d[i]>245&&d[i+1]>245&&d[i+2]>245){
        if(x<centerX-4)whiteLeft++;
        if(x>centerX+12)whiteRight++;
        if(x<3||x>=w-3||y<3||y>=h-3)edgeWhite++;
      }
    }
    return {blue,white,whiteAdjacentBlue,whiteLeft,whiteRight,edgeWhite,corner:d[3]};
  }));
  expect(metrics).toHaveLength(8);
  for(const m of metrics){
    expect(m.blue).toBeGreaterThan(300);
    expect(m.white).toBeGreaterThan(20);
    expect(m.whiteAdjacentBlue).toBeGreaterThan(5);
    expect(m.whiteLeft).toBeGreaterThan(5); // eye on the left
    expect(m.whiteRight).toBeGreaterThan(5); // paw on the right
    expect(m.edgeWhite).toBe(0); // no white sheet border
    expect(m.corner).toBe(0);
  }
});

test("review background selector updates both preview and audit without changing artwork",async ({page})=>{
  await page.goto("http://127.0.0.1:8765/");
  await page.locator("#production-mode").selectOption("easy");
  await page.locator("#easy-target").selectOption("8");
  const encoded=await page.evaluate(()=>{
    const c=document.createElement("canvas");c.width=600;c.height=1000;
    const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,600,1000);
    for(let row=0;row<5;row++)for(let col=0;col<2;col++){
      x.fillStyle="#a34f9c";x.beginPath();x.arc(col*300+150,row*200+100,50,0,Math.PI*2);x.fill();
    }
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#easy-files").setInputFiles([{name:"background-review.png",mimeType:"image/png",buffer:Buffer.from(encoded,"base64")}]);
  await expect(page.locator("#easy-state")).toContainText("読込済み1枚",{timeout:90000});
  await page.locator("#easy-process").click();
  await expect(page.locator("#easy-state")).toContainText("加工済み8個",{timeout:150000});
  const original=await page.locator("#stamp-grid canvas").first().evaluate(c=>c.toDataURL("image/png"));
  for(const [value,klass] of [["dark","dark"],["pink","pink"],["checker","checker"]]){
    await page.locator("#preview-background").selectOption(value);
    await expect(page.locator("#stamp-grid")).toHaveClass(new RegExp(klass));
    await expect(page.locator("#bulk-results")).toHaveClass(new RegExp(klass));
    const current=await page.locator("#stamp-grid canvas").first().evaluate(c=>c.toDataURL("image/png"));
    expect(current).toBe(original);
  }
  await expect(page.locator("#bulk-visual")).toBeEnabled();
});

test("changing main image invalidates prior bulk visual approval",async ({page})=>{
  await page.goto("http://127.0.0.1:8765/");
  await page.locator("#production-mode").selectOption("easy");
  await page.locator("#easy-target").selectOption("8");
  const encoded=await page.evaluate(()=>{
    const c=document.createElement("canvas");c.width=600;c.height=1000;
    const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,600,1000);
    for(let row=0;row<5;row++)for(let col=0;col<2;col++){
      x.fillStyle="#a34f9c";x.beginPath();x.arc(col*300+150,row*200+100,50,0,Math.PI*2);x.fill();
    }
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#easy-files").setInputFiles([{name:"approval-invalidation.png",mimeType:"image/png",buffer:Buffer.from(encoded,"base64")}]);
  await expect(page.locator("#easy-state")).toContainText("読込済み1枚",{timeout:90000});
  await page.locator("#easy-process").click();
  await expect(page.locator("#easy-state")).toContainText("加工済み8個",{timeout:150000});
  await page.locator("#bulk-visual").check();
  await page.locator("#bulk-confirm").click();
  await expect(page.locator("#bulk-summary")).toContainText("目視確認を保存しました");
  const initial=await page.locator("#main-select").inputValue();
  const options=await page.locator("#main-select option").evaluateAll(opts=>opts.map(o=>o.value).filter(Boolean));
  const changed=options.find(v=>v!==initial);
  expect(changed).toBeTruthy();
  await page.locator("#main-select").selectOption(changed);
  await expect(page.locator("#bulk-visual")).toBeDisabled();
  await expect(page.locator("#bulk-confirm")).toBeDisabled();
  await expect(page.locator("#bulk-summary")).toContainText("一括検査を実行してください");
  // No new review: ZIP must not be exported.
  await page.locator("#easy-export").click();
  await expect(page.locator("#download-link")).toBeHidden();
});
