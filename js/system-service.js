/* Device-local time and lifecycle. Task dates remain literal YYYY-MM-DD values. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniFlowSystem=api;})(globalThis,function(){
  'use strict';
  const pad=n=>String(n).padStart(2,'0');
  function snapshot(now=new Date()) {
    const hour=now.getHours();
    return {day:`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,hour,
      greeting:hour>=5&&hour<11?'早上好':hour<14&&hour>=11?'中午好':hour>=14&&hour<18?'下午好':hour>=18&&hour<23?'晚上好':'夜深了',
      dateLabel:`${now.getFullYear()} 年 ${now.getMonth()+1} 月 ${now.getDate()} 日 星期${'日一二三四五六'[now.getDay()]}`};
  }
  function todayTasks(tasks,day) {return tasks.filter(task=>!task.done&&task.date===day).length;}
  function start(callback,{document:doc=globalThis.document,window:win=globalThis.window,capacitor=globalThis.Capacitor}={}) {
    let disposed=false,listener;
    const refresh=()=>{if(!disposed&&doc.visibilityState!=='hidden')callback(snapshot());};
    doc.addEventListener('visibilitychange',refresh);win.addEventListener('focus',refresh);win.addEventListener('pageshow',refresh);
    const timer=setInterval(refresh,30000);
    const app=capacitor?.isNativePlatform()?capacitor.registerPlugin('App'):null;
    if(app?.addListener)app.addListener('appStateChange',({isActive})=>{if(isActive)refresh();}).then(handle=>{if(disposed)handle.remove();else listener=handle;}).catch(()=>{/* Browser lifecycle remains available. */});
    refresh();
    return ()=>{disposed=true;clearInterval(timer);listener?.remove();doc.removeEventListener('visibilitychange',refresh);win.removeEventListener('focus',refresh);win.removeEventListener('pageshow',refresh);};
  }
  return {snapshot,todayTasks,start};
});
