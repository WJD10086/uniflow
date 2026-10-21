/* UniFlow 增强层：时间冲突、到期提醒、本周统计、重复事项、深色模式。
   只依赖 UniFlowStore 与 window.UniFlowApp，不修改 app.js 的业务逻辑。
   本文件在 app.js 之前加载，因此重复事项的生成发生在主应用读取数据之前。 */
(function () {
  'use strict';

  const RULE_KEY = 'uniflow.recurrence.v1';
  const THEME_KEY = 'uniflow.theme.v1';
  const USAGE_KEY = 'uniflow.usage.v1';
  const NOTIFIED_KEY = 'uniflow.reminder.notified.v1';
  const SOURCE = '重复事项';

  const store = window.UniFlowStore;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  const uid = () => (window.crypto?.randomUUID ? crypto.randomUUID() : 'r' + Math.random().toString(16).slice(2));

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  function toast(msg) {
    if (window.UniFlowApp?.toast) return window.UniFlowApp.toast(msg);
    const el = $('#toast');
    if (el) { el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3200); }
  }
  const today = () => store.today();
  const mm = t => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));

  /* ---------------- 主题 ---------------- */
  const THEMES = ['auto', 'light', 'dark'];
  function currentTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.includes(saved) ? saved : 'auto';
  }
  function resolved(theme) {
    if (theme !== 'auto') return theme;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(theme = currentTheme()) {
    const mode = resolved(theme);
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.themePref = theme;
    document.documentElement.style.colorScheme = mode;
    $$('[data-uf-theme]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.ufTheme === theme)));
    return mode;
  }
  function setTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'auto';
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  }
  applyTheme();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (currentTheme() === 'auto') applyTheme();
  });

  /* ---------------- 重复事项：生成（必须在 app.js 读取数据之前） ---------------- */
  function readRules() {
    const rules = readJSON(RULE_KEY, []);
    return Array.isArray(rules) ? rules.filter(r => r && typeof r.title === 'string' && r.title.trim()) : [];
  }
  function writeRules(rules) { writeJSON(RULE_KEY, rules); }

  function occurrenceDates(rule, fromDate, toDate) {
    const out = [];
    if (!store.validDate(rule.from)) return out;
    let cursor = rule.from > fromDate ? rule.from : fromDate;
    if (rule.freq === 'monthly') {
      const day = Math.min(Math.max(Number(rule.day) || 1, 1), 28);
      let y = Number(cursor.slice(0, 4)), m = Number(cursor.slice(5, 7));
      for (let i = 0; i < 24; i++) {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (iso > toDate) break;
        if (iso >= cursor) out.push(iso);
        m += 1; if (m > 12) { m = 1; y += 1; }
      }
      return out;
    }
    const weekday = Number(rule.weekday) || 1;
    let d = cursor;
    for (let i = 0; i < 400; i++) {
      if (d > toDate) break;
      const day = new Date(d + 'T00:00:00Z').getUTCDay();
      const isoWeekday = day === 0 ? 7 : day;
      if (isoWeekday === weekday) out.push(d);
      d = store.dateAdd(d, 1);
    }
    return out.slice(0, 60);
  }

  function generateRecurring() {
    const rules = readRules().filter(r => r.enabled !== false);
    if (!rules.length) return 0;
    let inst;
    try {
      inst = store.createStore({ seed: null, today: today() });
      inst.load();
    } catch { return 0; }

    const snapshot = inst.snapshot();
    const existing = new Set(snapshot.tasks.map(t => `${t.title}|${t.date}|${t.time}`));
    const startDay = today();
    const endDay = store.dateAdd(startDay, 14);
    const created = [];

    for (const rule of rules) {
      const from = rule.from && rule.from > startDay ? rule.from : startDay;
      for (const date of occurrenceDates(rule, from, endDay)) {
        const key = `${rule.title}|${date}|${rule.time || ''}`;
        if (existing.has(key)) continue;
        existing.add(key);
        created.push({
          title: rule.title,
          date,
          time: rule.time || '',
          dateRole: rule.dateRole || 'deadline',
          location: rule.location || '',
          type: rule.type || 'personal',
          priority: rule.priority || 'normal',
          done: false,
          source: SOURCE
        });
        if (created.length >= 60) break;
      }
      if (created.length >= 60) break;
    }
    if (!created.length) return 0;

    try {
      inst.transact(d => {
        const stamp = new Date().toISOString();
        for (const fields of created) {
          d.tasks.push({
            ...fields,
            id: store.newId(),
            createdAt: stamp,
            updatedAt: stamp
          });
        }
      });
      return created.length;
    } catch { return 0; }
  }

  const generatedCount = generateRecurring();

  /* ---------------- 数据视图 ---------------- */
  const tasks = () => (window.UniFlowApp?.tasks?.() || []);
  const active = list => list.filter(t => !t.done);

  function findConflicts(list) {
    const groups = new Map();
    for (const t of active(list)) {
      if (!t.date || !t.time || t.dateRole !== 'start') continue;
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }
    const out = [];
    for (const [date, items] of groups) {
      items.sort((a, b) => a.time.localeCompare(b.time));
      for (let i = 1; i < items.length; i++) {
        const gap = mm(items[i].time) - mm(items[i - 1].time);
        if (gap < 60) out.push({ date, a: items[i - 1], b: items[i], gap });
      }
    }
    return out.sort((x, y) => x.date.localeCompare(y.date));
  }

  function dueInfo(list) {
    const now = new Date();
    const soon = [], overdue = [], started = [], starting = [];
    for (const t of active(list)) {
      if (!t.date) continue;
      const stamp = new Date(`${t.date}T${t.time || '23:59'}:00+08:00`);
      if (Number.isNaN(stamp.getTime())) continue;
      const diff = stamp - now;
      const isEvent = t.dateRole === 'start';
      if (isEvent) {
        // 日程开始不是「过期」：已到点算已开始，临近算即将开始
        if (diff < 0 && diff > -12 * 3600 * 1000) started.push({ task: t, diff });
        else if (diff >= 0 && diff <= 2 * 3600 * 1000) starting.push({ task: t, diff });
      } else {
        if (diff < 0) overdue.push({ task: t, diff });
        else if (diff <= 24 * 3600 * 1000) soon.push({ task: t, diff });
      }
    }
    overdue.sort((a, b) => a.diff - b.diff);
    soon.sort((a, b) => a.diff - b.diff);
    started.sort((a, b) => b.diff - a.diff);
    starting.sort((a, b) => a.diff - b.diff);
    return { overdue, soon, started, starting };
  }

  function weekStats(list) {
    const days = store.weekDates(today());
    const doneByDay = days.map(() => 0);
    const totalByDay = days.map(() => 0);
    for (const t of list) {
      if (!t.date) continue;
      const i = days.indexOf(t.date);
      if (i < 0) continue;
      totalByDay[i] += 1;
      if (t.done) doneByDay[i] += 1;
    }
    const weekDone = doneByDay.reduce((a, b) => a + b, 0);
    const weekTotal = totalByDay.reduce((a, b) => a + b, 0);
    const allDone = list.filter(t => t.done).length;
    const rate = weekTotal ? Math.round(weekDone / weekTotal * 100) : 0;
    return { days, doneByDay, totalByDay, weekDone, weekTotal, allDone, rate, total: list.length };
  }

  function streak() {
    const log = readJSON(USAGE_KEY, { days: [] });
    const days = new Set(Array.isArray(log.days) ? log.days : []);
    days.add(today());
    const sorted = [...days].sort();
    if (sorted.length > 400) days.delete(sorted[0]);
    writeJSON(USAGE_KEY, { days: [...days] });
    let count = 0;
    let cursor = today();
    while (days.has(cursor)) { count += 1; cursor = store.dateAdd(cursor, -1); }
    return count;
  }

  /* ---------------- 注入：提示条 ---------------- */
  function ensureAlerts() {
    let box = $('#uf-alerts');
    if (box) return box;
    const shell = $('.app-shell');
    const main = $('#main');
    if (!shell || !main) return null;
    box = document.createElement('div');
    box.id = 'uf-alerts';
    box.className = 'uf-alerts';
    shell.insertBefore(box, main);
    return box;
  }

  function renderAlerts(list) {
    const box = ensureAlerts();
    if (!box) return;
    const { overdue, soon, started, starting } = dueInfo(list);
    const items = [];
    const row = (kind, icon, label, task) => `<div class="uf-alert uf-alert--${kind}" data-uf-open="${esc(task.id)}">
        <span class="uf-alert-icon" aria-hidden="true">${icon}</span>
        <span class="uf-alert-text"><strong>${label}</strong>${esc(task.title)} · ${esc(task.date)}${task.time ? ' ' + esc(task.time) : ''}</span>
        <button class="uf-alert-close" data-uf-dismiss="alert" aria-label="关闭提示">×</button>
      </div>`;
    for (const { task } of overdue.slice(0, 2)) items.push(row('danger', '!', '已过期', task));
    for (const { task } of soon.slice(0, 2)) items.push(row('warn', '⏱', '24 小时内到期', task));
    for (const { task } of starting.slice(0, 2)) items.push(row('warn', '▶', '2 小时内开始', task));
    for (const { task } of started.slice(0, 2)) items.push(row('info', '•', '日程已开始', task));
    if (generatedCount && !sessionStorage.getItem('uf.gen.toast')) {
      sessionStorage.setItem('uf.gen.toast', '1');
      items.unshift(`<div class="uf-alert uf-alert--info">
        <span class="uf-alert-icon" aria-hidden="true">↻</span>
        <span class="uf-alert-text"><strong>已生成 ${generatedCount} 项重复事项</strong>来自你设置的重复规则</span>
        <button class="uf-alert-close" data-uf-dismiss="alert" aria-label="关闭提示">×</button>
      </div>`);
    }
    box.innerHTML = items.join('');
  }

  /* ---------------- 注入：本周统计 ---------------- */
  function renderStats(list) {
    const column = $('.overview-grid .right-column');
    if (!column || $('#uf-stats')) return;
    const s = weekStats(list);
    const max = Math.max(1, ...s.totalByDay);
    const bars = s.days.map((d, i) => {
      const total = s.totalByDay[i], done = s.doneByDay[i];
      const isToday = d === today();
      return `<div class="uf-bar ${isToday ? 'is-today' : ''}" title="${d} · ${done}/${total}">
        <div class="uf-bar-track">
          <div class="uf-bar-total" style="height:${Math.round(total / max * 100)}%"></div>
          <div class="uf-bar-done" style="height:${Math.round(done / max * 100)}%"></div>
        </div>
        <span>${'一二三四五六日'[i]}</span>
      </div>`;
    }).join('');
    const card = document.createElement('section');
    card.className = 'card uf-stats';
    card.id = 'uf-stats';
    card.innerHTML = `<div class="card-head"><div><h2>本周统计</h2><p class="card-note">${s.days[0]} — ${s.days[6]}</p></div>
        <span class="tag ${s.rate >= 60 ? 'green' : 'gray'}">完成率 ${s.rate}%</span></div>
      <div class="uf-stats-body">
        <div class="uf-stats-row">
          <div class="uf-stat"><b>${s.weekDone}</b><span>本周完成</span></div>
          <div class="uf-stat"><b>${s.weekTotal - s.weekDone}</b><span>待办</span></div>
          <div class="uf-stat"><b>${streak()}</b><span>连续使用</span></div>
        </div>
        <div class="uf-bars" aria-hidden="true">${bars}</div>
        <p class="uf-stats-note">累计完成 ${s.allDone} / ${s.total} 项</p>
      </div>`;
    column.append(card);
  }

  /* ---------------- 注入：冲突提示 ---------------- */
  function renderConflicts(list) {
    const main = $('.overview-grid .main-column') || $('#main .main-column');
    if (!main) return;
    const old = $('#uf-conflict');
    if (old) old.remove();
    const list0 = findConflicts(list);
    if (!list0.length) return;
    const rows = list0.slice(0, 3).map(c => `<li><button class="uf-link" data-uf-open="${esc(c.b.id)}">${esc(c.a.title)}</button>
      <span class="uf-conflict-vs">与</span>
      <button class="uf-link" data-uf-open="${esc(c.b.id)}">${esc(c.b.title)}</button>
      <span class="uf-conflict-time">${esc(c.date)} ${esc(c.a.time)} / ${esc(c.b.time)}</span></li>`).join('');
    const box = document.createElement('section');
    box.className = 'card uf-conflict';
    box.id = 'uf-conflict';
    box.innerHTML = `<div class="uf-conflict-head"><span class="uf-conflict-badge">时间冲突</span>
        <span>${list0.length} 组安排重叠，建议错开</span></div>
      <ul class="uf-conflict-list">${rows}</ul>`;
    main.prepend(box);
  }

  /* ---------------- 注入：任务页的重复事项入口 ---------------- */
  function renderRecurEntry() {
    const toolbar = $$('#main .toolbar').find(el => el.querySelector('[data-task-filter]'));
    if (!toolbar || toolbar.querySelector('#uf-recur-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'uf-recur-btn';
    btn.className = 'button';
    btn.type = 'button';
    btn.innerHTML = '<span class="uf-dot"></span>重复事项';
    btn.addEventListener('click', openRecurDialog);
    toolbar.append(btn);
  }

  /* ---------------- 注入：设置页 ---------------- */
  function renderSettingsCards() {
    const grid = $('#main .settings-grid');
    if (!grid || $('#uf-settings')) return;
    const wrap = document.createElement('div');
    wrap.id = 'uf-settings';
    wrap.className = 'uf-settings-extra';

    const themeCard = document.createElement('section');
    themeCard.className = 'card settings-section uf-theme-card';
    const theme = currentTheme();
    themeCard.innerHTML = `<h2>外观</h2>
      <div class="setting-row"><div><h3>主题</h3><p>深色模式会跟随系统设置，也可以手动固定</p></div>
        <div class="uf-segmented" role="group" aria-label="主题模式">
          ${[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([v, l]) =>
            `<button type="button" class="uf-seg ${theme === v ? 'is-active' : ''}" data-uf-theme="${v}" aria-pressed="${theme === v}">${l}</button>`).join('')}
        </div></div>`;

    const recurCard = document.createElement('section');
    recurCard.className = 'card settings-section';
    const rules = readRules();
    recurCard.innerHTML = `<h2>重复事项</h2>
      <p class="card-note">按固定节奏自动生成事项；每次打开 UniFlow 时补齐未来两周。</p>
      <div class="uf-rule-list">${rules.length ? rules.map(r => `
        <div class="uf-rule ${r.enabled === false ? 'is-off' : ''}">
          <div class="uf-rule-main"><strong>${esc(r.title)}</strong>
            <span>${r.freq === 'monthly' ? `每月 ${r.day} 日` : `每周${'一二三四五六日'[(Number(r.weekday) || 1) - 1]}`}${r.time ? ' · ' + esc(r.time) : ''} · ${r.dateRole === 'start' ? '日程开始' : '任务截止'}</span></div>
          <div class="uf-rule-actions">
            <button type="button" class="text-button" data-uf-rule-toggle="${esc(r.id)}">${r.enabled === false ? '启用' : '暂停'}</button>
            <button type="button" class="text-button uf-danger" data-uf-rule-del="${esc(r.id)}">删除</button>
          </div>
        </div>`).join('') : '<p class="uf-empty-hint">还没有重复规则。</p>'}</div>
      <div class="component-row"><button type="button" class="button primary" data-uf-rule-new>新建重复事项</button></div>`;

    wrap.append(themeCard, recurCard);
    grid.append(wrap);
  }

  /* ---------------- 重复事项弹窗 ---------------- */
  function modalEl() { return $('#modal'); }
  function openModal(title, body, footer) {
    const modal = modalEl();
    if (!modal) return;
    $('#modal-content').innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2>
        <button class="icon-button" data-action="close" aria-label="关闭弹窗">${window.ufIcon?.('close') || '×'}</button></div>
      ${body}${footer ? `<div class="modal-actions">${footer}</div>` : ''}`;
    if (!modal.open) modal.showModal();
  }
  function openRecurDialog() {
    openModal('新建重复事项', `
      <div class="modal-body">
        <label class="field">名称<input id="uf-rule-title" maxlength="80" placeholder="例如：每周组会"></label>
        <div class="field-grid">
          <label class="field">频率<select id="uf-rule-freq"><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
          <label class="field" id="uf-weekday-field">星期<select id="uf-rule-weekday">
            ${'一二三四五六日'.split('').map((d, i) => `<option value="${i + 1}" ${i === 0 ? 'selected' : ''}>周${d}</option>`).join('')}
          </select></label>
        </div>
        <div class="field-grid">
          <label class="field">时间（可选）<input id="uf-rule-time" type="time"></label>
          <label class="field">时间用途<select id="uf-rule-role"><option value="deadline">任务截止</option><option value="start">日程开始</option></select></label>
        </div>
        <label class="field">地点（可选）<input id="uf-rule-location" maxlength="80" placeholder="例如：教学楼 A302"></label>
        <p class="field card-note">规则保存后，会在下次打开 UniFlow 时补齐未来两周的事项。</p>
      </div>`,
      `<button class="button" data-action="close">取消</button><button class="button primary" data-uf-rule-save>保存规则</button>`);

    const freq = $('#uf-rule-freq');
    const sync = () => {
      const monthly = freq.value === 'monthly';
      $('#uf-weekday-field').hidden = monthly;
      $('#uf-weekday-field').style.display = monthly ? 'none' : '';
    };
    freq.addEventListener('change', sync);
    sync();
  }

  function saveRule() {
    const title = ($('#uf-rule-title')?.value || '').trim();
    if (!title) { toast('请填写名称'); $('#uf-rule-title')?.focus(); return; }
    const freq = $('#uf-rule-freq').value === 'monthly' ? 'monthly' : 'weekly';
    const rules = readRules();
    rules.push({
      id: uid(),
      title,
      freq,
      weekday: Number($('#uf-rule-weekday')?.value) || 1,
      day: Math.min(28, Number(today().slice(8, 10)) || 1),
      time: $('#uf-rule-time')?.value || '',
      dateRole: $('#uf-rule-role')?.value === 'start' ? 'start' : 'deadline',
      location: ($('#uf-rule-location')?.value || '').trim(),
      type: 'personal',
      priority: 'normal',
      from: today(),
      enabled: true,
      createdAt: new Date().toISOString()
    });
    writeRules(rules);
    modalEl()?.close();
    toast('重复规则已保存，下次打开时自动生成事项');
    decorate();
  }

  /* ---------------- 事件绑定 ---------------- */
  document.addEventListener('click', event => {
    const open = event.target.closest('[data-uf-open]');
    if (open) { window.UniFlowApp?.openTask?.(open.dataset.ufOpen); return; }

    if (event.target.closest('[data-uf-dismiss="alert"]')) {
      event.target.closest('.uf-alert')?.remove();
      return;
    }
    const seg = event.target.closest('[data-uf-theme]');
    if (seg) { setTheme(seg.dataset.ufTheme); decorate(); return; }

    if (event.target.closest('[data-uf-rule-new]')) { openRecurDialog(); return; }
    if (event.target.closest('[data-uf-rule-save]')) { saveRule(); return; }

    const toggle = event.target.closest('[data-uf-rule-toggle]');
    if (toggle) {
      const rules = readRules().map(r => r.id === toggle.dataset.ufRuleToggle ? { ...r, enabled: r.enabled === false } : r);
      writeRules(rules);
      toast('重复规则状态已更新');
      decorate();
      return;
    }
    const del = event.target.closest('[data-uf-rule-del]');
    if (del) {
      const rules = readRules().filter(r => r.id !== del.dataset.ufRuleDel);
      writeRules(rules);
      toast('重复规则已删除，已生成的事项仍保留');
      decorate();
    }
  });

  $('#modal')?.addEventListener('close', () => { /* 复用主应用的弹窗 */ });

  /* ---------------- 视图装饰 ---------------- */
  function decorate() {
    const view = (location.hash || '#overview').slice(1) || 'overview';
    const list = tasks();
    try { renderAlerts(list); } catch { }
    if (view === 'overview') {
      try { renderStats(list); } catch { }
      try { renderConflicts(list); } catch { }
    }
    if (view === 'tasks') { try { renderRecurEntry(); } catch { } }
    if (view === 'settings') { try { renderSettingsCards(); } catch { } }
  }

  window.addEventListener('uniflow:rendered', () => {
    // 主应用整屏重绘后，#main 内的注入元素会丢失，需要重新挂载
    $('#uf-stats')?.remove();
    $('#uf-conflict')?.remove();
    $('#uf-settings')?.remove();
    decorate();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decorate);
  } else {
    decorate();
  }

  window.UniFlowEnhance = { decorate, conflicts: () => findConflicts(tasks()), theme: { get: currentTheme, set: setTheme } };
})();
