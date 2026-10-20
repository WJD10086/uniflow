/* Local relevance only: no network, native permissions or business-data writes. */
(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('./notice-time.js'):root.UniFlowNoticeTime);if(common)module.exports=api;else root.UniFlowRelevance=api;})(globalThis,function(NoticeTime){
  'use strict';
  const VERSION=2;
  const labels={relevant:'值得关注',ordinary:'普通消息',uncertain:'待判断',excluded:'敏感或无效'};
  const reasons={action_time:'行动与时间安排',campus_arrangement:'校园安排与时间',explicit_request:'明确的校园行动要求',history_arrangement:'保留的通知历史含安排',weak_evidence:'信息不足，待你判断',conversation:'未发现明确行动安排',completed:'已完成或事后描述',negated:'已取消或无需行动',verification:'验证码或身份验证',invalid:'无有效内容',hidden:'系统未提供正文',user_relevant:'你已标记关注',user_ordinary:'你已取消关注'};
  // Requiring combined evidence prevents a lone date, campus noun or action word
  // from promoting everyday conversation. These rules are not semantic AI.
  const action=/提交|(?:上|补)交|交(?:作业|报告|材料|论文)|完成|报名|参加|缴费|交费|签到|填写|上传|携带|领取|归还|预约|答复|回复|确认参加|submit\b|register\b|attend\b|pay\b|upload\b|complete\b/i;
  const campus=/作业|考试|测验|实验|报告|论文|课程|课表|选课|会议|开会|讨论会|讲座|答辩|面试|活动|报名|缴费|学费|奖学金|图书馆|班会|开学|返校|exam\b|assignment\b|lecture\b|meeting\b|deadline\b/i;
  const arrangement=/考试|测验|答辩|面试|会议|开会|班会|讨论会|讲座|(?:课程|实验|活动)(?:安排|时间|地点)|exam\b|meeting\b|lecture\b/i;
  const time=/(?:今天|今晚|今早|明天|明晚|后天|本周|下周|下星期|这周|周[一二三四五六日天]|星期[一二三四五六日天]|月底|月初|截止|截至|限时|之前|以前|最迟|\d{1,2}\s*月\s*\d{1,2}\s*[日号]?|\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?:[01]?\d|2[0-3])[:：][0-5]\d|\d{1,2}\s*[点时]|tomorrow\b|today\b|next\s+(?:week|monday|tuesday|wednesday|thursday|friday)|by\s+\d|deadline\b)/i;
  const request=/请(?:大家|各位|同学|务必|及时|于|在|尽快|注意|准备|携带|完成|提交|参加|填写|上传|领取|回复|报名)|务必|必须|需要(?:大家|同学|你|您|在|于|提交|完成)|记得(?:提交|交|报名|参加|缴费)|请勿忘记|please\b|required\b|must\b/i;
  const completed=/已(?:经)?(?:提交|完成|缴费|报名|参加|结束|上传)|(?:提交|缴费|报名|支付)成功|(?:考试|会议|活动|讲座)已?结束|(?:我|我们)(?:昨天|刚才|之前).*(?:交了|提交了|考完|参加了|完成了)|(?:submitted|completed|paid)\s+(?:successfully|already)|(?:exam|meeting)\s+(?:is\s+)?over/i;
  const cancelled=/已取消|已经取消|(?:无需|不用|不必|不需要|不要)(?:再|大家|同学)?(?:提交|参加|缴费|报名|完成|回复)|(?:考试|会议|活动|讲座)取消|cancelled|canceled|no\s+need\s+to/i;
  Object.assign(reasons,{emoji:'表情或表情包提示',acknowledgement:'简单应答',course_change:'明确的课程变更',stacked_arrangement:'系统叠放正文含安排',history_uncertain:'叠放正文或历史仍有待判断内容'});
  const acknowledgement=/^(?:(?:收到|好(?:的|哒|呀|啊|吧)?|嗯+|哦+|哈+|呵呵|谢谢|谢啦|不客气|没问题|可以|知道了|了解|行|ok|okay|thanks|thank you|yes|nope|roger)[\s，,。.!！?？~～、]*)+$/iu;
  function noiseReason(body){
    // Evaluate actual body rather than a group title; names do not supply tasks.
    const text=body.replace(/^[^\n:：]{1,24}[:：]\s*/,'').trim();
    if(/^(?:\[(?:动画表情|表情包|表情|贴纸|sticker|emoji|微笑|呲牙|笑哭|捂脸|强|赞|爱心|偷笑|大笑|握手|抱拳)\]|(?:动画表情|表情包|贴纸)|\p{Extended_Pictographic}|[\p{Emoji_Modifier}\uFE0F\u200D\s\p{Punctuation}])+$/iu.test(text))return 'emoji';
    const plain=text.replace(/\[[^\]\n]{1,12}\]|\p{Extended_Pictographic}|[\p{Emoji_Modifier}\uFE0F\u200D]/gu,'').trim();
    return acknowledgement.test(plain)?'acknowledgement':null;
  }
  function fingerprint(notice){
    const input=JSON.stringify([notice.title||'',notice.text||'',notice.imageId||'',notice.captureHistory||[]]);let hash=2166136261;
    for(let i=0;i<input.length;i++){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return (hash>>>0).toString(16)+':'+input.length;
  }
  function classifyCurrent(notice){
    const title=String(notice?.title||''),body=String(notice?.text||'').trim();
    const result=(label,reasonCodes,score=0)=>({version:VERSION,label,reasonCodes,score,fingerprint:fingerprint(notice||{})});
    if(!body)return notice?.imageId?result('uncertain',['weak_evidence']):result('excluded',['invalid']);
    const all=title+'\n'+body;
    if(/(?:验证码|校验码|动态密码|一次性密码|verification\s*code|one.time\s*(?:password|code)|login\s*code)[\s\S]{0,60}\b\d{4,8}\b|\b\d{4,8}\b[\s\S]{0,30}(?:验证码|校验码)|(?:登录验证|身份验证).*(?:批准|确认|是否)/i.test(all))return result('excluded',['verification']);
    if(/^(?:(?:您?有)?\s*\d+\s*条\s*(?:新)?(?:消息|通知)|新消息|通知内容已隐藏|内容已隐藏|解锁后查看|content hidden|new message)$/i.test(body))return result('excluded',['hidden']);
    const noise=noiseReason(body);if(noise)return result('ordinary',[noise]);
    let strong=0,weak=false,retrospective=false,negated=false;const codes=new Set();
    // Sentence-sized evidence avoids joining an unrelated date in one paragraph
    // to an action mentioned elsewhere. Commas/line breaks often separate real
    // schedule notices, so they remain in the same bounded evidence window.
    const clauses=body.split(/[。！？!?；;]|\n\s*\n/).flatMap(s=>s.match(/[\s\S]{1,300}/g)||[]);
    // A precise subject such as “考试安排” can carry the event while its body
    // supplies the date. A generic group name does not provide that evidence.
    if(/考试(?:安排|通知|时间)|期[中末]考试|(?:会议|讲座|答辩|面试)(?:安排|通知|时间)/.test(title)&&time.test(body.slice(0,300))&&!completed.test(body.slice(0,300))&&!cancelled.test(body.slice(0,300))){strong=85;codes.add('campus_arrangement');}
    for(const clause of clauses){
      const a=action.test(clause),c=campus.test(clause),t=time.test(clause),r=request.test(clause);
      if(cancelled.test(clause)){negated=true;continue;}
      if(completed.test(clause)){retrospective=true;continue;}
      const courseChange=/(?:课程|上课|课表|调课|停课|补课|教室|高数|大学英语|大学物理|线性代数)/.test(clause)&&/(?:调整|调至|改(?:到|至|为|在)|变更|更换|停课|补课|调课|取消)/.test(clause)&&(time.test(clause)||/(?:教室|地点|教学楼|线上|线下|\d{2,4}[教室号])/.test(clause));
      if(courseChange){strong=Math.max(strong,90);codes.add('course_change');}
      else if(a&&t){strong=Math.max(strong,80+(c?10:0)+(r?5:0));codes.add('action_time');}
      else if(arrangement.test(clause)&&t){strong=Math.max(strong,85);codes.add('campus_arrangement');}
      else if(a&&c&&r){strong=Math.max(strong,70);codes.add('explicit_request');}
      else if(a||c||r)weak=true;
    }
    if(strong)return result('relevant',[...codes],strong);
    if(negated)return result('ordinary',['negated']);
    if(retrospective)return result('ordinary',['completed']);
    return result(weak?'uncertain':'ordinary',[weak?'weak_evidence':'conversation']);
  }
  function classify(notice){
    const current=classifyCurrent(notice);
    if(current.label==='excluded'||current.label==='relevant'||current.reasonCodes.some(code=>['completed','negated'].includes(code)))return current;
    // Android may reuse one notification key for stacked chats. A later chat
    // must not erase an earlier actionable version that we actually received.
    const lines=Array.isArray(notice?.originalNotification?.lines)?notice.originalNotification.lines.slice(0,10):[];
    const stacked=lines.map((text,index)=>({index,result:classifyCurrent({title:notice.title,text})})).find(x=>x.result.label==='relevant');
    if(stacked)return {...stacked.result,fingerprint:fingerprint(notice),reasonCodes:[...stacked.result.reasonCodes,'stacked_arrangement'],focusLine:stacked.index};
    const past=(Array.isArray(notice?.captureHistory)?notice.captureHistory:[]).slice(-10).map(item=>({item,result:classifyCurrent({title:item.title,text:item.content})})).filter(x=>x.result.label==='relevant').sort((a,b)=>b.result.score-a.result.score||b.item.version-a.item.version)[0];
    if(past)return {...past.result,fingerprint:fingerprint(notice),reasonCodes:[...past.result.reasonCodes,'history_arrangement'],focusVersion:past.item.version};
    const uncertain=lines.some(text=>classifyCurrent({title:notice.title,text}).label==='uncertain')||(notice?.captureHistory||[]).slice(-10).some(item=>classifyCurrent({title:item.title,text:item.content}).label==='uncertain');
    return uncertain?{...current,label:'uncertain',reasonCodes:['history_uncertain']}:current;
  }
  function focus(notice){
    const line=assessment(notice).focusLine;if(Number.isInteger(line)&&typeof notice.originalNotification?.lines?.[line]==='string')return {...notice,text:notice.originalNotification.lines[line]};
    const version=assessment(notice).focusVersion,item=version&&(notice.captureHistory||[]).find(h=>h.version===version);
    return item?{...notice,title:item.title,text:item.content,receivedAt:item.receivedAt,captureVersion:item.version,captureHistory:[]}:notice;
  }
  function assessment(notice){
    const stored=notice?.relevance;
    const automatic=stored?.version===VERSION&&stored.fingerprint===fingerprint(notice)&&['relevant','ordinary','uncertain','excluded'].includes(stored.label)&&Array.isArray(stored.reasonCodes)&&Number.isFinite(stored.score)?stored:classify(notice);
    const decision=notice?.relevanceFeedback?.decision;
    const overridden=automatic.label!=='excluded'&&['relevant','ordinary'].includes(decision);
    return {...automatic,label:overridden?decision:automatic.label,automaticLabel:automatic.label,
      reasonCodes:overridden?[decision==='relevant'?'user_relevant':'user_ordinary']:automatic.reasonCodes,
      unread:notice?.relevanceRead?.fingerprint!==fingerprint(notice),overridden};
  }
  function stamp(notice){return {...notice,relevance:classify(notice)};}
  function feedback(notice,decision,now=new Date().toISOString()){
    if(!['relevant','ordinary'].includes(decision))throw Error('关注选择无效。');
    if(decision==='relevant'&&assessment(notice).label==='excluded')throw Error('敏感或无效通知不能加入值得关注。');
    return {...notice,relevance:classify(notice),relevanceFeedback:{decision,updatedAt:now}};
  }
  function read(notice,now=new Date().toISOString()){return {...notice,relevanceRead:{fingerprint:fingerprint(notice),at:now}};}
  function attention(notices){return NoticeTime.sorted(notices.filter(n=>n.status!=='archived'&&assessment(n).label==='relevant'));}
  function describe(notice){const value=assessment(notice);return `${labels[value.label]} · ${value.reasonCodes.map(code=>reasons[code]||'本地规则').join('、')}`;}
  return {VERSION,labels,reasons,classify,assessment,stamp,feedback,read,attention,describe,fingerprint,focus};
});
