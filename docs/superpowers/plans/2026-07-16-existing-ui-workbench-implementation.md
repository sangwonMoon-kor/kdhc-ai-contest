# Existing UI Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** `b8452d1:demo/app.html`의 시각 언어를 보존하면서 제품을 `홈 → 내 업무(목록·달력) → 업무 작업대 → 기안 집중 화면`의 업무 건 중심 구조로 완성하고 GitHub Pages에 배포한다.

**Architecture:** 빌드 없는 단일 HTML 앱 구조를 유지한다. `WORK_SEED`에서 업무 상태를 만들고, 버전이 포함된 localStorage 저장소와 hash 기반 라우터가 홈·내 업무·작업대·기안을 연결한다. 기존 홈 오브젝트와 달력·메모·기안 UI는 각각 업무 알림·업무 탐색·진행 기록·업무별 결과물로 재사용한다.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, Node.js 정적 계약 테스트, Playwright 1.61.1, Microsoft Edge, GitHub Pages

## Global Constraints

- 시각 정본은 `b8452d1:demo/app.html`이며 넓은 대시보드형 `f690f68` UI는 사용하지 않는다.
- `demo/index.html`, `demo/jarvis.html`, `demo/admin.html`은 수정하지 않는다.
- 팀원 저장소 `creationy/jikmu-memory`는 수정하지 않는다.
- 홈 오프닝 영상, 타자 인트로, 좁은 중앙 폭, 흰 배경, 파란 포인트, 다크 모드, 샘플 데이터 고지를 보존한다.
- 전역 기능 탭으로 메모·기안을 노출하지 않는다.
- 표시와 탐색의 기본 단위는 개별 Todo가 아니라 업무 건이다.
- Todo와 해당 근거는 작업대의 같은 맥락에서 확인한다.
- 미확인 기한은 임의 날짜로 만들지 않고 `기한 미정`으로 둔다.
- 샘플 변경은 `jm-workbench-v1` localStorage 키에 저장하고 `샘플 초기화`로 복원한다.
- 로컬 엔진 연결은 localhost/loopback `/api/ask`만 선택적으로 허용하고 실패하면 샘플 응답을 유지한다.
- 모든 텍스트 삽입은 `escapeHtml()` 또는 `textContent`를 사용한다.
- 모든 구현 행동은 실패 테스트 → 최소 구현 → 통과 확인 순서로 진행한다.

---

## File Map

- Modify: `demo/app.html` — 기존 UI 시각 정본과 업무 건 앱 전체
- Modify: `demo/tests/verify-app-workbench.js` — 정적 구조·보안·시각 정본 계약
- Modify: `demo/tests/verify-app-workbench-e2e.js` — 사용자 흐름·반응형·접근성·지속성 검증
- Modify: `demo/screenshots/app-workbench-desktop.png` — 최종 데스크톱 작업대
- Modify: `demo/screenshots/app-workbench-mobile.png` — 최종 모바일 작업대
- Modify: `README.md` — 제품 v4 구조와 검증 명령
- Modify: `docs/아이디어-만능입력.md` — 구현 완료 상태와 다음 실업무 리플레이
- Modify: `docs/superpowers/plans/2026-07-16-existing-ui-workbench-implementation.md` — 완료 체크
- Preserve: `package.json`, `package-lock.json` — 기존 Playwright 스크립트와 버전 사용

---

### Task 1: 기존 UI 정본과 새 제품 계약을 RED로 고정

**Files:**
- Modify: `demo/tests/verify-app-workbench.js`
- Modify: `demo/tests/verify-app-workbench-e2e.js`
- Test: `demo/tests/verify-app-workbench.js`

**Interfaces:**
- Consumes: `demo/app.html` 문자열과 file URL
- Produces: 이후 모든 작업이 지켜야 하는 기존 UI·라우팅·상태 계약

- [x] **Step 1: 정적 계약을 기존 UI 기반으로 교체**

`verify-app-workbench.js`의 핵심 검사를 다음 계약으로 바꾼다.

```js
const checks = [
  ['keeps the original JARVIS home identity', () =>
    html.includes('Hello, <span>JARVIS?') &&
    html.includes('업무 일기예보') &&
    html.includes('오늘의 메모') &&
    html.includes('근거 문서 연결')],
  ['keeps original presentation-safe shell', () =>
    html.includes('assets/app-opening.mp4') &&
    html.includes('시연용 목업 · 샘플 데이터') &&
    /function toggleTheme\(/.test(html)],
  ['uses work-item routes', () =>
    ['#home', '#work/list', '#work/calendar', '#workbench/', '#draft/']
      .every((value) => html.includes(value))],
  ['does not expose memo and draft as global feature tabs', () =>
    !html.includes('id="tab-memo"') && !html.includes('id="tab-draft"')],
  ['provides work state and versioned persistence', () =>
    /const WORK_SEED\s*=/.test(html) &&
    html.includes("const STORAGE_KEY='jm-workbench-v1'") &&
    /function loadState\(/.test(html) && /function saveState\(/.test(html)],
  ['supports contextual workbench actions', () =>
    /function openWorkbench\(/.test(html) &&
    /function submitContextInput\(/.test(html) &&
    /function relinkLastInput\(/.test(html) &&
    /function undoLastAction\(/.test(html)],
  ['renders invalid links safely', () =>
    html.includes('업무를 찾을 수 없습니다') && /function renderNotFound\(/.test(html)],
];
```

- [x] **Step 2: E2E 첫 구간에 기존 홈 보존 계약 추가**

```js
await page.goto(appUrl.replace('#home', '#home'));
await page.waitForSelector('#view-home.active');
assert(await page.isVisible('#heroSearch'), 'original centered home search is missing');
assert(await page.isVisible('#homeForecastObject'), 'original forecast object was removed');
assert(await page.isVisible('#homeMemoObject'), 'original memo object was removed');
assert(await page.isVisible('#homeEvidenceObject'), 'original evidence object was removed');
assert(await page.isVisible('#openMyWork'), 'home has no explicit My Work entry');
```

- [x] **Step 3: 새 계약이 현재 로컬 v4에서 실패하는지 확인**

Run: `npm run test:workbench`

Expected: FAIL with at least `keeps the original JARVIS home identity` and route contract failures.

- [x] **Step 4: 테스트 파일만 커밋**

```powershell
git add -- demo/tests/verify-app-workbench.js demo/tests/verify-app-workbench-e2e.js
git commit -m "기존 UI 기반 작업대 계약 테스트 추가"
```

---

### Task 2: 업무 상태·저장·라우터 구현

**Files:**
- Modify: `demo/app.html`
- Modify: `demo/tests/verify-app-workbench-e2e.js`
- Test: `demo/tests/verify-app-workbench.js`
- Test: `demo/tests/verify-app-workbench-e2e.js`

**Interfaces:**
- Consumes: `WORK_SEED`, URL hash, localStorage key `jm-workbench-v1`
- Produces: `appState`, `getWork(id)`, `loadState()`, `saveState()`, `resetSample()`, `navigate(route, options)`, `openFromHash()`

- [x] **Step 1: 지속성·무효 링크 실패 테스트 추가**

```js
await page.goto(`${baseUrl}#workbench/pump-2026`);
await page.evaluate(() => {
  const work = getWork('pump-2026');
  work.notes.unshift({ id: 'persist-check', tag: '메모', time: '방금', text: '새로고침 유지 확인' });
  saveState();
});
await page.reload();
assert((await page.textContent('#activityList')).includes('새로고침 유지 확인'), 'notes did not persist');

await page.goto(`${baseUrl}#draft/missing-work`);
await page.waitForSelector('#view-notfound.active');
assert((await page.textContent('#notFoundTitle')).includes('업무를 찾을 수 없습니다'), 'invalid deep link silently selected a sample work');

await page.evaluate(() => localStorage.setItem('jm-workbench-v1','{broken json'));
await page.goto(`${baseUrl}#work/list`);
assert(await page.locator('[data-work-id="pump-2026"]').count()===1, 'corrupt storage did not recover the immutable seed');
```

- [x] **Step 2: 불변 샘플과 상태 저장소 구현**

```js
const STORAGE_KEY='jm-workbench-v1';
const WORK_SEED=[
  {
    id:'pump-2026',
    title:'순환수 펌프 정비공사 추진 보고',
    requester:'공무부장',
    due:'2026-04-09',
    status:'진행 중',
    repeat:'매년 4월 반복',
    todos:[], sources:[], notes:[], draftText:''
  }
];

function cloneSeed(){ return JSON.parse(JSON.stringify(WORK_SEED)); }
let appState={ version:1, works:cloneSeed(), selectedWorkId:'pump-2026', lastVisitedWorkId:null };

function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(saved && saved.version===1 && Array.isArray(saved.works)) appState=saved;
  }catch(error){ appState={version:1,works:cloneSeed(),selectedWorkId:'pump-2026',lastVisitedWorkId:null}; }
}
function saveState(){
  try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(appState)); }catch(error){}
}
function getWork(id){ return appState.works.find((work)=>work.id===id)||null; }
function getSelectedWork(){ return getWork(appState.selectedWorkId); }
```

- [x] **Step 3: hash 라우터와 전용 무효 상태 구현**

```js
function routeFromHash(){
  const [name,arg]=location.hash.slice(1).split('/');
  if(name==='work' && ['list','calendar'].includes(arg)) return {name:'work',mode:arg};
  if(['workbench','draft'].includes(name)) return {name,id:decodeURIComponent(arg||'')};
  return {name:'home'};
}
function renderNotFound(id){
  document.querySelector('#notFoundId').textContent=id||'알 수 없는 업무';
  showView('notfound');
}
```

- [x] **Step 4: 다음 행동·진행률을 Todo에서 계산**

```js
function getProgress(work){
  const confirmed=work.todos.filter((todo)=>!todo.candidate);
  const done=confirmed.filter((todo)=>todo.done).length;
  return {done,total:confirmed.length,percent:confirmed.length?Math.round(done/confirmed.length*100):0};
}
function syncNextAction(work){
  const next=work.todos.find((todo)=>!todo.candidate&&todo.next&&!todo.done)||
    work.todos.find((todo)=>!todo.candidate&&!todo.done)||null;
  work.todos.forEach((todo)=>{todo.next=todo===next});
  return next;
}
```

- [x] **Step 5: 정적·E2E 상태 계약 통과**

Run: `npm run test:workbench && npm run test:workbench:e2e`

Expected: state/persistence/not-found assertions PASS; later UI assertions may still fail.

- [x] **Step 6: 상태·라우터 커밋**

```powershell
git add -- demo/app.html demo/tests/verify-app-workbench-e2e.js
git commit -m "업무 상태 저장과 딥링크 라우터 구현"
```

---

### Task 3: 기존 홈과 내 업무 화면 재구성

**Files:**
- Modify: `demo/app.html`
- Modify: `demo/tests/verify-app-workbench-e2e.js`
- Test: `demo/tests/verify-app-workbench-e2e.js`

**Interfaces:**
- Consumes: `appState.works`, `navigate()`, `findPriorityWork()`, `lastVisitedWorkId`
- Produces: `renderHomeObjects()`, `renderWorkList()`, `renderWorkCalendar()`, `openMyWork(mode)`

- [x] **Step 1: 홈 오브젝트와 내 업무 실패 테스트 추가**

```js
await page.goto(`${baseUrl}#home`);
await page.click('#openMyWork');
await page.waitForSelector('#view-work.active');
assert(page.url().endsWith('#work/list'), 'My Work entry did not open list mode');
assert(await page.locator('[data-work-id="pump-2026"]').count()===1, 'work list does not render work items');
await page.click('#workModeCalendar');
assert(page.url().endsWith('#work/calendar'), 'calendar mode is not deep linked');
assert(await page.locator('[data-calendar-work="pump-2026"]').count()===1, 'calendar does not render work items');
```

- [x] **Step 2: 기존 홈 시각 구조를 정본대로 복원**

`git show b8452d1:demo/app.html`을 읽기 전용으로 참고하여 다음 기존 요소와 CSS 문법을 `demo/app.html`에 유지한다.

```html
<main class="view active" id="view-home">
  <section class="hero-stage">
    <button id="homeUrgentObject" class="float-object note-object" type="button"></button>
    <button id="homeForecastObject" class="float-object forecast-object" type="button"></button>
    <button id="homeMemoObject" class="float-object memo-object" type="button"></button>
    <button id="homeEvidenceObject" class="float-object evidence-object" type="button"></button>
    <div class="hero-center">
      <h1>Hello, <span>JARVIS?</span></h1>
      <p>일한 만큼, 준비됩니다.</p>
      <form id="homeForm" class="hero-search">
        <input id="homeInput" placeholder="예: 이번 주 뭐 해야 해?">
        <button type="submit">묻기</button>
      </form>
      <button id="openMyWork" class="home-work-link" type="button">내 업무 전체 보기 →</button>
    </div>
  </section>
</main>
```

- [x] **Step 3: 홈 오브젝트의 결정 규칙 구현**

```js
function findPriorityWork(){
  return [...appState.works]
    .filter((work)=>work.status!=='완료'&&work.due)
    .sort((a,b)=>a.due.localeCompare(b.due)||(a.priority||99)-(b.priority||99)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id))[0]||null;
}
function getHomeSelectedWork(){
  return getWork(appState.lastVisitedWorkId)||findPriorityWork();
}
```

- [x] **Step 4: 내 업무 목록·달력 구현**

기존 v3의 중앙 폭, 헤더 검색창, 캡슐 탭, 달력 스타일을 유지한다. 목록과 달력 모두 같은 `openWorkbench(id)`를 호출하고, 기한 미정 업무는 목록에만 `기한 확인 필요`로 표시한다.

```js
function openMyWork(mode='list'){
  appState.workMode=mode==='calendar'?'calendar':'list';
  renderMyWork();
  navigate(`#work/${appState.workMode}`);
}
```

- [x] **Step 5: 기존 UI·내 업무 E2E 통과**

Run: `npm run test:workbench:e2e`

Expected: original home objects visible; list/calendar route assertions PASS.

- [x] **Step 6: 홈·내 업무 커밋**

```powershell
git add -- demo/app.html demo/tests/verify-app-workbench-e2e.js
git commit -m "기존 홈 UI에 내 업무 탐색 연결"
```

---

### Task 4: 업무 작업대와 입력 연결 구현

**Files:**
- Modify: `demo/app.html`
- Modify: `demo/tests/verify-app-workbench.js`
- Modify: `demo/tests/verify-app-workbench-e2e.js`
- Test: `demo/tests/verify-app-workbench-e2e.js`

**Interfaces:**
- Consumes: `getWork(id)`, `saveState()`, `syncNextAction(work)`, `navigate()`
- Produces: `renderWorkbench(work)`, `routeInput(text, context)`, `applyInput(result, work)`, `relinkLastInput()`, `undoLastAction()`, `focusSource(id)`

- [x] **Step 1: 작업대 핵심 흐름 실패 테스트 추가**

```js
await page.goto(`${baseUrl}#work/calendar`);
await page.click('[data-calendar-work="pump-2026"]');
await page.waitForSelector('#view-workbench.active');
assert(page.url().endsWith('#workbench/pump-2026'), 'work card did not open the workbench');
assert(await page.isVisible('#nextActionPanel'), 'next action is missing');
assert(await page.isVisible('.todo-source'), 'todo has no direct evidence link');

await page.fill('#contextInput','운영부 일정은 5월 둘째 주로 확정');
await page.locator('#contextForm').evaluate((form)=>form.requestSubmit());
assert((await page.textContent('#workFeedback')).includes('결정 기록'), 'decision was not applied as a note');
assert(await page.isVisible('#undoButton'), 'change cannot be undone');

await page.goto(`${baseUrl}#home`);
await page.fill('#homeInput','펌프 기안 자료 찾아줘');
await page.locator('#homeForm').evaluate((form)=>form.requestSubmit());
await page.waitForSelector('#view-workbench.active');
assert(await page.isVisible('#workAnswer'), 'draft evidence question was misrouted to drafting');

await page.fill('#contextInput','펌프 최신값');
await page.locator('#contextForm').evaluate((form)=>form.requestSubmit());
await page.waitForSelector('#view-clarify.active');
assert(await page.isVisible('[data-intent="question"]')&&await page.isVisible('[data-intent="note"]'),'ambiguous intent cannot be corrected');

await page.goto(`${baseUrl}#home`);
await page.fill('#homeInput','팀장님이 신규 설비 홍보행사 준비하라고 했어');
await page.locator('#homeForm').evaluate((form)=>form.requestSubmit());
await page.waitForSelector('#view-clarify.active');
await page.click('.clarify-create');
assert(await page.evaluate(()=>getSelectedWork().due===null),'new work invented a deadline');
assert(await page.isVisible('#undoButton'),'new work creation cannot be undone');
```

- [x] **Step 2: 복합 의도 우선순위를 구현**

```js
function routeInput(text,context='home'){
  const clean=String(text||'').trim();
  const targetId=context==='workbench'?appState.selectedWorkId:detectTarget(clean);
  let intent='ambiguous';
  if(context==='home'&&!targetId&&/(내 업무|이번 ?주.*할 ?일)/.test(clean)) intent='overview';
  else if(/[?？]$|찾아|어디|알려|보여|무엇|뭐가|어떤/.test(clean)) intent='question';
  else if(context==='home'&&/(팀장|부장|올리래|하라고|지시)/.test(clean)) intent='instruction';
  else if(/확정|결정|변경|합의/.test(clean)) intent='note';
  else if(/초안.*써|기안.*작성|보고서.*만들/.test(clean)) intent='draft';
  else if(/해야|확인|요청|챙겨|할 것|하기|까지/.test(clean)) intent='todo';
  return {text:clean,targetId,intent,context};
}
```

- [x] **Step 3: 기존 UI 문법의 작업대 렌더링**

작업대는 기존 중앙 폭을 유지하고 다음 DOM 계약을 제공한다.

```html
<main class="view" id="view-workbench">
  <div class="product-shell workbench-shell">
    <nav class="breadcrumb"><button id="backToWork">내 업무</button><span id="workTitleCrumb"></span></nav>
    <header id="workContext"></header>
    <form id="contextForm"></form>
    <div id="workFeedback" role="status"></div>
    <section id="nextActionPanel"></section>
    <section id="evidencePanel"><div id="sourceList"></div><div id="sourceLinkStatus" role="status" aria-live="polite"></div></section>
    <section id="todoPanel"></section>
    <section id="activityPanel"></section>
    <section id="deliverablePanel"></section>
  </div>
</main>
```

- [x] **Step 4: 할 일 후보·반영·삭제와 다음 행동 갱신 구현**

```js
function confirmTodo(todoId){
  const work=getSelectedWork();
  const todo=work.todos.find((item)=>item.id===todoId);
  if(!todo)return;
  todo.candidate=false;
  syncNextAction(work);
  saveState();
  renderWorkbench(work);
}
function deleteTodoCandidate(todoId){
  const work=getSelectedWork();
  work.todos=work.todos.filter((item)=>item.id!==todoId||!item.candidate);
  saveState();
  renderWorkbench(work);
}
```

- [x] **Step 5: 대상 변경과 되돌리기 구현**

`lastAction`은 방금 입력이 만든 변경의 업무 ID, 유형, 이전 값 또는 삽입 ID만 저장한다. 대상 변경은 `rollbackAction(lastAction)` 후 새 대상에 동일 결과를 한 번 적용한다. 기존 메모·Todo는 변경하지 않는다.

- [x] **Step 6: Todo→근거 접근성 구현**

근거 카드는 `tabindex="-1"`, 구체적인 `aria-label`, 원문 버튼의 문서명 포함 접근성 이름을 가진다. `focusSource()`는 `.focused` 시각 상태, 실제 focus, `sourceLinkStatus` 안내를 함께 적용한다.

- [x] **Step 7: 선택적 로컬 엔진과 응답 경쟁 방어 구현**

```js
let engineSeq=0;
function normalizeEngineUrl(value){
  if(!value)return '';
  try{
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','::1'].includes(url.hostname)||url.username||url.password)return '';
    return url.href.replace(/\/+$/,'');
  }catch(error){ return ''; }
}
const ENGINE=normalizeEngineUrl(new URLSearchParams(location.search).get('engine'));
async function askEngine(question,work){
  if(!ENGINE)return;
  const seq=++engineSeq;
  const expected=work.answer;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),2500);
  try{
    const response=await fetch(`${ENGINE}/api/ask`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question,work_id:work.id,title:work.title}),signal:controller.signal
    });
    if(!response.ok)throw new Error('engine unavailable');
    const data=await response.json();
    if(seq!==engineSeq||work.answer!==expected||!getWork(work.id))return;
    if(data.answer)work.answer=String(data.answer);
  }catch(error){
    // The already-rendered sample answer remains visible.
  }finally{ clearTimeout(timeout); }
}
```

엔진 URL과 질문은 저장 상태에 넣지 않는다. 되돌리기와 새 질문은 `engineSeq`를 증가시켜 이전 응답을 무효화한다.

- [x] **Step 8: 작업대 E2E 통과**

Run: `npm run test:workbench && npm run test:workbench:e2e`

Expected: classification, note undo, todo candidate, evidence focus assertions PASS.

- [x] **Step 9: 작업대 커밋**

```powershell
git add -- demo/app.html demo/tests/verify-app-workbench.js demo/tests/verify-app-workbench-e2e.js
git commit -m "기존 UI 문법으로 업무 작업대 구현"
```

---

### Task 5: 업무별 기안·history·초기화 구현

**Files:**
- Modify: `demo/app.html`
- Modify: `demo/tests/verify-app-workbench-e2e.js`
- Test: `demo/tests/verify-app-workbench-e2e.js`

**Interfaces:**
- Consumes: selected work, hash route, persisted state
- Produces: `openDraft(id, options)`, `saveDraft()`, `returnToWorkbench()`, `resetSample()`

- [x] **Step 1: 기안 맥락·history·초기화 실패 테스트 추가**

```js
await page.goto(`${baseUrl}#workbench/audit-2026`);
await page.click('#draftStart');
assert(page.url().endsWith('#draft/audit-2026'), 'draft lost selected work id');
assert((await page.textContent('#draftBackground')).includes('감사'), 'draft reused pump content');
await page.fill('#draftIntent','운영부 미회신 항목 반영');
await page.click('#draftSave');
await page.reload();
assert(await page.inputValue('#draftIntent')==='운영부 미회신 항목 반영', 'draft did not persist');
await page.goBack();
await page.waitForSelector('#view-workbench.active');

await page.goto(`${baseUrl}#home`);
await page.fill('#homeInput','펌프 추진 보고 기안 작성해줘');
await page.locator('#homeForm').evaluate((form)=>form.requestSubmit());
await page.waitForSelector('#view-draft.active');
await page.goBack();
await page.waitForSelector('#view-workbench.active');
await page.goBack();
await page.waitForSelector('#view-home.active');

page.once('dialog',(dialog)=>dialog.accept());
await page.click('#resetSample');
assert(!(await page.textContent('#activityList')).includes('새로고침 유지 확인'), 'reset did not restore seed');
```

- [x] **Step 2: 업무별 기안 화면 구현**

기존 v3의 문서 서식 CSS와 입력 표현을 재사용한다. 제목·배경·세부 내용·표·근거·주의사항은 선택 업무 데이터에서 렌더링하고 `draftText`를 저장한다.

- [x] **Step 3: 진입 경로별 history 구현**

```js
function openDraft(id,{fromHome=false}={}){
  const work=getWork(id);
  if(!work){renderNotFound(id);return;}
  if(fromHome){
    history.pushState(null,'',`#workbench/${encodeURIComponent(id)}`);
  }
  history.pushState(null,'',`#draft/${encodeURIComponent(id)}`);
  renderDraft(work);
}
```

직접 딥링크 초기화에서는 `pushState`를 호출하지 않는다. 사용자 클릭 이동만 새 history entry를 만든다.

- [x] **Step 4: 샘플 초기화 구현**

```js
function resetSample(){
  if(!confirm('추가한 Todo, 메모와 기안 임시 저장을 모두 지울까요?'))return;
  try{localStorage.removeItem(STORAGE_KEY);}catch(error){}
  appState={version:1,works:cloneSeed(),selectedWorkId:'pump-2026',lastVisitedWorkId:null,workMode:'list'};
  history.pushState(null,'','#home');
  renderApp();
}
```

- [x] **Step 5: 기안·history·지속성 E2E 통과**

Run: `npm run test:workbench:e2e`

Expected: audit draft context, reload persistence, browser Back, sample reset PASS.

- [x] **Step 6: 기안·저장 커밋**

```powershell
git add -- demo/app.html demo/tests/verify-app-workbench-e2e.js
git commit -m "업무별 기안과 샘플 상태 저장 구현"
```

---

### Task 6: 반응형·문서·최종 검증

**Files:**
- Modify: `demo/app.html`
- Modify: `demo/tests/verify-app-workbench-e2e.js`
- Modify: `demo/screenshots/app-workbench-desktop.png`
- Modify: `demo/screenshots/app-workbench-mobile.png`
- Modify: `README.md`
- Modify: `docs/아이디어-만능입력.md`
- Modify: `docs/superpowers/plans/2026-07-16-existing-ui-workbench-implementation.md`

**Interfaces:**
- Consumes: 완성된 전체 앱
- Produces: 재현 가능한 테스트·스크린샷·문서·배포 가능 커밋

- [x] **Step 1: 모바일·키보드 E2E 계약 추가**

```js
const mobile=await browser.newPage({viewport:{width:390,height:844}});
await mobile.goto(`${baseUrl}#workbench/pump-2026`);
const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
assert(overflow<=1,`mobile workbench overflows by ${overflow}px`);
assert((await mobile.locator('#nextActionPanel').evaluate((node)=>node.getBoundingClientRect().top))<700,'next action is too low');
assert(await mobile.isVisible('.sample-badge'),'sample disclosure is hidden on mobile');
```

- [x] **Step 2: 반응형 CSS와 키보드 focus 보정**

390px에서 한 열, 제목·기한·다음 행동 우선순위를 유지한다. 프로그램으로 이동한 `tabindex="-1"` 제목은 시각 outline을 숨기되 버튼의 `:focus-visible`은 유지한다.

- [x] **Step 3: 최종 스크린샷 생성**

Run Playwright with installed Edge at `1440x1200` and `390x844`, route `#workbench/pump-2026`, `fullPage:true`.

Expected outputs:

```text
demo/screenshots/app-workbench-desktop.png
demo/screenshots/app-workbench-mobile.png
```

- [x] **Step 4: README와 아이디어 문서 동기화**

README에는 현재 제품 구조와 아래 명령을 기록한다.

```text
npm ci --ignore-scripts
npm run test:workbench
npm run test:workbench:e2e
```

아이디어 문서는 `기존 UI 기반 작업대 목업 구현 완료, 실업무 리플레이 전`으로 상태를 갱신한다.

- [x] **Step 5: 전체 검증 실행**

```powershell
npm ci --ignore-scripts
npm run test:workbench
npm run test:workbench:e2e
npm audit
git diff --check
git diff --quiet -- demo/index.html demo/jarvis.html demo/admin.html
```

Expected:

```text
static checks: all pass
Playwright E2E: pass
audit: 0 vulnerabilities
diff check: exit 0
presentation originals: no diff
```

- [x] **Step 6: 최종 코드 리뷰**

별도 리뷰어가 Critical/Important 관점으로 시각 정본 보존, 분류 우선순위, undo/relink, persistence, invalid link, history, accessibility를 확인한다. 발견된 문제는 회귀 테스트를 먼저 추가한 뒤 수정한다.

- [x] **Step 7: 구현 완료 커밋**

```powershell
git add -- demo/app.html demo/tests/verify-app-workbench.js demo/tests/verify-app-workbench-e2e.js demo/screenshots/app-workbench-desktop.png demo/screenshots/app-workbench-mobile.png README.md 'docs/아이디어-만능입력.md' docs/superpowers/plans/2026-07-16-existing-ui-workbench-implementation.md
git commit -m "기존 UI 기반 업무 작업대 제품 v4 완성"
```

---

### Task 7: GitHub 배포와 공개 미리보기 검증

**Files:**
- No file changes expected

**Interfaces:**
- Consumes: 검증된 `main` 로컬 커밋
- Produces: `origin/main`과 GitHub Pages 공개 화면

- [ ] **Step 1: 푸시 전 상태 확인**

```powershell
git status --short
git log -3 --oneline
git diff origin/main...HEAD --name-only
```

Expected: worktree clean; 발표용 3파일과 팀원 저장소 변경 없음.

- [ ] **Step 2: main 푸시**

```powershell
git push origin main
```

Expected: push succeeds without force.

- [ ] **Step 3: GitHub Pages 배포 대기·확인**

Poll no longer than 60 seconds per request:

```text
https://sangwonmoon-kor.github.io/kdhc-ai-contest/demo/app.html
```

페이지 title에 `제품 프로토타입 v4`가 포함되고, `#home`, `#work/list`, `#workbench/pump-2026`, `#draft/pump-2026`가 모두 HTTP 200과 정상 DOM을 반환해야 한다.

- [ ] **Step 4: 공개 링크 최종 전달**

최종 응답에는 공개 미리보기 링크, 핵심 변경, 검증 결과, 푸시 커밋을 간결하게 적는다.
