# Weekly Worklog HTML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `docs/7월 4주차.html`, a secure, responsive, standalone weekly worklog that explains the current state of the 직무 메모리 prototype and how to continue the work.

**Architecture:** The deliverable is one dependency-free HTML file containing semantic markup and embedded CSS. A focused Node/Playwright verifier checks required content, security boundaries, absence of external resources, UTF-8 metadata, and horizontal overflow at desktop and mobile widths.

**Tech Stack:** HTML5, embedded CSS, Node.js 24, Playwright 1.61.1, Git.

## Global Constraints

- Create the final artifact at exactly `docs/7월 4주차.html`.
- Do not load external fonts, stylesheets, scripts, images, or CDNs.
- Do not include an OpenAI API key, key fragment, `.env` value, local absolute path, maintenance-procedure body text, pseudonym mapping, or unreviewed image content.
- Mention only the source filenames `sanitized.md` and `변환결과_REVIEW.json`; do not copy those files into the repository.
- Record the data decision as `REVIEW`, residual risk `MEDIUM`, manual review required, and local-demo-only use.
- Record external OpenAI API transmission of real procedure data as unresolved.
- Use relative links for repository files and a normal HTTPS link for the GitHub branch.
- Preserve readable print output and prevent horizontal scrolling at 390px and 1440px viewport widths.

---

## File Structure

- Create `docs/7월 4주차.html` — the standalone user-facing weekly worklog.
- Create `demo/tests/verify-weekly-worklog.js` — static and responsive layout verification.
- Modify `package.json` — expose the verifier as `npm run test:worklog`.

### Task 1: Add the weekly-worklog acceptance test

**Files:**
- Create: `demo/tests/verify-weekly-worklog.js`
- Modify: `package.json`
- Test: `demo/tests/verify-weekly-worklog.js`

**Interfaces:**
- Consumes: `docs/7월 4주차.html` as UTF-8 HTML.
- Produces: command `npm run test:worklog`, exiting `0` only when content, privacy, and responsive checks pass.

- [ ] **Step 1: Create the verifier**

Create `demo/tests/verify-weekly-worklog.js` with this complete content:

```js
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
    '직무 메모리',
    '7월 4주차 작업 기록',
    '프로젝트 목표',
    '이번 기록의 핵심 성과',
    '작업 타임라인',
    '현재 제품 흐름',
    'OpenAI API 운영 방법',
    '실제 유지보수 데이터 검토',
    'Git 상태와 주요 커밋',
    '이어가기 체크리스트',
    'REVIEW',
    'MEDIUM',
    '로컬 데모에서만 사용',
    '외부 API 전송 범위는 아직 결정하지 않음',
  ];
  for (const text of required) assert.ok(html.includes(text), `missing required text: ${text}`);

  assert.doesNotMatch(html, /sk-[A-Za-z0-9_-]{16,}/);
  assert.doesNotMatch(html, /C:\\Users\\/i);
  assert.doesNotMatch(html, /\[(?:ORG|SITE|SYSTEM|VENDOR|DEPT|DOC_TITLE)_\d+\]/);
  assert.doesNotMatch(html, /image_\d+\.(?:bmp|png|jpe?g)/i);
  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i);
  assert.doesNotMatch(html, /url\(\s*["']?https?:/i);

  const server = http.createServer((request, response) => {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const browser = await chromium.launch({headless: true});
  try {
    const port = server.address().port;
    const page = await browser.newPage();
    for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
      await page.setViewportSize(viewport);
      await page.goto(`http://127.0.0.1:${port}/`, {waitUntil: 'load'});
      const state = await page.evaluate(() => ({
        title: document.title,
        lang: document.documentElement.lang,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        h1: document.querySelector('h1')?.textContent?.trim(),
      }));
      assert.equal(state.lang, 'ko');
      assert.match(state.title, /7월 4주차 작업 기록/);
      assert.match(state.h1, /7월 4주차 작업 기록/);
      assert.ok(state.scrollWidth <= state.clientWidth + 1, `horizontal overflow at ${viewport.width}px`);
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  process.stdout.write('Weekly worklog verification passed.\n');
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the package script**

Add this key to the existing `scripts` object in `package.json`:

```json
"test:worklog": "node demo/tests/verify-weekly-worklog.js"
```

- [ ] **Step 3: Run the test and verify the missing artifact fails**

Run:

```powershell
npm run test:worklog
```

Expected: FAIL with `ENOENT` for `docs/7월 4주차.html`.

### Task 2: Build the standalone weekly worklog

**Files:**
- Create: `docs/7월 4주차.html`
- Test: `demo/tests/verify-weekly-worklog.js`

**Interfaces:**
- Consumes: the approved design spec and only non-sensitive project metadata.
- Produces: a directly openable HTML5 document with stable section anchors `goal`, `wins`, `timeline`, `flow`, `api`, `data`, `git`, and `continue`.

- [ ] **Step 1: Create the complete HTML document**

Create `docs/7월 4주차.html` with the following complete document:

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>직무 메모리 · 7월 4주차 작업 기록</title>
  <style>
    :root{--bg:#f3f6fb;--paper:#fff;--ink:#172033;--muted:#667085;--line:#dfe5ef;--blue:#1769e0;--blue-soft:#eaf2ff;--green:#147d64;--green-soft:#e8f7f2;--amber:#9a6700;--amber-soft:#fff5d8;--red:#b42318;--red-soft:#ffebe9;--shadow:0 18px 55px rgba(28,45,76,.09)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Malgun Gothic","Apple SD Gothic Neo",Arial,sans-serif;line-height:1.72;word-break:keep-all;overflow-wrap:anywhere}a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}.wrap{width:min(1080px,calc(100% - 40px));margin:0 auto}.hero{padding:76px 0 42px;background:linear-gradient(145deg,#fff 0%,#edf4ff 58%,#e8f7f2 100%);border-bottom:1px solid var(--line)}.kicker{margin:0 0 12px;color:var(--blue);font-size:13px;font-weight:800;letter-spacing:.08em}.hero h1{max-width:800px;margin:0;font-size:clamp(38px,6vw,66px);line-height:1.08;letter-spacing:-.05em}.hero-copy{max-width:720px;margin:22px 0 0;color:var(--muted);font-size:18px}.badges{display:flex;flex-wrap:wrap;gap:9px;margin-top:30px}.badge{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:999px;font-size:12px;font-weight:800;border:1px solid transparent}.done{color:var(--green);background:var(--green-soft);border-color:#bfe7da}.review{color:var(--amber);background:var(--amber-soft);border-color:#f0d891}.hold{color:var(--red);background:var(--red-soft);border-color:#f5c3be}.meta-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:34px}.meta-card{padding:18px;border:1px solid rgba(23,105,224,.13);border-radius:16px;background:rgba(255,255,255,.72);backdrop-filter:blur(8px)}.meta-card span{display:block;color:var(--muted);font-size:12px}.meta-card strong{display:block;margin-top:4px;font-size:15px}.toc{position:sticky;top:0;z-index:10;border-bottom:1px solid var(--line);background:rgba(255,255,255,.91);backdrop-filter:blur(14px)}.toc-inner{display:flex;gap:6px;overflow-x:auto;padding:10px 0}.toc a{flex:0 0 auto;padding:7px 10px;border-radius:999px;color:var(--muted);font-size:12px;font-weight:700}.toc a:hover{background:var(--blue-soft);color:var(--blue);text-decoration:none}main{padding:30px 0 80px}.section{scroll-margin-top:70px;margin-top:22px;padding:32px;border:1px solid var(--line);border-radius:22px;background:var(--paper);box-shadow:var(--shadow)}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:22px}.eyebrow{color:var(--blue);font-size:12px;font-weight:800;letter-spacing:.06em}.section h2{margin:5px 0 0;font-size:clamp(24px,3vw,34px);line-height:1.25;letter-spacing:-.035em}.section-lead{max-width:680px;margin:8px 0 0;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{padding:20px;border:1px solid var(--line);border-radius:16px;background:#fbfcfe}.card h3{margin:0 0 8px;font-size:16px}.card p{margin:0;color:var(--muted);font-size:14px}.number{display:grid;width:34px;height:34px;margin-bottom:16px;place-items:center;border-radius:11px;background:var(--blue-soft);color:var(--blue);font-size:13px;font-weight:900}.timeline{position:relative;margin-left:8px;padding-left:27px}.timeline::before{content:"";position:absolute;top:7px;bottom:7px;left:6px;width:2px;background:var(--line)}.event{position:relative;padding:0 0 24px}.event:last-child{padding-bottom:0}.event::before{content:"";position:absolute;top:7px;left:-26px;width:12px;height:12px;border:3px solid var(--paper);border-radius:50%;background:var(--blue);box-shadow:0 0 0 2px var(--blue)}.event time{color:var(--blue);font-size:12px;font-weight:800}.event h3{margin:3px 0 5px;font-size:17px}.event p{margin:0;color:var(--muted);font-size:14px}.flow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;align-items:stretch}.flow-step{position:relative;min-height:112px;padding:16px 13px;border:1px solid var(--line);border-radius:15px;background:#fbfcfe}.flow-step:not(:last-child)::after{content:"→";position:absolute;z-index:2;top:40px;right:-15px;color:var(--blue);font-weight:900}.flow-step b{display:block;margin-bottom:8px;color:var(--blue);font-size:12px}.flow-step span{font-size:14px;font-weight:750}.callout{margin-top:18px;padding:18px 20px;border-left:4px solid var(--blue);border-radius:0 14px 14px 0;background:var(--blue-soft)}.callout.warn{border-left-color:var(--amber);background:var(--amber-soft)}.callout strong{display:block;margin-bottom:4px}.callout p{margin:0;color:var(--muted);font-size:14px}pre{margin:16px 0 0;padding:18px;border-radius:15px;background:#111827;color:#e8edf7;overflow:auto;font:13px/1.65 Consolas,"Courier New",monospace;white-space:pre-wrap}.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.fact{padding:18px;border:1px solid var(--line);border-radius:15px}.fact span{display:block;color:var(--muted);font-size:12px}.fact strong{display:block;margin-top:5px;font-size:17px}.risk-list,.checklist{display:grid;gap:10px;margin:18px 0 0;padding:0;list-style:none}.risk-list li,.checklist li{position:relative;padding:14px 16px 14px 44px;border:1px solid var(--line);border-radius:14px;background:#fbfcfe}.risk-list li::before,.checklist li::before{position:absolute;left:15px;top:13px;display:grid;width:22px;height:22px;place-items:center;border-radius:7px;font-size:12px;font-weight:900}.risk-list li::before{content:"!";color:var(--amber);background:var(--amber-soft)}.checklist li::before{content:"✓";color:var(--green);background:var(--green-soft)}.commit{display:grid;grid-template-columns:88px minmax(0,1fr);gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}.commit:last-child{border-bottom:0}.hash{font:12px/1.5 Consolas,monospace;color:var(--blue);font-weight:800}.commit b{display:block;font-size:14px}.commit span{display:block;color:var(--muted);font-size:12px}.footer{padding:30px 0 50px;color:var(--muted);font-size:12px;text-align:center}
    @media(max-width:820px){.meta-grid,.facts{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.flow{grid-template-columns:repeat(2,minmax(0,1fr))}.flow-step:not(:last-child)::after{display:none}.section{padding:24px}.section-head{display:block}}
    @media(max-width:520px){.wrap{width:min(100% - 24px,1080px)}.hero{padding:48px 0 30px}.hero-copy{font-size:16px}.flow{grid-template-columns:1fr}.section{padding:20px;border-radius:17px}.commit{grid-template-columns:1fr;gap:3px}}
    @media print{body{background:#fff}.toc{display:none}.hero{padding:30px 0;background:#fff}.section{break-inside:avoid;box-shadow:none}.wrap{width:100%;max-width:none}a{color:inherit}}
  </style>
</head>
<body>
  <header class="hero">
    <div class="wrap">
      <p class="kicker">WEEKLY BUILD LOG · 2026.07</p>
      <h1>직무 메모리<br>7월 4주차 작업 기록</h1>
      <p class="hero-copy">사내 AI 경진대회 제안 프로젝트의 화면 구현, 업무 중심 목업, OpenAI 검색 연결, 첫 실제 데이터 검토까지의 진행 상황을 한 문서로 정리했습니다.</p>
      <div class="badges"><span class="badge done">● 구현 완료</span><span class="badge review">● 데이터 검토</span><span class="badge hold">● 정책 결정 보류</span></div>
      <div class="meta-grid"><div class="meta-card"><span>현재 브랜치</span><strong>feature/openai-jarvis-search</strong></div><div class="meta-card"><span>현재 데모</span><strong>로컬 제품 프로토타입 v4</strong></div><div class="meta-card"><span>기록 기준일</span><strong>2026년 7월 21일</strong></div></div>
    </div>
  </header>
  <nav class="toc" aria-label="문서 목차"><div class="wrap toc-inner"><a href="#goal">목표</a><a href="#wins">핵심 성과</a><a href="#timeline">타임라인</a><a href="#flow">제품 흐름</a><a href="#api">API 운영</a><a href="#data">실제 데이터</a><a href="#git">Git 상태</a><a href="#continue">이어가기</a></div></nav>
  <main class="wrap">
    <section class="section" id="goal"><div class="section-head"><div><span class="eyebrow">01 · PROJECT</span><h2>프로젝트 목표</h2><p class="section-lead">직원이 남긴 문서와 기록을 단순 검색 결과가 아니라 ‘업무 건’으로 연결해, 다음 행동과 근거, 진행 기록, 최종 기안까지 이어주는 AI 업무승계 비서를 구현합니다.</p></div><span class="badge done">방향 확정</span></div><div class="grid"><article class="card"><div class="number">A</div><h3>자료를 업무 맥락으로 연결</h3><p>문서 제목만 찾는 대신 어떤 업무의 근거인지, 지금 무엇을 해야 하는지 함께 보여줍니다.</p></article><article class="card"><div class="number">B</div><h3>직원의 입력을 행동으로 전환</h3><p>질문, 메모, 할 일, 기안 요청을 하나의 입력창에서 받아 적절한 업무 화면으로 연결합니다.</p></article></div></section>
    <section class="section" id="wins"><div class="section-head"><div><span class="eyebrow">02 · RESULTS</span><h2>이번 기록의 핵심 성과</h2></div><span class="badge done">4개 축 완료</span></div><div class="grid"><article class="card"><div class="number">1</div><h3>홈과 업무 작업대</h3><p>홈의 만능 입력, 내 업무, 업무별 근거·체크리스트·진행 기록·기안 화면을 연결했습니다.</p></article><article class="card"><div class="number">2</div><h3>업무 중심 상태 모델</h3><p>자료를 업무별 근거로 묶고, 할 일과 메모가 같은 업무에서 계속 쌓이도록 구성했습니다.</p></article><article class="card"><div class="number">3</div><h3>OpenAI 검색 연결</h3><p>서버에서만 API 키를 사용하고 구조화된 AI 판단을 검증한 뒤 화면 행동으로 적용합니다.</p></article><article class="card"><div class="number">4</div><h3>로컬 키 자동 로딩</h3><p>Git에 포함되지 않는 `.env`를 사용해 매 실행마다 API 키를 다시 입력하지 않도록 만들었습니다.</p></article></div></section>
    <section class="section" id="timeline"><div class="section-head"><div><span class="eyebrow">03 · TIMELINE</span><h2>작업 타임라인</h2></div></div><div class="timeline"><article class="event"><time>오프닝·홈</time><h3>캐릭터와 사무실 배경을 활용한 시작 화면</h3><p>서류 더미에서 업무를 넘겨받아 AI 모니터로 연결되는 프로젝트 이야기를 시각화했습니다.</p></article><article class="event"><time>제품 목업</time><h3>업무 작업대 중심으로 정보 구조 재편</h3><p>업무별 다음 행동, 연결 근거, 체크리스트, 기록, 결과물을 한 흐름에서 확인하도록 구성했습니다.</p></article><article class="event"><time>AI 연결</time><h3>로컬 서버와 구조화된 검색 판단 구현</h3><p>브라우저에는 키를 노출하지 않고, 허용된 업무·근거 ID만 AI가 선택하도록 계약을 만들었습니다.</p></article><article class="event"><time>실제 호출 검증</time><h3>모델 권한 문제를 확인하고 호환 모델로 변경</h3><p>접근 권한이 없던 모델 대신 `gpt-5.4-mini`를 사용해 실제 AI 근거 답변 표시까지 확인했습니다.</p></article><article class="event"><time>첫 실제 데이터</time><h3>비식별 유지보수 절차 데이터 검토</h3><p>문서 구조와 잔여위험을 확인하고, 우선 저장소에 올리지 않고 로컬 데모에서만 사용하기로 결정했습니다.</p></article></div></section>
    <section class="section" id="flow"><div class="section-head"><div><span class="eyebrow">04 · PRODUCT FLOW</span><h2>현재 제품 흐름</h2></div></div><div class="flow"><div class="flow-step"><b>01</b><span>홈에서 질문·메모 입력</span></div><div class="flow-step"><b>02</b><span>AI가 의도와 대상 업무 판단</span></div><div class="flow-step"><b>03</b><span>허용된 업무·근거 ID 검증</span></div><div class="flow-step"><b>04</b><span>업무 작업대 열기</span></div><div class="flow-step"><b>05</b><span>근거·답변·다음 행동 표시</span></div><div class="flow-step"><b>06</b><span>할 일·메모·기안으로 연결</span></div></div><div class="callout"><strong>안전한 폴백</strong><p>OpenAI 호출이 실패해도 전체 화면을 막지 않고 기존 샘플 응답 경로로 전환합니다. 실제 AI 응답과 샘플 응답은 화면에서 구분해 표시합니다.</p></div></section>
    <section class="section" id="api"><div class="section-head"><div><span class="eyebrow">05 · LOCAL API</span><h2>OpenAI API 운영 방법</h2></div><span class="badge done">실제 호출 검증</span></div><p class="section-lead">API 키는 브라우저나 GitHub에 저장하지 않고 로컬 `.env`에서 서버만 읽습니다.</p><pre>OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
PORT=8400</pre><pre>cd kdhc-ai-contest
npm run demo:ai</pre><div class="callout warn"><strong>키 보안 원칙</strong><p>실제 키는 이 문서, 채팅, 커밋에 적지 않습니다. 서버 종료는 실행한 PowerShell에서 `Ctrl+C`를 누릅니다.</p></div></section>
    <section class="section" id="data"><div class="section-head"><div><span class="eyebrow">06 · REAL DATA REVIEW</span><h2>실제 유지보수 데이터 검토</h2><p class="section-lead">`sanitized.md`와 `변환결과_REVIEW.json`을 첫 실제 데이터 후보로 검토했습니다. 원문은 저장소로 복사하지 않았습니다.</p></div><span class="badge review">수동 검토 필요</span></div><div class="facts"><div class="fact"><span>변환 판정</span><strong>REVIEW</strong></div><div class="fact"><span>잔여위험</span><strong>MEDIUM</strong></div><div class="fact"><span>사용 경계</span><strong>로컬 데모에서만 사용</strong></div></div><ul class="risk-list"><li>정기점검, 조작 승인, 수리의뢰, 설비보존, 분야별 기준, 안전 지침 등 7개 상위 절차 영역을 확인했습니다.</li><li>직접 식별자는 제거됐지만 업종과 설비 구성, 승인 계층으로 발행기관 범주가 좁혀질 가능성이 남아 있습니다.</li><li>본문에서 분리된 도해 132종은 내용이 검증되지 않아 함께 반출하거나 저장소에 포함하지 않습니다.</li><li>외부 API 전송 범위는 아직 결정하지 않음 — 결정 전까지 실제 절차 내용을 OpenAI 요청에 포함하지 않습니다.</li></ul><div class="callout"><strong>제품 활용 후보</strong><p>첫 업무를 ‘정기점검보수 기본계획 수립’으로 만들고, 절차 근거 카드·필수 확인사항·승인 단계·안전 경고를 로컬 구조화 데이터로 연결하는 방향이 적합합니다.</p></div></section>
    <section class="section" id="git"><div class="section-head"><div><span class="eyebrow">07 · VERSION CONTROL</span><h2>Git 상태와 주요 커밋</h2></div><a href="https://github.com/sangwonMoon-kor/kdhc-ai-contest/tree/feature/openai-jarvis-search">GitHub 브랜치 보기 →</a></div><div class="commit"><span class="hash">6b61f33</span><div><b>OpenAI E2E 검증 안정화</b><span>실제 브라우저 흐름의 경합 조건을 보강했습니다.</span></div></div><div class="commit"><span class="hash">177454b</span><div><b>로컬 `.env` 자동 로딩</b><span>PowerShell을 다시 열어도 실행 명령 하나로 키를 불러오도록 했습니다.</span></div></div><div class="commit"><span class="hash">6524cec</span><div><b>사용 가능한 AI 모델 적용</b><span>API 프로젝트에서 접근 가능한 `gpt-5.4-mini`로 기본값을 변경했습니다.</span></div></div><div class="commit"><span class="hash">eb87b07</span><div><b>주간 작업 기록 HTML 설계</b><span>이 문서의 내용, 보안 경계, 검증 기준을 확정했습니다.</span></div></div><div class="callout warn"><strong>로컬 전용 파일</strong><p>`.env`, `sanitized.md`, `변환결과_REVIEW.json`은 GitHub 브랜치에 포함하지 않습니다. 다른 컴퓨터에서 실제 데이터 작업을 이어가려면 승인된 내부 전달 수단이 별도로 필요합니다.</p></div></section>
    <section class="section" id="continue"><div class="section-head"><div><span class="eyebrow">08 · HANDOFF</span><h2>이어가기 체크리스트</h2></div></div><ol class="checklist"><li>비공개 저장소를 클론하고 `feature/openai-jarvis-search` 브랜치로 이동합니다.</li><li>`npm install`로 의존성을 준비합니다.</li><li>`.env.example`을 `.env`로 복사하고 API 키는 로컬 파일에만 입력합니다.</li><li>`npm run demo:ai`를 실행하고 `http://127.0.0.1:8400/app.html`을 엽니다.</li><li>검색 결과가 `AI 응답 · 시연용 샘플 데이터 기반`으로 표시되는지 확인합니다.</li><li>실제 유지보수 데이터는 외부 API 전송 정책을 결정하기 전까지 로컬 규칙 기반 처리만 검토합니다.</li></ol><pre>git clone https://github.com/sangwonMoon-kor/kdhc-ai-contest.git
cd kdhc-ai-contest
git switch feature/openai-jarvis-search
npm install
Copy-Item .env.example .env
npm run demo:ai</pre><p><a href="../README.md">README 보기</a> · <a href="../demo/app.html">제품 프로토타입 열기</a> · <a href="superpowers/specs/2026-07-21-weekly-worklog-html-design.md">이 문서의 설계 기준 보기</a></p></section>
  </main>
  <footer class="footer"><div class="wrap">직무 메모리 · 사내 AI 경진대회 제품 프로토타입 · 2026년 7월 4주차</div></footer>
</body>
</html>
```

- [ ] **Step 2: Run the focused verifier**

Run:

```powershell
npm run test:worklog
```

Expected: `Weekly worklog verification passed.`

- [ ] **Step 3: Run existing OpenAI regression checks**

Run:

```powershell
npm run test:openai
```

Expected: contract, server, and static search verification all pass.

- [ ] **Step 4: Check formatting and commit the implementation**

Run:

```powershell
git diff --check
git add -- package.json demo/tests/verify-weekly-worklog.js "docs/7월 4주차.html"
git commit -m "7월 4주차 작업 기록 추가"
```

Expected: no diff-check errors and one commit containing exactly the three implementation files.

### Task 3: Perform final browser and repository verification

**Files:**
- Verify: `docs/7월 4주차.html`
- Verify: `demo/tests/verify-weekly-worklog.js`
- Verify: `package.json`

**Interfaces:**
- Consumes: the committed worklog artifact and verifier.
- Produces: evidence that the document is readable, responsive, secure, and reproducible.

- [ ] **Step 1: Open the document in a local browser session**

Start a temporary local server from the repository root:

```powershell
node -e "const fs=require('fs'),http=require('http');const body=fs.readFileSync('docs/7월 4주차.html');http.createServer((q,s)=>{s.writeHead(200,{'content-type':'text/html; charset=utf-8'});s.end(body)}).listen(8410,'127.0.0.1')"
```

Open `http://127.0.0.1:8410/`. Confirm the hero, status badges, two-column cards, timeline, product flow, risk summary, commits, and handoff checklist are visually readable. Stop the temporary server with `Ctrl+C`.

- [ ] **Step 2: Run the complete relevant verification set**

Run:

```powershell
npm run test:worklog
npm run test:openai
git diff --check
git status -sb
```

Expected: both test commands pass, diff check is silent, and the branch is clean with one new local commit ahead of its upstream until the user requests a push.
