const assert = require('assert');
const path = require('path');
const {chromium} = require('playwright');
const {createJarvisServer} = require('../openai-server.js');

const QUESTION = '펌프 정비 추진 보고 찾아줘?';
const TODO = '안전관리팀에게 작업허가 요청하기';
const DRAFT = '작년 양식으로 기안 작성해줘';
const RACE_FIRST = 'race-first';
const RACE_SECOND = 'race-second';
const FOCUS_RACE = 'focus-race';
const FOCUS_FOLLOWUP = 'focus-followup';
const FOCUS_INPUT = 'focus-input';
const FALLBACK = '펌프 정비 추진 보고 찾아줘? 실패 확인';
const PRIVACY_CHECK = 'privacy-check';
const PRIVATE_SENTINEL = 'PRIVATE_SENTINEL_sk-live-1234567890abcdef';
const KEY_LIKE = /\b(?:sk|pk|rk)-(?:live|proj)-[A-Za-z0-9_-]{8,}\b/i;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function isHttpUrl(value) {
  const {protocol} = new URL(value);
  return protocol === 'http:' || protocol === 'https:';
}

function recordResponse(responses, response) {
  if (!responses.some((item) => item.url === response.url && item.status === response.status)) responses.push(response);
}

function attachNetworkCapture(context, requests, apiRequestBodies, responses) {
  context.on('request', (request) => {
    const record = {url: request.url(), method: request.method(), body: request.postData() || ''};
    requests.push(record);
    if (isHttpUrl(record.url) && new URL(record.url).pathname === '/api/ai') apiRequestBodies.push(record);
  });
  context.on('response', (response) => {
    if (isHttpUrl(response.url())) recordResponse(responses, {url: response.url(), status: response.status()});
  });
}

function attachPageDiagnostics(page, consoleErrors) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({text: message.text(), location: message.location()});
  });
  page.on('pageerror', (error) => consoleErrors.push({text: error.message, location: null, pageError: true}));
}

function assertSafeNetwork(requests, apiRequestBodies, baseUrl) {
  const baseOrigin = new URL(baseUrl).origin;
  for (const request of requests.filter((item) => isHttpUrl(item.url))) {
    const url = new URL(request.url);
    assert.strictEqual(url.origin, baseOrigin, `external or non-test-server request: ${request.url}`);
    assert.strictEqual(url.hostname, '127.0.0.1', `non-loopback request: ${request.url}`);
  }
  assert(apiRequestBodies.length > 0, 'no browser API request bodies were captured');
  for (const request of apiRequestBodies) {
    assert(!request.body.includes(PRIVATE_SENTINEL), `private sentinel leaked into API request body: ${request.url}`);
    assert(!KEY_LIKE.test(request.body), `API-key-like text leaked into API request body: ${request.url}`);
  }
}

async function assertNoSensitivePageText(page, label) {
  const text = await page.locator('body').innerText();
  assert(!text.includes(PRIVATE_SENTINEL), `private sentinel appeared in ${label} page content`);
  assert(!KEY_LIKE.test(text), `API-key-like text appeared in ${label} page content`);
}

function assertOnlyExpectedConsoleDiagnostics(consoleErrors, responses, baseUrl) {
  const baseOrigin = new URL(baseUrl).origin;
  const expected = [
    {path: '/api/ai', status: 502, text: 'Failed to load resource: the server responded with a status of 502 (Bad Gateway)'},
    {path: '/favicon.ico', status: 404, text: 'Failed to load resource: the server responded with a status of 404 (Not Found)'},
  ];
  for (const error of consoleErrors) {
    assert(!error.pageError, `page error: ${error.text}`);
    const match = expected.find((item) => item.text === error.text);
    assert(match, `unexpected console error: ${error.text} at ${JSON.stringify(error.location)}`);
    const response = responses.find((item) => {
      const url = new URL(item.url);
      return url.origin === baseOrigin && url.pathname === match.path && item.status === match.status;
    });
    assert(response, `uncorroborated console diagnostic: ${error.text} at ${JSON.stringify(error.location)}`);
    if (error.location && error.location.url) assert.strictEqual(new URL(error.location.url).pathname, match.path, `console diagnostic location does not match ${match.path}`);
  }
}

function parseNormalizedRequest(params) {
  const user = params.input.find((item) => item.role === 'user');
  const content = user && user.content && user.content.find((item) => item.type === 'input_text');
  assert(content && typeof content.text === 'string', 'fake OpenAI client did not receive the normalized user request');
  return JSON.parse(content.text);
}

function decision(reply, suggestedAction, {intent = 'question', evidenceIds = []} = {}) {
  return {
    reply,
    intent,
    targetWorkId: 'pump-2026',
    confidence: 0.95,
    evidenceIds,
    suggestedAction,
    needsConfirmation: suggestedAction === 'propose_todo',
  };
}

function createFakeClient(normalizedRequests) {
  return {
    responses: {
      async create(params) {
        const request = parseNormalizedRequest(params);
        normalizedRequests.push(request);
        switch (request.message) {
          case QUESTION:
            return {output_text: JSON.stringify(decision('검증된 펌프 근거 답변', 'open_evidence', {evidenceIds: ['pump-report']}))};
          case TODO:
            return {output_text: JSON.stringify(decision('작업허가 요청을 후보로 제안합니다.', 'propose_todo', {intent: 'todo'}))};
          case DRAFT:
            return {output_text: JSON.stringify(decision('작년 양식 기안으로 이동합니다.', 'open_draft', {intent: 'draft'}))};
          case RACE_FIRST:
            await wait(300);
            return {output_text: JSON.stringify(decision('첫 번째 응답은 표시되면 안 됩니다.', 'answer_only'))};
          case RACE_SECOND:
            return {output_text: JSON.stringify(decision('두 번째 최신 응답입니다.', 'answer_only'))};
          case FOCUS_RACE:
            return {output_text: JSON.stringify(decision('이전 근거 포커스는 따라오면 안 됩니다.', 'open_evidence', {evidenceIds: ['pump-report']}))};
          case FOCUS_FOLLOWUP:
            return {output_text: JSON.stringify(decision('후속 같은 업무 입력입니다.', 'answer_only'))};
          case FOCUS_INPUT:
            return {output_text: JSON.stringify(decision('입력 포커스는 유지되어야 합니다.', 'open_evidence', {evidenceIds: ['pump-report']}))};
          case FALLBACK:
            throw new Error('fake server failure');
          case PRIVACY_CHECK:
            return {output_text: JSON.stringify({
              reply: '내 업무 목록으로 이동합니다.',
              intent: 'overview',
              targetWorkId: null,
              confidence: 0.95,
              evidenceIds: [],
              suggestedAction: 'open_work_list',
              needsConfirmation: false,
            })};
          default:
            throw new Error(`unexpected fake message: ${request.message}`);
        }
      },
    },
  };
}

function assertCanonicalPrivacyRequest(request) {
  assert(request, 'privacy request was not captured');
  assert.deepStrictEqual(request.history, [], 'privacy request included non-canonical conversation history');
  assert.deepStrictEqual(request.works.map((work) => work.id), ['pump-2026', 'audit-2026', 'budget-2026']);
  for (const work of request.works) {
    assert.deepStrictEqual(Object.keys(work).sort(), ['dueLabel', 'evidence', 'id', 'stage', 'status', 'title']);
    assert(work.evidence.length > 0, `canonical evidence is missing for ${work.id}`);
  }
  const body = JSON.stringify(request);
  assert(!body.includes(PRIVATE_SENTINEL), 'private sentinel leaked into normalized server request');
  assert(!KEY_LIKE.test(body), 'API-key-like text leaked into normalized server request');
}

(async () => {
  const executablePath = process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const normalizedRequests = [];
  const browserRequests = [];
  const apiRequestBodies = [];
  const networkResponses = [];
  const consoleErrors = [];
  const server = createJarvisServer({
    openaiClient: createFakeClient(normalizedRequests),
    model: 'fake-model',
    demoRoot: path.resolve(__dirname, '..'),
  });
  let browser;
  let runError;

  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/`;
    browser = await chromium.launch({headless: true, executablePath});
    const context = await browser.newContext({viewport: {width: 1440, height: 1200}});
    attachNetworkCapture(context, browserRequests, apiRequestBodies, networkResponses);
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.setDefaultNavigationTimeout(10000);
    attachPageDiagnostics(page, consoleErrors);
    await page.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(callback, delay === 60 ? 300 : delay, ...args);
    });

    await page.goto(`${baseUrl}#home`);
    const faviconProbe = await page.evaluate(async () => {
      const response = await fetch('/favicon.ico');
      return {url: response.url, status: response.status};
    });
    recordResponse(networkResponses, faviconProbe);
    await page.evaluate((sentinel) => {
      const work = getWork('pump-2026');
      work.privateToken = sentinel;
    }, PRIVATE_SENTINEL);
    await page.fill('#homeInput', PRIVACY_CHECK);
    await page.click('#homeForm button[type="submit"]');
    await page.waitForURL(/#work\/list$/);
    const privacyRequest = normalizedRequests.find((request) => request.message === PRIVACY_CHECK);
    assertCanonicalPrivacyRequest(privacyRequest);
    const privacyBody = apiRequestBodies.find((request) => JSON.parse(request.body).message === PRIVACY_CHECK);
    assert(privacyBody, 'browser did not send the privacy request body');
    await assertNoSensitivePageText(page, 'work list');

    await page.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
    await page.goto(`${baseUrl}#home`);
    await page.reload();
    await page.fill('#homeInput', QUESTION);
    await page.click('#homeForm button[type="submit"]');
    await page.waitForURL(/#workbench\/pump-2026$/);
    assert((await page.textContent('#workAnswer')).includes('검증된 펌프 근거 답변'), 'question did not show the validated AI evidence answer');
    assert((await page.textContent('#workAnswer')).includes('AI 응답 · 시연용 샘플 데이터 기반'), 'AI answer is missing its sample-data label');
    await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.sourceId === 'pump-report');
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.dataset.sourceId), 'pump-report', 'AI evidence answer did not focus its linked evidence');
    await assertNoSensitivePageText(page, 'evidence answer');

    const progressBeforeCandidate = await page.evaluate(() => getProgress(getSelectedWork()));
    await page.fill('#contextInput', TODO);
    await page.press('#contextInput', 'Enter');
    const candidate = page.locator('.todo-item.candidate', {hasText: TODO});
    await candidate.waitFor({state: 'attached'});
    assert.strictEqual(await candidate.count(), 1, 'todo AI decision did not create a candidate');
    const progressAfterCandidate = await page.evaluate(() => getProgress(getSelectedWork()));
    assert.deepStrictEqual(progressAfterCandidate, progressBeforeCandidate, 'candidate todo changed confirmed progress');

    await page.fill('#contextInput', DRAFT);
    await page.press('#contextInput', 'Enter');
    await page.waitForURL(/#draft\/pump-2026$/);
    await assertNoSensitivePageText(page, 'draft');

    await page.goto(`${baseUrl}#workbench/pump-2026`);
    await page.evaluate(() => {
      document.getElementById('contextInput').value = 'race-first';
      submitContextInput();
    });
    await page.waitForSelector('#contextForm[aria-busy="true"]');
    assert.strictEqual(await page.getAttribute('#contextForm', 'aria-busy'), 'true', 'active workbench form does not expose aria-busy');
    await page.evaluate(() => {
      document.getElementById('contextInput').value = 'race-second';
      submitContextInput();
    });
    await page.waitForFunction(() => document.getElementById('workAnswer').textContent.includes('두 번째 최신 응답입니다.'));
    await page.waitForTimeout(350);
    const raceAnswer = await page.textContent('#workAnswer');
    assert(raceAnswer.includes('두 번째 최신 응답입니다.'), 'latest AI reply was not displayed');
    assert(!raceAnswer.includes('첫 번째 응답은 표시되면 안 됩니다.'), 'stale AI reply overwrote the latest input');

    await page.fill('#contextInput', FOCUS_RACE);
    await page.press('#contextInput', 'Enter');
    await page.waitForFunction(() => document.getElementById('workAnswer').textContent.includes('이전 근거 포커스는 따라오면 안 됩니다.'));
    await page.evaluate((followup) => {
      window.__oldEvidenceFocuses = [];
      document.addEventListener('focusin', (event) => {
        if (event.target.matches('.source-item[data-source-id="pump-report"]')) window.__oldEvidenceFocuses.push(performance.now());
      });
      document.getElementById('contextInput').value = followup;
      submitContextInput();
    }, FOCUS_FOLLOWUP);
    await page.waitForFunction(() => document.getElementById('workAnswer').textContent.includes('후속 같은 업무 입력입니다.'));
    await page.waitForTimeout(350);
    assert.deepStrictEqual(await page.evaluate(() => window.__oldEvidenceFocuses), [], 'old AI evidence timer focused a source after a later same-work input');
    assert.notStrictEqual(await page.evaluate(() => document.activeElement && document.activeElement.dataset.sourceId), 'pump-report', 'old AI evidence timer stole focus after a later same-work input');

    await page.fill('#contextInput', FOCUS_INPUT);
    await page.press('#contextInput', 'Enter');
    await page.waitForFunction(() => document.getElementById('workAnswer').textContent.includes('입력 포커스는 유지되어야 합니다.'));
    await page.waitForSelector('#contextForm[aria-busy="false"]');
    await page.evaluate(() => {
      window.__oldEvidenceFocuses = [];
      document.addEventListener('focusin', (event) => {
        if (event.target.matches('.source-item[data-source-id="pump-report"]')) window.__oldEvidenceFocuses.push(performance.now());
      });
      document.getElementById('contextInput').focus();
    });
    await page.waitForTimeout(350);
    assert.deepStrictEqual(await page.evaluate(() => window.__oldEvidenceFocuses), [], 'AI evidence timer overrode deliberate input focus');
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.id), 'contextInput', 'AI evidence timer stole deliberate input focus');
    await assertNoSensitivePageText(page, 'race workbench');

    await page.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
    await page.goto(`${baseUrl}#home`);
    await page.reload();
    await page.fill('#homeInput', FALLBACK);
    await page.click('#homeForm button[type="submit"]');
    await page.waitForURL(/#workbench\/pump-2026$/);
    const fallbackAnswer = await page.textContent('#workAnswer');
    assert(fallbackAnswer.includes(FALLBACK), 'server failure did not show the existing deterministic mock answer');
    assert(fallbackAnswer.includes('샘플 응답'), 'server failure did not show the sample response label');
    await assertNoSensitivePageText(page, 'fallback workbench');

    const mobile = await context.newPage();
    await mobile.setViewportSize({width: 390, height: 844});
    mobile.setDefaultTimeout(7000);
    attachPageDiagnostics(mobile, consoleErrors);
    await mobile.goto(`${baseUrl}#workbench/pump-2026`);
    const mobileDimensions = await mobile.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    assert(mobileDimensions.documentWidth <= mobileDimensions.viewport && mobileDimensions.bodyWidth <= mobileDimensions.viewport, `mobile horizontal overflow: ${JSON.stringify(mobileDimensions)}`);
    await assertNoSensitivePageText(mobile, 'mobile workbench');
    await mobile.close();

    assertSafeNetwork(browserRequests, apiRequestBodies, baseUrl);
    assertOnlyExpectedConsoleDiagnostics(consoleErrors, networkResponses, baseUrl);
    console.log(`OpenAI browser E2E passed (${normalizedRequests.length} fake AI requests, ${apiRequestBodies.length} captured API request bodies, ${browserRequests.length} captured browser requests).`);
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    const shutdown = await Promise.allSettled([
      browser && browser.close(),
      server.listening && close(server),
    ].filter(Boolean));
    const cleanupFailure = shutdown.find((result) => result.status === 'rejected');
    if (!runError && cleanupFailure) throw cleanupFailure.reason;
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
