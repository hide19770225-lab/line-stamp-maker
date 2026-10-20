'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../suggestions.js');
const V=require('../caption-vision.js');

test('caption candidates do not silently assign meaning to unknown images',()=>{
  assert.deepEqual(S.candidates('unknown'),[]);
  assert.equal(S.choose('unknown'),null);
  const blank={width:4,height:4,data:new Uint8ClampedArray(64)};
  const mask=new Uint8Array(16);
  assert.equal(S.analyze(blank,mask).emotion,'unknown');
  assert.equal(V.match(blank,mask).emotion,'unknown');
});
test('automatic generic suggestions preserve manually assigned captions and do not mutate input',()=>{
  const rows=[{slot:1,caption:'おはよう'},{slot:2,caption:''},{slot:3,caption:'ありがとう'}];
  const before=JSON.stringify(rows);
  const result=S.automatic(rows);
  assert.equal(JSON.stringify(rows),before);
  assert.equal(result[0].caption,'おはよう');
  assert.equal(result[2].caption,'ありがとう');
  assert.ok(result[1].caption);
  assert.notEqual(result[1].caption,'ありがとう');
});
test('duplicate audit retains exact slot associations, including nonsequential slots',()=>{
  const rows=[{slot:40,caption:'ＯＫ！'},{slot:3,caption:'OK!'},{slot:12,caption:'ありがとう'},{slot:2,caption:''}];
  const duplicates=S.duplicates(rows);
  assert.deepEqual(duplicates,[{caption:'OK!',slots:[40,3]}]);
});
test('forty generic captions preserve numbered slot order and avoid duplicates',()=>{
  const rows=Array.from({length:40},(_,i)=>({slot:i+1,caption:''}));
  const result=S.automatic(rows);
  assert.deepEqual(result.map(r=>r.slot),rows.map(r=>r.slot));
  assert.equal(new Set(result.map(r=>r.caption.normalize('NFKC').trim())).size,40);
});
