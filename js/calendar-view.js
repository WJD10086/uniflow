/* A projection of the existing tasks store. No calendar records are persisted. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./task-store.js'));
  else root.UniFlowCalendar=factory(root.UniFlowStore);
})(typeof globalThis==='object'?globalThis:this,function(Store){
  'use strict';
  function render(state,selection,ui){
    const {esc,icon,heading,button,taskRow}=ui;
    const isAndroid=globalThis.Capacitor?.isNativePlatform?.()&&globalThis.Capacitor.getPlatform?.()==='android';
    const days=Store.weekDates(selection.day),start=days[0];
    const entries=Store.calendarTasks(state).filter(t=>days.includes(t.date));
    // Only explicit schedule starts belong on the time grid. A due time is
    // a deadline marker, not the start of an invented event duration.
    const timed=entries.filter(t=>t.dateRole==='start'&&t.time);
    const minHour=timed.reduce((min,t)=>Math.min(min,Math.floor(Number(t.time.slice(0,2))/2)*2),8);
    const calHeight=(24-minHour)*30+60;
    function dayEvents(day){
      const list=timed.filter(t=>t.date===day).map(t=>({task:t,top:((Number(t.time.slice(0,2))-minHour)*60+Number(t.time.slice(3)))/2}));
      const groups=[];
      for(const item of list){
        let g=groups[groups.length-1];
        if(!g||item.top>=g.end){g={end:0,items:[],lanes:[]};groups.push(g);}
        let lane=g.lanes.findIndex(end=>end<=item.top);if(lane<0)lane=g.lanes.length;
        g.lanes[lane]=item.top+60;g.end=Math.max(g.end,item.top+60);g.items.push({...item,lane});
      }
      return groups.flatMap(g=>g.items.map(({task:t,top,lane})=>`<button class="calendar-event ${t.type==='activity'?'mint':t.type==='personal'?'lilac':''} ${t.done?'is-complete':''}" style="top:${top}px;left:calc(${lane*100/g.lanes.length}% + 3px);width:calc(${100/g.lanes.length}% - 6px);right:auto" data-edit-task="${esc(t.id)}" aria-label="${esc(Store.timeLabel(t)+' '+t.title)}"><strong>${esc(t.title)}</strong><small>${esc(Store.timeLabel(t))}</small></button>`)).join('');
    }
    const dayTasks=Store.tasksForDate(state,selection.day);
    const undated=state.tasks.filter(t=>!t.date).length;
    return heading('MAKE SPACE FOR WHAT MATTERS','我的日程','任务和日程同步管理。',`${isAndroid?'':button('导出日历','export-calendar','download',false,'secondary-action')}${button('新建日程','new-event','plus',true)}`)+`
      <div class="toolbar calendar-toolbar"><div class="week-controls">
        <button class="icon-button" data-week="-1" aria-label="上一周"><span style="transform:rotate(180deg)">${icon('chevron')}</span></button>
        <span class="week-title">${start} — ${days[6]}</span>
        <button class="icon-button" data-week="1" aria-label="下一周">${icon('chevron')}</button>
        <button class="filter-button" data-action="this-week">本周</button></div>
        <label class="calendar-jump">跳转日期<input type="date" id="calendar-jump" value="${selection.day}" min="1000-01-01" max="9998-12-31"></label>
        <span class="tag">周视图 · 北京时间</span></div>
      <section class="card task-list calendar-day-tasks" aria-label="当天任务"><div class="card-head"><div><h2>${selection.day} · 当天任务</h2><p class="card-note">${dayTasks.length} 项 · 点击任务可编辑或删除</p></div></div>${dayTasks.length?dayTasks.map(taskRow).join(''):'<div class="empty-state"><p>这一天没有任务或日程。</p></div>'}</section>
      <section class="card"><div class="calendar-scroll"><div class="calendar-board">
        <div class="calendar-day-head">GMT+8</div>
        ${days.map((d,i)=>`<button class="calendar-day-head ${d===Store.today()?'today':''} ${d===selection.day?'selected':''}" data-calendar-day="${d}" aria-label="查看 ${d} 的任务" aria-pressed="${d===selection.day}">周${'一二三四五六日'[i]}<strong>${Number(d.slice(8))}</strong><small>${Store.tasksForDate(state,d).length} 项</small></button>`).join('')}
        <div class="all-day-label">截止 /<br>当日事项</div>
        ${days.map(d=>`<div class="calendar-all-day">${entries.filter(t=>t.date===d&&!(t.dateRole==='start'&&t.time)).map(t=>`<button class="all-day-task ${t.dateRole==='deadline'?'deadline-task':''} ${t.done?'completed':''}" data-edit-task="${esc(t.id)}" aria-label="${esc(Store.timeLabel(t)+' '+t.title)}"><strong>${esc(t.title)}</strong><small>${esc(Store.timeLabel(t))}</small></button>`).join('')||'<span class="all-day-empty">—</span>'}</div>`).join('')}
        <div class="calendar-time" style="height:${calHeight}px">${Array.from({length:(24-minHour)/2+1},(_,i)=>minHour+i*2).map(h=>`<span style="top:${(h-minHour)*30}px">${h}:00</span>`).join('')}</div>
        ${days.map(d=>`<div class="calendar-column" style="height:${calHeight}px">${dayEvents(d)}</div>`).join('')}
      </div></div><div class="calendar-legend"><span>截止时间显示在上方事项区；时间轴仅显示日程开始</span><span>时间卡片的高度不代表持续时长</span></div></section>
      ${undated?`<div class="local-note">${icon('tasks')}<span>${undated} 项未设置日期，保留在任务清单中。</span><button class="text-button" data-view="tasks">查看任务清单</button></div>`:''}`;
  }
  return {render};
});
