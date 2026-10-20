// Browser integration: load a real raster sheet and run the image processing path.
// The synthetic sheet has white gutters and ten separate colored subjects.
// Run: npx playwright test tests/browser-image.spec.cjs
const {test,expect}=require("@playwright/test");
test.setTimeout(180000);
test("8 stickers: import PNG sheet and generate processed previews",async ({page})=>{
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:8765/");
  await page.locator("#production-mode").selectOption("easy");
  await page.locator("#easy-target").selectOption("8");
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
  await page.locator("#easy-files").setInputFiles({
    name:"test-sheet.png",mimeType:"image/png",buffer:Buffer.from(data,"base64")
  });
  await expect(page.locator("#easy-state")).toContainText("読込済み1枚",{timeout:60000});
  await page.locator("#easy-process").click();
  await expect(page.locator("#easy-state")).toContainText("加工済み8個",{timeout:120000});
  await expect(page.locator("#easy-failure")).toBeHidden();
  expect(errors).toEqual([]);
});
