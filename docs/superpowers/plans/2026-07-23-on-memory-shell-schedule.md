# ON_메모리 공통 셸·조직 일정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 홈의 시각 언어를 전체 화면으로 확장하고, `홈 / 내 업무 / 일정 / 클라우드` 공통 사이드바와 `내 업무 / 우리 과 / 부서 전체` 독립 레이어 일정을 구현한다.

**Architecture:** `product-ui`의 정적 SPA 구조는 유지한다. 새 순수 모듈 `workspace-model.js`가 v1 브라우저 상태를 v2로 이관하고 조직·역할·업무 관계·개인 일정·레이어 합집합을 계산한다. `app.js`는 공통 셸과 화면 렌더링만 담당하며, 기존 `home-model.js`는 날짜 구간 계산을 계속 맡는다. 기존 엔진 forecast는 어댑터를 통해 같은 업무 ID에 조직/관계/기간 정보를 덧붙인다.

**Tech Stack:** 정적 HTML/CSS, Vanilla JavaScript UMD/CommonJS, Node.js `assert`, Playwright 1.61.1, 기존 `JikmuApi` fixture/live 어댑터

## Global Constraints

- UI·UX 정본은 `product-ui/`이고 팀 저장소 `service/public/`은 이 계획에서 수정하지 않는다.
- 공통 사이드바의 메뉴 이름은 모든 데스크톱 화면에서 항상 보인다: `홈`, `내 업무`, `일정`, `클라우드`.
- 홈의 2주 달력은 현재 사용자와 관계된 업무와 개인 일정만 보여준다.
- 일정 화면의 `내 업무`, `우리 과`, `부서 전체`는 라디오 버튼이 아니라 독립 다중 선택 레이어다.
- 선택된 레이어는 합집합으로 표시하고 같은 업무는 한 번만 렌더링한다. 대표 관계 우선순위는 `내 업무 > 우리 과 > 부서 전체`다.
- 업무는 시작일부터 종료일까지 전체 막대로 표시하며 마일스톤은 그 막대 위에 표시한다.
- 개인 일정은 홈과 `내 업무` 레이어에만 포함하고 녹색으로 구분한다.
- 기존 v1 localStorage, fixture/live/auto 모드, 근거 drawer, 워크벤치·기안 흐름을 보존한다.
- 데이터가 없으면 추측하지 않고 빈 상태 또는 `확인 필요`로 표현한다.
- 390px에서는 사이드바를 상단 고정 메뉴로 재배치하되 메뉴명이 읽히고 문서 전체 가로 overflow가 없어야 한다.

---

## Task 1: v2 작업공간 상태와 v1 마이그레이션 계약 추가

**Files:**
- Create: `product-ui/workspace-model.js`
- Create: `product-ui/tests/verify-workspace-model.js`
- Modify: `product-ui/index.html`
- Modify: `product-ui/sync-manifest.json`
- Modify: `package.json`

**Interfaces:**

```js
window.OnMemoryWorkspaceModel = {
  SCOPE: { MINE: "mine", SECTION: "section", DEPARTMENT: "department" },
  createDemoContext(),
  createDemoState(),
  migrateState(raw, context),
  adaptForecastItem(item, context, simISO),
  selectHomeEvents(state, calendarWindow),
  selectScheduleEvents(state, calendarWindow, selectedScopes),
  toggleScheduleScope(selectedScopes, scope)
};
```

- [ ] **Step 1: 실패하는 순수 모델 테스트 작성**

```js
// product-ui/tests/verify-workspace-model.js
const assert = require("assert");
const model = require("../workspace-model.js");
const context = model.createDemoContext();
const migrated = model.migrateState({
  v: 1,
  selectedWorkId: "work-a",
  works: [{ id: "work-a", title: "정기점검", todos: [], records: [], sources: [] }]
}, context);

assert.equal(migrated.v, 2);
assert.equal(migrated.currentPersonId, "person-kim-hannan");
assert.equal(migrated.currentRoleId, "role-maintenance-planning");
assert.equal(migrated.works[0].id, "work-a");
assert(Array.isArray(migrated.personalSchedules));

const events = model.selectScheduleEvents(model.createDemoState(), {
  startISO: "2026-01-01", endISO: "2026-01-31"
}, ["mine", "section", "department"]);
assert.equal(new Set(events.filter((event) => event.kind === "work").map((event) => event.workId)).size,
  events.filter((event) => event.kind === "work").length);
assert(events.some((event) => event.visibleScopes.includes("mine") && event.primaryScope === "mine"));
assert(events.some((event) => event.kind === "personal"));
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-workspace-model.js`

Expected: FAIL with `Cannot find module '../workspace-model.js'`.

- [ ] **Step 3: 상태 스키마와 안전한 마이그레이션 구현**

```js
// 핵심 형태 — workspace-model.js
{
  v: 2,
  currentPersonId: "person-kim-hannan",
  currentRoleId: "role-maintenance-planning",
  org: {
    departments: [{ id: "dept-plant", name: "발전처" }],
    sections: [{ id: "section-maintenance", departmentId: "dept-plant", name: "정비기획과" }],
    people: [{ id: "person-kim-hannan", sectionId: "section-maintenance", name: "김한난" }],
    roles: [{ id: "role-maintenance-planning", personId: "person-kim-hannan", name: "정기점검보수 계획" }]
  },
  works: [],
  personalSchedules: [],
  roleLibraries: [{ roleId: "role-maintenance-planning", items: [], proposals: [], rules: [], actionLog: [] }],
  selectedWorkId: null
}
```

`migrateState`는 원본 업무 ID, todos, records, sources, draft를 그대로 보존하고 누락된 `sectionId`, `departmentId`, `relations`, `schedule`만 시연 컨텍스트 기본값으로 보충한다. 알 수 없는 날짜는 만들지 않는다.

- [ ] **Step 4: forecast 어댑터와 레이어 선택자 구현**

`adaptForecastItem`은 기존 `w-<stageId>-m<month>` ID를 유지하고 `schedule: {startISO:null,endISO:dueDate,milestones:[]}`와 현재 사용자 `owner` 관계를 추가한다. `selectScheduleEvents`는 선택 레이어별 포함 여부를 모두 `visibleScopes`에 남긴 뒤 `workId`로 중복 제거한다.

- [ ] **Step 5: 브라우저 로드·동기화·테스트 명령 등록**

`index.html`에서 `workspace-model.js`를 `home-model.js` 다음, `app.js` 전에 불러온다. `sync-manifest.json`과 `package.json`에 각각 파일과 `test:product-ui:workspace-model`을 추가하고 전체 테스트 체인에 포함한다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-workspace-model.js`

Expected: `Workspace model contract passed`.

```bash
git add product-ui/workspace-model.js product-ui/tests/verify-workspace-model.js product-ui/index.html product-ui/sync-manifest.json package.json
git commit -m "feat: ON_메모리 작업공간 상태 모델 추가"
```

## Task 2: 앱 상태를 v2 모델에 연결하고 기존 흐름 보존

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/tests/verify-home-state.js`
- Modify: `product-ui/tests/verify-app-data-mode.js`
- Modify: `product-ui/tests/verify-showcase-e2e.js`

- [ ] **Step 1: v1 저장 상태가 v2로 이관되는 실패 테스트 작성**

기존 테스트의 `loadState()` 기대값을 `v:2`로 바꾸되 업무 ID·due·sources·scheduleCandidates가 동일함을 별도로 검증한다. 손상된 JSON은 `createDemoState()`로 안전 복구되는지도 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-home-state.js`

Expected: FAIL because `loadState()` still returns v1.

- [ ] **Step 3: 상태 초기화와 forecast 시드를 모델에 위임**

```js
const workspaceModel = window.OnMemoryWorkspaceModel;
function blankState() { return workspaceModel.createDemoState(); }
function loadState() {
  try { return workspaceModel.migrateState(JSON.parse(storage.getItem(SKEY) || "null")); }
  catch (error) { return blankState(); }
}
```

`seedFromForecast`는 기존 중복 방지 `seedKey` 규칙을 유지하면서 `adaptForecastItem` 결과를 저장한다. 기존 `normalizeRecord`, 일정 후보 확인·undo·retarget 동작은 v2 업무에서도 동일하게 작동시킨다.

- [ ] **Step 4: 회귀 테스트 통과**

Run: `node product-ui/tests/verify-home-state.js && node product-ui/tests/verify-app-data-mode.js`

Expected: both contracts pass.

- [ ] **Step 5: 커밋**

```bash
git add product-ui/app.js product-ui/tests/verify-home-state.js product-ui/tests/verify-app-data-mode.js product-ui/tests/verify-showcase-e2e.js
git commit -m "refactor: 업무 상태를 v2 작업공간에 연결"
```

## Task 3: 네 메뉴 공통 사이드바와 라우팅 구현

**Files:**
- Modify: `product-ui/index.html`
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Modify: `product-ui/tests/verify-source-contract.js`
- Create: `product-ui/tests/verify-product-shell-browser.js`
- Modify: `package.json`

- [ ] **Step 1: 공통 셸 브라우저 계약을 먼저 작성**

Playwright로 `#home`, `#work/list`, `#schedule`, `#cloud`, `#workbench/<id>`를 방문해 모든 화면에 네 메뉴명이 보이고 현재 메뉴에 `aria-current="page"`가 붙는지 검증한다. `#work/calendar`는 `#schedule`로 이동해야 한다. 390px에서도 네 이름과 포커스 링, overflow를 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-product-shell-browser.js`

Expected: FAIL because non-home routes do not render `.app-sidebar`.

- [ ] **Step 3: 공통 셸 렌더러와 라우트 추가**

```js
function renderAppSidebar(active) {
  const items = [
    ["home", "#home", "home", "홈"],
    ["work", "#work/list", "folder", "내 업무"],
    ["schedule", "#schedule", "calendar", "일정"],
    ["cloud", "#cloud", "cloud", "클라우드"]
  ];
  return `<aside class="app-sidebar"><a class="app-brand" href="#home">ON_메모리</a><nav>${items.map(([key, href, icon, label]) =>
    `<a href="${href}" ${key === active ? 'aria-current="page" class="is-current"' : ""}>${homeIcon(icon)}<span>${label}</span></a>`
  ).join("")}</nav></aside>`;
}
```

`route()`가 `main` 안에 `.app-shell > sidebar + .app-content`를 만들고 각 뷰에는 `.app-content`만 전달하게 한다. 기존 홈의 중복 `home-rail`과 비홈 상단 메뉴는 제거하되 데이터 상태·테마 버튼은 콘텐츠 상단 유틸리티로 유지한다. `#cloud`는 다음 계획 전까지 자료가 아직 없다는 정직한 빈 화면을 제공한다.

- [ ] **Step 4: 홈 시각 언어를 전체 셸에 확장**

흰 바탕, 옅은 적색/주황 광원, 반투명 패널, 둥근 모서리, 얇은 경계, 붉은 현재 메뉴를 재사용한다. 데스크톱 사이드바 폭은 `220px` 이상으로 이름이 항상 보이게 하고, 모바일은 4열 상단 메뉴로 바꾼다.

- [ ] **Step 5: 소스 계약과 전체 체인에 브라우저 테스트 등록**

`verify-source-contract.js`는 `#schedule`, `#cloud`, `workspace-model.js` 로드 순서와 네 메뉴 문자열을 검사한다. `test:product-ui:shell-browser`를 전체 테스트 체인에 넣는다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-product-shell-browser.js && node product-ui/tests/verify-source-contract.js`

```bash
git add product-ui/index.html product-ui/app.js product-ui/style.css product-ui/tests/verify-source-contract.js product-ui/tests/verify-product-shell-browser.js package.json
git commit -m "feat: ON_메모리 공통 사이드바 적용"
```

## Task 4: 홈을 내 업무 전용 2주 일정으로 제한

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/tests/verify-home-model.js`
- Modify: `product-ui/tests/verify-home-browser.js`

- [ ] **Step 1: 홈 노출 범위 실패 테스트 추가**

현재 사용자 owner 업무, participant 업무, 같은 과지만 관계없는 업무, 부서 타 과 업무, 개인 일정을 심는다. 홈에는 앞의 두 업무와 개인 일정만 보이고 나머지는 보이지 않아야 한다.

- [ ] **Step 2: `vHome` 선택자를 교체**

`buildCalendarEvents(S.works, window)` 직접 호출 대신 `workspaceModel.selectHomeEvents(S, window)`를 사용한다. 개인 일정은 `data-calendar-kind="personal"`과 녹색 스타일을 쓰며 클릭하면 일정 수정 drawer를 연다. 업무 이벤트는 기존 `workId`로 작업대로 이동한다.

- [ ] **Step 3: 자연어 개인 일정 저장 연결**

업무를 특정하지 않은 날짜 입력은 기존 일정 후보 확인 후 `personalSchedules`에 저장한다. 업무가 특정된 입력은 계속 해당 업무의 기록·후보로 저장한다. 자동 해석 결과는 사용자 확인 전 확정 일정으로 보이지 않는다.

- [ ] **Step 4: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-home-model.js && node product-ui/tests/verify-home-browser.js`

```bash
git add product-ui/app.js product-ui/tests/verify-home-model.js product-ui/tests/verify-home-browser.js
git commit -m "feat: 홈 달력을 내 일정으로 한정"
```

## Task 5: 독립 레이어 방식의 월간 조직 일정 구현

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Create: `product-ui/tests/verify-schedule-browser.js`
- Modify: `package.json`

- [ ] **Step 1: 레이어 합집합 E2E 계약 작성**

`내 업무`만 선택하면 관계 업무와 개인 일정, `우리 과`만 선택하면 과 업무, `부서 전체`만 선택하면 부서 업무가 보이는지 검증한다. 세 레이어를 모두 선택하면 중복 업무가 한 번만 보이고 `data-primary-scope="mine"` 우선순위를 갖는지 확인한다.

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-schedule-browser.js`

Expected: FAIL because `#schedule` has no layer controls.

- [ ] **Step 3: 일정 툴바와 다중 선택 구현**

```html
<fieldset class="schedule-layers" aria-label="표시 범위">
  <label><input type="checkbox" value="mine" checked>내 업무</label>
  <label><input type="checkbox" value="section">우리 과</label>
  <label><input type="checkbox" value="department">부서 전체</label>
</fieldset>
```

선택 상태는 `UI.scheduleScopes`에 저장한다. 모두 해제하면 빈 상태와 `표시할 범위를 선택하세요`를 보여준다. 각 업무의 `schedule.startISO/endISO`를 월 그리드의 주 단위 막대로 잘라 렌더링하고, 마일스톤은 동일 업무 색상의 점/라벨로 표시한다. 종료일만 있는 기존 forecast는 하루 마감 막대로 사실대로 보여준다.

- [ ] **Step 4: 직접 개인 일정 입력 구현**

날짜 셀의 `+ 개인 일정` 버튼은 제목·시작·종료를 받는 작은 drawer를 열고 `personalSchedules`에 저장한다. 유효한 ISO 날짜와 `startISO <= endISO`만 허용하고 저장 뒤 녹색 막대를 즉시 표시한다.

- [ ] **Step 5: 키보드·모바일·겹침 검증**

레이어 checkbox, 이전/다음 달, 업무 막대, 개인 일정 추가가 키보드로 작동해야 한다. 막대가 많은 주는 그리드 높이를 늘리고 텍스트를 생략부호 처리하되 업무 제목은 `title`과 접근 가능한 이름으로 보존한다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-schedule-browser.js`

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-schedule-browser.js package.json
git commit -m "feat: 조직 일정 독립 레이어 구현"
```

## Task 6: 1차 회귀 검증

**Files:**
- Modify if needed: `product-ui/app.js`
- Modify if needed: `product-ui/style.css`

- [ ] Run: `node --check product-ui/workspace-model.js && node --check product-ui/app.js`
- [ ] Run: `npm run test:product-ui`
- [ ] Run: `git diff --check`
- [ ] 1920×1080에서 홈과 일정, 390×844에서 공통 메뉴를 캡처해 메뉴명, 2주 홈 범위, 세 레이어 합집합, 업무 전체 막대, 개인 일정 녹색을 확인한다.
- [ ] `git status --short`가 계획 문서 외 구현 변경 없이 깨끗한지 확인한다.
