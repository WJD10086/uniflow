/* Homepage adapter: reads the existing state via a getter; owns no task records. */
(function(){
  'use strict';
  const System=window.UniFlowSystem,Weather=window.UniFlowWeather;
  const weather=Weather.create(),esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let result={data:weather.snapshot().cache,stale:true,error:''},busy=false,locating=false,requestId=0,searchId=0,choiceRevision=0,cities=[];
  const dialog=document.createElement('dialog');dialog.id='weather-dialog';dialog.setAttribute('aria-labelledby','weather-dialog-title');document.body.append(dialog);
  const svg=kind=>{
    const paths={sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',cloud:'<path d="M6 18a5 5 0 1 1 1-9 6 6 0 0 1 11-1 5 5 0 1 1 0 10Z"/>',rain:'<path d="M6 15a4 4 0 1 1 1-8 5 5 0 0 1 10 0 4 4 0 1 1 1 8M7 18l-1 3m7-3-1 3m7-3-1 3"/>',snow:'<path d="M6 14a4 4 0 1 1 1-8 5 5 0 0 1 10 0 4 4 0 1 1 1 8M7 18v4m-2-2h4m8-2v4m-2-2h4"/>'};
    return `<svg class="weather-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]||paths.cloud}</svg>`;
  };
  function hint(){
    if(!result.data||result.stale||navigator.onLine===false)return '把重要的事安排好，也给自己留一点从容。';
    const {code,temperature,precipitation}=result.data;
    if(Weather.condition(code).icon==='rain'||(precipitation!==null&&precipitation>=60))return '天气有雨或降雨可能较高，出门记得带伞。';
    if(temperature>=32)return '天气较热，出门注意补水。';
    if(temperature<=5)return '天气较冷，出门记得添衣。';
    return '按自己的节奏，把今天安排好。';
  }
  function updateGreeting(){
    const context=window.UniFlowHomeContext(),time=System.snapshot();
    const title=document.querySelector('[data-home-greeting]');
    if(title)title.textContent=`${time.greeting}，${context.nickname||'新朋友'}！`;
    const subtitle=document.querySelector('[data-home-hint]');
    if(subtitle)subtitle.textContent=`今天有 ${System.todayTasks(context.tasks,time.day)} 项待办。${hint()}`;
    document.querySelectorAll('[data-home-date]').forEach(date=>{date.textContent=time.dateLabel;});
  }
  function paint(){
    updateGreeting();const host=document.getElementById('home-weather');if(!host)return;
    const prefs=weather.snapshot(),data=result.data,condition=data?Weather.condition(data.code):null,stale=result.stale||navigator.onLine===false;
    host.innerHTML=`<div class="weather-head"><h2>${esc(prefs.city?.name||'我的天气')}</h2><button class="text-button" data-weather="choose">${prefs.city?'更换城市':'选择城市'}</button></div>`+
      (data?`<div class="weather-now">${svg(condition.icon)}<strong>${Math.round(data.temperature)}<small>°C</small></strong><span>${esc(condition.text)}<small>体感 ${Math.round(data.apparent)}°C</small></span></div><p class="weather-detail">${data.precipitation===null?'':`本小时降水概率 ${data.precipitation}% · `}${stale?'缓存天气':'最近天气'}</p><p class="weather-detail">数据时间 ${esc(new Date(data.dataAt).toLocaleString())}<br>最近获取 ${esc(new Date(data.fetchedAt).toLocaleString())}</p>`:
        `<div class="weather-empty">${svg('cloud')}<p>${prefs.city?'天气暂不可用':'选择城市，查看真实天气'}<small>${prefs.city?'可稍后重试，其他功能正常使用。':'无需定位权限，也无需注册。'}</small></p></div>`)+
      `<p class="weather-status" role="status">${esc(busy?'正在获取天气…':navigator.onLine===false&&data?'网络不可用，显示最近缓存。':result.error||(stale&&data?'当前显示缓存；刷新后可查看最新天气。':''))}</p><div class="weather-actions"><button class="text-button" data-weather="locate" ${locating?'disabled':''}>${locating?'定位中…':'使用当前位置'}</button>${prefs.city?'<button class="text-button" data-weather="refresh">刷新天气</button>':''}${prefs.mode==='auto'?'<button class="text-button" data-weather="disable">关闭自动定位</button>':''}</div><p class="weather-credit">天气：Open-Meteo · 城市：GeoNames<br>仅主动定位时读取大致位置并发送至天气服务；不记录轨迹。${prefs.mode==='auto'?'位置按需更新。':'手动选城无需定位。'}</p>`;
  }
  async function refresh(){
    const id=++requestId;busy=!!weather.snapshot().city;paint();
    const next=await weather.weather();if(id!==requestId||next.superseded)return;
    result=next;busy=false;paint();
  }
  function showChooser(){
    dialog.innerHTML=`<div class="modal-head"><div><h2 id="weather-dialog-title">选择天气城市</h2><p>城市与天气偏好单独保存在本机</p></div><button class="icon-button" data-weather="close" aria-label="关闭城市选择">${window.ufIcon('close')}</button></div><div class="modal-body"><form id="weather-search-form"><label for="weather-city-query">城市名称</label><div class="weather-search"><input id="weather-city-query" type="search" placeholder="例如：上海 / Shanghai" minlength="2" maxlength="80" required><button class="button primary" type="submit">搜索</button></div></form><p class="weather-status" id="weather-search-status" role="status"></p><div id="weather-city-results"></div><p class="weather-detail">“使用当前位置”只请求一次大致位置，并将近似坐标发送至天气服务；不会发送给 AI，也不记录位置历史。</p></div>`;
    dialog.showModal();
  }
  function status(message){const el=dialog.querySelector('#weather-search-status');if(el)el.textContent=message;}
  async function locate(button){
    if(locating)return;const revision=++choiceRevision;locating=true;button.disabled=true;button.textContent='定位中…';
    try{const selected=await window.UniFlowLocation.locate();if(revision!==choiceRevision)return;weather.select(selected,'auto');result={data:null,stale:false,error:''};await refresh();}
    catch(error){if(revision===choiceRevision){result={...result,error:error.message};paint();}}
    finally{locating=false;paint();}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-weather]');if(!button)return;
    const action=button.dataset.weather;
    if(action==='choose')showChooser();
    if(action==='close')dialog.close();
    if(action==='refresh')refresh();
    if(action==='locate')locate(button);
    if(action==='disable'){try{weather.disableAuto();++choiceRevision;++requestId;busy=false;result={data:null,stale:false,error:'已关闭自动定位。可以手动选择城市。'};paint();}catch(error){result={...result,error:error.message};paint();}}
    if(action==='select'){
      try{weather.select(cities[Number(button.dataset.cityIndex)]);++choiceRevision;dialog.close();result={data:weather.snapshot().cache,stale:true,error:''};refresh();}
      catch(error){status(error.message);}
    }
  });
  dialog.addEventListener('close',()=>{++searchId;cities=[];});
  dialog.addEventListener('submit',async event=>{
    if(event.target.id!=='weather-search-form')return;event.preventDefault();
    const id=++searchId;status('正在搜索…');dialog.querySelector('#weather-city-results').innerHTML='';cities=[];
    try{const found=await weather.search(dialog.querySelector('#weather-city-query').value);if(id!==searchId||!dialog.open)return;cities=found;
      dialog.querySelector('#weather-city-results').innerHTML=found.map((city,index)=>`<button class="weather-city-result" data-weather="select" data-city-index="${index}">${window.ufIcon('location')}<span>${esc(city.name)}</span>${window.ufIcon('chevron')}</button>`).join('');status(found.length?'请选择对应城市':'未找到城市，请尝试拼音或附近城市。');
    }catch(error){if(id===searchId)status(error.message);}
  });
  window.addEventListener('uniflow:rendered',()=>{paint();if(document.getElementById('home-weather'))refresh();});
  window.addEventListener('online',()=>{if(document.getElementById('home-weather'))refresh();});
  window.addEventListener('offline',paint);
  System.start(()=>{updateGreeting();if(document.getElementById('home-weather'))refresh();});
})();
