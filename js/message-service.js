/* Common local message adapter. No network requests or task creation. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniFlowMessages=api;})(globalThis,function(){
  'use strict';
  const MAX_LENGTH=100000;
  function safeUrl(value){try{if(typeof value!=='string'||value.length>2048||/[\s<>"\u0000-\u001f]/.test(value))return '';const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password?url.href:'';}catch{return '';}}
  function urls(text){return [...new Set((String(text||'').match(/https?:\/\/[^\s<>"'，。；！？、（）【】]+/gi)||[]).map(value=>safeUrl(value.replace(/[.,;!?)\]}]+$/g,''))).filter(Boolean))].slice(0,10);}
  function create(input){
    if(!input||typeof input.id!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(input.id))throw Error('消息 ID 无效。');
    const imageId=typeof input.imageId==='string'&&/^[a-f0-9-]{36}$/.test(input.imageId)?input.imageId:'';
    const text=String(input.content??'').trim();if(!text&&!imageId)throw Error('消息内容不能为空。');if(text.length>MAX_LENGTH)throw Error('消息不能超过 100000 字符。');
    const stamp=input.receivedAt||new Date().toISOString();if(!Number.isFinite(Date.parse(stamp)))throw Error('消息接收时间无效。');
    const date=text.match(/(20\d{2})\s*[年\-/]\s*(\d{1,2})\s*[月\-/]\s*(\d{1,2})/),time=text.match(/(?:\s|日|号|，|：|^)([01]?\d|2[0-3])[:：]([0-5]\d)/),place=text.match(/(?:地点[：:]|到|至|在)\s*([^，。\n]{2,24})/);
    let candidate=date?`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`:'';
    if(candidate){const [y,m,d]=candidate.split('-').map(Number),parsed=new Date(Date.UTC(y,m-1,d));if(parsed.getUTCFullYear()!==y||parsed.getUTCMonth()+1!==m||parsed.getUTCDate()!==d)candidate='';}
    const links=[...new Set([safeUrl(input.originalUrl),...urls(text)].filter(Boolean))].slice(0,10);
    return {id:input.id,title:String(input.title||text.split(/[。\n]/)[0]).trim().slice(0,80)||(imageId?'导入图片':'导入消息'),source:input.source||'手动导入',kind:'document',color:'',date:candidate,time:time?`${time[1].padStart(2,'0')}:${time[2]}`:'',location:place?place[1]:'',status:'pending',category:input.source==='android_share'?'系统分享':'导入通知',received:'刚刚',receivedAt:new Date(stamp).toISOString(),text,originalText:String(input.originalText??input.content??'').slice(0,MAX_LENGTH),originalUrl:links[0]||'',urls:links,mimeType:input.mimeType||'text/plain',...(imageId?{imageId}:{}),...(input.ocrStatus?{ocrStatus:input.ocrStatus}:{}),...(input.shareId?{shareId:input.shareId}:{})};
  }
  function append(draft,notice){if(draft.notices.some(n=>n.id===notice.id||(notice.shareId&&n.shareId===notice.shareId)))return false;draft.notices.unshift(notice);return true;}
  return {MAX_LENGTH,safeUrl,urls,create,append};
});
