/* Native notification inbox transport. No AI calls and no task creation. */
(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('./message-service.js'):root.UniFlowMessages,common?require('./notification-relevance.js'):root.UniFlowRelevance,common?require('./notice-time.js'):root.UniFlowNoticeTime);if(common)module.exports=api;else root.UniFlowCapture=api;})(globalThis,function(Messages,Relevance,NoticeTime){
  'use strict';
  let SOURCE='android_notification',PREFIX='android-capture:',PACKAGE=/^\w+(?:\.\w+)+$/;
  function history(entries,currentVersion){
    const versions=new Map();
    for(const item of entries){if(!item||!Number.isSafeInteger(item.version)||item.version<1||item.version>=currentVersion||typeof item.content!=='string'||!Number.isFinite(Date.parse(item.receivedAt)))continue;
      versions.set(item.version,{version:item.version,title:String(item.title||'').slice(0,80),content:item.content.slice(0,8000),receivedAt:new Date(item.receivedAt).toISOString(),...timeMetadata(item)});}
    let characters=0;const kept=[];
    for(const item of [...versions.values()].sort((a,b)=>b.version-a.version).slice(0,10)){characters+=item.content.length+item.title.length;if(characters>16000)break;kept.unshift(item);}return kept;
  }
  function timeMetadata(item){return Object.fromEntries(['postedAt','contentUpdatedAt'].filter(key=>NoticeTime.timestamp(item[key])!==null).map(key=>[key,new Date(item[key]).toISOString()]));}
  function adapt(item){
    if(!item||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.id)||!Number.isSafeInteger(item.version)||item.version<1||!PACKAGE.test(item.packageName||'')||typeof item.content!=='string'||item.content.length>8000||typeof item.receivedAt!=='string'||!Number.isFinite(Date.parse(item.receivedAt)))throw Error('自动捕获消息格式无效，未确认同步。');
    const appName=String(item.appName||item.packageName).slice(0,80),title=String(item.title||appName).slice(0,80);
    const notice=Messages.create({id:PREFIX+item.id,source:SOURCE,title,content:item.content||title,receivedAt:item.receivedAt,mimeType:'text/plain'});
    const original=item.originalNotification||{};
    return Relevance.stamp({...notice,category:'自动捕获',captureId:item.id,captureVersion:item.version,appName,packageName:item.packageName,
      received:new Date(notice.receivedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),
      postedAt:NoticeTime.timestamp(item.postedAt)!==null?new Date(item.postedAt).toISOString():null,
      ...timeMetadata(item),
      firstReceivedAt:NoticeTime.timestamp(item.firstReceivedAt)!==null?new Date(item.firstReceivedAt).toISOString():notice.receivedAt,possiblyTruncated:!!item.possiblyTruncated,
      captureHistory:history(Array.isArray(item.history)?item.history:[],item.version),
      originalNotification:{title:String(original.title||'').slice(0,200),text:String(original.text||'').slice(0,4000),bigText:String(original.bigText||'').slice(0,4000),lines:Array.isArray(original.lines)?original.lines.slice(0,10).map(line=>String(line).slice(0,400)):[]}});
  }
  function merge(draft,items,limit=100){
    if(!Array.isArray(items)||items.length>50||![50,100,200].includes(limit))throw Error('同步批次无效。');
    const prepared=items.map(adapt),deleted=new Set(draft.captureDeletedIds||[]),ack=[];let changed=false;
    for(const notice of prepared){
      ack.push({id:notice.captureId,version:notice.captureVersion});
      if(deleted.has(notice.captureId))continue;
      const index=draft.notices.findIndex(n=>n.id===notice.id);
      if(index<0){draft.notices.unshift(notice);changed=true;continue;}
      const existing=draft.notices[index];if(existing.source!==SOURCE)throw Error('自动捕获消息 ID 冲突，原消息已保留。');
      if((existing.captureVersion||0)>=notice.captureVersion)continue;
      // Automatic evidence is refreshed; explicit user feedback/read receipt and
      // business status belong to the existing record, not to the native event.
      const captureHistory=history([...(existing.captureHistory||[]),{version:existing.captureVersion,title:existing.title,content:existing.text,receivedAt:existing.receivedAt,...timeMetadata(existing)},...notice.captureHistory],notice.captureVersion);
      draft.notices[index]=Relevance.stamp({...existing,...notice,status:existing.status,captureUpdated:true,captureHistory});changed=true;
    }
    // The native limit bounds transport only. Inbox retention must consider
    // relevance, task links and confirmation state, never blanket slice here.
    return {changed,ack};
  }
  function markDeleted(draft,notice){
    if(notice?.source!==SOURCE||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(notice.captureId||''))return;
    const ids=new Set(draft.captureDeletedIds||[]);ids.add(notice.captureId);
    if(ids.size>500)throw Error('尚有较多删除记录未同步，请先重试通知同步。');draft.captureDeletedIds=[...ids];
    if(Number.isSafeInteger(notice.captureVersion)&&notice.captureVersion>0){draft.captureDeleteVersions={...(draft.captureDeleteVersions||{}),[notice.captureId]:Math.max(draft.captureDeleteVersions?.[notice.captureId]||0,notice.captureVersion)};}
  }
  function createService(plugin){
    const unavailable=()=>{throw Error('当前平台不支持主动通知感知。');};
    return {available:!!plugin,status:()=>plugin?plugin.getStatus():Promise.resolve({available:false,authorized:false,enabled:false,connected:false,allowedPackages:[],maxRecords:100}),
      configure:config=>plugin?plugin.setConfig(config):unavailable(),openSettings:()=>plugin?plugin.openAccessSettings():unavailable(),sources:async()=>plugin?(await plugin.listSources()).items:[],
      icon:async packageName=>plugin?.getSourceIcon?(await plugin.getSourceIcon({packageName})).dataUrl||'':'',
      pending:async()=>plugin?(await plugin.getPending()).items:[],acknowledge:items=>plugin?plugin.acknowledge({items}):Promise.resolve(),
      delete:(ids,versions={})=>plugin?plugin.deleteMessages({ids,versions}):Promise.resolve(),clear:()=>plugin?plugin.clearCaptured():unavailable(),
      listen:callback=>plugin?plugin.addListener('captureAvailable',callback):Promise.resolve({remove(){}})};
  }
  function setSource(source){if(source==='windows_notification'){SOURCE=source;PREFIX='windows-capture:';PACKAGE=/^(?!\s*$)[^\x00-\x1f\x7f]{1,512}$/;}else{SOURCE='android_notification';PREFIX='android-capture:';PACKAGE=/^\w+(?:\.\w+)+$/;}return SOURCE;}
  return {get SOURCE(){return SOURCE;},setSource,adapt,merge,markDeleted,createService,isCapturedNotice:n=>n?.source===SOURCE};
});
