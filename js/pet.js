/* UniFlow 桌宠「小流」：入口场景 + 右下角常驻陪伴。
   只读取 window.UniFlowApp 的数据与触发既有按钮，不改动 app.js 逻辑。 */
(function () {
  'use strict';

  const GATE_SEEN = 'uf.pet.gate.seen';
  const GATE_OFF = 'uf.pet.gate.off';
  const PET_HIDDEN = 'uf.pet.hidden';
  const NICK_KEY = 'uniflow.profile.v1';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function mascot(extraClass = '') {
    return `<svg class="uf-pet-svg ${extraClass}" viewBox="0 0 120 124" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ufPetBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fbfdff"/><stop offset="55%" stop-color="#e4f0ff"/><stop offset="100%" stop-color="#b9d2f6"/>
        </linearGradient>
        <radialGradient id="ufPetBlush">
          <stop offset="0%" stop-color="#ffb0c5" stop-opacity=".78"/><stop offset="100%" stop-color="#ffb0c5" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="ufPetGloss" cx="45%" cy="35%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity=".95"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="ufPetShadow">
          <stop offset="0%" stop-color="#26406a" stop-opacity=".16"/><stop offset="100%" stop-color="#26406a" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <ellipse class="uf-pet-shadow" cx="60" cy="101" rx="27" ry="5" fill="url(#ufPetShadow)"/>
      <g class="uf-pet-body">
        <path d="M60 23c23 0 41 14 41 33 0 20-18 33-41 33S19 76 19 56c0-19 18-33 41-33Z"
              fill="url(#ufPetBody)" stroke="#c6d9f6" stroke-width="1.6"/>
        <ellipse cx="52" cy="38" rx="26" ry="12" fill="url(#ufPetGloss)" opacity=".55"/>
        <g class="uf-pet-sprout">
          <path d="M60 24c0-7 4.6-11.4 11-11.4-.8 8-5 12.2-11 11.4Z" fill="#43ddb6"/>
          <path d="M60 24c-.9-7-5.6-10.2-11.6-9.2 1 8 5.7 11 11.6 9.2Z" fill="#79e6ca"/>
          <path d="M60 25.5v-4" stroke="#35bfa0" stroke-width="2.4" stroke-linecap="round"/>
        </g>
        <g class="uf-pet-arms">
          <ellipse class="uf-arm uf-arm--l" cx="26" cy="63" rx="6.6" ry="9.2" fill="#eaf3ff" stroke="#c6d9f6" stroke-width="1.3"/>
          <ellipse class="uf-arm uf-arm--r" cx="94" cy="63" rx="6.6" ry="9.2" fill="#eaf3ff" stroke="#c6d9f6" stroke-width="1.3"/>
        </g>
        <g class="uf-pet-eyes uf-pet-eyes--open">
          <ellipse class="uf-eye" cx="47" cy="55" rx="4.8" ry="5.9" fill="#28425f"/>
          <ellipse class="uf-eye" cx="73" cy="55" rx="4.8" ry="5.9" fill="#28425f"/>
          <circle cx="48.7" cy="52.6" r="1.5" fill="#fff" opacity=".95"/>
          <circle cx="74.7" cy="52.6" r="1.5" fill="#fff" opacity=".95"/>
        </g>
        <g class="uf-pet-eyes uf-pet-eyes--happy">
          <path d="M41.5 57c2.6-3.8 8.2-3.8 10.8 0" fill="none" stroke="#28425f" stroke-width="2.8" stroke-linecap="round"/>
          <path d="M67.5 57c2.6-3.8 8.2-3.8 10.8 0" fill="none" stroke="#28425f" stroke-width="2.8" stroke-linecap="round"/>
        </g>
        <g class="uf-pet-brows">
          <path d="M42 45c2.2-1.7 5.8-1.7 8 0" fill="none" stroke="#3c5a80" stroke-width="2.1" stroke-linecap="round"/>
          <path d="M70 45c2.2-1.7 5.8-1.7 8 0" fill="none" stroke="#3c5a80" stroke-width="2.1" stroke-linecap="round"/>
        </g>
        <circle cx="35" cy="66" r="8" fill="url(#ufPetBlush)"/>
        <circle cx="85" cy="66" r="8" fill="url(#ufPetBlush)"/>
        <path class="uf-mouth uf-mouth--smile" d="M53 66.5c2.4 4.2 9.6 4.2 12 0" fill="none" stroke="#3b5b80" stroke-width="2.5" stroke-linecap="round"/>
        <path class="uf-mouth uf-mouth--flat" d="M54 69h12" fill="none" stroke="#3b5b80" stroke-width="2.5" stroke-linecap="round"/>
        <circle class="uf-pet-badge" cx="95" cy="31" r="7.5" fill="#ef5b6b"/>
        <text class="uf-pet-badge-text" x="95" y="35" text-anchor="middle" font-size="10.5" font-weight="700" fill="#fff">!</text>
      </g>
    </svg>`;
  }

  /* ---------------- 状态 ---------------- */
  function stateOf(tasks) {
    const now = new Date();
    let overdue = 0, open = 0, done = 0;
    for (const t of tasks) {
      if (t.done) { done += 1; continue; }
      open += 1;
      if (!t.date || t.dateRole === 'start') continue;
      const stamp = new Date(`${t.date}T${t.time || '23:59'}:00+08:00`);
      if (Number.isFinite(stamp.getTime()) && stamp < now) overdue += 1;
    }
    if (overdue) return { state: 'worried', overdue, open, done };
    if (open === 0 && done > 0) return { state: 'happy', overdue: 0, open, done };
    return { state: 'idle', overdue: 0, open, done };
  }

  const TIPS = [
    '今天也要顺顺当当的',
    '有通知就丢给我，我来拆成事项',
    '按 Ctrl K 可以搜通知和任务',
    '截止和日程我分得清，不会乱排',
    '把重复的事交给我，每周自动补上',
    '累了就点「今天留一点从容」'
  ];

  /* ---------------- 常驻桌宠 ---------------- */
  let petEl = null;
  let menuOpen = false;
  let tipTimer = null;

  function buildPet() {
    const wrap = document.createElement('div');
    wrap.id = 'uf-pet';
    wrap.className = 'uf-pet';
    wrap.dataset.state = 'idle';
    wrap.innerHTML = `
      <div class="uf-pet-bubble" role="status" hidden></div>
      <div class="uf-pet-menu" hidden>
        <button type="button" class="uf-pet-item" data-uf-pet-go>进入 UniFlow</button>
        <button type="button" class="uf-pet-item" data-uf-pet-pip>浮到桌面（置顶）</button>
        <button type="button" class="uf-pet-item" data-uf-pet-import>导入通知</button>
        <button type="button" class="uf-pet-item" data-uf-pet-new>新建任务</button>
        <button type="button" class="uf-pet-item uf-pet-item--quiet" data-uf-pet-hide>先藏起来</button>
      </div>
      <button type="button" class="uf-pet-button" aria-label="桌宠小流：点击打开快捷操作，按住可拖动" aria-haspopup="true" aria-expanded="false">
        ${mascot()}
        <span class="uf-pet-dot" aria-hidden="true"></span>
      </button>`;
    document.body.append(wrap);
    petEl = wrap;

    const button = wrap.querySelector('.uf-pet-button');
    button.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      if (menuOpen) closeMenu(); else openMenu();
    });
    button.addEventListener('pointerdown', beginDrag);
    button.addEventListener('pointermove', moveDrag);
    button.addEventListener('pointerup', endDrag);
    button.addEventListener('pointercancel', endDrag);
    button.addEventListener('contextmenu', e => e.preventDefault());

    wrap.addEventListener('mouseenter', () => { if (!menuOpen && !dragging) say(randomTip(), 2600); });
    wrap.addEventListener('mouseleave', () => { if (!menuOpen) hideBubble(); });

    wrap.querySelector('[data-uf-pet-go]').addEventListener('click', () => {
      closeMenu();
      location.hash = 'overview';
      document.getElementById('main')?.focus({ preventScroll: true });
      say('回来啦，先看今天要做什么', 2600);
    });
    wrap.querySelector('[data-uf-pet-pip]').addEventListener('click', () => { closeMenu(); togglePip(); });
    wrap.querySelector('[data-uf-pet-import]').addEventListener('click', () => {
      closeMenu();
      document.querySelector('[data-action="import"]')?.click();
    });
    wrap.querySelector('[data-uf-pet-new]').addEventListener('click', () => {
      closeMenu();
      location.hash = 'tasks';
      setTimeout(() => document.querySelector('[data-action="new-task"]')?.click(), 120);
    });
    wrap.querySelector('[data-uf-pet-hide]').addEventListener('click', () => {
      localStorage.setItem(PET_HIDDEN, '1');
      closeMenu();
      wrap.remove();
      petEl = null;
    });

    document.addEventListener('click', e => {
      if (!menuOpen) return;
      if (!e.target.closest('#uf-pet')) closeMenu();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', () => applyPosition(true));
    applyPosition();
  }

  /* ---------------- 拖动与位置记忆 ---------------- */
  const POS_KEY = 'uf.pet.pos';
  let dragging = false, dragStart = null, suppressClick = false;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function readPos() {
    try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; }
    catch { return null; }
  }
  function savePos(x, y) {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch { }
  }
  function placeAt(x, y) {
    if (!petEl) return;
    const w = petEl.offsetWidth || 86, h = petEl.offsetHeight || 86;
    const left = clamp(x, 8, window.innerWidth - w - 8);
    const top = clamp(y, 8, window.innerHeight - h - 8);
    petEl.style.right = 'auto';
    petEl.style.bottom = 'auto';
    petEl.style.left = left + 'px';
    petEl.style.top = top + 'px';
    petEl.classList.toggle('is-flip', top < 170);
    return { left, top };
  }
  function applyPosition(reset = false) {
    if (!petEl || isPipMode()) return;
    if (reset) {
      const rect = petEl.getBoundingClientRect();
      const p = placeAt(rect.left, rect.top);
      if (p) savePos(p.left, p.top);
      return;
    }
    const saved = readPos();
    if (saved) placeAt(saved.x, saved.y);
  }

  function beginDrag(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (isPipMode()) return;
    const rect = petEl.getBoundingClientRect();
    dragStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, id: e.pointerId, moved: false };
    petEl.classList.add('is-dragging');
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
    e.preventDefault();
  }
  function moveDrag(e) {
    if (!dragStart || e.pointerId !== dragStart.id) return;
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if (!dragStart.moved && Math.hypot(dx, dy) > 4) { dragStart.moved = true; dragging = true; hideBubble(); }
    if (!dragStart.moved) return;
    placeAt(dragStart.left + dx, dragStart.top + dy);
  }
  function endDrag(e) {
    if (!dragStart) return;
    const moved = dragStart.moved;
    dragStart = null;
    dragging = false;
    petEl?.classList.remove('is-dragging');
    if (moved) {
      const rect = petEl.getBoundingClientRect();
      savePos(rect.left, rect.top);
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 250);
    }
  }

  /* ---------------- 桌面浮窗（Document Picture-in-Picture） ---------------- */
  let pipWin = null;
  const isPipMode = () => !!pipWin && !pipWin.closed;

  async function togglePip() {
    if (isPipMode()) { closePip(); return; }
    if (!('documentPictureInPicture' in window)) {
      say('当前浏览器不支持桌面浮窗，Edge / Chrome 116 以上可以', 4200);
      return;
    }
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 240, height: 260 });
      pipWin = win;
      const doc = win.document;
      doc.title = 'UniFlow 桌宠';
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('styles.css', location.href).href;
      doc.head.append(link);
      doc.body.className = 'uf-pip-body';
      doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
      doc.body.append(petEl);
      const tip = doc.createElement('p');
      tip.className = 'uf-pip-tip';
      tip.textContent = '拖窗口边缘可移动 · 点小流回到网页';
      doc.body.append(tip);
      petEl.classList.remove('is-flip');
      petEl.classList.add('uf-pet--pip');
      hideBubble();
      say('我到桌面上啦，最小化浏览器也还在', 4200);
      win.addEventListener('pagehide', () => { restoreFromPip(); });
      petEl.querySelector('.uf-pet-button').addEventListener('click', focusOpener);
    } catch (error) {
      say('桌面浮窗没有打开成功，可以再试一次', 3600);
    }
  }
  function focusOpener() {
    try { window.focus(); } catch { }
  }
  function restoreFromPip() {
    if (!pipWin) return;
    pipWin = null;
    if (!petEl) return;
    petEl.classList.remove('uf-pet--pip');
    document.body.append(petEl);
    applyPosition();
    say('回到网页啦', 2600);
  }
  function closePip() {
    try { pipWin?.close(); } catch { }
    restoreFromPip();
  }

  function randomTip() { return TIPS[Math.floor(Math.random() * TIPS.length)]; }

  function say(text, ms = 3200) {
    if (!petEl) return;
    const bubble = petEl.querySelector('.uf-pet-bubble');
    bubble.textContent = text;
    bubble.hidden = false;
    petEl.classList.add('is-talking');
    clearTimeout(tipTimer);
    if (ms) tipTimer = setTimeout(() => hideBubble(), ms);
  }
  function hideBubble() {
    if (!petEl) return;
    const bubble = petEl.querySelector('.uf-pet-bubble');
    if (bubble) bubble.hidden = true;
    petEl.classList.remove('is-talking');
  }
  function openMenu() {
    if (!petEl) return;
    menuOpen = true;
    petEl.classList.add('is-open');
    const menu = petEl.querySelector('.uf-pet-menu');
    menu.hidden = false;
    petEl.querySelector('.uf-pet-button').setAttribute('aria-expanded', 'true');
    hideBubble();
  }
  function closeMenu() {
    if (!petEl) return;
    menuOpen = false;
    petEl.classList.remove('is-open');
    const menu = petEl.querySelector('.uf-pet-menu');
    if (menu) menu.hidden = true;
    petEl.querySelector('.uf-pet-button')?.setAttribute('aria-expanded', 'false');
  }

  function syncPet(tasks) {
    if (!petEl) return;
    const { state, overdue } = stateOf(tasks);
    petEl.dataset.state = state;
    const dot = petEl.querySelector('.uf-pet-dot');
    dot.hidden = state !== 'worried';
    const label = state === 'worried'
      ? `桌宠小流：有 ${overdue} 项已过期，点击查看`
      : '桌宠小流：点击打开快捷操作';
    petEl.querySelector('.uf-pet-button').setAttribute('aria-label', label);
    if (state === 'worried') say(`有 ${overdue} 件事过期了，点我看看`, 0);
    else if (state === 'happy') say('今天的事项都完成啦，厉害', 3000);
  }

  /* ---------------- 入口场景 ---------------- */
  function buildGate() {
    const gate = document.createElement('div');
    gate.id = 'uf-pet-gate';
    gate.className = 'uf-pet-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-label', '欢迎回来');
    gate.innerHTML = `
      <div class="uf-gate-scene">
        <span class="uf-gate-deco d1" aria-hidden="true"></span>
        <span class="uf-gate-deco d2" aria-hidden="true"></span>
        <span class="uf-gate-deco d3" aria-hidden="true"></span>
        <span class="uf-gate-deco d4" aria-hidden="true"></span>
        <p class="uf-gate-eyebrow">UNIFLOW · 桌宠</p>
        <button type="button" class="uf-gate-pet" aria-label="点击小流进入 UniFlow">${mascot('uf-pet-svg--gate')}</button>
        <p class="uf-gate-title">小流在等你</p>
        <p class="uf-gate-sub">点一下，进入今天的安排</p>
        <div class="uf-gate-actions">
          <button type="button" class="uf-gate-skip" data-uf-gate-skip>直接进入</button>
          <label class="uf-gate-noshow"><input type="checkbox" data-uf-gate-noshow> 以后不再显示</label>
        </div>
      </div>`;
    document.documentElement.classList.add('uf-gate-open');
    document.body.append(gate);

    const close = () => {
      if (gate.querySelector('[data-uf-gate-noshow]').checked) localStorage.setItem(GATE_OFF, '1');
      sessionStorage.setItem(GATE_SEEN, '1');
      document.documentElement.classList.remove('uf-gate-open');
      gate.classList.add('is-leaving');
      setTimeout(() => gate.remove(), 420);
      document.getElementById('main')?.focus({ preventScroll: true });
      if (petEl) say('进来啦，今天也顺顺当当', 3000);
    };
    gate.querySelector('.uf-gate-pet').addEventListener('click', close);
    gate.querySelector('[data-uf-gate-skip]').addEventListener('click', close);
    gate.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    setTimeout(() => gate.querySelector('.uf-gate-pet')?.focus({ preventScroll: true }), 60);
  }

  function shouldShowGate() {
    if (localStorage.getItem(GATE_OFF) === '1') return false;
    if (sessionStorage.getItem(GATE_SEEN) === '1') return false;
    // 首次使用交给原生引导页，避免两层遮罩
    if (!localStorage.getItem(NICK_KEY)) return false;
    if (document.documentElement.classList.contains('onboarding-pending')) return false;
    if (!$('#onboarding')?.hidden) return false;
    return true;
  }

  /* ---------------- 设置页：桌宠开关 ---------------- */
  function renderSettingsToggle() {
    if ((location.hash || '').slice(1) !== 'settings') return;
    const grid = document.querySelector('#main .settings-grid');
    if (!grid || grid.querySelector('#uf-pet-settings')) return;
    const hidden = localStorage.getItem(PET_HIDDEN) === '1';
    const card = document.createElement('section');
    card.className = 'card settings-section';
    card.id = 'uf-pet-settings';
    card.innerHTML = `<h2>桌宠小流</h2>
      <div class="setting-row"><div><h3>在右下角陪着你</h3><p>点击它可打开快捷操作；关掉后不再出现</p></div>
        <button class="toggle" role="switch" aria-label="显示桌宠" aria-checked="${hidden ? 'false' : 'true'}" data-uf-pet-toggle></button></div>`;
    grid.append(card);
    card.querySelector('[data-uf-pet-toggle]').addEventListener('click', () => {
      const nowHidden = localStorage.getItem(PET_HIDDEN) === '1';
      if (nowHidden) {
        localStorage.removeItem(PET_HIDDEN);
        if (!petEl) buildPet();
        syncPet(window.UniFlowApp?.tasks?.() || []);
        say('我又回来啦', 2600);
      } else {
        localStorage.setItem(PET_HIDDEN, '1');
        petEl?.remove();
        petEl = null;
      }
      card.querySelector('[data-uf-pet-toggle]').setAttribute('aria-checked', String(nowHidden));
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    if (localStorage.getItem(PET_HIDDEN) === '1' && !shouldShowGate()) return;
    if (!petEl && localStorage.getItem(PET_HIDDEN) !== '1') buildPet();
    if (petEl) syncPet(window.UniFlowApp?.tasks?.() || []);
    if (shouldShowGate()) {
      buildGate();
    }
    renderSettingsToggle();
  }

  window.addEventListener('uniflow:rendered', () => {
    if (petEl) {
      syncPet(window.UniFlowApp?.tasks?.() || []);
      closeMenu();
    }
    renderSettingsToggle();
  });

  const start = () => setTimeout(boot, 700);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.UniFlowPet = {
    show() { localStorage.removeItem(PET_HIDDEN); if (!petEl) buildPet(); boot(); },
    hide() { localStorage.setItem(PET_HIDDEN, '1'); petEl?.remove(); petEl = null; },
    state: () => petEl?.dataset.state || 'hidden'
  };
})();
