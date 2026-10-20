/* Explicit, one-shot coarse location only. No watches, background work or history. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniFlowLocation=api;})(globalThis,function(){
  'use strict';
  function approximate(coords) {
    const {latitude,longitude}=coords||{};
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Error('定位结果无效，请手动选择城市。');
    // Round before persistence or transmitting to the weather provider (~1 km).
    return {latitude:Math.round(latitude*100)/100,longitude:Math.round(longitude*100)/100,name:'当前位置（大致）'};
  }
  async function locate({capacitor=globalThis.Capacitor,geolocation=globalThis.navigator?.geolocation}={}) {
    try {
      let position;
      if(capacitor?.isNativePlatform()) {
        const plugin=capacitor.registerPlugin('Geolocation');
        let permissions=await plugin.checkPermissions();
        if(permissions.coarseLocation!=='granted')permissions=await plugin.requestPermissions({permissions:['coarseLocation']});
        if(permissions.coarseLocation!=='granted')throw Error('denied');
        position=await plugin.getCurrentPosition({enableHighAccuracy:false,timeout:10000,maximumAge:300000,enableLocationFallback:true});
      } else {
        if(!geolocation)throw Error('unavailable');
        position=await new Promise((resolve,reject)=>geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:10000,maximumAge:300000}));
      }
      return approximate(position.coords);
    } catch(error) {
      const denied=error?.code===1||error?.code==='OS-PLUG-GLOC-0003'||error?.message==='denied';
      throw Error(denied?'定位权限未授权，仍可搜索并手动选择城市。':'暂时无法获取位置，请检查系统定位开关或手动选择城市。');
    }
  }
  return {locate,approximate};
});
