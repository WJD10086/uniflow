/* Keep the v3 Store API; Android additionally commits its envelope before publishing. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniFlowTaskPersistence=api;})(globalThis,function(){
  'use strict';
  const KEY='uniflow.data.v3';
  function createStorage(storage,journal,validate=JSON.parse){
    if(!journal)return storage;
    function revision(raw){validate(raw);const value=JSON.parse(raw);if(value.schemaVersion!==3||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('任务记录版本无效，已停止写入。');return value.revision;}
    return {
      getItem(key){
        const local=storage.getItem(key);if(key!==KEY)return local;
        const durable=journal.readSnapshot()??null;if(durable==='!unreadable')throw Error('原生任务保护记录无法读取，原记录已保留。');
        const localRevision=local===null?-1:revision(local),durableRevision=durable===null?-1:revision(durable);
        if(durableRevision>localRevision){storage.setItem(key,durable);return durable;}
        if(durableRevision===localRevision&&local!==durable)throw Error('本地任务记录存在版本冲突，已停止写入。');
        if(local!==null&&local!==durable&&!journal.writeSnapshot(local))throw Error('无法保护现有任务记录，已停止写入。');
        return local;
      },
      setItem(key,value){
        if(key!==KEY){storage.setItem(key,value);return;}
        const previous=storage.getItem(key);storage.setItem(key,value);
        let saved=false;try{saved=journal.writeSnapshot(value);}catch{}
        if(!saved){
          if(previous===null)storage.removeItem(key);else storage.setItem(key,previous);
          throw Error('原生任务保存失败，修改未提交。');
        }
      },
      removeItem(key){if(key===KEY)throw Error('请使用任务 Store 的重置功能。');storage.removeItem(key);}
    };
  }
  return {createStorage};
});
