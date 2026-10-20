/* Local image staging and bundled ML Kit OCR bridge. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniFlowImages=api;})(globalThis,function(){
  'use strict';
  function create(plugin){return {
    async choose(){if(!plugin)throw Error('相册导入需要 Android App。');return plugin.choose();},
    async capture(){if(!plugin)throw Error('拍照导入需要 Android App。');return plugin.capture();},
    async current(){if(!plugin)return null;const image=await plugin.getCurrent();return image?.imageId?image:null;},
    async get(imageId){if(!plugin)throw Error('图片导入需要 Android App。');return plugin.getImage({imageId});},
    async recognize(imageId){if(!plugin)throw Error('本地 OCR 需要 Android App。');return plugin.recognize({imageId});},
    async release(imageId){if(plugin&&imageId)await plugin.release({imageId});},
    async retain(imageId){if(!plugin)throw Error('图片保存需要 Android App。');await plugin.retain({imageId});}
  };}
  // One transaction at a time. Persist OCR text before starting the (fallible) AI call.
  function createOrganizer({recognize,extract}){
    let running=false;
    async function run({imageId=null,text='',ocrReady=false,receivedAt,timeZone,onText=async()=>{},onStage=()=>{},ocrOnly=false}){
      if(running)throw Error('正在整理，请等待当前操作完成。');
      running=true;
      try{
        if(imageId&&!ocrReady){onStage('ocr');const result=await recognize(imageId);text=String(result?.text||'').trim();if(!text)throw Error('图片中没有可用文字，未调用 AI。请换一张清晰图片或手动输入。');await onText(text);}
        text=String(text||'').trim();if(!text)throw Error('没有可用文字，未调用 AI。');
        if(ocrOnly)return {text};
        onStage('ai');return await extract({text,receivedAt,timeZone});
      }finally{running=false;}
    }
    return {run,isRunning:()=>running};
  }
  return {create,createOrganizer};
});
