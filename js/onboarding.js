/* Welcome, tutorial and nickname editing; isolated from tasks and calendar. */
(() => {
  'use strict';
  const root = document.getElementById('onboarding');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let store, profile, loadError, screen = '', step = 0, replay = false, busy = false;
  const steps = [
    {title:'认识 UniFlow', icon:'sparkles', text:'把分散在校园通知、文字和图片里的信息收进一处，找出需要跟进的事项。', note:'你可以粘贴文字、导入 TXT 或图片，也可以从其他 App 分享内容。'},
    {title:'主动发现通知', icon:'inbox', text:'在 Android 开启通知访问、选择来源并打开自动捕获后，UniFlow 会整理系统实际提供的通知。', note:'不会读取完整聊天记录；系统权限、来源应用和后台限制可能影响捕获。现在可以跳过，之后再设置。'},
    {title:'一键 AI 整理', icon:'sparkles', text:'对通知、文字或图片使用「AI 整理」，生成可编辑的任务候选。图片会先尝试本地 OCR。', note:'需要配置 DeepSeek Android 直连 Key 或后端代理。AI 结果要由你核对并确认后才会保存；链接只作为链接导入，不会自动读取网页正文。'},
    {title:'任务、日历与提醒', icon:'calendar', text:'确认后的任务同时出现在任务清单和日历。明确日期与时间的任务可以设置本地提醒。', note:'没有日期的任务仍留在待办清单。提醒需要通知权限，Android 厂商和系统可能延迟投递。'}
  ];
  const guide = [
    ['开启通知访问权限','在设置中找到「主动通知感知」，点击「前往系统授权」，在 Android 的通知使用权页面开启 UniFlow。返回后查看授权和监听状态。'],
    ['选择捕获来源','在「主动通知感知」点击「选择捕获来源」，勾选你愿意接入的应用并点「保存来源」。例如微信、QQ 或企业微信是否列出取决于系统可见应用。'],
    ['查看监听状态','设置页「主动通知感知」会显示授权、自动捕获和监听连接状态。若显示未连接，检查系统授权、来源选择和厂商后台限制；也可点「重新同步」。'],
    ['首页「值得关注」','首页只突出本地规则判断为相关或你手动关注的通知。规则用于初筛，不等同于 AI 语义理解；点开通知可查看详情并使用「AI 整理」。'],
    ['「其他消息」是什么','普通消息和待判断消息保留在收件箱「其他消息」折叠区。聊天、简短回复通常不会进入首页高优先级区域，但分类可能有误判。'],
    ['搜索、关注、忽略和删除','在通知收件箱使用搜索框或分类筛选。详情中可选「这条值得关注」「不再关注」；消息列表或详情中可手动删除。人工选择优先于本地自动分类。'],
    ['普通消息自动清理','设置页「收件箱降噪」可调整自动清理、保留天数和数量上限；默认保留 3 天、最多 100 条，并有首次启用宽限期。只清理明确普通且无任务关联、未处于整理或确认流程的自动捕获消息。'],
    ['使用「AI 整理」','打开通知详情或「导入通知」，点击「AI 整理」。可在候选列表编辑任务字段；只有点击「确认并保存」后，任务才会写入清单和日历。AI 需要联网并可能产生 API 用量。'],
    ['整理截图和图片','在「导入通知」中点击「从相册选择图片」或「使用相机拍照」。图片可先点「仅提取文字」查看、编辑 OCR 结果，再点「AI 整理」；图片过于模糊时可重新选择或手动输入。'],
    ['从其他 App 分享内容','在来源 App 选择系统「分享」，选 UniFlow。文字或图片会先显示预览；点「保存到收件箱」后再打开消息整理。只有用户主动分享时才接收内容。'],
    ['URL 导入的范围','分享的 URL 和原始文字会保存在收件箱中，并以安全链接形式显示。UniFlow 不会因此自动获取网页正文；需要整理时，请补充你有权分享的正文文字。'],
    ['配置 DeepSeek BYOK','在「偏好设置」的「UniFlow AI Core」选择「Android 直连」，点「输入 / 更新 Key」并在手机安全输入窗口填写自己的 Key，再点「测试连接」。Key 由 Android 安全存储保护。也可选择已配置的本地或云端后端代理。'],
    ['管理任务和日历','用「新建任务」添加任务，在任务清单编辑、完成或删除。带日期任务显示在对应日历日期；无日期任务仍在待办列表。任务和日历使用同一份数据。'],
    ['设置本地提醒','编辑任务并选择「任务提醒」。需要日期、具体时间和时间用途；保存时按设备本地时间安排。先允许通知权限。系统省电策略或厂商后台管理可能造成延迟。'],
    ['常见问题','通知漏收：检查通知访问、自动捕获、来源选择和监听状态。AI 失败：检查网络、直连 Key 或代理地址。OCR 失败：换清晰图片或手动输入。URL 没有正文：粘贴正文后再整理。'],
    ['隐私与关闭通知感知','关闭「主动通知感知」中的「自动捕获」即可暂停新增捕获，也可在 Android 通知使用权中撤销 UniFlow 授权。不会读取完整聊天记录；AI 只在你主动整理时处理提交内容。']
  ];
  function publish() {
    window.dispatchEvent(new CustomEvent('uniflow:profile-changed', {detail:{...profile}}));
  }
  function visibility(active) {
    document.documentElement.classList.remove('onboarding-pending');
    document.body.classList.toggle('onboarding-active', active);
    for (const selector of ['.sidebar','.app-shell','.skip-link']) document.querySelector(selector).inert = active;
    root.hidden = !active;
  }
  function error(message) {
    const el = document.getElementById('profile-error');
    el.textContent = message;
    document.getElementById('nickname')?.setAttribute('aria-invalid', 'true');
  }
  function welcome(value = profile?.nickname || '') {
    screen = 'welcome'; visibility(true);
    root.innerHTML = `<section class="onboarding-card" aria-labelledby="welcome-title"><img class="welcome-logo" src="assets/brand/uniflow-mark.svg" alt="UniFlow Logo"><p class="eyebrow">YOUR CAMPUS, YOUR FLOW</p><h1 id="welcome-title" tabindex="-1">欢迎来到 UniFlow</h1><p class="onboarding-subtitle">让大学生活更有条理</p><form id="welcome-form" novalidate><label class="field" for="nickname">怎么称呼你？<input id="nickname" name="nickname" value="${esc(value)}" placeholder="输入你喜欢的昵称" autocomplete="nickname" aria-describedby="nickname-help profile-error" enterkeyhint="done"></label><p id="nickname-help" class="onboarding-note">1–20 个字符，无需真实姓名或学号。<br>不注册账号，昵称仅保存在本机。</p><p id="profile-error" class="error-text" role="alert">${esc(loadError?.message || '')}</p><button class="button primary onboarding-primary" type="submit" ${loadError?'disabled':''}>开始使用 ${window.ufIcon('arrow')}</button>${loadError?'<button type="button" class="text-button" data-onboarding="retry">重新读取</button>':''}</form></section>`;
    document.getElementById('welcome-title').focus({preventScroll:true});
  }
  function tutorial() {
    screen = 'tutorial'; visibility(true);
    const item = steps[step];
    root.innerHTML = `<section class="onboarding-card tutorial-card" aria-labelledby="tutorial-title"><div class="tutorial-top"><img src="assets/brand/uniflow-mark.svg" alt="UniFlow"><button class="text-button" data-onboarding="skip">跳过</button></div><div class="tutorial-art" aria-hidden="true"><img src="assets/icons/glass/${item.icon}.svg" alt=""></div><p class="eyebrow">认识 UNIFLOW · ${step+1} / ${steps.length}</p><h1 id="tutorial-title" tabindex="-1">${item.title}</h1><p class="tutorial-description">${item.text}</p><div class="tutorial-note">${item.note}</div><div class="tutorial-dots" aria-label="第 ${step+1} 步，共 ${steps.length} 步">${steps.map((_,i)=>`<span class="${i===step?'active':''}"></span>`).join('')}</div><p id="profile-error" class="error-text" role="alert"></p><div class="tutorial-actions"><button class="button" data-onboarding="previous" ${step===0?'disabled':''}>上一步</button><button class="button primary" data-onboarding="next">${step===steps.length-1?'开始使用':'下一步'} ${window.ufIcon('arrow')}</button></div></section>`;
    root.scrollTop = 0;
    document.getElementById('tutorial-title').focus({preventScroll:true});
  }
  async function finish() {
    try { profile = await store.completeTutorial(); publish(); }
    catch (e) { error(e.message); return; }
    screen = ''; visibility(false); root.innerHTML = '';
    document.querySelector('#modal').close();
    document.querySelector('#navigation [data-view="overview"]').click();
    document.getElementById('main').focus({preventScroll:true});
  }
  async function load() {
    try {
      store ||= window.Capacitor?.isNativePlatform() && window.Capacitor.getPlatform() === 'android'
        ? window.UniFlowProfile.createNativeStore(window.Capacitor.registerPlugin('UniFlowProfileStorage'), window.localStorage)
        : window.UniFlowProfile.createStore();
      profile = await store.load(); loadError = null; publish();
    }
    catch (e) { loadError = e; welcome(); return; }
    if (!profile.nickname) welcome();
    else if (!profile.tutorialCompleted && profile.tutorialStarted) {step = 0; tutorial();}
    else if (!profile.tutorialCompleted) {try{profile=await store.completeTutorial();publish();}catch{}screen='';visibility(false);}
    else {screen=''; visibility(false);}
  }
  function openGuide(opener) {
    if (document.getElementById('tutorial-guide')) return;
    const dialog=document.createElement('dialog');dialog.id='tutorial-guide';dialog.className='system-dialog guide-dialog';
    dialog.setAttribute('aria-labelledby','tutorial-guide-title');
    dialog.innerHTML=`<div class="modal-head"><h2 id="tutorial-guide-title">UniFlow 使用教程</h2><button class="icon-button" type="button" data-guide-close aria-label="关闭教程">${window.ufIcon('close')}</button></div><div class="guide-list">${guide.map(([title,text],i)=>`<details ${i===0?'open':''}><summary><span>${String(i+1).padStart(2,'0')}</span>${esc(title)}</summary><p>${esc(text)}</p></details>`).join('')}</div>`;
    document.body.append(dialog);
    dialog.addEventListener('click',event=>{if(event.target.closest('[data-guide-close]'))dialog.close();});
    dialog.addEventListener('close',()=>{dialog.remove();if(opener?.isConnected)opener.focus();});
    dialog.showModal();
  }
  function editNickname() {
    const modal = document.getElementById('modal');
    document.getElementById('modal-content').innerHTML = `<div class="modal-head"><h2>修改昵称</h2><button class="icon-button" data-action="close" aria-label="关闭弹窗">${window.ufIcon('close')}</button></div><form id="nickname-form" novalidate><div class="modal-body"><label class="field" for="nickname">昵称<input id="nickname" name="nickname" value="${esc(profile.nickname)}" autocomplete="nickname" aria-describedby="nickname-help profile-error" enterkeyhint="done"></label><p id="nickname-help" class="onboarding-note">1–20 个字符，去除首尾空格。仅保存在本机。</p><p id="profile-error" class="error-text" role="alert"></p></div><div class="modal-actions"><button type="button" class="button" data-action="close">取消</button><button class="button primary" type="submit">保存昵称</button></div></form>`;
    modal.showModal();
  }
  async function saving(operation) {
    if (busy) return;
    busy = true;
    const buttons=[...document.querySelectorAll('#onboarding button,#nickname-form button')];
    const states=buttons.map(b=>b.disabled);
    buttons.forEach(b=>{b.disabled=true;});
    try { await operation(); }
    finally {busy=false;buttons.forEach((b,i)=>{b.disabled=states[i];});}
  }
  document.addEventListener('submit', async e=>{
    if (!['welcome-form','nickname-form'].includes(e.target.id)) return;
    e.preventDefault();
    const form = e.target, input = form.elements.nickname;
    await saving(async()=>{
    try { profile = await store.saveNickname(input.value); publish(); }
    catch (err) { error(err.message); input.focus(); return; }
    input.blur();
    if (form.id === 'welcome-form') {step = 0; tutorial();}
    else {document.getElementById('modal').close(); document.querySelector('[data-action="edit-nickname"]').focus();}
    });
  });
  document.addEventListener('click', e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(busy)return;
    const action=b.dataset.onboarding;
    if(action==='retry')saving(load);
    if(action==='skip')saving(finish);
    if(action==='next'){if(step===steps.length-1)saving(finish);else{step++;tutorial();}}
    if(action==='previous'&&step>0){step--;tutorial();}
    if(b.dataset.action==='edit-nickname')editNickname();
    if(b.dataset.action==='replay-tutorial'){replay=true;step=0;tutorial();}
    if(b.dataset.action==='open-help')openGuide(b);
  });
  window.UniFlowOnboarding = {
    isActive:()=>!!screen || !root.hidden || document.documentElement.classList.contains('onboarding-pending'),
    getProfile:()=>profile && ({...profile}),
    handleBack(){
      if(busy)return true;
      if(!screen)return false;
      if(screen==='tutorial'){
        if(step>0){step--;tutorial();}
        else if(replay){screen='';visibility(false);root.innerHTML='';document.querySelector('[data-action="replay-tutorial"]').focus();}
        else welcome();
        return true;
      }
      // At welcome, let the native shell put the App in the background.
      return screen!=='welcome';
    },
    tutorialStepCount:()=>steps.length,
    guideTopicCount:()=>guide.length
  };
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&screen){e.preventDefault();window.UniFlowOnboarding.handleBack();}
  });
  window.addEventListener('storage',e=>{if(e.key===window.UniFlowProfile.KEY||e.key===null)load();});
  load();
})();
