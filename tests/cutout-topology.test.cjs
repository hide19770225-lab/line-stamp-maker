'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');
const image=(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(255)});
function paint(im,x,y,w,h,c){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)im.data.set(c,(yy*im.width+xx)*4);}
const dark=[30,30,30,255],blue=[30,100,200,255];
function box(im,x,y,w,h){paint(im,x,y,w,2,dark);paint(im,x,y+h-2,w,2,dark);paint(im,x,y,2,h,dark);paint(im,x+w-2,y,2,h,dark);}
test('exterior flood protects closed white regions and seals small contour breaks at several sizes',()=>{
 for(const size of [80,160,320]){const im=image(size,size);box(im,20,20,size-40,size-40);paint(im,Math.floor(size/2),20,1,2,[255,255,255,255]);const copy=im.data.slice(),m=C.floodMask(im,'white',24);assert.equal(m[0],0);assert.equal(m[Math.floor(size/2)*size+Math.floor(size/2)],255);assert.deepEqual(im.data,copy);}
});
test('white open-bottom body is protected without directional pixel restoration',()=>{
 const im=image(100,100);paint(im,20,20,60,10,dark);paint(im,20,20,3,60,dark);paint(im,77,20,3,60,dark);const m=C.floodMask(im,'white',24);assert.equal(m[60*100+50],255);assert.equal(m[85*100+50],0);assert.equal(m[60*100+10],0);
});
test('detached colored decorations and original partial alpha survive; corridors between them clear',()=>{
 const im=image(120,100);box(im,40,30,40,50);paint(im,8,8,10,8,blue);paint(im,100,55,2,15,blue);paint(im,8,70,5,5,[250,250,250,90]);const m=C.floodMask(im,'white',24);
 for(let y=8;y<16;y++)for(let x=8;x<18;x++)assert.equal(m[y*120+x],255);
 assert.equal(m[60*120+100],255);assert.equal(m[72*120+10],90);assert.equal(m[50*120+90],0);assert.equal(m[50*120+50],255);
});
test('requested tolerance removes exterior grey matte while enclosed white stays solid',()=>{
 const im=image(80,80);paint(im,0,0,80,80,[236,236,236,255]);box(im,20,20,40,40);paint(im,25,25,30,30,[255,255,255,255]);const m=C.floodMask(im,'white',24);assert.equal(m[0],0);assert.equal(m[40*80+40],255);
});
test('outer neutral antialias fades but colored and existing partial-alpha pixels are unchanged',()=>{
 const im=image(80,80);paint(im,20,20,40,40,dark);paint(im,20,35,1,1,[210,210,210,255]);paint(im,20,40,1,1,blue);paint(im,20,45,1,1,[250,250,250,90]);const m=C.floodMask(im,'white',24);assert(m[35*80+20]>0&&m[35*80+20]<255);assert.equal(m[40*80+20],255);assert.equal(m[45*80+20],90);
});
test('crop check distinguishes a terminating edge from an actual crossing on all four sides',()=>{
 for(const side of ['left','right','top','bottom']){
  const im=image(100,100),rect={x:20,y:20,width:60,height:60};
  const horizontal=side==='top'||side==='bottom';
  const x=side==='right'?76:side==='left'?20:40,y=side==='bottom'?76:side==='top'?20:40;
  paint(im,x,y,horizontal?16:4,horizontal?4:16,blue);
  assert.deepEqual(C.pixelCropCrossings(im,rect,'white'),[],side+' terminates');
  paint(im,side==='right'?80:side==='left'?18:x,side==='bottom'?80:side==='top'?18:y,horizontal?16:2,horizontal?2:16,blue);
  assert.deepEqual(C.pixelCropCrossings(im,rect,'white'),[side],side+' crosses');
 }
});
