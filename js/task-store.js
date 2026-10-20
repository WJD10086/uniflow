/* UniFlow storage v3. Browser script and dependency-free Node test module. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UniFlowStore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const KEY = 'uniflow.data.v3';
  const LEGACY_KEY = 'uniflow.design.v1';
  const VERSION = 3;
  const clone = value => JSON.parse(JSON.stringify(value));
  class StoreError extends Error {
    constructor(code, message) { super(message); this.name = 'StoreError'; this.code = code; }
  }
  const fail = (code, message) => { throw new StoreError(code, message); };
  function validDate(value) {
    if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
    const [y,m,d] = value.split('-').map(Number), date = new Date(Date.UTC(y,m-1,d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d;
  }
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  function dateAdd(value, days) {
    if (!validDate(value)) fail('VALIDATION', '日期必须是有效的 YYYY-MM-DD。');
    const [y,m,d] = value.split('-').map(Number), date = new Date(Date.UTC(y,m-1,d + days));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
  }
  function monday(value) {
    const [y,m,d] = value.split('-').map(Number), weekday = new Date(Date.UTC(y,m-1,d)).getUTCDay();
    return dateAdd(value, -((weekday+6)%7));
  }
  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const get = type => parts.find(p=>p.type===type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function newId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (!globalThis.crypto?.getRandomValues) fail('ID', '浏览器不支持安全 ID 生成，请使用新版浏览器。');
    const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]&15)|64; b[8] = (b[8]&63)|128;
    const h = [...b].map(v=>v.toString(16).padStart(2,'0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  function validate(data) {
    if (!data || data.schemaVersion !== VERSION || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.tasks) || !Array.isArray(data.notices) || !data.settings || typeof data.settings !== 'object') fail('FORMAT', '本地数据格式不受支持，原记录已保留，请勿重置。');
    const ids = new Set();
    for (const t of data.tasks) {
      if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id)) fail('FORMAT', '任务 ID 缺失或重复，原记录已保留。');
      ids.add(t.id);
      if (typeof t.title !== 'string' || !t.title.trim() || typeof t.done !== 'boolean' || !['high','normal'].includes(t.priority) || !['course','activity','personal'].includes(t.type)) fail('VALIDATION', '任务名称、状态或类型无效。');
      if (t.date !== '' && !validDate(t.date)) fail('VALIDATION', '任务日期必须是有效的 YYYY-MM-DD，不能使用时间戳。');
      if (t.time !== '' && !validTime(t.time)) fail('VALIDATION', '任务时间必须是 HH:mm（00:00–23:59）。');
      if (t.time && !t.date) fail('VALIDATION', '填写时间时也需要填写日期。');
      if (!['deadline','start','unspecified'].includes(t.dateRole)) fail('VALIDATION', '请选择时间用途：任务截止或日程开始。');
      if(t.reminderMinutes!==undefined&&![0,5,15,30,60].includes(t.reminderMinutes))fail('VALIDATION','提醒提前时间无效。');
      if (typeof t.location !== 'string' || typeof t.source !== 'string') fail('VALIDATION', '任务地点或来源格式无效。');
    }
    const noticeIds = new Set();
    for (const n of data.notices) {
      if (!n || typeof n.id !== 'string' || !n.id || noticeIds.has(n.id) || typeof n.title !== 'string' || typeof n.text !== 'string' || !['pending','confirmed','archived'].includes(n.status)) fail('FORMAT', '通知数据格式无效，原记录已保留。');
      noticeIds.add(n.id);
    }
    return data;
  }
  function migrate(raw, currentDay) {
    if (raw?.schemaVersion === VERSION) {
      const data=clone(raw);
      // v3 originally used one ambiguous date/time pair. Preserve it without
      // guessing from the title, category, UUID or presence of a time.
      if(Array.isArray(data.tasks))data.tasks=data.tasks.map(t=>({...t,dateRole:t.dateRole??'unspecified'}));
      return validate(data);
    }
    if (!raw || raw.schemaVersion !== undefined || !Array.isArray(raw.tasks) || !Array.isArray(raw.events) || !Array.isArray(raw.notices)) fail('FORMAT', '无法识别旧数据格式，原记录已保留。');
    const tasks = raw.tasks.map(t=>({...t,date:t.date??'',time:t.time??'',dateRole:'deadline',location:t.location??'',type:t.type??'personal',source:t.source??'个人任务'}));
    const used = new Set(tasks.map(t=>t.id));
    const events = raw.events;
    for (const e of events) {
      const matches = e.noticeId ? tasks.filter(t=>t.noticeId===e.noticeId) : [];
      const relatedEvents = e.noticeId ? events.filter(v=>v.noticeId===e.noticeId) : [];
      const t = matches[0];
      // Only merge a one-to-one notice pair with compatible scheduling fields.
      // Ambiguous/divergent entries remain separate; the v1 source is never removed.
      if (matches.length===1 && relatedEvents.length===1 && t.date===e.date && (!t.time || t.time===e.time) && (!t.location || t.location===e.location)) {
        t.time = e.time??''; t.location = e.location??''; t.type = e.type??'personal';
        t.legacyEvent = clone(e); // Retain the original event's title/metadata for traceability.
      } else {
        if (typeof e.id !== 'string' || !e.id) fail('FORMAT', '旧日程缺少 ID，原记录已保留。');
        let id=e.id; while (used.has(id)) id='legacy-event:'+id; used.add(id);
        tasks.push({...e,id,date:e.date??'',time:e.time??'',dateRole:'start',location:e.location??'',type:e.type??'personal',priority:'normal',done:false,source:e.source??'原有日程'});
      }
    }
    return validate({schemaVersion:VERSION,revision:0,tasks,notices:clone(raw.notices),settings:{reminders:true,...raw.settings},selectedDay:validDate(raw.selectedDay)?raw.selectedDay:currentDay});
  }
  function createStore(options = {}) {
    const getStorage = options.storage ? ()=>options.storage : ()=>globalThis.localStorage;
    const currentDay = options.today || today();
    const clock = options.now || (()=>new Date().toISOString());
    const idFactory = options.idFactory || newId;
    let state, expectedRaw, expectedLegacy, loaded=false;
    function read(key) {
      try { return getStorage().getItem(key); }
      catch { fail('READ', '无法读取本地存储。请检查浏览器存储权限后重新加载；原数据不会被覆盖。'); }
    }
    function load() {
      loaded=false;
      const raw=read(KEY), legacy=raw===null?read(LEGACY_KEY):null;
      let candidate;
      try { candidate=raw!==null?JSON.parse(raw):legacy!==null?JSON.parse(legacy):clone(options.seed); }
      catch { fail('CORRUPT', '本地数据无法解析，已停止写入以保护原记录。请保留原始数据并恢复备份。'); }
      // A v3 key must contain a v3 envelope; never silently downgrade it to seed/v1.
      if (raw!==null && candidate?.schemaVersion!==VERSION) fail('VERSION', '本地数据版本不受支持，请使用匹配版本的应用。');
      state=migrate(candidate,currentDay); expectedRaw=raw; expectedLegacy=legacy; loaded=true;
      return clone(state);
    }
    function snapshot() { if(!loaded)fail('READ','数据尚未成功加载，不能继续操作。'); return clone(state); }
    function transact(change) {
      if (!loaded) fail('READ','数据尚未成功加载，不能保存。请先重新加载。');
      // Optimistic conflict check prevents a stale tab from overwriting newer data.
      if(read(KEY)!==expectedRaw || (expectedRaw===null && read(LEGACY_KEY)!==expectedLegacy)) fail('CONFLICT','另一个窗口已更新数据。本次操作未保存，请重新加载后再试。');
      const draft=clone(state); change(draft); draft.revision=state.revision+1; validate(draft);
      const serialized=JSON.stringify(draft);
      try { getStorage().setItem(KEY,serialized); }
      catch { fail('WRITE','保存失败：本地存储不可用或空间不足。本次修改未生效，请保留输入并重试。'); }
      // Publish only after the storage write succeeds; failures leave memory unchanged.
      state=draft; expectedRaw=serialized; expectedLegacy=null;
      return clone(state);
    }
    function makeTask(fields, draft) {
      let id; for(let i=0;i<10;i++){id=idFactory();if(!draft.tasks.some(t=>t.id===id))break;id=null;}
      if(!id)fail('ID','无法生成唯一任务 ID，请重试。');
      const stamp=clock();
      return {...fields,id,title:String(fields.title??'').trim(),date:fields.date??'',time:fields.time??'',dateRole:fields.dateRole??'deadline',location:fields.location??'',type:fields.type??'personal',priority:fields.priority??'normal',done:fields.done??false,source:fields.source??'个人任务',createdAt:stamp,updatedAt:stamp};
    }
    function addTask(fields) { return transact(d=>d.tasks.push(makeTask(fields,d))); }
    function addTasks(fieldsList) {
      if (!Array.isArray(fieldsList) || !fieldsList.length || fieldsList.length > 20) fail('VALIDATION','一次最多确认 20 项任务。');
      return transact(d=>fieldsList.forEach(fields=>d.tasks.push(makeTask(fields,d))));
    }
    function updateTask(id,fields) {return transact(d=>{const t=d.tasks.find(t=>t.id===id);if(!t)fail('MISSING','任务已不存在，请重新加载。');const {id:ignored,createdAt,...patch}=fields;Object.assign(t,patch,{updatedAt:clock()});if(typeof t.title==='string')t.title=t.title.trim();});}
    function removeTask(id) {return transact(d=>{const index=d.tasks.findIndex(t=>t.id===id);if(index<0)fail('MISSING','任务已不存在，请重新加载。');d.tasks.splice(index,1);});}
    function confirmNotice(id,fields) {return transact(d=>{const n=d.notices.find(n=>n.id===id);if(!n)fail('MISSING','通知已不存在。');if(n.status==='confirmed')fail('DUPLICATE','这条通知已经创建任务，请勿重复添加。');const t=makeTask({...fields,noticeId:id,source:n.source??'导入通知'},d);d.tasks.push(t);Object.assign(n,{status:'confirmed',taskId:t.id,date:t.date,time:t.time,location:t.location,title:t.title});});}
    function reset() {return transact(d=>{const fresh=migrate(clone(options.seed),currentDay);Object.assign(d,fresh);});}
    return {load,snapshot,transact,addTask,addTasks,updateTask,removeTask,confirmNotice,reset};
  }
  function calendarTasks(state) { return state.tasks.filter(t=>t.date).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.id.localeCompare(b.id)); }
  function tasksForDate(state,date) { return calendarTasks(state).filter(t=>t.date===date); }
  function weekDates(date) {const start=monday(date);return Array.from({length:7},(_,i)=>dateAdd(start,i));}
  function timeLabel(task) {
    if(!task.date)return task.dateRole==='start'?'未安排日期':'无截止日期';
    const label={deadline:'截止',start:'开始',unspecified:'时间用途待确认'}[task.dateRole]||'时间用途待确认';
    return task.time?`${label} ${task.time}`:task.dateRole==='deadline'?'当日截止':task.dateRole==='start'?'当天日程（未设时间）':label;
  }
  function exportICS(state,now=new Date()) {
    const escape=s=>String(s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
    const stamp=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z/,'Z');
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//UniFlow//Local Tasks//ZH','CALSCALE:GREGORIAN'];
    state.tasks.forEach(t=>{
      const start=t.dateRole==='start'&&t.date,component=start?'VEVENT':'VTODO';
      lines.push(`BEGIN:${component}`,`UID:${t.id}@uniflow.local`,`DTSTAMP:${stamp(now)}`);
      if(t.date){
        const value=t.time?stamp(new Date(t.date+'T'+t.time+':00+08:00')):t.date.replaceAll('-','');
        if(t.dateRole==='start'||t.dateRole==='deadline'){
          lines.push(`${start?'DTSTART':'DUE'}${t.time?'':';VALUE=DATE'}:${value}`);
          if(start&&!t.time)lines.push(`DTEND;VALUE=DATE:${dateAdd(t.date,1).replaceAll('-','')}`);
        }else{
          lines.push(`X-UNIFLOW-UNCLASSIFIED-DATE:${t.date}`,`X-UNIFLOW-UNCLASSIFIED-TIME:${t.time}`);
        }
      }
      if(component==='VTODO')lines.push(`STATUS:${t.done?'COMPLETED':'NEEDS-ACTION'}`);
      lines.push(`SUMMARY:${escape(t.title)}`,`LOCATION:${escape(t.location)}`,`END:${component}`);
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n')+'\r\n';
  }
  return {KEY,LEGACY_KEY,VERSION,StoreError,validDate,validTime,dateAdd,monday,today,newId,migrate,createStore,calendarTasks,tasksForDate,weekDates,timeLabel,exportICS};
});
