/* Independent iPhone file-input bridge. */
(() => {
 "use strict";
 const picker=document.getElementById("easy-files");
 const feedback=document.getElementById("easy-upload-feedback");
 if(!picker||!feedback)return;
 let pending=null;
 const show=(message)=>{feedback.textContent=message;};
 show("画像の選択待ち（添付機能の準備中）");
 const deliver=async()=>{
   if(!pending)return;
   if(typeof window.stampImportFiles!=="function"){
     show("画像は選択されましたが、加工プログラムが起動していません。画面を更新してください。");return;
   }
   const files=pending;pending=null;
   try{await window.stampImportFiles(files);}
   catch(error){show("読み込みエラー："+(error?.message||String(error)));}
 };
 picker.addEventListener("change",()=>{
   pending=Array.from(picker.files||[]);
   if(!pending.length){show("画像が選択されませんでした。");return;}
   show("画像を選択しました："+pending.map(f=>f.name).join("、"));
   void deliver();
 });
 window.addEventListener("stamp-import-ready",()=>{
   if(pending)void deliver();
   else show("画像を選択してください（添付機能は起動済み）");
 });
 window.addEventListener("error",(event)=>{
   if(typeof window.stampImportFiles!=="function")
     show("加工プログラムの起動エラー："+(event.message||"詳細不明"));
 });
})();