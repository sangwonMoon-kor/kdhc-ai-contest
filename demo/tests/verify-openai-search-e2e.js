const assert = require('assert');
const path = require('path');
const {chromium} = require('playwright');
const {createJarvisServer} = require('../openai-server.js');

const QUESTION = '펌프 정비 추진 보고 찾아줘?';
const TODO = '안전관리팀에게 작업허가 요청하기';
const DRAFT = '작년 양식으로 기안 작성해줘';
const RACE_FIRST = 'race-first';
const RACE_SECOND = 'race-second';
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
  const requestBodies = [];
  const consoleErrors = [];
  const server = createJarvisServer({
    openaiClient: createFakeClient(normalizedRequests),
    model: 'fake-model',
    demoRoot: path.resolve(__dirname, '..'),
  });
  let browser;

  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/`;
    browser = await chromium.launch({headless: true, executablePath});
    const page = await browser.newPage({viewport: {width: 1440, height: 1200}});
    page.setDefaultTimeout(7000);
    page.setDefaultNavigationTimeout(10000);
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/ai') requestBodies.push(request.postData() || '');
    });

    await page.goto(`${baseUrl}#home`);
    await page.evaluate((sentinel) => {
      const work = getWork('pump-2026');
      work.privateToken = sentinel;
    }, PRIVATE_SENTINEL);
    await page.fill('#homeInput', PRIVACY_CHECK);
    await page.click('#homeForm button[type="submit"]');
    await page.waitForURL(/#work\/list$/);
    const privacyRequest = normalizedRequests.find((request) => request.message === PRIVACY_CHECK);
    assertCanonicalPrivacyRequest(privacyRequest);
    const privacyBody = requestBodies.find((body) => JSON.parse(body).message === PRIVACY_CHECK);
    assert(privacyBody, 'browser did not send the privacy request body');
    assert(!privacyBody.includes(PRIVATE_SENTINEL), 'private sentinel leaked into browser request body');
    assert(!KEY_LIKE.test(privacyBody), 'API-key-like text leaked into browser request body');
    assert(!(await page.locator('body').innerText()).includes(PRIVATE_SENTINEL), 'private sentinel appeared in page content');
    assert(!KEY_LIKE.test(await page.locator('body').innerText()), 'API-key-like text appeared in page content');

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

    const progressBeforeCandidate = await page.evaluate(() => getProgress(getSelectedWork()));
    await page.fill('#contextInput', TODO);
    await page.press('#contextInput', 'Enter');
    assert.strictEqual(await page.locator('.todo-item.candidate', {hasText: TODO}).count(), 1, 'todo AI decision did not create a candidate');
    const progressAfterCandidate = await page.evaluate(() => getProgress(getSelectedWork()));
    assert.deepStrictEqual(progressAfterCandidate, progressBeforeCandidate, 'candidate todo changed confirmed progress');

    await page.fill('#contextInput', DRAFT);
    await page.press('#contextInput', 'Enter');
    await page.waitForURL(/#draft\/pump-2026$/);

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

    await page.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
    await page.goto(`${baseUrl}#home`);
    await page.reload();
    await page.fill('#homeInput', FALLBACK);
    await page.click('#homeForm button[type="submit"]');
    await page.waitForURL(/#workbench\/pump-2026$/);
    const fallbackAnswer = await page.textContent('#workAnswer');
    assert(fallbackAnswer.includes(FALLBACK), 'server failure did not show the existing deterministic mock answer');
    assert(fallbackAnswer.includes('샘플 응답'), 'server failure did not show the sample response label');

    const mobile = await browser.newPage({viewport: {width: 390, height: 844}});
    mobile.setDefaultTimeout(7000);
    mobile.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) consoleErrors.push(message.text());
    });
    mobile.on('pageerror', (error) => consoleErrors.push(error.message));
    await mobile.goto(`${baseUrl}#workbench/pump-2026`);
    const mobileDimensions = await mobile.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    assert(mobileDimensions.documentWidth <= mobileDimensions.viewport && mobileDimensions.bodyWidth <= mobileDimensions.viewport, `mobile horizontal overflow: ${JSON.stringify(mobileDimensions)}`);
    await mobile.close();

    assert.deepStrictEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join('\n')}`);
    console.log(`OpenAI browser E2E passed (${normalizedRequests.length} fake AI requests, ${requestBodies.length} captured request bodies).`);
  } finally {
    if (browser) await browser.close();
    if (server.listening) await close(server);
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
