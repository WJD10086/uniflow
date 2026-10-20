/* Local identity only. Never reads or writes the task store. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UniFlowProfile = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const KEY = 'uniflow.profile.v1';
  function nickname(value) {
    const name = String(value ?? '').trim();
    if ([...name].length < 1 || [...name].length > 20) throw new Error('请输入 1–20 个字符的昵称，首尾空格不计入长度。');
    return name;
  }
  function createStore(storage = globalThis.localStorage) {
    let current, expected;
    const copy = () => ({...current});
    function load() {
      current = null;
      let raw;
      try { raw = storage.getItem(KEY); }
      catch { throw new Error('无法读取昵称与引导记录，请检查本地存储后重试。已有记录不会被覆盖。'); }
      let data = {version:1, nickname:'', tutorialCompleted:false, tutorialStarted:false};
      if (raw !== null) {
        try {
          data = JSON.parse(raw);
          if (data?.version !== 1 || typeof data.nickname !== 'string' || typeof data.tutorialCompleted !== 'boolean' || nickname(data.nickname) !== data.nickname) throw new Error();
          // Older profile records predate tutorialStarted. A profile with a
          // nickname but no explicit in-progress marker is an existing user;
          // do not force that user through a new first-run tutorial on upgrade.
          if (typeof data.tutorialStarted !== 'boolean') data.tutorialStarted = false;
        } catch { throw new Error('昵称记录无法读取，原记录已保留。请勿清除应用数据，可检查后重试。'); }
      }
      expected = raw; current = data; return copy();
    }
    function save(patch) {
      if (!current) throw new Error('昵称记录尚未成功加载，请先重试读取。');
      const next = {...current, ...patch};
      let raw;
      try { raw = storage.getItem(KEY); }
      catch { throw new Error('无法读取昵称记录，本次修改未保存。'); }
      if (raw !== expected) throw new Error('昵称已在另一个窗口更改，请重新加载后再试。');
      const serialized = JSON.stringify(next);
      try { storage.setItem(KEY, serialized); }
      catch { throw new Error('保存失败：本地存储不可用或空间不足。请保留昵称输入并重试。'); }
      current = next; expected = serialized; return copy();
    }
    return {load, snapshot:copy, saveNickname:value=>save({nickname:nickname(value), ...(current && !current.nickname && !current.tutorialCompleted?{tutorialStarted:true}:{})}), completeTutorial:()=>{
      if (!current?.nickname) throw new Error('请先设置昵称。');
      return save({tutorialCompleted:true,tutorialStarted:false});
    }};
  }
  function createNativeStore(plugin, legacyStorage) {
    let raw, current;
    // Reuse the same validation and profile format with a candidate in memory.
    // Publish only after Android's independent profile file commits to disk.
    function candidate(value) {
      let draft = value;
      const store = createStore({getItem:()=>draft, setItem:(key,next)=>{draft=next;}});
      return {store, serialized:()=>draft};
    }
    async function load() {
      current = null;
      const result = await plugin.read();
      let value = result.value ?? null;
      if (value === null && legacyStorage) {
        const legacy = legacyStorage.getItem(KEY);
        if (legacy !== null) {
          candidate(legacy).store.load();
          await plugin.write({value:legacy, expected:null});
          value = legacy; // Retain the old key as a backup; never touch task keys.
        }
      }
      const next = candidate(value);
      const data = next.store.load();
      raw = next.serialized(); current = next.store; return data;
    }
    async function save(method, value) {
      if (!current) throw new Error('昵称记录尚未成功加载，请先重试读取。');
      const next = candidate(raw); next.store.load();
      const data = next.store[method](value);
      await plugin.write({value:next.serialized(), expected:raw});
      raw = next.serialized(); current = next.store; return data;
    }
    return {load, snapshot:()=>current?.snapshot(), saveNickname:value=>save('saveNickname',value), completeTutorial:()=>save('completeTutorial')};
  }
  return {KEY, nickname, createStore, createNativeStore};
});
