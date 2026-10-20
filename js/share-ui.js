/* Editable share preview, followed by the existing inbox confirmation flow. */
(() => {
  'use strict';
  const cap=window.Capacitor,native=cap?.isNativePlatform()&&cap.getPlatform()==='android';
  const service=window.UniFlowShares.createService(native?cap.registerPlugin('UniFlowShareIntent'):null),app=window.UniFlowApp;
  const images=window.UniFlowImages.create(native?cap.registerPlugin('UniFlowImageOcr'):null);
  let polling=false,active=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  function show(item){
    active=item.id;const dialog=document.createElement('dialog');dialog.id='share-dialog';dialog.className='system-dialog share-dialog';
    dialog.innerHTML=`<div class="modal-head"><h2>收到一条系统分享</h2></div><div class="modal-body"><div class="detail-meta"><span class="tag">Android 系统分享</span></div>${item.imageId?'<div class="share-image-preview" id="share-image-preview">正在读取图片…</div>':''}<label class="field">标题<input id="share-title" maxlength="80" value="${esc(item.title||'来自系统分享')}"></label><label class="field">${item.imageId?'识别文字（可编辑）':'内容'}<textarea id="share-content" maxlength="100000" rows="7" placeholder="${item.imageId?'可直接保存图片，稍后点击 AI 整理；也可仅提取文字。':''}">${esc(item.content)}</textarea></label>${item.imageId?'<div class="share-actions"><button type="button" class="button" data-share-choice="ocr">仅提取文字</button><button type="button" class="button primary" data-share-choice="ai">AI 整理</button></div>':''}<p class="card-note">确认后仅保存到本机收件箱。不会自动创建任务、上传内容或访问链接。</p><p class="error-text" id="share-error" role="alert">${esc(item.error||'')}</p></div><div class="modal-actions"><button class="button" data-share-choice="cancel">取消导入</button><button class="button primary" data-share-choice="save" ${item.error?'disabled':''}>保存到收件箱</button></div>`;
    document.body.append(dialog);let busy=false,settled=false;
    const showError=e=>{dialog.querySelector('#share-error').textContent=e.message||'分享处理失败，请重试。';};
    const finish=()=>{settled=true;dialog.close();dialog.remove();active=null;setTimeout(poll,0);};
    async function cancel(){if(busy||settled)return;busy=true;try{await service.discard(item.id);finish();}catch(e){showError(e);if(!dialog.open)dialog.showModal();}finally{busy=false;}}
    dialog.addEventListener('cancel',e=>{e.preventDefault();cancel();});dialog.addEventListener('close',()=>{if(!settled)cancel();});
    if(item.imageId){images.get(item.imageId).then(image=>{const preview=dialog.querySelector('#share-image-preview');if(preview)preview.innerHTML=`<img alt="待识别的系统分享图片" src="${esc(image.dataUrl)}">`;}).catch(showError);}
    dialog.addEventListener('click',async e=>{const choice=e.target.closest('[data-share-choice]')?.dataset.shareChoice;if(choice==='cancel'){cancel();return;}if(choice==='ocr'&&!busy){busy=true;const button=e.target.closest('[data-share-choice]');if(button)button.disabled=true;try{const result=await images.recognize(item.imageId);dialog.querySelector('#share-content').value=result.text;item.ocrStatus='ready';}catch(error){showError(error);}finally{busy=false;if(button)button.disabled=false;}return;}if(!['save','ai'].includes(choice)||busy)return;busy=true;
      try{const input={...item,title:dialog.querySelector('#share-title').value,content:dialog.querySelector('#share-content').value,ocrStatus:item.ocrStatus};if(item.imageId)await images.retain(item.imageId);if(!app.importSharedNotice(input))throw Error('未能保存分享，内容仍保留在此处。');await service.acknowledge(item.id);const saved=app.getNotice(`android-share:${item.id}`);finish();app.navigate('inbox');app.toast(choice==='ai'?'图片已保存，正在本地 OCR 并整理任务…':'分享已保存，可打开消息核对并提取任务。');if(choice==='ai'&&saved)setTimeout(()=>window.UniFlowAIUI?.extractNotice(saved),0);}catch(e){showError(e);}finally{busy=false;}
    });dialog.showModal();
  }
  async function poll(){if(polling||active||window.UniFlowOnboarding?.isActive()||document.querySelector('dialog[open]'))return;polling=true;try{for(const item of await service.pending()){if(app.hasSharedNotice(item.id)){await service.acknowledge(item.id);continue;}show(item);break;}}catch(e){app.toast('读取分享失败：'+e.message);}finally{polling=false;}}
  window.UniFlowShareUI={service,poll};
  service.listen(poll)?.catch(e=>app.toast('分享入口初始化失败：'+e.message));
  window.addEventListener('uniflow:rendered',()=>setTimeout(poll,0));window.addEventListener('uniflow:profile-changed',()=>setTimeout(poll,0));
  document.getElementById('modal').addEventListener('close',()=>setTimeout(poll,0));
  window.UniFlowSystem.start(poll);
})();
