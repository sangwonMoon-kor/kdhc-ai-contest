const assert = require('assert');
const {
  AI_INTENTS,
  AI_ACTIONS,
  AI_DECISION_SCHEMA,
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

const fs = require('fs');
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

function postJsonWithHeaders(url, payload, headers) {
  const target = new URL(url);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

const serverRequest = {
  message: 'Find the pump project progress report.',
  surface: 'home',
  selectedWorkId: null,
  works: [{
    id: 'pump-2026',
    title: 'PRIVATE_WORK_SUMMARY_DO_NOT_FORWARD',
    status: 'PRIVATE_STATUS_DO_NOT_FORWARD',
    dueLabel: 'PRIVATE_DUE_DATE_DO_NOT_FORWARD',
    stage: 'PRIVATE_STAGE_DO_NOT_FORWARD',
    evidence: [
      {id: 'pump-report', name: 'PRIVATE_EVIDENCE_SUMMARY_DO_NOT_FORWARD', role: 'private role'},
      {id: 'private-evidence', name: 'PRIVATE_UNKNOWN_EVIDENCE_DO_NOT_FORWARD', role: 'private role'},
    ],
  }, {
    id: 'private-work',
    title: 'PRIVATE_UNKNOWN_WORK_DO_NOT_FORWARD',
    status: 'private',
    dueLabel: 'private',
    stage: 'private',
    evidence: [],
  }],
  history: [{role: 'user', content: 'Earlier conversational question.'}],
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
  let capturedCreate;
  await withServer({responses: {create: async (...args) => {
    capturedCreate = args;
    return validModelDecision();
  }}}, async (url) => {
    const response = await fetch(`${url}/api/ai`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(serverRequest),
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual((await response.json()).decision.targetWorkId, 'pump-2026');

    const [openAiRequest, openAiOptions] = capturedCreate;
    assert.strictEqual(openAiRequest.model, 'test-model');
    assert.strictEqual(openAiRequest.input[0].role, 'system');
    assert.match(openAiRequest.input[0].content[0].text, /한국어 업무 비서/);
    assert.strictEqual(openAiRequest.input[1].role, 'user');
    const modelRequest = JSON.parse(openAiRequest.input[1].content[0].text);
    assert.strictEqual(modelRequest.message, serverRequest.message);
    assert.deepStrictEqual(modelRequest.history, serverRequest.history);
    assert.deepStrictEqual(modelRequest.works.map((work) => work.id), ['pump-2026']);
    assert.strictEqual(modelRequest.works[0].title, '순환수 펌프 정비공사 추진 보고');
    assert.deepStrictEqual(modelRequest.works[0].evidence, [{
      id: 'pump-report',
      name: '2025년 순환수 펌프 정비공사 추진 보고',
      role: '작년 서식',
    }]);
    const outboundText = JSON.stringify(openAiRequest);
    assert.doesNotMatch(outboundText, /PRIVATE_/);
    assert.match(outboundText, /순환수 펌프 정비공사 추진 보고/);
    assert.deepStrictEqual(openAiRequest.text, {
      format: {type: 'json_schema', name: 'jarvis_decision', strict: true, schema: AI_DECISION_SCHEMA},
    });
    assert.strictEqual(openAiRequest.max_output_tokens, 800);
    assert.ok(openAiOptions.signal instanceof AbortSignal);
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

  let guardedCreateCalls = 0;
  await withServer({responses: {create: async () => {
    guardedCreateCalls += 1;
    return validModelDecision();
  }}}, async (url) => {
    const wrongType = await fetch(`${url}/api/ai`, {
      method: 'POST',
      headers: {'content-type': 'text/plain'},
      body: JSON.stringify(serverRequest),
    });
    assert.strictEqual(wrongType.status, 415);
    assert.deepStrictEqual(await wrongType.json(), {error: 'invalid_request'});

    const crossOrigin = await fetch(`${url}/api/ai`, {
      method: 'POST',
      headers: {'content-type': 'application/json', origin: 'http://cross-origin.example'},
      body: JSON.stringify(serverRequest),
    });
    assert.strictEqual(crossOrigin.status, 403);
    assert.deepStrictEqual(await crossOrigin.json(), {error: 'invalid_request'});

    const forgedHost = await postJsonWithHeaders(`${url}/api/ai`, serverRequest, {
      host: 'rebinding.example',
      origin: 'http://rebinding.example',
    });
    assert.strictEqual(forgedHost.status, 400);
    assert.deepStrictEqual(forgedHost.body, {error: 'invalid_request'});
    assert.strictEqual(guardedCreateCalls, 0);

    const forgedHostWithoutOrigin = await postJsonWithHeaders(`${url}/api/ai`, serverRequest, {
      host: 'rebinding.example',
    });
    assert.strictEqual(forgedHostWithoutOrigin.status, 400);
    assert.deepStrictEqual(forgedHostWithoutOrigin.body, {error: 'invalid_request'});
    assert.strictEqual(guardedCreateCalls, 0);

    const localPort = new URL(url).port;
    const localhostWithoutOrigin = await postJsonWithHeaders(`${url}/api/ai`, serverRequest, {
      host: `localhost:${localPort}`,
    });
    assert.strictEqual(localhostWithoutOrigin.status, 200);

    const sameOrigin = await fetch(`${url}/api/ai`, {
      method: 'POST',
      headers: {'content-type': 'application/json', origin: url},
      body: JSON.stringify(serverRequest),
    });
    assert.strictEqual(sameOrigin.status, 200);
    assert.strictEqual(guardedCreateCalls, 2);
  });

  await withServer({responses: {create: async () => validModelDecision()}}, async (url) => {
    const missing = await fetch(`${url}/api/ai`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
    });
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
    const response = await fetch(`${url}/..%2fpackage.json`);
    assert.strictEqual(response.status, 404);
  });

  await withServer({responses: {create: async () => validModelDecision()}}, async (url) => {
    const originalReadFile = fs.promises.readFile;
    fs.promises.readFile = async () => { throw new Error('simulated static read failure'); };
    try {
      const response = await fetch(`${url}/app.html`);
      assert.strictEqual(response.status, 404);
    } finally {
      fs.promises.readFile = originalReadFile;
    }
  });

  const serverSource = fs.readFileSync(path.resolve(__dirname, '..', 'openai-server.js'), 'utf8');
  assert.match(serverSource, /model: process\.env\.OPENAI_MODEL \|\| 'gpt-5\.4-mini'/);
}

verifyServer().then(() => console.log('OpenAI server verification passed.')).catch((error) => {
  console.error(error);
  process.exit(1);
});
