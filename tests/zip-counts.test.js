// Exercise the actual browser-independent ZIP writer for every supported count.
// Run: node --test tests/zip-counts.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");

for (const count of [8,16,24,32,40]) {
  test(`${count} stickers: ZIP includes each PNG plus main and tab`, async () => {
    const png = Uint8Array.from([
      137,80,78,71,13,10,26,10,0,0,0,0
    ]);
    const files = Array.from({length:count}, (_,i) => ({
      name: `${String(i+1).padStart(2,"0")}.png`,
      blob: new Blob([png],{type:"image/png"})
    }));
    files.push({name:"main.png",blob:new Blob([png])});
    files.push({name:"tab.png",blob:new Blob([png])});
    const zip = await C.makeZip(files);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let offset=0;
    const names=[];
    const decoder=new TextDecoder();
    while(offset+30<=bytes.length && view.getUint32(offset,true)===0x04034b50) {
      const size=view.getUint32(offset+18,true);
      const nameLen=view.getUint16(offset+26,true);
      const extraLen=view.getUint16(offset+28,true);
      names.push(decoder.decode(bytes.subarray(offset+30,offset+30+nameLen)));
      offset+=30+nameLen+extraLen+size;
    }
    assert.equal(names.length,count+2);
    assert.deepEqual(names,files.map(f=>f.name));
    assert.equal(view.getUint32(offset,true),0x02014b50);
    assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
    assert.equal(view.getUint16(bytes.length-12,true),count+2);
  });
}
