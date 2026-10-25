'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');
function fixture() {
 const width=40,height=40,data=new Uint8ClampedArray(width*height*4).fill(255);
 const put=(x,y,rgb)=>data.set([...rgb,255],(y*width+x)*4);
 // Closed black contour with pure white inside.
 for(let y=10;y<=28;y++)for(let x=10;x<=28;x++)
  if(x===10||x===28||y===10||y===28)put(x,y,[20,20,20]);
 // Neutral matte rim, followed by the dark contour.
 for(let y=11;y<28;y++)put(9,y,[240,240,240]);
 for(let y=1;y<=5;y++)for(let x=15;x<=20;x++)
  if(y===1||y===5||x===15||x===20)put(x,y,[20,20,20]);
 put(8,18,[190,190,190]);
 // Open warm body reaches the bottom, including a paler neutral-ish tip.
 for(let y=30;y<40;y++)for(let x=14;x<25;x++)put(x,y,[254,250,238]);
 put(18,39,[255,252,245]);
 return {data,width,height};
}
test('exterior matte removes neutral rim, unmattes exposed edge, preserves white interior and open warm body',()=>{
 const im=fixture(),original=im.data.slice(),mask=C.floodMask(im);
 const rgb=C.exteriorWhiteMatte(im,mask);
 assert.equal(mask[15*40+9],0);
 assert(mask[18*40+8]>0 && mask[18*40+8]<255);
 assert(rgb[(18*40+8)*4]<190);
 assert.equal(mask[20*40+20],255);
 assert.equal(mask[3*40+17],0,'white glyph counter above character becomes transparent');
 assert.equal(mask[39*40+18],255);
 assert.equal(mask[39*40+20],255);
 assert.deepEqual(im.data,original,'comparison source remains untouched');
});
test('existing transparency and non-white sources bypass white matting',()=>{
 const im=fixture();im.data[3]=0;
 const mask=C.floodMask(im),before=mask.slice();
 assert.equal(C.exteriorWhiteMatte(im,mask),null);assert.deepEqual(mask,before);
 im.data.fill(100);for(let i=3;i<im.data.length;i+=4)im.data[i]=255;
 assert.equal(C.exteriorWhiteMatte(im,C.floodMask(im)),null);
});
test('boundary proximity is distinguished from actual edge contact without suppressing review',()=>{
 const w=100,h=100,m=new Uint8ClampedArray(w*h);
 m[50*w+1]=m[51*w+1]=255;
 const near=C.tileBoundaryReview(m,w,h);
 assert(near.needsReview);assert(near.edges.includes('left'));assert.deepEqual(near.touching,[]);
 m[50*w]=255;
 assert(C.tileBoundaryReview(m,w,h).touching.includes('left'));
});
