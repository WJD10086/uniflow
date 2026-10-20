/* Independent weather preference/cache; never accesses profile or task keys. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniFlowWeather=api;})(globalThis,function(){
  'use strict';
  const KEY='uniflow.weather.v1',TTL=30*60*1000;
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  function city(value) {
    if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>200||!finite(value.latitude)||!finite(value.longitude)||Math.abs(value.latitude)>90||Math.abs(value.longitude)>180)throw Error('城市信息无效，请重新选择。');
    return {name:value.name,latitude:value.latitude,longitude:value.longitude};
  }
  const same=(a,b)=>a&&b&&a.latitude===b.latitude&&a.longitude===b.longitude&&a.name===b.name;
  function condition(code) {
    if(code===0)return {text:'晴',icon:'sun'};
    if([1,2,3].includes(code))return {text:['','大部晴朗','多云','阴'][code],icon:'cloud'};
    if([45,48].includes(code))return {text:'雾',icon:'cloud'};
    if([51,53,55,56,57].includes(code))return {text:'毛毛雨',icon:'rain'};
    if([61,63,65,66,67,80,81,82].includes(code))return {text:'雨',icon:'rain'};
    if([71,73,75,77,85,86].includes(code))return {text:'雪',icon:'snow'};
    if([95,96,99].includes(code))return {text:'雷雨',icon:'rain'};
    return {text:'天气状况未知',icon:'cloud'};
  }
  function parse(data,selected,fetchedAt) {
    const c=data?.current;
    if(!c||!finite(c.temperature_2m)||!finite(c.apparent_temperature)||!Number.isInteger(c.weather_code)||!finite(c.time)||!Number.isFinite(new Date(c.time*1000).getTime()))throw Error('天气数据不完整，请稍后重试。');
    let precipitation=null;
    const times=data.hourly?.time,values=data.hourly?.precipitation_probability;
    if(Array.isArray(times)&&Array.isArray(values)) {
      const i=times.findIndex(time=>finite(time)&&time<=c.time&&c.time<time+3600);
      if(i>=0&&finite(values[i])&&values[i]>=0&&values[i]<=100)precipitation=values[i];
    }
    return {city:city(selected),temperature:c.temperature_2m,apparent:c.apparent_temperature,code:c.weather_code,
      precipitation,dataAt:new Date(c.time*1000).toISOString(),fetchedAt:new Date(fetchedAt).toISOString()};
  }
  function validCache(value,selected) {
    return value&&same(value.city,selected)&&finite(value.temperature)&&finite(value.apparent)&&Number.isInteger(value.code)&&
      (value.precipitation===null||(finite(value.precipitation)&&value.precipitation>=0&&value.precipitation<=100))&&
      typeof value.dataAt==='string'&&Number.isFinite(Date.parse(value.dataAt))&&typeof value.fetchedAt==='string'&&Number.isFinite(Date.parse(value.fetchedAt));
  }
  function create({storage=globalThis.localStorage,fetch:request=globalThis.fetch,now=Date.now,timeout=10000}={}) {
    let state={version:1,mode:'manual',city:null,cache:null},loadError='',pending=null,lastAttempt=-Infinity;
    try {
      const raw=storage.getItem(KEY);
      if(raw!==null){const value=JSON.parse(raw);if(value.version!==1||!['manual','auto'].includes(value.mode))throw Error();
        const selected=value.city===null?null:city(value.city);state={version:1,mode:value.mode,city:selected,cache:validCache(value.cache,selected)?value.cache:null};}
    }catch{loadError='天气偏好无法读取，可重新选择城市；任务数据不受影响。';}
    const copy=()=>JSON.parse(JSON.stringify(state));
    function save(next) {try{storage.setItem(KEY,JSON.stringify(next));}catch{throw Error('天气偏好保存失败，请检查本地存储后重试。');}state=next;loadError='';lastAttempt=-Infinity;}
    async function json(url) {
      const controller=new AbortController();let timer;
      try {return await Promise.race([(async()=>{const response=await request(url,{signal:controller.signal});if(!response.ok)throw Error('天气服务暂不可用');return response.json();})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('天气请求超时，请稍后重试。'));},timeout);})]);}
      finally{clearTimeout(timer);}
    }
    async function search(query) {
      const name=String(query).trim();if(name.length<2||name.length>80)throw Error('请输入 2–80 个字符的城市名称，也可尝试拼音。');
      try {const data=await json('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name,count:'8',language:'zh',format:'json'}));
        if(!data||typeof data!=='object'||data.error)throw Error();
        return (data.results||[]).map(result=>city({...result,name:[result.name,result.admin1,result.country].filter(Boolean).join(' · ')}));
      }catch(error){throw Error(error.message?.includes('超时')?error.message:'城市搜索失败，请检查网络后重试。');}
    }
    function select(value,mode='manual') {if(!['auto','manual'].includes(mode))throw Error('城市模式无效');const selected=city(value);save({version:1,mode,city:selected,cache:same(state.city,selected)?state.cache:null});return copy();}
    function disableAuto(){if(state.mode==='auto')save({version:1,mode:'manual',city:null,cache:null});return copy();}
    async function weather() {
      if(!state.city)return {data:null,stale:false,error:loadError};
      const age=state.cache?now()-Date.parse(state.cache.fetchedAt):Infinity;
      if(age>=0&&age<TTL)return {data:copy().cache,stale:false,error:''};
      if(pending&&same(pending.city,state.city))return pending.promise;
      if(now()-lastAttempt>=0&&now()-lastAttempt<60000)return {data:copy().cache,stale:true,error:'暂未刷新，稍后自动重试。'};
      const selected={...state.city};lastAttempt=now();
      const promise=(async()=>{
        try {
          const data=await json('https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:selected.latitude,longitude:selected.longitude,current:'temperature_2m,apparent_temperature,weather_code,is_day',hourly:'precipitation_probability',forecast_days:'1',timeformat:'unixtime',timezone:'auto'}));
          const parsed=parse(data,selected,now());if(!same(selected,state.city))return {superseded:true};
          let error='';try{storage.setItem(KEY,JSON.stringify({...state,cache:parsed}));}catch{error='天气已获取，但缓存保存失败。';}
          state={...state,cache:parsed};return {data:parsed,stale:false,error};
        }catch(error){if(!same(selected,state.city))return {superseded:true};return {data:copy().cache,stale:true,error:error.message?.includes('超时')?error.message:'天气更新失败，请检查网络。'};}
      })();
      pending={city:selected,promise};try{return await promise;}finally{if(pending?.promise===promise)pending=null;}
    }
    return {snapshot:copy,search,select,disableAuto,weather};
  }
  return {KEY,TTL,create,parse,condition};
});
