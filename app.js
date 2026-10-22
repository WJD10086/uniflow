/* UniFlow application UI; native services and AI transport live in separate modules. */
(() => {
  'use strict';
  const icon = window.ufIcon;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const Store = window.UniFlowStore;
  const Relevance = window.UniFlowRelevance;
  const NoticeTime = window.UniFlowNoticeTime;
  const InboxPolicy = window.UniFlowInboxPolicy;
  const BASE = Store.today();
  const WEEK_START = Store.monday(BASE);
  const names = {overview:'今日概览', inbox:'通知收件箱', calendar:'我的日程', tasks:'任务清单', settings:'偏好设置'};
  const seed = {
    schemaVersion:Store.VERSION, revision:0,
    notices: [],
    tasks:[],
    settings:{reminders:true,review:true}, selectedDay:BASE
  };
  let state, startupError,store;
  try {
    const storage=window.UniFlowTaskPersistence.createStorage(localStorage,window.UniFlowTaskJournal,raw=>Store.migrate(JSON.parse(raw),BASE));
    store=Store.createStore({seed,today:BASE,storage});state=store.load();
  }
  catch (error) { startupError=error; state={tasks:[],notices:[],settings:{reminders:true},selectedDay:BASE}; }
  const calendarItems = () => Store.calendarTasks(state);
  let view=names[location.hash.slice(1)]?location.hash.slice(1):'overview';
  function calendarDayFromUrl(){
    const day=new URL(location.href).searchParams.get('calendarDay');
    return Store.validDate(day)&&day>='1000-01-01'&&day<='9998-12-31'?day:BASE;
  }
  let inboxFilter='all',taskFilter='active',noticeQuery='',calendarDay=calendarDayFromUrl(),overviewDay=BASE,toastTimer,importDraft='';
  let otherMessagesOpen=false;
  function reportError(error) {
    const message=error.message || '保存失败，本次操作未生效，请重试。';
    $('#storage-error-text').textContent=message;
    $('#storage-error').hidden=false;
    if ($('#modal').open) {
      let detail=$('#modal-error');
      if(!detail){detail=document.createElement('p');detail.id='modal-error';detail.className='error-text';detail.setAttribute('role','alert');$('#modal-content .modal-body').append(detail);}
      detail.textContent=message;
    }
    toast(message);
  }
  function applyChange(operation) {
    try { state=operation(); $('#storage-error').hidden=true; $('#modal-error')?.remove(); window.dispatchEvent(new Event('uniflow:data-changed')); return true; }
    catch(error) { reportError(error); return false; }
  }
  const commit=mutate=>applyChange(()=>store.transact(mutate));
  function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3400);}
  const pending=()=>state.notices.filter(n=>n.status==='pending');
  const attentionNotices=()=>Relevance.attention(state.notices);
  function markNoticeRead(id){
    const notice=state.notices.find(n=>n.id===id);if(!notice)return false;
    if(!Relevance.assessment(notice).unread)return true;
    return commit(d=>{const i=d.notices.findIndex(n=>n.id===id);d.notices[i]=Relevance.read(d.notices[i]);});
  }
  function setNoticeAttention(id,decision){
    if(!commit(d=>{const i=d.notices.findIndex(n=>n.id===id);if(i<0)throw Error('消息已删除。');d.notices[i]=Relevance.feedback(d.notices[i],decision);}))return;
    const inDetail=$('#modal').open&&$('#notice-relevance')?.dataset.noticeId===id;
    render();if(inDetail)paintNoticeRelevance(state.notices.find(n=>n.id===id));
    toast(decision==='relevant'?'已加入值得关注':'已取消关注，消息仍保留在收件箱');
  }
  function paintNoticeRelevance(notice){
    const host=$('#notice-relevance');if(!host||!notice)return;
    const result=Relevance.assessment(notice);host.dataset.noticeId=notice.id;
    host.innerHTML=`<p class="card-note">${esc(Relevance.describe(notice))}${result.overridden?'（保留你的选择）':''} · 本地规则判断</p><div class="component-row">${result.label==='excluded'?'':`<button type="button" class="button" data-attention-relevant="${esc(notice.id)}" ${result.overridden&&result.label==='relevant'?'disabled':''}>这条值得关注</button>`}<button type="button" class="button" data-attention-ignore="${esc(notice.id)}" ${result.overridden&&result.label==='ordinary'?'disabled':''}>不再关注</button></div>`;
  }
  function attentionPanel(){
    const notices=attentionNotices();if(!notices.length)return '';
    const unread=notices.filter(n=>Relevance.assessment(n).unread).length,unprocessed=notices.filter(n=>n.status==='pending').length;
    return `<section id="home-attention" class="card" aria-label="值得关注"><div class="card-head"><div><h2>值得关注 <span class="count-pill">${notices.length}</span></h2><p class="card-note" data-attention-count>${unread} 条未读 · ${unprocessed} 条待处理</p></div><button class="text-button" data-attention-all>查看全部 ${icon('arrow')}</button></div><p class="attention-note">本地规则发现的潜在安排，由你核对和整理。</p>${notices.slice(0,3).map(n=>`<div class="attention-item" data-attention-id="${esc(n.id)}">${noticeRow(n,Relevance.focus(n))}<div class="attention-actions"><button class="text-button" data-attention-read="${esc(n.id)}" ${Relevance.assessment(n).unread?'':'disabled'}>标记已读</button><button class="text-button" data-attention-ignore="${esc(n.id)}">不再关注</button></div></div>`).join('')}</section>`;
  }
  const activeTasks=()=>state.tasks.filter(t=>!t.done);
  const dateLabel=d=>d?`${d.slice(0,4)} 年 ${Number(d.slice(5,7))} 月 ${Number(d.slice(8,10))} 日`:'无截止日期';
  const shortDate=d=>d?`${Number(d.slice(5,7))}.${Number(d.slice(8,10))}`:'未设日期';
  const feature=name=>`<img src="assets/icons/glass/${name}.svg" alt="">`;
  function heading(k,title,subtitle,actions=''){return `<div class="page-heading"><div><div class="eyebrow">${k}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;}
  const button=(label,action,ico='plus',primary=false,extra='')=>`<button class="button ${primary?'primary':''} ${extra}" data-action="${action}">${icon(ico)}${label}</button>`;
  function empty(title,text,action=''){return `<div class="empty-state">${feature('inbox')}<h3>${title}</h3><p>${text}</p>${action}</div>`;}
  function hydrate(){document.querySelectorAll('[data-icon]').forEach(e=>{e.innerHTML=icon(e.dataset.icon);});}
  function renderNav(){ $('#navigation').innerHTML=Object.entries(names).filter(([id])=>id!=='settings').map(([id,label])=>`<button class="nav-item ${view===id?'active':''}" data-view="${id}" aria-label="${label}" ${view===id?'aria-current="page"':''}>${icon(id==='design'?'palette':id)}<span>${label}</span>${id==='inbox'&&pending().length?`<span class="count">${pending().length}</span>`:''}</button>`).join('');$('#breadcrumb-title').textContent=names[view];}
  let profile = {nickname:''};
  function renderProfile(){
    document.querySelectorAll('[data-profile-name]').forEach(el=>{el.textContent=profile.nickname||'我的昵称';});
    document.querySelectorAll('[data-profile-avatar]').forEach(el=>{el.textContent=[...(profile.nickname||'U')][0];});
  }
  window.addEventListener('uniflow:profile-changed',event=>{profile=event.detail;render();});
  window.UniFlowHomeContext=()=>({tasks:state.tasks,nickname:profile.nickname,view});
  window.UniFlowApp={tasks:()=>JSON.parse(JSON.stringify(state.tasks)),settings:()=>({...state.settings}),setSettings:patch=>commit(d=>Object.assign(d.settings,patch)),toast,
    importText:()=>$('#import-text')?.value||'',
    getNotice:id=>{const n=state.notices.find(item=>item.id===id);return n?JSON.parse(JSON.stringify(n)):null;},
    saveImportedMessage:notice=>applyChange(()=>store.transact(d=>window.UniFlowMessages.append(d,notice))),
    updateNoticeContent:(id,text,ocrStatus='ready')=>commit(d=>{const n=d.notices.find(item=>item.id===id);if(!n)throw Error('消息已删除。');if(typeof text!=='string'||text.length>100000)throw Error('文字不能超过 100000 字符。');n.text=text;n.ocrStatus=ocrStatus;}),
    saveAiTasks:(fields,sourceNoticeId=$('#ai-task-dialog')?.dataset.sourceNoticeId)=>{
      if(!Array.isArray(fields)||!fields.length||fields.length>20)throw Error('请选择 1–20 项任务后再保存。');
      let sourceNotice=sourceNoticeId?state.notices.find(n=>n.id===sourceNoticeId):null;
      const version=Number($('#ai-task-dialog')?.dataset.sourceCaptureVersion||0);
      if(sourceNotice&&version&&version!==sourceNotice.captureVersion){const old=sourceNotice.captureHistory?.find(h=>h.version===version);if(!old)throw Error('所选通知版本已不在本地历史中，请重新整理。');sourceNotice={...sourceNotice,title:old.title,text:old.content,receivedAt:old.receivedAt,captureVersion:old.version};}
      if(sourceNoticeId&&!sourceNotice)throw Error('原消息已删除，请关闭候选后重新整理。');
      const provenance=sourceNotice?{noticeId:sourceNotice.id,sourceText:sourceNotice.text.slice(0,8000),sourceMessage:{id:sourceNotice.id,source:sourceNotice.source,appName:sourceNotice.appName||'',packageName:sourceNotice.packageName||'',version:sourceNotice.captureVersion||null,receivedAt:sourceNotice.receivedAt||null}}:{};
      const normalized=fields.map(item=>{
        const title=String(item.title||'').trim(),date=item.date||'',time=item.time||'',dateRole=item.dateRole;
        if(!title||title.length>80)throw Error('任务名称须为 1–80 个字符。');
        if(date&&!Store.validDate(date))throw Error('候选任务包含无效日期，请检查。');
        if(time&&!Store.validTime(time))throw Error('候选任务包含无效时间，请检查。');
        if(time&&!date)throw Error('无日期的任务不能保存具体时间。');
        if(!['deadline','start','unspecified'].includes(dateRole))throw Error('请选择时间用途。');
        return {title,date,time,dateRole,location:String(item.location||'').slice(0,80),type:'personal',priority:'normal',reminderMinutes:0,source:sourceNotice?.appName?`${sourceNotice.appName} · AI 整理（已确认）`:'AI 整理（已确认）',...provenance};
      });
      const key=item=>JSON.stringify([item.title.trim(),item.date||'',item.time||'',item.dateRole]);
      const seen=new Set(state.tasks.map(key));
      const unique=normalized.filter(item=>{const id=key(item);if(seen.has(id))return false;seen.add(id);return true;});
      if(!unique.length)throw Error('这些任务已经存在，无需重复保存。');
      const before=state.tasks.length;
      if(!applyChange(()=>store.addTasks(unique)))return false;
      const added=state.tasks.slice(before);const day=added.find(t=>t.date)?.date;if(day)rememberCalendarDay(day);
      render();window.UniFlowReminderUI?.afterSave();toast(`已确认保存 ${added.length} 项任务到任务清单与日历`);return true;
    },
    navigate,hasSharedNotice:id=>typeof id==='string'&&state.notices.some(n=>n.shareId===id),
    importSharedNotice(item){
      if(!item||typeof item.id!=='string'||!item.id)throw Error('分享 ID 缺失。');
      if(state.notices.some(n=>n.shareId===item.id))return true;
      const notice=window.UniFlowMessages.create({...item,id:'android-share:'+item.id,shareId:item.id,source:'android_share'});
      return commit(d=>window.UniFlowMessages.append(d,notice));
    },
    captureDeletedIds:()=>[...(state.captureDeletedIds||[])],
    captureDeleteVersions:()=>({...state.captureDeleteVersions}),
    ackCaptureDeletes:ids=>{
      if(!(state.captureDeletedIds||[]).some(id=>ids.includes(id)))return true;
      return commit(d=>{d.captureDeletedIds=(d.captureDeletedIds||[]).filter(id=>!ids.includes(id));for(const id of ids)if(d.captureDeleteVersions)delete d.captureDeleteVersions[id];});
    },
    mergeCapturedMessages(items,limit){
      const draft={notices:JSON.parse(JSON.stringify(state.notices)),captureDeletedIds:state.captureDeletedIds||[]};
      if(!window.UniFlowCapture.merge(draft,items,limit).changed)return true;
      if(!commit(d=>{d.notices=draft.notices;}))return false;render();return true;
    },
    cleanupOrdinaryMessages(policy,options={}){
      if(document.querySelector('dialog[open]')||window.UniFlowAIUI?.isBusy())return {count:0};
      const ids=InboxPolicy.plan(state,policy,options);if(!ids.length)return {count:0};
      if(!commit(d=>{const selected=new Set(InboxPolicy.plan(d,policy,options).filter(id=>ids.includes(id)));for(const n of d.notices)if(selected.has(n.id))window.UniFlowCapture.markDeleted(d,n);d.notices=d.notices.filter(n=>!selected.has(n.id));}))return {count:0,failed:true};
      render();return {count:ids.length};
    },
    deleteCapturedMessage(id){
      const item=state.notices.find(n=>n.id===id);if(!window.UniFlowCapture.isCapturedNotice(item))return false;
      if(!commit(d=>{window.UniFlowCapture.markDeleted(d,item);d.notices=d.notices.filter(n=>n.id!==id);}))return false;
      closeModal();render();toast('自动捕获消息已删除，已有任务仍保留。');return true;
    },
    clearCapturedMessages(){
      if(!state.notices.some(n=>window.UniFlowCapture.isCapturedNotice(n)))return true;
      if(!commit(d=>{for(const n of d.notices)window.UniFlowCapture.markDeleted(d,n);d.notices=d.notices.filter(n=>!window.UniFlowCapture.isCapturedNotice(n));}))return false;
      render();return true;
    },
    openNotice:reviewNotice,
    openTask(id){navigate('tasks');if(state.tasks.some(t=>t.id===id))editTask(id);else toast('该任务已删除，已返回任务列表。');}};
  function render(){renderProfile();renderNav();$('#main').innerHTML=({overview:overview,inbox:inbox,calendar:calendar,tasks:tasks,settings:settings}[view])();hydrate();document.title=`${names[view]} · UniFlow`;window.dispatchEvent(new Event('uniflow:rendered'));}
  function navigate(next){if(!names[next])return;view=next;location.hash=next;render();window.scrollTo({top:0,behavior:'instant'});}
  function restoreViewFromUrl(){view=names[location.hash.slice(1)]?location.hash.slice(1):'overview';calendarDay=calendarDayFromUrl();render();}
  window.addEventListener('hashchange',restoreViewFromUrl);
  // History traversal can change both the query date and the page fragment.
  window.addEventListener('popstate',restoreViewFromUrl);
  function noticeSource(n){return ['android_notification','windows_notification'].includes(n.source)?`${n.appName||n.packageName||'系统通知'} · 自动捕获`:n.source;}
  function noticeRow(n,display=null){
    const view=display&&typeof display==='object'?display:n;
    const preview=n.imageId?`<span class="notice-image-thumb" data-image-thumb="${esc(n.imageId)}">图片</span>`:'';
    const link=n.originalUrl?'<span class="tag">含链接</span>':'';
    return `<button class="notice-row" data-notice="${esc(n.id)}">${preview||`<span class="source-icon ${esc(n.color)}">${icon(n.kind)}</span>`}<span class="notice-body"><span class="notice-title"><span>${esc(view.title)}</span>${n.category==='截止提醒'?'<span class="tag amber">即将截止</span>':''}${n.captureUpdated?'<span class="tag amber">通知已更新</span>':''}${n.captureHistory?.length?'<span class="tag">含通知历史</span>':''}${link}<span class="tag relevance-${Relevance.assessment(n).label}">${esc(Relevance.labels[Relevance.assessment(n).label])}</span>${Relevance.assessment(n).unread?'<span class="tag attention-new">新</span>':''}</span><p>${esc(view.text||'图片消息，打开查看原图')}</p><span class="notice-meta"><span>${esc(noticeSource(n))}</span><span>${esc(n.category)}</span><span class="tag ${n.status==='confirmed'?'green':n.status==='archived'?'gray':''}">${n.status==='confirmed'?'已加入日程':n.status==='archived'?'已归档':'待确认'}</span></span></span><span class="row-side"><span>${esc(NoticeTime.label(n))}</span>${icon('chevron')}</span></button>`;
  }
  function taskRow(t){
    const date=t.date?(t.date===BASE?'今天':dateLabel(t.date)):'';
    const source=['android_notification','windows_notification'].includes(t.source)?noticeSource(state.notices.find(n=>n.id===t.noticeId)||{source:t.source}):t.source;
    return `<div class="task-preview"><button class="task-check ${t.done?'done':''}" data-task-toggle="${esc(t.id)}" aria-label="${t.done?'恢复':'完成'}任务：${esc(t.title)}" aria-pressed="${t.done}">${t.done?icon('check'):''}</button><div><h3 class="${t.done?'completed':''}"><button class="schedule-open" data-edit-task="${esc(t.id)}">${esc(t.title)}</button></h3><p>${esc(source)} · ${esc(date)} ${esc(Store.timeLabel(t))}</p></div><span class="tag ${t.done?'green':t.priority==='high'?'amber':'gray'}">${t.done?'已完成':t.priority==='high'?'优先处理':'按计划进行'}</span><button class="icon-button" data-edit-task="${esc(t.id)}" aria-label="编辑任务：${esc(t.title)}">${icon('chevron')}</button></div>`;
  }
  function overview(){const total=state.tasks.length,done=total-activeTasks().length;return heading('YOUR DAILY FLOW',`<span data-home-greeting>${window.UniFlowSystem.snapshot().greeting}，${esc(profile.nickname||'新朋友')}！</span>`,`<span class="home-local-date" data-home-date>${window.UniFlowSystem.snapshot().dateLabel}</span><span data-home-hint>今天有 ${window.UniFlowSystem.todayTasks(state.tasks,window.UniFlowSystem.snapshot().day)} 项待办。</span>`,`<span class="date-chip">${icon('calendar')}<span data-home-date>${window.UniFlowSystem.snapshot().dateLabel}</span></span>${button('导入通知','import','plus',true)}`)+`<div class="overview-grid"><div class="main-column"><section class="hero"><div class="hero-copy"><div class="hero-label">${icon('sparkles')} LESS NOISE. MORE FLOW.</div><h2>通知有归处，<br>生活有<em>节奏。</em></h2><p>${pending().length?`收件箱有 ${pending().length} 条消息待处理，值得关注的安排见下方。`:'从第一条任务开始，让今天更有条理。'}</p><button class="text-button" data-view="inbox">查看待处理通知 ${icon('arrow')}</button></div><div class="hero-art"><div class="orbit"></div><div class="orbit second"></div><img src="assets/brand/uniflow-mark.svg" alt=""><span class="floating-chip a">${icon('check')}</span><span class="floating-chip b">${icon('calendar')}</span><span class="hero-glint">✧</span></div></section><section class="stats-grid" aria-label="今日统计"><div class="stat-card">${feature('inbox')}<div><div class="stat-label">待确认通知</div><div class="stat-number">${String(pending().length).padStart(2,'0')}<span>条</span></div><div class="tiny-caption">收件箱待处理消息</div></div></div><div class="stat-card">${feature('calendar')}<div><div class="stat-label">今日日程</div><div class="stat-number">${String(calendarItems().filter(e=>e.date===BASE).length).padStart(2,'0')}<span>项</span></div><div class="tiny-caption">学习与生活，刚刚好</div></div></div><div class="stat-card">${feature('tasks')}<div><div class="stat-label">待办任务</div><div class="stat-number">${String(activeTasks().length).padStart(2,'0')}<span>项</span></div><div class="tiny-caption">每一步，都算数</div></div></div></section>${attentionPanel()}<section id="home-weather" class="card" aria-label="天气"></section><section class="card"><div class="card-head"><h2>接下来，做这些</h2><button class="text-button" data-view="tasks">全部任务 ${icon('arrow')}</button></div>${activeTasks().slice(0,2).map(taskRow).join('')||empty(state.tasks.length?'任务已全部完成':'从第一条任务开始',state.tasks.length?'给自己一点放松的时间。':'添加一件想做的事，也可以暂不设置日期。',button('新建任务','new-task','plus',true))}</section></div><div class="right-column"><section class="card"><div class="card-head"><h2>日程一览</h2><button class="icon-button" data-view="calendar" aria-label="查看完整日历">${icon('calendar')}</button></div><div class="mini-week-label"><span>${BASE.slice(0,4)} 年 ${Number(BASE.slice(5,7))} 月</span><span>本周</span></div><div class="week-dots">${Array.from({length:7},(_,i)=>{const date=Store.dateAdd(WEEK_START,i);return `<button class="day-dot ${overviewDay===date?'selected':''}" data-day="${date}" aria-label="${dateLabel(date)}" aria-pressed="${overviewDay===date}"><small>${'一二三四五六日'[i]}</small>${Number(date.slice(8))}<i></i></button>`;}).join('')}</div><div class="schedule-list">${calendarItems().filter(e=>e.date===overviewDay).sort((a,b)=>a.time.localeCompare(b.time)).map((e,i)=>`<div class="schedule-item ${['','mint','amber'][i%3]}"><time>${esc(Store.timeLabel(e))}</time><h3 class="${e.done?'completed':''}"><button class="schedule-open" data-edit-task="${esc(e.id)}">${esc(e.title)}</button></h3><p>${icon('location')}${esc(e.location)}</p></div>`).join('')||'<div class="empty-state" style="padding:25px 0"><p>这一天暂时没有安排</p></div>'}</div><div class="inline-footer"><button class="text-button" data-view="calendar">查看完整日程 ${icon('arrow')}</button></div></section><section class="focus-card"><h2>${icon('sparkles')} 给今天留一点从容</h2><p>你已经完成了 <strong>${done} 项任务</strong>。<br>保持自己的节奏，慢慢来，也很快。</p><div class="progress-track"><div class="progress-fill" style="width:${total?Math.round(done/total*100):0}%"></div></div><div class="focus-caption"><span>今日任务进度</span><span>${done} / ${total}</span></div></section></div></div>`;}
  function inbox(){return heading('INFORMATION, ORGANIZED','通知收件箱','把散落的信息，变成清晰的下一步。',button('导入通知','import','plus',true))+`<div class="toolbar"><div class="filter-group">${[['all','全部通知'],['relevant','值得关注'],['uncertain','待判断'],['pending','待确认'],['confirmed','已加入日程'],['archived','已归档']].map(([id,l])=>`<button class="filter-button ${inboxFilter===id?'active':''}" data-inbox-filter="${id}">${l}</button>`).join('')}</div><label class="field-search">${icon('search')}<input id="notice-search" type="search" placeholder="搜索通知标题、来源…" aria-label="搜索收件箱" value="${esc(noticeQuery)}"></label></div><section class="card inbox-page"><div class="inbox-summary"><span><strong>${pending().length} 条通知</strong> 等待你的确认</span><span>先核对，再安排</span></div><div id="notice-results">${filteredNotices()}</div></section><div class="local-note">${icon('shield')}<span>消息和图片保存在本机。AI 整理由你主动触发，结果须经确认；分享链接不会自动读取网页正文。</span></div>`;}
  function filteredNotices(){
    const filtered=state.notices.filter(n=>(inboxFilter==='all'||(['relevant','uncertain'].includes(inboxFilter)?n.status!=='archived'&&Relevance.assessment(n).label===inboxFilter:n.status===inboxFilter))&&`${n.title} ${noticeSource(n)} ${n.text} ${(n.captureHistory||[]).map(h=>h.content).join(' ')}`.toLowerCase().includes(noticeQuery.toLowerCase()));
    if(!filtered.length)return empty('没有找到相关通知','试试其他关键词，或切换通知分类。');
    const groups=InboxPolicy.groups(filtered),uncertain=groups.other.filter(n=>Relevance.assessment(n).label==='uncertain').length;
    const attention=`<section class="inbox-group" id="inbox-attention-group" aria-label="值得关注"><h2>值得关注 <span class="count-pill">${groups.attention.length}</span></h2>${groups.attention.map(n=>noticeRow(n,Relevance.focus(n))).join('')||'<p class="card-note">暂时没有值得关注的安排，其他消息仍可展开查看。</p>'}</section>`;
    const other=groups.other.length?`<details class="inbox-group inbox-other" id="inbox-other-group" ${otherMessagesOpen||noticeQuery||inboxFilter!=='all'?'open':''}><summary>其他消息 <span class="count-pill">${groups.other.length}</span>${uncertain?`<span class="tag relevance-uncertain">${uncertain} 条待判断</span>`:''}<span class="inbox-expand-hint">展开查看</span></summary><p class="card-note">普通消息与待判断消息保留在这里，可搜索、打开详情或手动删除。自动清理仅处理符合保留规则的普通通知。</p>${groups.other.map(n=>noticeRow(n)).join('')}</details>`:'';
    return attention+other;
  }
  document.addEventListener('toggle',event=>{if(event.target.id==='inbox-other-group'&&!noticeQuery&&inboxFilter==='all')otherMessagesOpen=event.target.open;},true);
  function dateAdd(str,n){return Store.dateAdd(str,n);}
  function calendar(){return window.UniFlowCalendar.render(state,{day:calendarDay},{esc,icon,heading,button,taskRow});}
  function rememberCalendarDay(day){
    calendarDay=day;
    // Keep the view on refresh without writing UI selection into task storage.
    // A blocked History API must not interrupt an already-saved task operation.
    try{const url=new URL(location.href);url.searchParams.set('calendarDay',day);history.replaceState(history.state,'',url.href);}catch{}
  }
  function selectCalendarDay(day){if(!Store.validDate(day)){toast('请选择有效日期');return;}rememberCalendarDay(day);render();}
  function timeFields(role,date,time){
    const dateText=role==='start'?'开始日期（可选）':role==='deadline'?'截止日期（可选）':'日期（用途待确认）';
    const timeText=role==='start'?'开始时间（可选，设备本地时间）':role==='deadline'?'截止时间（可选，设备本地时间）':'时间（用途待确认，设备本地时间）';
    return `<label class="field">时间用途<select name="dateRole"><option value="deadline" ${role==='deadline'?'selected':''}>任务截止</option><option value="start" ${role==='start'?'selected':''}>日程开始</option><option value="unspecified" ${role==='unspecified'?'selected':''}>待确认（保留原时间）</option></select></label><div class="field-grid"><label class="field"><span data-date-label>${dateText}</span><input type="date" name="date" value="${esc(date)}" min="1000-01-01" max="9998-12-31"></label><label class="field"><span data-time-label>${timeText}</span><input type="time" name="time" value="${esc(time)}"></label></div>`;
  }
  function refreshTimeLabels(form){
    const role=form.elements.dateRole.value;
    form.querySelector('[data-date-label]').textContent=role==='start'?'开始日期（可选）':role==='deadline'?'截止日期（可选）':'日期（用途待确认）';
    form.querySelector('[data-time-label]').textContent=role==='start'?'开始时间（可选，设备本地时间）':role==='deadline'?'截止时间（可选，设备本地时间）':'时间（用途待确认，设备本地时间）';
  }
  function reminderFields(minutes=state.settings.reminderDefaultMinutes||0){return `<label class="field">任务提醒<select name="reminderMinutes">${[0,5,15,30,60].map(m=>`<option value="${m}" ${m===minutes?'selected':''}>${m?'提前 '+m+' 分钟':'不提醒'}</option>`).join('')}</select></label><p class="reminder-help">须填写日期、具体时间及用途，按设备本地时区提醒；完成或删除任务会取消未触发提醒。</p>`;}
  function tasks(){const list=state.tasks.filter(t=>taskFilter==='all'||(taskFilter==='done'?t.done:!t.done));return heading('ONE THING AT A TIME','任务清单','把大事拆成小步，每完成一项，都向前一点。',button('新建任务','new-task','plus',true))+`<div class="toolbar"><div class="filter-group">${[['active','待完成'],['done','已完成'],['all','全部任务']].map(([id,l])=>`<button class="filter-button ${taskFilter===id?'active':''}" data-task-filter="${id}">${l} <span>${id==='active'?activeTasks().length:id==='done'?state.tasks.length-activeTasks().length:state.tasks.length}</span></button>`).join('')}</div><span class="date-chip">${icon('check')} 已完成 ${state.tasks.length-activeTasks().length} / ${state.tasks.length}</span></div><section class="card task-list"><div class="card-head"><h2>${taskFilter==='done'?'已经完成，很棒的一步':'给重要的事，留出时间'}</h2><span class="tag gray">按日期排序 · 未设日期置后</span></div>${list.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')).map(taskRow).join('')||empty('这里暂时没有任务',taskFilter==='done'?'完成一项任务后，会出现在这里。':'添加第一条任务，开始安排自己的节奏。',button('新建任务','new-task','plus',true))}</section>`;}
  function settings(){const isAndroid=window.Capacitor?.isNativePlatform?.()&&window.Capacitor.getPlatform?.()==='android';return heading('YOUR SPACE, YOUR PACE','偏好设置','通知、AI、提醒与个人信息。')+`<div class="settings-grid"><section class="card settings-section"><h2>我的 UniFlow</h2><div class="setting-row"><div><h3>昵称：<span data-profile-name>${esc(profile.nickname)}</span></h3></div>${button('修改昵称','edit-nickname','settings')}</div><div class="setting-row"><div><h3>使用帮助</h3></div><div class="component-row">${button('完整使用教程','open-help','book')}${button('重新查看首次引导','replay-tutorial','undo')}</div></div></section><section class="card settings-section" id="reminder-settings"></section><section class="card settings-section" id="notification-settings-links"><h2>通知与收件箱</h2><div class="setting-row"><div><h3>通知访问与来源</h3></div>${button('管理通知捕获','focus-capture-settings','bell')}</div><div class="setting-row"><div><h3>收件箱</h3></div><button class="button" type="button" data-view="inbox">${icon('inbox')}打开收件箱</button></div></section><section class="card settings-section"><h2>本地数据</h2><div class="component-row">${isAndroid?'':button('导出数据','export-data','download')}${button('重置数据','reset','undo')}</div></section><section class="card settings-section"><h2>关于 UniFlow</h2><p>UniFlow · V1.2.4</p></section></div>`;}

  function openModal(title,body,actions=''){const m=$('#modal');$('#modal-content').innerHTML=`<div class="modal-head"><h2>${title}</h2><button class="icon-button" data-action="close" aria-label="关闭弹窗">${icon('close')}</button></div>${body}${actions?`<div class="modal-actions">${actions}</div>`:''}`;if(!m.open)m.showModal();}
  function closeModal(){$('#modal').close();}
  function importModal(){openModal('把通知，变成下一步',`<div class="modal-body"><p>文字、图片或截图都可整理。图片会先在本地 OCR，再处理识别文字；AI 候选由你核对后保存。</p><label class="field">通知正文<textarea id="import-text" placeholder="粘贴通知文字，或选择图片后点击 AI 整理。">${esc(importDraft)}</textarea></label><div class="import-helper"><span>消息保存在本机；AI 使用设置中的连接方式</span></div><label class="upload-zone">${icon('upload')} 选择 TXT 文件（不超过 1 MB）<input type="file" id="text-file" accept=".txt,text/plain"></label><div class="image-import-actions"><button type="button" class="button" data-ai-action="choose-image">从相册选择图片</button><button type="button" class="button" data-ai-action="capture-image">使用相机拍照</button><input type="file" id="image-file" accept="image/jpeg,image/png,image/webp" hidden></div><div id="image-preview" class="image-preview" hidden></div><p id="ai-status" class="card-note" role="status"></p><p class="error-text" id="import-error" role="alert"></p></div>`,`${button('取消','close','close')}${button('保存到收件箱','parse','check')}<button class="button primary" data-ai-action="ai-extract">${icon('sparkles')}AI 整理</button>`);window.dispatchEvent(new Event('uniflow:import-opened'));}
  let importSaving=false;
  async function parseImport(){
    if(importSaving)return;importSaving=true;
    try{
    const image=window.UniFlowAIUI?.selectedImage();const text=$('#import-text').value.trim();if(!text&&!image?.imageId){$('#import-error').textContent='请先输入通知内容或选择图片。';return;}
    const existingId=window.UniFlowAIUI?.selectedNoticeId();
    if(existingId&&state.notices.some(n=>n.id===existingId)){
      if(!window.UniFlowApp.updateNoticeContent(existingId,text,window.UniFlowAIUI.ocrReady()?'ready':'pending'))return;
      importDraft='';reviewNotice(existingId);render();return;
    }
    importDraft=text;
    let id;try{id=Store.newId();}catch(error){reportError(error);return;}
    let n;try{if(image?.imageId)await window.UniFlowAIUI.images.retain(image.imageId);n=window.UniFlowMessages.create({id,title:text.split(/[。\n]/)[0].slice(0,36),content:text,source:'手动导入',...(image?.imageId?{imageId:image.imageId,mimeType:'image/jpeg',ocrStatus:window.UniFlowAIUI.ocrReady()?'ready':'pending'}:{})});}catch(error){$('#import-error').textContent=error.message;return;}
    if(!commit(d=>window.UniFlowMessages.append(d,n)))return;
    importDraft='';reviewNotice(n.id);render();
    }finally{importSaving=false;}
  }
  // Images and links reuse the existing message confirmation flow.
  function reviewNotice(id){
    if(!state.notices.some(item=>item.id===id))return;
    if(markNoticeRead(id))render();
    const n=state.notices.find(item=>item.id===id);
    const confirmed=n.status==='confirmed';
    const links=[...new Set((Array.isArray(n.urls)?n.urls:[n.originalUrl]).map(value=>window.UniFlowMessages?.safeUrl(value)||'').filter(Boolean))];
    const image=n.imageId?'<div id="notice-image" class="notice-image-view">正在读取原始图片…</div>':'';
    const content=n.imageId
      ? `<label class="field">识别文字（可编辑）<textarea id="notice-text" data-notice-id="${esc(n.id)}" maxlength="100000" rows="8">${esc(n.text)}</textarea></label><button type="button" class="button" data-ai-action="save-notice-text">保存文字</button>`
      : `<div class="original-text">${esc(n.text)}</div>`;
    const captured=['android_notification','windows_notification'].includes(n.source)?`<div class="review-callout"><span>${esc(noticeSource(n))}<br>当前版本 ${n.captureVersion} · 捕获时间：${esc(new Date(n.receivedAt).toLocaleString('zh-CN'))}${n.possiblyTruncated?'<br>通知内容较长，可能已截断。':''}${n.captureUpdated?'<br>通知已更新，请重新核对；原有任务不会自动改期。':''}</span></div><details class="capture-original"><summary>系统提供的原始内容</summary><div class="original-text">${esc([n.originalNotification?.title,n.originalNotification?.text,n.originalNotification?.bigText,...(n.originalNotification?.lines||[])].filter(Boolean).join('\n\n'))}</div></details>`:'';
    const history=(n.captureHistory||[]).length?`<details class="capture-history"><summary>通知历史（${n.captureHistory.length} 个旧版本）</summary><p class="card-note">同一系统通知叠放更新时保留最近 10 个旧版本、最多 16000 字符；不是完整聊天记录。仅点击某版 AI 整理才会上传该版文字。删除消息同时删除这些历史。</p>${NoticeTime.history(n.captureHistory).map(h=>`<section><p class="card-note">版本 ${h.version} · ${esc(NoticeTime.label(h))}</p><h4>${esc(h.title)}</h4><div class="original-text">${esc(h.content)}</div><button type="button" class="button" data-ai-action="extract-capture-history" data-notice-id="${esc(n.id)}" data-capture-version="${h.version}">${icon('sparkles')}AI 整理此版本</button></section>`).join('')}</details>`:'';
    const urlBlock=captured+history+(links.length?`<div class="notice-links"><strong>分享链接</strong>${links.map(url=>`<a class="notice-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`).join('')}</div>`:'');
    const pendingActions=confirmed?'':`<button type="button" class="button" data-ai-action="extract-notice" data-notice-id="${esc(n.id)}">${icon('sparkles')}AI 整理</button>${n.imageId?'<button type="button" class="button" data-ai-action="ocr-notice" data-notice-id="'+esc(n.id)+'">仅提取文字</button>':''}<button class="button" data-archive="${esc(n.id)}">暂不安排，归档</button><button class="button primary" data-action="confirm-notice">${icon('check')}确认加入日程</button>`;
    openModal(confirmed?'通知详情':'确认这条通知',`<div class="modal-body"><div class="detail-meta"><span class="tag">${esc(noticeSource(n))}</span><span>${esc(n.received)}</span></div><h3>${esc(n.title)}</h3>${image}${content}${urlBlock}<section id="notice-relevance" class="notice-relevance" aria-label="通知相关性"></section><p id="ai-status" class="card-note" role="status"></p><p id="content-error" class="error-text" role="alert"></p>${confirmed?'<div class="review-callout">这条通知已确认。任务清单与日历共用一条事项，修改会同步；若事项已删除，原通知仍保留。</div>':`<div class="review-callout">${icon('sparkles')}<span>核对日期、时间用途和地点后再加入日程；也可先用 AI 整理，生成待确认任务。</span></div><form id="review-form" data-id="${esc(n.id)}"><label class="field">日程 / 任务名称<input name="title" value="${esc(n.title)}" required maxlength="80"></label>${timeFields(['截止提醒','课程作业'].includes(n.category)?'deadline':'unspecified',n.date,n.time)}${reminderFields()}<label class="field">地点 / 提交渠道<input name="location" value="${esc(n.location)}" placeholder="如：教学楼 A302 或课程平台" maxlength="80"></label><p class="field">确认后创建一条事项，同时显示在任务清单与日历中。</p><button type="submit" hidden></button></form>`}</div>`,confirmed?`<button class="button danger" data-delete-notice="${esc(n.id)}">删除消息</button>${button('知道了','close','check',true)}`:`<button class="button danger" data-delete-notice="${esc(n.id)}">删除消息</button>${pendingActions}`);
    if(confirmed){
      const organize=document.createElement('button');organize.type='button';organize.className='button';
      organize.dataset.aiAction='extract-notice';organize.dataset.noticeId=n.id;
      organize.innerHTML=icon('sparkles')+'AI 整理';
      $('#modal .modal-actions').insertBefore(organize,$('#modal .modal-actions [data-action="close"]'));
    }
    paintNoticeRelevance(n);
    window.dispatchEvent(new CustomEvent('uniflow:notice-opened',{detail:n.id}));
  }
  async function confirmNotice(){
    const form=$('#review-form');if(!form||!form.reportValidity())return;
    const f=new FormData(form),n=state.notices.find(n=>n.id===form.dataset.id);if(!n)return;
    const fields={dateRole:f.get('dateRole'),title:String(f.get('title')).trim(),date:f.get('date'),time:f.get('time'),location:f.get('location')||'',type:n.category==='课程作业'?'course':'activity',priority:n.category==='截止提醒'?'high':'normal',reminderMinutes:Number(f.get('reminderMinutes')||0)};
    if(fields.dateRole==='unspecified'){reportError(new Error('请先选择时间用途：任务截止或日程开始。'));return;}
    if(form.dataset.saving)return;form.dataset.saving='true';
    try{await window.UniFlowReminderUI?.prepare(fields);}catch(error){delete form.dataset.saving;reportError(error);return;}
    delete form.dataset.saving;
    if(!form.isConnected)return;
    if(!applyChange(()=>store.confirmNotice(n.id,fields)))return;
    if(fields.date)rememberCalendarDay(fields.date);
    closeModal();render();toast('已保存事项，任务清单与日历同步更新');await window.UniFlowReminderUI?.afterSave();
  }
  function editTask(id,fromCalendar=false){
    const t=state.tasks.find(t=>t.id===id);if(id&&!t){reportError(new Error('任务已不存在，请重新加载。'));return;}
    openModal(t?'编辑事项':fromCalendar?'新建日程':'添加一个小目标',`<div class="modal-body"><form id="task-form" data-id="${esc(id||'')}"><label class="field">任务名称<input name="title" required maxlength="80" placeholder="你想完成什么？" value="${esc(t?.title||'')}"></label>${timeFields(t?.dateRole??(fromCalendar?'start':'deadline'),t?t.date:(fromCalendar?calendarDay:''),t?.time??'')}${reminderFields(t?t.reminderMinutes||0:undefined)}<div class="field-grid"><label class="field">优先级<select name="priority"><option value="normal" ${t?.priority!=='high'?'selected':''}>普通</option><option value="high" ${t?.priority==='high'?'selected':''}>优先处理</option></select></label><label class="field">事项类型<select name="type">${[['course','课程与作业'],['activity','校园活动'],['personal','个人安排']].map(([v,l])=>`<option value="${v}" ${(t?.type||'personal')===v?'selected':''}>${l}</option>`).join('')}</select></label></div><label class="field">地点 / 提交渠道<input name="location" maxlength="80" value="${esc(t?.location||'')}" placeholder="可选"></label><label class="field task-done-field"><input type="checkbox" name="done" ${t?.done?'checked':''}>已完成</label><p class="field">无日期的任务仅保留在待办列表。截止事项显示在日期上方，日程开始显示在时间轴。</p><button type="submit" hidden></button></form></div>`,`${t?`<button class="button danger" data-delete-task="${esc(t.id)}">删除事项</button>`:''}${button('取消','close','close')}${button('保存事项','save-task','check',true)}`);
  }
  async function saveTask(){
    const form=$('#task-form');if(!form||!form.reportValidity())return;
    const f=new FormData(form),id=form.dataset.id;
    const fields={dateRole:f.get('dateRole'),title:String(f.get('title')).trim(),date:f.get('date'),time:f.get('time')||'',location:f.get('location')||'',priority:f.get('priority'),type:f.get('type'),done:f.get('done')==='on',reminderMinutes:Number(f.get('reminderMinutes')||0)};
    if(form.dataset.saving)return;form.dataset.saving='true';
    try{await window.UniFlowReminderUI?.prepare(fields);}catch(error){delete form.dataset.saving;reportError(error);return;}
    delete form.dataset.saving;
    if(!form.isConnected)return;
    if(!applyChange(()=>id?store.updateTask(id,fields):store.addTask(fields)))return;
    if(fields.date)rememberCalendarDay(fields.date);
    closeModal();render();toast('事项已保存，任务清单与日历已同步');await window.UniFlowReminderUI?.afterSave();
  }
  function requestDelete(id){
    const t=state.tasks.find(t=>t.id===id);if(!t)return;
    openModal('删除这条事项？',`<div class="modal-body"><p>「${esc(t.title)}」将从任务清单和日历同时删除。原始通知仍会保留。</p></div>`,`<button class="button" data-edit-task="${esc(id)}">取消</button><button class="button danger" data-confirm-delete="${esc(id)}">确认删除</button>`);
  }
  function deleteTask(id){if(!applyChange(()=>store.removeTask(id)))return;closeModal();render();toast('事项已从任务清单和日历删除');}
  function editEvent(id){editTask(id,true);}
  function saveEvent(){saveTask();}
  function search(){openModal('搜索你的校园空间',`<div class="search-large">${icon('search')}<input id="global-search" placeholder="输入通知或任务关键词…" aria-label="全局搜索" autocomplete="off"></div><div class="modal-body search-results" id="global-results"><p>输入关键词，快速找到通知和任务。</p></div>`);$('#global-search').focus();}
  function globalResults(q){const el=$('#global-results');if(!q.trim()){el.innerHTML='<p>输入关键词，快速找到通知和任务。</p>';return;}const ns=NoticeTime.sorted(state.notices).filter(n=>(n.title+n.text).toLowerCase().includes(q.toLowerCase()));const ts=state.tasks.filter(t=>t.title.toLowerCase().includes(q.toLowerCase()));el.innerHTML=ns.map(noticeRow).join('')+ts.map(t=>`<button class="notice-row" data-edit-task="${esc(t.id)}"><span class="source-icon">${icon('tasks')}</span><span class="notice-body"><span class="notice-title">${esc(t.title)}</span><p>任务 · ${dateLabel(t.date)}</p></span>${icon('chevron')}</button>`).join('')||'<p>没有找到匹配结果，试试更短的关键词。</p>';}
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportCalendar(){
    try{download('UniFlow-calendar.ics',Store.exportICS(store.snapshot()),'text/calendar;charset=utf-8');toast('已导出：截止任务为待办，日程开始为事件');}catch(error){reportError(error);}
  }
  function exportData(){try{download('UniFlow-data.json',JSON.stringify(store.snapshot(),null,2),'application/json');toast('已导出本地数据');}catch(error){reportError(error);}}
  const actions={import:importModal,close:closeModal,parse:parseImport,'confirm-notice':confirmNotice,'new-task':()=>editTask(),'save-task':saveTask,'new-event':()=>editEvent(),'save-event':saveEvent,search,'reload-data':()=>location.reload(),'this-week':()=>selectCalendarDay(BASE),'export-data':exportData,'export-calendar':exportCalendar,reset:()=>openModal('重置本地数据？','<div class="modal-body"><p>本机的通知、日程、任务和偏好会被清空并恢复初始状态；昵称与教程记录不受影响。请先确认不再需要这些数据。</p></div>',`${button('取消','close','close')}<button class="button danger" data-action="confirm-reset">确认重置</button>`),'confirm-reset':()=>{if(!applyChange(()=>store.reset()))return;inboxFilter='all';noticeQuery='';rememberCalendarDay(BASE);overviewDay=BASE;closeModal();render();toast('已恢复初始状态');}};
  document.addEventListener('click',e=>{const b=e.target.closest('button,[data-action]');if(!b)return;const d=b.dataset;if('attentionAll' in d){inboxFilter='relevant';noticeQuery='';navigate('inbox');return;}if(d.attentionRead){if(markNoticeRead(d.attentionRead))render();return;}if(d.attentionIgnore){setNoticeAttention(d.attentionIgnore,'ordinary');return;}if(d.attentionRelevant){setNoticeAttention(d.attentionRelevant,'relevant');return;}if(d.deleteNotice){const imageId=state.notices.find(n=>n.id===d.deleteNotice)?.imageId;if(!commit(s=>{s.notices=s.notices.filter(n=>n.id!==d.deleteNotice);}))return;if(imageId&&!state.notices.some(n=>n.imageId===imageId))window.UniFlowAIUI?.images.release(imageId).catch(()=>toast('消息已删除，图片缓存暂未释放。'));closeModal();render();toast('消息已删除，已创建的任务仍保留。');return;}if(d.view){navigate(d.view);return;}if(d.action&&actions[d.action]){actions[d.action]();return;}if(d.notice){reviewNotice(d.notice);return;}if(d.inboxFilter){inboxFilter=d.inboxFilter;render();return;}if(d.overviewFilter){inboxFilter=d.overviewFilter;render();return;}if(d.taskFilter){taskFilter=d.taskFilter;render();return;}if(d.taskToggle){const t=state.tasks.find(t=>t.id===d.taskToggle);if(!t)return;const done=!t.done;if(!applyChange(()=>store.updateTask(t.id,{done})))return;render();toast(done?'又完成了一步，做得不错':'任务已恢复为待完成');return;}if(d.deleteTask){requestDelete(d.deleteTask);return;}if(d.confirmDelete){deleteTask(d.confirmDelete);return;}if(d.editTask){editTask(d.editTask);return;}if(d.event){editEvent(d.event);return;}if(d.day){overviewDay=d.day;render();return;}if(d.calendarDay){selectCalendarDay(d.calendarDay);return;}if(d.week){selectCalendarDay(dateAdd(calendarDay,Number(d.week)*7));return;}if(d.setting){if(!commit(s=>{s.settings[d.setting]=!s.settings[d.setting];}))return;render();toast('偏好已保存');return;}if(d.archive){if(!commit(s=>{s.notices.find(n=>n.id===d.archive).status='archived';}))return;closeModal();render();toast('通知已归档');}});
  document.addEventListener('input',e=>{if(e.target.id==='notice-search'){noticeQuery=e.target.value;$('#notice-results').innerHTML=filteredNotices();}if(e.target.id==='global-search')globalResults(e.target.value);});
  document.addEventListener('submit',e=>{e.preventDefault();if(e.target.id==='review-form')confirmNotice();if(e.target.id==='task-form')saveTask();if(e.target.id==='event-form')saveEvent();});
  document.addEventListener('change',async e=>{if(e.target.id==='calendar-jump'){if(e.target.value)selectCalendarDay(e.target.value);return;}if(e.target.name==='dateRole'){refreshTimeLabels(e.target.form);return;}if(e.target.id!=='text-file')return;const f=e.target.files[0];if(!f)return;if(f.size>1024*1024){$('#import-error').textContent='文件超过 1 MB，请选一个更小的文本文件。';return;}if(!f.name.toLowerCase().endsWith('.txt')){$('#import-error').textContent='请选择 TXT 文本文件。';return;}try{$('#import-text').value=await f.text();$('#import-error').textContent='';}catch{$('#import-error').textContent='未能读取文件，请重试或直接粘贴正文。';}});
  document.addEventListener('keydown',e=>{if(window.UniFlowOnboarding?.isActive())return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();search();}});
  $('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
  window.addEventListener('storage',event=>{if(event.key===Store.KEY||event.key===null)reportError(new Error('本地数据已在另一个窗口更改，请重新加载以使用最新记录。'));});
  render();
  if(startupError)reportError(startupError);
})();

