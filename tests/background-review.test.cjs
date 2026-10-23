'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');
function image(checker=false) {
 const width=80,height=80,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const v=checker && (Math.floor(x/8)+Math.floor(y/8))%2 ? 204:255;
  data.set([v,v,v,255],(y*width+x)*4);
 }
 return {data,width,height};
}
test('painted checkerboard stays opaque even with white removal selected',()=>{
 const im=image(true);
 assert(C.paintedCheckerboard(im));
 for(const mode of ['auto','white','custom'])assert(C.floodMask(im,mode).every(a=>a===255));
 im.data[3]=0;
 assert.equal(C.floodMask(im,'auto')[0],0);
});
test('exterior white is removed while enclosed white face and body remain',()=>{
 const im=image();
 for(let y=20;y<=60;y++)for(let x=20;x<=60;x++)
  if(x===20||x===60||y===20||y===60)im.data.set([20,20,20,255],(y*80+x)*4);
 assert.equal(C.paintedCheckerboard(im),false);
 const mask=C.floodMask(im);
 assert.equal(mask[0],0);assert.equal(mask[40*80+40],255);
});
