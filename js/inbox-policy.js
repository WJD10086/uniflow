/* Inbox presentation and conservative ordinary-message retention. No network. */
(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('./notification-relevance.js'):root.UniFlowRelevance,common?require('./notice-time.js'):root.UniFlowNoticeTime);if(common)module.exports=api;else root.UniFlowInboxPolicy=api;})(globalThis,function(Relevance,NoticeTime){
  'use strict';
  const KEY='uniflow.inbox-retention.v1',DAY=86400000,VERSION=1;
  function defaults(now=Date.now()){return {version:VERSION,enabled:true,days:3,maxCount:100,cleanupNotBefore:now+3*DAY};}
  function validate(value){
    if(!value||value.version!==VERSION||typeof value.enabled!=='boolean'||![1,3,7,30].includes(value.days)||![50,100,200,500].includes(value.maxCount)||!Number.isFinite(value.cleanupNotBefore)||value.cleanupNotBefore<=0)throw Error('普通消息保留设置无效，自动清理已暂停。');
    return {version:VERSION,enabled:value.enabled,days:value.days,maxCount:value.maxCount,cleanupNotBefore:value.cleanupNotBefore};
  }
  // A failed preference write never permits cleanup. First upgrade gets a
  // durable three-day grace period without rewriting existing business data.
  function preferences(storage,clock=Date.now){
    function get(){const raw=storage.getItem(KEY);if(raw!==null)return validate(JSON.parse(raw));const value=defaults(clock());storage.setItem(KEY,JSON.stringify(value));return value;}
    return {get,save(patch){const old=get();const next=validate({...old,...patch,version:VERSION,cleanupNotBefore:old.cleanupNotBefore});if(!old.enabled&&next.enabled)next.cleanupNotBefore=Math.max(old.cleanupNotBefore,clock()+3*DAY);storage.setItem(KEY,JSON.stringify(next));return next;}};
  }
  function groups(notices){const sorted=NoticeTime.sorted(notices);return {attention:sorted.filter(n=>n.status!=='archived'&&Relevance.assessment(n).label==='relevant'),other:sorted.filter(n=>n.status==='archived'||Relevance.assessment(n).label!=='relevant')};}
  function plan(state,policy,{now=Date.now(),protectedIds=[]}={}){
    validate(policy);
    if(!policy.enabled||!Number.isFinite(now)||now<policy.cleanupNotBefore)return [];
    const protectedSet=new Set(protectedIds);
    for(const task of state.tasks||[]){if(task.noticeId)protectedSet.add(task.noticeId);if(task.sourceMessage?.id)protectedSet.add(task.sourceMessage.id);}
    const eligible=(state.notices||[]).filter(n=>{
      const value=Relevance.assessment(n),time=NoticeTime.effective(n);
      return ['android_notification','windows_notification'].includes(n.source)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(n.captureId||'')&&Number.isSafeInteger(n.captureVersion)&&n.captureVersion>0&&
        value.label==='ordinary'&&value.automaticLabel==='ordinary'&&n.relevanceFeedback?.decision!=='relevant'&&
        !protectedSet.has(n.id)&&!n.taskId&&!(n.taskIds?.length)&&n.status!=='confirmed'&&
        !n.aiInProgress&&!n.needsConfirmation&&!['processing','pending_confirmation'].includes(n.aiStatus)&&!(n.pendingCandidates?.length)&&
        time>0&&time<=now;
    });
    const ordered=NoticeTime.sorted(eligible),overflow=new Set(ordered.slice(policy.maxCount).map(n=>n.id));
    const capacity=Math.max(0,500-(state.captureDeletedIds||[]).length);
    return ordered.filter(n=>now-NoticeTime.effective(n)>=policy.days*DAY||overflow.has(n.id)).reverse().slice(0,Math.min(100,capacity)).map(n=>n.id);
  }
  return {KEY,VERSION,DAY,defaults,validate,preferences,groups,plan};
});
