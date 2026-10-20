/* Native bridge queue: acknowledge only after local inbox storage succeeds. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniFlowShares=api;})(globalThis,function(){
  'use strict';
  function createService(plugin){return {
    async pending(){if(!plugin)return[];const result=await plugin.getPendingShares();if(!Array.isArray(result.items))throw Error('分享数据格式无效。');return result.items;},
    async acknowledge(id){if(plugin)await plugin.acknowledge({id});},
    async discard(id){if(plugin)await plugin.discard({id});},
    listen(callback){return plugin?.addListener('shareAvailable',callback);}
  };}
  return {createService};
});
