/* Shared presentation order. Never mutate the inbox or use read/feedback dates. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniFlowNoticeTime=api;})(globalThis,function(){
  'use strict';
  function timestamp(value){
    if(typeof value!=='string')return null;
    const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if(!m)return null;
    const [y,month,day,hour,minute,second]=m.slice(1,7).map(Number);
    if(month<1||month>12||day<1||day>new Date(Date.UTC(y,month,0)).getUTCDate()||hour>23||minute>59||second>59)return null;
    const n=Date.parse(value);return Number.isFinite(n)&&n>0?n:null;
  }
  function effective(notice){
    if(!notice||typeof notice!=='object')return 0;
    const received=timestamp(notice.receivedAt),updated=timestamp(notice.contentUpdatedAt);
    const withinCapture=t=>t!==null&&(received===null||t<=received+300000);
    if(withinCapture(updated))return updated;
    const posted=timestamp(notice.postedAt);
    if(withinCapture(posted)){
      // Legacy records lack contentUpdatedAt. A reused postTime predating the
      // previous version cannot date a later substantive content update.
      const previous=(Array.isArray(notice.captureHistory)?notice.captureHistory:[]).filter(h=>h.version<notice.captureVersion).reduce((a,b)=>!a||b.version>a.version?b:a,null);
      if(previous&&received!==null&&posted<=(timestamp(previous.receivedAt)||0))return received;
      return posted;
    }
    return received??timestamp(notice.firstReceivedAt)??0;
  }
  function compare(a,b){
    const difference=effective(b)-effective(a);if(difference)return difference;
    const x=String(a?.id??''),y=String(b?.id??'');return x<y?-1:x>y?1:0;
  }
  function sorted(notices){return [...notices].sort(compare);}
  function history(entries){return [...entries].sort((a,b)=>effective(b)-effective(a)||(Number(b.version)||0)-(Number(a.version)||0)||compare(a,b));}
  function label(notice){const time=effective(notice);return time?new Date(time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'时间未知';}
  return {timestamp,effective,compare,sorted,history,label};
});
