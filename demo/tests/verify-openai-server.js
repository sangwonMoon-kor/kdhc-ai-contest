const assert = require('assert');
const {
  AI_INTENTS,
  AI_ACTIONS,
  normalizeAiRequest,
  validateAiDecision,
} = require('../ai-contract.js');

assert.deepStrictEqual(AI_INTENTS, [
  'overview','question','instruction','note','todo','draft','ambiguous'
]);
assert.deepStrictEqual(AI_ACTIONS, [
  'answer_only','open_work_list','open_workbench','open_evidence',
  'propose_todo','propose_note','open_draft','clarify'
]);

const request = normalizeAiRequest({
  message: '작년 펌프 정비 추진 보고 찾아줘',
  surface: 'home',
  selectedWorkId: null,
  works: [{
    id: 'pump-2026', title: '순환수 펌프 정비공사 추진 보고',
    status: '진행 중', dueLabel: '4월 9일 마감', stage: '자료 확인',
    evidence: [{id:'pump-report',name:'2025년 추진 보고',role:'작년 서식'}]
  }],
  history: Array.from({length: 8}, (_, index) => ({role:'user',content:`질문 ${index}`})),
});
assert.strictEqual(request.history.length, 6);
assert.strictEqual(request.message, '작년 펌프 정비 추진 보고 찾아줘');

const valid = validateAiDecision({
  reply:'작년 추진 보고를 찾았습니다.', intent:'question',
  targetWorkId:'pump-2026', confidence:0.94,
  evidenceIds:['pump-report'], suggestedAction:'open_evidence',
  needsConfirmation:false,
}, request);
assert.strictEqual(valid.ok, true);

assert.strictEqual(validateAiDecision({...valid.value,targetWorkId:'made-up'},request).ok,false);
assert.strictEqual(validateAiDecision({...valid.value,evidenceIds:['made-up']},request).ok,false);
assert.strictEqual(validateAiDecision({...valid.value,suggestedAction:'execute_javascript'},request).ok,false);
assert.throws(() => normalizeAiRequest({message:'',surface:'home',works:[]}), /message/);
console.log('OpenAI contract verification passed.');
