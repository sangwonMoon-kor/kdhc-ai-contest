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

const http = require('http');
const path = require('path');
const {createJarvisServer} = require('../openai-server.js');

async function withServer(fakeClient, run, options = {}) {
  const server = createJarvisServer({
    openaiClient: fakeClient,
    model: 'test-model',
    demoRoot: path.resolve(__dirname, '..'),
    ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function rawGet(url, requestPath) {
  return new Promise((resolve, reject) => {
    http.get(url + requestPath, (response) => {
      response.resume();
      response.on('end', () => resolve(response));
    }).on('error', reject);
  });
}

const serverRequest = {
  message: 'Find the pump project progress report.',
  surface: 'home',
  selectedWorkId: null,
  works: [{
    id: 'pump-2026',
    title: 'Circulation pump maintenance progress report',
    status: 'in progress',
    dueLabel: 'due April 9',
    stage: 'reviewing materials',
    evidence: [{id: 'pump-report', name: '2025 progress report', role: 'previous report'}],
  }],
  history: [],
};

function validModelDecision() {
  return {
    output_text: JSON.stringify({
      reply: 'I found the report.',
      intent: 'question',
      targetWorkId: 'pump-2026',
      confidence: 0.9,
      evidenceIds: ['pump-report'],
      suggestedAction: 'open_evidence',
      needsConfirmation: false,
    }),
  };
}

async function verifyServer() {
  await withServer({responses: {create: async () => validModelDecision()}}, async (url) => {
    const response = await fetch(`${url}/api/ai`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(serverRequest),
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual((await response.json()).decision.targetWorkId, 'pump-2026');
  });

  await withServer({responses: {create: async () => ({output_text: '{"targetWorkId":"invented"}'})}}, async (url) => {
    const response = await fetch(`${url}/api/ai`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(serverRequest),
    });
    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(Object.keys(await response.json()), ['error']);
  });

  await withServer({responses: {create: async () => validModelDecision()}}, async (url) => {
    const response = await fetch(`${url}/app.html`);
    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html; charset=utf-8$/);
    assert.match(await response.text(), /<!DOCTYPE html>/i);
  });

  await withServer({responses: {create: async () => validModelDecision()}}, async (url) => {
    const response = await fetch(`${url}/api/ai`, {method: 'PUT'});
    assert.strictEqual(response.status, 405);
    assert.deepStrictEqual(await response.json(), {error: 'invalid_request'});
  });

  await withServer({responses: {create: async () => validModelDecision()}}, async (url) => {
    const missing = await fetch(`${url}/api/ai`, {method: 'POST'});
    assert.strictEqual(missing.status, 400);

    const oversized = await fetch(`${url}/api/ai`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: 'x'.repeat(12 * 1024 + 1),
    });
    assert.strictEqual(oversized.status, 413);
  });

  await withServer({responses: {create: async (_request, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})));
  })}}, async (url) => {
    const response = await fetch(`${url}/api/ai`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(serverRequest),
    });
    assert.strictEqual(response.status, 504);
    assert.deepStrictEqual(await response.json(), {error: 'ai_unavailable'});
  }, {timeoutMs: 10});

  await withServer({responses: {create: async () => validModelDecision()}}, async (url) => {
    const response = await rawGet(url, '/../package.json');
    assert.strictEqual(response.statusCode, 404);
  });
}

verifyServer().then(() => console.log('OpenAI server verification passed.')).catch((error) => {
  console.error(error);
  process.exit(1);
});
