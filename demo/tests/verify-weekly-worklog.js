const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..', '..');
const target = path.join(root, 'docs', '7월 4주차.html');

async function verify() {
  const html = fs.readFileSync(target, 'utf8');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/i);

  const required = [
    '직무 메모리', '7월 4주차 작업 기록', '프로젝트 목표', '이번 기록의 핵심 성과',
    '작업 타임라인', '현재 제품 흐름', 'OpenAI API 운영 방법', '실제 유지보수 데이터 검토',
    'Git 상태와 주요 커밋', '이어가기 체크리스트', 'REVIEW', 'MEDIUM',
    '로컬 데모에서만 사용', '외부 API 전송 범위는 아직 결정하지 않음',
  ];
  for (const text of required) assert.ok(html.includes(text), `missing required text: ${text}`);

  assert.doesNotMatch(html, /sk-[A-Za-z0-9_-]{16,}/);
  assert.doesNotMatch(html, /C:\\Users\\/i);
  assert.doesNotMatch(html, /\[(?:ORG|SITE|SYSTEM|VENDOR|DEPT|DOC_TITLE)_\d+\]/);
  assert.doesNotMatch(html, /image_\d+\.(?:bmp|png|jpe?g)/i);
  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i);
  assert.doesNotMatch(html, /url\(\s*["']?https?:/i);
  assert.match(html, /<pre>OPENAI_API_KEY\s+OPENAI_MODEL\s+PORT<\/pre>/);
  assert.doesNotMatch(html, /<pre>[^<]*(?:OPENAI_API_KEY|OPENAI_MODEL|PORT)\s*=\s*[^<]+<\/pre>/);
  assert.match(html, /sanitized\.md[^<]{0,160}약 0\.9MB/);
  assert.match(html, /변환결과_REVIEW\.json[^<]{0,160}약 1\.2MB/);

  const server = http.createServer((request, response) => {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser = null;
  try {
    browser = await chromium.launch({headless: true});
    const port = server.address().port;
    const page = await browser.newPage();
    for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
      await page.setViewportSize(viewport);
      await page.goto(`http://127.0.0.1:${port}/`, {waitUntil: 'load'});
      const state = await page.evaluate(() => ({title: document.title, lang: document.documentElement.lang, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, h1: document.querySelector('h1')?.textContent?.trim()}));
      assert.equal(state.lang, 'ko');
      assert.match(state.title, /7월 4주차 작업 기록/);
      assert.match(state.h1, /7월 4주차 작업 기록/);
      assert.ok(state.scrollWidth <= state.clientWidth + 1, `horizontal overflow at ${viewport.width}px`);
    }
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  process.stdout.write('Weekly worklog verification passed.\n');
}

verify().catch((error) => { console.error(error); process.exitCode = 1; });
