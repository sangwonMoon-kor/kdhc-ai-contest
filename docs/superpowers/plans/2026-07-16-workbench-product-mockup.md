# 업무 작업대 제품 목업 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while implementing each behavior. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 기능별 3탭 목업을 `홈 → 내 업무(목록·달력) → 업무 작업대 → 기안 집중 화면`으로 바꾸고, 한 업무의 Todo·근거·메모·산출물이 같은 맥락을 유지하는 대표 시나리오를 구현한다.

**Architecture:** 빌드 없는 단일 HTML 목업 구조를 유지하되 `WORK_ITEMS`, `selectedWorkId`, `currentView` 상태를 추가한다. 홈 입력은 의도와 대상 업무를 판단해 작업대로 착지시키고, 작업대 입력은 선택된 업무를 고정한 채 질문·메모·Todo 후보·기안 행동을 처리한다. 기안은 상단 탭이 아니라 작업대의 산출물 액션으로 연다.

**Tech Stack:** HTML5, CSS, 바닐라 JavaScript, Node.js 정적 계약 테스트, Microsoft Edge headless 시각 검증

## Global Constraints

- 사용자 저장소 `C:\Users\User\kdhc-ai-contest`만 수정하고 팀원 저장소는 수정하지 않는다.
- 발표용 `demo/index.html`, `demo/jarvis.html`, `demo/admin.html`은 변경하지 않는다.
- 상단 1차 메뉴는 `홈 | 내 업무`만 노출한다.
- 내 업무의 표시 단위는 개별 Todo가 아니라 업무 건이며 목록·달력 보기를 제공한다.
- Todo와 근거 자료는 업무 작업대에서 함께 보여준다.
- 만능 입력은 홈과 작업대 양쪽에 존재한다.
- 기안은 작업대에서 열고 같은 업무로 돌아온다.
- 입력 결과는 분류명이 아니라 연결된 업무와 변경 내용을 보여주고 되돌리기를 제공한다.
- 기존 2026년 4월 샘플과 `시연용 목업 · 샘플 데이터` 표시는 유지한다.
- 실제 백엔드 기능처럼 과장하지 않고 선택적 `/api/ask` 연결 외 동작은 목업 상태로 둔다.

---

### Task 1: 작업대 화면 계약을 실패 테스트로 고정

**Files:**
- Create: `demo/tests/verify-app-workbench.js`
- Test: `demo/tests/verify-app-workbench.js`

**Interfaces:**
- Consumes: 현재 `demo/app.html` 문자열
- Produces: 새 목업이 반드시 제공해야 하는 구조와 행동 계약

- [x] **Step 1: 실패 테스트 작성**

```js
const required = [
  'id="view-work"',
  'id="view-workbench"',
  'id="view-draft"',
  'const WORK_ITEMS',
  'let selectedWorkId',
  'function openWorkbench',
  'function openDraft',
  'function submitContextInput',
  '목록 보기',
  '달력 보기',
  '업무 작업대',
  '되돌리기',
];
```

- [x] **Step 2: 테스트가 기존 목업에서 실패하는지 확인**

Run: `node demo/tests/verify-app-workbench.js`

Expected: FAIL with missing workbench structure.

### Task 2: 홈과 내 업무를 업무 건 중심으로 재구성

**Files:**
- Modify: `demo/app.html`
- Test: `demo/tests/verify-app-workbench.js`

**Interfaces:**
- Consumes: `WORK_ITEMS`, `routeInput(text, context)`
- Produces: `showView(name)`, `openMyWork(mode)`, `openWorkbench(id, feedback)`

- [x] **Step 1: 업무 상태와 화면 전환 최소 구현**

```js
const WORK_ITEMS = [{ id: 'pump-2026', title: '순환수 펌프 정비공사 추진 보고' }];
let selectedWorkId = 'pump-2026';
let currentView = 'home';
function showView(name) { currentView = name; }
function openWorkbench(id, feedback) { selectedWorkId = id; showView('workbench'); }
```

- [x] **Step 2: 홈 입력을 새 업무 또는 기존 업무 작업대로 착지**

명확한 지시는 반복 업무를 연결해 작업대로 이동하고, 애매한 메모는 기능 화면이 아니라 대상 업무를 한 번 확인한다.

- [x] **Step 3: 내 업무에 목록·달력 보기 구현**

목록과 달력 모두 업무 건 단위로 표시하고 업무를 선택하면 같은 `openWorkbench(id)`를 호출한다.

- [x] **Step 4: 정적 계약 테스트 통과 확인**

Run: `node demo/tests/verify-app-workbench.js`

Expected: PASS.

### Task 3: 업무 작업대와 기안 맥락 구현

**Files:**
- Modify: `demo/app.html`
- Test: `demo/tests/verify-app-workbench.js`

**Interfaces:**
- Consumes: `selectedWorkId`, 선택된 업무의 `todos`, `sources`, `notes`, `deliverable`
- Produces: `renderWorkbench()`, `submitContextInput()`, `undoLastAction()`, `openDraft()`, `returnToWorkbench()`

- [x] **Step 1: 작업대 우선순위 렌더링**

상단에 지시·D-day·완료 조건, 본문에 `지금 할 일`과 `함께 볼 자료`, 하단에 진행 기록과 산출물 행동을 둔다.

- [x] **Step 2: 작업대 입력의 문맥 유지 구현**

```js
function submitContextInput() {
  const work = getSelectedWork();
  const result = routeInput(contextInput.value, 'workbench');
  applyResult(work, result);
  showFeedback(`${work.title}에 ${result.summary} · 되돌리기`);
}
```

질문은 근거 답변, 결정 문장은 메모, 행동 문장은 Todo 후보로 붙이고 마지막 변경을 되돌릴 수 있게 한다.

- [x] **Step 3: 기안 집중 화면과 복귀 구현**

`openDraft()`는 선택 업무 제목·근거·메모를 유지하고, `returnToWorkbench()`는 같은 `selectedWorkId`로 돌아온다.

- [x] **Step 4: 테스트 재실행**

Run: `node demo/tests/verify-app-workbench.js`

Expected: PASS.

### Task 4: 반응형·브라우저 검증과 문서 동기화

**Files:**
- Modify: `demo/app.html`
- Modify: `docs/아이디어-만능입력.md`
- Modify: `docs/superpowers/specs/2026-07-10-work-item-centered-product-design.md`
- Create: `demo/screenshots/app-workbench-desktop.png`
- Create: `demo/screenshots/app-workbench-mobile.png`

**Interfaces:**
- Consumes: 완성된 목업 URL hash `#work`, `#workbench`, `#draft`
- Produces: 재현 가능한 화면 캡처와 최종 검증 기록

- [x] **Step 1: 데스크톱과 모바일 레이아웃 검증**

Run Edge headless at `1440x1200` and `390x844`, capture `#workbench`.

Expected: 주요 카드가 잘리지 않고 모바일에서는 한 열로 정렬된다.

- [x] **Step 2: 핵심 상호작용 브라우저 검증**

홈 지시 입력 → 작업대 착지 → 작업대 메모 입력 → 되돌리기 → 기안 → 작업대 복귀를 확인한다.

- [x] **Step 3: 최종 정적 검증**

Run: `node demo/tests/verify-app-workbench.js`

Expected: all checks pass with exit code 0.

- [x] **Step 4: 범위와 변경사항 검토**

Run: `git diff --check` and `git status --short`.

Expected: whitespace error 0, 팀원 저장소 및 발표 정본 변경 0.
