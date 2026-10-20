/* Native access and UI orchestration; no permission request during startup. */
(() => {
  'use strict';
  const cap=window.Capacitor,native=cap?.isNativePlatform()&&cap.getPlatform()==='android';
  const service=window.UniFlowReminders.createService({plugin:native?cap.registerPlugin('LocalNotifications'):null});
  const bridge=native?cap.registerPlugin('UniFlowSystemBridge'):null;
  const app=window.UniFlowApp;
  let permission='unknown',lastResult,error='',openedTask;
  const statusLabels={granted:'已允许',denied:'已拒绝，请在系统设置中开启',prompt:'尚未申请','prompt-with-rationale':'尚未允许',unavailable:'仅 Android 安装版可用',unknown:'正在检查'};
  function render(){
    const root=document.getElementById('reminder-settings');if(!root)return;
    root.innerHTML=`<h2>任务提醒</h2><div class="setting-row"><div><h3>通知权限</h3><p id="notification-permission">${statusLabels[permission]||'暂不可用'}</p></div><button class="button" data-reminder="permission">启用提醒</button></div><div class="setting-row"><div><h3>默认提前时间</h3><p>仅用于新任务；每条任务仍由你选择</p></div><select id="reminder-default" aria-label="默认提前提醒时间">${window.UniFlowReminders.MINUTES.map(m=>`<option value="${m}" ${Number(app.settings().reminderDefaultMinutes||0)===m?'selected':''}>${m?'提前 '+m+' 分钟':'不提醒'}</option>`).join('')}</select></div><div class="component-row"><button class="button" data-reminder="test">测试通知</button><button class="button" data-reminder="settings">系统通知设置</button></div><p class="card-note">普通提醒不申请精确闹钟权限。系统省电、勿扰模式和 OPPO 后台限制可能延迟或静音；重要截止请另设闹钟。仅有日期或时间用途待确认时不能开启提醒。</p><p class="error-text" id="reminder-status" role="status"></p>`;
    const status=document.getElementById('reminder-status');status.textContent=error||lastResult?.issues?.[0]?.reason||'';
    root.querySelectorAll('button').forEach(b=>{b.disabled=!native;});
  }
  async function refresh(){
    try{permission=await service.permission();lastResult=await service.sync(app.tasks());error='';if(permission!=='granted'&&app.tasks().some(t=>!t.done&&t.reminderMinutes))error='任务已保留，但通知权限未开启，提醒尚未安排。';}
    catch(e){error='提醒同步失败：'+e.message;app.toast(error);}
    render();return lastResult;
  }
  function explain(){return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='system-dialog';dialog.id='reminder-explanation';
    dialog.innerHTML='<div class="modal-head"><h2>让重要的事，准时想起</h2></div><div class="modal-body"><p>UniFlow 需要通知权限，才能在你选择的时间提醒任务。不开启也可以正常管理任务，内容仅在本机安排。</p><p class="card-note">普通提醒可能因系统省电而延迟，不替代重要事项的闹钟。</p></div><div class="modal-actions"><button class="button" data-choice="cancel">暂不开启</button><button class="button primary" data-choice="allow">继续</button></div>';
    document.body.append(dialog);let settled=false;const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(value);};
    dialog.addEventListener('click',e=>{const choice=e.target.closest('[data-choice]')?.dataset.choice;if(choice)finish(choice==='allow');});dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dialog.addEventListener('close',()=>finish(false));dialog.showModal();
  });}
  async function enable(){
    permission=await service.permission();
    if(permission==='unavailable'){app.toast('系统提醒仅在 Android 安装版可用，任务仍可正常保存。');return false;}
    if(permission==='granted')return true;
    if(permission==='denied'){app.toast('通知未获允许，请点击“系统通知设置”自行开启。');return false;}
    if(!app.settings().reminderPermissionExplained){
      if(!await explain())return false;
      if(!app.setSettings({reminderPermissionExplained:true}))throw Error('未能保存提醒偏好，请重试。');
      permission=await service.requestPermission();
    }else{app.toast('通知尚未开启，请前往系统通知设置；不会重复弹出权限申请。');return false;}
    render();return permission==='granted';
  }
  window.UniFlowReminderUI={
    service,refresh,
    async prepare(fields){
      if(!fields.reminderMinutes||fields.done)return;
      const item=window.UniFlowReminders.plan({...fields,id:'validation'});
      if(!item)throw Error('提前提醒的时间已经过去，请选择未来时间或“不提醒”。');
      await enable();
    },
    async afterSave(){await refresh();if(error)app.toast(error);else if(lastResult?.issues?.length)app.toast(lastResult.issues[0].reason);}
  };
  document.addEventListener('click',async event=>{
    const action=event.target.closest('[data-reminder]')?.dataset.reminder;if(!action)return;
    const button=event.target.closest('button');button.disabled=true;
    try{if(action==='permission'){await enable();await refresh();}if(action==='settings')await bridge.openNotificationSettings();if(action==='test'&&await enable()){await service.test();app.toast('已请求系统发送测试通知，请查看通知栏；省电策略可能延迟。');}}
    catch(e){app.toast('通知操作失败：'+e.message);}finally{render();}
  });
  document.addEventListener('change',e=>{if(e.target.id==='reminder-default'){if(app.setSettings({reminderDefaultMinutes:Number(e.target.value)}))app.toast('默认提醒时间已保存，新任务可单独修改。');}});
  window.addEventListener('uniflow:rendered',render);
  window.addEventListener('uniflow:data-changed',()=>refresh());
  function openPending(){if(!openedTask||window.UniFlowOnboarding?.isActive())return;const id=openedTask;openedTask=null;app.openTask(id);}
  service.onAction(taskId=>{if(taskId){openedTask=taskId;openPending();}})?.catch(e=>{error='通知点击处理未能初始化：'+e.message;render();});
  window.addEventListener('uniflow:profile-changed',()=>setTimeout(openPending,0));
  window.UniFlowSystem.start(()=>{refresh();openPending();});
})();
