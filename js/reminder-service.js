/* Local notifications adapter. The task Store remains the sole task database. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniFlowReminders=api;})(globalThis,function(){
  'use strict';
  const MINUTES=[0,5,15,30,60], CHANNEL='uniflow-tasks-v1', OWNER='uniflow-task-v1', TEST_ID=2147483646;
  function notificationId(taskId){let hash=2166136261;for(const char of taskId){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0)%2147483644+1;}
  function plan(task,now=Date.now()){
    const minutes=task.reminderMinutes??0;
    if(!MINUTES.includes(minutes))throw Error('提醒时间无效，请重新选择。');
    if(!minutes||task.done)return null;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(task.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time)||!['deadline','start'].includes(task.dateRole))throw Error('开启提醒需要明确的日期、时间和时间用途；请先补全。');
    const [year,month,day]=task.date.split('-').map(Number),[hour,minute]=task.time.split(':').map(Number);
    const target=new Date(year,month-1,day,hour,minute,0,0);
    if(target.getFullYear()!==year||target.getMonth()!==month-1||target.getDate()!==day||target.getHours()!==hour||target.getMinutes()!==minute)throw Error('该本地时间无效，可能处于夏令时跳时，请选择其他时间。');
    const at=target.getTime()-minutes*60000;
    if(at<=now)return null;
    const fingerprint=JSON.stringify([task.id,task.title,task.date,task.time,task.dateRole,minutes,at]);
    return {id:notificationId(task.id),title:'UniFlow · 任务提醒',body:`距离“${task.title}”${task.dateRole==='deadline'?'截止':'开始'}还有 ${minutes} 分钟。`,channelId:CHANNEL,smallIcon:'ic_stat_uniflow',iconColor:'#2563EB',isExactNotification:false,isExactMandatory:false,schedule:{at:new Date(at),allowWhileIdle:true},extra:{owner:OWNER,taskId:task.id,wallDate:task.date,wallTime:task.time,minutes,fingerprint}};
  }
  function createService({plugin,now=()=>Date.now()}={}){
    let tail=Promise.resolve(),channelReady=false;
    const available=()=>!!plugin;
    async function permission(){return plugin?(await plugin.checkPermissions()).display:'unavailable';}
    async function requestPermission(){if(!plugin)return 'unavailable';const status=await permission();return status==='prompt'||status==='prompt-with-rationale'?(await plugin.requestPermissions()).display:status;}
    async function channel(){if(!channelReady){await plugin.createChannel({id:CHANNEL,name:'任务提醒',description:'你主动设置的任务截止与日程开始提醒',importance:4,visibility:0,vibration:true});channelReady=true;}}
    async function pending(){return plugin?(await plugin.getPending()).notifications:[];}
    async function reconcile(tasks){
      if(!plugin)return {status:'unavailable',scheduled:0,issues:[]};
      const records=await pending(),owned=records.filter(n=>n.extra?.owner===OWNER),desired=new Map(),issues=[];
      const ids=new Map();
      for(const task of tasks){
        const id=notificationId(task.id);
        if(ids.has(id)&&ids.get(id)!==task.id)throw Error('任务提醒 ID 冲突，未更改通知，请联系开发者。');
        ids.set(id,task.id);
        try{const item=plan(task,now());if(item)desired.set(item.id,item);else if(task.reminderMinutes&&!task.done)issues.push({taskId:task.id,reason:'提醒时间已过，不会补发或顺延。'});}catch(error){issues.push({taskId:task.id,reason:error.message});}
      }
      const status=await permission();
      const cancel=owned.filter(n=>status!=='granted'||!desired.has(n.id)||desired.get(n.id).extra.fingerprint!==n.extra.fingerprint);
      if(cancel.length)await plugin.cancel({notifications:cancel.map(({id})=>({id}))});
      if(status!=='granted')return {status,scheduled:0,issues};
      await channel();
      const unchanged=new Set(owned.filter(n=>!cancel.some(c=>c.id===n.id)).map(n=>n.id));
      const additions=[...desired.values()].filter(n=>!unchanged.has(n.id));
      if(additions.length)await plugin.schedule({notifications:additions});
      return {status,scheduled:desired.size,issues};
    }
    // Serial snapshots prevent a slow earlier save from restoring an old alarm.
    function sync(tasks){const snapshot=JSON.parse(JSON.stringify(tasks));const work=tail.catch(()=>{}).then(()=>reconcile(snapshot));tail=work;return work;}
    async function cancelTask(taskId){if(plugin)await plugin.cancel({notifications:[{id:notificationId(taskId)}]});}
    async function test(){if(await permission()!=='granted')throw Error('尚未获得通知权限，请先在系统设置中允许通知。');await channel();await plugin.schedule({notifications:[{id:TEST_ID,title:'UniFlow · 测试通知',body:'系统通知已连接。普通任务提醒可能受省电策略影响而延迟。',channelId:CHANNEL,smallIcon:'ic_stat_uniflow',isExactNotification:false,schedule:{at:new Date(now()+3000),allowWhileIdle:true},extra:{owner:'uniflow-test'}}]});}
    function onAction(callback){return plugin?.addListener('localNotificationActionPerformed',event=>callback(event.notification?.extra?.taskId));}
    return {available,permission,requestPermission,pending,sync,cancelTask,test,onAction};
  }
  return {MINUTES,CHANNEL,OWNER,TEST_ID,notificationId,plan,createService};
});
