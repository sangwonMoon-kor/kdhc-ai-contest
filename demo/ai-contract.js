(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.JarvisAiContract=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const AI_INTENTS=Object.freeze(['overview','question','instruction','note','todo','draft','ambiguous']);
  const AI_ACTIONS=Object.freeze(['answer_only','open_work_list','open_workbench','open_evidence','propose_todo','propose_note','open_draft','clarify']);
  const AI_DECISION_SCHEMA={
    type:'object',additionalProperties:false,
    required:['reply','intent','targetWorkId','confidence','evidenceIds','suggestedAction','needsConfirmation'],
    properties:{
      reply:{type:'string',minLength:1,maxLength:1200},
      intent:{type:'string',enum:[...AI_INTENTS]},
      targetWorkId:{type:['string','null']},
      confidence:{type:'number',minimum:0,maximum:1},
      evidenceIds:{type:'array',maxItems:8,items:{type:'string'}},
      suggestedAction:{type:'string',enum:[...AI_ACTIONS]},
      needsConfirmation:{type:'boolean'}
    }
  };
  function text(value,max){return String(value??'').trim().slice(0,max)}
  function normalizeAiRequest(payload){
    if(!payload||typeof payload!=='object')throw new Error('invalid payload');
    const message=text(payload.message,2000);if(!message)throw new Error('message is required');
    const surface=payload.surface==='workbench'?'workbench':'home';
    const works=(Array.isArray(payload.works)?payload.works:[]).slice(0,20).map((work)=>({
      id:text(work.id,80),title:text(work.title,200),status:text(work.status,80),
      dueLabel:text(work.dueLabel,80),stage:text(work.stage,120),
      evidence:(Array.isArray(work.evidence)?work.evidence:[]).slice(0,12).map((item)=>({
        id:text(item.id,80),name:text(item.name,240),role:text(item.role,100)
      })).filter((item)=>item.id&&item.name)
    })).filter((work)=>work.id&&work.title);
    const known=new Set(works.map((work)=>work.id));
    const selectedWorkId=known.has(payload.selectedWorkId)?payload.selectedWorkId:null;
    const history=(Array.isArray(payload.history)?payload.history:[]).slice(-6).map((item)=>({
      role:item&&item.role==='assistant'?'assistant':'user',content:text(item&&item.content,1200)
    })).filter((item)=>item.content);
    return {message,surface,selectedWorkId,works,history};
  }
  function validateAiDecision(value,request){
    if(!value||typeof value!=='object')return {ok:false,error:'decision must be an object'};
    const intent=AI_INTENTS.includes(value.intent)?value.intent:null;
    const action=AI_ACTIONS.includes(value.suggestedAction)?value.suggestedAction:null;
    const workIds=new Set(request.works.map((work)=>work.id));
    const target=value.targetWorkId===null?null:text(value.targetWorkId,80);
    const evidenceIds=new Set(request.works.flatMap((work)=>work.evidence.map((item)=>item.id)));
    const evidence=Array.isArray(value.evidenceIds)?value.evidenceIds.map((id)=>text(id,80)):[];
    if(!intent||!action||!text(value.reply,1200))return {ok:false,error:'invalid decision fields'};
    if(target!==null&&!workIds.has(target))return {ok:false,error:'unknown work id'};
    if(evidence.some((id)=>!evidenceIds.has(id)))return {ok:false,error:'unknown evidence id'};
    if(typeof value.confidence!=='number'||value.confidence<0||value.confidence>1)return {ok:false,error:'invalid confidence'};
    return {ok:true,value:{reply:text(value.reply,1200),intent,targetWorkId:target,confidence:value.confidence,evidenceIds:evidence.slice(0,8),suggestedAction:action,needsConfirmation:Boolean(value.needsConfirmation)}};
  }
  return {AI_INTENTS,AI_ACTIONS,AI_DECISION_SCHEMA,normalizeAiRequest,validateAiDecision};
});
