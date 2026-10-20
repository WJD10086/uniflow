/* User-confirmed OCR and DeepSeek task candidate flow. */
(() => {
  'use strict';
  const cap=window.Capacitor,native=cap?.isNativePlatform()&&cap.getPlatform()==='android';
  const directAi=native?cap.registerPlugin('UniFlowDirectAI'):null;
  const ai=window.UniFlowAI.create({isAndroidNative:native,nativeHttp:native?cap.registerPlugin('CapacitorHttp'):null,directAi}),images=window.UniFlowImages.create(native?cap.registerPlugin('UniFlowImageOcr'):null);
  let selectedImage=null,busy=false,recognizedImageId='',selectedNoticeId=null;
  const $=(selector,root=document)=>root.querySelector(selector),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const inputMeta=()=>({receivedAt:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'});
  function setError(message){const target=$('#ai-task-dialog #ai-error')||$('#content-error')||$('#import-error')||$('#ai-error');if(target)target.textContent=message;else window.UniFlowApp.toast(message);}
  function setBusy(value,label='正在处理…'){busy=value;document.querySelectorAll('[data-ai-action], [data-action="parse"]').forEach(button=>{button.disabled=value;if(value)button.dataset.busyLabel=button.textContent;else delete button.dataset.busyLabel;});const status=$('#ai-status');if(status)status.textContent=value?label:'';}
  function showImage(image){
    if(!selectedImage||selectedImage.imageId!==image.imageId){recognizedImageId='';selectedNoticeId=null;}
    selectedImage=image;
    const preview=$('#image-preview');if(!preview)return;preview.hidden=false;
    const url=image.dataUrl||image.previewUrl||'';
    preview.innerHTML=`<img alt="待识别图片预览" src="${esc(url)}"><div><span>${image.width||''} × ${image.height||''}</span><button type="button" class="text-button" data-ai-action="clear-image">重新选择</button><button type="button" class="text-button" data-ai-action="ocr-image">仅提取文字</button><button type="button" class="button primary" data-ai-action="ai-image">AI 整理</button></div>`;
  }
  async function openNativeImage(action){try{setError('');const image=await images[action]();if(!image.cancelled){showImage(image);setError('图片已在本机准备好。');}}catch(error){setError(error.message||'图片导入失败。');}}
  async function chooseWebImage(file){if(file.size>4*1024*1024)throw Error('图片超过 4 MB，请缩小后重试。');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('仅支持 JPEG、PNG 或 WebP。');const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('无法读取所选图片。'));reader.readAsDataURL(file);});showImage({dataUrl,previewUrl:dataUrl,mimeType:file.type,bytes:file.size});}
  const organizer=window.UniFlowImages.createOrganizer({recognize:id=>images.recognize(id),extract:input=>ai.extractTasks(input)});
  async function operation(work){if(busy||$('#ai-task-dialog'))return;setBusy(true);setError('');try{return await work();}catch(error){setError(error.message||'整理失败，原始内容已保留，可重试。');}finally{setBusy(false);}}
  function stage(value){const label=value==='ocr'?'正在设备本地提取中英文…':'正在通过当前 AI 连接整理文字…';const target=$('#ai-status');if(target)target.textContent=label;}
  async function saveSelected(){
    const image=selectedImage;
    if(!image?.imageId)return null;
    if(selectedNoticeId&&window.UniFlowApp.getNotice(selectedNoticeId))return selectedNoticeId;
    await images.retain(image.imageId);
    const text=$('#import-text')?.value||'',id=window.UniFlowStore.newId();
    const notice=window.UniFlowMessages.create({id,content:text,title:text.trim().split(/[。\n]/)[0].slice(0,80)||'导入图片',imageId:image.imageId,mimeType:'image/jpeg',ocrStatus:recognizedImageId===image.imageId?'ready':'pending',source:'手动导入'});
    if(!window.UniFlowApp.saveImportedMessage(notice))throw Error('无法保存图片消息，未发起 AI 请求。');
    if(selectedImage?.imageId===image.imageId)selectedNoticeId=id;return id;
  }
  async function organizeCurrent(ocrOnly=false){return operation(async()=>{
    const image=selectedImage;
    if(image&&!image.imageId)throw Error('浏览器图片暂无本地 OCR。请在 Android App 中整理图片，或手动粘贴文字。');
    if(!image&&window.UniFlowMessages.safeUrl(($('#import-text')?.value||'').trim()))throw Error('这里只保存了链接，尚未读取网页正文。请补充通知文字后再整理。');
    const noticeId=await saveSelected();
    if(noticeId&&recognizedImageId===selectedImage?.imageId){
      if(!window.UniFlowApp.updateNoticeContent(noticeId,$('#import-text')?.value||''))throw Error('文字保存失败，未调用 AI。');
    }
    const response=await organizer.run({...inputMeta(),imageId:image?.imageId,text:$('#import-text')?.value||'',ocrReady:recognizedImageId===image?.imageId,onStage:stage,ocrOnly,onText:async text=>{
      const field=$('#import-text');if(field)field.value=text;
      if(noticeId&&!window.UniFlowApp.updateNoticeContent(noticeId,text))throw Error('OCR 文字保存失败，原图仍在收件箱，未调用 AI。');
      if(selectedImage?.imageId===image?.imageId)recognizedImageId=image.imageId;
    }});
    if(ocrOnly)setError('文字已在本地提取并保存，可编辑后再次 AI 整理。');else {showCandidates(response.result.tasks);linkCandidateSource(noticeId);}
  });}
  async function extractNotice(item,ocrOnly=false){return operation(async()=>{
    const field=$('#notice-text'),text=field?.dataset.noticeId===item.id?field.value:item.text;
    const ready=item.ocrStatus==='ready';
    if(item.imageId&&ready&&text!==item.text&&!window.UniFlowApp.updateNoticeContent(item.id,text))throw Error('文字保存失败，未调用 AI。');
    if(!item.imageId&&window.UniFlowMessages.safeUrl(String(text).trim()))throw Error('这里只保存了链接，尚未读取网页正文。请补充通知文字后再整理。');
    const response=await organizer.run({...inputMeta(),receivedAt:item.receivedAt||inputMeta().receivedAt,imageId:item.imageId,text,ocrReady:ready,ocrOnly,onStage:stage,onText:async value=>{
      if(field)field.value=value;
      if(!window.UniFlowApp.updateNoticeContent(item.id,value))throw Error('OCR 文字保存失败，原图仍保留，未调用 AI。');
    }});
    if(ocrOnly)setError('文字已在本机提取并保存，可编辑后再次 AI 整理。');else {showCandidates(response.result.tasks);linkCandidateSource(item.id,item);}
  });}
  function linkCandidateSource(noticeId,selected=null){
    const dialog=$('#ai-task-dialog'),notice=selected||(noticeId&&window.UniFlowApp.getNotice(noticeId));if(!dialog||!notice)return;
    dialog.dataset.sourceNoticeId=noticeId;
    if(notice.captureVersion)dialog.dataset.sourceCaptureVersion=String(notice.captureVersion);
    const source=document.createElement('p');source.className='card-note';source.dataset.candidateSource='';
    source.textContent=`来自 ${notice.appName||notice.source||'收件箱'}：${notice.title}${notice.captureVersion?' · 通知版本 '+notice.captureVersion:''}`;
    $('#ai-candidate-form',dialog).before(source);
  }
  async function extract(text,imageDataUrl=null,receivedAt=null){return operation(async()=>{
    if(!String(text||'').trim())throw Error('请先输入可整理的文字。');
    const response=await ai.extractTasks({...inputMeta(),...(receivedAt?{receivedAt}:{}),text:text.trim(),...(imageDataUrl?{imageDataUrl}:{})});showCandidates(response.result.tasks);
  });}
  function showCandidates(tasks){if($('#ai-task-dialog'))return;if(!tasks.length){window.UniFlowApp.toast('没有识别到明确的待办事项。');return;}const dialog=document.createElement('dialog');dialog.id='ai-task-dialog';dialog.className='system-dialog ai-task-dialog';dialog.innerHTML=`<div class="modal-head"><h2>核对 AI 任务候选</h2><button class="icon-button" data-ai-dialog-close aria-label="关闭">×</button></div><div class="modal-body"><p>AI 结果尚未保存。检查每一项后，取消或确认写入现有任务清单与日历。</p><form id="ai-candidate-form">${tasks.map((task,index)=>`<fieldset class="ai-candidate" data-candidate="${index}"><legend>候选 ${index+1} · ${(task.confidence*100).toFixed(0)}% 置信度</legend><label class="field">任务名称<input name="title" maxlength="80" required value="${esc(task.title)}"></label><div class="field-grid"><label class="field">日期<input name="date" type="date" value="${esc(task.date||'')}" min="1000-01-01" max="9998-12-31"></label><label class="field">时间<input name="time" type="time" value="${esc(task.time||'')}"></label></div><label class="field">时间用途<select name="dateRole"><option value="deadline" ${task.dateRole==='deadline'?'selected':''}>任务截止</option><option value="start" ${task.dateRole==='start'?'selected':''}>日程开始</option><option value="unspecified" ${task.dateRole==='unspecified'?'selected':''}>待确认</option></select></label><label class="field">地点<input name="location" maxlength="80" value="${esc(task.location||'')}"></label><p class="card-note">依据：${esc(task.sourceText||'未提供原文依据')}${task.needsConfirmation?' · 需要进一步核对':''}</p><button type="button" class="text-button" data-ai-remove="${index}">移除候选</button></fieldset>`).join('')}</form><p id="ai-error" class="error-text" role="alert"></p></div><div class="modal-actions"><button class="button" data-ai-dialog-close>取消</button><button class="button primary" data-ai-confirm>确认并保存</button></div>`;document.body.append(dialog);dialog.showModal();dialog.addEventListener('click',async event=>{const remove=event.target.closest('[data-ai-remove]');if(remove){dialog.querySelector(`[data-candidate="${remove.dataset.aiRemove}"]`)?.remove();return;}if(event.target.closest('[data-ai-dialog-close]')){dialog.close();dialog.remove();return;}if(!event.target.closest('[data-ai-confirm]'))return;const form=$('#ai-candidate-form',dialog),fields=[...form.querySelectorAll('.ai-candidate')].map(field=>Object.fromEntries([...field.querySelectorAll("input[name],select[name]")].map(input=>[input.name,input.value])));if(!fields.length){$('#ai-error',dialog).textContent='至少保留一项候选任务。';return;}if(!form.reportValidity())return;try{const saved=window.UniFlowApp.saveAiTasks(fields);if(saved){dialog.close();dialog.remove();}}catch(error){$('#ai-error',dialog).textContent=error.message;}});}
  function renderSettings(){const grid=$('#main .settings-grid');if(!grid||$('#ai-core-settings'))return;const card=document.createElement('section');card.id='ai-core-settings';card.className='card settings-section';card.innerHTML=`<h2>UniFlow AI Core</h2><p>任务候选始终由 AI Core 校验并由你确认后保存。</p><fieldset class="ai-mode"><legend>AI 连接方式</legend><label><input type="radio" name="ai-mode" value="proxy" ${ai.mode()==='proxy'?'checked':''}>本地/云端后端代理</label><label><input type="radio" name="ai-mode" value="byok" ${ai.mode()==='byok'?'checked':''} ${native?'':'disabled'}>Android 直连（使用自己的 DeepSeek Key）</label></fieldset><div id="ai-byok-controls" ${native?'':'hidden'}><p class="card-note">Key 只在 Android 原生安全窗口中输入，经 Android Keystore 加密保存；不会进入网页、备份配置或日志。直连请求会将你主动提交的文字或图片发送给 DeepSeek。</p><div class="component-row"><button class="button" data-ai-config="configure">输入 / 更新 Key</button><button class="button" data-ai-config="test-direct">测试连接</button><button class="button" data-ai-config="clear">清除 Key</button></div><p id="ai-byok-status" class="card-note" role="status">正在检查安全存储状态…</p><p class="card-note">请求保护：每分钟最多 5 次识别、每天最多 30 次；超时仅在连接尚未建立时重试一次。AI 识别可能消耗 DeepSeek 余额。</p></div><div id="ai-proxy-controls" ${ai.mode()==='proxy'?'':'hidden'}><label class="field">后端地址<input id="ai-server-url" type="url" inputmode="url" placeholder="https://your-server.example" value="${esc(ai.baseUrl())}"></label><div class="component-row"><button class="button" data-ai-config="save">保存服务地址</button><button class="button" data-ai-config="check">检查 AI 服务</button></div><p id="ai-config-status" class="card-note" role="status">当前开放 extract_tasks；后端可配置自己的 DeepSeek Key。</p></div>`;grid.prepend(card);refreshDirectStatus();}
  async function refreshDirectStatus(){const target=$('#ai-byok-status');if(!native||!target)return;try{const status=await ai.directStatus();target.textContent=status.configured?'DeepSeek Key 已安全保存。': '尚未配置 DeepSeek Key。';}catch(error){target.textContent=error.message||'安全存储状态不可用。';}}
  document.addEventListener('click',async event=>{const button=event.target.closest('[data-ai-action]');if(!button||busy)return;const action=button.dataset.aiAction;try{setError('');if(action==='choose-image'||action==='capture-image'){if(native)await operation(()=>openNativeImage(action==='choose-image'?'choose':'capture'));else $('#image-file')?.click();}
    if(action==='clear-image'){selectedImage=null;recognizedImageId='';selectedNoticeId=null;if($('#image-preview')){$('#image-preview').hidden=true;$('#image-preview').replaceChildren();}if($('#image-file'))$('#image-file').value='';}
    if(action==='ocr-image')await organizeCurrent(true);
    if(action==='ai-extract')await organizeCurrent();
    if(action==='extract-notice'||action==='ocr-notice'||action==='extract-capture-history'){let item=window.UniFlowApp.getNotice(button.dataset.noticeId);const version=Number(button.dataset.captureVersion||0);if(item&&version){const old=item.captureHistory?.find(h=>h.version===version);if(!old)throw Error('此通知历史已不可用。');item={...item,title:old.title,text:old.content,receivedAt:old.receivedAt,captureVersion:old.version,captureHistory:[]};}if(item)await extractNotice(item,action==='ocr-notice');}
    if(action==='ai-image'){if(!selectedImage)throw Error('请先选择图片。');await organizeCurrent();}
  }catch(error){setError(error.message||'图片或 AI 处理失败。');}});
  document.addEventListener('click',async event=>{const button=event.target.closest('[data-ai-config="save"], [data-ai-config="check"]');if(!button)return;const status=$('#ai-config-status');try{if(button.dataset.aiConfig==='save'){ai.setBaseUrl($('#ai-server-url').value);status.textContent='服务地址已保存在本机偏好中。';return;}status.textContent='正在检查服务…';const health=await ai.health();status.textContent=health.configured?'AI 服务已配置，可调用 extract_tasks。':'服务端尚未配置 DeepSeek API Key。';}catch(error){status.textContent=error.message||'服务检查失败。';}});
  document.addEventListener('click',async event=>{const button=event.target.closest('[data-ai-config="configure"], [data-ai-config="test-direct"], [data-ai-config="clear"]');if(!button||button.disabled)return;const status=$('#ai-byok-status');button.disabled=true;try{if(button.dataset.aiConfig==='configure'){await ai.configureDirectKey();status.textContent='Key 已使用 Android Keystore 密钥加密并保存在本机。';}else if(button.dataset.aiConfig==='test-direct'){status.textContent='正在通过 DeepSeek 验证连接…';await ai.testDirectConnection();status.textContent='连接成功，已找到 deepseek-flash 模型。测试只读取模型列表，不调用任务生成。';}else{if(!window.confirm('从本机清除 DeepSeek Key？已有任务、消息和偏好会保留。'))return;await ai.clearDirectKey();status.textContent='Key 已从本机安全存储清除。';}}catch(error){status.textContent=error.message||'安全 AI 操作失败。';}finally{button.disabled=false;}});
  document.addEventListener('change',event=>{if(event.target.name!=='ai-mode')return;try{ai.setMode(event.target.value);$('#ai-byok-controls').hidden=!native;$('#ai-proxy-controls').hidden=ai.mode()!=='proxy';if(ai.mode()==='byok')refreshDirectStatus();}catch(error){setError(error.message);event.target.checked=false;}});
  document.addEventListener('close',event=>{if(event.target.id==='ai-task-dialog')event.target.remove();},true);
  document.addEventListener('change',async event=>{if(event.target.id==='image-file'){const file=event.target.files?.[0];if(file)try{await chooseWebImage(file);}catch(error){setError(error.message);}}});
  document.addEventListener('click',event=>{if(!event.target.closest('[data-ai-action="save-notice-text"]')||busy)return;const field=$('#notice-text');if(field&&window.UniFlowApp.updateNoticeContent(field.dataset.noticeId,field.value)){setError('文字已保存，可再次 AI 整理。');}});
  window.addEventListener('uniflow:import-opened',()=>{selectedImage=null;selectedNoticeId=null;recognizedImageId='';images.current().then(image=>{if(image&&$('#import-text')&&!selectedImage)showImage(image);}).catch(error=>setError(error.message));});
  window.addEventListener('uniflow:notice-opened',event=>{const item=window.UniFlowApp.getNotice(event.detail);if(!item?.imageId)return;const target=$('#notice-image');images.get(item.imageId).then(image=>{if(target?.isConnected){const img=document.createElement('img');img.alt='收件箱原始图片';img.src=image.dataUrl;target.replaceChildren(img);}}).catch(error=>{if(target?.isConnected)target.textContent=error.message||'图片读取失败，文字仍保留。';});});
  async function hydrateNoticeImages(){for(const target of document.querySelectorAll('[data-image-thumb]')){try{const image=await images.get(target.dataset.imageThumb);if(target.isConnected){const img=document.createElement('img');img.alt='收件箱图片';img.src=image.dataUrl;target.replaceChildren(img);}}catch{target.textContent='图片';}}}
  window.addEventListener('uniflow:rendered',()=>{renderSettings();hydrateNoticeImages();});
  setTimeout(renderSettings,0);
  window.UniFlowAIUI={ai,images,extract,extractNotice,showCandidates,isBusy:()=>busy,selectedImage:()=>selectedImage,ocrReady:()=>!!selectedImage&&recognizedImageId===selectedImage.imageId,selectedNoticeId:()=>selectedNoticeId,organizeCurrent};
})();
