/* Opt-in notification capture settings and durable native-to-inbox synchronization. */
(()=>{
  'use strict';
  const cap=window.Capacitor,native=cap?.isNativePlatform()&&cap.getPlatform()==='android',app=window.UniFlowApp;
  const service=window.UniFlowCapture.createService(native?cap.registerPlugin('UniFlowNotificationCapture'):null);
  const $=s=>document.querySelector(s),esc=value=>String(value??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  let status=null,running=false,scheduled=false,settingsBusy=false,retentionBlocked=false;
  const retention=window.UniFlowInboxPolicy.preferences(localStorage);
  function retentionStatus(){
    const target=$('#inbox-retention-feedback');
    try{if(retentionBlocked)throw Error('paused');const p=retention.get();if($('#inbox-retention-enabled')){$('#inbox-retention-enabled').checked=p.enabled;$('#inbox-retention-days').value=String(p.days);$('#inbox-retention-count').value=String(p.maxCount);}if(target)target.textContent=p.enabled?(Date.now()<p.cleanupNotBefore?'首次启用或重新开启后有 3 天宽限，期间不自动删除。':'仅清理明确普通、无任务关联且不在整理或确认中的自动捕获消息。'):'自动清理已关闭。';return p;}
    catch(e){if(target)target.textContent='保留设置读取或保存失败，自动清理已暂停。';return null;}
  }
  function message(text){const target=$('#capture-feedback');if(target)target.textContent=text;else if(text)app.toast(text);}
  function renderSettings(){
    const grid=$('#main .settings-grid');if(!grid||$('#capture-settings'))return;
    const section=document.createElement('section');section.id='capture-settings';section.tabIndex=-1;section.className='card settings-section';
    section.innerHTML=`<h2>主动通知感知</h2><p>仅在你授权、开启并选择来源后，保存系统实际提供的通知。AI 整理由你点击触发，不自动上传或创建任务。</p><p id="capture-permission" class="card-note" role="status">正在检查系统状态…</p><div class="component-row"><button class="button" data-capture-action="authorize">前往系统授权</button><button class="button" data-capture-action="sources">选择捕获来源</button></div><label class="setting-row capture-toggle"><span>自动捕获</span><input type="checkbox" id="capture-enabled" aria-label="自动捕获" ${native?'':'disabled'}></label><p id="capture-sources-count" class="card-note"></p><label class="field">最多保留的自动捕获通知<select id="capture-limit" ${native?'':'disabled'}><option value="50">50 条</option><option value="100">100 条</option><option value="200">200 条</option></select></label><div class="component-row"><button class="button" data-capture-action="sync">重新同步</button><button class="button danger" data-capture-action="clear">清除自动捕获记录</button></div><p class="card-note">不会读取完整聊天记录；隐藏内容、厂商后台限制或应用通知设置可能导致内容不完整。验证码和部分敏感类别会在本地过滤。来源选择只查询可见应用，不申请广泛应用查询或无障碍权限。</p><p id="capture-feedback" class="card-note" role="status"></p>`;
    section.innerHTML=section.innerHTML.replace('最多保留的自动捕获通知','原生后台同步缓冲');
    const policy=document.createElement('section');policy.id='inbox-retention-settings';policy.className='card settings-section';
    policy.innerHTML=`<h2>收件箱降噪</h2><p>值得关注默认展开，其他消息折叠保留。不确定消息、人工关注和关联任务不会自动清理。</p><label class="setting-row"><span>自动清理普通消息</span><input type="checkbox" id="inbox-retention-enabled"></label><label class="field">普通消息保留时间<select id="inbox-retention-days"><option value="1">1 天</option><option value="3">3 天</option><option value="7">7 天</option><option value="30">30 天</option></select></label><label class="field">普通消息数量上限<select id="inbox-retention-count"><option value="50">50 条</option><option value="100">100 条</option><option value="200">200 条</option><option value="500">500 条</option></select></label><p class="card-note">超过时限或数量上限时，优先清理最旧的普通消息。受保护消息不计入此上限；清理在 App 前台同步时执行。原生缓冲只限制后台待同步队列，不会裁剪已保存的收件箱。</p><p id="inbox-retention-feedback" class="card-note" role="status"></p>`;
    grid.append(section,policy);applyStatus();retentionStatus();
  }
  function applyStatus(){
    const target=$('#capture-permission');if(!target)return;
    if(!status){target.textContent='正在检查系统状态…';return;}
    target.textContent=!status.available?'仅支持 Android App。':!status.authorized?(status.enabled?'捕获已开启，但通知访问未授权或已撤销；当前不会捕获。':'通知访问未授权；自动捕获关闭。'):!status.enabled?'系统已授权，自动捕获关闭。':status.connected?'系统已授权，监听已连接。':'系统已授权，等待监听连接；请检查系统后台限制。';
    $('#capture-enabled').checked=!!status.enabled;$('#capture-enabled').disabled=!status.available||settingsBusy;
    $('#capture-limit').value=String(status.maxRecords||100);$('#capture-limit').disabled=!status.available||settingsBusy;
    $('#capture-sources-count').textContent=`已选择 ${status.allowedPackages?.length||0} 个来源；原生后台同步缓冲 ${status.maxRecords||100} 条，已保存的收件箱不受此上限裁剪。`;
    if(status.enabled&&!status.allowedPackages?.length)target.textContent+=' 尚未选择来源，不会捕获。';
    document.querySelectorAll('[data-capture-action]').forEach(b=>b.disabled=!status.available||settingsBusy);
    if(status.storageError)message('原生通知存储曾失败，请检查剩余空间并重试；没有上传通知。');
  }
  async function refresh(){try{status=await service.status();applyStatus();}catch(e){message(e.message);}}
  async function flushDeletes(){
    const ids=app.captureDeletedIds();if(!ids.length)return;
    await service.delete(ids,app.captureDeleteVersions());
    if(!app.ackCaptureDeletes(ids))throw Error('删除状态保存失败，请重试。');
  }
  async function sync(){
    if(running){scheduled=true;return;}
    if(!service.available)return;
    if(document.querySelector('dialog[open]'))return;
    running=true;
    try{
      await refresh();
      await flushDeletes();
      for(let round=0;round<5;round++){
        const items=await service.pending();if(!items.length)break;
        if(!app.mergeCapturedMessages(items,status?.maxRecords||100))throw Error('收件箱保存失败，原生通知仍待同步。');
        await service.acknowledge(items.map(item=>({id:item.id,version:item.version})));
      }
      const policy=retentionStatus();
      if(policy){const result=app.cleanupOrdinaryMessages(policy);if(result.failed)throw Error('普通消息清理未保存，原数据保留。');await flushDeletes();}
    }catch(e){message(e.message||'通知同步失败，原记录保留，可重试。');}
    finally{running=false;if(scheduled){scheduled=false;setTimeout(sync,250);}}
  }
  async function saveConfig(config){settingsBusy=true;applyStatus();try{status=await service.configure(config);applyStatus();message('通知捕获设置已保存。');}finally{settingsBusy=false;applyStatus();}}
  async function chooseSources(){
    await refresh();const apps=await service.sources(),selected=new Set(status.allowedPackages||[]);
    const dialog=document.createElement('dialog');dialog.id='capture-sources-dialog';dialog.className='system-dialog capture-sources-dialog';
    dialog.innerHTML=`<div class="modal-head"><h2>选择捕获来源</h2><button class="icon-button" data-capture-close aria-label="关闭">${window.ufIcon('close')}</button></div><div class="modal-body"><label class="field">搜索应用<input id="capture-app-search" type="search" placeholder="应用名称"></label><div class="capture-source-list">${apps.map(item=>`<label class="capture-source" data-source-name="${esc(item.name.toLowerCase())}"><span class="capture-source-icon" data-capture-icon="${esc(item.packageName)}" aria-hidden="true">${esc(item.name.slice(0,1))}</span><span>${esc(item.name)}</span><input type="checkbox" value="${esc(item.packageName)}" ${selected.has(item.packageName)?'checked':''}></label>`).join('')||'<p>没有找到可见应用。</p>'}</div><p class="card-note">这里只列出系统允许查询的应用。通知内容是否完整取决于来源应用；选择来源不会自动授予通知访问权限。</p><p id="capture-source-error" class="error-text" role="alert"></p></div><div class="modal-actions"><button class="button" data-capture-close>取消</button><button class="button primary" data-capture-save-sources>保存来源</button></div>`;
    document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();sync();});dialog.addEventListener('click',async event=>{
      if(event.target.closest('[data-capture-close]')){dialog.close();return;}
      const save=event.target.closest('[data-capture-save-sources]');if(!save||save.disabled)return;save.disabled=true;
      try{await saveConfig({allowedPackages:[...dialog.querySelectorAll('.capture-source input:checked')].map(input=>input.value)});dialog.close();}catch(e){dialog.querySelector('#capture-source-error').textContent=e.message;}finally{save.disabled=false;}
    });
    dialog.querySelector('#capture-app-search').addEventListener('input',event=>{const value=event.target.value.toLowerCase().trim();dialog.querySelectorAll('[data-source-name]').forEach(row=>row.hidden=!row.dataset.sourceName.includes(value));});
    dialog.showModal();
    const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const target=entry.target;observer.unobserve(target);service.icon(target.dataset.captureIcon).then(url=>{if(!url||!target.isConnected)return;const image=document.createElement('img');image.src=url;image.alt='';target.replaceChildren(image);}).catch(()=>{});}}, {root:dialog.querySelector('.modal-body')});
    dialog.querySelectorAll('[data-capture-icon]').forEach(el=>observer.observe(el));dialog.addEventListener('close',()=>observer.disconnect(),{once:true});
  }
  document.addEventListener('change',async event=>{
    if(event.target.id.startsWith('inbox-retention-')){
      try{retention.save(event.target.id==='inbox-retention-enabled'?{enabled:event.target.checked}:event.target.id==='inbox-retention-days'?{days:Number(event.target.value)}:{maxCount:Number(event.target.value)});retentionBlocked=false;retentionStatus();sync();}catch(e){retentionBlocked=true;retentionStatus();if($('#inbox-retention-feedback'))$('#inbox-retention-feedback').textContent='设置未保存，自动清理已暂停。';}
      return;
    }
    if(!['capture-enabled','capture-limit'].includes(event.target.id)||settingsBusy)return;
    const config=event.target.id==='capture-enabled'?{enabled:event.target.checked}:{maxRecords:Number(event.target.value)};
    try{await saveConfig(config);sync();}catch(e){message(e.message);applyStatus();}
  });
  document.addEventListener('click',async event=>{
    const action=event.target.closest('[data-capture-action]')?.dataset.captureAction;if(!action||settingsBusy)return;
    try{
      if(action==='authorize'){await service.openSettings();return;}
      if(action==='sources'){await chooseSources();return;}
      if(action==='sync'){await sync();return;}
      if(action==='clear'){
        if(running)throw Error('正在同步，请稍后再清除。');
        if(!confirm('清除全部自动捕获通知？手动导入、系统分享、图片及已有任务会保留。'))return;
        running=true;settingsBusy=true;applyStatus();
        try{
          if(!app.clearCapturedMessages())throw Error('清除未保存，原收件箱保留。');
          await service.clear();message('自动捕获记录已清除。');
        }finally{running=false;settingsBusy=false;applyStatus();setTimeout(sync,0);}
      }
    }catch(e){message(e.message||'操作失败，请重试。');}
  });
  window.addEventListener('uniflow:rendered',()=>{renderSettings();});
  document.addEventListener('click',event=>{
    const shortcut=event.target.closest('[data-action="focus-capture-settings"]');
    if(shortcut){
      const section=$('#capture-settings');
      if(section){section.scrollIntoView({behavior:'smooth',block:'start'});section.focus({preventScroll:true});}
      else message('通知设置尚未载入，请重新打开偏好设置。');
      return;
    }
    const id=event.target.closest('[data-delete-notice]')?.dataset.deleteNotice;
    if(!id||app.getNotice(id)?.source!=='android_notification')return;
    event.preventDefault();event.stopImmediatePropagation();app.deleteCapturedMessage(id);setTimeout(sync,0);
  },true);
  window.addEventListener('uniflow:data-changed',()=>setTimeout(sync,0));
  document.addEventListener('close',()=>setTimeout(sync,0),true);
  service.listen(()=>{refresh();sync();}).catch(e=>message(e.message));
  window.UniFlowSystem.start(()=>{refresh();sync();});renderSettings();
  window.UniFlowCaptureUI={service,sync,refresh};
})();
