/* 网页版图片 AI 整理：跳过本地 OCR，直接把图片交给支持视觉的模型。
   只在浏览器环境生效；Android 端仍走原生 ML Kit OCR 路径。
   通过捕获阶段接管「AI 整理 / 仅提取文字」按钮，不改动 ai-ui.js 的内部逻辑。 */
(function () {
  'use strict';

  const native = window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform() === 'android';
  if (native) return; // 原生走 OCR，无需接管

  const MAX_EDGE = 1600;      // 压缩后最长边
  const QUALITY = 0.85;
  let busy = false;

  const $ = (s, r = document) => r.querySelector(s);
  const status = () => $('#ai-status') || $('#import-error');

  function say(message) {
    const target = $('#import-error') || $('#content-error');
    if (target) { target.textContent = message; return; }
    window.UniFlowApp?.toast?.(message);
  }
  function setBusy(value, label = '正在识别图片…') {
    busy = value;
    document.querySelectorAll('[data-ai-action], [data-action="parse"]').forEach(btn => {
      btn.disabled = value;
      if (value) btn.dataset.ufBusy = '1';
    });
    const el = status();
    if (el && value) el.textContent = label;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片读取失败，请换一张试试。'));
      img.src = src;
    });
  }

  async function toJpeg(src) {
    const img = await loadImage(src);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', QUALITY);
  }

  async function runImage(ocrOnly) {
    if (busy) return;
    const api = window.UniFlowAIUI;
    const image = api?.selectedImage?.();
    if (!image || image.imageId) return; // 原生图片交给原逻辑
    const src = image.dataUrl || image.previewUrl;
    if (!src) { say('没有可用的图片数据，请重新选择。'); return; }

    if (ocrOnly) {
      say('网页版没有本地 OCR，请直接点「AI 整理」，由模型直接读图。');
      return;
    }

    setBusy(true, '正在识别图片并提取事项…');
    try {
      const imageDataUrl = await toJpeg(src);
      const text = ($('#import-text')?.value || '').trim() || '请识别图片中的通知内容，提取其中的待办事项与日程。';
      const payload = {
        text,
        imageDataUrl,
        receivedAt: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      };
      const response = await api.ai.extractTasks(payload);
      const tasks = response?.result?.tasks || [];
      if (!tasks.length) { say('没有从图片里识别到明确的事项，可以补充文字后再试。'); return; }
      api.showCandidates(tasks);
      const el = status(); if (el) el.textContent = '';
    } catch (error) {
      say(error?.message || '图片识别失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  // 捕获阶段接管网页图片相关的按钮：
  // ai-image / ocr-image 在图片预览面板里，ai-extract 是导入弹窗底部的主按钮
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-ai-action="ai-image"], [data-ai-action="ocr-image"], [data-ai-action="ai-extract"]');
    if (!button) return;
    const api = window.UniFlowAIUI;
    const image = api?.selectedImage?.();
    if (!image || image.imageId) return; // 没有网页图片，或原生流程 → 不拦截
    event.stopImmediatePropagation();
    event.preventDefault();
    runImage(button.dataset.aiAction === 'ocr-image');
  }, true);

  window.UniFlowImageAI = { run: runImage };
})();
