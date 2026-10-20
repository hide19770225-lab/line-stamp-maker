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
      let opaque=0,transparent=0;
      for(let i=3;i<data.length;i+=4){
        if(data[i]===0) transparent++;
        if(data[i]>0) opaque++;
      }
      return {width:c.width,height:c.height,opaque,transparent};
    })
  );
  for(const img of images){
    expect(img.width).toBe(370);
    expect(img.height).toBe(320);
    expect(img.opaque).toBeGreaterThan(0);
    expect(img.transparent).toBeGreaterThan(0);
  }

  expect(errors).toEqual([]);
});
